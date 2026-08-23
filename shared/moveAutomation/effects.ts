import {
  ENCOUNTER_EFFECT_DURATION_KINDS,
  ENCOUNTER_EFFECT_LIMITS,
  EncounterEffectValidationError,
  parseEncounterEffectDefinition,
  parseEncounterEffectDuration,
  parseEncounterEffectStackPolicy,
  parseEncounterEffectTransferPolicy,
  type EncounterEffectDefinition,
  type EncounterEffectDuration,
  type EncounterEffectStackPolicy,
  type EncounterEffectTransferPolicy,
} from './encounterEffects'
import {
  ENCOUNTER_ZONE_KINDS,
  type EncounterZoneKind,
} from './encounterZones'
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
  MOVE_HAZARD_CELL_SELECTION_ADJACENCY_KINDS,
  MOVE_HAZARD_CELL_SELECTION_CONNECTEDNESS_KINDS,
  MoveHazardCellSelectionValidationError,
  parseMoveHazardCellSelectionCount,
  parseMoveHazardCellSelectionRules,
  type MoveHazardCellSelectionAdjacency,
  type MoveHazardCellSelectionConnectedness,
  type MoveHazardCellSelectionCount,
  type MoveHazardCellSelectionRules,
} from './hazardCellSelection'
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
  MoveItemChoiceValidationError,
  parseMoveItemChoiceDeclaration,
  type MoveItemChoiceDeclaration,
} from './itemChoices'
import {
  MoveItemEffectValidationError,
  parseMoveItemEffectPayload,
  type MoveItemEffectPayload,
} from './itemEffects'
import {
  MOVE_SPEC_PHASES,
  type MoveSpecPhase,
} from './spec'
import {
  MOVE_RANDOM_SELECTION_LIMITS,
  MoveRandomSelectionValidationError,
  parseMoveRandomMovePoolDefinition,
  parseMoveRandomTableDefinition,
  type MoveRandomMovePoolDefinition,
  type MoveRandomTableDefinition,
} from './randomTables'
import {
  MOVE_AUTOMATION_AREA_DIRECTIONS,
  type MoveAutomationAreaDirection,
} from '~/types/moveAutomation'
import {
  MovePermanentMoveListValidationError,
  parseMovePermanentMoveListEffectPayload,
  type MovePermanentMoveListEffectPayload,
} from './permanentMoveLists'

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
  'loyalty',
  'heal',
  'condition',
  'combat-stage',
  'temporary-effect',
  'field',
  'hazard',
  'movement-request',
  'switch-request',
  'nested-move',
  'item',
  'permanent-move-list',
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
  /** Every authoritative map placement in deterministic map order. */
  'all-placements',
  'source-placement',
  /** Server-selected owner of one answered durable reaction window. */
  'response-owner',
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
  'all-placements',
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
export const MOVE_EFFECT_BRANCH_CHOICE_OWNERS = ['recipients', 'actor', 'gm'] as const

export const MOVE_EFFECT_DAMAGE_CLASSES = ['physical', 'special'] as const
export const MOVE_DAMAGE_CLASS_SELECTION_KINDS = ['compare-stats'] as const
/** Static reviewed additions that enter the damage roll before type effectiveness. */
export const MOVE_EFFECT_PRE_TYPE_DAMAGE_MODIFIER_PRIORITY_MAGNITUDE = 100_000 as const
export const MOVE_DAMAGE_CLASS_COMPARISON_OPERATORS = ['less-than'] as const
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
export const MOVE_EFFECT_TEMPORARY_RECIPIENT_SCOPES = ['placements', 'actor-side'] as const

export const MOVE_EFFECT_FIELD_CATEGORIES = [
  'weather',
  'terrain',
  'room',
  'side',
] as const

/** Native map-owned zone families emitted by reviewed hazard operations. */
export const MOVE_EFFECT_HAZARD_ZONE_KINDS = ['hazard', 'pledge', 'barrier'] as const
export const MOVE_EFFECT_HAZARD_OWNERSHIP_KINDS = ['source-side', 'recipient-side', 'neutral'] as const
export const MOVE_EFFECT_HAZARD_OWNERSHIP_FILTER_KINDS = [
  'any',
  'source-side',
  'recipient-side',
  'neutral',
] as const
export const MOVE_EFFECT_HAZARD_GEOMETRY_KINDS = ['selection', 'blast', 'line'] as const
export const MOVE_EFFECT_HAZARD_BLAST_CENTERS = ['actor', 'selected-target'] as const
export const MOVE_EFFECT_HAZARD_REMOVAL_TARGET_KINDS = ['zone-id', 'matching'] as const

/** Bounded selectors and mutations for canonical battlefield-zone cleanup. */
export const MOVE_EFFECT_BATTLEFIELD_ZONE_KINDS = ENCOUNTER_ZONE_KINDS
export const MOVE_EFFECT_BATTLEFIELD_ZONE_SOURCE_FILTERS = [
  'any',
  'actor',
  'recipients',
] as const
export const MOVE_EFFECT_BATTLEFIELD_ZONE_SIDE_FILTERS = [
  'any',
  'neutral',
  'source-side',
  'recipient-side',
  'other-side',
] as const
export const MOVE_EFFECT_BATTLEFIELD_ZONE_SIDE_REFERENCES = [
  'source-side',
  'recipient-side',
  'other-side',
] as const
export const MOVE_EFFECT_BATTLEFIELD_ZONE_MUTATIONS = [
  'remove',
  'destroy',
  'clear-side',
  'transfer-side',
  'swap-sides',
  'suppress',
  'consume-terrain',
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
/** Server-reviewed facts that may make a switch request eligible. */
export const MOVE_EFFECT_SWITCH_TRIGGERS = ['always', 'on-hit'] as const
/** A pass either declines the whole switch or performs the mandatory recall only. */
export const MOVE_EFFECT_SWITCH_PASS_POLICIES = ['stay', 'recall'] as const
/** Only a reviewed Baton Pass-style switch transfers stages and passable effects. */
export const MOVE_EFFECT_SWITCH_STATE_TRANSFER_POLICIES = ['none', 'baton-pass'] as const

/** A child actor is inherited only through one explicit reviewed policy. */
export const MOVE_EFFECT_NESTED_MOVE_ACTOR_KINDS = [
  'parent-actor',
  'sole-recipient',
  /** The server-authorized owner of an answered durable reaction request. */
  'response-owner',
] as const
/** Child mechanics always come from the server-selected reviewed runtime. */
export const MOVE_EFFECT_NESTED_MOVE_SOURCE_KINDS = [
  'registered-spec',
  'random-move-pool',
] as const
export const MOVE_EFFECT_NESTED_MOVE_TARGETING_KINDS = [
  'operation-recipients',
  'fresh-choice',
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
  movementChoiceDistance: 1_000,
  movementDisplacementDistance: 1_000,
  durationCount: 10_000,
  effectStacks: ENCOUNTER_EFFECT_LIMITS.stacks,
  hazardLayers: 64,
  hazardCharges: ENCOUNTER_EFFECT_LIMITS.charges,
  hazardGeometrySize: 32,
  hazardZoneKinds: MOVE_EFFECT_HAZARD_ZONE_KINDS.length,
  battlefieldZoneKinds: MOVE_EFFECT_BATTLEFIELD_ZONE_KINDS.length,
  battlefieldZoneTags: 32,
  typeOverrides: 18,
  preTypeDamageModifiers: 16,
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
export type MoveEffectBranchChoiceOwner =
  (typeof MOVE_EFFECT_BRANCH_CHOICE_OWNERS)[number]
export type MoveEffectDamageClass = (typeof MOVE_EFFECT_DAMAGE_CLASSES)[number]
export type MoveDamageClassSelectionKind =
  (typeof MOVE_DAMAGE_CLASS_SELECTION_KINDS)[number]
export type MoveDamageClassComparisonOperator =
  (typeof MOVE_DAMAGE_CLASS_COMPARISON_OPERATORS)[number]
export type MoveEffectTemporaryRecipientScope =
  (typeof MOVE_EFFECT_TEMPORARY_RECIPIENT_SCOPES)[number]
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
export type MoveEffectHazardZoneKind = (typeof MOVE_EFFECT_HAZARD_ZONE_KINDS)[number]
export type MoveEffectHazardOwnership = (typeof MOVE_EFFECT_HAZARD_OWNERSHIP_KINDS)[number]
export type MoveEffectHazardOwnershipFilter =
  (typeof MOVE_EFFECT_HAZARD_OWNERSHIP_FILTER_KINDS)[number]
export type MoveEffectHazardGeometryKind = (typeof MOVE_EFFECT_HAZARD_GEOMETRY_KINDS)[number]
export type MoveEffectHazardBlastCenter = (typeof MOVE_EFFECT_HAZARD_BLAST_CENTERS)[number]
export type MoveEffectHazardRemovalTargetKind =
  (typeof MOVE_EFFECT_HAZARD_REMOVAL_TARGET_KINDS)[number]
export type MoveEffectBattlefieldZoneKind =
  (typeof MOVE_EFFECT_BATTLEFIELD_ZONE_KINDS)[number]
export type MoveEffectBattlefieldZoneSourceFilter =
  (typeof MOVE_EFFECT_BATTLEFIELD_ZONE_SOURCE_FILTERS)[number]
export type MoveEffectBattlefieldZoneSideFilter =
  (typeof MOVE_EFFECT_BATTLEFIELD_ZONE_SIDE_FILTERS)[number]
export type MoveEffectBattlefieldZoneSideReference =
  (typeof MOVE_EFFECT_BATTLEFIELD_ZONE_SIDE_REFERENCES)[number]
export type MoveEffectBattlefieldZoneMutationKind =
  (typeof MOVE_EFFECT_BATTLEFIELD_ZONE_MUTATIONS)[number]
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
export type MoveEffectSwitchTrigger =
  (typeof MOVE_EFFECT_SWITCH_TRIGGERS)[number]
export type MoveEffectSwitchPassPolicy =
  (typeof MOVE_EFFECT_SWITCH_PASS_POLICIES)[number]
export type MoveEffectSwitchStateTransferPolicy =
  (typeof MOVE_EFFECT_SWITCH_STATE_TRANSFER_POLICIES)[number]
export type MoveEffectNestedMoveActorKind =
  (typeof MOVE_EFFECT_NESTED_MOVE_ACTOR_KINDS)[number]
export type MoveEffectNestedMoveSourceKind =
  (typeof MOVE_EFFECT_NESTED_MOVE_SOURCE_KINDS)[number]
export type MoveEffectNestedMoveTargetingKind =
  (typeof MOVE_EFFECT_NESTED_MOVE_TARGETING_KINDS)[number]
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

export interface MoveConditionalAutomaticHitRule {
  readonly kind: 'automatic-hit-when'
  readonly predicate: MovePredicate
  readonly sourceId: string
  readonly reasonCode: string
}

/** Server geometry may suppress Evasion without changing the move's base AC. */
export interface MoveConditionalEvasionRule {
  /** `ignore-always` is emitted only after a registered handler proves a contextual rule. */
  readonly kind: 'ignore-when-flanked' | 'ignore-always'
  readonly sourceId: string
  readonly reasonCode: string
}

export interface MoveScalarRollEffectPayload {
  readonly rollId: string
  readonly formula: MoveEffectDiceRollFormula | MoveEffectUniformIntegerRollFormula
  /** Optional reviewed predicate that promotes an accuracy d20 to automatic hit. */
  readonly accuracyRule?: MoveConditionalAutomaticHitRule
  /** Optional authoritative positional rule that changes only target Evasion. */
  readonly evasionRule?: MoveConditionalEvasionRule
}

export interface MoveTableRollEffectPayload {
  readonly rollId: string
  readonly formula: MoveEffectTableRollFormula
  /** Reviewed equal/weighted outcomes and the later typed operation lists they enable. */
  readonly table: MoveRandomTableDefinition
  /** Optional prior natural accuracy result that decides whether this table is rolled at all. */
  readonly accuracyRollTrigger?: MoveConditionAccuracyRollTrigger
}

export type MoveRollEffectPayload =
  | MoveScalarRollEffectPayload
  | MoveTableRollEffectPayload

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
  /** Optional server-evaluated eligibility rule for this recipient's durable option set. */
  readonly predicate?: MovePredicate
}

export interface MoveChoiceBranchEffectPayload {
  readonly kind: 'choice'
  readonly selectionId: string
  readonly scope: MoveEffectBranchScope
  /**
   * Response authority is independent from the branch's mechanics subjects.
   * `recipients` preserves the default target/subject ownership; `actor` lets
   * the move user answer an option that is conditional on target recipients.
   */
  readonly owner: MoveEffectBranchChoiceOwner
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

/**
 * Select Physical or Special by comparing two authoritative stat expressions.
 * Equality follows `whenFalse`, which makes tie policy explicit in reviewed data.
 */
export interface MoveComparedDamageClassSelection {
  readonly kind: 'compare-stats'
  readonly operator: MoveDamageClassComparisonOperator
  readonly left: MoveStatSelectionExpression
  readonly right: MoveStatSelectionExpression
  readonly whenTrue: MoveEffectDamageClass
  readonly whenFalse: MoveEffectDamageClass
}

export type MoveDamageClass = MoveEffectDamageClass | MoveComparedDamageClassSelection

export interface MoveDamageDefenderTypeOverride {
  readonly defenderType: string
  readonly relation: MoveEffectTypeRelation
}

export interface MoveDamageTypeEffectivenessPolicy {
  /** Ignore removes a type-chart immunity contribution; it does not force neutrality. */
  readonly immunity: MoveEffectTypeMatchupPolicy
  readonly resistance: MoveEffectTypeMatchupPolicy
  readonly weakness: MoveEffectTypeMatchupPolicy
  /**
   * Independently ignore passive ability/capability immunity while retaining
   * canonical type-chart immunity (for Sunsteel Strike/Moongeist Beam family).
   * Omission preserves the default `honor` policy.
   */
  readonly passiveImmunity?: MoveEffectTypeMatchupPolicy
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

export interface MovePreTypeDamageModifier {
  /** Stable identity in the ordered damage-pipeline trace. */
  readonly id: string
  /** Lower priorities apply first alongside other authoritative pre-type contributions. */
  readonly priority: number
  readonly stackingGroup: string
  readonly reasonCode: string
  /** A bounded static amount; contextual eligibility is resolved server-side before emission. */
  readonly value: number
}

export interface MoveDamageEffectPayload {
  readonly damageClass: MoveDamageClass
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
  /** Reviewed additive damage-roll contributions applied before type effectiveness. */
  readonly preTypeDamageModifiers?: readonly MovePreTypeDamageModifier[]
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
  /** Optional inclusive natural-accuracy threshold evaluated against this strike/sequence. */
  readonly naturalAccuracyMinimum?: number
  readonly recipient: MoveEffectMultiHitEffectRecipient
  readonly kind: 'condition'
  readonly reasonCode: string
  readonly payload: MoveConditionEffectPayload
}

export interface MoveMultiHitCombatStageEffectTemplate {
  readonly id: string
  readonly timing: MoveEffectMultiHitEffectTiming
  readonly trigger: MoveEffectMultiHitEffectTrigger
  readonly naturalAccuracyMinimum?: number
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

export interface MoveLoyaltyEffectPayload {
  /** The only reviewed Loyalty mutation: one optional rank decrease, clamped at zero. */
  readonly action: 'decrease-rank'
  readonly amount: 1
  readonly minimum: 0
}

export interface MoveHealEffectPayload {
  readonly mode: MoveEffectHealMode
  readonly pool: MoveEffectHpPool
  /** Required for gain; null for full. */
  readonly calculation: MoveHpCalculation | null
  readonly bounds: MoveHpFinalBounds
  readonly rounding: MoveEffectRoundingPolicy
  /** Apply only when an earlier typed state operation actually applied. */
  readonly operationOutcomeTrigger?: MoveConditionOperationOutcomeTrigger
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
  /** One condition per roll face; repeated IDs encode canonical weighted bands. */
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
  /**
   * Server-reviewed source owner for cross-owner reaction effects. Omitted operations
   * retain the active Move actor as their source.
   */
  readonly sourcePlacementId?: string
  readonly duration: EncounterEffectDuration
  /** Optional finite trigger charges; each authoritative trigger consumes one. */
  readonly charges?: number
  /** Explicitly opts a source-linked condition into expiry or Baton Pass transfer. */
  readonly transferPolicy?: EncounterEffectTransferPolicy
}

export interface MoveConditionOperationOutcomeTrigger {
  readonly operationId: string
  readonly outcome: MoveCombatStageOperationOutcomeTrigger['outcome']
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
  /** Apply only when an earlier typed state operation actually applied. */
  readonly operationOutcomeTrigger?: MoveConditionOperationOutcomeTrigger
  /** Honor whole-Move immunity before applying this condition; defaults to true. */
  readonly applyMoveImmunity?: boolean
  /** Honor complete typed-attack immunity before applying this condition. */
  readonly applyTypeImmunity?: boolean
  /** Non-null stores an application as a source-linked encounter effect. */
  readonly duration: MoveConditionDurationPolicy | null
  readonly saveTiming: MoveEffectConditionSaveTiming
  readonly stackPolicy: EncounterEffectStackPolicy
}

export const MOVE_COMBAT_STAGE_ACCURACY_TRIGGER_SCOPES = [
  'recipient',
  'resolution',
] as const

export const MOVE_COMBAT_STAGE_ACCURACY_TRIGGER_APPLICATIONS = [
  'once',
  'per-match',
] as const

export const MOVE_COMBAT_STAGE_OPERATION_TRIGGER_OUTCOMES = [
  'applied',
] as const

export type MoveCombatStageAccuracyTriggerScope =
  (typeof MOVE_COMBAT_STAGE_ACCURACY_TRIGGER_SCOPES)[number]
export type MoveCombatStageAccuracyTriggerApplication =
  (typeof MOVE_COMBAT_STAGE_ACCURACY_TRIGGER_APPLICATIONS)[number]
export type MoveCombatStageOperationTriggerOutcome =
  (typeof MOVE_COMBAT_STAGE_OPERATION_TRIGGER_OUTCOMES)[number]

/** A stage mutation gated by authoritative d20 evidence already present in the roll ledger. */
export interface MoveCombatStageAccuracyRollTrigger {
  readonly kind: 'accuracy-roll'
  readonly rollId: string
  readonly trigger: MoveConditionNaturalRollTrigger
  /** Recipient resolves one matching target roll; resolution considers every attacked target roll. */
  readonly scope: MoveCombatStageAccuracyTriggerScope
  /** Per-match multiplies a reviewed modify delta by the number of qualifying rolls. */
  readonly application: MoveCombatStageAccuracyTriggerApplication
}

/** A stage mutation gated by the reduced outcome of one earlier typed operation. */
export interface MoveCombatStageOperationOutcomeTrigger {
  readonly kind: 'operation-outcome'
  readonly operationId: string
  readonly outcome: MoveCombatStageOperationTriggerOutcome
}

export type MoveCombatStageTrigger =
  | MoveCombatStageAccuracyRollTrigger
  | MoveCombatStageOperationOutcomeTrigger

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
  /** Honor complete typed-attack immunity before changing a non-actor recipient. */
  readonly applyTypeImmunity?: boolean
  /** Optional bounded gate evaluated without drawing randomness or trusting client state. */
  readonly trigger?: MoveCombatStageTrigger
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
  /** Omitted legacy operations address placements; actor-side is derived authoritatively server-side. */
  readonly recipientScope?: MoveEffectTemporaryRecipientScope
  /** Optional reviewed natural-accuracy gate for a durable secondary effect. */
  readonly accuracyRollTrigger?: MoveConditionAccuracyRollTrigger
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

/**
 * Server-reviewed filter over durable battlefield zones. Geometry names only
 * interpreter/server-owned cell sets; no browser-authored coordinates enter a
 * cleanup operation.
 */
export interface MoveBattlefieldZoneFilter {
  readonly zoneKinds: readonly EncounterZoneKind[]
  readonly source: MoveEffectBattlefieldZoneSourceFilter
  readonly side: MoveEffectBattlefieldZoneSideFilter
  readonly requiredTags: readonly string[]
  readonly geometry: MoveHazardGeometry | null
}

export interface MoveRemoveBattlefieldZonesMutation {
  readonly kind: 'remove' | 'destroy'
  readonly target: MoveBattlefieldZoneFilter
}

export interface MoveClearBattlefieldSideMutation {
  readonly kind: 'clear-side'
  readonly target: MoveBattlefieldZoneFilter
}

export interface MoveTransferBattlefieldSideMutation {
  readonly kind: 'transfer-side'
  readonly target: MoveBattlefieldZoneFilter
  readonly destinationSide: MoveEffectBattlefieldZoneSideReference
}

export interface MoveSwapBattlefieldSidesMutation {
  readonly kind: 'swap-sides'
  readonly counterpartSide: Exclude<MoveEffectBattlefieldZoneSideReference, 'source-side'>
  readonly zoneKinds: readonly EncounterZoneKind[]
  readonly requiredTags: readonly string[]
}

export interface MoveSuppressBattlefieldFieldsMutation {
  readonly kind: 'suppress'
  readonly target: MoveBattlefieldZoneFilter
  /** Exact durable zone whose later removal automatically clears suppression. */
  readonly sourceZoneId: string
}

export interface MoveConsumeBattlefieldTerrainMutation {
  readonly kind: 'consume-terrain'
  readonly geometry: MoveHazardGeometry
  readonly includeGlobal: boolean
}

export type MoveBattlefieldZoneMutation =
  | MoveRemoveBattlefieldZonesMutation
  | MoveClearBattlefieldSideMutation
  | MoveTransferBattlefieldSideMutation
  | MoveSwapBattlefieldSidesMutation
  | MoveSuppressBattlefieldFieldsMutation
  | MoveConsumeBattlefieldTerrainMutation

export interface MoveMutateBattlefieldFieldEffectPayload {
  readonly action: 'mutate'
  readonly mutation: MoveBattlefieldZoneMutation
}

export type MoveFieldEffectPayload =
  | MoveApplyFieldEffectPayload
  | MoveRemoveFieldEffectPayload
  | MoveMutateBattlefieldFieldEffectPayload

export interface MoveHazardCellSelectionRequest extends MoveHazardCellSelectionRules {
  readonly requestId: string
  readonly promptKey: string
}

interface MoveHazardGeometryPolicy {
  readonly count: MoveHazardCellSelectionCount
  readonly adjacency: MoveHazardCellSelectionAdjacency
  readonly connectedness: MoveHazardCellSelectionConnectedness
}

/** Cells supplied only by an interpreter-owned set such as a durable selection. */
export interface MoveHazardSelectionGeometry extends MoveHazardGeometryPolicy {
  readonly kind: 'selection'
  readonly cellSetId: string
}

/** A bounded Blast is derived around a server-resolved placement center. */
export interface MoveHazardBlastGeometry extends MoveHazardGeometryPolicy {
  readonly kind: 'blast'
  readonly center: MoveEffectHazardBlastCenter
  readonly size: number
}

/** A bounded Line is derived from the actor and authoritative area direction. */
export interface MoveHazardLineGeometry extends MoveHazardGeometryPolicy {
  readonly kind: 'line'
  readonly length: number
}

export type MoveHazardGeometry =
  | MoveHazardSelectionGeometry
  | MoveHazardBlastGeometry
  | MoveHazardLineGeometry

export interface MoveAddHazardEffectPayload {
  readonly action: 'add'
  /** Stable stacking/removal family; concrete zone IDs remain server-derived. */
  readonly familyId: string
  readonly zoneKind: MoveEffectHazardZoneKind
  /** Typed mechanic ID, such as spikes, stealth-rock, or fire-grass. */
  readonly effectId: string
  readonly ownership: MoveEffectHazardOwnership
  readonly geometry: MoveHazardGeometry
  readonly layers: number
  readonly maxLayers: number
  readonly charges: number | null
  readonly maxCharges: number | null
  /** Reviewed durable policy; valid only for selection geometry. */
  readonly cellSelection?: MoveHazardCellSelectionRequest
}

export interface MoveHazardZoneIdRemovalTarget {
  readonly kind: 'zone-id'
  readonly zoneId: string
}

export interface MoveHazardMatchingRemovalTarget {
  readonly kind: 'matching'
  readonly zoneKinds: readonly MoveEffectHazardZoneKind[]
  readonly ownership: MoveEffectHazardOwnershipFilter
  /** Null matches every stacking family. */
  readonly familyId: string | null
  /** Null matches the whole battlefield; otherwise cells remain server-derived. */
  readonly geometry: MoveHazardGeometry | null
}

export type MoveHazardRemovalTarget =
  | MoveHazardZoneIdRemovalTarget
  | MoveHazardMatchingRemovalTarget

export interface MoveRemoveHazardEffectPayload {
  readonly action: 'remove'
  readonly target: MoveHazardRemovalTarget
}

/** Swap the actor side with the single recipient side; no side ID is spec-authored. */
export interface MoveSwapHazardSidesEffectPayload {
  readonly action: 'swap-sides'
  readonly zoneKinds: readonly MoveEffectHazardZoneKind[]
}

export type MoveHazardEffectPayload =
  | MoveAddHazardEffectPayload
  | MoveRemoveHazardEffectPayload
  | MoveSwapHazardSidesEffectPayload

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

/** Shortest server-derived displacement that leaves the resolved move area. */
export interface MoveAreaExitMovementDistance {
  readonly kind: 'area-exit'
  readonly maximum: number
}

export type MoveMovementDistance =
  | number
  | MoveContextualMovementDistance
  | MoveAreaExitMovementDistance

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
  /** Whether this request always runs or only follows a server-confirmed hit. */
  readonly trigger: MoveEffectSwitchTrigger
  /** Mandatory replacement selections cannot pass and fail closed without an option. */
  readonly required: boolean
  /** A legal pass may retain the actor or perform a mandatory recall without replacement. */
  readonly passPolicy: MoveEffectSwitchPassPolicy
  readonly positionPolicy: MoveEffectSwitchPositionPolicy
  readonly initiativePolicy: MoveEffectSwitchInitiativePolicy
  /** Server-reviewed state behavior; clients select only a replacement option ID. */
  readonly stateTransferPolicy: MoveEffectSwitchStateTransferPolicy
}

export interface MoveNestedMoveParentActor {
  readonly kind: 'parent-actor'
}

export interface MoveNestedMoveSoleRecipientActor {
  readonly kind: 'sole-recipient'
}

export interface MoveNestedMoveResponseOwnerActor {
  readonly kind: 'response-owner'
}

export type MoveNestedMoveActor =
  | MoveNestedMoveParentActor
  | MoveNestedMoveSoleRecipientActor
  | MoveNestedMoveResponseOwnerActor

export interface MoveNestedMoveRegisteredSpecSource {
  readonly kind: 'registered-spec'
}

export interface MoveNestedMoveRandomPoolSource {
  readonly kind: 'random-move-pool'
  readonly pool: MoveRandomMovePoolDefinition
}

export type MoveNestedMoveSource =
  | MoveNestedMoveRegisteredSpecSource
  | MoveNestedMoveRandomPoolSource

export interface MoveNestedMoveOperationRecipientTargeting {
  readonly kind: 'operation-recipients'
}

export interface MoveNestedMoveFreshTargetChoice {
  readonly kind: 'fresh-choice'
  readonly requestId: string
  readonly promptKey: string
  /** Server-evaluated candidate selector; response commands return only an option ID. */
  readonly selector: MoveSelector
}

export type MoveNestedMoveTargeting =
  | MoveNestedMoveOperationRecipientTargeting
  | MoveNestedMoveFreshTargetChoice

interface MoveNestedMoveEffectPayloadBase {
  /** No actor identity is inherited unless this reviewed declaration says so. */
  readonly actor: MoveNestedMoveActor
  readonly targeting: MoveNestedMoveTargeting
}

export interface MoveNestedMoveRegisteredSpecPayload
  extends MoveNestedMoveEffectPayloadBase {
  readonly canonicalId: string
  /** Parent move mechanics are never inherited as the child's source. */
  readonly source: MoveNestedMoveRegisteredSpecSource
}

export interface MoveNestedMoveRandomPoolPayload
  extends MoveNestedMoveEffectPayloadBase {
  /** The child identity comes only from the reviewed server-side pool draw. */
  readonly canonicalId: null
  readonly source: MoveNestedMoveRandomPoolSource
}

export type MoveNestedMoveEffectPayload =
  | MoveNestedMoveRegisteredSpecPayload
  | MoveNestedMoveRandomPoolPayload

export interface MoveUsageResourceIdentity {
  readonly moveName: string
  readonly moveKey: string
  readonly frequency: string
}

export interface MoveUsageEffectPayload {
  readonly action: MoveEffectUsageAction
  readonly resourceId: string
  readonly amount: number
  /** Supplemental reviewed frequency resource distinct from the declared move. */
  readonly resource?: MoveUsageResourceIdentity
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
  /** Static options are mutually exclusive with a dynamic item choice. */
  readonly options: readonly MoveEffectRequestOption[]
  readonly allowPass: boolean
  readonly itemChoice?: MoveItemChoiceDeclaration
}

export interface MoveReactionCancellationPolicy {
  readonly kind: 'cancel-move'
  /** A failed triggering move still spends its reviewed usage and action costs. */
  readonly retainTriggeringUsage: true
}

export interface MoveReactionRequestEffectPayload {
  readonly requestId: string
  readonly promptKey: string
  readonly options: readonly MoveEffectRequestOption[]
  /** Reactions are optional; pass closes only this priority window. */
  readonly allowPass: true
  readonly timing: MoveReactionTiming
  readonly priority: number
  /**
   * Server handlers may materialize concrete placement owners from an immutable
   * snapshot. Static specs leave this absent and use the operation selector.
   */
  readonly ownerPlacementIds?: readonly string[]
  /** Selecting an option cancels later mechanics while retaining usage/costs. */
  readonly cancellation?: MoveReactionCancellationPolicy
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
export type MoveLoyaltyEffectOperation = MoveEffectOperationEnvelope<'loyalty', MoveLoyaltyEffectPayload>
export type MoveHealEffectOperation = MoveEffectOperationEnvelope<'heal', MoveHealEffectPayload>
export type MoveConditionEffectOperation = MoveEffectOperationEnvelope<'condition', MoveConditionEffectPayload>
export type MoveCombatStageEffectOperation = MoveEffectOperationEnvelope<'combat-stage', MoveCombatStageEffectPayload>
export type MoveTemporaryEffectOperation = MoveEffectOperationEnvelope<'temporary-effect', MoveTemporaryEffectPayload>
export type MoveFieldEffectOperation = MoveEffectOperationEnvelope<'field', MoveFieldEffectPayload>
export type MoveHazardEffectOperation = MoveEffectOperationEnvelope<'hazard', MoveHazardEffectPayload>
export type MoveMovementRequestEffectOperation = MoveEffectOperationEnvelope<'movement-request', MoveMovementRequestEffectPayload>
export type MoveSwitchRequestEffectOperation = MoveEffectOperationEnvelope<'switch-request', MoveSwitchRequestEffectPayload>
export type MoveNestedMoveEffectOperation = MoveEffectOperationEnvelope<'nested-move', MoveNestedMoveEffectPayload>
export type MoveItemEffectOperation = MoveEffectOperationEnvelope<'item', MoveItemEffectPayload>
export type MovePermanentMoveListEffectOperation = MoveEffectOperationEnvelope<
  'permanent-move-list',
  MovePermanentMoveListEffectPayload
>
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
  | MoveLoyaltyEffectOperation
  | MoveHealEffectOperation
  | MoveConditionEffectOperation
  | MoveCombatStageEffectOperation
  | MoveTemporaryEffectOperation
  | MoveFieldEffectOperation
  | MoveHazardEffectOperation
  | MoveMovementRequestEffectOperation
  | MoveSwitchRequestEffectOperation
  | MoveNestedMoveEffectOperation
  | MoveItemEffectOperation
  | MovePermanentMoveListEffectOperation
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
const SCALAR_ROLL_OPTIONAL_FIELDS = ['accuracyRule', 'evasionRule'] as const
const TABLE_ROLL_FIELDS = ['rollId', 'formula', 'table'] as const
const TABLE_ROLL_OPTIONAL_FIELDS = ['accuracyRollTrigger'] as const
const CONDITIONAL_ACCURACY_RULE_FIELDS = ['kind', 'predicate', 'sourceId', 'reasonCode'] as const
const CONDITIONAL_EVASION_RULE_FIELDS = ['kind', 'sourceId', 'reasonCode'] as const
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
const CHOICE_BRANCH_REQUIRED_FIELDS = [
  'kind',
  'selectionId',
  'scope',
  'requestId',
  'promptKey',
  'options',
  'pass',
] as const
const CHOICE_BRANCH_FIELDS = [...CHOICE_BRANCH_REQUIRED_FIELDS, 'owner'] as const
const BRANCH_PATH_FIELDS = ['id', 'operationIds'] as const
const RELATIONSHIP_BRANCH_PATH_FIELDS = ['self', 'ally', 'enemy', 'unknown'] as const
const CHOICE_BRANCH_OPTION_REQUIRED_FIELDS = ['id', 'labelKey', 'operationIds'] as const
const DAMAGE_REQUIRED_FIELDS = [
  'damageClass',
  'damageBase',
  'moveType',
  'accuracyRollId',
  'criticalRollId',
] as const
const DAMAGE_CLASS_SELECTION_FIELDS = [
  'kind',
  'operator',
  'left',
  'right',
  'whenTrue',
  'whenFalse',
] as const
const DAMAGE_OPTIONAL_FIELDS = [
  'typeEffectiveness',
  'criticalHit',
  'attackStat',
  'defenseStat',
  'preTypeDamageModifiers',
] as const
const PRE_TYPE_DAMAGE_MODIFIER_FIELDS = [
  'id',
  'priority',
  'stackingGroup',
  'reasonCode',
  'value',
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
const MULTI_HIT_EFFECT_REQUIRED_FIELDS = [
  'id',
  'timing',
  'trigger',
  'recipient',
  'kind',
  'reasonCode',
  'payload',
] as const
const MULTI_HIT_EFFECT_OPTIONAL_FIELDS = ['naturalAccuracyMinimum'] as const
const CONTEXTUAL_DAMAGE_BASE_FIELDS = [
  'kind',
  'expression',
  'minimum',
  'maximum',
  'rounding',
  'stabTiming',
] as const
const TYPE_EFFECTIVENESS_REQUIRED_FIELDS = [
  'immunity',
  'resistance',
  'weakness',
  'effectivenessOverride',
  'defenderTypeOverrides',
] as const
const TYPE_EFFECTIVENESS_OPTIONAL_FIELDS = ['passiveImmunity'] as const
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
const HEAL_REQUIRED_FIELDS = [
  'mode',
  'pool',
  'calculation',
  'bounds',
  'rounding',
  'injury',
] as const
const HEAL_OPTIONAL_FIELDS = ['operationOutcomeTrigger'] as const
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
  'operationOutcomeTrigger',
  'applyMoveImmunity',
  'applyTypeImmunity',
  'duration',
  'saveTiming',
  'stackPolicy',
] as const
const CONDITION_FILTER_FIELDS = ['groups', 'conditionIds', 'excludedConditionIds'] as const
const CONDITION_RANDOM_CHOICE_FIELDS = ['rollId', 'conditionIds'] as const
const CONDITION_ACCURACY_ROLL_TRIGGER_FIELDS = ['rollId', 'trigger'] as const
const CONDITION_OPERATION_OUTCOME_TRIGGER_FIELDS = ['operationId', 'outcome'] as const
const CONDITION_DURATION_REQUIRED_FIELDS = ['effectId', 'duration'] as const
const CONDITION_DURATION_OPTIONAL_FIELDS = [
  'sourcePlacementId',
  'charges',
  'transferPolicy',
] as const
const CONDITION_STACK_POLICY_FIELDS = ['kind', 'maxStacks'] as const
const COMBAT_STAGE_REQUIRED_FIELDS = ['action', 'stage', 'value'] as const
const COMBAT_STAGE_OPTIONAL_FIELDS = [
  'selectedStage',
  'stageSource',
  'rounding',
  'applyTypeImmunity',
  'trigger',
] as const
const COMBAT_STAGE_ACCURACY_TRIGGER_FIELDS = [
  'kind',
  'rollId',
  'trigger',
  'scope',
  'application',
] as const
const COMBAT_STAGE_OPERATION_TRIGGER_FIELDS = [
  'kind',
  'operationId',
  'outcome',
] as const
const ADD_TEMPORARY_EFFECT_FIELDS = ['action', 'effectId', 'definition', 'recipientScope', 'accuracyRollTrigger'] as const
const LEGACY_ADD_TEMPORARY_EFFECT_FIELDS = ['action', 'effectId', 'definition'] as const
const REMOVE_TEMPORARY_EFFECT_FIELDS = ['action', 'effectId'] as const
const APPLY_FIELD_FIELDS = ['action', 'category', 'fieldId', 'rounds'] as const
const REMOVE_FIELD_FIELDS = ['action', 'category', 'fieldId'] as const
const MUTATE_FIELD_FIELDS = ['action', 'mutation'] as const
const BATTLEFIELD_ZONE_FILTER_FIELDS = [
  'zoneKinds',
  'source',
  'side',
  'requiredTags',
  'geometry',
] as const
const BATTLEFIELD_ZONE_TARGET_MUTATION_FIELDS = ['kind', 'target'] as const
const BATTLEFIELD_ZONE_TRANSFER_MUTATION_FIELDS = [
  'kind',
  'target',
  'destinationSide',
] as const
const BATTLEFIELD_ZONE_SWAP_MUTATION_FIELDS = [
  'kind',
  'counterpartSide',
  'zoneKinds',
  'requiredTags',
] as const
const BATTLEFIELD_ZONE_SUPPRESS_MUTATION_FIELDS = [
  'kind',
  'target',
  'sourceZoneId',
] as const
const BATTLEFIELD_ZONE_CONSUME_TERRAIN_MUTATION_FIELDS = [
  'kind',
  'geometry',
  'includeGlobal',
] as const
const ADD_HAZARD_FIELDS = [
  'action',
  'familyId',
  'zoneKind',
  'effectId',
  'ownership',
  'geometry',
  'layers',
  'maxLayers',
  'charges',
  'maxCharges',
] as const
const ADD_HAZARD_SELECTION_FIELDS = [...ADD_HAZARD_FIELDS, 'cellSelection'] as const
const HAZARD_CELL_SELECTION_FIELDS = [
  'requestId',
  'promptKey',
  'count',
  'range',
  'adjacency',
  'connectedness',
  'occupancy',
  'geometry',
] as const
const HAZARD_GEOMETRY_POLICY_FIELDS = ['kind', 'count', 'adjacency', 'connectedness'] as const
const HAZARD_SELECTION_GEOMETRY_FIELDS = [...HAZARD_GEOMETRY_POLICY_FIELDS, 'cellSetId'] as const
const HAZARD_BLAST_GEOMETRY_FIELDS = [...HAZARD_GEOMETRY_POLICY_FIELDS, 'center', 'size'] as const
const HAZARD_LINE_GEOMETRY_FIELDS = [...HAZARD_GEOMETRY_POLICY_FIELDS, 'length'] as const
const REMOVE_HAZARD_FIELDS = ['action', 'target'] as const
const HAZARD_ZONE_ID_REMOVAL_FIELDS = ['kind', 'zoneId'] as const
const HAZARD_MATCHING_REMOVAL_FIELDS = [
  'kind',
  'zoneKinds',
  'ownership',
  'familyId',
  'geometry',
] as const
const SWAP_HAZARD_SIDES_FIELDS = ['action', 'zoneKinds'] as const
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
const AREA_EXIT_MOVEMENT_DISTANCE_FIELDS = ['kind', 'maximum'] as const
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
  'trigger',
  'required',
  'passPolicy',
  'positionPolicy',
  'initiativePolicy',
  'stateTransferPolicy',
] as const
const NESTED_MOVE_FIELDS = ['canonicalId', 'actor', 'source', 'targeting'] as const
const NESTED_MOVE_ACTOR_FIELDS = ['kind'] as const
const NESTED_MOVE_SOURCE_FIELDS = ['kind'] as const
const NESTED_MOVE_RANDOM_POOL_SOURCE_FIELDS = ['kind', 'pool'] as const
const NESTED_MOVE_RECIPIENT_TARGETING_FIELDS = ['kind'] as const
const NESTED_MOVE_FRESH_TARGETING_FIELDS = [
  'kind',
  'requestId',
  'promptKey',
  'selector',
] as const
const USAGE_REQUIRED_FIELDS = ['action', 'resourceId', 'amount'] as const
const USAGE_OPTIONAL_FIELDS = ['resource'] as const
const USAGE_RESOURCE_FIELDS = ['moveName', 'moveKey', 'frequency'] as const
const LOYALTY_FIELDS = ['action', 'amount', 'minimum'] as const
const HISTORY_FIELDS = ['event', 'detailCode'] as const
const LOG_FIELDS = ['messageKey', 'arguments'] as const
const LOG_ARGUMENT_FIELDS = ['key', 'value'] as const
const REQUEST_FIELDS = ['requestId', 'promptKey', 'options', 'allowPass'] as const
const ITEM_CHOICE_REQUEST_FIELDS = [...REQUEST_FIELDS, 'itemChoice'] as const
const REACTION_REQUEST_REQUIRED_FIELDS = [
  'requestId',
  'promptKey',
  'options',
  'allowPass',
  'timing',
  'priority',
] as const
const REACTION_REQUEST_OPTIONAL_FIELDS = [
  'ownerPlacementIds',
  'cancellation',
] as const
const REACTION_CANCELLATION_FIELDS = ['kind', 'retainTriggeringUsage'] as const
const REQUEST_OPTION_FIELDS = ['id', 'labelKey'] as const

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ARRAY_INDEX_PATTERN = /^(0|[1-9][0-9]*)$/

const OPERATION_KIND_SET = new Set<string>(MOVE_EFFECT_OPERATION_KINDS)
const SOURCE_KIND_SET = new Set<string>(MOVE_EFFECT_SOURCE_KINDS)
const RECIPIENT_KIND_SET = new Set<string>(MOVE_EFFECT_RECIPIENT_SELECTOR_KINDS)
const TEMPORARY_RECIPIENT_SCOPE_SET = new Set<string>(MOVE_EFFECT_TEMPORARY_RECIPIENT_SCOPES)
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
const BRANCH_CHOICE_OWNER_SET = new Set<string>(MOVE_EFFECT_BRANCH_CHOICE_OWNERS)
const NESTED_MOVE_ACTOR_KIND_SET = new Set<string>(MOVE_EFFECT_NESTED_MOVE_ACTOR_KINDS)
const NESTED_MOVE_SOURCE_KIND_SET = new Set<string>(MOVE_EFFECT_NESTED_MOVE_SOURCE_KINDS)
const NESTED_MOVE_TARGETING_KIND_SET = new Set<string>(MOVE_EFFECT_NESTED_MOVE_TARGETING_KINDS)
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
const COMBAT_STAGE_ACCURACY_TRIGGER_SCOPE_SET = new Set<string>(
  MOVE_COMBAT_STAGE_ACCURACY_TRIGGER_SCOPES,
)
const COMBAT_STAGE_ACCURACY_TRIGGER_APPLICATION_SET = new Set<string>(
  MOVE_COMBAT_STAGE_ACCURACY_TRIGGER_APPLICATIONS,
)
const COMBAT_STAGE_OPERATION_TRIGGER_OUTCOME_SET = new Set<string>(
  MOVE_COMBAT_STAGE_OPERATION_TRIGGER_OUTCOMES,
)
const FIELD_CATEGORY_SET = new Set<string>(MOVE_EFFECT_FIELD_CATEGORIES)
const BATTLEFIELD_ZONE_KIND_SET = new Set<string>(MOVE_EFFECT_BATTLEFIELD_ZONE_KINDS)
const BATTLEFIELD_ZONE_SOURCE_FILTER_SET = new Set<string>(
  MOVE_EFFECT_BATTLEFIELD_ZONE_SOURCE_FILTERS,
)
const BATTLEFIELD_ZONE_SIDE_FILTER_SET = new Set<string>(
  MOVE_EFFECT_BATTLEFIELD_ZONE_SIDE_FILTERS,
)
const BATTLEFIELD_ZONE_SIDE_REFERENCE_SET = new Set<string>(
  MOVE_EFFECT_BATTLEFIELD_ZONE_SIDE_REFERENCES,
)
const BATTLEFIELD_ZONE_MUTATION_SET = new Set<string>(
  MOVE_EFFECT_BATTLEFIELD_ZONE_MUTATIONS,
)
const HAZARD_ZONE_KIND_SET = new Set<string>(MOVE_EFFECT_HAZARD_ZONE_KINDS)
const HAZARD_OWNERSHIP_SET = new Set<string>(MOVE_EFFECT_HAZARD_OWNERSHIP_KINDS)
const HAZARD_OWNERSHIP_FILTER_SET = new Set<string>(
  MOVE_EFFECT_HAZARD_OWNERSHIP_FILTER_KINDS,
)
const HAZARD_GEOMETRY_KIND_SET = new Set<string>(MOVE_EFFECT_HAZARD_GEOMETRY_KINDS)
const HAZARD_GEOMETRY_ADJACENCY_SET = new Set<string>(
  MOVE_HAZARD_CELL_SELECTION_ADJACENCY_KINDS,
)
const HAZARD_GEOMETRY_CONNECTEDNESS_SET = new Set<string>(
  MOVE_HAZARD_CELL_SELECTION_CONNECTEDNESS_KINDS,
)
const HAZARD_BLAST_CENTER_SET = new Set<string>(MOVE_EFFECT_HAZARD_BLAST_CENTERS)
const HAZARD_REMOVAL_TARGET_KIND_SET = new Set<string>(
  MOVE_EFFECT_HAZARD_REMOVAL_TARGET_KINDS,
)
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
const SWITCH_TRIGGER_SET = new Set<string>(MOVE_EFFECT_SWITCH_TRIGGERS)
const SWITCH_PASS_POLICY_SET = new Set<string>(MOVE_EFFECT_SWITCH_PASS_POLICIES)
const SWITCH_STATE_TRANSFER_POLICY_SET = new Set<string>(
  MOVE_EFFECT_SWITCH_STATE_TRANSFER_POLICIES,
)
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
  requiredKeys: readonly string[] = expectedKeys,
): void => {
  const expected = new Set(expectedKeys)
  const actual = Object.getOwnPropertyNames(record)
  const missing = requiredKeys.filter(key => !Object.prototype.hasOwnProperty.call(record, key))
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

const parseRandomSelectionNode = <Value>(
  parse: () => Value,
): Value => {
  try {
    return parse()
  }
  catch (error) {
    if (!(error instanceof MoveRandomSelectionValidationError)) throw error
    const detailPrefix = `${error.path}: `
    const detail = error.message.startsWith(detailPrefix)
      ? error.message.slice(detailPrefix.length)
      : error.message
    return fail(
      error.code === 'limit-exceeded'
        ? 'limit-exceeded'
        : error.code === 'not-json'
          ? 'not-json'
          : error.code === 'duplicate-id'
            ? 'duplicate-id'
            : 'invalid-effect-operation',
      error.path,
      detail,
    )
  }
}

const parseConditionalAccuracyRule = (
  value: unknown,
  path: string,
): MoveConditionalAutomaticHitRule => {
  const input = parseExactRecord(value, CONDITIONAL_ACCURACY_RULE_FIELDS, path)
  if (ownValue(input, 'kind', path) !== 'automatic-hit-when') {
    fail(
      'invalid-effect-operation',
      `${path}.kind`,
      'must be automatic-hit-when.',
    )
  }
  let predicate: MovePredicate
  try {
    predicate = parseMovePredicate(ownValue(input, 'predicate', path), `${path}.predicate`)
  }
  catch (error) {
    if (error instanceof MovePredicateValidationError) {
      return fail(
        error.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-effect-operation',
        error.path,
        error.message.slice(error.path.length + 2),
      )
    }
    throw error
  }
  return {
    kind: 'automatic-hit-when',
    predicate,
    sourceId: parseStableId(ownValue(input, 'sourceId', path), `${path}.sourceId`),
    reasonCode: parseStableId(ownValue(input, 'reasonCode', path), `${path}.reasonCode`),
  }
}

const parseConditionalEvasionRule = (
  value: unknown,
  path: string,
): MoveConditionalEvasionRule => {
  const input = parseExactRecord(value, CONDITIONAL_EVASION_RULE_FIELDS, path)
  const kind = ownValue(input, 'kind', path) as string
  if (kind !== 'ignore-when-flanked' && kind !== 'ignore-always') {
    fail(
      'invalid-effect-operation',
      `${path}.kind`,
      'must be ignore-when-flanked or ignore-always.',
    )
  }
  return {
    kind: kind as MoveConditionalEvasionRule['kind'],
    sourceId: parseStableId(ownValue(input, 'sourceId', path), `${path}.sourceId`),
    reasonCode: parseStableId(ownValue(input, 'reasonCode', path), `${path}.reasonCode`),
  }
}

const parseRollPayload = (value: unknown, path: string): MoveRollEffectPayload => {
  const raw = parseRecord(value, path)
  const formula = parseRollFormula(ownValue(raw, 'formula', path), `${path}.formula`)
  if (formula.kind !== 'table') {
    const input = parseRecordWithOptionalFields(
      raw,
      ROLL_FIELDS,
      SCALAR_ROLL_OPTIONAL_FIELDS,
      path,
    )
    const hasAccuracyRule = Object.prototype.hasOwnProperty.call(input, 'accuracyRule')
    const hasEvasionRule = Object.prototype.hasOwnProperty.call(input, 'evasionRule')
    return {
      rollId: parseStableId(ownValue(input, 'rollId', path), `${path}.rollId`),
      formula,
      ...(hasAccuracyRule
        ? {
            accuracyRule: parseConditionalAccuracyRule(
              ownValue(input, 'accuracyRule', path),
              `${path}.accuracyRule`,
            ),
          }
        : {}),
      ...(hasEvasionRule
        ? {
            evasionRule: parseConditionalEvasionRule(
              ownValue(input, 'evasionRule', path),
              `${path}.evasionRule`,
            ),
          }
        : {}),
    }
  }

  const input = parseRecordWithOptionalFields(
    raw,
    TABLE_ROLL_FIELDS,
    TABLE_ROLL_OPTIONAL_FIELDS,
    path,
  )
  const rollId = parseStableId(ownValue(input, 'rollId', path), `${path}.rollId`)
  if (rollId.length > MOVE_RANDOM_SELECTION_LIMITS.rollIdLength) {
    fail(
      'limit-exceeded',
      `${path}.rollId`,
      `random-table roll IDs must contain at most ${MOVE_RANDOM_SELECTION_LIMITS.rollIdLength} characters.`,
    )
  }
  const table = parseRandomSelectionNode(() => parseMoveRandomTableDefinition(
    ownValue(input, 'table', path),
    `${path}.table`,
  ))
  if (table.tableId !== formula.tableId) {
    fail(
      'invalid-effect-operation',
      `${path}.table.tableId`,
      `must match formula table ID ${formula.tableId}.`,
    )
  }
  const hasAccuracyRollTrigger = Object.prototype.hasOwnProperty.call(
    input,
    'accuracyRollTrigger',
  )
  return {
    rollId,
    formula,
    table,
    ...(hasAccuracyRollTrigger
      ? {
          accuracyRollTrigger: parseAccuracyRollTrigger(
            ownValue(input, 'accuracyRollTrigger', path),
            `${path}.accuracyRollTrigger`,
          ),
        }
      : {}),
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
  const input = parseRecordWithOptionalFields(
    value,
    TYPE_EFFECTIVENESS_REQUIRED_FIELDS,
    TYPE_EFFECTIVENESS_OPTIONAL_FIELDS,
    path,
  )
  const hasPassiveImmunity = Object.prototype.hasOwnProperty.call(input, 'passiveImmunity')
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
    ...(hasPassiveImmunity ? {
      passiveImmunity: parseEnum<MoveEffectTypeMatchupPolicy>(
        ownValue(input, 'passiveImmunity', path),
        TYPE_MATCHUP_POLICY_SET,
        `${path}.passiveImmunity`,
        'honor or ignore',
      ),
    } : {}),
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

const parseDamageClass = (
  value: unknown,
  path: string,
): MoveDamageClass => {
  if (typeof value === 'string') {
    return parseEnum<MoveEffectDamageClass>(
      value,
      DAMAGE_CLASS_SET,
      path,
      'physical or special',
    )
  }
  const input = parseExactRecord(value, DAMAGE_CLASS_SELECTION_FIELDS, path)
  if (ownValue(input, 'kind', path) !== 'compare-stats') {
    fail('invalid-effect-operation', `${path}.kind`, 'must be compare-stats.')
  }
  if (ownValue(input, 'operator', path) !== 'less-than') {
    fail('invalid-effect-operation', `${path}.operator`, 'must be less-than.')
  }
  const whenTrue = parseEnum<MoveEffectDamageClass>(
    ownValue(input, 'whenTrue', path),
    DAMAGE_CLASS_SET,
    `${path}.whenTrue`,
    'physical or special',
  )
  const whenFalse = parseEnum<MoveEffectDamageClass>(
    ownValue(input, 'whenFalse', path),
    DAMAGE_CLASS_SET,
    `${path}.whenFalse`,
    'physical or special',
  )
  if (whenTrue === whenFalse) {
    fail(
      'invalid-effect-operation',
      path,
      'a damage-class comparison must select distinct outcomes.',
    )
  }
  return {
    kind: 'compare-stats',
    operator: 'less-than',
    left: parseDamageStatSelection(ownValue(input, 'left', path), `${path}.left`),
    right: parseDamageStatSelection(ownValue(input, 'right', path), `${path}.right`),
    whenTrue,
    whenFalse,
  }
}

const parsePreTypeDamageModifiers = (
  value: unknown,
  path: string,
): readonly MovePreTypeDamageModifier[] => {
  const modifiers = parseBoundedArray(
    value,
    path,
    MOVE_EFFECT_OPERATION_LIMITS.preTypeDamageModifiers,
  ).map((modifier, index): MovePreTypeDamageModifier => {
    const modifierPath = `${path}[${index}]`
    const input = parseExactRecord(modifier, PRE_TYPE_DAMAGE_MODIFIER_FIELDS, modifierPath)
    return {
      id: parseStableId(ownValue(input, 'id', modifierPath), `${modifierPath}.id`),
      priority: parseInteger(
        ownValue(input, 'priority', modifierPath),
        `${modifierPath}.priority`,
        -MOVE_EFFECT_PRE_TYPE_DAMAGE_MODIFIER_PRIORITY_MAGNITUDE,
        MOVE_EFFECT_PRE_TYPE_DAMAGE_MODIFIER_PRIORITY_MAGNITUDE,
      ),
      stackingGroup: parseStableId(
        ownValue(input, 'stackingGroup', modifierPath),
        `${modifierPath}.stackingGroup`,
      ),
      reasonCode: parseStableId(
        ownValue(input, 'reasonCode', modifierPath),
        `${modifierPath}.reasonCode`,
      ),
      value: parseFiniteNumber(ownValue(input, 'value', modifierPath), `${modifierPath}.value`),
    }
  })
  assertUnique(modifiers.map(modifier => modifier.id), `${path}.id`)
  return modifiers
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
  const hasPreTypeDamageModifiers = Object.prototype.hasOwnProperty.call(
    input,
    'preTypeDamageModifiers',
  )
  return {
    damageClass: parseDamageClass(
      ownValue(input, 'damageClass', path),
      `${path}.damageClass`,
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
    ...(hasPreTypeDamageModifiers ? {
      preTypeDamageModifiers: parsePreTypeDamageModifiers(
        ownValue(input, 'preTypeDamageModifiers', path),
        `${path}.preTypeDamageModifiers`,
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

const parseLoyaltyPayload = (value: unknown, path: string): MoveLoyaltyEffectPayload => {
  const input = parseExactRecord(value, LOYALTY_FIELDS, path)
  if (ownValue(input, 'action', path) !== 'decrease-rank') {
    fail('invalid-effect-operation', `${path}.action`, 'must be decrease-rank.')
  }
  if (ownValue(input, 'amount', path) !== 1) {
    fail('invalid-effect-operation', `${path}.amount`, 'must be exactly 1.')
  }
  if (ownValue(input, 'minimum', path) !== 0) {
    fail('invalid-effect-operation', `${path}.minimum`, 'must be exactly 0.')
  }
  return { action: 'decrease-rank', amount: 1, minimum: 0 }
}

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
  const input = parseRecordWithOptionalFields(
    value,
    HEAL_REQUIRED_FIELDS,
    HEAL_OPTIONAL_FIELDS,
    path,
  )
  const hasOperationOutcomeTrigger = Object.prototype.hasOwnProperty.call(
    input,
    'operationOutcomeTrigger',
  )
  const operationOutcomeTrigger = hasOperationOutcomeTrigger
    ? (() => {
        const triggerPath = `${path}.operationOutcomeTrigger`
        const trigger = parseExactRecord(
          ownValue(input, 'operationOutcomeTrigger', path),
          CONDITION_OPERATION_OUTCOME_TRIGGER_FIELDS,
          triggerPath,
        )
        return {
          operationId: parseStableId(
            ownValue(trigger, 'operationId', triggerPath),
            `${triggerPath}.operationId`,
          ),
          outcome: parseEnum<MoveCombatStageOperationTriggerOutcome>(
            ownValue(trigger, 'outcome', triggerPath),
            COMBAT_STAGE_OPERATION_TRIGGER_OUTCOME_SET,
            `${triggerPath}.outcome`,
            'applied',
          ),
        }
      })()
    : undefined
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
    ...(operationOutcomeTrigger ? { operationOutcomeTrigger } : {}),
    injury,
  }
}

const parseConditionIdList = (
  value: unknown,
  path: string,
  maximum: number,
  minimum = 0,
  requireUnique = true,
): readonly string[] => {
  const ids = parseBoundedArray(value, path, maximum)
    .map((entry, index) => parseStableId(entry, `${path}[${index}]`))
  if (ids.length < minimum) {
    fail('invalid-effect-operation', path, `must contain at least ${minimum} entries.`)
  }
  if (requireUnique) assertUnique(ids, path)
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
      false,
    ),
  }
}

const parseAccuracyRollTrigger = (
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
      'must be range or natural-rolls for an accuracy-triggered effect.',
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
  const input = parseRecordWithOptionalFields(
    value,
    CONDITION_DURATION_REQUIRED_FIELDS,
    CONDITION_DURATION_OPTIONAL_FIELDS,
    path,
  )
  try {
    return {
      effectId: parseStableId(ownValue(input, 'effectId', path), `${path}.effectId`),
      duration: parseEncounterEffectDuration(
        ownValue(input, 'duration', path),
        `${path}.duration`,
      ),
      ...(input.sourcePlacementId === undefined
        ? {}
        : {
            sourcePlacementId: parseStableId(
              input.sourcePlacementId,
              `${path}.sourcePlacementId`,
            ),
          }),
      ...(input.charges === undefined
        ? {}
        : {
            charges: parseInteger(
              input.charges,
              `${path}.charges`,
              1,
              ENCOUNTER_EFFECT_LIMITS.charges,
            ),
          }),
      ...(input.transferPolicy === undefined
        ? {}
        : {
            transferPolicy: parseEncounterEffectTransferPolicy(
              input.transferPolicy,
              `${path}.transferPolicy`,
            ),
          }),
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
    ? parseAccuracyRollTrigger(
        ownValue(input, 'accuracyRollTrigger', path),
        `${path}.accuracyRollTrigger`,
      )
    : undefined
  const hasOperationOutcomeTrigger = Object.prototype.hasOwnProperty.call(
    input,
    'operationOutcomeTrigger',
  )
  const operationOutcomeTrigger = hasOperationOutcomeTrigger
    ? (() => {
        const triggerPath = `${path}.operationOutcomeTrigger`
        const trigger = parseExactRecord(
          ownValue(input, 'operationOutcomeTrigger', path),
          CONDITION_OPERATION_OUTCOME_TRIGGER_FIELDS,
          triggerPath,
        )
        return {
          operationId: parseStableId(
            ownValue(trigger, 'operationId', triggerPath),
            `${triggerPath}.operationId`,
          ),
          outcome: parseEnum<MoveCombatStageOperationTriggerOutcome>(
            ownValue(trigger, 'outcome', triggerPath),
            COMBAT_STAGE_OPERATION_TRIGGER_OUTCOME_SET,
            `${triggerPath}.outcome`,
            'applied',
          ),
        }
      })()
    : undefined
  const hasApplyMoveImmunity = Object.prototype.hasOwnProperty.call(
    input,
    'applyMoveImmunity',
  )
  const applyMoveImmunity = hasApplyMoveImmunity
    ? parseBoolean(ownValue(input, 'applyMoveImmunity', path), `${path}.applyMoveImmunity`)
    : undefined
  const hasApplyTypeImmunity = Object.prototype.hasOwnProperty.call(
    input,
    'applyTypeImmunity',
  )
  const applyTypeImmunity = hasApplyTypeImmunity
    ? parseBoolean(ownValue(input, 'applyTypeImmunity', path), `${path}.applyTypeImmunity`)
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
  if (operationOutcomeTrigger && !['apply', 'replace', 'random-choice'].includes(action)) {
    fail(
      'invalid-effect-operation',
      `${path}.operationOutcomeTrigger`,
      'is supported only when applying a condition.',
    )
  }
  if (hasApplyMoveImmunity && !['apply', 'replace', 'random-choice'].includes(action)) {
    fail(
      'invalid-effect-operation',
      `${path}.applyMoveImmunity`,
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
    ...(operationOutcomeTrigger ? { operationOutcomeTrigger } : {}),
    ...(hasApplyMoveImmunity ? { applyMoveImmunity } : {}),
    ...(hasApplyTypeImmunity ? { applyTypeImmunity } : {}),
    duration,
    saveTiming,
    stackPolicy,
  }
}

const parseCombatStageTrigger = (
  value: unknown,
  path: string,
): MoveCombatStageTrigger => {
  const input = parseRecord(value, path)
  const kind = ownValue(input, 'kind', path)
  if (kind === 'accuracy-roll') {
    assertExactKeys(input, COMBAT_STAGE_ACCURACY_TRIGGER_FIELDS, path)
    const parsed = parseAccuracyRollTrigger({
      rollId: ownValue(input, 'rollId', path),
      trigger: ownValue(input, 'trigger', path),
    }, path)
    return {
      kind,
      ...parsed,
      scope: parseEnum<MoveCombatStageAccuracyTriggerScope>(
        ownValue(input, 'scope', path),
        COMBAT_STAGE_ACCURACY_TRIGGER_SCOPE_SET,
        `${path}.scope`,
        'recipient or resolution',
      ),
      application: parseEnum<MoveCombatStageAccuracyTriggerApplication>(
        ownValue(input, 'application', path),
        COMBAT_STAGE_ACCURACY_TRIGGER_APPLICATION_SET,
        `${path}.application`,
        'once or per-match',
      ),
    }
  }
  if (kind === 'operation-outcome') {
    assertExactKeys(input, COMBAT_STAGE_OPERATION_TRIGGER_FIELDS, path)
    return {
      kind,
      operationId: parseStableId(
        ownValue(input, 'operationId', path),
        `${path}.operationId`,
      ),
      outcome: parseEnum<MoveCombatStageOperationTriggerOutcome>(
        ownValue(input, 'outcome', path),
        COMBAT_STAGE_OPERATION_TRIGGER_OUTCOME_SET,
        `${path}.outcome`,
        'applied',
      ),
    }
  }
  return fail(
    'invalid-effect-operation',
    `${path}.kind`,
    'must be accuracy-roll or operation-outcome.',
  )
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
  const hasApplyTypeImmunity = Object.prototype.hasOwnProperty.call(
    input,
    'applyTypeImmunity',
  )
  const applyTypeImmunity = hasApplyTypeImmunity
    ? parseBoolean(
        ownValue(input, 'applyTypeImmunity', path),
        `${path}.applyTypeImmunity`,
      )
    : undefined
  const trigger = Object.prototype.hasOwnProperty.call(input, 'trigger')
    ? parseCombatStageTrigger(ownValue(input, 'trigger', path), `${path}.trigger`)
    : undefined

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
  if (trigger && action !== 'modify') {
    fail(
      'invalid-effect-operation',
      `${path}.trigger`,
      'is supported only for cap-aware modify operations.',
    )
  }
  if (trigger?.kind === 'accuracy-roll' && trigger.application === 'per-match' && stageValue === 0) {
    fail(
      'invalid-effect-operation',
      `${path}.trigger.application`,
      'per-match requires a non-zero reviewed stage delta.',
    )
  }

  return {
    action,
    stage,
    selectedStage,
    value: stageValue,
    stageSource,
    rounding,
    ...(hasApplyTypeImmunity ? { applyTypeImmunity } : {}),
    ...(trigger ? { trigger } : {}),
  }
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
    const input = parseRecordWithOptionalFields(
      effect,
      MULTI_HIT_EFFECT_REQUIRED_FIELDS,
      MULTI_HIT_EFFECT_OPTIONAL_FIELDS,
      effectPath,
    )
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
      ...(Object.prototype.hasOwnProperty.call(input, 'naturalAccuracyMinimum')
        ? {
            naturalAccuracyMinimum: parseInteger(
              ownValue(input, 'naturalAccuracyMinimum', effectPath),
              `${effectPath}.naturalAccuracyMinimum`,
              1,
              20,
            ),
          }
        : {}),
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
    assertExactKeys(input, ADD_TEMPORARY_EFFECT_FIELDS, path, LEGACY_ADD_TEMPORARY_EFFECT_FIELDS)
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
    const recipientScope = input.recipientScope === undefined
      ? undefined
      : parseEnum<MoveEffectTemporaryRecipientScope>(
          input.recipientScope,
          TEMPORARY_RECIPIENT_SCOPE_SET,
          `${path}.recipientScope`,
          'placements or actor-side',
        )
    const accuracyRollTrigger = input.accuracyRollTrigger === undefined
      ? undefined
      : parseAccuracyRollTrigger(input.accuracyRollTrigger, `${path}.accuracyRollTrigger`)
    return {
      action,
      effectId: parseStableId(ownValue(input, 'effectId', path), `${path}.effectId`),
      definition,
      ...(recipientScope === undefined ? {} : { recipientScope }),
      ...(accuracyRollTrigger === undefined ? {} : { accuracyRollTrigger }),
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

const parseBattlefieldZoneKinds = (
  value: unknown,
  path: string,
): readonly EncounterZoneKind[] => {
  const kinds = parseBoundedArray(
    value,
    path,
    MOVE_EFFECT_OPERATION_LIMITS.battlefieldZoneKinds,
  ).map((entry, index) => parseEnum<EncounterZoneKind>(
    entry,
    BATTLEFIELD_ZONE_KIND_SET,
    `${path}[${index}]`,
    'a supported battlefield-zone kind',
  ))
  if (kinds.length === 0) {
    fail('invalid-effect-operation', path, 'must contain at least one zone kind.')
  }
  assertUnique(kinds, path)
  return kinds
}

const parseBattlefieldZoneTags = (
  value: unknown,
  path: string,
): readonly string[] => {
  const tags = parseBoundedArray(
    value,
    path,
    MOVE_EFFECT_OPERATION_LIMITS.battlefieldZoneTags,
  ).map((entry, index) => parseStableId(entry, `${path}[${index}]`))
  assertUnique(tags, path)
  return tags
}

const parseBattlefieldZoneFilter = (
  value: unknown,
  path: string,
): MoveBattlefieldZoneFilter => {
  const input = parseExactRecord(value, BATTLEFIELD_ZONE_FILTER_FIELDS, path)
  return {
    zoneKinds: parseBattlefieldZoneKinds(
      ownValue(input, 'zoneKinds', path),
      `${path}.zoneKinds`,
    ),
    source: parseEnum<MoveEffectBattlefieldZoneSourceFilter>(
      ownValue(input, 'source', path),
      BATTLEFIELD_ZONE_SOURCE_FILTER_SET,
      `${path}.source`,
      'any, actor, or recipients',
    ),
    side: parseEnum<MoveEffectBattlefieldZoneSideFilter>(
      ownValue(input, 'side', path),
      BATTLEFIELD_ZONE_SIDE_FILTER_SET,
      `${path}.side`,
      'any, neutral, source-side, recipient-side, or other-side',
    ),
    requiredTags: parseBattlefieldZoneTags(
      ownValue(input, 'requiredTags', path),
      `${path}.requiredTags`,
    ),
    geometry: input.geometry === null
      ? null
      : parseHazardGeometry(input.geometry, `${path}.geometry`),
  }
}

const parseBattlefieldZoneMutation = (
  value: unknown,
  path: string,
): MoveBattlefieldZoneMutation => {
  const candidate = parseRecord(value, path)
  const kind = parseEnum<MoveEffectBattlefieldZoneMutationKind>(
    ownValue(candidate, 'kind', path),
    BATTLEFIELD_ZONE_MUTATION_SET,
    `${path}.kind`,
    'a supported battlefield-zone mutation',
  )
  if (kind === 'consume-terrain') {
    const input = parseExactRecord(
      value,
      BATTLEFIELD_ZONE_CONSUME_TERRAIN_MUTATION_FIELDS,
      path,
    )
    return {
      kind,
      geometry: parseHazardGeometry(ownValue(input, 'geometry', path), `${path}.geometry`),
      includeGlobal: parseBoolean(
        ownValue(input, 'includeGlobal', path),
        `${path}.includeGlobal`,
      ),
    }
  }
  if (kind === 'swap-sides') {
    const input = parseExactRecord(value, BATTLEFIELD_ZONE_SWAP_MUTATION_FIELDS, path)
    const counterpartSide = parseEnum<MoveEffectBattlefieldZoneSideReference>(
      ownValue(input, 'counterpartSide', path),
      BATTLEFIELD_ZONE_SIDE_REFERENCE_SET,
      `${path}.counterpartSide`,
      'recipient-side or other-side',
    )
    if (counterpartSide === 'source-side') {
      fail(
        'invalid-effect-operation',
        `${path}.counterpartSide`,
        'cannot swap the source side with itself.',
      )
    }
    return {
      kind,
      counterpartSide: counterpartSide as Exclude<
        MoveEffectBattlefieldZoneSideReference,
        'source-side'
      >,
      zoneKinds: parseBattlefieldZoneKinds(
        ownValue(input, 'zoneKinds', path),
        `${path}.zoneKinds`,
      ),
      requiredTags: parseBattlefieldZoneTags(
        ownValue(input, 'requiredTags', path),
        `${path}.requiredTags`,
      ),
    }
  }

  const fields = kind === 'transfer-side'
    ? BATTLEFIELD_ZONE_TRANSFER_MUTATION_FIELDS
    : kind === 'suppress'
      ? BATTLEFIELD_ZONE_SUPPRESS_MUTATION_FIELDS
      : BATTLEFIELD_ZONE_TARGET_MUTATION_FIELDS
  const input = parseExactRecord(value, fields, path)
  const target = parseBattlefieldZoneFilter(
    ownValue(input, 'target', path),
    `${path}.target`,
  )
  if (kind === 'clear-side') {
    if (target.side === 'any' || target.side === 'neutral') {
      fail(
        'invalid-effect-operation',
        `${path}.target.side`,
        'clear-side requires source-side, recipient-side, or other-side.',
      )
    }
    return { kind, target }
  }
  if (kind === 'transfer-side') {
    if (target.side === 'any' || target.side === 'neutral') {
      fail(
        'invalid-effect-operation',
        `${path}.target.side`,
        'transfer-side requires one authoritative non-neutral source side.',
      )
    }
    const destinationSide = parseEnum<MoveEffectBattlefieldZoneSideReference>(
      ownValue(input, 'destinationSide', path),
      BATTLEFIELD_ZONE_SIDE_REFERENCE_SET,
      `${path}.destinationSide`,
      'source-side, recipient-side, or other-side',
    )
    if (destinationSide === target.side) {
      fail(
        'invalid-effect-operation',
        `${path}.destinationSide`,
        'must differ from the filtered source side.',
      )
    }
    return { kind, target, destinationSide }
  }
  if (kind === 'suppress') {
    if (target.zoneKinds.some(zoneKind => (
      zoneKind !== 'weather' && zoneKind !== 'terrain' && zoneKind !== 'room'
    ))) {
      fail(
        'invalid-effect-operation',
        `${path}.target.zoneKinds`,
        'suppression targets only battlefield-wide Weather, Terrain, or Room zones.',
      )
    }
    return {
      kind,
      target,
      sourceZoneId: parseStableId(
        ownValue(input, 'sourceZoneId', path),
        `${path}.sourceZoneId`,
      ),
    }
  }
  return { kind, target }
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
  if (action === 'mutate') {
    assertExactKeys(input, MUTATE_FIELD_FIELDS, path)
    return {
      action,
      mutation: parseBattlefieldZoneMutation(
        ownValue(input, 'mutation', path),
        `${path}.mutation`,
      ),
    }
  }
  return fail(
    'invalid-effect-operation',
    `${path}.action`,
    'must be apply, remove, or mutate.',
  )
}

const parseHazardCellSelection = (
  value: unknown,
  path: string,
): MoveHazardCellSelectionRequest => {
  const input = parseExactRecord(value, HAZARD_CELL_SELECTION_FIELDS, path)
  let rules: MoveHazardCellSelectionRules
  try {
    rules = parseMoveHazardCellSelectionRules({
      count: ownValue(input, 'count', path),
      range: ownValue(input, 'range', path),
      adjacency: ownValue(input, 'adjacency', path),
      connectedness: ownValue(input, 'connectedness', path),
      occupancy: ownValue(input, 'occupancy', path),
      geometry: ownValue(input, 'geometry', path),
    }, path)
  }
  catch (error) {
    if (error instanceof MoveHazardCellSelectionValidationError) {
      return fail(
        error.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-effect-operation',
        error.path,
        error.detail,
      )
    }
    throw error
  }
  return {
    requestId: parseStableId(ownValue(input, 'requestId', path), `${path}.requestId`),
    promptKey: parseStableId(ownValue(input, 'promptKey', path), `${path}.promptKey`),
    ...rules,
  }
}

const parseHazardGeometryCount = (
  value: unknown,
  path: string,
): MoveHazardCellSelectionCount => {
  try {
    return parseMoveHazardCellSelectionCount(value, path)
  }
  catch (error) {
    if (error instanceof MoveHazardCellSelectionValidationError) {
      return fail(
        error.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-effect-operation',
        error.path,
        error.detail,
      )
    }
    throw error
  }
}

const parseHazardGeometry = (value: unknown, path: string): MoveHazardGeometry => {
  const candidate = parseRecord(value, path)
  const kind = parseEnum<MoveEffectHazardGeometryKind>(
    ownValue(candidate, 'kind', path),
    HAZARD_GEOMETRY_KIND_SET,
    `${path}.kind`,
    'selection, blast, or line',
  )
  const fields = kind === 'selection'
    ? HAZARD_SELECTION_GEOMETRY_FIELDS
    : kind === 'blast'
      ? HAZARD_BLAST_GEOMETRY_FIELDS
      : HAZARD_LINE_GEOMETRY_FIELDS
  const input = parseExactRecord(value, fields, path)
  const common: MoveHazardGeometryPolicy = {
    count: parseHazardGeometryCount(ownValue(input, 'count', path), `${path}.count`),
    adjacency: parseEnum<MoveHazardCellSelectionAdjacency>(
      ownValue(input, 'adjacency', path),
      HAZARD_GEOMETRY_ADJACENCY_SET,
      `${path}.adjacency`,
      'orthogonal or including-diagonal',
    ),
    connectedness: parseEnum<MoveHazardCellSelectionConnectedness>(
      ownValue(input, 'connectedness', path),
      HAZARD_GEOMETRY_CONNECTEDNESS_SET,
      `${path}.connectedness`,
      'none, no-isolated, or connected',
    ),
  }
  if (kind === 'selection') {
    return {
      kind,
      ...common,
      cellSetId: parseStableId(ownValue(input, 'cellSetId', path), `${path}.cellSetId`),
    }
  }
  if (kind === 'blast') {
    return {
      kind,
      ...common,
      center: parseEnum<MoveEffectHazardBlastCenter>(
        ownValue(input, 'center', path),
        HAZARD_BLAST_CENTER_SET,
        `${path}.center`,
        'actor or selected-target',
      ),
      size: parseInteger(
        ownValue(input, 'size', path),
        `${path}.size`,
        1,
        MOVE_EFFECT_OPERATION_LIMITS.hazardGeometrySize,
      ),
    }
  }
  return {
    kind,
    ...common,
    length: parseInteger(
      ownValue(input, 'length', path),
      `${path}.length`,
      1,
      MOVE_EFFECT_OPERATION_LIMITS.hazardGeometrySize,
    ),
  }
}

const parseHazardZoneKinds = (
  value: unknown,
  path: string,
): readonly MoveEffectHazardZoneKind[] => {
  const values = parseBoundedArray(
    value,
    path,
    MOVE_EFFECT_OPERATION_LIMITS.hazardZoneKinds,
  ).map((entry, index) => parseEnum<MoveEffectHazardZoneKind>(
    entry,
    HAZARD_ZONE_KIND_SET,
    `${path}[${index}]`,
    'hazard or pledge',
  ))
  if (values.length === 0) {
    fail('invalid-effect-operation', path, 'must contain at least one zone kind.')
  }
  if (new Set(values).size !== values.length) {
    fail('duplicate-id', path, 'must not contain duplicate zone kinds.')
  }
  return values
}

const sameHazardCount = (
  left: MoveHazardCellSelectionCount,
  right: MoveHazardCellSelectionCount,
): boolean => left.kind === right.kind && (
  left.kind === 'exact'
    ? right.kind === 'exact' && left.count === right.count
    : right.kind === 'up-to'
      && left.minimum === right.minimum
      && left.maximum === right.maximum
)

const assertSelectionMatchesGeometry = (
  selection: MoveHazardCellSelectionRequest,
  geometry: MoveHazardGeometry,
  path: string,
): void => {
  if (geometry.kind !== 'selection') {
    fail(
      'invalid-effect-operation',
      path,
      'is valid only when hazard geometry is selection.',
    )
  }
  if (
    !sameHazardCount(selection.count, geometry.count)
    || selection.adjacency !== geometry.adjacency
    || selection.connectedness !== geometry.connectedness
  ) {
    fail(
      'invalid-effect-operation',
      path,
      'count, adjacency, and connectedness must match the enclosing selection geometry.',
    )
  }
}

const parseHazardRemovalTarget = (
  value: unknown,
  path: string,
): MoveHazardRemovalTarget => {
  const candidate = parseRecord(value, path)
  const kind = parseEnum<MoveEffectHazardRemovalTargetKind>(
    ownValue(candidate, 'kind', path),
    HAZARD_REMOVAL_TARGET_KIND_SET,
    `${path}.kind`,
    'zone-id or matching',
  )
  if (kind === 'zone-id') {
    const input = parseExactRecord(value, HAZARD_ZONE_ID_REMOVAL_FIELDS, path)
    return {
      kind,
      zoneId: parseStableId(ownValue(input, 'zoneId', path), `${path}.zoneId`),
    }
  }
  const input = parseExactRecord(value, HAZARD_MATCHING_REMOVAL_FIELDS, path)
  return {
    kind,
    zoneKinds: parseHazardZoneKinds(ownValue(input, 'zoneKinds', path), `${path}.zoneKinds`),
    ownership: parseEnum<MoveEffectHazardOwnershipFilter>(
      ownValue(input, 'ownership', path),
      HAZARD_OWNERSHIP_FILTER_SET,
      `${path}.ownership`,
      'any, source-side, recipient-side, or neutral',
    ),
    familyId: parseNullableStableId(ownValue(input, 'familyId', path), `${path}.familyId`),
    geometry: input.geometry === null
      ? null
      : parseHazardGeometry(input.geometry, `${path}.geometry`),
  }
}

const parseHazardPayload = (value: unknown, path: string): MoveHazardEffectPayload => {
  const input = parseRecord(value, path)
  const action = ownValue(input, 'action', path)
  if (action === 'add') {
    const hasCellSelection = Object.prototype.hasOwnProperty.call(input, 'cellSelection')
    assertExactKeys(input, hasCellSelection ? ADD_HAZARD_SELECTION_FIELDS : ADD_HAZARD_FIELDS, path)
    const geometry = parseHazardGeometry(ownValue(input, 'geometry', path), `${path}.geometry`)
    const layers = parseInteger(
      ownValue(input, 'layers', path),
      `${path}.layers`,
      1,
      MOVE_EFFECT_OPERATION_LIMITS.hazardLayers,
    )
    const maxLayers = parseInteger(
      ownValue(input, 'maxLayers', path),
      `${path}.maxLayers`,
      1,
      MOVE_EFFECT_OPERATION_LIMITS.hazardLayers,
    )
    if (layers > maxLayers) {
      fail('invalid-effect-operation', `${path}.layers`, 'cannot exceed maxLayers.')
    }
    const charges = parseNullableInteger(
      ownValue(input, 'charges', path),
      `${path}.charges`,
      1,
      MOVE_EFFECT_OPERATION_LIMITS.hazardCharges,
    )
    const maxCharges = parseNullableInteger(
      ownValue(input, 'maxCharges', path),
      `${path}.maxCharges`,
      1,
      MOVE_EFFECT_OPERATION_LIMITS.hazardCharges,
    )
    if ((charges === null) !== (maxCharges === null)) {
      fail(
        'invalid-effect-operation',
        `${path}.charges`,
        'charges and maxCharges must both be null or both be positive integers.',
      )
    }
    if (charges !== null && maxCharges !== null && charges > maxCharges) {
      fail('invalid-effect-operation', `${path}.charges`, 'cannot exceed maxCharges.')
    }
    const cellSelection = hasCellSelection
      ? parseHazardCellSelection(input.cellSelection, `${path}.cellSelection`)
      : null
    if (cellSelection) {
      assertSelectionMatchesGeometry(cellSelection, geometry, `${path}.cellSelection`)
    }
    return {
      action,
      familyId: parseStableId(ownValue(input, 'familyId', path), `${path}.familyId`),
      zoneKind: parseEnum<MoveEffectHazardZoneKind>(
        ownValue(input, 'zoneKind', path),
        HAZARD_ZONE_KIND_SET,
        `${path}.zoneKind`,
        'hazard or pledge',
      ),
      effectId: parseStableId(ownValue(input, 'effectId', path), `${path}.effectId`),
      ownership: parseEnum<MoveEffectHazardOwnership>(
        ownValue(input, 'ownership', path),
        HAZARD_OWNERSHIP_SET,
        `${path}.ownership`,
        'source-side or neutral',
      ),
      geometry,
      layers,
      maxLayers,
      charges,
      maxCharges,
      ...(cellSelection ? { cellSelection } : {}),
    }
  }
  if (action === 'remove') {
    assertExactKeys(input, REMOVE_HAZARD_FIELDS, path)
    return {
      action,
      target: parseHazardRemovalTarget(ownValue(input, 'target', path), `${path}.target`),
    }
  }
  if (action === 'swap-sides') {
    assertExactKeys(input, SWAP_HAZARD_SIDES_FIELDS, path)
    return {
      action,
      zoneKinds: parseHazardZoneKinds(
        ownValue(input, 'zoneKinds', path),
        `${path}.zoneKinds`,
      ),
    }
  }
  return fail(
    'invalid-effect-operation',
    `${path}.action`,
    'must be add, remove, or swap-sides.',
  )
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
): MoveContextualMovementDistance | MoveAreaExitMovementDistance => {
  const candidate = parseRecord(value, path)
  if (ownValue(candidate, 'kind', path) === 'area-exit') {
    const input = parseExactRecord(value, AREA_EXIT_MOVEMENT_DISTANCE_FIELDS, path)
    return {
      kind: 'area-exit',
      maximum: parseInteger(
        ownValue(input, 'maximum', path),
        `${path}.maximum`,
        1,
        MOVE_EFFECT_OPERATION_LIMITS.movementDisplacementDistance,
      ),
    }
  }
  const input = parseExactRecord(value, CONTEXTUAL_MOVEMENT_DISTANCE_FIELDS, path)
  if (ownValue(input, 'kind', path) !== 'expression') {
    return fail('invalid-effect-operation', `${path}.kind`, 'must be expression or area-exit.')
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
  const payload: MoveSwitchRequestEffectPayload = {
    requestId: parseStableId(ownValue(input, 'requestId', path), `${path}.requestId`),
    replacementSetId: parseStableId(
      ownValue(input, 'replacementSetId', path),
      `${path}.replacementSetId`,
    ),
    promptKey: parseStableId(ownValue(input, 'promptKey', path), `${path}.promptKey`),
    trigger: parseEnum<MoveEffectSwitchTrigger>(
      ownValue(input, 'trigger', path),
      SWITCH_TRIGGER_SET,
      `${path}.trigger`,
      'always or on-hit',
    ),
    required: parseBoolean(ownValue(input, 'required', path), `${path}.required`),
    passPolicy: parseEnum<MoveEffectSwitchPassPolicy>(
      ownValue(input, 'passPolicy', path),
      SWITCH_PASS_POLICY_SET,
      `${path}.passPolicy`,
      'stay or recall',
    ),
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
    stateTransferPolicy: parseEnum<MoveEffectSwitchStateTransferPolicy>(
      ownValue(input, 'stateTransferPolicy', path),
      SWITCH_STATE_TRANSFER_POLICY_SET,
      `${path}.stateTransferPolicy`,
      'none or baton-pass',
    ),
  }
  if (payload.required && payload.passPolicy !== 'stay') {
    fail(
      'invalid-effect-operation',
      `${path}.passPolicy`,
      'a mandatory replacement request cannot apply pass mechanics.',
    )
  }
  if (payload.passPolicy === 'recall' && payload.stateTransferPolicy !== 'none') {
    fail(
      'invalid-effect-operation',
      `${path}.stateTransferPolicy`,
      'a recall without replacement cannot transfer state.',
    )
  }
  return payload
}

const parseNestedMovePayload = (
  value: unknown,
  path: string,
): MoveNestedMoveEffectPayload => {
  const input = parseExactRecord(value, NESTED_MOVE_FIELDS, path)
  const actorInput = parseExactRecord(
    ownValue(input, 'actor', path),
    NESTED_MOVE_ACTOR_FIELDS,
    `${path}.actor`,
  )
  const sourceValue = ownValue(input, 'source', path)
  const sourceRecord = parseRecord(sourceValue, `${path}.source`)
  const sourceKind = parseEnum<MoveEffectNestedMoveSourceKind>(
    ownValue(sourceRecord, 'kind', `${path}.source`),
    NESTED_MOVE_SOURCE_KIND_SET,
    `${path}.source.kind`,
    'registered-spec or random-move-pool',
  )
  const targetingValue = ownValue(input, 'targeting', path)
  const targetingInput = parseRecord(targetingValue, `${path}.targeting`)
  const targetingKind = parseEnum<MoveEffectNestedMoveTargetingKind>(
    ownValue(targetingInput, 'kind', `${path}.targeting`),
    NESTED_MOVE_TARGETING_KIND_SET,
    `${path}.targeting.kind`,
    'operation-recipients or fresh-choice',
  )
  const targeting: MoveNestedMoveTargeting = targetingKind === 'operation-recipients'
    ? (() => {
        parseExactRecord(
          targetingValue,
          NESTED_MOVE_RECIPIENT_TARGETING_FIELDS,
          `${path}.targeting`,
        )
        return { kind: 'operation-recipients' as const }
      })()
    : (() => {
        const fresh = parseExactRecord(
          targetingValue,
          NESTED_MOVE_FRESH_TARGETING_FIELDS,
          `${path}.targeting`,
        )
        return {
          kind: 'fresh-choice' as const,
          requestId: parseStableId(
            ownValue(fresh, 'requestId', `${path}.targeting`),
            `${path}.targeting.requestId`,
          ),
          promptKey: parseStableId(
            ownValue(fresh, 'promptKey', `${path}.targeting`),
            `${path}.targeting.promptKey`,
          ),
          selector: parseEffectSelector(
            ownValue(fresh, 'selector', `${path}.targeting`),
            `${path}.targeting.selector`,
          ),
        }
      })()
  const actor: MoveNestedMoveActor = {
    kind: parseEnum<MoveEffectNestedMoveActorKind>(
      ownValue(actorInput, 'kind', `${path}.actor`),
      NESTED_MOVE_ACTOR_KIND_SET,
      `${path}.actor.kind`,
      'parent-actor, sole-recipient, or response-owner',
    ),
  }
  const rawCanonicalId = ownValue(input, 'canonicalId', path)

  if (sourceKind === 'registered-spec') {
    parseExactRecord(sourceValue, NESTED_MOVE_SOURCE_FIELDS, `${path}.source`)
    return {
      canonicalId: parseBoundedText(
        rawCanonicalId,
        `${path}.canonicalId`,
        MOVE_EFFECT_OPERATION_LIMITS.identifierLength,
      ),
      actor,
      source: { kind: 'registered-spec' },
      targeting,
    }
  }

  const source = parseExactRecord(
    sourceValue,
    NESTED_MOVE_RANDOM_POOL_SOURCE_FIELDS,
    `${path}.source`,
  )
  if (rawCanonicalId !== null) {
    fail(
      'invalid-effect-operation',
      `${path}.canonicalId`,
      'must be null when the reviewed random move pool selects the child.',
    )
  }
  return {
    canonicalId: null,
    actor,
    source: {
      kind: 'random-move-pool',
      pool: parseRandomSelectionNode(() => parseMoveRandomMovePoolDefinition(
        ownValue(source, 'pool', `${path}.source`),
        `${path}.source.pool`,
      )),
    },
    targeting,
  }
}

const parseUsagePayload = (value: unknown, path: string): MoveUsageEffectPayload => {
  const input = parseRecordWithOptionalFields(
    value,
    USAGE_REQUIRED_FIELDS,
    USAGE_OPTIONAL_FIELDS,
    path,
  )
  const hasResource = Object.prototype.hasOwnProperty.call(input, 'resource')
  const resource = hasResource
    ? parseExactRecord(ownValue(input, 'resource', path), USAGE_RESOURCE_FIELDS, `${path}.resource`)
    : null
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
    ...(resource
      ? {
          resource: {
            moveName: parseBoundedText(
              ownValue(resource, 'moveName', `${path}.resource`),
              `${path}.resource.moveName`,
              MOVE_EFFECT_OPERATION_LIMITS.textLength,
            ),
            moveKey: parseStableId(
              ownValue(resource, 'moveKey', `${path}.resource`),
              `${path}.resource.moveKey`,
            ),
            frequency: parseBoundedText(
              ownValue(resource, 'frequency', `${path}.resource`),
              `${path}.resource.frequency`,
              MOVE_EFFECT_OPERATION_LIMITS.textLength,
            ),
          },
        }
      : {}),
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
  allowEmpty = false,
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
  if (!allowEmpty && options.length === 0) {
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
  assertExactKeys(input, CHOICE_BRANCH_FIELDS, path, CHOICE_BRANCH_REQUIRED_FIELDS)
  const optionsPath = `${path}.options`
  const options = parseBoundedArray(
    ownValue(input, 'options', path),
    optionsPath,
    MOVE_EFFECT_OPERATION_LIMITS.requestOptions,
  ).map((option, index): MoveChoiceBranchOption => {
    const optionPath = `${optionsPath}[${index}]`
    const entry = parseRecordWithOptionalFields(
      option,
      CHOICE_BRANCH_OPTION_REQUIRED_FIELDS,
      ['predicate'],
      optionPath,
    )
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
      ...(Object.prototype.hasOwnProperty.call(entry, 'predicate')
        ? { predicate: parseEffectPredicate(
            ownValue(entry, 'predicate', optionPath),
            `${optionPath}.predicate`,
          ) }
        : {}),
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
    owner: Object.prototype.hasOwnProperty.call(input, 'owner')
      ? parseEnum<MoveEffectBranchChoiceOwner>(
          ownValue(input, 'owner', path),
          BRANCH_CHOICE_OWNER_SET,
          `${path}.owner`,
          'recipients, actor, or gm',
        )
      : 'recipients',
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
  const candidate = parseRecord(value, path)
  const hasItemChoice = Object.prototype.hasOwnProperty.call(candidate, 'itemChoice')
  const input = parseExactRecord(
    value,
    hasItemChoice ? ITEM_CHOICE_REQUEST_FIELDS : REQUEST_FIELDS,
    path,
  )
  const options = parseRequestOptions(
    ownValue(input, 'options', path),
    `${path}.options`,
    hasItemChoice,
  )
  if (hasItemChoice && options.length > 0) {
    fail(
      'invalid-effect-operation',
      `${path}.options`,
      'dynamic item choices cannot mix server-derived items with static options.',
    )
  }
  let itemChoice: MoveItemChoiceDeclaration | undefined
  if (hasItemChoice) {
    try {
      itemChoice = parseMoveItemChoiceDeclaration(
        ownValue(input, 'itemChoice', path),
        `${path}.itemChoice`,
      )
    }
    catch (error) {
      if (!(error instanceof MoveItemChoiceValidationError)) throw error
      return fail('invalid-effect-operation', `${path}.itemChoice`, error.message)
    }
  }
  return {
    requestId: parseStableId(ownValue(input, 'requestId', path), `${path}.requestId`),
    promptKey: parseStableId(ownValue(input, 'promptKey', path), `${path}.promptKey`),
    options,
    allowPass: parseBoolean(ownValue(input, 'allowPass', path), `${path}.allowPass`),
    ...(itemChoice ? { itemChoice } : {}),
  }
}

const parseReactionRequestPayload = (
  value: unknown,
  path: string,
): MoveReactionRequestEffectPayload => {
  const input = parseRecordWithOptionalFields(
    value,
    REACTION_REQUEST_REQUIRED_FIELDS,
    REACTION_REQUEST_OPTIONAL_FIELDS,
    path,
  )
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
  const hasOwners = Object.prototype.hasOwnProperty.call(input, 'ownerPlacementIds')
  const ownerPlacementIds = hasOwners
    ? parseBoundedArray(
        ownValue(input, 'ownerPlacementIds', path),
        `${path}.ownerPlacementIds`,
        MOVE_EFFECT_OPERATION_LIMITS.requestOptions,
      ).map((value, index) => parseBoundedText(
        value,
        `${path}.ownerPlacementIds[${index}]`,
        MOVE_EFFECT_OPERATION_LIMITS.identifierLength,
      ))
    : undefined
  if (ownerPlacementIds && ownerPlacementIds.length === 0) {
    fail('invalid-effect-operation', `${path}.ownerPlacementIds`, 'must not be empty.')
  }
  if (ownerPlacementIds && new Set(ownerPlacementIds).size !== ownerPlacementIds.length) {
    fail('duplicate-id', `${path}.ownerPlacementIds`, 'must not contain duplicates.')
  }
  const hasCancellation = Object.prototype.hasOwnProperty.call(input, 'cancellation')
  let cancellation: MoveReactionCancellationPolicy | undefined
  if (hasCancellation) {
    const candidate = parseExactRecord(
      ownValue(input, 'cancellation', path),
      REACTION_CANCELLATION_FIELDS,
      `${path}.cancellation`,
    )
    if (ownValue(candidate, 'kind', `${path}.cancellation`) !== 'cancel-move') {
      fail('invalid-effect-operation', `${path}.cancellation.kind`, 'must be cancel-move.')
    }
    if (ownValue(candidate, 'retainTriggeringUsage', `${path}.cancellation`) !== true) {
      fail(
        'invalid-effect-operation',
        `${path}.cancellation.retainTriggeringUsage`,
        'must be true for a failed triggering move.',
      )
    }
    cancellation = { kind: 'cancel-move', retainTriggeringUsage: true }
  }
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
    ...(ownerPlacementIds ? { ownerPlacementIds } : {}),
    ...(cancellation ? { cancellation } : {}),
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
    case 'loyalty':
      if (common.recipients.kind !== 'actor') {
        fail('invalid-effect-operation', `${path}.recipients.kind`, 'Loyalty mutations must address the authoritative actor.')
      }
      return { ...common, kind, payload: parseLoyaltyPayload(payload, payloadPath) }
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
    case 'nested-move': {
      const parsedPayload = parseNestedMovePayload(payload, payloadPath)
      if (
        parsedPayload.targeting.kind === 'fresh-choice'
        && common.recipients.kind === 'none'
        && parsedPayload.actor.kind === 'sole-recipient'
      ) {
        fail(
          'invalid-effect-operation',
          `${path}.recipients.kind`,
          'a sole-recipient child actor requires one authoritative operation recipient.',
        )
      }
      return { ...common, kind, payload: parsedPayload }
    }
    case 'item':
      try {
        return { ...common, kind, payload: parseMoveItemEffectPayload(payload, payloadPath) }
      }
      catch (error) {
        if (!(error instanceof MoveItemEffectValidationError)) throw error
        return fail('invalid-effect-operation', payloadPath, error.message)
      }
    case 'permanent-move-list':
      try {
        if (common.recipients.kind !== 'actor') {
          fail(
            'invalid-effect-operation',
            `${path}.recipients.kind`,
            'permanent move-list mutations must address the authoritative actor.',
          )
        }
        return {
          ...common,
          kind,
          payload: parseMovePermanentMoveListEffectPayload(payload, payloadPath),
        }
      }
      catch (error) {
        if (!(error instanceof MovePermanentMoveListValidationError)) throw error
        return fail('invalid-effect-operation', payloadPath, error.message)
      }
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
