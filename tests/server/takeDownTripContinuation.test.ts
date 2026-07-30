import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  isPendingMoveDeclarationResult,
  type PendingMoveResolution,
} from '#shared/moveAutomation/pendingResolution'
import {
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  type MoveResponseCommand,
} from '#shared/moveAutomation/responseCommands'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { deepCloneJson } from '~/utils/serialization'
import {
  TAKE_DOWN_TRIP_CONTINUATION_FIXTURE_SPEC,
  takeDownTripContinuationFixture,
  type TakeDownTripContinuationFixtureOptions,
} from '../fixtures/moveAutomation/takeDownTripContinuation'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import {
  executeMoveSpec,
  type MoveSpecExecutionResult,
} from '~~/server/domain/moveAutomation/executeSpec'
import { REGISTERED_MOVE_HANDLER_REGISTRY } from '~~/server/domain/moveAutomation/handlers/registry'
import { materializeMoveSpecSuspension } from '~~/server/domain/moveAutomation/materializeSuspension'
import { createMoveStateChangePlan } from '~~/server/domain/moveAutomation/plan'
import {
  createFiniteAuthoritativeMoveRandomStream,
  type AuthoritativeMoveRandomSource,
} from '~~/server/domain/moveAutomation/random'
import type {
  MoveAutomationRuntimeRegistry,
  MoveSpecV2Runtime,
} from '~~/server/domain/moveAutomation/registry'
import {
  TAKE_DOWN_TRIP_OPERATION_IDS,
  TAKE_DOWN_TRIP_REQUEST_IDS,
} from '~~/server/domain/moveAutomation/takeDownTripContinuation'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import { planAuthoritativeMoveStateExecution } from '~~/server/domain/planAuthoritativeMoveState'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import {
  MoveResponseCommandParserError,
  parsePendingMoveResponseCommand,
} from '~~/server/livePlay/moveResponseCommandParser'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqlitePendingMoveResolutionRepository } from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { executeLivePlayResolveMoveCommandUseCase } from '~~/server/useCases/applyResolveMoveCommand'
import { listPendingMoveResponsesUseCase } from '~~/server/useCases/listPendingMoveResponses'
import {
  PendingMoveResponseAccessError,
  authorizePendingMoveResponseWindow,
} from '~~/server/useCases/pendingMoveResponseAccess'
import {
  resumePendingMoveResolutionUseCase,
  type ResumePendingMoveResolutionInput,
} from '~~/server/useCases/resumePendingMoveResolution'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const definition = validateMoveSpec(TAKE_DOWN_TRIP_CONTINUATION_FIXTURE_SPEC)
const fixtureRuntime: MoveSpecV2Runtime = Object.freeze({
  canonicalId: 'Take Down',
  kind: 'movespec-v2',
  version: definition.spec.version,
  definitionHash: definition.definitionHash,
  sourceModule: 'tests/fixtures/moveAutomation/takeDownTripContinuation.ts',
  definition,
})
const fixtureRuntimeRegistry: MoveAutomationRuntimeRegistry = Object.freeze({
  size: 1,
  handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
  resolve: (canonicalId: string) => canonicalId === 'Take Down' ? fixtureRuntime : null,
  entries: () => Object.freeze([fixtureRuntime]),
})

const buildContext = (options: {
  readonly fixtureOptions?: TakeDownTripContinuationFixtureOptions
  readonly randomValues?: readonly number[]
  readonly resolutionId?: string
}) => {
  const fixture = takeDownTripContinuationFixture(options.fixtureOptions)
  return {
    fixture,
    context: buildAuthoritativeMoveRulesContext({
      ...fixture,
      candidatePlacementIds: ['target-token'],
      selectedPlacementIds: ['target-token'],
      random: createFiniteAuthoritativeMoveRandomStream(options.randomValues ?? []),
      runtimeRegistry: fixtureRuntimeRegistry,
      resolutionId: options.resolutionId ?? 'resolution-take-down-trip',
      time: 5_000,
    }),
  }
}

const execute = (options: {
  readonly fixtureOptions?: TakeDownTripContinuationFixtureOptions
  readonly randomValues?: readonly number[]
  readonly responses?: readonly { readonly requestId: string; readonly optionId: string | null }[]
  readonly ancestry?: readonly {
    readonly depth: number
    readonly resolutionId: string
    readonly canonicalId: string
    readonly definitionHash: string
    readonly parentOperationId: string | null
  }[]
} = {}): MoveSpecExecutionResult => {
  const { context } = buildContext(options)
  return executeMoveSpec({
    definition,
    context,
    authoritativeTargetIds: ['target-token'],
    resolutionId: 'resolution-take-down-trip',
    responses: options.responses,
    ancestry: options.ancestry,
  })
}

const operationTrace = (
  result: MoveSpecExecutionResult,
  operationId: string,
) => result.trace.events.find(event => (
  event.kind === 'operation' && event.operationId === operationId
))

const tripResponses = (options: {
  readonly actorSkill?: 'combat' | 'acrobatics'
  readonly targetSkill?: 'combat' | 'acrobatics'
} = {}) => [{
  requestId: TAKE_DOWN_TRIP_REQUEST_IDS.offer,
  optionId: 'trip',
}, {
  requestId: TAKE_DOWN_TRIP_REQUEST_IDS.actorSkill,
  optionId: options.actorSkill ?? 'combat',
}, {
  requestId: TAKE_DOWN_TRIP_REQUEST_IDS.targetSkill,
  optionId: options.targetSkill ?? 'combat',
}] as const

const checkDraws = (outcome: 'success' | 'failure' | 'tie'): readonly number[] => (
  outcome === 'success'
    ? [0.999, 0]
    : outcome === 'failure'
      ? [0, 0.999]
      : [0.5, 0.5]
)

describe('Take Down opposed Trip continuation interpreter', () => {
  it('materializes actor- and target-owned server-authored choices without drawing early', () => {
    const offered = execute()
    expect(offered.kind).toBe('pending-request')
    if (offered.kind !== 'pending-request') return
    expect(offered.request).toEqual({
      kind: 'branch-choice',
      responseAuthority: 'recipients',
      operationId: TAKE_DOWN_TRIP_OPERATION_IDS.offer,
      phase: 'after-damage',
      reasonCode: 'take-down.optional-free-action-trip',
      recipientIds: ['actor-token'],
      requestId: TAKE_DOWN_TRIP_REQUEST_IDS.offer,
      promptKey: 'move.take-down.offer-trip',
      options: [{ id: 'trip', labelKey: 'move.take-down.perform-trip' }],
      allowPass: true,
      selectionId: 'take-down.trip-choice',
      scope: 'recipient',
    })
    expect(offered.rollLedger).toEqual([])

    const actor = execute({
      responses: [{ requestId: TAKE_DOWN_TRIP_REQUEST_IDS.offer, optionId: 'trip' }],
    })
    expect(actor.kind).toBe('pending-request')
    if (actor.kind !== 'pending-request') return
    expect(actor.request).toMatchObject({
      kind: 'check-selection',
      role: 'actor',
      recipientIds: ['actor-token'],
      requestId: TAKE_DOWN_TRIP_REQUEST_IDS.actorSkill,
      options: [
        { id: 'combat', labelKey: 'skill.combat' },
        { id: 'acrobatics', labelKey: 'skill.acrobatics' },
      ],
    })
    expect(actor.rollLedger).toEqual([])

    const target = execute({
      responses: [
        { requestId: TAKE_DOWN_TRIP_REQUEST_IDS.offer, optionId: 'trip' },
        { requestId: TAKE_DOWN_TRIP_REQUEST_IDS.actorSkill, optionId: 'acrobatics' },
      ],
    })
    expect(target.kind).toBe('pending-request')
    if (target.kind !== 'pending-request') return
    expect(target.request).toMatchObject({
      kind: 'check-selection',
      role: 'target',
      recipientIds: ['target-token'],
      requestId: TAKE_DOWN_TRIP_REQUEST_IDS.targetSkill,
    })
    expect(target.rollLedger).toEqual([])
    expect(target.sheetReads).toEqual(expect.arrayContaining([
      { kind: 'pokemon', slug: 'actor', revision: 3 },
      { kind: 'pokemon', slug: 'target', revision: 3 },
    ]))
  })

  it('filters an invalid authoritative skill and rejects forged mechanics IDs', () => {
    const actor = execute({
      fixtureOptions: { actorCombatSkill: 'not-a-dice-pool' },
      responses: [{ requestId: TAKE_DOWN_TRIP_REQUEST_IDS.offer, optionId: 'trip' }],
    })
    expect(actor.kind).toBe('pending-request')
    if (actor.kind !== 'pending-request') return
    expect(actor.request.options).toEqual([
      { id: 'acrobatics', labelKey: 'skill.acrobatics' },
    ])

    const target = execute({
      fixtureOptions: { targetCombatSkill: 'not-a-dice-pool' },
      responses: [
        { requestId: TAKE_DOWN_TRIP_REQUEST_IDS.offer, optionId: 'trip' },
        { requestId: TAKE_DOWN_TRIP_REQUEST_IDS.actorSkill, optionId: 'combat' },
      ],
    })
    expect(target.kind).toBe('pending-request')
    if (target.kind !== 'pending-request') return
    expect(target.request.options).toEqual([
      { id: 'acrobatics', labelKey: 'skill.acrobatics' },
    ])

    expect(() => execute({
      responses: [
        { requestId: TAKE_DOWN_TRIP_REQUEST_IDS.offer, optionId: 'trip' },
        { requestId: TAKE_DOWN_TRIP_REQUEST_IDS.actorSkill, optionId: 'athletics' },
      ],
    })).toThrow(/not reviewed/)
  })

  it.each(['success', 'failure', 'tie'] as const)(
    'owns both rolls and emits Tripped only on opposed-check %s',
    (outcome) => {
      const result = execute({
        randomValues: checkDraws(outcome),
        responses: tripResponses(),
      })
      expect(result.kind).toBe('complete')
      if (result.kind !== 'complete') return
      const expected = outcome === 'success' ? 'success' : 'failure'
      expect(result.resolvedChecks).toMatchObject([{
        checkId: TAKE_DOWN_TRIP_OPERATION_IDS.check,
        kind: 'opposed',
        recipientId: 'target-token',
        actor: {
          placementId: 'actor-token',
          source: { kind: 'skill', skill: 'combat' },
        },
        target: {
          placementId: 'target-token',
          source: { kind: 'skill', skill: 'combat' },
        },
        outcome: expected,
        selectedBranchId: expected === 'success'
          ? 'take-down.trip-succeeded'
          : 'take-down.trip-failed',
      }])
      expect(result.rollLedger).toHaveLength(2)
      expect(result.rollLedger.every(roll => roll.parentEffectId === TAKE_DOWN_TRIP_OPERATION_IDS.check))
        .toBe(true)
      expect(operationTrace(result, TAKE_DOWN_TRIP_OPERATION_IDS.condition)).toMatchObject({
        outcome: expected === 'success' ? 'applied' : 'prevented',
        recipientIds: expected === 'success' ? ['target-token'] : [],
      })
    },
  )

  it('passes without a check, roll, or Tripped operation', () => {
    const result = execute({
      responses: [{ requestId: TAKE_DOWN_TRIP_REQUEST_IDS.offer, optionId: null }],
    })
    expect(result.kind).toBe('complete')
    expect(result.resolvedChecks).toEqual([])
    expect(result.rollLedger).toEqual([])
    expect(operationTrace(result, TAKE_DOWN_TRIP_OPERATION_IDS.check)).toMatchObject({
      outcome: 'prevented',
    })
    expect(operationTrace(result, TAKE_DOWN_TRIP_OPERATION_IDS.condition)).toMatchObject({
      outcome: 'prevented',
    })
  })

  it('retains causal ancestry, trace, ledger, and the full read set in a strict suspension', () => {
    const ancestry = [{
      depth: 0,
      resolutionId: 'resolution-parent-trip',
      canonicalId: 'Parent Move',
      definitionHash: 'a'.repeat(64),
      parentOperationId: null,
    }] as const
    const built = buildContext({ resolutionId: 'resolution-take-down-trip' })
    const execution = executeMoveSpec({
      definition,
      context: built.context,
      authoritativeTargetIds: ['target-token'],
      resolutionId: 'resolution-take-down-trip',
      ancestry,
    })
    expect(execution.kind).toBe('pending-request')
    if (execution.kind !== 'pending-request') return

    const materialized = materializeMoveSpecSuspension({
      resolutionId: 'resolution-take-down-trip',
      originOpId: 'op_take_down_trip_fixture',
      definition,
      originMapSlug: built.fixture.map.slug,
      originMapRevision: 0,
      actorPlacementId: 'actor-token',
      suspendedAt: 5_000,
      authoritativeSheetReads: [
        { kind: 'pokemon', slug: 'actor', revision: 3 },
        { kind: 'pokemon', slug: 'target', revision: 3 },
      ],
      execution,
      continuationMapRevision: 1,
      preWindowPlan: createMoveStateChangePlan([]),
    })

    expect(materialized.pendingResolution.causalAncestry).toEqual(ancestry)
    expect(materialized.pendingResolution.trace).toEqual(execution.trace)
    expect(materialized.pendingResolution.rollLedger).toEqual([])
    expect(materialized.pendingResolution.readSet).toEqual([
      { kind: 'map', slug: 'take-down-trip-arena', revision: 1 },
      { kind: 'sheet', sheetKind: 'pokemon', slug: 'actor', revision: 3 },
      { kind: 'sheet', sheetKind: 'pokemon', slug: 'target', revision: 3 },
    ])
    expect(materialized.pendingResolution.outstandingWindows[0]?.ownership).toEqual([
      { kind: 'actor', id: null },
    ])
  })
})

interface Harness {
  readonly database: RotomDatabase
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly inventories: ReturnType<typeof createSqliteGroupInventoryRepository>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly pending: ReturnType<typeof createSqlitePendingMoveResolutionRepository>
  readonly realtime: ReturnType<typeof createSqliteRealtimeEventRepository>
  readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
  readonly random: AuthoritativeMoveRandomSource
  readonly drawCount: () => number
}

const databases: RotomDatabase[] = []
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
})

const persistedSheets = (
  pokemonSheets: ReadonlyMap<string, CharacterSheet>,
  trainerSheets: ReadonlyMap<string, TrainerSheet>,
) => [
  ...[...pokemonSheets].map(([slug, sheet]) => ({
    kind: 'pokemon' as const,
    slug,
    revision: sheet.revision ?? 0,
    updatedAt: 100,
    sheet: { ...deepCloneJson(sheet), slug, updatedAt: 100 },
  })),
  ...[...trainerSheets].map(([slug, sheet]) => ({
    kind: 'trainer' as const,
    slug,
    revision: sheet.revision ?? 0,
    updatedAt: 100,
    sheet: { ...deepCloneJson(sheet), slug, updatedAt: 100 },
  })),
]

const createHarness = (options: {
  readonly fixtureOptions?: TakeDownTripContinuationFixtureOptions
  readonly randomValues?: readonly number[]
} = {}): Harness => {
  const fixture = takeDownTripContinuationFixture(options.fixtureOptions)
  const values = [...(options.randomValues ?? [])]
  let draws = 0
  const random = () => {
    const value = values[draws]
    if (value === undefined) {
      throw new Error(`Trip continuation requested unexpected random draw ${draws + 1}.`)
    }
    draws += 1
    return value
  }
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const inventories = createSqliteGroupInventoryRepository(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => 5_000 })
  const pending = createSqlitePendingMoveResolutionRepository(database)
  const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 5_000 })
  const modes = createSqliteMapInteractionModeRepository(database)
  const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
    readMapInteractionMode: mapSlug => modes.get(mapSlug).interactionMode,
    ...acceptedRealtimeTestHooks([]),
  })
  maps.save({
    slug: fixture.map.slug,
    document: fixture.map,
    revision: fixture.map.revision ?? 0,
    updatedAt: fixture.map.updatedAt ?? 100,
  })
  for (const sheet of persistedSheets(fixture.pokemonSheets, fixture.trainerSheets)) {
    sheets.save({
      kind: sheet.kind,
      slug: sheet.slug,
      document: sheet.sheet,
      revision: sheet.revision,
      updatedAt: sheet.updatedAt,
    })
  }
  return {
    database,
    maps,
    sheets,
    inventories,
    ops,
    pending,
    realtime,
    commandExecutor,
    random,
    drawCount: () => draws,
  }
}

const resolveCommand = (
  map: TabletopMap,
  opId: string,
): ResolveMoveLivePlayCommand => {
  const intent = takeDownTripContinuationFixture({ mapRevision: map.revision ?? 0 }).intent
  const scopes = buildResolveMoveScopes({
    map,
    intent,
    candidateScopePlacementIds: ['target-token'],
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

const declare = (harness: Harness, opId = 'op_take_down_trip_declare') => {
  const map = harness.maps.getBySlug('take-down-trip-arena')!
  const command = resolveCommand(map, opId)
  return executeLivePlayResolveMoveCommandUseCase({
    role: 'gm',
    clientId: 'take-down-trip-client',
    playerProfile: null,
    command,
    expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
  }, {
    database: harness.database,
    mapRepository: harness.maps,
    sheetRepository: harness.sheets,
    groupInventoryRepository: harness.inventories,
    pendingResolutionRepository: harness.pending,
    commandExecutor: harness.commandExecutor,
    planner: input => planAuthoritativeMoveStateExecution({
      ...input,
      runtimeRegistry: fixtureRuntimeRegistry,
    }),
    random: harness.random,
    now: () => 5_000,
  })
}

const currentPending = (harness: Harness) => {
  const stored = harness.pending.listByMap('take-down-trip-arena')
    .find(candidate => candidate.status === 'pending')
  if (!stored) throw new Error('Expected one pending Take Down Trip resolution.')
  return stored
}

const responseCommand = (input: {
  readonly harness: Harness
  readonly opId: string
  readonly optionId?: string
  readonly pass?: boolean
  readonly profileId?: PlayerProfileId
}): MoveResponseCommand => {
  const stored = currentPending(input.harness)
  const map = input.harness.maps.getBySlug('take-down-trip-arena')!
  const windowId = stored.resolution.outstandingWindows[0]!.windowId
  const common = {
    schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
    opId: input.opId,
    mapSlug: map.slug,
    baseRevision: map.revision ?? 0,
    ...(input.profileId ? { profileId: input.profileId } : {}),
  }
  return input.pass
    ? {
        ...common,
        type: MOVE_RESPONSE_COMMAND_TYPES.PASS,
        payload: { resolutionId: stored.resolutionId, windowId },
      }
    : {
        ...common,
        type: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
        payload: {
          resolutionId: stored.resolutionId,
          windowId,
          optionId: input.optionId!,
        },
      }
}

const gmAuthorization: ResumePendingMoveResolutionInput['authorization'] = {
  source: 'gm-authority',
  chosenBy: { kind: 'gm', id: null },
}

const parsedResponse = (harness: Harness, command: MoveResponseCommand) => (
  parsePendingMoveResponseCommand(command, {
    pendingResolutionRepository: harness.pending,
  })
)

const invokeResponse = (
  harness: Harness,
  parsed: ReturnType<typeof parsedResponse>,
) => resumePendingMoveResolutionUseCase({
  ...parsed,
  role: 'gm',
  playerProfile: null,
  authorization: gmAuthorization,
  clientId: 'take-down-trip-response-client',
}, {
  database: harness.database,
  mapRepository: harness.maps,
  sheetRepository: harness.sheets,
  groupInventoryRepository: harness.inventories,
  pendingResolutionRepository: harness.pending,
  opRepository: harness.ops,
  realtimeEventRepository: harness.realtime,
  runtimeRegistry: fixtureRuntimeRegistry,
  random: harness.random,
  now: () => 5_000,
  publishPersistedRealtimeEvent: vi.fn(),
})

const choose = (harness: Harness, opId: string, optionId: string) => {
  const parsed = parsedResponse(harness, responseCommand({ harness, opId, optionId }))
  return { parsed, invoke: () => invokeResponse(harness, parsed) }
}

const pass = (harness: Harness, opId: string) => {
  const parsed = parsedResponse(harness, responseCommand({ harness, opId, pass: true }))
  return { parsed, invoke: () => invokeResponse(harness, parsed) }
}

const currentConditions = (harness: Harness): readonly string[] => {
  const combat = harness.sheets.getByRef('pokemon', 'target')?.sheet.combat as {
    readonly conditions?: unknown
  } | undefined
  return Array.isArray(combat?.conditions) ? combat.conditions as string[] : []
}

const moveUses = (harness: Harness): number => (
  harness.maps.getBySlug('take-down-trip-arena')?.moveUsage
    ?.byPlacementId['actor-token']?.['take-down']?.uses
  ?? 0
)

const completeTripChoices = (harness: Harness) => {
  choose(harness, 'op_trip_accept', 'trip').invoke()
  choose(harness, 'op_trip_actor_skill', 'combat').invoke()
}

const profile = (id: string, slug: string): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: id as PlayerProfileId,
  displayName: id.slice('profile_'.length) as PlayerProfileDisplayName,
  linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: slug }],
})
const actorProfile = profile('profile_tripactor', 'actor')
const targetProfile = profile('profile_triptarget', 'target')
const outsiderProfile = profile('profile_tripother1', 'other')

const accessDependencies = (harness: Harness) => ({
  database: harness.database,
  mapRepository: harness.maps,
  sheetRepository: harness.sheets,
})

const readIdentities = (resolution: PendingMoveResolution) => resolution.readSet.map(read => (
  read.kind === 'sheet'
    ? `${read.kind}:${read.sheetKind}:${read.slug}:${read.revision}`
    : `${read.kind}:${read.slug}:${read.revision}`
))

describe('Take Down opposed Trip durable resume', () => {
  it('passes the continuation once without Tripped or random draws', async () => {
    const harness = createHarness()
    const declaration = await declare(harness)
    expect(isPendingMoveDeclarationResult(declaration.result)).toBe(true)

    const response = pass(harness, 'op_trip_pass')
    const accepted = response.invoke()
    const duplicate = response.invoke()

    expect(accepted.result).toMatchObject({ ok: true, previousRevision: 1, revision: 2 })
    expect(duplicate.result).toEqual(accepted.result)
    expect(currentConditions(harness)).not.toContain('Tripped')
    expect(moveUses(harness)).toBe(1)
    expect(harness.drawCount()).toBe(0)
    expect(harness.pending.listByMap('take-down-trip-arena')[0]).toMatchObject({
      status: 'committed',
      terminalOpId: 'op_trip_pass',
      resolution: {
        chosenOptions: [{ windowId: TAKE_DOWN_TRIP_REQUEST_IDS.offer, optionId: null }],
        rollLedger: [],
      },
    })
  })

  it.each(['success', 'failure', 'tie'] as const)(
    'resumes both skill choices and commits check %s exactly once',
    async (outcome) => {
      const harness = createHarness({ randomValues: checkDraws(outcome) })
      const declaration = await declare(harness, `op_trip_${outcome}_declare`)
      if (!isPendingMoveDeclarationResult(declaration.result)) {
        throw new Error('Trip fixture did not suspend.')
      }
      const initial = currentPending(harness).resolution
      const initialTrace = initial.trace.events
      const initialReads = readIdentities(initial).filter(read => !read.startsWith('map:'))

      choose(harness, `op_trip_${outcome}_accept`, 'trip').invoke()
      const actorWindow = currentPending(harness).resolution
      expect(actorWindow.outstandingWindows[0]).toMatchObject({
        windowId: TAKE_DOWN_TRIP_REQUEST_IDS.actorSkill,
        ownership: [{ kind: 'actor', id: null }],
      })
      expect(actorWindow.trace.events.slice(0, initialTrace.length - 2))
        .toEqual(initialTrace.slice(0, initialTrace.length - 2))
      expect(actorWindow.rollLedger).toEqual([])
      expect(readIdentities(actorWindow).filter(read => !read.startsWith('map:')))
        .toEqual(initialReads)

      choose(harness, `op_trip_${outcome}_actor`, 'combat').invoke()
      const targetWindow = currentPending(harness).resolution
      expect(targetWindow.outstandingWindows[0]).toMatchObject({
        windowId: TAKE_DOWN_TRIP_REQUEST_IDS.targetSkill,
        ownership: [{ kind: 'target', id: 'target-token' }],
      })
      expect(targetWindow.chosenOptions.map(choice => choice.optionId)).toEqual(['trip', 'combat'])
      expect(targetWindow.rollLedger).toEqual([])

      const final = choose(harness, `op_trip_${outcome}_target`, 'combat')
      const accepted = final.invoke()
      const draws = harness.drawCount()
      const duplicate = final.invoke()
      const terminal = harness.pending.listByMap('take-down-trip-arena')[0]!.resolution

      expect(accepted.result).toMatchObject({ ok: true })
      expect(duplicate.result).toEqual(accepted.result)
      expect(harness.drawCount()).toBe(draws)
      expect(draws).toBe(2)
      expect(terminal.rollLedger).toHaveLength(2)
      expect(terminal.chosenOptions.map(choice => choice.optionId)).toEqual([
        'trip',
        'combat',
        'combat',
      ])
      expect(currentConditions(harness).includes('Tripped')).toBe(outcome === 'success')
      expect(moveUses(harness)).toBe(1)
    },
  )

  it('restores each current window after reconnect and redacts it from an outsider', async () => {
    const harness = createHarness()
    await declare(harness, 'op_trip_reconnect_declare')

    const listed = () => listPendingMoveResponsesUseCase({
      role: 'gm',
      mapSlug: 'take-down-trip-arena',
      playerProfile: null,
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
    })
    expect(listed().windows[0]?.window.windowId).toBe(TAKE_DOWN_TRIP_REQUEST_IDS.offer)

    choose(harness, 'op_trip_reconnect_accept', 'trip').invoke()
    expect(listed().windows[0]?.window.windowId).toBe(TAKE_DOWN_TRIP_REQUEST_IDS.actorSkill)

    choose(harness, 'op_trip_reconnect_actor', 'acrobatics').invoke()
    expect(listed().windows[0]?.window.windowId).toBe(TAKE_DOWN_TRIP_REQUEST_IDS.targetSkill)
    expect(harness.drawCount()).toBe(0)

    expect(listPendingMoveResponsesUseCase({
      role: 'player',
      mapSlug: 'take-down-trip-arena',
      playerProfile: outsiderProfile,
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
    }).windows).toEqual([])
  })

  it('rejects forged and unauthorized responses before any operation', async () => {
    const harness = createHarness()
    await declare(harness, 'op_trip_authority_declare')
    const beforeMap = deepCloneJson(harness.maps.getBySlug('take-down-trip-arena'))
    const beforePending = deepCloneJson(currentPending(harness))

    expect(() => parsedResponse(harness, responseCommand({
      harness,
      opId: 'op_trip_forged',
      optionId: 'client-authored-athletics-roll-plus-99',
    }))).toThrowError(expect.objectContaining({
      code: 'unknown-option',
    } satisfies Partial<MoveResponseCommandParserError>))

    const clientMechanics = responseCommand({
      harness,
      opId: 'op_trip_client_mechanics',
      optionId: 'trip',
    })
    expect(() => parsePendingMoveResponseCommand({
      ...clientMechanics,
      payload: {
        ...clientMechanics.payload,
        roll: 20,
        modifier: 99,
      },
    }, {
      pendingResolutionRepository: harness.pending,
    })).toThrowError(expect.objectContaining({
      code: 'invalid-command',
    } satisfies Partial<MoveResponseCommandParserError>))

    const unauthorized = responseCommand({
      harness,
      opId: 'op_trip_unauthorized',
      optionId: 'trip',
      profileId: targetProfile.id,
    })
    expect(() => parsePendingMoveResponseCommand(unauthorized, {
      pendingResolutionRepository: harness.pending,
      authorize: ({ command, storedResolution, window }) => {
        authorizePendingMoveResponseWindow({
          role: 'player',
          command,
          playerProfile: targetProfile,
          storedResolution,
          window,
        }, accessDependencies(harness))
      },
    })).toThrowError(PendingMoveResponseAccessError)

    expect(harness.maps.getBySlug('take-down-trip-arena')).toEqual(beforeMap)
    expect(currentPending(harness)).toEqual(beforePending)
    expect(currentConditions(harness)).toEqual([])
    expect(harness.drawCount()).toBe(0)
    expect(harness.ops.getStoredOpRecord('take-down-trip-arena', 'op_trip_forged')).toBeNull()
    expect(harness.ops.getStoredOpRecord('take-down-trip-arena', 'op_trip_client_mechanics')).toBeNull()
    expect(harness.ops.getStoredOpRecord('take-down-trip-arena', 'op_trip_unauthorized')).toBeNull()
  })

  it('authorizes the actor skill only to the actor and the target skill only to the target', async () => {
    const harness = createHarness()
    await declare(harness, 'op_trip_owner_declare')
    choose(harness, 'op_trip_owner_accept', 'trip').invoke()

    const authorize = (selected: PlayerProfile, command: MoveResponseCommand) => {
      let grant: ReturnType<typeof authorizePendingMoveResponseWindow> | null = null
      parsePendingMoveResponseCommand(command, {
        pendingResolutionRepository: harness.pending,
        authorize: ({ storedResolution, window }) => {
          grant = authorizePendingMoveResponseWindow({
            role: 'player',
            command,
            playerProfile: selected,
            storedResolution,
            window,
          }, accessDependencies(harness))
        },
      })
      return grant
    }

    const actorCommand = responseCommand({
      harness,
      opId: 'op_trip_owner_actor',
      optionId: 'combat',
      profileId: actorProfile.id,
    })
    expect(authorize(actorProfile, actorCommand)).toMatchObject({
      chosenBy: { kind: 'actor', id: null },
    })
    expect(() => authorize(targetProfile, {
      ...actorCommand,
      profileId: targetProfile.id,
    })).toThrowError(PendingMoveResponseAccessError)

    choose(harness, 'op_trip_owner_actor_gm', 'combat').invoke()
    const targetCommand = responseCommand({
      harness,
      opId: 'op_trip_owner_target',
      optionId: 'combat',
      profileId: targetProfile.id,
    })
    expect(authorize(targetProfile, targetCommand)).toMatchObject({
      chosenBy: { kind: 'target', id: 'target-token' },
    })
    expect(() => authorize(actorProfile, {
      ...targetCommand,
      profileId: actorProfile.id,
    })).toThrowError(PendingMoveResponseAccessError)
  })

  it('conflicts a stale relevant skill read without rolls, usage, or Tripped', async () => {
    const harness = createHarness({ randomValues: checkDraws('success') })
    await declare(harness, 'op_trip_stale_declare')
    completeTripChoices(harness)
    const stale = choose(harness, 'op_trip_stale_target', 'combat')
    const target = harness.sheets.getByRef('pokemon', 'target')!
    expect(harness.sheets.applyLivePlayUpdate({
      kind: 'pokemon',
      slug: target.slug,
      expectedRevision: target.revision,
      nextSheet: {
        ...target.sheet,
        skills: { combat: 'not-a-dice-pool', acrobatics: '1d6' },
      },
    })).toBe('applied')

    const result = stale.invoke()
    expect(result.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(currentConditions(harness)).toEqual([])
    expect(moveUses(harness)).toBe(0)
    expect(harness.drawCount()).toBe(0)
    expect(harness.pending.listByMap('take-down-trip-arena')[0]).toMatchObject({
      status: 'conflicted',
      terminalOpId: 'op_trip_stale_target',
    })
  })
})
