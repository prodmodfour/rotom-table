import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  createEmptyEncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  executeMoveSpec,
  type MoveSpecExecutionResult,
} from '~~/server/domain/moveAutomation/executeSpec'
import {
  ASTONISH_AWARE_OPTION_ID,
  ASTONISH_UNAWARE_OPTION_ID,
  ASTONISH_UNAWARE_REQUEST_ID,
} from '~~/server/domain/moveAutomation/handlers/astonish'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import { ASTONISH_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/astonish'
import { FAKE_OUT_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/fakeOut'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveState,
  planAuthoritativeMoveStateExecution,
} from '~~/server/domain/planAuthoritativeMoveState'
import {
  ASTONISH_V2_SEMANTIC_SCENARIOS,
  FAKE_OUT_V2_SEMANTIC_SCENARIOS,
  OPENING_MOVE_ACTOR_ID,
  OPENING_MOVE_TARGET_ID,
  openingMoveV2Fixture,
  type OpeningMoveV2FixtureOptions,
} from '../fixtures/moveAutomation/openingMovesV2'

const astonishRow = manifestJson.moves.find(row => row.canonicalId === 'Astonish')!
const fakeOutRow = manifestJson.moves.find(row => row.canonicalId === 'Fake Out')!

const executeOpeningMove = (options: {
  readonly fixture?: OpeningMoveV2FixtureOptions
  readonly randomValues: readonly number[]
  readonly responses?: readonly { readonly requestId: string; readonly optionId: string | null }[]
}): MoveSpecExecutionResult => {
  const fixture = openingMoveV2Fixture(options.fixture)
  const runtime = registeredMoveAutomationRuntimeFor(fixture.intent.moveName)
  if (!runtime || runtime.kind !== 'movespec-v2') {
    throw new Error(`${fixture.intent.moveName} native runtime is missing.`)
  }
  const context = buildAuthoritativeMoveRulesContext({
    ...fixture,
    candidatePlacementIds: [OPENING_MOVE_TARGET_ID],
    selectedPlacementIds: [OPENING_MOVE_TARGET_ID],
    random: createFiniteAuthoritativeMoveRandomStream(options.randomValues),
    time: 5_000,
    resolutionId: `resolution.${fixture.intent.moveName.toLowerCase().replace(' ', '-')}`,
  })
  return executeMoveSpec({
    definition: runtime.definition,
    context,
    authoritativeTargetIds: [OPENING_MOVE_TARGET_ID],
    responses: options.responses,
  })
}

const traceOperation = (
  result: MoveSpecExecutionResult,
  operationId: string,
) => result.trace.events.find(event => (
  event.kind === 'operation' && event.operationId === operationId
))

const conditionUpdate = (
  plan: ReturnType<typeof planAuthoritativeMoveState>,
) => plan.resolution.transaction.conditionUpdates.find(
  update => update.id === OPENING_MOVE_TARGET_ID,
)

describe('Astonish and Fake Out opening legality', () => {
  it('selects both complete reviewed runtimes and links semantic evidence', () => {
    expect(astonishRow).toMatchObject({
      baseStatus: 'complete',
      runtime: {
        kind: 'movespec-v2',
        version: 2,
        definitionHash: '549776f9a5efaa06a28deef9b41bfc95813d2c44a1cd4de537d3f0c1fb33c793',
        sourceModule: 'server/domain/moveAutomation/specs/astonish.ts',
      },
      capabilityTags: [
        'conditions.typed',
        'history.structured',
        'lifecycle.effects',
        'reactions.durable',
        'targeting.authoritative',
      ],
      blockerCodes: [],
      limitations: [],
      manualSteps: [],
    })
    expect(astonishRow.scenarioIds).toEqual(
      ASTONISH_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(astonishRow.conformanceEvidence.scenarios).toEqual(
      ASTONISH_V2_SEMANTIC_SCENARIOS,
    )
    expect(registeredMoveAutomationRuntimeFor('Astonish')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: ASTONISH_MOVE_SPEC },
      definitionHash: astonishRow.runtime.definitionHash,
    })

    expect(fakeOutRow).toMatchObject({
      baseStatus: 'complete',
      runtime: {
        kind: 'movespec-v2',
        version: 2,
        definitionHash: 'a7adcdf05768206616cae8810c13502db950cf41bdc9474fbe6f94ba81db0d66',
        sourceModule: 'server/domain/moveAutomation/specs/fakeOut.ts',
      },
      capabilityTags: [
        'conditions.typed',
        'expressions.bounded',
        'history.structured',
        'reactions.durable',
        'targeting.authoritative',
      ],
      blockerCodes: [],
      limitations: [],
      manualSteps: [],
    })
    expect(fakeOutRow.scenarioIds).toEqual(
      FAKE_OUT_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(fakeOutRow.conformanceEvidence.scenarios).toEqual(
      FAKE_OUT_V2_SEMANTIC_SCENARIOS,
    )
    expect(registeredMoveAutomationRuntimeFor('Fake Out')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: FAKE_OUT_MOVE_SPEC },
      definitionHash: fakeOutRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalId: 'Astonish' }),
      expect.objectContaining({ canonicalId: 'Fake Out' }),
    ]))
  })

  it('rejects Fake Out after the opening action with its stable reason before RNG', () => {
    const result = executeOpeningMove({
      fixture: { moveName: 'Fake Out', actedSinceEntry: true },
      randomValues: [],
    })

    expect(result.kind).toBe('rejected')
    if (result.kind !== 'rejected') return
    expect(result.rejection).toEqual({
      code: 'precondition-failed',
      reasonCode: 'fake-out.not-joining-encounter',
      preconditionId: 'fake-out.opening-action',
      actualTargetCount: null,
      minimumTargetCount: null,
      maximumTargetCount: null,
    })
    expect(result.rollLedger).toEqual([])
    expect(result.trace.events).toContainEqual(expect.objectContaining({
      kind: 'predicate',
      predicateId: 'fake-out.opening-action',
      outcome: false,
      reasonCode: 'fake-out.not-joining-encounter',
    }))
  })

  it('applies Fake Out damage and typed Flinch only on a legal non-immune hit', () => {
    const fixture = openingMoveV2Fixture({ moveName: 'Fake Out' })
    const plan = planAuthoritativeMoveState({
      ...fixture,
      random: createFiniteAuthoritativeMoveRandomStream([0.45, 0]),
      now: () => 5_000,
      operationId: 'op_fake_out_joining_hit',
    })

    expect(plan.resolution.transaction).toMatchObject({
      attackedTargetIds: [OPENING_MOVE_TARGET_ID],
      hitTargetIds: [OPENING_MOVE_TARGET_ID],
    })
    expect(plan.resolution.transaction.hpUpdates).toHaveLength(1)
    expect(conditionUpdate(plan)).toEqual({
      id: OPENING_MOVE_TARGET_ID,
      conditions: ['Flinch', 'Vulnerable'],
    })
    expect(plan.nextMap.encounterState?.turnResources[OPENING_MOVE_ACTOR_ID])
      .toMatchObject({
        actions: { standard: { spent: 1 } },
        oncePerTurnFlags: expect.arrayContaining([
          expect.objectContaining({
            id: 'encounter.acted-since-entry',
            sourceOperationId: 'op_fake_out_joining_hit',
            resetOn: ['scene-end', 'recall', 'send-out'],
          }),
        ]),
      })
    expect(plan.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'operation',
      operationId: 'fake-out.flinch',
      outcome: 'applied',
    }))
  })

  it('omits Fake Out Flinch on a miss or Normal immunity and traces critical hits', () => {
    const missFixture = openingMoveV2Fixture({ moveName: 'Fake Out' })
    const miss = planAuthoritativeMoveState({
      ...missFixture,
      random: createFiniteAuthoritativeMoveRandomStream([0]),
      now: () => 5_000,
      operationId: 'op_fake_out_miss',
    })
    expect(miss.resolution.transaction.hitTargetIds).toEqual([])
    expect(miss.resolution.transaction.conditionUpdates).toEqual([])

    const immuneFixture = openingMoveV2Fixture({
      moveName: 'Fake Out',
      targetTypes: ['Ghost'],
    })
    const immune = planAuthoritativeMoveState({
      ...immuneFixture,
      random: createFiniteAuthoritativeMoveRandomStream([0.45, 0]),
      now: () => 5_000,
      operationId: 'op_fake_out_immunity',
    })
    expect(immune.resolution.transaction.hitTargetIds).toEqual([OPENING_MOVE_TARGET_ID])
    expect(immune.resolution.transaction.hpUpdates).toEqual([])
    expect(immune.resolution.transaction.conditionUpdates).toEqual([])
    expect(immune.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'operation',
      operationId: 'fake-out.damage',
      outcome: 'prevented',
    }))

    const criticalFixture = openingMoveV2Fixture({ moveName: 'Fake Out' })
    const critical = planAuthoritativeMoveState({
      ...criticalFixture,
      random: createFiniteAuthoritativeMoveRandomStream([0.999, 0]),
      now: () => 5_000,
      operationId: 'op_fake_out_critical',
    })
    expect(critical.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'operation',
      operationId: 'fake-out.damage',
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

  it('offers Astonish awareness only after a qualifying hit and owns both Flinch branches', () => {
    const offered = executeOpeningMove({
      fixture: { moveName: 'Astonish' },
      randomValues: [0.45, 0],
    })
    expect(offered.kind).toBe('pending-request')
    if (offered.kind !== 'pending-request') return
    expect(offered.request).toMatchObject({
      kind: 'branch-choice',
      operationId: 'astonish.choose-target-awareness',
      recipientIds: [OPENING_MOVE_TARGET_ID],
      requestId: ASTONISH_UNAWARE_REQUEST_ID,
      options: [
        { id: ASTONISH_AWARE_OPTION_ID },
        { id: ASTONISH_UNAWARE_OPTION_ID },
      ],
      allowPass: false,
    })
    expect(offered.preWindowOperations).toEqual([])

    const awareBelowThreshold = executeOpeningMove({
      fixture: { moveName: 'Astonish' },
      randomValues: [0.45, 0],
      responses: [{
        requestId: ASTONISH_UNAWARE_REQUEST_ID,
        optionId: ASTONISH_AWARE_OPTION_ID,
      }],
    })
    expect(awareBelowThreshold.kind).toBe('complete')
    expect(traceOperation(awareBelowThreshold, 'astonish.threshold-flinch')).toMatchObject({
      recipientIds: [OPENING_MOVE_TARGET_ID],
    })

    const awareThreshold = executeOpeningMove({
      fixture: { moveName: 'Astonish' },
      randomValues: [0.7, 0],
      responses: [{
        requestId: ASTONISH_UNAWARE_REQUEST_ID,
        optionId: ASTONISH_AWARE_OPTION_ID,
      }],
    })
    expect(awareThreshold.kind).toBe('complete')
    expect(traceOperation(awareThreshold, 'astonish.threshold-flinch')).toMatchObject({
      outcome: 'applied',
      recipientIds: [OPENING_MOVE_TARGET_ID],
    })

    const unaware = executeOpeningMove({
      fixture: { moveName: 'Astonish' },
      randomValues: [0.45, 0],
      responses: [{
        requestId: ASTONISH_UNAWARE_REQUEST_ID,
        optionId: ASTONISH_UNAWARE_OPTION_ID,
      }],
    })
    expect(unaware.kind).toBe('complete')
    expect(traceOperation(unaware, 'astonish.unaware-automatic-flinch')).toMatchObject({
      outcome: 'applied',
      recipientIds: [OPENING_MOVE_TARGET_ID],
    })
    expect(traceOperation(unaware, 'astonish.mark-unaware-flinch-used')).toMatchObject({
      outcome: 'applied',
      recipientIds: [OPENING_MOVE_ACTOR_ID],
    })
    expect(traceOperation(unaware, 'astonish.threshold-flinch')).toMatchObject({
      outcome: 'prevented',
    })
  })

  it('does not open Astonish awareness after a miss or Ghost immunity', () => {
    const missFixture = openingMoveV2Fixture({ moveName: 'Astonish' })
    const miss = planAuthoritativeMoveStateExecution({
      ...missFixture,
      random: createFiniteAuthoritativeMoveRandomStream([0]),
      now: () => 5_000,
      operationId: 'op_astonish_miss',
      pendingResolutionId: 'resolution.astonish.miss',
    })
    expect(isAuthoritativePendingMoveStatePlan(miss)).toBe(false)
    if (!isAuthoritativePendingMoveStatePlan(miss)) {
      expect(miss.resolution.transaction.hitTargetIds).toEqual([])
      expect(miss.resolution.transaction.conditionUpdates).toEqual([])
    }

    const immuneFixture = openingMoveV2Fixture({
      moveName: 'Astonish',
      targetTypes: ['Normal'],
    })
    const immune = planAuthoritativeMoveStateExecution({
      ...immuneFixture,
      random: createFiniteAuthoritativeMoveRandomStream([0.45, 0]),
      now: () => 5_000,
      operationId: 'op_astonish_immunity',
      pendingResolutionId: 'resolution.astonish.immunity',
    })
    expect(isAuthoritativePendingMoveStatePlan(immune)).toBe(false)
    if (!isAuthoritativePendingMoveStatePlan(immune)) {
      expect(immune.resolution.transaction.hitTargetIds).toEqual([OPENING_MOVE_TARGET_ID])
      expect(immune.resolution.transaction.hpUpdates).toEqual([])
      expect(immune.resolution.transaction.conditionUpdates).toEqual([])
    }
  })

  it('rejects an unavailable Priority declaration without any durable mutation', () => {
    const fixture = openingMoveV2Fixture({
      moveName: 'Fake Out',
      actedThisRound: true,
    })
    const snapshot = structuredClone(fixture.map)

    expect(() => planAuthoritativeMoveState({
      ...fixture,
      random: createFiniteAuthoritativeMoveRandomStream([0.45, 0]),
      now: () => 5_000,
      operationId: 'op_fake_out_priority_rejected',
    })).toThrowError(expect.objectContaining({
      code: 'move-resource-unavailable',
      message: expect.stringContaining('priority-unavailable'),
    }))
    expect(fixture.map).toEqual(snapshot)
  })

  it('keeps rejected planning inputs immutable', () => {
    const fixture = openingMoveV2Fixture({
      moveName: 'Fake Out',
      actedSinceEntry: true,
    })
    const snapshot = {
      map: structuredClone(fixture.map),
      pokemonSheets: structuredClone([...fixture.pokemonSheets]),
      trainerSheets: structuredClone([...fixture.trainerSheets]),
    }
    expect(() => planAuthoritativeMoveState({
      ...fixture,
      random: () => { throw new Error('Illegal Fake Out must not draw randomness.') },
      now: () => 5_000,
      operationId: 'op_fake_out_rejected',
    })).toThrowError(expect.objectContaining({ code: 'execution-rejected' }))
    expect(fixture.map).toEqual(snapshot.map)
    expect([...fixture.pokemonSheets]).toEqual(snapshot.pokemonSheets)
    expect([...fixture.trainerSheets]).toEqual(snapshot.trainerSheets)
    expect(fixture.map.encounterState).not.toEqual(createEmptyEncounterState())
  })
})
