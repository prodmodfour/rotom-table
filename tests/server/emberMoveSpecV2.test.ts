import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import legacyFingerprintsJson from '../../data/move-automation/legacy-v1-fingerprints.json'
import type { MoveAutomationManifest } from '#shared/moveAutomation/manifest'
import type {
  MoveResolutionAuditTraceEvent,
  MoveResolutionOperationTraceEvent,
} from '#shared/moveAutomation/trace'
import {
  allEmberV2SemanticScenarios,
  emberV2Fixture,
  EMBER_V2_SEMANTIC_SCENARIOS,
} from '../fixtures/moveAutomation/emberV2'
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
import { EMBER_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/ember'
import {
  EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
} from '~/utils/move-automation/registry'

const emberRow = manifestJson.moves.find(row => row.canonicalId === 'Ember')!
const emberLegacy = legacyFingerprintsJson.entries
  .find(entry => entry.canonicalId === 'Ember')!

const runtimeRegistry = (kind: 'legacy-v1' | 'movespec-v2') => {
  const manifest = structuredClone(manifestJson) as unknown as MoveAutomationManifest
  const row = manifest.moves.find(item => item.canonicalId === 'Ember')!
  if (kind === 'legacy-v1') {
    ;(row as { runtime: unknown }).runtime = {
      kind,
      version: emberLegacy.version,
      definitionHash: emberLegacy.definitionHash,
      sourceModule: emberLegacy.sourceModule,
    }
  }
  return createMoveAutomationRuntimeRegistry({
    manifest,
    legacySources: EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
    moveSpecs: REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
  })
}

const operationEvent = (
  events: readonly MoveResolutionAuditTraceEvent[] | undefined,
  operationId: string,
): MoveResolutionOperationTraceEvent | undefined => events?.find((event): event is MoveResolutionOperationTraceEvent => (
  event.kind === 'operation' && event.operationId === operationId
))

describe('Ember native MoveSpec v2', () => {
  it('selects the reviewed native definition and links every semantic scenario', () => {
    expect(emberRow.runtime).toEqual({
      kind: 'movespec-v2',
      version: 2,
      definitionHash: '3c94f42831d1b0113ae53576c9ad2c84efb06529beb718b8f6c50c527583266f',
      sourceModule: 'server/domain/moveAutomation/specs/ember.ts',
    })
    expect(emberRow.scenarioIds).toEqual(
      EMBER_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(emberRow.manualSteps).toEqual([])
    expect(registeredMoveAutomationRuntimeFor('Ember')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: EMBER_MOVE_SPEC },
      definitionHash: emberRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Ember' }),
    )
  })

  it('shadow-plans every reviewed branch with v1 parity before native selection', () => {
    for (const { scenarioId } of EMBER_V2_SEMANTIC_SCENARIOS) {
      const fixture = emberV2Fixture(scenarioId)
      const plan = (kind: 'legacy-v1' | 'movespec-v2') => planAuthoritativeMoveState({
        ...fixture,
        random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
        now: () => 5_000,
        operationId: `op_shadow${kind === 'legacy-v1' ? 'legacy' : 'native'}`,
        runtimeRegistry: runtimeRegistry(kind),
      })
      const legacy = plan('legacy-v1')
      const native = plan('movespec-v2')

      expect(native.resolution.transaction.attackedTargetIds)
        .toEqual(legacy.resolution.transaction.attackedTargetIds)
      expect(native.resolution.transaction.hitTargetIds)
        .toEqual(legacy.resolution.transaction.hitTargetIds)
      expect(native.resolution.transaction.hpUpdates.map(({ id, currentHp }) => ({ id, currentHp })))
        .toEqual(legacy.resolution.transaction.hpUpdates.map(({ id, currentHp }) => ({ id, currentHp })))
      expect(native.resolution.transaction.conditionUpdates)
        .toEqual(legacy.resolution.transaction.conditionUpdates)
      expect(native.sheetWrites).toEqual(legacy.sheetWrites)
      expect(native.resolution.auditTrace.program.runtimeKind).toBe('movespec-v2')
      expect(legacy.resolution.auditTrace.program.runtimeKind).toBe('legacy-v1')
    }
  })

  it('keeps damage while Shield Dust prevents the accuracy-triggered Burn', () => {
    const fixture = emberV2Fixture('ember.v2-threshold-pass')
    const target = structuredClone(fixture.pokemonSheets.get('target')!)
    target.abilities = [{ name: 'Shield Dust' }]
    const plan = planAuthoritativeMoveState({
      ...fixture,
      pokemonSheets: new Map([
        ...fixture.pokemonSheets,
        ['target', target],
      ]),
      random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
      now: () => 5_000,
      operationId: 'op_embershielddust1',
    })

    expect(plan.resolution.transaction.hpUpdates.map(({ id, currentHp }) => ({ id, currentHp })))
      .toEqual([{ id: 'target-token', currentHp: 77 }])
    expect(plan.resolution.transaction.conditionUpdates).toEqual([])
    expect(operationEvent(plan.resolution.auditTrace.events, 'ember.burn')).toMatchObject({
      outcome: 'prevented',
      result: {
        recipients: [{
          reasonCode: 'condition-immunity',
          blockers: [{ subject: 'Burned', source: 'Shield Dust' }],
        }],
      },
    })
  })

  it('rejects an out-of-range target before native rolls or mutations', () => {
    const fixture = emberV2Fixture('ember.v2-threshold-pass')
    const map = structuredClone(fixture.map)
    map.dimensions = { x: 12, y: 3, z: 4 }
    map.placements[1]!.position = { x: 10, y: 0, z: 1 }

    expect(() => planAuthoritativeMoveState({
      ...fixture,
      map,
      random: () => { throw new Error('out-of-range Ember must not roll') },
      now: () => 5_000,
      operationId: 'op_emberoutofrange1',
    })).toThrowError(expect.objectContaining({
      code: 'target-out-of-range',
      reason: 'invalid',
    }))
  })

  it.each(allEmberV2SemanticScenarios())(
    'proves $scenarioId through interpreter, planner, and accepted command',
    async (scenario) => {
      const result = await runAndAssertMoveAutomationSemanticScenario(scenario)

      expect([
        result.interpreter.status,
        result.plan.status,
        result.command.status,
      ]).toEqual(['completed', 'completed', 'completed'])
      expect(result.committedDocuments.operationResult).toEqual(result.command.value?.result)

      const planBurn = operationEvent(result.traces.plan?.events, 'ember.burn')
      if (scenario.scenarioId === 'ember.v2-threshold-fail') {
        expect(planBurn).toMatchObject({
          outcome: 'no-op',
          result: {
            recipients: [{
              reasonCode: 'condition-accuracy-roll-trigger-not-met',
              details: {
                accuracyRollTrigger: {
                  naturalResult: 17,
                  matched: false,
                },
              },
            }],
          },
        })
      }
      if (scenario.scenarioId === 'ember.v2-threshold-pass') {
        expect(planBurn).toMatchObject({
          outcome: 'applied',
          result: {
            recipients: [{
              details: {
                accuracyRollTrigger: {
                  naturalResult: 18,
                  matched: true,
                },
              },
            }],
          },
        })
      }
      if (scenario.scenarioId === 'ember.v2-burn-immunity') {
        expect(planBurn).toMatchObject({
          outcome: 'prevented',
          result: {
            recipients: [{
              reasonCode: 'condition-immunity',
              blockers: [{ subject: 'Burned', source: 'Fire type' }],
            }],
          },
        })
      }
      if (scenario.scenarioId === 'ember.v2-critical-hit') {
        expect(operationEvent(result.traces.plan?.events, 'ember.damage')).toMatchObject({
          outcome: 'applied',
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
      if (scenario.scenarioId === 'ember.v2-miss') {
        expect(result.plan.value?.sheetWrites).toEqual([])
        expect(result.plan.value?.resolution.rollLedger).toHaveLength(1)
      }
    },
  )
})
