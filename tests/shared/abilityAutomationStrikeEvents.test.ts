import { describe, expect, it } from 'vitest'
import {
  AbilityEncounterEventValidationError,
  parseAbilityEncounterEvent,
} from '#shared/abilityAutomation/events'
import {
  AbilityStrikeEventPredicateValidationError,
  parseAbilityStrikeEventPredicate,
} from '#shared/abilityAutomation/strikeEventPredicates'
import { evaluateAbilityStrikeEventPredicate } from '../../server/domain/abilityAutomation/strikeEventPredicates'
import { ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY } from '../../server/domain/abilityAutomation/sharedKernelExtensions'
import { ABILITY_SUBSCRIPTION_PREDICATE_REGISTRY } from '../../server/domain/abilityAutomation/subscriptionRouter'

const strikeEvent = (timing: 'accuracy-resolved' | 'damage-resolved' = 'damage-resolved') => ({
  schemaVersion: 1,
  eventId: `event.strike.${timing}`,
  kind: 'strike',
  sequence: 2,
  mapSlug: 'strike-arena',
  mapRevision: 9,
  sceneId: 'scene.one',
  occurredAt: 2_000,
  actorPlacementId: 'attacker-token',
  sourceResolutionId: 'resolution.move-one',
  parentEventId: 'event.move.completed',
  payload: {
    moveResolutionId: 'resolution.move-one',
    canonicalMoveId: 'Thunder Punch',
    moveDefinitionHash: 'a'.repeat(64),
    sourceOperationId: 'thunder-punch.damage',
    strikeIndex: 1,
    strikeCount: 2,
    attackerPlacementId: 'attacker-token',
    defenderPlacementId: 'defender-token',
    timing,
    accuracyOutcome: 'hit',
    rangeContext: 'melee',
    makesContact: true,
    directness: 'direct',
    moveType: 'electric',
    damageClass: 'physical',
    critical: true,
    effectiveness: 'super-effective',
    effectivenessMultiplier: 2,
    rolledDamage: timing === 'damage-resolved' ? 30 : null,
    postDefenseDamage: timing === 'damage-resolved' ? 20 : null,
    damageReduction: timing === 'damage-resolved' ? 5 : null,
    preventedDamage: timing === 'damage-resolved' ? 2 : null,
    temporaryHpLoss: timing === 'damage-resolved' ? 3 : null,
    hpLoss: timing === 'damage-resolved' ? 10 : null,
    totalLoss: timing === 'damage-resolved' ? 13 : null,
    preventionReasonCodes: ['defender.damage-reduction'],
  },
})

const strikePredicate = () => ({
  kind: 'ability-strike-fact',
  timings: ['damage-resolved'],
  accuracyOutcomes: ['hit'],
  rangeContexts: ['melee'],
  directness: ['direct'],
  moveTypes: ['electric'],
  damageClasses: ['physical'],
  effectiveness: ['super-effective'],
  contact: 'required',
  critical: 'required',
  ownerRole: 'defender',
  prevention: 'prevented',
  strikeIndex: 'first',
  minimumHpLoss: 10,
  minimumTotalLoss: 13,
})

const expectStrikeError = (callback: () => unknown): void => {
  expect(callback).toThrow(AbilityEncounterEventValidationError)
}

describe('authoritative strike and damage events', () => {
  it('preserves strike index, attack context, identities, effectiveness, and actual losses', () => {
    const parsed = parseAbilityEncounterEvent(strikeEvent())

    expect(parsed).toMatchObject({
      kind: 'strike',
      actorPlacementId: 'attacker-token',
      sourceResolutionId: 'resolution.move-one',
      payload: {
        strikeIndex: 1,
        strikeCount: 2,
        attackerPlacementId: 'attacker-token',
        defenderPlacementId: 'defender-token',
        rangeContext: 'melee',
        makesContact: true,
        directness: 'direct',
        critical: true,
        effectiveness: 'super-effective',
        effectivenessMultiplier: 2,
        temporaryHpLoss: 3,
        hpLoss: 10,
        totalLoss: 13,
      },
    })
  })

  it('registers and evaluates reviewed strike-fact predicate semantics', () => {
    expect(ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY.resolve(
      'predicate',
      'ability-strike-fact',
    )).toMatchObject({ version: 1 })
    expect(ABILITY_SUBSCRIPTION_PREDICATE_REGISTRY.resolve('ability-strike-fact'))
      .toMatchObject({ version: 1 })

    const event = parseAbilityEncounterEvent(strikeEvent())
    const predicate = parseAbilityStrikeEventPredicate(strikePredicate())
    if (event.kind !== 'strike') expect.unreachable()
    expect(evaluateAbilityStrikeEventPredicate({
      event,
      ownerPlacementId: 'defender-token',
      predicate,
    })).toBe(true)
    expect(evaluateAbilityStrikeEventPredicate({
      event,
      ownerPlacementId: 'attacker-token',
      predicate,
    })).toBe(false)
  })

  it('separates accuracy checkpoint facts from accepted damage totals', () => {
    const parsed = parseAbilityEncounterEvent(strikeEvent('accuracy-resolved'))
    expect(parsed).toMatchObject({
      kind: 'strike',
      payload: {
        timing: 'accuracy-resolved',
        accuracyOutcome: 'hit',
        rolledDamage: null,
        totalLoss: null,
      },
    })

    const premature = strikeEvent('accuracy-resolved')
    premature.payload.totalLoss = 1
    expectStrikeError(() => parseAbilityEncounterEvent(premature))
  })

  it('requires exact damage reduction, prevention, and HP-loss arithmetic', () => {
    const reduction = strikeEvent()
    reduction.payload.damageReduction = 4
    expectStrikeError(() => parseAbilityEncounterEvent(reduction))

    const split = strikeEvent()
    split.payload.hpLoss = 9
    expectStrikeError(() => parseAbilityEncounterEvent(split))

    const reason = strikeEvent()
    reason.payload.preventionReasonCodes = []
    expectStrikeError(() => parseAbilityEncounterEvent(reason))
  })

  it('rejects impossible critical, contact, effectiveness, and strike-index facts', () => {
    const missed = strikeEvent()
    missed.payload.accuracyOutcome = 'miss'
    expectStrikeError(() => parseAbilityEncounterEvent(missed))

    const indirect = strikeEvent()
    indirect.payload.directness = 'indirect'
    expectStrikeError(() => parseAbilityEncounterEvent(indirect))

    const multiplier = strikeEvent()
    multiplier.payload.effectivenessMultiplier = 1
    expectStrikeError(() => parseAbilityEncounterEvent(multiplier))

    const index = strikeEvent()
    index.payload.strikeIndex = 3
    expectStrikeError(() => parseAbilityEncounterEvent(index))
  })

  it('requires envelope attacker and move-resolution identity', () => {
    const actor = strikeEvent()
    actor.actorPlacementId = 'other-token'
    expectStrikeError(() => parseAbilityEncounterEvent(actor))

    const resolution = strikeEvent()
    resolution.sourceResolutionId = 'resolution.other'
    expectStrikeError(() => parseAbilityEncounterEvent(resolution))
  })

  it('rejects empty, duplicate, out-of-order, and executable strike predicates', () => {
    const empty = {
      ...strikePredicate(),
      timings: [], accuracyOutcomes: [], rangeContexts: [], directness: [], moveTypes: [],
      damageClasses: [], effectiveness: [], contact: 'any', critical: 'any',
      ownerRole: 'either', prevention: 'any', strikeIndex: 'any',
      minimumHpLoss: null, minimumTotalLoss: null,
    }
    // "either" remains a real role constraint; only fully-any is intentionally unavailable.
    expect(parseAbilityStrikeEventPredicate(empty)).toMatchObject({ ownerRole: 'either' })
    expect(() => parseAbilityStrikeEventPredicate({
      ...strikePredicate(),
      timings: ['damage-resolved', 'damage-resolved'],
    })).toThrow(AbilityStrikeEventPredicateValidationError)
    expect(() => parseAbilityStrikeEventPredicate({
      ...strikePredicate(),
      effectiveness: ['super-effective', 'neutral'],
    })).toThrow(AbilityStrikeEventPredicateValidationError)
    expect(() => parseAbilityStrikeEventPredicate({
      ...strikePredicate(),
      callback: () => true,
    })).toThrow(AbilityStrikeEventPredicateValidationError)
  })

  it('supports fully prevented and immune packets only with explicit reasons', () => {
    const prevented = strikeEvent()
    Object.assign(prevented.payload, {
      accuracyOutcome: 'prevented',
      critical: false,
      effectiveness: 'immune',
      effectivenessMultiplier: 0,
      rolledDamage: 30,
      postDefenseDamage: 20,
      damageReduction: 0,
      preventedDamage: 20,
      temporaryHpLoss: 0,
      hpLoss: 0,
      totalLoss: 0,
      preventionReasonCodes: ['type.immunity'],
    })
    expect(parseAbilityEncounterEvent(prevented)).toMatchObject({
      kind: 'strike',
      payload: { accuracyOutcome: 'prevented', totalLoss: 0 },
    })
  })
})
