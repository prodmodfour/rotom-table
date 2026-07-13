import {
  ENCOUNTER_EFFECT_DURATION_KINDS,
  ENCOUNTER_EFFECT_LIMITS,
  EncounterEffectValidationError,
  parseEncounterEffectDefinition,
  parseEncounterEffectDuration,
  parseEncounterEffectStackPolicy,
  type EncounterEffectDefinition,
  type EncounterEffectDuration,
  type EncounterEffectStackPolicy,
} from './encounterEffects'
import {
  MOVE_EXPRESSION_STATS,
  MOVE_STAGE_AFFECTED_EXPRESSION_STATS,
  MOVE_STAT_COMBAT_STAGE_POLICIES,
  MOVE_STAT_STAGE_MODIFIER_POLICIES,
  MoveExpressionValidationError,
  parseMoveExpression,
  parseMoveStatSelectionExpression,
  type MoveExpression,
  type MoveExpressionStat,
  type MoveStatCombatStagePolicy,
  type MoveStatSelectionExpression,
  type MoveStatStageModifierPolicy,
} from './expressions'
import {
  TRAINER_SKILLS,
  type TrainerSkillKey,
} from '~/types/trainerSheet'
import {
  MovePredicateValidationError,
  parseMovePredicate,
  type MovePredicate,
} from './predicates'
import {
  MoveSelectorValidationError,
  parseMoveSelector,
  type MoveSelector,
} from './selectors'
import {
  MOVE_REACTION_LIMITS,
  isMoveReactionTiming,
  moveReactionTimingDefinition,
  type MoveReactionTiming,
} from './reactions'
import {
  MOVE_SPEC_PHASES,
  type MoveSpecPhase,
} from './spec'
import {
  MOVE_AUTOMATION_AREA_DIRECTIONS,
  type MoveAutomationAreaDirection,
} from '~/types/moveAutomation'

/**
 * The closed set of state requests a reviewed MoveSpec or registered handler
 * may emit. Reducers own mutation semantics; operations never contain patches.
 */
export const MOVE_EFFECT_OPERATION_KINDS = [
  'roll',
  'check',
  'branch',
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
  'switch-request',
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
  'actor-and-attacked-targets',
  'cardinally-adjacent-to-hit-targets',
] as const

/** Recipient sets that can be narrowed independently for each branch subject. */
export const MOVE_EFFECT_RECIPIENT_SCOPED_BRANCH_SELECTOR_KINDS = [
  'selected-targets',
  'attacked-targets',
  'hit-targets',
  'missed-targets',
  'damaged-targets',
  'fainted-targets',
  'area-targets',
] as const satisfies readonly MoveEffectRecipientSelectorKind[]

export const MOVE_EFFECT_ROLL_FORMULA_KINDS = [
  'dice',
  'uniform-integer',
  'table',
] as const
export const MOVE_EFFECT_CHECK_KINDS = ['opposed', 'save'] as const
export const MOVE_EFFECT_CHECK_ROLL_SOURCE_KINDS = [
  'fixed',
  'skill',
  'stat',
  'choice',
] as const
export const MOVE_EFFECT_CHECK_SKILLS = TRAINER_SKILLS
export const MOVE_EFFECT_CHECK_REROLL_KEEP_POLICIES = [
  'latest',
  'highest',
  'lowest',
] as const
export const MOVE_EFFECT_CHECK_TIE_KINDS = ['success', 'failure', 'reroll'] as const
export const MOVE_EFFECT_CHECK_OUTCOMES = ['success', 'failure'] as const
export const MOVE_EFFECT_CHECK_RESOURCE_TRIGGERS = ['always', 'on-failure'] as const
export const MOVE_EFFECT_BRANCH_KINDS = [
  'predicate',
  'relationship',
  'check',
  'choice',
] as const
export const MOVE_EFFECT_BRANCH_SCOPES = ['resolution', 'recipient'] as const

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
export const MOVE_EFFECT_DIRECT_HP_MODES = ['lose', 'set', 'copy', 'split', 'swap'] as const
export const MOVE_EFFECT_HEAL_MODES = ['gain', 'full'] as const
export const MOVE_EFFECT_HP_CALCULATION_KINDS = [
  'fixed',
  'percent-max',
  'percent-current',
  'percent-missing',
  'formula',
  'damage-dealt',
  'hp-lost',
] as const
export const MOVE_EFFECT_HP_DAMAGE_AGGREGATIONS = ['per-target', 'aggregate'] as const
/** Prevented or zero effective damage contributes zero to drain/recoil calculations. */
export const MOVE_EFFECT_HP_PREVENTED_DAMAGE_POLICIES = ['zero'] as const
export const MOVE_EFFECT_HP_COST_KINDS = ['cost', 'sacrifice'] as const
export const MOVE_EFFECT_HP_COST_TIMINGS = [
  'declaration',
  'hit',
  'damage',
  'completion',
] as const
export const MOVE_EFFECT_HP_MARKER_INJURY_POLICIES = [
  'apply-after-operation',
  'ignore',
] as const
/** Direct HP operations never qualify as damage for PTU Massive Damage Injuries. */
export const MOVE_EFFECT_HP_MASSIVE_DAMAGE_POLICIES = ['never'] as const
export const MOVE_EFFECT_ROUNDING_POLICIES = ['floor', 'round', 'ceil'] as const
export const MOVE_EFFECT_CONDITION_ACTIONS = [
  'apply',
  'remove',
  'clear',
  'transfer',
  'replace',
  'random-choice',
] as const
export const MOVE_EFFECT_CONDITION_GROUPS = [
  'major',
  'minor',
  'persistent',
  'volatile',
  'other',
  'status',
  'all',
] as const
export const MOVE_EFFECT_CONDITION_SAVE_TIMINGS = [
  'canonical',
  'none',
  'start-turn',
  'end-turn',
] as const
export const MOVE_EFFECT_COMBAT_STAGE_ACTIONS = [
  'modify',
  'set',
  'reset',
  'invert',
  'clear-positive',
  'clear-negative',
  'copy',
  'swap',
  'split',
  'transfer',
] as const
export const MOVE_EFFECT_COMBAT_STAT_STAGES = [
  'atk',
  'def',
  'satk',
  'sdef',
  'spd',
] as const
export const MOVE_EFFECT_COMBAT_STAGES = [
  ...MOVE_EFFECT_COMBAT_STAT_STAGES,
  'acc',
  /** The five PTU Stats with Combat Stages; Accuracy is deliberately excluded. */
  'all-stats',
  /** Every Combat Stage, including Accuracy. */
  'all',
  /** One concrete server-selected Stat recorded in `selectedStage`. */
  'selected-stat',
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
export const MOVE_EFFECT_MOVEMENT_CHOICE_KINDS = [
  'destination',
  'direction',
] as const
export const MOVE_EFFECT_MOVEMENT_VECTOR_KINDS = [
  'away',
  'toward',
  'chosen',
  'cardinal',
] as const
export const MOVE_EFFECT_MOVEMENT_CARDINAL_DIRECTIONS = [
  'north',
  'east',
  'south',
  'west',
  'up',
  'down',
] as const satisfies readonly MoveAutomationAreaDirection[]
export const MOVE_EFFECT_MOVEMENT_OPPORTUNITY_ATTACK_POLICIES = [
  'provoke',
  'ignore',
] as const
export const MOVE_EFFECT_MOVEMENT_DISPLACEMENT_DISTANCE_POLICIES = [
  'up-to-distance',
  'full-distance-required',
] as const
export const MOVE_EFFECT_SWITCH_POSITION_POLICIES = ['recalled-position'] as const
export const MOVE_EFFECT_SWITCH_INITIATIVE_POLICIES = ['inherit-slot'] as const
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
  movementChoiceDistance: 1_000,
  movementDisplacementDistance: 1_000,
  durationCount: 10_000,
  effectStacks: ENCOUNTER_EFFECT_LIMITS.stacks,
  hazardLayers: 64,
  typeOverrides: 18,
  criticalNaturalRolls: 20,
  multiHitStrikes: 10,
  multiHitTableEntries: 32,
  multiHitEffects: 16,
  conditionFilterIds: 32,
  conditionRandomChoices: 16,
  checkModifiers: 16,
  checkSourceOptions: 16,
  checkRerolls: 3,
  branchOperationReferences: 128,
  reactionPriorityMagnitude: MOVE_REACTION_LIMITS.priorityMagnitude,
})

export type MoveEffectOperationKind = (typeof MOVE_EFFECT_OPERATION_KINDS)[number]
export type MoveEffectSourceKind = (typeof MOVE_EFFECT_SOURCE_KINDS)[number]
export type MoveEffectRecipientSelectorKind =
  (typeof MOVE_EFFECT_RECIPIENT_SELECTOR_KINDS)[number]
export type MoveEffectRollFormulaKind = (typeof MOVE_EFFECT_ROLL_FORMULA_KINDS)[number]
export type MoveEffectCheckKind = (typeof MOVE_EFFECT_CHECK_KINDS)[number]
export type MoveEffectCheckRollSourceKind =
  (typeof MOVE_EFFECT_CHECK_ROLL_SOURCE_KINDS)[number]
export type MoveEffectCheckSkill = TrainerSkillKey
export type MoveEffectCheckRerollKeepPolicy =
  (typeof MOVE_EFFECT_CHECK_REROLL_KEEP_POLICIES)[number]
export type MoveEffectCheckTieKind = (typeof MOVE_EFFECT_CHECK_TIE_KINDS)[number]
export type MoveEffectCheckOutcome = (typeof MOVE_EFFECT_CHECK_OUTCOMES)[number]
export type MoveEffectCheckResourceTrigger =
  (typeof MOVE_EFFECT_CHECK_RESOURCE_TRIGGERS)[number]
export type MoveEffectBranchKind = (typeof MOVE_EFFECT_BRANCH_KINDS)[number]
export type MoveEffectBranchScope = (typeof MOVE_EFFECT_BRANCH_SCOPES)[number]
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
export type MoveEffectHpCalculationKind =
  (typeof MOVE_EFFECT_HP_CALCULATION_KINDS)[number]
export type MoveEffectHpDamageAggregation =
  (typeof MOVE_EFFECT_HP_DAMAGE_AGGREGATIONS)[number]
export type MoveEffectHpPreventedDamagePolicy =
  (typeof MOVE_EFFECT_HP_PREVENTED_DAMAGE_POLICIES)[number]
export type MoveEffectHpCostKind = (typeof MOVE_EFFECT_HP_COST_KINDS)[number]
export type MoveEffectHpCostTiming = (typeof MOVE_EFFECT_HP_COST_TIMINGS)[number]
export type MoveEffectHpMarkerInjuryPolicy =
  (typeof MOVE_EFFECT_HP_MARKER_INJURY_POLICIES)[number]
export type MoveEffectHpMassiveDamagePolicy =
  (typeof MOVE_EFFECT_HP_MASSIVE_DAMAGE_POLICIES)[number]
export type MoveEffectRoundingPolicy = (typeof MOVE_EFFECT_ROUNDING_POLICIES)[number]
export type MoveEffectConditionAction = (typeof MOVE_EFFECT_CONDITION_ACTIONS)[number]
export type MoveEffectConditionGroup = (typeof MOVE_EFFECT_CONDITION_GROUPS)[number]
export type MoveEffectConditionSaveTiming =
  (typeof MOVE_EFFECT_CONDITION_SAVE_TIMINGS)[number]
export type MoveEffectCombatStageAction = (typeof MOVE_EFFECT_COMBAT_STAGE_ACTIONS)[number]
export type MoveEffectCombatStatStage = (typeof MOVE_EFFECT_COMBAT_STAT_STAGES)[number]
export type MoveEffectCombatStage = (typeof MOVE_EFFECT_COMBAT_STAGES)[number]
/** @deprecated Temporary-effect definitions use EncounterEffectDuration. */
export type MoveEffectDurationKind = (typeof MOVE_EFFECT_DURATION_KINDS)[number]
export type MoveEffectFieldCategory = (typeof MOVE_EFFECT_FIELD_CATEGORIES)[number]
export type MoveEffectMovementMode = (typeof MOVE_EFFECT_MOVEMENT_MODES)[number]
export type MoveEffectMovementChoiceKind =
  (typeof MOVE_EFFECT_MOVEMENT_CHOICE_KINDS)[number]
export type MoveEffectMovementVectorKind =
  (typeof MOVE_EFFECT_MOVEMENT_VECTOR_KINDS)[number]
export type MoveEffectMovementCardinalDirection =
  (typeof MOVE_EFFECT_MOVEMENT_CARDINAL_DIRECTIONS)[number]
export type MoveEffectMovementOpportunityAttackPolicy =
  (typeof MOVE_EFFECT_MOVEMENT_OPPORTUNITY_ATTACK_POLICIES)[number]
export type MoveEffectMovementDisplacementDistancePolicy =
  (typeof MOVE_EFFECT_MOVEMENT_DISPLACEMENT_DISTANCE_POLICIES)[number]
export type MoveEffectSwitchPositionPolicy =
  (typeof MOVE_EFFECT_SWITCH_POSITION_POLICIES)[number]
export type MoveEffectSwitchInitiativePolicy =
  (typeof MOVE_EFFECT_SWITCH_INITIATIVE_POLICIES)[number]
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

export type MoveCheckRollFormula = Exclude<
  MoveEffectRollFormula,
  MoveEffectTableRollFormula
>

export interface MoveCheckFixedRollSource {
  readonly kind: 'fixed'
  readonly formula: MoveCheckRollFormula
}

/** Resolve the participant's complete authoritative skill dice pool. */
export interface MoveCheckSkillRollSource {
  readonly kind: 'skill'
  readonly skill: MoveEffectCheckSkill
}

/** Roll the reviewed formula and add one authoritative participant stat. */
export interface MoveCheckStatRollSource {
  readonly kind: 'stat'
  readonly stat: MoveExpressionStat
  readonly combatStagePolicy: MoveStatCombatStagePolicy
  readonly stageModifierPolicy: MoveStatStageModifierPolicy
  readonly formula: MoveCheckRollFormula
}

export type MoveCheckResolvedRollSource =
  | MoveCheckFixedRollSource
  | MoveCheckSkillRollSource
  | MoveCheckStatRollSource

export interface MoveCheckRollSourceOption {
  readonly id: string
  readonly labelKey: string
  /** Mechanics remain server-owned; pending results expose only ID and labelKey. */
  readonly source: MoveCheckResolvedRollSource
}

export interface MoveCheckChoiceRollSource {
  readonly kind: 'choice'
  readonly requestId: string
  readonly promptKey: string
  readonly options: readonly MoveCheckRollSourceOption[]
}

export type MoveCheckRollSource =
  | MoveCheckResolvedRollSource
  | MoveCheckChoiceRollSource

export interface MoveCheckRollModifier {
  readonly sourceId: string
  readonly reasonCode: string
  readonly value: MoveExpression
}

export interface MoveCheckRerollPolicy {
  /** Number of automatic additional attempts after the first roll. */
  readonly count: number
  readonly keep: MoveEffectCheckRerollKeepPolicy
}

export interface MoveCheckResourceRerollRequest {
  readonly requestId: string
  readonly promptKey: string
  readonly resourceId: string
  readonly amount: number
  readonly trigger: MoveEffectCheckResourceTrigger
  readonly spendOption: MoveEffectRequestOption
  readonly declineOption: MoveEffectRequestOption
}

export interface MoveCheckRollDefinition {
  readonly rollId: string
  readonly source: MoveCheckRollSource
  readonly modifiers: readonly MoveCheckRollModifier[]
  readonly reroll: MoveCheckRerollPolicy
  /** A human decision suspends after the initial result; no resource is spent here. */
  readonly resourceReroll: MoveCheckResourceRerollRequest | null
}

export type MoveCheckTiePolicy =
  | {
      readonly kind: 'success' | 'failure'
    }
  | {
      readonly kind: 'reroll'
      readonly maximumRerolls: number
      readonly exhaustedOutcome: MoveEffectCheckOutcome
    }

export interface MoveCheckBranches {
  readonly success: string
  readonly failure: string
}

export interface MoveOpposedCheckEffectPayload {
  readonly kind: 'opposed'
  readonly checkId: string
  readonly actorRoll: MoveCheckRollDefinition
  readonly targetRoll: MoveCheckRollDefinition
  readonly tie: MoveCheckTiePolicy
  readonly branches: MoveCheckBranches
}

export interface MoveSavingThrowEffectPayload {
  readonly kind: 'save'
  readonly checkId: string
  readonly roll: MoveCheckRollDefinition
  readonly dc: MoveExpression
  readonly tie: MoveCheckTiePolicy
  readonly branches: MoveCheckBranches
}

export type MoveCheckEffectPayload =
  | MoveOpposedCheckEffectPayload
  | MoveSavingThrowEffectPayload

export interface MoveEffectBranchPath {
  /** Stable audit identity for the selected reviewed path. */
  readonly id: string
  /** Later top-level operation IDs enabled by this path. */
  readonly operationIds: readonly string[]
}

export interface MovePredicateBranchEffectPayload {
  readonly kind: 'predicate'
  readonly selectionId: string
  readonly scope: MoveEffectBranchScope
  readonly predicate: MovePredicate
  readonly whenTrue: MoveEffectBranchPath
  readonly whenFalse: MoveEffectBranchPath
}

export interface MoveRelationshipBranchPaths {
  readonly self: MoveEffectBranchPath
  readonly ally: MoveEffectBranchPath
  readonly enemy: MoveEffectBranchPath
  /** Explicit fail-closed path for unknown or unaffiliated targets. */
  readonly unknown: MoveEffectBranchPath
}

export interface MoveRelationshipBranchEffectPayload {
  readonly kind: 'relationship'
  readonly selectionId: string
  readonly scope: 'recipient'
  readonly branches: MoveRelationshipBranchPaths
}

export interface MoveCheckResultBranchPaths {
  readonly success: MoveEffectBranchPath
  readonly failure: MoveEffectBranchPath
}

export interface MoveCheckResultBranchEffectPayload {
  readonly kind: 'check'
  readonly selectionId: string
  readonly scope: 'recipient'
  /** Earlier authoritative check operation payload identity. */
  readonly checkId: string
  readonly branches: MoveCheckResultBranchPaths
}

export interface MoveChoiceBranchOption extends MoveEffectBranchPath {
  readonly labelKey: string
}

export interface MoveChoiceBranchEffectPayload {
  readonly kind: 'choice'
  readonly selectionId: string
  readonly scope: MoveEffectBranchScope
  readonly requestId: string
  readonly promptKey: string
  readonly options: readonly MoveChoiceBranchOption[]
  /** A non-null empty path makes this an optional effect with an explicit pass. */
  readonly pass: MoveEffectBranchPath | null
}

export type MoveBranchEffectPayload =
  | MovePredicateBranchEffectPayload
  | MoveRelationshipBranchEffectPayload
  | MoveCheckResultBranchEffectPayload
  | MoveChoiceBranchEffectPayload

/** Return every reviewed path in deterministic payload order. */
export const moveEffectBranchPaths = (
  payload: MoveBranchEffectPayload,
): readonly MoveEffectBranchPath[] => {
  if (payload.kind === 'predicate') return [payload.whenTrue, payload.whenFalse]
  if (payload.kind === 'relationship') {
    return [
      payload.branches.self,
      payload.branches.ally,
      payload.branches.enemy,
      payload.branches.unknown,
    ]
  }
  if (payload.kind === 'check') {
    return [payload.branches.success, payload.branches.failure]
  }
  return payload.pass ? [...payload.options, payload.pass] : payload.options
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

export interface MoveHpFixedCalculation {
  readonly kind: 'fixed'
  readonly value: number
}

export interface MoveHpPercentCalculation {
  readonly kind: 'percent-max' | 'percent-current' | 'percent-missing'
  readonly percent: number
}

export interface MoveHpFormulaCalculation {
  readonly kind: 'formula'
  readonly expression: MoveExpression
}

/**
 * A drain/recoil magnitude derived from effective HP plus temporary HP actually
 * removed by one earlier authoritative damage operation.
 */
export interface MoveHpDamageDealtCalculation {
  readonly kind: 'damage-dealt'
  readonly damageOperationId: string
  readonly percent: number
  readonly aggregation: MoveEffectHpDamageAggregation
  readonly preventedDamage: MoveEffectHpPreventedDamagePolicy
}

/**
 * A magnitude derived from the selected pool actually removed by one earlier
 * authoritative direct-HP operation. Prevented, unchanged, or upward changes
 * contribute zero; client-reported loss is never accepted.
 */
export interface MoveHpLostCalculation {
  readonly kind: 'hp-lost'
  readonly hpOperationId: string
  readonly pool: MoveEffectHpPool
  readonly percent: number
  readonly aggregation: MoveEffectHpDamageAggregation
}

/** A bounded magnitude/value calculation evaluated once per authoritative recipient. */
export type MoveHpCalculation =
  | MoveHpFixedCalculation
  | MoveHpPercentCalculation
  | MoveHpFormulaCalculation
  | MoveHpDamageDealtCalculation
  | MoveHpLostCalculation

/** Inclusive bounds on the final selected HP pool; null leaves that edge unbounded. */
export interface MoveHpFinalBounds {
  readonly minimum: number | null
  readonly maximum: number | null
}

/**
 * PTU Injury behavior is authored rather than inferred from an operation label.
 * Direct HP reduction may cross HP markers after the operation is complete, but
 * is never Damage and therefore never creates a Massive Damage Injury.
 */
export interface MoveHpInjuryPolicy {
  readonly hitPointMarkers: MoveEffectHpMarkerInjuryPolicy
  readonly massiveDamage: MoveEffectHpMassiveDamagePolicy
}

/**
 * Explicit payment timing and affordability for direct HP costs. `damageOperationId`
 * is required only for damage-triggered payments; hit timing uses the authoritative
 * hit set. A null minimum permits the payment to knock out the actor.
 */
export interface MoveHpCostPolicy {
  readonly kind: MoveEffectHpCostKind
  readonly timing: MoveEffectHpCostTiming
  readonly minimumRemaining: number | null
  readonly damageOperationId: string | null
}

export interface MoveDirectHpEffectPayload {
  readonly mode: MoveEffectDirectHpMode
  readonly pool: MoveEffectHpPool
  /** Required for lose/set; null for copy/split/swap. */
  readonly calculation: MoveHpCalculation | null
  /** One authoritative scalar selector for copy; null for all other modes. */
  readonly copySource: MoveSelector | null
  readonly bounds: MoveHpFinalBounds
  readonly rounding: MoveEffectRoundingPolicy
  /** Earlier server-owned accuracy roll that narrows attacked targets to hit targets. */
  readonly accuracyRollId?: string | null
  readonly applyTypeImmunity: boolean
  /** Null for ordinary loss/recoil; non-null marks an authoritative HP payment. */
  readonly cost: MoveHpCostPolicy | null
  readonly injury: MoveHpInjuryPolicy
}

export interface MoveHealEffectPayload {
  readonly mode: MoveEffectHealMode
  readonly pool: MoveEffectHpPool
  /** Required for gain; null for full. */
  readonly calculation: MoveHpCalculation | null
  readonly bounds: MoveHpFinalBounds
  readonly rounding: MoveEffectRoundingPolicy
  /** Healing and temporary HP always ignore HP markers and Massive Damage. */
  readonly injury: MoveHpInjuryPolicy
}

export interface MoveConditionCleanseFilter {
  /** Groups and explicit IDs are inclusive alternatives; an empty inclusion set means all. */
  readonly groups: readonly MoveEffectConditionGroup[]
  readonly conditionIds: readonly string[]
  readonly excludedConditionIds: readonly string[]
}

export interface MoveConditionRandomChoice {
  /** Earlier server-owned roll whose final value is a one-based choice index. */
  readonly rollId: string
  readonly conditionIds: readonly string[]
}

export type MoveConditionNaturalRollTrigger =
  | MoveCriticalHitRangeTrigger
  | MoveCriticalHitNaturalRollsTrigger

/** A hit-only secondary condition gated by an earlier authoritative accuracy d20. */
export interface MoveConditionAccuracyRollTrigger {
  readonly rollId: string
  readonly trigger: MoveConditionNaturalRollTrigger
}

export interface MoveConditionDurationPolicy {
  /** Stable reviewed base identity; the reducer derives one instance per recipient. */
  readonly effectId: string
  readonly duration: EncounterEffectDuration
}

export interface MoveConditionEffectPayload {
  readonly action: MoveEffectConditionAction
  /** Applied/removed/transferred/replacement condition; null for clear/random-choice. */
  readonly conditionId: string | null
  /**
   * Bounded display identity retained by the two canonical detailed conditions.
   * Only Disabled and Infatuation applications accept this server-authored text.
   */
  readonly conditionDetail?: string | null
  /** Exactly one authoritative source for transfer; null for every other action. */
  readonly conditionSource: MoveSelector | null
  /** Required for replace, optional for filtered clear, null for other actions. */
  readonly filter: MoveConditionCleanseFilter | null
  /** Required only for random-choice. */
  readonly randomChoice: MoveConditionRandomChoice | null
  /** Optional reviewed natural-roll gate for an accuracy-triggered secondary effect. */
  readonly accuracyRollTrigger?: MoveConditionAccuracyRollTrigger
  /** Non-null stores an application as a source-linked encounter effect. */
  readonly duration: MoveConditionDurationPolicy | null
  readonly saveTiming: MoveEffectConditionSaveTiming
  readonly stackPolicy: EncounterEffectStackPolicy
}

export interface MoveCombatStageEffectPayload {
  readonly action: MoveEffectCombatStageAction
  readonly stage: MoveEffectCombatStage
  /** Concrete server-owned result when `stage` is `selected-stat`; otherwise null. */
  readonly selectedStage: MoveEffectCombatStatStage | null
  /** Modify is a cap-aware delta; set uses an absolute stage. Other actions require null. */
  readonly value: number | null
  /** One authoritative source for copy/transfer; other actions require null. */
  readonly stageSource: MoveSelector | null
  /** Required only when averaging stages with split. */
  readonly rounding: MoveEffectRoundingPolicy | null
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

export interface MoveDestinationMovementChoice {
  readonly kind: 'destination'
  readonly promptKey: string
  readonly allowPass: boolean
}

export interface MoveDirectionMovementChoice {
  readonly kind: 'direction'
  readonly promptKey: string
  readonly allowPass: boolean
  /** Reviewed directions; the server derives and validates each endpoint. */
  readonly directions: readonly MoveAutomationAreaDirection[]
}

export type MoveMovementChoice =
  | MoveDestinationMovementChoice
  | MoveDirectionMovementChoice

export interface MoveContextualMovementDistance {
  readonly kind: 'expression'
  readonly expression: MoveExpression
  /** Inclusive post-rounding bounds for the authoritative movement distance. */
  readonly minimum: number
  readonly maximum: number
  readonly rounding: MoveEffectRoundingPolicy
}

export type MoveMovementDistance = number | MoveContextualMovementDistance

export interface MoveRelativeMovementVector {
  readonly kind: 'away' | 'toward'
  /** Exactly one server-owned placement used as the footprint-relative origin. */
  readonly source: MoveSelector
}

export interface MoveChosenMovementVector {
  readonly kind: 'chosen'
  /** Stable server-owned direction option set resolved before spatial reduction. */
  readonly directionSetId: string
}

export interface MoveCardinalMovementVector {
  readonly kind: 'cardinal'
  readonly direction: MoveEffectMovementCardinalDirection
}

export type MoveMovementVector =
  | MoveRelativeMovementVector
  | MoveChosenMovementVector
  | MoveCardinalMovementVector

export interface MoveMovementDisplacement {
  readonly vector: MoveMovementVector
  /** A shortened legal prefix is accepted only for the up-to policy. */
  readonly distancePolicy: MoveEffectMovementDisplacementDistancePolicy
  /** Explicit policy; forced/voluntary identity never implicitly decides reaction timing. */
  readonly opportunityAttacks: MoveEffectMovementOpportunityAttackPolicy
}

export interface MoveMovementRequestEffectPayload {
  readonly requestId: string
  readonly mode: MoveEffectMovementMode
  readonly distance: MoveMovementDistance | null
  /** Null when the movement mode derives its destination without a choice set. */
  readonly destinationSetId: string | null
  /** Omitted for retained immediate movement such as reviewed Pass geometry. */
  readonly choice?: MoveMovementChoice
  /** Reviewed straight-line push, pull, or immediate shift semantics. */
  readonly displacement?: MoveMovementDisplacement
}

export interface MoveSwitchRequestEffectPayload {
  readonly requestId: string
  readonly replacementSetId: string
  readonly promptKey: string
  /** Mandatory switches cannot pass and fail closed when no legal replacement exists. */
  readonly required: boolean
  readonly positionPolicy: MoveEffectSwitchPositionPolicy
  readonly initiativePolicy: MoveEffectSwitchInitiativePolicy
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
  /** Reactions are optional; pass closes only this priority window. */
  readonly allowPass: true
  readonly timing: MoveReactionTiming
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
export type MoveCheckEffectOperation = MoveEffectOperationEnvelope<'check', MoveCheckEffectPayload>
export type MoveBranchEffectOperation = MoveEffectOperationEnvelope<'branch', MoveBranchEffectPayload>
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
export type MoveSwitchRequestEffectOperation = MoveEffectOperationEnvelope<'switch-request', MoveSwitchRequestEffectPayload>
export type MoveUsageEffectOperation = MoveEffectOperationEnvelope<'usage', MoveUsageEffectPayload>
export type MoveHistoryEffectOperation = MoveEffectOperationEnvelope<'history', MoveHistoryEffectPayload>
export type MoveLogEffectOperation = MoveEffectOperationEnvelope<'log', MoveLogEffectPayload>
export type MoveChoiceRequestEffectOperation = MoveEffectOperationEnvelope<'choice-request', MoveChoiceRequestEffectPayload>
export type MoveReactionRequestEffectOperation = MoveEffectOperationEnvelope<'reaction-request', MoveReactionRequestEffectPayload>

export type MoveEffectOperation =
  | MoveRollEffectOperation
  | MoveCheckEffectOperation
  | MoveBranchEffectOperation
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
  | MoveSwitchRequestEffectOperation
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
const OPPOSED_CHECK_FIELDS = [
  'kind',
  'checkId',
  'actorRoll',
  'targetRoll',
  'tie',
  'branches',
] as const
const SAVE_CHECK_FIELDS = ['kind', 'checkId', 'roll', 'dc', 'tie', 'branches'] as const
const CHECK_ROLL_FIELDS = ['rollId', 'source', 'modifiers', 'reroll', 'resourceReroll'] as const
const CHECK_FIXED_SOURCE_FIELDS = ['kind', 'formula'] as const
const CHECK_SKILL_SOURCE_FIELDS = ['kind', 'skill'] as const
const CHECK_STAT_SOURCE_FIELDS = [
  'kind',
  'stat',
  'combatStagePolicy',
  'stageModifierPolicy',
  'formula',
] as const
const CHECK_CHOICE_SOURCE_FIELDS = ['kind', 'requestId', 'promptKey', 'options'] as const
const CHECK_SOURCE_OPTION_FIELDS = ['id', 'labelKey', 'source'] as const
const CHECK_MODIFIER_FIELDS = ['sourceId', 'reasonCode', 'value'] as const
const CHECK_REROLL_FIELDS = ['count', 'keep'] as const
const CHECK_RESOURCE_REROLL_FIELDS = [
  'requestId',
  'promptKey',
  'resourceId',
  'amount',
  'trigger',
  'spendOption',
  'declineOption',
] as const
const CHECK_RESOLVED_TIE_FIELDS = ['kind'] as const
const CHECK_REROLL_TIE_FIELDS = [
  'kind',
  'maximumRerolls',
  'exhaustedOutcome',
] as const
const CHECK_BRANCH_FIELDS = ['success', 'failure'] as const
const PREDICATE_BRANCH_FIELDS = [
  'kind',
  'selectionId',
  'scope',
  'predicate',
  'whenTrue',
  'whenFalse',
] as const
const RELATIONSHIP_BRANCH_FIELDS = ['kind', 'selectionId', 'scope', 'branches'] as const
const CHECK_RESULT_BRANCH_FIELDS = [
  'kind',
  'selectionId',
  'scope',
  'checkId',
  'branches',
] as const
const CHOICE_BRANCH_FIELDS = [
  'kind',
  'selectionId',
  'scope',
  'requestId',
  'promptKey',
  'options',
  'pass',
] as const
const BRANCH_PATH_FIELDS = ['id', 'operationIds'] as const
const RELATIONSHIP_BRANCH_PATH_FIELDS = ['self', 'ally', 'enemy', 'unknown'] as const
const CHOICE_BRANCH_OPTION_FIELDS = ['id', 'labelKey', 'operationIds'] as const
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
const DIRECT_HP_REQUIRED_FIELDS = [
  'mode',
  'pool',
  'calculation',
  'copySource',
  'bounds',
  'rounding',
  'applyTypeImmunity',
  'cost',
  'injury',
] as const
const DIRECT_HP_OPTIONAL_FIELDS = ['accuracyRollId'] as const
const HEAL_FIELDS = [
  'mode',
  'pool',
  'calculation',
  'bounds',
  'rounding',
  'injury',
] as const
const HP_FIXED_CALCULATION_FIELDS = ['kind', 'value'] as const
const HP_PERCENT_CALCULATION_FIELDS = ['kind', 'percent'] as const
const HP_FORMULA_CALCULATION_FIELDS = ['kind', 'expression'] as const
const HP_DAMAGE_DEALT_CALCULATION_FIELDS = [
  'kind',
  'damageOperationId',
  'percent',
  'aggregation',
  'preventedDamage',
] as const
const HP_LOST_CALCULATION_FIELDS = [
  'kind',
  'hpOperationId',
  'pool',
  'percent',
  'aggregation',
] as const
const HP_BOUNDS_FIELDS = ['minimum', 'maximum'] as const
const HP_INJURY_FIELDS = ['hitPointMarkers', 'massiveDamage'] as const
const HP_COST_FIELDS = ['kind', 'timing', 'minimumRemaining', 'damageOperationId'] as const
const CONDITION_REQUIRED_FIELDS = ['action', 'conditionId'] as const
const CONDITION_OPTIONAL_FIELDS = [
  'conditionDetail',
  'conditionSource',
  'filter',
  'randomChoice',
  'accuracyRollTrigger',
  'duration',
  'saveTiming',
  'stackPolicy',
] as const
const CONDITION_FILTER_FIELDS = ['groups', 'conditionIds', 'excludedConditionIds'] as const
const CONDITION_RANDOM_CHOICE_FIELDS = ['rollId', 'conditionIds'] as const
const CONDITION_ACCURACY_ROLL_TRIGGER_FIELDS = ['rollId', 'trigger'] as const
const CONDITION_DURATION_FIELDS = ['effectId', 'duration'] as const
const CONDITION_STACK_POLICY_FIELDS = ['kind', 'maxStacks'] as const
const COMBAT_STAGE_REQUIRED_FIELDS = ['action', 'stage', 'value'] as const
const COMBAT_STAGE_OPTIONAL_FIELDS = ['selectedStage', 'stageSource', 'rounding'] as const
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
const MOVEMENT_CHOICE_REQUEST_FIELDS = [...MOVEMENT_REQUEST_FIELDS, 'choice'] as const
const MOVEMENT_DISPLACEMENT_REQUEST_FIELDS = [
  ...MOVEMENT_REQUEST_FIELDS,
  'displacement',
] as const
const DESTINATION_MOVEMENT_CHOICE_FIELDS = ['kind', 'promptKey', 'allowPass'] as const
const DIRECTION_MOVEMENT_CHOICE_FIELDS = [
  'kind',
  'promptKey',
  'allowPass',
  'directions',
] as const
const CONTEXTUAL_MOVEMENT_DISTANCE_FIELDS = [
  'kind',
  'expression',
  'minimum',
  'maximum',
  'rounding',
] as const
const RELATIVE_MOVEMENT_VECTOR_FIELDS = ['kind', 'source'] as const
const CHOSEN_MOVEMENT_VECTOR_FIELDS = ['kind', 'directionSetId'] as const
const CARDINAL_MOVEMENT_VECTOR_FIELDS = ['kind', 'direction'] as const
const MOVEMENT_DISPLACEMENT_FIELDS = [
  'vector',
  'distancePolicy',
  'opportunityAttacks',
] as const
const SWITCH_REQUEST_FIELDS = [
  'requestId',
  'replacementSetId',
  'promptKey',
  'required',
  'positionPolicy',
  'initiativePolicy',
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
  'timing',
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
const CHECK_KIND_SET = new Set<string>(MOVE_EFFECT_CHECK_KINDS)
const CHECK_ROLL_SOURCE_KIND_SET = new Set<string>(MOVE_EFFECT_CHECK_ROLL_SOURCE_KINDS)
const CHECK_SKILL_SET = new Set<string>(MOVE_EFFECT_CHECK_SKILLS)
const CHECK_REROLL_KEEP_POLICY_SET = new Set<string>(MOVE_EFFECT_CHECK_REROLL_KEEP_POLICIES)
const CHECK_TIE_KIND_SET = new Set<string>(MOVE_EFFECT_CHECK_TIE_KINDS)
const CHECK_OUTCOME_SET = new Set<string>(MOVE_EFFECT_CHECK_OUTCOMES)
const CHECK_RESOURCE_TRIGGER_SET = new Set<string>(MOVE_EFFECT_CHECK_RESOURCE_TRIGGERS)
const BRANCH_KIND_SET = new Set<string>(MOVE_EFFECT_BRANCH_KINDS)
const BRANCH_SCOPE_SET = new Set<string>(MOVE_EFFECT_BRANCH_SCOPES)
const EXPRESSION_STAT_SET = new Set<string>(MOVE_EXPRESSION_STATS)
const STAGE_AFFECTED_EXPRESSION_STAT_SET = new Set<string>(
  MOVE_STAGE_AFFECTED_EXPRESSION_STATS,
)
const STAT_COMBAT_STAGE_POLICY_SET = new Set<string>(MOVE_STAT_COMBAT_STAGE_POLICIES)
const STAT_STAGE_MODIFIER_POLICY_SET = new Set<string>(MOVE_STAT_STAGE_MODIFIER_POLICIES)
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
const HP_CALCULATION_KIND_SET = new Set<string>(MOVE_EFFECT_HP_CALCULATION_KINDS)
const HP_DAMAGE_AGGREGATION_SET = new Set<string>(MOVE_EFFECT_HP_DAMAGE_AGGREGATIONS)
const HP_PREVENTED_DAMAGE_POLICY_SET = new Set<string>(
  MOVE_EFFECT_HP_PREVENTED_DAMAGE_POLICIES,
)
const HP_COST_KIND_SET = new Set<string>(MOVE_EFFECT_HP_COST_KINDS)
const HP_COST_TIMING_SET = new Set<string>(MOVE_EFFECT_HP_COST_TIMINGS)
const HP_MARKER_INJURY_POLICY_SET = new Set<string>(MOVE_EFFECT_HP_MARKER_INJURY_POLICIES)
const HP_MASSIVE_DAMAGE_POLICY_SET = new Set<string>(MOVE_EFFECT_HP_MASSIVE_DAMAGE_POLICIES)
const ROUNDING_POLICY_SET = new Set<string>(MOVE_EFFECT_ROUNDING_POLICIES)
const CONDITION_ACTION_SET = new Set<string>(MOVE_EFFECT_CONDITION_ACTIONS)
const CONDITION_GROUP_SET = new Set<string>(MOVE_EFFECT_CONDITION_GROUPS)
const CONDITION_SAVE_TIMING_SET = new Set<string>(MOVE_EFFECT_CONDITION_SAVE_TIMINGS)
const COMBAT_STAGE_ACTION_SET = new Set<string>(MOVE_EFFECT_COMBAT_STAGE_ACTIONS)
const COMBAT_STAT_STAGE_SET = new Set<string>(MOVE_EFFECT_COMBAT_STAT_STAGES)
const COMBAT_STAGE_SET = new Set<string>(MOVE_EFFECT_COMBAT_STAGES)
const FIELD_CATEGORY_SET = new Set<string>(MOVE_EFFECT_FIELD_CATEGORIES)
const MOVEMENT_MODE_SET = new Set<string>(MOVE_EFFECT_MOVEMENT_MODES)
const MOVEMENT_CHOICE_KIND_SET = new Set<string>(MOVE_EFFECT_MOVEMENT_CHOICE_KINDS)
const MOVEMENT_VECTOR_KIND_SET = new Set<string>(MOVE_EFFECT_MOVEMENT_VECTOR_KINDS)
const MOVEMENT_DIRECTION_SET = new Set<string>(MOVE_AUTOMATION_AREA_DIRECTIONS)
const MOVEMENT_CARDINAL_DIRECTION_SET = new Set<string>(
  MOVE_EFFECT_MOVEMENT_CARDINAL_DIRECTIONS,
)
const MOVEMENT_OPPORTUNITY_ATTACK_POLICY_SET = new Set<string>(
  MOVE_EFFECT_MOVEMENT_OPPORTUNITY_ATTACK_POLICIES,
)
const MOVEMENT_DISPLACEMENT_DISTANCE_POLICY_SET = new Set<string>(
  MOVE_EFFECT_MOVEMENT_DISPLACEMENT_DISTANCE_POLICIES,
)
const SWITCH_POSITION_POLICY_SET = new Set<string>(MOVE_EFFECT_SWITCH_POSITION_POLICIES)
const SWITCH_INITIATIVE_POLICY_SET = new Set<string>(MOVE_EFFECT_SWITCH_INITIATIVE_POLICIES)
const USAGE_ACTION_SET = new Set<string>(MOVE_EFFECT_USAGE_ACTIONS)
const HISTORY_EVENT_SET = new Set<string>(MOVE_EFFECT_HISTORY_EVENTS)
const RECIPIENT_SCOPED_BRANCH_SELECTOR_SET = new Set<MoveEffectRecipientSelectorKind>(
  MOVE_EFFECT_RECIPIENT_SCOPED_BRANCH_SELECTOR_KINDS,
)

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

const parseEffectRuleNode = <Value>(
  parse: () => Value,
): Value => {
  try {
    return parse()
  }
  catch (error) {
    if (
      !(error instanceof MoveExpressionValidationError)
      && !(error instanceof MovePredicateValidationError)
    ) {
      throw error
    }
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

const parseEffectExpression = <Value>(parse: () => Value): Value => parseEffectRuleNode(parse)

const parseEffectPredicate = (value: unknown, path: string): MovePredicate =>
  parseEffectRuleNode(() => parseMovePredicate(value, path))

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

const parseHpCalculation = (
  value: unknown,
  path: string,
): MoveHpCalculation => {
  const input = parseRecord(value, path)
  const kind = parseEnum<MoveEffectHpCalculationKind>(
    ownValue(input, 'kind', path),
    HP_CALCULATION_KIND_SET,
    `${path}.kind`,
    'fixed, percent-max, percent-current, percent-missing, formula, damage-dealt, or hp-lost',
  )
  if (kind === 'fixed') {
    assertExactKeys(input, HP_FIXED_CALCULATION_FIELDS, path)
    return {
      kind,
      value: parseFiniteNumber(ownValue(input, 'value', path), `${path}.value`),
    }
  }
  if (kind === 'formula') {
    assertExactKeys(input, HP_FORMULA_CALCULATION_FIELDS, path)
    return {
      kind,
      expression: parseEffectExpression(
        () => parseMoveExpression(
          ownValue(input, 'expression', path),
          `${path}.expression`,
        ),
      ),
    }
  }
  if (kind === 'damage-dealt') {
    assertExactKeys(input, HP_DAMAGE_DEALT_CALCULATION_FIELDS, path)
    return {
      kind,
      damageOperationId: parseStableId(
        ownValue(input, 'damageOperationId', path),
        `${path}.damageOperationId`,
      ),
      percent: parseFiniteNumber(
        ownValue(input, 'percent', path),
        `${path}.percent`,
        0,
      ),
      aggregation: parseEnum<MoveEffectHpDamageAggregation>(
        ownValue(input, 'aggregation', path),
        HP_DAMAGE_AGGREGATION_SET,
        `${path}.aggregation`,
        'per-target or aggregate',
      ),
      preventedDamage: parseEnum<MoveEffectHpPreventedDamagePolicy>(
        ownValue(input, 'preventedDamage', path),
        HP_PREVENTED_DAMAGE_POLICY_SET,
        `${path}.preventedDamage`,
        'zero',
      ),
    }
  }
  if (kind === 'hp-lost') {
    assertExactKeys(input, HP_LOST_CALCULATION_FIELDS, path)
    return {
      kind,
      hpOperationId: parseStableId(
        ownValue(input, 'hpOperationId', path),
        `${path}.hpOperationId`,
      ),
      pool: parseEnum<MoveEffectHpPool>(
        ownValue(input, 'pool', path),
        HP_POOL_SET,
        `${path}.pool`,
        'a supported HP pool',
      ),
      percent: parseFiniteNumber(
        ownValue(input, 'percent', path),
        `${path}.percent`,
        0,
      ),
      aggregation: parseEnum<MoveEffectHpDamageAggregation>(
        ownValue(input, 'aggregation', path),
        HP_DAMAGE_AGGREGATION_SET,
        `${path}.aggregation`,
        'per-target or aggregate',
      ),
    }
  }
  assertExactKeys(input, HP_PERCENT_CALCULATION_FIELDS, path)
  return {
    kind,
    percent: parseFiniteNumber(
      ownValue(input, 'percent', path),
      `${path}.percent`,
      0,
    ),
  }
}

const parseNullableHpCalculation = (
  value: unknown,
  path: string,
): MoveHpCalculation | null => value === null ? null : parseHpCalculation(value, path)

const parseHpBounds = (value: unknown, path: string): MoveHpFinalBounds => {
  const input = parseExactRecord(value, HP_BOUNDS_FIELDS, path)
  const minimum = parseNullableInteger(
    ownValue(input, 'minimum', path),
    `${path}.minimum`,
    -MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
    MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
  )
  const maximum = parseNullableInteger(
    ownValue(input, 'maximum', path),
    `${path}.maximum`,
    -MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
    MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
  )
  if (minimum !== null && maximum !== null && minimum > maximum) {
    fail('invalid-effect-operation', path, 'minimum cannot exceed maximum.')
  }
  return { minimum, maximum }
}

const parseHpInjuryPolicy = (value: unknown, path: string): MoveHpInjuryPolicy => {
  const input = parseExactRecord(value, HP_INJURY_FIELDS, path)
  return {
    hitPointMarkers: parseEnum<MoveEffectHpMarkerInjuryPolicy>(
      ownValue(input, 'hitPointMarkers', path),
      HP_MARKER_INJURY_POLICY_SET,
      `${path}.hitPointMarkers`,
      'apply-after-operation or ignore',
    ),
    massiveDamage: parseEnum<MoveEffectHpMassiveDamagePolicy>(
      ownValue(input, 'massiveDamage', path),
      HP_MASSIVE_DAMAGE_POLICY_SET,
      `${path}.massiveDamage`,
      'never',
    ),
  }
}

const parseHpCostPolicy = (value: unknown, path: string): MoveHpCostPolicy => {
  const input = parseExactRecord(value, HP_COST_FIELDS, path)
  const kind = parseEnum<MoveEffectHpCostKind>(
    ownValue(input, 'kind', path),
    HP_COST_KIND_SET,
    `${path}.kind`,
    'cost or sacrifice',
  )
  const timing = parseEnum<MoveEffectHpCostTiming>(
    ownValue(input, 'timing', path),
    HP_COST_TIMING_SET,
    `${path}.timing`,
    'declaration, hit, damage, or completion',
  )
  const minimumRemaining = parseNullableInteger(
    ownValue(input, 'minimumRemaining', path),
    `${path}.minimumRemaining`,
    0,
    MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
  )
  const damageOperationId = parseNullableStableId(
    ownValue(input, 'damageOperationId', path),
    `${path}.damageOperationId`,
  )
  if ((timing === 'damage') !== (damageOperationId !== null)) {
    fail(
      'invalid-effect-operation',
      `${path}.damageOperationId`,
      'must identify an earlier damage operation only for damage timing.',
    )
  }
  if (kind === 'sacrifice' && minimumRemaining !== null) {
    fail(
      'invalid-effect-operation',
      `${path}.minimumRemaining`,
      'a sacrifice cannot require remaining HP.',
    )
  }
  return { kind, timing, minimumRemaining, damageOperationId }
}

const parseNullableHpCostPolicy = (
  value: unknown,
  path: string,
): MoveHpCostPolicy | null => value === null ? null : parseHpCostPolicy(value, path)

const parseEffectSelector = (value: unknown, path: string): MoveSelector => {
  try {
    return parseMoveSelector(value, path)
  }
  catch (error) {
    if (!(error instanceof MoveSelectorValidationError)) throw error
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

const parseDirectHpPayload = (value: unknown, path: string): MoveDirectHpEffectPayload => {
  const input = parseRecordWithOptionalFields(
    value,
    DIRECT_HP_REQUIRED_FIELDS,
    DIRECT_HP_OPTIONAL_FIELDS,
    path,
  )
  const mode = parseEnum<MoveEffectDirectHpMode>(
    ownValue(input, 'mode', path),
    DIRECT_HP_MODE_SET,
    `${path}.mode`,
    'lose, set, copy, split, or swap',
  )
  const pool = parseEnum<MoveEffectHpPool>(
    ownValue(input, 'pool', path),
    HP_POOL_SET,
    `${path}.pool`,
    'a supported HP pool',
  )
  const calculation = parseNullableHpCalculation(
    ownValue(input, 'calculation', path),
    `${path}.calculation`,
  )
  const copySource = ownValue(input, 'copySource', path) === null
    ? null
    : parseEffectSelector(ownValue(input, 'copySource', path), `${path}.copySource`)
  const bounds = parseHpBounds(ownValue(input, 'bounds', path), `${path}.bounds`)
  const accuracyRollId = Object.prototype.hasOwnProperty.call(input, 'accuracyRollId')
    ? parseNullableStableId(ownValue(input, 'accuracyRollId', path), `${path}.accuracyRollId`)
    : null
  const applyTypeImmunity = parseBoolean(
    ownValue(input, 'applyTypeImmunity', path),
    `${path}.applyTypeImmunity`,
  )
  const cost = parseNullableHpCostPolicy(ownValue(input, 'cost', path), `${path}.cost`)
  const injury = parseHpInjuryPolicy(ownValue(input, 'injury', path), `${path}.injury`)

  if ((mode === 'lose' || mode === 'set') !== (calculation !== null)) {
    fail(
      'invalid-effect-operation',
      `${path}.calculation`,
      'must be present for lose/set and null for copy/split/swap.',
    )
  }
  if ((mode === 'copy') !== (copySource !== null)) {
    fail(
      'invalid-effect-operation',
      `${path}.copySource`,
      'must be a selector for copy and null for lose/set/split/swap.',
    )
  }
  if (
    mode === 'lose'
    && calculation?.kind === 'fixed'
    && calculation.value < 0
  ) {
    fail('invalid-effect-operation', `${path}.calculation.value`, 'loss cannot be negative.')
  }
  if (pool === 'temporary-hit-points' && injury.hitPointMarkers !== 'ignore') {
    fail(
      'invalid-effect-operation',
      `${path}.injury.hitPointMarkers`,
      'temporary HP cannot create Hit Point Marker Injuries.',
    )
  }
  if (calculation?.kind === 'damage-dealt' && (
    mode !== 'lose'
    || pool !== 'hit-points'
    || cost !== null
    || applyTypeImmunity
    || bounds.minimum !== null
    || bounds.maximum !== null
  )) {
    fail(
      'invalid-effect-operation',
      path,
      'damage-dealt direct HP must be non-immune actor recoil, not a cost.',
    )
  }
  if (calculation?.kind === 'hp-lost' && (
    mode !== 'lose'
    || pool !== 'hit-points'
    || cost !== null
    || bounds.minimum !== null
    || bounds.maximum !== null
  )) {
    fail(
      'invalid-effect-operation',
      path,
      'linked HP loss must be an unbounded real-HP loss, not a cost.',
    )
  }
  if (cost !== null) {
    if (
      pool !== 'hit-points'
      || accuracyRollId !== null
      || applyTypeImmunity
      || copySource !== null
      || bounds.minimum !== null
      || bounds.maximum !== null
    ) {
      fail(
        'invalid-effect-operation',
        path,
        'HP costs must affect real HP exactly, without immunity, copying, or final bounds.',
      )
    }
    if (cost.kind === 'cost' && (
      mode !== 'lose'
      || calculation === null
      || (calculation.kind !== 'fixed' && calculation.kind !== 'percent-max')
      || (calculation.kind === 'fixed' && calculation.value < 0)
    )) {
      fail(
        'invalid-effect-operation',
        `${path}.calculation`,
        'a cost requires a non-negative fixed or percent-max loss.',
      )
    }
    if (cost.kind === 'sacrifice' && !(
      mode === 'set'
      && calculation?.kind === 'fixed'
      && calculation.value === 0
    )) {
      fail(
        'invalid-effect-operation',
        `${path}.calculation`,
        'a sacrifice must set real HP to exactly zero.',
      )
    }
  }

  return {
    mode,
    pool,
    calculation,
    copySource,
    bounds,
    rounding: parseEnum<MoveEffectRoundingPolicy>(
      ownValue(input, 'rounding', path),
      ROUNDING_POLICY_SET,
      `${path}.rounding`,
      'floor, round, or ceil',
    ),
    accuracyRollId,
    applyTypeImmunity,
    cost,
    injury,
  }
}

const parseHealPayload = (value: unknown, path: string): MoveHealEffectPayload => {
  const input = parseExactRecord(value, HEAL_FIELDS, path)
  const mode = parseEnum<MoveEffectHealMode>(
    ownValue(input, 'mode', path),
    HEAL_MODE_SET,
    `${path}.mode`,
    'gain or full',
  )
  const pool = parseEnum<MoveEffectHpPool>(
    ownValue(input, 'pool', path),
    HP_POOL_SET,
    `${path}.pool`,
    'a supported HP pool',
  )
  const calculation = parseNullableHpCalculation(
    ownValue(input, 'calculation', path),
    `${path}.calculation`,
  )
  const bounds = parseHpBounds(ownValue(input, 'bounds', path), `${path}.bounds`)
  const injury = parseHpInjuryPolicy(ownValue(input, 'injury', path), `${path}.injury`)
  if ((mode === 'gain') !== (calculation !== null)) {
    fail(
      'invalid-effect-operation',
      `${path}.calculation`,
      'must be present for gain and null for full.',
    )
  }
  if (calculation?.kind === 'fixed' && calculation.value < 0) {
    fail('invalid-effect-operation', `${path}.calculation.value`, 'healing cannot be negative.')
  }
  if (mode === 'full' && pool !== 'hit-points') {
    fail('invalid-effect-operation', `${path}.pool`, 'full healing requires hit-points.')
  }
  if (mode === 'full' && (bounds.minimum !== null || bounds.maximum !== null)) {
    fail('invalid-effect-operation', `${path}.bounds`, 'full healing cannot override Max HP.')
  }
  if (calculation?.kind === 'damage-dealt' && (
    mode !== 'gain'
    || pool !== 'hit-points'
    || bounds.minimum !== null
    || bounds.maximum !== null
  )) {
    fail(
      'invalid-effect-operation',
      path,
      'damage-dealt healing must be an unbounded real-HP gain.',
    )
  }
  if (calculation?.kind === 'hp-lost' && (
    mode !== 'gain'
    || pool !== 'hit-points'
    || bounds.minimum !== null
    || bounds.maximum !== null
  )) {
    fail(
      'invalid-effect-operation',
      path,
      'linked HP-loss healing must be an unbounded real-HP gain.',
    )
  }
  if (injury.hitPointMarkers !== 'ignore') {
    fail(
      'invalid-effect-operation',
      `${path}.injury.hitPointMarkers`,
      'healing cannot create Hit Point Marker Injuries.',
    )
  }

  return {
    mode,
    pool,
    calculation,
    bounds,
    rounding: parseEnum<MoveEffectRoundingPolicy>(
      ownValue(input, 'rounding', path),
      ROUNDING_POLICY_SET,
      `${path}.rounding`,
      'floor, round, or ceil',
    ),
    injury,
  }
}

const parseConditionIdList = (
  value: unknown,
  path: string,
  maximum: number,
  minimum = 0,
): readonly string[] => {
  const ids = parseBoundedArray(value, path, maximum)
    .map((entry, index) => parseStableId(entry, `${path}[${index}]`))
  if (ids.length < minimum) {
    fail('invalid-effect-operation', path, `must contain at least ${minimum} entries.`)
  }
  assertUnique(ids, path)
  return ids
}

const parseConditionFilter = (
  value: unknown,
  path: string,
): MoveConditionCleanseFilter => {
  const input = parseExactRecord(value, CONDITION_FILTER_FIELDS, path)
  const groups = parseBoundedArray(
    ownValue(input, 'groups', path),
    `${path}.groups`,
    MOVE_EFFECT_CONDITION_GROUPS.length,
  ).map((entry, index) => parseEnum<MoveEffectConditionGroup>(
    entry,
    CONDITION_GROUP_SET,
    `${path}.groups[${index}]`,
    'major, minor, persistent, volatile, other, status, or all',
  ))
  assertUnique(groups, `${path}.groups`)
  if (groups.includes('all') && groups.length > 1) {
    fail('invalid-effect-operation', `${path}.groups`, 'all cannot be combined with another group.')
  }
  const conditionIds = parseConditionIdList(
    ownValue(input, 'conditionIds', path),
    `${path}.conditionIds`,
    MOVE_EFFECT_OPERATION_LIMITS.conditionFilterIds,
  )
  const excludedConditionIds = parseConditionIdList(
    ownValue(input, 'excludedConditionIds', path),
    `${path}.excludedConditionIds`,
    MOVE_EFFECT_OPERATION_LIMITS.conditionFilterIds,
  )
  const overlap = conditionIds.find(id => excludedConditionIds.includes(id))
  if (overlap) {
    fail(
      'invalid-effect-operation',
      `${path}.excludedConditionIds`,
      `cannot exclude explicitly included condition ${overlap}.`,
    )
  }
  return { groups, conditionIds, excludedConditionIds }
}

const parseConditionRandomChoice = (
  value: unknown,
  path: string,
): MoveConditionRandomChoice => {
  const input = parseExactRecord(value, CONDITION_RANDOM_CHOICE_FIELDS, path)
  return {
    rollId: parseStableId(ownValue(input, 'rollId', path), `${path}.rollId`),
    conditionIds: parseConditionIdList(
      ownValue(input, 'conditionIds', path),
      `${path}.conditionIds`,
      MOVE_EFFECT_OPERATION_LIMITS.conditionRandomChoices,
      2,
    ),
  }
}

const parseConditionAccuracyRollTrigger = (
  value: unknown,
  path: string,
): MoveConditionAccuracyRollTrigger => {
  const input = parseExactRecord(value, CONDITION_ACCURACY_ROLL_TRIGGER_FIELDS, path)
  const trigger = parseCriticalHitTrigger(
    ownValue(input, 'trigger', path),
    `${path}.trigger`,
  )
  if (trigger.kind !== 'range' && trigger.kind !== 'natural-rolls') {
    return fail(
      'invalid-effect-operation',
      `${path}.trigger.kind`,
      'must be range or natural-rolls for an accuracy-triggered condition.',
    )
  }
  return {
    rollId: parseStableId(ownValue(input, 'rollId', path), `${path}.rollId`),
    trigger,
  }
}

const rethrowEncounterPolicyError = (error: EncounterEffectValidationError): never => fail(
  error.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-effect-operation',
  error.path,
  error.detail,
)

const parseConditionDuration = (
  value: unknown,
  path: string,
): MoveConditionDurationPolicy => {
  const input = parseExactRecord(value, CONDITION_DURATION_FIELDS, path)
  try {
    return {
      effectId: parseStableId(ownValue(input, 'effectId', path), `${path}.effectId`),
      duration: parseEncounterEffectDuration(
        ownValue(input, 'duration', path),
        `${path}.duration`,
      ),
    }
  } catch (error) {
    if (error instanceof EncounterEffectValidationError) return rethrowEncounterPolicyError(error)
    throw error
  }
}

const parseConditionStackPolicy = (
  value: unknown,
  path: string,
): EncounterEffectStackPolicy => {
  const raw = value === undefined
    ? { kind: 'refresh', maxStacks: null }
    : parseExactRecord(value, CONDITION_STACK_POLICY_FIELDS, path)
  try {
    return parseEncounterEffectStackPolicy(raw, path, 1)
  } catch (error) {
    if (error instanceof EncounterEffectValidationError) return rethrowEncounterPolicyError(error)
    throw error
  }
}

const parseConditionPayload = (value: unknown, path: string): MoveConditionEffectPayload => {
  const input = parseRecordWithOptionalFields(
    value,
    CONDITION_REQUIRED_FIELDS,
    CONDITION_OPTIONAL_FIELDS,
    path,
  )
  const action = parseEnum<MoveEffectConditionAction>(
    ownValue(input, 'action', path),
    CONDITION_ACTION_SET,
    `${path}.action`,
    'a supported condition action',
  )
  const conditionId = parseNullableStableId(
    ownValue(input, 'conditionId', path),
    `${path}.conditionId`,
  )
  const hasConditionDetail = Object.prototype.hasOwnProperty.call(input, 'conditionDetail')
  const rawConditionDetail = hasConditionDetail
    ? ownValue(input, 'conditionDetail', path)
    : null
  const conditionDetail = rawConditionDetail === null
    ? null
    : parseBoundedText(
        rawConditionDetail,
        `${path}.conditionDetail`,
        MOVE_EFFECT_OPERATION_LIMITS.textLength,
      )
  const rawSource = Object.prototype.hasOwnProperty.call(input, 'conditionSource')
    ? ownValue(input, 'conditionSource', path)
    : null
  const conditionSource = rawSource === null
    ? null
    : parseEffectSelector(rawSource, `${path}.conditionSource`)
  const rawFilter = Object.prototype.hasOwnProperty.call(input, 'filter')
    ? ownValue(input, 'filter', path)
    : null
  const filter = rawFilter === null
    ? null
    : parseConditionFilter(rawFilter, `${path}.filter`)
  const rawRandomChoice = Object.prototype.hasOwnProperty.call(input, 'randomChoice')
    ? ownValue(input, 'randomChoice', path)
    : null
  const randomChoice = rawRandomChoice === null
    ? null
    : parseConditionRandomChoice(rawRandomChoice, `${path}.randomChoice`)
  const hasAccuracyRollTrigger = Object.prototype.hasOwnProperty.call(
    input,
    'accuracyRollTrigger',
  )
  const accuracyRollTrigger = hasAccuracyRollTrigger
    ? parseConditionAccuracyRollTrigger(
        ownValue(input, 'accuracyRollTrigger', path),
        `${path}.accuracyRollTrigger`,
      )
    : undefined
  const rawDuration = Object.prototype.hasOwnProperty.call(input, 'duration')
    ? ownValue(input, 'duration', path)
    : null
  const duration = rawDuration === null
    ? null
    : parseConditionDuration(rawDuration, `${path}.duration`)
  const saveTiming = Object.prototype.hasOwnProperty.call(input, 'saveTiming')
    ? parseEnum<MoveEffectConditionSaveTiming>(
        ownValue(input, 'saveTiming', path),
        CONDITION_SAVE_TIMING_SET,
        `${path}.saveTiming`,
        'canonical, none, start-turn, or end-turn',
      )
    : 'canonical'
  const stackPolicy = parseConditionStackPolicy(
    Object.prototype.hasOwnProperty.call(input, 'stackPolicy')
      ? ownValue(input, 'stackPolicy', path)
      : undefined,
    `${path}.stackPolicy`,
  )

  const conditionMustBeNull = action === 'clear' || action === 'random-choice'
  if (conditionMustBeNull !== (conditionId === null)) {
    fail(
      'invalid-effect-operation',
      `${path}.conditionId`,
      'must be null for clear/random-choice and a stable identifier for every other action.',
    )
  }
  if (
    conditionDetail !== null
    && (
      action !== 'apply'
      || (conditionId !== 'disabled' && conditionId !== 'infatuation')
    )
  ) {
    fail(
      'invalid-effect-operation',
      `${path}.conditionDetail`,
      'is supported only for Disabled or Infatuation apply operations.',
    )
  }
  if ((action === 'transfer') !== (conditionSource !== null)) {
    fail(
      'invalid-effect-operation',
      `${path}.conditionSource`,
      'must be an authoritative selector for transfer and null for every other action.',
    )
  }
  const filterAllowed = action === 'replace' || action === 'clear'
  if ((action === 'replace' && filter === null) || (!filterAllowed && filter !== null)) {
    fail(
      'invalid-effect-operation',
      `${path}.filter`,
      'is required for replace, optional for clear, and null for every other action.',
    )
  }
  if ((action === 'random-choice') !== (randomChoice !== null)) {
    fail(
      'invalid-effect-operation',
      `${path}.randomChoice`,
      'must be present only for random-choice.',
    )
  }
  if (accuracyRollTrigger && !['apply', 'replace', 'random-choice'].includes(action)) {
    fail(
      'invalid-effect-operation',
      `${path}.accuracyRollTrigger`,
      'is supported only when applying a condition.',
    )
  }
  if (duration !== null && !['apply', 'replace', 'random-choice'].includes(action)) {
    fail(
      'invalid-effect-operation',
      `${path}.duration`,
      'is supported only when applying a condition.',
    )
  }
  if (stackPolicy.kind === 'independent-instance' && duration === null) {
    fail(
      'invalid-effect-operation',
      `${path}.stackPolicy`,
      'independent condition instances require a source-linked duration.',
    )
  }
  if (saveTiming !== 'canonical' && duration === null) {
    fail(
      'invalid-effect-operation',
      `${path}.saveTiming`,
      'non-canonical save timing requires a source-linked duration.',
    )
  }
  if (
    ['remove', 'clear'].includes(action)
    && (stackPolicy.kind !== 'refresh' || saveTiming !== 'canonical')
  ) {
    fail(
      'invalid-effect-operation',
      path,
      'condition removal cannot declare application save or stack policies.',
    )
  }
  if (action === 'transfer' && (duration !== null || saveTiming !== 'canonical')) {
    fail(
      'invalid-effect-operation',
      path,
      'condition transfer preserves the source condition timing.',
    )
  }

  return {
    action,
    conditionId,
    ...(hasConditionDetail ? { conditionDetail } : {}),
    conditionSource,
    filter,
    randomChoice,
    ...(accuracyRollTrigger ? { accuracyRollTrigger } : {}),
    duration,
    saveTiming,
    stackPolicy,
  }
}

const parseCombatStagePayload = (
  value: unknown,
  path: string,
): MoveCombatStageEffectPayload => {
  const input = parseRecordWithOptionalFields(
    value,
    COMBAT_STAGE_REQUIRED_FIELDS,
    COMBAT_STAGE_OPTIONAL_FIELDS,
    path,
  )
  const action = parseEnum<MoveEffectCombatStageAction>(
    ownValue(input, 'action', path),
    COMBAT_STAGE_ACTION_SET,
    `${path}.action`,
    'a supported combat-stage action',
  )
  const stage = parseEnum<MoveEffectCombatStage>(
    ownValue(input, 'stage', path),
    COMBAT_STAGE_SET,
    `${path}.stage`,
    'a supported combat-stage selection',
  )
  const rawValue = ownValue(input, 'value', path)
  const stageValue = rawValue === null ? null : parseInteger(rawValue, `${path}.value`, -6, 6)
  const rawSelectedStage = Object.prototype.hasOwnProperty.call(input, 'selectedStage')
    ? ownValue(input, 'selectedStage', path)
    : null
  const selectedStage = rawSelectedStage === null
    ? null
    : parseEnum<MoveEffectCombatStatStage>(
        rawSelectedStage,
        COMBAT_STAT_STAGE_SET,
        `${path}.selectedStage`,
        'Attack, Defense, Special Attack, Special Defense, or Speed',
      )
  const rawStageSource = Object.prototype.hasOwnProperty.call(input, 'stageSource')
    ? ownValue(input, 'stageSource', path)
    : null
  const stageSource = rawStageSource === null
    ? null
    : parseEffectSelector(rawStageSource, `${path}.stageSource`)
  const rawRounding = Object.prototype.hasOwnProperty.call(input, 'rounding')
    ? ownValue(input, 'rounding', path)
    : null
  const rounding = rawRounding === null
    ? null
    : parseEnum<MoveEffectRoundingPolicy>(
        rawRounding,
        ROUNDING_POLICY_SET,
        `${path}.rounding`,
        'floor, round, or ceil',
      )

  if ((action === 'modify' || action === 'set') !== (stageValue !== null)) {
    fail(
      'invalid-effect-operation',
      `${path}.value`,
      'must be an integer from -6 through 6 for modify/set and null for every transform action.',
    )
  }
  if ((stage === 'selected-stat') !== (selectedStage !== null)) {
    fail(
      'invalid-effect-operation',
      `${path}.selectedStage`,
      'must name one concrete Stat only when stage is selected-stat.',
    )
  }
  if ((action === 'copy' || action === 'transfer') !== (stageSource !== null)) {
    fail(
      'invalid-effect-operation',
      `${path}.stageSource`,
      'must be an authoritative selector for copy/transfer and null for every other action.',
    )
  }
  if ((action === 'split') !== (rounding !== null)) {
    fail(
      'invalid-effect-operation',
      `${path}.rounding`,
      'must be present for split and null for every other action.',
    )
  }

  return { action, stage, selectedStage, value: stageValue, stageSource, rounding }
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
    if (kind === 'condition') {
      const conditionPayload = parseConditionPayload(payload, `${effectPath}.payload`)
      if (conditionPayload.accuracyRollTrigger) {
        fail(
          'invalid-effect-operation',
          `${effectPath}.payload.accuracyRollTrigger`,
          'multi-hit follow-ups use sequence-owned triggers and cannot reference a top-level accuracy roll.',
        )
      }
      return {
        ...common,
        kind,
        payload: conditionPayload,
      }
    }
    return {
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

const parseMovementChoice = (
  value: unknown,
  path: string,
): MoveMovementChoice => {
  const candidate = parseRecord(value, path)
  const kind = parseEnum<MoveEffectMovementChoiceKind>(
    ownValue(candidate, 'kind', path),
    MOVEMENT_CHOICE_KIND_SET,
    `${path}.kind`,
    'destination or direction',
  )
  const input = parseExactRecord(
    value,
    kind === 'direction'
      ? DIRECTION_MOVEMENT_CHOICE_FIELDS
      : DESTINATION_MOVEMENT_CHOICE_FIELDS,
    path,
  )
  const common = {
    promptKey: parseStableId(ownValue(input, 'promptKey', path), `${path}.promptKey`),
    allowPass: parseBoolean(ownValue(input, 'allowPass', path), `${path}.allowPass`),
  }
  if (kind === 'destination') return { kind, ...common }
  const directions = parseBoundedArray(
    ownValue(input, 'directions', path),
    `${path}.directions`,
    MOVE_AUTOMATION_AREA_DIRECTIONS.length,
  ).map((direction, index) => parseEnum<MoveAutomationAreaDirection>(
    direction,
    MOVEMENT_DIRECTION_SET,
    `${path}.directions[${index}]`,
    'a canonical movement direction',
  ))
  if (directions.length === 0) {
    fail('invalid-effect-operation', `${path}.directions`, 'must contain at least one direction.')
  }
  if (new Set(directions).size !== directions.length) {
    fail('duplicate-id', `${path}.directions`, 'must not contain duplicate directions.')
  }
  return { kind, ...common, directions }
}

const parseContextualMovementDistance = (
  value: unknown,
  path: string,
): MoveContextualMovementDistance => {
  const input = parseExactRecord(value, CONTEXTUAL_MOVEMENT_DISTANCE_FIELDS, path)
  if (ownValue(input, 'kind', path) !== 'expression') {
    return fail('invalid-effect-operation', `${path}.kind`, 'must be expression.')
  }
  const minimum = parseInteger(
    ownValue(input, 'minimum', path),
    `${path}.minimum`,
    0,
    MOVE_EFFECT_OPERATION_LIMITS.movementDisplacementDistance,
  )
  const maximum = parseInteger(
    ownValue(input, 'maximum', path),
    `${path}.maximum`,
    0,
    MOVE_EFFECT_OPERATION_LIMITS.movementDisplacementDistance,
  )
  if (minimum > maximum) {
    fail('invalid-effect-operation', path, 'movement distance minimum cannot exceed maximum.')
  }
  return {
    kind: 'expression',
    expression: parseMoveExpression(
      ownValue(input, 'expression', path),
      `${path}.expression`,
    ),
    minimum,
    maximum,
    rounding: parseEnum<MoveEffectRoundingPolicy>(
      ownValue(input, 'rounding', path),
      ROUNDING_POLICY_SET,
      `${path}.rounding`,
      'floor, round, or ceil',
    ),
  }
}

const parseMovementDistance = (
  value: unknown,
  path: string,
  maximum: number,
  allowExpression: boolean,
): MoveMovementDistance | null => {
  if (value === null) return null
  if (typeof value === 'number') return parseInteger(value, path, 0, maximum)
  if (!allowExpression) {
    return fail('invalid-effect-operation', path, 'must be a bounded integer or null.')
  }
  return parseContextualMovementDistance(value, path)
}

const parseMovementVector = (
  value: unknown,
  path: string,
): MoveMovementVector => {
  const candidate = parseRecord(value, path)
  const kind = parseEnum<MoveEffectMovementVectorKind>(
    ownValue(candidate, 'kind', path),
    MOVEMENT_VECTOR_KIND_SET,
    `${path}.kind`,
    'away, toward, chosen, or cardinal',
  )
  if (kind === 'away' || kind === 'toward') {
    const input = parseExactRecord(value, RELATIVE_MOVEMENT_VECTOR_FIELDS, path)
    return {
      kind,
      source: parseMoveSelector(ownValue(input, 'source', path), `${path}.source`),
    }
  }
  if (kind === 'chosen') {
    const input = parseExactRecord(value, CHOSEN_MOVEMENT_VECTOR_FIELDS, path)
    return {
      kind,
      directionSetId: parseStableId(
        ownValue(input, 'directionSetId', path),
        `${path}.directionSetId`,
      ),
    }
  }
  const input = parseExactRecord(value, CARDINAL_MOVEMENT_VECTOR_FIELDS, path)
  return {
    kind,
    direction: parseEnum<MoveEffectMovementCardinalDirection>(
      ownValue(input, 'direction', path),
      MOVEMENT_CARDINAL_DIRECTION_SET,
      `${path}.direction`,
      'a cardinal or vertical direction',
    ),
  }
}

const parseMovementDisplacement = (
  value: unknown,
  path: string,
): MoveMovementDisplacement => {
  const input = parseExactRecord(value, MOVEMENT_DISPLACEMENT_FIELDS, path)
  return {
    vector: parseMovementVector(ownValue(input, 'vector', path), `${path}.vector`),
    distancePolicy: parseEnum<MoveEffectMovementDisplacementDistancePolicy>(
      ownValue(input, 'distancePolicy', path),
      MOVEMENT_DISPLACEMENT_DISTANCE_POLICY_SET,
      `${path}.distancePolicy`,
      'up-to-distance or full-distance-required',
    ),
    opportunityAttacks: parseEnum<MoveEffectMovementOpportunityAttackPolicy>(
      ownValue(input, 'opportunityAttacks', path),
      MOVEMENT_OPPORTUNITY_ATTACK_POLICY_SET,
      `${path}.opportunityAttacks`,
      'provoke or ignore',
    ),
  }
}

const parseMovementRequestPayload = (
  value: unknown,
  path: string,
): MoveMovementRequestEffectPayload => {
  const candidate = parseRecord(value, path)
  const hasChoice = Object.prototype.hasOwnProperty.call(candidate, 'choice')
  const hasDisplacement = Object.prototype.hasOwnProperty.call(candidate, 'displacement')
  if (hasChoice && hasDisplacement) {
    return fail(
      'invalid-effect-operation',
      path,
      'movement choice and displacement declarations are mutually exclusive.',
    )
  }
  const input = parseExactRecord(
    value,
    hasChoice
      ? MOVEMENT_CHOICE_REQUEST_FIELDS
      : hasDisplacement
        ? MOVEMENT_DISPLACEMENT_REQUEST_FIELDS
        : MOVEMENT_REQUEST_FIELDS,
    path,
  )
  const mode = parseEnum<MoveEffectMovementMode>(
    ownValue(input, 'mode', path),
    MOVEMENT_MODE_SET,
    `${path}.mode`,
    'a supported movement mode',
  )
  if (hasDisplacement && mode !== 'forced' && mode !== 'voluntary') {
    fail(
      'invalid-effect-operation',
      `${path}.mode`,
      'spatial displacement supports forced or voluntary movement only.',
    )
  }
  const distance = parseMovementDistance(
    ownValue(input, 'distance', path),
    `${path}.distance`,
    hasChoice
      ? MOVE_EFFECT_OPERATION_LIMITS.movementChoiceDistance
      : hasDisplacement
        ? MOVE_EFFECT_OPERATION_LIMITS.movementDisplacementDistance
        : MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
    hasDisplacement,
  )
  const destinationSetId = parseNullableStableId(
    ownValue(input, 'destinationSetId', path),
    `${path}.destinationSetId`,
  )
  if (hasDisplacement && (distance === null || destinationSetId !== null)) {
    fail(
      'invalid-effect-operation',
      path,
      'spatial displacement requires a distance and derives its destination without a destination set.',
    )
  }
  return {
    requestId: parseStableId(ownValue(input, 'requestId', path), `${path}.requestId`),
    mode,
    distance,
    destinationSetId,
    ...(hasChoice
      ? { choice: parseMovementChoice(ownValue(input, 'choice', path), `${path}.choice`) }
      : {}),
    ...(hasDisplacement
      ? {
          displacement: parseMovementDisplacement(
            ownValue(input, 'displacement', path),
            `${path}.displacement`,
          ),
        }
      : {}),
  }
}

const parseSwitchRequestPayload = (
  value: unknown,
  path: string,
): MoveSwitchRequestEffectPayload => {
  const input = parseExactRecord(value, SWITCH_REQUEST_FIELDS, path)
  return {
    requestId: parseStableId(ownValue(input, 'requestId', path), `${path}.requestId`),
    replacementSetId: parseStableId(
      ownValue(input, 'replacementSetId', path),
      `${path}.replacementSetId`,
    ),
    promptKey: parseStableId(ownValue(input, 'promptKey', path), `${path}.promptKey`),
    required: parseBoolean(ownValue(input, 'required', path), `${path}.required`),
    positionPolicy: parseEnum<MoveEffectSwitchPositionPolicy>(
      ownValue(input, 'positionPolicy', path),
      SWITCH_POSITION_POLICY_SET,
      `${path}.positionPolicy`,
      'recalled-position',
    ),
    initiativePolicy: parseEnum<MoveEffectSwitchInitiativePolicy>(
      ownValue(input, 'initiativePolicy', path),
      SWITCH_INITIATIVE_POLICY_SET,
      `${path}.initiativePolicy`,
      'inherit-slot',
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

const parseBranchOperationIds = (
  value: unknown,
  path: string,
  minimum: number,
): readonly string[] => {
  const operationIds = parseBoundedArray(
    value,
    path,
    MOVE_EFFECT_OPERATION_LIMITS.branchOperationReferences,
  ).map((operationId, index) => parseStableId(operationId, `${path}[${index}]`))
  if (operationIds.length < minimum) {
    fail(
      'invalid-effect-operation',
      path,
      `must contain at least ${minimum} operation ${minimum === 1 ? 'ID' : 'IDs'}.`,
    )
  }
  assertUnique(operationIds, path)
  return operationIds
}

const parseBranchPath = (
  value: unknown,
  path: string,
  minimumOperations = 0,
): MoveEffectBranchPath => {
  const input = parseExactRecord(value, BRANCH_PATH_FIELDS, path)
  return {
    id: parseStableId(ownValue(input, 'id', path), `${path}.id`),
    operationIds: parseBranchOperationIds(
      ownValue(input, 'operationIds', path),
      `${path}.operationIds`,
      minimumOperations,
    ),
  }
}

const assertDistinctBranchPaths = (
  paths: readonly MoveEffectBranchPath[],
  path: string,
): void => {
  assertUnique(paths.map(branch => branch.id), `${path}.id`)
  const operationReferenceCount = paths.reduce(
    (total, branch) => total + branch.operationIds.length,
    0,
  )
  if (operationReferenceCount > MOVE_EFFECT_OPERATION_LIMITS.branchOperationReferences) {
    fail(
      'limit-exceeded',
      `${path}.operationIds`,
      `must contain at most ${MOVE_EFFECT_OPERATION_LIMITS.branchOperationReferences} operation references across all paths.`,
    )
  }
  if (!paths.some(branch => branch.operationIds.length > 0)) {
    fail(
      'invalid-effect-operation',
      path,
      'must enable at least one later operation across its paths.',
    )
  }
}

const parsePredicateBranchPayload = (
  input: UnknownRecord,
  path: string,
): MovePredicateBranchEffectPayload => {
  assertExactKeys(input, PREDICATE_BRANCH_FIELDS, path)
  const whenTrue = parseBranchPath(ownValue(input, 'whenTrue', path), `${path}.whenTrue`)
  const whenFalse = parseBranchPath(ownValue(input, 'whenFalse', path), `${path}.whenFalse`)
  assertDistinctBranchPaths([whenTrue, whenFalse], path)
  return {
    kind: 'predicate',
    selectionId: parseStableId(ownValue(input, 'selectionId', path), `${path}.selectionId`),
    scope: parseEnum<MoveEffectBranchScope>(
      ownValue(input, 'scope', path),
      BRANCH_SCOPE_SET,
      `${path}.scope`,
      'resolution or recipient',
    ),
    predicate: parseEffectPredicate(ownValue(input, 'predicate', path), `${path}.predicate`),
    whenTrue,
    whenFalse,
  }
}

const parseRelationshipBranchPayload = (
  input: UnknownRecord,
  path: string,
): MoveRelationshipBranchEffectPayload => {
  assertExactKeys(input, RELATIONSHIP_BRANCH_FIELDS, path)
  if (ownValue(input, 'scope', path) !== 'recipient') {
    fail(
      'invalid-effect-operation',
      `${path}.scope`,
      'relationship branches must be recipient-scoped.',
    )
  }
  const branchesPath = `${path}.branches`
  const branchInput = parseExactRecord(
    ownValue(input, 'branches', path),
    RELATIONSHIP_BRANCH_PATH_FIELDS,
    branchesPath,
  )
  const branches: MoveRelationshipBranchPaths = {
    self: parseBranchPath(ownValue(branchInput, 'self', branchesPath), `${branchesPath}.self`),
    ally: parseBranchPath(ownValue(branchInput, 'ally', branchesPath), `${branchesPath}.ally`),
    enemy: parseBranchPath(ownValue(branchInput, 'enemy', branchesPath), `${branchesPath}.enemy`),
    unknown: parseBranchPath(ownValue(branchInput, 'unknown', branchesPath), `${branchesPath}.unknown`),
  }
  assertDistinctBranchPaths(Object.values(branches), branchesPath)
  return {
    kind: 'relationship',
    selectionId: parseStableId(ownValue(input, 'selectionId', path), `${path}.selectionId`),
    scope: 'recipient',
    branches,
  }
}

const parseCheckResultBranchPayload = (
  input: UnknownRecord,
  path: string,
): MoveCheckResultBranchEffectPayload => {
  assertExactKeys(input, CHECK_RESULT_BRANCH_FIELDS, path)
  if (ownValue(input, 'scope', path) !== 'recipient') {
    fail(
      'invalid-effect-operation',
      `${path}.scope`,
      'check-result branches must be recipient-scoped.',
    )
  }
  const branchesPath = `${path}.branches`
  const branchInput = parseExactRecord(
    ownValue(input, 'branches', path),
    CHECK_BRANCH_FIELDS,
    branchesPath,
  )
  const branches: MoveCheckResultBranchPaths = {
    success: parseBranchPath(
      ownValue(branchInput, 'success', branchesPath),
      `${branchesPath}.success`,
    ),
    failure: parseBranchPath(
      ownValue(branchInput, 'failure', branchesPath),
      `${branchesPath}.failure`,
    ),
  }
  assertDistinctBranchPaths(Object.values(branches), branchesPath)
  return {
    kind: 'check',
    selectionId: parseStableId(ownValue(input, 'selectionId', path), `${path}.selectionId`),
    scope: 'recipient',
    checkId: parseStableId(ownValue(input, 'checkId', path), `${path}.checkId`),
    branches,
  }
}

const parseChoiceBranchPayload = (
  input: UnknownRecord,
  path: string,
): MoveChoiceBranchEffectPayload => {
  assertExactKeys(input, CHOICE_BRANCH_FIELDS, path)
  const optionsPath = `${path}.options`
  const options = parseBoundedArray(
    ownValue(input, 'options', path),
    optionsPath,
    MOVE_EFFECT_OPERATION_LIMITS.requestOptions,
  ).map((option, index): MoveChoiceBranchOption => {
    const optionPath = `${optionsPath}[${index}]`
    const entry = parseExactRecord(option, CHOICE_BRANCH_OPTION_FIELDS, optionPath)
    return {
      id: parseStableId(ownValue(entry, 'id', optionPath), `${optionPath}.id`),
      labelKey: parseStableId(
        ownValue(entry, 'labelKey', optionPath),
        `${optionPath}.labelKey`,
      ),
      operationIds: parseBranchOperationIds(
        ownValue(entry, 'operationIds', optionPath),
        `${optionPath}.operationIds`,
        1,
      ),
    }
  })
  const pass = ownValue(input, 'pass', path) === null
    ? null
    : parseBranchPath(ownValue(input, 'pass', path), `${path}.pass`)
  if (pass && pass.operationIds.length > 0) {
    fail(
      'invalid-effect-operation',
      `${path}.pass.operationIds`,
      'a pass path cannot enable effect operations.',
    )
  }
  if (options.length + (pass ? 1 : 0) < 2) {
    fail(
      'invalid-effect-operation',
      optionsPath,
      'must define at least two exclusive outcomes, counting an explicit pass.',
    )
  }
  assertDistinctBranchPaths(pass ? [...options, pass] : options, path)
  return {
    kind: 'choice',
    selectionId: parseStableId(ownValue(input, 'selectionId', path), `${path}.selectionId`),
    scope: parseEnum<MoveEffectBranchScope>(
      ownValue(input, 'scope', path),
      BRANCH_SCOPE_SET,
      `${path}.scope`,
      'resolution or recipient',
    ),
    requestId: parseStableId(ownValue(input, 'requestId', path), `${path}.requestId`),
    promptKey: parseStableId(ownValue(input, 'promptKey', path), `${path}.promptKey`),
    options,
    pass,
  }
}

const parseBranchPayload = (
  value: unknown,
  path: string,
): MoveBranchEffectPayload => {
  const input = parseRecord(value, path)
  const kind = parseEnum<MoveEffectBranchKind>(
    ownValue(input, 'kind', path),
    BRANCH_KIND_SET,
    `${path}.kind`,
    'predicate, relationship, check, or choice',
  )
  if (kind === 'predicate') return parsePredicateBranchPayload(input, path)
  if (kind === 'relationship') return parseRelationshipBranchPayload(input, path)
  if (kind === 'check') return parseCheckResultBranchPayload(input, path)
  return parseChoiceBranchPayload(input, path)
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
  const allowPass = parseBoolean(ownValue(input, 'allowPass', path), `${path}.allowPass`)
  if (!allowPass) {
    fail(
      'invalid-effect-operation',
      `${path}.allowPass`,
      'reaction windows must allow an explicit decline; mandatory outcomes are not reactions.',
    )
  }
  const timingValue = ownValue(input, 'timing', path)
  const timing = isMoveReactionTiming(timingValue)
    ? timingValue
    : fail(
        'invalid-effect-operation',
        `${path}.timing`,
        'must be a canonical move reaction timing.',
      )
  return {
    requestId: parseStableId(ownValue(input, 'requestId', path), `${path}.requestId`),
    promptKey: parseStableId(ownValue(input, 'promptKey', path), `${path}.promptKey`),
    options: parseRequestOptions(ownValue(input, 'options', path), `${path}.options`),
    allowPass: true,
    timing,
    priority: parseInteger(
      ownValue(input, 'priority', path),
      `${path}.priority`,
      -MOVE_EFFECT_OPERATION_LIMITS.reactionPriorityMagnitude,
      MOVE_EFFECT_OPERATION_LIMITS.reactionPriorityMagnitude,
    ),
  }
}

const parseCheckRollFormula = (
  value: unknown,
  path: string,
): MoveCheckRollFormula => {
  const formula = parseRollFormula(value, path)
  if (formula.kind === 'table') {
    return fail(
      'invalid-effect-operation',
      `${path}.kind`,
      'check rolls require a bounded dice or uniform-integer formula.',
    )
  }
  return formula
}

const parseCheckRequestOption = (
  value: unknown,
  path: string,
): MoveEffectRequestOption => {
  const input = parseExactRecord(value, REQUEST_OPTION_FIELDS, path)
  return {
    id: parseStableId(ownValue(input, 'id', path), `${path}.id`),
    labelKey: parseStableId(ownValue(input, 'labelKey', path), `${path}.labelKey`),
  }
}

const parseResolvedCheckRollSource = (
  value: unknown,
  path: string,
): MoveCheckResolvedRollSource => {
  const input = parseRecord(value, path)
  const kind = parseEnum<Exclude<MoveEffectCheckRollSourceKind, 'choice'>>(
    ownValue(input, 'kind', path),
    new Set(['fixed', 'skill', 'stat']),
    `${path}.kind`,
    'fixed, skill, or stat',
  )

  if (kind === 'fixed') {
    assertExactKeys(input, CHECK_FIXED_SOURCE_FIELDS, path)
    return {
      kind,
      formula: parseCheckRollFormula(ownValue(input, 'formula', path), `${path}.formula`),
    }
  }
  if (kind === 'skill') {
    assertExactKeys(input, CHECK_SKILL_SOURCE_FIELDS, path)
    return {
      kind,
      skill: parseEnum<MoveEffectCheckSkill>(
        ownValue(input, 'skill', path),
        CHECK_SKILL_SET,
        `${path}.skill`,
        'a canonical skill ID',
      ),
    }
  }

  assertExactKeys(input, CHECK_STAT_SOURCE_FIELDS, path)
  const stat = parseEnum<MoveExpressionStat>(
    ownValue(input, 'stat', path),
    EXPRESSION_STAT_SET,
    `${path}.stat`,
    'a supported authoritative stat',
  )
  const combatStagePolicy = parseEnum<MoveStatCombatStagePolicy>(
    ownValue(input, 'combatStagePolicy', path),
    STAT_COMBAT_STAGE_POLICY_SET,
    `${path}.combatStagePolicy`,
    'a supported Combat Stage policy',
  )
  const stageModifierPolicy = parseEnum<MoveStatStageModifierPolicy>(
    ownValue(input, 'stageModifierPolicy', path),
    STAT_STAGE_MODIFIER_POLICY_SET,
    `${path}.stageModifierPolicy`,
    'honor or ignore',
  )
  if (
    !STAGE_AFFECTED_EXPRESSION_STAT_SET.has(stat)
    && (combatStagePolicy !== 'ignore' || stageModifierPolicy !== 'ignore')
  ) {
    fail(
      'invalid-effect-operation',
      path,
      `${stat} cannot apply Combat Stage policies.`,
    )
  }
  return {
    kind,
    stat,
    combatStagePolicy,
    stageModifierPolicy,
    formula: parseCheckRollFormula(ownValue(input, 'formula', path), `${path}.formula`),
  }
}

const parseCheckRollSource = (
  value: unknown,
  path: string,
): MoveCheckRollSource => {
  const input = parseRecord(value, path)
  const kind = parseEnum<MoveEffectCheckRollSourceKind>(
    ownValue(input, 'kind', path),
    CHECK_ROLL_SOURCE_KIND_SET,
    `${path}.kind`,
    'fixed, skill, stat, or choice',
  )
  if (kind !== 'choice') return parseResolvedCheckRollSource(value, path)

  assertExactKeys(input, CHECK_CHOICE_SOURCE_FIELDS, path)
  const optionsPath = `${path}.options`
  const options = parseBoundedArray(
    ownValue(input, 'options', path),
    optionsPath,
    MOVE_EFFECT_OPERATION_LIMITS.checkSourceOptions,
  ).map((option, index): MoveCheckRollSourceOption => {
    const optionPath = `${optionsPath}[${index}]`
    const entry = parseExactRecord(option, CHECK_SOURCE_OPTION_FIELDS, optionPath)
    return {
      id: parseStableId(ownValue(entry, 'id', optionPath), `${optionPath}.id`),
      labelKey: parseStableId(
        ownValue(entry, 'labelKey', optionPath),
        `${optionPath}.labelKey`,
      ),
      source: parseResolvedCheckRollSource(
        ownValue(entry, 'source', optionPath),
        `${optionPath}.source`,
      ),
    }
  })
  if (options.length < 2) {
    fail('invalid-effect-operation', optionsPath, 'must contain at least two choices.')
  }
  assertUnique(options.map(option => option.id), `${optionsPath}.id`)
  return {
    kind,
    requestId: parseStableId(ownValue(input, 'requestId', path), `${path}.requestId`),
    promptKey: parseStableId(ownValue(input, 'promptKey', path), `${path}.promptKey`),
    options,
  }
}

const parseCheckModifiers = (
  value: unknown,
  path: string,
): readonly MoveCheckRollModifier[] => {
  const modifiers = parseBoundedArray(
    value,
    path,
    MOVE_EFFECT_OPERATION_LIMITS.checkModifiers,
  ).map((modifier, index): MoveCheckRollModifier => {
    const modifierPath = `${path}[${index}]`
    const input = parseExactRecord(modifier, CHECK_MODIFIER_FIELDS, modifierPath)
    const sourceId = parseStableId(
      ownValue(input, 'sourceId', modifierPath),
      `${modifierPath}.sourceId`,
    )
    if (sourceId === 'check-basis') {
      fail(
        'invalid-effect-operation',
        `${modifierPath}.sourceId`,
        'check-basis is reserved for the selected authoritative skill or stat.',
      )
    }
    return {
      sourceId,
      reasonCode: parseStableId(
        ownValue(input, 'reasonCode', modifierPath),
        `${modifierPath}.reasonCode`,
      ),
      value: parseEffectExpression(
        () => parseMoveExpression(
          ownValue(input, 'value', modifierPath),
          `${modifierPath}.value`,
        ),
      ),
    }
  })
  assertUnique(modifiers.map(modifier => modifier.sourceId), `${path}.sourceId`)
  return modifiers
}

const parseCheckRerollPolicy = (
  value: unknown,
  path: string,
): MoveCheckRerollPolicy => {
  const input = parseExactRecord(value, CHECK_REROLL_FIELDS, path)
  return {
    count: parseInteger(
      ownValue(input, 'count', path),
      `${path}.count`,
      0,
      MOVE_EFFECT_OPERATION_LIMITS.checkRerolls,
    ),
    keep: parseEnum<MoveEffectCheckRerollKeepPolicy>(
      ownValue(input, 'keep', path),
      CHECK_REROLL_KEEP_POLICY_SET,
      `${path}.keep`,
      'latest, highest, or lowest',
    ),
  }
}

const parseCheckResourceReroll = (
  value: unknown,
  path: string,
): MoveCheckResourceRerollRequest | null => {
  if (value === null) return null
  const input = parseExactRecord(value, CHECK_RESOURCE_REROLL_FIELDS, path)
  const spendOption = parseCheckRequestOption(
    ownValue(input, 'spendOption', path),
    `${path}.spendOption`,
  )
  const declineOption = parseCheckRequestOption(
    ownValue(input, 'declineOption', path),
    `${path}.declineOption`,
  )
  if (spendOption.id === declineOption.id) {
    fail(
      'duplicate-id',
      `${path}.declineOption.id`,
      'spend and decline options must have distinct IDs.',
    )
  }
  return {
    requestId: parseStableId(ownValue(input, 'requestId', path), `${path}.requestId`),
    promptKey: parseStableId(ownValue(input, 'promptKey', path), `${path}.promptKey`),
    resourceId: parseStableId(ownValue(input, 'resourceId', path), `${path}.resourceId`),
    amount: parseInteger(
      ownValue(input, 'amount', path),
      `${path}.amount`,
      1,
      MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
    ),
    trigger: parseEnum<MoveEffectCheckResourceTrigger>(
      ownValue(input, 'trigger', path),
      CHECK_RESOURCE_TRIGGER_SET,
      `${path}.trigger`,
      'always or on-failure',
    ),
    spendOption,
    declineOption,
  }
}

const parseCheckRollDefinition = (
  value: unknown,
  path: string,
): MoveCheckRollDefinition => {
  const input = parseExactRecord(value, CHECK_ROLL_FIELDS, path)
  return {
    rollId: parseStableId(ownValue(input, 'rollId', path), `${path}.rollId`),
    source: parseCheckRollSource(ownValue(input, 'source', path), `${path}.source`),
    modifiers: parseCheckModifiers(ownValue(input, 'modifiers', path), `${path}.modifiers`),
    reroll: parseCheckRerollPolicy(ownValue(input, 'reroll', path), `${path}.reroll`),
    resourceReroll: parseCheckResourceReroll(
      ownValue(input, 'resourceReroll', path),
      `${path}.resourceReroll`,
    ),
  }
}

const parseCheckTiePolicy = (
  value: unknown,
  path: string,
): MoveCheckTiePolicy => {
  const input = parseRecord(value, path)
  const kind = parseEnum<MoveEffectCheckTieKind>(
    ownValue(input, 'kind', path),
    CHECK_TIE_KIND_SET,
    `${path}.kind`,
    'success, failure, or reroll',
  )
  if (kind !== 'reroll') {
    assertExactKeys(input, CHECK_RESOLVED_TIE_FIELDS, path)
    return { kind }
  }
  assertExactKeys(input, CHECK_REROLL_TIE_FIELDS, path)
  return {
    kind,
    maximumRerolls: parseInteger(
      ownValue(input, 'maximumRerolls', path),
      `${path}.maximumRerolls`,
      1,
      MOVE_EFFECT_OPERATION_LIMITS.checkRerolls,
    ),
    exhaustedOutcome: parseEnum<MoveEffectCheckOutcome>(
      ownValue(input, 'exhaustedOutcome', path),
      CHECK_OUTCOME_SET,
      `${path}.exhaustedOutcome`,
      'success or failure',
    ),
  }
}

const parseCheckBranches = (
  value: unknown,
  path: string,
): MoveCheckBranches => {
  const input = parseExactRecord(value, CHECK_BRANCH_FIELDS, path)
  const branches = {
    success: parseStableId(ownValue(input, 'success', path), `${path}.success`),
    failure: parseStableId(ownValue(input, 'failure', path), `${path}.failure`),
  }
  if (branches.success === branches.failure) {
    fail('duplicate-id', `${path}.failure`, 'success and failure branches must be distinct.')
  }
  return branches
}

const checkRequestIds = (
  rolls: readonly MoveCheckRollDefinition[],
): readonly string[] => rolls.flatMap((roll) => [
  ...(roll.source.kind === 'choice' ? [roll.source.requestId] : []),
  ...(roll.resourceReroll ? [roll.resourceReroll.requestId] : []),
])

const validateCheckRollIdentity = (
  rolls: readonly MoveCheckRollDefinition[],
  path: string,
): void => {
  assertUnique(rolls.map(roll => roll.rollId), `${path}.rollId`)
  assertUnique(checkRequestIds(rolls), `${path}.requestId`)
  if (rolls.filter(roll => roll.resourceReroll !== null).length > 1) {
    fail(
      'invalid-effect-operation',
      path,
      'one check may open at most one resource-reroll request.',
    )
  }
}

const parseCheckPayload = (value: unknown, path: string): MoveCheckEffectPayload => {
  const input = parseRecord(value, path)
  const kind = parseEnum<MoveEffectCheckKind>(
    ownValue(input, 'kind', path),
    CHECK_KIND_SET,
    `${path}.kind`,
    'opposed or save',
  )
  if (kind === 'opposed') {
    assertExactKeys(input, OPPOSED_CHECK_FIELDS, path)
    const actorRoll = parseCheckRollDefinition(
      ownValue(input, 'actorRoll', path),
      `${path}.actorRoll`,
    )
    const targetRoll = parseCheckRollDefinition(
      ownValue(input, 'targetRoll', path),
      `${path}.targetRoll`,
    )
    validateCheckRollIdentity([actorRoll, targetRoll], path)
    return {
      kind,
      checkId: parseStableId(ownValue(input, 'checkId', path), `${path}.checkId`),
      actorRoll,
      targetRoll,
      tie: parseCheckTiePolicy(ownValue(input, 'tie', path), `${path}.tie`),
      branches: parseCheckBranches(ownValue(input, 'branches', path), `${path}.branches`),
    }
  }

  assertExactKeys(input, SAVE_CHECK_FIELDS, path)
  const roll = parseCheckRollDefinition(ownValue(input, 'roll', path), `${path}.roll`)
  validateCheckRollIdentity([roll], path)
  return {
    kind,
    checkId: parseStableId(ownValue(input, 'checkId', path), `${path}.checkId`),
    roll,
    dc: parseEffectExpression(
      () => parseMoveExpression(ownValue(input, 'dc', path), `${path}.dc`),
    ),
    tie: parseCheckTiePolicy(ownValue(input, 'tie', path), `${path}.tie`),
    branches: parseCheckBranches(ownValue(input, 'branches', path), `${path}.branches`),
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

const hpCostTimingMatchesPhase = (
  timing: MoveEffectHpCostTiming,
  phase: MoveSpecPhase,
): boolean => {
  if (timing === 'declaration') return phase === 'declare' || phase === 'pay'
  if (timing === 'hit') return phase === 'hit'
  if (timing === 'damage') return phase === 'damage' || phase === 'after-damage'
  return phase === 'cleanup'
}

const validateBranchOperationEnvelope = (options: {
  readonly common: ParsedOperationCommon
  readonly payload: MoveBranchEffectPayload
  readonly path: string
}): void => {
  if (options.payload.kind === 'choice' && options.common.recipients.kind === 'none') {
    fail(
      'invalid-effect-operation',
      `${options.path}.recipients.kind`,
      'human branch choices require an authoritative owner/subject recipient selector.',
    )
  }
  if (
    options.payload.scope === 'recipient'
    && !RECIPIENT_SCOPED_BRANCH_SELECTOR_SET.has(options.common.recipients.kind)
  ) {
    fail(
      'invalid-effect-operation',
      `${options.path}.recipients.kind`,
      'recipient-scoped branches require an authoritative target recipient selector.',
    )
  }
}

const validateHpOperationEnvelope = (options: {
  readonly common: ParsedOperationCommon
  readonly payload: MoveDirectHpEffectPayload | MoveHealEffectPayload
  readonly path: string
}): void => {
  const damageLinked = options.payload.calculation?.kind === 'damage-dealt'
  const cost = 'cost' in options.payload ? options.payload.cost : null
  const accuracyRollId = 'accuracyRollId' in options.payload
    ? options.payload.accuracyRollId ?? null
    : null
  if (accuracyRollId !== null && options.common.recipients.kind !== 'hit-targets') {
    fail(
      'invalid-effect-operation',
      `${options.path}.recipients.kind`,
      'accuracy-gated direct HP must use authoritative hit targets.',
    )
  }
  if ((damageLinked || cost !== null) && options.common.recipients.kind !== 'actor') {
    fail(
      'invalid-effect-operation',
      `${options.path}.recipients.kind`,
      'damage-linked HP and HP costs must use the authoritative actor recipient.',
    )
  }
  if (damageLinked && options.common.phase !== 'damage' && options.common.phase !== 'after-damage') {
    fail(
      'invalid-effect-operation',
      `${options.path}.phase`,
      'damage-linked HP must resolve in damage or after-damage.',
    )
  }
  if (cost !== null && !hpCostTimingMatchesPhase(cost.timing, options.common.phase)) {
    fail(
      'invalid-effect-operation',
      `${options.path}.phase`,
      `does not match ${cost.timing} HP cost timing.`,
    )
  }
}

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
    case 'check':
      return { ...common, kind, payload: parseCheckPayload(payload, payloadPath) }
    case 'branch': {
      const parsedPayload = parseBranchPayload(payload, payloadPath)
      validateBranchOperationEnvelope({ common, payload: parsedPayload, path })
      return { ...common, kind, payload: parsedPayload }
    }
    case 'damage':
      return { ...common, kind, payload: parseDamagePayload(payload, payloadPath) }
    case 'multi-hit':
      return { ...common, kind, payload: parseMultiHitPayload(payload, payloadPath) }
    case 'direct-hp': {
      const parsedPayload = parseDirectHpPayload(payload, payloadPath)
      validateHpOperationEnvelope({ common, payload: parsedPayload, path })
      return { ...common, kind, payload: parsedPayload }
    }
    case 'heal': {
      const parsedPayload = parseHealPayload(payload, payloadPath)
      validateHpOperationEnvelope({ common, payload: parsedPayload, path })
      return { ...common, kind, payload: parsedPayload }
    }
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
    case 'switch-request':
      return { ...common, kind, payload: parseSwitchRequestPayload(payload, payloadPath) }
    case 'usage':
      return { ...common, kind, payload: parseUsagePayload(payload, payloadPath) }
    case 'history':
      return { ...common, kind, payload: parseHistoryPayload(payload, payloadPath) }
    case 'log':
      return { ...common, kind, payload: parseLogPayload(payload, payloadPath) }
    case 'choice-request':
      return { ...common, kind, payload: parseChoiceRequestPayload(payload, payloadPath) }
    case 'reaction-request': {
      const parsedPayload = parseReactionRequestPayload(payload, payloadPath)
      const expectedPhase = moveReactionTimingDefinition(parsedPayload.timing).phase
      if (common.phase !== expectedPhase) {
        fail(
          'invalid-effect-operation',
          `${payloadPath}.timing`,
          `${parsedPayload.timing} reactions must execute in the ${expectedPhase} phase.`,
        )
      }
      return { ...common, kind, payload: parsedPayload }
    }
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
