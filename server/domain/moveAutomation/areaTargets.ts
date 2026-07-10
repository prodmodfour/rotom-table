import { MOVE_SPEC_LIMITS } from '#shared/moveAutomation/spec'
import type { MoveAutomationRelationshipResolver } from './relationships'
import type { MoveAutomationTargetStateResolver } from './targetState'
import {
  evaluateMoveAutomationTargetPredicates,
  type MoveAutomationTargetPredicateDeclaration,
  type MoveAutomationTargetPredicateEvaluation,
  type MoveAutomationTargetPredicateReasonCode,
} from './predicates/target'

export const DEFAULT_MOVE_AUTOMATION_AREA_TARGET_PREDICATE = Object.freeze<MoveAutomationTargetPredicateDeclaration>({
  relationship: 'any',
  willingness: 'any',
  excludeActor: true,
})

export type MoveAutomationAreaTargetReasonCode =
  | MoveAutomationTargetPredicateReasonCode
  | 'requested-friendly-exclusion'

export interface MoveAutomationAreaTargetEvaluation
  extends Omit<MoveAutomationTargetPredicateEvaluation, 'reasonCode'> {
  readonly reasonCode: MoveAutomationAreaTargetReasonCode
}

export interface MoveAutomationAreaTargetResult {
  readonly predicate: MoveAutomationTargetPredicateDeclaration
  /** Placements whose footprints intersect the server-derived area, in map order. */
  readonly geometricallyAffectedPlacementIds: readonly string[]
  /** Predicate-eligible placements after reviewed Friendly exclusions, in map order. */
  readonly eligibleTargetPlacementIds: readonly string[]
  /** Server-only audit evidence for every geometrically affected placement. */
  readonly evaluations: readonly MoveAutomationAreaTargetEvaluation[]
}

export interface ResolveMoveAutomationAreaTargetsInput {
  readonly actorPlacementId: string
  /** Geometry must be resolved before this function is called. */
  readonly geometricallyAffectedPlacementIds: readonly string[]
  readonly predicate: MoveAutomationTargetPredicateDeclaration
  readonly relationships: MoveAutomationRelationshipResolver
  readonly states?: MoveAutomationTargetStateResolver
  /** Already validated Friendly intent; it may narrow but never widen geometry. */
  readonly requestedExcludedPlacementIds?: readonly string[]
}

export type MoveAutomationAreaTargetErrorCode =
  | 'invalid-requested-exclusions'
  | 'duplicate-requested-exclusion'
  | 'requested-exclusion-outside-geometry'
  | 'too-many-requested-exclusions'

export class MoveAutomationAreaTargetError extends Error {
  readonly code: MoveAutomationAreaTargetErrorCode

  constructor(code: MoveAutomationAreaTargetErrorCode, message: string) {
    super(message)
    this.name = 'MoveAutomationAreaTargetError'
    this.code = code
  }
}

const fail = (
  code: MoveAutomationAreaTargetErrorCode,
  message: string,
): never => {
  throw new MoveAutomationAreaTargetError(code, message)
}

const requestedExclusionSet = (
  values: readonly string[],
  geometricallyAffectedPlacementIds: readonly string[],
): ReadonlySet<string> => {
  if (!Array.isArray(values)) {
    return fail('invalid-requested-exclusions', 'Requested area exclusions must be an array.')
  }
  if (values.length > MOVE_SPEC_LIMITS.targetCount) {
    return fail(
      'too-many-requested-exclusions',
      `Requested area exclusions must contain at most ${MOVE_SPEC_LIMITS.targetCount} placement IDs.`,
    )
  }

  const geometry = new Set(geometricallyAffectedPlacementIds)
  const exclusions = new Set<string>()
  for (const placementId of values) {
    if (typeof placementId !== 'string' || placementId.length === 0 || placementId.trim() !== placementId) {
      return fail('invalid-requested-exclusions', 'Requested area exclusions contain an invalid placement ID.')
    }
    if (exclusions.has(placementId)) {
      return fail(
        'duplicate-requested-exclusion',
        `Requested area exclusion ${placementId} was listed more than once.`,
      )
    }
    if (!geometry.has(placementId)) {
      return fail(
        'requested-exclusion-outside-geometry',
        `Requested area exclusion ${placementId} is not geometrically affected.`,
      )
    }
    exclusions.add(placementId)
  }
  return exclusions
}

const freezeEvaluation = (
  evaluation: MoveAutomationTargetPredicateEvaluation,
  requestedExclusions: ReadonlySet<string>,
): MoveAutomationAreaTargetEvaluation => {
  const requestedExclusion = evaluation.outcome === 'included'
    && requestedExclusions.has(evaluation.targetPlacementId)
  return Object.freeze({
    ...evaluation,
    outcome: requestedExclusion ? 'excluded' as const : evaluation.outcome,
    reasonCode: requestedExclusion
      ? 'requested-friendly-exclusion' as const
      : evaluation.reasonCode,
  })
}

/**
 * Filter a completed geometry result through one reviewed target declaration.
 *
 * Every geometric candidate receives one server-only decision. Client Friendly
 * exclusions are applied only after the predicate and cannot make an illegal or
 * out-of-area placement eligible.
 */
export const resolveMoveAutomationAreaTargets = (
  input: ResolveMoveAutomationAreaTargetsInput,
): MoveAutomationAreaTargetResult => {
  const requestedExclusions = requestedExclusionSet(
    input.requestedExcludedPlacementIds ?? [],
    input.geometricallyAffectedPlacementIds,
  )
  const predicateResult = evaluateMoveAutomationTargetPredicates({
    actorPlacementId: input.actorPlacementId,
    authoritativeCandidatePlacementIds: input.geometricallyAffectedPlacementIds,
    requestedCandidatePlacementIds: input.geometricallyAffectedPlacementIds,
    predicate: input.predicate,
    relationships: input.relationships,
    states: input.states,
  })
  const evaluations = predicateResult.legalTargetEvaluations.map(evaluation => (
    freezeEvaluation(evaluation, requestedExclusions)
  ))
  const eligibleTargetPlacementIds = evaluations
    .filter(evaluation => evaluation.outcome === 'included')
    .map(evaluation => evaluation.targetPlacementId)

  return Object.freeze({
    predicate: predicateResult.predicate,
    geometricallyAffectedPlacementIds: Object.freeze([
      ...input.geometricallyAffectedPlacementIds,
    ]),
    eligibleTargetPlacementIds: Object.freeze(eligibleTargetPlacementIds),
    evaluations: Object.freeze(evaluations),
  })
}
