import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  type ChooseMoveResponseCommand,
} from '#shared/moveAutomation/responseCommands'
import { isPendingMoveDeclarationResult } from '#shared/moveAutomation/pendingResolution'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'
import { deepCloneJson } from '~/utils/serialization'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqlitePendingMoveResolutionRepository } from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { parsePendingMoveResponseCommand } from '~~/server/livePlay/moveResponseCommandParser'
import { planAuthoritativeMoveStateExecution } from '~~/server/domain/planAuthoritativeMoveState'
import { executeLivePlayResolveMoveCommandUseCase } from '~~/server/useCases/applyResolveMoveCommand'
import {
  replayMoveResponseCommandUseCase,
  resumePendingMoveResolutionUseCase,
} from '~~/server/useCases/resumePendingMoveResolution'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import {
  SWITCH_ACTOR_PLACEMENT_ID,
  SWITCH_TARGET_PLACEMENT_ID,
  createSwitchChoiceMap,
  createSwitchChoiceRuntimeRegistry,
  switchChoiceIntent,
  switchChoiceSheets,
} from '../fixtures/moveAutomation/switchChoices'

interface Harness {
  readonly database: RotomDatabase
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly pending: ReturnType<typeof createSqlitePendingMoveResolutionRepository>
  readonly realtime: ReturnType<typeof createSqliteRealtimeEventRepository>
  readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
}

const openDatabases: RotomDatabase[] = []

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

const createHarness = (): Harness => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  openDatabases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => 1_000 })
  const pending = createSqlitePendingMoveResolutionRepository(database)
  const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 1_000 })
  const modes = createSqliteMapInteractionModeRepository(database)
  const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
    readMapInteractionMode: mapSlug => modes.get(mapSlug).interactionMode,
    ...acceptedRealtimeTestHooks([]),
  })
  const map = createSwitchChoiceMap()
  maps.save({ slug: map.slug, document: map, revision: map.revision ?? 0, updatedAt: 100 })
  const resources = switchChoiceSheets()
  for (const sheet of resources.pokemonSheets.values()) {
    sheets.save({
      kind: 'pokemon',
      slug: sheet.slug,
      document: sheet as unknown as Record<string, unknown>,
      revision: sheet.revision ?? 0,
      updatedAt: 50,
    })
  }
  for (const sheet of resources.trainerSheets.values()) {
    sheets.save({
      kind: 'trainer',
      slug: sheet.slug,
      document: sheet as unknown as Record<string, unknown>,
      revision: sheet.revision ?? 0,
      updatedAt: 50,
    })
  }
  return { database, maps, sheets, ops, pending, realtime, commandExecutor }
}

const resolveCommand = (map: TabletopMap, opId: string): ResolveMoveLivePlayCommand => {
  const intent = switchChoiceIntent()
  const scopes = buildResolveMoveScopes({
    map,
    intent,
    candidateScopePlacementIds: [SWITCH_TARGET_PLACEMENT_ID],
  })
  if (!scopes.ok) throw new Error(scopes.message)
  return {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId,
    mapSlug: map.slug,
    baseRevision: map.revision ?? 0,
    type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    scopes: scopes.scopes,
    payload: intent,
  }
}

const declare = async (harness: Harness, opId: string) => {
  const map = harness.maps.getBySlug('durable-switch-arena')!
  const command = resolveCommand(map, opId)
  const runtimeRegistry = createSwitchChoiceRuntimeRegistry()
  const response = await executeLivePlayResolveMoveCommandUseCase({
    role: 'gm',
    command,
    clientId: 'switch-declaration-client',
    playerProfile: null,
    expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
  }, {
    database: harness.database,
    mapRepository: harness.maps,
    sheetRepository: harness.sheets,
    pendingResolutionRepository: harness.pending,
    commandExecutor: harness.commandExecutor,
    planner: input => planAuthoritativeMoveStateExecution({ ...input, runtimeRegistry }),
    random: () => { throw new Error('switch fixture does not use randomness') },
    now: () => 1_000,
  })
  if (!isPendingMoveDeclarationResult(response.result)) {
    throw new Error('Expected a durable switch declaration.')
  }
  const stored = harness.pending.getByOrigin(map.slug, command.opId)
  if (!stored) throw new Error('Expected a stored switch declaration.')
  return { command, response, stored, runtimeRegistry }
}

const chooseCommand = (input: {
  readonly map: TabletopMap
  readonly resolutionId: string
  readonly windowId: string
  readonly optionId: string
  readonly opId: string
}): ChooseMoveResponseCommand => ({
  schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  opId: input.opId,
  mapSlug: input.map.slug,
  baseRevision: input.map.revision ?? 0,
  type: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
  payload: {
    resolutionId: input.resolutionId,
    windowId: input.windowId,
    optionId: input.optionId,
  },
})

const resume = (input: {
  readonly harness: Harness
  readonly command: ChooseMoveResponseCommand
  readonly now?: number
}) => {
  const parsed = parsePendingMoveResponseCommand(input.command, {
    pendingResolutionRepository: input.harness.pending,
  })
  return resumePendingMoveResolutionUseCase({
    ...parsed,
    role: 'gm',
    playerProfile: null,
    authorization: {
      chosenBy: { kind: 'gm', id: null },
      source: 'gm-authority',
    },
    clientId: 'switch-response-client',
  }, {
    database: input.harness.database,
    mapRepository: input.harness.maps,
    sheetRepository: input.harness.sheets,
    pendingResolutionRepository: input.harness.pending,
    opRepository: input.harness.ops,
    realtimeEventRepository: input.harness.realtime,
    runtimeRegistry: createSwitchChoiceRuntimeRegistry(),
    random: () => { throw new Error('switch fixture does not use randomness') },
    now: () => input.now ?? 2_000,
    publishPersistedRealtimeEvent: vi.fn(),
  })
}

const targetHp = (harness: Harness): number => {
  const stored = harness.sheets.getByRef('pokemon', 'switch-target-sheet')!
  return pokemonHpSnapshot(stored.sheet as unknown as CharacterSheet).currentHp
}

describe('pending move-driven switch resume integration', () => {
  it('commits damage, recall, send-out, cleanup, and initiative once after selection', async () => {
    const harness = createHarness()
    const declaration = await declare(harness, 'op_switchdeclare02')
    expect(targetHp(harness)).toBe(60)
    const pendingMap = harness.maps.getBySlug('durable-switch-arena')!
    expect(pendingMap.placements.some(placement => placement.id === SWITCH_ACTOR_PLACEMENT_ID)).toBe(true)
    const window = declaration.stored.resolution.outstandingWindows[0]!
    const option = window.options[0]!
    const command = chooseCommand({
      map: pendingMap,
      resolutionId: declaration.stored.resolutionId,
      windowId: window.windowId,
      optionId: option.id,
      opId: 'op_switchanswer002',
    })

    const first = resume({ harness, command })
    expect(first.result).toMatchObject({ ok: true })
    expect(targetHp(harness)).toBe(55)
    const committed = harness.maps.getBySlug('durable-switch-arena')!
    expect(committed.placements.some(placement => placement.id === SWITCH_ACTOR_PLACEMENT_ID)).toBe(false)
    const replacement = committed.placements.find(
      placement => placement.sheetSlug === 'switch-replacement',
    )!
    expect(replacement).toMatchObject({ sideId: 'heroes', initiative: 18 })
    expect(committed.initiative?.activeId).toBe(replacement.id)
    expect(committed.initiative?.manualOrderIds?.[0]).toBe(replacement.id)
    expect(committed.temporaryHitPoints).toBeUndefined()
    expect(committed.encounterState?.history.switches).toHaveLength(1)
    expect(committed.encounterState?.pendingResolutionSummaries).toEqual([])
    expect(first.result.ok && first.result.patches[0]?.scopes).toEqual(expect.arrayContaining([
      { kind: 'map', lane: 'placements' },
      { kind: 'map', lane: 'initiative' },
      { kind: 'token', placementId: SWITCH_ACTOR_PLACEMENT_ID, field: 'delete' },
      { kind: 'token', placementId: replacement.id, field: 'sendOut' },
    ]))

    const terminal = harness.pending.getById(declaration.stored.resolutionId)!
    expect(terminal).toMatchObject({
      status: 'committed',
      terminalOpId: command.opId,
      resolution: { status: 'committed' },
    })
    const revision = committed.revision
    const realtimeSequence = harness.realtime.cursorState().latestSequence
    const terminalBeforeReplay = deepCloneJson(terminal)

    const replay = replayMoveResponseCommandUseCase({ role: 'gm', command }, {
      database: harness.database,
      mapRepository: harness.maps,
      opRepository: harness.ops,
    })
    expect(replay?.result).toEqual(first.result)
    expect(targetHp(harness)).toBe(55)
    expect(harness.maps.getBySlug(committed.slug)?.revision).toBe(revision)
    expect(harness.realtime.cursorState().latestSequence).toBe(realtimeSequence)
    expect(harness.pending.getById(declaration.stored.resolutionId)).toEqual(terminalBeforeReplay)
  })

  it('terminally conflicts a stale replacement sheet with no partial attack or switch', async () => {
    const harness = createHarness()
    const declaration = await declare(harness, 'op_staleswitchdecl1')
    const storedReplacement = harness.sheets.getByRef('pokemon', 'switch-replacement')!
    expect(harness.sheets.applyLivePlayUpdate({
      kind: 'pokemon',
      slug: storedReplacement.slug,
      expectedRevision: storedReplacement.revision,
      nextSheet: {
        ...deepCloneJson(storedReplacement.sheet),
        revision: storedReplacement.revision + 1,
        updatedAt: 1_500,
      },
    })).toBe('applied')

    const pendingMap = harness.maps.getBySlug('durable-switch-arena')!
    const window = declaration.stored.resolution.outstandingWindows[0]!
    const command = chooseCommand({
      map: pendingMap,
      resolutionId: declaration.stored.resolutionId,
      windowId: window.windowId,
      optionId: window.options[0]!.id,
      opId: 'op_staleswitchans01',
    })
    const hpBefore = targetHp(harness)

    const response = resume({ harness, command })
    expect(response.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(targetHp(harness)).toBe(hpBefore)
    const after = harness.maps.getBySlug('durable-switch-arena')!
    expect(after.placements.some(placement => placement.id === SWITCH_ACTOR_PLACEMENT_ID)).toBe(true)
    expect(after.placements.some(placement => placement.sheetSlug === 'switch-replacement')).toBe(false)
    expect(after.temporaryHitPoints?.byPlacementId[SWITCH_ACTOR_PLACEMENT_ID]).toBe(5)
    expect(after.encounterState?.pendingResolutionSummaries).toEqual([])
    expect(harness.pending.getById(declaration.stored.resolutionId)).toMatchObject({
      status: 'conflicted',
      terminalOpId: command.opId,
      resolution: { status: 'conflicted', chosenOptions: [] },
    })
  })
})
