import type { GridAnchor } from './map'

/**
 * Generic visual effect families supported by the move animation event model.
 *
 * These strings describe renderer concepts only. They are not move script kinds,
 * move names, or gameplay rule branches.
 */
export type MoveAnimationEventKind =
  | 'projectile'
  | 'beam'
  | 'arc'
  | 'melee-lunge'
  | 'self-pulse'
  | 'target-flash'
  | 'area-pulse'
  | 'line-sweep'
  | 'cone-sweep'
  | 'dash'
  | 'miss'
  | 'crit'
  | 'status'
  | 'healing'
  | 'buff-debuff'

/**
 * Optional token target metadata used by the renderer or planner to resolve
 * visual anchors. Target ids identify current map placements only; they are not
 * an authority for whether a move hit, missed, or changed saved state.
 */
export interface MoveAnimationTargetMetadata {
  targetId?: string
  targetIds?: readonly string[]
  /** Optional grid-cell fallback for effects whose target token is unavailable. */
  targetCell?: GridAnchor
}

/** Optional grid-cell metadata for effects that originate from or near the user. */
export interface MoveAnimationOriginMetadata {
  originCell?: GridAnchor
}

/** Optional cell metadata for confirmed area or sweep effects. */
export interface MoveAnimationAreaMetadata {
  areaCells?: readonly GridAnchor[]
  areaOrigin?: GridAnchor
}

/** Optional destination/path metadata for movement-like visual effects. */
export interface MoveAnimationPathMetadata {
  destinationCell?: GridAnchor
  pathCells?: readonly GridAnchor[]
}

/** Distinguishes the semantic half of a combined buff/debuff visual request. */
export type MoveAnimationBuffDebuffDirection = 'buff' | 'debuff'

/**
 * Base fields shared by every transient move animation event.
 *
 * Move animation events are client-side VFX requests. They must never be saved
 * into map JSON, sheet JSON, campaign/session state, move usage logs, or server
 * payloads. They are visual-only and must not change move mechanics, token
 * placement, HP, conditions, combat stages, permissions, or visibility rules.
 */
export interface MoveAnimationEventBase<K extends MoveAnimationEventKind = MoveAnimationEventKind> {
  /** Stable queue/renderer id for this visual request. */
  id: string
  /** Display name of the move that caused the VFX request. */
  moveName: string
  /** Map placement id for the user/source token at the time of the request. */
  userId: string
  /** Client clock timestamp for when the request was created. */
  createdAtMs: number
  /** Intended visual lifetime in milliseconds. */
  durationMs: number
  kind: K
}

export interface MoveProjectileAnimationEvent
  extends MoveAnimationEventBase<'projectile'>,
    MoveAnimationOriginMetadata,
    MoveAnimationTargetMetadata {}

export interface MoveBeamAnimationEvent
  extends MoveAnimationEventBase<'beam'>,
    MoveAnimationOriginMetadata,
    MoveAnimationTargetMetadata {}

export interface MoveArcAnimationEvent
  extends MoveAnimationEventBase<'arc'>,
    MoveAnimationOriginMetadata,
    MoveAnimationTargetMetadata {}

export interface MoveMeleeLungeAnimationEvent
  extends MoveAnimationEventBase<'melee-lunge'>,
    MoveAnimationOriginMetadata,
    MoveAnimationTargetMetadata {}

export interface MoveSelfPulseAnimationEvent
  extends MoveAnimationEventBase<'self-pulse'>,
    MoveAnimationOriginMetadata {}

export interface MoveTargetFlashAnimationEvent
  extends MoveAnimationEventBase<'target-flash'>,
    MoveAnimationTargetMetadata {}

export interface MoveAreaPulseAnimationEvent
  extends MoveAnimationEventBase<'area-pulse'>,
    MoveAnimationAreaMetadata {}

export interface MoveLineSweepAnimationEvent
  extends MoveAnimationEventBase<'line-sweep'>,
    MoveAnimationOriginMetadata,
    MoveAnimationAreaMetadata {}

export interface MoveConeSweepAnimationEvent
  extends MoveAnimationEventBase<'cone-sweep'>,
    MoveAnimationOriginMetadata,
    MoveAnimationAreaMetadata {}

export interface MoveDashAnimationEvent
  extends MoveAnimationEventBase<'dash'>,
    MoveAnimationOriginMetadata,
    MoveAnimationPathMetadata {}

export interface MoveMissAnimationEvent
  extends MoveAnimationEventBase<'miss'>,
    MoveAnimationTargetMetadata {}

export interface MoveCritAnimationEvent
  extends MoveAnimationEventBase<'crit'>,
    MoveAnimationTargetMetadata {}

export interface MoveStatusAnimationEvent
  extends MoveAnimationEventBase<'status'>,
    MoveAnimationTargetMetadata {}

export interface MoveHealingAnimationEvent
  extends MoveAnimationEventBase<'healing'>,
    MoveAnimationTargetMetadata {}

export interface MoveBuffDebuffAnimationEvent
  extends MoveAnimationEventBase<'buff-debuff'>,
    MoveAnimationTargetMetadata {
  direction?: MoveAnimationBuffDebuffDirection
}

export type MoveAnimationEvent =
  | MoveProjectileAnimationEvent
  | MoveBeamAnimationEvent
  | MoveArcAnimationEvent
  | MoveMeleeLungeAnimationEvent
  | MoveSelfPulseAnimationEvent
  | MoveTargetFlashAnimationEvent
  | MoveAreaPulseAnimationEvent
  | MoveLineSweepAnimationEvent
  | MoveConeSweepAnimationEvent
  | MoveDashAnimationEvent
  | MoveMissAnimationEvent
  | MoveCritAnimationEvent
  | MoveStatusAnimationEvent
  | MoveHealingAnimationEvent
  | MoveBuffDebuffAnimationEvent
