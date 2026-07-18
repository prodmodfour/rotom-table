import { afterEach, describe, expect, it, vi } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  isPendingMoveDeclarationResult,
} from '#shared/moveAutomation/pendingResolution'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  type MoveResponseCommand,
} from '#shared/moveAutomation/responseCommands'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { deepCloneJson } from '~/utils/serialization'
import {
  TAKE_DOWN_V2_SEMANTIC_SCENARIOS,
  takeDownV2Fixture,
  type TakeDownV2FixtureOptions,
} from '../fixtures/moveAutomation/takeDownV2'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import { executeMoveSpec } from '~~/server/domain/moveAutomation/executeSpec'
import {
  createFiniteAuthoritativeMoveRandomStream,
  type AuthoritativeMoveRandomSource,
} from '~~/server/domain/moveAutomation/random'
import {
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
  registeredMoveAutomationRuntimeFor,
} from '~~/server/domain/moveAutomation/registry'
import { TAKE_DOWN_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/takeDown'
import {
  TAKE_DOWN_BASE_DAMAGE_BASE,
  TAKE_DOWN_RECKLESS_DAMAGE_BASE_BONUS,
} from '~~/server/domain/moveAutomation/handlers/takeDown'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '~~/server/domain/planAuthoritativeMoveState'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqlitePendingMoveResolutionRepository } from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { executeLivePlayResolveMoveCommandUseCase } from '~~/server/useCases/applyResolveMoveCommand'
import {
  resumePendingMoveResolutionUseCase,
  type ResumePendingMoveResolutionInput,
} from '~~/server/useCases/resumePendingMoveResolution'
import { listPendingMoveResponsesUseCase } from '~~/server/useCases/listPendingMoveResponses'
import { parsePendingMoveResponseCommand } from '~~/server/livePlay/moveResponseCommandParser'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const takeDownRow = manifestJson.moves.find(row => row.canonicalId === 'Take Down')!
const runtime = registeredMoveAutomationRuntimeFor('Take Down')
if (!runtime || runtime.kind !== 'movespec-v2') {
  throw new Error('Take Down native runtime was not selected.')
}

const buildContext = (options: {
  readonly fixtureOptions?: TakeDownV2FixtureOptions
  readonly randomValues: readonly number[]
}) => {
  const fixture = takeDownV2Fixture(options.fixtureOptions)
  return {
    fixture,
    context: buildAuthoritativeMoveRulesContext({
      map: fixture.map,
      pokemonSheets: fixture.pokemonSheets,
      trainerSheets: fixture.trainerSheets,
      intent: fixture.intent,
      candidatePlacementIds: ['target-token'],
      selectedPlacementIds: ['target-token'],
      random: createFiniteAuthoritativeMoveRandomStream(options.randomValues),
      time: 5_000,
      resolutionId: 'resolution-take-down-test',
    }),
  }
}

const execute = (options: {
  readonly fixtureOptions?: TakeDownV2FixtureOptions
  readonly randomValues?: readonly number[]
  readonly responses?: readonly { readonly requestId: string; readonly optionId: string | null }[]
}) => {
  const built = buildContext({
    fixtureOptions: options.fixtureOptions,
    randomValues: options.randomValues ?? [0.45, 0, 0, 0.999, 0],
  })
  return executeMoveSpec({
    definition: runtime.definition,
    context: built.context,
    authoritativeTargetIds: ['target-token'],
    resolutionId: 'resolution-take-down-test',
    responses: options.responses,
  })
}

const operation = (
  result: ReturnType<typeof executeMoveSpec>,
  operationId: string,
) => result.trace.events.find(event => (
  event.kind === 'operation' && event.operationId === operationId
))

const tripResponses = (options: {
  readonly actorSkill?: 'combat' | 'acrobatics'
  readonly targetSkill?: 'combat' | 'acrobatics'
} = {}) => [{
  requestId: 'take-down.trip-offer',
  optionId: 'trip',
}, {
  requestId: 'take-down.trip-actor-skill',
  optionId: options.actorSkill ?? 'combat',
}, {
  requestId: 'take-down.trip-target-skill',
  optionId: options.targetSkill ?? 'combat',
}] as const

const checkRollValues = (outcome: 'success' | 'failure' | 'tie'): readonly number[] => {
  const compared = outcome === 'success'
    ? [0.999, 0]
    : outcome === 'failure'
      ? [0, 0.999]
      : [0.5, 0.5]
  // Accuracy plus the DB 9 2d10 damage roll precede the two 1d6 skill rolls.
  return [0.45, 0, 0, ...compared]
}

describe('Take Down native MoveSpec v2', () => {
  it('selects the complete reviewed runtime, handler hash, and semantic evidence', () => {
    expect(takeDownRow).toMatchObject({
      baseStatus: 'complete',
      runtime: {
        kind: 'movespec-v2',
        version: 2,
        definitionHash: '8823eed10de8477a553498d302a57f01a558920020ad12a66d250e83a56829a2',
        sourceModule: 'server/domain/moveAutomation/specs/takeDown.ts',
      },
      blockerCodes: [],
      limitations: [],
      manualSteps: [],
    })
    expect(takeDownRow.scenarioIds).toEqual(
      TAKE_DOWN_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(runtime).toMatchObject({
      definition: {
        spec: TAKE_DOWN_MOVE_SPEC,
        registeredHandler: {
          id: 'take-down.contextual-damage',
          version: 1,
        },
      },
      definitionHash: takeDownRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Take Down' }),
    )
  })

  it('opens only an actor-owned optional Trip after a non-immune damaging hit', () => {
    const hit = execute({})
    expect(hit.kind).toBe('pending-request')
    if (hit.kind !== 'pending-request') return
    expect(hit.request).toEqual({
      kind: 'branch-choice',
      operationId: 'take-down.trip-offer',
      phase: 'after-damage',
      reasonCode: 'take-down.optional-free-action-trip',
      recipientIds: ['actor-token'],
      requestId: 'take-down.trip-offer',
      promptKey: 'move.take-down.offer-trip',
      options: [{ id: 'trip', labelKey: 'move.take-down.perform-trip' }],
      allowPass: true,
      selectionId: 'take-down.trip-choice',
      scope: 'recipient',
    })
    expect(hit.damagedTargetIds).toEqual(['target-token'])
    expect(hit.preWindowOperations).toEqual([])
    expect(hit.deferredContinuation.operations.map(entry => entry.operation.id)).toEqual([
      'take-down.accuracy',
      'take-down.damage',
      'take-down.recoil',
    ])

    for (const [label, result] of [
      ['miss', execute({ randomValues: [0] })],
      ['immunity', execute({
        fixtureOptions: { targetTypes: ['Ghost'] },
        randomValues: [0.45, 0, 0],
      })],
    ] as const) {
      expect(result.kind, label).toBe('complete')
      expect(result.damagedTargetIds, label).toEqual([])
      expect(result.resolvedChecks, label).toEqual([])
      expect(operation(result, 'take-down.trip-offer'), label).toMatchObject({
        outcome: 'no-op',
        recipientIds: [],
      })
      expect(operation(result, 'take-down.apply-tripped'), label).toMatchObject({
        outcome: 'prevented',
      })
    }
  })

  it('persists actor and target skill selections in order without drawing early randomness', () => {
    const offered = execute({})
    expect(offered.kind).toBe('pending-request')

    const actorChoice = execute({
      responses: [{ requestId: 'take-down.trip-offer', optionId: 'trip' }],
    })
    expect(actorChoice.kind).toBe('pending-request')
    if (actorChoice.kind !== 'pending-request') return
    expect(actorChoice.request).toMatchObject({
      kind: 'check-selection',
      role: 'actor',
      recipientIds: ['actor-token'],
      requestId: 'take-down.trip-actor-skill',
      options: [
        { id: 'combat', labelKey: 'skill.combat' },
        { id: 'acrobatics', labelKey: 'skill.acrobatics' },
      ],
    })
    expect(actorChoice.rollLedger).toHaveLength(2)

    const targetChoice = execute({
      responses: [
        { requestId: 'take-down.trip-offer', optionId: 'trip' },
        { requestId: 'take-down.trip-actor-skill', optionId: 'acrobatics' },
      ],
    })
    expect(targetChoice.kind).toBe('pending-request')
    if (targetChoice.kind !== 'pending-request') return
    expect(targetChoice.request).toMatchObject({
      kind: 'check-selection',
      role: 'target',
      recipientIds: ['target-token'],
      requestId: 'take-down.trip-target-skill',
      options: [
        { id: 'combat', labelKey: 'skill.combat' },
        { id: 'acrobatics', labelKey: 'skill.acrobatics' },
      ],
    })
    expect(targetChoice.rollLedger).toHaveLength(2)
  })

  it.each(['success', 'failure', 'tie'] as const)(
    'owns opposed rolls and applies Tripped only for check %s',
    (outcome) => {
      const result = execute({
        randomValues: checkRollValues(outcome),
        responses: tripResponses({ actorSkill: 'acrobatics', targetSkill: 'combat' }),
      })
      expect(result.kind).toBe('complete')
      if (result.kind !== 'complete') return
      const expectedOutcome = outcome === 'success' ? 'success' : 'failure'
      expect(result.resolvedChecks).toMatchObject([{
        checkId: 'take-down.trip-check',
        kind: 'opposed',
        recipientId: 'target-token',
        actor: {
          placementId: 'actor-token',
          source: { kind: 'skill', skill: 'acrobatics' },
        },
        target: {
          placementId: 'target-token',
          source: { kind: 'skill', skill: 'combat' },
        },
        outcome: expectedOutcome,
        selectedBranchId: expectedOutcome === 'success'
          ? 'take-down.trip-succeeded'
          : 'take-down.trip-failed',
      }])
      expect(result.rollLedger).toHaveLength(4)
      expect(operation(result, 'take-down.apply-tripped')).toMatchObject({
        outcome: expectedOutcome === 'success' ? 'applied' : 'prevented',
        recipientIds: expectedOutcome === 'success' ? ['target-token'] : [],
      })
    },
  )

  it('passes the optional branch without rolling a check or emitting Tripped', () => {
    const result = execute({
      randomValues: [0.45, 0, 0],
      responses: [{ requestId: 'take-down.trip-offer', optionId: null }],
    })
    expect(result.kind).toBe('complete')
    expect(result.resolvedChecks).toEqual([])
    expect(result.rollLedger).toHaveLength(2)
    expect(result.branchSelections).toContainEqual(expect.objectContaining({
      selectionId: 'take-down.trip-choice',
      decisions: [expect.objectContaining({
        branchId: 'take-down.trip-pass',
        reasonCode: 'branch-choice-passed',
      })],
    }))
    expect(operation(result, 'take-down.trip-check')).toMatchObject({ outcome: 'prevented' })
    expect(operation(result, 'take-down.trip-result')).toMatchObject({ outcome: 'prevented' })
    expect(operation(result, 'take-down.apply-tripped')).toMatchObject({ outcome: 'prevented' })
  })

  it('applies Reckless DB +3 and traces Rock Head or Magic Guard recoil prevention', () => {
    const reckless = execute({
      fixtureOptions: { actorAbilities: [{ name: 'Reckless' }] },
      randomValues: [0.45, 0, 0, 0],
    })
    expect(reckless.kind).toBe('pending-request')
    expect(operation(reckless, 'take-down.damage')).toMatchObject({
      input: {
        damageBase: TAKE_DOWN_BASE_DAMAGE_BASE + TAKE_DOWN_RECKLESS_DAMAGE_BASE_BONUS,
      },
    })
    expect(reckless.trace.events).toContainEqual(expect.objectContaining({
      kind: 'predicate',
      predicateId: 'take-down.reckless-damage-base',
      outcome: true,
      reasonCode: 'take-down.reckless-applied',
    }))

    for (const ability of ['Rock Head', 'Magic Guard'] as const) {
      const result = execute({
        fixtureOptions: { actorAbilities: [{ name: ability }] },
        randomValues: [0.45, 0, 0],
        responses: [{ requestId: 'take-down.trip-offer', optionId: null }],
      })
      expect(result.kind).toBe('complete')
      // Interpreter evidence remains non-mutating; reducer-level prevention is
      // asserted through the planner and accepted saga below.
      expect(result.trace.events).toContainEqual(expect.objectContaining({
        kind: 'predicate',
        predicateId: 'take-down.reckless-damage-base',
        outcome: false,
      }))
    }
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
  readonly published: unknown[]
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
  readonly fixtureOptions?: TakeDownV2FixtureOptions
  readonly randomValues?: readonly number[]
} = {}): Harness => {
  const fixture = takeDownV2Fixture(options.fixtureOptions)
  const values = [...(options.randomValues ?? [0.45, 0, 0, 0.999, 0])]
  let draws = 0
  const random = () => {
    const value = values[draws]
    if (value === undefined) throw new Error(`Take Down requested unexpected random draw ${draws + 1}.`)
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
  const published: unknown[] = []
  const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
    readMapInteractionMode: mapSlug => modes.get(mapSlug).interactionMode,
    ...acceptedRealtimeTestHooks(published),
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
    published,
  }
}

const resolveCommand = (
  map: TabletopMap,
  opId: string,
): ResolveMoveLivePlayCommand => {
  const intent = takeDownV2Fixture({ mapRevision: map.revision ?? 0 }).intent
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

const invokeDeclaration = (
  harness: Harness,
  command: ResolveMoveLivePlayCommand,
) => executeLivePlayResolveMoveCommandUseCase({
  role: 'gm',
  clientId: 'take-down-client',
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
  planner: input => planAuthoritativeMoveStateExecution(input),
  random: harness.random,
  now: () => 5_000,
})

const declare = (harness: Harness, opId = 'op_take_down_declare') => {
  const map = harness.maps.getBySlug('take-down-arena')!
  return invokeDeclaration(harness, resolveCommand(map, opId))
}

const responseCommand = (input: {
  readonly resolutionId: string
  readonly windowId: string
  readonly baseRevision: number
  readonly opId: string
  readonly optionId?: string
  readonly pass?: boolean
}): MoveResponseCommand => input.pass
  ? {
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'take-down-arena',
      baseRevision: input.baseRevision,
      type: MOVE_RESPONSE_COMMAND_TYPES.PASS,
      payload: {
        resolutionId: input.resolutionId,
        windowId: input.windowId,
      },
    }
  : {
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'take-down-arena',
      baseRevision: input.baseRevision,
      type: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
      payload: {
        resolutionId: input.resolutionId,
        windowId: input.windowId,
        optionId: input.optionId!,
      },
    }

const gmAuthorization: ResumePendingMoveResolutionInput['authorization'] = {
  source: 'gm-authority',
  chosenBy: { kind: 'gm', id: null },
}

const respond = (harness: Harness, command: MoveResponseCommand) => {
  const parsed = parsePendingMoveResponseCommand(command, {
    pendingResolutionRepository: harness.pending,
  })
  const invoke = () => resumePendingMoveResolutionUseCase({
    ...parsed,
    role: 'gm',
    playerProfile: null,
    authorization: gmAuthorization,
    clientId: 'take-down-response-client',
  }, {
    database: harness.database,
    mapRepository: harness.maps,
    sheetRepository: harness.sheets,
    groupInventoryRepository: harness.inventories,
    pendingResolutionRepository: harness.pending,
    opRepository: harness.ops,
    realtimeEventRepository: harness.realtime,
    random: harness.random,
    now: () => 5_000,
    publishPersistedRealtimeEvent: vi.fn(),
  })
  return { parsed, invoke }
}

const currentPending = (harness: Harness) => {
  const stored = harness.pending.listByMap('take-down-arena')
    .find(candidate => candidate.status === 'pending')
  if (!stored) throw new Error('Expected one pending Take Down resolution.')
  return stored
}

const chooseCurrent = (input: {
  readonly harness: Harness
  readonly opId: string
  readonly optionId: string
}) => {
  const stored = currentPending(input.harness)
  const window = stored.resolution.outstandingWindows[0]!
  const map = input.harness.maps.getBySlug('take-down-arena')!
  return respond(input.harness, responseCommand({
    resolutionId: stored.resolutionId,
    windowId: window.windowId,
    baseRevision: map.revision ?? 0,
    opId: input.opId,
    optionId: input.optionId,
  }))
}

const passCurrent = (input: { readonly harness: Harness; readonly opId: string }) => {
  const stored = currentPending(input.harness)
  const window = stored.resolution.outstandingWindows[0]!
  const map = input.harness.maps.getBySlug('take-down-arena')!
  return respond(input.harness, responseCommand({
    resolutionId: stored.resolutionId,
    windowId: window.windowId,
    baseRevision: map.revision ?? 0,
    opId: input.opId,
    pass: true,
  }))
}

const completeOpposedTrip = (input: {
  readonly harness: Harness
  readonly opPrefix: string
  readonly actorSkill?: 'combat' | 'acrobatics'
  readonly targetSkill?: 'combat' | 'acrobatics'
}) => {
  chooseCurrent({
    harness: input.harness,
    opId: `${input.opPrefix}_accept`,
    optionId: 'trip',
  }).invoke()
  chooseCurrent({
    harness: input.harness,
    opId: `${input.opPrefix}_actor`,
    optionId: input.actorSkill ?? 'combat',
  }).invoke()
  return chooseCurrent({
    harness: input.harness,
    opId: `${input.opPrefix}_target`,
    optionId: input.targetSkill ?? 'combat',
  })
}

const currentHp = (harness: Harness, slug: string): number => {
  const stored = harness.sheets.getByRef('pokemon', slug)
  const combat = stored?.sheet.combat as { readonly currentHp?: unknown } | undefined
  if (typeof combat?.currentHp !== 'number') throw new Error(`Missing HP for ${slug}.`)
  return combat.currentHp
}

const currentConditions = (harness: Harness, slug: string): readonly string[] => {
  const stored = harness.sheets.getByRef('pokemon', slug)
  const combat = stored?.sheet.combat as { readonly conditions?: unknown } | undefined
  return Array.isArray(combat?.conditions) ? combat.conditions as string[] : []
}

const moveUses = (harness: Harness): number => (
  harness.maps.getBySlug('take-down-arena')?.moveUsage
    ?.byPlacementId['actor-token']?.['take-down']?.uses
  ?? 0
)

const terminalAuditEvents = (harness: Harness) => (
  harness.pending.listByMap('take-down-arena')[0]?.resolution.trace.events ?? []
)

describe('Take Down planner and accepted durable saga', () => {
  it('plans miss and immunity immediately without opening Trip or applying recoil', () => {
    for (const entry of [
      { label: 'miss', fixtureOptions: {}, randomValues: [0] },
      { label: 'immunity', fixtureOptions: { targetTypes: ['Ghost'] }, randomValues: [0.45, 0, 0] },
    ] as const) {
      const fixture = takeDownV2Fixture(entry.fixtureOptions)
      const plan = planAuthoritativeMoveStateExecution({
        ...fixture,
        random: createFiniteAuthoritativeMoveRandomStream(entry.randomValues),
        now: () => 5_000,
        operationId: `op_take_down_${entry.label}`,
      })
      expect(isAuthoritativePendingMoveStatePlan(plan), entry.label).toBe(false)
      if (isAuthoritativePendingMoveStatePlan(plan)) continue
      expect(plan.resolution.transaction.conditionUpdates, entry.label).toEqual([])
      expect(plan.resolution.transaction.hpUpdates, entry.label).toEqual([])
      expect(plan.resolution.auditTrace.events, entry.label).toContainEqual(
        expect.objectContaining({
          kind: 'operation',
          operationId: 'take-down.trip-offer',
          outcome: 'no-op',
        }),
      )
      expect(plan.nextMap.encounterState?.turnResources['actor-token']?.actions.standard.spent)
        .toBe(1)
      expect(plan.usage.uses).toBe(1)
    }
  })

  it.each([
    {
      scenario: 'miss',
      fixtureOptions: {},
      randomValues: [0],
      hitTargetIds: [],
    },
    {
      scenario: 'immunity',
      fixtureOptions: { targetTypes: ['Ghost'] },
      randomValues: [0.45, 0, 0],
      hitTargetIds: ['target-token'],
    },
  ] as const)(
    'commits the immediate $scenario branch without opening Trip',
    async ({ scenario, fixtureOptions, randomValues, hitTargetIds }) => {
      const harness = createHarness({ fixtureOptions, randomValues })
      const response = await declare(harness, `op_take_down_${scenario}_accepted`)

      expect(response.result).toMatchObject({ ok: true, previousRevision: 0, revision: 1 })
      expect(isPendingMoveDeclarationResult(response.result)).toBe(false)
      expect(response.move?.transaction).toMatchObject({
        attackedTargetIds: ['target-token'],
        hitTargetIds,
        hpUpdates: [],
        conditionUpdates: [],
      })
      expect(currentHp(harness, 'actor')).toBe(100)
      expect(currentHp(harness, 'target')).toBe(100)
      expect(moveUses(harness)).toBe(1)
      expect(harness.maps.getBySlug('take-down-arena')?.encounterState
        ?.turnResources['actor-token']?.actions.standard.spent).toBe(1)
      expect(harness.pending.listByMap('take-down-arena')).toEqual([])
      expect(harness.drawCount()).toBe(randomValues.length)
    },
  )

  it('rejects Stuck Dash legality and unavailable Standard cost before mutation', async () => {
    const stuck = takeDownV2Fixture({ actorConditions: ['Stuck'] })
    expect(() => planAuthoritativeMoveStateExecution({
      ...stuck,
      random: () => { throw new Error('Stuck Take Down must not roll.') },
      operationId: 'op_take_down_stuck',
    })).toThrowError(expect.objectContaining({
      code: 'execution-rejected',
    }))

    const stuckHarness = createHarness({
      fixtureOptions: { actorConditions: ['Stuck'] },
      randomValues: [],
    })
    const stuckMap = deepCloneJson(stuckHarness.maps.getBySlug('take-down-arena'))
    const stuckSheets = deepCloneJson(stuckHarness.sheets.list())
    const stuckRejected = await declare(stuckHarness, 'op_take_down_stuck_command')
    expect(stuckRejected.result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(stuckHarness.maps.getBySlug('take-down-arena')).toEqual(stuckMap)
    expect(stuckHarness.sheets.list()).toEqual(stuckSheets)
    expect(stuckHarness.pending.listByMap('take-down-arena')).toEqual([])
    expect(stuckHarness.drawCount()).toBe(0)

    const harness = createHarness({
      fixtureOptions: { encounterStandardSpent: 1 },
      randomValues: [],
    })
    const beforeMap = deepCloneJson(harness.maps.getBySlug('take-down-arena'))
    const beforeSheets = deepCloneJson(harness.sheets.list())
    const rejected = await declare(harness, 'op_take_down_no_standard')
    expect(rejected.result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(harness.maps.getBySlug('take-down-arena')).toEqual(beforeMap)
    expect(harness.sheets.list()).toEqual(beforeSheets)
    expect(harness.pending.listByMap('take-down-arena')).toEqual([])
    expect(harness.drawCount()).toBe(0)
  })

  it('replays an exact duplicate declaration without rerolling, spending, or reopening Trip', async () => {
    const harness = createHarness()
    const initialMap = harness.maps.getBySlug('take-down-arena')!
    const command = resolveCommand(initialMap, 'op_take_down_duplicate_declare')

    const first = await invokeDeclaration(harness, command)
    const drawsAfterFirst = harness.drawCount()
    const duplicate = await invokeDeclaration(harness, command)

    expect(isPendingMoveDeclarationResult(first.result)).toBe(true)
    expect(duplicate.result).toEqual(first.result)
    expect(duplicate.map).toEqual(first.map)
    expect(drawsAfterFirst).toBe(3)
    expect(harness.drawCount()).toBe(drawsAfterFirst)
    expect(harness.maps.getBySlug('take-down-arena')).toMatchObject({
      revision: 1,
      encounterState: {
        turnResources: {
          'actor-token': { actions: { standard: { spent: 1 } } },
        },
      },
    })
    expect(harness.pending.listByMap('take-down-arena')).toHaveLength(1)
    expect(currentHp(harness, 'actor')).toBe(100)
    expect(currentHp(harness, 'target')).toBe(100)
    expect(moveUses(harness)).toBe(0)
  })

  it('commits a passed Trip branch with damage, recoil, usage, and no condition', async () => {
    const harness = createHarness()
    const declaration = await declare(harness, 'op_take_down_pass_declare')
    expect(isPendingMoveDeclarationResult(declaration.result)).toBe(true)
    expect(currentHp(harness, 'actor')).toBe(100)
    expect(currentHp(harness, 'target')).toBe(100)
    expect(moveUses(harness)).toBe(0)
    expect(declaration.map?.encounterState?.turnResources['actor-token']?.actions.standard.spent)
      .toBe(1)

    const terminal = passCurrent({ harness, opId: 'op_take_down_pass_response' }).invoke()
    expect(terminal.result).toMatchObject({ ok: true, previousRevision: 1, revision: 2 })
    expect(currentHp(harness, 'target')).toBeLessThan(100)
    expect(currentHp(harness, 'actor')).toBeLessThan(100)
    expect(currentConditions(harness, 'target')).not.toContain('Tripped')
    expect(moveUses(harness)).toBe(1)
    expect(harness.pending.listByMap('take-down-arena')[0]).toMatchObject({
      status: 'committed',
      terminalOpId: 'op_take_down_pass_response',
    })
  })

  it('commits critical damage, recoil, and usage once through the passed Trip saga', async () => {
    const harness = createHarness({ randomValues: [0.999, 0, 0] })
    const declaration = await declare(harness, 'op_take_down_critical_declare')
    expect(isPendingMoveDeclarationResult(declaration.result)).toBe(true)

    const accepted = passCurrent({
      harness,
      opId: 'op_take_down_critical_pass',
    }).invoke()

    expect(accepted.result).toMatchObject({ ok: true, previousRevision: 1, revision: 2 })
    expect(currentHp(harness, 'target')).toBeLessThan(100)
    expect(currentHp(harness, 'actor')).toBeLessThan(100)
    expect(moveUses(harness)).toBe(1)
    expect(harness.drawCount()).toBe(3)
    expect(terminalAuditEvents(harness)).toContainEqual(expect.objectContaining({
      kind: 'operation',
      operationId: 'take-down.damage',
      outcome: 'applied',
      result: expect.objectContaining({
        recipients: [expect.objectContaining({
          details: expect.objectContaining({
            calculation: expect.objectContaining({
              criticalHit: expect.objectContaining({ critical: true, naturalRoll: 20 }),
            }),
          }),
        })],
      }),
    }))
  })

  it('restores each authorized window after reconnect and commits a successful Trip once', async () => {
    const harness = createHarness({ randomValues: checkRollValues('success') })
    const declaration = await declare(harness, 'op_take_down_success_declare')
    if (!isPendingMoveDeclarationResult(declaration.result)) {
      throw new Error('Take Down did not suspend after its hit.')
    }
    const resolutionId = declaration.result.pendingResolution.resolutionId
    const originalDraws = harness.drawCount()

    const listed = listPendingMoveResponsesUseCase({
      role: 'gm',
      mapSlug: 'take-down-arena',
      playerProfile: null,
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
    })
    expect(listed.windows).toMatchObject([{
      resolution: { resolutionId },
      window: {
        windowId: 'take-down.trip-offer',
        options: [{ id: 'trip' }],
      },
    }])
    expect(harness.drawCount()).toBe(originalDraws)

    const trip = chooseCurrent({
      harness,
      opId: 'op_take_down_choose_trip',
      optionId: 'trip',
    }).invoke()
    expect(trip.result).toMatchObject({ ok: true, revision: 2 })
    expect(currentPending(harness).resolution.outstandingWindows[0]).toMatchObject({
      windowId: 'take-down.trip-actor-skill',
      ownership: [{ kind: 'actor', id: null }],
      options: [{ id: 'combat' }, { id: 'acrobatics' }],
    })

    chooseCurrent({
      harness,
      opId: 'op_take_down_actor_skill',
      optionId: 'acrobatics',
    }).invoke()
    expect(currentPending(harness).resolution.outstandingWindows[0]).toMatchObject({
      windowId: 'take-down.trip-target-skill',
      ownership: [{ kind: 'target', id: 'target-token' }],
      options: [{ id: 'combat' }, { id: 'acrobatics' }],
    })

    const finalResponse = chooseCurrent({
      harness,
      opId: 'op_take_down_target_skill',
      optionId: 'combat',
    })
    const accepted = finalResponse.invoke()
    const drawsAfterCommit = harness.drawCount()
    const hpAfterCommit = {
      actor: currentHp(harness, 'actor'),
      target: currentHp(harness, 'target'),
    }
    const duplicate = finalResponse.invoke()

    expect(accepted.result).toMatchObject({ ok: true, previousRevision: 3, revision: 4 })
    expect(duplicate.result).toEqual(accepted.result)
    expect(currentConditions(harness, 'target')).toContain('Tripped')
    expect(currentHp(harness, 'target')).toBeLessThan(100)
    expect(currentHp(harness, 'actor')).toBeLessThan(100)
    expect(moveUses(harness)).toBe(1)
    expect(harness.drawCount()).toBe(drawsAfterCommit)
    expect({
      actor: currentHp(harness, 'actor'),
      target: currentHp(harness, 'target'),
    }).toEqual(hpAfterCommit)
    expect(harness.ops.getStoredOpRecord('take-down-arena', 'op_take_down_target_skill'))
      .not.toBeNull()
    expect(harness.pending.getById(resolutionId)).toMatchObject({
      status: 'committed',
      terminalOpId: 'op_take_down_target_skill',
      resolution: {
        chosenOptions: [
          { windowId: 'take-down.trip-offer', optionId: 'trip' },
          { windowId: 'take-down.trip-actor-skill', optionId: 'acrobatics' },
          { windowId: 'take-down.trip-target-skill', optionId: 'combat' },
        ],
      },
    })
  })

  it.each(['failure', 'tie'] as const)(
    'commits opposed-check %s once without applying Tripped',
    async (outcome) => {
      const harness = createHarness({ randomValues: checkRollValues(outcome) })
      const declaration = await declare(harness, `op_take_down_${outcome}_declare`)
      expect(isPendingMoveDeclarationResult(declaration.result)).toBe(true)

      const terminal = completeOpposedTrip({
        harness,
        opPrefix: `op_take_down_${outcome}`,
        actorSkill: 'combat',
        targetSkill: 'acrobatics',
      }).invoke()

      expect(terminal.result).toMatchObject({ ok: true, previousRevision: 3, revision: 4 })
      expect(currentConditions(harness, 'target')).not.toContain('Tripped')
      expect(currentHp(harness, 'target')).toBeLessThan(100)
      expect(currentHp(harness, 'actor')).toBeLessThan(100)
      expect(moveUses(harness)).toBe(1)
      expect(harness.drawCount()).toBe(5)
      expect(harness.pending.listByMap('take-down-arena')[0]).toMatchObject({
        status: 'committed',
        terminalOpId: `op_take_down_${outcome}_target`,
        resolution: {
          rollLedger: expect.any(Array),
          chosenOptions: [
            { windowId: 'take-down.trip-offer', optionId: 'trip' },
            { windowId: 'take-down.trip-actor-skill', optionId: 'combat' },
            { windowId: 'take-down.trip-target-skill', optionId: 'acrobatics' },
          ],
        },
      })
      expect(harness.pending.listByMap('take-down-arena')[0]?.resolution.rollLedger)
        .toHaveLength(4)
    },
  )

  it.each(['Rock Head', 'Magic Guard'] as const)(
    'prevents recoil with %s while retaining target damage',
    async (ability) => {
      const harness = createHarness({
        fixtureOptions: { actorAbilities: [{ name: ability }] },
      })
      await declare(harness, `op_take_down_${ability.replace(' ', '_')}_declare`)
      const response = passCurrent({
        harness,
        opId: `op_take_down_${ability.replace(' ', '_')}_pass`,
      }).invoke()
      expect(response.result).toMatchObject({ ok: true })
      expect(currentHp(harness, 'target')).toBeLessThan(100)
      expect(currentHp(harness, 'actor')).toBe(100)
      expect(terminalAuditEvents(harness)).toContainEqual(expect.objectContaining({
        kind: 'operation',
        operationId: 'take-down.recoil',
        outcome: 'prevented',
        result: expect.objectContaining({
          recipients: [expect.objectContaining({
            reasonCode: 'recoil-immunity',
            blockers: [{ subject: 'Recoil', source: ability }],
          })],
        }),
      }))
    },
  )

  it('raises Reckless damage base before damage and recoil in the accepted plan', async () => {
    const harness = createHarness({
      fixtureOptions: { actorAbilities: [{ name: 'Reckless' }] },
      randomValues: [0.45, 0, 0, 0],
    })
    await declare(harness, 'op_take_down_reckless_declare')
    passCurrent({ harness, opId: 'op_take_down_reckless_pass' }).invoke()
    const damage = terminalAuditEvents(harness).find(event => (
      event.kind === 'operation' && event.operationId === 'take-down.damage'
    ))
    expect(damage).toMatchObject({
      input: {
        damageBase: TAKE_DOWN_BASE_DAMAGE_BASE + TAKE_DOWN_RECKLESS_DAMAGE_BASE_BONUS,
      },
      outcome: 'applied',
    })
    expect(terminalAuditEvents(harness)).toContainEqual(expect.objectContaining({
      kind: 'predicate',
      predicateId: 'take-down.reckless-damage-base',
      outcome: true,
    }))
  })

  it('conflicts a stale target response without deferred damage, recoil, usage, or condition', async () => {
    const harness = createHarness()
    await declare(harness, 'op_take_down_stale_declare')
    const stale = passCurrent({ harness, opId: 'op_take_down_stale_response' })
    const target = harness.sheets.getByRef('pokemon', 'target')!
    expect(harness.sheets.applyLivePlayUpdate({
      kind: 'pokemon',
      slug: target.slug,
      expectedRevision: target.revision,
      nextSheet: { ...target.sheet, nickname: 'Concurrent edit' },
    })).toBe('applied')

    const result = stale.invoke()
    expect(result.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(currentHp(harness, 'actor')).toBe(100)
    expect(currentHp(harness, 'target')).toBe(100)
    expect(currentConditions(harness, 'target')).toEqual([])
    expect(moveUses(harness)).toBe(0)
    expect(harness.maps.getBySlug('take-down-arena')?.encounterState
      ?.turnResources['actor-token']?.actions.standard.spent).toBe(1)
    expect(harness.pending.listByMap('take-down-arena')[0]).toMatchObject({
      status: 'conflicted',
      terminalOpId: 'op_take_down_stale_response',
    })
  })
})
