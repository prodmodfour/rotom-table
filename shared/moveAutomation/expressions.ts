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
  parseMoveRuleAstString,
  parseMoveRuleScalar,
  readMoveRuleAstOwnValue,
  type MoveRuleAstParseContext,
  type MoveRuleAstValidationCode,
  type MoveRuleScalar,
} from './ast'
import {
  MOVE_AUTOMATION_ITEM_EFFECT_TIMINGS,
  type MoveAutomationItemEffectTiming,
} from './globalFields'
import {
  MOVE_ITEM_CONTRIBUTION_QUERIES,
  MOVE_ITEM_POSSESSION_QUERIES,
  MOVE_ITEM_RULE_FAMILIES,
  MOVE_ITEM_RULE_QUERY_LIMITS,
  MOVE_ITEM_RULE_SOURCES,
  type MoveItemContributionQuery,
  type MoveItemPossessionQuery,
  type MoveItemRuleFamily,
  type MoveItemRuleSource,
} from './itemRuleQueries'
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
  'condition',
  'combat-stage',
  'combat-stage-total',
  'weight',
  'type',
  'weather',
  'terrain',
  'item',
  'move-history',
  'encounter-resource',
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

export const MOVE_STAGE_AFFECTED_EXPRESSION_STATS = [
  'attack',
  'special-attack',
  'defense',
  'special-defense',
  'speed',
] as const

export const MOVE_DAMAGE_STAT_SELECTION_STATS = [
  ...MOVE_STAGE_AFFECTED_EXPRESSION_STATS,
  'level',
] as const

/** How a selected stat treats the subject's resolved Combat Stage. */
export const MOVE_STAT_COMBAT_STAGE_POLICIES = [
  'honor',
  'ignore',
  'ignore-positive',
  'ignore-negative',
] as const

/** Whether condition/ability-derived modifiers contribute to a Combat Stage query. */
export const MOVE_STAT_STAGE_MODIFIER_POLICIES = ['honor', 'ignore'] as const

export const MOVE_COMBAT_STAGE_TOTAL_DIRECTIONS = ['positive', 'negative'] as const

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

/** Entry-local action facts retained by the authoritative encounter ledger. */
export const MOVE_ENCOUNTER_RESOURCE_QUERIES = [
  'acted-since-entry',
] as const

export const MOVE_EXPRESSION_LIMITS = MOVE_RULE_AST_LIMITS

export type MoveExpressionKind = (typeof MOVE_EXPRESSION_KINDS)[number]
export type MoveArithmeticOperator = (typeof MOVE_ARITHMETIC_OPERATORS)[number]
export type MoveExpressionStat = (typeof MOVE_EXPRESSION_STATS)[number]
export type MoveStageAffectedExpressionStat =
  (typeof MOVE_STAGE_AFFECTED_EXPRESSION_STATS)[number]
export type MoveDamageStatSelectionStat =
  (typeof MOVE_DAMAGE_STAT_SELECTION_STATS)[number]
export type MoveStatCombatStagePolicy =
  (typeof MOVE_STAT_COMBAT_STAGE_POLICIES)[number]
export type MoveStatStageModifierPolicy =
  (typeof MOVE_STAT_STAGE_MODIFIER_POLICIES)[number]
export type MoveCombatStageTotalDirection =
  (typeof MOVE_COMBAT_STAGE_TOTAL_DIRECTIONS)[number]
export type MoveHpRatioKind = (typeof MOVE_HP_RATIO_KINDS)[number]
export type MoveCombatStageStat = (typeof MOVE_COMBAT_STAGE_STATS)[number]
export type MoveWeightMetric = (typeof MOVE_WEIGHT_METRICS)[number]
export type MoveTypeSource = (typeof MOVE_TYPE_SOURCES)[number]
export type MoveHistoryQuery = (typeof MOVE_HISTORY_QUERIES)[number]
export type MoveEncounterResourceQuery =
  (typeof MOVE_ENCOUNTER_RESOURCE_QUERIES)[number]
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
  /**
   * Omitted only for legacy expression data, where both policies mean ignore.
   * New mechanic-bearing stat selections must encode both policies explicitly.
   */
  readonly combatStagePolicy?: MoveStatCombatStagePolicy
  readonly stageModifierPolicy?: MoveStatStageModifierPolicy
}

export interface MoveHpRatioExpression {
  readonly kind: 'hp-ratio'
  readonly subject: MoveSelector
  readonly ratio: MoveHpRatioKind
}

/** Boolean condition membership for status-dependent formulas and predicates. */
export interface MoveConditionExpression {
  readonly kind: 'condition'
  readonly subject: MoveSelector
  readonly conditionId: string
}

export interface MoveCombatStageExpression {
  readonly kind: 'combat-stage'
  readonly subject: MoveSelector
  readonly stage: MoveCombatStageStat
  /** Omission preserves the legacy authored-stage-only query. */
  readonly stageModifierPolicy?: MoveStatStageModifierPolicy
}

export interface MoveCombatStageTotalExpression {
  readonly kind: 'combat-stage-total'
  readonly subject: MoveSelector
  /** Negative totals are returned as a non-negative magnitude. */
  readonly direction: MoveCombatStageTotalDirection
  readonly stageModifierPolicy: MoveStatStageModifierPolicy
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

export interface MoveItemPossessionExpression {
  readonly kind: 'item'
  readonly subject: MoveSelector
  readonly query: MoveItemPossessionQuery
}

export interface MoveItemContributionExpression {
  readonly kind: 'item'
  readonly subject: MoveSelector
  readonly query: MoveItemContributionQuery
  readonly source: MoveItemRuleSource
  readonly families: readonly MoveItemRuleFamily[]
  readonly requirementId: string | null
  readonly timing: MoveAutomationItemEffectTiming
}

export type MoveItemExpression =
  | MoveItemPossessionExpression
  | MoveItemContributionExpression

export interface MoveHistoryExpression {
  readonly kind: 'move-history'
  readonly subject: MoveSelector
  readonly query: MoveHistoryQuery
}

export interface MoveEncounterResourceExpression {
  readonly kind: 'encounter-resource'
  readonly subject: MoveSelector
  readonly query: MoveEncounterResourceQuery
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
  | MoveConditionExpression
  | MoveCombatStageExpression
  | MoveCombatStageTotalExpression
  | MoveWeightExpression
  | MoveTypeExpression
  | MoveWeatherExpression
  | MoveTerrainExpression
  | MoveItemExpression
  | MoveHistoryExpression
  | MoveEncounterResourceExpression

export type MoveStatSelectionExpression =
  | (MoveStatExpression & {
      readonly stat: MoveDamageStatSelectionStat
      readonly combatStagePolicy: MoveStatCombatStagePolicy
      readonly stageModifierPolicy: MoveStatStageModifierPolicy
    })
  | {
      readonly kind: 'min'
      readonly values: readonly MoveStatSelectionExpression[]
    }
  | {
      readonly kind: 'max'
      readonly values: readonly MoveStatSelectionExpression[]
    }

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
const STAT_POLICY_FIELDS = [
  'kind',
  'subject',
  'stat',
  'combatStagePolicy',
  'stageModifierPolicy',
] as const
const HP_RATIO_FIELDS = ['kind', 'subject', 'ratio'] as const
const CONDITION_FIELDS = ['kind', 'subject', 'conditionId'] as const
const COMBAT_STAGE_FIELDS = ['kind', 'subject', 'stage'] as const
const COMBAT_STAGE_MODIFIER_FIELDS = [
  'kind',
  'subject',
  'stage',
  'stageModifierPolicy',
] as const
const COMBAT_STAGE_TOTAL_FIELDS = [
  'kind',
  'subject',
  'direction',
  'stageModifierPolicy',
] as const
const WEIGHT_FIELDS = ['kind', 'subject', 'metric'] as const
const TYPE_FIELDS = ['kind', 'of', 'subject'] as const
const FIELD_QUERY_FIELDS = ['kind'] as const
const ITEM_POSSESSION_FIELDS = ['kind', 'subject', 'query'] as const
const ITEM_CONTRIBUTION_FIELDS = [
  'kind',
  'subject',
  'query',
  'source',
  'families',
  'requirementId',
  'timing',
] as const
const HISTORY_FIELDS = ['kind', 'subject', 'query'] as const
const ENCOUNTER_RESOURCE_FIELDS = ['kind', 'subject', 'query'] as const

const EXPRESSION_KIND_SET = new Set<string>(MOVE_EXPRESSION_KINDS)
const ARITHMETIC_OPERATOR_SET = new Set<string>(MOVE_ARITHMETIC_OPERATORS)
const STAT_SET = new Set<string>(MOVE_EXPRESSION_STATS)
const DAMAGE_STAT_SELECTION_SET = new Set<string>(MOVE_DAMAGE_STAT_SELECTION_STATS)
const STAGE_AFFECTED_STAT_SET = new Set<string>(MOVE_STAGE_AFFECTED_EXPRESSION_STATS)
const STAT_COMBAT_STAGE_POLICY_SET = new Set<string>(MOVE_STAT_COMBAT_STAGE_POLICIES)
const STAT_STAGE_MODIFIER_POLICY_SET = new Set<string>(MOVE_STAT_STAGE_MODIFIER_POLICIES)
const COMBAT_STAGE_TOTAL_DIRECTION_SET = new Set<string>(MOVE_COMBAT_STAGE_TOTAL_DIRECTIONS)
const HP_RATIO_SET = new Set<string>(MOVE_HP_RATIO_KINDS)
const COMBAT_STAGE_SET = new Set<string>(MOVE_COMBAT_STAGE_STATS)
const WEIGHT_METRIC_SET = new Set<string>(MOVE_WEIGHT_METRICS)
const TYPE_SOURCE_SET = new Set<string>(MOVE_TYPE_SOURCES)
const ITEM_POSSESSION_QUERY_SET = new Set<string>(MOVE_ITEM_POSSESSION_QUERIES)
const ITEM_CONTRIBUTION_QUERY_SET = new Set<string>(MOVE_ITEM_CONTRIBUTION_QUERIES)
const ITEM_RULE_SOURCE_SET = new Set<string>(MOVE_ITEM_RULE_SOURCES)
const ITEM_RULE_FAMILY_SET = new Set<string>(MOVE_ITEM_RULE_FAMILIES)
const ITEM_EFFECT_TIMING_SET = new Set<string>(MOVE_AUTOMATION_ITEM_EFFECT_TIMINGS)
const HISTORY_QUERY_SET = new Set<string>(MOVE_HISTORY_QUERIES)
const ENCOUNTER_RESOURCE_QUERY_SET = new Set<string>(MOVE_ENCOUNTER_RESOURCE_QUERIES)
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/

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

const parseItemExpression = (
  input: Record<string, unknown>,
  path: string,
  depth: number,
  context: MoveRuleAstParseContext,
): MoveItemExpression => {
  const rawQuery = readMoveRuleAstOwnValue(input, 'query', path, context)
  if (typeof rawQuery === 'string' && ITEM_POSSESSION_QUERY_SET.has(rawQuery)) {
    assertMoveRuleAstExactKeys(input, ITEM_POSSESSION_FIELDS, path, context)
    return {
      kind: 'item',
      subject: parseSubject(input, path, depth, context),
      query: rawQuery as MoveItemPossessionQuery,
    }
  }

  assertMoveRuleAstExactKeys(input, ITEM_CONTRIBUTION_FIELDS, path, context)
  const query = parseMoveRuleAstEnum<MoveItemContributionQuery>(
    rawQuery,
    ITEM_CONTRIBUTION_QUERY_SET,
    `${path}.query`,
    'a supported item contribution query',
    context,
  )
  const source = parseMoveRuleAstEnum<MoveItemRuleSource>(
    readMoveRuleAstOwnValue(input, 'source', path, context),
    ITEM_RULE_SOURCE_SET,
    `${path}.source`,
    'equipped or digestion-buff',
    context,
  )
  const families = parseMoveRuleAstArray(
    readMoveRuleAstOwnValue(input, 'families', path, context),
    `${path}.families`,
    context,
    { minimum: 1 },
  ).map((family, index) => parseMoveRuleAstEnum<MoveItemRuleFamily>(
    family,
    ITEM_RULE_FAMILY_SET,
    `${path}.families[${index}]`,
    'berry, plate, drive, memory, or other',
    context,
  ))
  if (new Set(families).size !== families.length) {
    failMoveRuleAst(
      context,
      'duplicate-key',
      `${path}.families`,
      'item families must be unique.',
    )
  }

  const rawRequirementId = readMoveRuleAstOwnValue(
    input,
    'requirementId',
    path,
    context,
  )
  const requirementId = rawRequirementId === null
    ? null
    : parseMoveRuleAstString(rawRequirementId, `${path}.requirementId`, context)
  if (
    requirementId !== null
    && (
      requirementId.length > MOVE_ITEM_RULE_QUERY_LIMITS.identifierChars
      || !STABLE_ID_PATTERN.test(requirementId)
    )
  ) {
    failMoveRuleAst(
      context,
      context.invalidCode,
      `${path}.requirementId`,
      'must be a lowercase stable item requirement identifier.',
    )
  }
  if ((source === 'equipped') !== (requirementId !== null)) {
    failMoveRuleAst(
      context,
      context.invalidCode,
      `${path}.requirementId`,
      'must be non-null for equipped queries and null for digestion-buff queries.',
    )
  }

  return {
    kind: 'item',
    subject: parseSubject(input, path, depth, context),
    query,
    source,
    families,
    requirementId,
    timing: parseMoveRuleAstEnum<MoveAutomationItemEffectTiming>(
      readMoveRuleAstOwnValue(input, 'timing', path, context),
      ITEM_EFFECT_TIMING_SET,
      `${path}.timing`,
      'static, trigger, activated, or consumable',
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
    case 'stat': {
      const hasCombatStagePolicy = Object.prototype.hasOwnProperty.call(
        input,
        'combatStagePolicy',
      )
      const hasStageModifierPolicy = Object.prototype.hasOwnProperty.call(
        input,
        'stageModifierPolicy',
      )
      if (hasCombatStagePolicy !== hasStageModifierPolicy) {
        failMoveRuleAst(
          context,
          context.invalidCode,
          path,
          'combatStagePolicy and stageModifierPolicy must either both be present or both be omitted.',
        )
      }
      assertMoveRuleAstExactKeys(
        input,
        hasCombatStagePolicy ? STAT_POLICY_FIELDS : STAT_FIELDS,
        path,
        context,
      )
      const stat = parseMoveRuleAstEnum<MoveExpressionStat>(
        readMoveRuleAstOwnValue(input, 'stat', path, context),
        STAT_SET,
        `${path}.stat`,
        'a supported selected stat',
        context,
      )
      const policies = hasCombatStagePolicy
        ? {
            combatStagePolicy: parseMoveRuleAstEnum<MoveStatCombatStagePolicy>(
              readMoveRuleAstOwnValue(input, 'combatStagePolicy', path, context),
              STAT_COMBAT_STAGE_POLICY_SET,
              `${path}.combatStagePolicy`,
              'honor, ignore, ignore-positive, or ignore-negative',
              context,
            ),
            stageModifierPolicy: parseMoveRuleAstEnum<MoveStatStageModifierPolicy>(
              readMoveRuleAstOwnValue(input, 'stageModifierPolicy', path, context),
              STAT_STAGE_MODIFIER_POLICY_SET,
              `${path}.stageModifierPolicy`,
              'honor or ignore',
              context,
            ),
          }
        : {}
      if (
        hasCombatStagePolicy
        && !STAGE_AFFECTED_STAT_SET.has(stat)
        && (
          policies.combatStagePolicy !== 'ignore'
          || policies.stageModifierPolicy !== 'ignore'
        )
      ) {
        failMoveRuleAst(
          context,
          context.invalidCode,
          path,
          `${stat} has no Combat Stage or stage modifiers; both policies must be ignore.`,
        )
      }
      return {
        kind,
        subject: parseSubject(input, path, depth, context),
        stat,
        ...policies,
      }
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
    case 'condition': {
      assertMoveRuleAstExactKeys(input, CONDITION_FIELDS, path, context)
      const conditionId = parseMoveRuleAstString(
        readMoveRuleAstOwnValue(input, 'conditionId', path, context),
        `${path}.conditionId`,
        context,
      )
      if (!STABLE_ID_PATTERN.test(conditionId)) {
        failMoveRuleAst(
          context,
          context.invalidCode,
          `${path}.conditionId`,
          'must be a lowercase stable condition identifier.',
        )
      }
      return {
        kind,
        subject: parseSubject(input, path, depth, context),
        conditionId,
      }
    }
    case 'combat-stage': {
      const hasStageModifierPolicy = Object.prototype.hasOwnProperty.call(
        input,
        'stageModifierPolicy',
      )
      assertMoveRuleAstExactKeys(
        input,
        hasStageModifierPolicy ? COMBAT_STAGE_MODIFIER_FIELDS : COMBAT_STAGE_FIELDS,
        path,
        context,
      )
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
        ...(hasStageModifierPolicy ? {
          stageModifierPolicy: parseMoveRuleAstEnum<MoveStatStageModifierPolicy>(
            readMoveRuleAstOwnValue(input, 'stageModifierPolicy', path, context),
            STAT_STAGE_MODIFIER_POLICY_SET,
            `${path}.stageModifierPolicy`,
            'honor or ignore',
            context,
          ),
        } : {}),
      }
    }
    case 'combat-stage-total':
      assertMoveRuleAstExactKeys(input, COMBAT_STAGE_TOTAL_FIELDS, path, context)
      return {
        kind,
        subject: parseSubject(input, path, depth, context),
        direction: parseMoveRuleAstEnum<MoveCombatStageTotalDirection>(
          readMoveRuleAstOwnValue(input, 'direction', path, context),
          COMBAT_STAGE_TOTAL_DIRECTION_SET,
          `${path}.direction`,
          'positive or negative',
          context,
        ),
        stageModifierPolicy: parseMoveRuleAstEnum<MoveStatStageModifierPolicy>(
          readMoveRuleAstOwnValue(input, 'stageModifierPolicy', path, context),
          STAT_STAGE_MODIFIER_POLICY_SET,
          `${path}.stageModifierPolicy`,
          'honor or ignore',
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
    case 'item':
      return parseItemExpression(input, path, depth, context)
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
    case 'encounter-resource':
      assertMoveRuleAstExactKeys(input, ENCOUNTER_RESOURCE_FIELDS, path, context)
      return {
        kind,
        subject: parseSubject(input, path, depth, context),
        query: parseMoveRuleAstEnum<MoveEncounterResourceQuery>(
          readMoveRuleAstOwnValue(input, 'query', path, context),
          ENCOUNTER_RESOURCE_QUERY_SET,
          `${path}.query`,
          'a supported encounter-resource query',
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

const assertMoveStatSelectionNode = (
  expression: MoveExpression,
  path: string,
): MoveStatSelectionExpression => {
  if (expression.kind === 'stat') {
    if (!DAMAGE_STAT_SELECTION_SET.has(expression.stat)) {
      throw new MoveExpressionValidationError(
        'invalid-expression',
        `${path}.stat`,
        'damage stat selections support Attack, Special Attack, Defense, Special Defense, Speed, or level.',
      )
    }
    if (
      expression.combatStagePolicy === undefined
      || expression.stageModifierPolicy === undefined
    ) {
      throw new MoveExpressionValidationError(
        'invalid-expression',
        path,
        'damage stat selections must explicitly encode combatStagePolicy and stageModifierPolicy.',
      )
    }
    return expression as MoveStatSelectionExpression
  }
  if (expression.kind !== 'min' && expression.kind !== 'max') {
    throw new MoveExpressionValidationError(
      'invalid-expression',
      path,
      'damage stat selections must be a stat or a min/max comparison of stat selections.',
    )
  }
  expression.values.forEach((child, index) => {
    assertMoveStatSelectionNode(child, `${path}.values[${index}]`)
  })
  return expression as MoveStatSelectionExpression
}

/**
 * Parse a damage-pipeline stat selection. Comparisons stay bounded to min/max
 * over explicit authoritative stat leaves; arbitrary formulas are not accepted
 * as attack or defense selectors.
 */
export const parseMoveStatSelectionExpression = (
  value: unknown,
  path = 'statSelection',
): MoveStatSelectionExpression => assertMoveStatSelectionNode(
  parseMoveExpression(value, path),
  path,
)
