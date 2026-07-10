import {
  MOVE_RULE_AST_LIMITS,
  assertMoveRuleAstExactKeys,
  createMoveRuleAstParseContext,
  deepFreezeMoveRuleAst,
  enterMoveRuleAstNode,
  failMoveRuleAst,
  parseMoveRuleAstArray,
  parseMoveRuleAstRecord,
  readMoveRuleAstOwnValue,
  type MoveRuleAstParseContext,
  type MoveRuleAstValidationCode,
} from './ast'

/**
 * Interpreter-owned placement sets. None of these leaves can carry placement
 * IDs supplied by a client.
 */
export const MOVE_SELECTOR_LEAF_KINDS = [
  'actor',
  'current-target',
  'selected-targets',
  'candidate-targets',
  'attacked-targets',
  'hit-targets',
  'missed-targets',
  'damaged-targets',
  'fainted-targets',
  'area-targets',
  'source-placement',
] as const

export const MOVE_SELECTOR_COMPOSITION_KINDS = [
  'union',
  'intersection',
  'difference',
] as const

export const MOVE_SELECTOR_KINDS = [
  ...MOVE_SELECTOR_LEAF_KINDS,
  ...MOVE_SELECTOR_COMPOSITION_KINDS,
] as const

export const MOVE_SELECTOR_LIMITS = MOVE_RULE_AST_LIMITS

export type MoveSelectorLeafKind = (typeof MOVE_SELECTOR_LEAF_KINDS)[number]
export type MoveSelectorCompositionKind = (typeof MOVE_SELECTOR_COMPOSITION_KINDS)[number]
export type MoveSelectorKind = (typeof MOVE_SELECTOR_KINDS)[number]

export interface MoveSelectorLeaf {
  readonly kind: MoveSelectorLeafKind
}

export interface MoveSelectorUnion {
  readonly kind: 'union'
  readonly selectors: readonly MoveSelector[]
}

export interface MoveSelectorIntersection {
  readonly kind: 'intersection'
  readonly selectors: readonly MoveSelector[]
}

export interface MoveSelectorDifference {
  readonly kind: 'difference'
  readonly source: MoveSelector
  readonly exclude: MoveSelector
}

export type MoveSelector =
  | MoveSelectorLeaf
  | MoveSelectorUnion
  | MoveSelectorIntersection
  | MoveSelectorDifference

export type MoveSelectorValidationCode = MoveRuleAstValidationCode

export class MoveSelectorValidationError extends Error {
  readonly code: MoveSelectorValidationCode
  readonly path: string

  constructor(code: MoveSelectorValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'MoveSelectorValidationError'
    this.code = code
    this.path = path
  }
}

const LEAF_FIELDS = ['kind'] as const
const COMPOSITION_FIELDS = ['kind', 'selectors'] as const
const DIFFERENCE_FIELDS = ['kind', 'source', 'exclude'] as const
const LEAF_KIND_SET = new Set<string>(MOVE_SELECTOR_LEAF_KINDS)
const SELECTOR_KIND_SET = new Set<string>(MOVE_SELECTOR_KINDS)

/**
 * Parse one selector while sharing the caller's aggregate AST budget.
 * Exported so expression and predicate parsers cannot reset limits at nested
 * selector boundaries.
 */
export const parseMoveSelectorNode = (
  value: unknown,
  path: string,
  depth: number,
  context: MoveRuleAstParseContext,
): MoveSelector => {
  enterMoveRuleAstNode(context, path, depth)
  const input = parseMoveRuleAstRecord(value, path, context)
  const rawKind = readMoveRuleAstOwnValue(input, 'kind', path, context)
  if (typeof rawKind !== 'string' || !SELECTOR_KIND_SET.has(rawKind)) {
    failMoveRuleAst(
      context,
      'unknown-selector-kind',
      `${path}.kind`,
      'must be a supported selector kind.',
    )
  }
  const kind = rawKind as MoveSelectorKind

  if (LEAF_KIND_SET.has(kind)) {
    assertMoveRuleAstExactKeys(input, LEAF_FIELDS, path, context)
    return { kind: kind as MoveSelectorLeafKind }
  }

  if (kind === 'union' || kind === 'intersection') {
    assertMoveRuleAstExactKeys(input, COMPOSITION_FIELDS, path, context)
    const selectors = parseMoveRuleAstArray(
      readMoveRuleAstOwnValue(input, 'selectors', path, context),
      `${path}.selectors`,
      context,
      { minimum: 2 },
    ).map((selector, index) => parseMoveSelectorNode(
      selector,
      `${path}.selectors[${index}]`,
      depth + 1,
      context,
    ))
    return { kind, selectors }
  }

  assertMoveRuleAstExactKeys(input, DIFFERENCE_FIELDS, path, context)
  return {
    kind,
    source: parseMoveSelectorNode(
      readMoveRuleAstOwnValue(input, 'source', path, context),
      `${path}.source`,
      depth + 1,
      context,
    ),
    exclude: parseMoveSelectorNode(
      readMoveRuleAstOwnValue(input, 'exclude', path, context),
      `${path}.exclude`,
      depth + 1,
      context,
    ),
  }
}

/** Parse, detach, and deeply freeze one bounded placement selector AST. */
export const parseMoveSelector = (
  value: unknown,
  path = 'selector',
): MoveSelector => {
  const context = createMoveRuleAstParseContext(
    'invalid-selector',
    (code, errorPath, message) => new MoveSelectorValidationError(code, errorPath, message),
  )
  return deepFreezeMoveRuleAst(parseMoveSelectorNode(value, path, 1, context))
}
