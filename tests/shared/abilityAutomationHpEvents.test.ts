import { describe, expect, it } from 'vitest'
import {
  AbilityEncounterEventValidationError,
  parseAbilityEncounterEvent,
} from '#shared/abilityAutomation/events'
import {
  AbilityEventEmissionError,
  recordAcceptedAbilityEvent,
} from '../../server/domain/abilityAutomation/eventReceipts'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseAbilityHpEventPredicate } from '#shared/abilityAutomation/hpEventPredicates'
import { evaluateAbilityHpEventPredicate } from '../../server/domain/abilityAutomation/hpEventPredicates'
import { ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY } from '../../server/domain/abilityAutomation/sharedKernelExtensions'
import { ABILITY_SUBSCRIPTION_PREDICATE_REGISTRY } from '../../server/domain/abilityAutomation/subscriptionRouter'

const hpEvent = () => ({
  schemaVersion: 1,
  eventId: 'event.hp.damage-one',
  kind: 'hp',
  sequence: 4,
  mapSlug: 'hp-arena',
  mapRevision: 12,
  sceneId: 'scene.one',
  occurredAt: 4_000,
  actorPlacementId: 'attacker-token',
  sourceResolutionId: 'resolution.move-one',
  parentEventId: 'event.strike.damage-one',
  payload: {
    placementId: 'defender-token',
    changeKind: 'damage',
    before: 60,
    after: 10,
    maximumBefore: 100,
    maximumAfter: 100,
    fullMaximum: 100,
    temporaryBefore: 5,
    temporaryAfter: 0,
    requestedAmount: 55,
    appliedAmount: 55,
    crossedZero: false,
    crossedInjuryThreshold: true,
    injuriesBefore: 0,
    injuriesAfter: 1,
    massiveDamage: true,
    massiveDamageThreshold: 50,
    massiveDamageAmount: 55,
    massiveDamageInjuryApplied: true,
    faintedBefore: false,
    faintedAfter: false,
    faintTransition: 'none',
    sourceOperationId: 'move.damage-one',
    applicationId: 'application.damage-one.defender',
    reasonCode: 'move.damage.applied',
  },
})

const expectHpError = (callback: () => unknown): void => {
  expect(callback).toThrow(AbilityEncounterEventValidationError)
}

describe('authoritative HP, injury, and faint events', () => {
  it('captures HP/temporary-HP loss, injury, and massive-damage facts exactly', () => {
    const parsed = parseAbilityEncounterEvent(hpEvent())
    expect(parsed).toMatchObject({
      kind: 'hp',
      payload: {
        before: 60,
        after: 10,
        temporaryBefore: 5,
        temporaryAfter: 0,
        appliedAmount: 55,
        injuriesBefore: 0,
        injuriesAfter: 1,
        massiveDamage: true,
        massiveDamageThreshold: 50,
        massiveDamageInjuryApplied: true,
        faintTransition: 'none',
      },
    })
  })

  it('registers and evaluates reviewed HP-fact predicate semantics', () => {
    expect(ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY.resolve('predicate', 'ability-hp-fact'))
      .toMatchObject({ version: 1 })
    expect(ABILITY_SUBSCRIPTION_PREDICATE_REGISTRY.resolve('ability-hp-fact'))
      .toMatchObject({ version: 1 })
    const event = parseAbilityEncounterEvent(hpEvent())
    const predicate = parseAbilityHpEventPredicate({
      kind: 'ability-hp-fact',
      changeKinds: ['damage'],
      faintTransitions: [],
      ownerRole: 'subject',
      massiveDamage: 'required',
      crossedZero: 'forbidden',
      injuryChange: 'increased',
      temporaryChange: 'lost',
      hpThreshold: 'below-half',
      minimumAppliedAmount: 50,
    })
    if (event.kind !== 'hp') expect.unreachable()
    expect(evaluateAbilityHpEventPredicate({
      event,
      ownerPlacementId: 'defender-token',
      predicate,
    })).toBe(true)
    expect(evaluateAbilityHpEventPredicate({
      event,
      ownerPlacementId: 'attacker-token',
      predicate,
    })).toBe(false)
  })

  it('supports temporary gain, faint, revive, and injury-only accepted outcomes', () => {
    const temporary = hpEvent()
    Object.assign(temporary.payload, {
      changeKind: 'temporary-gain',
      before: 10,
      after: 10,
      temporaryBefore: 0,
      temporaryAfter: 20,
      requestedAmount: 20,
      appliedAmount: 20,
      crossedInjuryThreshold: false,
      injuriesBefore: 0,
      injuriesAfter: 0,
      massiveDamage: false,
      massiveDamageAmount: 0,
      massiveDamageInjuryApplied: false,
    })
    expect(parseAbilityEncounterEvent(temporary)).toMatchObject({
      kind: 'hp', payload: { changeKind: 'temporary-gain', appliedAmount: 20 },
    })

    const faint = hpEvent()
    Object.assign(faint.payload, {
      before: 10, after: 0, fullMaximum: 30, maximumBefore: 30, maximumAfter: 30,
      temporaryBefore: 0, temporaryAfter: 0, requestedAmount: 10, appliedAmount: 10,
      crossedZero: true, crossedInjuryThreshold: false, injuriesBefore: 0, injuriesAfter: 0,
      massiveDamage: false, massiveDamageThreshold: 15, massiveDamageAmount: 10,
      massiveDamageInjuryApplied: false, faintedBefore: false, faintedAfter: true,
      faintTransition: 'fainted',
    })
    expect(parseAbilityEncounterEvent(faint)).toMatchObject({
      kind: 'hp', payload: { faintTransition: 'fainted', crossedZero: true },
    })

    const revive = hpEvent()
    Object.assign(revive.payload, {
      changeKind: 'revive', before: 0, after: 5, temporaryBefore: 0, temporaryAfter: 0,
      requestedAmount: 5, appliedAmount: 5, crossedZero: false, crossedInjuryThreshold: false,
      injuriesBefore: 0, injuriesAfter: 0, massiveDamage: false, massiveDamageAmount: 0,
      massiveDamageInjuryApplied: false, faintedBefore: true, faintedAfter: false,
      faintTransition: 'revived',
    })
    expect(parseAbilityEncounterEvent(revive)).toMatchObject({
      kind: 'hp', payload: { faintTransition: 'revived' },
    })

    const injury = hpEvent()
    Object.assign(injury.payload, {
      changeKind: 'injury', before: 80, after: 80, maximumBefore: 100, maximumAfter: 90,
      temporaryBefore: 0, temporaryAfter: 0, requestedAmount: 0, appliedAmount: 0,
      crossedZero: false, crossedInjuryThreshold: true, injuriesBefore: 0, injuriesAfter: 1,
      massiveDamage: false, massiveDamageAmount: 0, massiveDamageInjuryApplied: false,
      faintedBefore: false, faintedAfter: false, faintTransition: 'none',
    })
    expect(parseAbilityEncounterEvent(injury)).toMatchObject({
      kind: 'hp', payload: { changeKind: 'injury', maximumAfter: 90 },
    })
  })

  it('rejects inconsistent massive damage, injuries, fainting, and applied deltas', () => {
    const massive = hpEvent()
    massive.payload.massiveDamage = false
    expectHpError(() => parseAbilityEncounterEvent(massive))

    const threshold = hpEvent()
    threshold.payload.massiveDamageThreshold = 49
    expectHpError(() => parseAbilityEncounterEvent(threshold))

    const injury = hpEvent()
    injury.payload.injuriesAfter = 0
    expectHpError(() => parseAbilityEncounterEvent(injury))

    const faint = hpEvent()
    faint.payload.faintedAfter = true
    expectHpError(() => parseAbilityEncounterEvent(faint))

    const delta = hpEvent()
    delta.payload.appliedAmount = 50
    expectHpError(() => parseAbilityEncounterEvent(delta))
  })

  it('persists an emission receipt and emits no duplicate trigger on exact replay', () => {
    const first = recordAcceptedAbilityEvent(createEmptyEncounterState(), hpEvent())
    const replay = recordAcceptedAbilityEvent(first.encounterState, hpEvent())

    expect(first.status).toBe('emitted')
    expect(first.event).toMatchObject({ kind: 'hp' })
    expect(first.encounterState.abilityEventReceipts?.entries).toEqual([
      expect.objectContaining({
        applicationId: 'application.damage-one.defender',
        eventId: 'event.hp.damage-one',
        eventSequence: 4,
      }),
    ])
    expect(replay).toMatchObject({ status: 'duplicate', event: null })
    expect(replay.encounterState).toEqual(first.encounterState)
  })

  it('fails closed when an application or event ID is replayed with changed facts', () => {
    const first = recordAcceptedAbilityEvent(createEmptyEncounterState(), hpEvent())
    const changed = hpEvent()
    changed.payload.reasonCode = 'move.damage.changed'
    expect(() => recordAcceptedAbilityEvent(first.encounterState, changed))
      .toThrow(AbilityEventEmissionError)

    const application = hpEvent()
    application.eventId = 'event.hp.other'
    expect(() => recordAcceptedAbilityEvent(first.encounterState, application))
      .toThrow(AbilityEventEmissionError)
  })
})
