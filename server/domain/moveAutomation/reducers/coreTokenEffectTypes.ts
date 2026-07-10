import type {
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveDamageEffectOperation,
  MoveDirectHpEffectOperation,
  MoveHealEffectOperation,
} from '#shared/moveAutomation/effects'
import type {
  MoveResolutionTraceJsonValue,
  MoveResolutionTraceOperationOutcome,
} from '#shared/moveAutomation/trace'
import type { AuthoritativeMoveResolvedSheet } from '../context'
import type { MoveSpecEmittedOperation } from '../executeSpec'
import type { MoveEffectDynamicRecipientSets } from './effectRecipients'
import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'
import type { SheetPlacement } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'

export type MoveCoreTokenEffectOperation =
  | MoveDamageEffectOperation
  | MoveDirectHpEffectOperation
  | MoveHealEffectOperation
  | MoveConditionEffectOperation
  | MoveCombatStageEffectOperation

export interface MoveResolvedCoreTokenEffectOperation
  extends Omit<MoveSpecEmittedOperation, 'operation'> {
  readonly operation: MoveCoreTokenEffectOperation
}

/** Dynamic recipient sets are authoritative interpreter/mechanics output, never client IDs. */
export type MoveCoreTokenDynamicRecipientSets = MoveEffectDynamicRecipientSets

export interface MoveCoreTokenEffectRecipient {
  readonly placement: SheetPlacement
  readonly token: SpawnedPokemon
  readonly sheet: AuthoritativeMoveResolvedSheet
}

export type MoveCoreTokenChangedField =
  | 'hp'
  | 'temporaryHitPoints'
  | 'conditions'
  | 'combatStages'

export interface MoveCoreHpStateSnapshot {
  readonly kind: 'hp'
  readonly currentHp: number
  readonly temporaryHp: number
  readonly injuries: number
  readonly maxHp: number
}

export interface MoveCoreConditionStateSnapshot {
  readonly kind: 'conditions'
  readonly conditions: readonly string[]
}

export interface MoveCoreCombatStageStateSnapshot {
  readonly kind: 'combat-stages'
  readonly stages: CombatStageMap
}

export type MoveCoreTokenStateSnapshot =
  | MoveCoreHpStateSnapshot
  | MoveCoreConditionStateSnapshot
  | MoveCoreCombatStageStateSnapshot

export interface MoveCoreTokenEffectBlocker {
  /** Stage/condition identifier when one sub-effect was prevented. */
  readonly subject: string | null
  readonly source: string
}

export interface MoveCoreTokenEffectRecipientResult {
  readonly recipientId: string
  readonly outcome: Exclude<MoveResolutionTraceOperationOutcome, 'pending'>
  readonly reasonCode: string
  readonly blockers: readonly MoveCoreTokenEffectBlocker[]
  /** Bounded server-audit detail such as damage absorption and Injury breakdown. */
  readonly details?: MoveResolutionTraceJsonValue
  /** Indirect rule providers consulted by immunity resolution, excluding this recipient. */
  readonly consultedPlacementIds: readonly string[]
  readonly previous: MoveCoreTokenStateSnapshot
  readonly current: MoveCoreTokenStateSnapshot
  readonly changedFields: readonly MoveCoreTokenChangedField[]
}

export interface MoveCoreTokenEffectOperationResult {
  readonly operationId: string
  readonly operationKind: MoveCoreTokenEffectOperation['kind']
  readonly phase: MoveCoreTokenEffectOperation['phase']
  /** The reviewed operation reason is retained even when every recipient is immune/no-op. */
  readonly reasonCode: string
  readonly recipientIds: readonly string[]
  readonly outcome: Exclude<MoveResolutionTraceOperationOutcome, 'pending'>
  readonly recipients: readonly MoveCoreTokenEffectRecipientResult[]
}

export interface MoveDamageResolutionQueryInput {
  readonly operation: MoveDamageEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
}

export interface MoveCoreTokenDamageResolution {
  /** Incoming loss before this reducer applies scene-local temporary HP. */
  readonly hpLoss: number
  readonly preventedBy: string | null
  readonly consultedPlacementIds: readonly string[]
  /** Server-audit-only bounded calculation evidence projected into the operation trace. */
  readonly details?: MoveResolutionTraceJsonValue
}

/** Damage math/RNG is injected; this reducer owns HP/temp-HP/Injury state application. */
export interface MoveCoreTokenDamageQuery {
  resolve(input: MoveDamageResolutionQueryInput): MoveCoreTokenDamageResolution
}

export interface MoveDirectHpImmunityQueryInput {
  readonly operation: MoveDirectHpEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
}

export interface MoveConditionImmunityQueryInput {
  readonly operation: MoveConditionEffectOperation
  readonly condition: string
  readonly recipient: MoveCoreTokenEffectRecipient
}

export interface MoveCombatStageImmunityQueryInput {
  readonly operation: MoveCombatStageEffectOperation
  readonly stage: CombatStageKey
  readonly delta: number
  readonly recipient: MoveCoreTokenEffectRecipient
}

export interface MoveCoreTokenEffectImmunityDecision {
  readonly blockedBy: string | null
  /** Indirect placements whose sheet-derived state was inspected by the query. */
  readonly consultedPlacementIds: readonly string[]
}

/**
 * Rules-specific prevention stays behind an injected query seam. Reducers own
 * state math, while the authoritative context owns type/ability/side queries.
 */
export interface MoveCoreTokenEffectImmunityQueries {
  directHp(input: MoveDirectHpImmunityQueryInput): MoveCoreTokenEffectImmunityDecision
  condition(input: MoveConditionImmunityQueryInput): MoveCoreTokenEffectImmunityDecision
  combatStage(input: MoveCombatStageImmunityQueryInput): MoveCoreTokenEffectImmunityDecision
}
