import type { GridAnchor } from './map'
import { MOVE_VFX_KIND } from './moveVfx'
import type { MoveVfxKind } from './moveVfx'
import type { MoveVfxPaletteEntry, MoveVfxTone } from '~/utils/moveAnimationPalette'

export { MOVE_VFX_KIND } from './moveVfx'
export type { MoveAnimationEffectKind, MoveVfxKind } from './moveVfx'

/**
 * Backwards-compatible event-kind alias. Prefer `MoveVfxKind` or
 * `MoveAnimationEffectKind` when categorizing generic visual effects.
 */
export type MoveAnimationEventKind = MoveVfxKind

/** Stable transient queue/renderer id for a single move VFX request. */
export type MoveAnimationId = string

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
 * The `kind` discriminant uses `MoveVfxKind`, the generic renderer effect-kind
 * catalog from `moveVfx.ts`. It is intentionally independent from move scripts
 * so moves, abilities, maneuvers, orders, manual triggers, and future per-move
 * overrides can reuse the same visual categories without coupling VFX to rules.
 *
 * Move animation events are client-side VFX requests. They must never be saved
 * into map JSON, sheet JSON, campaign/session state, move usage logs, or server
 * payloads. They are visual-only and must not change move mechanics, token
 * placement, HP, conditions, combat stages, permissions, or visibility rules.
 */
export interface MoveAnimationEventBase<K extends MoveVfxKind = MoveVfxKind> {
  /**
   * Stable queue/renderer id for this visual request.
   *
   * The per-map move animation queue generates ids with the deterministic
   * `move-vfx` prefix and a monotonic suffix when callers do not provide one.
   * Enqueueing the same id twice is ignored by default so repeated watchers do
   * not replay the same resolution moment; use a distinct id for intentional
   * multi-effect sequences.
   */
  id: MoveAnimationId
  /** Display name of the move that caused the VFX request. */
  moveName: string
  /** Map placement id for the user/source token at the time of the request. */
  userId: string
  /** Client clock timestamp for when the request was created. */
  createdAtMs: number
  /** Intended visual lifetime in milliseconds. */
  durationMs: number
  /** Optional planner-selected colour palette for renderer primitives. */
  palette?: MoveVfxPaletteEntry
  kind: K
}

export interface MoveProjectileAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.projectile>,
    MoveAnimationOriginMetadata,
    MoveAnimationTargetMetadata {}

export interface MoveBeamAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.beam>,
    MoveAnimationOriginMetadata,
    MoveAnimationTargetMetadata,
    MoveAnimationAreaMetadata {
  /** Optional beam-local impact accent at the target end. Generic impact-ring primitives land later. */
  impact?: boolean
}

export interface MoveArcAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.arc>,
    MoveAnimationOriginMetadata,
    MoveAnimationTargetMetadata {
  /** Optional requested lob height in world units. The renderer clamps unsafe values. */
  arcHeight?: number
}

export interface MoveMeleeLungeAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.meleeLunge>,
    MoveAnimationOriginMetadata,
    MoveAnimationTargetMetadata {}

export type MoveSelfPulseTone = 'heal' | MoveVfxTone

export interface MoveSelfPulseAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.selfPulse>,
    MoveAnimationOriginMetadata {
  /** Semantic colour hint for user-centred aura pulses; omitted values use the event/type palette. */
  tone?: MoveSelfPulseTone
}

export type MoveTargetFlashTone = 'hit' | 'heal' | MoveVfxTone

export interface MoveTargetFlashAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.targetFlash>,
    MoveAnimationTargetMetadata {
  /** Semantic colour hint for generic target flashes; unknown runtime tones fall back to neutral. */
  tone?: MoveTargetFlashTone
}

export type MoveImpactRingTone = 'hit' | 'damage' | 'damaging' | 'heal' | MoveVfxTone

export interface MoveImpactRingAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.impactRing>,
    MoveAnimationTargetMetadata {
  /** Optional semantic colour hint; omitted values use the event/type palette. */
  tone?: MoveImpactRingTone
}

export interface MoveAreaPulseAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.areaPulse>,
    MoveAnimationAreaMetadata {}

export interface MoveRadialBurstAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.radialBurst>,
    MoveAnimationOriginMetadata,
    MoveAnimationAreaMetadata {}

export interface MoveLineSweepAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.lineSweep>,
    MoveAnimationOriginMetadata,
    MoveAnimationAreaMetadata {}

export interface MoveConeSweepAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.coneSweep>,
    MoveAnimationOriginMetadata,
    MoveAnimationAreaMetadata {}

export interface MoveDashAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.dash>,
    MoveAnimationOriginMetadata,
    MoveAnimationPathMetadata {}

export interface MoveMissAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.miss>,
    MoveAnimationTargetMetadata {}

export interface MoveCritAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.crit>,
    MoveAnimationTargetMetadata {}

export interface MoveStatusAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.status>,
    MoveAnimationTargetMetadata {
  /** Optional primary condition name used only for generic status-cloud colour hints. */
  conditionName?: string
  /** Optional combined condition names; renderer chooses one compact status-cloud hint instead of noisy per-condition art. */
  conditionNames?: readonly string[]
}

export interface MoveHealingAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.healing>,
    MoveAnimationTargetMetadata {}

export interface MoveBuffDebuffAnimationEvent
  extends MoveAnimationEventBase<typeof MOVE_VFX_KIND.buffDebuff>,
    MoveAnimationTargetMetadata {
  /** Semantic tone hint used by the renderer; omitted values infer from direction or palette. */
  tone?: MoveAnimationBuffDebuffDirection
  /** Upward positive-stage read or sinking negative-stage read. */
  direction?: MoveAnimationBuffDebuffDirection
}

/**
 * Mapping from the shared visual kind catalog to its concrete event variant.
 * Indexing by `MoveVfxKind` keeps variant coverage tied to the single kind list.
 */
export interface MoveAnimationEventByKind {
  [MOVE_VFX_KIND.projectile]: MoveProjectileAnimationEvent
  [MOVE_VFX_KIND.beam]: MoveBeamAnimationEvent
  [MOVE_VFX_KIND.arc]: MoveArcAnimationEvent
  [MOVE_VFX_KIND.meleeLunge]: MoveMeleeLungeAnimationEvent
  [MOVE_VFX_KIND.selfPulse]: MoveSelfPulseAnimationEvent
  [MOVE_VFX_KIND.targetFlash]: MoveTargetFlashAnimationEvent
  [MOVE_VFX_KIND.impactRing]: MoveImpactRingAnimationEvent
  [MOVE_VFX_KIND.areaPulse]: MoveAreaPulseAnimationEvent
  [MOVE_VFX_KIND.radialBurst]: MoveRadialBurstAnimationEvent
  [MOVE_VFX_KIND.lineSweep]: MoveLineSweepAnimationEvent
  [MOVE_VFX_KIND.coneSweep]: MoveConeSweepAnimationEvent
  [MOVE_VFX_KIND.dash]: MoveDashAnimationEvent
  [MOVE_VFX_KIND.miss]: MoveMissAnimationEvent
  [MOVE_VFX_KIND.crit]: MoveCritAnimationEvent
  [MOVE_VFX_KIND.status]: MoveStatusAnimationEvent
  [MOVE_VFX_KIND.healing]: MoveHealingAnimationEvent
  [MOVE_VFX_KIND.buffDebuff]: MoveBuffDebuffAnimationEvent
}

export type MoveAnimationEvent = MoveAnimationEventByKind[MoveVfxKind]
