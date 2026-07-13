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
import {
  isPendingMoveDeclarationResult,
} from '#shared/moveAutomation/pendingResolution'
import type { MoveMovementChoice } from '#shared/moveAutomation/effects'
import type { PendingMoveMovementSelection } from '#shared/moveAutomation/responseOptions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { deepCloneJson } from '~/utils/serialization'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import {
  createSqlitePendingMoveResolutionRepository,
  type StoredPendingMoveResolution,
} from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { parsePendingMoveResponseCommand } from '~~/server/livePlay/moveResponseCommandParser'
import { planAuthoritativeMoveStateExecution } from '~~/server/domain/planAuthoritativeMoveState'
import {
  executeLivePlayResolveMoveCommandUseCase,
} from '~~/server/useCases/applyResolveMoveCommand'
import {
  replayMoveResponseCommandUseCase,
  resumePendingMoveResolutionUseCase,
} from '~~/server/useCases/resumePendingMoveResolution'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import {
  MOVEMENT_CHOICE_ACTOR_PLACEMENT_ID,
  MOVEMENT_CHOICE_ACTOR_SHEET_SLUG,
  MOVEMENT_CHOICE_DESTINATION_DECLARATION,
  MOVEMENT_CHOICE_DIRECTION_DECLARATION,
  createMovementChoiceActorSheet,
  createMovementChoiceMap,
  createMovementChoiceRuntimeRegistry,
  movementChoiceIntent,
} from '../fixtures/moveAutomation/movementChoices'

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
  const interactionModes = createSqliteMapInteractionModeRepository(database)
  const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
    readMapInteractionMode: mapSlug => interactionModes.get(mapSlug).interactionMode,
    ...acceptedRealtimeTestHooks([]),
  })
  const map = createMovementChoiceMap()
  const sheet = createMovementChoiceActorSheet()
  maps.save({
    slug: map.slug,
    document: map,
    revision: map.revision ?? 0,
    updatedAt: map.updatedAt ?? 100,
  })
  sheets.save({
    kind: 'pokemon',
    slug: sheet.slug,
    document: sheet as unknown as Record<string, unknown>,
    revision: sheet.revision ?? 0,
    updatedAt: 50,
  })
  return { database, maps, sheets, ops, pending, realtime, commandExecutor }
}

const resolveCommand = (
  map: TabletopMap,
  opId: string,
): ResolveMoveLivePlayCommand => {
  const intent = movementChoiceIntent()
  const scopes = buildResolveMoveScopes({
    map,
    intent,
    candidateScopePlacementIds: [],
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

const declareMovementChoice = async (
  harness: Harness,
  choice: MoveMovementChoice,
  opId: string,
) => {
  const runtimeRegistry = createMovementChoiceRuntimeRegistry(choice)
  const map = harness.maps.getBySlug('durable-movement-arena')!
  const command = resolveCommand(map, opId)
  const response = await executeLivePlayResolveMoveCommandUseCase({
    role: 'gm',
    command,
    clientId: 'movement-declaration-client',
    playerProfile: null,
    expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
  }, {
    database: harness.database,
    mapRepository: harness.maps,
    sheetRepository: harness.sheets,
    pendingResolutionRepository: harness.pending,
    commandExecutor: harness.commandExecutor,
    planner: input => planAuthoritativeMoveStateExecution({
      ...input,
      runtimeRegistry,
    }),
    random: () => { throw new Error('movement choices must not draw randomness') },
    now: () => 1_000,
  })
  if (!isPendingMoveDeclarationResult(response.result)) {
    throw new Error('Expected a durable movement declaration.')
  }
  const stored = harness.pending.getByOrigin(map.slug, command.opId)
  if (!stored) throw new Error('Expected the movement declaration to persist.')
  return { command, response, runtimeRegistry, stored }
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

const resumeChoice = (input: {
  readonly harness: Harness
  readonly choice: MoveMovementChoice
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
    clientId: 'movement-response-client',
  }, {
    database: input.harness.database,
    mapRepository: input.harness.maps,
    sheetRepository: input.harness.sheets,
    pendingResolutionRepository: input.harness.pending,
    opRepository: input.harness.ops,
    realtimeEventRepository: input.harness.realtime,
    runtimeRegistry: createMovementChoiceRuntimeRegistry(input.choice),
    random: () => { throw new Error('movement choices must not draw randomness') },
    now: () => input.now ?? 2_000,
    publishPersistedRealtimeEvent: vi.fn(),
  })
}

const actorPosition = (map: TabletopMap): SheetPlacement['position'] => (
  map.placements.find(placement => placement.id === MOVEMENT_CHOICE_ACTOR_PLACEMENT_ID)?.position
  ?? (() => { throw new Error('Movement actor is missing.') })()
)

const movementOption = (input: {
  readonly stored: StoredPendingMoveResolution
  readonly predicate: (selection: PendingMoveMovementSelection) => boolean
}) => {
  const window = input.stored.resolution.outstandingWindows[0]!
  const option = window.options.find(candidate => (
    candidate.selection !== undefined && input.predicate(candidate.selection)
  ))
  if (!option) throw new Error('Expected a matching server-issued movement option.')
  return { window, option }
}

const addBlockingPlacement = (harness: Harness, position: SheetPlacement['position']): void => {
  const blockerSheet = createMovementChoiceActorSheet({
    slug: 'late-blocker',
    nickname: 'Late Blocker',
    movelist: [],
    revision: 1,
  })
  harness.sheets.save({
    kind: 'pokemon',
    slug: blockerSheet.slug,
    document: blockerSheet as unknown as Record<string, unknown>,
    revision: 1,
    updatedAt: 1_500,
  })
  const current = harness.maps.getBySlug('durable-movement-arena')!
  const next: TabletopMap = {
    ...deepCloneJson(current),
    placements: [
      ...current.placements,
      {
        id: 'late-blocker',
        sheetKind: 'pokemon',
        sheetSlug: 'late-blocker',
        position: { ...position },
      },
    ],
    revision: (current.revision ?? 0) + 1,
    updatedAt: 1_500,
  }
  expect(harness.maps.applyLivePlayUpdate({
    slug: current.slug,
    expectedRevision: current.revision ?? 0,
    nextMap: next,
  })).toBe('applied')
}

const reduceActorMovementCapability = (harness: Harness): void => {
  const stored = harness.sheets.getByRef('pokemon', MOVEMENT_CHOICE_ACTOR_SHEET_SLUG)!
  const current = stored.sheet as unknown as CharacterSheet
  expect(harness.sheets.applyLivePlayUpdate({
    kind: 'pokemon',
    slug: MOVEMENT_CHOICE_ACTOR_SHEET_SLUG,
    expectedRevision: stored.revision,
    nextSheet: {
      ...deepCloneJson(current),
      revision: stored.revision + 1,
      updatedAt: 1_500,
      capabilities: { overland: 1, sky: 0, swim: 0, levitate: 0 },
    } as unknown as Record<string, unknown>,
  })).toBe('applied')
}

describe('pending movement choice resume integration', () => {
  it.each([
    {
      label: 'destination',
      choice: MOVEMENT_CHOICE_DESTINATION_DECLARATION,
      declarationOpId: 'op_destinationdeclare1',
      responseOpId: 'op_destinationanswer01',
      option: (selection: { readonly kind: string; readonly destination: { readonly x: number; readonly y: number; readonly z: number } }) => (
        selection.kind === 'movement-destination'
        && selection.destination.x === 3
        && selection.destination.y === 0
        && selection.destination.z === 1
      ),
      expectedDestination: { x: 3, y: 0, z: 1 },
      expectedDirection: undefined,
    },
    {
      label: 'direction',
      choice: MOVEMENT_CHOICE_DIRECTION_DECLARATION,
      declarationOpId: 'op_directiondeclare001',
      responseOpId: 'op_directionanswer001',
      option: (selection: { readonly kind: string; readonly direction?: string }) => (
        selection.kind === 'movement-direction' && selection.direction === 'east'
      ),
      expectedDestination: { x: 4, y: 0, z: 1 },
      expectedDirection: 'east',
    },
  ])('commits a server-issued $label once and exact replay cannot move twice', async (example) => {
    const harness = createHarness()
    const declaration = await declareMovementChoice(
      harness,
      example.choice,
      example.declarationOpId,
    )
    expect(actorPosition(declaration.response.map!)).toEqual({ x: 1, y: 0, z: 1 })
    const selected = movementOption({
      stored: declaration.stored,
      predicate: example.option,
    })
    const mapBeforeResponse = harness.maps.getBySlug('durable-movement-arena')!
    const command = chooseCommand({
      map: mapBeforeResponse,
      resolutionId: declaration.stored.resolutionId,
      windowId: selected.window.windowId,
      optionId: selected.option.id,
      opId: example.responseOpId,
    })

    const first = resumeChoice({ harness, choice: example.choice, command })
    expect(first.result).toMatchObject({ ok: true })
    expect(first.move?.movement).toMatchObject({
      kind: 'shift',
      from: { x: 1, y: 0, z: 1 },
      destination: example.expectedDestination,
      ...(example.expectedDirection ? { direction: example.expectedDirection } : {}),
    })
    const committedMap = harness.maps.getBySlug('durable-movement-arena')!
    expect(actorPosition(committedMap)).toEqual(example.expectedDestination)
    expect(committedMap.encounterState?.pendingResolutionSummaries).toEqual([])
    expect(declaration.stored.resolution.outstandingWindows[0]?.options[0]).toHaveProperty('selection')
    expect(command.payload).toEqual({
      resolutionId: declaration.stored.resolutionId,
      windowId: selected.window.windowId,
      optionId: selected.option.id,
    })
    expect(command.payload).not.toHaveProperty('destination')
    expect(command.payload).not.toHaveProperty('direction')
    expect(command.payload).not.toHaveProperty('pathCells')

    const storedTerminal = harness.pending.getById(declaration.stored.resolutionId)!
    expect(storedTerminal).toMatchObject({
      status: 'committed',
      terminalOpId: command.opId,
      resolution: {
        status: 'committed',
        chosenOptions: [expect.objectContaining({
          windowId: selected.window.windowId,
          responseOpId: command.opId,
          optionId: selected.option.id,
        })],
      },
    })
    const revisionAfterFirst = committedMap.revision
    const realtimeAfterFirst = harness.realtime.cursorState().latestSequence
    const pendingAfterFirst = deepCloneJson(storedTerminal)

    const replay = replayMoveResponseCommandUseCase({ role: 'gm', command }, {
      database: harness.database,
      mapRepository: harness.maps,
      opRepository: harness.ops,
    })
    expect(replay?.result).toEqual(first.result)
    expect(actorPosition(harness.maps.getBySlug('durable-movement-arena')!)).toEqual(
      example.expectedDestination,
    )
    expect(harness.maps.getBySlug('durable-movement-arena')?.revision).toBe(revisionAfterFirst)
    expect(harness.realtime.cursorState().latestSequence).toBe(realtimeAfterFirst)
    expect(harness.pending.getById(declaration.stored.resolutionId)).toEqual(pendingAfterFirst)
  })

  it('rejects a forged movement option ID before resume orchestration', async () => {
    const harness = createHarness()
    const declaration = await declareMovementChoice(
      harness,
      MOVEMENT_CHOICE_DESTINATION_DECLARATION,
      'op_forgedmovementdecl',
    )
    const window = declaration.stored.resolution.outstandingWindows[0]!
    const current = harness.maps.getBySlug('durable-movement-arena')!
    const command = chooseCommand({
      map: current,
      resolutionId: declaration.stored.resolutionId,
      windowId: window.windowId,
      optionId: 'movement.destination.deadbeef.99.0.99',
      opId: 'op_forgedmovementans1',
    })
    const mapBefore = deepCloneJson(current)
    const pendingBefore = deepCloneJson(declaration.stored)

    expect(() => parsePendingMoveResponseCommand(command, {
      pendingResolutionRepository: harness.pending,
    })).toThrowError(expect.objectContaining({ code: 'unknown-option' }))
    expect(harness.maps.getBySlug(current.slug)).toEqual(mapBefore)
    expect(harness.pending.getById(declaration.stored.resolutionId)).toEqual(pendingBefore)
    expect(harness.ops.getOpRecord(current.slug, command.opId)).toBeNull()
  })

  it.each([
    {
      label: 'destination occupancy',
      mutate: (harness: Harness, destination: SheetPlacement['position']) => (
        addBlockingPlacement(harness, destination)
      ),
      declarationOpId: 'op_staleoccupancydecl',
      responseOpId: 'op_staleoccupancyans',
    },
    {
      label: 'movement capability',
      mutate: (harness: Harness) => reduceActorMovementCapability(harness),
      declarationOpId: 'op_stalecapabilitydec',
      responseOpId: 'op_stalecapabilityans',
    },
  ])('terminally conflicts stale $label without partial movement', async (example) => {
    const harness = createHarness()
    const declaration = await declareMovementChoice(
      harness,
      MOVEMENT_CHOICE_DESTINATION_DECLARATION,
      example.declarationOpId,
    )
    const selected = movementOption({
      stored: declaration.stored,
      predicate: selection => (
        selection.kind === 'movement-destination'
        && selection.destination.x === 3
        && selection.destination.y === 0
        && selection.destination.z === 1
      ),
    })
    const destination = { ...selected.option.selection!.destination }
    example.mutate(harness, destination)
    const current = harness.maps.getBySlug('durable-movement-arena')!
    const command = chooseCommand({
      map: current,
      resolutionId: declaration.stored.resolutionId,
      windowId: selected.window.windowId,
      optionId: selected.option.id,
      opId: example.responseOpId,
    })
    const usageBefore = deepCloneJson(current.moveUsage)

    const response = resumeChoice({
      harness,
      choice: MOVEMENT_CHOICE_DESTINATION_DECLARATION,
      command,
    })

    expect(response.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(response.move).toBeUndefined()
    const after = harness.maps.getBySlug('durable-movement-arena')!
    expect(actorPosition(after)).toEqual({ x: 1, y: 0, z: 1 })
    expect(after.moveUsage).toEqual(usageBefore)
    expect(after.encounterState?.pendingResolutionSummaries).toEqual([])
    expect(harness.pending.getById(declaration.stored.resolutionId)).toMatchObject({
      status: 'conflicted',
      terminalOpId: command.opId,
      resolution: { status: 'conflicted', chosenOptions: [] },
    })
    expect(harness.ops.getOpRecord(after.slug, command.opId)?.result).toEqual(response.result)
  })
})
