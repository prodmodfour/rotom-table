import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { spendEncounterMoveResourceCosts } from '../../server/domain/moveAutomation/reduceEncounterResources'
import {
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  type MoveResponseCommand,
} from '#shared/moveAutomation/responseCommands'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import { createAuthoritativeLivePlayCommandExecutor } from '../../server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '../../server/livePlay/mapWriteQueue'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteLivePlayOpRepository } from '../../server/storage/opRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqlitePendingMoveResolutionRepository } from '../../server/storage/pendingMoveResolutionRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { executeAttackOfOpportunityLivePlayCommandUseCase } from '../../server/useCases/applyAttackOfOpportunityCommand'
import { listPendingMoveResponsesUseCase } from '../../server/useCases/listPendingMoveResponses'
import {
  replayMoveResponseCommandUseCase,
  resumePendingMoveResolutionUseCase,
} from '../../server/useCases/resumePendingMoveResolution'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayScope,
} from '../../shared/livePlayCommands'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '../../shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const tempRoots: string[] = []
const databases: RotomDatabase[] = []

const playerProfile = (sheetSlug: string): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: `profile_${sheetSlug}00000`.slice(0, 20) as PlayerProfileId,
  displayName: `${sheetSlug} player` as PlayerProfileDisplayName,
  linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug }],
})

const sheet = (slug: string, species: string, nickname: string): CharacterSheet => ({
  slug,
  species,
  nickname,
  level: 20,
  movelist: [],
  abilities: [],
  combat: { currentHp: 60 },
  revision: 2,
})

const baseMap = (
  includeSecondDefender = false,
  movementDestination = false,
): TabletopMap => ({
  schemaVersion: 2,
  revision: 7,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'provoker',
      sheetKind: 'pokemon',
      sheetSlug: 'provoker-mon',
      position: { x: movementDestination ? 2 : 1, y: 0, z: 1 },
    },
    { id: 'attacker', sheetKind: 'pokemon', sheetSlug: 'attacker-mon', position: { x: 0, y: 0, z: 1 } },
    ...(includeSecondDefender
      ? [{ id: 'attacker-two', sheetKind: 'pokemon' as const, sheetSlug: 'attacker-two-mon', position: { x: 1, y: 0, z: 0 } }]
      : []),
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target-mon', position: { x: 5, y: 0, z: 5 } },
  ],
  lights: [],
  initiative: { activeId: 'provoker', round: 3 },
  encounterState: createEmptyEncounterState(),
  metadata: { owner: 'gm' },
  createdAt: 10,
  updatedAt: 20,
})

const createHarness = (options: {
  readonly includeSecondDefender?: boolean
  readonly movementDestination?: boolean
} = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-table-aoo-'))
  tempRoots.push(root)
  const database = openRotomDatabase({ path: join(root, 'rotom.sqlite'), enableWal: false })
  databases.push(database)
  const maps = createSqliteMapRepository(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const pending = createSqlitePendingMoveResolutionRepository(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => 5_000 })
  const realtime = createSqliteRealtimeEventRepository({ database })
  const events: unknown[] = []
  const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
    ...acceptedRealtimeTestHooks(events),
  })
  const map = baseMap(
    options.includeSecondDefender === true,
    options.movementDestination === true,
  )
  maps.save({ slug: map.slug, document: map, revision: map.revision ?? 0, updatedAt: map.updatedAt ?? 20 })
  for (const document of [
    sheet('provoker-mon', 'Snorlax', 'Provoker'),
    sheet('attacker-mon', 'Machop', 'Defender'),
    ...(options.includeSecondDefender ? [sheet('attacker-two-mon', 'Pikachu', 'Second Defender')] : []),
    sheet('target-mon', 'Abra', 'Target'),
  ]) {
    sheets.save({
      kind: 'pokemon',
      slug: document.slug,
      document: document as unknown as Record<string, unknown>,
      revision: document.revision ?? 0,
      updatedAt: 20,
    })
  }

  const readSheet = (kind: 'pokemon' | 'trainer', slug: string) => {
    const stored = sheets.getByRef(kind, slug)
    return stored ? { sheet: { ...stored.sheet, revision: stored.revision } } : null
  }
  return {
    database,
    maps,
    sheets,
    pending,
    ops,
    realtime,
    events,
    triggerDeps: {
      commandExecutor,
      mapRepository: maps,
      pendingResolutionRepository: pending,
      database,
      readSheet,
      listProfiles: vi.fn(() => []),
      now: vi.fn(() => 1_111),
    },
  }
}

const metadataScope = { kind: 'map' as const, lane: 'metadata' as const }

const triggerCommand = (
  opId = 'op_aooprovoke1',
  payload: Record<string, unknown> = {
    action: 'provoke',
    reason: 'ranged-attack',
    provokerId: 'provoker',
    targetIds: ['target'],
  },
  scopes: readonly LivePlayScope[] = [metadataScope],
) => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId,
  mapSlug: 'arena',
  baseRevision: 7,
  type: LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
  scopes,
  payload,
})

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('durable Attack of Opportunity commands', () => {
  it('creates one server-owned defender window and exposes it only to its controller', async () => {
    const harness = createHarness()
    const response = await executeAttackOfOpportunityLivePlayCommandUseCase({
      role: 'player',
      command: triggerCommand(),
      playerProfile: playerProfile('provoker-mon'),
      clientId: 'provoker-client',
      expectedType: LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
    }, harness.triggerDeps)

    expect(response.result).toMatchObject({
      ok: true,
      opId: 'op_aooprovoke1',
      previousRevision: 7,
      revision: 8,
    })
    expect('patches' in response.result ? response.result.patches[0] : null).toMatchObject({
      type: LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
      payload: { action: 'provoke' },
    })
    const storedMap = harness.maps.getBySlug('arena')!
    const summary = storedMap.encounterState?.pendingResolutionSummaries[0]
    expect(summary).toMatchObject({
      canonicalMoveId: 'Attack of Opportunity',
      actorPlacementId: 'provoker',
      status: 'pending',
      outstandingWindowCount: 1,
    })
    const stored = harness.pending.getById(summary!.resolutionId)!
    expect(stored.resolution).toMatchObject({
      continuationKind: 'attack-of-opportunity',
      outstandingWindows: [{
        reasonCode: 'maneuver.attack-of-opportunity.ranged-attack',
        ownership: [{ kind: 'placement', id: 'attacker' }],
        options: [expect.objectContaining({ id: 'attack-of-opportunity.move.struggle' })],
      }],
    })
    expect(stored.resolution.trace.events).toContainEqual(expect.objectContaining({
      kind: 'operation',
      outcome: 'pending',
      input: expect.objectContaining({ timingLimitation: 'post-provoking-action' }),
    }))

    const defenderWindows = listPendingMoveResponsesUseCase({
      role: 'player',
      mapSlug: 'arena',
      playerProfile: playerProfile('attacker-mon'),
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
    })
    const provokerWindows = listPendingMoveResponsesUseCase({
      role: 'player',
      mapSlug: 'arena',
      playerProfile: playerProfile('provoker-mon'),
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
    })
    expect(defenderWindows.windows).toHaveLength(1)
    expect(provokerWindows.windows).toEqual([])
    expect(harness.events).toHaveLength(1)
  })

  it('resolves a post-movement child against the authoritative provoking origin without moving the target back', async () => {
    const harness = createHarness({ movementDestination: true })
    await executeAttackOfOpportunityLivePlayCommandUseCase({
      role: 'gm',
      command: triggerCommand('op_aoomovement01', {
        action: 'provoke',
        reason: 'movement',
        provokerId: 'provoker',
        from: { x: 1, y: 0, z: 1 },
        to: { x: 2, y: 0, z: 1 },
      }),
      clientId: 'gm-client',
      expectedType: LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
    }, harness.triggerDeps)
    const pending = harness.pending.listByMap('arena')[0]!
    expect(pending.resolution.continuationContext).toEqual({
      kind: 'attack-of-opportunity',
      triggerReason: 'movement',
      provokerPlacementId: 'provoker',
      from: { x: 1, y: 0, z: 1 },
      to: { x: 2, y: 0, z: 1 },
      targetPlacementIds: [],
      timingLimitation: 'post-provoking-action',
    })
    const window = pending.resolution.outstandingWindows[0]!
    const command: MoveResponseCommand = {
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: 'op_aoomovementhit1',
      mapSlug: 'arena',
      baseRevision: 8,
      type: MOVE_RESPONSE_COMMAND_TYPES.REACT,
      payload: {
        resolutionId: pending.resolutionId,
        windowId: window.windowId,
        optionId: window.options[0]!.id,
      },
    }
    const response = resumePendingMoveResolutionUseCase({
      command,
      storedResolution: pending,
      window,
      option: window.options[0]!,
      role: 'gm',
      playerProfile: null,
      authorization: { chosenBy: { kind: 'gm', id: null }, source: 'gm-authority' },
      clientId: 'gm-client',
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
      opRepository: harness.ops,
      realtimeEventRepository: harness.realtime,
      publishPersistedRealtimeEvent: vi.fn(),
      random: () => 0.95,
      now: () => 2_000,
    })

    expect(response.result).toMatchObject({ ok: true, revision: 9 })
    expect(response.move?.transaction.attackedTargetIds).toEqual(['provoker'])
    expect(harness.maps.getBySlug('arena')?.placements.find(
      placement => placement.id === 'provoker',
    )?.position).toEqual({ x: 2, y: 0, z: 1 })
  })

  it('rejects a player who does not control the provoking token', async () => {
    const harness = createHarness()
    const response = await executeAttackOfOpportunityLivePlayCommandUseCase({
      role: 'player',
      command: triggerCommand('op_aoodenied1'),
      playerProfile: playerProfile('attacker-mon'),
      clientId: 'attacker-client',
      expectedType: LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
    }, harness.triggerDeps)

    expect(response.result).toMatchObject({ ok: false, reason: 'unauthorized' })
    expect(harness.maps.getBySlug('arena')?.revision).toBe(7)
    expect(harness.pending.listByMap('arena')).toEqual([])
  })

  it('replays a duplicate trigger without creating another window or revision', async () => {
    const harness = createHarness()
    const input = {
      role: 'gm' as const,
      command: triggerCommand('op_aooduplicate1'),
      clientId: 'gm-client',
      expectedType: LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
    }
    const first = await executeAttackOfOpportunityLivePlayCommandUseCase(input, harness.triggerDeps)
    const duplicate = await executeAttackOfOpportunityLivePlayCommandUseCase(input, harness.triggerDeps)

    expect(first.result).toMatchObject({ ok: true, revision: 8 })
    expect(duplicate.result).toEqual(first.result)
    expect(harness.maps.getBySlug('arena')?.revision).toBe(8)
    expect(harness.pending.listByMap('arena')).toHaveLength(1)
  })

  it('records a pass idempotently while another defender window remains reconnect-safe', async () => {
    const harness = createHarness({ includeSecondDefender: true })
    await executeAttackOfOpportunityLivePlayCommandUseCase({
      role: 'gm',
      command: triggerCommand('op_aoomultiwindow1'),
      clientId: 'gm-client',
      expectedType: LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
    }, harness.triggerDeps)
    const pending = harness.pending.listByMap('arena')[0]!
    expect(pending.resolution.outstandingWindows.map(window => window.ownership)).toEqual([
      [{ kind: 'placement', id: 'attacker' }],
      [{ kind: 'placement', id: 'attacker-two' }],
    ])
    const window = pending.resolution.outstandingWindows[0]!
    const command: MoveResponseCommand = {
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: 'op_aoomultipass01',
      mapSlug: 'arena',
      baseRevision: 8,
      type: MOVE_RESPONSE_COMMAND_TYPES.PASS,
      payload: {
        resolutionId: pending.resolutionId,
        windowId: window.windowId,
      },
    }
    const response = resumePendingMoveResolutionUseCase({
      command,
      storedResolution: pending,
      window,
      option: null,
      role: 'gm',
      playerProfile: null,
      authorization: {
        chosenBy: { kind: 'gm', id: null },
        source: 'gm-authority',
      },
      clientId: 'gm-client',
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
      opRepository: harness.ops,
      realtimeEventRepository: harness.realtime,
      publishPersistedRealtimeEvent: vi.fn(),
      now: () => 1_500,
    })

    expect(response.result).toMatchObject({ ok: true, previousRevision: 8, revision: 9 })
    expect(response.move).toBeUndefined()
    const remaining = harness.pending.getById(pending.resolutionId)!
    expect(remaining.status).toBe('pending')
    expect(remaining.resolution.outstandingWindows).toHaveLength(1)
    expect(remaining.resolution.outstandingWindows[0]?.ownership).toEqual([
      { kind: 'placement', id: 'attacker-two' },
    ])
    expect(remaining.resolution.chosenOptions).toEqual([
      expect.objectContaining({ windowId: window.windowId, optionId: null }),
    ])
    expect(harness.maps.getBySlug('arena')?.metadata?.attackOfOpportunity).toBeUndefined()
    expect(harness.maps.getBySlug('arena')?.encounterState?.pendingResolutionSummaries).toEqual([
      remaining.resolution.publicSummary,
    ])
  })

  it('rejects a grounded off-turn opportunity attack under Psychic Terrain before RNG', async () => {
    const harness = createHarness()
    const map = harness.maps.getBySlug('arena')!
    harness.maps.save({
      slug: map.slug,
      document: {
        ...map,
        fieldEffects: {
          weather: [],
          terrains: [{ kind: 'psychic', scope: 'field' }],
          rooms: [],
        },
      },
      revision: map.revision ?? 0,
      updatedAt: map.updatedAt ?? 20,
    })
    await executeAttackOfOpportunityLivePlayCommandUseCase({
      role: 'gm',
      command: triggerCommand('op_aoopsychictrigger1'),
      clientId: 'gm-client',
      expectedType: LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
    }, harness.triggerDeps)
    const pending = harness.pending.listByMap('arena')[0]!
    const window = pending.resolution.outstandingWindows[0]!
    const command: MoveResponseCommand = {
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: 'op_aoopsychicanswer1',
      mapSlug: 'arena',
      baseRevision: 8,
      type: MOVE_RESPONSE_COMMAND_TYPES.REACT,
      payload: {
        resolutionId: pending.resolutionId,
        windowId: window.windowId,
        optionId: window.options[0]!.id,
      },
    }
    const random = vi.fn(() => 0.95)
    const mapBeforeResponse = structuredClone(harness.maps.getBySlug('arena'))
    const pendingBeforeResponse = structuredClone(harness.pending.getById(pending.resolutionId))

    const response = resumePendingMoveResolutionUseCase({
      command,
      storedResolution: pending,
      window,
      option: window.options[0]!,
      role: 'gm',
      playerProfile: null,
      authorization: { chosenBy: { kind: 'gm', id: null }, source: 'gm-authority' },
      clientId: 'gm-client',
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
      opRepository: harness.ops,
      realtimeEventRepository: harness.realtime,
      publishPersistedRealtimeEvent: vi.fn(),
      random,
      now: () => 2_000,
    })

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      currentRevision: 8,
      message: expect.stringContaining('Psychic Terrain (legacy.terrain.psychic)'),
    })
    const replay = replayMoveResponseCommandUseCase({ role: 'gm', command }, {
      database: harness.database,
      mapRepository: harness.maps,
      opRepository: harness.ops,
    })
    expect(replay?.result).toEqual(response.result)
    expect(random).not.toHaveBeenCalled()
    expect(harness.maps.getBySlug('arena')).toEqual(mapBeforeResponse)
    expect(harness.pending.getById(pending.resolutionId)).toEqual(pendingBeforeResponse)
    expect(harness.sheets.getByRef('pokemon', 'provoker-mon')?.sheet)
      .toMatchObject({ combat: { currentHp: 60 } })
  })

  it('rejects an unavailable reaction cost without changing the pending response or map', async () => {
    const harness = createHarness()
    const map = harness.maps.getBySlug('arena')!
    const spent = spendEncounterMoveResourceCosts({}, {
      placementId: 'attacker',
      canonicalMoveId: 'Seed Reaction',
      resolutionId: 'seed.reaction.resolution',
      sourceOperationId: 'seed.reaction.operation',
      costs: [{
        id: 'seed.cost.interrupt',
        phase: 'pay',
        cost: { kind: 'action-resource', resource: 'interrupt', amount: 1 },
      }],
      movementBudget: null,
      movementDistance: 0,
      round: 3,
      turn: null,
      actedThisRound: false,
    })
    harness.maps.save({
      slug: map.slug,
      document: {
        ...map,
        encounterState: {
          ...createEmptyEncounterState(),
          turnResources: spent.resources,
        },
      },
      revision: map.revision ?? 0,
      updatedAt: map.updatedAt ?? 20,
    })
    await executeAttackOfOpportunityLivePlayCommandUseCase({
      role: 'gm',
      command: triggerCommand('op_aoounavailable1'),
      clientId: 'gm-client',
      expectedType: LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
    }, harness.triggerDeps)
    const pending = harness.pending.listByMap('arena')[0]!
    const window = pending.resolution.outstandingWindows[0]!
    const command: MoveResponseCommand = {
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: 'op_aoounavailable2',
      mapSlug: 'arena',
      baseRevision: 8,
      type: MOVE_RESPONSE_COMMAND_TYPES.REACT,
      payload: {
        resolutionId: pending.resolutionId,
        windowId: window.windowId,
        optionId: window.options[0]!.id,
      },
    }
    const random = vi.fn(() => 0.95)
    const request = () => resumePendingMoveResolutionUseCase({
      command,
      storedResolution: pending,
      window,
      option: window.options[0]!,
      role: 'gm' as const,
      playerProfile: null,
      authorization: { chosenBy: { kind: 'gm' as const, id: null }, source: 'gm-authority' as const },
      clientId: 'gm-client',
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
      opRepository: harness.ops,
      realtimeEventRepository: harness.realtime,
      publishPersistedRealtimeEvent: vi.fn(),
      random,
      now: () => 2_000,
    })
    const mapBeforeResponse = structuredClone(harness.maps.getBySlug('arena'))
    const pendingBeforeResponse = structuredClone(harness.pending.getById(pending.resolutionId))

    const first = request()
    const drawsAfterFirst = random.mock.calls.length
    const duplicate = request()

    expect(first.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      currentRevision: 8,
      message: expect.stringContaining('action-unavailable'),
    })
    expect(duplicate.result).toEqual(first.result)
    expect(random).toHaveBeenCalledTimes(drawsAfterFirst)
    expect(harness.maps.getBySlug('arena')).toEqual(mapBeforeResponse)
    expect(harness.pending.getById(pending.resolutionId)).toEqual(pendingBeforeResponse)
    expect(harness.sheets.getByRef('pokemon', 'provoker-mon')?.sheet)
      .toMatchObject({ combat: { currentHp: 60 } })
  })

  it('commits a chosen Struggle as an ancestry-linked child and replays the response once', async () => {
    const harness = createHarness()
    await executeAttackOfOpportunityLivePlayCommandUseCase({
      role: 'gm',
      command: triggerCommand('op_aoochildtrigger1'),
      clientId: 'gm-client',
      expectedType: LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
    }, harness.triggerDeps)
    const pending = harness.pending.listByMap('arena')[0]!
    const window = pending.resolution.outstandingWindows[0]!
    const command: MoveResponseCommand = {
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: 'op_aoochildanswer1',
      mapSlug: 'arena',
      baseRevision: 8,
      profileId: playerProfile('attacker-mon').id,
      type: MOVE_RESPONSE_COMMAND_TYPES.REACT,
      payload: {
        resolutionId: pending.resolutionId,
        windowId: window.windowId,
        optionId: window.options[0]!.id,
      },
    }
    const response = resumePendingMoveResolutionUseCase({
      command,
      storedResolution: pending,
      window,
      option: window.options[0]!,
      role: 'player',
      playerProfile: playerProfile('attacker-mon'),
      authorization: {
        chosenBy: { kind: 'placement', id: 'attacker' },
        source: 'window-owner',
      },
      clientId: 'attacker-client',
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
      opRepository: harness.ops,
      realtimeEventRepository: harness.realtime,
      publishPersistedRealtimeEvent: vi.fn(),
      random: () => 0.95,
      now: () => 2_000,
    })

    expect(response.result).toMatchObject({
      ok: true,
      opId: 'op_aoochildanswer1',
      previousRevision: 8,
      revision: 9,
    })
    expect(response.move).toMatchObject({
      actorPlacementId: 'attacker',
      moveName: 'Struggle',
      transaction: expect.objectContaining({ attackedTargetIds: ['provoker'] }),
      trace: expect.objectContaining({
        ancestry: [expect.objectContaining({
          resolutionId: pending.resolutionId,
          canonicalId: 'Attack of Opportunity',
          parentOperationId: window.operationId,
        })],
      }),
    })
    const terminal = harness.pending.getById(pending.resolutionId)!
    expect(terminal.status).toBe('committed')
    expect(terminal.resolution.trace.events).toContainEqual(expect.objectContaining({
      kind: 'child-move',
      canonicalId: 'Struggle',
      outcome: 'completed',
    }))
    expect(terminal.resolution.chosenOptions).toEqual([
      expect.objectContaining({
        responseOpId: 'op_aoochildanswer1',
        optionId: 'attack-of-opportunity.move.struggle',
      }),
    ])
    expect(harness.maps.getBySlug('arena')?.metadata?.attackOfOpportunity).toMatchObject({
      usedRoundByAttackerId: { attacker: 3 },
    })
    expect(harness.maps.getBySlug('arena')?.encounterState?.pendingResolutionSummaries).toEqual([])
    expect(harness.maps.getBySlug('arena')?.encounterState
      ?.turnResources.attacker).toMatchObject({
      actions: { interrupt: { spent: 1 } },
      reaction: { available: false },
    })

    const replay = replayMoveResponseCommandUseCase({ role: 'player', command }, {
      database: harness.database,
      mapRepository: harness.maps,
      opRepository: harness.ops,
    })
    expect(replay?.result).toEqual(response.result)
    expect(harness.maps.getBySlug('arena')?.revision).toBe(9)
    expect(harness.maps.getBySlug('arena')?.encounterState
      ?.turnResources.attacker).toMatchObject({
      actions: { interrupt: { spent: 1 } },
      reaction: { available: false },
    })
  })
})
