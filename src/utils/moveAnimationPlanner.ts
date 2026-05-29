import type { GridAnchor } from '~/types/map'
import type { MoveAnimationEvent } from '~/types/moveAnimation'
import type {
  MoveAutomationAreaDirection,
  MoveAutomationFeedbackEffectiveness,
  MoveAutomationFeedbackState,
  MoveAutomationScript,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

/** Resolution flows that can request generic move VFX plans. */
export const MOVE_ANIMATION_PLAN_RESOLUTION = {
  self: 'self',
  singleTarget: 'single-target',
  area: 'area',
} as const

export type MoveAnimationPlanResolution = (
  typeof MOVE_ANIMATION_PLAN_RESOLUTION
)[keyof typeof MOVE_ANIMATION_PLAN_RESOLUTION]

/**
 * Readonly token snapshot accepted by the planner.
 *
 * The planner may inspect map-domain token data such as ids, positions, size,
 * HP, conditions, and combat stages, but it must never mutate these objects.
 */
export type MoveAnimationPlanToken = Readonly<SpawnedPokemon>

/** Readonly move-automation script metadata used for visual classification. */
export type MoveAnimationPlanScript = Readonly<MoveAutomationScript>

/** Readonly transaction/result data that has already been produced by move automation. */
export type MoveAnimationPlanTransaction = Readonly<MoveAutomationTransaction>

/** Readonly roll-feedback snapshot for single-target accuracy flows. */
export type MoveAnimationPlanFeedback = Readonly<MoveAutomationFeedbackState>

/** Readonly grid-cell coordinate used for area and fallback visual anchors. */
export type MoveAnimationPlanGridAnchor = Readonly<GridAnchor>

/**
 * Deterministic timing data supplied by the move-automation caller.
 *
 * Planner implementations should derive event `createdAtMs`, ids, and optional
 * delays from this object instead of reading wall-clock time, starting timers,
 * or owning mutable scheduler state.
 */
export interface MoveAnimationPlanTimingContext {
  /** Caller-provided client timestamp used as the base `createdAtMs` for events. */
  readonly nowMs: number
  /** Stable prefix/seed for event ids created for this one move resolution moment. */
  readonly animationIdBase?: string
  /** Optional base delay applied to planned launch/source events. */
  readonly baseDelayMs?: number
  /** Optional delay hint for impact/follow-up events after launch or roll feedback. */
  readonly impactDelayMs?: number
}

/**
 * Per-target hit/miss outcome data distilled from feedback and/or transactions.
 *
 * A miss is represented by `hit: false`. Damage, effectiveness, crit, and
 * condition fields are optional because self, no-accuracy, and area flows do not
 * all expose the same roll-feedback shape.
 */
export interface MoveAnimationPlanTargetOutcome {
  readonly targetId: string
  readonly hit: boolean
  readonly crit?: boolean
  readonly damageResolved?: boolean
  readonly damageLoss?: number
  readonly effectiveness?: MoveAutomationFeedbackEffectiveness
  readonly conditions?: readonly string[]
}

interface MoveAnimationPlanInputBase<R extends MoveAnimationPlanResolution> {
  /** Discriminates the move-resolution flow that produced this planning input. */
  readonly resolution: R
  /** Move user/source token snapshot, or null when the token disappeared before planning. */
  readonly user: MoveAnimationPlanToken | null
  /** Target token snapshots known to the resolving move flow. Self moves normally pass an empty array. */
  readonly targets: readonly MoveAnimationPlanToken[]
  /** Final target ids selected by the automation flow, including misses when known. */
  readonly selectedTargetIds: readonly string[]
  /** Explicit move script that resolved the mechanics. The planner must not run move rules. */
  readonly script: MoveAnimationPlanScript
  /** Optional transaction already produced by move automation. It is input data, not state to mutate. */
  readonly transaction?: MoveAnimationPlanTransaction | null
  /** Optional target roll/result summary for hit, miss, crit, and semantic follow-up planning. */
  readonly targetOutcomes?: readonly MoveAnimationPlanTargetOutcome[]
  /** Caller-owned timing/id context that keeps the planner deterministic and unit-testable. */
  readonly timing: MoveAnimationPlanTimingContext
}

/** Planner input for self or immediate user-centered move resolutions. */
export interface MoveAnimationSelfPlanInput
  extends MoveAnimationPlanInputBase<typeof MOVE_ANIMATION_PLAN_RESOLUTION.self> {}

/** Planner input for single-target resolutions, including optional roll feedback. */
export interface MoveAnimationSingleTargetPlanInput
  extends MoveAnimationPlanInputBase<typeof MOVE_ANIMATION_PLAN_RESOLUTION.singleTarget> {
  /** Existing roll feedback state for accuracy, hit/miss, crit, and damage display phases. */
  readonly feedback?: MoveAnimationPlanFeedback | null
}

/** Planner input for confirmed area-template resolutions. */
export interface MoveAnimationAreaPlanInput
  extends MoveAnimationPlanInputBase<typeof MOVE_ANIMATION_PLAN_RESOLUTION.area> {
  /** Confirmed cells affected by the area template. Empty arrays are valid and should no-op later. */
  readonly areaCells: readonly MoveAnimationPlanGridAnchor[]
  /** Direction selected by the area-template confirmation flow, when one exists. */
  readonly areaDirection?: MoveAutomationAreaDirection
  /** Candidate ids the user explicitly excluded from a Friendly area move, if any. */
  readonly excludedTargetIds?: readonly string[]
  /** Movement-like area moves may provide a pass/dash destination for future dash VFX. */
  readonly passDestination?: MoveAnimationPlanGridAnchor
}

export type MoveAnimationPlanInput =
  | MoveAnimationSelfPlanInput
  | MoveAnimationSingleTargetPlanInput
  | MoveAnimationAreaPlanInput

/** Output contract for a pure move-animation planner. */
export type MoveAnimationPlanOutput = readonly MoveAnimationEvent[]

/** Alias used by tests and future planner implementations. */
export type MoveAnimationPlan = MoveAnimationPlanOutput

/**
 * Pure boundary between move automation rules and renderer-ready VFX events.
 *
 * Implementations must be deterministic and side-effect free: no Vue refs,
 * reactive state, DOM/WebGL/Three.js objects, PokemonRenderObject instances,
 * timers, scheduler ownership, or mutations to map, sheet, token, script,
 * transaction, feedback, or campaign state. The returned events are transient
 * client-local display requests that can be unit-tested without DOM or WebGL.
 */
export type MoveAnimationPlanner = (input: MoveAnimationPlanInput) => MoveAnimationPlanOutput
