import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import legacyFingerprintsJson from '../../data/move-automation/legacy-v1-fingerprints.json'
import { parseResolveMoveIntent } from '#shared/livePlayMoveResolution'
import type { MoveAutomationManifest } from '#shared/moveAutomation/manifest'
import type {
  MoveResolutionAuditTraceEvent,
  MoveResolutionOperationTraceEvent,
} from '#shared/moveAutomation/trace'
import {
  allSynthesisV2SemanticScenarios,
  synthesisV2Fixture,
  synthesisV2ScenarioDefinition,
  SYNTHESIS_V2_SEMANTIC_SCENARIOS,
} from '../fixtures/moveAutomation/synthesisV2'
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
  SYNTHESIS_MOVE_SPEC,
} from '~~/server/domain/moveAutomation/specs/synthesis'
import {
  EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
} from '~/utils/move-automation/registry'

const synthesisRow = manifestJson.moves.find(row => row.canonicalId === 'Synthesis')!
const synthesisLegacy = legacyFingerprintsJson.entries
  .find(entry => entry.canonicalId === 'Synthesis')!

const runtimeRegistry = (kind: 'legacy-v1' | 'movespec-v2') => {
  const manifest = structuredClone(manifestJson) as unknown as MoveAutomationManifest
  const row = manifest.moves.find(item => item.canonicalId === 'Synthesis')!
  if (kind === 'legacy-v1') {
    ;(row as { runtime: unknown }).runtime = {
      kind,
      version: synthesisLegacy.version,
      definitionHash: synthesisLegacy.definitionHash,
      sourceModule: synthesisLegacy.sourceModule,
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

const predicateOutcome = (
  events: readonly MoveResolutionAuditTraceEvent[] | undefined,
  predicateId: string,
): boolean | undefined => events?.find(
  (event): event is Extract<MoveResolutionAuditTraceEvent, { readonly kind: 'predicate' }> => (
    event.kind === 'predicate' && event.predicateId === predicateId
  ),
)?.outcome

describe('Synthesis native MoveSpec v2', () => {
  it('selects the reviewed weather-heal definition and links every branch scenario', () => {
    expect(synthesisRow.runtime).toEqual({
      kind: 'movespec-v2',
      version: 2,
      definitionHash: '6d1c85c81b2e0740f0ebaeda09df2d19daa20f8624fdcc5007ef6d3c56c8c2c4',
      sourceModule: 'server/domain/moveAutomation/specs/synthesis.ts',
    })
    expect(synthesisRow.scenarioIds).toEqual(
      SYNTHESIS_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(synthesisRow.manualSteps).toEqual([])
    expect(registeredMoveAutomationRuntimeFor('Synthesis')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: SYNTHESIS_MOVE_SPEC },
      definitionHash: synthesisRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Synthesis' }),
    )
  })

  it('rejects client-authored HP results instead of treating a UI amount as mechanics', () => {
    const fixture = synthesisV2Fixture('synthesis.v2-sunny')
    const parsed = parseResolveMoveIntent({
      ...fixture.intent,
      hpUpdates: [{ id: 'actor-token', currentHp: 999_999 }],
    })

    expect(parsed.valid).toBe(false)
    expect(parsed.issues).toContainEqual(expect.objectContaining({
      path: 'hpUpdates',
      code: 'forbidden-field',
    }))
  })

  it('shadow-plans every weather and full-HP branch with the same v1 mechanics', () => {
    for (const { scenarioId } of SYNTHESIS_V2_SEMANTIC_SCENARIOS) {
      const fixture = synthesisV2Fixture(scenarioId)
      const plan = (kind: 'legacy-v1' | 'movespec-v2') => planAuthoritativeMoveState({
        ...fixture,
        random: createFiniteAuthoritativeMoveRandomStream([]),
        now: () => 5_000,
        operationId: 'op_synthesisshadow1',
        runtimeRegistry: runtimeRegistry(kind),
      })
      const legacy = plan('legacy-v1')
      const native = plan('movespec-v2')

      expect(mechanicsMap(native.nextMap)).toEqual(mechanicsMap(legacy.nextMap))
      expect(native.sheetWrites).toEqual(legacy.sheetWrites)
      expect(native.previousUsage).toEqual(legacy.previousUsage)
      expect(native.usage).toEqual(legacy.usage)
      expect(native.resolution.selectedTargetIds).toEqual([])
      expect(native.resolution.transaction.attackedTargetIds).toEqual([])
      expect(native.resolution.transaction.hitTargetIds).toEqual([])
      expect(native.resolution.transaction.hpUpdates.map(({ id, currentHp }) => ({ id, currentHp })))
        .toEqual(legacy.resolution.transaction.hpUpdates.map(({ id, currentHp }) => ({ id, currentHp })))
      expect(native.resolution.auditTrace.program.runtimeKind).toBe('movespec-v2')
      expect(legacy.resolution.auditTrace.program.runtimeKind).toBe('legacy-v1')
    }
  })

  it.each(allSynthesisV2SemanticScenarios())(
    'proves $scenarioId through interpreter, planner, and accepted command',
    async (scenario) => {
      const definition = synthesisV2ScenarioDefinition(
        scenario.scenarioId as (typeof SYNTHESIS_V2_SEMANTIC_SCENARIOS)[number]['scenarioId'],
      )
      const result = await runAndAssertMoveAutomationSemanticScenario(scenario)

      expect([
        result.interpreter.status,
        result.plan.status,
        result.command.status,
      ]).toEqual(['completed', 'completed', 'completed'])
      expect(result.committedDocuments.operationResult).toEqual(result.command.value?.result)
      expect(result.plan.value?.resolution.rollLedger).toEqual([])

      const emittedHealIds = result.interpreter.value?.operations
        .filter(({ operation }) => operation.kind === 'heal')
        .map(({ operation }) => operation.id)
      expect(emittedHealIds).toEqual([definition.healOperationId])

      const events = result.traces.plan?.events
      expect(predicateOutcome(events, 'synthesis.weather.sunny'))
        .toBe(definition.weather === 'sunny')
      expect(predicateOutcome(events, 'synthesis.weather.adverse'))
        .toBe(['rainy', 'sandstorm', 'hail'].includes(definition.weather ?? ''))
      expect(predicateOutcome(events, 'synthesis.weather.normal'))
        .toBe(definition.weather === null)

      const heal = operationEvent(events, definition.healOperationId)
      expect(heal).toMatchObject({
        outcome: definition.healOutcome,
        result: {
          recipients: [{
            reasonCode: definition.healOutcome === 'no-op'
              ? 'hp-at-cap'
              : definition.healOperationId,
            details: {
              calculation: {
                kind: 'percent-max',
                roundedValue: definition.expectedHealing,
                basisValue: 99,
              },
              previousPoolValue: definition.initialHp,
              appliedPoolValue: definition.expectedHp,
            },
          }],
        },
      })

      const sheetChanges = result.plan.value?.stateChanges.groups.sheets[0]?.changes
      expect(sheetChanges).toHaveLength(1)
      expect(sheetChanges?.[0]).toMatchObject({
        changedFields: definition.healOutcome === 'applied'
          ? ['moveUsage', 'hp']
          : ['moveUsage'],
        current: {
          revision: 4,
          combat: { currentHp: definition.expectedHp },
          moveUsage: { daily: { synthesis: { uses: 1 } } },
        },
      })
      if (definition.healOutcome === 'applied') {
        expect(sheetChanges?.[0]?.sourceOperationId).toBeNull()
        expect(sheetChanges?.[0]?.reasonCode).toBe('combined-sheet-operations')
      }
    },
  )
})
