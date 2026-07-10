import { expect } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type LivePlayCommandResult,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import type { PlayerProfile } from '#shared/playerProfiles'
import { normalizeRevision } from '#shared/sessionRevisions'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import type { EncounterState } from '#shared/moveAutomation/encounterState'
import type {
  MoveResolutionAuditTrace,
  MoveResolutionTraceSummary,
} from '#shared/moveAutomation/trace'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { deepCloneJson } from '~/utils/serialization'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import {
  planAuthoritativeMoveState,
  type AuthoritativeMoveStatePlan,
} from '~~/server/domain/planAuthoritativeMoveState'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  executeMoveSpec,
  type MoveSpecAuthoritativeTargetEvaluation,
  type MoveSpecExecutionResult,
} from '~~/server/domain/moveAutomation/executeSpec'
import {
  REGISTERED_MOVE_HANDLER_REGISTRY,
  type RegisteredMoveHandlerRegistry,
} from '~~/server/domain/moveAutomation/handlers/registry'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import type {
  MoveAutomationRuntimeRegistry,
  MoveSpecV2Runtime,
} from '~~/server/domain/moveAutomation/registry'
import type { ValidatedMoveSpecDefinition } from '~~/server/domain/moveAutomation/validateSpec'
import { openRotomDatabase } from '~~/server/storage/database'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import {
  executeLivePlayResolveMoveCommandUseCase,
  type LivePlayResolveMoveCommandResponse,
} from '~~/server/useCases/applyResolveMoveCommand'
import { acceptedRealtimeTestHooks } from '../../server/livePlayAcceptedRealtimeTestUtils'

export interface MoveAutomationSemanticScenarioChoice {
  readonly requestId: string
  readonly optionId: string | null
  readonly recipientPlacementId?: string
}

export interface MoveAutomationSemanticScenarioInitialState {
  readonly map: TabletopMap
  /** Kept explicit so active rule state is never hidden in a generic map fixture. */
  readonly encounterState: EncounterState
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
}

export interface MoveAutomationSemanticInterpreterInput {
  readonly candidatePlacementIds: readonly string[]
  readonly selectedPlacementIds: readonly string[]
  /** Required for geometric area specs; these IDs are server-derived in production. */
  readonly authoritativeTargetIds?: readonly string[]
  readonly authoritativeTargetEvaluations?: readonly MoveSpecAuthoritativeTargetEvaluation[]
}

export interface MoveAutomationSemanticCommandInput {
  readonly candidateScopePlacementIds: readonly string[]
  readonly baseRevision?: number
  readonly role?: 'gm' | 'player'
  readonly clientId?: string
  readonly playerProfile?: PlayerProfile | null
}

export interface MoveAutomationSemanticScenarioSeed {
  readonly randomValues: readonly number[]
  readonly now: number
  readonly idPrefix?: string
}

export interface MoveAutomationSemanticScenarioRejectionExpectation {
  readonly source?: 'error' | 'result'
  readonly name?: string
  readonly code?: string
  readonly reason?: string
  readonly reasonCode?: string
  readonly messageIncludes?: string
}

export type MoveAutomationSemanticExpectedObject = Readonly<Record<string, unknown>>

export type MoveAutomationSemanticScenarioLayerExpectation =
  | { readonly result: MoveAutomationSemanticExpectedObject; readonly rejection?: never }
  | { readonly rejection: MoveAutomationSemanticScenarioRejectionExpectation; readonly result?: never }

export interface MoveAutomationSemanticTraceSubset {
  readonly trace?: MoveAutomationSemanticExpectedObject
  readonly events?: readonly Readonly<Record<string, unknown>>[]
}

export interface MoveAutomationSemanticScenarioExpected {
  readonly interpreter: MoveAutomationSemanticScenarioLayerExpectation
  readonly plan: MoveAutomationSemanticScenarioLayerExpectation
  readonly command: MoveAutomationSemanticScenarioLayerExpectation
  readonly committedDocuments?: MoveAutomationSemanticExpectedObject
  readonly trace?: {
    readonly interpreter?: MoveAutomationSemanticTraceSubset
    readonly plan?: MoveAutomationSemanticTraceSubset
    readonly command?: MoveAutomationSemanticTraceSubset
  }
}

/**
 * One reviewed semantic example, executable independently at all immediate-move
 * boundaries. Choices are part of the fixture contract now, but must remain
 * empty until the durable resume boundary is implemented in Phase 5.
 */
export interface MoveAutomationSemanticScenario {
  readonly scenarioId: string
  readonly operationId: string
  readonly runtimeRegistry: MoveAutomationRuntimeRegistry
  readonly initialState: MoveAutomationSemanticScenarioInitialState
  readonly intent: ResolveMoveIntent
  readonly choices: readonly MoveAutomationSemanticScenarioChoice[]
  readonly interpreter: MoveAutomationSemanticInterpreterInput
  readonly command: MoveAutomationSemanticCommandInput
  readonly seed: MoveAutomationSemanticScenarioSeed
  readonly expected: MoveAutomationSemanticScenarioExpected
}

export interface MoveAutomationSemanticScenarioRejection {
  readonly source: 'error' | 'result'
  readonly name?: string
  readonly code?: string
  readonly reason?: string
  readonly reasonCode?: string
  readonly message: string
}

export type MoveAutomationSemanticLayerOutcome<Value> =
  | { readonly status: 'completed'; readonly value: Value }
  | {
      readonly status: 'rejected'
      readonly rejection: MoveAutomationSemanticScenarioRejection
      readonly value?: Value
    }

export interface MoveAutomationSemanticCommittedDocuments {
  readonly map: TabletopMap | null
  readonly sheets: {
    readonly pokemon: Readonly<Record<string, Readonly<Record<string, unknown>>>>
    readonly trainer: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  }
  readonly operationResult: LivePlayCommandResult | null
  readonly realtimeEvents: readonly unknown[]
}

export interface MoveAutomationSemanticScenarioResult {
  readonly scenarioId: string
  readonly interpreter: MoveAutomationSemanticLayerOutcome<MoveSpecExecutionResult>
  readonly plan: MoveAutomationSemanticLayerOutcome<AuthoritativeMoveStatePlan>
  readonly command: MoveAutomationSemanticLayerOutcome<LivePlayResolveMoveCommandResponse>
  readonly committedDocuments: MoveAutomationSemanticCommittedDocuments
  readonly traces: {
    readonly interpreter: MoveResolutionAuditTrace | null
    readonly plan: MoveResolutionAuditTrace | null
    readonly command: MoveResolutionTraceSummary | null
  }
  /** Cloneable source inputs captured before any layer ran. */
  readonly sourceInputSnapshot: unknown
}

export interface CreateMoveAutomationSemanticRuntimeOptions {
  readonly definition: ValidatedMoveSpecDefinition
  readonly sourceModule?: string
  readonly handlerRegistry?: RegisteredMoveHandlerRegistry
}

/** Build a one-spec registry without mutating the production manifest registry. */
export const createMoveAutomationSemanticRuntimeRegistry = (
  options: CreateMoveAutomationSemanticRuntimeOptions,
): MoveAutomationRuntimeRegistry => {
  const runtime: MoveSpecV2Runtime = Object.freeze({
    canonicalId: options.definition.spec.canonicalId,
    kind: 'movespec-v2',
    version: options.definition.spec.version,
    definitionHash: options.definition.definitionHash,
    sourceModule: options.sourceModule ?? 'tests/fixtures/moveAutomation/scenario.ts',
    definition: options.definition,
  })
  const entries = Object.freeze([runtime])
  return Object.freeze({
    size: 1,
    handlerRegistry: options.handlerRegistry ?? REGISTERED_MOVE_HANDLER_REGISTRY,
    resolve: (canonicalId: string) => canonicalId === runtime.canonicalId ? runtime : null,
    entries: () => entries,
  })
}

interface CanonicalScenarioState {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
}

const cloneSheetMap = <Sheet extends CharacterSheet | TrainerSheet>(
  sheets: ReadonlyMap<string, Sheet>,
): Map<string, Sheet> => new Map(
  [...sheets].map(([slug, sheet]) => [slug, deepCloneJson(sheet)]),
)

const sourceInputSnapshot = (scenario: MoveAutomationSemanticScenario): unknown => ({
  initialState: {
    map: deepCloneJson(scenario.initialState.map),
    encounterState: deepCloneJson(scenario.initialState.encounterState),
    pokemonSheets: [...scenario.initialState.pokemonSheets]
      .map(([slug, sheet]) => [slug, deepCloneJson(sheet)] as const),
    trainerSheets: [...scenario.initialState.trainerSheets]
      .map(([slug, sheet]) => [slug, deepCloneJson(sheet)] as const),
  },
  intent: deepCloneJson(scenario.intent),
  choices: deepCloneJson(scenario.choices),
  interpreter: deepCloneJson(scenario.interpreter),
  command: deepCloneJson(scenario.command),
  seed: deepCloneJson(scenario.seed),
})

const safeIdPrefix = (scenario: MoveAutomationSemanticScenario): string => (
  scenario.seed.idPrefix ?? scenario.scenarioId
).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 48) || 'semantic-scenario'

const createScenarioIdFactory = (scenario: MoveAutomationSemanticScenario): (() => string) => {
  const prefix = safeIdPrefix(scenario)
  let sequence = 0
  return () => `${prefix}-${++sequence}`
}

const errorRejection = (error: unknown): MoveAutomationSemanticScenarioRejection => {
  const record = typeof error === 'object' && error !== null
    ? error as Readonly<Record<string, unknown>>
    : null
  return {
    source: 'error',
    name: error instanceof Error ? error.name : typeof error,
    ...(typeof record?.code === 'string' ? { code: record.code } : {}),
    ...(typeof record?.reason === 'string' ? { reason: record.reason } : {}),
    ...(typeof record?.reasonCode === 'string' ? { reasonCode: record.reasonCode } : {}),
    message: error instanceof Error ? error.message : String(error),
  }
}

const interpreterResultRejection = (
  result: Extract<MoveSpecExecutionResult, { readonly kind: 'rejected' }>,
): MoveAutomationSemanticScenarioRejection => ({
  source: 'result',
  code: result.rejection.code,
  reasonCode: result.rejection.reasonCode,
  message: result.rejection.reasonCode,
})

const commandResultRejection = (
  result: Extract<LivePlayCommandResult, { readonly ok: false }>,
): MoveAutomationSemanticScenarioRejection => {
  const currentState = typeof result.currentState === 'object' && result.currentState !== null
    ? result.currentState as Readonly<Record<string, unknown>>
    : null
  return {
    source: 'result',
    reason: result.reason,
    ...(typeof currentState?.code === 'string' ? { code: currentState.code } : {}),
    message: result.message,
  }
}

const runInterpreter = (
  scenario: MoveAutomationSemanticScenario,
  state: CanonicalScenarioState,
): MoveAutomationSemanticLayerOutcome<MoveSpecExecutionResult> => {
  try {
    const runtime = scenario.runtimeRegistry.resolve(scenario.intent.moveName)
    if (!runtime || runtime.kind !== 'movespec-v2') {
      throw new Error(`Scenario ${scenario.scenarioId} has no native MoveSpec runtime for ${scenario.intent.moveName}.`)
    }
    const context = buildAuthoritativeMoveRulesContext({
      map: deepCloneJson(state.map),
      pokemonSheets: cloneSheetMap(state.pokemonSheets),
      trainerSheets: cloneSheetMap(state.trainerSheets),
      intent: deepCloneJson(scenario.intent),
      candidatePlacementIds: [...scenario.interpreter.candidatePlacementIds],
      selectedPlacementIds: [...scenario.interpreter.selectedPlacementIds],
      random: createFiniteAuthoritativeMoveRandomStream(scenario.seed.randomValues),
      time: scenario.seed.now,
      idFactory: createScenarioIdFactory(scenario),
      runtimeRegistry: scenario.runtimeRegistry,
    })
    const value = executeMoveSpec({
      definition: runtime.definition,
      context,
      ...(scenario.interpreter.authoritativeTargetIds === undefined
        ? {}
        : { authoritativeTargetIds: [...scenario.interpreter.authoritativeTargetIds] }),
      ...(scenario.interpreter.authoritativeTargetEvaluations === undefined
        ? {}
        : {
            authoritativeTargetEvaluations: scenario.interpreter.authoritativeTargetEvaluations
              .map(evaluation => ({ ...evaluation })),
          }),
      handlerRegistry: scenario.runtimeRegistry.handlerRegistry,
    })
    if (value.kind === 'rejected') {
      return { status: 'rejected', rejection: interpreterResultRejection(value), value }
    }
    return { status: 'completed', value }
  }
  catch (error) {
    return { status: 'rejected', rejection: errorRejection(error) }
  }
}

const runPlanner = (
  scenario: MoveAutomationSemanticScenario,
  state: CanonicalScenarioState,
): MoveAutomationSemanticLayerOutcome<AuthoritativeMoveStatePlan> => {
  try {
    const value = planAuthoritativeMoveState({
      map: deepCloneJson(state.map),
      pokemonSheets: cloneSheetMap(state.pokemonSheets),
      trainerSheets: cloneSheetMap(state.trainerSheets),
      intent: deepCloneJson(scenario.intent),
      random: createFiniteAuthoritativeMoveRandomStream(scenario.seed.randomValues),
      now: () => scenario.seed.now,
      idFactory: createScenarioIdFactory(scenario),
      operationId: scenario.operationId,
      runtimeRegistry: scenario.runtimeRegistry,
    })
    return { status: 'completed', value }
  }
  catch (error) {
    return { status: 'rejected', rejection: errorRejection(error) }
  }
}

const persistedSheetRecord = (
  sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>,
  kind: 'pokemon' | 'trainer',
  slugs: Iterable<string>,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> => Object.freeze(
  Object.fromEntries([...slugs].map((slug) => {
    const persisted = sheets.getByRef(kind, slug)
    return [slug, Object.freeze(deepCloneJson(persisted?.sheet ?? {}))]
  })),
)

const runCommand = async (options: {
  readonly scenario: MoveAutomationSemanticScenario
  readonly state: CanonicalScenarioState
  readonly database: ReturnType<typeof openRotomDatabase>
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
}): Promise<MoveAutomationSemanticLayerOutcome<LivePlayResolveMoveCommandResponse>> => {
  try {
    const scopes = buildResolveMoveScopes({
      map: options.state.map,
      intent: options.scenario.intent,
      candidateScopePlacementIds: options.scenario.command.candidateScopePlacementIds,
    })
    if (!scopes.ok) throw new Error(`Scenario command scopes are invalid: ${scopes.message}`)
    const command: ResolveMoveLivePlayCommand = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: options.scenario.operationId,
      mapSlug: options.state.map.slug,
      baseRevision: options.scenario.command.baseRevision
        ?? normalizeRevision(options.state.map.revision),
      type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
      scopes: scopes.scopes,
      payload: deepCloneJson(options.scenario.intent),
    }
    const value = await executeLivePlayResolveMoveCommandUseCase({
      role: options.scenario.command.role ?? 'gm',
      command,
      clientId: options.scenario.command.clientId ?? 'semantic-scenario-client',
      playerProfile: options.scenario.command.playerProfile ?? null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    }, {
      database: options.database,
      mapRepository: options.maps,
      sheetRepository: options.sheets,
      commandExecutor: options.commandExecutor,
      planner: input => planAuthoritativeMoveState({
        ...input,
        runtimeRegistry: options.scenario.runtimeRegistry,
      }),
      random: createFiniteAuthoritativeMoveRandomStream(options.scenario.seed.randomValues),
      now: () => options.scenario.seed.now,
      idFactory: createScenarioIdFactory(options.scenario),
      relativePath: path => path,
    })
    if (!value.result.ok) {
      return {
        status: 'rejected',
        rejection: commandResultRejection(value.result),
        value,
      }
    }
    return { status: 'completed', value }
  }
  catch (error) {
    return { status: 'rejected', rejection: errorRejection(error) }
  }
}

const seedScenarioState = (options: {
  readonly scenario: MoveAutomationSemanticScenario
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
}): CanonicalScenarioState => {
  const map = {
    ...deepCloneJson(options.scenario.initialState.map),
    encounterState: deepCloneJson(options.scenario.initialState.encounterState),
  }
  const mapUpdatedAt = map.updatedAt ?? options.scenario.seed.now
  options.maps.save({
    slug: map.slug,
    document: map,
    revision: normalizeRevision(map.revision),
    updatedAt: mapUpdatedAt,
  })

  const saveSheets = <Sheet extends CharacterSheet | TrainerSheet>(
    kind: 'pokemon' | 'trainer',
    entries: ReadonlyMap<string, Sheet>,
  ): void => {
    for (const [slug, sheet] of entries) {
      const updatedAt = Number((sheet as { readonly updatedAt?: number }).updatedAt ?? mapUpdatedAt)
      options.sheets.save({
        kind,
        slug,
        document: deepCloneJson(sheet) as unknown as Record<string, unknown>,
        revision: normalizeRevision(sheet.revision),
        updatedAt,
      })
    }
  }
  saveSheets('pokemon', options.scenario.initialState.pokemonSheets)
  saveSheets('trainer', options.scenario.initialState.trainerSheets)

  const canonicalMap = options.maps.getBySlug(map.slug)
  if (!canonicalMap) throw new Error(`Scenario map ${map.slug} was not persisted.`)
  const pokemonSheets = new Map<string, CharacterSheet>()
  const trainerSheets = new Map<string, TrainerSheet>()
  for (const slug of options.scenario.initialState.pokemonSheets.keys()) {
    const sheet = options.sheets.getByRef('pokemon', slug)
    if (!sheet) throw new Error(`Scenario pokemon sheet ${slug} was not persisted.`)
    pokemonSheets.set(slug, deepCloneJson(sheet.sheet) as unknown as CharacterSheet)
  }
  for (const slug of options.scenario.initialState.trainerSheets.keys()) {
    const sheet = options.sheets.getByRef('trainer', slug)
    if (!sheet) throw new Error(`Scenario trainer sheet ${slug} was not persisted.`)
    trainerSheets.set(slug, deepCloneJson(sheet.sheet) as unknown as TrainerSheet)
  }
  return { map: canonicalMap, pokemonSheets, trainerSheets }
}

/** Execute one immutable fixture at interpreter, planner, and durable command boundaries. */
export const runMoveAutomationSemanticScenario = async (
  scenario: MoveAutomationSemanticScenario,
): Promise<MoveAutomationSemanticScenarioResult> => {
  if (scenario.choices.length > 0) {
    throw new Error(
      `Scenario ${scenario.scenarioId} supplies resolved choices, but the immediate three-layer harness cannot resume durable choices before Phase 5.`,
    )
  }

  const snapshot = sourceInputSnapshot(scenario)
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  try {
    const maps = createSqliteMapRepository<TabletopMap>(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const ops = createSqliteLivePlayOpRepository({
      database,
      clock: () => scenario.seed.now,
    })
    const modes = createSqliteMapInteractionModeRepository(database)
    const realtimeEvents: unknown[] = []
    const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
      opStore: ops,
      queue: createInProcessMapWriteQueue(),
      readMapInteractionMode: mapSlug => modes.get(mapSlug).interactionMode,
      ...acceptedRealtimeTestHooks(realtimeEvents, { clock: () => scenario.seed.now }),
    })
    const state = seedScenarioState({ scenario, maps, sheets })
    const interpreter = runInterpreter(scenario, state)
    const plan = runPlanner(scenario, state)
    const command = await runCommand({
      scenario,
      state,
      database,
      maps,
      sheets,
      ops,
      commandExecutor,
    })
    const interpreterTrace = interpreter.value?.trace ?? null
    const planTrace = plan.value?.resolution.auditTrace ?? null
    const commandTrace = command.value?.move?.trace ?? null
    const committedDocuments: MoveAutomationSemanticCommittedDocuments = {
      map: deepCloneJson(maps.getBySlug(state.map.slug)),
      sheets: {
        pokemon: persistedSheetRecord(
          sheets,
          'pokemon',
          scenario.initialState.pokemonSheets.keys(),
        ),
        trainer: persistedSheetRecord(
          sheets,
          'trainer',
          scenario.initialState.trainerSheets.keys(),
        ),
      },
      operationResult: deepCloneJson(ops.getOpResult(state.map.slug, scenario.operationId)),
      realtimeEvents: deepCloneJson(realtimeEvents),
    }
    return {
      scenarioId: scenario.scenarioId,
      interpreter,
      plan,
      command,
      committedDocuments,
      traces: {
        interpreter: interpreterTrace,
        plan: planTrace,
        command: commandTrace,
      },
      sourceInputSnapshot: snapshot,
    }
  }
  finally {
    database.close()
  }
}

const assertLayerExpectation = <Value>(
  label: string,
  outcome: MoveAutomationSemanticLayerOutcome<Value>,
  expected: MoveAutomationSemanticScenarioLayerExpectation,
): void => {
  if (expected.result !== undefined) {
    expect(outcome.status, label).toBe('completed')
    if (outcome.status === 'completed') expect(outcome.value, label).toMatchObject(expected.result)
    return
  }

  expect(outcome.status, label).toBe('rejected')
  if (outcome.status !== 'rejected') return
  const { messageIncludes, ...rejection } = expected.rejection
  expect(outcome.rejection, label).toMatchObject(rejection)
  if (messageIncludes !== undefined) {
    expect(outcome.rejection.message, label).toContain(messageIncludes)
  }
}

const assertTraceSubset = (
  label: string,
  trace: MoveResolutionAuditTrace | MoveResolutionTraceSummary | null,
  expected: MoveAutomationSemanticTraceSubset | undefined,
): void => {
  if (!expected) return
  expect(trace, `${label} trace`).not.toBeNull()
  if (!trace) return
  if (expected.trace !== undefined) expect(trace, `${label} trace`).toMatchObject(expected.trace)
  for (const event of expected.events ?? []) {
    expect(trace.events, `${label} trace event ${String(event.kind ?? 'unknown')}`).toEqual(
      expect.arrayContaining([expect.objectContaining(event)]),
    )
  }
}

/** Assert only expectations stored in the scenario; test bodies need no repeated setup. */
export const assertMoveAutomationSemanticScenario = (
  scenario: MoveAutomationSemanticScenario,
  result: MoveAutomationSemanticScenarioResult,
): void => {
  expect(result.scenarioId).toBe(scenario.scenarioId)
  expect(sourceInputSnapshot(scenario)).toEqual(result.sourceInputSnapshot)
  assertLayerExpectation('interpreter', result.interpreter, scenario.expected.interpreter)
  assertLayerExpectation('plan', result.plan, scenario.expected.plan)
  assertLayerExpectation('command', result.command, scenario.expected.command)
  if (scenario.expected.committedDocuments !== undefined) {
    expect(result.committedDocuments).toMatchObject(scenario.expected.committedDocuments)
  }
  assertTraceSubset(
    'interpreter',
    result.traces.interpreter,
    scenario.expected.trace?.interpreter,
  )
  assertTraceSubset('plan', result.traces.plan, scenario.expected.trace?.plan)
  assertTraceSubset('command', result.traces.command, scenario.expected.trace?.command)
}

export const runAndAssertMoveAutomationSemanticScenario = async (
  scenario: MoveAutomationSemanticScenario,
): Promise<MoveAutomationSemanticScenarioResult> => {
  const result = await runMoveAutomationSemanticScenario(scenario)
  assertMoveAutomationSemanticScenario(scenario, result)
  return result
}
