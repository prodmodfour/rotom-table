import {
  MOVE_RULE_AST_LIMITS,
  assertMoveRuleAstExactKeys,
  createMoveRuleAstParseContext,
  deepFreezeMoveRuleAst,
  enterMoveRuleAstNode,
  failMoveRuleAst,
  moveRuleScalarIdentity,
  parseMoveRuleAstArray,
  parseMoveRuleAstEnum,
  parseMoveRuleAstExactRecord,
  parseMoveRuleAstRecord,
  parseMoveRuleScalar,
  readMoveRuleAstOwnValue,
  type MoveRuleAstParseContext,
  type MoveRuleAstValidationCode,
  type MoveRuleScalar,
} from './ast'
import {
  parseMoveSelectorNode,
  type MoveSelector,
} from './selectors'

export const MOVE_EXPRESSION_KINDS = [
  'constant',
  'arithmetic',
  'min',
  'max',
  'clamp',
  'lookup-table',
  'stat',
  'hp-ratio',
  'combat-stage',
  'weight',
  'type',
  'weather',
  'terrain',
  'move-history',
] as const

export const MOVE_ARITHMETIC_OPERATORS = [
  'add',
  'subtract',
  'multiply',
  'divide',
  'modulo',
] as const

export const MOVE_EXPRESSION_STATS = [
  'attack',
  'special-attack',
  'defense',
  'special-defense',
  'speed',
  'level',
  'current-hp',
  'maximum-hp',
] as const

export const MOVE_HP_RATIO_KINDS = [
  'current-to-maximum',
  'missing-to-maximum',
] as const

export const MOVE_COMBAT_STAGE_STATS = [
  'atk',
  'def',
  'satk',
  'sdef',
  'spd',
  'acc',
] as const

export const MOVE_WEIGHT_METRICS = ['kilograms', 'weight-class'] as const
export const MOVE_TYPE_SOURCES = ['move', 'primary', 'secondary'] as const

export const MOVE_HISTORY_QUERIES = [
  'last-declared-move-id',
  'last-completed-move-id',
  'last-damaging-move-id',
  'consecutive-use-count',
  'damage-dealt-this-turn',
  'damage-received-this-turn',
  'acted-this-turn',
  'switched-this-scene',
  'fainted-this-scene',
] as const

export const MOVE_EXPRESSION_LIMITS = MOVE_RULE_AST_LIMITS

export type MoveExpressionKind = (typeof MOVE_EXPRESSION_KINDS)[number]
export type MoveArithmeticOperator = (typeof MOVE_ARITHMETIC_OPERATORS)[number]
export type MoveExpressionStat = (typeof MOVE_EXPRESSION_STATS)[number]
export type MoveHpRatioKind = (typeof MOVE_HP_RATIO_KINDS)[number]
export type MoveCombatStageStat = (typeof MOVE_COMBAT_STAGE_STATS)[number]
export type MoveWeightMetric = (typeof MOVE_WEIGHT_METRICS)[number]
export type MoveTypeSource = (typeof MOVE_TYPE_SOURCES)[number]
export type MoveHistoryQuery = (typeof MOVE_HISTORY_QUERIES)[number]
export type MoveExpressionConstant = MoveRuleScalar

export interface MoveConstantExpression {
  readonly kind: 'constant'
  readonly value: MoveExpressionConstant
}

export interface MoveArithmeticExpression {
  readonly kind: 'arithmetic'
  readonly operator: MoveArithmeticOperator
  readonly operands: readonly MoveExpression[]
}

export interface MoveMinExpression {
  readonly kind: 'min'
  readonly values: readonly MoveExpression[]
}

export interface MoveMaxExpression {
  readonly kind: 'max'
  readonly values: readonly MoveExpression[]
}

export interface MoveClampExpression {
  readonly kind: 'clamp'
  readonly value: MoveExpression
  readonly minimum: MoveExpression
  readonly maximum: MoveExpression
}

export interface MoveLookupTableEntry {
  readonly key: MoveExpressionConstant
  readonly value: MoveExpression
}

export interface MoveLookupTableExpression {
  readonly kind: 'lookup-table'
  readonly input: MoveExpression
  readonly entries: readonly MoveLookupTableEntry[]
  readonly fallback: MoveExpression
}

export interface MoveStatExpression {
  readonly kind: 'stat'
  readonly subject: MoveSelector
  readonly stat: MoveExpressionStat
}

export interface MoveHpRatioExpression {
  readonly kind: 'hp-ratio'
  readonly subject: MoveSelector
  readonly ratio: MoveHpRatioKind
}

export interface MoveCombatStageExpression {
  readonly kind: 'combat-stage'
  readonly subject: MoveSelector
  readonly stage: MoveCombatStageStat
}

export interface MoveWeightExpression {
  readonly kind: 'weight'
  readonly subject: MoveSelector
  readonly metric: MoveWeightMetric
}

export interface MoveTypeExpression {
  readonly kind: 'type'
  /** Move type uses null; primary/secondary type requires an authoritative subject. */
  readonly of: MoveTypeSource
  readonly subject: MoveSelector | null
}

export interface MoveWeatherExpression {
  readonly kind: 'weather'
}

export interface MoveTerrainExpression {
  readonly kind: 'terrain'
}

export interface MoveHistoryExpression {
  readonly kind: 'move-history'
  readonly subject: MoveSelector
  readonly query: MoveHistoryQuery
}

export type MoveExpression =
  | MoveConstantExpression
  | MoveArithmeticExpression
  | MoveMinExpression
  | MoveMaxExpression
  | MoveClampExpression
  | MoveLookupTableExpression
  | MoveStatExpression
  | MoveHpRatioExpression
  | MoveCombatStageExpression
  | MoveWeightExpression
  | MoveTypeExpression
  | MoveWeatherExpression
  | MoveTerrainExpression
  | MoveHistoryExpression

export type MoveExpressionValidationCode = MoveRuleAstValidationCode

export class MoveExpressionValidationError extends Error {
  readonly code: MoveExpressionValidationCode
  readonly path: string

  constructor(code: MoveExpressionValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'MoveExpressionValidationError'
    this.code = code
    this.path = path
  }
}

const CONSTANT_FIELDS = ['kind', 'value'] as const
const ARITHMETIC_FIELDS = ['kind', 'operator', 'operands'] as const
const AGGREGATE_FIELDS = ['kind', 'values'] as const
const CLAMP_FIELDS = ['kind', 'value', 'minimum', 'maximum'] as const
const LOOKUP_TABLE_FIELDS = ['kind', 'input', 'entries', 'fallback'] as const
const LOOKUP_ENTRY_FIELDS = ['key', 'value'] as const
const STAT_FIELDS = ['kind', 'subject', 'stat'] as const
const HP_RATIO_FIELDS = ['kind', 'subject', 'ratio'] as const
const COMBAT_STAGE_FIELDS = ['kind', 'subject', 'stage'] as const
const WEIGHT_FIELDS = ['kind', 'subject', 'metric'] as const
const TYPE_FIELDS = ['kind', 'of', 'subject'] as const
const FIELD_QUERY_FIELDS = ['kind'] as const
const HISTORY_FIELDS = ['kind', 'subject', 'query'] as const

const EXPRESSION_KIND_SET = new Set<string>(MOVE_EXPRESSION_KINDS)
const ARITHMETIC_OPERATOR_SET = new Set<string>(MOVE_ARITHMETIC_OPERATORS)
const STAT_SET = new Set<string>(MOVE_EXPRESSION_STATS)
const HP_RATIO_SET = new Set<string>(MOVE_HP_RATIO_KINDS)
const COMBAT_STAGE_SET = new Set<string>(MOVE_COMBAT_STAGE_STATS)
const WEIGHT_METRIC_SET = new Set<string>(MOVE_WEIGHT_METRICS)
const TYPE_SOURCE_SET = new Set<string>(MOVE_TYPE_SOURCES)
const HISTORY_QUERY_SET = new Set<string>(MOVE_HISTORY_QUERIES)

const parseChildExpression = (
  value: unknown,
  path: string,
  depth: number,
  context: MoveRuleAstParseContext,
): MoveExpression => parseMoveExpressionNode(value, path, depth + 1, context)

const parseSubject = (
  input: Record<string, unknown>,
  path: string,
  depth: number,
  context: MoveRuleAstParseContext,
): MoveSelector => parseMoveSelectorNode(
  readMoveRuleAstOwnValue(input, 'subject', path, context),
  `${path}.subject`,
  depth + 1,
  context,
)

const parseExpressionList = (
  value: unknown,
  path: string,
  depth: number,
  context: MoveRuleAstParseContext,
  minimum: number,
): readonly MoveExpression[] => parseMoveRuleAstArray(
  value,
  path,
  context,
  { minimum },
).map((entry, index) => parseChildExpression(entry, `${path}[${index}]`, depth, context))

const parseArithmeticExpression = (
  input: Record<string, unknown>,
  path: string,
  depth: number,
  context: MoveRuleAstParseContext,
): MoveArithmeticExpression => {
  assertMoveRuleAstExactKeys(input, ARITHMETIC_FIELDS, path, context)
  const operator = parseMoveRuleAstEnum<MoveArithmeticOperator>(
    readMoveRuleAstOwnValue(input, 'operator', path, context),
    ARITHMETIC_OPERATOR_SET,
    `${path}.operator`,
    'a supported arithmetic operator',
    context,
  )
  const operands = parseExpressionList(
    readMoveRuleAstOwnValue(input, 'operands', path, context),
    `${path}.operands`,
    depth,
    context,
    2,
  )
  if (
    (operator === 'subtract' || operator === 'divide' || operator === 'modulo')
    && operands.length !== 2
  ) {
    failMoveRuleAst(
      context,
      context.invalidCode,
      `${path}.operands`,
      `${operator} requires exactly two operands.`,
    )
  }
  return { kind: 'arithmetic', operator, operands }
}

const parseAggregateExpression = (
  kind: 'min' | 'max',
  input: Record<string, unknown>,
  path: string,
  depth: number,
  context: MoveRuleAstParseContext,
): MoveMinExpression | MoveMaxExpression => {
  assertMoveRuleAstExactKeys(input, AGGREGATE_FIELDS, path, context)
  return {
    kind,
    values: parseExpressionList(
      readMoveRuleAstOwnValue(input, 'values', path, context),
      `${path}.values`,
      depth,
      context,
      1,
    ),
  }
}

const parseLookupTableExpression = (
  input: Record<string, unknown>,
  path: string,
  depth: number,
  context: MoveRuleAstParseContext,
): MoveLookupTableExpression => {
  assertMoveRuleAstExactKeys(input, LOOKUP_TABLE_FIELDS, path, context)
  const entriesPath = `${path}.entries`
  const entries = parseMoveRuleAstArray(
    readMoveRuleAstOwnValue(input, 'entries', path, context),
    entriesPath,
    context,
    { minimum: 1 },
  ).map((entry, index): MoveLookupTableEntry => {
    const entryPath = `${entriesPath}[${index}]`
    const entryInput = parseMoveRuleAstExactRecord(
      entry,
      LOOKUP_ENTRY_FIELDS,
      entryPath,
      context,
    )
    return {
      key: parseMoveRuleScalar(
        readMoveRuleAstOwnValue(entryInput, 'key', entryPath, context),
        `${entryPath}.key`,
        context,
      ),
      value: parseChildExpression(
        readMoveRuleAstOwnValue(entryInput, 'value', entryPath, context),
        `${entryPath}.value`,
        depth,
        context,
      ),
    }
  })
  const keyIdentities = entries.map(({ key }) => moveRuleScalarIdentity(key))
  if (new Set(keyIdentities).size !== keyIdentities.length) {
    failMoveRuleAst(context, 'duplicate-key', `${entriesPath}.key`, 'lookup keys must be unique.')
  }
  return {
    kind: 'lookup-table',
    input: parseChildExpression(
      readMoveRuleAstOwnValue(input, 'input', path, context),
      `${path}.input`,
      depth,
      context,
    ),
    entries,
    fallback: parseChildExpression(
      readMoveRuleAstOwnValue(input, 'fallback', path, context),
      `${path}.fallback`,
      depth,
      context,
    ),
  }
}

/**
 * Parse one expression while sharing the caller's aggregate AST budget.
 * Evaluation is deliberately not part of this wire contract.
 */
export const parseMoveExpressionNode = (
  value: unknown,
  path: string,
  depth: number,
  context: MoveRuleAstParseContext,
): MoveExpression => {
  enterMoveRuleAstNode(context, path, depth)
  const input = parseMoveRuleAstRecord(value, path, context)
  const rawKind = readMoveRuleAstOwnValue(input, 'kind', path, context)
  if (typeof rawKind !== 'string' || !EXPRESSION_KIND_SET.has(rawKind)) {
    failMoveRuleAst(
      context,
      'unknown-expression-kind',
      `${path}.kind`,
      'must be a supported expression kind.',
    )
  }
  const kind = rawKind as MoveExpressionKind

  switch (kind) {
    case 'constant':
      assertMoveRuleAstExactKeys(input, CONSTANT_FIELDS, path, context)
      return {
        kind,
        value: parseMoveRuleScalar(
          readMoveRuleAstOwnValue(input, 'value', path, context),
          `${path}.value`,
          context,
        ),
      }
    case 'arithmetic':
      return parseArithmeticExpression(input, path, depth, context)
    case 'min':
    case 'max':
      return parseAggregateExpression(kind, input, path, depth, context)
    case 'clamp':
      assertMoveRuleAstExactKeys(input, CLAMP_FIELDS, path, context)
      return {
        kind,
        value: parseChildExpression(
          readMoveRuleAstOwnValue(input, 'value', path, context),
          `${path}.value`,
          depth,
          context,
        ),
        minimum: parseChildExpression(
          readMoveRuleAstOwnValue(input, 'minimum', path, context),
          `${path}.minimum`,
          depth,
          context,
        ),
        maximum: parseChildExpression(
          readMoveRuleAstOwnValue(input, 'maximum', path, context),
          `${path}.maximum`,
          depth,
          context,
        ),
      }
    case 'lookup-table':
      return parseLookupTableExpression(input, path, depth, context)
    case 'stat':
      assertMoveRuleAstExactKeys(input, STAT_FIELDS, path, context)
      return {
        kind,
        subject: parseSubject(input, path, depth, context),
        stat: parseMoveRuleAstEnum<MoveExpressionStat>(
          readMoveRuleAstOwnValue(input, 'stat', path, context),
          STAT_SET,
          `${path}.stat`,
          'a supported selected stat',
          context,
        ),
      }
    case 'hp-ratio':
      assertMoveRuleAstExactKeys(input, HP_RATIO_FIELDS, path, context)
      return {
        kind,
        subject: parseSubject(input, path, depth, context),
        ratio: parseMoveRuleAstEnum<MoveHpRatioKind>(
          readMoveRuleAstOwnValue(input, 'ratio', path, context),
          HP_RATIO_SET,
          `${path}.ratio`,
          'a supported HP ratio',
          context,
        ),
      }
    case 'combat-stage':
      assertMoveRuleAstExactKeys(input, COMBAT_STAGE_FIELDS, path, context)
      return {
        kind,
        subject: parseSubject(input, path, depth, context),
        stage: parseMoveRuleAstEnum<MoveCombatStageStat>(
          readMoveRuleAstOwnValue(input, 'stage', path, context),
          COMBAT_STAGE_SET,
          `${path}.stage`,
          'a supported combat stage',
          context,
        ),
      }
    case 'weight':
      assertMoveRuleAstExactKeys(input, WEIGHT_FIELDS, path, context)
      return {
        kind,
        subject: parseSubject(input, path, depth, context),
        metric: parseMoveRuleAstEnum<MoveWeightMetric>(
          readMoveRuleAstOwnValue(input, 'metric', path, context),
          WEIGHT_METRIC_SET,
          `${path}.metric`,
          'a supported weight metric',
          context,
        ),
      }
    case 'type': {
      assertMoveRuleAstExactKeys(input, TYPE_FIELDS, path, context)
      const of = parseMoveRuleAstEnum<MoveTypeSource>(
        readMoveRuleAstOwnValue(input, 'of', path, context),
        TYPE_SOURCE_SET,
        `${path}.of`,
        'move, primary, or secondary',
        context,
      )
      const rawSubject = readMoveRuleAstOwnValue(input, 'subject', path, context)
      if ((of === 'move') !== (rawSubject === null)) {
        failMoveRuleAst(
          context,
          context.invalidCode,
          `${path}.subject`,
          'must be null for move type and a selector for primary/secondary type.',
        )
      }
      return {
        kind,
        of,
        subject: rawSubject === null
          ? null
          : parseMoveSelectorNode(rawSubject, `${path}.subject`, depth + 1, context),
      }
    }
    case 'weather':
    case 'terrain':
      assertMoveRuleAstExactKeys(input, FIELD_QUERY_FIELDS, path, context)
      return { kind }
    case 'move-history':
      assertMoveRuleAstExactKeys(input, HISTORY_FIELDS, path, context)
      return {
        kind,
        subject: parseSubject(input, path, depth, context),
        query: parseMoveRuleAstEnum<MoveHistoryQuery>(
          readMoveRuleAstOwnValue(input, 'query', path, context),
          HISTORY_QUERY_SET,
          `${path}.query`,
          'a supported move-history query',
          context,
        ),
      }
  }
}

/** Parse, detach, and deeply freeze one bounded rules-value expression AST. */
export const parseMoveExpression = (
  value: unknown,
  path = 'expression',
): MoveExpression => {
  const context = createMoveRuleAstParseContext(
    'invalid-expression',
    (code, errorPath, message) => new MoveExpressionValidationError(code, errorPath, message),
  )
  return deepFreezeMoveRuleAst(parseMoveExpressionNode(value, path, 1, context))
}
