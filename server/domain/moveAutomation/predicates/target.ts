import { MOVE_SPEC_LIMITS } from '#shared/moveAutomation/spec'
import type {
  MoveAutomationRelationshipKind,
  MoveAutomationRelationshipReasonCode,
  MoveAutomationRelationshipResolver,
  MoveAutomationRelationshipResult,
} from '../relationships'
import type { MoveSemiInvulnerableTargetabilityResolver } from '../semiInvulnerableTargetability'
import type { MoveAutomationTargetStateResolver } from '../targetState'
import {
  evaluateMoveAutomationTargetStatePredicates,
  parseMoveAutomationTargetStatePredicates,
  type MoveAutomationTargetStatePredicate,
  type MoveAutomationTargetStatePredicateReasonCode,
} from './targetState'

export const MOVE_AUTOMATION_TARGET_RELATIONSHIP_PREDICATES = [
  'self',
  'other',
  'ally',
  'enemy',
  'same-side',
  'any',
] as const

export const MOVE_AUTOMATION_TARGET_WILLINGNESS_PREDICATES = [
  'any',
  'willing',
  'unwilling',
] as const

export const MOVE_AUTOMATION_TARGET_WILLINGNESS_DECLARATIONS = [
  'willing',
  'unwilling',
] as const

export type MoveAutomationTargetRelationshipPredicate =
  (typeof MOVE_AUTOMATION_TARGET_RELATIONSHIP_PREDICATES)[number]

export type MoveAutomationTargetWillingnessPredicate =
  (typeof MOVE_AUTOMATION_TARGET_WILLINGNESS_PREDICATES)[number]

export type MoveAutomationTargetWillingnessDeclarationValue =
  (typeof MOVE_AUTOMATION_TARGET_WILLINGNESS_DECLARATIONS)[number]

export type MoveAutomationTargetWillingness =
  | MoveAutomationTargetWillingnessDeclarationValue
  | 'undeclared'

/** Reviewed identity and relationship rules for one target set. */
export interface MoveAutomationTargetPredicateDeclaration {
  readonly relationship: MoveAutomationTargetRelationshipPredicate
  readonly willingness: MoveAutomationTargetWillingnessPredicate
  /** Excludes the actor even when `same-side` or `any` would otherwise include it. */
  readonly excludeActor: boolean
  /** Optional all-of authoritative target-state constraints, evaluated before mechanics. */
  readonly statePredicates?: readonly MoveAutomationTargetStatePredicate[]
}

/**
 * Server-owned willingness evidence for this resolution.
 *
 * Callers may build these only from a reviewed rule or an authorised durable
 * response. A client-authored boolean is not authoritative willingness.
 */
export interface MoveAutomationTargetWillingnessDeclaration {
  readonly targetPlacementId: string
  readonly willingness: MoveAutomationTargetWillingnessDeclarationValue
}

export type MoveAutomationTargetPredicateOutcome = 'included' | 'excluded'

export type MoveAutomationTargetPredicateReasonCode =
  | 'target-included'
  | 'target-excluded-placement-missing'
  | 'target-excluded-not-authoritative-candidate'
  | 'target-excluded-duplicate'
  | 'target-excluded-actor'
  | 'target-excluded-unknown-side'
  | 'target-excluded-not-self'
  | 'target-excluded-not-other'
  | 'target-excluded-not-ally'
  | 'target-excluded-not-enemy'
  | 'target-excluded-not-same-side'
  | 'target-excluded-willingness-undeclared'
  | 'target-excluded-not-willing'
  | 'target-excluded-not-unwilling'
  | 'target-excluded-semi-invulnerable'
  | Exclude<MoveAutomationTargetStatePredicateReasonCode, 'target-state-included'>

export interface MoveAutomationTargetPredicateEvaluation {
  readonly targetPlacementId: string
  readonly outcome: MoveAutomationTargetPredicateOutcome
  readonly reasonCode: MoveAutomationTargetPredicateReasonCode
  readonly relationship: MoveAutomationRelationshipKind
  readonly relationshipReasonCode: MoveAutomationRelationshipReasonCode
  readonly willingness: MoveAutomationTargetWillingness
}

export interface MoveAutomationTargetPredicateResult {
  readonly predicate: MoveAutomationTargetPredicateDeclaration
  /** Every server-derived candidate that satisfies the declaration, in authoritative order. */
  readonly legalTargetPlacementIds: readonly string[]
  /** Requested candidates that are legal, distinct, and restored to authoritative order. */
  readonly eligibleTargetPlacementIds: readonly string[]
  /** One decision for every server-derived candidate. */
  readonly legalTargetEvaluations: readonly MoveAutomationTargetPredicateEvaluation[]
  /** One decision for every requested occurrence, preserving request order for audit. */
  readonly requestedTargetEvaluations: readonly MoveAutomationTargetPredicateEvaluation[]
}

export interface EvaluateMoveAutomationTargetPredicatesInput {
  readonly actorPlacementId: string
  /** Server-derived candidates, such as map, range, or geometry results. */
  readonly authoritativeCandidatePlacementIds: readonly string[]
  /** Client-selected IDs are requests only and cannot widen the authoritative set. */
  readonly requestedCandidatePlacementIds: readonly string[]
  readonly predicate: MoveAutomationTargetPredicateDeclaration
  readonly relationships: MoveAutomationRelationshipResolver
  readonly states?: MoveAutomationTargetStateResolver
  /** Server-owned global targetability gate for active setup states. */
  readonly targetability?: MoveSemiInvulnerableTargetabilityResolver
  readonly attackingMoveId?: string
  readonly originatingSetupOperationId?: string | null
  readonly willingnessDeclarations?: readonly MoveAutomationTargetWillingnessDeclaration[]
}

export type MoveAutomationTargetPredicateErrorCode =
  | 'invalid-target-predicate'
  | 'actor-placement-missing'
  | 'duplicate-authoritative-candidate'
  | 'invalid-willingness-declaration'
  | 'duplicate-willingness-declaration'
  | 'target-state-resolver-missing'
  | 'targetability-move-id-missing'
  | 'too-many-requested-targets'

export class MoveAutomationTargetPredicateError extends Error {
  readonly code: MoveAutomationTargetPredicateErrorCode

  constructor(code: MoveAutomationTargetPredicateErrorCode, message: string) {
    super(message)
    this.name = 'MoveAutomationTargetPredicateError'
    this.code = code
  }
}

const RELATIONSHIP_PREDICATE_SET = new Set<string>(
  MOVE_AUTOMATION_TARGET_RELATIONSHIP_PREDICATES,
)
const WILLINGNESS_PREDICATE_SET = new Set<string>(
  MOVE_AUTOMATION_TARGET_WILLINGNESS_PREDICATES,
)
const WILLINGNESS_DECLARATION_SET = new Set<string>(
  MOVE_AUTOMATION_TARGET_WILLINGNESS_DECLARATIONS,
)

const fail = (
  code: MoveAutomationTargetPredicateErrorCode,
  message: string,
): never => {
  throw new MoveAutomationTargetPredicateError(code, message)
}

const validPlacementId = (value: unknown): value is string => (
  typeof value === 'string' && value.length > 0 && value.trim() === value
)

/** Strictly parse, detach, and freeze one reviewed target declaration. */
export const parseMoveAutomationTargetPredicateDeclaration = (
  value: unknown,
): MoveAutomationTargetPredicateDeclaration => {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
  ) {
    return fail(
      'invalid-target-predicate',
      'Target predicate must declare only a supported relationship, willingness, actor-exclusion policy, and optional state predicates.',
    )
  }
  const predicate = value as Partial<MoveAutomationTargetPredicateDeclaration>
  if (
    !RELATIONSHIP_PREDICATE_SET.has(predicate.relationship ?? '')
    || !WILLINGNESS_PREDICATE_SET.has(predicate.willingness ?? '')
    || typeof predicate.excludeActor !== 'boolean'
    || Object.keys(predicate).some(key => ![
      'relationship',
      'willingness',
      'excludeActor',
      'statePredicates',
    ].includes(key))
  ) {
    return fail(
      'invalid-target-predicate',
      'Target predicate must declare only a supported relationship, willingness, actor-exclusion policy, and optional state predicates.',
    )
  }
  const hasStatePredicates = Object.prototype.hasOwnProperty.call(predicate, 'statePredicates')
  return Object.freeze({
    relationship: predicate.relationship!,
    willingness: predicate.willingness!,
    excludeActor: predicate.excludeActor,
    ...(hasStatePredicates
      ? {
          statePredicates: parseMoveAutomationTargetStatePredicates(
            predicate.statePredicates,
          ),
        }
      : {}),
  })
}

const authoritativeCandidateSet = (
  candidateIds: readonly string[],
): ReadonlySet<string> => {
  if (!Array.isArray(candidateIds)) {
    return fail('invalid-target-predicate', 'Authoritative target candidates must be an array.')
  }
  const candidates = new Set<string>()
  for (const candidateId of candidateIds) {
    if (!validPlacementId(candidateId)) {
      return fail('invalid-target-predicate', 'Authoritative target candidates contain an invalid placement ID.')
    }
    if (candidates.has(candidateId)) {
      return fail(
        'duplicate-authoritative-candidate',
        `Authoritative target candidate ${candidateId} was listed more than once.`,
      )
    }
    candidates.add(candidateId)
  }
  return candidates
}

const willingnessByTarget = (
  declarations: readonly MoveAutomationTargetWillingnessDeclaration[],
): ReadonlyMap<string, MoveAutomationTargetWillingnessDeclarationValue> => {
  if (!Array.isArray(declarations)) {
    return fail('invalid-willingness-declaration', 'Target willingness declarations must be an array.')
  }
  const byTarget = new Map<string, MoveAutomationTargetWillingnessDeclarationValue>()
  for (const declaration of declarations) {
    if (
      typeof declaration !== 'object'
      || declaration === null
      || !validPlacementId(declaration.targetPlacementId)
      || !WILLINGNESS_DECLARATION_SET.has(declaration.willingness)
    ) {
      return fail(
        'invalid-willingness-declaration',
        'Target willingness declarations require a placement ID and willing or unwilling value.',
      )
    }
    if (byTarget.has(declaration.targetPlacementId)) {
      return fail(
        'duplicate-willingness-declaration',
        `Target ${declaration.targetPlacementId} has more than one willingness declaration.`,
      )
    }
    byTarget.set(declaration.targetPlacementId, declaration.willingness)
  }
  return byTarget
}

const relationshipExclusionReason = (
  predicate: MoveAutomationTargetRelationshipPredicate,
  relationship: MoveAutomationRelationshipResult,
): MoveAutomationTargetPredicateReasonCode => {
  if (
    relationship.reasonCode === 'relationship-unknown-side'
    && (predicate === 'ally' || predicate === 'enemy' || predicate === 'same-side')
  ) {
    return 'target-excluded-unknown-side'
  }
  if (predicate === 'self') return 'target-excluded-not-self'
  if (predicate === 'other') return 'target-excluded-not-other'
  if (predicate === 'ally') return 'target-excluded-not-ally'
  if (predicate === 'enemy') return 'target-excluded-not-enemy'
  return 'target-excluded-not-same-side'
}

const evaluateRelationship = (
  actorPlacementId: string,
  targetPlacementId: string,
  predicate: MoveAutomationTargetRelationshipPredicate,
  relationships: MoveAutomationRelationshipResolver,
): {
  readonly relationship: MoveAutomationRelationshipResult
  readonly matches: boolean
} => {
  if (predicate === 'any' || predicate === 'other') {
    return {
      relationship: relationships.resolve(actorPlacementId, targetPlacementId),
      matches: predicate === 'any' || actorPlacementId !== targetPlacementId,
    }
  }
  const match = relationships.match(actorPlacementId, targetPlacementId, predicate)
  return { relationship: match, matches: match.matches }
}

const freezeEvaluation = (
  targetPlacementId: string,
  outcome: MoveAutomationTargetPredicateOutcome,
  reasonCode: MoveAutomationTargetPredicateReasonCode,
  relationship: MoveAutomationRelationshipResult,
  willingness: MoveAutomationTargetWillingness,
): MoveAutomationTargetPredicateEvaluation => Object.freeze({
  targetPlacementId,
  outcome,
  reasonCode,
  relationship: relationship.relationship,
  relationshipReasonCode: relationship.reasonCode,
  willingness,
})

const evaluateAuthoritativeCandidate = (options: {
  readonly actorPlacementId: string
  readonly targetPlacementId: string
  readonly predicate: MoveAutomationTargetPredicateDeclaration
  readonly relationships: MoveAutomationRelationshipResolver
  readonly states?: MoveAutomationTargetStateResolver
  readonly targetability?: MoveSemiInvulnerableTargetabilityResolver
  readonly attackingMoveId?: string
  readonly originatingSetupOperationId?: string | null
  readonly willingnessByTarget: ReadonlyMap<string, MoveAutomationTargetWillingnessDeclarationValue>
}): MoveAutomationTargetPredicateEvaluation => {
  const relationshipEvaluation = evaluateRelationship(
    options.actorPlacementId,
    options.targetPlacementId,
    options.predicate.relationship,
    options.relationships,
  )
  const relationship = relationshipEvaluation.relationship
  const willingness = options.willingnessByTarget.get(options.targetPlacementId) ?? 'undeclared'

  if (relationship.reasonCode === 'relationship-placement-missing') {
    return freezeEvaluation(
      options.targetPlacementId,
      'excluded',
      'target-excluded-placement-missing',
      relationship,
      willingness,
    )
  }
  if (options.predicate.excludeActor && options.targetPlacementId === options.actorPlacementId) {
    return freezeEvaluation(
      options.targetPlacementId,
      'excluded',
      'target-excluded-actor',
      relationship,
      willingness,
    )
  }
  if (!relationshipEvaluation.matches) {
    return freezeEvaluation(
      options.targetPlacementId,
      'excluded',
      relationshipExclusionReason(options.predicate.relationship, relationship),
      relationship,
      willingness,
    )
  }
  if (options.predicate.willingness !== 'any') {
    if (willingness === 'undeclared') {
      return freezeEvaluation(
        options.targetPlacementId,
        'excluded',
        'target-excluded-willingness-undeclared',
        relationship,
        willingness,
      )
    }
    if (willingness !== options.predicate.willingness) {
      return freezeEvaluation(
        options.targetPlacementId,
        'excluded',
        options.predicate.willingness === 'willing'
          ? 'target-excluded-not-willing'
          : 'target-excluded-not-unwilling',
        relationship,
        willingness,
      )
    }
  }
  if (options.targetability && options.attackingMoveId) {
    const targetability = options.targetability.resolve({
      actorPlacementId: options.actorPlacementId,
      targetPlacementId: options.targetPlacementId,
      attackingMoveId: options.attackingMoveId,
      originatingSetupOperationId: options.originatingSetupOperationId,
    })
    if (!targetability.targetable) {
      return freezeEvaluation(
        options.targetPlacementId,
        'excluded',
        'target-excluded-semi-invulnerable',
        relationship,
        willingness,
      )
    }
  }
  if (options.predicate.statePredicates) {
    const stateEvaluation = evaluateMoveAutomationTargetStatePredicates(
      options.predicate.statePredicates,
      options.states?.resolve(options.targetPlacementId) ?? null,
    )
    if (stateEvaluation.reasonCode !== 'target-state-included') {
      return freezeEvaluation(
        options.targetPlacementId,
        'excluded',
        stateEvaluation.reasonCode,
        relationship,
        willingness,
      )
    }
  }

  return freezeEvaluation(
    options.targetPlacementId,
    'included',
    'target-included',
    relationship,
    willingness,
  )
}

const requestedExclusion = (
  targetPlacementId: string,
  reasonCode: Extract<MoveAutomationTargetPredicateReasonCode,
    | 'target-excluded-not-authoritative-candidate'
    | 'target-excluded-duplicate'
    | 'target-excluded-placement-missing'
  >,
  relationship: MoveAutomationRelationshipResult,
  willingnessByTargetId: ReadonlyMap<string, MoveAutomationTargetWillingnessDeclarationValue>,
): MoveAutomationTargetPredicateEvaluation => freezeEvaluation(
  targetPlacementId,
  'excluded',
  reasonCode,
  relationship,
  willingnessByTargetId.get(targetPlacementId) ?? 'undeclared',
)

/**
 * Derive the legal relationship set first, then intersect it with requested IDs.
 * Request ordering cannot change mechanics ordering, duplicate a recipient, or
 * widen the server-authored candidate set.
 */
export const evaluateMoveAutomationTargetPredicates = (
  input: EvaluateMoveAutomationTargetPredicatesInput,
): MoveAutomationTargetPredicateResult => {
  if (!validPlacementId(input.actorPlacementId)) {
    return fail('actor-placement-missing', 'Move actor placement ID is invalid.')
  }
  const actorRelationship = input.relationships.resolve(
    input.actorPlacementId,
    input.actorPlacementId,
  )
  if (actorRelationship.reasonCode === 'relationship-placement-missing') {
    return fail(
      'actor-placement-missing',
      `Move actor placement ${input.actorPlacementId} was not found.`,
    )
  }
  const predicate = parseMoveAutomationTargetPredicateDeclaration(input.predicate)
  if (predicate.statePredicates && !input.states) {
    return fail(
      'target-state-resolver-missing',
      'Target state predicates require the server-owned target-state resolver.',
    )
  }
  if (input.targetability && (
    typeof input.attackingMoveId !== 'string'
    || input.attackingMoveId.length === 0
    || input.attackingMoveId.trim() !== input.attackingMoveId
  )) {
    return fail(
      'targetability-move-id-missing',
      'Semi-invulnerable targetability requires a server-owned attacking move ID.',
    )
  }
  const candidates = authoritativeCandidateSet(input.authoritativeCandidatePlacementIds)
  const willingness = willingnessByTarget(input.willingnessDeclarations ?? [])

  if (!Array.isArray(input.requestedCandidatePlacementIds)) {
    return fail('invalid-target-predicate', 'Requested target candidates must be an array.')
  }
  if (input.requestedCandidatePlacementIds.length > MOVE_SPEC_LIMITS.targetCount) {
    return fail(
      'too-many-requested-targets',
      `Requested target candidates must contain at most ${MOVE_SPEC_LIMITS.targetCount} entries.`,
    )
  }

  const legalTargetEvaluations = input.authoritativeCandidatePlacementIds.map(targetPlacementId => (
    evaluateAuthoritativeCandidate({
      actorPlacementId: input.actorPlacementId,
      targetPlacementId,
      predicate,
      relationships: input.relationships,
      states: input.states,
      targetability: input.targetability,
      attackingMoveId: input.attackingMoveId,
      originatingSetupOperationId: input.originatingSetupOperationId,
      willingnessByTarget: willingness,
    })
  ))
  const legalTargetPlacementIds = legalTargetEvaluations
    .filter(evaluation => evaluation.outcome === 'included')
    .map(evaluation => evaluation.targetPlacementId)
  const legalTargets = new Set(legalTargetPlacementIds)
  const requested = new Set<string>()
  const eligibleRequested = new Set<string>()
  const evaluationByCandidate = new Map(
    legalTargetEvaluations.map(evaluation => [evaluation.targetPlacementId, evaluation]),
  )

  const requestedTargetEvaluations = input.requestedCandidatePlacementIds.map((targetPlacementId) => {
    if (!validPlacementId(targetPlacementId)) {
      return fail('invalid-target-predicate', 'Requested target candidates contain an invalid placement ID.')
    }
    if (requested.has(targetPlacementId)) {
      return requestedExclusion(
        targetPlacementId,
        'target-excluded-duplicate',
        input.relationships.resolve(input.actorPlacementId, targetPlacementId),
        willingness,
      )
    }
    requested.add(targetPlacementId)

    if (!candidates.has(targetPlacementId)) {
      const relationship = input.relationships.resolve(input.actorPlacementId, targetPlacementId)
      return requestedExclusion(
        targetPlacementId,
        relationship.reasonCode === 'relationship-placement-missing'
          ? 'target-excluded-placement-missing'
          : 'target-excluded-not-authoritative-candidate',
        relationship,
        willingness,
      )
    }

    const evaluation = evaluationByCandidate.get(targetPlacementId)
      ?? fail(
        'invalid-target-predicate',
        `Authoritative target candidate ${targetPlacementId} has no evaluation.`,
      )
    if (legalTargets.has(targetPlacementId)) eligibleRequested.add(targetPlacementId)
    return evaluation
  })

  return Object.freeze({
    predicate,
    legalTargetPlacementIds: Object.freeze(legalTargetPlacementIds),
    eligibleTargetPlacementIds: Object.freeze(
      legalTargetPlacementIds.filter(targetPlacementId => eligibleRequested.has(targetPlacementId)),
    ),
    legalTargetEvaluations: Object.freeze(legalTargetEvaluations),
    requestedTargetEvaluations: Object.freeze(requestedTargetEvaluations),
  })
}
