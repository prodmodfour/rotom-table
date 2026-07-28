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
import { COMBAT_STAGE_KEYS } from '~/utils/combatStages'
import {
  MOVE_ANIMATION_TARGET_SEQUENCE_ORDER,
  applyMoveAnimationTargetStartOffsets,
  createMoveAnimationTargetStartOffsets,
} from '~/utils/moveAnimationSequencing'

/** Resolution flows that can request generic move VFX plans. */
export const MOVE_ANIMATION_PLAN_RESOLUTION = {
  self: 'self',
  singleTarget: 'single-target',
  multiTarget: 'multi-target',
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
  /** Optional delay hint for semantic transaction follow-ups once result/damage feedback is visually resolved. */
  readonly semanticDelayMs?: number
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

/** Planner input for explicit multi-target-count resolutions that selected target tokens directly. */
export interface MoveAnimationMultiTargetPlanInput
  extends MoveAnimationPlanInputBase<typeof MOVE_ANIMATION_PLAN_RESOLUTION.multiTarget> {}

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
  | MoveAnimationMultiTargetPlanInput
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
  /** Optional development-only one-shot summary logs for move VFX planning decisions. */
  readonly logPlanningDebug?: boolean
}

type GenericMoveSemanticIntent =
  | { readonly kind: 'healing'; readonly tone: typeof MOVE_VFX_TONE.healing }
  | { readonly kind: 'status'; readonly tone: typeof MOVE_VFX_TONE.status }
  | { readonly kind: 'buff-debuff'; readonly tone: typeof MOVE_VFX_TONE.buff | typeof MOVE_VFX_TONE.debuff; readonly direction: 'buff' | 'debuff' }
  | { readonly kind: 'neutral'; readonly tone: typeof MOVE_VFX_TONE.neutral }

type PlannerEventIdFactory = (kind: MoveVfxKind, targetId?: string) => string

interface MoveAnimationPlannerProcessEnvironment {
  readonly dev?: unknown
  readonly env?: {
    readonly NODE_ENV?: unknown
  }
}

export const MOVE_ANIMATION_PLANNING_DEBUG_QUERY_KEY = 'debug'

export const MOVE_ANIMATION_PLANNING_DEBUG_QUERY_VALUES = [
  'move-vfx-planning',
  'move-vfx-plan',
  'vfx-planning',
  'vfx-plan',
] as const

export type MoveAnimationPlanningDebugQueryValue = typeof MOVE_ANIMATION_PLANNING_DEBUG_QUERY_VALUES[number]

export type MoveAnimationPlanningDebugQuerySource =
  | string
  | URLSearchParams
  | Record<string, unknown>
  | null
  | undefined

export interface MoveAnimationPlanningDebugLocationLike {
  readonly search?: string | null
}

export interface MoveAnimationPlanningDebugFlagOptions {
  /** Explicit query source, such as Nuxt route.query or window.location.search. */
  readonly query?: MoveAnimationPlanningDebugQuerySource
  /** Injectable client location for callers that do not already have route query state. */
  readonly location?: MoveAnimationPlanningDebugLocationLike | null
  /** Injectable environment gate for tests and SSR-safe callers. Defaults to the Vite/Nuxt dev flag. */
  readonly isDev?: boolean
  /** Keep planning logs dev-safe by default; opt in only for explicit local diagnostics. */
  readonly allowProduction?: boolean
}

const UNKNOWN_MOVE_ANIMATION_MOVE_NAME = 'Unknown Move'
const UNKNOWN_MOVE_ANIMATION_USER_ID = 'unknown-user'
const AREA_TARGET_FOLLOW_UP_BASE_OFFSET_MS = 140
const AREA_PASS_DASH_IMPACT_OFFSET_MS = 100
const AREA_PASS_DASH_TARGET_FOLLOW_UP_BASE_OFFSET_MS = 220
const TARGET_ROLL_VFX_DURATION_MS = 650
const TARGET_DAMAGE_CALLOUT_OFFSET_MS = MOVE_VFX_DEFAULT_DURATIONS_MS.quick + 20
const TRANSACTION_SEMANTIC_AFTER_IMPACT_OFFSET_MS = 100
const TRANSACTION_SEMANTIC_SAME_TOKEN_STEP_MS = 70
const TRANSACTION_MAP_CONFIRMATION_SAME_STEP_MS = 70
const MAX_TRANSACTION_SEMANTIC_EVENTS = 12
const MAX_TRANSACTION_HAZARD_CONFIRMATION_CELLS = 24
const FIELD_EFFECT_CONFIRMATION_KINDS = new Set<string>(['weather', 'terrain', 'room'])
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

const gridAnchorKey = (anchor: GridAnchor): string => `${anchor.x}:${anchor.y}:${anchor.z}`

const uniqueGridAnchors = (anchors: readonly GridAnchor[]): GridAnchor[] => {
  const seen = new Set<string>()
  const out: GridAnchor[] = []

  for (const anchor of anchors) {
    const key = gridAnchorKey(anchor)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(anchor)
  }

  return out
}

const finiteNumberOrZero = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : 0
)

const finiteNumberOrUndefined = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
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
    semanticDelayMs: finiteNumberOrUndefined(timing.semanticDelayMs),
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

const addStartOffsetToEvents = <T extends MoveAnimationEvent>(
  events: readonly T[],
  offsetMs: number,
): T[] => {
  if (!Number.isFinite(offsetMs) || offsetMs <= 0) return [...events]

  return events.map((event) => ({
    ...event,
    startOffsetMs: (finiteNumberOrZero(event.startOffsetMs) + offsetMs),
  }) as T)
}

const scriptRequiresTargetAccuracyRollVfx = (script: MoveAnimationPlanScript): boolean => script.requiresAccuracy === true

const targetAccuracyRollOutcomeOffsetMs = (script: MoveAnimationPlanScript): number => (
  scriptRequiresTargetAccuracyRollVfx(script) ? TARGET_ROLL_VFX_DURATION_MS : 0
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
  const processDebug = globalThis.process as MoveAnimationPlannerProcessEnvironment | undefined

  return (
    import.meta.dev
    || import.meta.env.DEV
    || import.meta.env.MODE === 'development'
    || processDebug?.dev === true
    || processDebug?.env?.NODE_ENV === 'development'
  )
}

const MOVE_ANIMATION_PLANNING_DEBUG_TOKEN_SEPARATOR = /[\s,]+/
const MOVE_ANIMATION_PLANNING_DEBUG_QUERY_KEYS = new Set([
  MOVE_ANIMATION_PLANNING_DEBUG_QUERY_KEY,
  `${MOVE_ANIMATION_PLANNING_DEBUG_QUERY_KEY}[]`,
])
const MOVE_ANIMATION_PLANNING_DEBUG_QUERY_VALUE_SET = new Set<string>(MOVE_ANIMATION_PLANNING_DEBUG_QUERY_VALUES)

const normalizeMoveAnimationPlanningDebugToken = (value: string): string => value.trim().toLowerCase()

const splitMoveAnimationPlanningDebugTokens = (value: string): string[] => (
  value
    .split(MOVE_ANIMATION_PLANNING_DEBUG_TOKEN_SEPARATOR)
    .map(normalizeMoveAnimationPlanningDebugToken)
    .filter(Boolean)
)

const appendMoveAnimationPlanningDebugStringValues = (values: string[], value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) appendMoveAnimationPlanningDebugStringValues(values, item)
    return
  }

  if (typeof value === 'string') values.push(value)
}

const moveAnimationPlanningDebugQueryStringToSearchParams = (query: string): URLSearchParams => {
  const trimmed = query.trim()
  const withoutHash = trimmed.includes('#') ? trimmed.slice(0, trimmed.indexOf('#')) : trimmed
  const queryStartIndex = withoutHash.indexOf('?')
  const search = queryStartIndex >= 0 ? withoutHash.slice(queryStartIndex + 1) : withoutHash.replace(/^\?/, '')

  return new URLSearchParams(search)
}

const collectMoveAnimationPlanningDebugQueryValues = (query: MoveAnimationPlanningDebugQuerySource): string[] => {
  if (!query) return []

  if (typeof query === 'string') {
    return collectMoveAnimationPlanningDebugQueryValues(moveAnimationPlanningDebugQueryStringToSearchParams(query))
  }

  const values: string[] = []

  if (query instanceof URLSearchParams) {
    for (const key of MOVE_ANIMATION_PLANNING_DEBUG_QUERY_KEYS) values.push(...query.getAll(key))
    return values
  }

  for (const [key, value] of Object.entries(query)) {
    if (MOVE_ANIMATION_PLANNING_DEBUG_QUERY_KEYS.has(key)) appendMoveAnimationPlanningDebugStringValues(values, value)
  }

  return values
}

const readGlobalMoveAnimationPlanningDebugLocationSearch = (): string => {
  const location = globalThis.location as MoveAnimationPlanningDebugLocationLike | undefined

  return typeof location?.search === 'string' ? location.search : ''
}

export const hasMoveAnimationPlanningDebugQueryFlag = (
  query: MoveAnimationPlanningDebugQuerySource,
): boolean => (
  collectMoveAnimationPlanningDebugQueryValues(query).some((value) => (
    splitMoveAnimationPlanningDebugTokens(value).some((token) => MOVE_ANIMATION_PLANNING_DEBUG_QUERY_VALUE_SET.has(token))
  ))
)

/**
 * Client-safe gate for one-shot move VFX planning diagnostics. It requires an
 * explicit query flag and is dev-only by default so production players cannot
 * accidentally enable move-name or planning-branch console output.
 */
export const isMoveAnimationPlanningDebugEnabled = ({
  query,
  location,
  isDev = isMoveAnimationPlannerDevelopmentEnvironment(),
  allowProduction = false,
}: MoveAnimationPlanningDebugFlagOptions = {}): boolean => {
  const requested = hasMoveAnimationPlanningDebugQueryFlag(
    query ?? location?.search ?? readGlobalMoveAnimationPlanningDebugLocationSearch(),
  )

  if (!requested) return false

  return allowProduction || isDev
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

type MoveAnimationTargetedPlanInput = MoveAnimationSingleTargetPlanInput | MoveAnimationMultiTargetPlanInput

const targetOutcomeForId = (
  input: MoveAnimationTargetedPlanInput,
  targetId: string | undefined,
): MoveAnimationPlanTargetOutcome | null => {
  const explicitOutcome = explicitTargetOutcomeForId(input, targetId)
  if (explicitOutcome) return explicitOutcome

  const feedbackOutcome = input.resolution === MOVE_ANIMATION_PLAN_RESOLUTION.singleTarget
    ? feedbackToTargetOutcome(input.feedback)
    : null
  if (feedbackOutcome && (!targetId || feedbackOutcome.targetId === targetId)) return feedbackOutcome

  return null
}

const selectedMultiTargetIdsForInput = (input: MoveAnimationMultiTargetPlanInput): string[] => {
  const selectedTargetIds = uniquePlannerTargetIds(stringArrayOrEmpty(input.selectedTargetIds))
  if (selectedTargetIds.length > 0) return selectedTargetIds

  return uniquePlannerTargetIds([
    ...arrayOrEmpty(input.targetOutcomes).map((outcome) => outcome.targetId),
    ...arrayOrEmpty(input.targets).map((target) => target.id),
  ])
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

const damageClassForScript = (script: MoveAnimationPlanScript): string => (
  stringOrUndefined(script.damageClass)?.trim().toLowerCase() ?? ''
)

const rangedLaunchKindForScript = (script: MoveAnimationPlanScript):
  | typeof MOVE_VFX_KIND.projectile
  | typeof MOVE_VFX_KIND.beam
  | typeof MOVE_VFX_KIND.arc => {
  const classificationText = moveClassificationText(script)

  if (includesNormalizedWord(classificationText, [
    'arc',
    'lob',
    'lobbed',
    'thrown',
    'throw',
    'toss',
    'shot',
    'seed',
    'spore',
    'powder',
    'bomb',
    'rock',
    'stone',
    'sludge',
    'gunk',
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
    'aura',
    'sonic',
    'stream',
    'fountain',
    'threaded',
    'whip',
  ])) {
    return MOVE_VFX_KIND.beam
  }

  if (damageClassForScript(script) === 'special') {
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

  return templateKinds.some((kind) => kind === 'burst' || kind.endsWith('blast') || kind === 'cardinally-adjacent')
    || includesNormalizedWord(classificationText, ['burst', 'blast', 'cardinally', 'adjacent'])
}

type TransactionSemanticEventKind =
  | typeof MOVE_VFX_KIND.healing
  | typeof MOVE_VFX_KIND.buffDebuff
  | typeof MOVE_VFX_KIND.status

type MoveAnimationPlanHpUpdate = MoveAnimationPlanTransaction['hpUpdates'][number]
type MoveAnimationPlanConditionUpdate = MoveAnimationPlanTransaction['conditionUpdates'][number]
type MoveAnimationPlanCombatStageUpdate = MoveAnimationPlanTransaction['combatStageUpdates'][number]
type MoveAnimationPlanHazardAdd = MoveAnimationPlanTransaction['hazardsToAdd'][number]
type MoveAnimationPlanFieldEffectApply = MoveAnimationPlanTransaction['fieldEffectsToApply'][number]

interface TransactionSemanticAnimationDraft {
  readonly targetId: string
  readonly targetCell?: GridAnchor
  readonly kind: TransactionSemanticEventKind
  readonly conditionNames?: readonly string[]
  readonly direction?: 'buff' | 'debuff'
  readonly priority: number
  readonly targetOrder: number
}

interface PlanTransactionSemanticAnimationOptions {
  /** Candidate ids whose transaction updates are allowed to produce semantic VFX. */
  readonly targetIds: readonly string[]
  /** Base start offset for the first semantic event before same-token cascading or target staggering. */
  readonly startOffsetMs?: number
  /** Optional source cell used to stagger multi-target semantic follow-ups from near to far. */
  readonly staggerOrigin?: GridAnchor
}

interface PlanTransactionMapConfirmationOptions {
  /** Base start offset for field/hazard confirmation pulses. */
  readonly startOffsetMs?: number
}

const uniqueNonEmptyStrings = (values: readonly unknown[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []

  for (const value of values) {
    const item = nonEmptyStringOrUndefined(value)
    if (!item) continue
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }

  return out
}

const semanticComparisonKey = (value: unknown): string => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, ' ')

const uniquePlannerTargetIds = (targetIds: readonly unknown[]): string[] => uniqueNonEmptyStrings(targetIds)

const tokenForId = (
  input: MoveAnimationPlanInput,
  targetId: string | undefined,
): MoveAnimationPlanToken | undefined => {
  if (!targetId) return undefined

  const user = userTokenForInput(input)
  if (user?.id === targetId) return user

  return arrayOrEmpty(input.targets).find((target) => target.id === targetId)
}

const targetCellForId = (input: MoveAnimationPlanInput, targetId: string): GridAnchor | undefined => (
  positionForToken(tokenForId(input, targetId))
)

const hpDeltaForTransactionUpdate = (
  input: MoveAnimationPlanInput,
  update: MoveAnimationPlanHpUpdate,
): number | null => {
  const targetId = nonEmptyStringOrUndefined(update.id)
  if (!targetId) return null

  const token = tokenForId(input, targetId)
  if (!token) return null

  const beforeHp = token.currentHp + finiteNumberOrZero(token.temporaryHp)
  const afterHp = update.currentHp + finiteNumberOrZero(update.temporaryHp ?? token.temporaryHp)
  if (!Number.isFinite(beforeHp) || !Number.isFinite(afterHp)) return null

  return afterHp - beforeHp
}

const stageDirectionForTransactionUpdate = (
  input: MoveAnimationPlanInput,
  update: MoveAnimationPlanCombatStageUpdate,
): 'buff' | 'debuff' | null => {
  const targetId = nonEmptyStringOrUndefined(update.id)
  if (!targetId) return null

  const token = tokenForId(input, targetId)
  let positiveMagnitude = 0
  let negativeMagnitude = 0

  for (const key of COMBAT_STAGE_KEYS) {
    const after = finiteNumberOrZero(update.stages?.[key])
    const before = token ? finiteNumberOrZero(token.combatStages?.[key]) : 0
    const delta = after - before
    if (delta > 0) positiveMagnitude += delta
    else if (delta < 0) negativeMagnitude += Math.abs(delta)
  }

  if (positiveMagnitude <= 0 && negativeMagnitude <= 0) return null
  return positiveMagnitude >= negativeMagnitude ? 'buff' : 'debuff'
}

const changedConditionNamesForTransactionUpdate = (
  input: MoveAnimationPlanInput,
  update: MoveAnimationPlanConditionUpdate,
): readonly string[] => {
  const targetId = nonEmptyStringOrUndefined(update.id)
  if (!targetId) return []

  const nextConditions = uniqueNonEmptyStrings(update.conditions)
  const token = tokenForId(input, targetId)
  if (!token) return nextConditions

  const previousConditions = uniqueNonEmptyStrings(token.conditions)
  const previousKeys = new Set(previousConditions.map(semanticComparisonKey))
  const nextKeys = new Set(nextConditions.map(semanticComparisonKey))
  const addedConditions = nextConditions.filter((condition) => !previousKeys.has(semanticComparisonKey(condition)))
  if (addedConditions.length > 0) return addedConditions

  const removedConditions = previousConditions.filter((condition) => !nextKeys.has(semanticComparisonKey(condition)))
  if (removedConditions.length > 0) return removedConditions

  return []
}

const addTransactionSemanticDraft = (
  draftsByTargetId: Map<string, TransactionSemanticAnimationDraft[]>,
  draft: TransactionSemanticAnimationDraft,
): void => {
  const existingDrafts = draftsByTargetId.get(draft.targetId) ?? []
  const existingIndex = existingDrafts.findIndex((item) => item.kind === draft.kind)

  if (existingIndex === -1) {
    draftsByTargetId.set(draft.targetId, [...existingDrafts, draft])
    return
  }

  const existing = existingDrafts[existingIndex]
  if (!existing || draft.kind !== MOVE_VFX_KIND.status) return

  const merged: TransactionSemanticAnimationDraft = {
    ...existing,
    conditionNames: uniqueNonEmptyStrings([
      ...arrayOrEmpty(existing.conditionNames),
      ...arrayOrEmpty(draft.conditionNames),
    ]),
  }
  draftsByTargetId.set(draft.targetId, existingDrafts.map((item, index) => index === existingIndex ? merged : item))
}

const eventTargetId = (event: MoveAnimationEvent): string | undefined => {
  if (!('targetId' in event)) return undefined
  return nonEmptyStringOrUndefined(event.targetId)
}

const targetIdsWithEvents = (events: readonly MoveAnimationEvent[]): Set<string> => new Set(
  events
    .map(eventTargetId)
    .filter((targetId): targetId is string => Boolean(targetId)),
)

const hasTransactionSemanticUpdateForTarget = (
  input: MoveAnimationPlanInput,
  targetId: string,
): boolean => {
  const transaction = input.transaction
  if (!transaction) return false

  return arrayOrEmpty(transaction.hpUpdates).some((update) => update.id === targetId && (hpDeltaForTransactionUpdate(input, update) ?? 0) > 0)
    || arrayOrEmpty(transaction.combatStageUpdates).some((update) => update.id === targetId && Boolean(stageDirectionForTransactionUpdate(input, update)))
    || arrayOrEmpty(transaction.conditionUpdates).some((update) => update.id === targetId && changedConditionNamesForTransactionUpdate(input, update).length > 0)
}

const planTransactionSemanticAnimations = (
  input: MoveAnimationPlanInput,
  nextId: PlannerEventIdFactory,
  options: PlanTransactionSemanticAnimationOptions,
): MoveAnimationEvent[] => {
  const transaction = input.transaction
  if (!transaction) return []

  const allowedTargetIds = uniquePlannerTargetIds(options.targetIds)
  if (allowedTargetIds.length === 0) return []

  const targetOrderById = new Map(allowedTargetIds.map((targetId, index) => [targetId, index]))
  const draftsByTargetId = new Map<string, TransactionSemanticAnimationDraft[]>()

  const addDraft = (
    targetId: string | undefined,
    draft: Omit<TransactionSemanticAnimationDraft, 'targetId' | 'targetCell' | 'targetOrder'>,
  ): void => {
    const normalizedTargetId = nonEmptyStringOrUndefined(targetId)
    if (!normalizedTargetId || !targetOrderById.has(normalizedTargetId)) return

    addTransactionSemanticDraft(draftsByTargetId, {
      ...draft,
      targetId: normalizedTargetId,
      targetCell: targetCellForId(input, normalizedTargetId),
      targetOrder: targetOrderById.get(normalizedTargetId) ?? targetOrderById.size,
    })
  }

  for (const update of arrayOrEmpty(transaction.hpUpdates)) {
    const delta = hpDeltaForTransactionUpdate(input, update)
    if (delta == null || delta <= 0) continue

    addDraft(update.id, {
      kind: MOVE_VFX_KIND.healing,
      priority: 0,
    })
  }

  for (const update of arrayOrEmpty(transaction.combatStageUpdates)) {
    const direction = stageDirectionForTransactionUpdate(input, update)
    if (!direction) continue

    addDraft(update.id, {
      kind: MOVE_VFX_KIND.buffDebuff,
      direction,
      priority: direction === 'buff' ? 1 : 2,
    })
  }

  for (const update of arrayOrEmpty(transaction.conditionUpdates)) {
    const conditionNames = changedConditionNamesForTransactionUpdate(input, update)
    if (conditionNames.length === 0) continue

    addDraft(update.id, {
      kind: MOVE_VFX_KIND.status,
      conditionNames,
      priority: 3,
    })
  }

  const drafts = Array.from(draftsByTargetId.values())
    .flatMap((targetDrafts) => targetDrafts)
    .sort((left, right) => (
      left.targetOrder - right.targetOrder
      || left.priority - right.priority
      || left.kind.localeCompare(right.kind)
    ))
    .slice(0, MAX_TRANSACTION_SEMANTIC_EVENTS)

  if (drafts.length === 0) return []

  const baseStartOffsetMs = Math.max(0, finiteNumberOrZero(options.startOffsetMs))
  const eventCountByTargetId = new Map<string, number>()
  const events = drafts.map((draft): MoveAnimationEvent => {
    const sameTokenIndex = eventCountByTargetId.get(draft.targetId) ?? 0
    eventCountByTargetId.set(draft.targetId, sameTokenIndex + 1)
    const startOffset = baseStartOffsetMs + (sameTokenIndex * TRANSACTION_SEMANTIC_SAME_TOKEN_STEP_MS)
    const baseMetadata = {
      targetId: draft.targetId,
      targetCell: draft.targetCell,
      ...startOffsetMetadata(startOffset),
    }

    if (draft.kind === MOVE_VFX_KIND.healing) {
      return createPlannerEvent(input, nextId, MOVE_VFX_KIND.healing, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, baseMetadata, moveVfxColorForTone(MOVE_VFX_TONE.healing))
    }

    if (draft.kind === MOVE_VFX_KIND.buffDebuff) {
      const direction = draft.direction ?? 'buff'
      return createPlannerEvent(input, nextId, MOVE_VFX_KIND.buffDebuff, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
        ...baseMetadata,
        tone: direction,
        direction,
      }, moveVfxColorForTone(direction === 'buff' ? MOVE_VFX_TONE.buff : MOVE_VFX_TONE.debuff))
    }

    return createPlannerEvent(input, nextId, MOVE_VFX_KIND.status, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      ...baseMetadata,
      ...(draft.conditionNames?.length ? { conditionNames: draft.conditionNames } : {}),
    }, moveVfxColorForTone(MOVE_VFX_TONE.status))
  })

  if (!options.staggerOrigin) return events

  const offsets = createMoveAnimationTargetStartOffsets(
    uniquePlannerTargetIds(events.map(eventTargetId)).map((targetId) => ({
      targetId,
      position: targetCellForId(input, targetId),
    })),
    {
      order: MOVE_ANIMATION_TARGET_SEQUENCE_ORDER.distanceFromOrigin,
      origin: options.staggerOrigin,
    },
  )

  return [...applyMoveAnimationTargetStartOffsets(events, offsets, { mode: 'add' })]
}

const transactionFieldEffectCanConfirm = (effect: MoveAnimationPlanFieldEffectApply | unknown): boolean => {
  if (!isRecord(effect)) return false

  const kind = stringOrUndefined(effect.kind)
  return Boolean(
    kind
    && FIELD_EFFECT_CONFIRMATION_KINDS.has(kind)
    && nonEmptyStringOrUndefined(effect.value)
  )
}

const transactionHazardCanConfirm = (hazard: MoveAnimationPlanHazardAdd | unknown): boolean => (
  isRecord(hazard) && Boolean(nonEmptyStringOrUndefined(hazard.kind))
)

const hasTransactionFieldEffectConfirmations = (transaction: MoveAnimationPlanTransaction): boolean => (
  arrayOrEmpty(transaction.fieldEffectsToApply).some(transactionFieldEffectCanConfirm)
)

const hasTransactionHazardConfirmations = (transaction: MoveAnimationPlanTransaction): boolean => (
  arrayOrEmpty(transaction.hazardsToAdd).some(transactionHazardCanConfirm)
)

const hazardConfirmationCellsForTransaction = (transaction: MoveAnimationPlanTransaction): GridAnchor[] => uniqueGridAnchors(
  arrayOrEmpty(transaction.hazardsToAdd)
    .map((hazard) => gridAnchorOrUndefined(hazard))
    .filter((cell): cell is GridAnchor => Boolean(cell)),
).slice(0, MAX_TRANSACTION_HAZARD_CONFIRMATION_CELLS)

const createTransactionMapConfirmationSelfPulse = (
  input: MoveAnimationPlanInput,
  nextId: PlannerEventIdFactory,
  startOffsetMs: number,
): MoveAnimationEvent => {
  const user = userTokenForInput(input)

  return createPlannerEvent(input, nextId, MOVE_VFX_KIND.selfPulse, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
    originCell: positionForToken(user),
    tone: MOVE_VFX_TONE.status,
    ...startOffsetMetadata(startOffsetMs),
  }, moveVfxColorForTone(MOVE_VFX_TONE.status))
}

const planTransactionMapConfirmationAnimations = (
  input: MoveAnimationPlanInput,
  nextId: PlannerEventIdFactory,
  options: PlanTransactionMapConfirmationOptions = {},
): MoveAnimationEvent[] => {
  const transaction = input.transaction
  if (!transaction) return []
  if (!userTokenForInput(input)) return []

  const hasFieldConfirmations = hasTransactionFieldEffectConfirmations(transaction)
  const hasHazardConfirmations = hasTransactionHazardConfirmations(transaction)
  if (!hasFieldConfirmations && !hasHazardConfirmations) return []

  const palette = moveVfxColorForTone(MOVE_VFX_TONE.status)
  const userCell = positionForToken(userTokenForInput(input))
  const baseStartOffsetMs = Math.max(0, finiteNumberOrZero(options.startOffsetMs))
  const events: MoveAnimationEvent[] = []

  if (hasFieldConfirmations) {
    events.push(createTransactionMapConfirmationSelfPulse(input, nextId, baseStartOffsetMs))
  }

  const hazardCells = hazardConfirmationCellsForTransaction(transaction)
  if (hazardCells.length > 0) {
    const startOffsetMs = baseStartOffsetMs + (events.length > 0 ? TRANSACTION_MAP_CONFIRMATION_SAME_STEP_MS : 0)
    events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.areaPulse, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
      areaCells: hazardCells,
      areaOrigin: userCell,
      ...startOffsetMetadata(startOffsetMs),
    }, palette))
  } else if (hasHazardConfirmations && events.length === 0) {
    events.push(createTransactionMapConfirmationSelfPulse(input, nextId, baseStartOffsetMs))
  }

  return events
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
  const transactionSemanticEvents = planTransactionSemanticAnimations(input, nextId, {
    targetIds: targetId ? [targetId] : [],
  })
  const transactionMapConfirmationEvents = planTransactionMapConfirmationAnimations(input, nextId, {
    startOffsetMs: transactionSemanticEvents.length > 0 ? TRANSACTION_MAP_CONFIRMATION_SAME_STEP_MS : 0,
  })
  if (transactionSemanticEvents.length > 0 || transactionMapConfirmationEvents.length > 0) {
    return [...transactionSemanticEvents, ...transactionMapConfirmationEvents]
  }

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
  input: MoveAnimationTargetedPlanInput,
  nextId: PlannerEventIdFactory,
  targetId: string,
): MoveAnimationEvent[] => {
  const target = targetForId(input, targetId)
  const targetCell = positionForToken(target)
  const semanticIntent = semanticIntentForScript(input.script, 'target')
  const palette = paletteForSemanticIntent(semanticIntent)
  const timing = timingForInput(input)
  const semanticStartOffset = startOffsetMetadata(timing.semanticDelayMs ?? timing.impactDelayMs)

  if (semanticIntent.kind === 'healing') {
    return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.healing, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      targetId,
      targetCell,
      ...semanticStartOffset,
    }, palette)]
  }

  if (semanticIntent.kind === 'buff-debuff') {
    return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.buffDebuff, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      targetId,
      targetCell,
      tone: semanticIntent.direction,
      direction: semanticIntent.direction,
      ...semanticStartOffset,
    }, palette)]
  }

  if (semanticIntent.kind === 'status') {
    const conditionNames = conditionSuggestionNamesForScript(input.script, 'target')
    return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.status, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      targetId,
      targetCell,
      ...(conditionNames.length ? { conditionNames } : {}),
      ...semanticStartOffset,
    }, palette)]
  }

  return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.targetFlash, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
    targetId,
    targetCell,
    ...semanticStartOffset,
  }, palette)]
}

const planTargetAccuracyRollAnimation = (
  input: MoveAnimationPlanInput,
  nextId: PlannerEventIdFactory,
  options: {
    readonly targetId: string
    readonly targetCell?: GridAnchor
    readonly palette: MoveVfxPaletteEntry
    readonly startOffsetMs?: number
  },
): MoveAnimationEvent[] => {
  if (!scriptRequiresTargetAccuracyRollVfx(input.script)) return []

  return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.roll, TARGET_ROLL_VFX_DURATION_MS, {
    targetId: options.targetId,
    targetCell: options.targetCell,
    ...startOffsetMetadata(options.startOffsetMs),
  }, options.palette)]
}

const planDamagingTargetAnimationEvents = (options: {
  readonly input: MoveAnimationTargetedPlanInput
  readonly nextId: PlannerEventIdFactory
  readonly userCell?: GridAnchor
  readonly targetId: string
  readonly targetCell?: GridAnchor
  readonly hit: boolean
  readonly crit: boolean
  readonly palette: MoveVfxPaletteEntry
  readonly launchStartOffset?: { readonly startOffsetMs?: number }
  readonly impactStartOffset?: { readonly startOffsetMs?: number }
}): MoveAnimationEvent[] => {
  const events: MoveAnimationEvent[] = []

  if (isMeleeDamagingMove(options.input.script)) {
    events.push(createPlannerEvent(options.input, options.nextId, MOVE_VFX_KIND.meleeLunge, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      originCell: options.userCell,
      targetId: options.targetId,
      targetCell: options.targetCell,
      ...(options.launchStartOffset ?? {}),
    }, options.palette))
  } else {
    const launchKind = rangedLaunchKindForScript(options.input.script)
    events.push(createPlannerEvent(options.input, options.nextId, launchKind, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      originCell: options.userCell,
      targetId: options.targetId,
      targetCell: options.targetCell,
      ...(options.launchStartOffset ?? {}),
    }, options.palette))
  }

  if (!options.hit) {
    events.push(createPlannerEvent(options.input, options.nextId, MOVE_VFX_KIND.miss, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
      targetId: options.targetId,
      targetCell: options.targetCell,
      ...(options.impactStartOffset ?? {}),
    }, moveVfxColorForTone(MOVE_VFX_TONE.miss)))
    return events
  }

  events.push(createPlannerEvent(options.input, options.nextId, MOVE_VFX_KIND.targetFlash, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
    targetId: options.targetId,
    targetCell: options.targetCell,
    shake: true,
    ...(options.impactStartOffset ?? {}),
  }, options.palette))

  if (options.crit) {
    events.push(createPlannerEvent(options.input, options.nextId, MOVE_VFX_KIND.crit, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
      targetId: options.targetId,
      targetCell: options.targetCell,
      ...(options.impactStartOffset ?? {}),
    }, options.palette))
  }

  return events
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
  const semanticTargetIds = uniquePlannerTargetIds([user.id, targetId])
  const semanticStartOffsetMs = timing.semanticDelayMs ?? (timing.impactDelayMs ?? 0)

  if (!scriptHasDamageVisual(input.script)) {
    const transactionSemanticEvents = planTransactionSemanticAnimations(input, nextId, {
      targetIds: semanticTargetIds,
      startOffsetMs: semanticStartOffsetMs,
    })
    const transactionMapConfirmationEvents = planTransactionMapConfirmationAnimations(input, nextId, {
      startOffsetMs: semanticStartOffsetMs,
    })

    if (!hit) {
      return [
        createPlannerEvent(input, nextId, MOVE_VFX_KIND.miss, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
          targetId,
          targetCell,
          ...impactStartOffset,
        }, moveVfxColorForTone(MOVE_VFX_TONE.miss)),
        ...transactionSemanticEvents,
        ...transactionMapConfirmationEvents,
      ]
    }

    if (transactionSemanticEvents.length > 0 || transactionMapConfirmationEvents.length > 0) {
      return [...transactionSemanticEvents, ...transactionMapConfirmationEvents]
    }

    return planTargetSemanticAnimations(input, nextId, targetId)
  }

  const palette = damagingPaletteForScript(input.script)
  const transactionFollowUpStartOffsetMs = timing.semanticDelayMs
    ?? ((timing.impactDelayMs ?? 0) + TRANSACTION_SEMANTIC_AFTER_IMPACT_OFFSET_MS)
  const transactionSemanticEvents = planTransactionSemanticAnimations(input, nextId, {
    targetIds: semanticTargetIds,
    startOffsetMs: transactionFollowUpStartOffsetMs,
  })
  const transactionMapConfirmationEvents = planTransactionMapConfirmationAnimations(input, nextId, {
    startOffsetMs: transactionFollowUpStartOffsetMs,
  })
  const events = planDamagingTargetAnimationEvents({
    input,
    nextId,
    userCell,
    targetId,
    targetCell,
    hit,
    crit,
    palette,
    launchStartOffset,
    impactStartOffset,
  })

  return [...events, ...transactionSemanticEvents, ...transactionMapConfirmationEvents]
}

const planMultiTargetMoveAnimations = (
  input: MoveAnimationMultiTargetPlanInput,
  nextId: PlannerEventIdFactory,
): MoveAnimationEvent[] => {
  const user = userTokenForInput(input)
  if (!user) return []

  const userCell = positionForToken(user)
  const targetIds = selectedMultiTargetIdsForInput(input)
  if (targetIds.length === 0) {
    return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.selfPulse, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      originCell: userCell,
    }, moveVfxColorForTone(MOVE_VFX_TONE.neutral))]
  }

  const timing = timingForInput(input)
  const targetOffsets = createMoveAnimationTargetStartOffsets(
    targetIds.map((targetId) => ({
      targetId,
      position: positionForToken(targetForId(input, targetId)),
    })),
    {
      order: MOVE_ANIMATION_TARGET_SEQUENCE_ORDER.distanceFromOrigin,
      origin: userCell,
    },
  )
  const targetOffsetById = new Map(targetOffsets.map((offset) => [offset.targetId, offset.startOffsetMs]))
  const targetStartOffsetMs = (targetId: string): number => targetOffsetById.get(targetId) ?? 0
  const rollOutcomeOffsetMs = targetAccuracyRollOutcomeOffsetMs(input.script)
  const impactOffsetForTarget = (targetId: string): { readonly startOffsetMs?: number } => startOffsetMetadata(
    (timing.impactDelayMs ?? 0) + targetStartOffsetMs(targetId) + rollOutcomeOffsetMs,
  )
  const semanticTargetIds = uniquePlannerTargetIds([user.id, ...targetIds])

  if (!scriptHasDamageVisual(input.script)) {
    const semanticStartOffsetMs = (timing.semanticDelayMs ?? (timing.impactDelayMs ?? 0)) + rollOutcomeOffsetMs
    const transactionSemanticEvents = planTransactionSemanticAnimations(input, nextId, {
      targetIds: semanticTargetIds,
      startOffsetMs: semanticStartOffsetMs,
      staggerOrigin: userCell,
    })
    const transactionSemanticTargetIds = targetIdsWithEvents(transactionSemanticEvents)
    const targetEvents = targetIds.flatMap((targetId): MoveAnimationEvent[] => {
      const target = targetForId(input, targetId)
      const targetCell = positionForToken(target)
      const outcome = targetOutcomeForId(input, targetId)
      const hit = outcome?.hit ?? true
      const targetPalette = paletteForSemanticIntent(semanticIntentForScript(input.script))
      const rollEvents = planTargetAccuracyRollAnimation(input, nextId, {
        targetId,
        targetCell,
        palette: targetPalette,
      })
      const calloutEvents = scriptRequiresTargetAccuracyRollVfx(input.script)
        ? planTargetOutcomeCalloutAnimations(input, nextId, {
          targetId,
          targetCell,
          hit,
          outcome,
          palette: targetPalette,
          outcomeStartOffsetMs: rollOutcomeOffsetMs,
        })
        : []

      if (!hit) {
        return [
          ...rollEvents,
          createPlannerEvent(input, nextId, MOVE_VFX_KIND.miss, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
            targetId,
            targetCell,
            ...startOffsetMetadata((timing.impactDelayMs ?? 0) + rollOutcomeOffsetMs),
          }, moveVfxColorForTone(MOVE_VFX_TONE.miss)),
          ...calloutEvents,
        ]
      }

      if (
        transactionSemanticEvents.length > 0
        || transactionSemanticTargetIds.has(targetId)
        || hasTransactionSemanticUpdateForTarget(input, targetId)
      ) return [...rollEvents, ...calloutEvents]
      return [
        ...rollEvents,
        ...addStartOffsetToEvents(planTargetSemanticAnimations(input, nextId, targetId), rollOutcomeOffsetMs),
        ...calloutEvents,
      ]
    })

    return [
      ...applyMoveAnimationTargetStartOffsets(targetEvents, targetOffsets, { mode: 'add' }),
      ...transactionSemanticEvents,
    ]
  }

  const palette = damagingPaletteForScript(input.script)
  const transactionFollowUpStartOffsetMs = timing.semanticDelayMs
    ?? ((timing.impactDelayMs ?? 0) + rollOutcomeOffsetMs + TRANSACTION_SEMANTIC_AFTER_IMPACT_OFFSET_MS)
  const transactionSemanticEvents = planTransactionSemanticAnimations(input, nextId, {
    targetIds: semanticTargetIds,
    startOffsetMs: transactionFollowUpStartOffsetMs,
    staggerOrigin: userCell,
  })

  const targetEvents = targetIds.flatMap((targetId): MoveAnimationEvent[] => {
    const target = targetForId(input, targetId)
    const targetCell = positionForToken(target)
    const outcome = targetOutcomeForId(input, targetId)
    const hit = outcome?.hit ?? true
    const crit = outcome?.crit ?? false
    const rollEvents = planTargetAccuracyRollAnimation(input, nextId, {
      targetId,
      targetCell,
      palette,
      startOffsetMs: (timing.baseDelayMs ?? 0) + targetStartOffsetMs(targetId),
    })
    const outcomeStartOffsetMs = (timing.impactDelayMs ?? 0) + targetStartOffsetMs(targetId) + rollOutcomeOffsetMs
    const calloutEvents = scriptRequiresTargetAccuracyRollVfx(input.script)
      ? planTargetOutcomeCalloutAnimations(input, nextId, {
        targetId,
        targetCell,
        hit,
        outcome,
        palette,
        outcomeStartOffsetMs,
      })
      : []

    return [
      ...rollEvents,
      ...planDamagingTargetAnimationEvents({
        input,
        nextId,
        userCell,
        targetId,
        targetCell,
        hit,
        crit,
        palette,
        launchStartOffset: startOffsetMetadata((timing.baseDelayMs ?? 0) + targetStartOffsetMs(targetId) + rollOutcomeOffsetMs),
        impactStartOffset: impactOffsetForTarget(targetId),
      }),
      ...calloutEvents,
    ]
  })

  return [...targetEvents, ...transactionSemanticEvents]
}

const planTargetOutcomeCalloutAnimations = (
  input: MoveAnimationPlanInput,
  nextId: PlannerEventIdFactory,
  options: {
    readonly targetId: string
    readonly targetCell?: GridAnchor
    readonly hit: boolean
    readonly outcome: MoveAnimationPlanTargetOutcome | null
    readonly palette: MoveVfxPaletteEntry
    readonly outcomeStartOffsetMs?: number
  },
): MoveAnimationEvent[] => {
  const outcomeStartOffsetMs = finiteNumberOrZero(options.outcomeStartOffsetMs)

  if (!options.hit) {
    return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.badge, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
      targetId: options.targetId,
      targetCell: options.targetCell,
      label: 'Miss',
      tone: MOVE_VFX_TONE.miss,
      ...startOffsetMetadata(outcomeStartOffsetMs),
    }, moveVfxColorForTone(MOVE_VFX_TONE.miss))]
  }

  const events: MoveAnimationEvent[] = [createPlannerEvent(input, nextId, MOVE_VFX_KIND.badge, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
    targetId: options.targetId,
    targetCell: options.targetCell,
    label: 'Hit',
    ...startOffsetMetadata(outcomeStartOffsetMs),
  }, options.palette)]

  if (options.outcome?.damageResolved) {
    events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.badge, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
      targetId: options.targetId,
      targetCell: options.targetCell,
      label: `${Math.max(0, Math.round(options.outcome.damageLoss ?? 0))} Damage`,
      startOffsetMs: outcomeStartOffsetMs + TARGET_DAMAGE_CALLOUT_OFFSET_MS,
    }, options.palette))
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
    readonly showOutcomeCallouts?: boolean
  },
): MoveAnimationEvent[] => {
  const targetIds = selectedAreaTargetIdsForInput(input)
  const rollOutcomeOffsetMs = targetAccuracyRollOutcomeOffsetMs(input.script)
  const transactionSemanticEvents = planTransactionSemanticAnimations(input, nextId, {
    targetIds: uniquePlannerTargetIds([userIdForInput(input), ...targetIds]),
    startOffsetMs: options.baseOffsetMs + rollOutcomeOffsetMs + (options.damaging ? TRANSACTION_SEMANTIC_AFTER_IMPACT_OFFSET_MS : 0),
    staggerOrigin: options.userCell,
  })
  const semanticTargetIds = targetIdsWithEvents(transactionSemanticEvents)

  if (targetIds.length === 0) return transactionSemanticEvents

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

  const targetEvents = targetIds.flatMap((targetId): MoveAnimationEvent[] => {
    const target = targetForId(input, targetId)
    const targetCell = positionForToken(target)
    const outcome = explicitTargetOutcomeForId(input, targetId)
    const hit = outcome?.hit ?? true
    const rollEvents = planTargetAccuracyRollAnimation(input, nextId, {
      targetId,
      targetCell,
      palette: options.palette,
    })
    const outcomeStartOffset = startOffsetMetadata(rollOutcomeOffsetMs)
    const calloutEvents = options.showOutcomeCallouts
      ? planTargetOutcomeCalloutAnimations(input, nextId, {
        targetId,
        targetCell,
        hit,
        outcome,
        palette: options.palette,
        outcomeStartOffsetMs: rollOutcomeOffsetMs,
      })
      : []

    if (!hit) {
      return [
        ...rollEvents,
        createPlannerEvent(input, nextId, MOVE_VFX_KIND.miss, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
          targetId,
          targetCell,
          ...outcomeStartOffset,
        }, moveVfxColorForTone(MOVE_VFX_TONE.miss)),
        ...calloutEvents,
      ]
    }

    if (!options.damaging && (semanticTargetIds.has(targetId) || hasTransactionSemanticUpdateForTarget(input, targetId))) {
      return [...rollEvents, ...calloutEvents]
    }

    return [
      ...rollEvents,
      createPlannerEvent(input, nextId, MOVE_VFX_KIND.targetFlash, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
        targetId,
        targetCell,
        ...(options.damaging ? { shake: true } : {}),
        ...outcomeStartOffset,
      }, options.palette),
      ...calloutEvents,
    ]
  })

  return [
    ...applyMoveAnimationTargetStartOffsets(targetEvents, offsets, { mode: 'add' }),
    ...transactionSemanticEvents,
  ]
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
  const transactionMapConfirmationEvents = planTransactionMapConfirmationAnimations(input, nextId, {
    startOffsetMs: areaCells.length > 0 || hasPassDestination
      ? areaTargetFollowUpBaseOffsetMs(input, hasPassDestination)
      : 0,
  })
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
      showOutcomeCallouts: hasPassDestination || scriptRequiresTargetAccuracyRollVfx(input.script),
    }))
  } else if (hasPassDestination) {
    events.push(...planAreaTargetFollowUpAnimations(input, nextId, {
      userCell,
      palette,
      damaging,
      baseOffsetMs: areaTargetFollowUpBaseOffsetMs(input, hasPassDestination),
      showOutcomeCallouts: true,
    }))
  }

  events.push(...transactionMapConfirmationEvents)

  if (events.length > 0) return events

  return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.selfPulse, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
    originCell: userCell,
  }, moveVfxColorForTone(MOVE_VFX_TONE.neutral))]
}

type MoveAnimationPlanningDebugSource = 'generic' | 'override' | 'safe-fallback'

interface MoveAnimationPlanningDebugSummary {
  readonly devOnly: true
  readonly moveName: string
  readonly resolution: string
  readonly scriptTargetMode: string | null
  readonly plannerSource: MoveAnimationPlanningDebugSource
  readonly selectedVfxKinds: readonly MoveVfxKind[]
  readonly eventCount: number
  readonly fallbackReasons: readonly string[]
}

const uniqueDebugStrings = (values: readonly string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []

  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }

  return out
}

const moveAnimationDebugEventKinds = (events: readonly MoveAnimationEvent[]): MoveVfxKind[] => (
  events.map((event) => event.kind)
)

const isNeutralSelfPulseFallback = (events: readonly MoveAnimationEvent[]): boolean => {
  const [event] = events
  return events.length === 1
    && event?.kind === MOVE_VFX_KIND.selfPulse
    && event.palette?.key === MOVE_VFX_TONE.neutral
}

const describeMoveAnimationPlanningFallbackReasons = (
  input: MoveAnimationPlanInput,
  events: readonly MoveAnimationEvent[],
  extraReasons: readonly string[] = [],
): string[] => {
  const reasons: string[] = [...extraReasons]

  if (!userTokenForInput(input)) {
    reasons.push('missing user/source token; no trustworthy VFX anchor')
  }

  switch (input.resolution) {
    case MOVE_ANIMATION_PLAN_RESOLUTION.singleTarget: {
      const targetId = firstKnownTargetId(input)
      if (!targetId) {
        reasons.push('single-target flow had no target id; used neutral self-pulse fallback when possible')
      } else if (!targetForId(input, targetId)) {
        reasons.push('target token snapshot missing; renderer will resolve or skip target-id-only VFX')
      }
      break
    }
    case MOVE_ANIMATION_PLAN_RESOLUTION.multiTarget: {
      const targetIds = selectedMultiTargetIdsForInput(input)
      if (targetIds.length === 0) {
        reasons.push('multi-target flow had no target ids; used neutral self-pulse fallback when possible')
      } else if (targetIds.some((targetId) => !targetForId(input, targetId))) {
        reasons.push('one or more target token snapshots missing; renderer will resolve or skip target-id-only VFX')
      }
      break
    }
    case MOVE_ANIMATION_PLAN_RESOLUTION.area: {
      const areaCells = gridAnchorsOrEmpty(input.areaCells)
      if (areaCells.length === 0 && !passDestinationForInput(input)) {
        reasons.push('area flow had no usable cells or pass destination; used transaction confirmation or neutral fallback')
      }
      break
    }
    case MOVE_ANIMATION_PLAN_RESOLUTION.self:
      break
    default:
      reasons.push('unknown planner resolution; used neutral fallback')
  }

  if (events.length === 0) {
    reasons.push('planner returned no renderer-ready VFX events')
  } else if (isNeutralSelfPulseFallback(events) && reasons.length === 0) {
    reasons.push('generic metadata did not select a specific effect; used neutral self-pulse fallback')
  }

  return uniqueDebugStrings(reasons)
}

const shouldLogMoveAnimationPlanningDebug = (enabled: boolean | undefined): boolean => (
  enabled ?? isMoveAnimationPlanningDebugEnabled()
)

const logMoveAnimationPlanningDebug = (
  enabled: boolean,
  input: MoveAnimationPlanInput,
  events: readonly MoveAnimationEvent[],
  plannerSource: MoveAnimationPlanningDebugSource,
  extraFallbackReasons: readonly string[] = [],
): void => {
  if (!enabled) return

  const summary: MoveAnimationPlanningDebugSummary = {
    devOnly: true,
    moveName: moveNameForInput(input),
    resolution: String(input.resolution),
    scriptTargetMode: nonEmptyStringOrUndefined(input.script?.targetMode) ?? null,
    plannerSource,
    selectedVfxKinds: moveAnimationDebugEventKinds(events),
    eventCount: events.length,
    fallbackReasons: describeMoveAnimationPlanningFallbackReasons(input, events, extraFallbackReasons),
  }

  console.info('[move-vfx:planner]', summary)
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
      case MOVE_ANIMATION_PLAN_RESOLUTION.multiTarget:
        return planMultiTargetMoveAnimations(input, nextId)
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
  logPlanningDebug,
}: CreateMoveAnimationPlannerOptions = {}): MoveAnimationPlanner => (input) => {
  const canonicalMoveName = canonicalMoveAnimationOverrideKey(input.script?.moveName)
  const override = overrideRegistry[canonicalMoveName]
  const debugLoggingEnabled = shouldLogMoveAnimationPlanningDebug(logPlanningDebug)
  const fallbackReasons: string[] = []

  if (override?.disabled) {
    fallbackReasons.push(`per-move override '${canonicalMoveName}' is disabled; used generic planner`)
  }

  if (override && !override.disabled) {
    try {
      const overridePlan = override.preset.plan(input, {
        canonicalMoveName,
        fallbackPlanner,
      })

      if (overridePlan != null) {
        const events = normalizePlannerOutput(input, overridePlan)
        logMoveAnimationPlanningDebug(debugLoggingEnabled, input, events, 'override', fallbackReasons)
        return events
      }

      fallbackReasons.push(`per-move override '${canonicalMoveName}' returned no plan; used generic planner`)
    } catch (error) {
      warnMoveAnimationPlannerFallback(logPlanningWarnings, `Move animation override '${canonicalMoveName}' failed`, error)
      fallbackReasons.push(`per-move override '${canonicalMoveName}' failed; used generic planner`)
    }
  }

  try {
    const events = normalizePlannerOutput(input, fallbackPlanner(input))
    logMoveAnimationPlanningDebug(debugLoggingEnabled, input, events, 'generic', fallbackReasons)
    return events
  } catch (error) {
    warnMoveAnimationPlannerFallback(logPlanningWarnings, 'Generic move animation planner failed', error)
    const events = createNeutralPlannerFallback(input)
    logMoveAnimationPlanningDebug(debugLoggingEnabled, input, events, 'safe-fallback', [
      ...fallbackReasons,
      'generic planner failed; used safe neutral fallback',
    ])
    return events
  }
}

/** Public planner entry point for move automation integration. */
export const planMoveAnimations: MoveAnimationPlanner = createMoveAnimationPlanner()
