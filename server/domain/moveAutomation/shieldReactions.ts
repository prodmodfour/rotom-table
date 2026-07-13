import {
  parseMoveEffectOperation,
  type MoveCombatStageEffectOperation,
  type MoveConditionEffectOperation,
  type MoveDirectHpEffectOperation,
  type MoveEffectOperation,
  type MoveEffectRecipientSelectorKind,
  type MoveReactionRequestEffectOperation,
} from '#shared/moveAutomation/effects'
import { moveReactionTimingDefinition } from '#shared/moveAutomation/reactions'
import type { AuthoritativeMoveRulesContext } from './context'
import type { MoveAutomationRelationshipResolver } from './relationships'
import {
  MOVE_SHIELD_GUARD_BREAK_PRIORITY,
  MOVE_SHIELD_REACTION_PRIORITY,
  moveShieldReactionDefinition,
  type MoveShieldReactionDefinition,
  type MoveShieldRetaliationKind,
} from './shieldReactionDefinitions'

export const MOVE_SHIELD_REACTION_LIMITS = Object.freeze({
  placements: 64,
  effects: 128,
  applications: 32,
  operationIdLength: 128,
})

export type MoveShieldProvokingMoveCategory = 'status' | 'damaging'
export type MoveShieldProvokingActionTiming = 'ordinary' | 'priority' | 'interrupt'
export type MoveShieldProvokingRange = 'melee' | 'ranged' | 'other'

export interface MoveShieldReactionAuthority {
  /** Complete authoritative placement order for deterministic output. */
  readonly placementIds: readonly string[]
  readonly relationships: MoveAutomationRelationshipResolver
}

export interface MoveShieldProvokingEffectPlan {
  readonly operationId: string
  readonly recipientIds: readonly string[]
}

export interface MoveShieldUsageSpendPlan {
  readonly kind: 'move-usage-spend'
  readonly reactionOperationId: string
  readonly ownerPlacementId: string
  readonly canonicalMoveId: MoveShieldReactionDefinition['canonicalId']
  readonly resourceId: string
  readonly amount: 1
}

export interface MoveShieldPreventionPlan {
  readonly kind: 'hit' | 'effect'
  readonly reactionOperationId: string
  readonly provokingOperationId: string | null
  readonly recipientIds: readonly string[]
  readonly reasonCode: string
}

export interface MoveShieldReactionApplication {
  readonly reactionOperationId: string
  readonly canonicalMoveId: MoveShieldReactionDefinition['canonicalId']
  readonly guardianPlacementId: string
  readonly outcome: 'applied' | 'broken'
  readonly reasonCode: string
  readonly priority: typeof MOVE_SHIELD_REACTION_PRIORITY
  readonly protectedRecipientIds: readonly string[]
  readonly cancelledHitTargetIds: readonly string[]
  readonly cancelledEffectOperationIds: readonly string[]
  readonly retaliationOperationIds: readonly string[]
  readonly guardBreakOperationId: string | null
}

/**
 * A bounded pre-commit projection of the provoking move. It contains mechanics
 * identities and authoritative recipients only—never callbacks or state patches.
 */
export interface MoveShieldProvokingPlan {
  readonly actorPlacementId: string
  readonly moveCategory: MoveShieldProvokingMoveCategory
  readonly actionTiming: MoveShieldProvokingActionTiming
  readonly range: MoveShieldProvokingRange
  readonly encounterRound: number
  readonly attackedTargetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly effects: readonly MoveShieldProvokingEffectPlan[]
  readonly preventedHitTargetIds: readonly string[]
  readonly preventions: readonly MoveShieldPreventionPlan[]
  readonly usageSpends: readonly MoveShieldUsageSpendPlan[]
  readonly retaliationOperations: readonly MoveEffectOperation[]
  readonly appliedReactions: readonly MoveShieldReactionApplication[]
}

export interface MoveShieldGuardBreak {
  readonly kind: 'feint'
  readonly operationId: string
  readonly priority: typeof MOVE_SHIELD_GUARD_BREAK_PRIORITY
}

export type MoveShieldIneligibleReasonCode =
  | 'shield-trigger-target-uncovered'
  | 'shield-trigger-category-mismatch'
  | 'shield-trigger-timing-mismatch'
  | 'shield-first-round-required'

export type ApplyMoveShieldReactionResult =
  | {
      readonly status: 'applied' | 'broken'
      readonly reasonCode: string
      readonly plan: MoveShieldProvokingPlan
      readonly application: MoveShieldReactionApplication
    }
  | {
      readonly status: 'duplicate'
      readonly reasonCode: 'shield-reaction-duplicate'
      readonly plan: MoveShieldProvokingPlan
      readonly application: MoveShieldReactionApplication
    }
  | {
      readonly status: 'ineligible'
      readonly reasonCode: MoveShieldIneligibleReasonCode
      readonly plan: MoveShieldProvokingPlan
      readonly application: null
    }

export type MoveShieldReactionErrorCode =
  | 'invalid-authority'
  | 'invalid-plan'
  | 'invalid-operation-id'
  | 'placement-not-found'
  | 'reaction-identity-conflict'
  | 'invalid-guard-break'
  | 'limit-exceeded'

export class MoveShieldReactionError extends Error {
  readonly code: MoveShieldReactionErrorCode

  constructor(code: MoveShieldReactionErrorCode, message: string) {
    super(message)
    this.name = 'MoveShieldReactionError'
    this.code = code
  }
}

const OPERATION_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/

const fail = (code: MoveShieldReactionErrorCode, message: string): never => {
  throw new MoveShieldReactionError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const validOperationId = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= MOVE_SHIELD_REACTION_LIMITS.operationIdLength
  && OPERATION_ID_PATTERN.test(value)
)

const assertOperationId = (value: unknown, label: string): string => {
  if (!validOperationId(value)) {
    return fail(
      'invalid-operation-id',
      `${label} must be a bounded lowercase stable operation ID.`,
    )
  }
  return value
}

const authorityOrder = (
  authority: MoveShieldReactionAuthority,
): readonly string[] => {
  if (!Array.isArray(authority.placementIds)) {
    return fail('invalid-authority', 'Shield reaction authority placementIds must be an array.')
  }
  if (authority.placementIds.length > MOVE_SHIELD_REACTION_LIMITS.placements) {
    return fail(
      'limit-exceeded',
      `Shield reaction authority exceeds ${MOVE_SHIELD_REACTION_LIMITS.placements} placements.`,
    )
  }
  const seen = new Set<string>()
  for (const id of authority.placementIds) {
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) {
      return fail('invalid-authority', 'Shield reaction authority has an invalid or duplicate placement ID.')
    }
    seen.add(id)
  }
  if (!authority.relationships || typeof authority.relationships.resolve !== 'function') {
    return fail('invalid-authority', 'Shield reaction authority requires relationship queries.')
  }
  return authority.placementIds
}

const canonicalPlacementIds = (
  authority: MoveShieldReactionAuthority,
  ids: readonly string[],
  label: string,
): readonly string[] => {
  if (!Array.isArray(ids)) return fail('invalid-plan', `${label} must be an array.`)
  if (ids.length > MOVE_SHIELD_REACTION_LIMITS.placements) {
    return fail('limit-exceeded', `${label} exceeds the shield placement bound.`)
  }
  const requested = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim() || requested.has(id)) {
      return fail('invalid-plan', `${label} has an invalid or duplicate placement ID.`)
    }
    requested.add(id)
  }
  const ordered = authorityOrder(authority).filter(id => requested.delete(id))
  if (requested.size > 0) {
    return fail('placement-not-found', `${label} references missing placement ${[...requested][0]}.`)
  }
  return ordered
}

const canonicalEffectPlans = (
  authority: MoveShieldReactionAuthority,
  effects: readonly MoveShieldProvokingEffectPlan[],
): readonly MoveShieldProvokingEffectPlan[] => {
  if (!Array.isArray(effects)) return fail('invalid-plan', 'Shield effect plans must be an array.')
  if (effects.length > MOVE_SHIELD_REACTION_LIMITS.effects) {
    return fail(
      'limit-exceeded',
      `Shield effect plans exceed ${MOVE_SHIELD_REACTION_LIMITS.effects} entries.`,
    )
  }
  const operationIds = new Set<string>()
  return effects.map((effect, index) => {
    const operationId = assertOperationId(effect?.operationId, `effects[${index}].operationId`)
    if (operationIds.has(operationId)) {
      return fail('invalid-plan', `Shield effect operation ${operationId} is duplicated.`)
    }
    operationIds.add(operationId)
    return Object.freeze({
      operationId,
      recipientIds: Object.freeze([
        ...canonicalPlacementIds(authority, effect.recipientIds, `effects[${index}].recipientIds`),
      ]),
    })
  })
}

const assertHitSubset = (
  attackedTargetIds: readonly string[],
  hitTargetIds: readonly string[],
): void => {
  const attacked = new Set(attackedTargetIds)
  const invalid = hitTargetIds.find(id => !attacked.has(id))
  if (invalid) fail('invalid-plan', `Hit target ${invalid} was not attacked.`)
}

export interface CreateMoveShieldProvokingPlanInput {
  readonly actorPlacementId: string
  readonly moveCategory: MoveShieldProvokingMoveCategory
  readonly actionTiming: MoveShieldProvokingActionTiming
  readonly range: MoveShieldProvokingRange
  readonly encounterRound: number
  readonly attackedTargetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly effects: readonly MoveShieldProvokingEffectPlan[]
}

/** Create the only supported empty shield overlay for a provoking move plan. */
export const createMoveShieldProvokingPlan = (
  authority: MoveShieldReactionAuthority,
  input: CreateMoveShieldProvokingPlanInput,
): MoveShieldProvokingPlan => {
  const placementIds = authorityOrder(authority)
  if (!placementIds.includes(input.actorPlacementId)) {
    return fail('placement-not-found', `Provoking actor ${input.actorPlacementId} is missing.`)
  }
  if (input.moveCategory !== 'status' && input.moveCategory !== 'damaging') {
    return fail('invalid-plan', 'Provoking move category must be status or damaging.')
  }
  if (!['ordinary', 'priority', 'interrupt'].includes(input.actionTiming)) {
    return fail('invalid-plan', 'Provoking action timing is invalid.')
  }
  if (!['melee', 'ranged', 'other'].includes(input.range)) {
    return fail('invalid-plan', 'Provoking move range is invalid.')
  }
  if (!Number.isSafeInteger(input.encounterRound) || input.encounterRound < 1) {
    return fail('invalid-plan', 'Encounter round must be a positive safe integer.')
  }
  const attackedTargetIds = canonicalPlacementIds(
    authority,
    input.attackedTargetIds,
    'attackedTargetIds',
  )
  const hitTargetIds = canonicalPlacementIds(authority, input.hitTargetIds, 'hitTargetIds')
  assertHitSubset(attackedTargetIds, hitTargetIds)

  return deepFreeze({
    actorPlacementId: input.actorPlacementId,
    moveCategory: input.moveCategory,
    actionTiming: input.actionTiming,
    range: input.range,
    encounterRound: input.encounterRound,
    attackedTargetIds: [...attackedTargetIds],
    hitTargetIds: [...hitTargetIds],
    effects: [...canonicalEffectPlans(authority, input.effects)],
    preventedHitTargetIds: [],
    preventions: [],
    usageSpends: [],
    retaliationOperations: [],
    appliedReactions: [],
  })
}

/** Adapt the immutable rules context without exposing its maps or sheet payloads. */
export const moveShieldReactionAuthorityFromContext = (
  context: Pick<AuthoritativeMoveRulesContext, 'queries'>,
): MoveShieldReactionAuthority => Object.freeze({
  placementIds: Object.freeze(context.queries.placements.all().map(placement => placement.id)),
  relationships: context.queries.relationships,
})

const isSelfOrAlly = (
  authority: MoveShieldReactionAuthority,
  guardianPlacementId: string,
  targetPlacementId: string,
): boolean => {
  const relationship = authority.relationships.resolve(guardianPlacementId, targetPlacementId)
  return relationship.relationship === 'self' || relationship.relationship === 'ally'
}

const coveredIds = (input: {
  readonly authority: MoveShieldReactionAuthority
  readonly definition: MoveShieldReactionDefinition
  readonly guardianPlacementId: string
  readonly authoritativeScopePlacementIds: readonly string[]
}): readonly string[] => {
  if (input.definition.scope.kind === 'self') return [input.guardianPlacementId]
  const candidates = canonicalPlacementIds(
    input.authority,
    input.authoritativeScopePlacementIds,
    'authoritativeScopePlacementIds',
  )
  if (input.definition.scope.coverageRelation === 'any') return candidates
  return candidates.filter(id => isSelfOrAlly(
    input.authority,
    input.guardianPlacementId,
    id,
  ))
}

const eligibleTriggerIds = (input: {
  readonly authority: MoveShieldReactionAuthority
  readonly definition: MoveShieldReactionDefinition
  readonly guardianPlacementId: string
  readonly covered: readonly string[]
}): readonly string[] => input.definition.trigger.eligibleRelation === 'self'
  ? input.covered.filter(id => id === input.guardianPlacementId)
  : input.covered.filter(id => isSelfOrAlly(
      input.authority,
      input.guardianPlacementId,
      id,
    ))

const triggerFailure = (input: {
  readonly definition: MoveShieldReactionDefinition
  readonly plan: MoveShieldProvokingPlan
  readonly triggerIds: readonly string[]
}): MoveShieldIneligibleReasonCode | null => {
  const triggerTargets = input.definition.trigger.event === 'hit'
    ? input.plan.hitTargetIds
    : input.plan.attackedTargetIds
  if (!triggerTargets.some(id => input.triggerIds.includes(id))) {
    return 'shield-trigger-target-uncovered'
  }
  if (
    input.definition.trigger.category !== 'any'
    && input.definition.trigger.category !== input.plan.moveCategory
  ) {
    return 'shield-trigger-category-mismatch'
  }
  if (
    input.definition.trigger.actionTiming === 'priority-or-interrupt'
    && input.plan.actionTiming !== 'priority'
    && input.plan.actionTiming !== 'interrupt'
  ) {
    return 'shield-trigger-timing-mismatch'
  }
  if (input.definition.trigger.firstRoundOnly && input.plan.encounterRound !== 1) {
    return 'shield-first-round-required'
  }
  return null
}

const conditionRetaliation = (
  operationId: string,
  definition: MoveShieldReactionDefinition,
): MoveConditionEffectOperation => ({
  id: `${operationId}.retaliation`,
  kind: 'condition',
  source: { kind: 'operation', id: operationId },
  recipients: { kind: 'actor' },
  phase: 'after-damage',
  reasonCode: `${definition.definitionId}.melee-retaliation`,
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

const stageRetaliation = (
  operationId: string,
  definition: MoveShieldReactionDefinition,
  stage: 'atk' | 'def',
): MoveCombatStageEffectOperation => ({
  id: `${operationId}.retaliation`,
  kind: 'combat-stage',
  source: { kind: 'operation', id: operationId },
  recipients: { kind: 'actor' },
  phase: 'after-damage',
  reasonCode: `${definition.definitionId}.melee-retaliation`,
  payload: {
    action: 'modify',
    stage,
    selectedStage: null,
    value: -2,
    stageSource: null,
    rounding: null,
  },
})

const tickRetaliation = (
  operationId: string,
  definition: MoveShieldReactionDefinition,
): MoveDirectHpEffectOperation => ({
  id: `${operationId}.retaliation`,
  kind: 'direct-hp',
  source: { kind: 'operation', id: operationId },
  recipients: { kind: 'actor' },
  phase: 'after-damage',
  reasonCode: `${definition.definitionId}.melee-retaliation`,
  payload: {
    mode: 'lose',
    pool: 'hit-points',
    calculation: { kind: 'percent-max', percent: 10 },
    copySource: null,
    bounds: { minimum: null, maximum: null },
    rounding: 'floor',
    applyTypeImmunity: false,
    cost: null,
    injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
  },
})

const retaliationOperation = (
  kind: MoveShieldRetaliationKind,
  reactionOperationId: string,
  definition: MoveShieldReactionDefinition,
): MoveEffectOperation => {
  const operation = kind === 'poison-attacker'
    ? conditionRetaliation(reactionOperationId, definition)
    : kind === 'lower-attacker-attack-two'
      ? stageRetaliation(reactionOperationId, definition, 'atk')
      : kind === 'lower-attacker-defense-two'
        ? stageRetaliation(reactionOperationId, definition, 'def')
        : tickRetaliation(reactionOperationId, definition)
  return parseMoveEffectOperation(operation, 'shieldReaction.retaliation')
}

const assertGuardBreak = (
  guardBreak: MoveShieldGuardBreak | null | undefined,
): MoveShieldGuardBreak | null => {
  if (!guardBreak) return null
  if (
    guardBreak.kind !== 'feint'
    || guardBreak.priority !== MOVE_SHIELD_GUARD_BREAK_PRIORITY
    || !validOperationId(guardBreak.operationId)
  ) {
    return fail('invalid-guard-break', 'Shield guard break is not a reviewed Feint operation.')
  }
  return guardBreak
}

export const createMoveShieldGuardBreak = (
  operationId: string,
): MoveShieldGuardBreak => Object.freeze({
  kind: 'feint',
  operationId: assertOperationId(operationId, 'guardBreak.operationId'),
  priority: MOVE_SHIELD_GUARD_BREAK_PRIORITY,
})

const usageSpend = (input: {
  readonly definition: MoveShieldReactionDefinition
  readonly guardianPlacementId: string
  readonly reactionOperationId: string
}): MoveShieldUsageSpendPlan => Object.freeze({
  kind: 'move-usage-spend',
  reactionOperationId: input.reactionOperationId,
  ownerPlacementId: input.guardianPlacementId,
  canonicalMoveId: input.definition.canonicalId,
  resourceId: input.definition.usageResourceId,
  amount: 1,
})

const canonicalUnion = (
  authority: MoveShieldReactionAuthority,
  left: readonly string[],
  right: readonly string[],
  label: string,
): readonly string[] => canonicalPlacementIds(authority, [...new Set([...left, ...right])], label)

/**
 * Apply one selected, authorized shield response to the still-uncommitted
 * provoking plan. A reviewed Feint break spends the shield use but leaves the
 * provoking hit/effects intact. Reapplying the same response operation is an
 * idempotent no-op, so usage and retaliation are never duplicated.
 */
export const applyMoveShieldReaction = (input: {
  readonly authority: MoveShieldReactionAuthority
  readonly plan: MoveShieldProvokingPlan
  readonly canonicalMoveId: MoveShieldReactionDefinition['canonicalId']
  readonly guardianPlacementId: string
  readonly reactionOperationId: string
  readonly authoritativeScopePlacementIds?: readonly string[]
  readonly guardBreak?: MoveShieldGuardBreak | null
}): ApplyMoveShieldReactionResult => {
  const placementIds = authorityOrder(input.authority)
  if (!placementIds.includes(input.guardianPlacementId)) {
    return fail('placement-not-found', `Shield guardian ${input.guardianPlacementId} is missing.`)
  }
  const reactionOperationId = assertOperationId(
    input.reactionOperationId,
    'reactionOperationId',
  )
  const existing = input.plan.appliedReactions.find(application => (
    application.reactionOperationId === reactionOperationId
  ))
  if (existing) {
    if (
      existing.canonicalMoveId !== input.canonicalMoveId
      || existing.guardianPlacementId !== input.guardianPlacementId
    ) {
      return fail(
        'reaction-identity-conflict',
        `Shield reaction ${reactionOperationId} was already used by another definition or guardian.`,
      )
    }
    return Object.freeze({
      status: 'duplicate',
      reasonCode: 'shield-reaction-duplicate',
      plan: input.plan,
      application: existing,
    })
  }
  if (input.plan.appliedReactions.length >= MOVE_SHIELD_REACTION_LIMITS.applications) {
    return fail('limit-exceeded', 'Shield reaction application bound was exceeded.')
  }

  const definition = moveShieldReactionDefinition(input.canonicalMoveId)
  const covered = coveredIds({
    authority: input.authority,
    definition,
    guardianPlacementId: input.guardianPlacementId,
    authoritativeScopePlacementIds: input.authoritativeScopePlacementIds ?? [],
  })
  const triggerIds = eligibleTriggerIds({
    authority: input.authority,
    definition,
    guardianPlacementId: input.guardianPlacementId,
    covered,
  })
  const failure = triggerFailure({ definition, plan: input.plan, triggerIds })
  if (failure) {
    return Object.freeze({
      status: 'ineligible',
      reasonCode: failure,
      plan: input.plan,
      application: null,
    })
  }

  const guardBreak = assertGuardBreak(input.guardBreak)
  const cancelledHitTargetIds = guardBreak
    ? []
    : definition.cancellation.scope === 'all-targets'
      ? [...input.plan.attackedTargetIds]
      : input.plan.attackedTargetIds.filter(id => covered.includes(id))
  const cancelledSet = new Set(cancelledHitTargetIds)
  const cancelledEffectOperationIds: string[] = []
  const effectPreventions: MoveShieldPreventionPlan[] = []
  const effects = input.plan.effects.map(effect => {
    if (guardBreak || !definition.cancellation.cancelEffects) return effect
    const preventedIds = effect.recipientIds.filter(id => cancelledSet.has(id))
    if (preventedIds.length === 0) return effect
    cancelledEffectOperationIds.push(effect.operationId)
    effectPreventions.push(Object.freeze({
      kind: 'effect' as const,
      reactionOperationId,
      provokingOperationId: effect.operationId,
      recipientIds: Object.freeze([...preventedIds]),
      reasonCode: `${definition.definitionId}.effect-cancelled`,
    }))
    return Object.freeze({
      ...effect,
      recipientIds: Object.freeze(effect.recipientIds.filter(id => !cancelledSet.has(id))),
    })
  })
  const retaliation = !guardBreak
    && definition.retaliation
    && input.plan.range === 'melee'
    ? [retaliationOperation(definition.retaliation.kind, reactionOperationId, definition)]
    : []
  const reasonCode = guardBreak
    ? `${definition.definitionId}.broken-by-feint`
    : `${definition.definitionId}.shield-applied`
  const hitPrevention: MoveShieldPreventionPlan[] = cancelledHitTargetIds.length === 0
    ? []
    : [Object.freeze({
        kind: 'hit' as const,
        reactionOperationId,
        provokingOperationId: null,
        recipientIds: Object.freeze([...cancelledHitTargetIds]),
        reasonCode: `${definition.definitionId}.hit-cancelled`,
      })]
  const application: MoveShieldReactionApplication = deepFreeze({
    reactionOperationId,
    canonicalMoveId: definition.canonicalId,
    guardianPlacementId: input.guardianPlacementId,
    outcome: guardBreak ? 'broken' : 'applied',
    reasonCode,
    priority: definition.priority,
    protectedRecipientIds: [...covered],
    cancelledHitTargetIds: [...cancelledHitTargetIds],
    cancelledEffectOperationIds: [...cancelledEffectOperationIds],
    retaliationOperationIds: retaliation.map(operation => operation.id),
    guardBreakOperationId: guardBreak?.operationId ?? null,
  })
  const nextPlan: MoveShieldProvokingPlan = deepFreeze({
    ...input.plan,
    hitTargetIds: definition.cancellation.cancelHit && !guardBreak
      ? input.plan.hitTargetIds.filter(id => !cancelledSet.has(id))
      : [...input.plan.hitTargetIds],
    effects,
    preventedHitTargetIds: canonicalUnion(
      input.authority,
      input.plan.preventedHitTargetIds,
      cancelledHitTargetIds,
      'preventedHitTargetIds',
    ),
    preventions: [...input.plan.preventions, ...hitPrevention, ...effectPreventions],
    usageSpends: [
      ...input.plan.usageSpends,
      usageSpend({ definition, guardianPlacementId: input.guardianPlacementId, reactionOperationId }),
    ],
    retaliationOperations: [...input.plan.retaliationOperations, ...retaliation],
    appliedReactions: [...input.plan.appliedReactions, application],
  })
  return Object.freeze({
    status: guardBreak ? 'broken' : 'applied',
    reasonCode,
    plan: nextPlan,
    application,
  })
}

/** Build the phase-bound durable window operation used by future registered specs. */
export const buildMoveShieldReactionRequestOperation = (input: {
  readonly canonicalMoveId: MoveShieldReactionDefinition['canonicalId']
  readonly operationId: string
  readonly recipients: MoveEffectRecipientSelectorKind
}): MoveReactionRequestEffectOperation => {
  const definition = moveShieldReactionDefinition(input.canonicalMoveId)
  const operation: MoveReactionRequestEffectOperation = {
    id: assertOperationId(input.operationId, 'shieldRequest.operationId'),
    kind: 'reaction-request',
    source: { kind: 'move', id: `move.${definition.definitionId}` },
    recipients: { kind: input.recipients },
    phase: moveReactionTimingDefinition(definition.timing).phase,
    reasonCode: `${definition.definitionId}.shield-window`,
    payload: {
      requestId: `${definition.definitionId}.shield-request`,
      promptKey: definition.promptKey,
      options: [{ id: definition.optionId, labelKey: definition.optionLabelKey }],
      allowPass: true,
      timing: definition.timing,
      priority: definition.priority,
    },
  }
  return parseMoveEffectOperation(
    operation,
    'shieldReaction.request',
  ) as MoveReactionRequestEffectOperation
}
