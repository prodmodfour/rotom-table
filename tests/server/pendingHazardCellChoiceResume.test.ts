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
  type PendingMoveChoiceResponseWindow,
} from '#shared/moveAutomation/pendingResolution'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { deepCloneJson } from '~/utils/serialization'
import { planAuthoritativeMoveStateExecution } from '~~/server/domain/planAuthoritativeMoveState'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import {
  MoveResponseCommandParserError,
  parsePendingMoveResponseCommand,
} from '~~/server/livePlay/moveResponseCommandParser'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import {
  createSqlitePendingMoveResolutionRepository,
  type StoredPendingMoveResolution,
} from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { executeLivePlayResolveMoveCommandUseCase } from '~~/server/useCases/applyResolveMoveCommand'
import {
  replayMoveResponseCommandUseCase,
  resumePendingMoveResolutionUseCase,
} from '~~/server/useCases/resumePendingMoveResolution'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import {
  HAZARD_CELL_CHOICE_ACTOR_ID,
  HAZARD_CELL_CHOICE_CANONICAL_MOVE_ID,
  HAZARD_CELL_CHOICE_EXACT_RULES,
  HAZARD_CELL_CHOICE_OPERATION_ID,
  HAZARD_CELL_CHOICE_UP_TO_RULES,
  HAZARD_CELL_CHOICE_WINDOW_ID,
  createHazardCellChoiceActorSheet,
  createHazardCellChoiceMap,
  createHazardCellChoiceRuntimeRegistry,
  hazardCellChoiceIntent,
} from '../fixtures/moveAutomation/hazardCellChoices'

interface Harness {
  readonly database: RotomDatabase
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly pending: ReturnType<typeof createSqlitePendingMoveResolutionRepository>
  readonly realtime: ReturnType<typeof createSqliteRealtimeEventRepository>
  readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
}

type HazardRules = typeof HAZARD_CELL_CHOICE_EXACT_RULES | typeof HAZARD_CELL_CHOICE_UP_TO_RULES

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
  const map = createHazardCellChoiceMap()
  const sheet = createHazardCellChoiceActorSheet()
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
    updatedAt: 100,
  })
  return { database, maps, sheets, ops, pending, realtime, commandExecutor }
}

const declarationCommand = (map: TabletopMap, opId: string): ResolveMoveLivePlayCommand => {
  const intent = hazardCellChoiceIntent()
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

const declareHazardChoice = async (
  harness: Harness,
  rules: HazardRules,
  opId: string,
) => {
  const runtimeRegistry = createHazardCellChoiceRuntimeRegistry(rules)
  const map = harness.maps.getBySlug('hazard-choice-arena')!
  const command = declarationCommand(map, opId)
  const response = await executeLivePlayResolveMoveCommandUseCase({
    role: 'gm',
    command,
    clientId: 'hazard-declaration-client',
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
    random: () => { throw new Error('hazard-cell choices must not draw randomness') },
    now: () => 1_000,
  })
  if (!isPendingMoveDeclarationResult(response.result)) {
    throw new Error('Expected a durable hazard-cell declaration.')
  }
  const stored = harness.pending.getByOrigin(map.slug, command.opId)
  if (!stored) throw new Error('Expected the hazard-cell declaration to persist.')
  return { command, response, runtimeRegistry, stored }
}

const privateHazardWindow = (
  stored: StoredPendingMoveResolution,
): PendingMoveChoiceResponseWindow & {
  readonly hazardCellSelection: NonNullable<PendingMoveChoiceResponseWindow['hazardCellSelection']>
} => {
  const window = stored.resolution.outstandingWindows[0]
  if (window?.kind !== 'choice' || !window.hazardCellSelection) {
    throw new Error('Expected one private hazard-cell response window.')
  }
  return window as PendingMoveChoiceResponseWindow & {
    readonly hazardCellSelection: NonNullable<PendingMoveChoiceResponseWindow['hazardCellSelection']>
  }
}

const optionAt = (
  window: ReturnType<typeof privateHazardWindow>,
  cell: GridAnchor,
) => window.hazardCellSelection.options.find(option => (
  option.cell.x === cell.x
  && option.cell.y === cell.y
  && option.cell.z === cell.z
)) ?? (() => { throw new Error(`Missing hazard option ${cell.x},${cell.y},${cell.z}.`) })()

const chooseCommand = (input: {
  readonly map: TabletopMap
  readonly resolutionId: string
  readonly windowId: string
  readonly optionIds: readonly string[]
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
    optionIds: [...input.optionIds],
  },
})

const resumeChoice = (input: {
  readonly harness: Harness
  readonly rules: HazardRules
  readonly command: ChooseMoveResponseCommand
  readonly now?: number
}) => {
  const parsed = parsePendingMoveResponseCommand(input.command, {
    pendingResolutionRepository: input.harness.pending,
    expectedType: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
  })
  return resumePendingMoveResolutionUseCase({
    ...parsed,
    role: 'gm',
    playerProfile: null,
    authorization: {
      chosenBy: { kind: 'gm', id: null },
      source: 'gm-authority',
    },
    clientId: 'hazard-response-client',
  }, {
    database: input.harness.database,
    mapRepository: input.harness.maps,
    sheetRepository: input.harness.sheets,
    pendingResolutionRepository: input.harness.pending,
    opRepository: input.harness.ops,
    realtimeEventRepository: input.harness.realtime,
    runtimeRegistry: createHazardCellChoiceRuntimeRegistry(input.rules),
    random: () => { throw new Error('hazard-cell choices must not draw randomness') },
    now: () => input.now ?? 2_000,
    publishPersistedRealtimeEvent: vi.fn(),
  })
}

const selectedAdjacentOptions = (
  window: ReturnType<typeof privateHazardWindow>,
) => [
  optionAt(window, { x: 1, y: 0, z: 1 }),
  optionAt(window, { x: 2, y: 0, z: 1 }),
]

const currentStandardSpend = (map: TabletopMap): number => (
  map.encounterState?.turnResources[HAZARD_CELL_CHOICE_ACTOR_ID]?.actions.standard.spent ?? 0
)

const expectNoDeferredMoveMutation = (map: TabletopMap): void => {
  expect(map.hazards).toEqual([])
  expect(map.moveUsage).toBeUndefined()
  expect(currentStandardSpend(map)).toBe(1)
}

describe('pending hazard-cell choice resume integration', () => {
  it.each([
    {
      label: 'exact',
      rules: HAZARD_CELL_CHOICE_EXACT_RULES,
      declarationOpId: 'op_hazardexactdeclare1',
      responseOpId: 'op_hazardexactanswer01',
    },
    {
      label: 'up-to',
      rules: HAZARD_CELL_CHOICE_UP_TO_RULES,
      declarationOpId: 'op_hazarduptodeclare01',
      responseOpId: 'op_hazarduptoanswer001',
    },
  ])('commits a server-issued $label cell set once and exact replay cannot place twice', async (example) => {
    const harness = createHarness()
    const declaration = await declareHazardChoice(
      harness,
      example.rules,
      example.declarationOpId,
    )
    const window = privateHazardWindow(declaration.stored)
    const selected = selectedAdjacentOptions(window)
    const mapBeforeResponse = harness.maps.getBySlug(declaration.command.mapSlug)!
    expectNoDeferredMoveMutation(mapBeforeResponse)

    const command = chooseCommand({
      map: mapBeforeResponse,
      resolutionId: declaration.stored.resolutionId,
      windowId: window.windowId,
      // Deliberately reverse browser order; the server must canonicalize it.
      optionIds: [selected[1]!.id, selected[0]!.id],
      opId: example.responseOpId,
    })
    const accepted = resumeChoice({
      harness,
      rules: example.rules,
      command,
    })

    expect(accepted.result).toMatchObject({
      ok: true,
      opId: command.opId,
      previousRevision: mapBeforeResponse.revision,
      revision: (mapBeforeResponse.revision ?? 0) + 1,
    })
    expect(accepted.map?.hazards).toEqual([])
    expect(accepted.map?.encounterState?.zones).toEqual(selected.map(option => (
      expect.objectContaining({
        kind: 'hazard',
        sideId: null,
        geometry: { kind: 'cells', cells: [option.cell] },
        layer: 1,
        payload: {
          hazardId: 'spikes',
          familyId: 'hazard-test.spikes',
          charges: null,
          maxCharges: null,
        },
      })
    )))
    expect(accepted.move?.transaction.hazardsToAdd).toEqual([])
    expect(accepted.move?.transaction.logLines).toEqual(expect.arrayContaining([
      expect.stringContaining(HAZARD_CELL_CHOICE_CANONICAL_MOVE_ID),
    ]))
    expect(JSON.stringify(accepted.move?.trace)).not.toContain(selected[0]!.id)
    expect(accepted.map?.moveUsage).toBeDefined()

    const terminal = harness.pending.getById(declaration.stored.resolutionId)
    expect(terminal).toMatchObject({
      status: 'committed',
      terminalOpId: command.opId,
      resolution: {
        status: 'committed',
        outstandingWindows: [],
        chosenOptions: [{
          windowId: HAZARD_CELL_CHOICE_WINDOW_ID,
          responseOpId: command.opId,
          optionId: expect.stringMatching(/^hazard\.selection\.[a-f0-9]{8}$/),
          optionIds: selected.map(option => option.id),
        }],
      },
    })
    const durableMap = deepCloneJson(harness.maps.getBySlug(command.mapSlug))
    const durableTerminal = deepCloneJson(terminal)
    const durableRealtime = harness.realtime.readAfter({ afterSequence: 0, limit: 100 }).events

    const replay = replayMoveResponseCommandUseCase({ role: 'gm', command }, {
      database: harness.database,
      mapRepository: harness.maps,
      opRepository: harness.ops,
    })
    expect(replay?.result).toEqual(accepted.result)
    expect(harness.maps.getBySlug(command.mapSlug)).toEqual(durableMap)
    expect(harness.pending.getById(declaration.stored.resolutionId)).toEqual(durableTerminal)
    expect(harness.realtime.readAfter({ afterSequence: 0, limit: 100 }).events).toEqual(durableRealtime)
    expect(harness.maps.getBySlug(command.mapSlug)?.hazards).toEqual([])
    expect(harness.maps.getBySlug(command.mapSlug)?.encounterState?.zones).toHaveLength(2)
  })

  it('accepts a reviewed zero-cell up-to selection without inventing a hazard', async () => {
    const harness = createHarness()
    const declaration = await declareHazardChoice(
      harness,
      HAZARD_CELL_CHOICE_UP_TO_RULES,
      'op_hazardemptydeclare1',
    )
    const window = privateHazardWindow(declaration.stored)
    const mapBeforeResponse = harness.maps.getBySlug(declaration.command.mapSlug)!
    const command = chooseCommand({
      map: mapBeforeResponse,
      resolutionId: declaration.stored.resolutionId,
      windowId: window.windowId,
      optionIds: [],
      opId: 'op_hazardemptyanswer01',
    })

    const accepted = resumeChoice({
      harness,
      rules: HAZARD_CELL_CHOICE_UP_TO_RULES,
      command,
    })

    expect(accepted.result.ok).toBe(true)
    expect(accepted.map?.hazards).toEqual([])
    expect(accepted.map?.encounterState?.zones).toEqual([])
    expect(accepted.move?.transaction.hazardsToAdd).toEqual([])
    expect(harness.pending.getById(declaration.stored.resolutionId)).toMatchObject({
      resolution: {
        chosenOptions: [{
          optionId: expect.stringMatching(/^hazard\.selection\./),
          optionIds: [],
        }],
      },
    })
  })

  it.each([
    {
      label: 'over-count',
      optionIds: (window: ReturnType<typeof privateHazardWindow>) => [
        optionAt(window, { x: 1, y: 0, z: 1 }).id,
        optionAt(window, { x: 2, y: 0, z: 1 }).id,
        optionAt(window, { x: 3, y: 0, z: 1 }).id,
      ],
    },
    {
      label: 'disconnected',
      optionIds: (window: ReturnType<typeof privateHazardWindow>) => [
        optionAt(window, { x: 0, y: 0, z: 0 }).id,
        optionAt(window, { x: 4, y: 0, z: 4 }).id,
      ],
    },
  ])('terminally conflicts an authoritative $label selection without deferred mutation', async (example) => {
    const harness = createHarness()
    const declaration = await declareHazardChoice(
      harness,
      HAZARD_CELL_CHOICE_EXACT_RULES,
      `op_hazard${example.label.replace('-', '')}decl`,
    )
    const window = privateHazardWindow(declaration.stored)
    const mapBeforeResponse = harness.maps.getBySlug(declaration.command.mapSlug)!
    const command = chooseCommand({
      map: mapBeforeResponse,
      resolutionId: declaration.stored.resolutionId,
      windowId: window.windowId,
      optionIds: example.optionIds(window),
      opId: `op_hazard${example.label.replace('-', '')}ans01`,
    })

    const rejected = resumeChoice({
      harness,
      rules: HAZARD_CELL_CHOICE_EXACT_RULES,
      command,
    })

    expect(rejected.result).toMatchObject({ ok: false, reason: 'conflict' })
    expectNoDeferredMoveMutation(rejected.map!)
    expect(rejected.map?.encounterState?.pendingResolutionSummaries).toEqual([])
    expect(harness.pending.getById(declaration.stored.resolutionId)).toMatchObject({
      status: 'conflicted',
      terminalOpId: command.opId,
    })
  })

  it('rejects a forged option before execution and leaves the durable window unchanged', async () => {
    const harness = createHarness()
    const declaration = await declareHazardChoice(
      harness,
      HAZARD_CELL_CHOICE_EXACT_RULES,
      'op_hazardforgedeclare',
    )
    const window = privateHazardWindow(declaration.stored)
    const first = selectedAdjacentOptions(window)[0]!
    const mapBefore = deepCloneJson(harness.maps.getBySlug(declaration.command.mapSlug))
    const pendingBefore = deepCloneJson(harness.pending.getById(declaration.stored.resolutionId))
    const command = chooseCommand({
      map: mapBefore!,
      resolutionId: declaration.stored.resolutionId,
      windowId: window.windowId,
      optionIds: [first.id, 'hazard.cell.deadbeef.5.0.5'],
      opId: 'op_hazardforgedanswer1',
    })

    expect(() => parsePendingMoveResponseCommand(command, {
      pendingResolutionRepository: harness.pending,
      expectedType: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
    })).toThrowError(expect.objectContaining<Partial<MoveResponseCommandParserError>>({
      code: 'unknown-option',
    }))
    expect(harness.maps.getBySlug(command.mapSlug)).toEqual(mapBefore)
    expect(harness.pending.getById(declaration.stored.resolutionId)).toEqual(pendingBefore)
    expect(harness.ops.getOpRecord(command.mapSlug, command.opId)).toBeNull()
  })

  it('conflicts a stale occupied window before hazard, usage, or a second resource spend', async () => {
    const harness = createHarness()
    const declaration = await declareHazardChoice(
      harness,
      HAZARD_CELL_CHOICE_EXACT_RULES,
      'op_hazardstaledeclare1',
    )
    const window = privateHazardWindow(declaration.stored)
    const selected = selectedAdjacentOptions(window)
    const blockerSheet = createHazardCellChoiceActorSheet({
      slug: 'late-hazard-blocker',
      nickname: 'Late Hazard Blocker',
      revision: 1,
      movelist: [],
    })
    harness.sheets.save({
      kind: 'pokemon',
      slug: blockerSheet.slug,
      document: blockerSheet as unknown as Record<string, unknown>,
      revision: 1,
      updatedAt: 1_500,
    })
    const current = harness.maps.getBySlug(declaration.command.mapSlug)!
    const blocker: SheetPlacement = {
      id: 'late-hazard-blocker',
      sheetKind: 'pokemon',
      sheetSlug: blockerSheet.slug,
      position: { ...selected[0]!.cell },
    }
    const changed: TabletopMap = {
      ...deepCloneJson(current),
      placements: [...current.placements, blocker],
      revision: (current.revision ?? 0) + 1,
      updatedAt: 1_500,
    }
    expect(harness.maps.applyLivePlayUpdate({
      slug: current.slug,
      expectedRevision: current.revision ?? 0,
      nextMap: changed,
    })).toBe('applied')

    const command = chooseCommand({
      map: changed,
      resolutionId: declaration.stored.resolutionId,
      windowId: window.windowId,
      optionIds: selected.map(option => option.id),
      opId: 'op_hazardstaleanswer01',
    })
    const rejected = resumeChoice({
      harness,
      rules: HAZARD_CELL_CHOICE_EXACT_RULES,
      command,
    })

    expect(rejected.result).toMatchObject({ ok: false, reason: 'conflict' })
    expectNoDeferredMoveMutation(rejected.map!)
    expect(rejected.map?.placements).toContainEqual(blocker)
    expect(harness.pending.getById(declaration.stored.resolutionId)).toMatchObject({
      status: 'conflicted',
    })
  })
})
