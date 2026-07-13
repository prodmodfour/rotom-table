import { describe, expect, it } from 'vitest'
import {
  MOVE_COUNTER_REACTION_DEFINITION_HASH,
  MOVE_COUNTER_REACTION_DEFINITIONS,
  MOVE_COUNTER_REACTION_PRIORITY,
} from '../../server/domain/moveAutomation/counterReactionDefinitions'
import {
  MoveCounterReactionError,
  applyMoveDamageCounterReaction,
  applyMoveEffectRedirectReaction,
  buildMoveCounterReactionRequestOperation,
  createMoveBideStorage,
  createMoveDamageCounterLedger,
  createMoveRedirectProvokingPlan,
  recordMoveBideDamage,
  recordMoveReactionDamage,
  releaseMoveBide,
} from '../../server/domain/moveAutomation/counterReactions'
import {
  COUNTER_REACTION_CANARY_SCENARIO_IDS,
  counterDamageEvent,
  createCounterReactionCanaryAuthority,
  runBideCanaryScenario,
  runCounterCanaryScenario,
  runMagicCoatCanaryScenario,
  runMirrorCoatCanaryScenario,
  runSnatchCanaryScenario,
} from '../fixtures/moveAutomation/counterReactions'

const recordedDamage = (options: {
  readonly eventId?: string
  readonly resolutionId?: string
  readonly damageClass?: 'physical' | 'special' | 'direct'
  readonly hitPointLoss?: number
  readonly temporaryHitPointLoss?: number
  readonly moveType?: string | null
} = {}) => recordMoveReactionDamage(counterDamageEvent({
  eventId: options.eventId ?? 'event.test.damage.1',
  resolutionId: options.resolutionId ?? 'resolution.trigger.test',
  canonicalMoveId: 'Test Attack',
  hitPointLoss: options.hitPointLoss ?? 5,
  temporaryHitPointLoss: options.temporaryHitPointLoss ?? 1,
  damageClass: options.damageClass ?? 'physical',
  moveType: options.moveType === undefined ? 'normal' : options.moveType,
}))

describe('counter, storage, and reflected-effect reaction primitives', () => {
  it('keeps one versioned reviewed definition and durable timing for every canary', () => {
    expect(MOVE_COUNTER_REACTION_DEFINITIONS.map(definition => definition.canonicalId)).toEqual([
      'Counter',
      'Mirror Coat',
      'Bide',
      'Magic Coat',
      'Snatch',
    ])
    expect(COUNTER_REACTION_CANARY_SCENARIO_IDS).toHaveLength(5)
    expect(new Set(MOVE_COUNTER_REACTION_DEFINITIONS.map(entry => entry.definitionId)).size)
      .toBe(5)
    expect(MOVE_COUNTER_REACTION_DEFINITION_HASH).toMatch(/^[a-f0-9]{64}$/)

    const expectedPhases = {
      Counter: 'hit',
      'Mirror Coat': 'hit',
      Bide: 'hit',
      'Magic Coat': 'hit',
      Snatch: 'target',
    }
    for (const definition of MOVE_COUNTER_REACTION_DEFINITIONS) {
      const request = buildMoveCounterReactionRequestOperation({
        canonicalMoveId: definition.canonicalId,
        operationId: `request.${definition.definitionId}`,
        recipients: definition.canonicalId === 'Snatch' ? 'selected-targets' : 'hit-targets',
      })
      expect(request).toMatchObject({
        kind: 'reaction-request',
        phase: expectedPhases[definition.canonicalId],
        payload: {
          allowPass: true,
          timing: definition.triggerTiming,
          priority: MOVE_COUNTER_REACTION_PRIORITY,
          options: [{ id: definition.optionId }],
        },
      })
    }
  })

  it('resolves Counter from deduplicated actual effective HP loss with child ancestry', () => {
    const result = runCounterCanaryScenario()

    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(result.application).toMatchObject({
      canonicalMoveId: 'Counter',
      triggeringResolutionId: 'resolution.trigger.physical',
      reactionResolutionId: 'resolution.counter.1',
      triggerDamageClass: 'physical',
      triggerMoveType: 'normal',
      damageEventIds: ['event.counter.damage.1'],
      recordedEffectiveHpLoss: 10,
      responseHpLoss: 20,
      outcome: 'applied',
      ancestry: {
        parentResolutionId: 'resolution.trigger.physical',
        childResolutionId: 'resolution.counter.1',
      },
    })
    expect(result.ledger.adjustments).toEqual([expect.objectContaining({
      triggeringResolutionId: 'resolution.trigger.physical',
      targetPlacementId: 'reactor',
      resistanceSteps: 1,
    })])
    expect(result.ledger.retaliationPlans).toEqual([expect.objectContaining({
      recipientIds: ['attacker'],
      damageClass: 'physical',
      moveType: 'fighting',
      operation: expect.objectContaining({
        kind: 'direct-hp',
        recipients: { kind: 'selected-targets' },
        payload: expect.objectContaining({
          calculation: { kind: 'fixed', value: 20 },
          applyTypeImmunity: true,
        }),
      }),
    })])
    expect(result.ledger.usageSpends).toEqual([expect.objectContaining({
      canonicalMoveId: 'Counter',
      ownerPlacementId: 'reactor',
      amount: 1,
    })])
  })

  it('resolves Mirror Coat only from recorded Special damage and preserves its type', () => {
    const result = runMirrorCoatCanaryScenario()

    expect(result.status).toBe('applied')
    expect(result.application).toMatchObject({
      canonicalMoveId: 'Mirror Coat',
      triggerDamageClass: 'special',
      triggerMoveType: 'psychic',
      recordedEffectiveHpLoss: 6,
      responseHpLoss: 12,
      ancestry: {
        parentResolutionId: 'resolution.trigger.special',
        childResolutionId: 'resolution.mirror-coat.1',
      },
    })
    expect(result.ledger.retaliationPlans[0]).toMatchObject({
      damageClass: 'special',
      moveType: 'psychic',
      operation: { payload: { applyTypeImmunity: true } },
    })
  })

  it('stores Bide damage across move resolutions and releases it once on the next turn', () => {
    const result = runBideCanaryScenario()

    expect(result.status).toBe('released')
    expect(result.state).toMatchObject({
      status: 'released',
      triggeringResolutionId: 'resolution.trigger.bide',
      resolutionId: 'resolution.bide.1',
      storedEffectiveHpLoss: 10,
      damageRecords: [
        { eventId: 'event.bide.damage.trigger', effectiveHpLoss: 5 },
        { eventId: 'event.bide.damage.later', effectiveHpLoss: 5 },
      ],
      ancestry: {
        parentResolutionId: 'resolution.trigger.bide',
        childResolutionId: 'resolution.bide.1',
      },
      release: {
        recipientIds: ['attacker', 'other-enemy'],
        releasedTurn: 11,
        operation: {
          kind: 'direct-hp',
          recipients: { kind: 'area-targets' },
          payload: {
            calculation: { kind: 'fixed', value: 10 },
            applyTypeImmunity: false,
          },
        },
      },
    })
    expect(result.state.damageRecords).toHaveLength(2)
    expect(result.state.usageSpend).toMatchObject({ canonicalMoveId: 'Bide', amount: 1 })

    const duplicate = releaseMoveBide({
      authority: createCounterReactionCanaryAuthority(),
      state: result.state,
      currentTurn: 11,
      authoritativeAdjacentPlacementIds: ['attacker'],
    })
    expect(duplicate.status).toBe('duplicate')
    expect(duplicate.state).toBe(result.state)
  })

  it('reflects a Magic Coat status to its original user with the reactor as source', () => {
    const result = runMagicCoatCanaryScenario()

    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(result.application).toMatchObject({
      canonicalMoveId: 'Magic Coat',
      redirectedOperationIds: ['provoking.status-condition'],
      ancestry: {
        parentResolutionId: 'resolution.trigger.magic-coat',
        childResolutionId: 'resolution.magic-coat.1',
      },
      recipientReplacements: [{
        operationId: 'provoking.status-condition',
        fromPlacementId: 'reactor',
        toPlacementId: 'attacker',
        sourcePlacementId: 'reactor',
      }],
    })
    expect(result.plan.effects[0]).toMatchObject({
      operation: { kind: 'condition', payload: { conditionId: 'poisoned' } },
      recipients: [{ placementId: 'attacker', sourcePlacementId: 'reactor' }],
    })
  })

  it('redirects only Snatch benefits while preserving the original user costs', () => {
    const result = runSnatchCanaryScenario()

    expect(result.status).toBe('applied')
    if (result.status !== 'applied') return
    expect(result.application).toMatchObject({
      canonicalMoveId: 'Snatch',
      redirectedOperationIds: ['provoking.self-benefit'],
      ancestry: {
        parentResolutionId: 'resolution.trigger.snatch',
        childResolutionId: 'resolution.snatch.1',
      },
    })
    expect(result.plan.effects).toEqual([
      expect.objectContaining({
        disposition: 'benefit',
        recipients: [{ placementId: 'reactor', sourcePlacementId: 'attacker' }],
      }),
      expect.objectContaining({
        disposition: 'cost',
        recipients: [{ placementId: 'attacker', sourcePlacementId: 'attacker' }],
      }),
    ])
    expect(result.plan.usageSpends).toHaveLength(1)
  })

  it('fails class and type eligibility closed without manufacturing retaliation damage', () => {
    const authority = createCounterReactionCanaryAuthority(['attacker:fighting'])
    const special = recordedDamage({
      eventId: 'event.counter.special',
      resolutionId: 'resolution.counter.special',
      damageClass: 'special',
      moveType: 'fire',
    })
    const mismatch = applyMoveDamageCounterReaction({
      authority,
      ledger: createMoveDamageCounterLedger(),
      canonicalMoveId: 'Counter',
      reactorPlacementId: 'reactor',
      reactionOperationId: 'reaction.counter.mismatch',
      reactionResolutionId: 'resolution.counter.mismatch',
      damageRecords: [special],
      reactorFainted: false,
    })
    expect(mismatch).toMatchObject({
      status: 'ineligible',
      reasonCode: 'counter-trigger-class-mismatch',
      ledger: { usageSpends: [], retaliationPlans: [], applications: [] },
    })

    const physical = recordedDamage()
    const immune = applyMoveDamageCounterReaction({
      authority,
      ledger: createMoveDamageCounterLedger(),
      canonicalMoveId: 'Counter',
      reactorPlacementId: 'reactor',
      reactionOperationId: 'reaction.counter.immune',
      reactionResolutionId: 'resolution.counter.immune',
      damageRecords: [physical],
      reactorFainted: false,
    })
    expect(immune).toMatchObject({
      status: 'prevented',
      application: { outcome: 'target-immune', responseHpLoss: 12 },
      ledger: { retaliationPlans: [], usageSpends: [{ amount: 1 }] },
    })

    const fainted = applyMoveDamageCounterReaction({
      authority: createCounterReactionCanaryAuthority(),
      ledger: createMoveDamageCounterLedger(),
      canonicalMoveId: 'Counter',
      reactorPlacementId: 'reactor',
      reactionOperationId: 'reaction.counter.fainted',
      reactionResolutionId: 'resolution.counter.fainted',
      damageRecords: [physical],
      reactorFainted: true,
    })
    expect(fainted).toMatchObject({
      status: 'prevented',
      application: { outcome: 'reactor-fainted' },
      ledger: { retaliationPlans: [], usageSpends: [{ amount: 1 }] },
    })
  })

  it('replays exact counter and redirect responses without a second spend or effect', () => {
    const firstCounter = runCounterCanaryScenario()
    if (firstCounter.status !== 'applied') throw new Error('Counter canary did not apply.')
    const damage = recordMoveReactionDamage(counterDamageEvent({
      eventId: 'event.counter.damage.1',
      resolutionId: 'resolution.trigger.physical',
      canonicalMoveId: 'Body Slam',
      hitPointLoss: 8,
      temporaryHitPointLoss: 2,
      damageClass: 'physical',
      moveType: 'normal',
    }))
    const duplicateCounter = applyMoveDamageCounterReaction({
      authority: createCounterReactionCanaryAuthority(),
      ledger: firstCounter.ledger,
      canonicalMoveId: 'Counter',
      reactorPlacementId: 'reactor',
      reactionOperationId: 'reaction.counter.1',
      reactionResolutionId: 'resolution.counter.1',
      damageRecords: [damage],
      reactorFainted: false,
    })
    expect(duplicateCounter.status).toBe('duplicate')
    expect(duplicateCounter.ledger).toBe(firstCounter.ledger)
    expect(duplicateCounter.ledger.usageSpends).toHaveLength(1)
    expect(duplicateCounter.ledger.retaliationPlans).toHaveLength(1)

    const firstRedirect = runMagicCoatCanaryScenario()
    if (firstRedirect.status !== 'applied') throw new Error('Magic Coat canary did not apply.')
    const duplicateRedirect = applyMoveEffectRedirectReaction({
      authority: createCounterReactionCanaryAuthority(),
      plan: firstRedirect.plan,
      canonicalMoveId: 'Magic Coat',
      reactorPlacementId: 'reactor',
      reactionOperationId: 'reaction.magic-coat.1',
      reactionResolutionId: 'resolution.magic-coat.1',
    })
    expect(duplicateRedirect.status).toBe('duplicate')
    expect(duplicateRedirect.plan).toBe(firstRedirect.plan)
    expect(duplicateRedirect.plan.usageSpends).toHaveLength(1)
  })

  it('rejects conflicting damage identity, early Bide release, and forged recipients', () => {
    const authority = createCounterReactionCanaryAuthority()
    const damage = recordedDamage()
    const conflicting = {
      ...damage,
      hitPointLoss: damage.hitPointLoss + 1,
      effectiveHpLoss: damage.effectiveHpLoss + 1,
    }
    expect(() => applyMoveDamageCounterReaction({
      authority,
      ledger: createMoveDamageCounterLedger(),
      canonicalMoveId: 'Counter',
      reactorPlacementId: 'reactor',
      reactionOperationId: 'reaction.counter.conflict',
      reactionResolutionId: 'resolution.counter.conflict',
      damageRecords: [damage, conflicting],
      reactorFainted: false,
    })).toThrowError(expect.objectContaining({
      name: MoveCounterReactionError.name,
      code: 'damage-record-conflict',
    }))

    const storage = createMoveBideStorage({
      authority,
      userPlacementId: 'reactor',
      reactionOperationId: 'reaction.bide.early',
      resolutionId: 'resolution.bide.early',
      declaredTurn: 1,
      executeTurn: 3,
      triggeringDamageRecords: [damage],
    })
    expect(() => releaseMoveBide({
      authority,
      state: storage,
      currentTurn: 2,
      authoritativeAdjacentPlacementIds: ['attacker'],
    })).toThrowError(expect.objectContaining({ code: 'not-ready' }))
    expect(() => releaseMoveBide({
      authority,
      state: storage,
      currentTurn: 3,
      authoritativeAdjacentPlacementIds: ['client-forged'],
    })).toThrowError(expect.objectContaining({ code: 'placement-not-found' }))

    const unrelated = recordedDamage({
      eventId: 'event.bide.unrelated',
      resolutionId: 'resolution.bide.unrelated',
    })
    expect(recordMoveBideDamage(storage, [unrelated, unrelated])).toMatchObject({
      damageRecords: [
        { eventId: damage.eventId },
        { eventId: unrelated.eventId },
      ],
    })
  })

  it('leaves immutable inputs intact and rejects unsupported redirect triggers', () => {
    const authority = createCounterReactionCanaryAuthority()
    const condition = runMagicCoatCanaryScenario()
    expect(Object.isFrozen(condition.plan)).toBe(true)
    expect(Object.isFrozen(condition.plan.effects)).toBe(true)

    const damageDicePlan = createMoveRedirectProvokingPlan(authority, {
      triggeringResolutionId: 'resolution.redirect.damage-dice',
      actorPlacementId: 'attacker',
      attackedTargetIds: ['reactor'],
      hitTargetIds: ['reactor'],
      selfTargeting: false,
      hasDamageDiceRoll: true,
      effects: condition.plan.effects.map(effect => ({
        operation: effect.operation,
        disposition: effect.disposition,
        recipientIds: ['reactor'],
      })),
    })
    expect(applyMoveEffectRedirectReaction({
      authority,
      plan: damageDicePlan,
      canonicalMoveId: 'Magic Coat',
      reactorPlacementId: 'reactor',
      reactionOperationId: 'reaction.magic-coat.damage-dice',
      reactionResolutionId: 'resolution.magic-coat.damage-dice',
    })).toMatchObject({ status: 'ineligible', reasonCode: 'magic-coat-damage-dice' })

    const notSelfPlan = createMoveRedirectProvokingPlan(authority, {
      triggeringResolutionId: 'resolution.redirect.not-self',
      actorPlacementId: 'attacker',
      attackedTargetIds: ['reactor'],
      hitTargetIds: ['reactor'],
      selfTargeting: false,
      hasDamageDiceRoll: false,
      effects: condition.plan.effects.map(effect => ({
        operation: effect.operation,
        disposition: 'benefit' as const,
        recipientIds: ['attacker'],
      })),
    })
    const snapshot = structuredClone(notSelfPlan)
    expect(applyMoveEffectRedirectReaction({
      authority,
      plan: notSelfPlan,
      canonicalMoveId: 'Snatch',
      reactorPlacementId: 'reactor',
      reactionOperationId: 'reaction.snatch.not-self',
      reactionResolutionId: 'resolution.snatch.not-self',
    })).toMatchObject({ status: 'ineligible', reasonCode: 'snatch-not-self-targeting' })
    expect(notSelfPlan).toEqual(snapshot)
  })
})
