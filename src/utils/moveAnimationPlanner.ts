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
}

type GenericMoveSemanticIntent =
  | { readonly kind: 'healing'; readonly tone: typeof MOVE_VFX_TONE.healing }
  | { readonly kind: 'status'; readonly tone: typeof MOVE_VFX_TONE.status }
  | { readonly kind: 'buff-debuff'; readonly tone: typeof MOVE_VFX_TONE.buff | typeof MOVE_VFX_TONE.debuff; readonly direction: 'buff' | 'debuff' }
  | { readonly kind: 'neutral'; readonly tone: typeof MOVE_VFX_TONE.neutral }

type PlannerEventIdFactory = (kind: MoveVfxKind, targetId?: string) => string

const sanitizePlannerIdPart = (value: unknown): string => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'event'
}

export const canonicalMoveAnimationOverrideKey = (moveName: string): MoveAnimationOverrideKey => {
  const normalized = moveName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'unknown-move'
}

const finiteNumberOrZero = (value: number): number => (Number.isFinite(value) ? value : 0)

const createPlannerEventIdFactory = (input: MoveAnimationPlanInput): PlannerEventIdFactory => {
  const baseSeed = input.timing.animationIdBase?.trim()
    || `${input.script.moveName}-${finiteNumberOrZero(input.timing.nowMs)}`
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
  return typeof extras.targetId === 'string' ? extras.targetId : undefined
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
  moveName: input.script.moveName,
  userId: input.user?.id ?? input.transaction?.userId ?? 'unknown-user',
  createdAtMs: finiteNumberOrZero(input.timing.nowMs),
  durationMs,
  palette,
  kind,
  ...extras,
} as MoveAnimationEventByKind[K])

const includesNormalizedWord = (haystack: string, words: readonly string[]): boolean => {
  const normalized = haystack.toLowerCase()
  return words.some((word) => new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, 'i').test(normalized))
}

const moveClassificationText = (script: MoveAnimationPlanScript): string => [
  script.range,
  script.effect,
  script.special ?? '',
  ...script.keywords,
  ...(script.areaTemplates?.map((template) => `${template.kind} ${template.label}`) ?? []),
]
  .filter(Boolean)
  .join(' ')

const hasHealingSuggestion = (
  script: MoveAnimationPlanScript,
  recipient?: MoveAutomationRecipient,
): boolean => script.hpSuggestions.some((suggestion) => (
  (!recipient || suggestion.recipient === recipient)
  && suggestion.mode.startsWith('heal')
))

const stageDirectionForRecipient = (
  script: MoveAnimationPlanScript,
  recipient?: MoveAutomationRecipient,
): 'buff' | 'debuff' | null => {
  const stageSuggestions = script.stageSuggestions.filter((suggestion) => (
    !recipient || suggestion.recipient === recipient
  ))

  if (stageSuggestions.some((suggestion) => suggestion.delta > 0)) return 'buff'
  if (stageSuggestions.some((suggestion) => suggestion.delta < 0)) return 'debuff'
  return null
}

const hasStatusSuggestion = (
  script: MoveAnimationPlanScript,
  recipient?: MoveAutomationRecipient,
): boolean => script.conditionSuggestions.some((suggestion) => (
  !recipient || suggestion.recipient === recipient
))

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

const targetIdForToken = (target: MoveAnimationPlanToken | undefined): string | undefined => target?.id

const firstKnownTargetId = (input: MoveAnimationSingleTargetPlanInput): string | undefined => (
  input.feedback?.targetId
  ?? input.targetOutcomes?.[0]?.targetId
  ?? input.selectedTargetIds[0]
  ?? targetIdForToken(input.targets[0])
)

const targetForId = (
  input: MoveAnimationPlanInput,
  targetId: string | undefined,
): MoveAnimationPlanToken | undefined => {
  if (!targetId) return undefined
  return input.targets.find((target) => target.id === targetId)
}

const feedbackToTargetOutcome = (
  feedback: MoveAnimationPlanFeedback | null | undefined,
): MoveAnimationPlanTargetOutcome | null => {
  if (!feedback) return null

  return {
    targetId: feedback.targetId,
    hit: feedback.hit,
    crit: feedback.crit,
    damageResolved: feedback.damageResolved,
    damageLoss: feedback.damageLoss,
    effectiveness: feedback.effectiveness,
    conditions: feedback.conditions
      .filter((condition) => condition.applied)
      .map((condition) => condition.condition),
  }
}

const targetOutcomeForId = (
  input: MoveAnimationSingleTargetPlanInput,
  targetId: string | undefined,
): MoveAnimationPlanTargetOutcome | null => {
  const explicitOutcome = input.targetOutcomes?.find((outcome) => outcome.targetId === targetId)
  if (explicitOutcome) return explicitOutcome

  const feedbackOutcome = feedbackToTargetOutcome(input.feedback)
  if (feedbackOutcome && (!targetId || feedbackOutcome.targetId === targetId)) return feedbackOutcome

  return null
}

const damagingPaletteForScript = (script: MoveAnimationPlanScript): MoveVfxPaletteEntry => (
  moveVfxColorForType(script.type)
)

const isMeleeDamagingMove = (script: MoveAnimationPlanScript): boolean => {
  if (!script.damaging && !script.directHpLoss) return false

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

const areaSweepKindForScript = (script: MoveAnimationPlanScript):
  | typeof MOVE_VFX_KIND.lineSweep
  | typeof MOVE_VFX_KIND.coneSweep
  | null => {
  const templateKinds = script.areaTemplates?.map((template) => template.kind) ?? []
  const classificationText = moveClassificationText(script)

  if (templateKinds.includes('line') || includesNormalizedWord(classificationText, ['line'])) {
    return MOVE_VFX_KIND.lineSweep
  }

  if (templateKinds.includes('cone') || includesNormalizedWord(classificationText, ['cone'])) {
    return MOVE_VFX_KIND.coneSweep
  }

  return null
}

const planSelfMoveAnimations = (
  input: MoveAnimationSelfPlanInput,
  nextId: PlannerEventIdFactory,
): MoveAnimationEvent[] => {
  if (!input.user) return []

  const semanticIntent = semanticIntentForScript(input.script, 'user')
  const palette = paletteForSemanticIntent(semanticIntent)
  const targetId = input.user.id
  const targetCell = input.user.position

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
      direction: semanticIntent.direction,
    }, palette)]
  }

  if (semanticIntent.kind === 'status') {
    return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.status, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      targetId,
      targetCell,
    }, palette)]
  }

  return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.selfPulse, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
    originCell: input.user.position,
  }, palette)]
}

const planTargetSemanticAnimations = (
  input: MoveAnimationSingleTargetPlanInput,
  nextId: PlannerEventIdFactory,
  targetId: string,
): MoveAnimationEvent[] => {
  const target = targetForId(input, targetId)
  const targetCell = target?.position
  const semanticIntent = semanticIntentForScript(input.script, 'target')
  const palette = paletteForSemanticIntent(semanticIntent)

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
      direction: semanticIntent.direction,
    }, palette)]
  }

  if (semanticIntent.kind === 'status') {
    return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.status, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      targetId,
      targetCell,
    }, palette)]
  }

  return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.targetFlash, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
    targetId,
    targetCell,
  }, palette)]
}

const planSingleTargetMoveAnimations = (
  input: MoveAnimationSingleTargetPlanInput,
  nextId: PlannerEventIdFactory,
): MoveAnimationEvent[] => {
  if (!input.user) return []

  const targetId = firstKnownTargetId(input)
  if (!targetId) {
    return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.selfPulse, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      originCell: input.user.position,
    }, moveVfxColorForTone(MOVE_VFX_TONE.neutral))]
  }

  if (!input.script.damaging && !input.script.directHpLoss) {
    return planTargetSemanticAnimations(input, nextId, targetId)
  }

  const target = targetForId(input, targetId)
  const targetCell = target?.position
  const outcome = targetOutcomeForId(input, targetId)
  const hit = outcome?.hit ?? true
  const crit = outcome?.crit ?? false
  const palette = damagingPaletteForScript(input.script)
  const events: MoveAnimationEvent[] = []

  if (isMeleeDamagingMove(input.script)) {
    events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.meleeLunge, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      originCell: input.user.position,
      targetId,
      targetCell,
    }, palette))
  } else {
    const launchKind = rangedLaunchKindForScript(input.script)
    events.push(createPlannerEvent(input, nextId, launchKind, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      originCell: input.user.position,
      targetId,
      targetCell,
    }, palette))
  }

  if (!hit) {
    events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.miss, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
      targetId,
      targetCell,
    }, moveVfxColorForTone(MOVE_VFX_TONE.miss)))
    return events
  }

  events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.targetFlash, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
    targetId,
    targetCell,
  }, palette))

  if (crit) {
    events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.crit, MOVE_VFX_DEFAULT_DURATIONS_MS.quick, {
      targetId,
      targetCell,
    }, moveVfxColorForTone(MOVE_VFX_TONE.crit)))
  }

  return events
}

const planAreaMoveAnimations = (
  input: MoveAnimationAreaPlanInput,
  nextId: PlannerEventIdFactory,
): MoveAnimationEvent[] => {
  if (!input.user) return []

  const semanticIntent = semanticIntentForScript(input.script)
  const palette = input.script.damaging || input.script.directHpLoss
    ? damagingPaletteForScript(input.script)
    : paletteForSemanticIntent(semanticIntent)
  const events: MoveAnimationEvent[] = []

  if (input.areaCells.length > 0) {
    events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.areaPulse, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
      areaCells: input.areaCells,
      areaOrigin: input.user.position,
    }, palette))

    const sweepKind = areaSweepKindForScript(input.script)
    if (sweepKind === MOVE_VFX_KIND.lineSweep) {
      events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.lineSweep, MOVE_VFX_DEFAULT_DURATIONS_MS.long, {
        originCell: input.user.position,
        areaCells: input.areaCells,
        areaOrigin: input.user.position,
      }, palette))
    } else if (sweepKind === MOVE_VFX_KIND.coneSweep) {
      events.push(createPlannerEvent(input, nextId, MOVE_VFX_KIND.coneSweep, MOVE_VFX_DEFAULT_DURATIONS_MS.long, {
        originCell: input.user.position,
        areaCells: input.areaCells,
        areaOrigin: input.user.position,
      }, palette))
    }
  }

  if (events.length > 0) return events

  return [createPlannerEvent(input, nextId, MOVE_VFX_KIND.selfPulse, MOVE_VFX_DEFAULT_DURATIONS_MS.normal, {
    originCell: input.user.position,
  }, moveVfxColorForTone(MOVE_VFX_TONE.neutral))]
}

/**
 * Generic metadata-driven planner used before any bespoke per-move animation
 * override system exists. It intentionally avoids move-name-specific branches:
 * target mode, damage flags, range text, keywords, area templates, outcome data,
 * and authored suggestions choose reusable effect families only.
 */
export const planGenericMoveAnimations: MoveAnimationPlanner = (input) => {
  const nextId = createPlannerEventIdFactory(input)

  switch (input.resolution) {
    case MOVE_ANIMATION_PLAN_RESOLUTION.self:
      return planSelfMoveAnimations(input, nextId)
    case MOVE_ANIMATION_PLAN_RESOLUTION.singleTarget:
      return planSingleTargetMoveAnimations(input, nextId)
    case MOVE_ANIMATION_PLAN_RESOLUTION.area:
      return planAreaMoveAnimations(input, nextId)
    default:
      return []
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
}: CreateMoveAnimationPlannerOptions = {}): MoveAnimationPlanner => (input) => {
  const canonicalMoveName = canonicalMoveAnimationOverrideKey(input.script.moveName)
  const override = overrideRegistry[canonicalMoveName]

  if (override && !override.disabled) {
    const overridePlan = override.preset.plan(input, {
      canonicalMoveName,
      fallbackPlanner,
    })

    if (overridePlan != null) return overridePlan
  }

  return fallbackPlanner(input)
}

/** Public planner entry point for move automation integration. */
export const planMoveAnimations: MoveAnimationPlanner = createMoveAnimationPlanner()
