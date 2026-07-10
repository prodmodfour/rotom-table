import type {
  MoveBranchEffectOperation,
  MoveEffectBranchPath,
} from '#shared/moveAutomation/effects'
import type { MoveCheckResolution } from './checks'
import type { AuthoritativeMoveRulesContext } from './context'
import {
  evaluateMovePredicate,
  type MovePredicateEvaluationResult,
  type MoveRuleSelectorState,
} from './evaluateExpression'

export type MoveBranchExecutionErrorCode =
  | 'human-choice-not-resolved'
  | 'check-result-unavailable'

export class MoveBranchExecutionError extends Error {
  readonly code: MoveBranchExecutionErrorCode

  constructor(code: MoveBranchExecutionErrorCode, message: string) {
    super(message)
    this.name = 'MoveBranchExecutionError'
    this.code = code
  }
}

export interface MoveBranchSelectionDecision {
  /** Null means one resolution-wide decision; otherwise this is the branch subject. */
  readonly recipientId: string | null
  readonly branchId: string
  readonly reasonCode: string
}

export interface MoveBranchSelection {
  readonly operationId: string
  readonly selectionId: string
  readonly scope: 'resolution' | 'recipient'
  readonly decisions: readonly MoveBranchSelectionDecision[]
}

export interface ExecutedMoveBranchDecision extends MoveBranchSelectionDecision {
  /** Kept server-side to gate only reviewed later operations. */
  readonly operationIds: readonly string[]
  readonly predicateEvaluation: MovePredicateEvaluationResult | null
}

export interface ExecutedMoveBranch {
  readonly selection: MoveBranchSelection
  readonly decisions: readonly ExecutedMoveBranchDecision[]
}

export interface ExecuteServerMoveBranchInput {
  readonly operation: MoveBranchEffectOperation
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientIds: readonly string[]
  readonly selectorState: MoveRuleSelectorState
  readonly canonicalMoveId: string
  readonly resolvedChecks: readonly MoveCheckResolution[]
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const predicateSelectorState = (
  selectorState: MoveRuleSelectorState,
  recipientId: string | null,
): MoveRuleSelectorState => recipientId === null
  ? selectorState
  : { ...selectorState, targetIds: [recipientId] }

const executePredicateBranch = (
  input: ExecuteServerMoveBranchInput,
): readonly ExecutedMoveBranchDecision[] => {
  const payload = input.operation.payload
  if (payload.kind !== 'predicate') return []
  const subjects: readonly (string | null)[] = payload.scope === 'resolution'
    ? [null]
    : input.recipientIds
  return subjects.map((recipientId) => {
    const predicateEvaluation = evaluateMovePredicate({
      predicate: payload.predicate,
      context: input.context,
      selectorState: predicateSelectorState(input.selectorState, recipientId),
      canonicalMoveId: input.canonicalMoveId,
      rootNodeId: payload.selectionId,
    })
    const branch: MoveEffectBranchPath = predicateEvaluation.value
      ? payload.whenTrue
      : payload.whenFalse
    return deepFreeze({
      recipientId,
      branchId: branch.id,
      reasonCode: predicateEvaluation.value
        ? 'branch-predicate-true'
        : 'branch-predicate-false',
      operationIds: [...branch.operationIds],
      predicateEvaluation,
    })
  })
}

const executeRelationshipBranch = (
  input: ExecuteServerMoveBranchInput,
): readonly ExecutedMoveBranchDecision[] => {
  const payload = input.operation.payload
  if (payload.kind !== 'relationship') return []
  return input.recipientIds.map((recipientId) => {
    const relationship = input.context.queries.relationships.resolve(
      input.context.actor.placement.id,
      recipientId,
    )
    const branch = payload.branches[relationship.relationship]
    return deepFreeze({
      recipientId,
      branchId: branch.id,
      reasonCode: relationship.reasonCode,
      operationIds: [...branch.operationIds],
      predicateEvaluation: null,
    })
  })
}

const executeCheckResultBranch = (
  input: ExecuteServerMoveBranchInput,
): readonly ExecutedMoveBranchDecision[] => {
  const payload = input.operation.payload
  if (payload.kind !== 'check') return []
  return input.recipientIds.map((recipientId) => {
    const check = input.resolvedChecks.find(resolution => (
      resolution.checkId === payload.checkId
      && resolution.recipientId === recipientId
      && resolution.status === 'resolved'
      && resolution.selectedBranchId !== null
    ))
    if (!check || check.selectedBranchId === null) {
      throw new MoveBranchExecutionError(
        'check-result-unavailable',
        `Branch ${payload.selectionId} has no final ${payload.checkId} result for ${recipientId}.`,
      )
    }
    const branch = payload.branches[check.outcome]
    return deepFreeze({
      recipientId,
      branchId: check.selectedBranchId,
      reasonCode: check.outcome === 'success' ? 'branch-check-success' : 'branch-check-failure',
      operationIds: [...branch.operationIds],
      predicateEvaluation: null,
    })
  })
}

/**
 * Resolve a server-owned branch against one immutable snapshot. Human choices
 * deliberately stop at the interpreter boundary until durable resume support.
 */
export const executeServerMoveBranch = (
  input: ExecuteServerMoveBranchInput,
): ExecutedMoveBranch => {
  if (input.operation.payload.kind === 'choice') {
    throw new MoveBranchExecutionError(
      'human-choice-not-resolved',
      `Branch ${input.operation.payload.selectionId} requires a durable human response.`,
    )
  }
  const decisions = input.operation.payload.kind === 'predicate'
    ? executePredicateBranch(input)
    : input.operation.payload.kind === 'relationship'
      ? executeRelationshipBranch(input)
      : executeCheckResultBranch(input)
  const selection = {
    operationId: input.operation.id,
    selectionId: input.operation.payload.selectionId,
    scope: input.operation.payload.scope,
    decisions: decisions.map(({ recipientId, branchId, reasonCode }) => ({
      recipientId,
      branchId,
      reasonCode,
    })),
  } satisfies MoveBranchSelection
  return deepFreeze({ selection, decisions })
}
