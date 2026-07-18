import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import type {
  MoveResolutionAuditTraceEvent,
  MoveResolutionOperationTraceEvent,
} from '#shared/moveAutomation/trace'
import {
  allStrikeCanaryV2SemanticScenarios,
  PIN_MISSILE_V2_SEMANTIC_SCENARIOS,
  strikeCanaryV2MoveDefinition,
  strikeCanaryV2ScenarioDefinition,
  type StrikeCanaryMoveName,
  type StrikeCanaryV2SemanticScenarioId,
} from '../fixtures/moveAutomation/strikeCanariesV2'
import {
  runAndAssertMoveAutomationSemanticScenario,
} from '../fixtures/moveAutomation/scenario'
import {
  DOUBLE_KICK_REG_007_SCENARIOS,
} from '../fixtures/moveAutomation/registeredBatch007'
import {
  FURY_ATTACK_REG_011_SCENARIOS,
  FURY_SWIPES_REG_011_SCENARIOS,
} from '../fixtures/moveAutomation/registeredBatch011'
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
import {
  FURY_SWIPES_MOVE_SPEC,
} from '~~/server/domain/moveAutomation/specs/furySwipes'
import {
  PIN_MISSILE_MOVE_SPEC,
} from '~~/server/domain/moveAutomation/specs/pinMissile'

const rowFor = (canonicalId: StrikeCanaryMoveName) => (
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

describe('registered Double Strike and Five Strike native MoveSpec v2 family', () => {
  it('selects every reviewed strike definition and links complete semantic evidence', () => {
    const expected = [{
      canonicalId: 'Double Kick' as const,
      definitionHash: 'cf35c000a7ef3dc5e74582eebd1ddb48162ad53adc6672ee32cb58c07f3f59e9',
      sourceModule: 'server/domain/moveAutomation/specs/doubleKick.ts',
      spec: DOUBLE_KICK_MOVE_SPEC,
      scenarios: DOUBLE_KICK_REG_007_SCENARIOS,
    }, {
      canonicalId: 'Fury Attack' as const,
      definitionHash: 'e8bf4e7a91905f9927b6393e5ce174d1adaa72538253e96c9f34315f31674f79',
      sourceModule: 'server/domain/moveAutomation/specs/furyAttack.ts',
      spec: FURY_ATTACK_MOVE_SPEC,
      scenarios: FURY_ATTACK_REG_011_SCENARIOS,
    }, {
      canonicalId: 'Fury Swipes' as const,
      definitionHash: '64fbaa4edfe28d03340942b6fa407f04423b13e322a00465a7761220169060a9',
      sourceModule: 'server/domain/moveAutomation/specs/furySwipes.ts',
      spec: FURY_SWIPES_MOVE_SPEC,
      scenarios: FURY_SWIPES_REG_011_SCENARIOS,
    }, {
      canonicalId: 'Pin Missile' as const,
      definitionHash: '2b01a38a8551175e51fd0566971fa20ff17f8802ffa1f0cf14a1c7e81c677164',
      sourceModule: 'server/domain/moveAutomation/specs/pinMissile.ts',
      spec: PIN_MISSILE_MOVE_SPEC,
      scenarios: PIN_MISSILE_V2_SEMANTIC_SCENARIOS,
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
      expect(row.baseStatus).toBe('complete')
      expect(row.blockerCodes).toEqual([])
      expect(row.manualSteps).toEqual([])
      expect(row.limitations).toEqual([])
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
    for (const spec of [
      FURY_ATTACK_MOVE_SPEC,
      FURY_SWIPES_MOVE_SPEC,
      PIN_MISSILE_MOVE_SPEC,
    ]) {
      expect(spec.phases[0]?.operations[0]).toMatchObject({
        kind: 'multi-hit',
        payload: {
          count: {
            kind: 'table',
            scope: 'sequence',
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
          effects: [],
        },
      })
    }
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
      const moveDefinition = strikeCanaryV2MoveDefinition(definition.moveName)
      const expectedDamageBase = moveDefinition.expectedDamageBase
      const expectedDamageFormula = moveDefinition.expectedDamageFormula
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
          definition.plannedHitCount === null ? null : moveDefinition.hitCountRollId,
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
