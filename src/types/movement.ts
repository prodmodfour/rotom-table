export const MOVEMENT_MODES = [
  'overland',
  'sky',
  'swim',
  'burrow',
  'levitate',
  'phasing',
  'jump',
  'climb',
] as const

export type MovementMode = (typeof MOVEMENT_MODES)[number]

export type MovementCapabilityKey =
  | 'overland'
  | 'sky'
  | 'swim'
  | 'levitate'
  | 'burrow'
  | 'climb'
  | 'teleporter'

export type ShiftMovementCapabilityKey = Exclude<MovementCapabilityKey, 'teleporter'>

export type MovementCapabilitySpeeds = Partial<Record<MovementCapabilityKey, number>>

export interface MovementJumpCapability {
  readonly long: number
  readonly high: number
}

/** Non-speed capabilities that participate in authoritative route queries. */
export interface MovementCapabilityTraits {
  readonly phasing: boolean
  readonly jump: MovementJumpCapability
}

export type MovementGroundingState = 'grounded' | 'airborne'

/**
 * Rule state is intentionally independent from token sprite/display height.
 * MA-129 supplies the lifecycle and targeting semantics for the named setup
 * states; this union keeps their authoritative projection typed now.
 */
export type MovementSemiInvulnerableState =
  | 'none'
  | 'underground'
  | 'underwater'
  | 'airborne'
  | 'vanished'
  | 'carried'
  | 'phased'

export interface MovementRuleState {
  readonly grounding: MovementGroundingState
  readonly semiInvulnerable: MovementSemiInvulnerableState
}

export interface EffectiveMovementMode {
  readonly mode: MovementMode
  readonly available: boolean
  /** Speed for ordinary/climb modes; null for boolean and jump modes. */
  readonly speed: number | null
  readonly longJump: number | null
  readonly highJump: number | null
}

/** Detached effective movement view used by server legality and client previews. */
export interface EffectiveMovementProfile {
  readonly speeds: MovementCapabilitySpeeds
  readonly traits: MovementCapabilityTraits
  readonly state: MovementRuleState
  readonly modes: readonly EffectiveMovementMode[]
  /** Active typed encounter effects that changed this projection, in state order. */
  readonly sourceEffectIds: readonly string[]
}
