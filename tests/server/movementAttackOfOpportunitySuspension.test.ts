import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterZone } from '#shared/moveAutomation/encounterZones'
import {
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  type MoveResponseCommand,
} from '#shared/moveAutomation/responseCommands'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type MoveTokenLivePlayCommand,
} from '#shared/livePlayCommands'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { createInMemoryLivePlayOpStore } from '~~/server/livePlay/opStore'
import { resumePendingMoveResolutionUseCase } from '~~/server/useCases/resumePendingMoveResolution'
import { executeMapTokenLivePlayCommandUseCase } from '~~/server/useCases/applyMapTokenAction'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqlitePendingMoveResolutionRepository } from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { canonicalBattlefieldZoneComponents } from '~~/server/domain/moveAutomation/battlefieldZoneDefinitions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, TabletopMap } from '~/types/map'

const tempRoots: string[] = []
const databases: RotomDatabase[] = []

const sheet = (
  slug: string,
  species: string,
  nickname: string,
  currentHp = 60,
  abilities: CharacterSheet['abilities'] = [],
): CharacterSheet => ({
  slug,
  species,
  nickname,
  level: 20,
  movelist: [],
  abilities,
  combat: { currentHp },
  revision: 2,
})

const arenaMap = (overrides: { readonly defenderPosition?: GridAnchor } = {}): TabletopMap => ({
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
    { id: 'provoker', sheetKind: 'pokemon', sheetSlug: 'provoker-mon', position: { x: 1, y: 0, z: 1 } },
    {
      id: 'defender',
      sheetKind: 'pokemon',
      sheetSlug: 'defender-mon',
      position: overrides.defenderPosition ?? { x: 1, y: 0, z: 2 },
    },
  ],
  lights: [],
  initiative: { activeId: 'provoker', round: 3 },
  encounterState: createEmptyEncounterState(),
  metadata: { owner: 'gm' },
  createdAt: 10,
  updatedAt: 20,
})

interface Harness {
  readonly database: RotomDatabase
  readonly maps: ReturnType<typeof createSqliteMapRepository>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly pending: ReturnType<typeof createSqlitePendingMoveResolutionRepository>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly realtime: ReturnType<typeof createSqliteRealtimeEventRepository>
  readonly executor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
  readonly readSheet: (kind: 'pokemon' | 'trainer', slug: string) => { sheet: Record<string, unknown> } | null
}

const createHarness = (options: {
  readonly map?: TabletopMap
  readonly provokerHp?: number
  readonly provokerAbilities?: CharacterSheet['abilities']
} = {}): Harness => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-movement-aoo-'))
  tempRoots.push(root)
  const database = openRotomDatabase({ path: join(root, 'rotom.sqlite'), enableWal: false })
  databases.push(database)
  const maps = createSqliteMapRepository(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const pending = createSqlitePendingMoveResolutionRepository(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => 5_000 })
  const realtime = createSqliteRealtimeEventRepository({ database })
  const events: unknown[] = []
  const executor = createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
    ...acceptedRealtimeTestHooks(events),
  })
  const map = options.map ?? arenaMap()
  maps.save({ slug: map.slug, document: map, revision: map.revision ?? 0, updatedAt: map.updatedAt ?? 20 })
  for (const document of [
    sheet(
      'provoker-mon', 'Pikachu', 'Provoker', options.provokerHp ?? 60,
      options.provokerAbilities ?? [],
    ),
    sheet('defender-mon', 'Machop', 'Defender'),
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
  return { database, maps, sheets, pending, ops, realtime, executor, readSheet }
}

const moveCommand = (opId: string, destination: GridAnchor): MoveTokenLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId,
  mapSlug: 'arena',
  baseRevision: 7,
  type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  scopes: [{ kind: 'token', placementId: 'provoker', field: 'position' }],
  payload: { placementId: 'provoker', position: destination },
})

const moveToken = async (harness: Harness, opId: string, destination: GridAnchor) => (
  executeMapTokenLivePlayCommandUseCase({
    role: 'gm',
    command: moveCommand(opId, destination),
    expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  }, {
    mapRepository: harness.maps,
    database: harness.database,
    commandExecutor: harness.executor,
    pendingResolutionRepository: harness.pending,
    sheetRepository: harness.sheets,
    readSheet: harness.readSheet,
    listProfiles: () => [],
    now: () => 1_000,
  })
)

const passResponse = (harness: Harness, opId: string, baseRevision: number) => {
  const stored = harness.pending.listByMap('arena')[0]!
  const window = stored.resolution.outstandingWindows[0]!
  const command: MoveResponseCommand = {
    schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
    opId,
    mapSlug: 'arena',
    baseRevision,
    type: MOVE_RESPONSE_COMMAND_TYPES.PASS,
    payload: { resolutionId: stored.resolutionId, windowId: window.windowId },
  }
  return resumePendingMoveResolutionUseCase({
    command,
    storedResolution: stored,
    window,
    option: null,
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
    now: () => 2_000,
  })
}

const provokerPosition = (harness: Harness): GridAnchor => (
  harness.maps.getBySlug('arena')!.placements.find(placement => placement.id === 'provoker')!.position
)

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('movement Attack of Opportunity interruption', () => {
  it('suspends the provoking step before it commits and opens one durable defender window', async () => {
    const harness = createHarness()
    const response = await moveToken(harness, 'op_movementsuspend01', { x: 5, y: 0, z: 1 })

    expect(response.result).toMatchObject({ ok: true, pending: true, previousRevision: 7, revision: 8 })
    expect((response.result as { pendingResolution?: { status: string } }).pendingResolution?.status)
      .toBe('pending')

    // The provoking step (leaving the defender's adjacency) never committed,
    // so the token advanced only as far as the last safe step before it.
    const position = provokerPosition(harness)
    expect(position).not.toEqual({ x: 5, y: 0, z: 1 })
    expect(position).toEqual({ x: 2, y: 0, z: 1 })

    const stored = harness.pending.listByMap('arena')
    expect(stored).toHaveLength(1)
    const resolution = stored[0]!.resolution
    expect(resolution.outstandingWindows).toHaveLength(1)
    expect(resolution.outstandingWindows[0]?.ownership).toEqual([{ kind: 'placement', id: 'defender' }])
    expect(resolution.continuationContext?.triggerReason).toBe('movement')
    expect(resolution.continuationContext && 'movementPath' in resolution.continuationContext).toBe(true)

    const summaries = harness.maps.getBySlug('arena')?.encounterState?.pendingResolutionSummaries ?? []
    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.status).toBe('pending')
  })

  it('replays a duplicate movement opId without reopening the window or advancing the revision', async () => {
    const harness = createHarness()
    await moveToken(harness, 'op_movementsuspend02', { x: 5, y: 0, z: 1 })
    const firstPosition = provokerPosition(harness)
    const firstPending = harness.pending.listByMap('arena')[0]!

    const replay = await moveToken(harness, 'op_movementsuspend02', { x: 5, y: 0, z: 1 })

    expect(replay.result).toMatchObject({ ok: true, pending: true, previousRevision: 7, revision: 8 })
    expect(provokerPosition(harness)).toEqual(firstPosition)
    expect(harness.pending.listByMap('arena')).toHaveLength(1)
    expect(harness.pending.listByMap('arena')[0]!.resolutionId).toBe(firstPending.resolutionId)
    expect(harness.pending.listByMap('arena')[0]!.resolution.outstandingWindows).toHaveLength(1)
  })

  it('resumes the remaining path after the defender passes and reaches the destination', async () => {
    const harness = createHarness()
    await moveToken(harness, 'op_movementsuspend03', { x: 5, y: 0, z: 1 })
    expect(provokerPosition(harness)).toEqual({ x: 2, y: 0, z: 1 })

    const response = passResponse(harness, 'op_movementpass0001', 8)

    expect(response.result).toMatchObject({ ok: true, previousRevision: 8, revision: 9 })
    expect((response.result as { pending?: boolean }).pending).toBeUndefined()
    expect(provokerPosition(harness)).toEqual({ x: 5, y: 0, z: 1 })

    const resolution = harness.pending.listByMap('arena')[0]!
    expect(resolution.status).toBe('committed')
    expect(resolution.resolution.outstandingWindows).toHaveLength(0)
    const summaries = harness.maps.getBySlug('arena')?.encounterState?.pendingResolutionSummaries ?? []
    expect(summaries).toEqual([])
  })

  it('applies post-interrupt Hazards on resume while effective Infiltrator remains immune', async () => {
    const components = canonicalBattlefieldZoneComponents({ kind: 'hazard', effectId: 'spikes' })
    const withHazard = (): TabletopMap => {
      const map = arenaMap()
      return {
        ...map,
        voxels: [0, 2].flatMap(z => Array.from({ length: 6 }, (_value, offset) => ({
          x: offset + 2, y: 0, z, materialId: 'cave_stone', tags: ['wall'],
          blocksMovement: true, blocksSight: true,
        }))),
        placements: map.placements.map(placement => ({
          ...placement,
          sideId: placement.id === 'provoker' ? 'heroes' : 'rivals',
        })),
        encounterState: {
          ...createEmptyEncounterState(),
          sides: {
            heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
            rivals: { id: 'rivals', label: 'Rivals', status: 'active' },
          },
          zones: [parseEncounterZone({
            id: 'zone.resumed.spikes', kind: 'hazard',
            source: {
              kind: 'operation', operationId: 'operation.resumed.spikes',
              moveId: 'move.spikes', placementId: 'defender',
            },
            sideId: 'rivals',
            geometry: { kind: 'cells', cells: [{ x: 4, y: 0, z: 1 }] },
            layer: 1, duration: { kind: 'scene', remaining: null },
            stacking: { kind: 'refresh', maxLayers: null },
            hooks: components.hooks, modifiers: components.modifiers,
            tags: ['hazard', 'spikes'],
            payload: {
              hazardId: 'spikes', familyId: 'hazard.spikes', charges: null, maxCharges: null,
            },
          })],
        },
      }
    }
    const plain = createHarness({ map: withHazard() })
    await moveToken(plain, 'op_movementhazard_plain', { x: 5, y: 0, z: 1 })
    expect((plain.sheets.getByRef('pokemon', 'provoker-mon')!.sheet.combat as { currentHp: number }).currentHp)
      .toBe(60)
    passResponse(plain, 'op_movementhazard_pass_plain', 8)
    expect((plain.sheets.getByRef('pokemon', 'provoker-mon')!.sheet.combat as { currentHp: number }).currentHp)
      .toBeLessThan(60)

    const infiltrator = createHarness({
      map: withHazard(),
      provokerAbilities: [{
        name: 'Infiltrator', automation: {
          schemaVersion: 1, instanceId: 'base:infiltrator', canonicalId: 'Infiltrator',
          definitionVersion: null, selections: [],
        },
      }],
    })
    await moveToken(infiltrator, 'op_movementhazard_infiltrator', { x: 5, y: 0, z: 1 })
    passResponse(infiltrator, 'op_movementhazard_pass_infiltrator', 8)
    expect((infiltrator.sheets.getByRef('pokemon', 'provoker-mon')!.sheet.combat as { currentHp: number }).currentHp)
      .toBe(60)
  }, 30_000)

  it('completes the full movement without suspending when no eligible defender is adjacent', async () => {
    // Place the defender far from the provoker's path so no adjacency is lost.
    const harness = createHarness({ map: arenaMap({ defenderPosition: { x: 7, y: 0, z: 7 } }) })
    const response = await moveToken(harness, 'op_movementnoaoo001', { x: 5, y: 0, z: 1 })

    expect(response.result).toMatchObject({ ok: true, previousRevision: 7, revision: 8 })
    expect((response.result as { pending?: boolean }).pending).toBeUndefined()
    expect(provokerPosition(harness)).toEqual({ x: 5, y: 0, z: 1 })
    expect(harness.pending.listByMap('arena')).toHaveLength(0)
  })

  it('resumes the remaining path after the defender chooses a typed attack and reaches the destination', async () => {
    const harness = createHarness()
    await moveToken(harness, 'op_movementsuspend04', { x: 5, y: 0, z: 1 })
    expect(provokerPosition(harness)).toEqual({ x: 2, y: 0, z: 1 })

    const stored = harness.pending.listByMap('arena')[0]!
    const window = stored.resolution.outstandingWindows[0]!
    const command: MoveResponseCommand = {
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: 'op_movementreact001',
      mapSlug: 'arena',
      baseRevision: 8,
      type: MOVE_RESPONSE_COMMAND_TYPES.REACT,
      payload: {
        resolutionId: stored.resolutionId,
        windowId: window.windowId,
        optionId: window.options[0]!.id,
      },
    }
    const response = resumePendingMoveResolutionUseCase({
      command,
      storedResolution: stored,
      window,
      option: window.options[0]!,
      role: 'gm',
      playerProfile: null,
      authorization: { chosenBy: { kind: 'placement', id: 'defender' }, source: 'window-owner' },
      clientId: 'defender-client',
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

    expect(response.result).toMatchObject({ ok: true, previousRevision: 8, revision: 9 })
    expect(response.move?.actorPlacementId).toBe('defender')
    // The typed attack did not faint the provoker, so the remaining path resumed.
    expect(provokerPosition(harness)).toEqual({ x: 5, y: 0, z: 1 })
    const resolution = harness.pending.listByMap('arena')[0]!
    expect(resolution.status).toBe('committed')
  })

  it('cancels the remaining movement when the typed attack faints the provoker before the next step', async () => {
    const harness = createHarness({ provokerHp: 1 })
    await moveToken(harness, 'op_movementsuspend05', { x: 5, y: 0, z: 1 })
    expect(provokerPosition(harness)).toEqual({ x: 2, y: 0, z: 1 })

    const stored = harness.pending.listByMap('arena')[0]!
    const window = stored.resolution.outstandingWindows[0]!
    const command: MoveResponseCommand = {
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: 'op_movementreact002',
      mapSlug: 'arena',
      baseRevision: 8,
      type: MOVE_RESPONSE_COMMAND_TYPES.REACT,
      payload: {
        resolutionId: stored.resolutionId,
        windowId: window.windowId,
        optionId: window.options[0]!.id,
      },
    }
    const response = resumePendingMoveResolutionUseCase({
      command,
      storedResolution: stored,
      window,
      option: window.options[0]!,
      role: 'gm',
      playerProfile: null,
      authorization: { chosenBy: { kind: 'placement', id: 'defender' }, source: 'window-owner' },
      clientId: 'defender-client',
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

    expect(response.result).toMatchObject({ ok: true, previousRevision: 8, revision: 9 })
    // The provoker fainted, so the remaining path was cancelled at the last
    // committed step instead of advancing to the destination.
    expect(provokerPosition(harness)).toEqual({ x: 2, y: 0, z: 1 })
    const resolution = harness.pending.listByMap('arena')[0]!
    expect(resolution.status).toBe('committed')
  })
})
