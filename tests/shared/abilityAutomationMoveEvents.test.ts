import { describe, expect, it } from 'vitest'
import {
  AbilityEncounterEventValidationError,
  parseAbilityEncounterEvent,
} from '#shared/abilityAutomation/events'
import {
  AbilityMoveEventPredicateValidationError,
  parseAbilityMoveEventPredicate,
} from '#shared/abilityAutomation/moveEventPredicates'
import { evaluateAbilityMoveEventPredicate } from '../../server/domain/abilityAutomation/moveEventPredicates'
import { ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY } from '../../server/domain/abilityAutomation/sharedKernelExtensions'
import { ABILITY_SUBSCRIPTION_PREDICATE_REGISTRY } from '../../server/domain/abilityAutomation/subscriptionRouter'

const moveEvent = (timing: 'declared' | 'completed' = 'completed') => ({
  schemaVersion: 1,
  eventId: `event.move.${timing}`,
  kind: 'move',
  sequence: 1,
  mapSlug: 'move-event-arena',
  mapRevision: 7,
  sceneId: 'scene.one',
  occurredAt: 1_000,
  actorPlacementId: 'user-token',
  sourceResolutionId: 'resolution.move-one',
  parentEventId: null,
  payload: {
    resolutionId: 'resolution.move-one',
    canonicalMoveId: 'Thunder Punch',
    moveDefinitionHash: 'a'.repeat(64),
    userPlacementId: 'user-token',
    timing,
    outcome: timing === 'completed' ? 'applied' : null,
    moveType: 'electric',
    damageClass: 'physical',
    rangeKind: 'melee',
    minimumRange: 0,
    maximumRange: 1,
    keywords: ['interrupt', 'punch'] as string[],
    semanticBranchIds: ['branch.base', 'branch.paralysis-check'],
    declaredTargetIds: ['target-token'],
    attackedTargetIds: timing === 'declared' ? [] : ['target-token', 'missed-token'],
    hitTargetIds: timing === 'declared' ? [] : ['target-token'],
    missedTargetIds: timing === 'declared' ? [] : ['missed-token'],
    criticalTargetIds: timing === 'declared' ? [] : ['target-token'],
    parentMoveResolutionId: null,
  },
})

const validMoveEvent = (timing: 'declared' | 'completed' = 'completed') => {
  const value = moveEvent(timing)
  value.payload.keywords = ['interrupt']
  return value
}

const predicate = () => ({
  kind: 'ability-move-fact',
  timings: ['completed'],
  moveTypes: ['electric'],
  damageClasses: ['physical'],
  keywordsAny: ['interrupt'],
  keywordsAll: ['interrupt'],
  userRelation: 'other',
  targetRelation: 'hit',
})

const expectEventError = (callback: () => unknown): void => {
  expect(callback).toThrow(AbilityEncounterEventValidationError)
}

describe('authoritative move event facts', () => {
  it('captures declaration/use, type, class, keywords, and hit outcomes', () => {
    const declared = parseAbilityEncounterEvent(validMoveEvent('declared'))
    const completed = parseAbilityEncounterEvent(validMoveEvent())

    expect(declared).toMatchObject({
      kind: 'move',
      payload: {
        timing: 'declared',
        moveType: 'electric',
        damageClass: 'physical',
        rangeKind: 'melee',
        maximumRange: 1,
        semanticBranchIds: ['branch.base', 'branch.paralysis-check'],
        attackedTargetIds: [],
      },
    })
    expect(completed).toMatchObject({
      kind: 'move',
      payload: {
        timing: 'completed',
        keywords: ['interrupt'],
        attackedTargetIds: ['target-token', 'missed-token'],
        hitTargetIds: ['target-token'],
        missedTargetIds: ['missed-token'],
        criticalTargetIds: ['target-token'],
      },
    })
  })

  it('registers matching versioned parser and evaluator semantics in production', () => {
    expect(ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY.resolve(
      'predicate',
      'ability-move-fact',
    )).toMatchObject({ version: 1 })
    expect(ABILITY_SUBSCRIPTION_PREDICATE_REGISTRY.resolve('ability-move-fact'))
      .toMatchObject({ version: 1 })
  })

  it('validates and evaluates closed move-fact subscription predicates', () => {
    const parsedEvent = parseAbilityEncounterEvent(validMoveEvent())
    const parsedPredicate = parseAbilityMoveEventPredicate(predicate())
    if (parsedEvent.kind !== 'move') expect.unreachable()

    expect(evaluateAbilityMoveEventPredicate({
      event: parsedEvent,
      ownerPlacementId: 'target-token',
      predicate: parsedPredicate,
    })).toBe(true)
    expect(evaluateAbilityMoveEventPredicate({
      event: parsedEvent,
      ownerPlacementId: 'user-token',
      predicate: parsedPredicate,
    })).toBe(false)
    expect(evaluateAbilityMoveEventPredicate({
      event: parsedEvent,
      ownerPlacementId: 'missed-token',
      predicate: parsedPredicate,
    })).toBe(false)
  })

  it('rejects unknown/out-of-order keywords and inconsistent target outcomes', () => {
    expectEventError(() => parseAbilityEncounterEvent(moveEvent()))

    const order = validMoveEvent()
    order.payload.keywords = ['sonic', 'interrupt']
    expectEventError(() => parseAbilityEncounterEvent(order))

    const hit = validMoveEvent()
    hit.payload.hitTargetIds = ['not-attacked']
    expectEventError(() => parseAbilityEncounterEvent(hit))

    const critical = validMoveEvent()
    critical.payload.criticalTargetIds = ['missed-token']
    expectEventError(() => parseAbilityEncounterEvent(critical))
  })

  it('rejects inconsistent range and duplicate semantic branch facts', () => {
    const range = validMoveEvent()
    range.payload.minimumRange = 3
    range.payload.maximumRange = 1
    expectEventError(() => parseAbilityEncounterEvent(range))

    const branch = validMoveEvent()
    branch.payload.semanticBranchIds = ['branch.base', 'branch.base']
    expectEventError(() => parseAbilityEncounterEvent(branch))
  })

  it('rejects declaration outcomes, bad hashes, and envelope identity drift', () => {
    const declaration = validMoveEvent('declared')
    declaration.payload.outcome = 'applied'
    expectEventError(() => parseAbilityEncounterEvent(declaration))

    const hash = validMoveEvent()
    hash.payload.moveDefinitionHash = 'bad'
    expectEventError(() => parseAbilityEncounterEvent(hash))

    const actor = validMoveEvent()
    actor.actorPlacementId = 'other-token'
    expectEventError(() => parseAbilityEncounterEvent(actor))
  })

  it('rejects empty, malformed, duplicate, and noncanonical predicate filters', () => {
    expect(() => parseAbilityMoveEventPredicate({
      ...predicate(),
      timings: [], moveTypes: [], damageClasses: [], keywordsAny: [], keywordsAll: [],
      userRelation: 'any', targetRelation: 'any',
    })).toThrow(AbilityMoveEventPredicateValidationError)

    expect(() => parseAbilityMoveEventPredicate({
      ...predicate(),
      keywordsAny: ['interrupt', 'interrupt'],
    })).toThrow(AbilityMoveEventPredicateValidationError)

    expect(() => parseAbilityMoveEventPredicate({
      ...predicate(),
      moveTypes: ['light'],
    })).toThrow(AbilityMoveEventPredicateValidationError)

    expect(() => parseAbilityMoveEventPredicate({
      ...predicate(),
      callback: () => true,
    })).toThrow(AbilityMoveEventPredicateValidationError)
  })
})
