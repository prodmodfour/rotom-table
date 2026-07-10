import {
  ENCOUNTER_EFFECT_DURATION_KINDS,
  ENCOUNTER_EFFECT_LIMITS,
  EncounterEffectValidationError,
  parseEncounterEffectDefinition,
  type EncounterEffectDefinition,
} from './encounterEffects'
import {
  MoveExpressionValidationError,
  parseMoveExpression,
  parseMoveStatSelectionExpression,
  type MoveExpression,
  type MoveStatSelectionExpression,
} from './expressions'
import {
  MOVE_SPEC_PHASES,
  type MoveSpecPhase,
} from './spec'

/**
 * The closed set of state requests a reviewed MoveSpec or registered handler
 * may emit. Reducers own mutation semantics; operations never contain patches.
 */
export const MOVE_EFFECT_OPERATION_KINDS = [
  'roll',
  'damage',
  'multi-hit',
  'direct-hp',
  'heal',
  'condition',
  'combat-stage',
  'temporary-effect',
  'field',
  'hazard',
  'movement-request',
  'usage',
  'history',
  'log',
  'choice-request',
  'reaction-request',
] as const

export const MOVE_EFFECT_SOURCE_KINDS = [
  'move',
  'operation',
  'encounter-effect',
  'lifecycle-event',
] as const

/**
 * These selectors name interpreter-owned recipient sets. They cannot carry
 * client-selected placement IDs. The richer selector AST is defined
 * separately and can be evaluated into one of these bounded sets.
 */
export const MOVE_EFFECT_RECIPIENT_SELECTOR_KINDS = [
  'none',
  'actor',
  'selected-targets',
  'attacked-targets',
  'hit-targets',
  'missed-targets',
  'damaged-targets',
  'fainted-targets',
  'area-targets',
  'source-placement',
] as const

export const MOVE_EFFECT_ROLL_FORMULA_KINDS = [
  'dice',
  'uniform-integer',
  'table',
] as const

export const MOVE_EFFECT_DAMAGE_CLASSES = ['physical', 'special'] as const
export const MOVE_EFFECT_DAMAGE_BASE_STAB_TIMINGS = [
  'none',
  'before-bounds',
  'after-bounds',
] as const
export const MOVE_EFFECT_TYPE_MATCHUP_POLICIES = ['honor', 'ignore'] as const
export const MOVE_EFFECT_TYPE_RELATIONS = [
  'immune',
  'resistant',
  'neutral',
  'weak',
] as const
export const MOVE_EFFECT_CRITICAL_TRIGGER_KINDS = [
  'standard',
  'range',
  'natural-rolls',
  'always',
  'never',
] as const
export const MOVE_EFFECT_CRITICAL_PREVENTION_POLICIES = ['honor', 'ignore'] as const
export const MOVE_EFFECT_MULTI_HIT_COUNT_KINDS = ['fixed', 'roll', 'table'] as const
export const MOVE_EFFECT_MULTI_HIT_COUNT_SCOPES = ['sequence', 'recipient'] as const
export const MOVE_EFFECT_MULTI_HIT_ACCURACY_KINDS = ['automatic', 'once', 'per-hit'] as const
export const MOVE_EFFECT_MULTI_HIT_CRITICAL_KINDS = ['none', 'accuracy', 'per-hit'] as const
export const MOVE_EFFECT_MULTI_HIT_EFFECT_TIMINGS = ['after-each', 'after-all'] as const
export const MOVE_EFFECT_MULTI_HIT_EFFECT_TRIGGERS = [
  'always',
  'hit',
  'damage',
  'knockout',
] as const
export const MOVE_EFFECT_MULTI_HIT_EFFECT_RECIPIENTS = ['actor', 'target'] as const
export const MOVE_EFFECT_MULTI_HIT_EFFECT_KINDS = ['condition', 'combat-stage'] as const
export const MOVE_EFFECT_HP_POOLS = ['hit-points', 'temporary-hit-points'] as const
export const MOVE_EFFECT_DIRECT_HP_MODES = ['lose', 'set'] as const
export const MOVE_EFFECT_HEAL_MODES = [
  'fixed',
  'percent-max',
  'percent-current',
  'percent-missing',
] as const
export const MOVE_EFFECT_ROUNDING_POLICIES = ['floor', 'round', 'ceil'] as const
export const MOVE_EFFECT_CONDITION_ACTIONS = ['apply', 'remove', 'clear'] as const
export const MOVE_EFFECT_COMBAT_STAGE_ACTIONS = ['modify', 'set', 'reset'] as const
export const MOVE_EFFECT_COMBAT_STAGES = [
  'atk',
  'def',
  'satk',
  'sdef',
  'spd',
  'acc',
  'all',
] as const
/** @deprecated Temporary-effect definitions use ENCOUNTER_EFFECT_DURATION_KINDS directly. */
export const MOVE_EFFECT_DURATION_KINDS = ENCOUNTER_EFFECT_DURATION_KINDS

export const MOVE_EFFECT_FIELD_CATEGORIES = [
  'weather',
  'terrain',
  'room',
  'side',
] as const
export const MOVE_EFFECT_MOVEMENT_MODES = [
  'voluntary',
  'forced',
  'teleport',
  'swap',
] as const
export const MOVE_EFFECT_USAGE_ACTIONS = ['spend', 'restore', 'set'] as const
export const MOVE_EFFECT_HISTORY_EVENTS = [
  'move-declared',
  'move-completed',
  'move-hit',
  'damage-dealt',
  'damage-received',
  'knockout',
  'movement',
  'switch',
] as const

export const MOVE_EFFECT_OPERATION_LIMITS = Object.freeze({
  identifierLength: 160,
  textLength: 500,
  operations: 128,
  requestOptions: 64,
  logArguments: 32,
  diceCount: 100,
  diceSides: 10_000,
  numericMagnitude: 1_000_000,
  durationCount: 10_000,
  effectStacks: ENCOUNTER_EFFECT_LIMITS.stacks,
  hazardLayers: 64,
  typeOverrides: 18,
  criticalNaturalRolls: 20,
  multiHitStrikes: 10,
  multiHitTableEntries: 32,
  multiHitEffects: 16,
  reactionPriorityMagnitude: 1_000,
})

export type MoveEffectOperationKind = (typeof MOVE_EFFECT_OPERATION_KINDS)[number]
export type MoveEffectSourceKind = (typeof MOVE_EFFECT_SOURCE_KINDS)[number]
export type MoveEffectRecipientSelectorKind =
  (typeof MOVE_EFFECT_RECIPIENT_SELECTOR_KINDS)[number]
export type MoveEffectRollFormulaKind = (typeof MOVE_EFFECT_ROLL_FORMULA_KINDS)[number]
export type MoveEffectDamageClass = (typeof MOVE_EFFECT_DAMAGE_CLASSES)[number]
export type MoveEffectDamageBaseStabTiming =
  (typeof MOVE_EFFECT_DAMAGE_BASE_STAB_TIMINGS)[number]
export type MoveEffectTypeMatchupPolicy =
  (typeof MOVE_EFFECT_TYPE_MATCHUP_POLICIES)[number]
export type MoveEffectTypeRelation = (typeof MOVE_EFFECT_TYPE_RELATIONS)[number]
export type MoveEffectCriticalTriggerKind =
  (typeof MOVE_EFFECT_CRITICAL_TRIGGER_KINDS)[number]
export type MoveEffectCriticalPreventionPolicy =
  (typeof MOVE_EFFECT_CRITICAL_PREVENTION_POLICIES)[number]
export type MoveEffectMultiHitCountKind =
  (typeof MOVE_EFFECT_MULTI_HIT_COUNT_KINDS)[number]
export type MoveEffectMultiHitCountScope =
  (typeof MOVE_EFFECT_MULTI_HIT_COUNT_SCOPES)[number]
export type MoveEffectMultiHitAccuracyKind =
  (typeof MOVE_EFFECT_MULTI_HIT_ACCURACY_KINDS)[number]
export type MoveEffectMultiHitCriticalKind =
  (typeof MOVE_EFFECT_MULTI_HIT_CRITICAL_KINDS)[number]
export type MoveEffectMultiHitEffectTiming =
  (typeof MOVE_EFFECT_MULTI_HIT_EFFECT_TIMINGS)[number]
export type MoveEffectMultiHitEffectTrigger =
  (typeof MOVE_EFFECT_MULTI_HIT_EFFECT_TRIGGERS)[number]
export type MoveEffectMultiHitEffectRecipient =
  (typeof MOVE_EFFECT_MULTI_HIT_EFFECT_RECIPIENTS)[number]
export type MoveEffectMultiHitEffectKind =
  (typeof MOVE_EFFECT_MULTI_HIT_EFFECT_KINDS)[number]
export type MoveEffectHpPool = (typeof MOVE_EFFECT_HP_POOLS)[number]
export type MoveEffectDirectHpMode = (typeof MOVE_EFFECT_DIRECT_HP_MODES)[number]
export type MoveEffectHealMode = (typeof MOVE_EFFECT_HEAL_MODES)[number]
export type MoveEffectRoundingPolicy = (typeof MOVE_EFFECT_ROUNDING_POLICIES)[number]
export type MoveEffectConditionAction = (typeof MOVE_EFFECT_CONDITION_ACTIONS)[number]
export type MoveEffectCombatStageAction = (typeof MOVE_EFFECT_COMBAT_STAGE_ACTIONS)[number]
export type MoveEffectCombatStage = (typeof MOVE_EFFECT_COMBAT_STAGES)[number]
/** @deprecated Temporary-effect definitions use EncounterEffectDuration. */
export type MoveEffectDurationKind = (typeof MOVE_EFFECT_DURATION_KINDS)[number]
export type MoveEffectFieldCategory = (typeof MOVE_EFFECT_FIELD_CATEGORIES)[number]
export type MoveEffectMovementMode = (typeof MOVE_EFFECT_MOVEMENT_MODES)[number]
export type MoveEffectUsageAction = (typeof MOVE_EFFECT_USAGE_ACTIONS)[number]
export type MoveEffectHistoryEvent = (typeof MOVE_EFFECT_HISTORY_EVENTS)[number]

export interface MoveEffectSourceReference {
  readonly kind: MoveEffectSourceKind
  readonly id: string
}

export interface MoveEffectRecipientsSelector {
  readonly kind: MoveEffectRecipientSelectorKind
}

export interface MoveEffectDiceRollFormula {
  readonly kind: 'dice'
  readonly count: number
  readonly sides: number
  readonly modifier: number
}

export interface MoveEffectUniformIntegerRollFormula {
  readonly kind: 'uniform-integer'
  readonly minimum: number
  readonly maximum: number
}

export interface MoveEffectTableRollFormula {
  readonly kind: 'table'
  /** Stable reference to a reviewed, server-owned table. */
  readonly tableId: string
}

export type MoveEffectRollFormula =
  | MoveEffectDiceRollFormula
  | MoveEffectUniformIntegerRollFormula
  | MoveEffectTableRollFormula

export interface MoveRollEffectPayload {
  readonly rollId: string
  readonly formula: MoveEffectRollFormula
}

export interface MoveContextualDamageBase {
  readonly kind: 'expression'
  readonly expression: MoveExpression
  /** Inclusive bounds applied at the configured point relative to STAB. */
  readonly minimum: number
  readonly maximum: number
  readonly rounding: MoveEffectRoundingPolicy
  readonly stabTiming: MoveEffectDamageBaseStabTiming
}

export type MoveDamageBase = number | MoveContextualDamageBase

/** Static canonical type ID or a bounded scalar expression resolved once per recipient. */
export type MoveDamageType = string | MoveExpression

export interface MoveDamageDefenderTypeOverride {
  readonly defenderType: string
  readonly relation: MoveEffectTypeRelation
}

export interface MoveDamageTypeEffectivenessPolicy {
  /** Ignore removes an immunity contribution; it does not force the final result to neutral. */
  readonly immunity: MoveEffectTypeMatchupPolicy
  readonly resistance: MoveEffectTypeMatchupPolicy
  readonly weakness: MoveEffectTypeMatchupPolicy
  /** Exact final multiplier after immunity policy; null uses the reviewed matchup calculation. */
  readonly effectivenessOverride: number | null
  /** Per-defender-type relation replacements, such as Freeze-Dry treating Water as weak. */
  readonly defenderTypeOverrides: readonly MoveDamageDefenderTypeOverride[]
}

export interface MoveCriticalHitStandardTrigger {
  readonly kind: 'standard'
}

export interface MoveCriticalHitRangeTrigger {
  readonly kind: 'range'
  /** Inclusive minimum natural d20 result. */
  readonly minimum: number
}

export interface MoveCriticalHitNaturalRollsTrigger {
  readonly kind: 'natural-rolls'
  /** Explicit natural d20 results, supporting reviewed patterns such as even rolls. */
  readonly values: readonly number[]
}

export interface MoveCriticalHitAlwaysTrigger {
  readonly kind: 'always'
}

export interface MoveCriticalHitNeverTrigger {
  readonly kind: 'never'
}

export type MoveCriticalHitTrigger =
  | MoveCriticalHitStandardTrigger
  | MoveCriticalHitRangeTrigger
  | MoveCriticalHitNaturalRollsTrigger
  | MoveCriticalHitAlwaysTrigger
  | MoveCriticalHitNeverTrigger

export interface MoveCriticalHitPolicy {
  readonly trigger: MoveCriticalHitTrigger
  readonly prevention: MoveEffectCriticalPreventionPolicy
}

export interface MoveDamageEffectPayload {
  readonly damageClass: MoveEffectDamageClass
  /** A number preserves fixed v2 definitions; contextual rules use the bounded expression form. */
  readonly damageBase: MoveDamageBase
  readonly moveType: MoveDamageType
  readonly accuracyRollId: string | null
  readonly criticalRollId: string | null
  /** Omission uses canonical type matchups, including immunity, resistance, and weakness. */
  readonly typeEffectiveness?: MoveDamageTypeEffectivenessPolicy
  /** Omission uses the move's canonical critical range and honors target prevention. */
  readonly criticalHit?: MoveCriticalHitPolicy
  /** Omission uses the damage class's normal actor Attack/Special Attack selection. */
  readonly attackStat?: MoveStatSelectionExpression
  /** Omission uses the damage class's normal target Defense/Special Defense selection. */
  readonly defenseStat?: MoveStatSelectionExpression
}

export interface MoveMultiHitFixedCount {
  readonly kind: 'fixed'
  readonly hits: number
}

export interface MoveMultiHitRolledCount {
  readonly kind: 'roll'
  readonly scope: MoveEffectMultiHitCountScope
  readonly rollId: string
  readonly formula: Exclude<MoveEffectRollFormula, MoveEffectTableRollFormula>
  readonly minimum: number
  readonly maximum: number
}

export interface MoveMultiHitCountTableEntry {
  readonly minimum: number
  readonly maximum: number
  readonly hits: number
}

export interface MoveMultiHitTableCount {
  readonly kind: 'table'
  readonly scope: MoveEffectMultiHitCountScope
  readonly rollId: string
  readonly tableId: string
  readonly drawFormula: Exclude<MoveEffectRollFormula, MoveEffectTableRollFormula>
  readonly entries: readonly MoveMultiHitCountTableEntry[]
}

export type MoveMultiHitCount =
  | MoveMultiHitFixedCount
  | MoveMultiHitRolledCount
  | MoveMultiHitTableCount

export interface MoveMultiHitAutomaticAccuracy {
  readonly kind: 'automatic'
}

export interface MoveMultiHitOnceAccuracy {
  readonly kind: 'once'
  readonly rollId: string
  readonly formula: MoveEffectDiceRollFormula
}

export interface MoveMultiHitPerHitAccuracy {
  readonly kind: 'per-hit'
  readonly rollId: string
  readonly formula: MoveEffectDiceRollFormula
  /** A reviewed sequence such as Triple Kick may end on its first miss. */
  readonly stopOnMiss: boolean
}

export type MoveMultiHitAccuracy =
  | MoveMultiHitAutomaticAccuracy
  | MoveMultiHitOnceAccuracy
  | MoveMultiHitPerHitAccuracy

export interface MoveMultiHitNoCriticalRoll {
  readonly kind: 'none'
}

export interface MoveMultiHitAccuracyCriticalRoll {
  readonly kind: 'accuracy'
}

export interface MoveMultiHitPerHitCriticalRoll {
  readonly kind: 'per-hit'
  readonly rollId: string
  readonly formula: MoveEffectDiceRollFormula
}

export type MoveMultiHitCriticalRoll =
  | MoveMultiHitNoCriticalRoll
  | MoveMultiHitAccuracyCriticalRoll
  | MoveMultiHitPerHitCriticalRoll

export interface MoveMultiHitConditionEffectTemplate {
  readonly id: string
  readonly timing: MoveEffectMultiHitEffectTiming
  readonly trigger: MoveEffectMultiHitEffectTrigger
  readonly recipient: MoveEffectMultiHitEffectRecipient
  readonly kind: 'condition'
  readonly reasonCode: string
  readonly payload: MoveConditionEffectPayload
}

export interface MoveMultiHitCombatStageEffectTemplate {
  readonly id: string
  readonly timing: MoveEffectMultiHitEffectTiming
  readonly trigger: MoveEffectMultiHitEffectTrigger
  readonly recipient: MoveEffectMultiHitEffectRecipient
  readonly kind: 'combat-stage'
  readonly reasonCode: string
  readonly payload: MoveCombatStageEffectPayload
}

/**
 * Bounded follow-ups that may affect later strikes. Richer HP/lifecycle effects
 * are added by their owning capability tickets rather than opaque callbacks.
 */
export type MoveMultiHitEffectTemplate =
  | MoveMultiHitConditionEffectTemplate
  | MoveMultiHitCombatStageEffectTemplate

export interface MoveMultiHitEffectPayload {
  readonly count: MoveMultiHitCount
  readonly accuracy: MoveMultiHitAccuracy
  readonly critical: MoveMultiHitCriticalRoll
  /** Accuracy/critical references are null because the sequence owns those rolls. */
  readonly damage: MoveDamageEffectPayload
  readonly effects: readonly MoveMultiHitEffectTemplate[]
}

export interface MoveDirectHpEffectPayload {
  readonly mode: MoveEffectDirectHpMode
  readonly pool: MoveEffectHpPool
  readonly amount: number
  readonly minimumRemaining: number | null
  readonly applyTypeImmunity: boolean
}

export interface MoveHealEffectPayload {
  readonly mode: MoveEffectHealMode
  readonly pool: MoveEffectHpPool
  readonly amount: number
  readonly rounding: MoveEffectRoundingPolicy
}

export interface MoveConditionEffectPayload {
  readonly action: MoveEffectConditionAction
  /** Null is required only for `clear`; other actions name one condition. */
  readonly conditionId: string | null
}

export interface MoveCombatStageEffectPayload {
  readonly action: MoveEffectCombatStageAction
  readonly stage: MoveEffectCombatStage
  /** Null is required only for `reset`; modify/set use an integer value. */
  readonly value: number | null
}

/** @deprecated Temporary-effect definitions use EncounterEffectDuration. */
export interface MoveEffectDuration {
  readonly kind: MoveEffectDurationKind
  readonly amount: number | null
}

export interface MoveAddTemporaryEffectPayload {
  readonly action: 'add'
  readonly effectId: string
  /** Typed mechanics only; the reducer supplies source, recipients, timing, and suppression. */
  readonly definition: EncounterEffectDefinition
}

export interface MoveRemoveTemporaryEffectPayload {
  readonly action: 'remove'
  readonly effectId: string
}

export type MoveTemporaryEffectPayload =
  | MoveAddTemporaryEffectPayload
  | MoveRemoveTemporaryEffectPayload

export interface MoveApplyFieldEffectPayload {
  readonly action: 'apply'
  readonly category: MoveEffectFieldCategory
  readonly fieldId: string
  readonly rounds: number | null
}

export interface MoveRemoveFieldEffectPayload {
  readonly action: 'remove'
  readonly category: MoveEffectFieldCategory
  readonly fieldId: string
}

export type MoveFieldEffectPayload = MoveApplyFieldEffectPayload | MoveRemoveFieldEffectPayload

export interface MoveAddHazardEffectPayload {
  readonly action: 'add'
  readonly hazardId: string
  readonly hazardKind: string
  /** Stable reference to cells resolved by authoritative targeting. */
  readonly cellSetId: string
  readonly layers: number
}

export interface MoveRemoveHazardEffectPayload {
  readonly action: 'remove'
  readonly hazardId: string
}

export type MoveHazardEffectPayload = MoveAddHazardEffectPayload | MoveRemoveHazardEffectPayload

export interface MoveMovementRequestEffectPayload {
  readonly requestId: string
  readonly mode: MoveEffectMovementMode
  readonly distance: number | null
  /** Null when the movement mode derives its destination without a choice set. */
  readonly destinationSetId: string | null
}

export interface MoveUsageEffectPayload {
  readonly action: MoveEffectUsageAction
  readonly resourceId: string
  readonly amount: number
}

export interface MoveHistoryEffectPayload {
  readonly event: MoveEffectHistoryEvent
  readonly detailCode: string | null
}

export type MoveLogArgumentValue = string | number | boolean

export interface MoveLogArgument {
  readonly key: string
  readonly value: MoveLogArgumentValue
}

export interface MoveLogEffectPayload {
  /** Message-catalog key; free-form rule instructions are not accepted. */
  readonly messageKey: string
  readonly arguments: readonly MoveLogArgument[]
}

export interface MoveEffectRequestOption {
  readonly id: string
  readonly labelKey: string
}

export interface MoveChoiceRequestEffectPayload {
  readonly requestId: string
  readonly promptKey: string
  readonly options: readonly MoveEffectRequestOption[]
  readonly allowPass: boolean
}

export interface MoveReactionRequestEffectPayload {
  readonly requestId: string
  readonly promptKey: string
  readonly options: readonly MoveEffectRequestOption[]
  readonly allowPass: boolean
  readonly priority: number
}

export interface MoveEffectOperationEnvelope<
  Kind extends MoveEffectOperationKind,
  Payload,
> {
  readonly id: string
  readonly kind: Kind
  readonly source: MoveEffectSourceReference
  readonly recipients: MoveEffectRecipientsSelector
  readonly phase: MoveSpecPhase
  readonly reasonCode: string
  readonly payload: Payload
}

export type MoveRollEffectOperation = MoveEffectOperationEnvelope<'roll', MoveRollEffectPayload>
export type MoveDamageEffectOperation = MoveEffectOperationEnvelope<'damage', MoveDamageEffectPayload>
export type MoveMultiHitEffectOperation = MoveEffectOperationEnvelope<'multi-hit', MoveMultiHitEffectPayload>
export type MoveDirectHpEffectOperation = MoveEffectOperationEnvelope<'direct-hp', MoveDirectHpEffectPayload>
export type MoveHealEffectOperation = MoveEffectOperationEnvelope<'heal', MoveHealEffectPayload>
export type MoveConditionEffectOperation = MoveEffectOperationEnvelope<'condition', MoveConditionEffectPayload>
export type MoveCombatStageEffectOperation = MoveEffectOperationEnvelope<'combat-stage', MoveCombatStageEffectPayload>
export type MoveTemporaryEffectOperation = MoveEffectOperationEnvelope<'temporary-effect', MoveTemporaryEffectPayload>
export type MoveFieldEffectOperation = MoveEffectOperationEnvelope<'field', MoveFieldEffectPayload>
export type MoveHazardEffectOperation = MoveEffectOperationEnvelope<'hazard', MoveHazardEffectPayload>
export type MoveMovementRequestEffectOperation = MoveEffectOperationEnvelope<'movement-request', MoveMovementRequestEffectPayload>
export type MoveUsageEffectOperation = MoveEffectOperationEnvelope<'usage', MoveUsageEffectPayload>
export type MoveHistoryEffectOperation = MoveEffectOperationEnvelope<'history', MoveHistoryEffectPayload>
export type MoveLogEffectOperation = MoveEffectOperationEnvelope<'log', MoveLogEffectPayload>
export type MoveChoiceRequestEffectOperation = MoveEffectOperationEnvelope<'choice-request', MoveChoiceRequestEffectPayload>
export type MoveReactionRequestEffectOperation = MoveEffectOperationEnvelope<'reaction-request', MoveReactionRequestEffectPayload>

export type MoveEffectOperation =
  | MoveRollEffectOperation
  | MoveDamageEffectOperation
  | MoveMultiHitEffectOperation
  | MoveDirectHpEffectOperation
  | MoveHealEffectOperation
  | MoveConditionEffectOperation
  | MoveCombatStageEffectOperation
  | MoveTemporaryEffectOperation
  | MoveFieldEffectOperation
  | MoveHazardEffectOperation
  | MoveMovementRequestEffectOperation
  | MoveUsageEffectOperation
  | MoveHistoryEffectOperation
  | MoveLogEffectOperation
  | MoveChoiceRequestEffectOperation
  | MoveReactionRequestEffectOperation

export type MoveEffectOperationValidationCode =
  | 'invalid-effect-operation'
  | 'unknown-operation-kind'
  | 'limit-exceeded'
  | 'not-json'
  | 'duplicate-id'

export class MoveEffectOperationValidationError extends Error {
  readonly code: MoveEffectOperationValidationCode
  readonly path: string

  constructor(code: MoveEffectOperationValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'MoveEffectOperationValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const OPERATION_FIELDS = [
  'id',
  'kind',
  'source',
  'recipients',
  'phase',
  'reasonCode',
  'payload',
] as const
const SOURCE_FIELDS = ['kind', 'id'] as const
const RECIPIENTS_FIELDS = ['kind'] as const
const ROLL_FIELDS = ['rollId', 'formula'] as const
const DICE_FORMULA_FIELDS = ['kind', 'count', 'sides', 'modifier'] as const
const UNIFORM_FORMULA_FIELDS = ['kind', 'minimum', 'maximum'] as const
const TABLE_FORMULA_FIELDS = ['kind', 'tableId'] as const
const DAMAGE_REQUIRED_FIELDS = [
  'damageClass',
  'damageBase',
  'moveType',
  'accuracyRollId',
  'criticalRollId',
] as const
const DAMAGE_OPTIONAL_FIELDS = [
  'typeEffectiveness',
  'criticalHit',
  'attackStat',
  'defenseStat',
] as const
const MULTI_HIT_FIELDS = ['count', 'accuracy', 'critical', 'damage', 'effects'] as const
const MULTI_HIT_FIXED_COUNT_FIELDS = ['kind', 'hits'] as const
const MULTI_HIT_ROLLED_COUNT_FIELDS = [
  'kind',
  'scope',
  'rollId',
  'formula',
  'minimum',
  'maximum',
] as const
const MULTI_HIT_TABLE_COUNT_FIELDS = [
  'kind',
  'scope',
  'rollId',
  'tableId',
  'drawFormula',
  'entries',
] as const
const MULTI_HIT_TABLE_ENTRY_FIELDS = ['minimum', 'maximum', 'hits'] as const
const MULTI_HIT_AUTOMATIC_ACCURACY_FIELDS = ['kind'] as const
const MULTI_HIT_ONCE_ACCURACY_FIELDS = ['kind', 'rollId', 'formula'] as const
const MULTI_HIT_PER_HIT_ACCURACY_FIELDS = [
  'kind',
  'rollId',
  'formula',
  'stopOnMiss',
] as const
const MULTI_HIT_CRITICAL_KIND_FIELDS = ['kind'] as const
const MULTI_HIT_PER_HIT_CRITICAL_FIELDS = ['kind', 'rollId', 'formula'] as const
const MULTI_HIT_EFFECT_FIELDS = [
  'id',
  'timing',
  'trigger',
  'recipient',
  'kind',
  'reasonCode',
  'payload',
] as const
const CONTEXTUAL_DAMAGE_BASE_FIELDS = [
  'kind',
  'expression',
  'minimum',
  'maximum',
  'rounding',
  'stabTiming',
] as const
const TYPE_EFFECTIVENESS_FIELDS = [
  'immunity',
  'resistance',
  'weakness',
  'effectivenessOverride',
  'defenderTypeOverrides',
] as const
const DEFENDER_TYPE_OVERRIDE_FIELDS = ['defenderType', 'relation'] as const
const CRITICAL_HIT_FIELDS = ['trigger', 'prevention'] as const
const CRITICAL_TRIGGER_KIND_FIELDS = ['kind'] as const
const CRITICAL_RANGE_TRIGGER_FIELDS = ['kind', 'minimum'] as const
const CRITICAL_NATURAL_ROLLS_TRIGGER_FIELDS = ['kind', 'values'] as const
const DIRECT_HP_FIELDS = [
  'mode',
  'pool',
  'amount',
  'minimumRemaining',
  'applyTypeImmunity',
] as const
const HEAL_FIELDS = ['mode', 'pool', 'amount', 'rounding'] as const
const CONDITION_FIELDS = ['action', 'conditionId'] as const
const COMBAT_STAGE_FIELDS = ['action', 'stage', 'value'] as const
const ADD_TEMPORARY_EFFECT_FIELDS = ['action', 'effectId', 'definition'] as const
const REMOVE_TEMPORARY_EFFECT_FIELDS = ['action', 'effectId'] as const
const APPLY_FIELD_FIELDS = ['action', 'category', 'fieldId', 'rounds'] as const
const REMOVE_FIELD_FIELDS = ['action', 'category', 'fieldId'] as const
const ADD_HAZARD_FIELDS = [
  'action',
  'hazardId',
  'hazardKind',
  'cellSetId',
  'layers',
] as const
const REMOVE_HAZARD_FIELDS = ['action', 'hazardId'] as const
const MOVEMENT_REQUEST_FIELDS = [
  'requestId',
  'mode',
  'distance',
  'destinationSetId',
] as const
const USAGE_FIELDS = ['action', 'resourceId', 'amount'] as const
const HISTORY_FIELDS = ['event', 'detailCode'] as const
const LOG_FIELDS = ['messageKey', 'arguments'] as const
const LOG_ARGUMENT_FIELDS = ['key', 'value'] as const
const REQUEST_FIELDS = ['requestId', 'promptKey', 'options', 'allowPass'] as const
const REACTION_REQUEST_FIELDS = [
  'requestId',
  'promptKey',
  'options',
  'allowPass',
  'priority',
] as const
const REQUEST_OPTION_FIELDS = ['id', 'labelKey'] as const

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ARRAY_INDEX_PATTERN = /^(0|[1-9][0-9]*)$/

const OPERATION_KIND_SET = new Set<string>(MOVE_EFFECT_OPERATION_KINDS)
const SOURCE_KIND_SET = new Set<string>(MOVE_EFFECT_SOURCE_KINDS)
const RECIPIENT_KIND_SET = new Set<string>(MOVE_EFFECT_RECIPIENT_SELECTOR_KINDS)
const PHASE_SET = new Set<string>(MOVE_SPEC_PHASES)
const ROLL_FORMULA_KIND_SET = new Set<string>(MOVE_EFFECT_ROLL_FORMULA_KINDS)
const DAMAGE_CLASS_SET = new Set<string>(MOVE_EFFECT_DAMAGE_CLASSES)
const DAMAGE_BASE_STAB_TIMING_SET = new Set<string>(MOVE_EFFECT_DAMAGE_BASE_STAB_TIMINGS)
const TYPE_MATCHUP_POLICY_SET = new Set<string>(MOVE_EFFECT_TYPE_MATCHUP_POLICIES)
const TYPE_RELATION_SET = new Set<string>(MOVE_EFFECT_TYPE_RELATIONS)
const CRITICAL_TRIGGER_KIND_SET = new Set<string>(MOVE_EFFECT_CRITICAL_TRIGGER_KINDS)
const CRITICAL_PREVENTION_POLICY_SET = new Set<string>(
  MOVE_EFFECT_CRITICAL_PREVENTION_POLICIES,
)
const MULTI_HIT_COUNT_KIND_SET = new Set<string>(MOVE_EFFECT_MULTI_HIT_COUNT_KINDS)
const MULTI_HIT_COUNT_SCOPE_SET = new Set<string>(MOVE_EFFECT_MULTI_HIT_COUNT_SCOPES)
const MULTI_HIT_ACCURACY_KIND_SET = new Set<string>(MOVE_EFFECT_MULTI_HIT_ACCURACY_KINDS)
const MULTI_HIT_CRITICAL_KIND_SET = new Set<string>(MOVE_EFFECT_MULTI_HIT_CRITICAL_KINDS)
const MULTI_HIT_EFFECT_TIMING_SET = new Set<string>(MOVE_EFFECT_MULTI_HIT_EFFECT_TIMINGS)
const MULTI_HIT_EFFECT_TRIGGER_SET = new Set<string>(MOVE_EFFECT_MULTI_HIT_EFFECT_TRIGGERS)
const MULTI_HIT_EFFECT_RECIPIENT_SET = new Set<string>(MOVE_EFFECT_MULTI_HIT_EFFECT_RECIPIENTS)
const MULTI_HIT_EFFECT_KIND_SET = new Set<string>(MOVE_EFFECT_MULTI_HIT_EFFECT_KINDS)
const HP_POOL_SET = new Set<string>(MOVE_EFFECT_HP_POOLS)
const DIRECT_HP_MODE_SET = new Set<string>(MOVE_EFFECT_DIRECT_HP_MODES)
const HEAL_MODE_SET = new Set<string>(MOVE_EFFECT_HEAL_MODES)
const ROUNDING_POLICY_SET = new Set<string>(MOVE_EFFECT_ROUNDING_POLICIES)
const CONDITION_ACTION_SET = new Set<string>(MOVE_EFFECT_CONDITION_ACTIONS)
const COMBAT_STAGE_ACTION_SET = new Set<string>(MOVE_EFFECT_COMBAT_STAGE_ACTIONS)
const COMBAT_STAGE_SET = new Set<string>(MOVE_EFFECT_COMBAT_STAGES)
const FIELD_CATEGORY_SET = new Set<string>(MOVE_EFFECT_FIELD_CATEGORIES)
const MOVEMENT_MODE_SET = new Set<string>(MOVE_EFFECT_MOVEMENT_MODES)
const USAGE_ACTION_SET = new Set<string>(MOVE_EFFECT_USAGE_ACTIONS)
const HISTORY_EVENT_SET = new Set<string>(MOVE_EFFECT_HISTORY_EVENTS)

const fail = (
  code: MoveEffectOperationValidationCode,
  path: string,
  message: string,
): never => {
  throw new MoveEffectOperationValidationError(code, path, message)
}

const propertyPath = (path: string, key: string): string => `${path}.${key}`

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Validate descriptors before any field value is read, so accessors never run. */
const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) {
    return fail('not-json', path, 'must be a plain JSON object.')
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('not-json', path, 'symbol properties are not allowed.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
      ?? fail('not-json', propertyPath(path, key), 'must have a property descriptor.')
    if (!descriptor.enumerable || !('value' in descriptor)) {
      fail(
        'not-json',
        propertyPath(path, key),
        'fields must be enumerable data properties.',
      )
    }
  }
  return value
}

const ownValue = (record: UnknownRecord, key: string, path: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
    ?? fail('invalid-effect-operation', propertyPath(path, key), 'is required.')
  if (!descriptor.enumerable || !('value' in descriptor)) {
    return fail('not-json', propertyPath(path, key), 'must be an enumerable data property.')
  }
  return (descriptor as PropertyDescriptor & { value: unknown }).value
}

const assertExactKeys = (
  record: UnknownRecord,
  expectedKeys: readonly string[],
  path: string,
): void => {
  const expected = new Set(expectedKeys)
  const actual = Object.getOwnPropertyNames(record)
  const missing = expectedKeys.filter(key => !Object.prototype.hasOwnProperty.call(record, key))
  const unknown = actual.filter(key => !expected.has(key))
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'invalid-effect-operation',
      path,
      `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
    )
  }
}

const parseExactRecord = (
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): UnknownRecord => {
  const record = parseRecord(value, path)
  assertExactKeys(record, expectedKeys, path)
  return record
}

const parseRecordWithOptionalFields = (
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  path: string,
): UnknownRecord => {
  const record = parseRecord(value, path)
  const allowed = new Set([...requiredKeys, ...optionalKeys])
  const actual = Object.getOwnPropertyNames(record)
  const missing = requiredKeys.filter(key => !Object.prototype.hasOwnProperty.call(record, key))
  const unknown = actual.filter(key => !allowed.has(key))
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'invalid-effect-operation',
      path,
      `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
    )
  }
  return record
}

const parseBoundedText = (
  value: unknown,
  path: string,
  maximumLength: number,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail(
      'invalid-effect-operation',
      path,
      'must be a non-empty, trimmed, single-line string.',
    )
  }
  if (value.length > maximumLength) {
    fail('limit-exceeded', path, `must contain at most ${maximumLength} characters.`)
  }
  return value
}

const parseStableId = (value: unknown, path: string): string => {
  const id = parseBoundedText(value, path, MOVE_EFFECT_OPERATION_LIMITS.identifierLength)
  if (!STABLE_ID_PATTERN.test(id)) {
    fail('invalid-effect-operation', path, 'must be a lowercase stable identifier.')
  }
  return id
}

const parseNullableStableId = (value: unknown, path: string): string | null =>
  value === null ? null : parseStableId(value, path)

const parseEnum = <Value extends string>(
  value: unknown,
  values: ReadonlySet<string>,
  path: string,
  description: string,
): Value => {
  if (typeof value !== 'string' || !values.has(value)) {
    return fail('invalid-effect-operation', path, `must be ${description}.`)
  }
  return value as Value
}

const parseBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') {
    return fail('invalid-effect-operation', path, 'must be a boolean.')
  }
  return value
}

const parseFiniteNumber = (
  value: unknown,
  path: string,
  minimum: number = -MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
  maximum: number = MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('not-json', path, 'must be a finite number.')
  }
  if (value < minimum || value > maximum) {
    fail('limit-exceeded', path, `must be from ${minimum} through ${maximum}.`)
  }
  return value
}

const parseInteger = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number => {
  const parsed = parseFiniteNumber(value, path, minimum, maximum)
  if (!Number.isSafeInteger(parsed)) {
    fail('invalid-effect-operation', path, 'must be a safe integer.')
  }
  return parsed
}

const parseNullableInteger = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number | null => value === null ? null : parseInteger(value, path, minimum, maximum)

const parseBoundedArray = (
  value: unknown,
  path: string,
  maximumLength: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) {
    return fail('invalid-effect-operation', path, 'must be an array.')
  }
  if (value.length > maximumLength) {
    fail('limit-exceeded', path, `must contain at most ${maximumLength} entries.`)
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('not-json', path, 'symbol properties are not allowed on arrays.')
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === 'length') continue
    const index = Number(key)
    if (!ARRAY_INDEX_PATTERN.test(key) || !Number.isSafeInteger(index) || index >= value.length) {
      fail('not-json', propertyPath(path, key), 'arrays cannot contain named properties.')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
      ?? fail('not-json', `${path}[${key}]`, 'must have a property descriptor.')
    if (!descriptor.enumerable || !('value' in descriptor)) {
      fail('not-json', `${path}[${key}]`, 'entries must be enumerable data properties.')
    }
  }

  const entries: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      ?? fail('not-json', `${path}[${index}]`, 'sparse arrays are not allowed.')
    if (!descriptor.enumerable || !('value' in descriptor)) {
      fail('not-json', `${path}[${index}]`, 'entries must be enumerable data properties.')
    }
    entries.push((descriptor as PropertyDescriptor & { value: unknown }).value)
  }
  return entries
}

const assertUnique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) {
    fail('duplicate-id', path, 'must not contain duplicate identifiers.')
  }
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const parseSource = (value: unknown, path: string): MoveEffectSourceReference => {
  const input = parseExactRecord(value, SOURCE_FIELDS, path)
  return {
    kind: parseEnum<MoveEffectSourceKind>(
      ownValue(input, 'kind', path),
      SOURCE_KIND_SET,
      `${path}.kind`,
      'a supported source kind',
    ),
    id: parseStableId(ownValue(input, 'id', path), `${path}.id`),
  }
}

const parseRecipients = (value: unknown, path: string): MoveEffectRecipientsSelector => {
  const input = parseExactRecord(value, RECIPIENTS_FIELDS, path)
  return {
    kind: parseEnum<MoveEffectRecipientSelectorKind>(
      ownValue(input, 'kind', path),
      RECIPIENT_KIND_SET,
      `${path}.kind`,
      'a supported recipient selector kind',
    ),
  }
}

const parseRollFormula = (value: unknown, path: string): MoveEffectRollFormula => {
  const input = parseRecord(value, path)
  const kind = parseEnum<MoveEffectRollFormulaKind>(
    ownValue(input, 'kind', path),
    ROLL_FORMULA_KIND_SET,
    `${path}.kind`,
    'a supported roll formula kind',
  )

  if (kind === 'dice') {
    assertExactKeys(input, DICE_FORMULA_FIELDS, path)
    return {
      kind,
      count: parseInteger(
        ownValue(input, 'count', path),
        `${path}.count`,
        1,
        MOVE_EFFECT_OPERATION_LIMITS.diceCount,
      ),
      sides: parseInteger(
        ownValue(input, 'sides', path),
        `${path}.sides`,
        2,
        MOVE_EFFECT_OPERATION_LIMITS.diceSides,
      ),
      modifier: parseInteger(
        ownValue(input, 'modifier', path),
        `${path}.modifier`,
        -MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
        MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
      ),
    }
  }
  if (kind === 'uniform-integer') {
    assertExactKeys(input, UNIFORM_FORMULA_FIELDS, path)
    const minimum = parseInteger(
      ownValue(input, 'minimum', path),
      `${path}.minimum`,
      -MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
      MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
    )
    const maximum = parseInteger(
      ownValue(input, 'maximum', path),
      `${path}.maximum`,
      -MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
      MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
    )
    if (minimum > maximum) {
      fail('invalid-effect-operation', path, 'minimum cannot exceed maximum.')
    }
    return { kind, minimum, maximum }
  }

  assertExactKeys(input, TABLE_FORMULA_FIELDS, path)
  return {
    kind,
    tableId: parseStableId(ownValue(input, 'tableId', path), `${path}.tableId`),
  }
}

const parseRollPayload = (value: unknown, path: string): MoveRollEffectPayload => {
  const input = parseExactRecord(value, ROLL_FIELDS, path)
  return {
    rollId: parseStableId(ownValue(input, 'rollId', path), `${path}.rollId`),
    formula: parseRollFormula(ownValue(input, 'formula', path), `${path}.formula`),
  }
}

const parseEffectExpression = <Value>(
  parse: () => Value,
): Value => {
  try {
    return parse()
  }
  catch (error) {
    if (!(error instanceof MoveExpressionValidationError)) throw error
    const detailPrefix = `${error.path}: `
    const detail = error.message.startsWith(detailPrefix)
      ? error.message.slice(detailPrefix.length)
      : error.message
    return fail(
      error.code === 'limit-exceeded'
        ? 'limit-exceeded'
        : error.code === 'not-json'
          ? 'not-json'
          : 'invalid-effect-operation',
      error.path,
      detail,
    )
  }
}

const parseDamageStatSelection = (
  value: unknown,
  path: string,
): MoveStatSelectionExpression => parseEffectExpression(
  () => parseMoveStatSelectionExpression(value, path),
)

const parseDamageBase = (
  value: unknown,
  path: string,
): MoveDamageBase => {
  if (typeof value === 'number') {
    return parseInteger(
      value,
      path,
      0,
      MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
    )
  }

  const input = parseExactRecord(value, CONTEXTUAL_DAMAGE_BASE_FIELDS, path)
  if (ownValue(input, 'kind', path) !== 'expression') {
    fail('invalid-effect-operation', `${path}.kind`, 'must be expression.')
  }
  const minimum = parseInteger(
    ownValue(input, 'minimum', path),
    `${path}.minimum`,
    0,
    MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
  )
  const maximum = parseInteger(
    ownValue(input, 'maximum', path),
    `${path}.maximum`,
    0,
    MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
  )
  if (minimum > maximum) {
    fail('invalid-effect-operation', path, 'minimum cannot exceed maximum.')
  }
  return {
    kind: 'expression',
    expression: parseEffectExpression(
      () => parseMoveExpression(
        ownValue(input, 'expression', path),
        `${path}.expression`,
      ),
    ),
    minimum,
    maximum,
    rounding: parseEnum<MoveEffectRoundingPolicy>(
      ownValue(input, 'rounding', path),
      ROUNDING_POLICY_SET,
      `${path}.rounding`,
      'floor, round, or ceil',
    ),
    stabTiming: parseEnum<MoveEffectDamageBaseStabTiming>(
      ownValue(input, 'stabTiming', path),
      DAMAGE_BASE_STAB_TIMING_SET,
      `${path}.stabTiming`,
      'none, before-bounds, or after-bounds',
    ),
  }
}

const parseDamageType = (
  value: unknown,
  path: string,
): MoveDamageType => typeof value === 'string'
  ? parseStableId(value, path)
  : parseEffectExpression(() => parseMoveExpression(value, path))

const parseTypeEffectivenessPolicy = (
  value: unknown,
  path: string,
): MoveDamageTypeEffectivenessPolicy => {
  const input = parseExactRecord(value, TYPE_EFFECTIVENESS_FIELDS, path)
  const overridesPath = `${path}.defenderTypeOverrides`
  const defenderTypeOverrides = parseBoundedArray(
    ownValue(input, 'defenderTypeOverrides', path),
    overridesPath,
    MOVE_EFFECT_OPERATION_LIMITS.typeOverrides,
  ).map((entry, index): MoveDamageDefenderTypeOverride => {
    const entryPath = `${overridesPath}[${index}]`
    const override = parseExactRecord(entry, DEFENDER_TYPE_OVERRIDE_FIELDS, entryPath)
    return {
      defenderType: parseStableId(
        ownValue(override, 'defenderType', entryPath),
        `${entryPath}.defenderType`,
      ),
      relation: parseEnum<MoveEffectTypeRelation>(
        ownValue(override, 'relation', entryPath),
        TYPE_RELATION_SET,
        `${entryPath}.relation`,
        'immune, resistant, neutral, or weak',
      ),
    }
  })
  assertUnique(
    defenderTypeOverrides.map(override => override.defenderType),
    `${overridesPath}.defenderType`,
  )
  defenderTypeOverrides.sort((left, right) => (
    left.defenderType < right.defenderType
      ? -1
      : left.defenderType > right.defenderType
        ? 1
        : 0
  ))
  return {
    immunity: parseEnum<MoveEffectTypeMatchupPolicy>(
      ownValue(input, 'immunity', path),
      TYPE_MATCHUP_POLICY_SET,
      `${path}.immunity`,
      'honor or ignore',
    ),
    resistance: parseEnum<MoveEffectTypeMatchupPolicy>(
      ownValue(input, 'resistance', path),
      TYPE_MATCHUP_POLICY_SET,
      `${path}.resistance`,
      'honor or ignore',
    ),
    weakness: parseEnum<MoveEffectTypeMatchupPolicy>(
      ownValue(input, 'weakness', path),
      TYPE_MATCHUP_POLICY_SET,
      `${path}.weakness`,
      'honor or ignore',
    ),
    effectivenessOverride: ownValue(input, 'effectivenessOverride', path) === null
      ? null
      : parseFiniteNumber(
          ownValue(input, 'effectivenessOverride', path),
          `${path}.effectivenessOverride`,
          0,
        ),
    defenderTypeOverrides,
  }
}

const parseCriticalHitTrigger = (
  value: unknown,
  path: string,
): MoveCriticalHitTrigger => {
  const input = parseRecord(value, path)
  const kind = parseEnum<MoveEffectCriticalTriggerKind>(
    ownValue(input, 'kind', path),
    CRITICAL_TRIGGER_KIND_SET,
    `${path}.kind`,
    'standard, range, natural-rolls, always, or never',
  )
  if (kind === 'range') {
    assertExactKeys(input, CRITICAL_RANGE_TRIGGER_FIELDS, path)
    return {
      kind,
      minimum: parseInteger(ownValue(input, 'minimum', path), `${path}.minimum`, 1, 20),
    }
  }
  if (kind === 'natural-rolls') {
    assertExactKeys(input, CRITICAL_NATURAL_ROLLS_TRIGGER_FIELDS, path)
    const valuesPath = `${path}.values`
    const values = parseBoundedArray(
      ownValue(input, 'values', path),
      valuesPath,
      MOVE_EFFECT_OPERATION_LIMITS.criticalNaturalRolls,
    ).map((entry, index) => parseInteger(entry, `${valuesPath}[${index}]`, 1, 20))
    if (values.length === 0) {
      fail('invalid-effect-operation', valuesPath, 'must contain at least one natural roll.')
    }
    if (new Set(values).size !== values.length) {
      fail('duplicate-id', valuesPath, 'must not contain duplicate natural rolls.')
    }
    return { kind, values: [...values].sort((left, right) => left - right) }
  }
  assertExactKeys(input, CRITICAL_TRIGGER_KIND_FIELDS, path)
  return { kind }
}

const parseCriticalHitPolicy = (
  value: unknown,
  path: string,
): MoveCriticalHitPolicy => {
  const input = parseExactRecord(value, CRITICAL_HIT_FIELDS, path)
  return {
    trigger: parseCriticalHitTrigger(ownValue(input, 'trigger', path), `${path}.trigger`),
    prevention: parseEnum<MoveEffectCriticalPreventionPolicy>(
      ownValue(input, 'prevention', path),
      CRITICAL_PREVENTION_POLICY_SET,
      `${path}.prevention`,
      'honor or ignore',
    ),
  }
}

const parseDamagePayload = (value: unknown, path: string): MoveDamageEffectPayload => {
  const input = parseRecordWithOptionalFields(
    value,
    DAMAGE_REQUIRED_FIELDS,
    DAMAGE_OPTIONAL_FIELDS,
    path,
  )
  const hasTypeEffectiveness = Object.prototype.hasOwnProperty.call(input, 'typeEffectiveness')
  const hasCriticalHit = Object.prototype.hasOwnProperty.call(input, 'criticalHit')
  const hasAttackStat = Object.prototype.hasOwnProperty.call(input, 'attackStat')
  const hasDefenseStat = Object.prototype.hasOwnProperty.call(input, 'defenseStat')
  return {
    damageClass: parseEnum<MoveEffectDamageClass>(
      ownValue(input, 'damageClass', path),
      DAMAGE_CLASS_SET,
      `${path}.damageClass`,
      'physical or special',
    ),
    damageBase: parseDamageBase(
      ownValue(input, 'damageBase', path),
      `${path}.damageBase`,
    ),
    moveType: parseDamageType(ownValue(input, 'moveType', path), `${path}.moveType`),
    accuracyRollId: parseNullableStableId(
      ownValue(input, 'accuracyRollId', path),
      `${path}.accuracyRollId`,
    ),
    criticalRollId: parseNullableStableId(
      ownValue(input, 'criticalRollId', path),
      `${path}.criticalRollId`,
    ),
    ...(hasTypeEffectiveness ? {
      typeEffectiveness: parseTypeEffectivenessPolicy(
        ownValue(input, 'typeEffectiveness', path),
        `${path}.typeEffectiveness`,
      ),
    } : {}),
    ...(hasCriticalHit ? {
      criticalHit: parseCriticalHitPolicy(
        ownValue(input, 'criticalHit', path),
        `${path}.criticalHit`,
      ),
    } : {}),
    ...(hasAttackStat ? {
      attackStat: parseDamageStatSelection(
        ownValue(input, 'attackStat', path),
        `${path}.attackStat`,
      ),
    } : {}),
    ...(hasDefenseStat ? {
      defenseStat: parseDamageStatSelection(
        ownValue(input, 'defenseStat', path),
        `${path}.defenseStat`,
      ),
    } : {}),
  }
}

const parseDirectHpPayload = (value: unknown, path: string): MoveDirectHpEffectPayload => {
  const input = parseExactRecord(value, DIRECT_HP_FIELDS, path)
  return {
    mode: parseEnum<MoveEffectDirectHpMode>(
      ownValue(input, 'mode', path),
      DIRECT_HP_MODE_SET,
      `${path}.mode`,
      'lose or set',
    ),
    pool: parseEnum<MoveEffectHpPool>(
      ownValue(input, 'pool', path),
      HP_POOL_SET,
      `${path}.pool`,
      'a supported HP pool',
    ),
    amount: parseFiniteNumber(
      ownValue(input, 'amount', path),
      `${path}.amount`,
      0,
    ),
    minimumRemaining: parseNullableInteger(
      ownValue(input, 'minimumRemaining', path),
      `${path}.minimumRemaining`,
      0,
      MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
    ),
    applyTypeImmunity: parseBoolean(
      ownValue(input, 'applyTypeImmunity', path),
      `${path}.applyTypeImmunity`,
    ),
  }
}

const parseHealPayload = (value: unknown, path: string): MoveHealEffectPayload => {
  const input = parseExactRecord(value, HEAL_FIELDS, path)
  return {
    mode: parseEnum<MoveEffectHealMode>(
      ownValue(input, 'mode', path),
      HEAL_MODE_SET,
      `${path}.mode`,
      'a supported healing mode',
    ),
    pool: parseEnum<MoveEffectHpPool>(
      ownValue(input, 'pool', path),
      HP_POOL_SET,
      `${path}.pool`,
      'a supported HP pool',
    ),
    amount: parseFiniteNumber(ownValue(input, 'amount', path), `${path}.amount`, 0),
    rounding: parseEnum<MoveEffectRoundingPolicy>(
      ownValue(input, 'rounding', path),
      ROUNDING_POLICY_SET,
      `${path}.rounding`,
      'floor, round, or ceil',
    ),
  }
}

const parseConditionPayload = (value: unknown, path: string): MoveConditionEffectPayload => {
  const input = parseExactRecord(value, CONDITION_FIELDS, path)
  const action = parseEnum<MoveEffectConditionAction>(
    ownValue(input, 'action', path),
    CONDITION_ACTION_SET,
    `${path}.action`,
    'apply, remove, or clear',
  )
  const conditionId = parseNullableStableId(
    ownValue(input, 'conditionId', path),
    `${path}.conditionId`,
  )
  if ((action === 'clear') !== (conditionId === null)) {
    fail(
      'invalid-effect-operation',
      `${path}.conditionId`,
      'must be null for clear and a stable identifier for apply/remove.',
    )
  }
  return { action, conditionId }
}

const parseCombatStagePayload = (
  value: unknown,
  path: string,
): MoveCombatStageEffectPayload => {
  const input = parseExactRecord(value, COMBAT_STAGE_FIELDS, path)
  const action = parseEnum<MoveEffectCombatStageAction>(
    ownValue(input, 'action', path),
    COMBAT_STAGE_ACTION_SET,
    `${path}.action`,
    'modify, set, or reset',
  )
  const stage = parseEnum<MoveEffectCombatStage>(
    ownValue(input, 'stage', path),
    COMBAT_STAGE_SET,
    `${path}.stage`,
    'a supported combat stage',
  )
  const rawValue = ownValue(input, 'value', path)
  const stageValue = rawValue === null ? null : parseInteger(rawValue, `${path}.value`, -6, 6)
  if ((action === 'reset') !== (stageValue === null)) {
    fail(
      'invalid-effect-operation',
      `${path}.value`,
      'must be null for reset and an integer from -6 through 6 for modify/set.',
    )
  }
  return { action, stage, value: stageValue }
}

const parseMultiHitDrawFormula = (
  value: unknown,
  path: string,
): Exclude<MoveEffectRollFormula, MoveEffectTableRollFormula> => {
  const formula = parseRollFormula(value, path)
  if (formula.kind === 'table') {
    return fail(
      'invalid-effect-operation',
      `${path}.kind`,
      'nested random tables are not supported.',
    )
  }
  return formula
}

const parseMultiHitD20Formula = (
  value: unknown,
  path: string,
): MoveEffectDiceRollFormula => {
  const formula = parseRollFormula(value, path)
  if (formula.kind !== 'dice') {
    return fail(
      'invalid-effect-operation',
      path,
      'must be an unmodified 1d20 formula; contextual modifiers are applied separately.',
    )
  }
  if (formula.count !== 1 || formula.sides !== 20 || formula.modifier !== 0) {
    return fail(
      'invalid-effect-operation',
      path,
      'must be an unmodified 1d20 formula; contextual modifiers are applied separately.',
    )
  }
  return formula
}

const parseMultiHitCount = (
  value: unknown,
  path: string,
): MoveMultiHitCount => {
  const input = parseRecord(value, path)
  const kind = parseEnum<MoveEffectMultiHitCountKind>(
    ownValue(input, 'kind', path),
    MULTI_HIT_COUNT_KIND_SET,
    `${path}.kind`,
    'fixed, roll, or table',
  )
  if (kind === 'fixed') {
    assertExactKeys(input, MULTI_HIT_FIXED_COUNT_FIELDS, path)
    return {
      kind,
      hits: parseInteger(
        ownValue(input, 'hits', path),
        `${path}.hits`,
        1,
        MOVE_EFFECT_OPERATION_LIMITS.multiHitStrikes,
      ),
    }
  }

  const scope = parseEnum<MoveEffectMultiHitCountScope>(
    ownValue(input, 'scope', path),
    MULTI_HIT_COUNT_SCOPE_SET,
    `${path}.scope`,
    'sequence or recipient',
  )
  const rollId = parseStableId(ownValue(input, 'rollId', path), `${path}.rollId`)
  if (kind === 'roll') {
    assertExactKeys(input, MULTI_HIT_ROLLED_COUNT_FIELDS, path)
    const minimum = parseInteger(
      ownValue(input, 'minimum', path),
      `${path}.minimum`,
      1,
      MOVE_EFFECT_OPERATION_LIMITS.multiHitStrikes,
    )
    const maximum = parseInteger(
      ownValue(input, 'maximum', path),
      `${path}.maximum`,
      1,
      MOVE_EFFECT_OPERATION_LIMITS.multiHitStrikes,
    )
    if (minimum > maximum) {
      fail('invalid-effect-operation', path, 'minimum cannot exceed maximum.')
    }
    return {
      kind,
      scope,
      rollId,
      formula: parseMultiHitDrawFormula(
        ownValue(input, 'formula', path),
        `${path}.formula`,
      ),
      minimum,
      maximum,
    }
  }

  assertExactKeys(input, MULTI_HIT_TABLE_COUNT_FIELDS, path)
  const entriesPath = `${path}.entries`
  const entries = parseBoundedArray(
    ownValue(input, 'entries', path),
    entriesPath,
    MOVE_EFFECT_OPERATION_LIMITS.multiHitTableEntries,
  ).map((entry, index): MoveMultiHitCountTableEntry => {
    const entryPath = `${entriesPath}[${index}]`
    const record = parseExactRecord(entry, MULTI_HIT_TABLE_ENTRY_FIELDS, entryPath)
    const minimum = parseInteger(
      ownValue(record, 'minimum', entryPath),
      `${entryPath}.minimum`,
      -MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
      MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
    )
    const maximum = parseInteger(
      ownValue(record, 'maximum', entryPath),
      `${entryPath}.maximum`,
      -MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
      MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
    )
    if (minimum > maximum) {
      fail('invalid-effect-operation', entryPath, 'minimum cannot exceed maximum.')
    }
    return {
      minimum,
      maximum,
      hits: parseInteger(
        ownValue(record, 'hits', entryPath),
        `${entryPath}.hits`,
        1,
        MOVE_EFFECT_OPERATION_LIMITS.multiHitStrikes,
      ),
    }
  }).sort((left, right) => left.minimum - right.minimum || left.maximum - right.maximum)
  if (entries.length === 0) {
    fail('invalid-effect-operation', entriesPath, 'must contain at least one table entry.')
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index]!.minimum <= entries[index - 1]!.maximum) {
      fail('invalid-effect-operation', entriesPath, 'table ranges may not overlap.')
    }
  }
  return {
    kind,
    scope,
    rollId,
    tableId: parseStableId(ownValue(input, 'tableId', path), `${path}.tableId`),
    drawFormula: parseMultiHitDrawFormula(
      ownValue(input, 'drawFormula', path),
      `${path}.drawFormula`,
    ),
    entries,
  }
}

const parseMultiHitAccuracy = (
  value: unknown,
  path: string,
): MoveMultiHitAccuracy => {
  const input = parseRecord(value, path)
  const kind = parseEnum<MoveEffectMultiHitAccuracyKind>(
    ownValue(input, 'kind', path),
    MULTI_HIT_ACCURACY_KIND_SET,
    `${path}.kind`,
    'automatic, once, or per-hit',
  )
  if (kind === 'automatic') {
    assertExactKeys(input, MULTI_HIT_AUTOMATIC_ACCURACY_FIELDS, path)
    return { kind }
  }
  if (kind === 'once') {
    assertExactKeys(input, MULTI_HIT_ONCE_ACCURACY_FIELDS, path)
    return {
      kind,
      rollId: parseStableId(ownValue(input, 'rollId', path), `${path}.rollId`),
      formula: parseMultiHitD20Formula(ownValue(input, 'formula', path), `${path}.formula`),
    }
  }
  assertExactKeys(input, MULTI_HIT_PER_HIT_ACCURACY_FIELDS, path)
  return {
    kind,
    rollId: parseStableId(ownValue(input, 'rollId', path), `${path}.rollId`),
    formula: parseMultiHitD20Formula(ownValue(input, 'formula', path), `${path}.formula`),
    stopOnMiss: parseBoolean(ownValue(input, 'stopOnMiss', path), `${path}.stopOnMiss`),
  }
}

const parseMultiHitCritical = (
  value: unknown,
  path: string,
): MoveMultiHitCriticalRoll => {
  const input = parseRecord(value, path)
  const kind = parseEnum<MoveEffectMultiHitCriticalKind>(
    ownValue(input, 'kind', path),
    MULTI_HIT_CRITICAL_KIND_SET,
    `${path}.kind`,
    'none, accuracy, or per-hit',
  )
  if (kind !== 'per-hit') {
    assertExactKeys(input, MULTI_HIT_CRITICAL_KIND_FIELDS, path)
    return { kind }
  }
  assertExactKeys(input, MULTI_HIT_PER_HIT_CRITICAL_FIELDS, path)
  return {
    kind,
    rollId: parseStableId(ownValue(input, 'rollId', path), `${path}.rollId`),
    formula: parseMultiHitD20Formula(ownValue(input, 'formula', path), `${path}.formula`),
  }
}

const parseMultiHitEffects = (
  value: unknown,
  path: string,
): readonly MoveMultiHitEffectTemplate[] => {
  const effects = parseBoundedArray(
    value,
    path,
    MOVE_EFFECT_OPERATION_LIMITS.multiHitEffects,
  ).map((effect, index): MoveMultiHitEffectTemplate => {
    const effectPath = `${path}[${index}]`
    const input = parseExactRecord(effect, MULTI_HIT_EFFECT_FIELDS, effectPath)
    const common = {
      id: parseStableId(ownValue(input, 'id', effectPath), `${effectPath}.id`),
      timing: parseEnum<MoveEffectMultiHitEffectTiming>(
        ownValue(input, 'timing', effectPath),
        MULTI_HIT_EFFECT_TIMING_SET,
        `${effectPath}.timing`,
        'after-each or after-all',
      ),
      trigger: parseEnum<MoveEffectMultiHitEffectTrigger>(
        ownValue(input, 'trigger', effectPath),
        MULTI_HIT_EFFECT_TRIGGER_SET,
        `${effectPath}.trigger`,
        'always, hit, damage, or knockout',
      ),
      recipient: parseEnum<MoveEffectMultiHitEffectRecipient>(
        ownValue(input, 'recipient', effectPath),
        MULTI_HIT_EFFECT_RECIPIENT_SET,
        `${effectPath}.recipient`,
        'actor or target',
      ),
      reasonCode: parseStableId(
        ownValue(input, 'reasonCode', effectPath),
        `${effectPath}.reasonCode`,
      ),
    }
    const kind = parseEnum<MoveEffectMultiHitEffectKind>(
      ownValue(input, 'kind', effectPath),
      MULTI_HIT_EFFECT_KIND_SET,
      `${effectPath}.kind`,
      'condition or combat-stage',
    )
    const payload = ownValue(input, 'payload', effectPath)
    return kind === 'condition'
      ? {
          ...common,
          kind,
          payload: parseConditionPayload(payload, `${effectPath}.payload`),
        }
      : {
          ...common,
          kind,
          payload: parseCombatStagePayload(payload, `${effectPath}.payload`),
        }
  })
  assertUnique(effects.map(effect => effect.id), `${path}.id`)
  return effects
}

const parseMultiHitPayload = (
  value: unknown,
  path: string,
): MoveMultiHitEffectPayload => {
  const input = parseExactRecord(value, MULTI_HIT_FIELDS, path)
  const damage = parseDamagePayload(ownValue(input, 'damage', path), `${path}.damage`)
  if (damage.accuracyRollId !== null || damage.criticalRollId !== null) {
    fail(
      'invalid-effect-operation',
      `${path}.damage`,
      'accuracyRollId and criticalRollId must be null because the sequence owns per-hit rolls.',
    )
  }
  const accuracy = parseMultiHitAccuracy(
    ownValue(input, 'accuracy', path),
    `${path}.accuracy`,
  )
  const critical = parseMultiHitCritical(
    ownValue(input, 'critical', path),
    `${path}.critical`,
  )
  if (critical.kind === 'accuracy' && accuracy.kind === 'automatic') {
    fail(
      'invalid-effect-operation',
      `${path}.critical.kind`,
      'accuracy criticals require an accuracy roll.',
    )
  }
  return {
    count: parseMultiHitCount(ownValue(input, 'count', path), `${path}.count`),
    accuracy,
    critical,
    damage,
    effects: parseMultiHitEffects(ownValue(input, 'effects', path), `${path}.effects`),
  }
}

const parseTemporaryEffectPayload = (
  value: unknown,
  path: string,
): MoveTemporaryEffectPayload => {
  const input = parseRecord(value, path)
  const action = ownValue(input, 'action', path)
  if (action === 'add') {
    assertExactKeys(input, ADD_TEMPORARY_EFFECT_FIELDS, path)
    let definition: EncounterEffectDefinition
    try {
      definition = parseEncounterEffectDefinition(
        ownValue(input, 'definition', path),
        `${path}.definition`,
      )
    } catch (error) {
      if (error instanceof EncounterEffectValidationError) {
        fail(
          error.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-effect-operation',
          error.path,
          error.detail,
        )
      }
      throw error
    }
    return {
      action,
      effectId: parseStableId(ownValue(input, 'effectId', path), `${path}.effectId`),
      definition,
    }
  }
  if (action === 'remove') {
    assertExactKeys(input, REMOVE_TEMPORARY_EFFECT_FIELDS, path)
    return {
      action,
      effectId: parseStableId(ownValue(input, 'effectId', path), `${path}.effectId`),
    }
  }
  return fail('invalid-effect-operation', `${path}.action`, 'must be add or remove.')
}

const parseFieldPayload = (value: unknown, path: string): MoveFieldEffectPayload => {
  const input = parseRecord(value, path)
  const action = ownValue(input, 'action', path)
  if (action === 'apply') {
    assertExactKeys(input, APPLY_FIELD_FIELDS, path)
    return {
      action,
      category: parseEnum<MoveEffectFieldCategory>(
        ownValue(input, 'category', path),
        FIELD_CATEGORY_SET,
        `${path}.category`,
        'a supported field category',
      ),
      fieldId: parseStableId(ownValue(input, 'fieldId', path), `${path}.fieldId`),
      rounds: parseNullableInteger(
        ownValue(input, 'rounds', path),
        `${path}.rounds`,
        1,
        MOVE_EFFECT_OPERATION_LIMITS.durationCount,
      ),
    }
  }
  if (action === 'remove') {
    assertExactKeys(input, REMOVE_FIELD_FIELDS, path)
    return {
      action,
      category: parseEnum<MoveEffectFieldCategory>(
        ownValue(input, 'category', path),
        FIELD_CATEGORY_SET,
        `${path}.category`,
        'a supported field category',
      ),
      fieldId: parseStableId(ownValue(input, 'fieldId', path), `${path}.fieldId`),
    }
  }
  return fail('invalid-effect-operation', `${path}.action`, 'must be apply or remove.')
}

const parseHazardPayload = (value: unknown, path: string): MoveHazardEffectPayload => {
  const input = parseRecord(value, path)
  const action = ownValue(input, 'action', path)
  if (action === 'add') {
    assertExactKeys(input, ADD_HAZARD_FIELDS, path)
    return {
      action,
      hazardId: parseStableId(ownValue(input, 'hazardId', path), `${path}.hazardId`),
      hazardKind: parseStableId(ownValue(input, 'hazardKind', path), `${path}.hazardKind`),
      cellSetId: parseStableId(ownValue(input, 'cellSetId', path), `${path}.cellSetId`),
      layers: parseInteger(
        ownValue(input, 'layers', path),
        `${path}.layers`,
        1,
        MOVE_EFFECT_OPERATION_LIMITS.hazardLayers,
      ),
    }
  }
  if (action === 'remove') {
    assertExactKeys(input, REMOVE_HAZARD_FIELDS, path)
    return {
      action,
      hazardId: parseStableId(ownValue(input, 'hazardId', path), `${path}.hazardId`),
    }
  }
  return fail('invalid-effect-operation', `${path}.action`, 'must be add or remove.')
}

const parseMovementRequestPayload = (
  value: unknown,
  path: string,
): MoveMovementRequestEffectPayload => {
  const input = parseExactRecord(value, MOVEMENT_REQUEST_FIELDS, path)
  return {
    requestId: parseStableId(ownValue(input, 'requestId', path), `${path}.requestId`),
    mode: parseEnum<MoveEffectMovementMode>(
      ownValue(input, 'mode', path),
      MOVEMENT_MODE_SET,
      `${path}.mode`,
      'a supported movement mode',
    ),
    distance: parseNullableInteger(
      ownValue(input, 'distance', path),
      `${path}.distance`,
      0,
      MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
    ),
    destinationSetId: parseNullableStableId(
      ownValue(input, 'destinationSetId', path),
      `${path}.destinationSetId`,
    ),
  }
}

const parseUsagePayload = (value: unknown, path: string): MoveUsageEffectPayload => {
  const input = parseExactRecord(value, USAGE_FIELDS, path)
  return {
    action: parseEnum<MoveEffectUsageAction>(
      ownValue(input, 'action', path),
      USAGE_ACTION_SET,
      `${path}.action`,
      'spend, restore, or set',
    ),
    resourceId: parseStableId(ownValue(input, 'resourceId', path), `${path}.resourceId`),
    amount: parseInteger(
      ownValue(input, 'amount', path),
      `${path}.amount`,
      0,
      MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
    ),
  }
}

const parseHistoryPayload = (value: unknown, path: string): MoveHistoryEffectPayload => {
  const input = parseExactRecord(value, HISTORY_FIELDS, path)
  return {
    event: parseEnum<MoveEffectHistoryEvent>(
      ownValue(input, 'event', path),
      HISTORY_EVENT_SET,
      `${path}.event`,
      'a supported history event',
    ),
    detailCode: parseNullableStableId(
      ownValue(input, 'detailCode', path),
      `${path}.detailCode`,
    ),
  }
}

const parseLogArgumentValue = (value: unknown, path: string): MoveLogArgumentValue => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return parseFiniteNumber(value, path)
  if (typeof value === 'string') {
    return parseBoundedText(value, path, MOVE_EFFECT_OPERATION_LIMITS.textLength)
  }
  return fail('not-json', path, 'must be a bounded string, finite number, or boolean.')
}

const parseLogPayload = (value: unknown, path: string): MoveLogEffectPayload => {
  const input = parseExactRecord(value, LOG_FIELDS, path)
  const argumentsPath = `${path}.arguments`
  const args = parseBoundedArray(
    ownValue(input, 'arguments', path),
    argumentsPath,
    MOVE_EFFECT_OPERATION_LIMITS.logArguments,
  ).map((argument, index): MoveLogArgument => {
    const argumentPath = `${argumentsPath}[${index}]`
    const entry = parseExactRecord(argument, LOG_ARGUMENT_FIELDS, argumentPath)
    return {
      key: parseStableId(ownValue(entry, 'key', argumentPath), `${argumentPath}.key`),
      value: parseLogArgumentValue(
        ownValue(entry, 'value', argumentPath),
        `${argumentPath}.value`,
      ),
    }
  })
  assertUnique(args.map(argument => argument.key), `${argumentsPath}.key`)
  return {
    messageKey: parseStableId(ownValue(input, 'messageKey', path), `${path}.messageKey`),
    arguments: args,
  }
}

const parseRequestOptions = (
  value: unknown,
  path: string,
): readonly MoveEffectRequestOption[] => {
  const options = parseBoundedArray(
    value,
    path,
    MOVE_EFFECT_OPERATION_LIMITS.requestOptions,
  ).map((option, index): MoveEffectRequestOption => {
    const optionPath = `${path}[${index}]`
    const entry = parseExactRecord(option, REQUEST_OPTION_FIELDS, optionPath)
    return {
      id: parseStableId(ownValue(entry, 'id', optionPath), `${optionPath}.id`),
      labelKey: parseStableId(
        ownValue(entry, 'labelKey', optionPath),
        `${optionPath}.labelKey`,
      ),
    }
  })
  if (options.length === 0) {
    fail('invalid-effect-operation', path, 'must contain at least one option.')
  }
  assertUnique(options.map(option => option.id), `${path}.id`)
  return options
}

const parseChoiceRequestPayload = (
  value: unknown,
  path: string,
): MoveChoiceRequestEffectPayload => {
  const input = parseExactRecord(value, REQUEST_FIELDS, path)
  return {
    requestId: parseStableId(ownValue(input, 'requestId', path), `${path}.requestId`),
    promptKey: parseStableId(ownValue(input, 'promptKey', path), `${path}.promptKey`),
    options: parseRequestOptions(ownValue(input, 'options', path), `${path}.options`),
    allowPass: parseBoolean(ownValue(input, 'allowPass', path), `${path}.allowPass`),
  }
}

const parseReactionRequestPayload = (
  value: unknown,
  path: string,
): MoveReactionRequestEffectPayload => {
  const input = parseExactRecord(value, REACTION_REQUEST_FIELDS, path)
  return {
    requestId: parseStableId(ownValue(input, 'requestId', path), `${path}.requestId`),
    promptKey: parseStableId(ownValue(input, 'promptKey', path), `${path}.promptKey`),
    options: parseRequestOptions(ownValue(input, 'options', path), `${path}.options`),
    allowPass: parseBoolean(ownValue(input, 'allowPass', path), `${path}.allowPass`),
    priority: parseInteger(
      ownValue(input, 'priority', path),
      `${path}.priority`,
      -MOVE_EFFECT_OPERATION_LIMITS.reactionPriorityMagnitude,
      MOVE_EFFECT_OPERATION_LIMITS.reactionPriorityMagnitude,
    ),
  }
}

type ParsedOperationCommon = Pick<
  MoveEffectOperation,
  'id' | 'source' | 'recipients' | 'phase' | 'reasonCode'
>

const parseCommon = (input: UnknownRecord, path: string): ParsedOperationCommon => ({
  id: parseStableId(ownValue(input, 'id', path), `${path}.id`),
  source: parseSource(ownValue(input, 'source', path), `${path}.source`),
  recipients: parseRecipients(ownValue(input, 'recipients', path), `${path}.recipients`),
  phase: parseEnum<MoveSpecPhase>(
    ownValue(input, 'phase', path),
    PHASE_SET,
    `${path}.phase`,
    'a supported MoveSpec phase',
  ),
  reasonCode: parseStableId(ownValue(input, 'reasonCode', path), `${path}.reasonCode`),
})

const parseDetachedOperation = (value: unknown, path: string): MoveEffectOperation => {
  const input = parseExactRecord(value, OPERATION_FIELDS, path)
  const rawKind = ownValue(input, 'kind', path)
  if (typeof rawKind !== 'string' || !OPERATION_KIND_SET.has(rawKind)) {
    fail(
      'unknown-operation-kind',
      `${path}.kind`,
      'must be a supported effect-operation kind.',
    )
  }
  const kind = rawKind as MoveEffectOperationKind
  const common = parseCommon(input, path)
  const payload = ownValue(input, 'payload', path)
  const payloadPath = `${path}.payload`

  switch (kind) {
    case 'roll':
      return { ...common, kind, payload: parseRollPayload(payload, payloadPath) }
    case 'damage':
      return { ...common, kind, payload: parseDamagePayload(payload, payloadPath) }
    case 'multi-hit':
      return { ...common, kind, payload: parseMultiHitPayload(payload, payloadPath) }
    case 'direct-hp':
      return { ...common, kind, payload: parseDirectHpPayload(payload, payloadPath) }
    case 'heal':
      return { ...common, kind, payload: parseHealPayload(payload, payloadPath) }
    case 'condition':
      return { ...common, kind, payload: parseConditionPayload(payload, payloadPath) }
    case 'combat-stage':
      return { ...common, kind, payload: parseCombatStagePayload(payload, payloadPath) }
    case 'temporary-effect':
      return { ...common, kind, payload: parseTemporaryEffectPayload(payload, payloadPath) }
    case 'field':
      return { ...common, kind, payload: parseFieldPayload(payload, payloadPath) }
    case 'hazard':
      return { ...common, kind, payload: parseHazardPayload(payload, payloadPath) }
    case 'movement-request':
      return { ...common, kind, payload: parseMovementRequestPayload(payload, payloadPath) }
    case 'usage':
      return { ...common, kind, payload: parseUsagePayload(payload, payloadPath) }
    case 'history':
      return { ...common, kind, payload: parseHistoryPayload(payload, payloadPath) }
    case 'log':
      return { ...common, kind, payload: parseLogPayload(payload, payloadPath) }
    case 'choice-request':
      return { ...common, kind, payload: parseChoiceRequestPayload(payload, payloadPath) }
    case 'reaction-request':
      return { ...common, kind, payload: parseReactionRequestPayload(payload, payloadPath) }
  }
}

/** Parse, detach, and deeply freeze one bounded effect operation. */
export const parseMoveEffectOperation = (
  value: unknown,
  path = 'operation',
): MoveEffectOperation => deepFreeze(parseDetachedOperation(value, path))

/** Parse a bounded operation list and enforce spec-wide operation identity. */
export const parseMoveEffectOperations = (
  value: unknown,
  path = 'operations',
): readonly MoveEffectOperation[] => {
  const operations = parseBoundedArray(
    value,
    path,
    MOVE_EFFECT_OPERATION_LIMITS.operations,
  ).map((operation, index) => parseDetachedOperation(operation, `${path}[${index}]`))
  assertUnique(operations.map(operation => operation.id), `${path}.id`)
  return deepFreeze(operations)
}
