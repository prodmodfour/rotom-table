import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import legacyFingerprintsJson from '../../data/move-automation/legacy-v1-fingerprints.json'
import type { MoveAutomationManifest } from '#shared/moveAutomation/manifest'
import type {
  MoveResolutionAuditTraceEvent,
  MoveResolutionOperationTraceEvent,
} from '#shared/moveAutomation/trace'
import {
  ABSORB_V2_SEMANTIC_SCENARIOS,
  absorbV2Fixture,
  absorbV2ScenarioDefinition,
  allAbsorbV2SemanticScenarios,
} from '../fixtures/moveAutomation/absorbV2'
import {
  runAndAssertMoveAutomationSemanticScenario,
} from '../fixtures/moveAutomation/scenario'
import { ABSORB_REG_001_SCENARIOS } from '../fixtures/moveAutomation/registeredBatch001'
import { planAuthoritativeMoveState } from '~~/server/domain/planAuthoritativeMoveState'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import {
  createMoveAutomationRuntimeRegistry,
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import { ABSORB_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/absorb'
import {
  EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
} from '~/utils/move-automation/registry'

const absorbRow = manifestJson.moves.find(row => row.canonicalId === 'Absorb')!
const absorbLegacy = legacyFingerprintsJson.entries
  .find(entry => entry.canonicalId === 'Absorb')!

const runtimeRegistry = (kind: 'legacy-v1' | 'movespec-v2') => {
  const manifest = structuredClone(manifestJson) as unknown as MoveAutomationManifest
  const row = manifest.moves.find(item => item.canonicalId === 'Absorb')!
  if (kind === 'legacy-v1') {
    ;(row as { runtime: unknown }).runtime = {
      kind,
      version: absorbLegacy.version,
      definitionHash: absorbLegacy.definitionHash,
      sourceModule: absorbLegacy.sourceModule,
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

describe('Absorb native MoveSpec v2', () => {
  it('selects the reviewed drain definition and links every semantic scenario', () => {
    expect(absorbRow.runtime).toEqual({
      kind: 'movespec-v2',
      version: 2,
      definitionHash: 'c5ae83a53d77a7e7bef30c6990938d51cd834eec699c50e692f5190ceccb359d',
      sourceModule: 'server/domain/moveAutomation/specs/absorb.ts',
    })
    expect(absorbRow.scenarioIds).toEqual(
      ABSORB_REG_001_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(absorbRow.manualSteps).toEqual([])
    expect(registeredMoveAutomationRuntimeFor('Absorb')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: ABSORB_MOVE_SPEC },
      definitionHash: absorbRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Absorb' }),
    )
  })

  it('shadow-plans mitigation, immunity, temporary HP, KO, and cap branches with v1 parity', () => {
    for (const { scenarioId } of ABSORB_V2_SEMANTIC_SCENARIOS) {
      const fixture = absorbV2Fixture(scenarioId)
      const plan = (kind: 'legacy-v1' | 'movespec-v2') => planAuthoritativeMoveState({
        ...fixture,
        random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
        now: () => 5_000,
        operationId: 'op_absorbshadow01',
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

  it.each(allAbsorbV2SemanticScenarios())(
    'proves $scenarioId through interpreter, planner, and accepted command',
    async (scenario) => {
      const definition = absorbV2ScenarioDefinition(
        scenario.scenarioId as (typeof ABSORB_V2_SEMANTIC_SCENARIOS)[number]['scenarioId'],
      )
      const result = await runAndAssertMoveAutomationSemanticScenario(scenario)

      expect([
        result.interpreter.status,
        result.plan.status,
        result.command.status,
      ]).toEqual(['completed', 'completed', 'completed'])
      expect(result.committedDocuments.operationResult).toEqual(result.command.value?.result)

      const damage = operationEvent(result.traces.plan?.events, 'absorb.damage')
      const drain = operationEvent(result.traces.plan?.events, 'absorb.drain')
      expect(drain).toMatchObject({
        outcome: definition.drainOutcome,
        result: {
          recipients: [{
            reasonCode: definition.drainReasonCode,
            details: {
              calculation: {
                kind: 'damage-dealt',
                rawValue: definition.effectiveDamage / 2,
                roundedValue: Math.round(definition.effectiveDamage / 2),
                basisValue: definition.effectiveDamage,
                damageSource: {
                  operationId: 'absorb.damage',
                  aggregation: 'aggregate',
                  preventedDamage: 'zero',
                  totalEffectiveHpLost: definition.effectiveDamage,
                },
              },
              previousPoolValue: definition.actorHp,
              appliedPoolValue: definition.expectedActorHp,
            },
          }],
        },
      })

      if (scenario.scenarioId === 'absorb.v2-hit-mitigated') {
        expect(damage).toMatchObject({
          outcome: 'applied',
          result: {
            recipients: [{
              details: {
                requestedHpLoss: 13,
                effectiveHpLost: 13,
                calculation: {
                  damagePipeline: {
                    damageBase: 4,
                    preTypeDamage: 13,
                    hpLoss: 13,
                    stages: expect.arrayContaining([
                      expect.objectContaining({
                        stage: 'attack-stat',
                        input: 7,
                        output: 24,
                      }),
                      expect.objectContaining({
                        stage: 'defense-stat',
                        input: 24,
                        output: 13,
                      }),
                    ]),
                  },
                },
              },
            }],
          },
        })
        expect(result.plan.value?.stateChanges.groups.sheets).toHaveLength(2)
        expect(result.plan.value?.sheetWrites.map(write => write.slug)).toEqual([
          'target',
          'actor',
        ])
      }

      if (scenario.scenarioId === 'absorb.v2-immunity') {
        expect(damage).toMatchObject({
          outcome: 'prevented',
          result: {
            recipients: [{
              reasonCode: 'damage-immunity',
              blockers: [{ subject: 'Grass', source: 'Sap Sipper' }],
            }],
          },
        })
        expect(result.plan.value?.sheetWrites).toEqual([])
      }

      if (scenario.scenarioId === 'absorb.v2-temporary-hp') {
        expect(damage).toMatchObject({
          result: {
            recipients: [{
              details: {
                requestedHpLoss: 13,
                effectiveHpLost: 13,
                realHpLost: 5,
                absorbedByTemporaryHp: 8,
              },
              previous: { currentHp: 50, temporaryHp: 8 },
              current: { currentHp: 45, temporaryHp: 0 },
            }],
          },
        })
        expect(result.plan.value?.nextMap.temporaryHitPoints).toBeUndefined()
      }

      if (scenario.scenarioId === 'absorb.v2-target-ko') {
        expect(result.plan.value?.resolution.transaction.hpUpdates).toEqual([
          expect.objectContaining({ id: 'target-token', currentHp: -8, injuries: 1 }),
          expect.objectContaining({ id: 'actor-token', currentHp: 17 }),
        ])
      }

      if (scenario.scenarioId === 'absorb.v2-full-hp-user') {
        expect(drain).toMatchObject({ outcome: 'no-op' })
        expect(result.plan.value?.sheetWrites.map(write => write.slug)).toEqual(['target'])
      }

      if (scenario.scenarioId === 'absorb.v2-critical-hit') {
        expect(damage).toMatchObject({
          result: {
            recipients: [{
              details: {
                calculation: {
                  criticalHit: { critical: true, naturalRoll: 20 },
                },
              },
            }],
          },
        })
      }

      if (scenario.scenarioId === 'absorb.v2-miss') {
        expect(result.plan.value?.sheetWrites).toEqual([])
        expect(result.plan.value?.resolution.rollLedger).toHaveLength(1)
      }
    },
  )
})
