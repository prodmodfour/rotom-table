import { describe, expect, it } from 'vitest'
import {
  parseMoveEffectOperation,
  type MoveCombatStageEffectOperation,
  type MoveMultiHitEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveResolutionAuditTrace } from '#shared/moveAutomation/trace'
import {
  evaluateMoveSelector,
  type MoveRuleSelectorState,
} from '~~/server/domain/moveAutomation/evaluateExpression'
import { executeMoveSpec } from '~~/server/domain/moveAutomation/executeSpec'
import {
  reduceMoveCoreTokenOperationState,
} from '~~/server/domain/moveAutomation/reducers/coreTokenEffects'
import type {
  MoveCoreTokenDynamicRecipientSets,
  MoveResolvedCoreTokenEffectOperation,
} from '~~/server/domain/moveAutomation/reducers/coreTokenEffectTypes'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import {
  NEVER_PREVENT_CORE_TOKEN_EFFECTS,
  MECHANICS_PROPERTY_PLACEMENT_ORDER,
  MECHANICS_PROPERTY_TARGET_IDS,
  buildMechanicsPropertyContext,
  createDeterministicPropertyGenerator,
} from '../fixtures/moveAutomation/mechanicsProperties'

const canonicalIds = (
  ids: ReadonlySet<string>,
): string[] => MECHANICS_PROPERTY_PLACEMENT_ORDER.filter(id => ids.has(id))

const generatedTargetSubset = (
  mask: number,
): string[] => MECHANICS_PROPERTY_TARGET_IDS.filter((_id, index) => (
  (mask & (1 << index)) !== 0
))

const selectorState = (options: {
  readonly attacked: readonly string[]
  readonly hit: readonly string[]
}): MoveRuleSelectorState => ({
  targetIds: options.attacked,
  hitTargetIds: options.hit,
  missedTargetIds: options.attacked.filter(id => !options.hit.includes(id)),
  damagedTargetIds: options.hit,
  faintedTargetIds: [],
})

const stageOperation = (): MoveCombatStageEffectOperation => {
  const operation = parseMoveEffectOperation({
    id: 'operation.property-recipients',
    kind: 'combat-stage',
    source: { kind: 'move', id: 'move.property-test' },
    recipients: { kind: 'hit-targets' },
    phase: 'hit',
    reasonCode: 'move.property-test.recipients',
    payload: {
      action: 'modify',
      stage: 'atk',
      selectedStage: null,
      value: 1,
      stageSource: null,
      rounding: null,
    },
  })
  if (operation.kind !== 'combat-stage') throw new Error('Expected combat-stage operation.')
  return operation
}

const dynamicRecipients = (
  attackedTargetIds: readonly string[],
  hitTargetIds: readonly string[],
): MoveCoreTokenDynamicRecipientSets => ({
  attackedTargetIds,
  hitTargetIds,
  missedTargetIds: attackedTargetIds.filter(id => !hitTargetIds.includes(id)),
  damagedTargetIds: hitTargetIds,
  faintedTargetIds: [],
})

const multiHitOperation = (hits: number): MoveMultiHitEffectOperation => ({
  id: 'operation.property-multi-hit',
  kind: 'multi-hit',
  source: { kind: 'move', id: 'move.tackle' },
  recipients: { kind: 'attacked-targets' },
  phase: 'damage',
  reasonCode: 'move.tackle.property-multi-hit',
  payload: {
    count: { kind: 'fixed', hits },
    accuracy: { kind: 'automatic' },
    critical: { kind: 'none' },
    damage: {
      damageClass: 'physical',
      damageBase: 1,
      moveType: 'normal',
      accuracyRollId: null,
      criticalRollId: null,
    },
    effects: [],
  },
})

const definitionFor = (operation: MoveMultiHitEffectOperation) => validateMoveSpec({
  schemaVersion: 2,
  canonicalId: 'Tackle',
  version: 2,
  targeting: {
    kind: 'single-target',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'selected-targets' },
  },
  preconditions: [],
  costs: [],
  phases: [{ phase: 'damage', operations: [operation] }],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Tackle',
    vfxKey: null,
    tags: ['property-multi-hit'],
  },
})

const expectNativeTraceParents = (
  trace: MoveResolutionAuditTrace,
  resolvedRolls: readonly {
    readonly operationId: string
    readonly rollId: string
  }[],
): void => {
  const operations = trace.events.filter(event => event.kind === 'operation')
  const operationSequence = new Map(operations.map(event => [event.operationId, event.sequence]))
  const rolls = trace.events.filter(event => event.kind === 'roll')
  const rollById = new Map(rolls.map(event => [event.roll.rollId, event]))

  for (const event of rolls) {
    const parentSequence = operationSequence.get(event.roll.parentEffectId)
    expect(parentSequence, `trace parent for ${event.roll.rollId}`).toBeDefined()
    expect(parentSequence!).toBeLessThan(event.sequence)
  }
  for (const resolved of resolvedRolls) {
    const event = rollById.get(resolved.rollId)
    expect(event, `trace roll ${resolved.rollId}`).toBeDefined()
    expect(event?.roll.parentEffectId).toBe(resolved.operationId)
    expect(operationSequence.has(resolved.operationId)).toBe(true)
  }
}

describe('selector and recipient-set properties', () => {
  it('canonicalizes generated selector sets in authoritative map order', () => {
    const context = buildMechanicsPropertyContext()
    const generated = createDeterministicPropertyGenerator(0x0880_7301)

    for (let caseIndex = 0; caseIndex < 256; caseIndex += 1) {
      const attacked = generatedTargetSubset(generated.integer(0, 15))
      const hit = generatedTargetSubset(generated.integer(0, 15))
        .filter(id => attacked.includes(id))
      const shuffledAttacked = generated.shuffle(attacked)
      const shuffledHit = generated.shuffle(hit)
      const state = selectorState({ attacked: shuffledAttacked, hit: shuffledHit })
      const attackedSet = new Set(attacked)
      const hitSet = new Set(hit)
      const unionSet = new Set([...attacked, ...hit])

      expect(evaluateMoveSelector({
        selector: { kind: 'attacked-targets' },
        context,
        selectorState: state,
      }), `attacked selector case ${caseIndex}`).toEqual(canonicalIds(attackedSet))
      expect(evaluateMoveSelector({
        selector: {
          kind: 'union',
          selectors: [
            { kind: 'hit-targets' },
            { kind: 'attacked-targets' },
            { kind: 'hit-targets' },
          ],
        },
        context,
        selectorState: state,
      }), `union selector case ${caseIndex}`).toEqual(canonicalIds(unionSet))
      expect(evaluateMoveSelector({
        selector: {
          kind: 'difference',
          source: { kind: 'attacked-targets' },
          exclude: { kind: 'hit-targets' },
        },
        context,
        selectorState: state,
      }), `difference selector case ${caseIndex}`).toEqual(
        canonicalIds(new Set([...attackedSet].filter(id => !hitSet.has(id)))),
      )
    }
  })

  it('never applies a generated operation to an emitted recipient outside its selector', () => {
    const context = buildMechanicsPropertyContext()
    const operation = stageOperation()
    const generated = createDeterministicPropertyGenerator(0x0880_7302)

    for (let caseIndex = 0; caseIndex < 128; caseIndex += 1) {
      const attacked = generatedTargetSubset(generated.integer(1, 15))
      const hit = attacked.filter(() => generated.integer(0, 1) === 1)
      const expectedIds = canonicalIds(new Set(hit))
      const dynamic = dynamicRecipients(
        generated.shuffle(attacked),
        generated.shuffle(hit),
      )
      const emission: MoveResolvedCoreTokenEffectOperation = {
        operation,
        recipientIds: expectedIds,
      }
      const accepted = reduceMoveCoreTokenOperationState({
        context,
        operations: [emission],
        dynamicRecipients: dynamic,
        immunities: NEVER_PREVENT_CORE_TOKEN_EFFECTS,
      })

      expect(accepted.operationResults[0]?.recipientIds, `recipient case ${caseIndex}`)
        .toEqual(expectedIds)
      expect(accepted.operationResults[0]?.recipients.map(result => result.recipientId))
        .toEqual(expectedIds)

      const forged: MoveResolvedCoreTokenEffectOperation = {
        operation,
        recipientIds: [...expectedIds, 'actor-token'],
      }
      expect(
        () => reduceMoveCoreTokenOperationState({
          context,
          operations: [forged],
          dynamicRecipients: dynamic,
          immunities: NEVER_PREVENT_CORE_TOKEN_EFFECTS,
        }),
        `forged recipient case ${caseIndex}`,
      ).toThrowError(expect.objectContaining({ code: 'recipient-set-mismatch' }))
    }
  })
})

describe('multi-hit aggregate and trace-parent properties', () => {
  it('matches every generated aggregate to its strike totals and authoritative trace parents', () => {
    const generated = createDeterministicPropertyGenerator(0x0880_7901)

    for (let caseIndex = 0; caseIndex < 96; caseIndex += 1) {
      const hits = generated.integer(1, 10)
      const randomValues = Array.from({ length: hits }, () => generated.fraction())
      const context = buildMechanicsPropertyContext({ randomValues })
      const targetId = MECHANICS_PROPERTY_TARGET_IDS[0]
      const targetBefore = context.queries.tokens.get(targetId)!
      const result = executeMoveSpec({
        definition: definitionFor(multiHitOperation(hits)),
        context,
        authoritativeTargetIds: [targetId],
      })
      if (result.kind !== 'complete') throw new Error('Generated multi-hit unexpectedly suspended.')

      const execution = result.multiHitExecutions[0]!
      const target = execution.resolution.targets[0]!
      const strikeDamage = target.strikes.flatMap(strike => (
        strike.damage === null ? [] : [strike.damage]
      ))
      const requestedTotal = strikeDamage.reduce(
        (total, damage) => total + damage.requestedHpLoss,
        0,
      )
      const effectiveTotal = strikeDamage.reduce(
        (total, damage) => total + damage.effectiveHpLost,
        0,
      )

      expect(target.attemptedHitCount, `multi-hit case ${caseIndex}`).toBe(hits)
      expect(target.successfulHitCount).toBe(hits)
      expect(target.missedHitCount).toBe(0)
      expect(target.strikes.map(strike => strike.hitIndex)).toEqual(
        Array.from({ length: hits }, (_unused, index) => index + 1),
      )
      expect(target.totalRequestedHpLoss).toBe(requestedTotal)
      expect(target.totalEffectiveHpLost).toBe(effectiveTotal)
      expect(execution.resolution.totalAttemptedHitCount).toBe(target.attemptedHitCount)
      expect(execution.resolution.totalSuccessfulHitCount).toBe(target.successfulHitCount)
      expect(execution.resolution.totalRequestedHpLoss).toBe(requestedTotal)
      expect(execution.resolution.totalEffectiveHpLost).toBe(effectiveTotal)
      expect(execution.rollLedgerEntries).toHaveLength(hits)
      expect(result.rollLedger).toHaveLength(hits)
      expect(target.strikes.at(-1)?.damage?.targetHpAfter).toBe(
        targetBefore.currentHp - effectiveTotal,
      )
      expectNativeTraceParents(result.trace, result.resolvedRolls)
    }
  })
})
