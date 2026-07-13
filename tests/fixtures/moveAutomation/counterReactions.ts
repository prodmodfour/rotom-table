import type {
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvent,
  type EncounterMoveDamagedEvent,
} from '#shared/moveAutomation/events'
import {
  applyMoveDamageCounterReaction,
  applyMoveEffectRedirectReaction,
  createMoveBideStorage,
  createMoveDamageCounterLedger,
  createMoveRedirectProvokingPlan,
  recordMoveBideDamage,
  recordMoveReactionDamage,
  releaseMoveBide,
  type MoveCounterReactionAuthority,
} from '~~/server/domain/moveAutomation/counterReactions'
import {
  createMoveAutomationRelationshipResolver,
  type MoveAutomationRelationshipPlacement,
} from '~~/server/domain/moveAutomation/relationships'

const PLACEMENTS = Object.freeze([
  { id: 'attacker', sideId: 'red' },
  { id: 'reactor', sideId: 'blue' },
  { id: 'ally', sideId: 'blue' },
  { id: 'other-enemy', sideId: 'red' },
  { id: 'unknown-side' },
] satisfies readonly MoveAutomationRelationshipPlacement[])

export const createCounterReactionCanaryAuthority = (
  immunities: readonly string[] = [],
): MoveCounterReactionAuthority => {
  const immunitySet = new Set(immunities)
  return Object.freeze({
    placementIds: Object.freeze(PLACEMENTS.map(placement => placement.id)),
    relationships: createMoveAutomationRelationshipResolver({
      placements: PLACEMENTS,
      sides: {
        blue: { id: 'blue', label: 'Blue', status: 'active' },
        red: { id: 'red', label: 'Red', status: 'active' },
      },
    }),
    isTypeImmune: (placementId: string, moveType: string): boolean => (
      immunitySet.has(`${placementId}:${moveType}`)
    ),
  })
}

export const counterDamageEvent = (input: {
  readonly eventId: string
  readonly resolutionId: string
  readonly canonicalMoveId: string
  readonly sourcePlacementId?: string
  readonly targetPlacementId?: string
  readonly hitIndex?: number
  readonly hitPointLoss: number
  readonly temporaryHitPointLoss?: number
  readonly damageClass: 'physical' | 'special' | 'direct'
  readonly moveType: string | null
}): EncounterMoveDamagedEvent => parseEncounterEvent({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId: input.eventId,
  kind: 'move-damaged',
  sourceOperationId: `${input.eventId}.operation`,
  causalParentEventId: null,
  reasonCode: 'counter.canary-damage',
  move: {
    resolutionId: input.resolutionId,
    canonicalId: input.canonicalMoveId,
    actorPlacementId: input.sourcePlacementId ?? 'attacker',
  },
  targetPlacementId: input.targetPlacementId ?? 'reactor',
  hitIndex: input.hitIndex ?? 1,
  damage: {
    hitPointLoss: input.hitPointLoss,
    temporaryHitPointLoss: input.temporaryHitPointLoss ?? 0,
    damageClass: input.damageClass,
    moveType: input.moveType,
  },
}) as EncounterMoveDamagedEvent

const conditionOperation = (): MoveConditionEffectOperation => ({
  id: 'provoking.status-condition',
  kind: 'condition',
  source: { kind: 'move', id: 'move.provoking-status' },
  recipients: { kind: 'hit-targets' },
  phase: 'hit',
  reasonCode: 'provoking.status-condition',
  payload: {
    action: 'apply',
    conditionId: 'poisoned',
    conditionSource: null,
    filter: null,
    randomChoice: null,
    duration: null,
    saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
  },
})

const stageOperation = (
  id: string,
  value: number,
): MoveCombatStageEffectOperation => ({
  id,
  kind: 'combat-stage',
  source: { kind: 'move', id: 'move.provoking-self' },
  recipients: { kind: 'actor' },
  phase: 'hit',
  reasonCode: id,
  payload: {
    action: 'modify',
    stage: 'atk',
    selectedStage: null,
    value,
    stageSource: null,
    rounding: null,
  },
})

export const COUNTER_REACTION_CANARY_SCENARIO_IDS = Object.freeze([
  'counter.physical-effective-loss',
  'counter.mirror-coat-special-effective-loss',
  'counter.bide-delayed-stored-damage',
  'counter.magic-coat-reflected-status',
  'counter.snatch-self-benefit-redirection',
])

export const runCounterCanaryScenario = () => {
  const authority = createCounterReactionCanaryAuthority()
  const damage = recordMoveReactionDamage(counterDamageEvent({
    eventId: 'event.counter.damage.1',
    resolutionId: 'resolution.trigger.physical',
    canonicalMoveId: 'Body Slam',
    hitPointLoss: 8,
    temporaryHitPointLoss: 2,
    damageClass: 'physical',
    moveType: 'normal',
  }))
  return applyMoveDamageCounterReaction({
    authority,
    ledger: createMoveDamageCounterLedger(),
    canonicalMoveId: 'Counter',
    reactorPlacementId: 'reactor',
    reactionOperationId: 'reaction.counter.1',
    reactionResolutionId: 'resolution.counter.1',
    // Replayed event evidence must not double-count the response magnitude.
    damageRecords: [damage, damage],
    reactorFainted: false,
  })
}

export const runMirrorCoatCanaryScenario = () => {
  const authority = createCounterReactionCanaryAuthority()
  const damage = recordMoveReactionDamage(counterDamageEvent({
    eventId: 'event.mirror-coat.damage.1',
    resolutionId: 'resolution.trigger.special',
    canonicalMoveId: 'Psychic',
    hitPointLoss: 6,
    damageClass: 'special',
    moveType: 'psychic',
  }))
  return applyMoveDamageCounterReaction({
    authority,
    ledger: createMoveDamageCounterLedger(),
    canonicalMoveId: 'Mirror Coat',
    reactorPlacementId: 'reactor',
    reactionOperationId: 'reaction.mirror-coat.1',
    reactionResolutionId: 'resolution.mirror-coat.1',
    damageRecords: [damage],
    reactorFainted: false,
  })
}

export const runBideCanaryScenario = () => {
  const authority = createCounterReactionCanaryAuthority()
  const trigger = recordMoveReactionDamage(counterDamageEvent({
    eventId: 'event.bide.damage.trigger',
    resolutionId: 'resolution.trigger.bide',
    canonicalMoveId: 'Scratch',
    hitPointLoss: 4,
    temporaryHitPointLoss: 1,
    damageClass: 'physical',
    moveType: 'normal',
  }))
  const later = recordMoveReactionDamage(counterDamageEvent({
    eventId: 'event.bide.damage.later',
    resolutionId: 'resolution.trigger.bide-later',
    canonicalMoveId: 'Ember',
    hitPointLoss: 3,
    temporaryHitPointLoss: 2,
    damageClass: 'special',
    moveType: 'fire',
  }))
  const opened = createMoveBideStorage({
    authority,
    userPlacementId: 'reactor',
    reactionOperationId: 'reaction.bide.1',
    resolutionId: 'resolution.bide.1',
    declaredTurn: 8,
    executeTurn: 11,
    triggeringDamageRecords: [trigger],
  })
  const accumulated = recordMoveBideDamage(opened, [later, later])
  return releaseMoveBide({
    authority,
    state: accumulated,
    currentTurn: 11,
    authoritativeAdjacentPlacementIds: [
      'attacker',
      'ally',
      'other-enemy',
      'unknown-side',
    ],
  })
}

export const runMagicCoatCanaryScenario = () => {
  const authority = createCounterReactionCanaryAuthority()
  const plan = createMoveRedirectProvokingPlan(authority, {
    triggeringResolutionId: 'resolution.trigger.magic-coat',
    actorPlacementId: 'attacker',
    attackedTargetIds: ['reactor'],
    hitTargetIds: ['reactor'],
    selfTargeting: false,
    hasDamageDiceRoll: false,
    effects: [{
      operation: conditionOperation(),
      disposition: 'harm',
      recipientIds: ['reactor'],
    }],
  })
  return applyMoveEffectRedirectReaction({
    authority,
    plan,
    canonicalMoveId: 'Magic Coat',
    reactorPlacementId: 'reactor',
    reactionOperationId: 'reaction.magic-coat.1',
    reactionResolutionId: 'resolution.magic-coat.1',
  })
}

export const runSnatchCanaryScenario = () => {
  const authority = createCounterReactionCanaryAuthority()
  const plan = createMoveRedirectProvokingPlan(authority, {
    triggeringResolutionId: 'resolution.trigger.snatch',
    actorPlacementId: 'attacker',
    attackedTargetIds: ['attacker'],
    hitTargetIds: ['attacker'],
    selfTargeting: true,
    hasDamageDiceRoll: false,
    effects: [{
      operation: stageOperation('provoking.self-benefit', 2),
      disposition: 'benefit',
      recipientIds: ['attacker'],
    }, {
      operation: stageOperation('provoking.self-cost', -1),
      disposition: 'cost',
      recipientIds: ['attacker'],
    }],
  })
  return applyMoveEffectRedirectReaction({
    authority,
    plan,
    canonicalMoveId: 'Snatch',
    reactorPlacementId: 'reactor',
    reactionOperationId: 'reaction.snatch.1',
    reactionResolutionId: 'resolution.snatch.1',
  })
}
