import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import legacyFingerprintsJson from '../../data/move-automation/legacy-v1-fingerprints.json'
import type { MoveAutomationManifest } from '#shared/moveAutomation/manifest'
import type {
  MoveResolutionAuditTraceEvent,
  MoveResolutionOperationTraceEvent,
} from '#shared/moveAutomation/trace'
import {
  allPowerTripV2SemanticScenarios,
  POWER_TRIP_V2_SEMANTIC_SCENARIOS,
  powerTripV2Fixture,
  powerTripV2ScenarioDefinition,
} from '../fixtures/moveAutomation/powerTripV2'
import {
  runAndAssertMoveAutomationSemanticScenario,
} from '../fixtures/moveAutomation/scenario'
import { planAuthoritativeMoveState } from '~~/server/domain/planAuthoritativeMoveState'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import {
  createMoveAutomationRuntimeRegistry,
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import {
  POWER_TRIP_MOVE_SPEC,
} from '~~/server/domain/moveAutomation/specs/powerTrip'
import {
  EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
} from '~/utils/move-automation/registry'

const powerTripRow = manifestJson.moves.find(row => row.canonicalId === 'Power Trip')!
const powerTripLegacy = legacyFingerprintsJson.entries
  .find(entry => entry.canonicalId === 'Power Trip')!

const runtimeRegistry = (kind: 'legacy-v1' | 'movespec-v2') => {
  const manifest = structuredClone(manifestJson) as unknown as MoveAutomationManifest
  const row = manifest.moves.find(item => item.canonicalId === 'Power Trip')!
  if (kind === 'legacy-v1') {
    ;(row as { runtime: unknown }).runtime = {
      kind,
      version: powerTripLegacy.version,
      definitionHash: powerTripLegacy.definitionHash,
      sourceModule: powerTripLegacy.sourceModule,
    }
  }
  return createMoveAutomationRuntimeRegistry({
    manifest,
    legacySources: EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
    moveSpecs: REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
  })
}

const mechanicsMap = (value: ReturnType<typeof planAuthoritativeMoveState>['nextMap']) => {
  const clone = structuredClone(value)
  delete clone.metadata
  return clone
}

const operationEvent = (
  events: readonly MoveResolutionAuditTraceEvent[] | undefined,
  operationId: string,
): MoveResolutionOperationTraceEvent | undefined => events?.find(
  (event): event is MoveResolutionOperationTraceEvent => (
    event.kind === 'operation' && event.operationId === operationId
  ),
)

describe('Power Trip native MoveSpec v2', () => {
  it('selects the reviewed contextual-DB definition and links every stage scenario', () => {
    expect(powerTripRow.runtime).toEqual({
      kind: 'movespec-v2',
      version: 2,
      definitionHash: '7dedaadc10bffd93abb92c9281410eff4fcde3bc9ffd5c08f56cc5b11a40273c',
      sourceModule: 'server/domain/moveAutomation/specs/powerTrip.ts',
    })
    expect(powerTripRow.scenarioIds).toEqual(
      POWER_TRIP_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(powerTripRow.manualSteps).toEqual([])
    expect(registeredMoveAutomationRuntimeFor('Power Trip')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: POWER_TRIP_MOVE_SPEC },
      definitionHash: powerTripRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Power Trip' }),
    )
  })

  it('shadow-plans zero, mixed, and capped stage totals with v1 mechanical parity', () => {
    for (const { scenarioId } of POWER_TRIP_V2_SEMANTIC_SCENARIOS) {
      const fixture = powerTripV2Fixture(scenarioId)
      const plan = (kind: 'legacy-v1' | 'movespec-v2') => planAuthoritativeMoveState({
        ...fixture,
        random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
        now: () => 5_000,
        operationId: 'op_powertripshadow1',
        runtimeRegistry: runtimeRegistry(kind),
      })
      const legacy = plan('legacy-v1')
      const native = plan('movespec-v2')

      expect(mechanicsMap(native.nextMap)).toEqual(mechanicsMap(legacy.nextMap))
      expect(native.sheetWrites).toEqual(legacy.sheetWrites)
      expect(native.previousUsage).toEqual(legacy.previousUsage)
      expect(native.usage).toEqual(legacy.usage)
      expect(native.resolution.selectedTargetIds).toEqual(legacy.resolution.selectedTargetIds)
      expect(native.resolution.transaction.attackedTargetIds)
        .toEqual(legacy.resolution.transaction.attackedTargetIds)
      expect(native.resolution.transaction.hitTargetIds)
        .toEqual(legacy.resolution.transaction.hitTargetIds)
      const normalizedHpUpdates = (
        updates: typeof native.resolution.transaction.hpUpdates,
      ) => updates.map(update => ({
        id: update.id,
        currentHp: update.currentHp,
        temporaryHp: update.temporaryHp ?? 0,
        injuries: update.injuries ?? 0,
      }))
      expect(normalizedHpUpdates(native.resolution.transaction.hpUpdates))
        .toEqual(normalizedHpUpdates(legacy.resolution.transaction.hpUpdates))
      expect(native.resolution.auditTrace.program.runtimeKind).toBe('movespec-v2')
      expect(legacy.resolution.auditTrace.program.runtimeKind).toBe('legacy-v1')
    }
  })

  it.each(allPowerTripV2SemanticScenarios())(
    'proves $scenarioId through interpreter, planner, and accepted command',
    async (scenario) => {
      const definition = powerTripV2ScenarioDefinition(scenario.scenarioId as (
        typeof POWER_TRIP_V2_SEMANTIC_SCENARIOS
      )[number]['scenarioId'])
      const result = await runAndAssertMoveAutomationSemanticScenario(scenario)

      expect([
        result.interpreter.status,
        result.plan.status,
        result.command.status,
      ]).toEqual(['completed', 'completed', 'completed'])
      expect(result.committedDocuments.operationResult).toEqual(result.command.value?.result)
      expect(result.plan.value?.sheetReads).toEqual([
        { kind: 'pokemon', slug: 'actor', revision: 3 },
        { kind: 'pokemon', slug: 'target', revision: 3 },
      ])

      const contextualDamageBase = result.interpreter.value?.resolvedDamageBases[0]
      expect(contextualDamageBase).toMatchObject({
        operationId: 'power-trip.damage',
        recipientId: 'target-token',
        expressionValue: definition.expressionValue,
        roundedExpressionValue: definition.expressionValue,
        stabTiming: 'after-bounds',
        stabBonus: definition.stabBonus,
        valueBeforeBounds: definition.expressionValue,
        minimum: 2,
        maximum: 20,
        boundedValue: definition.boundedDamageBase,
        finalDamageBase: definition.finalDamageBase,
      })
      expect(contextualDamageBase?.evaluationTrace).toEqual([
        {
          nodeType: 'expression',
          nodeId: 'power-trip.damage.damageBase.target-token.operands.0',
          expressionKind: 'constant',
          value: 2,
        },
        {
          nodeType: 'expression',
          nodeId: 'power-trip.damage.damageBase.target-token.operands.1.operands.0',
          expressionKind: 'combat-stage-total',
          value: definition.positiveStageTotal,
        },
        {
          nodeType: 'expression',
          nodeId: 'power-trip.damage.damageBase.target-token.operands.1.operands.1',
          expressionKind: 'constant',
          value: 2,
        },
        {
          nodeType: 'expression',
          nodeId: 'power-trip.damage.damageBase.target-token.operands.1',
          expressionKind: 'arithmetic',
          value: definition.positiveStageTotal * 2,
        },
        {
          nodeType: 'expression',
          nodeId: 'power-trip.damage.damageBase.target-token',
          expressionKind: 'arithmetic',
          value: definition.expressionValue,
        },
      ])

      const damage = operationEvent(result.traces.plan?.events, 'power-trip.damage')
      expect(damage).toMatchObject({
        outcome: 'applied',
        result: {
          recipients: [{
            details: {
              requestedHpLoss: definition.expectedDamage,
              effectiveHpLost: definition.expectedDamage,
              calculation: {
                contextualDamageBase: {
                  expressionValue: definition.expressionValue,
                  boundedValue: definition.boundedDamageBase,
                  stabBonus: definition.stabBonus,
                  finalDamageBase: definition.finalDamageBase,
                },
                evaluationTrace: contextualDamageBase?.evaluationTrace,
                damagePipeline: {
                  damageBase: definition.finalDamageBase,
                  hpLoss: definition.expectedDamage,
                },
              },
            },
            current: { currentHp: definition.expectedTargetHp },
          }],
        },
      })
      expect(result.plan.value?.resolution.rollLedger[1]).toMatchObject({
        rollId: 'power-trip.damage.roll.1',
        formula: { kind: 'dice', ...definition.damageFormula },
      })
      expect(result.plan.value?.resolution.transaction.hpUpdates).toEqual([
        expect.objectContaining({
          id: 'target-token',
          currentHp: definition.expectedTargetHp,
        }),
      ])

      // The compatibility projection stays at canonical DB (+ STAB when
      // applicable); only the immutable expression derives the final DB.
      expect(result.plan.value?.resolution.script.dynamicDamageBase).toBeUndefined()
      expect(result.plan.value?.resolution.script.damageBase).toBe(
        definition.stabBonus > 0 ? 4 : 2,
      )
    },
  )
})
