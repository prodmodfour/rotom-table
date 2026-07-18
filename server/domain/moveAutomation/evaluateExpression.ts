import {
  MOVE_RULE_AST_LIMITS,
  moveRuleScalarIdentity,
  type MoveRuleScalar,
} from '#shared/moveAutomation/ast'
import type {
  MoveArithmeticOperator,
  MoveCombatStageStat,
  MoveExpression,
  MoveExpressionKind,
  MoveHistoryQuery,
  MoveWeightMetric,
} from '#shared/moveAutomation/expressions'
import type {
  MoveComparisonOperator,
  MovePredicate,
  MovePredicateKind,
} from '#shared/moveAutomation/predicates'
import type {
  MoveSelector,
  MoveSelectorLeafKind,
} from '#shared/moveAutomation/selectors'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { AuthoritativeMoveRulesContext } from './context'

/**
 * Numeric expressions retain fractions unless their consumer explicitly asks
 * for an integer. Integer rounding is applied once, at the root result; child
 * nodes keep their exact bounded values so formulas do not round repeatedly.
 */
export const MOVE_EXPRESSION_NUMERIC_POLICIES = [
  'preserve',
  'integer-floor',
  'integer-round',
  'integer-ceil',
  'integer-truncate',
] as const

export type MoveExpressionNumericPolicy =
  (typeof MOVE_EXPRESSION_NUMERIC_POLICIES)[number]

export const MOVE_EXPRESSION_EVALUATION_LIMITS = Object.freeze({
  nodes: MOVE_RULE_AST_LIMITS.nodes,
  depth: MOVE_RULE_AST_LIMITS.depth,
  numericMagnitude: MOVE_RULE_AST_LIMITS.numericMagnitude,
  nodeIdLength: 500,
})

/** Interpreter-owned recipient sets used by selector leaves. */
export interface MoveRuleSelectorState {
  readonly targetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly missedTargetIds: readonly string[]
  readonly damagedTargetIds: readonly string[]
  readonly faintedTargetIds: readonly string[]
}

export interface EvaluateMoveSelectorInput {
  readonly selector: MoveSelector
  readonly context: AuthoritativeMoveRulesContext
  readonly selectorState?: MoveRuleSelectorState
}

interface MoveRuleEvaluationInputBase {
  readonly context: AuthoritativeMoveRulesContext
  readonly selectorState?: MoveRuleSelectorState
  /** Defaults to the authoritative intent's move name. */
  readonly canonicalMoveId?: string
  readonly numericPolicy?: MoveExpressionNumericPolicy
  /** Stable audit namespace for the root node. */
  readonly rootNodeId?: string
}

export interface EvaluateMoveExpressionInput extends MoveRuleEvaluationInputBase {
  readonly expression: MoveExpression
}

export interface EvaluateMovePredicateInput extends MoveRuleEvaluationInputBase {
  readonly predicate: MovePredicate
}

export interface MoveExpressionEvaluationTraceEntry {
  readonly nodeType: 'expression'
  readonly nodeId: string
  readonly expressionKind: MoveExpressionKind
  readonly value: MoveRuleScalar
}

export interface MovePredicateEvaluationTraceEntry {
  readonly nodeType: 'predicate'
  readonly nodeId: string
  readonly predicateKind: MovePredicateKind
  readonly value: boolean
}

export type MoveRuleEvaluationTraceEntry =
  | MoveExpressionEvaluationTraceEntry
  | MovePredicateEvaluationTraceEntry

export interface MoveExpressionEvaluationResult {
  readonly value: MoveRuleScalar
  /** Post-order audit values for every expression node that was evaluated. */
  readonly trace: readonly MoveRuleEvaluationTraceEntry[]
}

export interface MovePredicateEvaluationResult {
  readonly value: boolean
  /** Post-order audit values for every expression and predicate node evaluated. */
  readonly trace: readonly MoveRuleEvaluationTraceEntry[]
}

export type MoveExpressionEvaluationErrorCode =
  | 'invalid-node'
  | 'limit-exceeded'
  | 'non-finite-value'
  | 'numeric-value-required'
  | 'numeric-overflow'
  | 'divide-by-zero'
  | 'invalid-clamp-bounds'
  | 'missing-selector'
  | 'ambiguous-selector'
  | 'subject-unavailable'
  | 'query-value-unavailable'
  | 'ambiguous-field-value'
  | 'comparison-type-mismatch'

export class MoveExpressionEvaluationError extends Error {
  readonly code: MoveExpressionEvaluationErrorCode
  readonly nodeId: string

  constructor(
    code: MoveExpressionEvaluationErrorCode,
    nodeId: string,
    message: string,
  ) {
    super(`${nodeId}: ${message}`)
    this.name = 'MoveExpressionEvaluationError'
    this.code = code
    this.nodeId = nodeId
  }
}

interface EvaluationState {
  readonly context: AuthoritativeMoveRulesContext
  readonly selectorState: MoveRuleSelectorState
  readonly canonicalMoveId: string
  readonly numericPolicy: MoveExpressionNumericPolicy
  readonly trace: MoveRuleEvaluationTraceEntry[]
  nodes: number
}

const EMPTY_SELECTOR_STATE: MoveRuleSelectorState = Object.freeze({
  targetIds: Object.freeze([]),
  hitTargetIds: Object.freeze([]),
  missedTargetIds: Object.freeze([]),
  damagedTargetIds: Object.freeze([]),
  faintedTargetIds: Object.freeze([]),
})

const fail = (
  code: MoveExpressionEvaluationErrorCode,
  nodeId: string,
  message: string,
): never => {
  throw new MoveExpressionEvaluationError(code, nodeId, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const normalizedSelectorState = (
  value: MoveRuleSelectorState | undefined,
): MoveRuleSelectorState => {
  if (!value) return EMPTY_SELECTOR_STATE
  return deepFreeze({
    targetIds: [...value.targetIds],
    hitTargetIds: [...value.hitTargetIds],
    missedTargetIds: [...value.missedTargetIds],
    damagedTargetIds: [...value.damagedTargetIds],
    faintedTargetIds: [...value.faintedTargetIds],
  })
}

const assertRootNodeId = (nodeId: string): string => {
  if (
    nodeId.length === 0
    || nodeId.trim() !== nodeId
    || nodeId.length > MOVE_EXPRESSION_EVALUATION_LIMITS.nodeIdLength
    || /[\u0000-\u001f\u007f]/.test(nodeId)
  ) {
    return fail(
      'invalid-node',
      'expression',
      `rootNodeId must be non-empty, trimmed audit text of at most ${MOVE_EXPRESSION_EVALUATION_LIMITS.nodeIdLength} characters.`,
    )
  }
  return nodeId
}

const createEvaluationState = (
  input: MoveRuleEvaluationInputBase,
): EvaluationState => ({
  context: input.context,
  selectorState: normalizedSelectorState(input.selectorState),
  canonicalMoveId: input.canonicalMoveId ?? input.context.intent.moveName,
  numericPolicy: input.numericPolicy ?? 'preserve',
  trace: [],
  nodes: 0,
})

const enterNode = (
  state: EvaluationState,
  nodeId: string,
  depth: number,
): void => {
  if (depth > MOVE_EXPRESSION_EVALUATION_LIMITS.depth) {
    fail(
      'limit-exceeded',
      nodeId,
      `evaluation must be at most ${MOVE_EXPRESSION_EVALUATION_LIMITS.depth} levels deep.`,
    )
  }
  state.nodes += 1
  if (state.nodes > MOVE_EXPRESSION_EVALUATION_LIMITS.nodes) {
    fail(
      'limit-exceeded',
      nodeId,
      `evaluation must contain at most ${MOVE_EXPRESSION_EVALUATION_LIMITS.nodes} nodes.`,
    )
  }
  if (nodeId.length > MOVE_EXPRESSION_EVALUATION_LIMITS.nodeIdLength) {
    fail(
      'limit-exceeded',
      nodeId.slice(0, MOVE_EXPRESSION_EVALUATION_LIMITS.nodeIdLength),
      `derived expression node IDs must contain at most ${MOVE_EXPRESSION_EVALUATION_LIMITS.nodeIdLength} characters.`,
    )
  }
}

const boundedNumber = (value: unknown, nodeId: string): number => {
  if (typeof value !== 'number') {
    return fail('numeric-value-required', nodeId, 'must resolve to a number.')
  }
  if (!Number.isFinite(value)) {
    return fail('non-finite-value', nodeId, 'resolved to a non-finite number.')
  }
  if (
    Math.abs(value) > MOVE_EXPRESSION_EVALUATION_LIMITS.numericMagnitude
    || (Number.isInteger(value) && !Number.isSafeInteger(value))
  ) {
    return fail(
      'numeric-overflow',
      nodeId,
      `must remain within ±${MOVE_EXPRESSION_EVALUATION_LIMITS.numericMagnitude}.`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

const boundedScalar = (value: unknown, nodeId: string): MoveRuleScalar => {
  if (typeof value === 'number') return boundedNumber(value, nodeId)
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.length > MOVE_RULE_AST_LIMITS.stringLength) {
      return fail(
        'limit-exceeded',
        nodeId,
        `scalar strings must contain at most ${MOVE_RULE_AST_LIMITS.stringLength} characters.`,
      )
    }
    return value
  }
  return fail(
    'invalid-node',
    nodeId,
    'must resolve to a JSON scalar.',
  )
}

const applyNumericPolicy = (
  value: MoveRuleScalar,
  state: EvaluationState,
  nodeId: string,
): MoveRuleScalar => {
  if (state.numericPolicy === 'preserve') return value
  const numeric = boundedNumber(value, nodeId)
  let rounded: number
  switch (state.numericPolicy) {
    case 'integer-floor':
      rounded = Math.floor(numeric)
      break
    case 'integer-round':
      rounded = Math.round(numeric)
      break
    case 'integer-ceil':
      rounded = Math.ceil(numeric)
      break
    case 'integer-truncate':
      rounded = Math.trunc(numeric)
      break
  }
  return boundedNumber(rounded, nodeId)
}

const traceExpression = (
  state: EvaluationState,
  nodeId: string,
  expressionKind: MoveExpressionKind,
  value: MoveRuleScalar,
): MoveRuleScalar => {
  state.trace.push(Object.freeze({
    nodeType: 'expression',
    nodeId,
    expressionKind,
    value,
  }))
  return value
}

const tracePredicate = (
  state: EvaluationState,
  nodeId: string,
  predicateKind: MovePredicateKind,
  value: boolean,
): boolean => {
  state.trace.push(Object.freeze({
    nodeType: 'predicate',
    nodeId,
    predicateKind,
    value,
  }))
  return value
}

const canonicalPlacementIds = (
  context: AuthoritativeMoveRulesContext,
  ids: Iterable<string>,
): readonly string[] => {
  const requested = new Set(ids)
  const ordered: string[] = []
  for (const placement of context.queries.placements.all()) {
    if (!requested.delete(placement.id)) continue
    ordered.push(placement.id)
  }
  ordered.push(...[...requested].sort((left, right) => (
    left === right ? 0 : left < right ? -1 : 1
  )))
  return Object.freeze(ordered)
}

const selectorLeafIds = (
  state: EvaluationState,
  kind: MoveSelectorLeafKind,
): readonly string[] => {
  const { context, selectorState } = state
  switch (kind) {
    case 'actor':
    case 'source-placement':
      return [context.actor.placement.id]
    case 'current-target': {
      const current = selectorState.targetIds.length > 0
        ? selectorState.targetIds
        : context.selectedPlacements.map(({ id }) => id)
      return current.length === 1 ? current : []
    }
    case 'selected-targets':
      return context.selectedPlacements.map(({ id }) => id)
    case 'candidate-targets':
    case 'area-targets':
      return context.candidatePlacements.map(({ id }) => id)
    case 'attacked-targets':
      return selectorState.targetIds
    case 'hit-targets':
      return selectorState.hitTargetIds
    case 'missed-targets':
      return selectorState.missedTargetIds
    case 'damaged-targets':
      return selectorState.damagedTargetIds
    case 'fainted-targets':
      return selectorState.faintedTargetIds
  }
}

const resolveSelectorNode = (
  selector: MoveSelector,
  state: EvaluationState,
  nodeId: string,
  depth: number,
): readonly string[] => {
  enterNode(state, nodeId, depth)

  if (
    selector.kind !== 'union'
    && selector.kind !== 'intersection'
    && selector.kind !== 'difference'
  ) {
    return canonicalPlacementIds(
      state.context,
      selectorLeafIds(state, selector.kind),
    )
  }

  if (selector.kind === 'union') {
    if (!Array.isArray(selector.selectors)) {
      return fail('invalid-node', nodeId, 'union selectors must be an array.')
    }
    return canonicalPlacementIds(
      state.context,
      selector.selectors.flatMap((child, index) => [
        ...resolveSelectorNode(
          child,
          state,
          `${nodeId}.selectors.${index}`,
          depth + 1,
        ),
      ]),
    )
  }

  if (selector.kind === 'intersection') {
    if (!Array.isArray(selector.selectors)) {
      return fail('invalid-node', nodeId, 'intersection selectors must be an array.')
    }
    const [first, ...rest] = selector.selectors.map((child, index) => (
      new Set(resolveSelectorNode(
        child,
        state,
        `${nodeId}.selectors.${index}`,
        depth + 1,
      ))
    ))
    return canonicalPlacementIds(
      state.context,
      [...(first ?? new Set<string>())].filter(id => rest.every(ids => ids.has(id))),
    )
  }

  const source = resolveSelectorNode(
    selector.source,
    state,
    `${nodeId}.source`,
    depth + 1,
  )
  const excluded = new Set(resolveSelectorNode(
    selector.exclude,
    state,
    `${nodeId}.exclude`,
    depth + 1,
  ))
  return canonicalPlacementIds(
    state.context,
    source.filter(id => !excluded.has(id)),
  )
}

const selectedSubjectId = (
  selector: MoveSelector,
  state: EvaluationState,
  nodeId: string,
  depth: number,
): string => {
  const ids = resolveSelectorNode(selector, state, `${nodeId}.subject`, depth)
  if (ids.length === 0) {
    return fail(
      'missing-selector',
      `${nodeId}.subject`,
      'must resolve to exactly one authoritative placement, but resolved none.',
    )
  }
  if (ids.length > 1) {
    return fail(
      'ambiguous-selector',
      `${nodeId}.subject`,
      `must resolve to exactly one authoritative placement, but resolved ${ids.length}.`,
    )
  }
  return ids[0]!
}

const subjectToken = (
  selector: MoveSelector,
  state: EvaluationState,
  nodeId: string,
  depth: number,
): SpawnedPokemon => {
  const placementId = selectedSubjectId(selector, state, nodeId, depth)
  const placement = state.context.queries.placements.get(placementId)
  const token = state.context.queries.tokens.get(placementId)
  if (!placement || !token) {
    return fail(
      'subject-unavailable',
      `${nodeId}.subject`,
      `placement ${placementId} has no authoritative token projection.`,
    )
  }
  state.context.reads.recordPlacement(placement)
  return token
}

const statValue = (
  expression: Extract<MoveExpression, { readonly kind: 'stat' }>,
  state: EvaluationState,
  nodeId: string,
  depth: number,
): number => {
  const placementId = selectedSubjectId(
    expression.subject,
    state,
    nodeId,
    depth + 1,
  )
  const resolution = state.context.queries.stats.resolve(placementId, {
    stat: expression.stat,
    ...(expression.combatStagePolicy === undefined
      ? {}
      : { combatStagePolicy: expression.combatStagePolicy }),
    ...(expression.stageModifierPolicy === undefined
      ? {}
      : { stageModifierPolicy: expression.stageModifierPolicy }),
  })
  if (!resolution) {
    return fail(
      'query-value-unavailable',
      nodeId,
      `${expression.stat} is unavailable for placement ${placementId} under the selected stage policies.`,
    )
  }
  return boundedNumber(resolution.value, nodeId)
}

const conditionValue = (
  expression: Extract<MoveExpression, { readonly kind: 'condition' }>,
  state: EvaluationState,
  nodeId: string,
  depth: number,
): boolean => {
  const placementId = selectedSubjectId(
    expression.subject,
    state,
    nodeId,
    depth + 1,
  )
  const targetState = state.context.queries.targetStates.resolve(placementId)
  if (!targetState) {
    return fail(
      'subject-unavailable',
      `${nodeId}.subject`,
      `placement ${placementId} has no authoritative target-state projection.`,
    )
  }
  return targetState.conditionIds.includes(expression.conditionId)
}

const combatStageValue = (
  expression: Extract<MoveExpression, { readonly kind: 'combat-stage' }>,
  state: EvaluationState,
  nodeId: string,
  depth: number,
): number => {
  const placementId = selectedSubjectId(
    expression.subject,
    state,
    nodeId,
    depth + 1,
  )
  const resolution = state.context.queries.stats.combatStage(placementId, {
    stage: expression.stage,
    ...(expression.stageModifierPolicy === undefined
      ? {}
      : { stageModifierPolicy: expression.stageModifierPolicy }),
  })
  if (!resolution) {
    return fail(
      'query-value-unavailable',
      nodeId,
      `${expression.stage} Combat Stage is unavailable for placement ${placementId}.`,
    )
  }
  return boundedNumber(resolution.value, nodeId)
}

const combatStageTotalValue = (
  expression: Extract<MoveExpression, { readonly kind: 'combat-stage-total' }>,
  state: EvaluationState,
  nodeId: string,
  depth: number,
): number => {
  const placementId = selectedSubjectId(
    expression.subject,
    state,
    nodeId,
    depth + 1,
  )
  const resolution = state.context.queries.stats.combatStageTotal(placementId, {
    direction: expression.direction,
    stageModifierPolicy: expression.stageModifierPolicy,
  })
  if (!resolution) {
    return fail(
      'query-value-unavailable',
      nodeId,
      `${expression.direction} Combat Stage total is unavailable for placement ${placementId}.`,
    )
  }
  return boundedNumber(resolution.value, nodeId)
}

const activeFieldValue = (
  values: readonly { readonly kind: string }[] | undefined,
  field: 'weather' | 'terrain',
  nodeId: string,
): string | null => {
  if (!values || values.length === 0) return null
  if (values.length > 1) {
    return fail(
      'ambiguous-field-value',
      nodeId,
      `${field} expression requires zero or one active ${field}, but found ${values.length}.`,
    )
  }
  return values[0]!.kind
}

const moveType = (state: EvaluationState, nodeId: string): string => {
  const result = state.context.queries.resolveActorMoveEntry(state.canonicalMoveId)
  if (!result.ok) {
    return fail(
      'query-value-unavailable',
      nodeId,
      `move type for ${state.canonicalMoveId} is unavailable (${result.reason}).`,
    )
  }
  state.context.reads.recordPlacement(state.context.actor.placement)
  const value = result.entry.script.type.trim().toLowerCase()
  if (!value) {
    return fail(
      'query-value-unavailable',
      nodeId,
      `move type for ${state.canonicalMoveId} is empty.`,
    )
  }
  return value
}

const subjectType = (
  expression: Extract<MoveExpression, { readonly kind: 'type' }>,
  state: EvaluationState,
  nodeId: string,
  depth: number,
): string | null => {
  if (expression.of === 'move') return moveType(state, nodeId)
  if (expression.subject === null) {
    return fail('missing-selector', `${nodeId}.subject`, 'a type subject is required.')
  }
  const token = subjectToken(expression.subject, state, nodeId, depth + 1)
  const index = expression.of === 'primary' ? 0 : 1
  return token.defenderTypes[index]?.trim().toLowerCase() || null
}

const weightValue = (
  selector: MoveSelector,
  metric: MoveWeightMetric,
  state: EvaluationState,
  nodeId: string,
  depth: number,
): number => {
  const placementId = selectedSubjectId(selector, state, nodeId, depth + 1)
  const targetState = state.context.queries.targetStates.resolve(placementId)
  if (!targetState) {
    return fail(
      'subject-unavailable',
      `${nodeId}.subject`,
      `placement ${placementId} has no authoritative target-state projection.`,
    )
  }
  if (metric === 'kilograms') {
    return fail(
      'query-value-unavailable',
      nodeId,
      `exact kilograms are not available for placement ${placementId}; weight class cannot be converted without inventing source data.`,
    )
  }
  if (targetState.weightClass === null) {
    return fail(
      'query-value-unavailable',
      nodeId,
      `weight class is unavailable for placement ${placementId}.`,
    )
  }
  return boundedNumber(targetState.weightClass, nodeId)
}

const itemValue = (
  expression: Extract<MoveExpression, { readonly kind: 'item' }>,
  state: EvaluationState,
  nodeId: string,
  depth: number,
): MoveRuleScalar => {
  const placementId = selectedSubjectId(
    expression.subject,
    state,
    nodeId,
    depth + 1,
  )
  if (!('source' in expression)) {
    return boundedScalar(state.context.queries.itemRules.resolve({
      placementId,
      query: expression.query,
    }).value, nodeId)
  }
  return boundedScalar(state.context.queries.itemRules.resolve({
    placementId,
    query: expression.query,
    source: expression.source,
    families: expression.families,
    requirementId: expression.requirementId,
    timing: expression.timing,
  }).value, nodeId)
}

const historyValue = (
  selector: MoveSelector,
  query: MoveHistoryQuery,
  state: EvaluationState,
  nodeId: string,
  depth: number,
): MoveRuleScalar => {
  const placementId = selectedSubjectId(selector, state, nodeId, depth + 1)
  if (!state.context.queries.placements.get(placementId)) {
    return fail(
      'subject-unavailable',
      `${nodeId}.subject`,
      `placement ${placementId} is unavailable.`,
    )
  }
  const currentTargetPlacementId = state.selectorState.targetIds.length === 1
    ? state.selectorState.targetIds[0]
    : undefined
  const value = query === 'consecutive-use-count'
    ? state.context.queries.history.consecutiveUseCount(
        placementId,
        state.canonicalMoveId,
        currentTargetPlacementId,
      )
    : state.context.queries.history.query(placementId, query)
  return boundedScalar(value, nodeId)
}

const encounterResourceValue = (
  expression: Extract<MoveExpression, { readonly kind: 'encounter-resource' }>,
  state: EvaluationState,
  nodeId: string,
  depth: number,
): MoveRuleScalar => {
  const placementId = selectedSubjectId(
    expression.subject,
    state,
    nodeId,
    depth + 1,
  )
  if (!state.context.queries.placements.get(placementId)) {
    return fail(
      'subject-unavailable',
      `${nodeId}.subject`,
      `placement ${placementId} is unavailable.`,
    )
  }
  if (expression.query === 'acted-since-entry') {
    return state.context.queries.resources.actedSinceEntry(placementId)
  }
  return fail(
    'query-value-unavailable',
    nodeId,
    `encounter resource query ${String(expression.query)} is unavailable.`,
  )
}

const arithmeticResult = (
  operator: MoveArithmeticOperator,
  operands: readonly number[],
  nodeId: string,
): number => {
  if (operands.length < 2) {
    return fail('invalid-node', nodeId, `${operator} requires at least two operands.`)
  }

  if (operator === 'subtract' || operator === 'divide' || operator === 'modulo') {
    if (operands.length !== 2) {
      return fail('invalid-node', nodeId, `${operator} requires exactly two operands.`)
    }
  }

  if (operator === 'add') {
    return operands.reduce(
      (total, operand) => boundedNumber(total + operand, nodeId),
      0,
    )
  }
  if (operator === 'multiply') {
    return operands.reduce(
      (total, operand) => boundedNumber(total * operand, nodeId),
      1,
    )
  }
  if (operator === 'subtract') {
    return boundedNumber(operands[0]! - operands[1]!, nodeId)
  }
  if (operands[1] === 0) {
    return fail(
      'divide-by-zero',
      nodeId,
      `${operator} cannot use zero as its divisor.`,
    )
  }
  return boundedNumber(
    operator === 'divide'
      ? operands[0]! / operands[1]!
      : operands[0]! % operands[1]!,
    nodeId,
  )
}

const expressionChildren = (
  expressions: readonly MoveExpression[],
  state: EvaluationState,
  nodeId: string,
  field: string,
  depth: number,
): readonly MoveRuleScalar[] => {
  if (!Array.isArray(expressions)) {
    return fail('invalid-node', `${nodeId}.${field}`, 'must be an expression array.')
  }
  return expressions.map((expression, index) => evaluateExpressionNode(
    expression,
    state,
    `${nodeId}.${field}.${index}`,
    depth + 1,
    false,
  ))
}

const evaluateExpressionNode = (
  expression: MoveExpression,
  state: EvaluationState,
  nodeId: string,
  depth: number,
  applyResultPolicy: boolean,
): MoveRuleScalar => {
  enterNode(state, nodeId, depth)
  let value: MoveRuleScalar

  switch (expression.kind) {
    case 'constant':
      value = boundedScalar(expression.value, nodeId)
      break
    case 'arithmetic': {
      const operands = expressionChildren(
        expression.operands,
        state,
        nodeId,
        'operands',
        depth,
      ).map((operand, index) => boundedNumber(operand, `${nodeId}.operands.${index}`))
      value = arithmeticResult(expression.operator, operands, nodeId)
      break
    }
    case 'min':
    case 'max': {
      const values = expressionChildren(
        expression.values,
        state,
        nodeId,
        'values',
        depth,
      ).map((entry, index) => boundedNumber(entry, `${nodeId}.values.${index}`))
      if (values.length === 0) {
        return fail('invalid-node', nodeId, `${expression.kind} requires at least one value.`)
      }
      value = boundedNumber(
        expression.kind === 'min' ? Math.min(...values) : Math.max(...values),
        nodeId,
      )
      break
    }
    case 'clamp': {
      const raw = boundedNumber(evaluateExpressionNode(
        expression.value,
        state,
        `${nodeId}.value`,
        depth + 1,
        false,
      ), `${nodeId}.value`)
      const minimum = boundedNumber(evaluateExpressionNode(
        expression.minimum,
        state,
        `${nodeId}.minimum`,
        depth + 1,
        false,
      ), `${nodeId}.minimum`)
      const maximum = boundedNumber(evaluateExpressionNode(
        expression.maximum,
        state,
        `${nodeId}.maximum`,
        depth + 1,
        false,
      ), `${nodeId}.maximum`)
      if (minimum > maximum) {
        return fail(
          'invalid-clamp-bounds',
          nodeId,
          `clamp minimum ${minimum} cannot exceed maximum ${maximum}.`,
        )
      }
      value = boundedNumber(Math.min(maximum, Math.max(minimum, raw)), nodeId)
      break
    }
    case 'lookup-table': {
      const input = evaluateExpressionNode(
        expression.input,
        state,
        `${nodeId}.input`,
        depth + 1,
        false,
      )
      if (!Array.isArray(expression.entries)) {
        return fail('invalid-node', `${nodeId}.entries`, 'must be a lookup entry array.')
      }
      const inputIdentity = moveRuleScalarIdentity(input)
      const entryIndex = expression.entries.findIndex(entry => (
        moveRuleScalarIdentity(boundedScalar(entry.key, `${nodeId}.entries.key`))
        === inputIdentity
      ))
      value = entryIndex >= 0
        ? evaluateExpressionNode(
            expression.entries[entryIndex]!.value,
            state,
            `${nodeId}.entries.${entryIndex}.value`,
            depth + 1,
            false,
          )
        : evaluateExpressionNode(
            expression.fallback,
            state,
            `${nodeId}.fallback`,
            depth + 1,
            false,
          )
      break
    }
    case 'stat':
      value = statValue(expression, state, nodeId, depth)
      break
    case 'hp-ratio': {
      const token = subjectToken(expression.subject, state, nodeId, depth + 1)
      const maximum = boundedNumber(token.maxHp, nodeId)
      if (maximum === 0) {
        return fail('divide-by-zero', nodeId, 'HP ratio requires non-zero maximum HP.')
      }
      const current = boundedNumber(token.currentHp, nodeId)
      value = boundedNumber(
        expression.ratio === 'current-to-maximum'
          ? current / maximum
          : (maximum - current) / maximum,
        nodeId,
      )
      break
    }
    case 'condition':
      value = conditionValue(expression, state, nodeId, depth)
      break
    case 'combat-stage':
      value = combatStageValue(expression, state, nodeId, depth)
      break
    case 'combat-stage-total':
      value = combatStageTotalValue(expression, state, nodeId, depth)
      break
    case 'weight':
      value = weightValue(
        expression.subject,
        expression.metric,
        state,
        nodeId,
        depth,
      )
      break
    case 'type':
      value = subjectType(expression, state, nodeId, depth)
      break
    case 'weather':
      value = activeFieldValue(
        state.context.queries.weather.active(),
        'weather',
        nodeId,
      )
      break
    case 'terrain':
      value = activeFieldValue(
        state.context.queries.terrain.membership({
          placementId: state.context.actor.placement.id,
        }).terrains,
        'terrain',
        nodeId,
      )
      break
    case 'item':
      value = itemValue(expression, state, nodeId, depth)
      break
    case 'move-history':
      value = historyValue(
        expression.subject,
        expression.query,
        state,
        nodeId,
        depth,
      )
      break
    case 'encounter-resource':
      value = encounterResourceValue(expression, state, nodeId, depth)
      break
    default:
      return fail(
        'invalid-node',
        nodeId,
        `unsupported expression kind ${String((expression as { kind?: unknown }).kind)}.`,
      )
  }

  const result = applyResultPolicy
    ? applyNumericPolicy(value, state, nodeId)
    : value
  return traceExpression(state, nodeId, expression.kind, result)
}

const orderedComparison = (
  left: MoveRuleScalar,
  right: MoveRuleScalar,
  operator: MoveComparisonOperator,
  nodeId: string,
): boolean => {
  if (typeof left === 'number' && typeof right === 'number') {
    const boundedLeft = boundedNumber(left, `${nodeId}.left`)
    const boundedRight = boundedNumber(right, `${nodeId}.right`)
    if (operator === 'less-than') return boundedLeft < boundedRight
    if (operator === 'less-than-or-equal') return boundedLeft <= boundedRight
    if (operator === 'greater-than') return boundedLeft > boundedRight
    return boundedLeft >= boundedRight
  }
  if (typeof left === 'string' && typeof right === 'string') {
    if (operator === 'less-than') return left < right
    if (operator === 'less-than-or-equal') return left <= right
    if (operator === 'greater-than') return left > right
    return left >= right
  }
  return fail(
    'comparison-type-mismatch',
    nodeId,
    'ordered comparisons require two numbers or two strings.',
  )
}

const comparisonResult = (
  left: MoveRuleScalar,
  right: MoveRuleScalar,
  operator: MoveComparisonOperator,
  nodeId: string,
): boolean => {
  if (operator === 'equal') {
    return moveRuleScalarIdentity(left) === moveRuleScalarIdentity(right)
  }
  if (operator === 'not-equal') {
    return moveRuleScalarIdentity(left) !== moveRuleScalarIdentity(right)
  }
  return orderedComparison(left, right, operator, nodeId)
}

const evaluatePredicateNode = (
  predicate: MovePredicate,
  state: EvaluationState,
  nodeId: string,
  depth: number,
): boolean => {
  enterNode(state, nodeId, depth)
  let value: boolean

  switch (predicate.kind) {
    case 'constant':
      if (typeof predicate.value !== 'boolean') {
        return fail('invalid-node', nodeId, 'constant predicate must contain a boolean.')
      }
      value = predicate.value
      break
    case 'comparison': {
      const left = evaluateExpressionNode(
        predicate.left,
        state,
        `${nodeId}.left`,
        depth + 1,
        true,
      )
      const right = evaluateExpressionNode(
        predicate.right,
        state,
        `${nodeId}.right`,
        depth + 1,
        true,
      )
      value = comparisonResult(left, right, predicate.operator, nodeId)
      break
    }
    case 'not':
      value = !evaluatePredicateNode(
        predicate.predicate,
        state,
        `${nodeId}.predicate`,
        depth + 1,
      )
      break
    case 'all':
    case 'any': {
      if (!Array.isArray(predicate.predicates) || predicate.predicates.length === 0) {
        return fail(
          'invalid-node',
          `${nodeId}.predicates`,
          `${predicate.kind} requires at least one child predicate.`,
        )
      }
      // Evaluate every branch in reviewed order so audit evidence is complete.
      const childValues = predicate.predicates.map((child, index) => evaluatePredicateNode(
        child,
        state,
        `${nodeId}.predicates.${index}`,
        depth + 1,
      ))
      value = predicate.kind === 'all'
        ? childValues.every(Boolean)
        : childValues.some(Boolean)
      break
    }
    default:
      return fail(
        'invalid-node',
        nodeId,
        `unsupported predicate kind ${String((predicate as { kind?: unknown }).kind)}.`,
      )
  }

  return tracePredicate(state, nodeId, predicate.kind, value)
}

/** Resolve a bounded selector in authoritative map order. */
export const evaluateMoveSelector = (
  input: EvaluateMoveSelectorInput,
): readonly string[] => {
  const state = createEvaluationState({
    context: input.context,
    selectorState: input.selectorState,
  })
  return resolveSelectorNode(input.selector, state, 'selector', 1)
}

/** Evaluate one bounded expression and return immutable per-node audit values. */
export const evaluateMoveExpression = (
  input: EvaluateMoveExpressionInput,
): MoveExpressionEvaluationResult => {
  const rootNodeId = assertRootNodeId(input.rootNodeId ?? 'expression')
  const state = createEvaluationState(input)
  const value = evaluateExpressionNode(
    input.expression,
    state,
    rootNodeId,
    1,
    true,
  )
  return deepFreeze({ value, trace: [...state.trace] })
}

/** Evaluate comparisons and boolean branches using the same bounded expression state. */
export const evaluateMovePredicate = (
  input: EvaluateMovePredicateInput,
): MovePredicateEvaluationResult => {
  const rootNodeId = assertRootNodeId(input.rootNodeId ?? 'predicate')
  const state = createEvaluationState(input)
  const value = evaluatePredicateNode(input.predicate, state, rootNodeId, 1)
  return deepFreeze({ value, trace: [...state.trace] })
}
