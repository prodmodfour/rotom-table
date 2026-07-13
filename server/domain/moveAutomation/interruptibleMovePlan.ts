import {
  MOVE_EFFECT_OPERATION_LIMITS,
  parseMoveEffectOperation,
  type MoveEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationRelationshipResolver } from './relationships'
import { stableJsonStringify } from './stableJson'

export const INTERRUPTIBLE_MOVE_PLAN_LIMITS = Object.freeze({
  placements: 64,
  operations: MOVE_EFFECT_OPERATION_LIMITS.operations,
  usageSpends: 32,
  applications: 32,
  identifierLength: 160,
  canonicalMoveLength: 160,
  keywords: 32,
})

export interface InterruptibleMovePlanAuthority {
  /** Complete authoritative placement order for deterministic replacements. */
  readonly placementIds: readonly string[]
  readonly relationships: MoveAutomationRelationshipResolver
}

export interface MoveResolvedOperationPlan {
  readonly operation: MoveEffectOperation
  /** Server-resolved mechanics source; operation.source remains provenance. */
  readonly sourcePlacementId: string
  /** Server-resolved recipients in authoritative placement order. */
  readonly recipientIds: readonly string[]
}

export interface MovePlanUsageSpend {
  readonly kind: 'move-usage-spend'
  readonly operationId: string
  readonly ownerPlacementId: string
  readonly resourceId: string
  readonly amount: 1
  readonly disposition: 'triggering-move' | 'reaction'
}

export interface MovePlanSourceReplacement {
  readonly fromPlacementId: string
  readonly toPlacementId: string
}

export interface MovePlanTargetReplacement {
  readonly fromPlacementId: string
  readonly toPlacementId: string
}

export interface MovePlanParticipantReplacementApplication {
  readonly applicationId: string
  readonly reasonCode: string
  readonly sourceReplacement: MovePlanSourceReplacement | null
  readonly targetReplacements: readonly MovePlanTargetReplacement[]
}

export interface MovePlanCancellationApplication {
  readonly applicationId: string
  readonly reasonCode: string
  readonly cancellationKind: string
  readonly canceller: {
    readonly kind: 'placement' | 'lifecycle-event'
    readonly id: string
  }
  readonly retainTriggeringUsage: boolean
  readonly cancelledOperationIds: readonly string[]
  readonly retainedUsageOperationIds: readonly string[]
  readonly reactionUsageOperationId: string | null
}

/**
 * Bounded immutable mechanics waiting at a pre-commit reaction boundary.
 * Recipient IDs are server projections; clients never author this structure.
 */
export interface InterruptibleMovePlan {
  readonly resolutionId: string
  readonly canonicalMoveId: string
  readonly actorPlacementId: string
  readonly sourcePlacementId: string
  /** Feint uses this to prove the shield answered this actor's triggering action. */
  readonly triggeringActionSourcePlacementId: string | null
  readonly keywords: readonly string[]
  readonly targetClass: 'self' | 'opponents' | 'others' | 'none'
  readonly targetRedirectionAllowed: boolean
  readonly accuracyState: 'pending' | 'resolved'
  readonly targetPlacementIds: readonly string[]
  readonly operations: readonly MoveResolvedOperationPlan[]
  readonly usageSpends: readonly MovePlanUsageSpend[]
  readonly status: 'pending' | 'cancelled'
  readonly participantReplacements: readonly MovePlanParticipantReplacementApplication[]
  readonly cancellations: readonly MovePlanCancellationApplication[]
}

export type InterruptibleMovePlanErrorCode =
  | 'invalid-authority'
  | 'invalid-plan'
  | 'invalid-id'
  | 'placement-not-found'
  | 'duplicate-id'
  | 'limit-exceeded'
  | 'plan-not-pending'
  | 'accuracy-already-resolved'
  | 'application-identity-conflict'

export class InterruptibleMovePlanError extends Error {
  readonly code: InterruptibleMovePlanErrorCode

  constructor(code: InterruptibleMovePlanErrorCode, message: string) {
    super(message)
    this.name = 'InterruptibleMovePlanError'
    this.code = code
  }
}

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const KEYWORD_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const fail = (code: InterruptibleMovePlanErrorCode, message: string): never => {
  throw new InterruptibleMovePlanError(code, message)
}

export const deepFreezeInterruptibleMovePlan = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreezeInterruptibleMovePlan((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

export const assertMovePlanStableId = (
  value: unknown,
  label: string,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > INTERRUPTIBLE_MOVE_PLAN_LIMITS.identifierLength
    || !STABLE_ID_PATTERN.test(value)
  ) {
    return fail('invalid-id', `${label} must be a bounded lowercase stable ID.`)
  }
  return value
}

const assertCanonicalMoveId = (value: unknown): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > INTERRUPTIBLE_MOVE_PLAN_LIMITS.canonicalMoveLength
    || value.trim() !== value
  ) {
    return fail('invalid-plan', 'Canonical move ID must be bounded non-empty text.')
  }
  return value
}

export const movePlanAuthorityOrder = (
  authority: InterruptibleMovePlanAuthority,
): readonly string[] => {
  if (!Array.isArray(authority.placementIds)) {
    return fail('invalid-authority', 'Interruptible plan authority placementIds must be an array.')
  }
  if (authority.placementIds.length > INTERRUPTIBLE_MOVE_PLAN_LIMITS.placements) {
    return fail('limit-exceeded', 'Interruptible plan authority exceeds the placement bound.')
  }
  const seen = new Set<string>()
  for (const placementId of authority.placementIds) {
    if (
      typeof placementId !== 'string'
      || !placementId.trim()
      || seen.has(placementId)
    ) {
      return fail(
        'invalid-authority',
        'Interruptible plan authority has an invalid or duplicate placement ID.',
      )
    }
    seen.add(placementId)
  }
  if (!authority.relationships || typeof authority.relationships.resolve !== 'function') {
    return fail('invalid-authority', 'Interruptible plan authority requires relationship queries.')
  }
  return authority.placementIds
}

export const assertMovePlanPlacement = (
  authority: InterruptibleMovePlanAuthority,
  placementId: string,
  label: string,
): string => movePlanAuthorityOrder(authority).includes(placementId)
  ? placementId
  : fail('placement-not-found', `${label} ${placementId} is not authoritative.`)

export const canonicalMovePlanPlacementIds = (
  authority: InterruptibleMovePlanAuthority,
  values: readonly string[],
  label: string,
): readonly string[] => {
  if (!Array.isArray(values)) return fail('invalid-plan', `${label} must be an array.`)
  if (values.length > INTERRUPTIBLE_MOVE_PLAN_LIMITS.placements) {
    return fail('limit-exceeded', `${label} exceeds the placement bound.`)
  }
  const requested = new Set<string>()
  for (const placementId of values) {
    if (typeof placementId !== 'string' || !placementId.trim()) {
      return fail('invalid-plan', `${label} has an invalid placement ID.`)
    }
    if (requested.has(placementId)) {
      return fail('duplicate-id', `${label} duplicates placement ${placementId}.`)
    }
    requested.add(placementId)
  }
  const ordered = movePlanAuthorityOrder(authority).filter(id => requested.delete(id))
  if (requested.size > 0) {
    return fail(
      'placement-not-found',
      `${label} references missing placement ${[...requested][0]}.`,
    )
  }
  return ordered
}

const canonicalKeywords = (values: readonly string[]): readonly string[] => {
  if (!Array.isArray(values)) return fail('invalid-plan', 'Move keywords must be an array.')
  if (values.length > INTERRUPTIBLE_MOVE_PLAN_LIMITS.keywords) {
    return fail('limit-exceeded', 'Move keywords exceed the bounded count.')
  }
  const keywords: string[] = []
  for (const keyword of values) {
    if (
      typeof keyword !== 'string'
      || keyword.length > INTERRUPTIBLE_MOVE_PLAN_LIMITS.identifierLength
      || !KEYWORD_PATTERN.test(keyword)
    ) {
      return fail('invalid-plan', 'Move keywords must be lowercase stable keyword IDs.')
    }
    if (keywords.includes(keyword)) return fail('duplicate-id', `Move keyword ${keyword} is duplicated.`)
    keywords.push(keyword)
  }
  return keywords.sort((left, right) => left.localeCompare(right))
}

export const createMovePlanUsageSpend = (
  authority: InterruptibleMovePlanAuthority,
  input: Omit<MovePlanUsageSpend, 'kind' | 'amount'>,
): MovePlanUsageSpend => {
  if (input.disposition !== 'triggering-move' && input.disposition !== 'reaction') {
    return fail('invalid-plan', 'Usage disposition must be triggering-move or reaction.')
  }
  return deepFreezeInterruptibleMovePlan({
    kind: 'move-usage-spend' as const,
    operationId: assertMovePlanStableId(input.operationId, 'Usage operation ID'),
    ownerPlacementId: assertMovePlanPlacement(
      authority,
      input.ownerPlacementId,
      'Usage owner',
    ),
    resourceId: assertMovePlanStableId(input.resourceId, 'Usage resource ID'),
    amount: 1 as const,
    disposition: input.disposition,
  })
}

const canonicalUsageSpends = (
  authority: InterruptibleMovePlanAuthority,
  values: readonly MovePlanUsageSpend[],
): readonly MovePlanUsageSpend[] => {
  if (!Array.isArray(values)) return fail('invalid-plan', 'Move usage spends must be an array.')
  if (values.length > INTERRUPTIBLE_MOVE_PLAN_LIMITS.usageSpends) {
    return fail('limit-exceeded', 'Move usage spends exceed the bounded count.')
  }
  const operationIds = new Set<string>()
  return values.map((usage, index) => {
    if (usage?.kind !== 'move-usage-spend' || usage.amount !== 1) {
      return fail('invalid-plan', `Usage spend ${index} must be a one-unit move usage spend.`)
    }
    const parsed = createMovePlanUsageSpend(authority, usage)
    if (operationIds.has(parsed.operationId)) {
      return fail('duplicate-id', `Usage operation ${parsed.operationId} is duplicated.`)
    }
    operationIds.add(parsed.operationId)
    return parsed
  })
}

const canonicalOperations = (
  authority: InterruptibleMovePlanAuthority,
  values: readonly MoveResolvedOperationPlan[],
): readonly MoveResolvedOperationPlan[] => {
  if (!Array.isArray(values)) return fail('invalid-plan', 'Resolved operations must be an array.')
  if (values.length > INTERRUPTIBLE_MOVE_PLAN_LIMITS.operations) {
    return fail('limit-exceeded', 'Resolved operations exceed the operation bound.')
  }
  const operationIds = new Set<string>()
  return values.map((entry, index) => {
    const operation = parseMoveEffectOperation(entry?.operation, `interruptiblePlan.operations[${index}]`)
    if (operationIds.has(operation.id)) {
      return fail('duplicate-id', `Resolved operation ${operation.id} is duplicated.`)
    }
    operationIds.add(operation.id)
    return deepFreezeInterruptibleMovePlan({
      operation,
      sourcePlacementId: assertMovePlanPlacement(
        authority,
        entry.sourcePlacementId,
        `Resolved operation ${operation.id} source`,
      ),
      recipientIds: [...canonicalMovePlanPlacementIds(
        authority,
        entry.recipientIds,
        `Resolved operation ${operation.id} recipients`,
      )],
    })
  })
}

export interface CreateInterruptibleMovePlanInput {
  readonly resolutionId: string
  readonly canonicalMoveId: string
  readonly actorPlacementId: string
  readonly sourcePlacementId?: string
  readonly triggeringActionSourcePlacementId?: string | null
  readonly keywords: readonly string[]
  readonly targetClass: InterruptibleMovePlan['targetClass']
  readonly targetRedirectionAllowed: boolean
  readonly accuracyState?: InterruptibleMovePlan['accuracyState']
  readonly targetPlacementIds: readonly string[]
  readonly operations: readonly MoveResolvedOperationPlan[]
  readonly usageSpends: readonly MovePlanUsageSpend[]
}

export const createInterruptibleMovePlan = (
  authority: InterruptibleMovePlanAuthority,
  input: CreateInterruptibleMovePlanInput,
): InterruptibleMovePlan => {
  const actorPlacementId = assertMovePlanPlacement(
    authority,
    input.actorPlacementId,
    'Move actor',
  )
  const sourcePlacementId = assertMovePlanPlacement(
    authority,
    input.sourcePlacementId ?? actorPlacementId,
    'Move mechanics source',
  )
  const triggeringActionSourcePlacementId = input.triggeringActionSourcePlacementId === null
    || input.triggeringActionSourcePlacementId === undefined
    ? null
    : assertMovePlanPlacement(
        authority,
        input.triggeringActionSourcePlacementId,
        'Triggering action source',
      )
  if (!['self', 'opponents', 'others', 'none'].includes(input.targetClass)) {
    return fail('invalid-plan', 'Move target class is invalid.')
  }
  if (typeof input.targetRedirectionAllowed !== 'boolean') {
    return fail('invalid-plan', 'Move target redirection policy must be boolean.')
  }
  const accuracyState = input.accuracyState ?? 'pending'
  if (accuracyState !== 'pending' && accuracyState !== 'resolved') {
    return fail('invalid-plan', 'Move accuracy state is invalid.')
  }
  return deepFreezeInterruptibleMovePlan({
    resolutionId: assertMovePlanStableId(input.resolutionId, 'Move resolution ID'),
    canonicalMoveId: assertCanonicalMoveId(input.canonicalMoveId),
    actorPlacementId,
    sourcePlacementId,
    triggeringActionSourcePlacementId,
    keywords: [...canonicalKeywords(input.keywords)],
    targetClass: input.targetClass,
    targetRedirectionAllowed: input.targetRedirectionAllowed,
    accuracyState,
    targetPlacementIds: [...canonicalMovePlanPlacementIds(
      authority,
      input.targetPlacementIds,
      'Move target placement IDs',
    )],
    operations: [...canonicalOperations(authority, input.operations)],
    usageSpends: [...canonicalUsageSpends(authority, input.usageSpends)],
    status: 'pending' as const,
    participantReplacements: [],
    cancellations: [],
  })
}

export const markInterruptibleMovePlanAccuracyResolved = (
  plan: InterruptibleMovePlan,
): InterruptibleMovePlan => plan.accuracyState === 'resolved'
  ? plan
  : deepFreezeInterruptibleMovePlan({ ...plan, accuracyState: 'resolved' as const })

const sameJson = (left: unknown, right: unknown): boolean => (
  stableJsonStringify(left) === stableJsonStringify(right)
)

export type ReplaceMovePlanParticipantsResult =
  | {
      readonly status: 'applied'
      readonly plan: InterruptibleMovePlan
      readonly application: MovePlanParticipantReplacementApplication
    }
  | {
      readonly status: 'duplicate'
      readonly plan: InterruptibleMovePlan
      readonly application: MovePlanParticipantReplacementApplication
    }
  | {
      readonly status: 'unchanged'
      readonly plan: InterruptibleMovePlan
      readonly application: null
    }

/** Replace source/targets in a still-unrolled plan and every resolved operation projection. */
export const replaceInterruptibleMovePlanParticipants = (input: {
  readonly authority: InterruptibleMovePlanAuthority
  readonly plan: InterruptibleMovePlan
  readonly applicationId: string
  readonly reasonCode: string
  readonly sourceReplacement?: MovePlanSourceReplacement | null
  readonly targetReplacements?: readonly MovePlanTargetReplacement[]
}): ReplaceMovePlanParticipantsResult => {
  if (input.plan.status !== 'pending') {
    return fail('plan-not-pending', 'A cancelled move plan cannot be redirected.')
  }
  if (input.plan.accuracyState !== 'pending') {
    return fail('accuracy-already-resolved', 'Move participants must be replaced before accuracy.')
  }
  const applicationId = assertMovePlanStableId(input.applicationId, 'Replacement application ID')
  const reasonCode = assertMovePlanStableId(input.reasonCode, 'Replacement reason code')
  const sourceReplacement = input.sourceReplacement ?? null
  if (sourceReplacement) {
    assertMovePlanPlacement(input.authority, sourceReplacement.fromPlacementId, 'Replacement source')
    assertMovePlanPlacement(input.authority, sourceReplacement.toPlacementId, 'Replacement source')
  }
  const rawTargetReplacements = input.targetReplacements ?? []
  if (!Array.isArray(rawTargetReplacements)) {
    return fail('invalid-plan', 'Target replacements must be an array.')
  }
  if (rawTargetReplacements.length > INTERRUPTIBLE_MOVE_PLAN_LIMITS.placements) {
    return fail('limit-exceeded', 'Target replacements exceed the placement bound.')
  }
  const fromIds = new Set<string>()
  const targetReplacements = rawTargetReplacements.map(replacement => {
    const fromPlacementId = assertMovePlanPlacement(
      input.authority,
      replacement.fromPlacementId,
      'Replacement target',
    )
    const toPlacementId = assertMovePlanPlacement(
      input.authority,
      replacement.toPlacementId,
      'Replacement target',
    )
    if (fromIds.has(fromPlacementId)) {
      return fail('duplicate-id', `Target replacement duplicates ${fromPlacementId}.`)
    }
    fromIds.add(fromPlacementId)
    return Object.freeze({ fromPlacementId, toPlacementId })
  })
  const proposedApplication: MovePlanParticipantReplacementApplication = deepFreezeInterruptibleMovePlan({
    applicationId,
    reasonCode,
    sourceReplacement: sourceReplacement ? { ...sourceReplacement } : null,
    targetReplacements: [...targetReplacements],
  })
  const existing = input.plan.participantReplacements.find(
    application => application.applicationId === applicationId,
  )
  if (existing) {
    if (!sameJson(existing, proposedApplication)) {
      return fail(
        'application-identity-conflict',
        `Participant replacement ${applicationId} changed on replay.`,
      )
    }
    return Object.freeze({ status: 'duplicate', plan: input.plan, application: existing })
  }
  if (
    sourceReplacement
    && sourceReplacement.fromPlacementId !== input.plan.sourcePlacementId
  ) {
    return fail('invalid-plan', 'Source replacement must replace the current mechanics source.')
  }
  for (const replacement of targetReplacements) {
    if (!input.plan.targetPlacementIds.includes(replacement.fromPlacementId)) {
      return fail(
        'invalid-plan',
        `Target replacement ${replacement.fromPlacementId} is not a current target.`,
      )
    }
  }
  if (input.plan.participantReplacements.length >= INTERRUPTIBLE_MOVE_PLAN_LIMITS.applications) {
    return fail('limit-exceeded', 'Participant replacement application bound was exceeded.')
  }

  const targetByOriginal = new Map(
    targetReplacements.map(replacement => [replacement.fromPlacementId, replacement.toPlacementId]),
  )
  const replaceTarget = (placementId: string): string => targetByOriginal.get(placementId)
    ?? placementId
  const nextSource = sourceReplacement?.toPlacementId ?? input.plan.sourcePlacementId
  const nextTargets = canonicalMovePlanPlacementIds(
    input.authority,
    [...new Set(input.plan.targetPlacementIds.map(replaceTarget))],
    'Replaced move targets',
  )
  const operations = input.plan.operations.map(entry => deepFreezeInterruptibleMovePlan({
    ...entry,
    sourcePlacementId: sourceReplacement
      && entry.sourcePlacementId === sourceReplacement.fromPlacementId
      ? sourceReplacement.toPlacementId
      : entry.sourcePlacementId,
    recipientIds: [...canonicalMovePlanPlacementIds(
      input.authority,
      [...new Set(entry.recipientIds.map(replaceTarget))],
      `Replaced operation ${entry.operation.id} recipients`,
    )],
  }))
  const changed = nextSource !== input.plan.sourcePlacementId
    || !sameJson(nextTargets, input.plan.targetPlacementIds)
    || !sameJson(operations, input.plan.operations)
  if (!changed) return Object.freeze({ status: 'unchanged', plan: input.plan, application: null })

  const plan = deepFreezeInterruptibleMovePlan({
    ...input.plan,
    sourcePlacementId: nextSource,
    targetPlacementIds: [...nextTargets],
    operations,
    participantReplacements: [...input.plan.participantReplacements, proposedApplication],
  })
  return Object.freeze({ status: 'applied', plan, application: proposedApplication })
}

export type CancelInterruptibleMovePlanResult =
  | {
      readonly status: 'cancelled'
      readonly plan: InterruptibleMovePlan
      readonly application: MovePlanCancellationApplication
    }
  | {
      readonly status: 'duplicate'
      readonly plan: InterruptibleMovePlan
      readonly application: MovePlanCancellationApplication
    }

/**
 * Cancel deferred mechanics in-place at the plan layer. Nothing here inverses
 * an accepted mutation: triggering usage is retained or dropped by reviewed policy.
 */
export const cancelInterruptibleMovePlan = (input: {
  readonly authority: InterruptibleMovePlanAuthority
  readonly plan: InterruptibleMovePlan
  readonly applicationId: string
  readonly cancellationKind: string
  readonly reasonCode: string
  readonly canceller: MovePlanCancellationApplication['canceller']
  readonly retainTriggeringUsage: boolean
  readonly reactionUsage?: MovePlanUsageSpend | null
}): CancelInterruptibleMovePlanResult => {
  const applicationId = assertMovePlanStableId(input.applicationId, 'Cancellation application ID')
  const cancellationKind = assertMovePlanStableId(input.cancellationKind, 'Cancellation kind')
  const reasonCode = assertMovePlanStableId(input.reasonCode, 'Cancellation reason code')
  const canceller = Object.freeze({
    kind: input.canceller.kind,
    id: assertMovePlanStableId(input.canceller.id, 'Cancellation source ID'),
  })
  if (canceller.kind === 'placement') {
    assertMovePlanPlacement(input.authority, canceller.id, 'Cancellation source')
  }
  else if (canceller.kind !== 'lifecycle-event') {
    return fail('invalid-plan', 'Cancellation source kind is invalid.')
  }
  if (typeof input.retainTriggeringUsage !== 'boolean') {
    return fail('invalid-plan', 'Cancellation usage-retention policy must be boolean.')
  }
  const reactionUsage = input.reactionUsage
    ? createMovePlanUsageSpend(input.authority, input.reactionUsage)
    : null
  if (reactionUsage && reactionUsage.disposition !== 'reaction') {
    return fail('invalid-plan', 'Cancellation-owned usage must have reaction disposition.')
  }

  const existing = input.plan.cancellations.find(
    application => application.applicationId === applicationId,
  )
  if (existing) {
    const replayIdentity = {
      applicationId,
      reasonCode,
      cancellationKind,
      canceller,
      retainTriggeringUsage: input.retainTriggeringUsage,
      reactionUsageOperationId: reactionUsage?.operationId ?? null,
    }
    const existingIdentity = {
      applicationId: existing.applicationId,
      reasonCode: existing.reasonCode,
      cancellationKind: existing.cancellationKind,
      canceller: existing.canceller,
      retainTriggeringUsage: existing.retainTriggeringUsage,
      reactionUsageOperationId: existing.reactionUsageOperationId,
    }
    if (!sameJson(existingIdentity, replayIdentity)) {
      return fail(
        'application-identity-conflict',
        `Cancellation ${applicationId} changed on replay.`,
      )
    }
    return Object.freeze({ status: 'duplicate', plan: input.plan, application: existing })
  }
  if (input.plan.status !== 'pending') {
    return fail('plan-not-pending', 'A move plan cannot be cancelled twice by distinct facts.')
  }
  if (input.plan.cancellations.length >= INTERRUPTIBLE_MOVE_PLAN_LIMITS.applications) {
    return fail('limit-exceeded', 'Move plan cancellation bound was exceeded.')
  }
  const retainedUsage = input.retainTriggeringUsage
    ? input.plan.usageSpends
    : input.plan.usageSpends.filter(usage => usage.disposition === 'reaction')
  const proposedApplication: MovePlanCancellationApplication = deepFreezeInterruptibleMovePlan({
    applicationId,
    reasonCode,
    cancellationKind,
    canceller,
    retainTriggeringUsage: input.retainTriggeringUsage,
    cancelledOperationIds: input.plan.operations.map(entry => entry.operation.id),
    retainedUsageOperationIds: retainedUsage.map(usage => usage.operationId),
    reactionUsageOperationId: reactionUsage?.operationId ?? null,
  })
  const usageSpends = [
    ...retainedUsage,
    ...(reactionUsage ? [reactionUsage] : []),
  ]
  if (new Set(usageSpends.map(usage => usage.operationId)).size !== usageSpends.length) {
    return fail('duplicate-id', 'Cancellation usage operation identity is duplicated.')
  }
  if (usageSpends.length > INTERRUPTIBLE_MOVE_PLAN_LIMITS.usageSpends) {
    return fail('limit-exceeded', 'Cancellation usage spends exceed the bounded count.')
  }
  const plan = deepFreezeInterruptibleMovePlan({
    ...input.plan,
    operations: [],
    usageSpends,
    status: 'cancelled' as const,
    cancellations: [...input.plan.cancellations, proposedApplication],
  })
  return Object.freeze({ status: 'cancelled', plan, application: proposedApplication })
}
