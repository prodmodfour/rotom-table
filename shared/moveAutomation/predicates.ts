import {
  MOVE_RULE_AST_LIMITS,
  assertMoveRuleAstExactKeys,
  createMoveRuleAstParseContext,
  deepFreezeMoveRuleAst,
  enterMoveRuleAstNode,
  failMoveRuleAst,
  parseMoveRuleAstArray,
  parseMoveRuleAstEnum,
  parseMoveRuleAstRecord,
  readMoveRuleAstOwnValue,
  type MoveRuleAstParseContext,
  type MoveRuleAstValidationCode,
} from './ast'
import {
  parseMoveExpressionNode,
  type MoveExpression,
} from './expressions'

export const MOVE_PREDICATE_KINDS = [
  'constant',
  'comparison',
  'all',
  'any',
  'not',
] as const

export const MOVE_COMPARISON_OPERATORS = [
  'equal',
  'not-equal',
  'less-than',
  'less-than-or-equal',
  'greater-than',
  'greater-than-or-equal',
] as const

export const MOVE_PREDICATE_LIMITS = MOVE_RULE_AST_LIMITS

export type MovePredicateKind = (typeof MOVE_PREDICATE_KINDS)[number]
export type MoveComparisonOperator = (typeof MOVE_COMPARISON_OPERATORS)[number]

export interface MoveConstantPredicate {
  readonly kind: 'constant'
  readonly value: boolean
}

export interface MoveComparisonPredicate {
  readonly kind: 'comparison'
  readonly operator: MoveComparisonOperator
  readonly left: MoveExpression
  readonly right: MoveExpression
}

export interface MoveAllPredicate {
  readonly kind: 'all'
  readonly predicates: readonly MovePredicate[]
}

export interface MoveAnyPredicate {
  readonly kind: 'any'
  readonly predicates: readonly MovePredicate[]
}

export interface MoveNotPredicate {
  readonly kind: 'not'
  readonly predicate: MovePredicate
}

export type MovePredicate =
  | MoveConstantPredicate
  | MoveComparisonPredicate
  | MoveAllPredicate
  | MoveAnyPredicate
  | MoveNotPredicate

export type MovePredicateValidationCode = MoveRuleAstValidationCode

export class MovePredicateValidationError extends Error {
  readonly code: MovePredicateValidationCode
  readonly path: string

  constructor(code: MovePredicateValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'MovePredicateValidationError'
    this.code = code
    this.path = path
  }
}

const CONSTANT_FIELDS = ['kind', 'value'] as const
const COMPARISON_FIELDS = ['kind', 'operator', 'left', 'right'] as const
const COMPOSITION_FIELDS = ['kind', 'predicates'] as const
const NOT_FIELDS = ['kind', 'predicate'] as const
const PREDICATE_KIND_SET = new Set<string>(MOVE_PREDICATE_KINDS)
const COMPARISON_OPERATOR_SET = new Set<string>(MOVE_COMPARISON_OPERATORS)

/**
 * Parse one predicate while sharing the caller's aggregate AST budget.
 * Boolean logic is data-only; source expressions and executable predicates do
 * not belong to this language.
 */
export const parseMovePredicateNode = (
  value: unknown,
  path: string,
  depth: number,
  context: MoveRuleAstParseContext,
): MovePredicate => {
  enterMoveRuleAstNode(context, path, depth)
  const input = parseMoveRuleAstRecord(value, path, context)
  const rawKind = readMoveRuleAstOwnValue(input, 'kind', path, context)
  if (typeof rawKind !== 'string' || !PREDICATE_KIND_SET.has(rawKind)) {
    failMoveRuleAst(
      context,
      'unknown-predicate-kind',
      `${path}.kind`,
      'must be a supported predicate kind.',
    )
  }
  const kind = rawKind as MovePredicateKind

  switch (kind) {
    case 'constant': {
      assertMoveRuleAstExactKeys(input, CONSTANT_FIELDS, path, context)
      const value = readMoveRuleAstOwnValue(input, 'value', path, context)
      if (typeof value !== 'boolean') {
        return failMoveRuleAst(
          context,
          context.invalidCode,
          `${path}.value`,
          'must be a boolean.',
        )
      }
      return { kind, value }
    }
    case 'comparison':
      assertMoveRuleAstExactKeys(input, COMPARISON_FIELDS, path, context)
      return {
        kind,
        operator: parseMoveRuleAstEnum<MoveComparisonOperator>(
          readMoveRuleAstOwnValue(input, 'operator', path, context),
          COMPARISON_OPERATOR_SET,
          `${path}.operator`,
          'a supported comparison operator',
          context,
        ),
        left: parseMoveExpressionNode(
          readMoveRuleAstOwnValue(input, 'left', path, context),
          `${path}.left`,
          depth + 1,
          context,
        ),
        right: parseMoveExpressionNode(
          readMoveRuleAstOwnValue(input, 'right', path, context),
          `${path}.right`,
          depth + 1,
          context,
        ),
      }
    case 'all':
    case 'any':
      assertMoveRuleAstExactKeys(input, COMPOSITION_FIELDS, path, context)
      return {
        kind,
        predicates: parseMoveRuleAstArray(
          readMoveRuleAstOwnValue(input, 'predicates', path, context),
          `${path}.predicates`,
          context,
          { minimum: 1 },
        ).map((predicate, index) => parseMovePredicateNode(
          predicate,
          `${path}.predicates[${index}]`,
          depth + 1,
          context,
        )),
      }
    case 'not':
      assertMoveRuleAstExactKeys(input, NOT_FIELDS, path, context)
      return {
        kind,
        predicate: parseMovePredicateNode(
          readMoveRuleAstOwnValue(input, 'predicate', path, context),
          `${path}.predicate`,
          depth + 1,
          context,
        ),
      }
  }
}

/** Parse, detach, and deeply freeze one bounded boolean predicate AST. */
export const parseMovePredicate = (
  value: unknown,
  path = 'predicate',
): MovePredicate => {
  const context = createMoveRuleAstParseContext(
    'invalid-predicate',
    (code, errorPath, message) => new MovePredicateValidationError(code, errorPath, message),
  )
  return deepFreezeMoveRuleAst(parseMovePredicateNode(value, path, 1, context))
}
