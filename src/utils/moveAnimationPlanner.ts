import type { GridAnchor } from '~/types/map'
import {
  MOVE_VFX_KIND,
  type MoveAnimationEvent,
  type MoveAnimationEventByKind,
  type MoveVfxKind,
} from '~/types/moveAnimation'
import type {
  MoveAutomationAreaDirection,
  MoveAutomationFeedbackEffectiveness,
  MoveAutomationFeedbackState,
  MoveAutomationRecipient,
  MoveAutomationScript,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import {
  MOVE_VFX_TONE,
  type MoveVfxPaletteEntry,
  moveVfxColorForTone,
  moveVfxColorForType,
} from '~/utils/moveAnimationPalette'
import { MOVE_VFX_DEFAULT_DURATIONS_MS } from '~/utils/isometric/moveVfxTiming'
import {
  MOVE_ANIMATION_TARGET_SEQUENCE_ORDER,
  applyMoveAnimationTargetStartOffsets,
  createMoveAnimationTargetStartOffsets,
} from '~/utils/moveAnimationSequencing'

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

/** Canonical, normalized move-name key used by future per-move override registries. */
export type MoveAnimationOverrideKey = string

/**
 * Context supplied to future bespoke override planners.
 *
 * Real per-move choreography is intentionally deferred to a later milestone;
 * overrides should call `fallbackPlanner` when they cannot fully own a move's
 * visual plan, and production code should keep the default registry empty for
 * the basic generic-animation phase.
 */
export interface MoveAnimationOverrideContext {
  readonly canonicalMoveName: MoveAnimationOverrideKey
  readonly fallbackPlanner: MoveAnimationPlanner
}

/**
 * Optional future preset contract for bespoke per-move animation choreography.
 *
 * A preset may return a concrete event list, return an empty array to
 * intentionally suppress VFX, or return `null`/`undefined` to let the generic
 * metadata-driven planner handle the move. Do not add canonical production move
 * presets during the basic move-VFX phase; this hook exists for a later
 * per-move animation milestone.
 */
export interface MoveAnimationPreset {
  readonly id: string
  readonly description?: string
  readonly plan: (
    input: MoveAnimationPlanInput,
    context: MoveAnimationOverrideContext,
  ) => MoveAnimationPlanOutput | null | undefined
}

/** Registry entry for a future per-move preset. Disabled entries fall back to generic planning. */
export interface MoveAnimationOverride {
  readonly preset: MoveAnimationPreset
  readonly disabled?: boolean
  readonly notes?: string
}

/**
 * Registry shape keyed by `canonicalMoveAnimationOverrideKey(moveName)`.
 *
 * The production registry below is deliberately empty: no canonical move gets
 * bespoke choreography in this implementation phase.
 */
export type MoveAnimationOverrideRegistry = Readonly<Record<MoveAnimationOverrideKey, MoveAnimationOverride | undefined>>

/**
 * Production registry for future per-move presets.
 *
 * Keep this empty until a future bespoke per-move animation milestone approves
 * specific choreography, review scope, tests, and fan-project asset boundaries.
 */
export const MOVE_ANIMATION_OVERRIDE_REGISTRY: MoveAnimationOverrideRegistry = Object.freeze({})

export interface CreateMoveAnimationPlannerOptions {
  readonly overrideRegistry?: MoveAnimationOverrideRegistry
  readonly fallbackPlanner?: MoveAnimationPlanner
  /** Optional development-only diagnostics when a planner branch has to fall back safely. */
  readonly logPlanningWarnings?: boolean
}

type GenericMoveSemanticIntent =
  | { readonly kind: 'healing'; readonly tone: typeof MOVE_VFX_TONE.healing }
  | { readonly kind: 'status'; readonly tone: typeof MOVE_VFX_TONE.status }
  | { readonly kind: 'buff-debuff'; readonly tone: typeof MOVE_VFX_TONE.buff | typeof MOVE_VFX_TONE.debuff; readonly direction: 'buff' | 'debuff' }
  | { readonly kind: 'neutral'; readonly tone: typeof MOVE_VFX_TONE.neutral }

type PlannerEventIdFactory = (kind: MoveVfxKind, targetId?: string) => string

interface MoveAnimationPlannerImportMetaEnvironment {
  readonly dev?: boolean
  readonly env?: {
    readonly DEV?: unknown
    readonly MODE?: unknown
  }
}

interface MoveAnimationPlannerProcessEnvironment {
  readonly dev?: unknown
  readonly env?: {
    readonly NODE_ENV?: unknown
  }
}

const UNKNOWN_MOVE_ANIMATION_MOVE_NAME = 'Unknown Move'
const UNKNOWN_MOVE_ANIMATION_USER_ID = 'unknown-user'
const AREA_TARGET_FOLLOW_UP_BASE_OFFSET_MS = 180
const AREA_PASS_DASH_IMPACT_OFFSET_MS = 120
const AREA_PASS_DASH_TARGET_FOLLOW_UP_BASE_OFFSET_MS = 260
const MOVE_VFX_KIND_VALUES = new Set<string>(Object.values(MOVE_VFX_KIND))

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
)

const isMoveVfxKind = (value: unknown): value is MoveVfxKind => (
  typeof value === 'string' && MOVE_VFX_KIND_VALUES.has(value)
)

const stringOrUndefined = (value: unknown): string | undefined => (
  typeof value === 'string' ? value : undefined
)

const nonEmptyStringOrUndefined = (value: unknown): string | undefined => {
  const trimmed = stringOrUndefined(value)?.trim()
  return trimmed ? trimmed : undefined
}

const arrayOrEmpty = <T>(value: readonly T[] | null | undefined): readonly T[] => (
  Array.isArray(value) ? value : []
)

const stringArrayOrEmpty = (value: readonly unknown[] | null | undefined): readonly string[] => (
  arrayOrEmpty(value).filter((item): item is string => typeof item === 'string')
)

const gridAnchorOrUndefined = (value: unknown): GridAnchor | undefined => {
  if (!isRecord(value)) return undefined

  const { x, y, z } = value
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return undefined

  return { x: x as number, y: y as number, z: z as number }
}

const gridAnchorsOrEmpty = (value: readonly unknown[] | null | undefined): readonly GridAnchor[] => (
  arrayOrEmpty(value)
    .map(gridAnchorOrUndefined)
    .filter((anchor): anchor is GridAnchor => Boolean(anchor))
)

const finiteNumberOrZero = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : 0
)

const safePlannerDurationMs = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : MOVE_VFX_DEFAULT_DURATIONS_MS.normal
)

const timingForInput = (input: MoveAnimationPlanInput): MoveAnimationPlanTimingContext => {
  const timing: Record<string, unknown> = isRecord(input.timing) ? input.timing : {}

  return {
    nowMs: finiteNumberOrZero(timing.nowMs),
    animationIdBase: nonEmptyStringOrUndefined(timing.animationIdBase),
    baseDelayMs: finiteNumberOrZero(timing.baseDelayMs),
    impactDelayMs: finiteNumberOrZero(timing.impactDelayMs),
  }
}

const moveNameForInput = (input: MoveAnimationPlanInput): string => (
  nonEmptyStringOrUndefined(input.script?.moveName)
  ?? nonEmptyStringOrUndefined(input.transaction?.moveName)
  ?? UNKNOWN_MOVE_ANIMATION_MOVE_NAME
)

const userIdForInput = (input: MoveAnimationPlanInput): string => (
  nonEmptyStringOrUndefined(input.user?.id)
  ?? nonEmptyStringOrUndefined(input.transaction?.userId)
  ?? UNKNOWN_MOVE_ANIMATION_USER_ID
)

const userTokenForInput = (input: MoveAnimationPlanInput): MoveAnimationPlanToken | null => (
  isRecord(input.user) ? input.user as MoveAnimationPlanToken : null
)

const positionForToken = (token: MoveAnimationPlanToken | null | undefined): GridAnchor | undefined => (
  gridAnchorOrUndefined(token?.position)
)

const sanitizePlannerIdPart = (value: unknown): string => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'event'
}

export const canonicalMoveAnimationOverrideKey = (moveName: unknown): MoveAnimationOverrideKey => {
  const normalized = String(moveName ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'unknown-move'
}

const createPlannerEventIdFactory = (input: MoveAnimationPlanInput): PlannerEventIdFactory => {
  const timing = timingForInput(input)
  const baseSeed = timing.animationIdBase
    ?? `${moveNameForInput(input)}-${timing.nowMs}`
  const base = sanitizePlannerIdPart(baseSeed)
  let nextSequence = 1

  return (kind, targetId) => {
    const sequence = String(nextSequence++).padStart(2, '0')
    const targetSuffix = targetId ? `-${sanitizePlannerIdPart(targetId)}` : ''
    return `${base}-${sanitizePlannerIdPart(kind)}${targetSuffix}-${sequence}`
  }
}

const targetIdFromEventExtras = <K extends MoveVfxKind>(
  extras: Partial<MoveAnimationEventByKind[K]>,
): string | undefined => {
  if (!('targetId' in extras)) return undefined
  return nonEmptyStringOrUndefined(extras.targetId)
}

const createPlannerEvent = <K extends MoveVfxKind>(
  input: MoveAnimationPlanInput,
  nextId: PlannerEventIdFactory,
  kind: K,
  durationMs: number,
  extras: Partial<MoveAnimationEventByKind[K]> = {},
  palette?: MoveVfxPaletteEntry,
): MoveAnimationEventByKind[K] => ({
  id: nextId(kind, targetIdFromEventExtras(extras)),
  moveName: moveNameForInput(input),
  userId: userIdForInput(input),
  createdAtMs: timingForInput(input).nowMs,
  durationMs: safePlannerDurationMs(durationMs),
  palette,
  kind,
  ...extras,
} as MoveAnimationEventByKind[K])

const startOffsetMetadata = (startOffsetMs: number | undefined): { readonly startOffsetMs?: number } => (
  typeof startOffsetMs === 'number' && Number.isFinite(startOffsetMs) && startOffsetMs > 0
    ? { startOffsetMs }
    : {}
)

/**
 * VFX-017 fallback policy:
 * - if the user/source token is missing, return an empty plan because there is
 *   no trustworthy anchor for a visual-only effect;
 * - if a single-target move has no usable target id, show a neutral self pulse
 *   on the user instead of inventing a target;
 * - if a target id exists but its token snapshot/cell is missing, keep the
 *   target-id-only event so a later renderer can resolve the live token or skip
 *   the effect without planner failure;
 * - if area cells are empty or invalid, fall back to the same neutral user
 *   pulse instead of creating an empty area primitive;
 * - unknown/custom move types use the neutral palette via the palette helper;
 * - invalid or missing event durations are normalized to the normal timing tier;
 * - unexpected override/generic-planner failures are caught by the public
 *   planner and become this neutral fallback or a no-op, with optional dev logs.
 */
const createNeutralPlannerFallback = (input: MoveAnimationPlanInput): MoveAnimationEvent[] => {
  const user = userTokenForInput(input)
  if (!user) return []

  return [createPlannerEvent(input, createPlannerEventIdFactory(input), MOVE_VFX_KIND.selfPulse, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
    originCell: positionForToken(user),
  }, moveVfxColorForTone(MOVE_VFX_TONE.neutral))]
}

const normalizePlannerOutput = (
  input: MoveAnimationPlanInput,
  output: MoveAnimationPlanOutput,
): MoveAnimationEvent[] => {
  if (!Array.isArray(output)) return []

  const nextId = createPlannerEventIdFactory(input)
  const timing = timingForInput(input)

  return output.flatMap((event) => {
    if (!isRecord(event) || !isMoveVfxKind(event.kind)) return []

    const targetId = nonEmptyStringOrUndefined(event.targetId)
    return [{
      ...event,
      id: nonEmptyStringOrUndefined(event.id) ?? nextId(event.kind, targetId),
      moveName: nonEmptyStringOrUndefined(event.moveName) ?? moveNameForInput(input),
      userId: nonEmptyStringOrUndefined(event.userId) ?? userIdForInput(input),
      createdAtMs: finiteNumberOrZero(event.createdAtMs) || timing.nowMs,
      durationMs: safePlannerDurationMs(event.durationMs),
      kind: event.kind,
    } as MoveAnimationEvent]
  })
}

const isMoveAnimationPlannerDevelopmentEnvironment = (): boolean => {
  const meta = import.meta as MoveAnimationPlannerImportMetaEnvironment
  const processDebug = globalThis.process as MoveAnimationPlannerProcessEnvironment | undefined

  return (
    meta.dev === true
    || meta.env?.DEV === true
    || meta.env?.DEV === 'true'
    || meta.env?.MODE === 'development'
    || processDebug?.dev === true
    || processDebug?.env?.NODE_ENV === 'development'
  )
}

const warnMoveAnimationPlannerFallback = (
  enabled: boolean,
  reason: string,
  error: unknown,
): void => {
  if (!enabled) return
  console.warn(`[move-vfx] ${reason}; using safe fallback.`, error)
}

const includesNormalizedWord = (haystack: string, words: readonly string[]): boolean => {
  const normalized = haystack.toLowerCase()
  return words.some((word) => new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, 'i').test(normalized))
}

const keywordsForScript = (script: MoveAnimationPlanScript): readonly string[] => (
  stringArrayOrEmpty(script.keywords)
)

const areaTemplatesForScript = (script: MoveAnimationPlanScript) => (
  Array.isArray(script.areaTemplates) ? script.areaTemplates : []
)

const moveClassificationText = (script: MoveAnimationPlanScript): string => [
  stringOrUndefined(script.range) ?? '',
  stringOrUndefined(script.effect) ?? '',
  stringOrUndefined(script.special) ?? '',
  ...keywordsForScript(script),
  ...areaTemplatesForScript(script).map((template) => {
    if (!isRecord(template)) return ''
    return `${stringOrUndefined(template.kind) ?? ''} ${stringOrUndefined(template.label) ?? ''}`
  }),
]
  .filter(Boolean)
  .join(' ')

const hasHealingSuggestion = (
  script: MoveAnimationPlanScript,
  recipient?: MoveAutomationRecipient,
): boolean => arrayOrEmpty(script.hpSuggestions).some((suggestion) => (
  (!recipient || suggestion.recipient === recipient)
  && (stringOrUndefined(suggestion.mode)?.startsWith('heal') ?? false)
))

const stageDirectionForRecipient = (
  script: MoveAnimationPlanScript,
  recipient?: MoveAutomationRecipient,
): 'buff' | 'debuff' | null => {
  const stageSuggestions = arrayOrEmpty(script.stageSuggestions).filter((suggestion) => (
    !recipient || suggestion.recipient === recipient
  ))

  if (stageSuggestions.some((suggestion) => typeof suggestion.delta === 'number' && suggestion.delta > 0)) return 'buff'
  if (stageSuggestions.some((suggestion) => typeof suggestion.delta === 'number' && suggestion.delta < 0)) return 'debuff'
  return null
}

const hasStatusSuggestion = (
  script: MoveAnimationPlanScript,
  recipient?: MoveAutomationRecipient,
): boolean => arrayOrEmpty(script.conditionSuggestions).some((suggestion) => (
  !recipient || suggestion.recipient === recipient
))

const conditionSuggestionNamesForScript = (
  script: MoveAnimationPlanScript,
  recipient?: MoveAutomationRecipient,
): readonly string[] => arrayOrEmpty(script.conditionSuggestions)
  .filter((suggestion) => !recipient || suggestion.recipient === recipient)
  .map((suggestion) => nonEmptyStringOrUndefined(suggestion.condition))
  .filter((condition): condition is string => Boolean(condition))

const semanticIntentForScript = (
  script: MoveAnimationPlanScript,
  recipient?: MoveAutomationRecipient,
): GenericMoveSemanticIntent => {
  if (hasHealingSuggestion(script, recipient)) {
    return { kind: 'healing', tone: MOVE_VFX_TONE.healing }
  }

  const stageDirection = stageDirectionForRecipient(script, recipient)
  if (stageDirection) {
    return {
      kind: 'buff-debuff',
      tone: stageDirection === 'buff' ? MOVE_VFX_TONE.buff : MOVE_VFX_TONE.debuff,
      direction: stageDirection,
    }
  }

  if (hasStatusSuggestion(script, recipient) || script.damageClass === 'Status') {
    return { kind: 'status', tone: MOVE_VFX_TONE.status }
  }

  return { kind: 'neutral', tone: MOVE_VFX_TONE.neutral }
}

const paletteForSemanticIntent = (intent: GenericMoveSemanticIntent): MoveVfxPaletteEntry => (
  moveVfxColorForTone(intent.tone)
)

const targetIdForToken = (target: MoveAnimationPlanToken | undefined): string | undefined => (
  nonEmptyStringOrUndefined(target?.id)
)

const firstKnownTargetId = (input: MoveAnimationSingleTargetPlanInput): string | undefined => (
  nonEmptyStringOrUndefined(input.feedback?.targetId)
  ?? arrayOrEmpty(input.targetOutcomes)
    .map((outcome) => nonEmptyStringOrUndefined(outcome.targetId))
    .find(Boolean)
  ?? stringArrayOrEmpty(input.selectedTargetIds)[0]
  ?? targetIdForToken(arrayOrEmpty(input.targets)[0])
)

const targetForId = (
  input: MoveAnimationPlanInput,
  targetId: string | undefined,
): MoveAnimationPlanToken | undefined => {
  if (!targetId) return undefined
  return arrayOrEmpty(input.targets).find((target) => target.id === targetId)
}

const feedbackToTargetOutcome = (
  feedback: MoveAnimationPlanFeedback | null | undefined,
): MoveAnimationPlanTargetOutcome | null => {
  if (!feedback) return null

  const targetId = nonEmptyStringOrUndefined(feedback.targetId)
  if (!targetId) return null

  return {
    targetId,
    hit: feedback.hit === true,
    crit: feedback.crit === true,
    damageResolved: feedback.damageResolved === true,
    damageLoss: typeof feedback.damageLoss === 'number' ? feedback.damageLoss : undefined,
    effectiveness: feedback.effectiveness,
    conditions: arrayOrEmpty(feedback.conditions)
      .filter((condition) => condition.applied)
      .map((condition) => condition.condition)
      .filter((condition): condition is string => typeof condition === 'string'),
  }
}

const explicitTargetOutcomeForId = (
  input: MoveAnimationPlanInput,
  targetId: string | undefined,
): MoveAnimationPlanTargetOutcome | null => (
  arrayOrEmpty(input.targetOutcomes).find((outcome) => outcome.targetId === targetId) ?? null
)

const targetOutcomeForId = (
  input: MoveAnimationSingleTargetPlanInput,
  targetId: string | undefined,
): MoveAnimationPlanTargetOutcome | null => {
  const explicitOutcome = explicitTargetOutcomeForId(input, targetId)
  if (explicitOutcome) return explicitOutcome

  const feedbackOutcome = feedbackToTargetOutcome(input.feedback)
  if (feedbackOutcome && (!targetId || feedbackOutcome.targetId === targetId)) return feedbackOutcome

  return null
}

const selectedAreaTargetIdsForInput = (input: MoveAnimationAreaPlanInput): string[] => {
  const excludedTargetIds = new Set(stringArrayOrEmpty(input.excludedTargetIds))
  const seen = new Set<string>()
  const selectedTargetIds: string[] = []

  for (const targetId of stringArrayOrEmpty(input.selectedTargetIds)) {
    if (excludedTargetIds.has(targetId) || seen.has(targetId)) continue
    seen.add(targetId)
    selectedTargetIds.push(targetId)
  }

  return selectedTargetIds
}

const passDestinationForInput = (input: MoveAnimationAreaPlanInput): GridAnchor | undefined => (
  gridAnchorOrUndefined(input.passDestination)
)

const passDashAreaImpactStartOffset = (
  timing: MoveAnimationPlanTimingContext,
): { readonly startOffsetMs?: number } => startOffsetMetadata(
  timing.impactDelayMs || AREA_PASS_DASH_IMPACT_OFFSET_MS,
)

const areaTargetFollowUpBaseOffsetMs = (
  input: MoveAnimationAreaPlanInput,
  hasPassDestination: boolean,
): number => {
  const timing = timingForInput(input)
  if (timing.impactDelayMs) return timing.impactDelayMs
  return hasPassDestination
    ? AREA_PASS_DASH_TARGET_FOLLOW_UP_BASE_OFFSET_MS
    : AREA_TARGET_FOLLOW_UP_BASE_OFFSET_MS
}

const damagingPaletteForScript = (script: MoveAnimationPlanScript): MoveVfxPaletteEntry => (
  moveVfxColorForType(script.type)
)

const scriptHasDamageVisual = (script: MoveAnimationPlanScript): boolean => (
  script.damaging === true || Boolean(script.directHpLoss)
)

const isMeleeDamagingMove = (script: MoveAnimationPlanScript): boolean => {
  if (!scriptHasDamageVisual(script)) return false

  const classificationText = moveClassificationText(script)
  const mentionsMelee = includesNormalizedWord(classificationText, ['melee', 'close'])
  const mentionsRanged = includesNormalizedWord(classificationText, ['range', 'ranged', 'line', 'cone', 'blast', 'burst'])

  return mentionsMelee && !mentionsRanged
}

const rangedLaunchKindForScript = (script: MoveAnimationPlanScript):
  | typeof MOVE_VFX_KIND.projectile
  | typeof MOVE_VFX_KIND.beam
  | typeof MOVE_VFX_KIND.arc => {
  const classificationText = moveClassificationText(script)

  if (includesNormalizedWord(classificationText, [
    'arc',
    'lob',
    'thrown',
    'throw',
    'toss',
    'seed',
    'spore',
    'powder',
    'bomb',
    'rock',
  ])) {
    return MOVE_VFX_KIND.arc
  }

  if (includesNormalizedWord(classificationText, [
    'beam',
    'ray',
    'line',
    'pulse',
    'blast',
    'wave',
  ])) {
    return MOVE_VFX_KIND.beam
  }

  return MOVE_VFX_KIND.projectile
}

const areaTemplateKindsForScript = (script: MoveAnimationPlanScript): string[] => areaTemplatesForScript(script)
  .map((template) => isRecord(template) ? stringOrUndefined(template.kind) : undefined)
  .filter((kind): kind is string => Boolean(kind))

const areaSweepKindForScript = (script: MoveAnimationPlanScript):
  | typeof MOVE_VFX_KIND.lineSweep
  | typeof MOVE_VFX_KIND.coneSweep
  | null => {
  const templateKinds = areaTemplateKindsForScript(script)
  const classificationText = moveClassificationText(script)

  if (templateKinds.includes('line') || includesNormalizedWord(classificationText, ['line'])) {
    return MOVE_VFX_KIND.lineSweep
  }

  if (templateKinds.includes('cone') || includesNormalizedWord(classificationText, ['cone'])) {
    return MOVE_VFX_KIND.coneSweep
  }

  return null
}

const shouldPlanRadialBurstForScript = (script: MoveAnimationPlanScript): boolean => {
  const templateKinds = areaTemplateKindsForScript(script)
  const classificationText = moveClassificationText(script)

  return templateKinds.some((kind) => kind === 'burst' || kind.endsWith('blast'))
    || includesNormalizedWord(classificationText, ['burst', 'blast'])
}

const planSelfMoveAnimations = (
  input: MoveAnimationSelfPlanInput,
  nextId: PlannerEventIdFactory,
): MoveAnimationEvent[] => {
  const user = userTokenForInput(input)
  if (!user) return []

  const semanticIntent = semanticIntentForScript(input.script, 'user')
  const palette = paletteForSemanticIntent(semanticIntent)
  const targetId = targetIdForToken(user)
  const targetCell = positionForToken(user)

  if (semanticIntent.kind === 'healing') {
    return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.healing, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      targetId,
      targetCell,
    }, palette)]
  }

  if (semanticIntent.kind === 'buff-debuff') {
    return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.buffDebuff, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      targetId,
      targetCell,
      tone: semanticIntent.direction,
      direction: semanticIntent.direction,
    }, palette)]
  }

  if (semanticIntent.kind === 'status') {
    const conditionNames = conditionSuggestionNamesForScript(input.script, 'user')
    return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.status, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      targetId,
      targetCell,
      ...(conditionNames.length ? { conditionNames } : {}),
    }, palette)]
  }

  return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.selfPulse, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
    originCell: targetCell,
  }, palette)]
}

const planTargetSemanticAnimations = (
  input: MoveAnimationSingleTargetPlanInput,
  nextId: PlannerEventIdFactory,
  targetId: string,
): MoveAnimationEvent[] => {
  const target = targetForId(input, targetId)
  const targetCell = positionForToken(target)
  const semanticIntent = semanticIntentForScript(input.script, 'target')
  const palette = paletteForSemanticIntent(semanticIntent)
  const impactStartOffset = startOffsetMetadata(timingForInput(input).impactDelayMs)

  if (semanticIntent.kind === 'healing') {
    return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.healing, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      targetId,
      targetCell,
      ...impactStartOffset,
    }, palette)]
  }

  if (semanticIntent.kind === 'buff-debuff') {
    return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.buffDebuff, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      targetId,
      targetCell,
      tone: semanticIntent.direction,
      direction: semanticIntent.direction,
      ...impactStartOffset,
    }, palette)]
  }

  if (semanticIntent.kind === 'status') {
    const conditionNames = conditionSuggestionNamesForScript(input.script, 'target')
    return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.status, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      targetId,
      targetCell,
      ...(conditionNames.length ? { conditionNames } : {}),
      ...impactStartOffset,
    }, palette)]
  }

  return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.targetFlash, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
    targetId,
    targetCell,
    ...impactStartOffset,
  }, palette)]
}

const planSingleTargetMoveAnimations = (
  input: MoveAnimationSingleTargetPlanInput,
  nextId: PlannerEventIdFactory,
): MoveAnimationEvent[] => {
  const user = userTokenForInput(input)
  if (!user) return []

  const userCell = positionForToken(user)
  const targetId = firstKnownTargetId(input)
  if (!targetId) {
    return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.selfPulse, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      originCell: userCell,
    }, moveVfxColorForTone(MOVE_VFX_TONE.neutral))]
  }

  const target = targetForId(input, targetId)
  const targetCell = positionForToken(target)
  const outcome = targetOutcomeForId(input, targetId)
  const hit = outcome?.hit ?? true
  const crit = outcome?.crit ?? false
  const timing = timingForInput(input)
  const launchStartOffset = startOffsetMetadata(timing.baseDelayMs)
  const impactStartOffset = startOffsetMetadata(timing.impactDelayMs)

  if (!scriptHasDamageVisual(input.script)) {
    if (!hit) {
      return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.miss, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
        targetId,
        targetCell,
        ...impactStartOffset,
      }, moveVfxColorForTone(MOVE_VFX_TONE.miss))]
    }

    return planTargetSemanticAnimations(input, nextId, targetId)
  }

  const palette = damagingPaletteForScript(input.script)
  const events: MoveAnimationEvent[] = []

  if (isMeleeDamagingMove(input.script)) {
    events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.meleeLunge, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      originCell: userCell,
      targetId,
      targetCell,
      ...launchStartOffset,
    }, palette))
  } else {
    const launchKind = rangedLaunchKindForScript(input.script)
    events.push(createPlannerEvent(input, nextId, launchKind, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      originCell: userCell,
      targetId,
      targetCell,
      ...launchStartOffset,
    }, palette))
  }

  if (!hit) {
    events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.miss, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
      targetId,
      targetCell,
      ...impactStartOffset,
    }, moveVfxColorForTone(MOVE_VFX_TONE.miss)))
    return events
  }

  events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.targetFlash, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
    targetId,
    targetCell,
    shake: true,
    ...impactStartOffset,
  }, palette))

  if (crit) {
    events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.crit, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
      targetId,
      targetCell,
      ...impactStartOffset,
    }, palette))
  }

  return events
}

const planAreaTargetFollowUpAnimations = (
  input: MoveAnimationAreaPlanInput,
  nextId: PlannerEventIdFactory,
  options: {
    readonly userCell?: GridAnchor
    readonly palette: MoveVfxPaletteEntry
    readonly damaging: boolean
    readonly baseOffsetMs: number
  },
): MoveAnimationEvent[] => {
  const targetIds = selectedAreaTargetIdsForInput(input)
  if (targetIds.length === 0) return []

  const offsets = createMoveAnimationTargetStartOffsets(
    targetIds.map((targetId) => ({
      targetId,
      position: positionForToken(targetForId(input, targetId)),
    })),
    {
      order: MOVE_ANIMATION_TARGET_SEQUENCE_ORDER.distanceFromOrigin,
      origin: options.userCell,
      baseOffsetMs: options.baseOffsetMs,
    },
  )

  const targetEvents = targetIds.map((targetId): MoveAnimationEvent => {
    const target = targetForId(input, targetId)
    const targetCell = positionForToken(target)
    const outcome = explicitTargetOutcomeForId(input, targetId)
    const hit = outcome?.hit ?? true

    if (!hit) {
      return createPlannerEvent(input, nextId, MOVE_VFX_KIND.miss, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
        targetId,
        targetCell,
      }, moveVfxColorForTone(MOVE_VFX_TONE.miss))
    }

    return createPlannerEvent(input, nextId, MOVE_VFX_KIND.targetFlash, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
      targetId,
      targetCell,
      ...(options.damaging ? { shake: true } : {}),
    }, options.palette)
  })

  return [...applyMoveAnimationTargetStartOffsets(targetEvents, offsets, { mode: 'replace' })]
}

const planAreaMoveAnimations = (
  input: MoveAnimationAreaPlanInput,
  nextId: PlannerEventIdFactory,
): MoveAnimationEvent[] => {
  const user = userTokenForInput(input)
  if (!user) return []

  const userCell = positionForToken(user)
  const areaCells = gridAnchorsOrEmpty(input.areaCells)
  const passDestination = passDestinationForInput(input)
  const hasPassDestination = Boolean(passDestination)
  const timing = timingForInput(input)
  const passDashImpactOffset = hasPassDestination ? passDashAreaImpactStartOffset(timing) : {}
  const semanticIntent = semanticIntentForScript(input.script)
  const damaging = scriptHasDamageVisual(input.script)
  const palette = damaging
    ? damagingPaletteForScript(input.script)
    : paletteForSemanticIntent(semanticIntent)
  const events: MoveAnimationEvent[] = []

  if (passDestination) {
    events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.dash, MOVE_VFX_DEFAULT_DURATIONS_MS.long, {
      originCell: userCell,
      destinationCell: passDestination,
      pathCells: areaCells.length > 0 ? areaCells : [passDestination],
    }, palette))
  }

  if (areaCells.length > 0) {
    events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.areaPulse, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      areaCells,
      areaOrigin: userCell,
      ...passDashImpactOffset,
    }, palette))

    if (shouldPlanRadialBurstForScript(input.script)) {
      events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.radialBurst, MOVE_VFX_DEFAULT_DURATIONS_MS.long, {
        originCell: userCell,
        areaCells,
        areaOrigin: userCell,
        ...passDashImpactOffset,
      }, palette))
    }

    const sweepKind = areaSweepKindForScript(input.script)
    const sweepMetadata = {
      originCell: userCell,
      areaCells,
      areaOrigin: userCell,
      ...(input.areaDirection ? { areaDirection: input.areaDirection } : {}),
      ...passDashImpactOffset,
    }
    if (sweepKind === MOVE_VFX_KIND.lineSweep) {
      events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.lineSweep, MOVE_VFX_DEFAULT_DURATIONS_MS.long, sweepMetadata, palette))
    } else if (sweepKind === MOVE_VFX_KIND.coneSweep) {
      events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.coneSweep, MOVE_VFX_DEFAULT_DURATIONS_MS.long, sweepMetadata, palette))
    }

    events.push(...planAreaTargetFollowUpAnimations(input, nextId, {
      userCell,
      palette,
      damaging,
      baseOffsetMs: areaTargetFollowUpBaseOffsetMs(input, hasPassDestination),
    }))
  }

  if (events.length > 0) return events

  return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.selfPulse, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
    originCell: userCell,
  }, moveVfxColorForTone(MOVE_VFX_TONE.neutral))]
}

/**
 * Generic metadata-driven planner used before any bespoke per-move animation
 * override system exists. It intentionally avoids move-name-specific branches:
 * target mode, damage flags, range text, keywords, area templates, outcome data,
 * and authored suggestions choose reusable effect families only.
 */
export const planGenericMoveAnimations: MoveAnimationPlanner = (input) => {
  try {
    const nextId = createPlannerEventIdFactory(input)

    switch (input.resolution) {
      case MOVE_ANIMATION_PLAN_RESOLUTION.self:
        return planSelfMoveAnimations(input, nextId)
      case MOVE_ANIMATION_PLAN_RESOLUTION.singleTarget:
        return planSingleTargetMoveAnimations(input, nextId)
      case MOVE_ANIMATION_PLAN_RESOLUTION.area:
        return planAreaMoveAnimations(input, nextId)
      default:
        return createNeutralPlannerFallback(input)
    }
  } catch {
    return createNeutralPlannerFallback(input)
  }
}

/**
 * Creates the public planner pipeline: future per-move override first, generic
 * metadata classification second.
 *
 * The default production override registry is intentionally empty for the basic
 * move-VFX phase, so this behaves exactly like `planGenericMoveAnimations()`
 * unless tests or a future milestone inject an explicit registry entry.
 */
export const createMoveAnimationPlanner = ({
  overrideRegistry = MOVE_ANIMATION_OVERRIDE_REGISTRY,
  fallbackPlanner = planGenericMoveAnimations,
  logPlanningWarnings = isMoveAnimationPlannerDevelopmentEnvironment(),
}: CreateMoveAnimationPlannerOptions = {}): MoveAnimationPlanner => (input) => {
  const canonicalMoveName = canonicalMoveAnimationOverrideKey(input.script?.moveName)
  const override = overrideRegistry[canonicalMoveName]

  if (override && !override.disabled) {
    try {
      const overridePlan = override.preset.plan(input, {
        canonicalMoveName,
        fallbackPlanner,
      })

      if (overridePlan != null) return normalizePlannerOutput(input, overridePlan)
    } catch (error) {
      warnMoveAnimationPlannerFallback(logPlanningWarnings, `Move animation override '${canonicalMoveName}' failed`, error)
    }
  }

  try {
    return normalizePlannerOutput(input, fallbackPlanner(input))
  } catch (error) {
    warnMoveAnimationPlannerFallback(logPlanningWarnings, 'Generic move animation planner failed', error)
    return createNeutralPlannerFallback(input)
  }
}

/** Public planner entry point for move automation integration. */
export const planMoveAnimations: MoveAnimationPlanner = createMoveAnimationPlanner()
