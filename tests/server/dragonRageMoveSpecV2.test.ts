import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import legacyFingerprintsJson from '../../data/move-automation/legacy-v1-fingerprints.json'
import type { MoveAutomationManifest } from '#shared/moveAutomation/manifest'
import type {
  MoveResolutionAuditTraceEvent,
  MoveResolutionOperationTraceEvent,
} from '#shared/moveAutomation/trace'
import {
  allDragonRageV2SemanticScenarios,
  dragonRageV2Fixture,
  DRAGON_RAGE_V2_SEMANTIC_SCENARIOS,
} from '../fixtures/moveAutomation/dragonRageV2'
import {
  runAndAssertMoveAutomationSemanticScenario,
} from '../fixtures/moveAutomation/scenario'
import {
  DRAGON_RAGE_REG_007_SCENARIOS,
} from '../fixtures/moveAutomation/registeredBatch007'
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
  DRAGON_RAGE_MOVE_SPEC,
} from '~~/server/domain/moveAutomation/specs/dragonRage'
import {
  EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
} from '~/utils/move-automation/registry'

const dragonRageRow = manifestJson.moves.find(row => row.canonicalId === 'Dragon Rage')!
const dragonRageLegacy = legacyFingerprintsJson.entries
  .find(entry => entry.canonicalId === 'Dragon Rage')!

const runtimeRegistry = (kind: 'legacy-v1' | 'movespec-v2') => {
  const manifest = structuredClone(manifestJson) as unknown as MoveAutomationManifest
  const row = manifest.moves.find(item => item.canonicalId === 'Dragon Rage')!
  if (kind === 'legacy-v1') {
    ;(row as { runtime: unknown }).runtime = {
      kind,
      version: dragonRageLegacy.version,
      definitionHash: dragonRageLegacy.definitionHash,
      sourceModule: dragonRageLegacy.sourceModule,
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
  const history = clone.encounterState?.history
  for (const entry of history?.lastDeclaredMoves ?? []) Reflect.deleteProperty(entry, 'specVersion')
  for (const entry of history?.lastDamagingMovesReceived ?? []) Reflect.deleteProperty(entry, 'specVersion')
  for (const entry of history?.knockouts ?? []) Reflect.deleteProperty(entry, 'specVersion')
  for (const entry of history?.lastCompletedMoves ?? []) {
    Reflect.deleteProperty(entry, 'specVersion')
    Reflect.deleteProperty(entry, 'branches')
  }
  for (const entry of history?.moveUses ?? []) {
    Reflect.deleteProperty(entry, 'specVersion')
    if (entry.completion) Reflect.deleteProperty(entry.completion, 'branches')
  }
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

describe('Dragon Rage native MoveSpec v2', () => {
  it('selects the reviewed fixed-loss definition and links hit, miss, and immunity evidence', () => {
    expect(dragonRageRow.runtime).toEqual({
      kind: 'movespec-v2',
      version: 2,
      definitionHash: '1b839292759057bb26106409afd5c1230ab28c4eb6fe64f28a77d1fe9c9413f7',
      sourceModule: 'server/domain/moveAutomation/specs/dragonRage.ts',
    })
    expect(dragonRageRow.scenarioIds).toEqual(
      DRAGON_RAGE_REG_007_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(dragonRageRow.manualSteps).toEqual([])
    expect(registeredMoveAutomationRuntimeFor('Dragon Rage')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: DRAGON_RAGE_MOVE_SPEC },
      definitionHash: dragonRageRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Dragon Rage' }),
    )
  })

  it('shadow-plans every reviewed branch with the same v1 mechanics', () => {
    for (const { scenarioId } of DRAGON_RAGE_V2_SEMANTIC_SCENARIOS) {
      const fixture = dragonRageV2Fixture(scenarioId)
      const plan = (kind: 'legacy-v1' | 'movespec-v2') => planAuthoritativeMoveState({
        ...fixture,
        random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
        now: () => 5_000,
        operationId: 'op_dragonrageshadow1',
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
      expect(native.resolution.transaction.hpUpdates.map(({ id, currentHp }) => ({ id, currentHp })))
        .toEqual(legacy.resolution.transaction.hpUpdates.map(({ id, currentHp }) => ({ id, currentHp })))
      expect(native.resolution.auditTrace.program.runtimeKind).toBe('movespec-v2')
      expect(legacy.resolution.auditTrace.program.runtimeKind).toBe('legacy-v1')
    }
  }, 15_000)

  it.each(allDragonRageV2SemanticScenarios())(
    'proves $scenarioId through interpreter, planner, and accepted command',
    async (scenario) => {
      const result = await runAndAssertMoveAutomationSemanticScenario(scenario)

      expect([
        result.interpreter.status,
        result.plan.status,
        result.command.status,
      ]).toEqual(['completed', 'completed', 'completed'])
      expect(result.committedDocuments.operationResult).toEqual(result.command.value?.result)
      expect(result.plan.value?.resolution.rollLedger).toEqual([
        expect.objectContaining({
          rollId: 'dragon-rage.accuracy-roll.1',
          parentEffectId: 'dragon-rage.accuracy',
        }),
      ])
      expect(result.traces.plan?.events.some(event => (
        event.kind === 'operation' && event.operationKind === 'damage'
      ))).toBe(false)

      const directHp = operationEvent(
        result.traces.plan?.events,
        'dragon-rage.fixed-hp-loss',
      )
      if (scenario.scenarioId === 'dragon-rage.v2-hit') {
        expect(scenario.initialState.pokemonSheets.get('target')).toMatchObject({
          types: ['Dragon'],
          stats: { sdef: { added: 100, stage: 6 } },
        })
        expect(result.plan.value?.resolution.rollLedger[0]).toMatchObject({
          naturalResult: 20,
        })
        expect(directHp).toMatchObject({
          outcome: 'applied',
          result: {
            recipients: [{
              reasonCode: 'dragon-rage.fixed-hp-loss',
              details: {
                calculation: {
                  kind: 'fixed',
                  rawValue: 15,
                  roundedValue: 15,
                },
                injury: {
                  policy: { massiveDamage: 'never' },
                  massiveDamageInjuries: 0,
                },
              },
            }],
          },
        })
        expect(JSON.stringify(directHp)).not.toContain('criticalHit')
      }
      if (scenario.scenarioId === 'dragon-rage.v2-immunity') {
        expect(result.plan.value?.sheetWrites).toEqual([])
        expect(directHp).toMatchObject({
          outcome: 'prevented',
          result: {
            recipients: [{
              reasonCode: 'type-immunity',
              blockers: [{ source: 'Dragon type' }],
            }],
          },
        })
      }
      if (scenario.scenarioId === 'dragon-rage.v2-miss') {
        expect(result.plan.value?.sheetWrites).toEqual([])
        expect(directHp).toMatchObject({
          outcome: 'no-op',
          recipientIds: [],
          result: { recipients: [] },
        })
      }
    },
  )
})
