import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import legacyFingerprintsJson from '../../data/move-automation/legacy-v1-fingerprints.json'
import type { MoveAutomationManifest } from '#shared/moveAutomation/manifest'
import type {
  MoveResolutionAuditTraceEvent,
  MoveResolutionOperationTraceEvent,
} from '#shared/moveAutomation/trace'
import {
  allSwordsDanceV2SemanticScenarios,
  swordsDanceV2Fixture,
  swordsDanceV2ScenarioDefinition,
  SWORDS_DANCE_V2_SEMANTIC_SCENARIOS,
} from '../fixtures/moveAutomation/swordsDanceV2'
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
  SWORDS_DANCE_MOVE_SPEC,
} from '~~/server/domain/moveAutomation/specs/swordsDance'
import {
  EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
} from '~/utils/move-automation/registry'

const swordsDanceRow = manifestJson.moves.find(row => row.canonicalId === 'Swords Dance')!
const swordsDanceLegacy = legacyFingerprintsJson.entries
  .find(entry => entry.canonicalId === 'Swords Dance')!

const runtimeRegistry = (kind: 'legacy-v1' | 'movespec-v2') => {
  const manifest = structuredClone(manifestJson) as unknown as MoveAutomationManifest
  const row = manifest.moves.find(item => item.canonicalId === 'Swords Dance')!
  if (kind === 'legacy-v1') {
    ;(row as { runtime: unknown }).runtime = {
      kind,
      version: swordsDanceLegacy.version,
      definitionHash: swordsDanceLegacy.definitionHash,
      sourceModule: swordsDanceLegacy.sourceModule,
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

describe('Swords Dance native MoveSpec v2', () => {
  it('selects the reviewed self-stage definition and links its cap scenarios', () => {
    expect(swordsDanceRow.runtime).toEqual({
      kind: 'movespec-v2',
      version: 2,
      definitionHash: '13e08b63cd5ca691be81797b54d5c55616a5de2f3a28b25f1bd7084b8b31ac5c',
      sourceModule: 'server/domain/moveAutomation/specs/swordsDance.ts',
    })
    expect(swordsDanceRow.scenarioIds).toEqual(
      SWORDS_DANCE_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(swordsDanceRow.manualSteps).toEqual([])
    expect(registeredMoveAutomationRuntimeFor('Swords Dance')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: SWORDS_DANCE_MOVE_SPEC },
      definitionHash: swordsDanceRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Swords Dance' }),
    )
  })

  it('shadow-plans every stage-cap branch with the same v1 mechanics', () => {
    for (const { scenarioId } of SWORDS_DANCE_V2_SEMANTIC_SCENARIOS) {
      const fixture = swordsDanceV2Fixture(scenarioId)
      const plan = (kind: 'legacy-v1' | 'movespec-v2') => planAuthoritativeMoveState({
        ...fixture,
        random: createFiniteAuthoritativeMoveRandomStream([]),
        now: () => 5_000,
        operationId: 'op_swordsdanceshadow1',
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
      expect(native.resolution.auditTrace.program.runtimeKind).toBe('movespec-v2')
      expect(legacy.resolution.auditTrace.program.runtimeKind).toBe('legacy-v1')
    }
  })

  it.each(allSwordsDanceV2SemanticScenarios())(
    'proves $scenarioId through interpreter, planner, and accepted command',
    async (scenario) => {
      const definition = swordsDanceV2ScenarioDefinition(scenario.scenarioId as (
        typeof SWORDS_DANCE_V2_SEMANTIC_SCENARIOS
      )[number]['scenarioId'])
      const result = await runAndAssertMoveAutomationSemanticScenario(scenario)

      expect([
        result.interpreter.status,
        result.plan.status,
        result.command.status,
      ]).toEqual(['completed', 'completed', 'completed'])
      expect(result.committedDocuments.operationResult).toEqual(result.command.value?.result)

      const stage = operationEvent(
        result.traces.plan?.events,
        'swords-dance.raise-attack',
      )
      expect(stage).toMatchObject({
        outcome: definition.operationOutcome,
        result: {
          recipients: [{
            reasonCode: definition.operationOutcome === 'no-op'
              ? 'combat-stage-unchanged'
              : 'swords-dance.raise-attack',
            details: {
              changes: [{
                stage: 'atk',
                previous: definition.initialAttack,
                unboundedRequested: definition.initialAttack + 2,
                requested: definition.expectedAttack,
                current: definition.expectedAttack,
                appliedDelta: definition.expectedAppliedDelta,
                capped: definition.capped,
                outcome: definition.operationOutcome,
              }],
            },
          }],
        },
      })

      if (definition.operationOutcome === 'no-op') {
        expect(result.plan.value?.sheetWrites).toEqual([])
        expect(result.plan.value?.stateChanges.changes).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ kind: 'sheet-state' })]),
        )
      }
      else {
        expect(result.plan.value?.stateChanges.changes).toEqual(
          expect.arrayContaining([expect.objectContaining({
            kind: 'sheet-state',
            sourceOperationId: 'swords-dance.raise-attack',
          })]),
        )
      }
    },
  )
})
