import { afterEach, describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import type { MoveResolutionOperationTraceEvent } from '#shared/moveAutomation/trace'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import { executeMoveSpec } from '~~/server/domain/moveAutomation/executeSpec'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveState,
  planAuthoritativeMoveStateExecution,
} from '~~/server/domain/planAuthoritativeMoveState'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import { FURY_CUTTER_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/furyCutter'
import type { PersistedSheet } from '~~/server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import {
  FURY_CUTTER_ACTOR_ID,
  FURY_CUTTER_OTHER_TARGET_ID,
  FURY_CUTTER_TARGET_ID,
  FURY_CUTTER_V2_SEMANTIC_SCENARIOS,
  furyCutterIntent,
  furyCutterV2Fixture,
} from '../fixtures/moveAutomation/furyCutterV2'
import {
  U_TURN_ACTOR_PLACEMENT_ID,
  U_TURN_TARGET_PLACEMENT_ID,
  uTurnV2Fixture,
} from '../fixtures/moveAutomation/uTurnV2'
import {
  LivePlayIntegrationHarness,
  assertAccepted,
} from './livePlayIntegrationHarness'

const furyCutterRow = manifestJson.moves.find(row => row.canonicalId === 'Fury Cutter')!
const harnesses: LivePlayIntegrationHarness[] = []
const gm = { role: 'gm' as const, clientId: 'gm-fury-cutter-client' }

const operationEvent = (
  events: readonly { readonly kind: string }[],
  operationId: string,
): MoveResolutionOperationTraceEvent | undefined => events.find(
  (event): event is MoveResolutionOperationTraceEvent => (
    event.kind === 'operation'
    && (event as MoveResolutionOperationTraceEvent).operationId === operationId
  ),
)

const randomSequence = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => values[index++] ?? values.at(-1) ?? 0.5
}

const planFuryCutter = (options: {
  readonly chainCount?: number
  readonly chainTargetPlacementId?: string
  readonly targetPlacementId?: string
  readonly targetCurrentHp?: number
  readonly randomValues?: readonly number[]
  readonly operationId: string
}) => {
  const fixture = furyCutterV2Fixture({
    chainCount: options.chainCount,
    chainTargetPlacementId: options.chainTargetPlacementId,
    targetCurrentHp: options.targetCurrentHp,
  })
  return planAuthoritativeMoveState({
    ...fixture,
    intent: furyCutterIntent('Fury Cutter', options.targetPlacementId),
    random: randomSequence(options.randomValues ?? [0.5, 0]),
    now: () => 5_000,
    operationId: options.operationId,
    pendingResolutionId: `resolution.${options.operationId}`,
  })
}

const contextualDamageBase = (
  plan: ReturnType<typeof planFuryCutter>,
): Readonly<Record<string, unknown>> | null => {
  const damage = operationEvent(plan.resolution.auditTrace.events, 'fury-cutter.damage')
  const result = damage?.result as {
    readonly recipients?: readonly [{
      readonly details?: { readonly calculation?: {
        readonly contextualDamageBase?: Readonly<Record<string, unknown>>
      } }
    }]
  } | null
  return result?.recipients?.[0]?.details?.calculation?.contextualDamageBase ?? null
}

const chainTrace = (
  plan: ReturnType<typeof planFuryCutter>,
): Readonly<Record<string, unknown>> | null => {
  const event = operationEvent(
    plan.resolution.auditTrace.events,
    'fury-cutter.chain-completed',
  )
  const result = event?.result as {
    readonly details?: Readonly<Record<string, unknown>>
  } | null
  return result?.details ?? null
}

const persistedSheets = (
  sheets: ReadonlyMap<string, CharacterSheet>,
): readonly PersistedSheet[] => [...sheets].map(([slug, sheet]) => ({
  kind: 'pokemon' as const,
  slug,
  revision: sheet.revision ?? 0,
  updatedAt: 100,
  sheet: { ...sheet, updatedAt: 100 },
}))

const integrationHarness = (options: {
  readonly chainCount?: number
  readonly random?: () => number
} = {}): LivePlayIntegrationHarness => {
  const fixture = furyCutterV2Fixture({ chainCount: options.chainCount, revision: 0 })
  const harness = LivePlayIntegrationHarness.create({
    map: { ...fixture.map, slug: 'integration-arena' },
    sheets: persistedSheets(fixture.pokemonSheets),
    random: options.random ?? (() => 0.5),
  })
  harnesses.push(harness)
  return harness
}

const resolveMove = async (
  harness: LivePlayIntegrationHarness,
  opId: string,
  moveName = 'Fury Cutter',
  targetPlacementId = FURY_CUTTER_TARGET_ID,
) => {
  const map = await harness.readMap()
  if (!map) throw new Error('Fury Cutter integration map is missing.')
  const command = harness.resolveMoveCommand({
    opId,
    baseRevision: map.revision ?? 0,
    intent: furyCutterIntent(moveName, targetPlacementId),
    candidateScopePlacementIds: [targetPlacementId],
  })
  return {
    command,
    response: await harness.resolveMove({ actor: gm, command }),
  }
}

const advanceBackToActor = async (
  harness: LivePlayIntegrationHarness,
  opPrefix: string,
): Promise<void> => {
  const orderIds = [
    FURY_CUTTER_ACTOR_ID,
    FURY_CUTTER_TARGET_ID,
    FURY_CUTTER_OTHER_TARGET_ID,
  ]
  for (let index = 0; index < orderIds.length; index += 1) {
    const map = await harness.readMap()
    if (!map?.initiative) throw new Error('Fury Cutter initiative is missing.')
    const response = await harness.nextInitiative({
      actor: gm,
      command: harness.nextInitiativeCommand({
        opId: `${opPrefix}_${index + 1}`,
        baseRevision: map.revision ?? 0,
        orderIds,
        activeId: map.initiative.activeId,
        round: map.initiative.round,
      }),
    })
    assertAccepted(response.result)
  }
}

const persistedChain = async (harness: LivePlayIntegrationHarness) => (
  (await harness.readMap())?.encounterState?.history.consecutiveMoves ?? []
)

afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()?.dispose()
})

describe('Fury Cutter native MoveSpec v2', () => {
  it('selects the reviewed complete runtime and links all semantic evidence', () => {
    expect(furyCutterRow).toMatchObject({
      baseStatus: 'complete',
      runtime: {
        kind: 'movespec-v2',
        version: 2,
        definitionHash: '8c2bdd861565cf66620320d978d9adcada9c157274779e50d47d4e401c6393cf',
        sourceModule: 'server/domain/moveAutomation/specs/furyCutter.ts',
      },
      capabilityTags: [
        'expressions.bounded',
        'history.structured',
        'targeting.authoritative',
      ],
      blockerCodes: [],
      limitations: [],
      manualSteps: [],
    })
    expect(furyCutterRow.scenarioIds).toEqual(
      FURY_CUTTER_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(registeredMoveAutomationRuntimeFor('Fury Cutter')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: FURY_CUTTER_MOVE_SPEC },
      definitionHash: furyCutterRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Fury Cutter' }),
    )
  })

  it('derives target-bound DB in the interpreter before any state mutation', () => {
    const fixture = furyCutterV2Fixture({ chainCount: 2 })
    const runtime = registeredMoveAutomationRuntimeFor('Fury Cutter')
    if (!runtime || runtime.kind !== 'movespec-v2') throw new Error('Fury Cutter v2 is missing.')
    const sourceMap = structuredClone(fixture.map)
    const context = buildAuthoritativeMoveRulesContext({
      ...fixture,
      intent: furyCutterIntent(),
      candidatePlacementIds: [FURY_CUTTER_TARGET_ID],
      selectedPlacementIds: [FURY_CUTTER_TARGET_ID],
      random: () => 0.5,
      time: 5_000,
      resolutionId: 'resolution.fury.interpreter',
    })
    const result = executeMoveSpec({
      definition: runtime.definition,
      context,
      authoritativeTargetIds: [FURY_CUTTER_TARGET_ID],
    })

    expect(result).toMatchObject({
      kind: 'complete',
      targetIds: [FURY_CUTTER_TARGET_ID],
      hitTargetIds: [FURY_CUTTER_TARGET_ID],
      resolvedDamageBases: [{
        operationId: 'fury-cutter.damage',
        recipientId: FURY_CUTTER_TARGET_ID,
        expressionValue: 12,
        boundedValue: 12,
        finalDamageBase: 12,
      }],
      operations: expect.arrayContaining([
        expect.objectContaining({
          operation: expect.objectContaining({
            id: 'fury-cutter.chain-completed',
            kind: 'history',
          }),
        }),
      ]),
    })
    expect(fixture.map).toEqual(sourceMap)
  })

  it.each([
    { label: 'first', chainCount: 0, expressionValue: 4, expectedDb: 4, expectedCount: 1, outcome: 'advanced' },
    { label: 'second', chainCount: 1, expressionValue: 8, expectedDb: 8, expectedCount: 2, outcome: 'advanced' },
    { label: 'third', chainCount: 2, expressionValue: 12, expectedDb: 12, expectedCount: 3, outcome: 'advanced' },
    { label: 'fourth', chainCount: 3, expressionValue: 16, expectedDb: 16, expectedCount: 4, outcome: 'advanced' },
    { label: 'capped', chainCount: 4, expressionValue: 20, expectedDb: 16, expectedCount: 4, outcome: 'capped' },
  ])('plans the $label same-target hit at DB $expectedDb', ({
    label,
    chainCount,
    expressionValue,
    expectedDb,
    expectedCount,
    outcome,
  }) => {
    const plan = planFuryCutter({
      chainCount,
      operationId: `op_fury_${label}`,
    })

    expect(contextualDamageBase(plan)).toMatchObject({
      expressionValue,
      boundedValue: expectedDb,
      finalDamageBase: expectedDb,
    })
    expect(chainTrace(plan)).toMatchObject({
      status: outcome,
      previousCount: chainCount,
      currentCount: expectedCount,
      targetPlacementId: FURY_CUTTER_TARGET_ID,
    })
    expect(plan.nextMap.encounterState?.history.consecutiveMoves).toEqual([{
      placementId: FURY_CUTTER_ACTOR_ID,
      canonicalId: 'Fury Cutter',
      targetPlacementId: FURY_CUTTER_TARGET_ID,
      count: expectedCount,
      lastResolutionId: `resolution.op_fury_${label}`,
    }])
  })

  it('starts at DB 4 for a changed target and stores that new successful chain', () => {
    const plan = planFuryCutter({
      chainCount: 3,
      chainTargetPlacementId: FURY_CUTTER_TARGET_ID,
      targetPlacementId: FURY_CUTTER_OTHER_TARGET_ID,
      operationId: 'op_fury_target_change',
    })
    expect(contextualDamageBase(plan)).toMatchObject({ finalDamageBase: 4 })
    expect(chainTrace(plan)).toMatchObject({
      status: 'restarted-target-change',
      previousTargetPlacementId: FURY_CUTTER_TARGET_ID,
      targetPlacementId: FURY_CUTTER_OTHER_TARGET_ID,
      previousCount: 3,
      currentCount: 1,
    })
  })

  it('resets on an authoritative miss and traces a critical hit without changing chain rules', () => {
    const miss = planFuryCutter({
      chainCount: 2,
      randomValues: [0],
      operationId: 'op_fury_miss_reset',
    })
    expect(miss.resolution.transaction.hitTargetIds).toEqual([])
    expect(miss.nextMap.encounterState?.history.consecutiveMoves).toEqual([])
    expect(chainTrace(miss)).toMatchObject({
      status: 'reset-miss',
      previousCount: 2,
      currentCount: 0,
    })

    const critical = planFuryCutter({
      randomValues: [0.99, 0],
      operationId: 'op_fury_critical',
    })
    const damage = operationEvent(critical.resolution.auditTrace.events, 'fury-cutter.damage')
    expect(damage).toMatchObject({
      outcome: 'applied',
      result: {
        recipients: [{
          details: { calculation: { criticalHit: { critical: true } } },
        }],
      },
    })
    expect(chainTrace(critical)).toMatchObject({ currentCount: 1 })
  })

  it('commits consecutive hits and duplicate replay exactly once', async () => {
    let draws = 0
    const harness = integrationHarness({
      random: () => {
        draws += 1
        return 0.5
      },
    })
    const first = await resolveMove(harness, 'op_fury_live_first')
    assertAccepted(first.response.result)
    expect(await persistedChain(harness)).toEqual([
      expect.objectContaining({ count: 1, targetPlacementId: FURY_CUTTER_TARGET_ID }),
    ])
    const firstMap = await harness.readMap()
    const firstTarget = await harness.readSheet('pokemon', 'fury-cutter-target-sheet')
    const drawsAfterFirst = draws
    const eventsAfterFirst = harness.publishedEvents.length

    const duplicate = await harness.resolveMove({ actor: gm, command: first.command })
    expect(duplicate.result).toEqual(first.response.result)
    expect((await harness.readMap())?.revision).toBe(firstMap?.revision)
    expect(await harness.readSheet('pokemon', 'fury-cutter-target-sheet')).toEqual(firstTarget)
    expect(await persistedChain(harness)).toEqual([
      expect.objectContaining({ count: 1, targetPlacementId: FURY_CUTTER_TARGET_ID }),
    ])
    expect(draws).toBe(drawsAfterFirst)
    expect(harness.publishedEvents).toHaveLength(eventsAfterFirst)

    await advanceBackToActor(harness, 'op_fury_advance')
    const second = await resolveMove(harness, 'op_fury_live_second')
    assertAccepted(second.response.result)
    expect(await persistedChain(harness)).toEqual([
      expect.objectContaining({ count: 2, targetPlacementId: FURY_CUTTER_TARGET_ID }),
    ])
  })

  it('atomically clears a retained chain when the actor uses a different move', async () => {
    const harness = integrationHarness({ chainCount: 3 })
    const pound = await resolveMove(
      harness,
      'op_fury_different_move',
      'Pound',
      FURY_CUTTER_TARGET_ID,
    )
    assertAccepted(pound.response.result)
    expect(await persistedChain(harness)).toEqual([])
  })

  it('breaks the chain when a different move declaration durably suspends', () => {
    const fixture = uTurnV2Fixture()
    const encounterState = fixture.map.encounterState!
    const map = {
      ...fixture.map,
      encounterState: {
        ...encounterState,
        history: {
          ...encounterState.history,
          consecutiveMoves: [{
            placementId: U_TURN_ACTOR_PLACEMENT_ID,
            canonicalId: 'Fury Cutter',
            targetPlacementId: U_TURN_TARGET_PLACEMENT_ID,
            count: 3,
            lastResolutionId: 'resolution.fury.before-u-turn',
          }],
        },
      },
    }
    const plan = planAuthoritativeMoveStateExecution({
      ...fixture,
      map,
      random: () => 0.5,
      now: () => 5_000,
      operationId: 'op_fury_pending_different_move',
      pendingResolutionId: 'resolution.fury.pending-different-move',
    })

    expect(isAuthoritativePendingMoveStatePlan(plan)).toBe(true)
    expect(plan.nextMap.encounterState?.history.consecutiveMoves).toEqual([])
    expect(map.encounterState.history.consecutiveMoves).toHaveLength(1)
  })
})
