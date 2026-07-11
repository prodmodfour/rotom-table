import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import type {
  MoveResolutionAuditTraceEvent,
  MoveResolutionOperationTraceEvent,
} from '#shared/moveAutomation/trace'
import {
  allStrikeCanaryV2SemanticScenarios,
  DOUBLE_KICK_V2_SEMANTIC_SCENARIOS,
  FURY_ATTACK_V2_SEMANTIC_SCENARIOS,
  strikeCanaryV2ScenarioDefinition,
  type StrikeCanaryV2SemanticScenarioId,
} from '../fixtures/moveAutomation/strikeCanariesV2'
import {
  runAndAssertMoveAutomationSemanticScenario,
} from '../fixtures/moveAutomation/scenario'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import {
  DOUBLE_KICK_MOVE_SPEC,
} from '~~/server/domain/moveAutomation/specs/doubleKick'
import {
  FURY_ATTACK_MOVE_SPEC,
} from '~~/server/domain/moveAutomation/specs/furyAttack'

const rowFor = (canonicalId: 'Double Kick' | 'Fury Attack') => (
  manifestJson.moves.find(row => row.canonicalId === canonicalId)!
)

const operationEvent = (
  events: readonly MoveResolutionAuditTraceEvent[] | undefined,
  operationId: string,
): MoveResolutionOperationTraceEvent | undefined => events?.find(
  (event): event is MoveResolutionOperationTraceEvent => (
    event.kind === 'operation' && event.operationId === operationId
  ),
)

describe('Double Kick and Fury Attack native MoveSpec v2 canaries', () => {
  it('selects both reviewed strike definitions and links their semantic evidence', () => {
    const expected = [{
      canonicalId: 'Double Kick' as const,
      definitionHash: '6deeebee2b386656defd0c033642ec4c8a4cfd9d974e014a21f56d99f6cc4f89',
      sourceModule: 'server/domain/moveAutomation/specs/doubleKick.ts',
      spec: DOUBLE_KICK_MOVE_SPEC,
      scenarios: DOUBLE_KICK_V2_SEMANTIC_SCENARIOS,
    }, {
      canonicalId: 'Fury Attack' as const,
      definitionHash: 'b159369dcfed9ec8f6de6b542634eaeb40dcf28f59a93ea64f552458e314e13f',
      sourceModule: 'server/domain/moveAutomation/specs/furyAttack.ts',
      spec: FURY_ATTACK_MOVE_SPEC,
      scenarios: FURY_ATTACK_V2_SEMANTIC_SCENARIOS,
    }]

    for (const definition of expected) {
      const row = rowFor(definition.canonicalId)
      expect(row.runtime).toEqual({
        kind: 'movespec-v2',
        version: 2,
        definitionHash: definition.definitionHash,
        sourceModule: definition.sourceModule,
      })
      expect(row.scenarioIds).toEqual(
        definition.scenarios.map(({ scenarioId }) => scenarioId),
      )
      expect(row.blockerCodes).toEqual([])
      expect(row.manualSteps).toEqual([])
      expect(row.limitations).toEqual([{
        code: 'audit.required',
        summary: 'Semantic conformance review is required before this native implementation can be marked complete.',
      }])
      expect(registeredMoveAutomationRuntimeFor(definition.canonicalId)).toMatchObject({
        kind: 'movespec-v2',
        definition: { spec: definition.spec },
        definitionHash: definition.definitionHash,
      })
      expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
        expect.objectContaining({ canonicalId: definition.canonicalId }),
      )
    }

    expect(DOUBLE_KICK_MOVE_SPEC.phases[0]?.operations[0]).toMatchObject({
      kind: 'multi-hit',
      payload: {
        count: { kind: 'fixed', hits: 2 },
        accuracy: { kind: 'per-hit', stopOnMiss: false },
        critical: { kind: 'accuracy' },
      },
    })
    expect(FURY_ATTACK_MOVE_SPEC.phases[0]?.operations[0]).toMatchObject({
      kind: 'multi-hit',
      payload: {
        count: {
          kind: 'table',
          drawFormula: { kind: 'dice', count: 1, sides: 8, modifier: 0 },
          entries: [
            { minimum: 1, maximum: 1, hits: 1 },
            { minimum: 2, maximum: 3, hits: 2 },
            { minimum: 4, maximum: 6, hits: 3 },
            { minimum: 7, maximum: 7, hits: 4 },
            { minimum: 8, maximum: 8, hits: 5 },
          ],
        },
        accuracy: { kind: 'once' },
        critical: { kind: 'per-hit' },
      },
    })
  })

  it.each(allStrikeCanaryV2SemanticScenarios())(
    'proves $scenarioId through interpreter, planner, and accepted command',
    async (scenario) => {
      const definition = strikeCanaryV2ScenarioDefinition(
        scenario.scenarioId as StrikeCanaryV2SemanticScenarioId,
      )
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
      expect(result.plan.value?.resolution.script.dynamicDamageBase).toBeUndefined()
      expect(result.plan.value?.resolution.script.automationNotes).toEqual([])

      const execution = result.interpreter.value?.multiHitExecutions[0]
      expect(result.interpreter.value?.multiHitExecutions).toHaveLength(1)
      expect(execution).toBeDefined()
      if (!execution) throw new Error('Expected one multi-hit execution.')

      const target = execution.resolution.targets[0]
      expect(execution.operationId).toBe(definition.multiHitOperationId)
      expect(execution.outcome).toBe(definition.operationOutcome)
      expect(execution.resolution).toMatchObject({
        totalAttemptedHitCount: definition.attemptedHitCount,
        totalSuccessfulHitCount: definition.successfulHitCount,
        stoppedForKnockout: definition.stopReason === 'knockout',
      })
      expect(target).toMatchObject({
        targetId: 'target-token',
        plannedHitCount: definition.plannedHitCount,
        attemptedHitCount: definition.attemptedHitCount,
        successfulHitCount: definition.successfulHitCount,
        missedHitCount: definition.missedHitCount,
        stopReason: definition.stopReason,
      })
      expect(target?.strikes.map(strike => strike.hitIndex)).toEqual(
        Array.from({ length: definition.attemptedHitCount }, (_, index) => index + 1),
      )
      expect(target?.strikes.filter(strike => strike.accuracy.hit)).toHaveLength(
        definition.successfulHitCount,
      )
      expect(target?.strikes.filter(strike => !strike.accuracy.hit)).toHaveLength(
        definition.missedHitCount,
      )
      expect(target?.strikes.filter(strike => strike.damage?.criticalHit.critical)
        .map(strike => strike.hitIndex)).toEqual(definition.criticalHitIndexes)
      for (const strike of target?.strikes ?? []) {
        expect(strike.damage === null).toBe(!strike.accuracy.hit)
      }

      const strikeDamage = target?.strikes.flatMap(strike => (
        strike.damage === null ? [] : [strike.damage]
      )) ?? []
      expect(target?.totalRequestedHpLoss).toBe(
        strikeDamage.reduce((total, damage) => total + damage.requestedHpLoss, 0),
      )
      expect(target?.totalEffectiveHpLost).toBe(
        strikeDamage.reduce((total, damage) => total + damage.effectiveHpLost, 0),
      )
      expect(execution.resolution.totalEffectiveHpLost).toBe(target?.totalEffectiveHpLost)
      const expectedDamageBase = definition.moveName === 'Double Kick' ? 5 : 4
      const expectedDamageFormula = definition.moveName === 'Double Kick'
        ? { kind: 'dice', count: 1, sides: 8, modifier: 8 }
        : { kind: 'dice', count: 1, sides: 8, modifier: 6 }
      expect(strikeDamage.map(damage => damage.damagePipeline?.damageBase)).toEqual(
        Array.from(
          { length: definition.successfulHitCount },
          () => definition.operationOutcome === 'prevented' ? undefined : expectedDamageBase,
        ),
      )
      const damageRollIds = new Set(execution.resolvedRolls
        .filter(roll => roll.purpose === 'damage')
        .map(roll => roll.rollId))
      expect(execution.rollLedgerEntries
        .filter(roll => damageRollIds.has(roll.rollId))
        .map(roll => roll.formula)).toEqual(
        Array.from({ length: definition.successfulHitCount }, () => expectedDamageFormula),
      )
      expect(result.plan.value?.resolution.rollLedger.map(roll => roll.rollId)).toEqual(
        definition.expectedRollIds,
      )
      expect(result.command.value?.move?.rollLedger.map(roll => roll.rollId)).toEqual(
        definition.expectedRollIds,
      )

      const planEvent = operationEvent(
        result.traces.plan?.events,
        definition.multiHitOperationId,
      )
      const commandEvent = result.traces.command?.events.find(event => (
        event.kind === 'operation'
        && event.operationId === definition.multiHitOperationId
      ))
      expect(planEvent).toMatchObject({
        operationKind: 'multi-hit',
        outcome: definition.operationOutcome,
        result: {
          totalAttemptedHitCount: definition.attemptedHitCount,
          totalSuccessfulHitCount: definition.successfulHitCount,
          targets: [{
            plannedHitCount: definition.plannedHitCount,
            attemptedHitCount: definition.attemptedHitCount,
            successfulHitCount: definition.successfulHitCount,
            missedHitCount: definition.missedHitCount,
            stopReason: definition.stopReason,
          }],
        },
      })
      // Public accepted traces intentionally omit server-only operation payloads
      // while retaining the operation outcome and the durable roll ledger.
      expect(commandEvent).toMatchObject({
        operationKind: 'multi-hit',
        outcome: definition.operationOutcome,
      })
      expect(commandEvent).not.toHaveProperty('result')

      const initialTargetHp = scenario.initialState.pokemonSheets.get('target')?.combat?.currentHp
      const committedTarget = result.committedDocuments.sheets.pokemon.target
      if (definition.targetWritten) {
        const hpUpdate = result.plan.value?.resolution.transaction.hpUpdates[0]
        expect(hpUpdate?.id).toBe('target-token')
        expect(committedTarget?.combat).toMatchObject({ currentHp: hpUpdate?.currentHp })
        expect(Number(initialTargetHp) - Number(hpUpdate?.currentHp)).toBe(
          target?.totalEffectiveHpLost,
        )
      }
      else {
        expect(result.plan.value?.resolution.transaction.hpUpdates).toEqual([])
        expect(committedTarget?.combat).toMatchObject({ currentHp: initialTargetHp })
      }

      if (definition.moveName === 'Double Kick') {
        expect(execution.resolution.countKind).toBe('fixed')
        expect(execution.resolution.countScope).toBe('fixed')
        expect(target?.hitCountRollId).toBeNull()
        expect(target?.strikes.every(strike => strike.criticalRollId === null)).toBe(true)
      }
      else {
        expect(execution.resolution.countKind).toBe('table')
        expect(execution.resolution.countScope).toBe('sequence')
        expect(target?.hitCountRollId).toBe(
          definition.plannedHitCount === null ? null : 'fury-attack.hit-count-roll',
        )
        expect(target?.strikes.filter(strike => strike.accuracy.hit)
          .every(strike => strike.criticalRollId !== null)).toBe(true)
      }

      if (definition.operationOutcome === 'prevented') {
        expect(strikeDamage.every(damage => damage.outcome === 'prevented')).toBe(true)
        expect(target?.totalEffectiveHpLost).toBe(0)
      }
      if (definition.stopReason === 'knockout') {
        expect(target?.strikes.at(-1)).toMatchObject({
          knockout: true,
          stoppedAfterStrike: true,
        })
        expect(result.plan.value?.resolution.transaction.hpUpdates[0]?.currentHp)
          .toBeLessThanOrEqual(0)
      }
    },
  )
})
