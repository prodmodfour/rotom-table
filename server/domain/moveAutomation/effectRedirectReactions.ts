import {
  parseMoveEffectOperation,
  type MoveEffectOperation,
} from '#shared/moveAutomation/effects'
import { moveCounterReactionDefinition } from './counterReactionDefinitions'
import {
  MOVE_COUNTER_REACTION_LIMITS,
  assertCounterPlacement,
  assertCounterStableId,
  canonicalCounterPlacementIds,
  counterReactionAuthorityOrder,
  createReactionAncestryLink,
  createReactionUsageSpend,
  deepFreezeCounterReaction,
  failCounterReaction,
  type MoveCounterReactionAuthority,
  type MoveReactionResolutionLink,
  type MoveReactionUsageSpend,
} from './counterReactionCore'

export type MoveRedirectEffectDisposition = 'benefit' | 'harm' | 'cost' | 'neutral'

export interface MoveRedirectEffectRecipient {
  readonly placementId: string
  readonly sourcePlacementId: string
}

export interface MoveRedirectableEffectPlan {
  readonly operation: MoveEffectOperation
  readonly disposition: MoveRedirectEffectDisposition
  readonly recipients: readonly MoveRedirectEffectRecipient[]
}

export interface MoveRedirectReactionApplication {
  readonly reactionOperationId: string
  readonly canonicalMoveId: 'Magic Coat' | 'Snatch'
  readonly reactorPlacementId: string
  readonly triggeringResolutionId: string
  readonly reactionResolutionId: string
  readonly ancestry: MoveReactionResolutionLink
  readonly redirectedOperationIds: readonly string[]
  readonly recipientReplacements: readonly {
    readonly operationId: string
    readonly fromPlacementId: string
    readonly toPlacementId: string
    readonly sourcePlacementId: string
  }[]
  readonly reasonCode: string
}

export interface MoveRedirectProvokingPlan {
  readonly triggeringResolutionId: string
  readonly actorPlacementId: string
  readonly attackedTargetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly selfTargeting: boolean
  readonly hasDamageDiceRoll: boolean
  readonly effects: readonly MoveRedirectableEffectPlan[]
  readonly usageSpends: readonly MoveReactionUsageSpend[]
  readonly applications: readonly MoveRedirectReactionApplication[]
}

export type ApplyMoveEffectRedirectResult =
  | {
      readonly status: 'applied'
      readonly reasonCode: string
      readonly plan: MoveRedirectProvokingPlan
      readonly application: MoveRedirectReactionApplication
    }
  | {
      readonly status: 'duplicate'
      readonly reasonCode: 'redirect-reaction-duplicate'
      readonly plan: MoveRedirectProvokingPlan
      readonly application: MoveRedirectReactionApplication
    }
  | {
      readonly status: 'ineligible'
      readonly reasonCode:
        | 'magic-coat-damage-dice'
        | 'magic-coat-not-hit'
        | 'snatch-not-self-targeting'
        | 'redirect-no-eligible-effect'
      readonly plan: MoveRedirectProvokingPlan
      readonly application: null
    }

export const createMoveRedirectProvokingPlan = (
  authority: MoveCounterReactionAuthority,
  input: {
    readonly triggeringResolutionId: string
    readonly actorPlacementId: string
    readonly attackedTargetIds: readonly string[]
    readonly hitTargetIds: readonly string[]
    readonly selfTargeting: boolean
    readonly hasDamageDiceRoll: boolean
    readonly effects: readonly {
      readonly operation: MoveEffectOperation
      readonly disposition: MoveRedirectEffectDisposition
      readonly recipientIds: readonly string[]
    }[]
  },
): MoveRedirectProvokingPlan => {
  const triggeringResolutionId = assertCounterStableId(
    input.triggeringResolutionId,
    'triggering resolution ID',
  )
  assertCounterPlacement(authority, input.actorPlacementId, 'Provoking actor')
  const attackedTargetIds = canonicalCounterPlacementIds(
    authority,
    input.attackedTargetIds,
    'attackedTargetIds',
  )
  const hitTargetIds = canonicalCounterPlacementIds(
    authority,
    input.hitTargetIds,
    'hitTargetIds',
  )
  const attacked = new Set(attackedTargetIds)
  if (hitTargetIds.some(id => !attacked.has(id))) {
    return failCounterReaction('invalid-plan', 'A redirect hit target must have been attacked.')
  }
  if (!Array.isArray(input.effects)) {
    return failCounterReaction('invalid-plan', 'Redirect effects must be an array.')
  }
  if (input.effects.length > MOVE_COUNTER_REACTION_LIMITS.effects) {
    return failCounterReaction('limit-exceeded', 'Redirect effect plan exceeds the operation bound.')
  }
  if (typeof input.selfTargeting !== 'boolean' || typeof input.hasDamageDiceRoll !== 'boolean') {
    return failCounterReaction(
      'invalid-plan',
      'Redirect targeting and damage-dice flags must be booleans.',
    )
  }
  const operationIds = new Set<string>()
  const effects = input.effects.map((effect, index): MoveRedirectableEffectPlan => {
    const operation = parseMoveEffectOperation(effect.operation, `redirectPlan.effects[${index}]`)
    if (operationIds.has(operation.id)) {
      return failCounterReaction(
        'invalid-plan',
        `Redirect effect operation ${operation.id} is duplicated.`,
      )
    }
    operationIds.add(operation.id)
    if (!['benefit', 'harm', 'cost', 'neutral'].includes(effect.disposition)) {
      return failCounterReaction(
        'invalid-plan',
        `Redirect effect ${operation.id} has an invalid disposition.`,
      )
    }
    const recipientIds = canonicalCounterPlacementIds(
      authority,
      effect.recipientIds,
      `effects[${index}].recipientIds`,
    )
    return {
      operation,
      disposition: effect.disposition,
      recipients: recipientIds.map(placementId => ({
        placementId,
        sourcePlacementId: input.actorPlacementId,
      })),
    }
  })
  return deepFreezeCounterReaction({
    triggeringResolutionId,
    actorPlacementId: input.actorPlacementId,
    attackedTargetIds,
    hitTargetIds,
    selfTargeting: input.selfTargeting,
    hasDamageDiceRoll: input.hasDamageDiceRoll,
    effects,
    usageSpends: [],
    applications: [],
  })
}

const replaceEffectRecipient = (input: {
  readonly authority: MoveCounterReactionAuthority
  readonly effect: MoveRedirectableEffectPlan
  readonly fromPlacementId: string
  readonly toPlacementId: string
  readonly sourcePlacementId: string
}): {
  readonly effect: MoveRedirectableEffectPlan
  readonly replacement: MoveRedirectReactionApplication['recipientReplacements'][number] | null
} => {
  if (!input.effect.recipients.some(recipient => recipient.placementId === input.fromPlacementId)) {
    return { effect: input.effect, replacement: null }
  }
  const byPlacementId = new Map(
    input.effect.recipients
      .filter(recipient => recipient.placementId !== input.fromPlacementId)
      .map(recipient => [recipient.placementId, recipient]),
  )
  byPlacementId.set(input.toPlacementId, {
    placementId: input.toPlacementId,
    sourcePlacementId: input.sourcePlacementId,
  })
  const recipients = counterReactionAuthorityOrder(input.authority)
    .flatMap(placementId => {
      const recipient = byPlacementId.get(placementId)
      return recipient ? [recipient] : []
    })
  return {
    effect: { ...input.effect, recipients },
    replacement: {
      operationId: input.effect.operation.id,
      fromPlacementId: input.fromPlacementId,
      toPlacementId: input.toPlacementId,
      sourcePlacementId: input.sourcePlacementId,
    },
  }
}

const existingRedirectApplication = (input: {
  readonly plan: MoveRedirectProvokingPlan
  readonly reactionOperationId: string
  readonly canonicalMoveId: 'Magic Coat' | 'Snatch'
  readonly reactorPlacementId: string
  readonly reactionResolutionId: string
}): MoveRedirectReactionApplication | null => {
  const existing = input.plan.applications.find(
    application => application.reactionOperationId === input.reactionOperationId,
  )
  if (existing && (
    existing.canonicalMoveId !== input.canonicalMoveId
    || existing.reactorPlacementId !== input.reactorPlacementId
    || existing.reactionResolutionId !== input.reactionResolutionId
  )) {
    return failCounterReaction(
      'reaction-identity-conflict',
      'Redirect operation identity changed on replay.',
    )
  }
  if (existing) return existing
  if (input.plan.applications.some(
    application => application.reactionResolutionId === input.reactionResolutionId,
  )) {
    return failCounterReaction(
      'reaction-identity-conflict',
      'Redirect reaction resolution already has a parent.',
    )
  }
  return null
}

/** Reflect an incoming effect or transfer only reviewed self-benefits before commit. */
export const applyMoveEffectRedirectReaction = (input: {
  readonly authority: MoveCounterReactionAuthority
  readonly plan: MoveRedirectProvokingPlan
  readonly canonicalMoveId: 'Magic Coat' | 'Snatch'
  readonly reactorPlacementId: string
  readonly reactionOperationId: string
  readonly reactionResolutionId: string
}): ApplyMoveEffectRedirectResult => {
  assertCounterPlacement(input.authority, input.reactorPlacementId, 'Redirect reactor')
  const reactionOperationId = assertCounterStableId(
    input.reactionOperationId,
    'reaction operation ID',
  )
  const reactionResolutionId = assertCounterStableId(
    input.reactionResolutionId,
    'reaction resolution ID',
  )
  const definition = moveCounterReactionDefinition(input.canonicalMoveId)
  const existing = existingRedirectApplication({
    plan: input.plan,
    reactionOperationId,
    canonicalMoveId: input.canonicalMoveId,
    reactorPlacementId: input.reactorPlacementId,
    reactionResolutionId,
  })
  if (existing) {
    return Object.freeze({
      status: 'duplicate',
      reasonCode: 'redirect-reaction-duplicate',
      plan: input.plan,
      application: existing,
    })
  }
  if (input.plan.applications.length >= MOVE_COUNTER_REACTION_LIMITS.applications) {
    return failCounterReaction(
      'limit-exceeded',
      'Redirect reaction application bound was exceeded.',
    )
  }
  if (definition.canonicalId === 'Magic Coat' && input.plan.hasDamageDiceRoll) {
    return Object.freeze({
      status: 'ineligible',
      reasonCode: 'magic-coat-damage-dice',
      plan: input.plan,
      application: null,
    })
  }
  if (
    definition.canonicalId === 'Magic Coat'
    && !input.plan.hitTargetIds.includes(input.reactorPlacementId)
  ) {
    return Object.freeze({
      status: 'ineligible',
      reasonCode: 'magic-coat-not-hit',
      plan: input.plan,
      application: null,
    })
  }
  if (definition.canonicalId === 'Snatch' && (
    !input.plan.selfTargeting
    || !input.plan.attackedTargetIds.includes(input.plan.actorPlacementId)
  )) {
    return Object.freeze({
      status: 'ineligible',
      reasonCode: 'snatch-not-self-targeting',
      plan: input.plan,
      application: null,
    })
  }

  const fromPlacementId = definition.canonicalId === 'Magic Coat'
    ? input.reactorPlacementId
    : input.plan.actorPlacementId
  const toPlacementId = definition.canonicalId === 'Magic Coat'
    ? input.plan.actorPlacementId
    : input.reactorPlacementId
  const sourcePlacementId = definition.sourcePolicy === 'replace-with-reactor'
    ? input.reactorPlacementId
    : input.plan.actorPlacementId
  const replacements: MoveRedirectReactionApplication['recipientReplacements'][number][] = []
  const effects = input.plan.effects.map(effect => {
    if (definition.canonicalId === 'Snatch' && effect.disposition !== 'benefit') return effect
    const result = replaceEffectRecipient({
      authority: input.authority,
      effect,
      fromPlacementId,
      toPlacementId,
      sourcePlacementId,
    })
    if (result.replacement) replacements.push(result.replacement)
    return result.effect
  })
  if (replacements.length === 0) {
    return Object.freeze({
      status: 'ineligible',
      reasonCode: 'redirect-no-eligible-effect',
      plan: input.plan,
      application: null,
    })
  }
  const ancestry = createReactionAncestryLink(
    input.plan.triggeringResolutionId,
    reactionResolutionId,
  )
  const reasonCode = definition.canonicalId === 'Magic Coat'
    ? 'magic-coat.effect-reflected'
    : 'snatch.self-benefits-redirected'
  const application: MoveRedirectReactionApplication = deepFreezeCounterReaction({
    reactionOperationId,
    canonicalMoveId: definition.canonicalId,
    reactorPlacementId: input.reactorPlacementId,
    triggeringResolutionId: input.plan.triggeringResolutionId,
    reactionResolutionId,
    ancestry,
    redirectedOperationIds: [...new Set(replacements.map(entry => entry.operationId))],
    recipientReplacements: replacements,
    reasonCode,
  })
  const plan: MoveRedirectProvokingPlan = deepFreezeCounterReaction({
    ...input.plan,
    effects,
    usageSpends: [
      ...input.plan.usageSpends,
      createReactionUsageSpend({
        reactionOperationId,
        ownerPlacementId: input.reactorPlacementId,
        canonicalMoveId: definition.canonicalId,
      }),
    ],
    applications: [...input.plan.applications, application],
  })
  return Object.freeze({ status: 'applied', reasonCode, plan, application })
}
