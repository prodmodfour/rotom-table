import { createHash } from 'node:crypto'
import {
  MOVE_EFFECT_OPERATION_LIMITS,
  moveEffectBranchPaths,
  parseMoveEffectOperation,
  type MoveBranchEffectOperation,
  type MoveCheckEffectOperation,
  type MoveChoiceRequestEffectOperation,
  type MoveDamageEffectOperation,
  type MoveEffectOperation,
  type MoveEffectRecipientSelectorKind,
  type MoveHazardEffectOperation,
  type MoveMovementRequestEffectOperation,
  type MoveNestedMoveEffectOperation,
  type MoveNestedMoveRegisteredSpecPayload,
  type MoveReactionRequestEffectOperation,
  type MoveSwitchRequestEffectOperation,
  type MoveEffectSwitchStateTransferPolicy,
  type MoveRollEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationRollLedgerEntry } from '#shared/moveAutomation/random'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import { AA077_KLUTZ_ITEM_REQUIREMENT_ID } from '#shared/abilityAutomation/aa077'
import { AA079_MAGICIAN_TARGET_REQUIREMENT_ID } from '#shared/abilityAutomation/aa079'
import type { PendingMoveResponseOption } from '#shared/moveAutomation/responseOptions'
import {
  MOVE_REACTION_LIMITS,
  moveReactionTimingDefinition,
  type MoveReactionInformationKind,
  type MoveReactionTiming,
} from '#shared/moveAutomation/reactions'
import {
  MOVE_SPEC_LIMITS,
  MOVE_SPEC_PHASES,
  type MoveSpecPhase,
} from '#shared/moveAutomation/spec'
import {
  MOVE_RESOLUTION_TRACE_LIMITS,
  type MoveResolutionAuditTrace,
  type MoveResolutionAuditTraceEventInput,
  type MoveResolutionTraceAncestryEntry,
  type MoveResolutionTraceJsonValue,
} from '#shared/moveAutomation/trace'
import {
  moveAutomationUserAccuracy,
  resolveMoveAutomationTargetEvasion,
} from '~/utils/moveAutomationAccuracy'
import { normalizeConditionName } from '~/utils/statusConditions'
import {
  resolveMoveAutomationAccuracyRoll,
  type MoveAutomationAccuracyRule,
} from '~/utils/moveAutomationResolution'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { createMoveAutomationHpUpdateAccumulator } from '~/utils/moveAutomationHpUpdates'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { CharacterSheet } from '~/types/characterSheet'
import { resistMultiplierOneStepFurther } from '~/utils/typeChart'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import {
  buildMoveAutomationAreaTemplateCells,
  tokensInMoveAutomationArea,
} from '~/utils/moveAutomationAreaTemplates'
import { buildAllVoxelOccupancy } from '~/utils/voxelOccupancy'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { GridAnchor } from '~/types/map'
import type {
  AuthoritativeMoveRulesContext,
  AuthoritativeMoveSheetRead,
} from './context'
import { resolveAuthoritativeMoveUserAccuracy } from './accuracy'
import { resolveMoveAutomationAreaTargets } from './areaTargets'
import {
  executeResolvedMoveChoiceBranch,
  executeServerMoveBranch,
  type ExecutedMoveBranch,
  type MoveBranchSelection,
} from './branches'
import {
  executeMoveCheckOperation,
  type MoveCheckExecution,
  type MoveCheckPendingRequest,
  type MoveCheckResolution,
} from './checks'
import type { MoveContextualDamageBaseResolution } from './damageBase'
import { resolveMoveDamageClass, resolveMoveSpecDamageCalculation } from './damageStats'
import { resolveMoveCriticalHit } from './criticalHits'
import { resolveMoveSpecDamageRollFormula } from './damageRollFormula'
import { resolveMoveEffectCompoundRecipientIds } from './effectRecipientQueries'
import {
  resolveMoveDamageType,
  type MoveDamageTypeResolution,
} from './damageTypes'
import {
  evaluateMovePredicate,
  evaluateMoveSelector,
} from './evaluateExpression'
import {
  executeMoveMultiHitOperation,
  type MoveMultiHitExecution,
} from './multiHit'
import {
  REGISTERED_MOVE_HANDLER_REGISTRY,
  executeRegisteredMoveHandler,
  type RegisteredMoveHandlerOutput,
  type RegisteredMoveHandlerRegistry,
  type RegisteredMoveHandlerTraceEntry,
} from './handlers/registry'
import {
  createMoveResolutionTrace,
  reduceMoveResolutionTrace as appendMoveResolutionTrace,
} from './trace'
import { orderMoveReactionOperationEntries } from './reactionOrder'
import { aa062BoneLordEmpowersMove } from '../abilityAutomation/mechanics/aa062MoveIntegration'
import { aa064MoveOverlayOperations } from '../abilityAutomation/mechanics/aa064MoveIntegration'
import { aa065MoveOverlayOperations } from '../abilityAutomation/mechanics/aa065MoveIntegration'
import { aa066MoveOverlayOperations } from '../abilityAutomation/mechanics/aa066MoveIntegration'
import {
  AA067_AVOIDANCE_REASONS,
  AA067_DELAYED_REACTION_REASON,
  AA067_DISGUISE_REASON,
  aa067MoveOverlayOperations,
} from '../abilityAutomation/mechanics/aa067MoveIntegration'
import { AA067_DELAYED_REACTION_TYPE_SOURCE } from '../abilityAutomation/mechanics/aa067StaticIntegration'
import { applyAa067DeliveryBirdItemChoiceEntries } from '../abilityAutomation/mechanics/aa067ItemIntegration'
import { applyEncounterNumericModifiers } from './encounterNumericModifiers'
import {
  aa069DamageBaseBonus,
  aa069DamageBaseSources,
  aa069FieryCrashMoveType,
} from '../abilityAutomation/mechanics/aa069StaticIntegration'
import {
  aa068MoveOverlayOperations,
  aa068TargetBoundOperationTargetId,
} from '../abilityAutomation/mechanics/aa068MoveIntegration'
import {
  AA069_EMERGENCY_EXIT_REASON,
  AA069_ENFEEBLING_LIPS_REASON,
  AA069_FADE_AWAY_REASON,
  AA069_FIERY_CRASH_REASON,
  aa069MoveOverlayOperations,
} from '../abilityAutomation/mechanics/aa069MoveIntegration'
import {
  AA070_FLAME_TONGUE_REASON,
  AA070_FLASH_FIRE_REASON,
  AA070_FLAVORFUL_AROMA_REASON,
  AA070_FLOWER_POWER_REASON,
  aa070MoveOverlayOperations,
} from '../abilityAutomation/mechanics/aa070MoveIntegration'
import {
  aa071MoveOverlayOperations,
  AA071_FOX_FIRE_REASON,
  AA071_FRIEND_GUARD_REASON,
  AA071_FULL_GUARD_REASON,
} from '../abilityAutomation/mechanics/aa071MoveIntegration'
import {
  AA072_GALE_WINGS_REASON,
  AA072_GALVANIZE_REASON,
  AA072_GIVER_REASON,
  AA072_GOOEY_REASON,
  AA072_GORE_REASON,
  AA072_GORILLA_TACTICS_REASON,
  aa072GiverForcedValue,
  aa072GorillaTacticsSelected,
  aa072MoveOverlayOperations,
  aa072SelectedMoveType,
  applyAa072SelectedMoveOperations,
} from '../abilityAutomation/mechanics/aa072MoveIntegration'
import {
  aa070FlowerPowerDamageOperation,
  aa070FluffyDamageTypeOverlay,
} from '../abilityAutomation/mechanics/aa070StaticIntegration'
import {
  aa071ForecastTypeResolution,
  aa071FrostbiteOperations,
  aa071ResistDamageType,
} from '../abilityAutomation/mechanics/aa071StaticIntegration'
import {
  aa072FurCoatDamageTypeOverlay,
  aa072GorillaTacticsMoveAllowed,
} from '../abilityAutomation/mechanics/aa072StaticIntegration'
import { aa073HeatproofDamageTypeOverlay } from '../abilityAutomation/mechanics/aa073StaticIntegration'
import {
  AA073_GRIM_NEIGH_REASON,
  AA073_GULP_MISSILE_ARM_REASON,
  AA073_GULP_MISSILE_CONSUME_REASON,
  AA073_GULP_MISSILE_DEFENSE_REASON,
  AA073_GULP_MISSILE_HP_REASON,
  AA073_GULP_MISSILE_PARALYZE_REASON,
  AA073_GULP_MISSILE_ROLL_REASON,
  AA073_HEAT_MIRAGE_REASON,
  aa073GulpMissileOwnerId,
  aa073HarvestOwnerId,
  aa073MoveOverlayOperations,
} from '../abilityAutomation/mechanics/aa073MoveIntegration'
import {
  AA074_HELIOVOLT_REASON,
  AA074_HORDE_BREAK_REASON,
  AA074_HONEY_THIEF_TEMP_HP_REASON,
  aa074MoveOverlayOperations,
  applyAa074HoneyThiefOperations,
  applyAa074HordeBreakOperations,
  aa074TargetHasDigestionBuff,
} from '../abilityAutomation/mechanics/aa074MoveIntegration'
import {
  AA075_IGNITION_BOOST_REASON,
  AA075_ILLUSION_BREAK_REASON,
  AA075_INNARDS_OUT_HP_REASON,
  AA075_INNARDS_OUT_OPTION_PREFIX,
  AA075_INNARDS_OUT_REASON,
  aa075MoveOverlayOperations,
} from '../abilityAutomation/mechanics/aa075MoveIntegration'
import {
  AA076_IRON_BARBS_HP_REASON,
  AA076_IRON_BARBS_REASON,
  AA076_JUSTIFIED_REASON,
  AA076_KAMPFGEIST_REASON,
  aa076MoveOverlayOperations,
} from '../abilityAutomation/mechanics/aa076MoveIntegration'
import { aa077MoveOverlayOperations } from '../abilityAutomation/mechanics/aa077MoveIntegration'
import {
  AA078_LIGHTNING_ROD_OPTION_ID,
  AA078_LIGHTNING_ROD_REASON,
  AA078_LIQUID_OOZE_RECOIL_REASON,
  AA078_LULLABY_OPTION_PREFIX,
  AA078_LULLABY_REASON,
  AA078_LUNCHBOX_REASON,
  AA078_MAGIC_BOUNCE_HAZARD_OPTION_ID,
  AA078_MAGIC_BOUNCE_HAZARD_OPERATION_REASON,
  AA078_MAGIC_BOUNCE_HAZARD_REASON,
  AA078_MAGIC_BOUNCE_OPTION_ID,
  AA078_MAGIC_BOUNCE_REASON,
  aa078HasLiquidOozeHitTarget,
  aa078IsDrainMove,
  aa078LullabyTargetOptionId,
  aa078MoveOverlayOperations,
  applyAa078ReviewedOperations,
} from '../abilityAutomation/mechanics/aa078MoveIntegration'
import { aa074HungerModeForPlacement } from '#shared/abilityAutomation/aa074'
import {
  aa075HypnoticAutomaticHit,
  aa075IceScalesDamageTypeOverlay,
  aa075InfiltratorBlocksResponsiveBlessings,
  aa075InfiltratorBypassesTemporaryHp,
} from '../abilityAutomation/mechanics/aa075StaticIntegration'
import {
  aa076InstinctEvasionBonus,
  aa076IronFistDamageBaseBonus,
  aa076KampfgeistDamageTypeOverlay,
  aa076KeenEyeActive,
  aa076TargetWithoutLegacyIlluminate,
  aa076TokenWithEffectiveKeenEye,
} from '../abilityAutomation/mechanics/aa076StaticIntegration'
import { aa078LiquidOozeDamageTypeOverlay } from '../abilityAutomation/mechanics/aa078StaticIntegration'
import {
  AA079_MAGMA_ARMOR_REASON,
  AA079_MIGRAINE_REASON,
  aa079MagmaArmorOwnerForOperation,
  aa079MigraineDamageOperation,
  aa079MoveOverlayOperations,
  applyAa079ReviewedOperations,
} from '../abilityAutomation/mechanics/aa079MoveIntegration'
import {
  AA080_MINUS_REQUEST_REASON,
  AA080_MINUS_STAGE_REASON,
  AA080_MIRROR_ARMOR_REQUEST_REASON,
  AA080_MIRROR_ARMOR_REFLECT_REASON,
  AA080_MOTOR_DRIVE_STAGE_REASON,
  aa080MotorDriveOwnerForOperation,
  aa080MoveOverlayOperations,
  applyAa080ReviewedOperations,
} from '../abilityAutomation/mechanics/aa080MoveIntegration'
import {
  AA081_MUMMY_REQUEST_REASON,
  AA081_MUMMY_SUPPRESS_REASON,
  aa081MummySuppressionSelection,
  aa081MoveOverlayOperations,
} from '../abilityAutomation/mechanics/aa081MoveIntegration'
import { aa081NeutralizingGasBlocksTriggeredAbility } from '../abilityAutomation/mechanics/aa081NeutralizingGasIntegration'
import {
  AA082_PACK_HUNT_HP_REASON,
  AA082_PACK_HUNT_REQUEST_REASON,
  AA082_PARRY_REASON,
  AA082_PERCEPTION_REASON,
  aa082MoveOverlayOperations,
  aa082PackHuntIdentity,
} from '../abilityAutomation/mechanics/aa082MoveIntegration'
import {
  AA083_PERISH_BODY_REASON,
  AA083_PICKPOCKET_REASON,
  AA083_PIXILATE_REASON,
  AA083_PLUS_REQUEST_REASON,
  AA083_PLUS_STAGE_REASON,
  AA083_POISON_HEAL_REASON,
  AA083_POISON_POINT_REASON,
  AA083_POLYCEPHALY_REASON,
  aa083MoveOverlayOperations,
  aa083SelectedMoveType,
  applyAa083ReviewedOperations,
} from '../abilityAutomation/mechanics/aa083MoveIntegration'
import {
  AA084_PROBABILITY_CONTROL_OPTION_PREFIX,
  AA084_PROBABILITY_CONTROL_REASON,
  aa084MoveOverlayOperations,
  aa084ProbabilityControlSelections,
  aa084ProteanSelected,
  applyAa084ReviewedOperations,
} from '../abilityAutomation/mechanics/aa084MoveIntegration'
import {
  AA068_DRAGONS_MAW_REASON,
  AA068_DREAM_SMOKE_REASON,
  AA068_EFFECT_SPORE_REASON,
  aa068DamageTypeOverlay,
  aa068DrySkinCancelsRecipientEffect,
} from '../abilityAutomation/mechanics/aa068StaticIntegration'
import {
  aa065CovertEvasionBonus,
  aa065DampCancelsMove,
  primeAa065MoveRandomness,
} from '../abilityAutomation/mechanics/aa065StaticIntegration'
import {
  aa066DazzlingBlocksInterruptMovesAgainst,
  aa066DecoyEvasionBonus,
} from '../abilityAutomation/mechanics/aa066StaticIntegration'
import {
  createMoveSpecResponseResolver,
  type MoveSpecResolvedResponse,
  type MoveSpecResponseResolver,
} from './responses'
import {
  enumerateAuthoritativeMovementChoices,
  revalidateAuthoritativeMovementChoice,
  type AuthoritativeMovementChoice,
  type AuthoritativeMovementChoiceSet,
} from '../movement/resolveMovementChoices'
import {
  enumerateAuthoritativeSwitchChoices,
  revalidateAuthoritativeSwitchChoice,
  type AuthoritativeSwitchChoice,
  type AuthoritativeSwitchChoiceSet,
} from './switchChoices'
import {
  enumerateAuthoritativeMoveItemChoices,
  revalidateAuthoritativeMoveItemChoice,
  type AuthoritativeMoveItemChoice,
  type AuthoritativeMoveItemChoiceSet,
} from './itemChoices'
import {
  KNOCK_OFF_ITEM_EFFECT_OPERATION,
  KNOCK_OFF_ITEM_REQUEST_ID,
  type KnockOffItemOutcome,
} from './knockOff'
import {
  isKnockOffItemChoiceOperation,
  KnockOffContinuationError,
  planProjectedKnockOffItemContinuation,
} from './knockOffContinuation'
import { primeAa060MoveRandomness } from '../abilityAutomation/mechanics/aa060MoveIntegration'
import { aa061BeamCannonMinimum, primeAa061MoveRandomness } from '../abilityAutomation/mechanics/aa061MoveIntegration'
import { primeAa066MoveRandomness } from '../abilityAutomation/mechanics/aa066StaticIntegration'
import type { ValidatedAuthoritativeHazardCellSelection } from './hazardCellSelection'
import type { MoveSpecV2Runtime } from './registry'
import {
  MovePoolResolutionError,
  resolveAuthoritativeMovePool,
} from './movePools'
import {
  MoveRandomOperationError,
  resolveMoveRandomTable,
  type MoveRandomCandidateResolution,
} from './randomOperations'
import {
  createNestedMoveExecutionBudget,
  NestedMoveExecutionBudgetError,
  type NestedMoveExecutionBudget,
  type NestedMoveExecutionBudgetErrorCode,
  type NestedMoveExecutionPolicy,
} from './nestedExecution'
import {
  validateMoveSpec,
  validateMoveSpecOperationSequence,
  type ValidatedMoveSpec,
  type ValidatedMoveSpecDefinition,
  type ValidatedMoveSpecTargetingRule,
} from './validateSpec'
import { resolveMoveSpecTargetingRule } from './targetingBranches'

const AA080_COMBAT_STAGE_KEYS = new Set(['atk', 'def', 'satk', 'sdef', 'spd', 'acc'] as const)
type Aa080CombatStageKey = 'atk' | 'def' | 'satk' | 'sdef' | 'spd' | 'acc'
const aa080CombatStageKey = (value: unknown): Aa080CombatStageKey | null => (
  typeof value === 'string' && AA080_COMBAT_STAGE_KEYS.has(value as Aa080CombatStageKey)
    ? value as Aa080CombatStageKey
    : null
)

export type MoveSpecExecutionErrorCode =
  | 'definition-integrity-mismatch'
  | 'ruleset-mismatch'
  | 'random-selection-rejected'
  | 'recipient-limit-exceeded'
  | 'authoritative-target-invalid'
  | 'move-mechanics-unavailable'
  | 'damage-formula-unsupported'
  | 'resolved-roll-id-too-long'
  | 'pre-window-operation-forbidden'
  | 'reaction-nesting-limit-exceeded'
  | 'nested-resolution-id-missing'
  | 'nested-runtime-unavailable'
  | 'nested-actor-invalid'
  | 'nested-targeting-invalid'
  | 'nested-operation-id-conflict'
  | 'nested-execution-rejected'
  | `nested-${NestedMoveExecutionBudgetErrorCode}`

export class MoveSpecExecutionError extends Error {
  readonly code: MoveSpecExecutionErrorCode

  constructor(code: MoveSpecExecutionErrorCode, message: string) {
    super(message)
    this.name = 'MoveSpecExecutionError'
    this.code = code
  }
}

export interface MoveSpecEmittedOperation {
  /** The exact reviewed, validated operation. Reducers decide its state semantics later. */
  readonly operation: MoveEffectOperation
  /** Authoritative placement IDs resolved from the operation's recipient selector. */
  readonly recipientIds: readonly string[]
  /** Present only when this operation was emitted by an ancestry-linked child spec. */
  readonly childResolutionId?: string
}

/** Server-only evidence retained for each reviewed child invocation. */
export interface MoveSpecChildExecution {
  readonly resolutionId: string
  readonly parentOperationId: string
  readonly actorPlacementId: string
  readonly canonicalId: string
  readonly definitionHash: string
  readonly operationIds: readonly string[]
  readonly targetIds: readonly string[]
  readonly rootTargetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly rootHitTargetIds: readonly string[]
  readonly missedTargetIds: readonly string[]
  readonly rootMissedTargetIds: readonly string[]
  readonly damagedTargetIds: readonly string[]
  readonly rootDamagedTargetIds: readonly string[]
  readonly faintedTargetIds: readonly string[]
  readonly rootFaintedTargetIds: readonly string[]
  readonly mechanics: MoveAutomationScript
  readonly trace: MoveResolutionAuditTrace
}

export interface MoveSpecResolvedRoll {
  readonly operationId: string
  /** Stable ID authored by a roll operation, or the owning damage operation ID. */
  readonly referenceId: string
  readonly purpose:
    | 'generic'
    | 'hit-count'
    | 'accuracy'
    | 'critical'
    | 'damage'
    | 'check'
  readonly recipientId: string | null
  /** One-based strike position for sequence-owned rolls. */
  readonly hitIndex?: number | null
  readonly checkRole?: 'actor' | 'target' | null
  readonly attemptIndex?: number | null
  readonly rollId: string
}

interface MoveSpecPendingRequestBase {
  readonly operationId: string
  readonly phase: MoveSpecPhase
  readonly reasonCode: string
  readonly recipientIds: readonly string[]
  readonly requestId: string
  readonly promptKey: string
  readonly options: readonly PendingMoveResponseOption[]
  readonly allowPass: boolean
}

export interface MoveSpecPendingChoiceRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'choice'
}

export interface MoveSpecPendingBranchChoiceRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'branch-choice'
  readonly selectionId: string
  readonly scope: 'resolution' | 'recipient'
}

export interface MoveSpecPendingReactionRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'reaction'
  readonly timing: MoveReactionTiming
  readonly priority: number
  readonly depth: number
  readonly revealedInformation: readonly MoveReactionInformationKind[]
}

export interface MoveSpecPendingCheckSelectionRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'check-selection'
  readonly checkId: string
  readonly role: 'actor' | 'target'
}

export interface MoveSpecPendingResourceSpendRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'resource-spend'
  readonly checkId: string
  readonly role: 'actor' | 'target'
  readonly resourceId: string
  readonly amount: number
  readonly checkRecipientId: string
}

export interface MoveSpecPendingMovementRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'movement-choice'
  readonly movementChoiceKind: AuthoritativeMovementChoiceSet['kind']
  readonly destinationSetId: string
}

export interface MoveSpecPendingHazardCellRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'hazard-cell-choice'
  readonly cellSetId: string
  readonly selection: NonNullable<Extract<
    MoveHazardEffectOperation['payload'],
    { readonly action: 'add' }
  >['cellSelection']>
}

export interface MoveSpecPendingSwitchRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'switch-choice'
  readonly replacementSetId: string
}

export interface MoveSpecPendingItemRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'item-choice'
  readonly itemSetId: string
  readonly requirementId: string
}

export interface MoveSpecPendingNestedTargetRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'nested-target-choice'
  readonly childCanonicalId: string
}

export type MoveSpecPendingRequest =
  | MoveSpecPendingChoiceRequest
  | MoveSpecPendingBranchChoiceRequest
  | MoveSpecPendingReactionRequest
  | MoveSpecPendingCheckSelectionRequest
  | MoveSpecPendingResourceSpendRequest
  | MoveSpecPendingMovementRequest
  | MoveSpecPendingHazardCellRequest
  | MoveSpecPendingSwitchRequest
  | MoveSpecPendingItemRequest
  | MoveSpecPendingNestedTargetRequest

export interface MoveSpecResolvedMovement {
  readonly operationId: string
  readonly requestId: string
  readonly optionId: string
  readonly choice: AuthoritativeMovementChoice
}

export interface MoveSpecResolvedSwitch {
  readonly operationId: string
  readonly requestId: string
  /** Null records a reviewed pass that still recalls the actor. */
  readonly optionId: string | null
  /** Null only for a recall-without-replacement result. */
  readonly choice: AuthoritativeSwitchChoice | null
  readonly recalledPlacementId: string
  readonly stateTransferPolicy: MoveEffectSwitchStateTransferPolicy
}

export interface MoveSpecResolvedItemChoice {
  readonly operationId: string
  readonly requestId: string
  readonly optionId: string
  readonly choice: AuthoritativeMoveItemChoice
}

export interface MoveSpecResolvedHazardCells {
  readonly operationId: string
  readonly requestId: string
  readonly cellSetId: string
  readonly selectionId: string
  readonly optionIds: readonly string[]
  readonly cells: readonly GridAnchor[]
}

export interface MoveSpecExecutionRejection {
  readonly code: 'precondition-failed' | 'target-count-out-of-range'
  readonly reasonCode: string
  readonly preconditionId: string | null
  readonly actualTargetCount: number | null
  readonly minimumTargetCount: number | null
  readonly maximumTargetCount: number | null
}

interface MoveSpecExecutionResultBase {
  readonly operations: readonly MoveSpecEmittedOperation[]
  /** Aggregate root and descendant recipients retained for audit/presentation. */
  readonly targetIds: readonly string[]
  /** Root-only recipient sets used by root operation reducers. */
  readonly rootTargetIds: readonly string[]
  readonly rootHitTargetIds: readonly string[]
  readonly rootMissedTargetIds: readonly string[]
  readonly rootDamagedTargetIds: readonly string[]
  readonly rootFaintedTargetIds: readonly string[]
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly rollLedger: readonly MoveAutomationRollLedgerEntry[]
  readonly resolvedRolls: readonly MoveSpecResolvedRoll[]
  /** Per-recipient authoritative move-type/effectiveness calculations in operation order. */
  readonly resolvedDamageTypes: readonly MoveDamageTypeResolution[]
  /** Per-recipient native-v2 contextual DB calculations in operation order. */
  readonly resolvedDamageBases: readonly MoveContextualDamageBaseResolution[]
  /** Pre-reduced bounded strike sequences, retained for immediate typed planning. */
  readonly multiHitExecutions: readonly MoveMultiHitExecution[]
  /** Authoritative opposed-check/save outcomes, including selected branch IDs. */
  readonly resolvedChecks: readonly MoveCheckResolution[]
  /** Server-determined branch paths in reviewed execution order. */
  readonly branchSelections: readonly MoveBranchSelection[]
  /** Fresh oracle result for each answered server-issued movement option. */
  readonly resolvedMovements: readonly MoveSpecResolvedMovement[]
  /** Fresh roster/send-out result for each answered server-issued replacement. */
  readonly resolvedSwitches: readonly MoveSpecResolvedSwitch[]
  /** Fresh authoritative item/destination result for each answered item choice. */
  readonly resolvedItemChoices: readonly MoveSpecResolvedItemChoice[]
  /** Freshly revalidated server-issued hazard cells keyed by operation/cell set. */
  readonly resolvedHazardCells: readonly MoveSpecResolvedHazardCells[]
  /** Full server-only child traces and mechanics, flattened in execution order. */
  readonly childExecutions: readonly MoveSpecChildExecution[]
  readonly hitTargetIds: readonly string[]
  readonly missedTargetIds: readonly string[]
  readonly damagedTargetIds: readonly string[]
  readonly faintedTargetIds: readonly string[]
  readonly trace: MoveResolutionAuditTrace
}

export interface MoveSpecExecutionCompleteResult extends MoveSpecExecutionResultBase {
  readonly kind: 'complete'
}

export interface MoveSpecDeferredContinuation {
  /** Exact phase and operation where authoritative execution suspended. */
  readonly phase: MoveSpecPhase
  readonly requestOperationId: string
  /** Already evaluated operations whose state effects must wait for continuation. */
  readonly operations: readonly MoveSpecEmittedOperation[]
}

export interface MoveSpecExecutionPendingResult extends MoveSpecExecutionResultBase {
  readonly kind: 'pending-request'
  readonly request: MoveSpecPendingRequest
  /** The only accumulated operations eligible for an atomic pre-window commit. */
  readonly preWindowOperations: readonly MoveSpecEmittedOperation[]
  /** Non-committing accumulated work retained for the eventual resume boundary. */
  readonly deferredContinuation: MoveSpecDeferredContinuation
}

export interface MoveSpecExecutionRejectedResult extends MoveSpecExecutionResultBase {
  readonly kind: 'rejected'
  readonly rejection: MoveSpecExecutionRejection
}

export type MoveSpecExecutionResult =
  | MoveSpecExecutionCompleteResult
  | MoveSpecExecutionPendingResult
  | MoveSpecExecutionRejectedResult

export interface MoveSpecAuthoritativeTargetEvaluation {
  readonly targetPlacementId: string
  readonly outcome: 'included' | 'excluded'
  readonly reasonCode: string
}

export interface ExecuteMoveSpecInput {
  /** A server-registered definition. It is revalidated before any phase executes. */
  readonly definition: ValidatedMoveSpecDefinition
  readonly context: AuthoritativeMoveRulesContext
  /** Server-derived geometry recipients; this field never comes from move intent. */
  readonly authoritativeTargetIds?: readonly string[]
  /** Reviewed alternate targeting declaration selected by the move intent. */
  readonly targetBranchId?: string | null
  /** Complete server-only area-filter evidence in geometric candidate order. */
  readonly authoritativeTargetEvaluations?: readonly MoveSpecAuthoritativeTargetEvaluation[]
  readonly ancestry?: readonly MoveResolutionTraceAncestryEntry[]
  /** Stable server-owned root identity; required when a nested operation is reached. */
  readonly resolutionId?: string
  /** Internal-only namespace for one reviewed repeated Dancer/Danger Syrup child definition. */
  readonly reviewedIdentityNamespace?: string
  /** Authorized durable responses, resolved only against reviewed request IDs/options. */
  readonly responses?: readonly MoveSpecResolvedResponse[]
  /** Server-derived effective-ability overlays; never accepted from an intent or response command. */
  readonly serverAbilityOverlayOperations?: readonly MoveEffectOperation[]
  /** Closed server-only targeting override for a manifest-selected ability transformation. */
  readonly serverAbilityTargetingOverride?: ValidatedMoveSpecTargetingRule
  /** Freshly revalidated multi-cell answers; response commands never populate cells. */
  readonly authoritativeHazardCellSelections?: readonly ValidatedAuthoritativeHazardCellSelection[]
  /** Test/migration seam; production resolves only the audited global registry. */
  readonly handlerRegistry?: RegisteredMoveHandlerRegistry
  /** Server-reviewed child deny policy; never parsed from a command or response. */
  readonly nestedExecutionPolicy?: NestedMoveExecutionPolicy
}

interface MoveSpecSelectorState {
  readonly targetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly missedTargetIds: readonly string[]
  readonly damagedTargetIds: readonly string[]
  readonly faintedTargetIds: readonly string[]
  /** Owner selected by a server-authored move-cancelling reaction response. */
  readonly responseOwnerIds?: readonly string[]
}

const fail = (
  code: MoveSpecExecutionErrorCode,
  message: string,
): never => {
  throw new MoveSpecExecutionError(code, message)
}

const enforceNestedExecutionBudget = <Result>(operation: () => Result): Result => {
  try {
    return operation()
  }
  catch (error) {
    if (error instanceof NestedMoveExecutionBudgetError) {
      return fail(`nested-${error.code}`, error.message)
    }
    throw error
  }
}

const enforceRandomSelection = <Result>(operation: () => Result): Result => {
  try {
    return operation()
  }
  catch (error) {
    if (error instanceof MoveRandomOperationError || error instanceof MovePoolResolutionError) {
      return fail('random-selection-rejected', error.message)
    }
    if (error instanceof NestedMoveExecutionBudgetError) {
      return fail(`nested-${error.code}`, error.message)
    }
    throw error
  }
}

const frozenIds = (ids: readonly string[]): readonly string[] => Object.freeze([...ids])

const freezeEmittedOperations = (
  operations: readonly MoveSpecEmittedOperation[],
): readonly MoveSpecEmittedOperation[] => Object.freeze(operations.map(emission => Object.freeze({
  operation: emission.operation,
  recipientIds: frozenIds(emission.recipientIds),
  ...(emission.childResolutionId
    ? { childResolutionId: emission.childResolutionId }
    : {}),
})))

const freezeChildExecutions = (
  executions: readonly MoveSpecChildExecution[],
): readonly MoveSpecChildExecution[] => Object.freeze(executions.map(execution => Object.freeze({
  ...execution,
  operationIds: frozenIds(execution.operationIds),
  targetIds: frozenIds(execution.targetIds),
  rootTargetIds: frozenIds(execution.rootTargetIds),
  hitTargetIds: frozenIds(execution.hitTargetIds),
  rootHitTargetIds: frozenIds(execution.rootHitTargetIds),
  missedTargetIds: frozenIds(execution.missedTargetIds),
  rootMissedTargetIds: frozenIds(execution.rootMissedTargetIds),
  damagedTargetIds: frozenIds(execution.damagedTargetIds),
  rootDamagedTargetIds: frozenIds(execution.rootDamagedTargetIds),
  faintedTargetIds: frozenIds(execution.faintedTargetIds),
  rootFaintedTargetIds: frozenIds(execution.rootFaintedTargetIds),
})))

const freezeResolvedRolls = (
  rolls: readonly MoveSpecResolvedRoll[],
): readonly MoveSpecResolvedRoll[] => Object.freeze(rolls.map(roll => Object.freeze({ ...roll })))

const freezeResolvedDamageTypes = (
  resolutions: readonly MoveDamageTypeResolution[],
): readonly MoveDamageTypeResolution[] => Object.freeze([...resolutions])

const freezeResolvedDamageBases = (
  resolutions: readonly MoveContextualDamageBaseResolution[],
): readonly MoveContextualDamageBaseResolution[] => Object.freeze([...resolutions])

const freezeMultiHitExecutions = (
  executions: readonly MoveMultiHitExecution[],
): readonly MoveMultiHitExecution[] => Object.freeze([...executions])

const freezeResolvedChecks = (
  resolutions: readonly MoveCheckResolution[],
): readonly MoveCheckResolution[] => Object.freeze([...resolutions])

const freezeBranchSelections = (
  selections: readonly MoveBranchSelection[],
): readonly MoveBranchSelection[] => Object.freeze([...selections])

const freezeResolvedMovements = (
  movements: readonly MoveSpecResolvedMovement[],
): readonly MoveSpecResolvedMovement[] => Object.freeze(movements.map(movement => Object.freeze({
  ...movement,
  choice: movement.choice,
})))

const freezeResolvedSwitches = (
  switches: readonly MoveSpecResolvedSwitch[],
): readonly MoveSpecResolvedSwitch[] => Object.freeze(switches.map(switchResult => Object.freeze({
  ...switchResult,
  choice: switchResult.choice,
})))

const freezeResolvedItemChoices = (
  choices: readonly MoveSpecResolvedItemChoice[],
): readonly MoveSpecResolvedItemChoice[] => Object.freeze(choices.map(choice => Object.freeze({
  ...choice,
  choice: choice.choice,
})))

const freezeResolvedHazardCells = (
  selections: readonly MoveSpecResolvedHazardCells[],
): readonly MoveSpecResolvedHazardCells[] => Object.freeze(selections.map(selection => Object.freeze({
  ...selection,
  optionIds: frozenIds(selection.optionIds),
  cells: Object.freeze(selection.cells.map(cell => Object.freeze({ ...cell }))),
})))

const rulesetMatchesContext = (
  definition: ValidatedMoveSpecDefinition,
  context: AuthoritativeMoveRulesContext,
): boolean => (
  definition.rulesetVersion.rulesetId === context.ruleset.rulesetId
  && definition.rulesetVersion.canonicalizationVersion === context.ruleset.canonicalization.version
  && definition.rulesetVersion.sourceDataSha256 === context.ruleset.sourceData.sha256
)

/**
 * Re-run strict parsing before execution. A forged or accidentally mutated
 * definition therefore fails before random draws, trace emission, or planning.
 */
const executableDefinition = (
  input: ExecuteMoveSpecInput,
  handlerRegistry: RegisteredMoveHandlerRegistry,
): ValidatedMoveSpecDefinition => {
  const validated = validateMoveSpec(input.definition.spec, {
    capabilityIds: input.definition.capabilityIds,
    rulesetVersion: input.definition.rulesetVersion,
    handlerRegistry,
  })
  if (
    validated.definitionHash !== input.definition.definitionHash
    || validated.canonicalJson !== input.definition.canonicalJson
  ) {
    fail(
      'definition-integrity-mismatch',
      `MoveSpec ${validated.spec.canonicalId} does not match its reviewed definition hash.`,
    )
  }
  if (!rulesetMatchesContext(validated, input.context)) {
    fail(
      'ruleset-mismatch',
      `MoveSpec ${validated.spec.canonicalId} was not reviewed for the authoritative rules context.`,
    )
  }
  if (input.reviewedIdentityNamespace) {
    const parent = input.context.ancestry.at(-1)
    if (input.reviewedIdentityNamespace !== input.resolutionId
      || parent?.canonicalId !== validated.spec.canonicalId
      || ![
        'ability.dancer.copy.',
        'ability.danger-syrup.sweet-scent.',
        'ability.dig-away.dig.',
        'ability.fox-fire.ember.',
      ].some(prefix => parent.parentOperationId?.startsWith(prefix) === true)) {
      fail(
        'definition-integrity-mismatch',
        'Repeated MoveSpec identity namespacing is authorized only for an exact reviewed Ability child ancestry.',
      )
    }
    return namespaceRepeatedNestedDefinition(validated, input.reviewedIdentityNamespace)
  }
  return validated
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
  return ordered
}

const emptySelectorState = (): MoveSpecSelectorState => ({
  targetIds: [],
  hitTargetIds: [],
  missedTargetIds: [],
  damagedTargetIds: [],
  faintedTargetIds: [],
})

const validatedAuthoritativeTargetIds = (
  context: AuthoritativeMoveRulesContext,
  ids: readonly string[],
): readonly string[] => {
  if (!Array.isArray(ids) || ids.length > MOVE_SPEC_LIMITS.targetCount) {
    return fail(
      'authoritative-target-invalid',
      `Server-derived targets must contain at most ${MOVE_SPEC_LIMITS.targetCount} placement IDs.`,
    )
  }
  const seen = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim() || seen.has(id) || !context.queries.placements.get(id)) {
      return fail(
        'authoritative-target-invalid',
        `Server-derived target ${String(id)} is missing, duplicated, or invalid.`,
      )
    }
    seen.add(id)
  }
  return canonicalPlacementIds(context, ids)
}

const targetIdsForSpec = (
  context: AuthoritativeMoveRulesContext,
  targeting: ValidatedMoveSpecTargetingRule,
  authoritativeTargetIds?: readonly string[],
): readonly string[] => {
  if (targeting.kind === 'none') return []
  if (targeting.kind === 'self') return [context.actor.placement.id]
  if (targeting.kind === 'area' && authoritativeTargetIds === undefined) {
    return fail(
      'authoritative-target-invalid',
      'Geometric area targeting requires server-derived eligible target IDs.',
    )
  }
  if (authoritativeTargetIds !== undefined) {
    return validatedAuthoritativeTargetIds(context, authoritativeTargetIds)
  }
  if (targeting.selector) {
    return evaluateMoveSelector({
      context,
      selectorState: emptySelectorState(),
      selector: targeting.selector,
    })
  }
  return canonicalPlacementIds(
    context,
    context.selectedPlacements.map(({ id }) => id),
  )
}

const authoritativeTargetEvaluations = (
  context: AuthoritativeMoveRulesContext,
  targetIds: readonly string[],
  value: readonly MoveSpecAuthoritativeTargetEvaluation[] | undefined,
): readonly MoveSpecAuthoritativeTargetEvaluation[] | null => {
  if (value === undefined) return null
  if (!Array.isArray(value) || value.length > MOVE_SPEC_LIMITS.targetCount) {
    return fail(
      'authoritative-target-invalid',
      `Server-derived target evaluations must contain at most ${MOVE_SPEC_LIMITS.targetCount} entries.`,
    )
  }

  const seen = new Set<string>()
  const evaluations = value.map((evaluation) => {
    if (
      typeof evaluation !== 'object'
      || evaluation === null
      || typeof evaluation.targetPlacementId !== 'string'
      || evaluation.targetPlacementId.length === 0
      || evaluation.targetPlacementId.trim() !== evaluation.targetPlacementId
      || !context.queries.placements.get(evaluation.targetPlacementId)
      || seen.has(evaluation.targetPlacementId)
      || (evaluation.outcome !== 'included' && evaluation.outcome !== 'excluded')
      || typeof evaluation.reasonCode !== 'string'
      || !/^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/.test(evaluation.reasonCode)
    ) {
      return fail(
        'authoritative-target-invalid',
        'Server-derived target evaluations contain a missing, duplicated, or malformed decision.',
      )
    }
    seen.add(evaluation.targetPlacementId)
    return Object.freeze({
      targetPlacementId: evaluation.targetPlacementId,
      outcome: evaluation.outcome,
      reasonCode: evaluation.reasonCode,
    })
  })
  const includedIds = evaluations
    .filter(evaluation => evaluation.outcome === 'included')
    .map(evaluation => evaluation.targetPlacementId)
  if (
    includedIds.length !== targetIds.length
    || includedIds.some((targetId, index) => targetId !== targetIds[index])
  ) {
    return fail(
      'authoritative-target-invalid',
      'Included target evaluations must exactly match authoritative targets in server order.',
    )
  }
  return Object.freeze(evaluations)
}

const consideredTargetIds = (
  context: AuthoritativeMoveRulesContext,
  targeting: ValidatedMoveSpecTargetingRule,
  targetIds: readonly string[],
): readonly string[] => {
  if (targeting.kind === 'none') return []
  if (targeting.kind === 'self') return [context.actor.placement.id]
  return canonicalPlacementIds(context, [
    ...context.selectedPlacements.map(({ id }) => id),
    ...targetIds,
  ]).slice(0, MOVE_SPEC_LIMITS.targetCount)
}

const effectRecipientIds = (
  context: AuthoritativeMoveRulesContext,
  state: MoveSpecSelectorState,
  kind: MoveEffectRecipientSelectorKind,
): readonly string[] => {
  const compoundIds = resolveMoveEffectCompoundRecipientIds(context, {
    attackedTargetIds: state.targetIds,
    hitTargetIds: state.hitTargetIds,
  }, kind)
  let ids: readonly string[]
  if (compoundIds !== null) ids = compoundIds
  else switch (kind) {
    case 'none':
      ids = []
      break
    case 'actor':
    case 'source-placement':
      ids = [context.actor.placement.id]
      break
    case 'response-owner':
      ids = state.responseOwnerIds ?? []
      break
    case 'selected-targets':
      ids = context.selectedPlacements.map(({ id }) => id)
      break
    case 'attacked-targets':
      ids = state.targetIds
      break
    case 'area-targets':
      // Geometric candidates have already passed the reviewed area predicate.
      // Re-reading the broader context candidate set here would re-include
      // rule-excluded or explicitly excluded placements.
      ids = state.targetIds
      break
    case 'all-placements':
      ids = context.queries.placements.all().map(({ id }) => id)
      break
    case 'hit-targets':
      ids = state.hitTargetIds
      break
    case 'missed-targets':
      ids = state.missedTargetIds
      break
    case 'damaged-targets':
      ids = state.damagedTargetIds
      break
    case 'fainted-targets':
      ids = state.faintedTargetIds
      break
    case 'actor-and-attacked-targets':
    case 'cardinally-adjacent-to-hit-targets':
      return fail(
        'move-mechanics-unavailable',
        `Compound recipient selector ${kind} did not resolve.`,
      )
  }

  const resolved = canonicalPlacementIds(context, ids)
  if (resolved.length > MOVE_RESOLUTION_TRACE_LIMITS.recipients) {
    fail(
      'recipient-limit-exceeded',
      `Operation recipient selector ${kind} resolved ${resolved.length} placements; at most ${MOVE_RESOLUTION_TRACE_LIMITS.recipients} are allowed.`,
    )
  }
  return resolved
}

const traceJson = (value: unknown): MoveResolutionTraceJsonValue => (
  value as MoveResolutionTraceJsonValue
)

const pendingRequest = (
  operation: MoveChoiceRequestEffectOperation | MoveReactionRequestEffectOperation,
  recipientIds: readonly string[],
  ancestryDepth: number,
): MoveSpecPendingChoiceRequest | MoveSpecPendingReactionRequest => {
  const common = {
    operationId: operation.id,
    phase: operation.phase,
    reasonCode: operation.reasonCode,
    recipientIds: frozenIds(recipientIds),
    requestId: operation.payload.requestId,
    promptKey: operation.payload.promptKey,
    options: Object.freeze(operation.payload.options.map(option => Object.freeze({ ...option }))),
    allowPass: operation.payload.allowPass,
  }
  if (operation.kind === 'choice-request') {
    return Object.freeze({ kind: 'choice', ...common })
  }
  if (ancestryDepth > MOVE_REACTION_LIMITS.nestedWindowDepth) {
    return fail(
      'reaction-nesting-limit-exceeded',
      `Reaction ${operation.payload.requestId} reached nested depth ${ancestryDepth}; at most ${MOVE_REACTION_LIMITS.nestedWindowDepth} is allowed.`,
    )
  }
  const timing = moveReactionTimingDefinition(operation.payload.timing)
  return Object.freeze({
    kind: 'reaction',
    ...common,
    timing: timing.timing,
    priority: operation.payload.priority,
    depth: ancestryDepth,
    revealedInformation: timing.revealedInformation,
  })
}

const movementSheetsForContext = (
  context: AuthoritativeMoveRulesContext,
): { readonly pokemon: ReadonlyMap<string, CharacterSheet>; readonly trainer: ReadonlyMap<string, TrainerSheet> } => {
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  for (const resolved of context.resolvedSheets) {
    if (resolved.kind === 'pokemon') pokemon.set(resolved.slug, resolved.sheet as CharacterSheet)
    else trainer.set(resolved.slug, resolved.sheet as TrainerSheet)
  }
  return { pokemon, trainer }
}

const movementChoiceSet = (
  operation: MoveMovementRequestEffectOperation,
  context: AuthoritativeMoveRulesContext,
  recipientIds: readonly string[],
): AuthoritativeMovementChoiceSet => {
  const choice = operation.payload.choice
  const destinationSetId = operation.payload.destinationSetId
  const maximumDistance = operation.payload.distance
  if (
    !choice
    || destinationSetId === null
    || typeof maximumDistance !== 'number'
  ) {
    return fail(
      'definition-integrity-mismatch',
      `Movement operation ${operation.id} has no complete durable choice declaration.`,
    )
  }
  let set: AuthoritativeMovementChoiceSet
  try {
    const placementId = operation.recipients.kind === 'response-owner'
      ? recipientIds.length === 1
        ? recipientIds[0]!
        : fail(
            'definition-integrity-mismatch',
            `Response-owner movement ${operation.id} must resolve exactly one owner.`,
          )
      : context.actor.placement.id
    const common = {
      map: context.map,
      sheets: movementSheetsForContext(context),
      placementId,
      setId: destinationSetId,
      maximumDistance,
    }
    set = choice.kind === 'direction'
      ? enumerateAuthoritativeMovementChoices({
          ...common,
          kind: 'direction',
          directions: choice.directions,
        })
      : enumerateAuthoritativeMovementChoices({
          ...common,
          kind: 'destination',
        })
  }
  catch (error) {
    return fail(
      'move-mechanics-unavailable',
      `Movement choices for ${operation.id} could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  for (const read of set.sheetReads) context.reads.recordSheet(read)
  return set
}

const revalidateMovementChoice = (
  operation: MoveMovementRequestEffectOperation,
  context: AuthoritativeMoveRulesContext,
  set: AuthoritativeMovementChoiceSet,
  optionId: string,
): AuthoritativeMovementChoice => {
  const option = set.choices.find(entry => entry.option.id === optionId)?.option
    ?? fail(
      'definition-integrity-mismatch',
      `Movement option ${optionId} disappeared from ${operation.payload.requestId}.`,
    )
  const choice = operation.payload.choice
    ?? fail('definition-integrity-mismatch', `Movement operation ${operation.id} has no choice.`)
  try {
    return revalidateAuthoritativeMovementChoice({
      map: context.map,
      sheets: movementSheetsForContext(context),
      placementId: set.placementId,
      setId: set.setId,
      maximumDistance: set.maximumDistance,
      kind: set.kind,
      option,
      ...(choice.kind === 'direction' ? { directions: choice.directions } : {}),
    })
  }
  catch (error) {
    return fail(
      'move-mechanics-unavailable',
      `Movement option ${optionId} failed resume validation: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const pendingMovementRequest = (
  operation: MoveMovementRequestEffectOperation,
  recipientIds: readonly string[],
  set: AuthoritativeMovementChoiceSet,
): MoveSpecPendingMovementRequest => {
  const choice = operation.payload.choice
    ?? fail('definition-integrity-mismatch', `Movement operation ${operation.id} has no choice.`)
  return Object.freeze({
    kind: 'movement-choice',
    movementChoiceKind: set.kind,
    destinationSetId: set.setId,
    operationId: operation.id,
    phase: operation.phase,
    reasonCode: operation.reasonCode,
    recipientIds: frozenIds(recipientIds),
    requestId: operation.payload.requestId,
    promptKey: choice.promptKey,
    options: Object.freeze(set.choices.map(entry => entry.option)),
    allowPass: choice.allowPass,
  })
}

const pendingHazardCellRequest = (
  operation: MoveHazardEffectOperation,
  actorPlacementId: string,
): MoveSpecPendingHazardCellRequest => {
  if (operation.payload.action !== 'add' || !operation.payload.cellSelection) {
    return fail(
      'definition-integrity-mismatch',
      `Hazard operation ${operation.id} has no durable cell-selection declaration.`,
    )
  }
  const selection = operation.payload.cellSelection
  const geometry = operation.payload.geometry
  if (geometry.kind !== 'selection') {
    return fail(
      'definition-integrity-mismatch',
      `Hazard operation ${operation.id} has a durable selection without selection geometry.`,
    )
  }
  const minimum = selection.count.kind === 'exact'
    ? selection.count.count
    : selection.count.minimum
  return Object.freeze({
    kind: 'hazard-cell-choice',
    operationId: operation.id,
    phase: operation.phase,
    reasonCode: operation.reasonCode,
    // The hazard itself has no placement recipients. The actor owns the
    // mechanics-free durable choice used to select its server-issued cells.
    recipientIds: frozenIds([actorPlacementId]),
    requestId: selection.requestId,
    promptKey: selection.promptKey,
    // Stable options depend on the durable resolution ID and continuation map
    // revision, so suspension materialization creates them after execution.
    options: Object.freeze([]),
    allowPass: minimum === 0,
    cellSetId: geometry.cellSetId,
    selection,
  })
}

const switchChoiceSet = (
  operation: MoveSwitchRequestEffectOperation,
  context: AuthoritativeMoveRulesContext,
): AuthoritativeSwitchChoiceSet => {
  try {
    return enumerateAuthoritativeSwitchChoices({
      context,
      recalledPlacementId: context.actor.placement.id,
      setId: operation.payload.replacementSetId,
      positionPolicy: operation.payload.positionPolicy,
      initiativePolicy: operation.payload.initiativePolicy,
    })
  }
  catch (error) {
    return fail(
      'move-mechanics-unavailable',
      `Switch choices for ${operation.id} could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const revalidateSwitchChoice = (
  operation: MoveSwitchRequestEffectOperation,
  context: AuthoritativeMoveRulesContext,
  optionId: string,
): AuthoritativeSwitchChoice => {
  try {
    return revalidateAuthoritativeSwitchChoice({
      context,
      recalledPlacementId: context.actor.placement.id,
      setId: operation.payload.replacementSetId,
      positionPolicy: operation.payload.positionPolicy,
      initiativePolicy: operation.payload.initiativePolicy,
      optionId,
    })
  }
  catch (error) {
    return fail(
      'move-mechanics-unavailable',
      `Switch option ${optionId} failed resume validation: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const pendingSwitchRequest = (
  operation: MoveSwitchRequestEffectOperation,
  recipientIds: readonly string[],
  set: AuthoritativeSwitchChoiceSet,
): MoveSpecPendingSwitchRequest => Object.freeze({
  kind: 'switch-choice',
  replacementSetId: set.setId,
  operationId: operation.id,
  phase: operation.phase,
  reasonCode: operation.reasonCode,
  recipientIds: frozenIds(recipientIds),
  requestId: operation.payload.requestId,
  promptKey: operation.payload.promptKey,
  options: Object.freeze(set.choices.map(choice => choice.option)),
  allowPass: !operation.payload.required,
})

const itemChoiceQueries = (
  operation: MoveChoiceRequestEffectOperation,
  context: AuthoritativeMoveRulesContext,
  recipientIds: readonly string[],
) => {
  const requirementId = operation.payload.itemChoice?.requirementId
  if (requirementId !== AA077_KLUTZ_ITEM_REQUIREMENT_ID
    && requirementId !== AA079_MAGICIAN_TARGET_REQUIREMENT_ID) {
    return context.queries.items
  }
  const ownerKeys = new Set(recipientIds.flatMap(recipientId => {
    const placement = context.queries.placements.get(recipientId)
    return placement ? [`${placement.sheetKind}:${placement.sheetSlug}`] : []
  }))
  const eligible = (reference: ReturnType<typeof context.queries.items.all>[number]): boolean => {
    const owner = reference.owner
    if (owner.kind !== 'sheet') return false
    const ownerPlacement = context.map.placements.find(placement => (
      placement.sheetKind === owner.sheetKind
      && placement.sheetSlug === owner.slug
    ))
    if (!ownerPlacement || !ownerKeys.has(`${owner.sheetKind}:${owner.slug}`)) {
      return false
    }
    if (requirementId === AA079_MAGICIAN_TARGET_REQUIREMENT_ID) {
      return reference.kind === 'pokemon-held'
    }
    return reference.canonicalItemId !== 'rare-leek'
      || !context.queries.abilities.has(ownerPlacement.id, 'Leek Mastery')
  }
  return Object.freeze({
    all: () => context.queries.items.all().filter(eligible),
    forRequirement: (requirementId: string) => context.queries.items
      .forRequirement(requirementId).filter(eligible),
    consumedById: (consumptionId: string) => context.queries.items.consumedById(consumptionId),
  })
}

const itemChoiceSet = (
  operation: MoveChoiceRequestEffectOperation,
  context: AuthoritativeMoveRulesContext,
  recipientIds: readonly string[],
): AuthoritativeMoveItemChoiceSet => {
  const declaration = operation.payload.itemChoice
    ?? fail(
      'definition-integrity-mismatch',
      `Choice operation ${operation.id} has no dynamic item declaration.`,
    )
  try {
    return enumerateAuthoritativeMoveItemChoices({
      declaration,
      items: itemChoiceQueries(operation, context, recipientIds),
    })
  }
  catch (error) {
    return fail(
      'move-mechanics-unavailable',
      `Item choices for ${operation.id} could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const revalidateItemChoice = (
  operation: MoveChoiceRequestEffectOperation,
  context: AuthoritativeMoveRulesContext,
  recipientIds: readonly string[],
  optionId: string,
): AuthoritativeMoveItemChoice => {
  const declaration = operation.payload.itemChoice
    ?? fail('definition-integrity-mismatch', `Choice operation ${operation.id} has no item declaration.`)
  try {
    return revalidateAuthoritativeMoveItemChoice({
      declaration,
      items: itemChoiceQueries(operation, context, recipientIds),
      optionId,
    })
  }
  catch (error) {
    return fail(
      'move-mechanics-unavailable',
      `Item option ${optionId} failed resume validation: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const pendingItemRequest = (
  operation: MoveChoiceRequestEffectOperation,
  recipientIds: readonly string[],
  actorPlacementId: string,
  set: AuthoritativeMoveItemChoiceSet,
): MoveSpecPendingItemRequest => Object.freeze({
  kind: 'item-choice',
  itemSetId: set.setId,
  requirementId: set.requirementId,
  operationId: operation.id,
  phase: operation.phase,
  reasonCode: operation.reasonCode,
  recipientIds: frozenIds(set.owner === 'actor' ? [actorPlacementId] : recipientIds),
  requestId: operation.payload.requestId,
  promptKey: operation.payload.promptKey,
  options: Object.freeze(set.choices.map(choice => choice.option)),
  allowPass: operation.payload.allowPass,
})

const projectedKnockOffItemOutcome = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly resolvedRolls: readonly MoveSpecResolvedRoll[]
  readonly recipientIds: readonly string[]
  readonly selectedOptionId?: string | null
}): KnockOffItemOutcome => {
  try {
    return planProjectedKnockOffItemContinuation(input)
  }
  catch (error) {
    if (error instanceof KnockOffContinuationError) {
      return fail('move-mechanics-unavailable', error.message)
    }
    throw error
  }
}

const pendingBranchRequest = (
  operation: MoveBranchEffectOperation,
  recipientIds: readonly string[],
  actorPlacementId: string,
  options: readonly PendingMoveResponseOption[] = operation.payload.kind === 'choice'
    ? operation.payload.options.map(option => ({ id: option.id, labelKey: option.labelKey }))
    : [],
  requestId?: string,
): MoveSpecPendingBranchChoiceRequest => {
  if (operation.payload.kind !== 'choice') {
    return fail(
      'definition-integrity-mismatch',
      `Branch ${operation.payload.selectionId} is not a human choice.`,
    )
  }
  return Object.freeze({
    kind: 'branch-choice',
    operationId: operation.id,
    phase: operation.phase,
    reasonCode: operation.reasonCode,
    recipientIds: frozenIds(
      operation.payload.owner === 'actor' ? [actorPlacementId] : recipientIds,
    ),
    requestId: requestId ?? operation.payload.requestId,
    promptKey: operation.payload.promptKey,
    options: Object.freeze(options.map(option => Object.freeze({ ...option }))),
    allowPass: operation.payload.pass !== null,
    selectionId: operation.payload.selectionId,
    scope: operation.payload.scope,
  })
}

interface MoveChoiceOptionEligibility {
  readonly option: Extract<MoveBranchEffectOperation['payload'], {
    readonly kind: 'choice'
  }>['options'][number]
  readonly eligible: boolean
  readonly evaluationTrace: readonly MoveResolutionTraceJsonValue[]
}

const scopedBranchChoiceRequestId = (
  requestId: string,
  recipientId: string,
  recipientCount: number,
): string => {
  if (recipientCount === 1) return requestId
  const scoped = `${requestId}.${createHash('sha256')
    .update(recipientId, 'utf8')
    .digest('hex')
    .slice(0, 16)}`
  if (scoped.length > MOVE_SPEC_LIMITS.identifierLength) {
    return fail(
      'definition-integrity-mismatch',
      `Recipient-scoped branch request ID ${scoped} exceeds ${MOVE_SPEC_LIMITS.identifierLength} characters.`,
    )
  }
  return scoped
}

const eligibleMoveChoiceOptions = (input: {
  readonly operation: MoveBranchEffectOperation
  readonly context: AuthoritativeMoveRulesContext
  readonly selectorState: MoveSpecSelectorState
  readonly canonicalMoveId: string
  readonly recipientId: string | null
}): readonly MoveChoiceOptionEligibility[] => {
  if (input.operation.payload.kind !== 'choice') {
    return fail(
      'definition-integrity-mismatch',
      `Branch ${input.operation.id} is not a choice branch.`,
    )
  }
  const scopedSelectorState = input.recipientId === null
    ? input.selectorState
    : { ...input.selectorState, targetIds: [input.recipientId] }
  return input.operation.payload.options.map((option): MoveChoiceOptionEligibility => {
    if (!option.predicate) {
      return { option, eligible: true, evaluationTrace: [] }
    }
    const evaluation = evaluateMovePredicate({
      predicate: option.predicate,
      context: input.context,
      selectorState: scopedSelectorState,
      canonicalMoveId: input.canonicalMoveId,
      rootNodeId: `${input.operation.payload.selectionId}.${option.id}`,
    })
    return {
      option,
      eligible: evaluation.value,
      evaluationTrace: evaluation.trace as unknown as readonly MoveResolutionTraceJsonValue[],
    }
  })
}

const pendingCheckRequest = (
  operation: MoveCheckEffectOperation,
  request: MoveCheckPendingRequest,
): MoveSpecPendingRequest => {
  const common = {
    operationId: operation.id,
    phase: operation.phase,
    reasonCode: operation.reasonCode,
    recipientIds: frozenIds(request.ownerPlacementIds),
    requestId: request.requestId,
    promptKey: request.promptKey,
    options: Object.freeze(request.options.map(option => Object.freeze({ ...option }))),
    allowPass: false,
    checkId: request.checkId,
    role: request.role,
  }
  return request.kind === 'selection'
    ? Object.freeze({ kind: 'check-selection', ...common })
    : Object.freeze({
        kind: 'resource-spend',
        ...common,
        resourceId: request.resourceId,
        amount: request.amount,
        checkRecipientId: request.checkRecipientId,
      })
}

interface MoveSpecAuthoritativeMoveMechanics {
  readonly script: MoveAutomationScript
}

const optionalAuthoritativeMoveMechanics = (
  context: AuthoritativeMoveRulesContext,
  canonicalId: string,
  source: 'actor-move' | 'registered-spec',
): MoveSpecAuthoritativeMoveMechanics | null => {
  if (source === 'registered-spec') {
    const script = context.queries.rules.reviewedScriptFor(canonicalId)
    if (!script) return null
    context.reads.recordPlacement(context.actor.placement)
    return { script }
  }

  const result = context.queries.resolveActorMoveEntry(canonicalId)
  if (!result.ok || result.entry.canonicalMoveName !== canonicalId) return null
  context.reads.recordPlacement(context.actor.placement)
  return { script: result.entry.script }
}

const authoritativeMoveMechanics = (
  context: AuthoritativeMoveRulesContext,
  canonicalId: string,
  source: 'actor-move' | 'registered-spec',
): MoveSpecAuthoritativeMoveMechanics => optionalAuthoritativeMoveMechanics(
  context,
  canonicalId,
  source,
) ?? fail(
  'move-mechanics-unavailable',
  source === 'registered-spec'
    ? `Reviewed child mechanics for ${canonicalId} are not available from the server registry.`
    : `Authoritative move mechanics for ${canonicalId} are not available to the actor.`,
)

const targetTokenForRoll = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
): SpawnedPokemon => {
  const placement = context.queries.placements.get(placementId)
  const token = context.queries.tokens.get(placementId)
  if (!placement || !token) {
    return fail(
      'authoritative-target-invalid',
      `Roll recipient ${placementId} could not resolve to an authoritative token.`,
    )
  }
  context.reads.recordPlacement(placement)
  return token
}

const resolvedRollId = (
  baseId: string,
  ordinal: number,
  suffix = '',
): string => {
  const rollId = `${baseId}${suffix}.${ordinal}`
  if (rollId.length > MOVE_SPEC_LIMITS.identifierLength) {
    return fail(
      'resolved-roll-id-too-long',
      `Resolved roll ID ${rollId} exceeds ${MOVE_SPEC_LIMITS.identifierLength} characters.`,
    )
  }
  return rollId
}

const latestLedgerEntry = (
  context: AuthoritativeMoveRulesContext,
  rollId: string,
): MoveAutomationRollLedgerEntry => context.random.snapshot().at(-1)
  ?? fail('definition-integrity-mismatch', `Roll ${rollId} did not produce a ledger entry.`)

const resolvedCheckRolls = (
  operation: MoveCheckEffectOperation,
  execution: MoveCheckExecution,
): readonly MoveSpecResolvedRoll[] => execution.rollReferences.map(reference => ({
  operationId: operation.id,
  referenceId: reference.referenceId,
  purpose: 'check',
  recipientId: reference.recipientId,
  checkRole: reference.role,
  attemptIndex: reference.attemptIndex,
  rollId: reference.rollId,
}))

const accuracyReferenceIds = (
  operations: readonly MoveEffectOperation[],
): ReadonlySet<string> => new Set(
  operations.flatMap((operation) => {
    // Accuracy-only Status moves have no damage operation to reference their
    // d20. The reviewed accuracy phase and attacked-target recipient selector
    // are therefore also an explicit bounded accuracy declaration.
    if (
      operation.kind === 'roll'
      && operation.phase === 'accuracy'
      && operation.recipients.kind === 'attacked-targets'
    ) {
      return [operation.payload.rollId]
    }
    if (operation.kind === 'damage' && operation.payload.accuracyRollId !== null) {
      return [operation.payload.accuracyRollId]
    }
    if (operation.kind === 'direct-hp' && operation.payload.accuracyRollId) {
      return [operation.payload.accuracyRollId]
    }
    return []
  }),
)

const terminalBase = (
  context: AuthoritativeMoveRulesContext,
  operations: readonly MoveSpecEmittedOperation[],
  targetIds: readonly string[],
  trace: MoveResolutionAuditTrace,
  rollLedger: readonly MoveAutomationRollLedgerEntry[],
  resolvedRolls: readonly MoveSpecResolvedRoll[],
  resolvedDamageTypes: readonly MoveDamageTypeResolution[],
  resolvedDamageBases: readonly MoveContextualDamageBaseResolution[],
  multiHitExecutions: readonly MoveMultiHitExecution[],
  resolvedChecks: readonly MoveCheckResolution[],
  branchSelections: readonly MoveBranchSelection[],
  resolvedMovements: readonly MoveSpecResolvedMovement[],
  resolvedSwitches: readonly MoveSpecResolvedSwitch[],
  resolvedItemChoices: readonly MoveSpecResolvedItemChoice[],
  resolvedHazardCells: readonly MoveSpecResolvedHazardCells[],
  childExecutions: readonly MoveSpecChildExecution[],
  selectorState: MoveSpecSelectorState,
): MoveSpecExecutionResultBase => {
  const aggregate = (
    root: readonly string[],
    select: (child: MoveSpecChildExecution) => readonly string[],
  ): readonly string[] => canonicalPlacementIds(context, [
    ...root,
    ...childExecutions.flatMap(child => select(child)),
  ])
  return {
  operations: freezeEmittedOperations(operations),
  targetIds: frozenIds(aggregate(targetIds, child => child.targetIds)),
  rootTargetIds: frozenIds(targetIds),
  rootHitTargetIds: frozenIds(selectorState.hitTargetIds),
  rootMissedTargetIds: frozenIds(selectorState.missedTargetIds),
  rootDamagedTargetIds: frozenIds(selectorState.damagedTargetIds),
  rootFaintedTargetIds: frozenIds(selectorState.faintedTargetIds),
  sheetReads: context.reads.snapshot(),
  rollLedger,
  resolvedRolls: freezeResolvedRolls(resolvedRolls),
  resolvedDamageTypes: freezeResolvedDamageTypes(resolvedDamageTypes),
  resolvedDamageBases: freezeResolvedDamageBases(resolvedDamageBases),
  multiHitExecutions: freezeMultiHitExecutions(multiHitExecutions),
  resolvedChecks: freezeResolvedChecks(resolvedChecks),
  branchSelections: freezeBranchSelections(branchSelections),
  resolvedMovements: freezeResolvedMovements(resolvedMovements),
  resolvedSwitches: freezeResolvedSwitches(resolvedSwitches),
  resolvedItemChoices: freezeResolvedItemChoices(resolvedItemChoices),
  resolvedHazardCells: freezeResolvedHazardCells(resolvedHazardCells),
  childExecutions: freezeChildExecutions(childExecutions),
  hitTargetIds: frozenIds(aggregate(selectorState.hitTargetIds, child => child.hitTargetIds)),
  missedTargetIds: frozenIds(aggregate(selectorState.missedTargetIds, child => child.missedTargetIds)),
  damagedTargetIds: frozenIds(aggregate(selectorState.damagedTargetIds, child => child.damagedTargetIds)),
  faintedTargetIds: frozenIds(aggregate(selectorState.faintedTargetIds, child => child.faintedTargetIds)),
  trace,
  }
}

interface MoveSpecSuspendedOperationPartition {
  readonly preWindowOperations: readonly MoveSpecEmittedOperation[]
  readonly deferredContinuation: MoveSpecDeferredContinuation
}

const suspendedOperationPartition = (
  operations: readonly MoveSpecEmittedOperation[],
  request: MoveSpecPendingRequest,
): MoveSpecSuspendedOperationPartition => {
  const preWindowOperations: MoveSpecEmittedOperation[] = []
  const deferredOperations: MoveSpecEmittedOperation[] = []
  let foundRequestOperation = false

  for (const emission of operations) {
    const operation = emission.operation
    if (operation.id === request.operationId) {
      foundRequestOperation = true
      continue
    }

    if (operation.kind === 'direct-hp' && operation.payload.cost?.timing === 'declaration') {
      if (operation.phase !== 'pay') {
        fail(
          'pre-window-operation-forbidden',
          `Declaration HP cost ${operation.id} must use the reviewed pay phase before a response window.`,
        )
      }
      preWindowOperations.push(emission)
      continue
    }

    // Execution evidence (including ordinary damage/effects) is durable, but
    // no implicit phase convention makes it safe to commit before the answer.
    deferredOperations.push(emission)
  }

  if (!foundRequestOperation) {
    fail(
      'definition-integrity-mismatch',
      `Pending request ${request.requestId} has no matching operation ${request.operationId}.`,
    )
  }

  return Object.freeze({
    preWindowOperations: freezeEmittedOperations(preWindowOperations),
    deferredContinuation: Object.freeze({
      phase: request.phase,
      requestOperationId: request.operationId,
      operations: freezeEmittedOperations(deferredOperations),
    }),
  })
}

const materializePendingExecutionResult = (
  base: MoveSpecExecutionResultBase,
  request: MoveSpecPendingRequest,
): MoveSpecExecutionPendingResult => {
  const partition = suspendedOperationPartition(base.operations, request)
  return Object.freeze({
    kind: 'pending-request',
    ...base,
    request,
    ...partition,
  })
}

interface ExecutableMoveSpecOperationEntry {
  readonly operation: MoveEffectOperation
  readonly path: string
}

interface ExecutableMoveSpecProgram {
  readonly operations: readonly MoveEffectOperation[]
  readonly operationsByPhase: ReadonlyMap<MoveSpecPhase, readonly MoveEffectOperation[]>
  readonly handlerTraceEntriesByPhase: ReadonlyMap<
    MoveSpecPhase,
    readonly RegisteredMoveHandlerTraceEntry[]
  >
}

const staticOperationEntries = (
  spec: ValidatedMoveSpec,
): readonly ExecutableMoveSpecOperationEntry[] => spec.phases.flatMap((block, phaseIndex) => (
  block.operations.map((operation, operationIndex) => ({
    operation,
    path: `spec.phases[${phaseIndex}].operations[${operationIndex}]`,
  }))
))

const handlerOutputFor = (
  definition: ValidatedMoveSpecDefinition,
  context: AuthoritativeMoveRulesContext,
  handlerRegistry: RegisteredMoveHandlerRegistry,
  staticOperationCount: number,
): RegisteredMoveHandlerOutput => {
  const reference = definition.registeredHandler
  if (reference === null) {
    return Object.freeze({
      operations: Object.freeze([]),
      traceEntries: Object.freeze([]),
    })
  }
  const registration = handlerRegistry.resolve(reference.id)
  if (!registration) {
    return fail(
      'definition-integrity-mismatch',
      `Registered handler ${reference.id} disappeared after MoveSpec validation.`,
    )
  }
  return executeRegisteredMoveHandler({
    registration,
    expectedVersion: reference.version,
    context,
    maximumOperations: MOVE_EFFECT_OPERATION_LIMITS.operations - staticOperationCount,
  })
}

const applyBlurAccuracyEntries = (
  context: AuthoritativeMoveRulesContext,
  entries: readonly ExecutableMoveSpecOperationEntry[],
): readonly ExecutableMoveSpecOperationEntry[] => {
  const moveEntry = context.queries.resolveActorMoveEntry(context.intent.moveName)
  if (!moveEntry.ok || moveEntry.entry.script.requiresAccuracy) return entries
  const hasBlurTarget = context.selectedPlacements.some(placement => (
    context.queries.abilities.has(placement.id, 'Blur')
  ))
  if (!hasBlurTarget) return entries
  const rollId = 'ability.blur.accuracy-roll'
  const source = entries.find(entry => entry.operation.source.kind === 'move')?.operation.source
    ?? { kind: 'lifecycle-event' as const, id: 'ability.blur' }
  const transformed = entries.map((entry): ExecutableMoveSpecOperationEntry => {
    const operation = entry.operation
    if (operation.kind === 'damage' && operation.payload.accuracyRollId === null) {
      return {
        ...entry,
        operation: {
          ...operation,
          recipients: operation.recipients.kind === 'attacked-targets'
            ? { kind: 'hit-targets' }
            : operation.recipients,
          payload: {
            ...operation.payload,
            accuracyRollId: rollId,
            criticalRollId: operation.payload.criticalRollId ?? rollId,
          },
        },
      }
    }
    if (operation.phase !== 'accuracy' && operation.recipients.kind === 'attacked-targets') {
      return { ...entry, operation: { ...operation, recipients: { kind: 'hit-targets' } } }
    }
    return entry
  })
  return [{
    path: 'serverAbilityOperations[blur.accuracy]',
    operation: {
      id: 'ability.blur.accuracy',
      kind: 'roll',
      source,
      recipients: { kind: 'attacked-targets' },
      phase: 'accuracy',
      reasonCode: 'ability.blur.accuracy-check',
      payload: {
        rollId,
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      },
    },
  }, ...transformed]
}

const applyBoneLordOperationEntries = (
  context: AuthoritativeMoveRulesContext,
  entries: readonly ExecutableMoveSpecOperationEntry[],
): readonly ExecutableMoveSpecOperationEntry[] => {
  const moveName = context.intent.moveName
  if (!aa062BoneLordEmpowersMove(context, moveName)
    || (moveName !== 'Bone Rush' && moveName !== 'Bonemerang')) return entries
  const hits = moveName === 'Bone Rush' ? 4 : 1
  return entries.map(entry => entry.operation.kind === 'multi-hit'
    ? {
        ...entry,
        operation: {
          ...entry.operation,
          payload: { ...entry.operation.payload, count: { kind: 'fixed' as const, hits } },
        },
      }
    : entry)
}

const executableProgram = (
  definition: ValidatedMoveSpecDefinition,
  context: AuthoritativeMoveRulesContext,
  handlerRegistry: RegisteredMoveHandlerRegistry,
  responseResolver: MoveSpecResponseResolver,
  serverAbilityOverlayOperations: readonly MoveEffectOperation[] = [],
): ExecutableMoveSpecProgram => {
  const staticEntries = staticOperationEntries(definition.spec)
  const handlerOutput = handlerOutputFor(
    definition,
    context,
    handlerRegistry,
    staticEntries.length + serverAbilityOverlayOperations.length,
  )
  const handlerEntries = handlerOutput.operations.map((operation, index) => ({
    operation,
    path: `handlerOutput.operations[${index}]`,
  }))
  const abilityEntries = serverAbilityOverlayOperations.map((operation, index) => ({
    operation: parseMoveEffectOperation(operation, `serverAbilityOverlayOperations[${index}]`),
    path: `serverAbilityOverlayOperations[${index}]`,
  }))
  const baseReviewedEntries = applyAa067DeliveryBirdItemChoiceEntries(
    context,
    applyBoneLordOperationEntries(
      context,
      applyBlurAccuracyEntries(context, [
        ...staticEntries,
        ...handlerEntries,
        ...abilityEntries,
      ]),
    ),
  )
  const reviewedScript = context.queries.rules.reviewedScriptFor(definition.spec.canonicalId)
    ?? context.queries.rules.reviewedScriptFor(context.intent.moveName)
    ?? fail('definition-integrity-mismatch', 'Ability overlays could not resolve the reviewed Move script.')
  const selectedAa072Operations = applyAa072SelectedMoveOperations({
    script: reviewedScript,
    operations: baseReviewedEntries.map(entry => entry.operation),
    moveOwnedOperationIds: new Set([
      ...staticEntries.map(entry => entry.operation.id),
      ...handlerEntries.map(entry => entry.operation.id),
    ]),
    responses: responseResolver,
  })
  const moveOwnedOperationIds = new Set([
    ...staticEntries.map(entry => entry.operation.id),
    ...handlerEntries.map(entry => entry.operation.id),
  ])
  const frostbiteOperations = aa071FrostbiteOperations({
    context,
    script: reviewedScript,
    operations: applyAa084ReviewedOperations({
      operations: applyAa083ReviewedOperations({
        context,
        script: reviewedScript,
        operations: applyAa080ReviewedOperations(applyAa079ReviewedOperations({
        context,
        script: reviewedScript,
        operations: applyAa078ReviewedOperations({
          context,
          script: reviewedScript,
          operations: applyAa074HoneyThiefOperations(applyAa074HordeBreakOperations({
            context,
            operations: selectedAa072Operations,
          })),
        }),
      })),
        moveOwnedOperationIds,
        responses: responseResolver,
      }),
      moveOwnedOperationIds,
      responses: responseResolver,
    }),
  })
  const reviewedEntries = frostbiteOperations.map((operation, index): ExecutableMoveSpecOperationEntry => ({
    operation,
    path: baseReviewedEntries[index]?.path ?? `abilityFrostbite.operations[${index}]`,
  }))
  const entriesByPhase = new Map<MoveSpecPhase, ExecutableMoveSpecOperationEntry[]>()
  for (const phase of MOVE_SPEC_PHASES) {
    const entries = orderMoveReactionOperationEntries(
      reviewedEntries.filter(entry => entry.operation.phase === phase),
    )
    if (entries.length > 0) entriesByPhase.set(phase, [...entries])
  }
  const orderedEntries = MOVE_SPEC_PHASES.flatMap(phase => entriesByPhase.get(phase) ?? [])
  validateMoveSpecOperationSequence(
    orderedEntries,
    'moveSpecExecution.operations',
    {
      allowAttackedTargetAccuracyEffects:
        definition.spec.presentation.tags.includes('natural-effect-range'),
      allowSequentialHazardResponseRequests: serverAbilityOverlayOperations.some(operation => (
        operation.reasonCode === AA078_MAGIC_BOUNCE_HAZARD_REASON
      )),
    },
  )
  const operations = Object.freeze(orderedEntries.map(({ operation }) => operation))

  const handlerTraceEntriesByPhase = new Map<
    MoveSpecPhase,
    readonly RegisteredMoveHandlerTraceEntry[]
  >()
  for (const phase of MOVE_SPEC_PHASES) {
    const entries = handlerOutput.traceEntries.filter(entry => entry.phase === phase)
    if (entries.length > 0) handlerTraceEntriesByPhase.set(phase, Object.freeze(entries))
  }

  return Object.freeze({
    operations,
    operationsByPhase: new Map(
      [...entriesByPhase].map(([phase, entries]) => [
        phase,
        Object.freeze(entries.map(({ operation }) => operation)),
      ]),
    ),
    handlerTraceEntriesByPhase,
  })
}

const branchControllerIndex = (
  operations: readonly MoveEffectOperation[],
): ReadonlyMap<string, MoveBranchEffectOperation> => {
  const controllers = new Map<string, MoveBranchEffectOperation>()
  for (const operation of operations) {
    if (operation.kind !== 'branch') continue
    for (const branch of moveEffectBranchPaths(operation.payload)) {
      for (const operationId of branch.operationIds) {
        const existing = controllers.get(operationId)
        if (existing && existing.payload.selectionId !== operation.payload.selectionId) {
          fail(
            'definition-integrity-mismatch',
            `Operation ${operationId} has multiple branch controllers.`,
          )
        }
        controllers.set(operationId, operation)
      }
    }
  }
  return controllers
}

type MoveRandomTableOperation = MoveRollEffectOperation & {
  readonly payload: Extract<MoveRollEffectOperation['payload'], {
    readonly formula: { readonly kind: 'table' }
  }>
}

type ExecutedMoveRandomTable = MoveRandomCandidateResolution<
  MoveRandomTableOperation['payload']['table']['entries'][number]
>

const randomTableControllerIndex = (
  operations: readonly MoveEffectOperation[],
): ReadonlyMap<string, MoveRandomTableOperation> => {
  const controllers = new Map<string, MoveRandomTableOperation>()
  for (const operation of operations) {
    if (operation.kind !== 'roll' || operation.payload.formula.kind !== 'table') continue
    const tableOperation = operation as MoveRandomTableOperation
    for (const entry of tableOperation.payload.table.entries) {
      for (const operationId of entry.operationIds) {
        const existing = controllers.get(operationId)
        if (existing && existing.id !== operation.id) {
          fail(
            'definition-integrity-mismatch',
            `Operation ${operationId} has multiple random-table controllers.`,
          )
        }
        controllers.set(operationId, tableOperation)
      }
    }
  }
  return controllers
}

interface MoveBranchOperationGate {
  readonly execute: boolean
  readonly recipientIds: readonly string[]
  readonly selectionId: string | null
}

const gateBranchControlledOperation = (options: {
  readonly operationId: string
  readonly resolveRecipientIds: () => readonly string[]
  readonly controller: MoveBranchEffectOperation | undefined
  readonly executions: ReadonlyMap<string, ExecutedMoveBranch>
}): MoveBranchOperationGate => {
  if (!options.controller) {
    return {
      execute: true,
      recipientIds: options.resolveRecipientIds(),
      selectionId: null,
    }
  }
  const selectionId = options.controller.payload.selectionId
  const execution = options.executions.get(selectionId)
    ?? fail(
      'definition-integrity-mismatch',
      `Branch ${selectionId} did not resolve before controlled operation ${options.operationId}.`,
    )
  const selectedDecisions = execution.decisions.filter(decision => (
    decision.operationIds.includes(options.operationId)
  ))
  if (selectedDecisions.length === 0) {
    return { execute: false, recipientIds: [], selectionId }
  }
  const recipientIds = options.resolveRecipientIds()
  if (execution.selection.scope === 'resolution') {
    return {
      execute: true,
      recipientIds,
      selectionId,
    }
  }
  const selectedRecipientIds = new Set(
    selectedDecisions.flatMap(decision => decision.recipientId ? [decision.recipientId] : []),
  )
  return {
    execute: true,
    recipientIds: recipientIds.filter(recipientId => selectedRecipientIds.has(recipientId)),
    selectionId,
  }
}

interface MoveRandomTableOperationGate {
  readonly execute: boolean
  readonly tableId: string | null
  readonly selectedId: string | null
}

const gateRandomTableControlledOperation = (options: {
  readonly operationId: string
  readonly controller: MoveRandomTableOperation | undefined
  readonly executions: ReadonlyMap<string, ExecutedMoveRandomTable>
  readonly skippedControllerIds: ReadonlySet<string>
}): MoveRandomTableOperationGate => {
  if (!options.controller) return { execute: true, tableId: null, selectedId: null }
  if (options.skippedControllerIds.has(options.controller.id)) {
    return {
      execute: false,
      tableId: options.controller.payload.table.tableId,
      selectedId: null,
    }
  }
  const execution = options.executions.get(options.controller.id)
    ?? fail(
      'definition-integrity-mismatch',
      `Random table ${options.controller.payload.table.tableId} did not resolve before controlled operation ${options.operationId}.`,
    )
  return {
    execute: execution.selected.operationIds.includes(options.operationId),
    tableId: options.controller.payload.table.tableId,
    selectedId: execution.selectedId,
  }
}

interface MoveSpecExecutionState {
  readonly responseResolver: MoveSpecResponseResolver
  readonly resolutionId: string | null
  readonly mechanicsSource: 'actor-move' | 'registered-spec'
  readonly sealRandomLedger: boolean
  readonly assertResponsesAtCompletion: boolean
  readonly nestedBudget: NestedMoveExecutionBudget
  readonly nestedDepth: number
  readonly root: boolean
  /** Exact server-generated Dancer/Danger Syrup seam; all other repeated specs remain rejected. */
  readonly allowReviewedSpecRepeat: boolean
}

interface NestedMoveTargetOption {
  readonly option: PendingMoveResponseOption
  readonly targetPlacementId: string
}

const nestedChildResolutionId = (input: {
  readonly parentResolutionId: string
  readonly operationId: string
  readonly canonicalId: string
  readonly actorPlacementId: string
}): string => `resolution-nested-${createHash('sha256')
  .update([
    input.parentResolutionId,
    input.operationId,
    input.canonicalId,
    input.actorPlacementId,
  ].join('\u0000'))
  .digest('hex')}`

const nestedTargetOptionId = (
  requestId: string,
  placementId: string,
): string => `nested-target.${createHash('sha256')
  .update(`${requestId}\u0000${placementId}`)
  .digest('hex')}`

const nestedTargetLabelKey = (index: number): string => (
  `move.nested-target-option-${index + 1}`
)

type ResolvedNestedMoveOperation = Omit<MoveNestedMoveEffectOperation, 'payload'> & {
  readonly payload: MoveNestedMoveRegisteredSpecPayload
}

interface ResolvedNestedMoveInvocation {
  readonly operation: ResolvedNestedMoveOperation
  readonly randomSelection: {
    readonly candidateCount: number
    readonly selectedId: string
    readonly attemptCount: number
    readonly rollIds: readonly string[]
  } | null
  readonly rollLedgerEntries: readonly MoveAutomationRollLedgerEntry[]
}

const nestedRuntimeFor = (
  context: AuthoritativeMoveRulesContext,
  operation: ResolvedNestedMoveOperation,
): MoveSpecV2Runtime => {
  const runtime = context.queries.rules.runtimeFor(operation.payload.canonicalId)
  if (
    !runtime
    || runtime.kind !== 'movespec-v2'
    || runtime.definition.spec.canonicalId !== operation.payload.canonicalId
  ) {
    return fail(
      'nested-runtime-unavailable',
      `Nested operation ${operation.id} can invoke only the server-selected reviewed spec ${operation.payload.canonicalId}.`,
    )
  }
  return runtime
}

const resolveNestedMoveInvocation = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveNestedMoveEffectOperation
  readonly recipientIds: readonly string[]
  readonly budget: NestedMoveExecutionBudget
}): ResolvedNestedMoveInvocation => {
  const payload = input.operation.payload
  const source = payload.source
  if (source.kind === 'registered-spec') {
    return Object.freeze({
      operation: input.operation as ResolvedNestedMoveOperation,
      randomSelection: null,
      rollLedgerEntries: Object.freeze([]),
    })
  }

  const ledgerStart = input.context.random.snapshot().length
  const selection = enforceRandomSelection(() => resolveAuthoritativeMovePool({
    definition: source.pool,
    context: input.context,
    recipientIds: input.recipientIds,
    parentEffectId: input.operation.id,
    reasonCode: input.operation.reasonCode,
    budget: input.budget,
    isCandidateValid: (canonicalId) => {
      const runtime = input.context.queries.rules.runtimeFor(canonicalId)
      if (!runtime || runtime.kind !== 'movespec-v2') return false
      const snapshot = input.budget.snapshot()
      return !snapshot.visitedCanonicalIds.includes(canonicalId)
        && !snapshot.bannedCanonicalIds.includes(canonicalId)
    },
  }))
  const operation: ResolvedNestedMoveOperation = Object.freeze({
    ...input.operation,
    payload: Object.freeze({
      canonicalId: selection.selectedId,
      actor: payload.actor,
      source: Object.freeze({ kind: 'registered-spec' as const }),
      targeting: payload.targeting,
    }),
  })
  return Object.freeze({
    operation,
    randomSelection: Object.freeze({
      candidateCount: selection.candidateCount,
      selectedId: selection.selectedId,
      attemptCount: selection.attemptCount,
      rollIds: frozenIds(selection.rollIds),
    }),
    rollLedgerEntries: Object.freeze(input.context.random.snapshot().slice(ledgerStart)),
  })
}

const nestedActorPlacementId = (
  context: AuthoritativeMoveRulesContext,
  operation: ResolvedNestedMoveOperation,
  recipientIds: readonly string[],
  responseOwnerIds: readonly string[],
): string => {
  if (operation.payload.actor.kind === 'parent-actor') {
    return context.actor.placement.id
  }
  const actorIds = operation.payload.actor.kind === 'response-owner'
    ? responseOwnerIds
    : recipientIds
  if (actorIds.length !== 1) {
    return fail(
      'nested-actor-invalid',
      `Nested operation ${operation.id} requires exactly one authoritative ${operation.payload.actor.kind}.`,
    )
  }
  return actorIds[0]!
}

const nestedIntentSelection = (
  targetIds: readonly string[],
): ResolveMoveIntent['selection'] => targetIds.length === 0
  ? { kind: 'self' }
  : targetIds.length === 1
    ? { kind: 'single-target', targetPlacementId: targetIds[0]! }
    : { kind: 'target-count', targetPlacementIds: [...targetIds] }

export const deriveNestedMoveRulesContext = (input: {
  readonly parent: AuthoritativeMoveRulesContext
  readonly actorPlacementId: string
  readonly canonicalId: string
  readonly targetIds: readonly string[]
  readonly resolutionId: string
  readonly ancestry: readonly MoveResolutionTraceAncestryEntry[]
}): AuthoritativeMoveRulesContext => {
  const placement = input.parent.queries.placements.get(input.actorPlacementId)
  const token = input.parent.queries.tokens.get(input.actorPlacementId)
  const sheet = placement ? input.parent.queries.sheets.forPlacement(placement) : null
  if (!placement || !token || !sheet) {
    return fail(
      'nested-actor-invalid',
      `Nested child actor ${input.actorPlacementId} is not a fully resolved authoritative placement.`,
    )
  }
  const selectedPlacements = input.targetIds.map(targetId => (
    input.parent.queries.placements.get(targetId)
    ?? fail('nested-targeting-invalid', `Nested child target ${targetId} is not authoritative.`)
  ))
  const candidatePlacements = input.parent.queries.placements.all()
  input.parent.reads.recordPlacement(placement)
  const placements = Object.freeze({
    ...input.parent.queries.placements,
    candidates: () => candidatePlacements,
    selected: () => Object.freeze([...selectedPlacements]),
  })
  const queries = Object.freeze({
    ...input.parent.queries,
    placements,
  })
  return Object.freeze({
    ...input.parent,
    intent: Object.freeze({
      schemaVersion: 1 as const,
      placementId: placement.id,
      moveName: input.canonicalId,
      selection: nestedIntentSelection(input.targetIds),
    }),
    resolutionId: input.resolutionId,
    actor: Object.freeze({ placement, token, sheet }),
    candidatePlacements,
    selectedPlacements: Object.freeze([...selectedPlacements]),
    ancestry: Object.freeze(input.ancestry.map(entry => Object.freeze({ ...entry }))),
    queries,
  })
}

const nestedDefinitionNamespace = (resolutionId: string): string => `nested.${createHash('sha256')
  .update(resolutionId)
  .digest('hex')
  .slice(0, 24)}`

const NESTED_DEFINITION_IDENTITY_KEYS = new Set([
  'id', 'rollId', 'effectId', 'requestId', 'selectionId', 'resourceId',
  'destinationSetId', 'itemSetId', 'tableId', 'checkId', 'zoneId', 'entityId',
])

/** Namespace interpreter-owned identities when a reviewed Ability child repeats the root spec. */
const namespaceRepeatedNestedDefinition = (
  definition: ValidatedMoveSpecDefinition,
  resolutionId: string,
): ValidatedMoveSpecDefinition => {
  const identities = new Set<string>()
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) collect(entry)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value)) {
      if (NESTED_DEFINITION_IDENTITY_KEYS.has(key) && typeof entry === 'string') identities.add(entry)
      collect(entry)
    }
  }
  collect(definition.spec.phases)
  const namespace = nestedDefinitionNamespace(resolutionId)
  const replacements = new Map([...identities].map(id => [id, `${namespace}.${id}`]))
  const rewrite = (value: unknown): unknown => {
    if (typeof value === 'string') return replacements.get(value) ?? value
    if (Array.isArray(value)) return value.map(rewrite)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewrite(entry)]))
  }
  return Object.freeze({
    ...definition,
    spec: Object.freeze({
      ...definition.spec,
      phases: rewrite(definition.spec.phases) as ValidatedMoveSpec['phases'],
    }),
  })
}

const centeredNestedAreaTargeting = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly runtime: MoveSpecV2Runtime
  readonly script: MoveAutomationScript
}): {
  readonly targetIds: readonly string[]
  readonly evaluations: readonly MoveSpecAuthoritativeTargetEvaluation[]
} | null => {
  const targeting = input.runtime.definition.spec.targeting
  if (targeting.kind !== 'area') return null
  const templates = input.script.areaTemplates?.filter(template => (
    template.kind === 'burst' || template.kind === 'cardinally-adjacent'
  )) ?? []
  if (templates.length !== 1 || templates.length !== (input.script.areaTemplates?.length ?? 0)) {
    return fail(
      'nested-targeting-invalid',
      `Nested area spec ${input.runtime.canonicalId} requires unsupported directional or aimed geometry.`,
    )
  }
  const cells = buildMoveAutomationAreaTemplateCells({
    template: templates[0]!,
    user: input.context.actor.token,
    bounds: input.context.map.dimensions,
    blockedCells: buildAllVoxelOccupancy(input.context.map.voxels),
  })
  const geometricIds = tokensInMoveAutomationArea({
    cells,
    tokens: input.context.queries.tokens.all(),
    excludeIds: [input.context.actor.placement.id],
  }).map(token => token.id)
  const resolved = resolveMoveAutomationAreaTargets({
    actorPlacementId: input.context.actor.placement.id,
    geometricallyAffectedPlacementIds: geometricIds,
    predicate: targeting.predicate ?? {
      relationship: 'any', willingness: 'any', excludeActor: true,
    },
    relationships: input.context.queries.relationships,
    states: input.context.queries.targetStates,
    targetability: input.context.queries.targetability,
    attackingMoveId: input.runtime.canonicalId,
  })
  return Object.freeze({
    targetIds: canonicalPlacementIds(input.context, resolved.eligibleTargetPlacementIds),
    evaluations: Object.freeze(resolved.evaluations.map(evaluation => Object.freeze({
      targetPlacementId: evaluation.targetPlacementId,
      outcome: evaluation.outcome,
      reasonCode: evaluation.reasonCode,
    }))),
  })
}

const nestedTargetOptions = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: ResolvedNestedMoveOperation
  readonly runtime: MoveSpecV2Runtime
  readonly selectorState: MoveSpecSelectorState
  readonly budget: NestedMoveExecutionBudget
}): readonly NestedMoveTargetOption[] => {
  const targeting = input.operation.payload.targeting
  if (targeting.kind !== 'fresh-choice') return Object.freeze([])
  const childTargeting = input.runtime.definition.spec.targeting
  if (
    childTargeting.kind === 'none'
    || childTargeting.kind === 'self'
    || childTargeting.kind === 'area'
    || childTargeting.kind === 'field'
    || childTargeting.kind === 'hazard'
    || childTargeting.minTargets !== 1
    || childTargeting.maxTargets !== 1
  ) {
    return fail(
      'nested-targeting-invalid',
      `Nested fresh target ${input.operation.id} requires a reviewed child with exactly one non-area target.`,
    )
  }
  const ids = evaluateMoveSelector({
    context: input.context,
    selectorState: input.selectorState,
    selector: targeting.selector,
  })
  enforceNestedExecutionBudget(() => input.budget.reserveTargets(
    ids.length,
    `Nested fresh-target request ${targeting.requestId}`,
  ))
  if (ids.length === 0) {
    return fail(
      'nested-targeting-invalid',
      `Nested fresh target ${input.operation.id} has no legal server-derived option.`,
    )
  }
  const options = ids.map((targetPlacementId, index): NestedMoveTargetOption => Object.freeze({
    targetPlacementId,
    option: Object.freeze({
      id: nestedTargetOptionId(targeting.requestId, targetPlacementId),
      // Dynamic target identity stays server-only until a dedicated authorized
      // targeting view projects it; generic option labels reveal no placement.
      labelKey: nestedTargetLabelKey(index),
    }),
  }))
  if (new Set(options.map(({ option }) => option.id)).size !== options.length) {
    return fail(
      'nested-targeting-invalid',
      `Nested target options for ${input.operation.id} produced an identity collision.`,
    )
  }
  return Object.freeze(options)
}

const nestedTargetRequest = (input: {
  readonly operation: ResolvedNestedMoveOperation
  readonly actorPlacementId: string
  readonly options: readonly NestedMoveTargetOption[]
}): MoveSpecPendingNestedTargetRequest => {
  const targeting = input.operation.payload.targeting
  if (targeting.kind !== 'fresh-choice') {
    return fail('nested-targeting-invalid', `Nested operation ${input.operation.id} has no fresh target request.`)
  }
  return Object.freeze({
    kind: 'nested-target-choice',
    childCanonicalId: input.operation.payload.canonicalId,
    operationId: input.operation.id,
    phase: input.operation.phase,
    reasonCode: input.operation.reasonCode,
    recipientIds: frozenIds([input.actorPlacementId]),
    requestId: targeting.requestId,
    promptKey: targeting.promptKey,
    options: Object.freeze(input.options.map(({ option }) => option)),
    allowPass: false,
  })
}

const projectNestedEmission = (input: {
  readonly emission: MoveSpecEmittedOperation
  readonly invocationPhase: MoveSpecPhase
  readonly childResolutionId: string
}): MoveSpecEmittedOperation => Object.freeze({
  operation: Object.freeze({
    ...input.emission.operation,
    phase: input.invocationPhase,
  }) as MoveEffectOperation,
  recipientIds: frozenIds(input.emission.recipientIds),
  childResolutionId: input.emission.childResolutionId ?? input.childResolutionId,
})

const projectNestedRequest = (
  request: MoveSpecPendingRequest,
  invocationPhase: MoveSpecPhase,
  parentAncestryDepth: number,
): MoveSpecPendingRequest => Object.freeze({
  ...request,
  // A nested reaction retains its reviewed child timing. Choice windows remain
  // projected at the parent invocation point because they precede child work.
  phase: request.kind === 'reaction' ? request.phase : invocationPhase,
  ...(request.kind === 'reaction' ? { depth: parentAncestryDepth } : {}),
})

const appendNestedTrace = (
  parent: MoveResolutionAuditTrace,
  child: MoveResolutionAuditTrace,
  invocationPhase: MoveSpecPhase,
  budget: NestedMoveExecutionBudget,
): MoveResolutionAuditTrace => {
  let trace = parent
  let projectedPhase = invocationPhase
  for (const event of child.events) {
    if (event.kind === 'phase-transition') continue
    const { sequence: _sequence, ...withoutSequence } = event
    if (event.kind === 'target') {
      enforceNestedExecutionBudget(() => budget.reserveEmittedEvents(
        1,
        `Nested trace projection for ${child.program.canonicalId}`,
      ))
      trace = appendMoveResolutionTrace(trace, {
        ...withoutSequence,
        phase: invocationPhase,
        reasonCode: 'nested-child-target',
      })
      continue
    }
    const pendingReaction = event.kind === 'operation'
      && event.operationKind === 'reaction-request'
      && event.outcome === 'pending'
    if (pendingReaction && event.phase !== projectedPhase) {
      enforceNestedExecutionBudget(() => budget.reserveEmittedEvents(
        1,
        `Nested reaction phase projection for ${child.program.canonicalId}`,
      ))
      trace = appendMoveResolutionTrace(trace, {
        kind: 'phase-transition',
        from: projectedPhase,
        to: event.phase,
        reasonCode: 'nested-child-reaction-phase',
      })
      projectedPhase = event.phase
    }
    enforceNestedExecutionBudget(() => budget.reserveEmittedEvents(
      1,
      `Nested trace projection for ${child.program.canonicalId}`,
    ))
    trace = appendMoveResolutionTrace(trace, {
      ...withoutSequence,
      // Pending reaction windows must link to their reviewed child phase so
      // durable timing validation and resume reconstruction remain exact.
      phase: projectedPhase,
    })
  }
  return trace
}

const childAncestry = (input: {
  readonly parentAncestry: readonly MoveResolutionTraceAncestryEntry[]
  readonly parentResolutionId: string
  readonly parentCanonicalId: string
  readonly parentDefinitionHash: string
  readonly parentOperationId: string
}): readonly MoveResolutionTraceAncestryEntry[] => Object.freeze([
  ...input.parentAncestry,
  Object.freeze({
    depth: input.parentAncestry.length,
    resolutionId: input.parentResolutionId,
    canonicalId: input.parentCanonicalId,
    definitionHash: input.parentDefinitionHash,
    parentOperationId: input.parentOperationId,
  }),
])

const terminalRollLedger = (
  context: AuthoritativeMoveRulesContext,
  seal: boolean,
): readonly MoveAutomationRollLedgerEntry[] => seal
  ? context.random.complete()
  : context.random.snapshot()

/**
 * Execute one reviewed MoveSpec against an immutable authoritative snapshot.
 * This layer emits typed operations only; repositories and state reducers are
 * intentionally outside the interpreter boundary.
 */
const executeMoveSpecInternal = (
  input: ExecuteMoveSpecInput,
  executionState: MoveSpecExecutionState,
): MoveSpecExecutionResult => {
  const handlerRegistry = input.handlerRegistry ?? REGISTERED_MOVE_HANDLER_REGISTRY
  const definition = executableDefinition(input, handlerRegistry)
  const { spec } = definition
  if (spec.canonicalId === 'Rest'
    && input.context.queries.abilities.has(input.context.actor.placement.id, 'Insomnia')) {
    fail(
      'move-mechanics-unavailable',
      'Rest cannot be executed while the user has effective Insomnia.',
    )
  }
  const targeting = input.serverAbilityTargetingOverride
    ?? resolveMoveSpecTargetingRule(spec, input.targetBranchId)
    ?? fail(
      'authoritative-target-invalid',
      `MoveSpec ${spec.canonicalId} requires one reviewed targeting branch ID.`,
    )
  enforceNestedExecutionBudget(() => executionState.nestedBudget.enterSpec(
    spec.canonicalId,
    executionState.nestedDepth,
    executionState.root,
    executionState.allowReviewedSpecRepeat,
  ))
  const program = executableProgram(
    definition,
    input.context,
    handlerRegistry,
    executionState.responseResolver,
    input.serverAbilityOverlayOperations,
  )
  enforceNestedExecutionBudget(() => executionState.nestedBudget.reserveOperations(
    program.operations.length,
    `MoveSpec ${spec.canonicalId}`,
  ))
  const reduceMoveResolutionTrace = (
    current: MoveResolutionAuditTrace,
    event: MoveResolutionAuditTraceEventInput,
  ): MoveResolutionAuditTrace => {
    enforceNestedExecutionBudget(() => executionState.nestedBudget.reserveEmittedEvents(
      1,
      `MoveSpec ${spec.canonicalId}`,
    ))
    return appendMoveResolutionTrace(current, event)
  }
  const branchControllers = branchControllerIndex(program.operations)
  const randomTableControllers = randomTableControllerIndex(program.operations)
  const reactionRequestsByOperationId = new Map(program.operations
    .filter((operation): operation is MoveReactionRequestEffectOperation => operation.kind === 'reaction-request')
    .map(operation => [operation.id, operation]))
  const choiceRequestsByOperationId = new Map(program.operations
    .filter((operation): operation is MoveChoiceRequestEffectOperation => operation.kind === 'choice-request')
    .map(operation => [operation.id, operation]))
  const responseRequestOperationIds = new Set([
    ...reactionRequestsByOperationId.keys(), ...choiceRequestsByOperationId.keys(),
  ])
  const responseResolver = executionState.responseResolver
  const hazardSelections = new Map<string, ValidatedAuthoritativeHazardCellSelection>()
  for (const selection of input.authoritativeHazardCellSelections ?? []) {
    if (hazardSelections.has(selection.operationId)) {
      fail(
        'definition-integrity-mismatch',
        `Hazard operation ${selection.operationId} received more than one authoritative cell selection.`,
      )
    }
    hazardSelections.set(selection.operationId, selection)
  }
  const consumedHazardSelections = new Set<string>()

  const activePhases = new Set<MoveSpecPhase>(program.operationsByPhase.keys())
  for (const phase of program.handlerTraceEntriesByPhase.keys()) activePhases.add(phase)
  for (const declaration of spec.costs) activePhases.add(declaration.phase)
  if (spec.preconditions.length > 0) activePhases.add('precondition')
  if (
    targeting.kind !== 'none'
    || targeting.selector !== null
    || targeting.minTargets > 0
    || targeting.maxTargets > 0
  ) {
    activePhases.add('target')
  }

  let trace = createMoveResolutionTrace({
    program: {
      canonicalId: spec.canonicalId,
      runtimeKind: 'movespec-v2',
      runtimeVersion: spec.version,
      definitionHash: definition.definitionHash,
    },
    ruleset: {
      rulesetId: definition.rulesetVersion.rulesetId,
      sourceDataSha256: definition.rulesetVersion.sourceDataSha256,
    },
    ancestry: input.ancestry,
  })
  let activePhase: MoveSpecPhase | null = null
  let targetIds: readonly string[] = []
  let hitTargetIds: readonly string[] = []
  let missedTargetIds: readonly string[] = []
  let damagedTargetIds: readonly string[] = []
  let faintedTargetIds: readonly string[] = []
  const operations: MoveSpecEmittedOperation[] = []
  const resolvedRolls: MoveSpecResolvedRoll[] = []
  const resolvedDamageTypes: MoveDamageTypeResolution[] = []
  const resolvedDamageBases: MoveContextualDamageBaseResolution[] = []
  const multiHitExecutions: MoveMultiHitExecution[] = []
  const resolvedChecks: MoveCheckResolution[] = []
  const branchSelections: MoveBranchSelection[] = []
  const resolvedMovements: MoveSpecResolvedMovement[] = []
  const resolvedSwitches: MoveSpecResolvedSwitch[] = []
  const resolvedItemChoices: MoveSpecResolvedItemChoice[] = []
  const resolvedHazardCells: MoveSpecResolvedHazardCells[] = []
  const childExecutions: MoveSpecChildExecution[] = []
  const branchExecutions = new Map<string, ExecutedMoveBranch>()
  const responseOwnerIdsByRequestOperation = new Map<string, readonly string[]>()
  const selectedResponseOptionByRequestOperation = new Map<string, string | null>()
  const responseOptionForReason = (
    reasonCode: string,
    moveSourceId: string | null,
  ): string | null | undefined => {
    const entries = [
      ...reactionRequestsByOperationId.entries(),
      ...choiceRequestsByOperationId.entries(),
    ].reverse()
    const match = entries.find(([requestOperationId, request]) => (
      request.reasonCode === reasonCode
      && (moveSourceId === null
        || (request.source.kind === 'move' && request.source.id === moveSourceId))
      && selectedResponseOptionByRequestOperation.has(requestOperationId)
    ))
    return match
      ? selectedResponseOptionByRequestOperation.get(match[0])
      : undefined
  }
  const selectedAbsorbForceOwnerIds = new Set<string>()
  const selectedBodyguardOwnerIds = new Set<string>()
  const selectedDelayedReactionOwnerIds = new Set<string>()
  const selectedDragonsMawTargetIds = new Set<string>()
  const selectedAa068PostHitOwnerIds = new Set<string>()
  const selectedFriendGuardTargetIds = new Set<string>()
  const selectedFullGuardTargetIds = new Set<string>()
  const selectedAa071ResistanceRequestOperationIds = new Set<string>()
  const selectedKampfgeistOwnerIds = new Set<string>()
  const selectedProbabilityControlOwnerIds = new Set<string>()
  const ordinaryKampfgeistDamageTargetIds = new Set<string>()
  // Probability Control redraws are evaluated before downstream mechanics, but
  // their audit entries must follow the durable response that authorized them.
  // Keeping the original roll trace as an exact prefix lets pending execution
  // replay through the response window without weakening resume validation.
  const deferredAa084RerollsByRequestOperation = new Map<string, Array<{
    readonly rollId: string
  }>>()
  for (const request of reactionRequestsByOperationId.values()) {
    if (request.reasonCode !== AA076_KAMPFGEIST_REASON) continue
    const selected = responseResolver.resolve({
      requestId: request.payload.requestId,
      options: request.payload.options,
      allowPass: request.payload.allowPass,
    })
    const ownerPlacementIds = request.payload.ownerPlacementIds ?? []
    if (selected?.optionId === 'ability.kampfgeist.use'
      && ownerPlacementIds.length === 1) {
      selectedKampfgeistOwnerIds.add(ownerPlacementIds[0]!)
    }
  }
  const aa072MoveTypeOverride = aa072SelectedMoveType({
    operations: program.operations,
    responses: responseResolver,
  })
  const aa083MoveTypeOverride = aa083SelectedMoveType({
    operations: program.operations,
    responses: responseResolver,
  })
  const aa084ProteanStab = aa084ProteanSelected({
    operations: program.operations,
    responses: responseResolver,
  })
  const aa072GoreSelected = [...reactionRequestsByOperationId.values()].some(operation => (
    operation.reasonCode === AA072_GORE_REASON
    && responseResolver.resolve({
      requestId: operation.payload.requestId,
      options: operation.payload.options,
      allowPass: operation.payload.allowPass,
    })?.optionId === 'ability.gore.use'
  ))
  const aa072GaleWingsSelected = [...reactionRequestsByOperationId.values()].some(operation => (
    operation.reasonCode === AA072_GALE_WINGS_REASON
    && responseResolver.resolve({
      requestId: operation.payload.requestId,
      options: operation.payload.options,
      allowPass: operation.payload.allowPass,
    })?.optionId === 'ability.gale-wings.flying'
  ))
  const aa072GorillaSelected = !aa072GoreSelected && aa072GorillaTacticsSelected({
    operations: program.operations,
    responses: responseResolver,
  })
  const selectedIgnitionBoostRequestId = [...reactionRequestsByOperationId.entries()]
    .find(([_operationId, request]) => request.reasonCode === AA075_IGNITION_BOOST_REASON
      && responseResolver.resolve({
        requestId: request.payload.requestId,
        options: request.payload.options,
        allowPass: request.payload.allowPass,
      })?.optionId === 'ability.ignition-boost.use')?.[0] ?? null
  const selectedInnardsOutByOwner = new Map<string, { readonly requestId: string; readonly targetId: string }>()
  for (const [requestId, request] of reactionRequestsByOperationId) {
    if (request.reasonCode !== AA075_INNARDS_OUT_REASON) continue
    const ownerId = request.source.kind === 'lifecycle-event'
      && request.source.id.startsWith('ability.innards-out.target:')
      ? request.source.id.slice('ability.innards-out.target:'.length)
      : null
    const response = responseResolver.resolve({
      requestId: request.payload.requestId,
      options: request.payload.options,
      allowPass: request.payload.allowPass,
    })
    const targetId = response?.optionId?.startsWith(AA075_INNARDS_OUT_OPTION_PREFIX)
      ? response.optionId.slice(AA075_INNARDS_OUT_OPTION_PREFIX.length)
      : null
    if (ownerId && targetId && !selectedInnardsOutByOwner.has(ownerId)) {
      selectedInnardsOutByOwner.set(ownerId, { requestId, targetId })
    }
  }
  const aa072ForcedPresentValue = aa072GorillaSelected
    ? null
    : aa072GiverForcedValue({
        operations: program.operations,
        responses: responseResolver,
      })
  const aa071ProtectedTargetId = (
    operation: MoveReactionRequestEffectOperation,
    prefix: string,
  ): string | null => operation.source.kind === 'lifecycle-event'
    && operation.source.id.startsWith(prefix)
    ? operation.source.id.slice(prefix.length)
    : null
  for (const operation of reactionRequestsByOperationId.values()) {
    const target = operation.reasonCode === AA071_FRIEND_GUARD_REASON
      ? { id: aa071ProtectedTargetId(operation, 'ability.friend-guard.target:'), set: selectedFriendGuardTargetIds }
      : operation.reasonCode === AA071_FULL_GUARD_REASON
        ? { id: aa071ProtectedTargetId(operation, 'ability.full-guard.target:'), set: selectedFullGuardTargetIds }
        : null
    if (!target?.id) continue
    const retained = responseResolver.resolve({
      requestId: operation.payload.requestId,
      options: operation.payload.options,
      allowPass: operation.payload.allowPass,
    })
    if (retained?.optionId !== null && retained?.optionId !== undefined) {
      target.set.add(target.id)
      selectedAa071ResistanceRequestOperationIds.add(operation.id)
    }
  }
  const cancelledEffectTargetIds = new Set<string>()
  const automaticHitTargetIds = new Set<string>()
  let bodyguardSelected = false
  let aquaBoostSelected = false
  let lightningRodSelected = false
  let magicBounceSelected = false
  let magicBounceHazardSelected = false
  let selectedMagicBounceHazardOwnerId: string | null = null
  const criticalHitTargetIds = new Set<string>()
  const projectedRemainingHpByTarget = new Map<string, number>()
  const projectedHp = createMoveAutomationHpUpdateAccumulator()
  const projectedInjuriesByTarget = new Map<string, number>()
  let moveCancelledByReaction = false
  const randomTableExecutions = new Map<string, ExecutedMoveRandomTable>()
  const skippedRandomTableOperationIds = new Set<string>()
  const currentSelectorState = (): MoveSpecSelectorState => ({
    targetIds,
    hitTargetIds,
    missedTargetIds,
    damagedTargetIds,
    faintedTargetIds,
    responseOwnerIds: [],
  })
  const referencedAccuracyRollIds = accuracyReferenceIds(program.operations)
  let mechanics: MoveSpecAuthoritativeMoveMechanics | null = null
  const getMechanics = (): MoveSpecAuthoritativeMoveMechanics => {
    if (mechanics) return mechanics
    const base = authoritativeMoveMechanics(
      input.context,
      spec.canonicalId,
      executionState.mechanicsSource,
    )
    const moveTypeOverride = aa072MoveTypeOverride ?? aa083MoveTypeOverride
    mechanics = moveTypeOverride
      ? { script: { ...base.script, type: moveTypeOverride } }
      : base
    return mechanics
  }
  const dampCancelled = ['Self-Destruct', 'Explosion'].includes(spec.canonicalId)
    && aa065DampCancelsMove({
      context: input.context,
      script: { moveName: spec.canonicalId },
    })
  if (dampCancelled) {
    moveCancelledByReaction = true
    activePhases.add('precondition')
  }

  for (const phase of MOVE_SPEC_PHASES) {
    if (!activePhases.has(phase)) continue
    trace = reduceMoveResolutionTrace(trace, {
      kind: 'phase-transition',
      from: activePhase,
      to: phase,
      reasonCode: `${phase}-phase`,
    })
    activePhase = phase

    if (phase === 'precondition') {
      if (dampCancelled) {
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'predicate', phase, predicateId: 'ability.damp.prevent-explosion',
          outcome: true, reasonCode: 'ability.damp.effects-fail',
          input: { subjectPlacementId: input.context.actor.placement.id },
        })
      }
      for (const precondition of spec.preconditions) {
        const evaluation = evaluateMovePredicate({
          predicate: precondition.predicate,
          context: input.context,
          canonicalMoveId: spec.canonicalId,
          rootNodeId: precondition.id,
          selectorState: {
            targetIds,
            hitTargetIds,
            missedTargetIds,
            damagedTargetIds,
            faintedTargetIds,
          },
        })
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'predicate',
          phase,
          predicateId: precondition.id,
          outcome: evaluation.value,
          reasonCode: evaluation.value
            ? 'precondition-passed'
            : precondition.failureReasonCode,
          input: traceJson({
            predicateKind: precondition.predicate.kind,
            evaluationTrace: evaluation.trace,
          }),
        })
        if (!evaluation.value) {
          return Object.freeze({
            kind: 'rejected',
            ...terminalBase(
              input.context,
              operations,
              targetIds,
              trace,
              terminalRollLedger(input.context, executionState.sealRandomLedger),
              resolvedRolls,
              resolvedDamageTypes,
              resolvedDamageBases,
              multiHitExecutions,
              resolvedChecks,
              branchSelections,
              resolvedMovements,
              resolvedSwitches,
              resolvedItemChoices,
              resolvedHazardCells,
              childExecutions,
              currentSelectorState(),
            ),
            rejection: Object.freeze({
              code: 'precondition-failed',
              reasonCode: precondition.failureReasonCode,
              preconditionId: precondition.id,
              actualTargetCount: null,
              minimumTargetCount: null,
              maximumTargetCount: null,
            }),
          })
        }
      }
    }

    if (phase === 'target') {
      if (
        input.authoritativeTargetEvaluations !== undefined
        && targeting.kind !== 'area'
      ) {
        fail(
          'authoritative-target-invalid',
          'Server-derived target evaluations are supported only for geometric area targeting.',
        )
      }
      if (
        targeting.kind === 'area'
        && input.authoritativeTargetEvaluations === undefined
      ) {
        fail(
          'authoritative-target-invalid',
          'Geometric area targeting requires complete server-derived target evaluations.',
        )
      }
      const resolvedTargetIds = targetIdsForSpec(
        input.context,
        targeting,
        input.authoritativeTargetIds,
      )
      enforceNestedExecutionBudget(() => executionState.nestedBudget.reserveTargets(
        resolvedTargetIds.length,
        `MoveSpec ${spec.canonicalId}`,
      ))
      targetIds = resolvedTargetIds.length <= MOVE_SPEC_LIMITS.targetCount
        ? resolvedTargetIds
        : []
      if (input.context.queries.abilities.has(input.context.actor.placement.id, 'Hunger Switch')
        && aa074HungerModeForPlacement(
          input.context.map.encounterState?.effects,
          input.context.actor.placement.id,
        ) === null) {
        fail(
          'move-mechanics-unavailable',
          'Hunger Switch requires a Full Belly or Hangry choice for the active turn.',
        )
      }
      if (!aa072GorillaTacticsMoveAllowed({
        context: input.context,
        placementId: input.context.actor.placement.id,
        canonicalMoveId: spec.canonicalId,
      })) {
        fail(
          'move-mechanics-unavailable',
          `Gorilla Tactics does not permit ${spec.canonicalId} in this Scene.`,
        )
      }
      for (const placementId of [input.context.actor.placement.id, ...targetIds]) {
        const forecast = aa071ForecastTypeResolution({
          contextMap: input.context.map,
          placementId,
          hasForecast: input.context.queries.abilities.has(placementId, 'Forecast'),
        })
        if (forecast.ambiguous) {
          fail(
            'move-mechanics-unavailable',
            `Forecast owner ${placementId} must choose one active weather Type before Move resolution.`,
          )
        }
      }
      for (const targetPlacementId of targetIds) {
        if (targetPlacementId === input.context.actor.placement.id) continue
        const sight = input.context.queries.lineOfSight.resolve(
          input.context.actor.placement.id,
          targetPlacementId,
        )
        if (!sight.targetable) {
          fail(
            'authoritative-target-invalid',
            `Target ${targetPlacementId} is blocked by authoritative line of sight (${sight.reasonCode}).`,
          )
        }
      }
      const targetMechanics = optionalAuthoritativeMoveMechanics(
        input.context,
        spec.canonicalId,
        executionState.mechanicsSource,
      )
      hitTargetIds = targeting.kind !== 'self'
        && targeting.kind !== 'none'
        && targetMechanics?.script.requiresAccuracy === false
        ? targetIds
        : []
      missedTargetIds = []
      const suppliedEvaluations = authoritativeTargetEvaluations(
        input.context,
        targetIds,
        input.authoritativeTargetEvaluations,
      )
      const targetIdSet = new Set(targetIds)
      const evaluations = suppliedEvaluations ?? consideredTargetIds(
        input.context,
        targeting,
        targetIds,
      ).map((targetPlacementId): MoveSpecAuthoritativeTargetEvaluation => {
        const included = targetIdSet.has(targetPlacementId)
        return {
          targetPlacementId,
          outcome: included ? 'included' : 'excluded',
          reasonCode: included ? 'target-selector-included' : 'target-selector-excluded',
        }
      })
      for (const evaluation of evaluations) {
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'target',
          phase,
          targetId: evaluation.targetPlacementId,
          outcome: evaluation.outcome,
          reasonCode: evaluation.reasonCode,
        })
      }

      if (
        resolvedTargetIds.length < targeting.minTargets
        || resolvedTargetIds.length > targeting.maxTargets
      ) {
        return Object.freeze({
          kind: 'rejected',
          ...terminalBase(
            input.context,
            operations,
            targetIds,
            trace,
            terminalRollLedger(input.context, executionState.sealRandomLedger),
            resolvedRolls,
            resolvedDamageTypes,
            resolvedDamageBases,
            multiHitExecutions,
            resolvedChecks,
            branchSelections,
            resolvedMovements,
            resolvedSwitches,
            resolvedItemChoices,
            resolvedHazardCells,
            childExecutions,
            currentSelectorState(),
          ),
          rejection: Object.freeze({
            code: 'target-count-out-of-range',
            reasonCode: 'target-count-out-of-range',
            preconditionId: null,
            actualTargetCount: resolvedTargetIds.length,
            minimumTargetCount: targeting.minTargets,
            maximumTargetCount: targeting.maxTargets,
          }),
        })
      }
    }

    for (const handlerTraceEntry of program.handlerTraceEntriesByPhase.get(phase) ?? []) {
      trace = reduceMoveResolutionTrace(trace, handlerTraceEntry)
    }

    for (const operation of program.operationsByPhase.get(phase) ?? []) {
      const selectorState: MoveSpecSelectorState = {
        targetIds,
        hitTargetIds,
        missedTargetIds,
        damagedTargetIds,
        faintedTargetIds,
      }
      if (
        moveCancelledByReaction
        && operation.kind !== 'usage'
        && operation.kind !== 'log'
      ) {
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds: [],
          outcome: 'prevented',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: { status: 'move-cancelled-by-reaction' },
        })
        continue
      }
      const resolveOperationRecipientIds = (): readonly string[] => {
        if (operation.reasonCode === AA080_MOTOR_DRIVE_STAGE_REASON) {
          const ownerId = aa080MotorDriveOwnerForOperation(operation)
          if (!ownerId
            || !input.context.queries.abilities.has(ownerId, 'Motor Drive')) return []
          const ordinaryElectricHit = hitTargetIds.includes(ownerId)
            && resolvedDamageTypes.some(resolution => (
              resolution.recipientId === ownerId
              && resolution.moveType.trim().toLowerCase() === 'electric'
            ))
          const multiElectricHit = multiHitExecutions.some(execution => (
            execution.hitTargetIds.includes(ownerId)
            && execution.resolution.targets.some(target => (
              target.targetId === ownerId
              && target.strikes.some(strike => (
                strike.damage?.moveType.moveType.trim().toLowerCase() === 'electric'
              ))
            ))
          ))
          const hasResolvedDamageType = resolvedDamageTypes.some(resolution => resolution.recipientId === ownerId)
            || multiHitExecutions.some(execution => execution.resolution.targets.some(target => (
              target.targetId === ownerId && target.strikes.some(strike => Boolean(strike.damage))
            )))
          const reviewedElectricDirectOrStatusHit = !hasResolvedDamageType
            && getMechanics().script.type.trim().toLowerCase() === 'electric'
            && hitTargetIds.includes(ownerId)
          return ordinaryElectricHit || multiElectricHit || reviewedElectricDirectOrStatusHit ? [ownerId] : []
        }
        if (operation.kind === 'reaction-request' && operation.payload.ownerPlacementIds) {
          if (aa075InfiltratorBlocksResponsiveBlessings({
            context: input.context,
            actingPlacementId: input.context.actor.placement.id,
          }) && operation.source.kind === 'encounter-effect'
            && input.context.map.encounterState?.effects.some(effect => (
              effect.id === operation.source.id && effect.tags.includes('blessing')
            ))) return []
          const interruptChild = operation.reasonCode === 'ability.dig-away.optional-avoid'
            || program.operations.some(candidate => (
              candidate.kind === 'nested-move'
              && candidate.source.kind === 'operation'
              && candidate.source.id === operation.id
              && typeof candidate.payload.canonicalId === 'string'
              && /\bInterrupt\b/i.test(
                input.context.queries.rules.reviewedScriptFor(candidate.payload.canonicalId)?.range ?? '',
              )
            ))
          if (interruptChild && aa066DazzlingBlocksInterruptMovesAgainst({
            context: input.context,
            actionSourcePlacementId: input.context.actor.placement.id,
          })) return []
          let owners = canonicalPlacementIds(input.context, operation.payload.ownerPlacementIds)
          if (operation.reasonCode.startsWith('ability.')) {
            const abilitiesByPlacement = new Map(input.context.queries.placements.all().map(placement => [
              placement.id,
              input.context.queries.abilities.activeForPlacement(placement.id),
            ] as const))
            const tokensById = new Map(input.context.queries.tokens.all().map(token => [token.id, token] as const))
            owners = owners.filter(ownerPlacementId => !aa081NeutralizingGasBlocksTriggeredAbility({
              abilitiesByPlacement,
              tokensById,
              effects: input.context.map.encounterState?.effects ?? [],
              ownerPlacementId,
            }))
            if (owners.length === 0) return []
          }
          if (operation.reasonCode === AA080_MIRROR_ARMOR_REQUEST_REASON) {
            const ownerId = owners[0] ?? null
            const token = ownerId ? input.context.queries.tokens.get(ownerId) : null
            const sources = program.operations.flatMap(candidate => {
              if (candidate.reasonCode !== AA080_MIRROR_ARMOR_REFLECT_REASON
                || candidate.source.kind !== 'lifecycle-event'
                || !candidate.source.id.startsWith(`ability.mirror-armor.response:${operation.id}:source:`)) return []
              const sourceId = candidate.source.id.slice(
                `ability.mirror-armor.response:${operation.id}:source:`.length,
              )
              const source = program.operations.find(sourceOperation => sourceOperation.id === sourceId)
              return source?.kind === 'combat-stage' ? [source] : []
            })
            const canLoseStage = Boolean(token && sources.some(source => {
              const stage = aa080CombatStageKey(source.payload.stage)
              return stage && typeof source.payload.value === 'number'
                && (token.combatStages[stage] ?? 0) > -6
            }))
            return ownerId && canLoseStage
              && input.context.queries.abilities.has(ownerId, 'Mirror Armor')
              && hitTargetIds.includes(ownerId) ? owners : []
          }
          if (operation.reasonCode === AA084_PROBABILITY_CONTROL_REASON) {
            const hasResolvedRoll = operation.payload.options.some(option => resolvedRolls.some(roll => (
              option.id === `${AA084_PROBABILITY_CONTROL_OPTION_PREFIX}${roll.operationId}:${roll.recipientId ?? 'none'}`
            )))
            return hasResolvedRoll
              ? owners.filter(ownerId => !selectedProbabilityControlOwnerIds.has(ownerId))
              : []
          }
          if (operation.reasonCode === AA082_PACK_HUNT_REQUEST_REASON) {
            const targetId = operation.source.kind === 'lifecycle-event'
              && operation.source.id.startsWith('ability.pack-hunt.target:')
              ? operation.source.id.slice('ability.pack-hunt.target:'.length)
              : null
            return targetId && damagedTargetIds.includes(targetId) ? owners : []
          }
          if (operation.reasonCode === AA083_PERISH_BODY_REASON
            || operation.reasonCode === AA083_PICKPOCKET_REASON
            || operation.reasonCode === AA083_POISON_POINT_REASON) {
            const prefix = operation.reasonCode === AA083_PERISH_BODY_REASON
              ? 'ability.perish-body.target:'
              : operation.reasonCode === AA083_PICKPOCKET_REASON
                ? 'ability.pickpocket.target:'
                : 'ability.poison-point.target:'
            const targetId = operation.source.kind === 'lifecycle-event'
              && operation.source.id.startsWith(prefix)
              ? operation.source.id.slice(prefix.length)
              : null
            return targetId && hitTargetIds.includes(targetId) ? owners : []
          }
          if (operation.reasonCode === AA083_POISON_HEAL_REASON) {
            const targetId = operation.source.kind === 'lifecycle-event'
              && operation.source.id.startsWith('ability.poison-heal.target:')
              ? operation.source.id.slice('ability.poison-heal.target:'.length)
              : null
            const target = targetId ? input.context.queries.tokens.get(targetId) : null
            const pastelVeil = targetId && target ? input.context.queries.tokens.all().some(provider => (
              input.context.queries.abilities.has(provider.id, 'Pastel Veil')
              && (provider.id === targetId
                || input.context.queries.relationships.resolve(provider.id, targetId).relationship === 'ally')
              && ptuGridDistanceBetweenFootprints(provider, target) <= 3
            )) : false
            const poisonImmune = target?.defenderTypes.some(type => (
              type.trim().toLowerCase() === 'poison' || type.trim().toLowerCase() === 'steel'
            )) || (targetId ? input.context.queries.abilities.has(targetId, 'Immunity') : false)
              || pastelVeil
            const poisonOperations = program.operations.filter(candidate => (
              candidate.kind === 'condition'
              && candidate.payload.action === 'apply'
              && ['Poisoned', 'Badly Poisoned'].includes(
                normalizeConditionName(candidate.payload.conditionId) ?? '',
              )
            ))
            const rollEligible = poisonOperations.some(candidate => {
              const trigger = candidate.kind === 'condition'
                ? candidate.payload.accuracyRollTrigger
                : undefined
              if (!trigger) return true
              const roll = input.context.random.snapshot().find(entry => entry.rollId === trigger.rollId)
              if (!roll) return false
              return trigger.trigger.kind === 'range'
                ? roll.naturalResult >= trigger.trigger.minimum
                : trigger.trigger.values.includes(roll.naturalResult)
            })
            return targetId && target && !poisonImmune && rollEligible
              && (hitTargetIds.includes(targetId)
                || targetIds.includes(targetId)
                || targetId === input.context.actor.placement.id) ? owners : []
          }
          if (operation.reasonCode === AA083_PLUS_REQUEST_REASON) {
            const targetId = operation.source.kind === 'lifecycle-event'
              && operation.source.id.startsWith('ability.plus.target:')
              ? operation.source.id.slice('ability.plus.target:'.length)
              : null
            const target = targetId ? input.context.queries.tokens.get(targetId) : null
            const stages = program.operations.flatMap(candidate => (
              candidate.kind === 'combat-stage'
              && candidate.reasonCode === AA083_PLUS_STAGE_REASON
              && candidate.source.kind === 'lifecycle-event'
              && candidate.source.id.startsWith(`ability.plus.response:${operation.id}:option:`)
                ? [aa080CombatStageKey(candidate.payload.stage)] : []
            ))
            const canGainStage = Boolean(target && stages.some(stage => (
              stage !== null && (target.combatStages[stage] ?? 0) < 6
            )))
            const ownerId = owners[0] ?? null
            return ownerId && targetId && canGainStage
              && input.context.queries.abilities.has(ownerId, 'Plus') ? owners : []
          }
          if (operation.reasonCode === AA081_MUMMY_REQUEST_REASON) {
            const targetId = operation.source.kind === 'lifecycle-event'
              && operation.source.id.startsWith('ability.mummy.target:')
              ? operation.source.id.slice('ability.mummy.target:'.length)
              : null
            return targetId && hitTargetIds.includes(targetId)
              && input.context.queries.abilities.has(targetId, 'Mummy') ? owners : []
          }
          if (operation.reasonCode === AA080_MINUS_REQUEST_REASON) {
            const targetId = operation.source.kind === 'lifecycle-event'
              && operation.source.id.startsWith('ability.minus.target:')
              ? operation.source.id.slice('ability.minus.target:'.length)
              : null
            const target = targetId ? input.context.queries.tokens.get(targetId) : null
            const stages = program.operations.flatMap(candidate => (
              candidate.kind === 'combat-stage'
              && candidate.reasonCode === AA080_MINUS_STAGE_REASON
              && candidate.source.kind === 'lifecycle-event'
              && candidate.source.id.startsWith(`ability.minus.response:${operation.id}:option:`)
                ? [aa080CombatStageKey(candidate.payload.stage)] : []
            ))
            const canLoseStage = Boolean(target && stages.some(stage => (
              stage !== null && (target.combatStages[stage] ?? 0) > -6
            )))
            const ownerId = owners[0] ?? null
            return ownerId && targetId && canLoseStage
              && input.context.queries.abilities.has(ownerId, 'Minus')
              && hitTargetIds.includes(targetId) ? owners : []
          }
          if (operation.reasonCode === AA078_LIGHTNING_ROD_REASON) {
            return lightningRodSelected ? [] : owners
          }
          if (operation.reasonCode === AA078_LULLABY_REASON) return owners
          if (operation.reasonCode === AA078_MAGIC_BOUNCE_REASON) {
            return magicBounceSelected ? [] : owners.filter(ownerId => hitTargetIds.includes(ownerId))
          }
          if (operation.reasonCode === AA078_MAGIC_BOUNCE_HAZARD_REASON) {
            return magicBounceHazardSelected ? [] : owners
          }
          if (operation.reasonCode === AA078_LUNCHBOX_REASON) {
            return owners.filter(ownerId => operations.some(emission => (
              emission.operation.kind === 'item'
              && emission.operation.payload.action === 'digest-buff'
              && emission.recipientIds.includes(ownerId)
            )))
          }
          if (operation.reasonCode === 'ability.danger-syrup.optional-sweet-scent') {
            return owners.filter(ownerId => hitTargetIds.includes(ownerId))
          }
          if (operation.reasonCode === AA067_DELAYED_REACTION_REASON
            || AA067_AVOIDANCE_REASONS.has(operation.reasonCode)
            || operation.reasonCode === AA069_FADE_AWAY_REASON) {
            return owners.filter(ownerId => hitTargetIds.includes(ownerId))
          }
          if (operation.reasonCode === AA069_EMERGENCY_EXIT_REASON) {
            return owners.filter((ownerId) => {
              const token = input.context.queries.tokens.get(ownerId)
              if (!token) return false
              const maximumHp = Math.max(1, token.fullMaxHp ?? token.maxHp)
              return token.currentHp * 2 >= maximumHp
                && projectedHp.get(token) * 2 < maximumHp
            })
          }
          if (operation.reasonCode === AA068_DRAGONS_MAW_REASON) {
            const targetId = aa068TargetBoundOperationTargetId(operation)
            return targetId && hitTargetIds.includes(targetId)
              && selectedDragonsMawTargetIds.size === 0 ? owners : []
          }
          if (operation.reasonCode === AA068_DREAM_SMOKE_REASON
            || operation.reasonCode === AA068_EFFECT_SPORE_REASON) {
            const targetId = aa068TargetBoundOperationTargetId(operation)
            return targetId && hitTargetIds.includes(targetId)
              && !selectedAa068PostHitOwnerIds.has(targetId) ? owners : []
          }
          const aa065TargetPrefixes = new Map<string, string>([
            ['ability.corrosive-toxins.optional-bypass', 'ability.corrosive-toxins.target:'],
            ['ability.cruelty.optional-purchases', 'ability.cruelty.target:'],
            ['ability.cotton-down.optional-burst', 'ability.cotton-down.center:'],
            ['ability.cursed-body.optional-disable', 'ability.cursed-body.target:'],
            ['ability.cute-charm.optional-infatuation', 'ability.cute-charm.target:'],
            ['ability.cute-tears.optional-stage-loss', 'ability.cute-tears.target:'],
          ])
          const aa065Prefix = aa065TargetPrefixes.get(operation.reasonCode)
          if (aa065Prefix) {
            const targetId = operation.source.kind === 'lifecycle-event'
              && operation.source.id.startsWith(aa065Prefix)
              ? operation.source.id.slice(aa065Prefix.length)
              : null
            const eligibleIds = operation.reasonCode === 'ability.cute-charm.optional-infatuation'
              ? targetIds
              : hitTargetIds
            return targetId && eligibleIds.includes(targetId) ? owners : []
          }
          if (operation.reasonCode === 'ability.bully.optional-effects') {
            const targetId = operation.source.kind === 'lifecycle-event'
              && operation.source.id.startsWith('ability.bully.target:')
              ? operation.source.id.slice('ability.bully.target:'.length)
              : null
            const superEffective = targetId !== null && resolvedDamageTypes.some(resolution => (
              resolution.recipientId === targetId && resolution.finalMultiplier > 1
            ))
            return targetId && damagedTargetIds.includes(targetId) && superEffective ? owners : []
          }
          if (operation.reasonCode === 'ability.celebrate.optional-disengage') {
            const hitEnemy = hitTargetIds.some(targetId => (
              input.context.queries.relationships.resolve(owners[0]!, targetId).relationship === 'enemy'
            ))
            return hitEnemy ? owners : []
          }
          if (operation.reasonCode === 'ability.chilling-neigh.optional-boost'
            || operation.reasonCode === AA073_GRIM_NEIGH_REASON
            || operation.reasonCode === 'ability.conqueror.optional-stages') {
            const alreadyHandledByChild = operation.reasonCode === 'ability.conqueror.optional-stages'
              && childExecutions.some(child => child.trace.events.some(event => (
                event.kind === 'operation'
                && event.reasonCode === operation.reasonCode
                && event.recipientIds.includes(owners[0]!)
              )))
            if (alreadyHandledByChild) return []
            const defeatedFoe = faintedTargetIds.some(targetId => (
              input.context.queries.relationships.resolve(owners[0]!, targetId).relationship === 'enemy'
            ))
            return defeatedFoe ? owners : []
          }
          if (operation.reasonCode === 'ability.color-change.optional-type') {
            return owners.filter(ownerId => hitTargetIds.includes(ownerId)
              && !childExecutions.some(child => child.trace.events.some(event => (
                event.kind === 'operation'
                && event.reasonCode === operation.reasonCode
                && event.recipientIds.includes(ownerId)
              ))))
          }
          if (operation.reasonCode === 'ability.combo-striker.optional-struggle') {
            const ledger = new Map(input.context.random.snapshot().map(roll => [roll.rollId, roll]))
            const triggered = resolvedRolls.some(roll => (
              roll.purpose === 'accuracy'
              && [1, 10, 11].includes(ledger.get(roll.rollId)?.naturalResult ?? 0)
            ))
            return triggered ? owners : []
          }
          if (operation.reasonCode === 'ability.bodyguard.optional-redirection') {
            const protectedTargetId = operation.source.kind === 'lifecycle-event'
              && operation.source.id.startsWith('ability.bodyguard.target:')
              ? operation.source.id.slice('ability.bodyguard.target:'.length)
              : null
            return !bodyguardSelected && protectedTargetId && hitTargetIds.includes(protectedTargetId)
              ? owners
              : []
          }
          if (operation.reasonCode === AA072_GOOEY_REASON) {
            const targetId = operation.source.kind === 'lifecycle-event'
              && operation.source.id.startsWith('ability.gooey.target:')
              ? operation.source.id.slice('ability.gooey.target:'.length)
              : null
            return targetId && hitTargetIds.includes(targetId) ? owners : []
          }
          if (operation.reasonCode === AA075_IGNITION_BOOST_REASON) {
            if (selectedIgnitionBoostRequestId === null) return owners
            const requests = [...reactionRequestsByOperationId.keys()]
              .filter(id => reactionRequestsByOperationId.get(id)?.reasonCode === AA075_IGNITION_BOOST_REASON)
            return requests.indexOf(operation.id) <= requests.indexOf(selectedIgnitionBoostRequestId)
              ? owners
              : []
          }
          if (operation.reasonCode === AA075_INNARDS_OUT_REASON) {
            const ownerId = operation.source.kind === 'lifecycle-event'
              && operation.source.id.startsWith('ability.innards-out.target:')
              ? operation.source.id.slice('ability.innards-out.target:'.length)
              : null
            return ownerId && hitTargetIds.includes(ownerId) ? owners : []
          }
          if (operation.reasonCode === AA076_IRON_BARBS_REASON) {
            const ownerId = operation.source.kind === 'lifecycle-event'
              && operation.source.id.startsWith('ability.iron-barbs.target:')
              ? operation.source.id.slice('ability.iron-barbs.target:'.length)
              : null
            const ownerWasHit = ownerId !== null && (
              hitTargetIds.includes(ownerId)
              || multiHitExecutions.some(execution => execution.hitTargetIds.includes(ownerId))
            )
            return ownerWasHit ? owners : []
          }
          if (operation.reasonCode === AA076_JUSTIFIED_REASON) {
            const ownerId = operation.source.kind === 'lifecycle-event'
              && operation.source.id.startsWith('ability.justified.target:')
              ? operation.source.id.slice('ability.justified.target:'.length)
              : null
            const attackOfOpportunity = input.ancestry?.some(entry => (
              entry.canonicalId === 'Attack of Opportunity'
            )) ?? false
            const darkAttack = ownerId !== null && (
              resolvedDamageTypes.some(resolution => (
                resolution.recipientId === ownerId && resolution.moveType === 'Dark'
              ))
              || multiHitExecutions.some(execution => (
                execution.resolution.targets.some(target => target.targetId === ownerId
                  && target.strikes.some(strike => strike.damage?.moveType.moveType === 'Dark'))
              ))
            )
            const ownerWasHit = ownerId !== null && (
              hitTargetIds.includes(ownerId)
              || multiHitExecutions.some(execution => execution.hitTargetIds.includes(ownerId))
            )
            return ownerWasHit && (attackOfOpportunity || darkAttack) ? owners : []
          }
          if (operation.reasonCode === AA076_KAMPFGEIST_REASON) {
            const ownerId = operation.source.kind === 'lifecycle-event'
              && operation.source.id.startsWith('ability.kampfgeist.target:')
              ? operation.source.id.slice('ability.kampfgeist.target:'.length)
              : null
            const ordinaryMatchingHit = ownerId !== null && resolvedDamageTypes.some(resolution => (
              resolution.recipientId === ownerId
              && ['Bug', 'Dark', 'Rock'].includes(resolution.moveType)
            ))
            const multiMatchingHit = ownerId !== null && multiHitExecutions.some(execution => (
              execution.resolution.targets.some(target => target.targetId === ownerId
                && target.strikes.some(strike => strike.damage !== null
                  && ['Bug', 'Dark', 'Rock'].includes(strike.damage.moveType.moveType)))
            ))
            const multiHitDamage = ownerId !== null && multiHitExecutions.some(execution => (
              execution.resolution.targets.some(target => target.targetId === ownerId
                && target.strikes.some(strike => strike.damage !== null
                  && strike.damage.effectiveHpLost > 0
                  && ['Bug', 'Dark', 'Rock'].includes(strike.damage.moveType.moveType)))
            ))
            const triggeringDamage = ownerId !== null
              && (ordinaryKampfgeistDamageTargetIds.has(ownerId) || multiHitDamage)
            const retainedSelectedTrigger = ownerId !== null
              && selectedKampfgeistOwnerIds.has(ownerId)
              && (ordinaryMatchingHit || multiMatchingHit)
            return triggeringDamage || retainedSelectedTrigger ? owners : []
          }
          if (operation.reasonCode === AA072_GALE_WINGS_REASON
            || operation.reasonCode === AA072_GORE_REASON
            || operation.reasonCode === AA073_GULP_MISSILE_ARM_REASON
            || operation.reasonCode === AA073_HEAT_MIRAGE_REASON
            || operation.reasonCode === AA074_HELIOVOLT_REASON
            || operation.reasonCode === AA074_HORDE_BREAK_REASON) return owners
          if (operation.reasonCode === AA072_GORILLA_TACTICS_REASON) {
            return aa072GoreSelected ? [] : owners
          }
          if (operation.reasonCode === AA072_GALVANIZE_REASON) {
            return aa072GaleWingsSelected ? [] : owners
          }
          if (operation.reasonCode === AA072_GIVER_REASON) {
            return !aa072GorillaSelected && randomTableExecutions.size > 0 ? owners : []
          }
          if (operation.reasonCode === AA071_FRIEND_GUARD_REASON) {
            const protectedTargetId = operation.source.kind === 'lifecycle-event'
              && operation.source.id.startsWith('ability.friend-guard.target:')
              ? operation.source.id.slice('ability.friend-guard.target:'.length)
              : null
            return protectedTargetId && damagedTargetIds.includes(protectedTargetId)
              && (!selectedFriendGuardTargetIds.has(protectedTargetId)
                || selectedAa071ResistanceRequestOperationIds.has(operation.id)) ? owners : []
          }
          if (operation.reasonCode === AA071_FULL_GUARD_REASON) {
            const protectedTargetId = operation.source.kind === 'lifecycle-event'
              && operation.source.id.startsWith('ability.full-guard.target:')
              ? operation.source.id.slice('ability.full-guard.target:'.length)
              : null
            return protectedTargetId && damagedTargetIds.includes(protectedTargetId)
              && (!selectedFullGuardTargetIds.has(protectedTargetId)
                || selectedAa071ResistanceRequestOperationIds.has(operation.id)) ? owners : []
          }
          if (operation.reasonCode === 'ability.aqua-boost.optional-damage') {
            return !aquaBoostSelected && hitTargetIds.length > 0 ? owners : []
          }
          if (operation.reasonCode === AA069_ENFEEBLING_LIPS_REASON
            || operation.reasonCode === AA070_FLAME_TONGUE_REASON
            || operation.reasonCode === AA070_FLAVORFUL_AROMA_REASON
            || operation.reasonCode === AA079_MIGRAINE_REASON) {
            return hitTargetIds.length > 0 ? owners : []
          }
          if (operation.reasonCode === 'ability.beast-boost.optional-stage') {
            const defeatedOpponent = faintedTargetIds.some(targetId => (
              input.context.queries.relationships.resolve(owners[0]!, targetId).relationship === 'enemy'
            ))
            return defeatedOpponent ? owners : []
          }
          if (operation.payload.timing === 'post-damage') {
            return operation.reasonCode === 'ability.anger-point.optional-attack-stage'
              ? owners.filter(ownerId => criticalHitTargetIds.has(ownerId))
              : owners.filter(ownerId => damagedTargetIds.includes(ownerId))
          }
          if (operation.payload.timing === 'ko') {
            return operation.reasonCode === 'ability.aftermath.optional-hp-loss'
              ? owners.filter(ownerId => faintedTargetIds.includes(ownerId))
              : owners.filter(ownerId => hitTargetIds.includes(ownerId))
          }
          return ['post-hit', 'pre-damage'].includes(operation.payload.timing)
            ? owners.filter(ownerId => hitTargetIds.includes(ownerId))
            : owners
        }
        if (operation.reasonCode === AA081_MUMMY_SUPPRESS_REASON
          && !aa081MummySuppressionSelection({
            operation,
            selectedOptionByRequestId: selectedResponseOptionByRequestOperation,
          })) return []
        if (operation.source.kind === 'operation'
          && (reactionRequestsByOperationId.has(operation.source.id)
            || choiceRequestsByOperationId.get(operation.source.id)?.reasonCode
              === AA069_ENFEEBLING_LIPS_REASON)
          && (responseOwnerIdsByRequestOperation.get(operation.source.id)?.length ?? 0) === 0) {
          return []
        }
        if (operation.source.kind === 'operation') {
          const request = reactionRequestsByOperationId.get(operation.source.id)
            ?? choiceRequestsByOperationId.get(operation.source.id)
          const selectedOption = selectedResponseOptionByRequestOperation.get(operation.source.id)
          if (request?.reasonCode === AA069_ENFEEBLING_LIPS_REASON) {
            const expected = operation.reasonCode.startsWith('ability.enfeebling-lips.lower-')
              ? `ability.enfeebling-lips.${operation.reasonCode.slice('ability.enfeebling-lips.lower-'.length)}`
              : null
            if (!expected || selectedOption !== expected) return []
          }
          if (request?.reasonCode === AA069_FIERY_CRASH_REASON
            && operation.reasonCode === 'ability.fiery-crash.burn'
            && selectedOption !== 'ability.fiery-crash.fire-type') return []
          if (request?.reasonCode === AA070_FLASH_FIRE_REASON) {
            const expected = operation.reasonCode === 'ability.flash-fire.raise-attack'
              ? 'ability.flash-fire.attack'
              : operation.reasonCode === 'ability.flash-fire.raise-special-attack'
                ? 'ability.flash-fire.special-attack'
                : null
            if (!expected || selectedOption !== expected) return []
          }
        }
        if (operation.recipients.kind === 'response-owner') {
          if (operation.source.kind !== 'operation') return []
          const owners = responseOwnerIdsByRequestOperation.get(operation.source.id) ?? []
          const request = reactionRequestsByOperationId.get(operation.source.id)
            ?? choiceRequestsByOperationId.get(operation.source.id)
          if (request && owners.length === 1 && request.source.kind === 'lifecycle-event') {
            const aa065Prefixes = new Map<string, string>([
              ['ability.corrosive-toxins.optional-bypass', 'ability.corrosive-toxins.target:'],
              ['ability.cruelty.optional-purchases', 'ability.cruelty.target:'],
              ['ability.cotton-down.optional-burst', 'ability.cotton-down.center:'],
              ['ability.cursed-body.optional-disable', 'ability.cursed-body.target:'],
              ['ability.cute-charm.optional-infatuation', 'ability.cute-charm.target:'],
              ['ability.cute-tears.optional-stage-loss', 'ability.cute-tears.target:'],
            ])
            const prefix = aa065Prefixes.get(request.reasonCode)
            if (prefix && request.source.id.startsWith(prefix)) {
              const targetId = request.source.id.slice(prefix.length)
              if (!input.context.queries.placements.get(targetId)) return []
              if (request.reasonCode === 'ability.cruelty.optional-purchases') {
                const selected = selectedResponseOptionByRequestOperation.get(operation.source.id)
                const match = selected?.match(/^ability\.cruelty\.hp-(\d+)\.slow-([01])\.block-([01])$/)
                if (!match) return []
                if (operation.reasonCode.startsWith('ability.cruelty.lose-hp-')
                  && operation.reasonCode !== `ability.cruelty.lose-hp-${Number(match[1])}`) return []
                if (operation.reasonCode === 'ability.cruelty.slowed' && match[2] !== '1') return []
                if (operation.reasonCode === 'ability.cruelty.healing-blocked' && match[3] !== '1') return []
              }
              if (request.reasonCode === 'ability.cotton-down.optional-burst') {
                const center = input.context.queries.tokens.get(targetId)
                if (!center) return []
                return canonicalPlacementIds(input.context, input.context.queries.placements.all().flatMap((placement) => {
                  const token = input.context.queries.tokens.get(placement.id)
                  return token?.entityKind === 'pokemon'
                    && ptuGridDistanceBetweenFootprints(center, token) <= 1 ? [placement.id] : []
                }))
              }
              if (request.reasonCode === 'ability.cursed-body.optional-disable'
                || request.reasonCode === 'ability.cute-charm.optional-infatuation'
                || request.reasonCode === 'ability.cute-tears.optional-stage-loss') {
                return [input.context.actor.placement.id]
              }
              return [targetId]
            }
          }
          if ((request?.reasonCode === AA068_DREAM_SMOKE_REASON
            || request?.reasonCode === AA068_EFFECT_SPORE_REASON
            || request?.reasonCode === AA083_POISON_POINT_REASON)
            && owners.length === 1) {
            return [input.context.actor.placement.id]
          }
          if (request?.reasonCode === 'ability.bully.optional-effects'
            && owners.length === 1
            && request.source.kind === 'lifecycle-event'
            && request.source.id.startsWith('ability.bully.target:')) {
            const targetId = request.source.id.slice('ability.bully.target:'.length)
            return input.context.queries.placements.get(targetId) ? [targetId] : []
          }
          if ((operation.reasonCode === 'ability.chilling-neigh.foe-evasion'
            || operation.reasonCode === 'ability.grim-neigh.foe-accuracy') && owners.length === 1) {
            const owner = input.context.queries.tokens.get(owners[0]!)
            if (!owner) return []
            return canonicalPlacementIds(input.context, input.context.queries.placements.all().flatMap((placement) => {
              const token = input.context.queries.tokens.get(placement.id)
              return token
                && input.context.queries.relationships.resolve(owners[0]!, placement.id).relationship === 'enemy'
                && ptuGridDistanceBetweenFootprints(owner, token) <= 3
                ? [placement.id]
                : []
            }))
          }
          if (operation.reasonCode === 'ability.bodyguard.swap' && owners.length === 1
            && request?.source.kind === 'lifecycle-event'
            && request.source.id.startsWith('ability.bodyguard.target:')) {
            const protectedTargetId = request.source.id.slice('ability.bodyguard.target:'.length)
            return input.context.queries.placements.get(protectedTargetId)
              ? canonicalPlacementIds(input.context, [owners[0]!, protectedTargetId])
              : []
          }
          if (request?.reasonCode === AA067_DISGUISE_REASON) {
            const selectedOption = selectedResponseOptionByRequestOperation.get(operation.source.id)
            const expectedOption = operation.reasonCode.startsWith('ability.disguise.raise-')
              ? `ability.disguise.${operation.reasonCode.slice('ability.disguise.raise-'.length)}`
              : null
            if (selectedOption === undefined || selectedOption === null || selectedOption !== expectedOption) return []
          }
          if (request?.reasonCode === 'ability.beast-boost.optional-stage'
            || request?.reasonCode === 'ability.copy-master.choose-stage') {
            const selectedOption = selectedResponseOptionByRequestOperation.get(operation.source.id)
            const prefix = request.reasonCode === 'ability.beast-boost.optional-stage'
              ? 'ability.beast-boost.raise-'
              : 'ability.copy-master.raise-'
            const optionPrefix = request.reasonCode === 'ability.beast-boost.optional-stage'
              ? 'ability.beast-boost.'
              : 'ability.copy-master.'
            const expectedOption = operation.reasonCode.startsWith(prefix)
              ? `${optionPrefix}${operation.reasonCode.slice(prefix.length)}`
              : null
            if (selectedOption === undefined || selectedOption === null || selectedOption !== expectedOption) return []
          }
          if (request?.reasonCode === 'ability.aftermath.optional-hp-loss' && owners.length === 1) {
            const center = input.context.queries.tokens.get(owners[0]!)
            if (!center) return []
            return input.context.queries.placements.all().flatMap((placement) => {
              const token = input.context.queries.tokens.get(placement.id)
              return token && ptuGridDistanceBetweenFootprints(center, token) <= 1
                ? [placement.id]
                : []
            })
          }
          return owners
        }
        if (operation.kind === 'choice-request'
          && operation.reasonCode === AA069_ENFEEBLING_LIPS_REASON
          && hitTargetIds.length === 0) return []
        if (operation.reasonCode === AA074_HONEY_THIEF_TEMP_HP_REASON) {
          const targetId = targetIds.length === 1 ? targetIds[0]! : null
          return targetId && hitTargetIds.includes(targetId)
            && aa074TargetHasDigestionBuff(input.context, targetId)
            ? [input.context.actor.placement.id]
            : []
        }
        if (operation.reasonCode === AA075_ILLUSION_BREAK_REASON
          && operation.source.kind === 'lifecycle-event'
          && operation.source.id.startsWith('ability.illusion.target:')) {
          const illusionTargetId = operation.source.id.slice('ability.illusion.target:'.length)
          return hitTargetIds.includes(illusionTargetId) ? [illusionTargetId] : []
        }
        if (operation.reasonCode === AA075_INNARDS_OUT_HP_REASON
          && operation.source.kind === 'operation') {
          const selected = [...selectedInnardsOutByOwner.entries()]
            .find(([_ownerId, value]) => value.requestId === operation.source.id)
          return selected && selected[1].targetId
            && input.context.queries.placements.get(selected[1].targetId)
            ? [selected[1].targetId]
            : []
        }
        if (operation.reasonCode === AA076_IRON_BARBS_HP_REASON
          && operation.source.kind === 'operation') {
          const request = reactionRequestsByOperationId.get(operation.source.id)
          const selected = selectedResponseOptionByRequestOperation.get(operation.source.id)
          return request?.reasonCode === AA076_IRON_BARBS_REASON
            && selected === 'ability.iron-barbs.use'
            ? [input.context.actor.placement.id]
            : []
        }
        if (operation.reasonCode === 'ability.poison-point.apply-poisoned'
          && operation.source.kind === 'operation') {
          const request = reactionRequestsByOperationId.get(operation.source.id)
          const selected = selectedResponseOptionByRequestOperation.get(operation.source.id)
          return request?.reasonCode === AA083_POISON_POINT_REASON
            && selected === 'ability.poison-point.use'
            ? [input.context.actor.placement.id]
            : []
        }
        const harvestOwnerId = aa073HarvestOwnerId(operation)
        if (harvestOwnerId) {
          return (targetIds.includes(harvestOwnerId)
              || harvestOwnerId === input.context.actor.placement.id)
            && input.context.queries.abilities.has(harvestOwnerId, 'Harvest')
            ? [harvestOwnerId]
            : []
        }
        const gulpMissileOwnerId = aa073GulpMissileOwnerId(operation)
        if (gulpMissileOwnerId) {
          if (!damagedTargetIds.includes(gulpMissileOwnerId)) return []
          if (operation.reasonCode === AA073_GULP_MISSILE_CONSUME_REASON) {
            return input.context.queries.placements.get(gulpMissileOwnerId)
              ? [gulpMissileOwnerId]
              : []
          }
          if (operation.reasonCode === AA073_GULP_MISSILE_ROLL_REASON
            || operation.reasonCode === AA073_GULP_MISSILE_HP_REASON
            || operation.reasonCode === AA073_GULP_MISSILE_PARALYZE_REASON
            || operation.reasonCode === AA073_GULP_MISSILE_DEFENSE_REASON) {
            return [input.context.actor.placement.id]
          }
        }
        if (selectedMagicBounceHazardOwnerId !== null
          && operation.kind === 'hazard'
          && operation.payload.action === 'add') {
          return [selectedMagicBounceHazardOwnerId]
        }
        if (operation.reasonCode === AA078_LIQUID_OOZE_RECOIL_REASON) {
          return aa078HasLiquidOozeHitTarget({ context: input.context, hitTargetIds: damagedTargetIds })
            ? [input.context.actor.placement.id] : []
        }
        if (operation.kind === 'heal'
          && operation.recipients.kind === 'actor'
          && aa078IsDrainMove(spec.canonicalId)
          && aa078HasLiquidOozeHitTarget({ context: input.context, hitTargetIds: damagedTargetIds })) return []
        const targetBoundId = aa068TargetBoundOperationTargetId(operation)
        const resolved = effectRecipientIds(input.context, selectorState, operation.recipients.kind)
          .filter(recipientId => targetBoundId === null || recipientId === targetBoundId)
        const uncancelled = resolved.filter(recipientId => {
          if (cancelledEffectTargetIds.has(recipientId)) return false
          if (!input.context.queries.abilities.has(recipientId, 'Dry Skin')) return true
          return !aa068DrySkinCancelsRecipientEffect({
            context: input.context,
            script: getMechanics().script,
            recipientId,
            operationReasonCode: operation.reasonCode,
            operationKind: operation.kind,
          })
        })
        if (operation.reasonCode === 'ability.fiery-crash.burn'
          && operation.source.kind === 'operation') {
          return uncancelled.filter(recipientId => resolvedDamageTypes.some(resolved => (
            resolved.recipientId === recipientId && resolved.finalMultiplier > 0
          )))
        }
        if (operation.reasonCode === 'ability.flame-body.burn-attacker') {
          return uncancelled.filter(recipientId => recipientId === input.context.actor.placement.id)
        }
        if (operation.reasonCode.startsWith('ability.flame-tongue.')) {
          return uncancelled.filter(recipientId => (
            input.context.queries.relationships.resolve(
              input.context.actor.placement.id,
              recipientId,
            ).relationship === 'enemy'
          ))
        }
        if (operation.reasonCode.startsWith('ability.flavorful-aroma.')) {
          return uncancelled.filter(recipientId => (
            input.context.queries.relationships.resolve(
              input.context.actor.placement.id,
              recipientId,
            ).relationship === 'ally'
          ))
        }
        if (operation.reasonCode === 'ability.danger-syrup.blind-on-hit') {
          return uncancelled.filter(recipientId => (
            input.context.queries.relationships.resolve(
              input.context.actor.placement.id,
              recipientId,
            ).relationship === 'enemy'
          ))
        }
        if (operation.kind === 'combat-stage'
          && operation.reasonCode === AA080_MIRROR_ARMOR_REFLECT_REASON) {
          const encoded = operation.source.kind === 'lifecycle-event'
            && operation.source.id.startsWith('ability.mirror-armor.response:')
            ? operation.source.id.slice('ability.mirror-armor.response:'.length)
            : null
          const requestId = encoded?.includes(':source:')
            ? encoded.slice(0, encoded.indexOf(':source:'))
            : null
          const request = requestId
            ? program.operations.find(candidate => candidate.id === requestId)
            : null
          const ownerId = request?.kind === 'reaction-request'
            ? request.payload.ownerPlacementIds?.[0] ?? null
            : null
          return ownerId && hitTargetIds.includes(ownerId)
            && input.context.queries.abilities.has(ownerId, 'Mirror Armor')
            && requestId !== null
            && selectedResponseOptionByRequestOperation.get(requestId) === 'ability.mirror-armor.use'
            ? [input.context.actor.placement.id] : []
        }
        if (operation.kind === 'combat-stage'
          && operation.reasonCode === AA080_MINUS_STAGE_REASON) {
          const encoded = operation.source.kind === 'lifecycle-event'
            && operation.source.id.startsWith('ability.minus.response:')
            ? operation.source.id.slice('ability.minus.response:'.length)
            : null
          const optionMarker = encoded?.indexOf(':option:') ?? -1
          const targetMarker = encoded?.indexOf(':target:') ?? -1
          const requestId = optionMarker > 0 ? encoded!.slice(0, optionMarker) : null
          const selectedOptionId = optionMarker > 0 && targetMarker > optionMarker
            ? encoded!.slice(optionMarker + ':option:'.length, targetMarker) : null
          const targetId = targetMarker > 0 ? encoded!.slice(targetMarker + ':target:'.length) : null
          const request = requestId
            ? program.operations.find(candidate => candidate.id === requestId)
            : null
          const ownerId = request?.kind === 'reaction-request'
            ? request.payload.ownerPlacementIds?.[0] ?? null
            : null
          return ownerId && targetId && selectedOptionId
            && hitTargetIds.includes(targetId)
            && input.context.queries.abilities.has(ownerId, 'Minus')
            && selectedResponseOptionByRequestOperation.get(requestId!) === selectedOptionId
            ? uncancelled.filter(recipientId => recipientId === targetId) : []
        }
        if (operation.kind === 'combat-stage'
          && operation.reasonCode === AA083_PLUS_STAGE_REASON) {
          const encoded = operation.source.kind === 'lifecycle-event'
            && operation.source.id.startsWith('ability.plus.response:')
            ? operation.source.id.slice('ability.plus.response:'.length)
            : null
          const optionMarker = encoded?.indexOf(':option:') ?? -1
          const targetMarker = encoded?.indexOf(':target:') ?? -1
          const requestId = optionMarker > 0 ? encoded!.slice(0, optionMarker) : null
          const selectedOptionId = optionMarker > 0 && targetMarker > optionMarker
            ? encoded!.slice(optionMarker + ':option:'.length, targetMarker) : null
          const targetId = targetMarker > 0 ? encoded!.slice(targetMarker + ':target:'.length) : null
          const request = requestId
            ? program.operations.find(candidate => candidate.id === requestId)
            : null
          const ownerId = request?.kind === 'reaction-request'
            ? request.payload.ownerPlacementIds?.[0] ?? null
            : null
          return ownerId && targetId && selectedOptionId
            && input.context.queries.abilities.has(ownerId, 'Plus')
            && selectedResponseOptionByRequestOperation.get(requestId!) === selectedOptionId
            && input.context.queries.placements.get(targetId)
            ? [targetId] : []
        }
        if (operation.kind === 'combat-stage'
          && operation.payload.action === 'modify'
          && typeof operation.payload.value === 'number'
          && operation.payload.value < 0) {
          return uncancelled.filter(recipientId => {
            const request = program.operations.find(candidate => (
              candidate.kind === 'reaction-request'
              && candidate.reasonCode === AA080_MIRROR_ARMOR_REQUEST_REASON
              && candidate.payload.ownerPlacementIds?.includes(recipientId)
              && program.operations.some(reflected => (
                reflected.reasonCode === AA080_MIRROR_ARMOR_REFLECT_REASON
                && reflected.source.kind === 'lifecycle-event'
                && reflected.source.id === `ability.mirror-armor.response:${candidate.id}:source:${operation.id}`
              ))
            ))
            return !request
              || selectedResponseOptionByRequestOperation.get(request.id) !== 'ability.mirror-armor.use'
          })
        }
        return uncancelled
      }
      const randomTableGate = gateRandomTableControlledOperation({
        operationId: operation.id,
        controller: randomTableControllers.get(operation.id),
        executions: randomTableExecutions,
        skippedControllerIds: skippedRandomTableOperationIds,
      })
      if (!randomTableGate.execute) {
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds: [],
          outcome: 'prevented',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: traceJson({
            status: 'random-entry-not-selected',
            tableId: randomTableGate.tableId,
            selectedId: randomTableGate.selectedId,
          }),
        })
        continue
      }
      const branchGate = gateBranchControlledOperation({
        operationId: operation.id,
        resolveRecipientIds: resolveOperationRecipientIds,
        controller: branchControllers.get(operation.id),
        executions: branchExecutions,
      })
      if (!branchGate.execute) {
        // A branch may itself be controlled by an earlier reviewed branch.
        // Materialize an empty execution when its parent path is not selected
        // so descendants remain deterministically gated instead of observing
        // a missing controller.
        if (operation.kind === 'branch') {
          branchExecutions.set(operation.payload.selectionId, Object.freeze({
            selection: Object.freeze({
              operationId: operation.id,
              selectionId: operation.payload.selectionId,
              scope: operation.payload.scope,
              decisions: Object.freeze([]),
            }),
            decisions: Object.freeze([]),
          }))
        }
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds: [],
          outcome: 'prevented',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: traceJson({
            status: 'branch-not-selected',
            selectionId: branchGate.selectionId,
          }),
        })
        continue
      }
      const recipientIds = branchGate.recipientIds
      if (recipientIds.length === 0 && (
        operation.recipients.kind === 'response-owner'
        || (operation.source.kind === 'operation'
          && responseRequestOperationIds.has(operation.source.id))
      )) {
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds: [],
          outcome: 'no-op',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: { status: 'reaction-not-selected' },
        })
        continue
      }
      if (operation.kind === 'direct-hp' && operation.reasonCode === AA079_MAGMA_ARMOR_REASON) {
        const moveIdentity = input.context.resolutionId
          ?? `${operation.source.kind === 'move' ? operation.source.id : 'move'}:${getMechanics().script.moveName}`
        const ownerId = aa079MagmaArmorOwnerForOperation({
          context: input.context,
          operation,
          moveIdentity,
          candidateTargetIds: targetIds,
        })
        if (ownerId === null || !hitTargetIds.includes(ownerId)) {
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation', phase, operationId: operation.id,
            operationKind: operation.kind, recipientIds: [], outcome: 'no-op',
            reasonCode: operation.reasonCode, input: traceJson(operation.payload),
            result: { status: 'magma-armor-owner-not-hit' },
          })
          continue
        }
      }
      if (
        operation.kind === 'roll'
        && operation.payload.formula.kind === 'table'
        && 'table' in operation.payload
        && operation.payload.accuracyRollTrigger
      ) {
        const trigger = operation.payload.accuracyRollTrigger
        const referenced = resolvedRolls.filter(roll => (
          roll.referenceId === trigger.rollId && roll.purpose === 'accuracy'
        ))
        if (referenced.length !== 1) {
          return fail(
            'definition-integrity-mismatch',
            `Accuracy-triggered operation table ${operation.id} requires exactly one prior authoritative accuracy result.`,
          )
        }
        const ledger = input.context.random.snapshot().find(entry => (
          entry.rollId === referenced[0]!.rollId
        )) ?? fail(
          'definition-integrity-mismatch',
          `Accuracy-triggered operation table ${operation.id} cannot find roll ${referenced[0]!.rollId}.`,
        )
        const matched = trigger.trigger.kind === 'range'
          ? ledger.naturalResult >= aa061BeamCannonMinimum(input.context, trigger.trigger.minimum)
          : trigger.trigger.values.includes(ledger.naturalResult)
        if (!matched) {
          skippedRandomTableOperationIds.add(operation.id)
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: operation.id,
            operationKind: operation.kind,
            recipientIds,
            outcome: 'no-op',
            reasonCode: operation.reasonCode,
            input: traceJson(operation.payload),
            result: traceJson({
              status: 'accuracy-roll-trigger-not-met',
              requestedRollId: trigger.rollId,
              resolvedRollId: ledger.rollId,
              naturalResult: ledger.naturalResult,
            }),
          })
          continue
        }
      }
      if (
        spec.canonicalId === 'Knock Off'
        && operation.kind === 'item'
        && operation.id === KNOCK_OFF_ITEM_EFFECT_OPERATION.id
        && !resolvedItemChoices.some(choice => (
          choice.requestId === KNOCK_OFF_ITEM_REQUEST_ID
        ))
      ) {
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: 'no-op',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: { status: 'no-qualifying-item-outcome' },
        })
        continue
      }
      const reviewedResponseOptionForReason = (reasonCode: string) => responseOptionForReason(
        reasonCode,
        operation.source.kind === 'move' ? operation.source.id : null,
      )
      const aa079Operation = aa079MigraineDamageOperation({
        operation,
        responseOptionForReason: reviewedResponseOptionForReason,
      })
      const aa070Operation = aa079Operation.kind === 'damage' || aa079Operation.kind === 'multi-hit'
        ? aa070FlowerPowerDamageOperation({
            operation: aa079Operation,
            responseOptionForReason: reviewedResponseOptionForReason,
          })
        : aa079Operation
      const fieryCrashOption = operation.kind === 'damage'
        && input.context.queries.abilities.has(input.context.actor.placement.id, 'Fiery Crash')
        ? reviewedResponseOptionForReason(AA069_FIERY_CRASH_REASON)
        : undefined
      const fairyDamageCandidate = aa070Operation.kind === 'damage'
        && ((typeof aa070Operation.payload.moveType === 'string'
          && aa070Operation.payload.moveType.trim().toLowerCase() === 'fairy')
          || getMechanics().script.type.trim().toLowerCase() === 'fairy')
      const aa069DamageBaseRelevant = operation.kind === 'damage'
        && (fieryCrashOption === 'ability.fiery-crash.damage-base-plus-2'
          || fieryCrashOption === 'ability.fiery-crash.fire-type'
          || (fairyDamageCandidate && input.context.queries.placements.all().some(
            placement => input.context.queries.abilities.has(placement.id, 'Fairy Aura'),
          )))
      const baseEmittedOperation = operation.kind === 'damage'
        && recipientIds[0]
        && aa069DamageBaseRelevant
        ? (() => {
            const typed = aa069FieryCrashMoveType({
              operation: aa070Operation.kind === 'damage' ? aa070Operation : operation,
              responseOptionForReason: reviewedResponseOptionForReason,
            })
            const resolved = resolveMoveDamageType({
              context: input.context,
              operation: typed,
              script: getMechanics().script,
              recipientId: recipientIds[0]!,
              canonicalMoveId: spec.canonicalId,
              forceActorStab: aa084ProteanStab,
            })
            const bonus = aa069DamageBaseBonus({
              context: input.context,
              actor: input.context.actor.token,
              moveType: resolved.moveType,
              responseOptionForReason: reviewedResponseOptionForReason,
            })
            return bonus > 0 && typeof typed.payload.damageBase === 'number'
              ? { ...typed, payload: { ...typed.payload, damageBase: typed.payload.damageBase + bonus } }
              : typed
          })()
        : aa070Operation
      const aa078BaseEmittedOperation = baseEmittedOperation.kind === 'hazard'
        && baseEmittedOperation.payload.action === 'add'
        && selectedMagicBounceHazardOwnerId !== null
        ? {
            ...baseEmittedOperation,
            reasonCode: AA078_MAGIC_BOUNCE_HAZARD_OPERATION_REASON,
            payload: { ...baseEmittedOperation.payload, ownership: 'recipient-side' as const },
          }
        : baseEmittedOperation
      const emittedOperation = aa078BaseEmittedOperation.kind === 'direct-hp'
        && aa078BaseEmittedOperation.reasonCode === AA075_INNARDS_OUT_HP_REASON
        && aa078BaseEmittedOperation.source.kind === 'operation'
        ? (() => {
            const baseEmittedOperation = aa078BaseEmittedOperation
            const selected = [...selectedInnardsOutByOwner.entries()]
              .find(([_ownerId, value]) => value.requestId === baseEmittedOperation.source.id)
            if (!selected) return baseEmittedOperation
            const [ownerId] = selected
            const owner = input.context.queries.tokens.get(ownerId)
              ?? fail('definition-integrity-mismatch', `Innards Out owner ${ownerId} disappeared.`)
            const ordinaryRealHpLost = Math.max(0, owner.currentHp - projectedHp.get(owner))
            const multiHitRealHpLost = multiHitExecutions.reduce((total, execution) => (
              total + execution.resolution.targets
                .filter(target => target.targetId === ownerId)
                .flatMap(target => target.strikes)
                .reduce((sum, strike) => sum + (strike.damage?.realHpLost ?? 0), 0)
            ), 0)
            const amount = Math.min(
              MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude,
              (ordinaryRealHpLost + multiHitRealHpLost) * 2,
            )
            return {
              ...baseEmittedOperation,
              payload: {
                ...baseEmittedOperation.payload,
                calculation: { kind: 'fixed' as const, value: amount },
              },
            }
          })()
        : aa078BaseEmittedOperation
      const aa080EmittedOperation = emittedOperation.kind === 'combat-stage'
        && emittedOperation.reasonCode === AA080_MIRROR_ARMOR_REFLECT_REASON
        && emittedOperation.source.kind === 'lifecycle-event'
        && emittedOperation.source.id.startsWith('ability.mirror-armor.response:')
        ? (() => {
            const encoded = emittedOperation.source.id.slice('ability.mirror-armor.response:'.length)
            const requestId = encoded.includes(':source:')
              ? encoded.slice(0, encoded.indexOf(':source:')) : ''
            const request = program.operations.find(candidate => (
              candidate.id === requestId && candidate.kind === 'reaction-request'
            ))
            const ownerId = request?.kind === 'reaction-request'
              ? request.payload.ownerPlacementIds?.[0] ?? null
              : null
            const owner = ownerId ? input.context.queries.tokens.get(ownerId) : null
            const stage = aa080CombatStageKey(emittedOperation.payload.stage)
            const value = emittedOperation.payload.value
            if (!owner || !stage || typeof value !== 'number') return emittedOperation
            const current = owner.combatStages[stage] ?? 0
            const reflected = Math.max(-6, current + value) - current
            return {
              ...emittedOperation,
              payload: { ...emittedOperation.payload, value: reflected },
            }
          })()
        : emittedOperation
      const aa082EmittedOperation = aa080EmittedOperation.kind === 'direct-hp'
        && aa080EmittedOperation.reasonCode === AA082_PACK_HUNT_HP_REASON
        ? (() => {
            const identity = aa082PackHuntIdentity(aa080EmittedOperation)
            const target = identity ? input.context.queries.tokens.get(identity.targetId) : null
            const owner = identity ? input.context.queries.tokens.get(identity.ownerId) : null
            const rollOperation = aa080EmittedOperation.source.kind === 'operation'
              ? program.operations.find(candidate => candidate.id === aa080EmittedOperation.source.id)
              : null
            if (!identity || !target || !owner || rollOperation?.kind !== 'roll') {
              return { ...aa080EmittedOperation, payload: {
                ...aa080EmittedOperation.payload,
                calculation: { kind: 'fixed' as const, value: 0 },
              } }
            }
            const rollId = resolvedRollId(rollOperation.payload.rollId, 1)
            const roll = input.context.random.snapshot().find(candidate => candidate.rollId === rollId)
            const attackScript: MoveAutomationScript = {
              ...getMechanics().script,
              ac: 5, requiresAccuracy: true, damageClass: 'Physical',
            }
            const userAccuracy = moveAutomationUserAccuracy(owner, {
              fieldEffects: input.context.queries.rooms.projectFieldEffects(),
            })
            const targetEvasion = resolveMoveAutomationTargetEvasion(attackScript, target, {
              attacker: owner,
              fieldEffects: input.context.queries.rooms.projectFieldEffects(),
            }).value
            const hit = roll && resolveMoveAutomationAccuracyRoll(attackScript, roll.naturalResult, {
              userAccuracy, targetEvasion,
            }).hit
            return hit ? aa080EmittedOperation : {
              ...aa080EmittedOperation,
              payload: {
                ...aa080EmittedOperation.payload,
                calculation: { kind: 'fixed' as const, value: 0 },
              },
            }
          })()
        : aa080EmittedOperation
      operations.push(Object.freeze({
        operation: aa082EmittedOperation,
        recipientIds: frozenIds(recipientIds),
      }))

      if (operation.kind === 'branch') {
        if (operation.payload.kind === 'choice') {
          if (recipientIds.length === 0) {
            const selection = Object.freeze<MoveBranchSelection>({
              operationId: operation.id,
              selectionId: operation.payload.selectionId,
              scope: operation.payload.scope,
              decisions: Object.freeze([]),
            })
            const execution = Object.freeze<ExecutedMoveBranch>({
              selection,
              decisions: Object.freeze([]),
            })
            branchSelections.push(selection)
            branchExecutions.set(operation.payload.selectionId, execution)
            trace = reduceMoveResolutionTrace(trace, {
              kind: 'operation',
              phase,
              operationId: operation.id,
              operationKind: operation.kind,
              recipientIds,
              outcome: 'no-op',
              reasonCode: operation.reasonCode,
              input: traceJson(operation.payload),
              result: traceJson({ selection }),
            })
            continue
          }

          // Existing choices intentionally make one shared decision for every
          // recipient. Recipient-specific sequencing is enabled only when the
          // reviewed options declare server-evaluated eligibility predicates.
          // This preserves established optional/check continuations while
          // allowing moves such as Aromatherapy to expose only each ally's
          // current legal condition choices.
          if (!operation.payload.options.some(option => option.predicate)) {
            const request = pendingBranchRequest(
              operation,
              recipientIds,
              input.context.actor.placement.id,
            )
            const response = responseResolver.resolve({
              requestId: request.requestId,
              options: request.options,
              allowPass: request.allowPass,
            })
            if (response) {
              const execution = executeResolvedMoveChoiceBranch({
                operation,
                recipientIds,
                optionId: response.optionId,
              })
              branchSelections.push(execution.selection)
              branchExecutions.set(operation.payload.selectionId, execution)
              trace = reduceMoveResolutionTrace(trace, {
                kind: 'operation',
                phase,
                operationId: operation.id,
                operationKind: operation.kind,
                recipientIds,
                outcome: response.optionId === null ? 'no-op' : 'applied',
                reasonCode: operation.reasonCode,
                input: traceJson(operation.payload),
                result: traceJson({ selection: execution.selection }),
              })
              trace = reduceMoveResolutionTrace(trace, {
                kind: 'choice',
                phase,
                requestId: request.requestId,
                requestKind: 'choice',
                outcome: response.optionId === null ? 'passed' : 'selected',
                optionId: response.optionId,
                reasonCode: operation.reasonCode,
              })
              continue
            }
            trace = reduceMoveResolutionTrace(trace, {
              kind: 'operation',
              phase,
              operationId: operation.id,
              operationKind: operation.kind,
              recipientIds,
              outcome: 'pending',
              reasonCode: operation.reasonCode,
              input: traceJson(operation.payload),
              result: traceJson({
                requestId: request.requestId,
                requestKind: request.kind,
                selectionId: request.selectionId,
                scope: request.scope,
              }),
            })
            trace = reduceMoveResolutionTrace(trace, {
              kind: 'choice',
              phase,
              requestId: request.requestId,
              requestKind: 'choice',
              outcome: 'requested',
              optionId: null,
              reasonCode: operation.reasonCode,
            })
            responseResolver.assertAllConsumed()
            return materializePendingExecutionResult(
              terminalBase(
                input.context,
                operations,
                targetIds,
                trace,
                input.context.random.snapshot(),
                resolvedRolls,
                resolvedDamageTypes,
                resolvedDamageBases,
                multiHitExecutions,
                resolvedChecks,
                branchSelections,
                resolvedMovements,
                resolvedSwitches,
                resolvedItemChoices,
                resolvedHazardCells,
                childExecutions,
                currentSelectorState(),
              ),
              request,
            )
          }

          const subjects: readonly (string | null)[] = operation.payload.scope === 'resolution'
            ? [null]
            : recipientIds
          const decisions: ExecutedMoveBranch['decisions'][number][] = []
          for (const subject of subjects) {
            const eligibility = eligibleMoveChoiceOptions({
              operation,
              context: input.context,
              selectorState,
              canonicalMoveId: spec.canonicalId,
              recipientId: subject,
            })
            for (const candidate of eligibility) {
              if (!candidate.option.predicate) continue
              trace = reduceMoveResolutionTrace(trace, {
                kind: 'predicate',
                phase,
                predicateId: `${operation.payload.selectionId}.${candidate.option.id}`,
                outcome: candidate.eligible,
                reasonCode: candidate.eligible
                  ? 'branch-choice-option-eligible'
                  : 'branch-choice-option-ineligible',
                input: traceJson({
                  recipientId: subject,
                  evaluationTrace: candidate.evaluationTrace,
                }),
              })
            }
            const available = eligibility
              .filter(candidate => candidate.eligible)
              .map(candidate => candidate.option)
            if (available.length === 0 && operation.payload.pass === null) {
              return fail(
                'definition-integrity-mismatch',
                `Choice branch ${operation.payload.selectionId} has no eligible option for ${subject ?? 'the resolution'}.`,
              )
            }

            let optionId: string | null
            let requestId: string | null = null
            if (available.length === 0) {
              optionId = null
            }
            else if (available.length === 1 && operation.payload.pass === null) {
              optionId = available[0]!.id
            }
            else {
              const ownerRecipientIds = subject === null ? recipientIds : [subject]
              requestId = scopedBranchChoiceRequestId(
                operation.payload.requestId,
                subject ?? input.context.actor.placement.id,
                subjects.length,
              )
              const request = pendingBranchRequest(
                operation,
                ownerRecipientIds,
                input.context.actor.placement.id,
                available.map(option => ({ id: option.id, labelKey: option.labelKey })),
                requestId,
              )
              const response = responseResolver.resolve({
                requestId: request.requestId,
                options: request.options,
                allowPass: request.allowPass,
              })
              if (!response) {
                trace = reduceMoveResolutionTrace(trace, {
                  kind: 'operation',
                  phase,
                  operationId: operation.id,
                  operationKind: operation.kind,
                  recipientIds,
                  outcome: 'pending',
                  reasonCode: operation.reasonCode,
                  input: traceJson(operation.payload),
                  result: traceJson({
                    requestId: request.requestId,
                    requestKind: request.kind,
                    selectionId: request.selectionId,
                    scope: request.scope,
                    completedDecisionCount: decisions.length,
                  }),
                })
                trace = reduceMoveResolutionTrace(trace, {
                  kind: 'choice',
                  phase,
                  requestId: request.requestId,
                  requestKind: 'choice',
                  outcome: 'requested',
                  optionId: null,
                  reasonCode: operation.reasonCode,
                })
                responseResolver.assertAllConsumed()
                return materializePendingExecutionResult(
                  terminalBase(
                    input.context,
                    operations,
                    targetIds,
                    trace,
                    input.context.random.snapshot(),
                    resolvedRolls,
                    resolvedDamageTypes,
                    resolvedDamageBases,
                    multiHitExecutions,
                    resolvedChecks,
                    branchSelections,
                    resolvedMovements,
                    resolvedSwitches,
                    resolvedItemChoices,
                    resolvedHazardCells,
                    childExecutions,
                    currentSelectorState(),
                  ),
                  request,
                )
              }
              optionId = response.optionId
              trace = reduceMoveResolutionTrace(trace, {
                kind: 'choice',
                phase,
                requestId,
                requestKind: 'choice',
                outcome: optionId === null ? 'passed' : 'selected',
                optionId,
                reasonCode: operation.reasonCode,
              })
            }

            const selected = executeResolvedMoveChoiceBranch({
              operation,
              recipientIds: subject === null ? recipientIds : [subject],
              optionId,
            })
            decisions.push(...selected.decisions)
          }

          const selection = Object.freeze<MoveBranchSelection>({
            operationId: operation.id,
            selectionId: operation.payload.selectionId,
            scope: operation.payload.scope,
            decisions: Object.freeze(decisions.map(decision => Object.freeze({
              recipientId: decision.recipientId,
              branchId: decision.branchId,
              reasonCode: decision.reasonCode,
            }))),
          })
          const execution = Object.freeze<ExecutedMoveBranch>({
            selection,
            decisions: Object.freeze(decisions),
          })
          branchSelections.push(selection)
          branchExecutions.set(operation.payload.selectionId, execution)
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: operation.id,
            operationKind: operation.kind,
            recipientIds,
            outcome: decisions.some(decision => decision.operationIds.length > 0)
              ? 'applied'
              : 'no-op',
            reasonCode: operation.reasonCode,
            input: traceJson(operation.payload),
            result: traceJson({ selection }),
          })
          continue
        }

        const execution = executeServerMoveBranch({
          operation,
          context: input.context,
          recipientIds,
          selectorState,
          canonicalMoveId: spec.canonicalId,
          resolvedChecks,
        })
        branchSelections.push(execution.selection)
        branchExecutions.set(operation.payload.selectionId, execution)
        for (const decision of execution.decisions) {
          if (!decision.predicateEvaluation) continue
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'predicate',
            phase,
            predicateId: operation.payload.selectionId,
            outcome: decision.predicateEvaluation.value,
            reasonCode: decision.reasonCode,
            input: traceJson({
              recipientId: decision.recipientId,
              branchId: decision.branchId,
              evaluationTrace: decision.predicateEvaluation.trace,
            }),
          })
        }
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: execution.selection.decisions.length > 0 ? 'applied' : 'no-op',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: traceJson({ selection: execution.selection }),
        })
        continue
      }

      if (operation.kind === 'check') {
        const execution = executeMoveCheckOperation({
          context: input.context,
          operation,
          recipientIds,
          selectorState,
          canonicalMoveId: spec.canonicalId,
          responseResolver,
        })
        resolvedChecks.push(...execution.resolutions)
        resolvedRolls.push(...resolvedCheckRolls(operation, execution))
        const request = execution.kind === 'pending'
          ? pendingCheckRequest(operation, execution.request)
          : null
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: request ? 'pending' : 'applied',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: traceJson({
            checks: execution.resolutions,
            request: request
              ? {
                  requestId: request.requestId,
                  requestKind: request.kind,
                }
              : null,
          }),
        })
        for (const roll of execution.rollLedgerEntries) {
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'roll',
            phase,
            reasonCode: operation.reasonCode,
            roll,
          })
        }
        for (const response of execution.resolvedResponses) {
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'choice',
            phase,
            requestId: response.requestId,
            requestKind: 'choice',
            outcome: 'selected',
            optionId: response.optionId,
            reasonCode: operation.reasonCode,
          })
        }
        if (!request) continue
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'choice',
          phase,
          requestId: request.requestId,
          requestKind: 'choice',
          outcome: 'requested',
          optionId: null,
          reasonCode: operation.reasonCode,
        })
        responseResolver.assertAllConsumed()
        return materializePendingExecutionResult(
          terminalBase(
            input.context,
            operations,
            targetIds,
            trace,
            input.context.random.snapshot(),
            resolvedRolls,
            resolvedDamageTypes,
            resolvedDamageBases,
            multiHitExecutions,
            resolvedChecks,
            branchSelections,
            resolvedMovements,
            resolvedSwitches,
            resolvedItemChoices,
            resolvedHazardCells,
            childExecutions,
            currentSelectorState(),
          ),
          request,
        )
      }

      if (operation.kind === 'roll') {
        if (operation.payload.formula.kind === 'table') {
          const tableOperation = operation as MoveRandomTableOperation
          const naturalSelection = enforceRandomSelection(() => resolveMoveRandomTable({
            definition: tableOperation.payload.table,
            rollId: tableOperation.payload.rollId,
            parentEffectId: tableOperation.id,
            reasonCode: tableOperation.reasonCode,
            random: input.context.random,
            isEntryValid: entry => entry.predicate === null || evaluateMovePredicate({
              predicate: entry.predicate,
              context: input.context,
              canonicalMoveId: spec.canonicalId,
              rootNodeId: `${tableOperation.id}.${entry.id}`,
              selectorState,
            }).value,
            reserveRetry: () => executionState.nestedBudget.reserveRandomRetries(
              1,
              `Random operation table ${tableOperation.payload.table.tableId}`,
            ),
          }))
          const forcedEntry = spec.canonicalId === 'Present' && aa072ForcedPresentValue !== null
            ? tableOperation.payload.table.entries.find(entry => entry.id === `outcome-${aa072ForcedPresentValue}`)
              ?? fail('definition-integrity-mismatch', 'Giver could not resolve the reviewed Present outcome.')
            : null
          const selection: ExecutedMoveRandomTable = forcedEntry
            ? { ...naturalSelection, selectedId: forcedEntry.id, selected: forcedEntry }
            : naturalSelection
          randomTableExecutions.set(tableOperation.id, selection)
          for (const rollId of selection.rollIds) {
            resolvedRolls.push({
              operationId: tableOperation.id,
              referenceId: tableOperation.payload.rollId,
              purpose: 'generic',
              recipientId: null,
              rollId,
            })
          }
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: tableOperation.id,
            operationKind: tableOperation.kind,
            recipientIds,
            outcome: 'applied',
            reasonCode: tableOperation.reasonCode,
            input: traceJson(tableOperation.payload),
            result: traceJson({
              candidateCount: selection.candidateCount,
              selectedId: selection.selectedId,
              naturalSelectedId: naturalSelection.selectedId,
              forcedByGiver: forcedEntry !== null,
              attemptCount: selection.attemptCount,
            }),
          })
          for (const rollId of selection.rollIds) {
            const roll = input.context.random.snapshot().find(entry => entry.rollId === rollId)
              ?? fail('definition-integrity-mismatch', `Random-table roll ${rollId} is missing from the ledger.`)
            trace = reduceMoveResolutionTrace(trace, {
              kind: 'roll',
              phase,
              reasonCode: tableOperation.reasonCode,
              roll,
            })
          }
          continue
        }
        const purpose = referencedAccuracyRollIds.has(operation.payload.rollId)
          ? 'accuracy' as const
          : 'generic' as const
        const weatherAccuracy = purpose === 'accuracy'
          ? input.context.queries.weather.accuracy({
              canonicalMoveId: getMechanics().script.moveName,
            })
          : null
        const subjects: readonly (string | null)[] = operation.recipients.kind === 'none'
          ? [null]
          : recipientIds
        const rollSummaries: Array<{
          readonly rollId: string
          readonly recipientId: string | null
          readonly naturalResult: number
          readonly finalValue: number
          readonly accuracyRule: MoveAutomationAccuracyRule | null
          readonly attemptRollIds: readonly string[]
        }> = []
        const hitSet = new Set(hitTargetIds)
        const missedSet = new Set(missedTargetIds)

        for (const [index, recipientId] of subjects.entries()) {
          const rollId = recipientId === null
            ? operation.payload.rollId
            : resolvedRollId(operation.payload.rollId, index + 1)
          let modifiers: readonly {
            readonly sourceId: string
            readonly reason: string
            readonly value: number
          }[] = []
          let target: SpawnedPokemon | null = null
          let targetEvasion = 0
          let accuracyScript: MoveAutomationScript | null = null
          if (purpose === 'accuracy') {
            if (recipientId === null) {
              return fail(
                'move-mechanics-unavailable',
                `Accuracy roll ${operation.id} must resolve once per attacked target.`,
              )
            }
            const move = getMechanics()
            target = targetTokenForRoll(input.context, recipientId)
            const linkedDamage = program.operations.find((candidate): candidate is MoveDamageEffectOperation => (
              candidate.kind === 'damage'
              && candidate.payload.accuracyRollId === operation.payload.rollId
            ))
            const damageClass = linkedDamage
              ? resolveMoveDamageClass({
                  context: input.context,
                  operation: linkedDamage,
                  recipientId,
                }).damageClass
              : null
            const baseScriptForAccuracy: MoveAutomationScript = damageClass
              ? {
                  ...move.script,
                  damageClass: damageClass === 'physical' ? 'Physical' : 'Special',
                }
              : move.script
            const blurApplies = !move.script.requiresAccuracy
              && input.context.queries.abilities.has(recipientId, 'Blur')
            accuracyScript = blurApplies
              ? { ...baseScriptForAccuracy, requiresAccuracy: true, ac: 2 }
              : baseScriptForAccuracy
            const userAccuracy = resolveAuthoritativeMoveUserAccuracy(input.context, {
              targetPlacementId: recipientId,
              script: accuracyScript,
            })
            const evasionRule = 'evasionRule' in operation.payload
              ? operation.payload.evasionRule
              : undefined
            const ignoreEvasionAlways = evasionRule?.kind === 'ignore-always'
            const flanking = evasionRule?.kind === 'ignore-when-flanked'
              ? input.context.queries.flanking.resolve(recipientId)
              : null
            if (evasionRule && (flanking || ignoreEvasionAlways)) {
              trace = reduceMoveResolutionTrace(trace, {
                kind: 'predicate',
                phase,
                predicateId: `${operation.id}.evasion-rule.${recipientId}`,
                outcome: ignoreEvasionAlways || Boolean(flanking?.flanked),
                reasonCode: ignoreEvasionAlways || flanking?.flanked
                  ? evasionRule.reasonCode
                  : flanking?.reasonCode ?? evasionRule.reasonCode,
                input: traceJson({
                  sourceId: evasionRule.sourceId,
                  requiredAdjacentSquares: flanking?.requiredAdjacentSquares ?? 0,
                  adjacentFoeIds: flanking?.adjacentFoeIds ?? [],
                  qualifyingFoeIds: flanking?.qualifyingFoeIds ?? [],
                  contributions: flanking?.contributions ?? [],
                }),
              })
            }
            const keenEye = aa076KeenEyeActive(input.context)
            const nonStatEvasion = keenEye
              ? 0
              : aa076InstinctEvasionBonus({ context: input.context, recipientId })
                + aa065CovertEvasionBonus({ context: input.context, placementId: recipientId })
                + aa066DecoyEvasionBonus({ map: input.context.map, placementId: recipientId })
            targetEvasion = ignoreEvasionAlways || flanking?.flanked
              ? 0
              : resolveMoveAutomationTargetEvasion(
                  accuracyScript,
                  aa076TargetWithoutLegacyIlluminate(aa076TokenWithEffectiveKeenEye({
                    context: input.context,
                    token: target,
                  })),
                  {
                    attacker: aa076TokenWithEffectiveKeenEye({
                      context: input.context,
                      token: input.context.actor.token,
                    }),
                    fieldEffects: input.context.queries.rooms.projectFieldEffects(),
                    dauntlessShieldActive: input.context.queries.abilities.has(
                      recipientId,
                      'Dauntless Shield',
                    ),
                  },
                ).value + nonStatEvasion
            targetEvasion = applyEncounterNumericModifiers({
              map: input.context.map,
              placementId: recipientId,
              attribute: 'evasion',
              baseValue: targetEvasion,
              changePolicy: keenEye ? 'non-increasing' : 'all',
            }).value
            if (blurApplies) targetEvasion = Math.floor(targetEvasion / 2)
            modifiers = userAccuracy.modifiers
          }

          let result = input.context.random.roll({
            rollId,
            parentEffectId: operation.id,
            formula: operation.payload.formula,
            reason: recipientId === null
              ? operation.reasonCode
              : `${operation.reasonCode} for ${recipientId}`,
            modifiers,
          })
          const attemptRollIds = [rollId]
          for (const selection of aa084ProbabilityControlSelections({
            operations: program.operations,
            responses: responseResolver,
            rollOperationId: operation.id,
            recipientId: recipientId ?? 'none',
          })) {
            const rerollId = `${rollId}.probability-control.${createHash('sha256')
              .update(selection.requestOperationId).digest('hex').slice(0, 16)}`
            result = input.context.random.roll({
              rollId: rerollId,
              parentEffectId: selection.requestOperationId,
              formula: operation.payload.formula,
              reason: `Probability Control reroll for ${selection.ownerPlacementId}`,
              modifiers,
            })
            attemptRollIds.push(rerollId)
            const deferred = deferredAa084RerollsByRequestOperation
              .get(selection.requestOperationId) ?? []
            deferred.push({ rollId: rerollId })
            deferredAa084RerollsByRequestOperation
              .set(selection.requestOperationId, deferred)
          }
          const effectiveRollId = attemptRollIds[attemptRollIds.length - 1]!
          resolvedRolls.push({
            operationId: operation.id,
            referenceId: operation.payload.rollId,
            purpose,
            recipientId,
            rollId: effectiveRollId,
          })
          let resolvedAccuracyRule: MoveAutomationAccuracyRule | null = null
          if (purpose === 'accuracy' && recipientId !== null && target) {
            const conditionalRule = 'accuracyRule' in operation.payload
              ? operation.payload.accuracyRule
              : undefined
            const conditionalEvaluation = conditionalRule
              ? evaluateMovePredicate({
                  predicate: conditionalRule.predicate,
                  context: input.context,
                  canonicalMoveId: spec.canonicalId,
                  rootNodeId: `${operation.id}.accuracy-rule.${recipientId}`,
                  selectorState: {
                    ...selectorState,
                    targetIds: [recipientId],
                  },
                })
              : null
            if (conditionalRule && conditionalEvaluation) {
              trace = reduceMoveResolutionTrace(trace, {
                kind: 'predicate',
                phase,
                predicateId: `${operation.id}.accuracy-rule.${recipientId}`,
                outcome: conditionalEvaluation.value,
                reasonCode: conditionalRule.reasonCode,
                input: traceJson({ evaluationTrace: conditionalEvaluation.trace }),
              })
            }
            const reviewedAccuracyRule: MoveAutomationAccuracyRule | null = automaticHitTargetIds.has(recipientId)
              ? {
                  kind: 'automatic-hit',
                  sourceId: 'ability.aa078',
                  reasonCode: 'ability.aa078.automatic-hit',
                }
              : conditionalRule && conditionalEvaluation?.value
                ? {
                    kind: 'automatic-hit',
                    sourceId: conditionalRule.sourceId,
                    reasonCode: conditionalRule.reasonCode,
                  }
              : aa075HypnoticAutomaticHit({ context: input.context, script: getMechanics().script })
                ? {
                    kind: 'automatic-hit',
                    sourceId: 'ability.hypnotic',
                    reasonCode: 'ability.hypnotic.automatic-hit',
                  }
                : weatherAccuracy?.rule ?? null
            const accuracy = resolveMoveAutomationAccuracyRoll(
              accuracyScript ?? getMechanics().script,
              result.naturalResult,
              {
                userAccuracy: modifiers.reduce((total, modifier) => total + modifier.value, 0),
                targetEvasion,
                accuracyRule: reviewedAccuracyRule,
              },
            )
            resolvedAccuracyRule = accuracy.accuracyRule ?? null
            if (accuracy.hit) {
              hitSet.add(recipientId)
              missedSet.delete(recipientId)
            }
            else {
              missedSet.add(recipientId)
              hitSet.delete(recipientId)
            }
          }
          rollSummaries.push({
            rollId: effectiveRollId,
            recipientId,
            naturalResult: result.naturalResult,
            finalValue: result.finalValue,
            accuracyRule: resolvedAccuracyRule,
            attemptRollIds,
          })
        }

        hitTargetIds = canonicalPlacementIds(input.context, hitSet)
        missedTargetIds = canonicalPlacementIds(input.context, missedSet)
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: 'applied',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: { rolls: rollSummaries },
        })
        for (const summary of rollSummaries) {
          const originalRollId = summary.attemptRollIds[0]
            ?? fail('definition-integrity-mismatch', `Roll summary ${summary.rollId} has no original attempt.`)
          const roll = input.context.random.snapshot().find(entry => entry.rollId === originalRollId)
            ?? fail('definition-integrity-mismatch', `Roll ${originalRollId} is missing from the ledger.`)
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'roll',
            phase,
            reasonCode: operation.reasonCode,
            roll,
          })
        }
        continue
      }

      if (operation.kind === 'damage') {
        const reviewedDamageOperation = emittedOperation.kind === 'damage'
          ? emittedOperation
          : operation
        const operationDamageTypes: MoveDamageTypeResolution[] = []
        const operationDamageClasses: ReturnType<typeof resolveMoveDamageClass>[] = []
        const operationDamageBases: MoveContextualDamageBaseResolution[] = []
        const projectedDamagedTargetIds = new Set(damagedTargetIds)
        const rollSummaries: Array<{
          readonly rollId: string
          readonly recipientId: string
          readonly naturalResult: number
          readonly finalValue: number
          readonly attemptRollIds: readonly string[]
        }> = []
        for (const [index, recipientId] of recipientIds.entries()) {
          targetTokenForRoll(input.context, recipientId)
          const resolvedClass = resolveMoveDamageClass({
            context: input.context,
            operation: reviewedDamageOperation,
            recipientId,
          })
          operationDamageClasses.push(resolvedClass)
          const accuracyRoll = [...resolvedRolls].reverse().find(roll => (
            roll.purpose === 'accuracy' && roll.recipientId === recipientId
          ))
          const naturalCriticalRoll = accuracyRoll
            ? input.context.random.snapshot().find(entry => entry.rollId === accuracyRoll.rollId)?.naturalResult ?? null
            : null
          const baseType = resolveMoveDamageType({
            context: input.context,
            operation: reviewedDamageOperation,
            script: getMechanics().script,
            recipientId,
            canonicalMoveId: spec.canonicalId,
            forceActorStab: aa084ProteanStab,
          })
          const aa069Sources = aa069DamageBaseRelevant
            ? aa069DamageBaseSources({
                context: input.context,
                actor: input.context.actor.token,
                moveType: baseType.moveType,
                responseOptionForReason: reviewedResponseOptionForReason,
              })
            : []
          const baseResolvedType: MoveDamageTypeResolution = aa069Sources.length > 0
            ? { ...baseType, passiveSources: [...baseType.passiveSources, ...aa069Sources] }
            : baseType
          const absorbForceType: MoveDamageTypeResolution = selectedAbsorbForceOwnerIds.has(recipientId)
            && resolvedClass.damageClass === 'physical'
            ? {
                ...baseResolvedType,
                passiveMultiplier: resistMultiplierOneStepFurther(baseResolvedType.passiveMultiplier),
                passiveSources: [...baseResolvedType.passiveSources, 'Absorb Force'],
                finalMultiplier: resistMultiplierOneStepFurther(baseResolvedType.finalMultiplier),
                finalRelation: baseResolvedType.finalMultiplier === 0
                  ? 'immune'
                  : resistMultiplierOneStepFurther(baseResolvedType.finalMultiplier) < 1
                    ? 'resistant'
                    : resistMultiplierOneStepFurther(baseResolvedType.finalMultiplier) > 1
                      ? 'weak'
                      : 'neutral',
              }
            : baseResolvedType
          const bodyguardType: MoveDamageTypeResolution = selectedBodyguardOwnerIds.has(recipientId)
            ? {
                ...absorbForceType,
                passiveMultiplier: resistMultiplierOneStepFurther(absorbForceType.passiveMultiplier),
                passiveSources: [...absorbForceType.passiveSources, 'Bodyguard'],
                finalMultiplier: resistMultiplierOneStepFurther(absorbForceType.finalMultiplier),
                finalRelation: absorbForceType.finalMultiplier === 0
                  ? 'immune'
                  : resistMultiplierOneStepFurther(absorbForceType.finalMultiplier) < 1
                    ? 'resistant'
                    : resistMultiplierOneStepFurther(absorbForceType.finalMultiplier) > 1
                      ? 'weak'
                      : 'neutral',
              }
            : absorbForceType
          const delayedType: MoveDamageTypeResolution = selectedDelayedReactionOwnerIds.has(recipientId)
            ? {
                ...bodyguardType,
                passiveSources: [...bodyguardType.passiveSources, AA067_DELAYED_REACTION_TYPE_SOURCE],
              }
            : bodyguardType
          const preAa068Type: MoveDamageTypeResolution = aquaBoostSelected
            ? { ...delayedType, passiveSources: [...delayedType.passiveSources, 'Aqua Boost'] }
            : delayedType
          const aa070ResolvedType = aa070FluffyDamageTypeOverlay({
            context: input.context,
            script: getMechanics().script,
            recipientId,
            resolved: preAa068Type,
          })
          const aa072ResolvedType = aa072FurCoatDamageTypeOverlay({
            context: input.context,
            damageClass: resolvedClass.damageClass,
            recipientId,
            resolved: aa070ResolvedType,
          })
          const aa071ResistanceSources = [
            ...(selectedFriendGuardTargetIds.has(recipientId) ? ['Friend Guard'] : []),
            ...(selectedFullGuardTargetIds.has(recipientId) ? ['Full Guard'] : []),
            ...(selectedInnardsOutByOwner.has(recipientId) ? ['Innards Out'] : []),
          ]
          const aa071ResolvedType = aa071ResistDamageType({
            resolved: aa072ResolvedType,
            steps: aa071ResistanceSources.length,
            sources: aa071ResistanceSources,
          })
          const aa073ResolvedType = aa073HeatproofDamageTypeOverlay({
            context: input.context,
            recipientId,
            resolved: aa071ResolvedType,
          })
          const aa078ResolvedType = aa078LiquidOozeDamageTypeOverlay({
            context: input.context,
            recipientId,
            resolved: aa073ResolvedType,
          })
          const aa075ResolvedType = aa075IceScalesDamageTypeOverlay({
            context: input.context,
            damageClass: resolvedClass.damageClass,
            recipientId,
            resolved: aa078ResolvedType,
          })
          const aa076StabType = aa076KampfgeistDamageTypeOverlay({
            context: input.context,
            resolved: aa075ResolvedType,
          })
          const aa076ResolvedType = selectedKampfgeistOwnerIds.has(recipientId)
            && ['Bug', 'Dark', 'Rock'].includes(aa076StabType.moveType)
            ? aa071ResistDamageType({
                resolved: aa076StabType,
                steps: 1,
                sources: ['Kampfgeist'],
              })
            : aa076StabType
          const resolvedType = aa068DamageTypeOverlay({
            context: input.context,
            script: getMechanics().script,
            recipientId,
            resolved: aa076ResolvedType,
            naturalAccuracyRoll: naturalCriticalRoll,
            dragonsMawSelected: selectedDragonsMawTargetIds.has(recipientId),
          })
          operationDamageTypes.push(resolvedType)
          resolvedDamageTypes.push(resolvedType)
          if (resolvedType.finalMultiplier > 0 && resolveMoveCriticalHit({
            context: input.context,
            operation: reviewedDamageOperation,
            script: getMechanics().script,
            recipientId,
            naturalRoll: naturalCriticalRoll,
          }).critical) criticalHitTargetIds.add(recipientId)
          const formula = resolveMoveSpecDamageRollFormula({
            context: input.context,
            operation: reviewedDamageOperation,
            recipientId,
            canonicalMoveId: spec.canonicalId,
            resolvedType,
            postBoundsDamageBaseBonus: aa076IronFistDamageBaseBonus({
              context: input.context,
              script: getMechanics().script,
            }) + (typeof operation.payload.damageBase === 'number'
              || !aa069DamageBaseRelevant
              ? 0
              : aa069DamageBaseBonus({
                  context: input.context,
                  actor: input.context.actor.token,
                  moveType: resolvedType.moveType,
                  responseOptionForReason: reviewedResponseOptionForReason,
                })),
            failUnsupported: message => fail('damage-formula-unsupported', message),
          })
          if (formula.contextualDamageBase) {
            operationDamageBases.push(formula.contextualDamageBase)
            resolvedDamageBases.push(formula.contextualDamageBase)
          }
          const rollId = resolvedRollId(operation.id, index + 1, '.roll')
          const damageRollFormula = {
            kind: 'dice' as const,
            count: formula.count,
            sides: formula.sides,
            modifier: formula.modifier,
          }
          let result = input.context.random.roll({
            rollId,
            parentEffectId: operation.id,
            formula: damageRollFormula,
            reason: `${operation.reasonCode} for ${recipientId}`,
          })
          const attemptRollIds = [rollId]
          for (const selection of aa084ProbabilityControlSelections({
            operations: program.operations,
            responses: responseResolver,
            rollOperationId: operation.id,
            recipientId,
          })) {
            const rerollId = `${rollId}.probability-control.${createHash('sha256')
              .update(selection.requestOperationId).digest('hex').slice(0, 16)}`
            result = input.context.random.roll({
              rollId: rerollId,
              parentEffectId: selection.requestOperationId,
              formula: damageRollFormula,
              reason: `Probability Control reroll for ${selection.ownerPlacementId}`,
            })
            attemptRollIds.push(rerollId)
            const deferred = deferredAa084RerollsByRequestOperation
              .get(selection.requestOperationId) ?? []
            deferred.push({ rollId: rerollId })
            deferredAa084RerollsByRequestOperation
              .set(selection.requestOperationId, deferred)
          }
          const effectiveRollId = attemptRollIds[attemptRollIds.length - 1]!
          resolvedRolls.push({
            operationId: operation.id,
            referenceId: operation.id,
            purpose: 'damage',
            recipientId,
            rollId: effectiveRollId,
          })
          const abilityRandomInput = {
            context: input.context,
            script: getMechanics().script,
            damageOperationIds: [operation.id],
            damageRecipientId: recipientId,
          }
          primeAa060MoveRandomness(abilityRandomInput)
          primeAa061MoveRandomness(abilityRandomInput)
          primeAa065MoveRandomness(abilityRandomInput)
          primeAa066MoveRandomness(abilityRandomInput)
          const recipient = input.context.queries.tokens.get(recipientId)
            ?? fail('definition-integrity-mismatch', `Damage recipient ${recipientId} disappeared.`)
          const calculation = resolveMoveSpecDamageCalculation({
            context: input.context,
            operation: reviewedDamageOperation,
            script: getMechanics().script,
            recipient,
            resolution: {
              accuracyRoll: naturalCriticalRoll === null ? '' : String(naturalCriticalRoll),
              hit: true,
              crit: false,
              damageRoll: {
                formula: `${formula.count}d${formula.sides}${formula.modifier === 0 ? '' : formula.modifier > 0 ? `+${formula.modifier}` : formula.modifier}`,
                count: formula.count,
                sides: formula.sides,
                mod: formula.modifier,
                rolls: [],
                total: result.finalValue,
              },
              manualHpLoss: '',
              applyDamage: true,
            },
            fieldEffects: input.context.queries.weather.projectFieldEffects(),
            selectedTargets: targetIds.flatMap(id => {
              const token = input.context.queries.tokens.get(id)
              return token ? [token] : []
            }),
            resolvedMoveType: resolvedType,
            naturalCriticalRoll,
            ...(aa072GorillaSelected || selectedIgnitionBoostRequestId !== null
              ? { responseDamageModifiers: [
                  ...(aa072GorillaSelected ? [{
                    id: 'ability.gorilla-tactics.triggering-damage',
                    stage: 'pre-type-modifiers' as const, priority: 40,
                    source: { kind: 'ability' as const, id: 'Gorilla Tactics' },
                    stackingGroup: 'aa072-gorilla-tactics-triggering',
                    reasonCode: 'ability.gorilla-tactics.triggering-damage',
                    operation: 'add' as const, value: 10,
                  }] : []),
                  ...(selectedIgnitionBoostRequestId !== null ? [{
                    id: 'ability.ignition-boost.triggering-damage',
                    stage: 'pre-type-modifiers' as const, priority: 41,
                    source: { kind: 'ability' as const, id: 'Ignition Boost' },
                    stackingGroup: 'aa075-ignition-boost-triggering',
                    reasonCode: 'ability.ignition-boost.triggering-damage',
                    operation: 'add' as const, value: 5,
                  }] : []),
                ] } : {}),
            forceActorStab: aa084ProteanStab,
            ...(formula.contextualDamageBase ? { contextualDamageBase: formula.contextualDamageBase } : {}),
          })
          if (calculation.breakdown.hpLoss > 0) projectedDamagedTargetIds.add(recipientId)
          const bypassTemporaryHp = aa075InfiltratorBypassesTemporaryHp({
            context: input.context,
            recipientId,
          })
          const hpLoss = projectedHp.applyLossWithInjuryAutomation(
            recipient,
            calculation.breakdown.hpLoss,
            'damage',
            { bypassTemporaryHp },
          )
          if (hpLoss.effectiveHpLost > 0
            && ['Bug', 'Dark', 'Rock'].includes(resolvedType.moveType)) {
            ordinaryKampfgeistDamageTargetIds.add(recipientId)
          }
          projectedInjuriesByTarget.set(recipientId, projectedHp.getInjuries(recipient))
          const previousRemaining = projectedRemainingHpByTarget.get(recipientId)
            ?? recipient.currentHp + (recipient.temporaryHp ?? 0)
          const remaining = bypassTemporaryHp
            ? projectedHp.get(recipient)
            : Math.max(0, previousRemaining - calculation.breakdown.hpLoss)
          projectedRemainingHpByTarget.set(recipientId, remaining)
          if (remaining === 0 && calculation.breakdown.hpLoss > 0) {
            faintedTargetIds = canonicalPlacementIds(input.context, [...faintedTargetIds, recipientId])
          }
          rollSummaries.push({
            rollId: effectiveRollId,
            recipientId,
            naturalResult: result.naturalResult,
            finalValue: result.finalValue,
            attemptRollIds,
          })
        }
        damagedTargetIds = canonicalPlacementIds(
          input.context,
          projectedDamagedTargetIds,
        )
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: 'applied',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: traceJson({
            status: 'emitted',
            damageTypes: operationDamageTypes,
            damageClasses: operationDamageClasses,
            contextualDamageBases: operationDamageBases,
            damageRolls: rollSummaries,
          }),
        })
        for (const summary of rollSummaries) {
          const originalRollId = summary.attemptRollIds[0]
            ?? fail('definition-integrity-mismatch', `Damage roll summary ${summary.rollId} has no original attempt.`)
          const roll = input.context.random.snapshot().find(entry => entry.rollId === originalRollId)
            ?? fail('definition-integrity-mismatch', `Roll ${originalRollId} is missing from the ledger.`)
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'roll',
            phase,
            reasonCode: operation.reasonCode,
            roll,
          })
        }
        continue
      }

      if (operation.kind === 'multi-hit') {
        const reviewedMultiHitOperation = emittedOperation.kind === 'multi-hit'
          ? emittedOperation
          : operation
        const execution = executeMoveMultiHitOperation({
          context: input.context,
          operation: reviewedMultiHitOperation,
          script: getMechanics().script,
          canonicalMoveId: spec.canonicalId,
          recipientIds,
          gorillaTacticsTriggeringDamage: aa072GorillaSelected,
          ignitionBoostTriggeringDamage: selectedIgnitionBoostRequestId !== null,
          firstStrikeResistanceStepsByRecipient: new Map(recipientIds.map(recipientId => [
            recipientId,
            Number(selectedFriendGuardTargetIds.has(recipientId))
              + Number(selectedFullGuardTargetIds.has(recipientId)),
          ])),
          allStrikeResistanceStepsByRecipient: new Map(recipientIds.map(recipientId => [
            recipientId,
            Number(selectedInnardsOutByOwner.has(recipientId)),
          ])),
          kampfgeistResistanceRecipientIds: selectedKampfgeistOwnerIds,
          forceActorStab: aa084ProteanStab,
        })
        multiHitExecutions.push(execution)
        resolvedRolls.push(...execution.resolvedRolls.map(roll => ({ ...roll })))
        hitTargetIds = canonicalPlacementIds(input.context, [
          ...hitTargetIds,
          ...execution.hitTargetIds,
        ])
        missedTargetIds = canonicalPlacementIds(input.context, [
          ...missedTargetIds.filter(id => !execution.hitTargetIds.includes(id)),
          ...execution.missedTargetIds,
        ])
        damagedTargetIds = canonicalPlacementIds(input.context, [
          ...damagedTargetIds,
          ...execution.damagedTargetIds,
        ])
        faintedTargetIds = canonicalPlacementIds(input.context, [
          ...faintedTargetIds,
          ...execution.faintedTargetIds,
        ])
        for (const update of execution.hpUpdates) {
          if (update.injuries !== undefined) projectedInjuriesByTarget.set(update.id, update.injuries)
        }
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: execution.outcome,
          reasonCode: operation.reasonCode,
          input: traceJson(reviewedMultiHitOperation.payload),
          result: execution.traceResult,
        })
        for (const roll of execution.rollLedgerEntries) {
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'roll',
            phase,
            reasonCode: operation.reasonCode,
            roll,
          })
        }
        continue
      }

      if (
        operation.kind === 'hazard'
        && operation.payload.action === 'add'
        && operation.payload.cellSelection
      ) {
        const reviewedHazardOperation = emittedOperation.kind === 'hazard'
          ? emittedOperation
          : operation
        const request = pendingHazardCellRequest(
          reviewedHazardOperation,
          selectedMagicBounceHazardOwnerId ?? input.context.actor.placement.id,
        )
        const selected = hazardSelections.get(operation.id) ?? null
        if (selected) {
          if (
            selected.windowId !== request.requestId
            || selected.operationId !== operation.id
            || selected.cellSetId !== request.cellSetId
          ) {
            return fail(
              'definition-integrity-mismatch',
              `Hazard selection for ${operation.id} does not match its reviewed request and cell-set identity.`,
            )
          }
          consumedHazardSelections.add(operation.id)
          resolvedHazardCells.push(Object.freeze({
            operationId: operation.id,
            requestId: request.requestId,
            cellSetId: request.cellSetId,
            selectionId: selected.selectionId,
            optionIds: frozenIds(selected.optionIds),
            cells: Object.freeze(selected.cells.map(cell => Object.freeze({ ...cell }))),
          }))
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: operation.id,
            operationKind: reviewedHazardOperation.kind,
            recipientIds,
            outcome: 'applied',
            reasonCode: reviewedHazardOperation.reasonCode,
            input: traceJson(reviewedHazardOperation.payload),
            result: traceJson({
              status: 'selected',
              cellSetId: request.cellSetId,
              selectionId: selected.selectionId,
              optionIds: selected.optionIds,
              cells: selected.cells,
            }),
          })
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'choice',
            phase,
            requestId: request.requestId,
            requestKind: 'choice',
            outcome: 'selected',
            optionId: selected.selectionId,
            reasonCode: reviewedHazardOperation.reasonCode,
          })
          continue
        }
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: reviewedHazardOperation.id,
          operationKind: reviewedHazardOperation.kind,
          recipientIds,
          outcome: 'pending',
          reasonCode: reviewedHazardOperation.reasonCode,
          input: traceJson(reviewedHazardOperation.payload),
          result: traceJson({
            requestId: request.requestId,
            requestKind: request.kind,
            cellSetId: request.cellSetId,
          }),
        })
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'choice',
          phase,
          requestId: request.requestId,
          requestKind: 'choice',
          outcome: 'requested',
          optionId: null,
          reasonCode: reviewedHazardOperation.reasonCode,
        })
        responseResolver.assertAllConsumed()
        return materializePendingExecutionResult(
          terminalBase(
            input.context,
            operations,
            targetIds,
            trace,
            input.context.random.snapshot(),
            resolvedRolls,
            resolvedDamageTypes,
            resolvedDamageBases,
            multiHitExecutions,
            resolvedChecks,
            branchSelections,
            resolvedMovements,
            resolvedSwitches,
            resolvedItemChoices,
            resolvedHazardCells,
            childExecutions,
            currentSelectorState(),
          ),
          request,
        )
      }

      if (operation.kind === 'movement-request' && operation.payload.choice) {
        const set = movementChoiceSet(operation, input.context, recipientIds)
        const request = pendingMovementRequest(operation, recipientIds, set)
        if (request.options.length === 0) {
          if (!request.allowPass) {
            return fail(
              'move-mechanics-unavailable',
              `Movement request ${request.requestId} has no legal authoritative option and cannot pass.`,
            )
          }
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: operation.id,
            operationKind: operation.kind,
            recipientIds,
            outcome: 'no-op',
            reasonCode: operation.reasonCode,
            input: traceJson(operation.payload),
            result: { status: 'no-legal-options' },
          })
          continue
        }
        const response = responseResolver.resolve({
          requestId: request.requestId,
          options: request.options,
          allowPass: request.allowPass,
        })
        const selectedChoice = response?.optionId === null || !response
          ? null
          : revalidateMovementChoice(operation, input.context, set, response.optionId)
        if (selectedChoice && response?.optionId) {
          resolvedMovements.push(Object.freeze({
            operationId: operation.id,
            requestId: request.requestId,
            optionId: response.optionId,
            choice: selectedChoice,
          }))
        }
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: response ? (selectedChoice ? 'applied' : 'no-op') : 'pending',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: traceJson(response
            ? {
                status: selectedChoice ? 'selected' : 'passed',
                ...(selectedChoice ? { selection: selectedChoice.option.selection } : {}),
              }
            : {
                requestId: request.requestId,
                requestKind: request.kind,
                optionCount: request.options.length,
              }),
        })
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'choice',
          phase,
          requestId: request.requestId,
          requestKind: 'choice',
          outcome: response
            ? (selectedChoice ? 'selected' : 'passed')
            : 'requested',
          optionId: response?.optionId ?? null,
          reasonCode: operation.reasonCode,
        })
        if (response) continue
        responseResolver.assertAllConsumed()
        return materializePendingExecutionResult(
          terminalBase(
            input.context,
            operations,
            targetIds,
            trace,
            input.context.random.snapshot(),
            resolvedRolls,
            resolvedDamageTypes,
            resolvedDamageBases,
            multiHitExecutions,
            resolvedChecks,
            branchSelections,
            resolvedMovements,
            resolvedSwitches,
            resolvedItemChoices,
            resolvedHazardCells,
            childExecutions,
            currentSelectorState(),
          ),
          request,
        )
      }

      if (operation.kind === 'switch-request') {
        if (operation.payload.trigger === 'on-hit' && hitTargetIds.length === 0) {
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: operation.id,
            operationKind: operation.kind,
            recipientIds,
            outcome: 'no-op',
            reasonCode: operation.reasonCode,
            input: traceJson(operation.payload),
            result: { status: 'trigger-not-met', trigger: operation.payload.trigger },
          })
          continue
        }

        const switchContext = operation.reasonCode === 'ability.emergency-exit.switch'
          && recipientIds.length === 1
          ? deriveNestedMoveRulesContext({
              parent: input.context,
              actorPlacementId: recipientIds[0]!,
              canonicalId: getMechanics().script.moveName,
              targetIds: [],
              resolutionId: `${executionState.resolutionId}:emergency-exit`,
              ancestry: input.ancestry ?? [],
            })
          : input.context
        const set = switchChoiceSet(operation, switchContext)
        const request = pendingSwitchRequest(operation, recipientIds, set)
        if (request.options.length === 0) {
          if (operation.payload.required) {
            return fail(
              'move-mechanics-unavailable',
              `Switch request ${request.requestId} has no legal authoritative replacement.`,
            )
          }
          if (operation.payload.passPolicy === 'stay') {
            trace = reduceMoveResolutionTrace(trace, {
              kind: 'operation',
              phase,
              operationId: operation.id,
              operationKind: operation.kind,
              recipientIds,
              outcome: 'no-op',
              reasonCode: operation.reasonCode,
              input: traceJson(operation.payload),
              result: { status: 'no-legal-replacements' },
            })
            continue
          }
        }
        const response = responseResolver.resolve({
          requestId: request.requestId,
          options: request.options,
          allowPass: request.allowPass,
        })
        const selectedChoice = response?.optionId === null || !response
          ? null
          : revalidateSwitchChoice(operation, switchContext, response.optionId)
        const recallOnly = response?.optionId === null
          && operation.payload.passPolicy === 'recall'
        if ((selectedChoice && response?.optionId) || recallOnly) {
          resolvedSwitches.push(Object.freeze({
            operationId: operation.id,
            requestId: request.requestId,
            optionId: response?.optionId ?? null,
            choice: selectedChoice,
            recalledPlacementId: selectedChoice?.recalledPlacementId
              ?? switchContext.actor.placement.id,
            stateTransferPolicy: operation.payload.stateTransferPolicy,
          }))
        }
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: response ? (selectedChoice || recallOnly ? 'applied' : 'no-op') : 'pending',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: traceJson(response
            ? {
                status: selectedChoice ? 'selected' : recallOnly ? 'recall-only' : 'passed',
                ...(selectedChoice
                  ? {
                      recalledPlacementId: selectedChoice.recalledPlacementId,
                      sentOutPlacementId: selectedChoice.sentOutPlacement.id,
                      replacementSheetSlug: selectedChoice.replacementSheetSlug,
                    }
                  : recallOnly
                    ? { recalledPlacementId: input.context.actor.placement.id }
                    : {}),
              }
            : {
                requestId: request.requestId,
                requestKind: request.kind,
                optionCount: request.options.length,
              }),
        })
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'choice',
          phase,
          requestId: request.requestId,
          requestKind: 'choice',
          outcome: response
            ? (selectedChoice ? 'selected' : 'passed')
            : 'requested',
          optionId: response?.optionId ?? null,
          reasonCode: operation.reasonCode,
        })
        if (response) continue
        responseResolver.assertAllConsumed()
        return materializePendingExecutionResult(
          terminalBase(
            input.context,
            operations,
            targetIds,
            trace,
            input.context.random.snapshot(),
            resolvedRolls,
            resolvedDamageTypes,
            resolvedDamageBases,
            multiHitExecutions,
            resolvedChecks,
            branchSelections,
            resolvedMovements,
            resolvedSwitches,
            resolvedItemChoices,
            resolvedHazardCells,
            childExecutions,
            currentSelectorState(),
          ),
          request,
        )
      }

      if (operation.kind === 'choice-request' && operation.payload.itemChoice) {
        if (recipientIds.length === 0) {
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: operation.id,
            operationKind: operation.kind,
            recipientIds,
            outcome: 'no-op',
            reasonCode: operation.reasonCode,
            input: traceJson(operation.payload),
            result: { status: 'no-eligible-recipients' },
          })
          continue
        }
        const set = itemChoiceSet(operation, input.context, recipientIds)
        const knockOffOutcome = isKnockOffItemChoiceOperation(spec.canonicalId, operation)
          ? projectedKnockOffItemOutcome({
              context: input.context,
              resolvedRolls,
              recipientIds,
            })
          : null
        if (knockOffOutcome?.kind === 'no-item') {
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: operation.id,
            operationKind: operation.kind,
            recipientIds,
            outcome: 'no-op',
            reasonCode: operation.reasonCode,
            input: traceJson(operation.payload),
            result: {
              status: 'no-legal-items',
              reasonCode: knockOffOutcome.reasonCode,
            },
          })
          continue
        }
        const request = knockOffOutcome?.kind === 'pending-choice'
          ? knockOffOutcome.request
          : pendingItemRequest(
              operation,
              recipientIds,
              input.context.actor.placement.id,
              set,
            )
        if (request.options.length === 0) {
          if (set.emptyPolicy === 'reject') {
            return fail(
              'move-mechanics-unavailable',
              `Item request ${request.requestId} has no legal authoritative option.`,
            )
          }
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: operation.id,
            operationKind: operation.kind,
            recipientIds,
            outcome: 'no-op',
            reasonCode: operation.reasonCode,
            input: traceJson(operation.payload),
            result: { status: 'no-legal-items' },
          })
          continue
        }
        const automaticOptionId = knockOffOutcome?.kind === 'item-plan'
          && knockOffOutcome.selectionMode === 'automatic'
          ? knockOffOutcome.optionId
          : null
        const response = automaticOptionId === null
          ? responseResolver.resolve({
              requestId: request.requestId,
              options: request.options,
              allowPass: request.allowPass,
            })
          : null
        const selectedOptionId = automaticOptionId ?? response?.optionId ?? null
        const resolvedKnockOffOutcome = knockOffOutcome?.kind === 'pending-choice'
          && selectedOptionId !== null
          ? projectedKnockOffItemOutcome({
              context: input.context,
              resolvedRolls,
              recipientIds,
              selectedOptionId,
            })
          : knockOffOutcome
        if (
          resolvedKnockOffOutcome !== null
          && resolvedKnockOffOutcome.kind !== 'item-plan'
          && response
        ) {
          return fail(
            'move-mechanics-unavailable',
            'Knock Off response did not resolve one authoritative item plan.',
          )
        }
        const selectedChoice = resolvedKnockOffOutcome?.kind === 'item-plan'
          ? resolvedKnockOffOutcome.choice
          : selectedOptionId === null
            ? null
            : revalidateItemChoice(operation, input.context, recipientIds, selectedOptionId)
        if (selectedChoice && selectedOptionId) {
          resolvedItemChoices.push(Object.freeze({
            operationId: operation.id,
            requestId: request.requestId,
            optionId: selectedOptionId,
            choice: selectedChoice,
          }))
        }
        const resolved = automaticOptionId !== null || response !== null
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: resolved ? (selectedChoice ? 'applied' : 'no-op') : 'pending',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: traceJson(resolved
            ? {
                status: selectedChoice
                  ? selectedChoice.reference === null
                    ? 'none-selected'
                    : automaticOptionId !== null
                      ? 'auto-selected'
                      : 'selected'
                  : 'passed',
                ...(selectedChoice
                  ? {
                      itemSetId: set.setId,
                      destinationId: selectedChoice.destination?.id ?? null,
                    }
                  : {}),
              }
            : {
                requestId: request.requestId,
                requestKind: request.kind,
                itemSetId: request.itemSetId,
                optionCount: request.options.length,
              }),
        })
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'choice',
          phase,
          requestId: request.requestId,
          requestKind: 'choice',
          outcome: resolved
            ? (selectedChoice ? 'selected' : 'passed')
            : 'requested',
          optionId: selectedOptionId,
          reasonCode: operation.reasonCode,
        })
        if (resolved) continue
        responseResolver.assertAllConsumed()
        return materializePendingExecutionResult(
          terminalBase(
            input.context,
            operations,
            targetIds,
            trace,
            input.context.random.snapshot(),
            resolvedRolls,
            resolvedDamageTypes,
            resolvedDamageBases,
            multiHitExecutions,
            resolvedChecks,
            branchSelections,
            resolvedMovements,
            resolvedSwitches,
            resolvedItemChoices,
            resolvedHazardCells,
            childExecutions,
            currentSelectorState(),
          ),
          request,
        )
      }

      if (operation.kind === 'nested-move') {
        const invocation = resolveNestedMoveInvocation({
          context: input.context,
          operation,
          recipientIds,
          budget: executionState.nestedBudget,
        })
        const nestedOperation = invocation.operation
        for (const roll of invocation.rollLedgerEntries) {
          resolvedRolls.push({
            operationId: operation.id,
            referenceId: operation.payload.source.kind === 'random-move-pool'
              ? operation.payload.source.pool.rollId
              : roll.rollId,
            purpose: 'generic',
            recipientId: null,
            rollId: roll.rollId,
          })
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'roll',
            phase,
            reasonCode: operation.reasonCode,
            roll,
          })
        }
        const runtime = nestedRuntimeFor(input.context, nestedOperation)
        const parentResolutionId = executionState.resolutionId
          ?? fail(
            'nested-resolution-id-missing',
            `Nested operation ${operation.id} requires a stable server-owned parent resolution ID.`,
          )
        const actorPlacementId = nestedActorPlacementId(
          input.context,
          nestedOperation,
          recipientIds,
          nestedOperation.source.kind === 'operation'
            ? responseOwnerIdsByRequestOperation.get(nestedOperation.source.id) ?? []
            : [],
        )
        const childResolutionId = nestedChildResolutionId({
          parentResolutionId,
          operationId: operation.id,
          canonicalId: runtime.canonicalId,
          actorPlacementId,
        })
        const ancestry = childAncestry({
          parentAncestry: trace.ancestry,
          parentResolutionId,
          parentCanonicalId: spec.canonicalId,
          parentDefinitionHash: definition.definitionHash,
          parentOperationId: operation.id,
        })
        const areaChild = runtime.definition.spec.targeting.kind === 'area'
        const targetlessChild = runtime.definition.spec.targeting.kind === 'field'
          || runtime.definition.spec.targeting.kind === 'none'
        const actorContext = deriveNestedMoveRulesContext({
          parent: input.context,
          actorPlacementId,
          canonicalId: runtime.canonicalId,
          targetIds: !areaChild && !targetlessChild
            && nestedOperation.payload.targeting.kind === 'operation-recipients'
              ? recipientIds
              : [],
          resolutionId: childResolutionId,
          ancestry,
        })
        const actorMechanics = authoritativeMoveMechanics(
          actorContext,
          runtime.canonicalId,
          'registered-spec',
        ).script
        const centeredArea = centeredNestedAreaTargeting({
          context: actorContext,
          runtime,
          script: actorMechanics,
        })
        let childTargetIds: readonly string[] = targetlessChild
          ? []
          : centeredArea?.targetIds
            ?? (nestedOperation.payload.targeting.kind === 'operation-recipients' ? recipientIds : [])
        let nestedOperationTraced = false
        if (
          invocation.randomSelection
          && nestedOperation.payload.targeting.kind === 'operation-recipients'
        ) {
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: operation.id,
            operationKind: operation.kind,
            recipientIds,
            outcome: 'applied',
            reasonCode: operation.reasonCode,
            input: traceJson(operation.payload),
            result: traceJson({
              status: 'child-selected',
              randomSelection: invocation.randomSelection,
            }),
          })
          nestedOperationTraced = true
        }

        if (!targetlessChild
          && centeredArea === null
          && nestedOperation.payload.targeting.kind === 'fresh-choice') {
          const choices = nestedTargetOptions({
            context: actorContext,
            operation: nestedOperation,
            runtime,
            selectorState,
            budget: executionState.nestedBudget,
          })
          const request = nestedTargetRequest({
            operation: nestedOperation,
            actorPlacementId,
            options: choices,
          })
          const response = responseResolver.resolve({
            requestId: request.requestId,
            options: request.options,
            allowPass: false,
          })
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: operation.id,
            operationKind: operation.kind,
            recipientIds,
            outcome: response ? 'applied' : 'pending',
            reasonCode: operation.reasonCode,
            input: traceJson(operation.payload),
            result: traceJson(response
              ? {
                  status: 'target-selected',
                  randomSelection: invocation.randomSelection,
                }
              : {
                  requestId: request.requestId,
                  requestKind: request.kind,
                  optionCount: request.options.length,
                  randomSelection: invocation.randomSelection,
                }),
          })
          nestedOperationTraced = true
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'choice',
            phase,
            requestId: request.requestId,
            requestKind: 'choice',
            outcome: response ? 'selected' : 'requested',
            optionId: response?.optionId ?? null,
            reasonCode: operation.reasonCode,
          })
          if (!response?.optionId) {
            responseResolver.assertAllConsumed()
            return materializePendingExecutionResult(
              terminalBase(
                input.context,
                operations,
                targetIds,
                trace,
                input.context.random.snapshot(),
                resolvedRolls,
                resolvedDamageTypes,
                resolvedDamageBases,
                multiHitExecutions,
                resolvedChecks,
                branchSelections,
                resolvedMovements,
                resolvedSwitches,
                resolvedItemChoices,
                resolvedHazardCells,
                childExecutions,
                currentSelectorState(),
              ),
              request,
            )
          }
          childTargetIds = [
            choices.find(({ option }) => option.id === response.optionId)?.targetPlacementId
              ?? fail(
                'nested-targeting-invalid',
                `Nested target option ${response.optionId} disappeared before child execution.`,
              ),
          ]
        }

        const childContext = deriveNestedMoveRulesContext({
          parent: input.context,
          actorPlacementId,
          canonicalId: runtime.canonicalId,
          targetIds: childTargetIds,
          resolutionId: childResolutionId,
          ancestry,
        })
        const childMechanics = actorMechanics
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'child-move',
          phase,
          childResolutionId,
          canonicalId: runtime.canonicalId,
          definitionHash: runtime.definitionHash,
          parentOperationId: operation.id,
          depth: ancestry.length,
          outcome: 'started',
          reasonCode: 'nested-child-started',
        })
        const reviewedSpecRepeat = runtime.canonicalId === spec.canonicalId
          && (
            (operation.id.startsWith('ability.dancer.copy.') && operation.reasonCode === 'dancer')
            || (operation.id.startsWith('ability.danger-syrup.sweet-scent.')
              && operation.reasonCode === 'danger-syrup')
            || (operation.id.startsWith('ability.dig-away.dig.')
              && operation.reasonCode === 'dig-away')
            || (operation.id.startsWith('ability.fox-fire.ember.')
              && operation.reasonCode === 'fox-fire')
          )
        const childMoveSourceId = runtime.definition.spec.phases
          .flatMap(block => block.operations)
          .find(candidate => candidate.source.kind === 'move')?.source.id
          ?? `move.${runtime.canonicalId}`
        const child = executeMoveSpecInternal({
          definition: runtime.definition,
          context: childContext,
          authoritativeTargetIds: childTargetIds,
          ...(reviewedSpecRepeat ? { reviewedIdentityNamespace: childResolutionId } : {}),
          ...(centeredArea ? { authoritativeTargetEvaluations: centeredArea.evaluations } : {}),
          serverAbilityOverlayOperations: [
            ...aa064MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa065MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa066MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa067MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa068MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa069MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa070MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa071MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa072MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa073MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa074MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa075MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa076MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa077MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa078MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa079MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa080MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
              reviewedOperations: runtime.definition.spec.phases.flatMap(block => block.operations),
            }),
            ...aa081MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa082MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
            }),
            ...aa083MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
              reviewedOperations: runtime.definition.spec.phases.flatMap(block => block.operations),
            }),
            ...aa084MoveOverlayOperations({
              context: childContext,
              script: childMechanics,
              moveSourceId: childMoveSourceId,
              authoritativeTargetIds: childTargetIds,
              reviewedOperations: runtime.definition.spec.phases.flatMap(block => block.operations),
            }),
          ],
          ancestry,
          resolutionId: childResolutionId,
          handlerRegistry: childContext.handlerRegistry,
        }, {
          responseResolver,
          resolutionId: childResolutionId,
          mechanicsSource: 'registered-spec',
          sealRandomLedger: false,
          assertResponsesAtCompletion: false,
          nestedBudget: executionState.nestedBudget,
          nestedDepth: executionState.nestedDepth + 1,
          root: false,
          allowReviewedSpecRepeat: reviewedSpecRepeat,
        })
        if (child.kind === 'rejected') {
          return fail(
            'nested-execution-rejected',
            `Nested child ${runtime.canonicalId} rejected: ${child.rejection.reasonCode}.`,
          )
        }
        if (
          child.resolvedMovements.length > 0
          || child.resolvedSwitches.length > 0
          || (
            child.kind === 'pending-request'
            && (
              child.request.kind === 'movement-choice'
              || child.request.kind === 'hazard-cell-choice'
              || child.request.kind === 'switch-choice'
              || child.request.kind === 'item-choice'
            )
          )
        ) {
          return fail(
            'nested-execution-rejected',
            `Nested child ${runtime.canonicalId} requested an orchestration-specific movement, switch, hazard, or item window that is not a fresh target/branch window.`,
          )
        }

        const existingOperationIds = new Set([
          ...program.operations.map(emitted => emitted.id),
          ...operations.map(({ operation: emitted }) => emitted.id),
        ])
        const conflictingChildOperation = child.operations.find(({ operation: emitted }) => (
          existingOperationIds.has(emitted.id)
        ))
        if (conflictingChildOperation && !reviewedSpecRepeat) {
          return fail(
            'nested-operation-id-conflict',
            `Nested child ${runtime.canonicalId} reused operation ID ${conflictingChildOperation.operation.id}.`,
          )
        }
        const directChildOperationIds = child.operations.flatMap(emission => (
          emission.childResolutionId === undefined ? [emission.operation.id] : []
        ))
        operations.push(...child.operations.map(emission => projectNestedEmission({
          emission,
          invocationPhase: phase,
          childResolutionId,
        })))
        childExecutions.push(Object.freeze({
          resolutionId: childResolutionId,
          parentOperationId: operation.id,
          actorPlacementId,
          canonicalId: runtime.canonicalId,
          definitionHash: runtime.definitionHash,
          operationIds: frozenIds(directChildOperationIds),
          targetIds: frozenIds(child.targetIds),
          rootTargetIds: frozenIds(child.rootTargetIds),
          hitTargetIds: frozenIds(child.hitTargetIds),
          rootHitTargetIds: frozenIds(child.rootHitTargetIds),
          missedTargetIds: frozenIds(child.missedTargetIds),
          rootMissedTargetIds: frozenIds(child.rootMissedTargetIds),
          damagedTargetIds: frozenIds(child.damagedTargetIds),
          rootDamagedTargetIds: frozenIds(child.rootDamagedTargetIds),
          faintedTargetIds: frozenIds(child.faintedTargetIds),
          rootFaintedTargetIds: frozenIds(child.rootFaintedTargetIds),
          mechanics: childMechanics,
          trace: child.trace,
        }), ...child.childExecutions)
        resolvedRolls.push(...child.resolvedRolls)
        resolvedDamageTypes.push(...child.resolvedDamageTypes)
        resolvedDamageBases.push(...child.resolvedDamageBases)
        multiHitExecutions.push(...child.multiHitExecutions)
        resolvedChecks.push(...child.resolvedChecks)
        branchSelections.push(...child.branchSelections)
        resolvedMovements.push(...child.resolvedMovements)
        resolvedSwitches.push(...child.resolvedSwitches)
        resolvedItemChoices.push(...child.resolvedItemChoices)
        resolvedHazardCells.push(...child.resolvedHazardCells)
        // Child recipient facts stay scoped to childExecutions. Merging them into
        // the parent selector sets would make root hit-target operations address
        // unrelated child-area recipients during core reduction.
        trace = appendNestedTrace(
          trace,
          child.trace,
          phase,
          executionState.nestedBudget,
        )

        if (child.kind === 'pending-request') {
          const request = projectNestedRequest(child.request, phase, trace.ancestry.length)
          responseResolver.assertAllConsumed()
          return materializePendingExecutionResult(
            terminalBase(
              input.context,
              operations,
              targetIds,
              trace,
              input.context.random.snapshot(),
              resolvedRolls,
              resolvedDamageTypes,
              resolvedDamageBases,
              multiHitExecutions,
              resolvedChecks,
              branchSelections,
              resolvedMovements,
              resolvedSwitches,
              resolvedItemChoices,
              resolvedHazardCells,
              childExecutions,
              currentSelectorState(),
            ),
            request,
          )
        }

        if (!nestedOperationTraced) {
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: operation.id,
            operationKind: operation.kind,
            recipientIds,
            outcome: 'applied',
            reasonCode: operation.reasonCode,
            input: traceJson(operation.payload),
            result: traceJson({
              status: 'child-completed',
              childResolutionId,
              canonicalId: runtime.canonicalId,
              randomSelection: invocation.randomSelection,
            }),
          })
        }
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'child-move',
          phase,
          childResolutionId,
          canonicalId: runtime.canonicalId,
          definitionHash: runtime.definitionHash,
          parentOperationId: operation.id,
          depth: ancestry.length,
          outcome: 'completed',
          reasonCode: 'nested-child-completed',
        })
        continue
      }

      if (operation.kind === 'choice-request' || operation.kind === 'reaction-request') {
        if ((operation.kind === 'reaction-request'
          || operation.reasonCode === AA069_ENFEEBLING_LIPS_REASON)
          && recipientIds.length === 0) {
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation', phase, operationId: operation.id,
            operationKind: operation.kind, recipientIds: [], outcome: 'no-op',
            reasonCode: operation.reasonCode, input: traceJson(operation.payload),
            result: { status: 'no-eligible-owner' },
          })
          continue
        }
        let requestOperation = operation
        if (operation.kind === 'reaction-request'
          && operation.reasonCode === 'ability.cruelty.optional-purchases') {
          const prefix = 'ability.cruelty.target:'
          const targetId = operation.source.kind === 'lifecycle-event'
            && operation.source.id.startsWith(prefix)
            ? operation.source.id.slice(prefix.length)
            : null
          const token = targetId ? input.context.queries.tokens.get(targetId) : null
          const budget = token
            ? Math.min(10, (projectedInjuriesByTarget.get(token.id) ?? token.injuries ?? 0) + 1)
            : 0
          const options = operation.payload.options.filter((option) => {
            const match = option.id.match(/^ability\.cruelty\.hp-(\d+)\.slow-([01])\.block-([01])$/)
            return match !== null
              && Number(match[1]) + Number(match[2]) + Number(match[3]) * 2 <= budget
          })
          if (options.length === 0) {
            return fail('definition-integrity-mismatch', 'Cruelty has no legal purchase for its granted Injury.')
          }
          requestOperation = {
            ...operation,
            payload: { ...operation.payload, options },
          }
        }
        const request = pendingRequest(
          requestOperation,
          recipientIds,
          input.ancestry?.length ?? 0,
        )
        const response = responseResolver.resolve({
          requestId: request.requestId,
          options: request.options,
          allowPass: request.allowPass,
        })
        if (response) {
          selectedResponseOptionByRequestOperation.set(operation.id, response.optionId)
          if (response.optionId === null) {
            responseOwnerIdsByRequestOperation.set(operation.id, Object.freeze([]))
          }
          else {
            if (recipientIds.length !== 1) {
              return fail(
                'definition-integrity-mismatch',
                `Response request ${operation.id} must have exactly one authoritative owner.`,
              )
            }
            responseOwnerIdsByRequestOperation.set(
              operation.id,
              Object.freeze([recipientIds[0]!]),
            )
            if (operation.reasonCode === AA078_LIGHTNING_ROD_REASON) {
              if (response.optionId !== AA078_LIGHTNING_ROD_OPTION_ID || lightningRodSelected) {
                return fail('definition-integrity-mismatch', `Lightning Rod reaction ${operation.id} received an invalid selection.`)
              }
              const ownerId = recipientIds[0]!
              lightningRodSelected = true
              targetIds = canonicalPlacementIds(input.context, [ownerId])
              hitTargetIds = canonicalPlacementIds(input.context, [ownerId])
              missedTargetIds = []
              automaticHitTargetIds.add(ownerId)
            }
            if (operation.reasonCode === AA078_LULLABY_REASON) {
              const targetId = targetIds.find(id => aa078LullabyTargetOptionId(id) === response.optionId)
              if (!targetId || !response.optionId.startsWith(AA078_LULLABY_OPTION_PREFIX)) {
                return fail('definition-integrity-mismatch', `Lullaby reaction ${operation.id} lost its selected target.`)
              }
              automaticHitTargetIds.add(targetId)
            }
            if (operation.reasonCode === AA078_MAGIC_BOUNCE_HAZARD_REASON) {
              if (response.optionId !== AA078_MAGIC_BOUNCE_HAZARD_OPTION_ID || magicBounceHazardSelected) {
                return fail('definition-integrity-mismatch', `Magic Bounce hazard reaction ${operation.id} received an invalid selection.`)
              }
              magicBounceHazardSelected = true
              selectedMagicBounceHazardOwnerId = recipientIds[0]!
            }
            if (operation.reasonCode === AA078_MAGIC_BOUNCE_REASON) {
              if (response.optionId !== AA078_MAGIC_BOUNCE_OPTION_ID || magicBounceSelected) {
                return fail('definition-integrity-mismatch', `Magic Bounce reaction ${operation.id} received an invalid selection.`)
              }
              const ownerId = recipientIds[0]!
              if (!hitTargetIds.includes(ownerId)) {
                return fail('definition-integrity-mismatch', `Magic Bounce reaction ${operation.id} lost its hit owner.`)
              }
              const reflectedId = input.context.actor.placement.id
              magicBounceSelected = true
              targetIds = canonicalPlacementIds(input.context, [
                ...targetIds.filter(id => id !== ownerId), reflectedId,
              ])
              hitTargetIds = canonicalPlacementIds(input.context, [
                ...hitTargetIds.filter(id => id !== ownerId), reflectedId,
              ])
              missedTargetIds = missedTargetIds.filter(id => id !== reflectedId)
              for (const reflected of resolvedRolls.filter(roll => (
                roll.recipientId === ownerId
                && (roll.purpose === 'accuracy' || roll.purpose === 'critical')
              ))) {
                if (!resolvedRolls.some(roll => (
                  roll.operationId === reflected.operationId
                  && roll.referenceId === reflected.referenceId
                  && roll.purpose === reflected.purpose
                  && roll.recipientId === reflectedId
                ))) resolvedRolls.push({ ...reflected, recipientId: reflectedId })
              }
            }
            if (operation.reasonCode === AA069_FIERY_CRASH_REASON
              && response.optionId === 'ability.fiery-crash.fire-type') {
              const currentMechanics = getMechanics()
              mechanics = Object.freeze({
                ...currentMechanics,
                script: Object.freeze({ ...currentMechanics.script, type: 'Fire' }),
              })
            }
            if (operation.reasonCode === AA070_FLOWER_POWER_REASON) {
              const damageClass = response.optionId === 'ability.flower-power.physical'
                ? 'Physical'
                : response.optionId === 'ability.flower-power.special'
                  ? 'Special'
                  : null
              if (!damageClass) {
                return fail('definition-integrity-mismatch', 'Flower Power received an invalid damage-class choice.')
              }
              const currentMechanics = getMechanics()
              mechanics = Object.freeze({
                ...currentMechanics,
                script: Object.freeze({ ...currentMechanics.script, damageClass }),
              })
            }
            if (operation.reasonCode === 'ability.absorb-force.optional-resistance') {
              selectedAbsorbForceOwnerIds.add(recipientIds[0]!)
            }
            if (operation.reasonCode === AA071_FRIEND_GUARD_REASON) {
              const protectedTargetId = operation.source.kind === 'lifecycle-event'
                && operation.source.id.startsWith('ability.friend-guard.target:')
                ? operation.source.id.slice('ability.friend-guard.target:'.length)
                : null
              if (!protectedTargetId || !damagedTargetIds.includes(protectedTargetId)) {
                return fail('definition-integrity-mismatch', `Friend Guard reaction ${operation.id} lost its protected target.`)
              }
              selectedFriendGuardTargetIds.add(protectedTargetId)
              selectedAa071ResistanceRequestOperationIds.add(operation.id)
            }
            if (operation.reasonCode === AA071_FULL_GUARD_REASON) {
              const protectedTargetId = operation.source.kind === 'lifecycle-event'
                && operation.source.id.startsWith('ability.full-guard.target:')
                ? operation.source.id.slice('ability.full-guard.target:'.length)
                : null
              if (!protectedTargetId || !damagedTargetIds.includes(protectedTargetId)
                || recipientIds[0] !== protectedTargetId) {
                return fail('definition-integrity-mismatch', `Full Guard reaction ${operation.id} lost its protected target.`)
              }
              selectedFullGuardTargetIds.add(protectedTargetId)
              selectedAa071ResistanceRequestOperationIds.add(operation.id)
            }
            if (operation.reasonCode === AA067_DELAYED_REACTION_REASON) {
              selectedDelayedReactionOwnerIds.add(recipientIds[0]!)
            }
            if (operation.reasonCode === AA068_DRAGONS_MAW_REASON) {
              const targetId = aa068TargetBoundOperationTargetId(operation)
              if (!targetId || !hitTargetIds.includes(targetId)
                || selectedDragonsMawTargetIds.size > 0) {
                return fail('definition-integrity-mismatch', `Dragon’s Maw reaction ${operation.id} lost its hit target.`)
              }
              selectedDragonsMawTargetIds.add(targetId)
            }
            if (operation.reasonCode === AA068_DREAM_SMOKE_REASON
              || operation.reasonCode === AA068_EFFECT_SPORE_REASON) {
              const ownerId = recipientIds[0]!
              if (!hitTargetIds.includes(ownerId)
                || selectedAa068PostHitOwnerIds.has(ownerId)) {
                return fail('definition-integrity-mismatch', `AA-068 reaction ${operation.id} lost its hit owner.`)
              }
              selectedAa068PostHitOwnerIds.add(ownerId)
            }
            if (AA067_AVOIDANCE_REASONS.has(operation.reasonCode)
              || operation.reasonCode === AA069_FADE_AWAY_REASON
              || operation.reasonCode === AA082_PARRY_REASON
              || operation.reasonCode === AA082_PERCEPTION_REASON) {
              const ownerId = recipientIds[0]!
              if (!hitTargetIds.includes(ownerId)) {
                return fail('definition-integrity-mismatch', `Avoidance reaction ${operation.id} lost its hit target.`)
              }
              hitTargetIds = hitTargetIds.filter(id => id !== ownerId)
              missedTargetIds = canonicalPlacementIds(input.context, [...missedTargetIds, ownerId])
              damagedTargetIds = damagedTargetIds.filter(id => id !== ownerId)
              faintedTargetIds = faintedTargetIds.filter(id => id !== ownerId)
              if (operation.reasonCode === AA067_DISGUISE_REASON
                || operation.reasonCode === 'ability.dig-away.optional-avoid'
                || operation.reasonCode === AA069_FADE_AWAY_REASON
                || operation.reasonCode === AA082_PARRY_REASON
                || operation.reasonCode === AA082_PERCEPTION_REASON) {
                cancelledEffectTargetIds.add(ownerId)
              }
            }
            if (operation.reasonCode === 'ability.bodyguard.optional-redirection') {
              const protectedTargetId = operation.source.kind === 'lifecycle-event'
                && operation.source.id.startsWith('ability.bodyguard.target:')
                ? operation.source.id.slice('ability.bodyguard.target:'.length)
                : null
              if (!protectedTargetId || !hitTargetIds.includes(protectedTargetId)) {
                return fail('definition-integrity-mismatch', `Bodyguard reaction ${operation.id} lost its protected target.`)
              }
              const ownerId = recipientIds[0]!
              selectedBodyguardOwnerIds.add(ownerId)
              bodyguardSelected = true
              const protectedRemainsInArea = input.context.candidatePlacements.some(placement => placement.id === ownerId)
              const nextHit = new Set(hitTargetIds)
              const nextTargets = new Set(targetIds)
              if (!protectedRemainsInArea) {
                nextHit.delete(protectedTargetId)
                nextTargets.delete(protectedTargetId)
              }
              nextHit.add(ownerId)
              nextTargets.add(ownerId)
              hitTargetIds = canonicalPlacementIds(input.context, nextHit)
              targetIds = canonicalPlacementIds(input.context, nextTargets)
              missedTargetIds = missedTargetIds.filter(id => id !== ownerId)
              const redirectedRolls = resolvedRolls.filter(roll => (
                roll.recipientId === protectedTargetId
                && (roll.purpose === 'accuracy' || roll.purpose === 'critical')
              ))
              for (const redirected of redirectedRolls) {
                if (!resolvedRolls.some(roll => (
                  roll.operationId === redirected.operationId
                  && roll.referenceId === redirected.referenceId
                  && roll.purpose === redirected.purpose
                  && roll.recipientId === ownerId
                ))) resolvedRolls.push({ ...redirected, recipientId: ownerId })
              }
              if (criticalHitTargetIds.has(protectedTargetId)) {
                criticalHitTargetIds.add(ownerId)
                if (!protectedRemainsInArea) criticalHitTargetIds.delete(protectedTargetId)
              }
            }
            if (operation.reasonCode === 'ability.aqua-boost.optional-damage') aquaBoostSelected = true
            if (operation.reasonCode === AA084_PROBABILITY_CONTROL_REASON) {
              for (const ownerId of recipientIds) selectedProbabilityControlOwnerIds.add(ownerId)
            }
            if (operation.kind === 'reaction-request' && operation.payload.cancellation) moveCancelledByReaction = true
          }
        }
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: response ? (response.optionId === null ? 'no-op' : 'applied') : 'pending',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: response
            ? { status: response.optionId === null ? 'passed' : 'selected' }
            : {
                requestId: request.requestId,
                requestKind: request.kind,
              },
        })
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'choice',
          phase,
          requestId: request.requestId,
          requestKind: request.kind,
          outcome: response
            ? (response.optionId === null ? 'passed' : 'selected')
            : 'requested',
          optionId: response?.optionId ?? null,
          reasonCode: operation.reasonCode,
        })
        if (response) {
          for (const deferred of deferredAa084RerollsByRequestOperation.get(operation.id) ?? []) {
            const roll = input.context.random.snapshot().find(entry => entry.rollId === deferred.rollId)
              ?? fail('definition-integrity-mismatch', `Probability Control roll ${deferred.rollId} is missing from the ledger.`)
            trace = reduceMoveResolutionTrace(trace, {
              kind: 'roll',
              phase,
              reasonCode: AA084_PROBABILITY_CONTROL_REASON,
              roll,
            })
          }
          continue
        }
        // A declare/pre-target window suspends before the normal target phase.
        // Preserve server-resolved intent IDs in private audit evidence so a
        // durable resume reconstructs and freshly validates the same targets.
        if (MOVE_SPEC_PHASES.indexOf(phase) < MOVE_SPEC_PHASES.indexOf('target')) {
          for (const placement of input.context.selectedPlacements) {
            trace = reduceMoveResolutionTrace(trace, {
              kind: 'target',
              phase,
              targetId: placement.id,
              outcome: 'included',
              reasonCode: 'pre-target-intent-preserved',
            })
          }
        }
        responseResolver.assertAllConsumed()
        return materializePendingExecutionResult(
          terminalBase(
            input.context,
            operations,
            targetIds,
            trace,
            input.context.random.snapshot(),
            resolvedRolls,
            resolvedDamageTypes,
            resolvedDamageBases,
            multiHitExecutions,
            resolvedChecks,
            branchSelections,
            resolvedMovements,
            resolvedSwitches,
            resolvedItemChoices,
            resolvedHazardCells,
            childExecutions,
            currentSelectorState(),
          ),
          request,
        )
      }

      trace = reduceMoveResolutionTrace(trace, {
        kind: 'operation',
        phase,
        operationId: operation.id,
        operationKind: operation.kind,
        recipientIds,
        outcome: 'applied',
        reasonCode: operation.reasonCode,
        input: traceJson(operation.payload),
        result: { status: 'emitted' },
      })
    }
  }

  if (executionState.assertResponsesAtCompletion) responseResolver.assertAllConsumed()
  const unusedHazardSelection = [...hazardSelections.keys()].find(
    operationId => !consumedHazardSelections.has(operationId),
  )
  if (unusedHazardSelection) {
    fail(
      'definition-integrity-mismatch',
      `Authoritative hazard selection for ${unusedHazardSelection} was not reached by the reviewed MoveSpec.`,
    )
  }
  if (hitTargetIds.length > 0) {
    const abilityRandomInput = {
      context: input.context,
      script: getMechanics().script,
      damageOperationIds: operations.flatMap(({ operation }) => (
        operation.kind === 'damage' ? [operation.id] : []
      )),
    }
    primeAa060MoveRandomness(abilityRandomInput)
    primeAa061MoveRandomness(abilityRandomInput)
    primeAa065MoveRandomness(abilityRandomInput)
    primeAa066MoveRandomness(abilityRandomInput)
  }
  return Object.freeze({
    kind: 'complete',
    ...terminalBase(
      input.context,
      operations,
      targetIds,
      trace,
      terminalRollLedger(input.context, executionState.sealRandomLedger),
      resolvedRolls,
      resolvedDamageTypes,
      resolvedDamageBases,
      multiHitExecutions,
      resolvedChecks,
      branchSelections,
      resolvedMovements,
      resolvedSwitches,
      resolvedItemChoices,
      resolvedHazardCells,
      childExecutions,
      currentSelectorState(),
    ),
  })
}

export const executeMoveSpec = (
  input: ExecuteMoveSpecInput,
): MoveSpecExecutionResult => {
  const nestedBudget = enforceNestedExecutionBudget(() => createNestedMoveExecutionBudget({
    policy: input.nestedExecutionPolicy,
  }))
  return executeMoveSpecInternal(input, {
    responseResolver: createMoveSpecResponseResolver(input.responses),
    resolutionId: input.resolutionId ?? input.context.resolutionId,
    mechanicsSource: 'actor-move',
    sealRandomLedger: true,
    assertResponsesAtCompletion: true,
    nestedBudget,
    nestedDepth: 0,
    root: true,
    allowReviewedSpecRepeat: false,
  })
}
