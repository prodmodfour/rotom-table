import { afterEach, describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  isPendingMoveDeclarationResult,
  parsePendingMoveResolution,
} from '#shared/moveAutomation/pendingResolution'
import {
  parseMoveHazardCellSelectionPublicWindow,
  projectMoveHazardCellSelectionPublicWindow,
} from '#shared/moveAutomation/hazardCellSelection'
import { parsePendingMoveResponseWindowList } from '#shared/moveAutomation/responseViews'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { deepCloneJson } from '~/utils/serialization'
import {
  buildAuthoritativeMoveRulesContext,
  type AuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import { executeMoveSpec } from '~~/server/domain/moveAutomation/executeSpec'
import type { MoveAutomationRuntimeRegistry } from '~~/server/domain/moveAutomation/registry'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import {
  isAuthoritativePendingMoveResolution,
  resolveAuthoritativeMoveExecutionFromContext,
} from '~~/server/domain/resolveAuthoritativeMove'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '~~/server/domain/planAuthoritativeMoveState'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqlitePendingMoveResolutionRepository } from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import {
  executeLivePlayResolveMoveCommandUseCase,
} from '~~/server/useCases/applyResolveMoveCommand'
import { listPendingMoveResponsesUseCase } from '~~/server/useCases/listPendingMoveResponses'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import {
  HAZARD_CELL_CHOICE_ACTOR_ID,
  HAZARD_CELL_CHOICE_ACTOR_SHEET,
  HAZARD_CELL_CHOICE_CANONICAL_MOVE_ID,
  HAZARD_CELL_CHOICE_EXACT_RULES,
  HAZARD_CELL_CHOICE_OPERATION_ID,
  HAZARD_CELL_CHOICE_SET_ID,
  HAZARD_CELL_CHOICE_UP_TO_RULES,
  HAZARD_CELL_CHOICE_WINDOW_ID,
  createHazardCellChoiceActorSheet,
  createHazardCellChoiceMap,
  createHazardCellChoiceRuntimeRegistry,
  createHazardCellChoiceSpec,
  hazardCellChoiceIntent,
  hazardCellChoiceSheets,
} from '../fixtures/moveAutomation/hazardCellChoices'

const rulesCases = [
  ['exact', HAZARD_CELL_CHOICE_EXACT_RULES, false],
  ['up-to', HAZARD_CELL_CHOICE_UP_TO_RULES, true],
] as const

const runtimeDefinition = (registry: MoveAutomationRuntimeRegistry) => {
  const runtime = registry.resolve(HAZARD_CELL_CHOICE_CANONICAL_MOVE_ID)
  if (!runtime || runtime.kind !== 'movespec-v2') {
    throw new Error('Expected the test hazard MoveSpec runtime.')
  }
  return runtime.definition
}

const executeHazardSpec = (
  rules: typeof HAZARD_CELL_CHOICE_EXACT_RULES | typeof HAZARD_CELL_CHOICE_UP_TO_RULES,
) => {
  const map = createHazardCellChoiceMap()
  const sheets = hazardCellChoiceSheets()
  const registry = createHazardCellChoiceRuntimeRegistry(rules)
  const context = buildAuthoritativeMoveRulesContext({
    map,
    ...sheets,
    intent: hazardCellChoiceIntent(),
    candidatePlacementIds: [],
    selectedPlacementIds: [],
    random: () => { throw new Error('hazard-cell suspension must not draw randomness') },
    time: 1_000,
    runtimeRegistry: registry,
  })
  return {
    map,
    result: executeMoveSpec({
      definition: runtimeDefinition(registry),
      context,
    }),
    registry,
    sheets,
  }
}

const planHazardSpec = (
  rules: typeof HAZARD_CELL_CHOICE_EXACT_RULES | typeof HAZARD_CELL_CHOICE_UP_TO_RULES,
) => {
  const execution = executeHazardSpec(rules)
  const mapBefore = deepCloneJson(execution.map)
  const plan = planAuthoritativeMoveStateExecution({
    map: execution.map,
    ...execution.sheets,
    intent: hazardCellChoiceIntent(),
    random: () => { throw new Error('hazard-cell suspension must not draw randomness') },
    now: () => 1_000,
    operationId: 'op_hazardplan0001',
    pendingResolutionId: 'resolution-hazard-plan-1',
    runtimeRegistry: execution.registry,
  })
  if (!isAuthoritativePendingMoveStatePlan(plan)) {
    throw new Error('Expected the hazard-cell move to suspend.')
  }
  return { ...execution, mapBefore, plan }
}

describe('durable MoveSpec hazard-cell suspension', () => {
  it('rejects a coordinate origin embedded in reviewed MoveSpec data', () => {
    const candidate = deepCloneJson(createHazardCellChoiceSpec()) as {
      phases: Array<{
        operations: Array<{ payload: Record<string, unknown> }>
      }>
    }
    const payload = candidate.phases[0]?.operations[0]?.payload
    const selection = payload?.cellSelection
    if (!payload || typeof selection !== 'object' || selection === null || Array.isArray(selection)) {
      throw new Error('Expected the hazard-cell selection fixture.')
    }
    payload.cellSelection = {
      ...(selection as Record<string, unknown>),
      origin: { x: 99, y: 99, z: 99 },
    }

    expect(() => validateMoveSpec(candidate)).toThrowError(expect.objectContaining({
      name: 'MoveEffectOperationValidationError',
      code: 'invalid-effect-operation',
      path: expect.stringContaining('cellSelection'),
    }))
  })

  it('lets a reviewed native self runtime suspend a canonical hazard-placement script', () => {
    const { map, registry, sheets } = executeHazardSpec(HAZARD_CELL_CHOICE_EXACT_RULES)
    const baseContext = buildAuthoritativeMoveRulesContext({
      map,
      ...sheets,
      intent: hazardCellChoiceIntent(),
      candidatePlacementIds: [],
      selectedPlacementIds: [],
      random: () => { throw new Error('hazard-cell suspension must not draw randomness') },
      time: 1_000,
      runtimeRegistry: registry,
    })
    const entryResult = baseContext.queries.resolveActorMoveEntry(
      HAZARD_CELL_CHOICE_CANONICAL_MOVE_ID,
    )
    if (!entryResult.ok) throw new Error('Expected the actor move entry.')
    const hazardScript: MoveAutomationScript = {
      ...entryResult.entry.script,
      targetMode: 'hazard',
      targetCount: null,
      hazardSuggestions: [{ kind: 'spikes', squares: 2, label: 'Place Spikes' }],
    }
    const resolveActorMoveEntry: AuthoritativeMoveRulesContext['queries']['resolveActorMoveEntry']
      = () => ({
        ok: true,
        entry: { ...entryResult.entry, script: hazardScript },
      })
    const context: AuthoritativeMoveRulesContext = {
      ...baseContext,
      queries: {
        ...baseContext.queries,
        resolveActorMoveEntry,
      },
    }

    const result = resolveAuthoritativeMoveExecutionFromContext(context)

    expect(isAuthoritativePendingMoveResolution(result)).toBe(true)
    expect(result).toMatchObject({
      kind: 'pending',
      execution: {
        request: {
          kind: 'hazard-cell-choice',
          operationId: HAZARD_CELL_CHOICE_OPERATION_ID,
        },
      },
    })
  })

  it.each(rulesCases)(
    'stops an unresolved %s requirement before hazard and usage mutation',
    (_kind, rules, allowPass) => {
      const { map, result } = executeHazardSpec(rules)

      expect(result.kind).toBe('pending-request')
      if (result.kind !== 'pending-request') return
      expect(result).toMatchObject({
        kind: 'pending-request',
        request: {
          kind: 'hazard-cell-choice',
          requestId: HAZARD_CELL_CHOICE_WINDOW_ID,
          operationId: HAZARD_CELL_CHOICE_OPERATION_ID,
          cellSetId: HAZARD_CELL_CHOICE_SET_ID,
          phase: 'schedule',
          recipientIds: [HAZARD_CELL_CHOICE_ACTOR_ID],
          options: [],
          allowPass,
          selection: rules,
        },
        preWindowOperations: [],
        deferredContinuation: {
          phase: 'schedule',
          requestOperationId: HAZARD_CELL_CHOICE_OPERATION_ID,
          operations: [],
        },
      })
      expect(result.trace.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'operation',
          operationId: HAZARD_CELL_CHOICE_OPERATION_ID,
          outcome: 'pending',
        }),
        expect.objectContaining({
          kind: 'choice',
          requestId: HAZARD_CELL_CHOICE_WINDOW_ID,
          outcome: 'requested',
        }),
      ]))
      expect(result.operations.map(entry => entry.operation.id)).toEqual([
        HAZARD_CELL_CHOICE_OPERATION_ID,
      ])
      expect(map.hazards).toEqual([])
      expect(map.moveUsage).toBeUndefined()
      expect(Object.isFrozen(result)).toBe(true)
      expect(Object.isFrozen(result.request)).toBe(true)
    },
  )

  it.each(rulesCases)(
    'materializes one private and public %s window at the authoritative planner boundary',
    (_kind, rules, allowPass) => {
      const { map, mapBefore, plan } = planHazardSpec(rules)
      const pending = plan.suspension.pendingResolution
      const window = pending.outstandingWindows[0]

      expect(window).toMatchObject({
        kind: 'choice',
        windowId: HAZARD_CELL_CHOICE_WINDOW_ID,
        operationId: HAZARD_CELL_CHOICE_OPERATION_ID,
        ownership: [{ kind: 'actor', id: null }],
        allowPass,
        options: expect.arrayContaining([
          expect.objectContaining({
            id: expect.stringMatching(/^hazard\.cell\./),
            labelKey: 'move.hazard.select-cell',
          }),
        ]),
        hazardCellSelection: {
          declaration: {
            windowId: HAZARD_CELL_CHOICE_WINDOW_ID,
            map: { slug: map.slug, revision: 8 },
            move: {
              resolutionId: pending.resolutionId,
              actorPlacementId: HAZARD_CELL_CHOICE_ACTOR_ID,
              canonicalMoveId: HAZARD_CELL_CHOICE_CANONICAL_MOVE_ID,
              operationId: HAZARD_CELL_CHOICE_OPERATION_ID,
              cellSetId: HAZARD_CELL_CHOICE_SET_ID,
            },
            constraints: {
              ...rules,
              origin: { x: 2, y: 0, z: 2 },
            },
          },
        },
      })
      if (window?.kind !== 'choice' || !window.hazardCellSelection) {
        throw new Error('Expected a private hazard-cell window.')
      }
      expect(window.options.map(option => option.id)).toEqual(
        window.hazardCellSelection.options.map(option => option.id),
      )
      const publicWindow = projectMoveHazardCellSelectionPublicWindow(
        window.hazardCellSelection,
      )
      expect(parseMoveHazardCellSelectionPublicWindow(
        JSON.parse(JSON.stringify(publicWindow)) as unknown,
      )).toEqual(publicWindow)
      expect(publicWindow.move).not.toHaveProperty('operationId')
      expect(publicWindow.move).not.toHaveProperty('cellSetId')
      expect(parsePendingMoveResolution(
        JSON.parse(JSON.stringify(pending)) as unknown,
      )).toEqual(pending)
      expect(pending.publicSummary).not.toHaveProperty('options')
      expect(pending.publicSummary).not.toHaveProperty('ownership')
      expect(plan.nextMap.hazards).toEqual([])
      expect(plan.nextMap.moveUsage).toBeUndefined()
      expect(plan.nextMap.encounterState?.turnResources[HAZARD_CELL_CHOICE_ACTOR_ID])
        .toMatchObject({ actions: { standard: { spent: 1 } } })
      expect(map).toEqual(mapBefore)
    },
  )
})

interface Harness {
  readonly database: RotomDatabase
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly pending: ReturnType<typeof createSqlitePendingMoveResolutionRepository>
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
  return { database, maps, sheets, ops, pending, commandExecutor }
}

const declarationCommand = (map: TabletopMap): ResolveMoveLivePlayCommand => {
  const intent = hazardCellChoiceIntent()
  const scopes = buildResolveMoveScopes({
    map,
    intent,
    candidateScopePlacementIds: [],
  })
  if (!scopes.ok) throw new Error(scopes.message)
  return {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId: 'op_hazarddeclare01',
    mapSlug: map.slug,
    baseRevision: map.revision ?? 0,
    type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    scopes: scopes.scopes,
    payload: intent,
  }
}

const profile = (id: string, sheetSlug: string): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: id as PlayerProfileId,
  displayName: id.slice('profile_'.length) as PlayerProfileDisplayName,
  linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug }],
})

const eligibleProfile = profile('profile_hazardactor', HAZARD_CELL_CHOICE_ACTOR_SHEET)
const ineligibleProfile = profile('profile_hazardother', 'other-sheet')

describe('persisted hazard-cell declarations', () => {
  it('restores only authorized public options and replays one declaration without mutation', async () => {
    const harness = createHarness()
    const originalMap = harness.maps.getBySlug('hazard-choice-arena')!
    const command = declarationCommand(originalMap)
    const registry = createHazardCellChoiceRuntimeRegistry(HAZARD_CELL_CHOICE_EXACT_RULES)
    const first = await executeLivePlayResolveMoveCommandUseCase({
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
      planner: input => planAuthoritativeMoveStateExecution({ ...input, runtimeRegistry: registry }),
      random: () => { throw new Error('hazard-cell suspension must not draw randomness') },
      now: () => 1_000,
    })

    expect(isPendingMoveDeclarationResult(first.result)).toBe(true)
    if (!isPendingMoveDeclarationResult(first.result)) return
    const stored = harness.pending.getByOrigin(command.mapSlug, command.opId)
    expect(stored).not.toBeNull()
    expect(stored?.resolution).toMatchObject({
      originMapSlug: command.mapSlug,
      originOpId: command.opId,
      readSet: [{ kind: 'map', slug: command.mapSlug, revision: 8 }, expect.any(Object)],
    })
    expect(stored?.resolution.outstandingWindows[0]).toMatchObject({
      windowId: HAZARD_CELL_CHOICE_WINDOW_ID,
      hazardCellSelection: {
        declaration: {
          move: {
            operationId: HAZARD_CELL_CHOICE_OPERATION_ID,
            cellSetId: HAZARD_CELL_CHOICE_SET_ID,
          },
        },
      },
    })

    const accessDependencies = {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
    }
    const eligible = listPendingMoveResponsesUseCase({
      role: 'player',
      mapSlug: command.mapSlug,
      playerProfile: eligibleProfile,
    }, accessDependencies)
    const ineligible = listPendingMoveResponsesUseCase({
      role: 'player',
      mapSlug: command.mapSlug,
      playerProfile: ineligibleProfile,
    }, accessDependencies)
    const gm = listPendingMoveResponsesUseCase({
      role: 'gm',
      mapSlug: command.mapSlug,
      playerProfile: null,
    }, accessDependencies)

    expect(ineligible.windows).toEqual([])
    expect(gm).toEqual(eligible)
    expect(eligible.windows).toHaveLength(1)
    expect(eligible.windows[0]?.window).toMatchObject({
      windowId: HAZARD_CELL_CHOICE_WINDOW_ID,
      hazardCellSelection: {
        map: { slug: command.mapSlug, revision: 8 },
        move: {
          resolutionId: first.result.pendingResolution.resolutionId,
          actorPlacementId: HAZARD_CELL_CHOICE_ACTOR_ID,
          canonicalMoveId: HAZARD_CELL_CHOICE_CANONICAL_MOVE_ID,
        },
        count: HAZARD_CELL_CHOICE_EXACT_RULES.count,
        options: expect.arrayContaining([
          expect.objectContaining({ id: expect.stringMatching(/^hazard\.cell\./) }),
        ]),
      },
    })
    const publicWire = JSON.stringify(eligible)
    expect(publicWire).not.toContain(HAZARD_CELL_CHOICE_OPERATION_ID)
    expect(publicWire).not.toContain(HAZARD_CELL_CHOICE_SET_ID)
    expect(publicWire).not.toContain('ownership')
    expect(parsePendingMoveResponseWindowList(
      JSON.parse(publicWire) as unknown,
    )).toEqual(eligible)

    const mapAfterFirst = deepCloneJson(harness.maps.getBySlug(command.mapSlug))
    const pendingAfterFirst = deepCloneJson(stored)
    expect(mapAfterFirst?.revision).toBe(8)
    expect(mapAfterFirst?.hazards).toEqual([])
    expect(mapAfterFirst?.moveUsage).toBeUndefined()
    expect(mapAfterFirst?.encounterState?.turnResources[HAZARD_CELL_CHOICE_ACTOR_ID])
      .toMatchObject({ actions: { standard: { spent: 1 } } })

    const duplicate = await executeLivePlayResolveMoveCommandUseCase({
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
      planner: () => { throw new Error('duplicate declaration must not replan') },
      random: () => { throw new Error('duplicate declaration must not reroll') },
      now: () => 2_000,
    })

    expect(duplicate.result).toEqual(first.result)
    expect(harness.maps.getBySlug(command.mapSlug)).toEqual(mapAfterFirst)
    expect(harness.pending.getByOrigin(command.mapSlug, command.opId)).toEqual(pendingAfterFirst)
    expect(harness.ops.getOpRecord(command.mapSlug, command.opId)).toBeNull()
    expect(listPendingMoveResponsesUseCase({
      role: 'player',
      mapSlug: command.mapSlug,
      playerProfile: eligibleProfile,
    }, accessDependencies)).toEqual(eligible)
  })
})
