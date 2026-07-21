import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import type { LivePlayResolvedMoveResult, ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import { findMove } from '~~/data/ptuReference'
import {
  buildTokenMoveMenuOptions,
  moveEntriesForPlacement,
  type TokenSheetMoveEntry,
} from '~/utils/mapTokenMoves'
import {
  resolveCanonicalMoveEntryForPlacement,
  type ResolvedCanonicalMoveEntry,
} from '~/utils/authoritativeMoveEntries'
import {
  buildMoveAutomationScriptFromMoveData,
  isSeamlessAreaConfirmationScript,
  isSeamlessFieldMoveScript,
  isSeamlessSelfMoveScript,
  isSeamlessSingleTargetMoveScript,
  isSeamlessTargetCountMoveScript,
  moveAutomationHasMultipleTargetBranches,
  moveAutomationScriptForTargetBranch,
  moveAutomationTargetBranches,
} from '~/utils/moveAutomation'
import { moveAutomationCanResolveDamageAtRuntime } from '~/utils/moveAutomationDynamicDamage'
import { findMoveAutomationSemanticStatus } from '~/utils/moveAutomationSemanticStatus'
import { moveAutomationScriptForConfirmedAreaTemplate } from '~/utils/moveAutomationConfirmedAreaTemplate'
import { passDestinationLogLine } from '~/utils/moveAutomationPass'
import {
  buildMoveAutomationAreaTemplateCells,
  buildMoveAutomationAreaTemplatePlacementAtCenter,
  buildMoveAutomationAreaTemplatePlacements,
  buildMoveAutomationCloseBlastPlacementAtAimCell,
  moveAutomationAreaTemplateId,
  tokensInMoveAutomationArea,
  type MoveAutomationAreaTemplatePlacement,
} from '~/utils/moveAutomationAreaTemplates'
import {
  resolveInstantAreaMoveAutomation,
  resolveInstantMoveAutomation,
  resolveInstantMultiTargetMoveAutomation,
  resolveInstantSelfMoveAutomation,
  resolveInstantTargetMoveAutomation,
} from '~/utils/moveAutomationInstant'
import {
  MOVE_ANIMATION_PLAN_RESOLUTION,
  planMoveAnimations,
  type MoveAnimationPlanTargetOutcome,
} from '~/utils/moveAnimationPlanner'
import {
  setTokenFacingOnPlacement,
  tokenFacingAreaDirection,
  tokenFacingForPlacement,
  tokenFacingFromAreaDirection,
  tokenFacingTowardPoint,
} from '~/utils/tokenFacing'
import {
  MELEE_MOVE_RANGE_METERS,
  moveAutomationTargetsInRange,
  parseExplicitMultiTargetMoveRangeMeters,
  parseSingleTargetMoveRangeMeters,
} from '~/utils/moveAutomationRange'
import { moveAutomationTargetHitChance } from '~/utils/moveAutomationAccuracy'
import { activeEncounterRoomKinds } from '~/utils/encounterRooms'
import { buildMoveAutomationResolveIntent } from '~/utils/moveAutomationResolveIntent'
import { buildAllVoxelOccupancy } from '~/utils/voxelOccupancy'
import { getClearanceValue } from '~/utils/gridGeometry'
import { getErrorMessage } from '~/utils/errorMessages'
import { MOVE_VFX_DEFAULT_DURATIONS_MS } from '~/utils/isometric/moveVfxTiming'
import { moveFrequencyTracksOnMap, moveFrequencyTracksOnSheet, parseMoveFrequency } from '~/utils/moveUsage'
import {
  DEFAULT_MOVE_AUTOMATION_LOG_ENTRIES,
  appendMoveAutomationLogEntry,
} from '~/utils/moveAutomationLog'
import { playDiceRollSound } from '~/utils/soundEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, MapFieldEffects, MapHazardV2, TabletopMap } from '~/types/map'
import type {
  MoveAutomationAreaDirection,
  MoveAutomationAreaDirectionOption,
  MoveAutomationAreaTemplate,
  MoveAutomationAreaTemplateOption,
  MoveAutomationCombatStageUpdate,
  MoveAutomationConditionUpdate,
  MoveAutomationFieldEffectApply,
  MoveAutomationHpUpdate,
  MoveAutomationFeedbackState,
  MoveAutomationCelebratePrompt,
  MoveAutomationCuteCharmPrompt,
  MoveAutomationMoxiePrompt,
  MoveAutomationPoisonPointPrompt,
  MoveAutomationScript,
  MoveAutomationSpitePrompt,
  MoveAutomationTargetBranch,
  MoveAutomationTargetingOverlayState,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { MoveAnimationEvent } from '~/types/moveAnimation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

interface BooleanRef {
  readonly value: boolean
}

type SheetMapRef<T> = Ref<Map<string, T> | undefined>
type MaybePromise<T> = T | Promise<T>

export type MoveAnimationEnqueueHandler = (events: readonly MoveAnimationEvent[]) => MaybePromise<unknown>

export interface MoveAutomationFeedbackEvent {
  feedback: MoveAutomationFeedbackState
}

type SheetUpdateOptions = { allowAnyTarget?: boolean }

type MoveUsageRecordRequest = { placementId: string; moveName: string }
type MoveUsageRecordHandler = (request: MoveUsageRecordRequest) => MaybePromise<void>
type MoveAutomationTokenMoveRequest = { id: string; position: GridAnchor }
type MoveAutomationTokenMoveHandler = (request: MoveAutomationTokenMoveRequest) => MaybePromise<void>

export interface MoveAutomationAuthoritativeDispatchRequest {
  readonly intent: ResolveMoveIntent
  readonly candidateScopePlacementIds?: readonly string[]
}

export type MoveAutomationAuthoritativeDispatchOutcome =
  | {
      readonly accepted: false
      readonly message?: string
    }
  | {
      readonly accepted: true
      readonly move: LivePlayResolvedMoveResult | null
      /** Durable accepted-result VFX were already enqueued for this operation. */
      readonly presentationHandled?: boolean
      readonly presentationError?: string
    }

export type MoveAutomationAuthoritativeDispatchHandler = (
  request: MoveAutomationAuthoritativeDispatchRequest,
) => MaybePromise<MoveAutomationAuthoritativeDispatchOutcome | undefined>

const noopEnqueueMoveAnimations: MoveAnimationEnqueueHandler = () => undefined

const defaultMoveAnimationNowMs = (): number => {
  const performanceNow = globalThis.performance?.now
  if (typeof performanceNow === 'function') return performanceNow.call(globalThis.performance)
  return Date.now()
}

export interface MoveAutomationActionUseEvent {
  userId: string
  moveName: string
}

export type MoveAutomationNonImmediateActionEvent = MoveAutomationActionUseEvent

export interface MoveAutomationRangedAttackOfOpportunityEvent {
  provokerId: string
  targetIds: string[]
  moveName: string
}

type SheetUpdateHandler<TUpdate> = (
  update: TUpdate,
  options?: SheetUpdateOptions,
) => MaybePromise<void>

export interface UseMoveAutomationPanelOptions {
  map: Ref<TabletopMap | null>
  spawnedPokemon: ComputedRef<SpawnedPokemon[]>
  pokemonBySlug: SheetMapRef<CharacterSheet>
  trainerBySlug: SheetMapRef<TrainerSheet>
  canEditMap: BooleanRef
  canControlPlacement: (id: string) => boolean
  modifyHp: SheetUpdateHandler<MoveAutomationHpUpdate>
  modifyCombatStages: SheetUpdateHandler<MoveAutomationCombatStageUpdate>
  modifyConditions: SheetUpdateHandler<MoveAutomationConditionUpdate>
  applyMoveFieldEffect: (effect: MoveAutomationFieldEffectApply) => MaybePromise<void>
  placeHazard: (hazard: MapHazardV2) => MaybePromise<void>
  moveToken?: MoveAutomationTokenMoveHandler
  recordMoveUsage?: MoveUsageRecordHandler
  dispatchAuthoritativeMove?: MoveAutomationAuthoritativeDispatchHandler
  /**
   * Renderer-agnostic sink for transient move VFX requests owned by the map page.
   * VFX integration tickets decide when to call it; the panel must not import
   * Three.js renderer utilities or persist queued animation events.
   */
  enqueueMoveAnimations?: MoveAnimationEnqueueHandler
  onBeforeNonImmediateAction?: (event: MoveAutomationNonImmediateActionEvent) => MaybePromise<unknown>
  onMoveUse?: (event: MoveAutomationActionUseEvent) => MaybePromise<unknown>
  onMoveFeedback?: (event: MoveAutomationFeedbackEvent) => MaybePromise<unknown>
  onRangedAttackOfOpportunity?: (event: MoveAutomationRangedAttackOfOpportunityEvent) => MaybePromise<unknown>
  now?: () => number
  maxLogEntries?: number
}

const DEFAULT_MAX_LOG_ENTRIES = DEFAULT_MOVE_AUTOMATION_LOG_ENTRIES

export const MOVE_AUTOMATION_FEEDBACK_TIMING_MS = {
  d20RollAnimation: 650,
  hitRollVisible: 850,
  hitResultVisible: 600,
  effectivenessVisible: 700,
  finalResultVisible: 1100,
} as const

const D20_ROLL_ANIMATION_MS = MOVE_AUTOMATION_FEEDBACK_TIMING_MS.d20RollAnimation
const HIT_ROLL_VISIBLE_MS = MOVE_AUTOMATION_FEEDBACK_TIMING_MS.hitRollVisible
const HIT_RESULT_VISIBLE_MS = MOVE_AUTOMATION_FEEDBACK_TIMING_MS.hitResultVisible
const EFFECTIVENESS_VISIBLE_MS = MOVE_AUTOMATION_FEEDBACK_TIMING_MS.effectivenessVisible
const FINAL_RESULT_VISIBLE_MS = MOVE_AUTOMATION_FEEDBACK_TIMING_MS.finalResultVisible

const MOVE_AUTOMATION_FEEDBACK_OUTCOME_DELAY_MS = D20_ROLL_ANIMATION_MS + HIT_ROLL_VISIBLE_MS
const MOVE_AUTOMATION_FEEDBACK_EFFECTIVENESS_DELAY_MS = MOVE_AUTOMATION_FEEDBACK_OUTCOME_DELAY_MS + HIT_RESULT_VISIBLE_MS
const MOVE_AUTOMATION_VFX_LAUNCH_DELAY_MS = MOVE_AUTOMATION_FEEDBACK_EFFECTIVENESS_DELAY_MS
const MOVE_AUTOMATION_VFX_IMPACT_DELAY_MS = MOVE_AUTOMATION_VFX_LAUNCH_DELAY_MS + MOVE_VFX_DEFAULT_DURATIONS_MS.normal
const MOVE_AUTOMATION_FEEDBACK_DAMAGE_ANIMATION_DONE_DELAY_MS = (
  MOVE_AUTOMATION_VFX_IMPACT_DELAY_MS + MOVE_VFX_DEFAULT_DURATIONS_MS.quick
)

export const MOVE_AUTOMATION_VFX_ROLL_FEEDBACK_OFFSETS_MS = {
  launch: MOVE_AUTOMATION_VFX_LAUNCH_DELAY_MS,
  impact: MOVE_AUTOMATION_VFX_IMPACT_DELAY_MS,
  crit: MOVE_AUTOMATION_VFX_IMPACT_DELAY_MS,
} as const

export interface MoveAutomationFeedbackVfxTiming {
  launchDelayMs: number
  impactDelayMs: number
  critDelayMs: number
  semanticDelayMs: number
}

export const moveAutomationFeedbackHasFinalResolutionPhase = (feedback: MoveAutomationFeedbackState): boolean =>
  feedback.damageResolved || feedback.conditions.length > 0

export const moveAutomationFeedbackHasEffectivenessPhase = (feedback: MoveAutomationFeedbackState): boolean =>
  Boolean(feedback.effectiveness)

export const moveAutomationFeedbackDamagePhaseDelayMs = (feedback: MoveAutomationFeedbackState): number => {
  const feedbackDelay = MOVE_AUTOMATION_FEEDBACK_EFFECTIVENESS_DELAY_MS
    + (
      moveAutomationFeedbackHasFinalResolutionPhase(feedback)
      && moveAutomationFeedbackHasEffectivenessPhase(feedback)
        ? EFFECTIVENESS_VISIBLE_MS
        : 0
    )

  return feedback.damageResolved
    ? Math.max(feedbackDelay, MOVE_AUTOMATION_FEEDBACK_DAMAGE_ANIMATION_DONE_DELAY_MS)
    : feedbackDelay
}

export const moveAutomationFeedbackVfxTiming = (feedback: MoveAutomationFeedbackState): MoveAutomationFeedbackVfxTiming => ({
  launchDelayMs: MOVE_AUTOMATION_VFX_ROLL_FEEDBACK_OFFSETS_MS.launch,
  impactDelayMs: MOVE_AUTOMATION_VFX_ROLL_FEEDBACK_OFFSETS_MS.impact,
  critDelayMs: MOVE_AUTOMATION_VFX_ROLL_FEEDBACK_OFFSETS_MS.crit,
  semanticDelayMs: moveAutomationFeedbackHasFinalResolutionPhase(feedback)
    ? moveAutomationFeedbackDamagePhaseDelayMs(feedback)
    : MOVE_AUTOMATION_VFX_ROLL_FEEDBACK_OFFSETS_MS.impact,
})

interface VirtualOriginRequestFields {
  originCell?: GridAnchor
}

interface ActiveSelfMoveRequest extends VirtualOriginRequestFields {
  kind: 'self'
  userId: string
  moveName: string
  script: MoveAutomationScript
  damageFormula: string | null
  frequency: string | null
  targetBranchId?: string
}

interface ActiveSingleTargetingRequest extends VirtualOriginRequestFields {
  kind: 'single-target'
  userId: string
  moveName: string
  script: MoveAutomationScript
  damageFormula: string | null
  frequency: string | null
  rangeMeters: number
  targetBranchId?: string
}

interface ActiveTargetCountRequest extends VirtualOriginRequestFields {
  kind: 'target-count'
  userId: string
  moveName: string
  script: MoveAutomationScript
  damageFormula: string | null
  frequency: string | null
  rangeMeters: number
  maxTargetCount: number
  selectedTargetIds: string[]
  targetBranchId?: string
}

interface ActiveAreaConfirmationRequest extends VirtualOriginRequestFields {
  kind: 'area-confirmation'
  userId: string
  moveName: string
  script: MoveAutomationScript
  damageFormula: string | null
  frequency: string | null
  targetBranchId?: string
  label: string
  cells: GridAnchor[]
  /** All token ids in the current area template. */
  targetIds: string[]
  /** Candidate token ids manually excluded before confirming Friendly area moves. */
  excludedTargetIds: string[]
  direction?: MoveAutomationAreaDirection
  directionOptions: MoveAutomationAreaDirectionOption[]
  areaTemplateId: string
  areaTemplateOptions: MoveAutomationAreaTemplateOption[]
  placements: MoveAutomationAreaTemplatePlacement[]
  /** Current free-aim center for Ranged Blast area templates. */
  aimCenter?: GridAnchor
  /** Maximum distance, in meters, from the user for the current free-aim center. */
  aimRangeMeters?: number
  passDestination?: GridAnchor
}

interface ActiveVirtualOriginRequest {
  kind: 'virtual-origin'
  userId: string
  moveName: string
  script: MoveAutomationScript
  damageFormula: string | null
  frequency: string | null
  targetBranchId?: string
  originCell: GridAnchor
}

type ActiveMoveTargetingRequest = ActiveSingleTargetingRequest | ActiveTargetCountRequest | ActiveAreaConfirmationRequest | ActiveVirtualOriginRequest

interface ActiveTargetBranchSelectionRequest {
  userId: string
  moveName: string
  baseScript: MoveAutomationScript
  branches: MoveAutomationTargetBranch[]
  damageFormula: string | null
  frequency: string | null
}

interface MoveAutomationPresentationSnapshot {
  readonly tokens: readonly SpawnedPokemon[]
  readonly actorId: string
}

interface MoveAutomationAuthoritativePresentationInput {
  readonly move: LivePlayResolvedMoveResult
  readonly snapshot: MoveAutomationPresentationSnapshot
  readonly request: ActiveSelfMoveRequest | ActiveMoveTargetingRequest
  readonly intent: ResolveMoveIntent
}

export interface MoveAutomationTargetBranchSelectionOption {
  branchId: string
  label: string
  range: string
  targetMode: MoveAutomationTargetBranch['targetMode']
  targetCount: number | null
  mode: NonNullable<MoveAutomationTargetingOverlayState['mode']>
  areaTemplates: MoveAutomationAreaTemplate[]
  disabled: boolean
  disabledReason: string | null
}

export interface MoveAutomationTargetBranchSelectionState {
  userId: string
  moveName: string
  options: MoveAutomationTargetBranchSelectionOption[]
}

export { appendMoveAutomationLogEntry } from '~/utils/moveAutomationLog'

export const useMoveAutomationPanel = ({
  map,
  spawnedPokemon,
  pokemonBySlug,
  trainerBySlug,
  canEditMap,
  canControlPlacement,
  modifyHp,
  modifyCombatStages,
  modifyConditions,
  applyMoveFieldEffect,
  placeHazard,
  moveToken,
  recordMoveUsage,
  dispatchAuthoritativeMove,
  enqueueMoveAnimations = noopEnqueueMoveAnimations,
  onBeforeNonImmediateAction,
  onMoveUse,
  onMoveFeedback,
  onRangedAttackOfOpportunity,
  now,
  maxLogEntries = DEFAULT_MAX_LOG_ENTRIES,
}: UseMoveAutomationPanelOptions) => {
  const activeMoveTargeting = ref<ActiveMoveTargetingRequest | null>(null)
  const activeMoveTargetBranchSelection = ref<ActiveTargetBranchSelectionRequest | null>(null)
  const moveAutomationFeedback = ref<MoveAutomationFeedbackState | null>(null)
  const moveUsageError = ref<string | null>(null)
  const moveDispatchPending = ref(false)
  // Compatibility-only presentation state. Live-play mechanics are available
  // exclusively through the durable response panel and remain empty here.
  const spiteReactionPrompts = ref<MoveAutomationSpitePrompt[]>([])
  const cuteCharmReactionPrompts = ref<MoveAutomationCuteCharmPrompt[]>([])
  const poisonPointReactionPrompts = ref<MoveAutomationPoisonPointPrompt[]>([])
  const moxieTriggerPrompts = ref<MoveAutomationMoxiePrompt[]>([])
  const celebrateTriggerPrompts = ref<MoveAutomationCelebratePrompt[]>([])
  const feedbackTimers: Array<ReturnType<typeof setTimeout>> = []
  let pendingFeedbackTransactionApplier: (() => void) | null = null
  let moveAnimationPlanSequence = 0

  const sheetLookup = () => ({
    pokemon: pokemonBySlug.value,
    trainer: trainerBySlug.value,
  })

  const cloneDetached = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

  const captureMoveAutomationPresentationSnapshot = (actorId: string): MoveAutomationPresentationSnapshot => ({
    actorId,
    tokens: cloneDetached(spawnedPokemon.value),
  })

  const snapshotToken = (
    snapshot: MoveAutomationPresentationSnapshot,
    id: string | null | undefined,
  ): SpawnedPokemon | null => id ? snapshot.tokens.find((token) => token.id === id) ?? null : null

  const snapshotTokensForIds = (
    snapshot: MoveAutomationPresentationSnapshot,
    ids: readonly string[],
  ): SpawnedPokemon[] => ids
    .map((id) => snapshotToken(snapshot, id))
    .filter((token): token is SpawnedPokemon => Boolean(token))

  const missingSnapshotTokenIds = (
    snapshot: MoveAutomationPresentationSnapshot,
    ids: readonly string[],
  ): string[] => ids.filter((id) => !snapshotToken(snapshot, id))

  const moveEntriesForId = (id: string | null | undefined): TokenSheetMoveEntry[] => {
    if (!map.value || !id) return []
    return moveEntriesForPlacement(
      map.value.placements.find((item) => item.id === id),
      sheetLookup(),
      { encounterEffects: map.value.encounterState?.effects ?? [] },
    )
  }

  const findSpawnedPokemon = (id: string | null | undefined): SpawnedPokemon | null =>
    id ? spawnedPokemon.value.find((pokemon) => pokemon.id === id) ?? null : null

  const placementById = (id: string) => map.value?.placements.find((placement) => placement.id === id) ?? null

  const sheetMoveUsageForPlacement = (id: string) => {
    const placement = placementById(id)
    if (!placement) return undefined
    return placement.sheetKind === 'pokemon'
      ? pokemonBySlug.value?.get(placement.sheetSlug)?.moveUsage
      : trainerBySlug.value?.get(placement.sheetSlug)?.moveUsage
  }

  const tokenMoveUsageContext = (id: string) => ({
    mapMoveUsage: map.value?.moveUsage,
    sheetMoveUsage: sheetMoveUsageForPlacement(id),
    activeScene: map.value?.activeScene ?? null,
    currentRound: map.value?.initiative?.round ?? null,
  })

  const tokenFacingPoint = (token: SpawnedPokemon) => ({
    x: token.position.x + token.base / 2,
    z: token.position.z + token.base / 2,
  })

  const faceTokenTowardPoint = (user: SpawnedPokemon, point: { x: number; z: number }) => {
    const placement = placementById(user.id)
    if (!placement) return
    const facing = tokenFacingTowardPoint(
      tokenFacingPoint(user),
      point,
      tokenFacingForPlacement(placement),
    )
    if (facing) setTokenFacingOnPlacement(placement, facing)
  }

  const faceTokenTowardToken = (user: SpawnedPokemon, target: SpawnedPokemon) => {
    faceTokenTowardPoint(user, tokenFacingPoint(target))
  }

  const faceTokenTowardAreaDirection = (
    user: SpawnedPokemon,
    direction: MoveAutomationAreaDirection | undefined,
  ) => {
    if (!direction) return
    const placement = placementById(user.id)
    if (!placement) return
    const facing = tokenFacingFromAreaDirection(direction, tokenFacingForPlacement(placement))
    if (facing) setTokenFacingOnPlacement(placement, facing)
  }

  const moveTokenToPassDestination = async (id: string, destination: GridAnchor | undefined) => {
    if (!destination) return
    const position = { ...destination }
    if (moveToken) {
      await moveToken({ id, position })
      return
    }
    const placement = placementById(id)
    if (!placement) return
    placement.position = position
  }

  const faceTokenTowardNearestTarget = (user: SpawnedPokemon, targets: readonly SpawnedPokemon[]) => {
    const origin = tokenFacingPoint(user)
    const target = [...targets]
      .sort((a, b) => {
        const aPoint = tokenFacingPoint(a)
        const bPoint = tokenFacingPoint(b)
        const aDistance = (aPoint.x - origin.x) ** 2 + (aPoint.z - origin.z) ** 2
        const bDistance = (bPoint.x - origin.x) ** 2 + (bPoint.z - origin.z) ** 2
        return aDistance - bDistance
      })[0]
    if (target) faceTokenTowardToken(user, target)
  }

  const moveAutomationEntryForUse = (id: string, moveName: string): ResolvedCanonicalMoveEntry | null => {
    const user = findSpawnedPokemon(id)
    const result = resolveCanonicalMoveEntryForPlacement({
      placement: placementById(id),
      token: user,
      sheets: sheetLookup(),
      moveName,
      usageContext: tokenMoveUsageContext(id),
      encounterEffects: map.value?.encounterState?.effects ?? [],
    })
    if (!result.ok) return null

    const semanticStatus = findMoveAutomationSemanticStatus(result.entry.canonicalMoveName)
    return semanticStatus?.baseStatus === 'blocked' ? null : result.entry
  }

  const moveTargetHitChances = (
    script: MoveAutomationScript,
    user: SpawnedPokemon,
    targetIds: readonly string[],
  ): NonNullable<MoveAutomationTargetingOverlayState['hitChances']> => {
    const activeRooms = [...activeEncounterRoomKinds(map.value ?? {})]
    const fieldEffects: MapFieldEffects = {
      weather: [],
      terrains: [],
      rooms: activeRooms.map(kind => ({ kind })),
    }
    return Object.fromEntries(
      targetIds.flatMap((targetId) => {
        const target = findSpawnedPokemon(targetId)
        return target
          ? [[targetId, moveAutomationTargetHitChance(script, user, target, { fieldEffects })]]
          : []
      }),
    )
  }

  const canToggleAreaTargets = (script: MoveAutomationScript): boolean =>
    script.keywords.some((keyword) => /^Friendly$/i.test(keyword))

  const selectedAreaTargetIds = (request: ActiveAreaConfirmationRequest): string[] => {
    if (!canToggleAreaTargets(request.script) || !request.excludedTargetIds.length) return request.targetIds
    const excluded = new Set(request.excludedTargetIds)
    return request.targetIds.filter((id) => !excluded.has(id))
  }

  const targetCountCandidateIds = (request: ActiveTargetCountRequest, user: SpawnedPokemon): string[] => moveAutomationTargetsInRange({
    user,
    tokens: spawnedPokemon.value,
    rangeMeters: request.rangeMeters,
  }).map((candidate) => candidate.id)

  const selectedTargetCountIds = (
    request: ActiveTargetCountRequest,
    candidateIds: readonly string[],
  ): string[] => {
    const candidates = new Set(candidateIds)
    return request.selectedTargetIds.filter((id) => candidates.has(id)).slice(0, request.maxTargetCount)
  }

  const cloneMoveAutomationAreaTemplates = (
    templates: readonly MoveAutomationAreaTemplate[] | null | undefined,
  ): MoveAutomationAreaTemplate[] => templates?.map((template) => ({ ...template })) ?? []

  const areaTemplateOptionsForTemplates = (
    templates: readonly MoveAutomationAreaTemplate[] | null | undefined,
  ): MoveAutomationAreaTemplateOption[] => {
    const options: MoveAutomationAreaTemplateOption[] = []
    const seen = new Set<string>()
    for (const template of templates ?? []) {
      const id = moveAutomationAreaTemplateId(template)
      if (seen.has(id)) continue
      seen.add(id)
      options.push({ id, label: template.label })
    }
    return options
  }

  const areaTemplateOptionsForPlacements = (
    placements: readonly MoveAutomationAreaTemplatePlacement[],
    fallbackTemplates: readonly MoveAutomationAreaTemplate[] | null | undefined,
  ): MoveAutomationAreaTemplateOption[] => areaTemplateOptionsForTemplates(
    placements.length ? placements.map((placement) => placement.template) : fallbackTemplates,
  )

  const areaTemplateOptionIsVisible = (options: readonly MoveAutomationAreaTemplateOption[]): boolean =>
    options.length > 1

  const placementTemplateId = (placement: MoveAutomationAreaTemplatePlacement): string =>
    moveAutomationAreaTemplateId(placement.template)

  const areaAimFieldsForPlacement = (
    placement: MoveAutomationAreaTemplatePlacement,
  ): Pick<ActiveAreaConfirmationRequest, 'aimCenter' | 'aimRangeMeters'> => {
    const aimCell = placement.aimCell ?? placement.center
    if (!aimCell) return { aimCenter: undefined, aimRangeMeters: undefined }

    const aimRangeMeters = typeof placement.template.range === 'number'
      ? placement.template.range
      : placement.template.kind === 'close-blast'
        ? placement.template.size
        : undefined

    return {
      aimCenter: aimCell,
      ...(typeof aimRangeMeters === 'number' ? { aimRangeMeters } : { aimRangeMeters: undefined }),
    }
  }

  const placementsForAreaTemplate = (
    placements: readonly MoveAutomationAreaTemplatePlacement[],
    templateId: string,
  ): MoveAutomationAreaTemplatePlacement[] => placements.filter((placement) => placementTemplateId(placement) === templateId)

  const targetBranchSelectionModeForScript = (
    script: MoveAutomationScript,
  ): MoveAutomationTargetBranchSelectionOption['mode'] | null => {
    if (script.targetMode === 'one-target') return 'target'
    if (script.targetMode === 'multi-target') {
      if (script.areaTemplates?.length) return 'area-confirmation'
      if (isSeamlessTargetCountMoveScript(script)) return 'target-count'
    }
    return null
  }

  const unsupportedTargetBranchReason = (
    script: MoveAutomationScript,
    user: SpawnedPokemon,
    damageFormula: string | null,
  ): string | null => {
    if (script.damaging && !damageFormula && !moveAutomationCanResolveDamageAtRuntime(script)) {
      return 'Damage cannot be resolved automatically.'
    }

    if (script.targetMode === 'one-target') {
      return parseSingleTargetMoveRangeMeters(script.range, {
        focusSkillRankValue: user.focusSkillRankValue,
      }) == null
        ? 'Unsupported target range.'
        : null
    }

    if (script.targetMode === 'multi-target') {
      if (script.areaTemplates?.length) return null
      if (isSeamlessTargetCountMoveScript(script)) {
        return parseExplicitMultiTargetMoveRangeMeters(script.range) == null
          ? 'Unsupported target range.'
          : null
      }
      return 'Unsupported area template.'
    }

    return 'Unsupported target mode.'
  }

  const targetBranchSelectionOption = (
    request: ActiveTargetBranchSelectionRequest,
    branch: MoveAutomationTargetBranch,
    user: SpawnedPokemon,
  ): MoveAutomationTargetBranchSelectionOption => {
    const script = moveAutomationScriptForTargetBranch(request.baseScript, branch)
    const mode = script ? targetBranchSelectionModeForScript(script) : null
    const disabledReason = script
      ? unsupportedTargetBranchReason(script, user, request.damageFormula)
      : 'Unsupported target branch.'

    return {
      branchId: branch.id,
      label: branch.label,
      range: branch.range,
      targetMode: branch.targetMode,
      targetCount: branch.targetCount,
      mode: mode ?? (branch.targetMode === 'one-target' ? 'target' : branch.targetCount != null && branch.targetCount > 1 ? 'target-count' : 'area-confirmation'),
      areaTemplates: cloneMoveAutomationAreaTemplates(script?.areaTemplates ?? branch.areaTemplates),
      disabled: Boolean(disabledReason || !mode),
      disabledReason: disabledReason ?? (!mode ? 'Unsupported target branch.' : null),
    }
  }

  const moveAutomationTargetBranchSelection = computed<MoveAutomationTargetBranchSelectionState | null>(() => {
    const request = activeMoveTargetBranchSelection.value
    const user = findSpawnedPokemon(request?.userId)
    if (!request || !user || !canControlPlacement(request.userId)) return null

    return {
      userId: request.userId,
      moveName: request.moveName,
      options: request.branches.map((branch) => targetBranchSelectionOption(request, branch, user)),
    }
  })

  const moveAutomationTargeting = computed<MoveAutomationTargetingOverlayState | null>(() => {
    const request = activeMoveTargeting.value
    const user = findSpawnedPokemon(request?.userId)
    if (!request || !user || !canControlPlacement(request.userId)) return null

    if (request.kind === 'virtual-origin') {
      return {
        userId: request.userId,
        moveName: request.moveName,
        mode: 'area-confirmation',
        rangeLabel: 'Clay Cannons origin (2m)',
        rangeMeters: 2,
        targetPrompt: 'Choose the virtual origin for this Ranged Move.',
        candidateIds: [], hitChances: {}, areaCells: [request.originCell], affectedIds: [],
        canToggleTargets: false, areaAimMode: 'free', areaAimCenter: request.originCell,
        areaAimRangeMeters: 2,
      }
    }

    if (request.kind === 'area-confirmation') {
      return {
        userId: request.userId,
        moveName: request.moveName,
        mode: 'area-confirmation',
        rangeLabel: request.label,
        rangeMeters: request.aimRangeMeters ?? 0,
        candidateIds: request.targetIds,
        hitChances: moveTargetHitChances(request.script, user, request.targetIds),
        areaCells: request.cells,
        affectedIds: selectedAreaTargetIds(request),
        canToggleTargets: canToggleAreaTargets(request.script),
        areaDirection: request.direction,
        areaDirectionOptions: request.directionOptions,
        ...(request.aimCenter
          ? {
              areaAimMode: 'free' as const,
              areaAimCenter: request.aimCenter,
              ...(typeof request.aimRangeMeters === 'number' ? { areaAimRangeMeters: request.aimRangeMeters } : {}),
            }
          : {}),
        areaTemplateId: request.areaTemplateId,
        areaTemplateOptions: areaTemplateOptionIsVisible(request.areaTemplateOptions) ? request.areaTemplateOptions : undefined,
      }
    }

    if (request.kind === 'target-count') {
      const targetingUser = request.originCell ? { ...user, position: { ...request.originCell } } : user
      const candidateIds = targetCountCandidateIds(request, targetingUser)
      const selectedTargetIds = selectedTargetCountIds(request, candidateIds)
      const plural = request.maxTargetCount === 1 ? 'target' : 'targets'
      return {
        userId: request.userId,
        moveName: request.moveName,
        mode: 'target-count',
        rangeLabel: `${request.rangeMeters}m`,
        rangeMeters: request.rangeMeters,
        targetPrompt: `Choose up to ${request.maxTargetCount} ${plural} within ${request.rangeMeters}m.`,
        candidateIds,
        hitChances: moveTargetHitChances(request.script, user, candidateIds),
        selectedTargetIds,
        affectedIds: selectedTargetIds,
        targetCount: selectedTargetIds.length,
        maxTargetCount: request.maxTargetCount,
      }
    }

    const targetingUser = request.originCell ? { ...user, position: { ...request.originCell } } : user
    const candidates = moveAutomationTargetsInRange({
      user: targetingUser,
      tokens: spawnedPokemon.value,
      rangeMeters: request.rangeMeters,
    })
    if (/\bSelf\b/i.test(request.script.range)) candidates.unshift(user)
    const candidateIds = candidates.map((candidate) => candidate.id)
    return {
      userId: request.userId,
      moveName: request.moveName,
      mode: 'target',
      rangeLabel: `${request.rangeMeters}m`,
      rangeMeters: request.rangeMeters,
      candidateIds,
      hitChances: moveTargetHitChances(request.script, user, candidateIds),
    }
  })

  const tokenMoveOptionsById = computed(() => {
    const out: Record<string, ReturnType<typeof buildTokenMoveMenuOptions>> = {}
    if (!map.value) return out
    for (const token of spawnedPokemon.value) {
      out[token.id] = buildTokenMoveMenuOptions(
        token,
        moveEntriesForId(token.id),
        tokenMoveUsageContext(token.id),
      )
    }
    return out
  })

  const clearFeedbackTimers = () => {
    while (feedbackTimers.length) {
      const timer = feedbackTimers.pop()
      if (timer) clearTimeout(timer)
    }
  }

  const flushPendingFeedbackTransaction = () => {
    const apply = pendingFeedbackTransactionApplier
    pendingFeedbackTransactionApplier = null
    apply?.()
  }

  const clearMoveAutomationFeedback = () => {
    flushPendingFeedbackTransaction()
    clearFeedbackTimers()
    moveAutomationFeedback.value = null
  }

  const tokenAreaDirection = (user: SpawnedPokemon): MoveAutomationAreaDirection =>
    tokenFacingAreaDirection(tokenFacingForPlacement(user))

  const tokenCenterCell = (token: SpawnedPokemon): GridAnchor => ({
    x: token.position.x + Math.floor((token.base - 1) / 2),
    y: token.position.y + Math.floor((getClearanceValue(token) - 1) / 2),
    z: token.position.z + Math.floor((token.base - 1) / 2),
  })

  const areaTemplateCellConstraints = () => ({
    bounds: map.value?.dimensions,
    blockedCells: buildAllVoxelOccupancy(map.value?.voxels ?? []),
  })

  const directionOptionsForPlacements = (
    placements: readonly MoveAutomationAreaTemplatePlacement[],
  ): MoveAutomationAreaDirectionOption[] => placements
    .filter((placement): placement is MoveAutomationAreaTemplatePlacement & { direction: MoveAutomationAreaDirection } => Boolean(placement.direction))
    .map((placement) => ({
      direction: placement.direction,
      label: placement.label,
      areaCells: placement.cells,
      affectedIds: placement.targetIds,
      ...(placement.destination ? { destination: placement.destination } : {}),
    }))

  const areaPlacementForTokenFacing = (
    placements: readonly MoveAutomationAreaTemplatePlacement[],
    user: SpawnedPokemon,
  ): MoveAutomationAreaTemplatePlacement | null => placements.find((placement) =>
    placement.direction === tokenAreaDirection(user),
  ) ?? placements[0] ?? null

  const initialAreaPlacement = (
    placements: readonly MoveAutomationAreaTemplatePlacement[],
    user: SpawnedPokemon,
  ): MoveAutomationAreaTemplatePlacement | null => {
    const firstTemplateId = placements[0] ? placementTemplateId(placements[0]) : null
    return firstTemplateId
      ? areaPlacementForTokenFacing(placementsForAreaTemplate(placements, firstTemplateId), user)
      : null
  }

  const requestFromAreaPlacement = (
    user: SpawnedPokemon,
    script: MoveAutomationScript,
    damageFormula: string | null,
    frequency: string | null,
    placement: MoveAutomationAreaTemplatePlacement,
    placements: readonly MoveAutomationAreaTemplatePlacement[],
    targetBranchId?: string,
  ): ActiveAreaConfirmationRequest => {
    const areaTemplateId = placementTemplateId(placement)
    const selectedTemplatePlacements = placementsForAreaTemplate(placements, areaTemplateId)
    const aimFields = areaAimFieldsForPlacement(placement)
    const freeAim = Boolean(aimFields.aimCenter)
    return {
      kind: 'area-confirmation',
      userId: user.id,
      moveName: script.moveName,
      script,
      damageFormula,
      frequency,
      ...(targetBranchId ? { targetBranchId } : {}),
      label: placement.label,
      cells: placement.cells,
      targetIds: placement.targetIds,
      excludedTargetIds: [],
      direction: freeAim ? undefined : placement.direction,
      directionOptions: freeAim ? [] : directionOptionsForPlacements(selectedTemplatePlacements),
      areaTemplateId,
      areaTemplateOptions: areaTemplateOptionsForPlacements(placements, script.areaTemplates),
      placements: [...placements],
      ...aimFields,
      ...(placement.destination ? { passDestination: placement.destination } : {}),
    }
  }

  const initialCloseBlastPlacementForTemplate = (
    user: SpawnedPokemon,
    template: MoveAutomationAreaTemplate,
  ): MoveAutomationAreaTemplatePlacement | null => {
    const placements = buildMoveAutomationAreaTemplatePlacements({
      script: { range: template.label, areaTemplates: [template] },
      user,
      tokens: spawnedPokemon.value,
      includeEmpty: true,
      ...areaTemplateCellConstraints(),
    })
    return areaPlacementForTokenFacing(placements, user)
  }

  const makeFallbackAreaPlacement = (
    script: MoveAutomationScript,
    damageFormula: string | null,
    frequency: string | null,
    user: SpawnedPokemon,
    targetBranchId?: string,
  ): ActiveAreaConfirmationRequest | null => {
    const template = script.areaTemplates?.[0]
    if (!template || template.kind === 'pass') return null

    if (template.kind === 'ranged-blast') {
      const placement = buildMoveAutomationAreaTemplatePlacementAtCenter({
        template,
        user,
        tokens: spawnedPokemon.value,
        center: tokenCenterCell(user),
        includeEmpty: true,
        ...areaTemplateCellConstraints(),
      })
      return placement ? requestFromAreaPlacement(user, script, damageFormula, frequency, placement, [], targetBranchId) : null
    }

    if (template.kind === 'close-blast') {
      const placement = initialCloseBlastPlacementForTemplate(user, template)
      return placement ? requestFromAreaPlacement(user, script, damageFormula, frequency, placement, [], targetBranchId) : null
    }

    const direction = template.kind === 'cone' || template.kind === 'line'
      ? tokenAreaDirection(user)
      : undefined
    const cells = buildMoveAutomationAreaTemplateCells({
      template,
      user,
      direction,
      ...areaTemplateCellConstraints(),
    })
    const targetIds = tokensInMoveAutomationArea({
      cells,
      tokens: spawnedPokemon.value,
      excludeIds: [user.id],
    }).map((token) => token.id)
    return {
      kind: 'area-confirmation',
      userId: user.id,
      moveName: script.moveName,
      script,
      damageFormula,
      frequency,
      ...(targetBranchId ? { targetBranchId } : {}),
      label: template.label,
      cells,
      targetIds,
      excludedTargetIds: [],
      direction,
      directionOptions: [],
      areaTemplateId: moveAutomationAreaTemplateId(template),
      areaTemplateOptions: areaTemplateOptionsForTemplates(script.areaTemplates),
      placements: [],
    }
  }

  const rollFormulaForEntry = (entry: NonNullable<ReturnType<typeof moveAutomationEntryForUse>>): string | null =>
    entry.damageFormula

  const frequencyForEntry = (entry: NonNullable<ReturnType<typeof moveAutomationEntryForUse>>): string | null =>
    entry.frequency

  const usageIsTracked = (frequency: string | null): boolean => {
    const parsed = parseMoveFrequency(frequency)
    return moveFrequencyTracksOnMap(parsed) || moveFrequencyTracksOnSheet(parsed)
  }

  const moveScriptIsImmediateOrInterrupt = (script: MoveAutomationScript): boolean =>
    script.keywords.some((keyword) => /^(Immediate|Interrupt|Reaction)$/i.test(keyword.trim()))

  const notifyMoveActionTaken = (request: Pick<ActiveSelfMoveRequest | ActiveMoveTargetingRequest, 'userId' | 'moveName' | 'script'>): MaybePromise<unknown> => {
    if (moveScriptIsImmediateOrInterrupt(request.script)) return undefined
    return onBeforeNonImmediateAction?.({ userId: request.userId, moveName: request.moveName })
  }

  const isPromiseLike = (value: unknown): value is PromiseLike<unknown> => (
    value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function'
  )

  const notifyMoveUse = (request: Pick<ActiveSelfMoveRequest | ActiveMoveTargetingRequest, 'userId' | 'moveName'>): MaybePromise<unknown> =>
    onMoveUse?.({ userId: request.userId, moveName: request.moveName })

  const warnMoveFeedbackEmissionFailure = (error: unknown) => {
    console.warn('[useMoveAutomationPanel] move feedback callback failed', error)
  }

  const notifyMoveFeedback = (feedback: MoveAutomationFeedbackState) => {
    if (!onMoveFeedback) return

    try {
      void Promise.resolve(onMoveFeedback({ feedback })).catch(warnMoveFeedbackEmissionFailure)
    } catch (error) {
      warnMoveFeedbackEmissionFailure(error)
    }
  }

  const notifyRangedAttackOfOpportunity = (
    request: ActiveMoveTargetingRequest,
    targetIds: readonly string[],
  ): MaybePromise<unknown> => {
    if (request.kind === 'area-confirmation' || request.kind === 'virtual-origin') return undefined
    if (request.rangeMeters <= MELEE_MOVE_RANGE_METERS) return undefined
    return onRangedAttackOfOpportunity?.({
      provokerId: request.userId,
      targetIds: [...targetIds],
      moveName: request.moveName,
    })
  }

  const recordMoveUseIfTracked = async (request: MoveUsageRecordRequest, frequency: string | null): Promise<boolean> => {
    moveUsageError.value = null
    if (!usageIsTracked(frequency) || !recordMoveUsage) return true
    try {
      await recordMoveUsage(request)
      return true
    } catch (error) {
      const message = getErrorMessage(error, { fallback: 'Move usage could not be recorded.' })
      moveUsageError.value = message
      console.warn('[useMoveAutomationPanel] move usage failed', error)
      return false
    }
  }

  const moveAnimationNowMs = (): number => {
    const nowMs = now?.() ?? defaultMoveAnimationNowMs()
    return Number.isFinite(nowMs) ? nowMs : 0
  }

  const nextMoveAnimationPlanIdBase = (
    resolution: string,
    script: MoveAutomationScript,
    user: SpawnedPokemon,
  ): string => {
    moveAnimationPlanSequence += 1
    return `use-move-${resolution}-${script.moveName}-${user.id}-${String(moveAnimationPlanSequence).padStart(6, '0')}`
  }

  const warnMoveAnimationEmissionFailure = (stage: string, error: unknown) => {
    console.warn(`[useMoveAutomationPanel] move animation ${stage} failed`, error)
  }

  const clearMoveAutomationTargetingForUser = (userId: string) => {
    if (activeMoveTargetBranchSelection.value?.userId === userId) activeMoveTargetBranchSelection.value = null
    if (activeMoveTargeting.value?.userId === userId) activeMoveTargeting.value = null
  }

  const canContinueMoveAutomationForUser = (userId: string): boolean => {
    if (canControlPlacement(userId)) return true

    clearMoveAutomationTargetingForUser(userId)
    return false
  }

  const enqueuePlannedMoveAnimations = (userId: string, events: readonly MoveAnimationEvent[]) => {
    if (events.length === 0 || !canControlPlacement(userId)) return

    try {
      void Promise.resolve(enqueueMoveAnimations(events)).catch((error) => {
        warnMoveAnimationEmissionFailure('enqueue', error)
      })
    } catch (error) {
      warnMoveAnimationEmissionFailure('enqueue', error)
    }
  }

  const planAndEnqueueSelfMoveAnimations = (options: {
    script: MoveAutomationScript
    user: SpawnedPokemon
    transaction: MoveAutomationTransaction
  }) => {
    try {
      enqueuePlannedMoveAnimations(options.user.id, planMoveAnimations({
        resolution: MOVE_ANIMATION_PLAN_RESOLUTION.self,
        user: options.user,
        targets: [],
        selectedTargetIds: [],
        script: options.script,
        transaction: options.transaction,
        timing: {
          nowMs: moveAnimationNowMs(),
          animationIdBase: nextMoveAnimationPlanIdBase('self', options.script, options.user),
        },
      }))
    } catch (error) {
      warnMoveAnimationEmissionFailure('planning', error)
    }
  }

  const targetOutcomesForFeedback = (feedback: MoveAutomationFeedbackState): readonly MoveAnimationPlanTargetOutcome[] => [{
    targetId: feedback.targetId,
    hit: feedback.hit,
    crit: feedback.crit,
    damageResolved: feedback.damageResolved,
    damageLoss: feedback.damageLoss,
    effectiveness: feedback.effectiveness,
    conditions: feedback.conditions
      .filter((condition) => condition.applied)
      .map((condition) => condition.condition),
  }]

  const confirmedTargetOutcomeForTransaction = (
    target: SpawnedPokemon,
    transaction: MoveAutomationTransaction,
  ): MoveAnimationPlanTargetOutcome => {
    const hpUpdate = transaction.hpUpdates.find((update) => update.id === target.id)
    const beforeEffectiveHp = target.currentHp + Math.max(0, Math.floor(target.temporaryHp ?? 0))
    const afterEffectiveHp = hpUpdate
      ? hpUpdate.currentHp + Math.max(0, Math.floor(hpUpdate.temporaryHp ?? target.temporaryHp ?? 0))
      : beforeEffectiveHp
    const damageLoss = hpUpdate ? Math.max(0, beforeEffectiveHp - afterEffectiveHp) : undefined
    const conditionUpdate = transaction.conditionUpdates.find((update) => update.id === target.id)
    const hitTargetIds = transaction.hitTargetIds

    return {
      targetId: target.id,
      hit: !hitTargetIds || hitTargetIds.includes(target.id),
      damageResolved: Boolean(hpUpdate),
      ...(damageLoss && damageLoss > 0 ? { damageLoss } : {}),
      ...(conditionUpdate?.conditions.length ? { conditions: conditionUpdate.conditions } : {}),
    }
  }

  const planAndEnqueueConfirmedSingleTargetMoveAnimations = (options: {
    script: MoveAutomationScript
    user: SpawnedPokemon
    target: SpawnedPokemon
    transaction: MoveAutomationTransaction
  }) => {
    try {
      enqueuePlannedMoveAnimations(options.user.id, planMoveAnimations({
        resolution: MOVE_ANIMATION_PLAN_RESOLUTION.singleTarget,
        user: options.user,
        targets: [options.target],
        selectedTargetIds: [options.target.id],
        script: options.script,
        targetOutcomes: [confirmedTargetOutcomeForTransaction(options.target, options.transaction)],
        transaction: options.transaction,
        timing: {
          nowMs: moveAnimationNowMs(),
          animationIdBase: nextMoveAnimationPlanIdBase('single-target-confirmed', options.script, options.user),
        },
      }))
    } catch (error) {
      warnMoveAnimationEmissionFailure('planning', error)
    }
  }

  const planAndEnqueueSingleTargetMoveAnimations = (options: {
    script: MoveAutomationScript
    user: SpawnedPokemon
    target: SpawnedPokemon
    feedback: MoveAutomationFeedbackState
    transaction: MoveAutomationTransaction
  }) => {
    const feedbackVfxTiming = moveAutomationFeedbackVfxTiming(options.feedback)

    try {
      enqueuePlannedMoveAnimations(options.user.id, planMoveAnimations({
        resolution: MOVE_ANIMATION_PLAN_RESOLUTION.singleTarget,
        user: options.user,
        targets: [options.target],
        selectedTargetIds: [options.target.id],
        script: options.script,
        feedback: options.feedback,
        targetOutcomes: targetOutcomesForFeedback(options.feedback),
        transaction: options.transaction,
        timing: {
          nowMs: moveAnimationNowMs(),
          animationIdBase: nextMoveAnimationPlanIdBase('single-target', options.script, options.user),
          baseDelayMs: feedbackVfxTiming.launchDelayMs,
          impactDelayMs: feedbackVfxTiming.impactDelayMs,
          semanticDelayMs: feedbackVfxTiming.semanticDelayMs,
        },
      }))
    } catch (error) {
      warnMoveAnimationEmissionFailure('planning', error)
    }
  }

  const planAndEnqueueMultiTargetMoveAnimations = (options: {
    script: MoveAutomationScript
    user: SpawnedPokemon
    targets: readonly SpawnedPokemon[]
    selectedTargetIds: readonly string[]
    transaction: MoveAutomationTransaction
  }) => {
    try {
      enqueuePlannedMoveAnimations(options.user.id, planMoveAnimations({
        resolution: MOVE_ANIMATION_PLAN_RESOLUTION.multiTarget,
        user: options.user,
        targets: options.targets,
        selectedTargetIds: options.selectedTargetIds,
        script: options.script,
        transaction: options.transaction,
        targetOutcomes: options.targets.map((target) => confirmedTargetOutcomeForTransaction(target, options.transaction)),
        timing: {
          nowMs: moveAnimationNowMs(),
          animationIdBase: nextMoveAnimationPlanIdBase('multi-target', options.script, options.user),
        },
      }))
    } catch (error) {
      warnMoveAnimationEmissionFailure('planning', error)
    }
  }

  const planAndEnqueueAreaMoveAnimations = (options: {
    script: MoveAutomationScript
    user: SpawnedPokemon
    targets: readonly SpawnedPokemon[]
    selectedTargetIds: readonly string[]
    excludedTargetIds: readonly string[]
    areaCells: readonly GridAnchor[]
    areaDirection?: MoveAutomationAreaDirection
    passDestination?: GridAnchor
    transaction: MoveAutomationTransaction
  }) => {
    try {
      enqueuePlannedMoveAnimations(options.user.id, planMoveAnimations({
        resolution: MOVE_ANIMATION_PLAN_RESOLUTION.area,
        user: options.user,
        targets: options.targets,
        selectedTargetIds: options.selectedTargetIds,
        script: options.script,
        transaction: options.transaction,
        targetOutcomes: options.targets.map((target) => confirmedTargetOutcomeForTransaction(target, options.transaction)),
        areaCells: options.areaCells,
        ...(options.areaDirection ? { areaDirection: options.areaDirection } : {}),
        ...(options.excludedTargetIds.length ? { excludedTargetIds: options.excludedTargetIds } : {}),
        ...(options.passDestination ? { passDestination: options.passDestination } : {}),
        timing: {
          nowMs: moveAnimationNowMs(),
          animationIdBase: nextMoveAnimationPlanIdBase('area', options.script, options.user),
        },
      }))
    } catch (error) {
      warnMoveAnimationEmissionFailure('planning', error)
    }
  }

  const areaConfirmationRequestForScript = (
    user: SpawnedPokemon,
    script: MoveAutomationScript,
    damageFormula: string | null,
    frequency: string | null,
    targetBranchId?: string,
  ): ActiveAreaConfirmationRequest | null => {
    if (script.damaging && !damageFormula && !moveAutomationCanResolveDamageAtRuntime(script)) return null
    const placements = buildMoveAutomationAreaTemplatePlacements({
      script,
      user,
      tokens: spawnedPokemon.value,
      includeEmpty: true,
      ...areaTemplateCellConstraints(),
    })
    const placement = initialAreaPlacement(placements, user)
    return placement
      ? requestFromAreaPlacement(user, script, damageFormula, frequency, placement, placements, targetBranchId)
      : makeFallbackAreaPlacement(script, damageFormula, frequency, user, targetBranchId)
  }

  const beginAreaConfirmationForScript = (
    user: SpawnedPokemon,
    script: MoveAutomationScript,
    damageFormula: string | null,
    frequency: string | null,
    targetBranchId?: string,
  ): boolean => {
    const request = areaConfirmationRequestForScript(user, script, damageFormula, frequency, targetBranchId)
    if (!request) return false

    clearMoveAutomationFeedback()
    activeMoveTargetBranchSelection.value = null
    activeMoveTargeting.value = request
    return true
  }

  const beginSeamlessAreaConfirmation = (id: string, entry: ReturnType<typeof moveAutomationEntryForUse>): boolean => {
    const user = findSpawnedPokemon(id)
    if (!user || !entry || !isSeamlessAreaConfirmationScript(entry.script)) return false
    const damageFormula = entry.script.damaging ? rollFormulaForEntry(entry) : null
    return beginAreaConfirmationForScript(user, entry.script, damageFormula, frequencyForEntry(entry))
  }

  const singleTargetRequestForScript = (
    user: SpawnedPokemon,
    script: MoveAutomationScript,
    damageFormula: string | null,
    frequency: string | null,
    targetBranchId?: string,
  ): ActiveSingleTargetingRequest | null => {
    const rangeMeters = parseSingleTargetMoveRangeMeters(script.range, {
      focusSkillRankValue: user.focusSkillRankValue,
    })
    if (rangeMeters == null || (script.damaging && !damageFormula && !moveAutomationCanResolveDamageAtRuntime(script))) {
      return null
    }

    return {
      kind: 'single-target',
      userId: user.id,
      moveName: script.moveName,
      script,
      damageFormula,
      frequency,
      rangeMeters,
      ...(targetBranchId ? { targetBranchId } : {}),
    }
  }

  const beginSingleTargetingForScript = (
    user: SpawnedPokemon,
    script: MoveAutomationScript,
    damageFormula: string | null,
    frequency: string | null,
    targetBranchId?: string,
  ): boolean => {
    const request = singleTargetRequestForScript(user, script, damageFormula, frequency, targetBranchId)
    if (!request) return false

    clearMoveAutomationFeedback()
    activeMoveTargetBranchSelection.value = null
    activeMoveTargeting.value = request
    return true
  }

  const targetCountRequestForScript = (
    user: SpawnedPokemon,
    script: MoveAutomationScript,
    damageFormula: string | null,
    frequency: string | null,
    targetBranchId?: string,
  ): ActiveTargetCountRequest | null => {
    const maxTargetCount = typeof script.targetCount === 'number' && Number.isFinite(script.targetCount)
      ? Math.floor(script.targetCount)
      : 0
    const rangeMeters = parseExplicitMultiTargetMoveRangeMeters(script.range)
    if (
      maxTargetCount <= 1
      || rangeMeters == null
      || (script.damaging && !damageFormula && !moveAutomationCanResolveDamageAtRuntime(script))
    ) {
      return null
    }

    return {
      kind: 'target-count',
      userId: user.id,
      moveName: script.moveName,
      script,
      damageFormula,
      frequency,
      rangeMeters,
      maxTargetCount,
      selectedTargetIds: [],
      ...(targetBranchId ? { targetBranchId } : {}),
    }
  }

  const beginTargetCountTargetingForScript = (
    user: SpawnedPokemon,
    script: MoveAutomationScript,
    damageFormula: string | null,
    frequency: string | null,
    targetBranchId?: string,
  ): boolean => {
    const request = targetCountRequestForScript(user, script, damageFormula, frequency, targetBranchId)
    if (!request) return false

    clearMoveAutomationFeedback()
    activeMoveTargetBranchSelection.value = null
    activeMoveTargeting.value = request
    return true
  }

  const clayCannonsOriginAvailable = (userId: string, script: MoveAutomationScript): boolean => {
    const ranged = script.targetMode !== 'self'
      && !script.range.toLowerCase().includes('melee')
      && !['self', 'field'].includes(script.range.trim().toLowerCase())
    return ranged && (map.value?.encounterState?.effects ?? []).some(effect => (
      effect.kind === 'capability'
      && effect.payload.action === 'grant'
      && effect.payload.capabilityId === 'aa063.clay-cannons.virtual-origin'
      && effect.affected.placementIds.includes(userId)
      && effect.suppression.sources.length === 0
    ))
  }

  const beginClayCannonsOriginSelection = (
    user: SpawnedPokemon,
    script: MoveAutomationScript,
    damageFormula: string | null,
    frequency: string | null,
    targetBranchId?: string,
  ): boolean => {
    if (!clayCannonsOriginAvailable(user.id, script)) return false
    clearMoveAutomationFeedback()
    activeMoveTargetBranchSelection.value = null
    activeMoveTargeting.value = {
      kind: 'virtual-origin', userId: user.id, moveName: script.moveName,
      script, damageFormula, frequency, originCell: { ...user.position },
      ...(targetBranchId ? { targetBranchId } : {}),
    }
    return true
  }

  const continueAfterClayCannonsOrigin = (request: ActiveVirtualOriginRequest): boolean => {
    const user = findSpawnedPokemon(request.userId)
    if (!user) return false
    const virtualUser = { ...user, position: { ...request.originCell } }
    const mode = targetBranchSelectionModeForScript(request.script)
    const started = mode === 'target'
      ? beginSingleTargetingForScript(virtualUser, request.script, request.damageFormula, request.frequency, request.targetBranchId)
      : mode === 'target-count'
        ? beginTargetCountTargetingForScript(virtualUser, request.script, request.damageFormula, request.frequency, request.targetBranchId)
        : mode === 'area-confirmation'
          ? beginAreaConfirmationForScript(virtualUser, request.script, request.damageFormula, request.frequency, request.targetBranchId)
          : false
    if (started && activeMoveTargeting.value && activeMoveTargeting.value.kind !== 'virtual-origin') {
      activeMoveTargeting.value = { ...activeMoveTargeting.value, originCell: { ...request.originCell } }
    }
    return started
  }

  const beginSeamlessMoveTargeting = (id: string, moveName: string | null | undefined): boolean => {
    const trimmedMoveName = moveName?.trim()
    if (!trimmedMoveName) return false
    const user = findSpawnedPokemon(id)
    const entry = moveAutomationEntryForUse(id, trimmedMoveName)
    if (!user || !entry) return false
    const script: MoveAutomationScript = entry.script

    if (moveAutomationHasMultipleTargetBranches(script)) {
      clearMoveAutomationFeedback()
      activeMoveTargeting.value = null
      activeMoveTargetBranchSelection.value = {
        userId: id,
        moveName: script.moveName,
        baseScript: script,
        branches: moveAutomationTargetBranches(script),
        damageFormula: script.damaging ? rollFormulaForEntry(entry) : null,
        frequency: frequencyForEntry(entry),
      }
      return true
    }

    if (beginClayCannonsOriginSelection(
      user, script, script.damaging ? rollFormulaForEntry(entry) : null, frequencyForEntry(entry),
    )) return true

    if (
      isSeamlessSelfMoveScript(script)
      || isSeamlessFieldMoveScript(script)
      || script.targetMode === 'hazard'
    ) {
      clearMoveAutomationFeedback()
      activeMoveTargetBranchSelection.value = null
      activeMoveTargeting.value = null
      const request: ActiveSelfMoveRequest = {
        kind: 'self',
        userId: id,
        moveName: script.moveName,
        script,
        damageFormula: null,
        frequency: frequencyForEntry(entry),
      }
      void executeSelfMoveRequest(request, user)
      return true
    }

    if (isSeamlessSingleTargetMoveScript(script)) {
      return beginSingleTargetingForScript(user, script, rollFormulaForEntry(entry), frequencyForEntry(entry))
    }

    if (isSeamlessTargetCountMoveScript(script)) {
      return beginTargetCountTargetingForScript(user, script, rollFormulaForEntry(entry), frequencyForEntry(entry))
    }

    return beginSeamlessAreaConfirmation(id, entry)
  }

  const openMoveAutomation = (input: string | { id: string; moveName?: string | null }) => {
    moveUsageError.value = null
    const id = typeof input === 'string' ? input : input.id
    if (!canControlPlacement(id)) return
    const moveName = typeof input === 'string' ? null : input.moveName?.trim() || null
    if (beginSeamlessMoveTargeting(id, moveName)) return

    clearMoveAutomationFeedback()
    activeMoveTargetBranchSelection.value = null
    activeMoveTargeting.value = null
  }

  const cancelMoveAutomationTargeting = () => {
    activeMoveTargetBranchSelection.value = null
    activeMoveTargeting.value = null
  }

  const moveTargetingRequestIsStillActive = (request: ActiveMoveTargetingRequest): boolean =>
    activeMoveTargeting.value === request

  const appendMoveAutomationLog = (transaction: MoveAutomationTransaction) => {
    if (!map.value) return
    map.value.metadata = appendMoveAutomationLogEntry(map.value.metadata, transaction, {
      now,
      maxLogEntries,
    })
  }

  const dismissSpiteReactionPrompt = (_id: string) => {}
  const applySpiteReactionPrompt = async (_id: string) => {}
  const dismissCuteCharmReactionPrompt = (_id: string) => {}
  const applyCuteCharmReactionPrompt = async (_id: string) => {}
  const dismissPoisonPointReactionPrompt = (_id: string) => {}
  const applyPoisonPointReactionPrompt = async (_id: string) => {}
  const dismissMoxieTriggerPrompt = (_id: string) => {}
  const applyMoxieTriggerPrompt = async (_id: string) => {}
  const dismissCelebrateTriggerPrompt = (_id: string) => {}
  const applyCelebrateTriggerPrompt = (_id: string) => {}

  const faceTokenForTransaction = (transaction: MoveAutomationTransaction) => {
    const user = findSpawnedPokemon(transaction.userId)
    if (!user) return
    const targetIds = transaction.attackedTargetIds
      ?? transaction.hitTargetIds
      ?? [
        ...transaction.hpUpdates.map((update) => update.id),
        ...transaction.combatStageUpdates.map((update) => update.id),
        ...transaction.conditionUpdates.map((update) => update.id),
      ]
    const targets = targetIds
      .filter((id) => id !== transaction.userId)
      .map((id) => findSpawnedPokemon(id))
      .filter((token): token is SpawnedPokemon => Boolean(token))
    faceTokenTowardNearestTarget(user, targets)
  }

  const applyMoveAutomation = async (
    transaction: MoveAutomationTransaction,
    options: { updateFacing?: boolean; script?: MoveAutomationScript } = {},
  ) => {
    if (!map.value || !canControlPlacement(transaction.userId)) return
    if (options.updateFacing !== false) faceTokenForTransaction(transaction)
    for (const update of transaction.hpUpdates) await modifyHp(update, { allowAnyTarget: true })
    for (const update of transaction.combatStageUpdates) await modifyCombatStages(update, { allowAnyTarget: true })
    for (const update of transaction.conditionUpdates) await modifyConditions(update, { allowAnyTarget: true })
    if (canEditMap.value) {
      for (const effect of transaction.fieldEffectsToApply) await applyMoveFieldEffect(effect)
      for (const hazard of transaction.hazardsToAdd) await placeHazard(hazard)
    }
    appendMoveAutomationLog(transaction)
  }

  const showMoveAutomationResolution = (
    feedback: MoveAutomationFeedbackState,
    transaction: MoveAutomationTransaction,
    options: { script?: MoveAutomationScript; applyPersistentTransaction?: boolean } = {},
  ) => {
    flushPendingFeedbackTransaction()
    clearFeedbackTimers()

    const applyPersistentTransaction = options.applyPersistentTransaction !== false
    const hasFinalPhase = moveAutomationFeedbackHasFinalResolutionPhase(feedback)
    const hasEffectivenessPhase = hasFinalPhase && moveAutomationFeedbackHasEffectivenessPhase(feedback)
    let transactionApplied = false
    const feedbackStillCurrent = () => moveAutomationFeedback.value?.id === feedback.id
    const applyTransactionOnce = () => {
      if (!applyPersistentTransaction || transactionApplied) return
      transactionApplied = true
      pendingFeedbackTransactionApplier = null
      void applyMoveAutomation(transaction, { script: options.script })
    }
    const setFeedbackPhase = (phase: MoveAutomationFeedbackState['phase']): boolean => {
      if (!feedbackStillCurrent()) return false
      moveAutomationFeedback.value = { ...feedback, phase }
      return true
    }
    const scheduleFeedbackStep = (delay: number, step: () => void) => {
      feedbackTimers.push(setTimeout(step, delay))
    }

    pendingFeedbackTransactionApplier = applyPersistentTransaction ? applyTransactionOnce : null
    moveAutomationFeedback.value = feedback
    void playDiceRollSound({ dedupeKey: feedback.id })
    scheduleFeedbackStep(D20_ROLL_ANIMATION_MS, () => {
      setFeedbackPhase('hit-roll')
    })

    const outcomeDelay = MOVE_AUTOMATION_FEEDBACK_OUTCOME_DELAY_MS
    scheduleFeedbackStep(outcomeDelay, () => {
      if (!setFeedbackPhase('outcome')) return
      if (!hasFinalPhase) applyTransactionOnce()
    })

    if (hasFinalPhase) {
      const effectivenessDelay = MOVE_AUTOMATION_FEEDBACK_EFFECTIVENESS_DELAY_MS
      if (hasEffectivenessPhase) {
        scheduleFeedbackStep(effectivenessDelay, () => {
          setFeedbackPhase('effectiveness')
        })
      }

      const finalDelay = moveAutomationFeedbackDamagePhaseDelayMs(feedback)
      scheduleFeedbackStep(finalDelay, () => {
        if (!setFeedbackPhase('damage')) return
        applyTransactionOnce()
      })
      scheduleFeedbackStep(finalDelay + FINAL_RESULT_VISIBLE_MS, () => {
        if (feedbackStillCurrent()) moveAutomationFeedback.value = null
      })
      notifyMoveFeedback(feedback)
      return
    }

    scheduleFeedbackStep(outcomeDelay + HIT_RESULT_VISIBLE_MS, () => {
      if (feedbackStillCurrent()) moveAutomationFeedback.value = null
    })
    notifyMoveFeedback(feedback)
  }

  const prependTransactionLogLine = (
    transaction: MoveAutomationTransaction,
    line: string | null | undefined,
  ) => {
    const trimmed = line?.trim()
    if (trimmed) transaction.logLines.unshift(trimmed)
  }

  const normalizedMoveIdentity = (value: string | null | undefined): string => value?.trim().toLowerCase() ?? ''

  const uniqueStrings = (values: readonly string[]): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    for (const value of values) {
      if (seen.has(value)) continue
      seen.add(value)
      out.push(value)
    }
    return out
  }

  const sameStringSet = (left: readonly string[], right: readonly string[]): boolean => {
    if (left.length !== right.length) return false
    const rightSet = new Set(right)
    return left.every((value) => rightSet.has(value))
  }

  const gridAnchorsMatch = (left: GridAnchor | undefined, right: GridAnchor | undefined): boolean => (
    Boolean(left && right && left.x === right.x && left.y === right.y && left.z === right.z)
  )

  const buildSelfAuthoritativeDispatchRequest = (request: ActiveSelfMoveRequest): MoveAutomationAuthoritativeDispatchRequest => {
    const built = buildMoveAutomationResolveIntent({
      kind: 'self',
      actorPlacementId: request.userId,
      moveName: request.moveName,
      targetBranchId: request.targetBranchId,
      originCell: request.originCell,
    })
    return {
      ...built,
      ...(request.script.targetMode === 'field' && map.value
        ? {
            candidateScopePlacementIds: map.value.placements.map(({ id }) => id),
          }
        : {}),
    }
  }

  const buildSingleTargetAuthoritativeDispatchRequest = (
    request: ActiveSingleTargetingRequest,
    targetId: string,
  ): MoveAutomationAuthoritativeDispatchRequest => {
    const built = buildMoveAutomationResolveIntent({
      kind: 'single-target',
      actorPlacementId: request.userId,
      moveName: request.moveName,
      targetBranchId: request.targetBranchId,
      originCell: request.originCell,
      targetPlacementId: targetId,
    })
    return built
  }

  const buildTargetCountAuthoritativeDispatchRequest = (
    request: ActiveTargetCountRequest,
    selectedTargetIds: readonly string[],
  ): MoveAutomationAuthoritativeDispatchRequest => {
    const built = buildMoveAutomationResolveIntent({
      kind: 'target-count',
      actorPlacementId: request.userId,
      moveName: request.moveName,
      targetBranchId: request.targetBranchId,
      originCell: request.originCell,
      targetPlacementIds: selectedTargetIds,
    })
    return built
  }

  const buildAreaAuthoritativeDispatchRequest = (
    request: ActiveAreaConfirmationRequest,
  ): MoveAutomationAuthoritativeDispatchRequest | null => {
    const common = {
      actorPlacementId: request.userId,
      moveName: request.moveName,
      targetBranchId: request.targetBranchId,
      originCell: request.originCell,
      areaTemplateId: request.areaTemplateId,
      excludedTargetPlacementIds: request.excludedTargetIds,
      candidateTargetPlacementIds: request.targetIds,
    }

    if (request.passDestination) {
      if (!request.direction) return null
      return buildMoveAutomationResolveIntent({
        kind: 'pass',
        ...common,
        direction: request.direction,
      })
    }

    return buildMoveAutomationResolveIntent({
      kind: 'area',
      ...common,
      ...(request.aimCenter ? { aimCell: request.aimCenter } : {}),
      ...(!request.aimCenter && request.direction ? { direction: request.direction } : {}),
    })
  }

  const requestedMoveNameMatches = (move: LivePlayResolvedMoveResult, requestedMoveName: string): boolean => {
    const requested = normalizedMoveIdentity(requestedMoveName)
    return [move.moveName, move.canonicalMoveName, move.transaction.moveName]
      .some((candidate) => normalizedMoveIdentity(candidate) === requested)
  }

  const validateAuthoritativeMoveResult = (
    move: LivePlayResolvedMoveResult,
    request: ActiveSelfMoveRequest | ActiveMoveTargetingRequest,
    intent: ResolveMoveIntent,
  ): string | null => {
    if (move.actorPlacementId !== intent.placementId) {
      return `Resolved move actor ${move.actorPlacementId} did not match requested actor ${intent.placementId}.`
    }
    if (move.transaction.userId !== intent.placementId) {
      return `Resolved move transaction user ${move.transaction.userId} did not match requested actor ${intent.placementId}.`
    }
    if (!requestedMoveNameMatches(move, intent.moveName)) {
      return `Resolved move ${move.moveName} did not match requested move ${intent.moveName}.`
    }
    if ((move.targetBranchId ?? null) !== (intent.targetBranchId ?? null)) {
      return 'Resolved move target branch did not match the selected branch.'
    }

    if (intent.selection.kind === 'self' && move.selectedTargetIds.length > 0) {
      return 'Resolved self move unexpectedly selected targets.'
    }

    if (
      intent.selection.kind === 'single-target'
      && !sameStringSet([...move.selectedTargetIds], [intent.selection.targetPlacementId])
    ) {
      return `Resolved move targets did not exactly match selected target ${intent.selection.targetPlacementId}.`
    }

    if (
      intent.selection.kind === 'target-count'
      && !sameStringSet([...move.selectedTargetIds], [...intent.selection.targetPlacementIds])
    ) {
      return 'Resolved target-count move targets did not match the selected targets.'
    }

    const requestIsPass = request.kind === 'area-confirmation' && Boolean(request.passDestination)
    if (requestIsPass && move.movement?.kind !== 'pass') {
      return 'Resolved Pass move did not include Pass movement.'
    }
    if (!requestIsPass && move.movement) {
      return 'Resolved non-Pass move unexpectedly included actor movement.'
    }

    if (intent.selection.kind === 'area') {
      if (!move.area) return 'Resolved area move did not include area presentation data.'
      if (move.area.areaTemplateId !== intent.selection.areaTemplateId) {
        return 'Resolved area template did not match the selected template.'
      }
      if (intent.selection.direction && move.area.direction !== intent.selection.direction) {
        return 'Resolved area direction did not match the selected direction.'
      }
      if (intent.selection.aimCell && !gridAnchorsMatch(move.area.aimCell, intent.selection.aimCell)) {
        return 'Resolved area aim cell did not match the selected aim cell.'
      }
      if (!sameStringSet(
        [...move.area.excludedTargetIds],
        [...(intent.selection.excludedTargetPlacementIds ?? [])],
      )) {
        return 'Resolved area exclusions did not match the selected exclusions.'
      }
      if (requestIsPass && move.movement && move.movement.direction !== intent.selection.direction) {
        return 'Resolved Pass movement direction did not match the selected direction.'
      }
    }

    return null
  }

  const requiredAuthoritativeSnapshotTokenIds = (move: LivePlayResolvedMoveResult): string[] => uniqueStrings([
    move.actorPlacementId,
    move.transaction.userId,
    ...move.selectedTargetIds,
    ...(move.area?.candidateTargetIds ?? []),
    ...(move.transaction.attackedTargetIds ?? []),
    ...(move.transaction.hitTargetIds ?? []),
    ...move.transaction.hpUpdates.map((update) => update.id),
    ...move.transaction.combatStageUpdates.map((update) => update.id),
    ...move.transaction.conditionUpdates.map((update) => update.id),
  ])

  const targetOutcomesForAuthoritativeTargets = (
    targets: readonly SpawnedPokemon[],
    transaction: MoveAutomationTransaction,
  ): MoveAnimationPlanTargetOutcome[] => targets.map((target) => confirmedTargetOutcomeForTransaction(target, transaction))

  const planAuthoritativeMoveAnimations = (
    move: LivePlayResolvedMoveResult,
    snapshot: MoveAutomationPresentationSnapshot,
    intent: ResolveMoveIntent,
    request: ActiveSelfMoveRequest | ActiveMoveTargetingRequest,
  ): { readonly ok: true; readonly userId: string; readonly events: readonly MoveAnimationEvent[] } | { readonly ok: false; readonly message: string } => {
    const missing = missingSnapshotTokenIds(snapshot, requiredAuthoritativeSnapshotTokenIds(move))
    if (missing.length) {
      return { ok: false, message: `Pre-move token snapshot was missing: ${missing.join(', ')}.` }
    }

    const snapshotUser = snapshotToken(snapshot, move.actorPlacementId)
    if (!snapshotUser) return { ok: false, message: `Pre-move actor ${move.actorPlacementId} was not available for presentation.` }
    const user = intent.originCell
      ? { ...snapshotUser, position: { ...intent.originCell } }
      : snapshotUser

    try {
      if (intent.selection.kind === 'self') {
        return {
          ok: true,
          userId: user.id,
          events: planMoveAnimations({
            resolution: MOVE_ANIMATION_PLAN_RESOLUTION.self,
            user,
            targets: [],
            selectedTargetIds: [],
            script: move.script,
            transaction: move.transaction,
            timing: {
              nowMs: moveAnimationNowMs(),
              animationIdBase: nextMoveAnimationPlanIdBase('self-authoritative', move.script, user),
            },
          }),
        }
      }

      if (intent.selection.kind === 'single-target') {
        const targets = snapshotTokensForIds(snapshot, [...move.selectedTargetIds])
        const feedbackVfxTiming = move.feedback ? moveAutomationFeedbackVfxTiming(move.feedback) : null
        return {
          ok: true,
          userId: user.id,
          events: planMoveAnimations({
            resolution: MOVE_ANIMATION_PLAN_RESOLUTION.singleTarget,
            user,
            targets,
            selectedTargetIds: [...move.selectedTargetIds],
            script: move.script,
            ...(move.feedback ? { feedback: move.feedback } : {}),
            transaction: move.transaction,
            targetOutcomes: move.feedback
              ? targetOutcomesForFeedback(move.feedback)
              : targetOutcomesForAuthoritativeTargets(targets, move.transaction),
            timing: {
              nowMs: moveAnimationNowMs(),
              animationIdBase: nextMoveAnimationPlanIdBase('single-target-authoritative', move.script, user),
              ...(feedbackVfxTiming
                ? {
                    baseDelayMs: feedbackVfxTiming.launchDelayMs,
                    impactDelayMs: feedbackVfxTiming.impactDelayMs,
                    semanticDelayMs: feedbackVfxTiming.semanticDelayMs,
                  }
                : {}),
            },
          }),
        }
      }

      if (intent.selection.kind === 'target-count') {
        const targets = snapshotTokensForIds(snapshot, [...move.selectedTargetIds])
        return {
          ok: true,
          userId: user.id,
          events: planMoveAnimations({
            resolution: MOVE_ANIMATION_PLAN_RESOLUTION.multiTarget,
            user,
            targets,
            selectedTargetIds: [...move.selectedTargetIds],
            script: move.script,
            transaction: move.transaction,
            targetOutcomes: targetOutcomesForAuthoritativeTargets(targets, move.transaction),
            timing: {
              nowMs: moveAnimationNowMs(),
              animationIdBase: nextMoveAnimationPlanIdBase('multi-target-authoritative', move.script, user),
            },
          }),
        }
      }

      if (!move.area) return { ok: false, message: 'Resolved area move did not include area cells for presentation.' }
      const isPass = request.kind === 'area-confirmation' && Boolean(request.passDestination)
      if (isPass && !move.movement) return { ok: false, message: 'Resolved Pass move did not include movement for presentation.' }
      const targets = snapshotTokensForIds(snapshot, [...move.area.candidateTargetIds])
      const areaCells = isPass ? [...(move.movement?.pathCells ?? [])] : [...move.area.cells]
      return {
        ok: true,
        userId: user.id,
        events: planMoveAnimations({
          resolution: MOVE_ANIMATION_PLAN_RESOLUTION.area,
          user,
          targets,
          selectedTargetIds: [...move.selectedTargetIds],
          script: move.script,
          transaction: move.transaction,
          targetOutcomes: targetOutcomesForAuthoritativeTargets(targets, move.transaction),
          areaCells,
          ...(move.movement?.direction ?? move.area.direction ? { areaDirection: move.movement?.direction ?? move.area.direction } : {}),
          ...(move.area.excludedTargetIds.length ? { excludedTargetIds: [...move.area.excludedTargetIds] } : {}),
          ...(move.movement ? { passDestination: move.movement.destination } : {}),
          timing: {
            nowMs: moveAnimationNowMs(),
            animationIdBase: nextMoveAnimationPlanIdBase('area-authoritative', move.script, user),
          },
        }),
      }
    } catch (error) {
      return {
        ok: false,
        message: getErrorMessage(error, { fallback: 'Move presentation animations could not be planned.' }),
      }
    }
  }

  const presentAuthoritativeMove = ({
    move,
    snapshot,
    request,
    intent,
    skipMoveAnimations = false,
  }: MoveAutomationAuthoritativePresentationInput & {
    readonly skipMoveAnimations?: boolean
  }): { readonly ok: true } | { readonly ok: false; readonly message: string } => {
    const validationError = validateAuthoritativeMoveResult(move, request, intent)
    if (validationError) return { ok: false, message: validationError }

    const animationPlan = skipMoveAnimations
      ? null
      : planAuthoritativeMoveAnimations(move, snapshot, intent, request)
    if (animationPlan && !animationPlan.ok) return animationPlan

    if (animationPlan?.ok) enqueuePlannedMoveAnimations(animationPlan.userId, animationPlan.events)
    if (move.feedback) {
      showMoveAutomationResolution(move.feedback, move.transaction, {
        script: move.script,
        applyPersistentTransaction: false,
      })
    }
    return { ok: true }
  }

  const postAcceptanceCallbackWarning = (label: string, error: unknown): string => (
    `${label} failed after the move was accepted: ${getErrorMessage(error, { fallback: 'callback failed.' })}`
  )

  const runAuthoritativePostAcceptanceCallbacks = async (
    request: ActiveSelfMoveRequest | ActiveMoveTargetingRequest,
    targetIds: readonly string[],
    options: { skipActionNotifications?: boolean } = {},
  ): Promise<string[]> => {
    const warnings: string[] = []

    try {
      const notification = notifyMoveUse(request)
      if (isPromiseLike(notification)) await notification
    } catch (error) {
      warnings.push(postAcceptanceCallbackWarning('Move-use notification', error))
    }

    if (options.skipActionNotifications) return warnings

    try {
      const actionNotification = notifyMoveActionTaken(request)
      if (isPromiseLike(actionNotification)) await actionNotification
    } catch (error) {
      warnings.push(postAcceptanceCallbackWarning('Action notification', error))
    }

    if (request.kind !== 'self') {
      try {
        const rangedAoONotification = notifyRangedAttackOfOpportunity(request, targetIds)
        if (isPromiseLike(rangedAoONotification)) await rangedAoONotification
      } catch (error) {
        warnings.push(postAcceptanceCallbackWarning('Ranged attack-of-opportunity notification', error))
      }
    }

    return warnings
  }

  const acceptedMoveWarningMessage = (messages: readonly string[]): string | null => {
    const filtered = messages.map((message) => message.trim()).filter(Boolean)
    return filtered.length ? `Move was accepted, but ${filtered.join(' ')}` : null
  }

  const handledAuthoritativeDispatch = async (options: {
    readonly request: ActiveSelfMoveRequest | ActiveMoveTargetingRequest
    readonly dispatchRequest: MoveAutomationAuthoritativeDispatchRequest
    readonly targetIdsForCallbacks?: readonly string[]
    readonly skipActionNotifications?: boolean
    readonly requireActiveTargeting?: boolean
  }): Promise<{ readonly handled: false } | { readonly handled: true; readonly accepted: boolean }> => {
    if (!dispatchAuthoritativeMove) return { handled: false }
    moveUsageError.value = null
    if (moveDispatchPending.value) return { handled: true, accepted: false }
    if (options.requireActiveTargeting && !moveTargetingRequestIsStillActive(options.request as ActiveMoveTargetingRequest)) {
      return { handled: true, accepted: false }
    }

    const snapshot = captureMoveAutomationPresentationSnapshot(options.request.userId)
    moveDispatchPending.value = true
    let outcome: MoveAutomationAuthoritativeDispatchOutcome | undefined
    try {
      outcome = await dispatchAuthoritativeMove(options.dispatchRequest)
    } catch (error) {
      moveUsageError.value = getErrorMessage(error, { fallback: 'Authoritative move dispatch failed.' })
      return { handled: true, accepted: false }
    } finally {
      moveDispatchPending.value = false
    }

    if (outcome === undefined) return { handled: false }

    if (!outcome.accepted) {
      moveUsageError.value = outcome.message?.trim() || 'Authoritative move was not accepted.'
      return { handled: true, accepted: false }
    }

    if (activeMoveTargeting.value === options.request) activeMoveTargeting.value = null
    if (activeMoveTargetBranchSelection.value?.userId === options.request.userId) activeMoveTargetBranchSelection.value = null

    const validatedAuthoritativeTargetIds = outcome.move
      && !validateAuthoritativeMoveResult(outcome.move, options.request, options.dispatchRequest.intent)
      ? [...outcome.move.selectedTargetIds]
      : null
    const callbackWarnings = await runAuthoritativePostAcceptanceCallbacks(
      options.request,
      validatedAuthoritativeTargetIds ?? options.targetIdsForCallbacks ?? [],
      { skipActionNotifications: options.skipActionNotifications },
    )
    const presentationWarnings: string[] = []
    if (outcome.presentationError?.trim()) presentationWarnings.push(outcome.presentationError.trim())

    if (!outcome.move) {
      presentationWarnings.unshift('presentation data is unavailable.')
    } else {
      const presentation = presentAuthoritativeMove({
        move: outcome.move,
        snapshot,
        request: options.request,
        intent: options.dispatchRequest.intent,
        skipMoveAnimations: outcome.presentationHandled === true,
      })
      if (!presentation.ok) presentationWarnings.unshift(presentation.message)
    }

    const warning = acceptedMoveWarningMessage([...presentationWarnings, ...callbackWarnings])
    if (warning) moveUsageError.value = warning
    return { handled: true, accepted: true }
  }

  const executeSelfMoveRequest = async (
    request: ActiveSelfMoveRequest,
    user: SpawnedPokemon,
  ): Promise<boolean> => {
    if (!canContinueMoveAutomationForUser(request.userId)) return false

    if (dispatchAuthoritativeMove) {
      const authoritative = await handledAuthoritativeDispatch({
        request,
        dispatchRequest: buildSelfAuthoritativeDispatchRequest(request),
      })
      if (authoritative.handled) return authoritative.accepted
    }

    if (request.script.targetMode === 'hazard') {
      moveUsageError.value = 'Hazard placement requires the authoritative durable cell-selection flow.'
      return false
    }

    const recorded = await recordMoveUseIfTracked({ placementId: request.userId, moveName: request.moveName }, request.frequency)
    if (!recorded || !canContinueMoveAutomationForUser(request.userId)) return false
    const notification = notifyMoveUse(request)
    if (isPromiseLike(notification)) await notification
    if (!canContinueMoveAutomationForUser(request.userId)) return false
    const actionNotification = notifyMoveActionTaken(request)
    if (isPromiseLike(actionNotification)) await actionNotification
    if (!canContinueMoveAutomationForUser(request.userId)) return false
    const transaction = resolveInstantSelfMoveAutomation({
      script: request.script,
      user,
      fieldEffects: map.value?.fieldEffects,
    })
    planAndEnqueueSelfMoveAnimations({ script: request.script, user, transaction })
    await applyMoveAutomation(transaction, { script: request.script })
    return true
  }

  const executeSingleTargetMoveRequest = async (
    request: ActiveSingleTargetingRequest,
    targetId: string,
    options: { skipActionNotifications?: boolean; logLine?: string; requireActiveTargeting?: boolean } = {},
  ): Promise<boolean> => {
    if (!canContinueMoveAutomationForUser(request.userId)) return false
    const user = findSpawnedPokemon(request.userId)
    const target = findSpawnedPokemon(targetId)
    if (!user || !target) return false

    if (dispatchAuthoritativeMove) {
      const authoritative = await handledAuthoritativeDispatch({
        request,
        dispatchRequest: buildSingleTargetAuthoritativeDispatchRequest(request, targetId),
        targetIdsForCallbacks: [targetId],
        skipActionNotifications: options.skipActionNotifications,
        requireActiveTargeting: options.requireActiveTargeting,
      })
      if (authoritative.handled) return authoritative.accepted
    }

    const recorded = await recordMoveUseIfTracked(
      { placementId: request.userId, moveName: request.moveName },
      request.frequency,
    )
    if (!recorded || !canContinueMoveAutomationForUser(request.userId)) return false
    if (options.requireActiveTargeting && !moveTargetingRequestIsStillActive(request)) return false

    activeMoveTargeting.value = null
    const notification = notifyMoveUse(request)
    if (isPromiseLike(notification)) await notification
    if (!canContinueMoveAutomationForUser(request.userId)) return false

    if (!options.skipActionNotifications) {
      const actionNotification = notifyMoveActionTaken(request)
      if (isPromiseLike(actionNotification)) await actionNotification
      if (!canContinueMoveAutomationForUser(request.userId)) return false
      const rangedAoONotification = notifyRangedAttackOfOpportunity(request, [targetId])
      if (isPromiseLike(rangedAoONotification)) await rangedAoONotification
      if (!canContinueMoveAutomationForUser(request.userId)) return false
    }

    faceTokenTowardToken(user, target)

    if (!request.script.requiresAccuracy) {
      const transaction = resolveInstantTargetMoveAutomation({
        script: request.script,
        user,
        target,
        damageFormula: request.damageFormula,
        fieldEffects: map.value?.fieldEffects,
      })
      prependTransactionLogLine(transaction, options.logLine)
      planAndEnqueueConfirmedSingleTargetMoveAnimations({
        script: request.script,
        user,
        target,
        transaction,
      })
      await applyMoveAutomation(transaction, { script: request.script })
      return true
    }

    const result = resolveInstantMoveAutomation({
      script: request.script,
      user,
      target,
      damageFormula: request.damageFormula,
      fieldEffects: map.value?.fieldEffects,
    })
    prependTransactionLogLine(result.transaction, options.logLine)
    planAndEnqueueSingleTargetMoveAnimations({
      script: request.script,
      user,
      target,
      feedback: result.feedback,
      transaction: result.transaction,
    })
    showMoveAutomationResolution(result.feedback, result.transaction, { script: request.script })
    return true
  }

  const singleTargetRequestForMove = (
    id: string,
    moveName: string,
  ): ActiveSingleTargetingRequest | null => {
    const user = findSpawnedPokemon(id)
    const entry = moveAutomationEntryForUse(id, moveName)
    if (!user || !entry || !isSeamlessSingleTargetMoveScript(entry.script)) return null

    return singleTargetRequestForScript(
      user,
      entry.script,
      rollFormulaForEntry(entry),
      frequencyForEntry(entry),
    )
  }

  const useMoveAgainstTarget = async (input: {
    id: string
    targetId: string
    moveName: string
    skipActionNotifications?: boolean
    logLine?: string
  }): Promise<boolean> => {
    if (!canControlPlacement(input.id)) return false
    const request = singleTargetRequestForMove(input.id, input.moveName)
    if (!request) return false
    return executeSingleTargetMoveRequest(request, input.targetId, {
      skipActionNotifications: input.skipActionNotifications,
      logLine: input.logLine,
    })
  }

  const selectMoveAutomationTargetBranch = (branchId: string) => {
    if (moveDispatchPending.value) return
    const request = activeMoveTargetBranchSelection.value
    if (!request || !canContinueMoveAutomationForUser(request.userId)) return
    const user = findSpawnedPokemon(request.userId)
    const branch = request.branches.find((item) => item.id === branchId)
    const script = branch ? moveAutomationScriptForTargetBranch(request.baseScript, branch) : null
    if (!user || !branch || !script) return
    if (unsupportedTargetBranchReason(script, user, request.damageFormula)) return
    if (beginClayCannonsOriginSelection(
      user, script, request.damageFormula, request.frequency, branch.id,
    )) return

    const mode = targetBranchSelectionModeForScript(script)
    if (mode === 'target') {
      beginSingleTargetingForScript(user, script, request.damageFormula, request.frequency, branch.id)
      return
    }

    if (mode === 'target-count') {
      beginTargetCountTargetingForScript(user, script, request.damageFormula, request.frequency, branch.id)
      return
    }

    if (mode === 'area-confirmation') {
      beginAreaConfirmationForScript(user, script, request.damageFormula, request.frequency, branch.id)
    }
  }

  const activeAreaRequestWithPlacement = (
    request: ActiveAreaConfirmationRequest,
    placement: MoveAutomationAreaTemplatePlacement,
  ): ActiveAreaConfirmationRequest => {
    const areaTemplateId = placementTemplateId(placement)
    const aimFields = areaAimFieldsForPlacement(placement)
    const freeAim = Boolean(aimFields.aimCenter)
    return {
      ...request,
      label: placement.label,
      cells: placement.cells,
      targetIds: placement.targetIds,
      excludedTargetIds: [],
      direction: freeAim ? undefined : placement.direction,
      directionOptions: freeAim ? [] : directionOptionsForPlacements(placementsForAreaTemplate(request.placements, areaTemplateId)),
      areaTemplateId,
      ...aimFields,
      passDestination: placement.destination,
    }
  }

  const activeAreaRequestWithRangedBlastCenter = (
    request: ActiveAreaConfirmationRequest,
    user: SpawnedPokemon,
    template: MoveAutomationAreaTemplate,
    center: GridAnchor,
  ): ActiveAreaConfirmationRequest | null => {
    const placement = buildMoveAutomationAreaTemplatePlacementAtCenter({
      template,
      user,
      tokens: spawnedPokemon.value,
      center,
      includeEmpty: true,
      ...areaTemplateCellConstraints(),
    })
    if (!placement) return null

    return activeAreaRequestWithPlacement(request, placement)
  }

  const activeAreaRequestWithCloseBlastAimCell = (
    request: ActiveAreaConfirmationRequest,
    user: SpawnedPokemon,
    template: MoveAutomationAreaTemplate,
    aimCell: GridAnchor,
  ): ActiveAreaConfirmationRequest | null => {
    const placement = buildMoveAutomationCloseBlastPlacementAtAimCell({
      template,
      user,
      tokens: spawnedPokemon.value,
      aimCell,
      includeEmpty: true,
      ...areaTemplateCellConstraints(),
    })
    if (!placement) return null

    return activeAreaRequestWithPlacement(request, placement)
  }

  const fallbackAreaRequestForTemplate = (
    request: ActiveAreaConfirmationRequest,
    user: SpawnedPokemon,
    templateId: string,
  ): ActiveAreaConfirmationRequest | null => {
    const template = request.script.areaTemplates?.find((item) => moveAutomationAreaTemplateId(item) === templateId)
    if (!template || template.kind === 'pass') return null
    if (template.kind === 'ranged-blast') {
      return activeAreaRequestWithRangedBlastCenter(request, user, template, request.aimCenter ?? tokenCenterCell(user))
    }

    if (template.kind === 'close-blast') {
      const placement = initialCloseBlastPlacementForTemplate(user, template)
      return placement ? activeAreaRequestWithPlacement(request, placement) : null
    }

    const direction = template.kind === 'cone' || template.kind === 'line'
      ? request.direction ?? tokenAreaDirection(user)
      : undefined
    const cells = buildMoveAutomationAreaTemplateCells({
      template,
      user,
      direction,
      ...areaTemplateCellConstraints(),
    })
    const targetIds = tokensInMoveAutomationArea({
      cells,
      tokens: spawnedPokemon.value,
      excludeIds: [user.id],
    }).map((token) => token.id)

    return {
      ...request,
      label: template.label,
      cells,
      targetIds,
      excludedTargetIds: [],
      direction,
      directionOptions: [],
      areaTemplateId: templateId,
      aimCenter: undefined,
      aimRangeMeters: undefined,
      passDestination: undefined,
    }
  }

  const areaPlacementForTemplateChoice = (
    request: ActiveAreaConfirmationRequest,
    user: SpawnedPokemon,
    templateId: string,
  ): MoveAutomationAreaTemplatePlacement | null => {
    const templatePlacements = placementsForAreaTemplate(request.placements, templateId)
    if (!templatePlacements.length) return null
    if (request.direction) {
      const sameDirection = templatePlacements.find((placement) => placement.direction === request.direction)
      if (sameDirection) return sameDirection
    }
    return areaPlacementForTokenFacing(templatePlacements, user)
  }

  const selectMoveAutomationAreaTemplate = (templateId: string) => {
    if (moveDispatchPending.value) return
    const request = activeMoveTargeting.value
    if (request?.kind !== 'area-confirmation' || request.areaTemplateId === templateId) return
    if (!request.areaTemplateOptions.some((option) => option.id === templateId)) return
    const user = findSpawnedPokemon(request.userId)
    if (!user) return

    const placement = areaPlacementForTemplateChoice(request, user, templateId)
    const nextRequest = placement
      ? activeAreaRequestWithPlacement(request, placement)
      : fallbackAreaRequestForTemplate(request, user, templateId)
    if (nextRequest) activeMoveTargeting.value = nextRequest
  }

  const selectMoveAutomationAreaDirection = (direction: MoveAutomationAreaDirection) => {
    if (moveDispatchPending.value) return
    const request = activeMoveTargeting.value
    if (request?.kind !== 'area-confirmation') return
    const option = request.directionOptions.find((item) => item.direction === direction)
    if (!option) return
    activeMoveTargeting.value = {
      ...request,
      label: option.label,
      cells: option.areaCells,
      targetIds: option.affectedIds,
      direction: option.direction,
      aimCenter: undefined,
      aimRangeMeters: undefined,
      passDestination: option.destination,
    }
  }

  const toggleMoveAutomationAreaTarget = (request: ActiveAreaConfirmationRequest, targetId: string) => {
    if (moveDispatchPending.value) return
    const excluded = new Set(request.excludedTargetIds)
    if (excluded.has(targetId)) excluded.delete(targetId)
    else excluded.add(targetId)
    activeMoveTargeting.value = {
      ...request,
      excludedTargetIds: Array.from(excluded),
    }
  }

  const toggleMoveAutomationTargetCountTarget = (
    request: ActiveTargetCountRequest,
    targetId: string,
    candidateIds: readonly string[],
  ) => {
    if (moveDispatchPending.value) return
    if (!candidateIds.includes(targetId)) return
    const selected = selectedTargetCountIds(request, candidateIds)
    const next = new Set(selected)
    if (next.has(targetId)) next.delete(targetId)
    else if (next.size < request.maxTargetCount) next.add(targetId)
    activeMoveTargeting.value = {
      ...request,
      selectedTargetIds: Array.from(next),
    }
  }

  const targetCountTargetsForIds = (targetIds: readonly string[]): SpawnedPokemon[] => targetIds
    .map((id) => findSpawnedPokemon(id))
    .filter((token): token is SpawnedPokemon => Boolean(token))

  const selectedAreaTemplateForRequest = (
    request: ActiveAreaConfirmationRequest,
  ): MoveAutomationAreaTemplate | null => {
    const placementTemplate = request.placements.find((placement) => placementTemplateId(placement) === request.areaTemplateId)?.template
    return placementTemplate
      ?? request.script.areaTemplates?.find((template) => moveAutomationAreaTemplateId(template) === request.areaTemplateId)
      ?? null
  }

  const aimMoveAutomationArea = (aimCell: GridAnchor) => {
    if (moveDispatchPending.value) return
    const request = activeMoveTargeting.value
    if (request?.kind === 'virtual-origin') {
      activeMoveTargeting.value = { ...request, originCell: { ...aimCell } }
      return
    }
    if (request?.kind !== 'area-confirmation') return
    const user = findSpawnedPokemon(request.userId)
    const template = selectedAreaTemplateForRequest(request)
    if (!user || !template) return

    const nextRequest = template.kind === 'ranged-blast'
      ? activeAreaRequestWithRangedBlastCenter(request, user, template, aimCell)
      : template.kind === 'close-blast'
        ? activeAreaRequestWithCloseBlastAimCell(request, user, template, aimCell)
        : null
    if (nextRequest) activeMoveTargeting.value = nextRequest
  }

  const scriptForConfirmedAreaRequest = (request: ActiveAreaConfirmationRequest): MoveAutomationScript => {
    const template = selectedAreaTemplateForRequest(request)
    return template
      ? moveAutomationScriptForConfirmedAreaTemplate(request.script, template, {
          alternativeTemplateLabels: request.areaTemplateOptions.map((option) => option.label),
        })
      : request.script
  }

  const confirmMoveAutomationTargetCountRequest = async (request: ActiveTargetCountRequest) => {
    if (!canContinueMoveAutomationForUser(request.userId)) return
    const user = findSpawnedPokemon(request.userId)
    if (!user) return
    const targetingUser = request.originCell ? { ...user, position: { ...request.originCell } } : user
    const selectedTargetIds = selectedTargetCountIds(request, targetCountCandidateIds(request, targetingUser))
    if (!selectedTargetIds.length) return

    if (dispatchAuthoritativeMove) {
      const authoritative = await handledAuthoritativeDispatch({
        request,
        dispatchRequest: buildTargetCountAuthoritativeDispatchRequest(request, selectedTargetIds),
        targetIdsForCallbacks: selectedTargetIds,
        requireActiveTargeting: true,
      })
      if (authoritative.handled) return
    }

    const recorded = await recordMoveUseIfTracked(
      { placementId: request.userId, moveName: request.moveName },
      request.frequency,
    )
    if (!recorded || !canContinueMoveAutomationForUser(request.userId)) return
    if (!moveTargetingRequestIsStillActive(request)) return
    activeMoveTargeting.value = null
    const notification = notifyMoveUse(request)
    if (isPromiseLike(notification)) await notification
    if (!canContinueMoveAutomationForUser(request.userId)) return
    const actionNotification = notifyMoveActionTaken(request)
    if (isPromiseLike(actionNotification)) await actionNotification
    if (!canContinueMoveAutomationForUser(request.userId)) return
    const rangedAoONotification = notifyRangedAttackOfOpportunity(request, selectedTargetIds)
    if (isPromiseLike(rangedAoONotification)) await rangedAoONotification
    if (!canContinueMoveAutomationForUser(request.userId)) return

    const targets = targetCountTargetsForIds(selectedTargetIds)
    if (!targets.length) return
    faceTokenTowardNearestTarget(user, targets)

    const transaction = resolveInstantMultiTargetMoveAutomation({
      script: request.script,
      user,
      selectedTargets: targets,
      damageFormula: request.damageFormula,
      fieldEffects: map.value?.fieldEffects,
    })
    planAndEnqueueMultiTargetMoveAnimations({
      script: request.script,
      user,
      targets,
      selectedTargetIds,
      transaction,
    })
    await applyMoveAutomation(transaction, { script: request.script })
  }

  const confirmMoveAutomationArea = async (request: ActiveAreaConfirmationRequest) => {
    if (!canContinueMoveAutomationForUser(request.userId)) return
    const user = findSpawnedPokemon(request.userId)
    if (!user) return
    const selectedTargetIds = selectedAreaTargetIds(request)
    if (dispatchAuthoritativeMove) {
      const dispatchRequest = buildAreaAuthoritativeDispatchRequest(request)
      if (!dispatchRequest) {
        moveUsageError.value = 'Pass move direction is unavailable.'
        return
      }
      const authoritative = await handledAuthoritativeDispatch({
        request,
        dispatchRequest,
        targetIdsForCallbacks: selectedTargetIds,
        requireActiveTargeting: true,
      })
      if (authoritative.handled) return
    }

    const recorded = await recordMoveUseIfTracked(
      { placementId: request.userId, moveName: request.moveName },
      request.frequency,
    )
    if (!recorded || !canContinueMoveAutomationForUser(request.userId)) return
    if (!moveTargetingRequestIsStillActive(request)) return
    activeMoveTargeting.value = null
    const notification = notifyMoveUse(request)
    if (isPromiseLike(notification)) await notification
    if (!canContinueMoveAutomationForUser(request.userId)) return
    const actionNotification = notifyMoveActionTaken(request)
    if (isPromiseLike(actionNotification)) await actionNotification
    if (!canContinueMoveAutomationForUser(request.userId)) return
    const targetSet = new Set(selectedTargetIds)
    const targets = spawnedPokemon.value.filter((token) => targetSet.has(token.id))
    if (request.direction) faceTokenTowardAreaDirection(user, request.direction)
    else faceTokenTowardNearestTarget(user, targets)

    const confirmedScript = scriptForConfirmedAreaRequest(request)
    const transaction = resolveInstantAreaMoveAutomation({
      script: confirmedScript,
      user,
      targets,
      damageFormula: request.damageFormula,
      fieldEffects: map.value?.fieldEffects,
    })
    const destinationLogLine = request.passDestination ? passDestinationLogLine(user, request.passDestination) : null
    if (destinationLogLine) transaction.logLines.push(destinationLogLine)
    planAndEnqueueAreaMoveAnimations({
      script: confirmedScript,
      user,
      targets,
      selectedTargetIds,
      excludedTargetIds: request.excludedTargetIds,
      areaCells: request.cells,
      ...(request.direction ? { areaDirection: request.direction } : {}),
      ...(request.passDestination ? { passDestination: request.passDestination } : {}),
      transaction,
    })
    await applyMoveAutomation(transaction, { updateFacing: !request.direction, script: confirmedScript })
    await moveTokenToPassDestination(request.userId, request.passDestination)
  }

  const confirmMoveAutomationTargetCount = async () => {
    const request = activeMoveTargeting.value
    if (request?.kind !== 'target-count') return
    await confirmMoveAutomationTargetCountRequest(request)
  }

  const selectMoveAutomationTarget = async (targetId: string) => {
    const request = activeMoveTargeting.value
    const overlay = moveAutomationTargeting.value
    if (!request) return

    if (request.kind === 'virtual-origin') {
      continueAfterClayCannonsOrigin(request)
      return
    }
    if (request.kind === 'area-confirmation') {
      if (!overlay) return
      if (canToggleAreaTargets(request.script) && request.targetIds.includes(targetId)) {
        toggleMoveAutomationAreaTarget(request, targetId)
        return
      }
      await confirmMoveAutomationArea(request)
      return
    }

    if (request.kind === 'target-count') {
      if (!overlay) return
      if (overlay.candidateIds.includes(targetId)) {
        toggleMoveAutomationTargetCountTarget(request, targetId, overlay.candidateIds)
      }
      return
    }

    if (!overlay?.candidateIds.includes(targetId)) return
    await executeSingleTargetMoveRequest(request, targetId, { requireActiveTargeting: true })
  }

  onBeforeUnmount(() => {
    flushPendingFeedbackTransaction()
    clearFeedbackTimers()
  })

  return {
    moveAutomationTargeting,
    moveAutomationTargetBranchSelection,
    moveAutomationFeedback,
    moveUsageError,
    moveDispatchPending,
    spiteReactionPrompts,
    cuteCharmReactionPrompts,
    poisonPointReactionPrompts,
    moxieTriggerPrompts,
    celebrateTriggerPrompts,
    tokenMoveOptionsById,
    openMoveAutomation,
    useMoveAgainstTarget,
    cancelMoveAutomationTargeting,
    selectMoveAutomationTarget,
    confirmMoveAutomationTargetCount,
    selectMoveAutomationTargetBranch,
    selectMoveAutomationAreaTemplate,
    selectMoveAutomationAreaDirection,
    aimMoveAutomationArea,
    dismissSpiteReactionPrompt,
    applySpiteReactionPrompt,
    dismissCuteCharmReactionPrompt,
    applyCuteCharmReactionPrompt,
    dismissPoisonPointReactionPrompt,
    applyPoisonPointReactionPrompt,
    dismissMoxieTriggerPrompt,
    applyMoxieTriggerPrompt,
    dismissCelebrateTriggerPrompt,
    applyCelebrateTriggerPrompt,
    appendMoveAutomationLog,
    applyMoveAutomation,
  }
}

export type { SheetUpdateOptions }
