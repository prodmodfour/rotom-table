<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, watchEffect } from 'vue'
import FieldEffectsMenuModal from '~/components/map/FieldEffectsMenuModal.vue'
import InitiativeMenuModal from '~/components/map/InitiativeMenuModal.vue'
import MapAdminPanel from '~/components/map/MapAdminPanel.vue'
import LivePlayCommandRecoveryPanel from '~/components/map/LivePlayCommandRecoveryPanel.vue'
import LivePlayLatencyDebugPanel from '~/components/map/LivePlayLatencyDebugPanel.vue'
import MapEditorLayout from '~/components/map/MapEditorLayout.vue'
import MapNavigationRail from '~/components/map/MapNavigationRail.vue'
import MapPresencePanel from '~/components/map/MapPresencePanel.vue'
import MapScenePanel from '~/components/map/MapScenePanel.vue'
import PokeballCaptureResultModal from '~/components/map/PokeballCaptureResultModal.vue'
import SheetsMenuModal from '~/components/map/SheetsMenuModal.vue'
import StartTurnModal from '~/components/map/StartTurnModal.vue'
import {
  useEditableMap,
  type LivePlayAcceptedEventAdoptionInfo,
  type MapSaveStatus,
} from '~/composables/useEditableMap'
import { useLiveSheets } from '~/composables/useLiveSheets'
import {
  movePresentationFromAcceptedRealtimeEvent,
  pokeballCaptureFromAcceptedRealtimeEvent,
  useLivePlayCommands,
  type LivePlayCommandResponse,
  type UseLivePlayCommandsOptions,
  type UseLivePlayCommandsReturn,
} from '~/composables/map-editor/useLivePlayCommands'
import { useAcceptedMovePresentation } from '~/composables/map-editor/useAcceptedMovePresentation'
import { useLivePlayCommandRecoveryGate } from '~/composables/map-editor/useLivePlayCommandRecoveryGate'
import { usePendingMoveResponses } from '~/composables/map-editor/usePendingMoveResponses'
import { useLivePlayStateMachine, type LivePlayConnectionState } from '~/composables/map-editor/useLivePlayStateMachine'
import { useMapPageTableActionDispatchers } from '~/composables/map-editor/useMapPageTableActionDispatchers'
import { useMapPageTokenSpawning } from '~/composables/map-editor/useMapPageTokenSpawning'
import { useMapPresence } from '~/composables/map-editor/useMapPresence'
import { useLiveTableSnapshotSync } from '~/composables/map-editor/useLiveTableSnapshotSync'
import { useSharedMapInteractionMode } from '~/composables/map-editor/useSharedMapInteractionMode'
import { parseRoundInputValue, useFieldEffectsEditor } from '~/composables/map-editor/useFieldEffectsEditor'
import { useHazardBuilder } from '~/composables/map-editor/useHazardBuilder'
import { useInitiativeTracker } from '~/composables/map-editor/useInitiativeTracker'
import { useMapAccess, useMapGmModeGuard } from '~/composables/map-editor/useMapAccess'
import { useMapActionEventSync } from '~/composables/map-editor/useMapActionEventSync'
import { useMapActionMoveAnimations, type MapActionMoveAnimationsPublishHandler } from '~/composables/map-editor/useMapActionMoveAnimations'
import { useMapActionMoveFeedback, type MapActionMoveFeedbackPublishHandler } from '~/composables/map-editor/useMapActionMoveFeedback'
import {
  useMapActionPokeballCapture,
  type MapActionPokeballFeedbackPublishHandler,
  type MapActionPokeballResultPublishHandler,
} from '~/composables/map-editor/useMapActionPokeballCapture'
import { useMapActionSplash, type MapActionSplashPublishHandler } from '~/composables/map-editor/useMapActionSplash'
import {
  useMapDimensionControls,
  useMapDimensionReconciliation,
} from '~/composables/map-editor/useMapDimensions'
import { useMapEditorUiState } from '~/composables/map-editor/useMapEditorUiState'
import { useMapEncounterSides } from '~/composables/map-editor/useMapEncounterSides'
import { useMapShopInterfaces } from '~/composables/map-editor/useMapShopInterfaces'
import { useMapTokenNavigation } from '~/composables/map-editor/useMapTokenNavigation'
import { useAbilityAutomationPanel } from '~/composables/map-editor/useAbilityAutomationPanel'
import { useMoveAnimationQueue } from '~/composables/map-editor/useMoveAnimationQueue'
import { useActionSplashSettings } from '~/composables/useActionSplashSettings'
import { useInitiativeAutoFocusSettings } from '~/composables/useInitiativeAutoFocusSettings'
import { useMoveAnimationSettings } from '~/composables/useMoveAnimationSettings'
import {
  useMoveAutomationPanel,
  type MoveAutomationAuthoritativeDispatchHandler,
} from '~/composables/map-editor/useMoveAutomationPanel'
import {
  createMoveVfxDebugPreviewEvents,
  isMoveVfxDebugHarnessEnabled,
} from '~/utils/moveVfxDebugHarness'
import { useManeuverActionPanel } from '~/composables/map-editor/useManeuverActionPanel'
import { useOrderActionPanel } from '~/composables/map-editor/useOrderActionPanel'
import { usePokeballCapturePanel } from '~/composables/map-editor/usePokeballCapturePanel'
import { LIVE_PLAY_COMMAND_TYPES, LIVE_PLAY_PATCH_TYPES } from '#shared/livePlayCommands'
import { MAP_INTERACTION_MODES, type MapInteractionMode } from '#shared/mapInteractionMode'
import {
  LIVE_PLAY_PRESENCE_MAX_INTENT_AREA_CELLS,
  LIVE_PLAY_PRESENCE_MAX_INTENT_COUNT,
  livePlayPresenceClientIdSuffix,
  type LivePlayPresenceAttentionTarget,
  type LivePlayPresenceGridCell,
  type LivePlayPresenceIntentState,
} from '#shared/livePlayPresence'
import { isRealtimeEcho } from '#shared/realtime'
import type { LivePlayAcceptedRealtimeEvent } from '#shared/livePlayRealtimeEvents'
import type { LivePlayMovePresentationSummary } from '#shared/livePlayMovePresentation'
import { useStartTurnModal } from '~/composables/map-editor/useStartTurnModal'
import { useTerrainBuilder } from '~/composables/map-editor/useTerrainBuilder'
import { useLivePlayHazardBrushBatcher } from '~/composables/map-editor/useLivePlayHazardBrushBatcher'
import { useLivePlayTerrainBrushBatcher } from '~/composables/map-editor/useLivePlayTerrainBrushBatcher'
import { useAttackOfOpportunityTriggers } from '~/utils/attackOfOpportunity'
import { useTokenSheetMutations } from '~/composables/map-editor/useTokenSheetMutations'
import { useTokenControls } from '~/composables/map-editor/useTokenControls'
import { buildClientPlayerProfileTokenControlModel } from '~/utils/playerProfileTokenControl'
import { clearCombatLogMetadata, countCombatLogMessages } from '~/utils/combatLog'
import { buildLivePlayBatchPendingLabel } from '~/utils/livePlayBatchCommandUi'
import { textValueFromEvent } from '~/utils/domEvents'
import {
  applyPokeballCaptureOutcomeToPokemonSheet,
  applyPokeballCaptureOutcomeToTrainerSheet,
  type PokeballCaptureOutcomeEvent,
} from '~/utils/pokeballCapture'
import { isSameAnchor } from '~/utils/gridGeometry'
import { normalizeMapSceneName, MAP_SCENE_NAME_MAX_LENGTH } from '~/utils/mapSceneState'
import { setTemporaryHpForPlacement } from '~/utils/mapTemporaryHitPoints'
import { createLivePlayTokenCorrectionNoticeController } from '~/utils/livePlayTokenCorrectionNotice'
import { mapEditorPath, mapLibraryPath } from '~/utils/mapRoutes'
import { buildLiveSheetAccessScopeKey } from '~/utils/liveSheetCache'
import { buildMapTokenRemoteAttention } from '~/utils/mapPresenceTokenAttention'
import { buildMapPresenceIntentOverlays } from '~/utils/mapPresenceIntentOverlays'
import { getClientId } from '~/utils/clientId'
import { deepCloneJson } from '~/utils/serialization'
import { nextTokenFacingForPlacement } from '~/utils/tokenFacing'
import {
  livePlayConditionsForPrediction,
  type LivePlayLocalPrediction,
} from '~/utils/livePlayPredictions'
import type { LivePlayPatchAdoptionContext } from '~/utils/livePlayPatchAdoption'
import { routeSlugParam } from '~/utils/routeParams'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TokenMovementCommitPayload } from '~/utils/isometric/tokenMovementInteraction'
import {
  createEmptyTokenMotionDebugMetrics,
  type TokenMotionDebugMetrics,
} from '~/utils/isometric/tokenMotionDebugMetrics'
import type { GridAnchor, MapRoomKind, MapTerrainKind, MapWeatherKind } from '~/types/map'
import type { MoveAutomationTargetingOverlayState } from '~/types/moveAutomation'
import type { MoveVfxKind } from '~/types/moveAnimation'
import type { TrainerSheet } from '~/types/trainerSheet'

definePageMeta({
  hasPageSpecificGmAdminPanel: true,
  key: (route) => `map-${routeSlugParam(route.params)}`,
})

const route = useRoute()
const router = useRouter()
const { role, isGm, isPlayer } = useAuth()
const slug = routeSlugParam(route.params)
const {
  profiles: playerProfiles,
  selectedProfile,
  selectedProfileId,
  loadRememberedProfile,
  reloadProfiles,
  lastError: playerProfileError,
} = usePlayerProfiles()

if (import.meta.client && isPlayer.value) loadRememberedProfile()

const liveSheets = useLiveSheets({
  autoHydrate: false,
  hydrationOwner: `map:${slug}`,
})
const {
  pokemonBySlug,
  trainerBySlug,
  hydrated: liveSheetsHydrated,
  accessScopeKey: hydratedLiveSheetAccessScopeKey,
  loadError: liveSheetsLoadError,
  reconciliationRequired: liveSheetsReconciliationRequired,
  adoptSheetUpdate,
  reportReconciliationRequired: reportLiveSheetReconciliationRequired,
} = liveSheets

const {
  interactionMode: sharedMapInteractionMode,
  status: sharedMapInteractionModeStatus,
  error: sharedMapInteractionModeError,
  setInteractionMode: setSharedMapInteractionMode,
  applyAuthoritativeMode: applyAuthoritativeMapInteractionMode,
} = useSharedMapInteractionMode(slug, { autoLoad: false })
const mapInPrepareMode = computed(() => sharedMapInteractionMode.value === MAP_INTERACTION_MODES.SETUP_EDIT)
const mapInteractionMode = computed<MapInteractionMode>(() => (
  isGm.value && mapInPrepareMode.value
    ? MAP_INTERACTION_MODES.SETUP_EDIT
    : MAP_INTERACTION_MODES.LIVE_PLAY
))
const isSetupEditMode = () => mapInteractionMode.value === MAP_INTERACTION_MODES.SETUP_EDIT
const liveSheetAccessScopeKey = computed(() => buildLiveSheetAccessScopeKey({
  role: role.value,
  profileId: isPlayer.value ? selectedProfileId.value : null,
}))

let requestLiveTableSnapshot: (reason?: string) => Promise<void> = async () => {
  throw new Error('Live table snapshot synchroniser is not initialised.')
}
let acceptedRealtimeAcknowledgementHandler: ((event: LivePlayAcceptedRealtimeEvent) => Promise<unknown> | unknown) | null = null
const queuedAcceptedRealtimeEvents: LivePlayAcceptedRealtimeEvent[] = []
const queuedAcceptedRealtimeCaptureEvents: LivePlayAcceptedRealtimeEvent[] = []
const queuedAcceptedMovePresentations: Array<{
  readonly presentation: LivePlayMovePresentationSummary
  readonly publishHint: boolean
}> = []
let presentAcceptedMove = (
  presentation: LivePlayMovePresentationSummary,
  publishHint: boolean,
): void => {
  queuedAcceptedMovePresentations.push({ presentation, publishHint })
}
let acceptedMoveWasPresented = (_operationId: string | null | undefined): boolean => false
let scheduleAcceptedRealtimePokeballCaptureResult = (event: LivePlayAcceptedRealtimeEvent): void => {
  queuedAcceptedRealtimeCaptureEvents.push(event)
}
let acknowledgeAcceptedRealtimeEvent = async (event: LivePlayAcceptedRealtimeEvent): Promise<void> => {
  if (acceptedRealtimeAcknowledgementHandler) {
    scheduleAcceptedRealtimePokeballCaptureResult(event)
    await acceptedRealtimeAcknowledgementHandler(event)
    return
  }
  queuedAcceptedRealtimeEvents.push(event)
}

const emptyLivePlayPendingPredictions: Readonly<Record<string, LivePlayLocalPrediction>> = Object.freeze({})
interface TrackedLivePlayTokenPrediction {
  readonly opId: string
  readonly placementId: string
  readonly commandType: LivePlayLocalPrediction['commandType']
  readonly tokenLabel: string
}

const livePlayTrackedTokenPredictions = ref<Readonly<Record<string, TrackedLivePlayTokenPrediction>>>({})
const livePlayTokenCorrectionNoticeController = createLivePlayTokenCorrectionNoticeController()
const livePlayTokenCorrectionNotice = livePlayTokenCorrectionNoticeController.notice
const transientLivePlayCorrectionMotionTokenIds = ref<string[]>([])
const transientLivePlaySnapCorrectionTokenIds = ref<string[]>([])
const transientLivePlayRemoteAcceptedMotionTokenIds = ref<string[]>([])
let correctionMotionTokenClearQueued = false
let snapCorrectionTokenClearQueued = false
let remoteAcceptedMotionTokenClearQueued = false

onBeforeUnmount(() => {
  livePlayTokenCorrectionNoticeController.dispose()
})

const appendUniqueTokenIds = (
  currentIds: readonly string[],
  placementIds: readonly string[],
): string[] => Array.from(new Set([
  ...currentIds,
  ...placementIds.filter((placementId) => placementId.length > 0),
]))

const markLivePlayCorrectionMotionTokens = (placementIds: readonly string[]): void => {
  transientLivePlayCorrectionMotionTokenIds.value = appendUniqueTokenIds(
    transientLivePlayCorrectionMotionTokenIds.value,
    placementIds,
  )
  if (correctionMotionTokenClearQueued) return

  correctionMotionTokenClearQueued = true
  void nextTick(() => {
    correctionMotionTokenClearQueued = false
    transientLivePlayCorrectionMotionTokenIds.value = []
  })
}

const markLivePlaySnapCorrectionTokens = (placementIds: readonly string[]): void => {
  transientLivePlaySnapCorrectionTokenIds.value = appendUniqueTokenIds(
    transientLivePlaySnapCorrectionTokenIds.value,
    placementIds,
  )
  if (snapCorrectionTokenClearQueued) return

  snapCorrectionTokenClearQueued = true
  void nextTick(() => {
    snapCorrectionTokenClearQueued = false
    transientLivePlaySnapCorrectionTokenIds.value = []
  })
}

const markLivePlayRemoteAcceptedMotionTokens = (placementIds: readonly string[]): void => {
  transientLivePlayRemoteAcceptedMotionTokenIds.value = appendUniqueTokenIds(
    transientLivePlayRemoteAcceptedMotionTokenIds.value,
    placementIds,
  )
  if (remoteAcceptedMotionTokenClearQueued) return

  remoteAcceptedMotionTokenClearQueued = true
  void nextTick(() => {
    remoteAcceptedMotionTokenClearQueued = false
    transientLivePlayRemoteAcceptedMotionTokenIds.value = []
  })
}

const livePlayTokenPositionPatchPlacementId = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object' || !('placementId' in payload)) return null
  const placementId = (payload as { readonly placementId?: unknown }).placementId
  return typeof placementId === 'string' && placementId.length > 0 ? placementId : null
}

const livePlayRemoteAcceptedMovementTokenIds = (
  event: LivePlayAcceptedRealtimeEvent,
  adoption: LivePlayAcceptedEventAdoptionInfo,
): string[] => {
  if (!adoption.applied || adoption.origin !== 'remote-accepted') return []

  const visiblePlacementIds = visiblePresenceTokenIdSet.value
  return Array.from(new Set(event.patches.flatMap((patch) => {
    if (patch.type !== LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION) return []
    const placementId = livePlayTokenPositionPatchPlacementId(patch.payload)
    return placementId && visiblePlacementIds.has(placementId) ? [placementId] : []
  })))
}

const handleAcceptedLivePlayCommandEventForPresentation = (
  event: LivePlayAcceptedRealtimeEvent,
  adoption: LivePlayAcceptedEventAdoptionInfo,
): void => {
  const placementIds = livePlayRemoteAcceptedMovementTokenIds(event, adoption)
  if (placementIds.length > 0) markLivePlayRemoteAcceptedMotionTokens(placementIds)

  const presentation = movePresentationFromAcceptedRealtimeEvent(event)
  if (presentation) presentAcceptedMove(presentation, false)
}

const clearLivePlayTrackedPredictionsForReconciliation = (): void => {
  markLivePlaySnapCorrectionTokens(
    Object.values(livePlayTrackedTokenPredictions.value).map((prediction) => prediction.placementId),
  )
  livePlayTrackedTokenPredictions.value = {}
  livePlayTokenCorrectionNoticeController.clear()
}

const livePlayCommandsForPatchAdoption = shallowRef<Pick<
  UseLivePlayCommandsReturn,
  'pendingPredictions' | 'beforeLivePlayPatchesApply' | 'afterLivePlayPatchesApply' | 'clearPendingPredictionsForReconciliation'
> | null>(null)
const livePlayPatchAdoptionPendingPredictions = computed<Readonly<Record<string, LivePlayLocalPrediction>>>(() => (
  livePlayCommandsForPatchAdoption.value?.pendingPredictions.value ?? emptyLivePlayPendingPredictions
))
const beforeLivePlayPatchesApply = (context: LivePlayPatchAdoptionContext): void => {
  livePlayCommandsForPatchAdoption.value?.beforeLivePlayPatchesApply(context)
}
const afterLivePlayPatchesApply = (context: LivePlayPatchAdoptionContext): void => {
  livePlayCommandsForPatchAdoption.value?.afterLivePlayPatchesApply(context)
}
const clearLivePlayPredictionsForReconciliation = (reason: string): void => {
  livePlayCommandsForPatchAdoption.value?.clearPendingPredictionsForReconciliation(reason)
  clearLivePlayTrackedPredictionsForReconciliation()
}

const {
  map,
  status,
  error,
  renamedTo,
  mapDataRevision,
  mapRevision,
  realtimeReconciliationStatus,
  livePlayRealtimeNotice,
  saveNow: saveMapNow,
  reconcileAuthoritativeMap,
  applyPersistedMap,
} = useEditableMap(slug, {
  autoLoad: false,
  interactionMode: mapInteractionMode,
  playerProfileId: computed(() => (isPlayer.value ? selectedProfileId.value : null)),
  requestAuthoritativeReconciliation: (reason) => requestLiveTableSnapshot(reason),
  authoritativeReconciliationKey: liveSheetAccessScopeKey,
  pendingLivePlayPredictions: livePlayPatchAdoptionPendingPredictions,
  beforeLivePlayPatchesApply,
  afterLivePlayPatchesApply,
  onBeforeAuthoritativeReconciliation: clearLivePlayPredictionsForReconciliation,
  onLivePlayCommandAcceptedEvent: (event, adoption) => {
    handleAcceptedLivePlayCommandEventForPresentation(event, adoption)
    return acknowledgeAcceptedRealtimeEvent(event)
  },
})

const liveTableSnapshotSync = useLiveTableSnapshotSync({
  slug,
  role,
  playerProfileId: computed(() => (isPlayer.value ? selectedProfileId.value : null)),
  sheetCache: liveSheets,
  applyMap: applyPersistedMap,
  applyInteractionMode: applyAuthoritativeMapInteractionMode,
})
requestLiveTableSnapshot = liveTableSnapshotSync.requestSnapshot

const sheetCacheHydratedForCurrentScope = computed(() => (
  liveSheetsHydrated.value
  && hydratedLiveSheetAccessScopeKey.value === liveSheetAccessScopeKey.value
))
const aggregateSnapshotReady = computed(() => (
  liveTableSnapshotSync.ready.value
  && sheetCacheHydratedForCurrentScope.value
  && !liveSheetsReconciliationRequired.value
))
const livePlayMapStatus = computed<MapSaveStatus>(() => {
  if (status.value === 'loading' || status.value === 'error' || status.value === 'not-found') return status.value
  if (liveTableSnapshotSync.status.value === 'error' || liveSheetsReconciliationRequired.value) return 'error'
  if (!aggregateSnapshotReady.value) return 'loading'
  return status.value
})
const livePlayMapError = computed(() => (
  liveTableSnapshotSync.error.value
  ?? liveSheetsLoadError.value
  ?? error.value
))
const sceneStatus = computed<MapSaveStatus>(() => (
  map.value
    ? status.value
    : livePlayMapStatus.value
))
const sceneError = computed(() => (
  map.value
    ? error.value
    : livePlayMapError.value
))

const reconcileLivePlayState = () => reconcileAuthoritativeMap('Reconciling the live table snapshot.')
liveSheets.registerAuthoritativeReconciler((reason) => reconcileAuthoritativeMap(reason))

const applyLivePlaySheetUpdate = (update: { kind: 'pokemon' | 'trainer'; slug: string; sheet: Record<string, unknown> }) => {
  const result = adoptSheetUpdate({
    kind: update.kind,
    slug: update.slug,
    sheet: update.sheet,
    preserveClientAccessAnnotations: true,
  })
  if (result.status === 'conflict' || result.status === 'invalid') {
    const message = `Live-play sheet update for ${update.kind}:${update.slug} could not be adopted: ${result.message}`
    reportLiveSheetReconciliationRequired(message, { reload: false })
    void livePlayStateMachine.reconcile(reconcileLivePlayState).catch(() => undefined)
    throw new Error(message)
  }
}
const livePlayStateMachine = useLivePlayStateMachine({
  mapStatus: livePlayMapStatus,
  mapError: livePlayMapError,
  realtimeStatus: realtimeReconciliationStatus,
  realtimeNotice: livePlayRealtimeNotice,
})
const livePlayStateBlocksCommands = computed(() => {
  const state = livePlayStateMachine.state.value
  return state !== 'ready' && state !== 'saving-command'
})
const fundamentalLivePlayCommandBlocked = computed(() => (
  mapInPrepareMode.value || livePlayStateBlocksCommands.value
))
const livePlayCommandBlockedMessage = computed(() => {
  if (mapInPrepareMode.value) return 'Map is in Prepare Map mode. Switch to Run Live Play before live-play commands.'
  if (livePlayStateBlocksCommands.value) return livePlayStateMachine.commandBlockMessage.value
  return null
})
const livePlayRecoveryNewCommandBlocked = ref(true)
const livePlayRecoveryNewCommandBlockedMessage = ref<string | null>(
  'Checking for interrupted live-play commands before actions resume.',
)

type LivePlayCommandRejectionNotification = Parameters<NonNullable<UseLivePlayCommandsOptions['onCommandRejected']>>[0]

const livePlayTokenCorrectionMessage = (prediction: TrackedLivePlayTokenPrediction): string => {
  if (prediction.commandType === LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN) {
    return `Facing corrected by the server; ${prediction.tokenLabel} returned to its last confirmed facing.`
  }
  if (prediction.commandType === LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS) {
    return `Conditions corrected by the server; ${prediction.tokenLabel} returned to its last confirmed conditions.`
  }
  return `Move corrected by the server; ${prediction.tokenLabel} returned to its last confirmed position.`
}

const rememberLivePlayPredictedToken = (prediction: LivePlayLocalPrediction, tokenLabel: string) => {
  livePlayTrackedTokenPredictions.value = {
    ...livePlayTrackedTokenPredictions.value,
    [prediction.opId]: {
      opId: prediction.opId,
      placementId: prediction.placementId,
      commandType: prediction.commandType,
      tokenLabel,
    },
  }
}

const forgetLivePlayPredictedToken = (opId: string): TrackedLivePlayTokenPrediction | null => {
  const prediction = livePlayTrackedTokenPredictions.value[opId]
  if (!prediction) return null
  const nextPredictions = { ...livePlayTrackedTokenPredictions.value }
  delete nextPredictions[opId]
  livePlayTrackedTokenPredictions.value = nextPredictions
  return prediction
}

const trackedLivePlayTokenPredictionForResponse = (
  response: LivePlayCommandResponse,
): TrackedLivePlayTokenPrediction | null => livePlayTrackedTokenPredictions.value[response.opId] ?? null

const livePlayPatchPayloadPlacementId = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object' || !('placementId' in payload)) return null
  const placementId = (payload as { readonly placementId?: unknown }).placementId
  return typeof placementId === 'string' ? placementId : null
}

const livePlayAcceptedResponsePlacementId = (response: LivePlayCommandResponse): string | null => {
  if (typeof response.placement?.id === 'string') return response.placement.id
  if (!response.ok || 'duplicate' in response) return null
  for (const patch of response.patches) {
    const placementId = livePlayPatchPayloadPlacementId(patch.payload)
    if (placementId) return placementId
  }
  return null
}

const handleLivePlayCommandAccepted = (response: LivePlayCommandResponse) => {
  const predictedToken = forgetLivePlayPredictedToken(response.opId)
  const acceptedPlacementId = predictedToken?.placementId ?? livePlayAcceptedResponsePlacementId(response)
  if (acceptedPlacementId) livePlayTokenCorrectionNoticeController.clearForPlacement(acceptedPlacementId)
  livePlayStateMachine.commandAccepted()
}

const handleLivePlayCommandRejected = (transition: LivePlayCommandRejectionNotification) => {
  if (
    transition.reason !== 'stale-revision'
    && livePlayTokenCorrectionNoticeController.hasCorrectedOpId(transition.response.opId)
  ) {
    livePlayStateMachine.clearCommandError()
    return
  }

  const predictedToken = trackedLivePlayTokenPredictionForResponse(transition.response)
  if (!predictedToken) {
    livePlayStateMachine.commandRejected(transition)
    return
  }

  forgetLivePlayPredictedToken(predictedToken.opId)
  if (transition.reason === 'stale-revision') {
    markLivePlaySnapCorrectionTokens([predictedToken.placementId])
    livePlayStateMachine.commandRejected(transition)
    return
  }

  markLivePlayCorrectionMotionTokens([predictedToken.placementId])
  livePlayTokenCorrectionNoticeController.show({
    opId: predictedToken.opId,
    placementId: predictedToken.placementId,
    message: livePlayTokenCorrectionMessage(predictedToken),
  })
  livePlayStateMachine.clearCommandError()
}

const livePlayCommands = useLivePlayCommands({
  slug,
  authRole: role,
  playerProfileId: computed(() => (isPlayer.value ? selectedProfileId.value : null)),
  map,
  mapRevision,
  livePlayCommandBlocked: fundamentalLivePlayCommandBlocked,
  livePlayCommandBlockedMessage,
  newCommandBlocked: livePlayRecoveryNewCommandBlocked,
  newCommandBlockedMessage: livePlayRecoveryNewCommandBlockedMessage,
  applyPersistedMap,
  applySheetUpdate: applyLivePlaySheetUpdate,
  requestReconciliation: () => livePlayStateMachine.reconcile(reconcileLivePlayState),
  onCommandStarted: livePlayStateMachine.commandStarted,
  onCommandAccepted: handleLivePlayCommandAccepted,
  onAcceptedMovePresentation: ({ presentation, source }) => {
    presentAcceptedMove(presentation, source === 'http')
  },
  onCommandRejected: handleLivePlayCommandRejected,
  onCommandFailed: livePlayStateMachine.commandFailed,
  onCommandBlocked: livePlayStateMachine.commandBlocked,
  onCommandErrorCleared: livePlayStateMachine.clearCommandError,
})
livePlayCommandsForPatchAdoption.value = livePlayCommands
acceptedRealtimeAcknowledgementHandler = livePlayCommands.acknowledgeAcceptedRealtimeEvent
acknowledgeAcceptedRealtimeEvent = async (event: LivePlayAcceptedRealtimeEvent): Promise<void> => {
  scheduleAcceptedRealtimePokeballCaptureResult(event)
  await acceptedRealtimeAcknowledgementHandler?.(event)
}
for (const event of queuedAcceptedRealtimeEvents.splice(0)) {
  void acknowledgeAcceptedRealtimeEvent(event).catch((error: unknown) => {
    console.error('[map page] queued accepted live-play command acknowledgement failed', error)
  })
}
const livePlayRecoveryContextKey = computed(() => {
  if (role.value === 'gm') return `${slug}:gm`
  if (role.value === 'player') return `${slug}:player:${selectedProfileId.value ?? 'none'}`
  return null
})
const livePlayCommandRecoveryGate = useLivePlayCommandRecoveryGate({
  contextKey: livePlayRecoveryContextKey,
  enabled: computed(() => livePlayRecoveryContextKey.value !== null),
  interactionMode: mapInteractionMode,
  commandStatus: livePlayCommands.status,
  entries: livePlayCommands.outboxEntries,
  recoveryStatus: livePlayCommands.outboxRecoveryStatus,
  recoveryError: livePlayCommands.outboxRecoveryError,
  recoverInterrupted: livePlayCommands.recoverInterruptedOutboxCommands,
  refresh: livePlayCommands.refreshOutboxEntries,
  retry: livePlayCommands.retryOutboxCommand,
  checkStatus: livePlayCommands.checkOutboxCommandStatus,
  abandon: livePlayCommands.abandonOutboxCommand,
})
watchEffect(() => {
  livePlayRecoveryNewCommandBlocked.value = livePlayCommandRecoveryGate.blocksNewLiveCommands.value
  livePlayRecoveryNewCommandBlockedMessage.value = livePlayCommandRecoveryGate.blockMessage.value
})
const livePlayHazardBrushBatcher = useLivePlayHazardBrushBatcher({
  dispatchEditHazards: (payload) => livePlayCommands.editHazards(payload),
  dispatchPlaceHazard: (payload) => livePlayCommands.placeHazard(payload),
  dispatchRemoveHazard: (payload) => livePlayCommands.removeHazard(payload),
})
const livePlayTerrainBrushBatcher = useLivePlayTerrainBrushBatcher({
  dispatchEditTerrainVoxels: (payload) => livePlayCommands.editTerrainVoxels(payload),
})
const livePlayCommandsAllowed = computed(() => (
  !mapInPrepareMode.value
  && !livePlayStateBlocksCommands.value
  && !livePlayCommandRecoveryGate.blocksNewLiveCommands.value
))
const livePlayPendingPredictionTokenIds = computed(() => Array.from(new Set(
  Object.values(livePlayCommands.pendingPredictions.value).map((prediction) => prediction.placementId),
)))
const livePlayCorrectionTokenIds = computed(() => (
  livePlayTokenCorrectionNotice.value ? [livePlayTokenCorrectionNotice.value.placementId] : []
))
const livePlayCorrectionMotionTokenIds = computed(() => transientLivePlayCorrectionMotionTokenIds.value)
const livePlayRemoteAcceptedMotionTokenIds = computed(() => transientLivePlayRemoteAcceptedMotionTokenIds.value)
const livePlayUnpredictedPendingCommandCount = computed(() => Object.values(livePlayCommands.pendingCommands.value).filter(
  (command) => livePlayCommands.pendingPredictions.value[command.opId] === undefined,
).length)
const livePlayGlobalTransportPending = computed(() => (
  livePlayCommands.transportStatus.value === 'sending'
  && livePlayUnpredictedPendingCommandCount.value > 0
))
const livePlayActiveBatchPendingLabel = computed(() => buildLivePlayBatchPendingLabel(
  Object.values(livePlayCommands.pendingCommands.value),
  {
    hazardCount: hazardCount.value,
    fieldEffectCount: fieldEffectCount.value,
  },
))
const livePlayClearHazardsPending = computed(() => (
  !isSetupEditMode()
  && Object.values(livePlayCommands.pendingCommands.value).some(
    (command) => command.commandType === LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
  )
))
const livePlayLatencyDebugEnabled = computed(() => route.query.debugLivePlayLatency === '1')
const livePlayTokenMotionDebugMetrics = shallowRef<TokenMotionDebugMetrics>(createEmptyTokenMotionDebugMetrics())
const updateLivePlayTokenMotionDebugMetrics = (metrics: TokenMotionDebugMetrics): void => {
  livePlayTokenMotionDebugMetrics.value = metrics
}
const livePlayConnectionState = computed<LivePlayConnectionState>(() => {
  const visibleState = livePlayStateMachine.state.value === 'saving-command' && !livePlayGlobalTransportPending.value
    ? 'ready'
    : livePlayStateMachine.state.value

  if (mapInPrepareMode.value) return visibleState
  if (livePlayCommandRecoveryGate.retryingOpId.value) return 'saving-command'
  if (livePlayCommandRecoveryGate.abandoningOpId.value) return 'saving-command'
  if (visibleState !== 'ready') return visibleState
  if (livePlayGlobalTransportPending.value) return 'saving-command'
  if (livePlayCommands.outboxRecoveryStatus.value === 'error' || livePlayCommands.outboxRecoveryError.value) return 'error'
  if (livePlayCommands.outboxRecoveryStatus.value === 'abandoning') return 'saving-command'
  if (livePlayCommands.outboxRecoveryStatus.value === 'synchronizing') return 'reconciling'
  if (!livePlayCommandRecoveryGate.readyForCurrentContext.value) return 'reconciling'
  if (livePlayCommands.outboxEntries.value.length > 0) return 'stale'
  return 'ready'
})
const livePlayStatusMessage = computed(() => {
  if (mapInPrepareMode.value) {
    return 'Prepare Map mode is active. Live-play commands are paused until the GM switches to Run Live Play.'
  }
  if (livePlayCommandRecoveryGate.retryingOpId.value || livePlayCommandRecoveryGate.abandoningOpId.value) {
    return livePlayCommandRecoveryGate.blockMessage.value
  }
  if (livePlayStateMachine.state.value !== 'ready') {
    if (livePlayStateMachine.state.value === 'saving-command') {
      return livePlayGlobalTransportPending.value
        ? livePlayActiveBatchPendingLabel.value ?? livePlayStateMachine.notice.value
        : livePlayCommandRecoveryGate.blockMessage.value
    }
    return livePlayStateMachine.notice.value
  }
  if (livePlayGlobalTransportPending.value) {
    return livePlayActiveBatchPendingLabel.value ?? 'Sending live-play command to the server.'
  }
  return livePlayCommandRecoveryGate.blockMessage.value ?? livePlayStateMachine.notice.value
})
const livePlayRetryDisabledMessage = computed(() => {
  if (isSetupEditMode()) return 'Switch to Run Live Play to retry pending live-play commands.'
  if (livePlayStateBlocksCommands.value) return livePlayStateMachine.commandBlockMessage.value
  if (livePlayCommands.outboxRecoveryStatus.value === 'synchronizing') {
    return 'Synchronizing accepted command with the authoritative live table snapshot.'
  }
  if (livePlayCommands.outboxRecoveryStatus.value === 'abandoning') {
    return 'Abandoning the pending live-play operation safely on the server.'
  }
  if (livePlayCommands.transportStatus.value === 'sending') return 'A live-play command is already in flight.'
  if (livePlayCommandRecoveryGate.retryingOpId.value) {
    return 'Retrying the pending live-play command with its original operation ID.'
  }
  if (livePlayCommandRecoveryGate.checkingOpId.value) {
    return 'Checking the server for a terminal command result without resending the command.'
  }
  if (livePlayCommandRecoveryGate.abandoningOpId.value) {
    return 'Abandoning the pending live-play operation safely on the server.'
  }
  return null
})
const refreshLivePlayCommandRecovery = () => {
  void livePlayCommandRecoveryGate.refreshRecovery().catch(() => undefined)
}
const retryLivePlayCommandRecoveryEntry = (opId: string) => {
  void livePlayCommandRecoveryGate.retryEntry(opId).catch(() => undefined)
}
const checkLivePlayCommandRecoveryEntryStatus = (opId: string) => {
  void livePlayCommandRecoveryGate.checkEntry(opId).catch(() => undefined)
}
const requestLivePlayCommandAbandonConfirmation = (opId: string) => {
  livePlayCommandRecoveryGate.requestAbandonConfirmation(opId)
}
const cancelLivePlayCommandAbandonConfirmation = () => {
  livePlayCommandRecoveryGate.cancelAbandonConfirmation()
}
const confirmLivePlayCommandAbandonment = (opId: string) => {
  void livePlayCommandRecoveryGate.confirmAbandon(opId).catch(() => undefined)
}
const clearLivePlayCommandRecoveryResolutionNotice = () => {
  livePlayCommandRecoveryGate.clearResolutionNotice()
}

watch(renamedTo, (newSlug) => {
  if (newSlug) router.replace(mapEditorPath(newSlug))
})
const playerProfileTokenControlModel = computed(() => buildClientPlayerProfileTokenControlModel({
  role: role.value,
  profile: selectedProfile.value,
  placements: map.value?.placements ?? [],
  linkedTrainerSheets: Array.from(trainerBySlug.value.values()),
}))
const tokenControlNotice = computed(() => {
  if (isPlayer.value && mapInPrepareMode.value) {
    return 'The GM is preparing this map. Live play controls are paused.'
  }
  if (isPlayer.value && playerProfileError.value) {
    return `Player profile unavailable: ${playerProfileError.value}`
  }
  return playerProfileTokenControlModel.value.notice
})

useHead(() => ({
  title: map.value ? `${map.value.name} · Maps` : 'Maps · Rotom Table',
}))

interface MapScenePanelHandle {
  focusPokemon: (id: string) => boolean
  focusCell: (cell: LivePlayPresenceGridCell) => boolean
}

const gridRef = ref<MapScenePanelHandle | null>(null)

const {
  moveAnimationsEnabled,
  moveAnimationsReducedMotion,
} = useMoveAnimationSettings()
const {
  initiativeAutoFocusEnabled,
} = useInitiativeAutoFocusSettings()
const {
  actionSplashDisplayDurationMs,
  actionSplashSpeedLinesDurationMs,
} = useActionSplashSettings()

const {
  activeMoveAnimations,
  enqueueMoveAnimations: enqueueLocalMoveAnimations,
  clearMoveAnimations,
  pruneExpiredMoveAnimations,
} = useMoveAnimationQueue({ moveAnimationsEnabled })

const visibleMoveAnimations = computed(() => (
  moveAnimationsEnabled.value ? activeMoveAnimations.value : []
))

const pruneSettledMoveAnimations = ({ nowMs }: { nowMs: number }) => {
  pruneExpiredMoveAnimations(nowMs)
}

const moveVfxDebugHarnessEnabled = computed(() => isMoveVfxDebugHarnessEnabled({ query: route.query }))

watch(
  () => routeSlugParam(route.params),
  (nextSlug, previousSlug) => {
    if (nextSlug !== previousSlug) clearMoveAnimations()
  },
)

// `useEditableMap` keeps the map object stable during authoritative reloads,
// realtime replacements, live-play command results, and rename/delete
// events. Watch its explicit data-revision signal so transient VFX are cleared
// when the rendered scene adopts a new persisted map without tying cleanup to
// ordinary local autosave timestamp updates.
watch(mapDataRevision, () => {
  clearMoveAnimations()
})

watch(
  () => {
    const dimensions = map.value?.dimensions
    return dimensions ? `${dimensions.x}:${dimensions.y}:${dimensions.z}` : 'no-map'
  },
  (nextDimensionsKey, previousDimensionsKey) => {
    if (nextDimensionsKey !== previousDimensionsKey) clearMoveAnimations()
  },
)

let cleanupMoveAnimationVisibilityChange: (() => void) | null = null

onBeforeUnmount(() => {
  cleanupMoveAnimationVisibilityChange?.()
  cleanupMoveAnimationVisibilityChange = null
  clearMoveAnimations()
})

let liveTableSnapshotRequested = false

const loadLiveTableSnapshotForCurrentAccess = async (reason: string) => {
  if (!liveTableSnapshotRequested) {
    liveTableSnapshotRequested = true
    await requestLiveTableSnapshot(reason)
    return
  }
  await reconcileAuthoritativeMap(reason)
}

const syncPlayerProfilesForMapControl = async (reason = 'Loading the initial live table snapshot.') => {
  if (!import.meta.client || (!isGm.value && !isPlayer.value)) return
  if (isPlayer.value) loadRememberedProfile()
  try {
    await reloadProfiles({
      silent: !isPlayer.value,
      clearMissingSelection: isPlayer.value,
    })
  } catch {
    // Keep the map view available; token-control notices surface the profile loading problem.
  }
  await loadLiveTableSnapshotForCurrentAccess(reason)
}

onMounted(() => {
  if (import.meta.client) {
    const handleMoveAnimationVisibilityChange = () => {
      if (document.hidden) return

      // Hidden tabs age move VFX by wall-clock time. Prune expired queue
      // entries on resume so renderer input cannot retain stale events after
      // the isometric scheduler wakes for its hidden-tab-resume frame.
      pruneExpiredMoveAnimations(Date.now())
    }
    document.addEventListener('visibilitychange', handleMoveAnimationVisibilityChange)
    cleanupMoveAnimationVisibilityChange = () => {
      document.removeEventListener('visibilitychange', handleMoveAnimationVisibilityChange)
    }
  }

  void syncPlayerProfilesForMapControl()
})

watch([isGm, isPlayer], ([nextIsGm, nextIsPlayer], [previousIsGm, previousIsPlayer]) => {
  if (nextIsGm === previousIsGm && nextIsPlayer === previousIsPlayer) return
  if (nextIsGm || nextIsPlayer) void syncPlayerProfilesForMapControl('Auth role changed. Reloading the live table snapshot.')
})

watch(
  selectedProfileId,
  (nextProfileId, previousProfileId) => {
    if (!liveTableSnapshotRequested || nextProfileId === previousProfileId) return
    void reconcileAuthoritativeMap('Selected player profile changed. Reloading the live table snapshot.')
  },
  { flush: 'sync' },
)

const {
  canEditMap,
  canManageInitiative,
  canSpawnTokens,
  canViewMap,
} = useMapAccess({
  map,
  isGm,
  isPlayer,
  redirectHiddenPlayerMap: () => router.replace(mapLibraryPath()),
})
const mapActionEditingEnabled = computed(() => (
  canEditMap.value && (isSetupEditMode() || livePlayCommandsAllowed.value)
))

const {
  mapVoxels,
  mapHazards,
  groundLevelYMax,
  mapGroundLevelY,
  mapSpecificYMin,
  mapSpecificYMax,
  setMapPlayerVisible,
  setGroundLevelY,
} = useMapDimensionControls({ map, canEditMap, isGm })

const {
  selectedId,
  previewState,
  sheetLookup,
  spawnedPokemon,
  controllablePlacementIds,
  tokenSendOutOptionsById,
  canControlPlacement,
  createSpawnPlacement,
  spawnSheetForSetupEdit,
  createSendOutPokemonPlacement,
  placementById,
  clearSelection,
  updatePreview,
  sendOutPokemon,
  selectPlacement,
  deletePlacement,
  turnPlacementForSetupEdit,
  movePlacementForSetupEdit,
} = useTokenControls({
  map,
  pokemonBySlug,
  trainerBySlug,
  mapVoxels,
  mapGroundLevelY,
  canSpawnTokens,
  canControlAllTokens: isGm,
  canSendOutTokens: computed(() => isGm.value || (isPlayer.value && !mapInPrepareMode.value)),
  tokenControl: {
    enabled: computed(() => true),
    controllablePlacementIds: computed(() => playerProfileTokenControlModel.value.controllablePlacementIds),
  },
})

const pendingMoveResponses = usePendingMoveResponses({
  slug,
  authRole: role,
  playerProfileId: computed(() => (isPlayer.value ? selectedProfileId.value : null)),
  mapRevision,
  enabled: computed(() => (
    canViewMap.value
    && !mapInPrepareMode.value
    && (isGm.value || (isPlayer.value && Boolean(selectedProfileId.value)))
  )),
  applyPersistedMap,
  applySheetUpdate: applyLivePlaySheetUpdate,
})
const pendingMoveResponseActorLabels = computed<Readonly<Record<string, string>>>(() => (
  Object.fromEntries(spawnedPokemon.value.map(token => [token.id, token.species]))
))
const pendingMoveResponseOwnerLabel = computed(() => (
  isGm.value
    ? 'Game Master'
    : selectedProfile.value?.displayName ?? 'Selected player profile'
))

const hoveredPresenceTokenId = ref<string | null>(null)
const visiblePresenceTokenIds = computed<readonly string[]>(() => spawnedPokemon.value.map((pokemon) => pokemon.id))
const visiblePresenceTokenIdSet = computed(() => new Set(visiblePresenceTokenIds.value))
const presenceTokenIdIfVisible = (tokenId: string | null | undefined): string | null => (
  tokenId && visiblePresenceTokenIdSet.value.has(tokenId) ? tokenId : null
)
const presencePingCellIfVisible = (cell: LivePlayPresenceGridCell | null | undefined): LivePlayPresenceGridCell | null => {
  const dimensions = map.value?.dimensions
  if (!cell || !dimensions) return null
  if (!Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y) || !Number.isSafeInteger(cell.z)) return null
  if (cell.x < 0 || cell.y < 0 || cell.z < 0) return null
  if (cell.x >= dimensions.x || cell.y >= dimensions.y || cell.z >= dimensions.z) return null
  return { x: cell.x, y: cell.y, z: cell.z }
}
const mapPresenceEnabled = computed(() => (
  canViewMap.value
  && (isGm.value || (isPlayer.value && Boolean(selectedProfileId.value)))
))
const mapPresence = useMapPresence({
  slug,
  profileId: computed(() => (isPlayer.value ? selectedProfileId.value : null)),
  enabled: mapPresenceEnabled,
  visibleTokenIds: visiblePresenceTokenIds,
  autoStart: false,
})
const mapPresenceEntries = mapPresence.entries
const mapPresencePings = mapPresence.pings
const mapPresenceStatus = mapPresence.status
const mapPresenceDebugMetrics = computed(() => mapPresence.debugMetrics.value)
const mapPresenceServerTimeOffsetMs = computed(() => mapPresence.transportFreshness.value.serverTimeOffsetMs)
const canRequestGmAttention = computed(() => mapPresenceEnabled.value && isGm.value)
const ownPresenceClientIdSuffix = computed(() => (
  import.meta.client ? livePlayPresenceClientIdSuffix(getClientId()) : null
))
const remoteTokenAttention = computed(() => buildMapTokenRemoteAttention(
  mapPresenceEntries.value,
  visiblePresenceTokenIdSet.value,
))
const remotePresenceIntentOverlays = computed(() => buildMapPresenceIntentOverlays(
  mapPresenceEntries.value,
  {
    visibleTokenIds: visiblePresenceTokenIdSet.value,
    ownPresence: mapPresence.ownPresence.value,
    ownClientIdSuffix: ownPresenceClientIdSuffix.value,
    serverNowMs: Date.now() + mapPresenceServerTimeOffsetMs.value,
  },
))

const updateOwnTokenPresence = (selectedTokenId: string | null, hoveredTokenId: string | null, publish = true): void => {
  if (
    mapPresence.ownPresence.value.selectedTokenId === selectedTokenId
    && mapPresence.ownPresence.value.hoveredTokenId === hoveredTokenId
  ) return

  void mapPresence.updateOwnPresence({ selectedTokenId, hoveredTokenId }, { publish })
}

const clearOwnPresenceForContextChange = (): void => {
  const ownPresence = mapPresence.ownPresence.value
  if (
    ownPresence.selectedTokenId === null
    && ownPresence.hoveredTokenId === null
    && ownPresence.ping === null
    && ownPresence.attention === null
    && ownPresence.intent.kind === 'idle'
  ) return

  void mapPresence.updateOwnPresence({
    selectedTokenId: null,
    hoveredTokenId: null,
    ping: null,
    attention: null,
    intent: { kind: 'idle' },
  }, { publish: false })
}

const placePresencePingFromScene = (payload: { cell: LivePlayPresenceGridCell; label?: unknown }): void => {
  if (!mapPresenceEnabled.value) return
  const cell = presencePingCellIfVisible(payload.cell)
  if (!cell) return
  void mapPresence.placePing(cell, { label: payload.label })
}

const requestGmAttention = (target: LivePlayPresenceAttentionTarget, label?: unknown): void => {
  if (!canRequestGmAttention.value) return
  if (target.kind === 'token') {
    const tokenId = presenceTokenIdIfVisible(target.tokenId)
    if (!tokenId) return
    void mapPresence.requestAttention({ kind: 'token', tokenId }, { label })
    return
  }

  const cell = presencePingCellIfVisible(target.cell)
  if (!cell) return
  void mapPresence.requestAttention({ kind: 'cell', cell }, { label })
}

const requestGmAttentionForSelectedToken = (): void => {
  const tokenId = presenceTokenIdIfVisible(selectedId.value)
  if (!tokenId) return
  requestGmAttention({ kind: 'token', tokenId })
}

const requestGmAttentionFromScene = (payload: { target: LivePlayPresenceAttentionTarget; label?: unknown }): void => {
  requestGmAttention(payload.target, payload.label)
}

const focusPresenceAttentionTarget = (target: LivePlayPresenceAttentionTarget): void => {
  if (target.kind === 'token') {
    const tokenId = presenceTokenIdIfVisible(target.tokenId)
    if (tokenId) gridRef.value?.focusPokemon(tokenId)
    return
  }

  const cell = presencePingCellIfVisible(target.cell)
  if (cell) gridRef.value?.focusCell(cell)
}

const syncOwnTokenPresence = (publish = true): void => {
  if (!mapPresenceEnabled.value) {
    clearOwnPresenceForContextChange()
    return
  }

  updateOwnTokenPresence(
    presenceTokenIdIfVisible(selectedId.value),
    presenceTokenIdIfVisible(hoveredPresenceTokenId.value),
    publish,
  )
}

const setHoveredPresenceToken = (tokenId: string | null): void => {
  hoveredPresenceTokenId.value = presenceTokenIdIfVisible(tokenId)
}

watch(
  [selectedId, hoveredPresenceTokenId, visiblePresenceTokenIds, mapPresenceEnabled],
  () => syncOwnTokenPresence(),
  { immediate: true },
)

watch(
  selectedProfileId,
  (nextProfileId, previousProfileId) => {
    if (nextProfileId === previousProfileId) return
    hoveredPresenceTokenId.value = null
    if (isPlayer.value) clearSelection()
    clearOwnPresenceForContextChange()
  },
  { flush: 'sync' },
)

if (import.meta.client) {
  let mapPresenceStarted = false
  watch(
    [mapPresenceEnabled, selectedProfileId],
    ([enabled]) => {
      if (!enabled) {
        mapPresence.stop()
        mapPresenceStarted = false
        syncOwnTokenPresence(false)
        return
      }
      if (!mapPresenceStarted) {
        syncOwnTokenPresence(false)
        mapPresence.start()
        mapPresenceStarted = true
        return
      }
      syncOwnTokenPresence(false)
      void mapPresence.loadSnapshot()
      void mapPresence.sendHeartbeat()
    },
    { immediate: true },
  )
}

const livePlayTokenLabel = (placementId: string): string => {
  const spawned = spawnedPokemon.value.find((pokemon) => pokemon.id === placementId)
  if (spawned?.species) return spawned.species
  const placement = placementById(placementId)
  return placement?.sheetSlug ?? 'This token'
}

const livePlayPendingConditionsByTokenId = computed<Readonly<Record<string, readonly string[]>>>(() => {
  const conditionPredictions = Object.values(livePlayCommands.pendingPredictions.value).filter((prediction) => (
    prediction.pendingConditionChange !== undefined
  ))
  if (conditionPredictions.length === 0) return {}

  const pendingConditionsByTokenId: Record<string, readonly string[]> = {}
  for (const pokemon of spawnedPokemon.value) {
    let conditions: readonly string[] = pokemon.conditions
    let hasPendingConditionPrediction = false
    for (const prediction of conditionPredictions) {
      if (prediction.placementId !== pokemon.id) continue
      conditions = livePlayConditionsForPrediction(conditions, prediction)
      hasPendingConditionPrediction = true
    }
    if (hasPendingConditionPrediction) pendingConditionsByTokenId[pokemon.id] = [...conditions]
  }
  return pendingConditionsByTokenId
})

const {
  spawnSheetPending,
  spawnSheetFromMenu,
} = useMapPageTokenSpawning({
  isSetupEditMode,
  authoritativeSnapshotReady: computed(() => aggregateSnapshotReady.value && livePlayCommandsAllowed.value),
  createSpawnPlacement,
  spawnSheetForSetupEdit,
  spawnToken: ({ placement }) => livePlayCommands.spawnToken({
    placement: deepCloneJson(placement),
  }),
})

const tableActionDispatchers = useMapPageTableActionDispatchers({
  isSetupEditMode,
  livePlayCommands,
})

const enqueueMoveVfxDebugPreview = (kind: MoveVfxKind | 'all') => {
  const selectedTokenId = selectedId.value
  if (!selectedTokenId || !canControlPlacement(selectedTokenId)) return

  const events = createMoveVfxDebugPreviewEvents({
    kind,
    selectedId: selectedTokenId,
    tokens: spawnedPokemon.value,
    controllablePlacementIds: controllablePlacementIds.value,
    dimensions: map.value?.dimensions ?? null,
  })

  if (events.length === 0) return
  enqueueLocalMoveAnimations(events)
}

const previewMoveVfxDebugKind = (kind: MoveVfxKind) => {
  enqueueMoveVfxDebugPreview(kind)
}

const previewAllMoveVfxDebug = () => {
  enqueueMoveVfxDebugPreview('all')
}

const selectPokemon = (id: string | null) => {
  if (buildMode.value) return
  selectPlacement(id)
}
const deletePokemon = (id: string) => {
  if (!canControlPlacement(id)) return
  if (isSetupEditMode()) {
    deletePlacement(id)
    return
  }
  void livePlayCommands.deleteToken({ placementId: id }).then((result) => {
    if (result.dispatched) clearSelection()
  })
}
const turnPokemon = (id: string) => {
  const placement = placementById(id)
  if (!placement || !canControlPlacement(id)) return
  if (isSetupEditMode()) {
    turnPlacementForSetupEdit(id)
    clearSelection()
    return
  }
  const facing = nextTokenFacingForPlacement(placement)
  const pendingPredictionOpIdsBeforeTurn = new Set(Object.keys(livePlayCommands.pendingPredictions.value))
  const dispatch = livePlayCommands.turnToken({ placementId: id, facing })
  const predictedTurn = newPendingTurnPredictionForPlacement(pendingPredictionOpIdsBeforeTurn, id)
  if (predictedTurn) {
    rememberLivePlayPredictedToken(predictedTurn, livePlayTokenLabel(id))
    clearSelection()
  }

  void dispatch.then((result) => {
    if (!result.dispatched) {
      if (result.opId) forgetLivePlayPredictedToken(result.opId)
      return
    }
    if (result.opId) forgetLivePlayPredictedToken(result.opId)
    const turnWasPredicted = predictedTurn !== null
    if (!turnWasPredicted) clearSelection()
  })
}

let attackOfOpportunityTriggers: ReturnType<typeof useAttackOfOpportunityTriggers> | null = null

const newPendingTokenPredictionForPlacement = (
  previousOpIds: ReadonlySet<string>,
  placementId: string,
  commandType: LivePlayLocalPrediction['commandType'],
): LivePlayLocalPrediction | null => (
  Object.values(livePlayCommands.pendingPredictions.value).find((prediction) => (
    !previousOpIds.has(prediction.opId)
    && prediction.commandType === commandType
    && prediction.placementId === placementId
  )) ?? null
)

const newPendingMovePredictionForPlacement = (
  previousOpIds: ReadonlySet<string>,
  placementId: string,
): LivePlayLocalPrediction | null => newPendingTokenPredictionForPlacement(
  previousOpIds,
  placementId,
  LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
)

const newPendingTurnPredictionForPlacement = (
  previousOpIds: ReadonlySet<string>,
  placementId: string,
): LivePlayLocalPrediction | null => newPendingTokenPredictionForPlacement(
  previousOpIds,
  placementId,
  LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
)

const newPendingConditionsPredictionForPlacement = (
  previousOpIds: ReadonlySet<string>,
  placementId: string,
): LivePlayLocalPrediction | null => newPendingTokenPredictionForPlacement(
  previousOpIds,
  placementId,
  LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS,
)

const movePokemon = (payload: TokenMovementCommitPayload) => {
  const from = spawnedPokemon.value.find((pokemon) => pokemon.id === payload.id)?.position
    ?? placementById(payload.id)?.position
  const previousPosition = from ? { ...from } : null

  if (!canControlPlacement(payload.id)) return
  if (isSetupEditMode()) {
    movePlacementForSetupEdit(payload)
    return
  }
  const pendingPredictionOpIdsBeforeMove = new Set(Object.keys(livePlayCommands.pendingPredictions.value))
  const dispatch = livePlayCommands.moveToken({
    placementId: payload.id,
    position: payload.position,
    pathLength: previewState.value.pathLength,
  })
  const predictedMove = newPendingMovePredictionForPlacement(pendingPredictionOpIdsBeforeMove, payload.id)
  if (predictedMove) {
    rememberLivePlayPredictedToken(predictedMove, livePlayTokenLabel(payload.id))
    clearSelection()
  }

  void dispatch.then(async (result) => {
    if (!result.dispatched) {
      if (result.opId) forgetLivePlayPredictedToken(result.opId)
      return
    }
    if (result.opId) forgetLivePlayPredictedToken(result.opId)
    const moveWasPredicted = predictedMove !== null
    if (!moveWasPredicted) clearSelection()
    const currentPosition = placementById(payload.id)?.position
    if (!previousPosition || !currentPosition || isSameAnchor(previousPosition, currentPosition)) return
    await Promise.resolve(attackOfOpportunityTriggers?.provokeMovementAttackOfOpportunity({
      provokerId: payload.id,
      from: previousPosition,
      to: { ...currentPosition },
    }))
  })
}

const hazardCount = computed(() => mapHazards.value.length)
const {
  hazardMode,
  hazardTool,
  hazardKind,
  activeHazardDef,
  hazardPalette,
  placeHazard,
  removeHazard,
  clearAllHazards,
  setHazardTool,
  selectHazardKind,
} = useHazardBuilder({ map, mapHazards, canEditMap })

const {
  weatherCoexistNext,
  mapFieldEffects,
  activeWeatherEffects,
  activeTerrainEffects,
  activeRoomEffects,
  fieldEffectCount,
  weatherPalette,
  terrainPalette,
  roomPalette,
  weatherDefinition,
  terrainDefinition,
  roomDefinition,
  weatherIsActive,
  terrainIsActive,
  roomIsActive,
  setWeather: setWeatherLocally,
  removeWeather: removeWeatherLocally,
  clearWeather: clearWeatherLocally,
  toggleTerrain: toggleTerrainLocally,
  removeTerrain: removeTerrainLocally,
  toggleRoom: toggleRoomLocally,
  removeRoom: removeRoomLocally,
  setWeatherRounds: setWeatherRoundsLocally,
  setTerrainRounds: setTerrainRoundsLocally,
  setRoomRounds: setRoomRoundsLocally,
  durationLabel,
  tickFieldEffectDurations: tickFieldEffectDurationsLocally,
  clearAllFieldEffects: clearAllFieldEffectsLocally,
  applyMoveFieldEffect: applyMoveFieldEffectLocally,
} = useFieldEffectsEditor({ map, canEditMap })

const activeScene = computed(() => map.value?.activeScene ?? null)
const combatLogEntryCount = computed(() => countCombatLogMessages(
  map.value?.metadata,
  { scene: activeScene.value ?? null },
))

const clearCombatLog = () => {
  if (!map.value || !canEditMap.value || combatLogEntryCount.value <= 0) return

  const count = combatLogEntryCount.value
  const ok = typeof window === 'undefined' || window.confirm(
    `Clear ${count} combat log ${count === 1 ? 'entry' : 'entries'}? This cannot be undone.`,
  )
  if (!ok) return

  const nextMetadata = clearCombatLogMetadata(map.value.metadata)
  if (nextMetadata) map.value.metadata = nextMetadata
  else delete map.value.metadata
}

const setWeatherCoexistNext = (value: boolean) => {
  weatherCoexistNext.value = value
}

const livePlayActionablePlacementIds = computed(() => {
  if (isSetupEditMode()) return controllablePlacementIds.value
  return livePlayCommandsAllowed.value ? controllablePlacementIds.value : []
})

const clearWeatherCoexistIfNoWeather = () => {
  if (!activeWeatherEffects.value.length) weatherCoexistNext.value = false
}

const clearAllHazardsFromMenu = async () => {
  if (isSetupEditMode()) {
    clearAllHazards()
    return
  }
  if (!canEditMap.value || !mapHazards.value.length) return
  const count = mapHazards.value.length
  const ok = typeof window === 'undefined' || window.confirm(
    `Remove all ${count} hazard square${count === 1 ? '' : 's'}?`,
  )
  if (!ok) return

  await livePlayCommands.clearHazards({ mode: 'all' })
}

const setWeatherFromMenu = async (kind: MapWeatherKind) => {
  if (isSetupEditMode()) {
    setWeatherLocally(kind)
    return
  }
  if (!canEditMap.value) return
  const append = weatherCoexistNext.value && activeWeatherEffects.value.length > 0
  const result = await livePlayCommands.setFieldEffect({
    category: 'weather',
    kind,
    weatherMode: append ? 'append' : 'replace',
  })
  if (result.dispatched && append) weatherCoexistNext.value = false
}

const removeWeatherFromMenu = async (kind: MapWeatherKind) => {
  if (isSetupEditMode()) {
    removeWeatherLocally(kind)
    return
  }
  if (!canEditMap.value) return
  const result = await livePlayCommands.removeFieldEffect({ category: 'weather', kind })
  if (result.dispatched) clearWeatherCoexistIfNoWeather()
}

const clearWeatherFromMenu = async () => {
  if (isSetupEditMode()) {
    clearWeatherLocally()
    return
  }
  if (!canEditMap.value) return
  const result = await livePlayCommands.clearFieldEffects({ category: 'weather' })
  if (result.dispatched) weatherCoexistNext.value = false
}

const toggleTerrainFromMenu = async (kind: MapTerrainKind) => {
  if (isSetupEditMode()) {
    toggleTerrainLocally(kind)
    return
  }
  if (!canEditMap.value) return
  if (terrainIsActive(kind)) await livePlayCommands.removeFieldEffect({ category: 'terrain', kind })
  else await livePlayCommands.setFieldEffect({ category: 'terrain', kind })
}

const removeTerrainFromMenu = async (kind: MapTerrainKind) => {
  if (isSetupEditMode()) {
    removeTerrainLocally(kind)
    return
  }
  if (!canEditMap.value) return
  await livePlayCommands.removeFieldEffect({ category: 'terrain', kind })
}

const toggleRoomFromMenu = async (kind: MapRoomKind) => {
  if (isSetupEditMode()) {
    toggleRoomLocally(kind)
    return
  }
  if (!canEditMap.value) return
  if (roomIsActive(kind)) await livePlayCommands.removeFieldEffect({ category: 'room', kind })
  else await livePlayCommands.setFieldEffect({ category: 'room', kind })
}

const removeRoomFromMenu = async (kind: MapRoomKind) => {
  if (isSetupEditMode()) {
    removeRoomLocally(kind)
    return
  }
  if (!canEditMap.value) return
  await livePlayCommands.removeFieldEffect({ category: 'room', kind })
}

const fieldEffectRoundsFromEvent = (event: Event): number | null =>
  parseRoundInputValue(textValueFromEvent(event))

const setWeatherRoundsFromMenu = async (kind: MapWeatherKind, event: Event) => {
  if (isSetupEditMode()) {
    setWeatherRoundsLocally(kind, event)
    return
  }
  if (!canEditMap.value) return
  const rounds = fieldEffectRoundsFromEvent(event)
  if (rounds === 0) await removeWeatherFromMenu(kind)
  else {
    await livePlayCommands.setFieldEffect({
      category: 'weather',
      kind,
      rounds,
      weatherMode: activeWeatherEffects.value.length > 1 ? 'append' : 'replace',
    })
  }
}

const setTerrainRoundsFromMenu = async (kind: MapTerrainKind, event: Event) => {
  if (isSetupEditMode()) {
    setTerrainRoundsLocally(kind, event)
    return
  }
  if (!canEditMap.value) return
  const rounds = fieldEffectRoundsFromEvent(event)
  if (rounds === 0) await removeTerrainFromMenu(kind)
  else await livePlayCommands.setFieldEffect({ category: 'terrain', kind, rounds })
}

const setRoomRoundsFromMenu = async (kind: MapRoomKind, event: Event) => {
  if (isSetupEditMode()) {
    setRoomRoundsLocally(kind, event)
    return
  }
  if (!canEditMap.value) return
  const rounds = fieldEffectRoundsFromEvent(event)
  if (rounds === 0) await removeRoomFromMenu(kind)
  else await livePlayCommands.setFieldEffect({ category: 'room', kind, rounds })
}

const tickFieldEffectDurationsFromMenu = async () => {
  if (isSetupEditMode()) {
    tickFieldEffectDurationsLocally()
    return
  }
  if (!canEditMap.value) return
  await livePlayCommands.tickFieldEffectDurations()
}

const clearAllFieldEffectsFromMenu = async () => {
  if (isSetupEditMode()) {
    clearAllFieldEffectsLocally()
    return
  }
  if (!canEditMap.value || fieldEffectCount.value === 0) return
  const ok = typeof window === 'undefined' || window.confirm('Clear all active Weather, Terrain, and Room effects?')
  if (!ok) return
  const result = await livePlayCommands.clearFieldEffects({ category: 'all' })
  if (result.dispatched) weatherCoexistNext.value = false
}

const {
  buildMode,
  buildTool,
  buildMaterial,
  buildColor,
  buildGhostVoxel,
  ghostVoxelsFaded,
  placeVoxel,
  removeVoxel,
} = useTerrainBuilder({ map, mapVoxels, mapGroundLevelY, spawnedPokemon, canEditMap })

const {
  adminPanelOpen,
  fieldEffectsMenuOpen,
  sheetsMenuOpen,
  initiativeMenuOpen,
  layerVisibility,
  smartTerrainCutawayEnabled,
  closeFieldEffectsMenu,
  closeSheetsMenu,
  closeInitiativeMenu,
  setMode,
} = useMapEditorUiState({
  isGm,
  canEditMap,
  buildMode,
  hazardMode,
  clearSelection,
})

const {
  initiativeRows,
  sortedInitiativeRows,
  manualInitiativeOrderActive,
  activeInitiativeId,
  initiativeRound,
  hasInitiativeValues,
  focusInitiativeEntry,
  setActiveInitiativeAndFocus,
  setInitiativeInput,
  setInitiativeFromSpeed,
  setInitiativeRound,
  fillInitiativeFromSpeed,
  clearInitiativeValues,
  clearActiveInitiative,
  setManualInitiativeOrder,
  moveInitiativeRow,
  reorderInitiativeRows,
  nextInitiative,
  previousInitiative,
} = useInitiativeTracker({
  map,
  spawnedPokemon,
  pokemonBySlug,
  trainerBySlug,
  canManageInitiative,
  interactionMode: computed(() => mapInteractionMode.value),
  dispatchSetInitiative: (payload) => livePlayCommands.setInitiative(payload),
  dispatchNextInitiative: (payload) => livePlayCommands.nextInitiative(payload),
  dispatchPreviousInitiative: (payload) => livePlayCommands.previousInitiative(payload),
  focusEntry: (id) => {
    gridRef.value?.focusPokemon(id)
  },
})

const initiativeControlsEnabled = computed(() => (
  canManageInitiative.value
  && (
    mapInteractionMode.value !== MAP_INTERACTION_MODES.LIVE_PLAY
    || livePlayCommandsAllowed.value
  )
))

const {
  activeStartTurnModal,
  startTurnModalBusy,
  closeStartTurnModal,
  resolveStartTurnModalCondition,
} = useStartTurnModal({
  map,
  canViewMap,
  mapInPrepareMode,
  activeInitiativeId,
  initiativeRound,
  sortedInitiativeRows,
  placementById,
  isGm,
  livePlayReady: computed(() => livePlayConnectionState.value === 'ready'),
  commandSaving: computed(() => livePlayCommands.transportStatus.value === 'sending'),
  updateTurn: (payload) => livePlayCommands.updateStartTurnModal(payload),
  replaceConditions: (payload) => modifyConditionsFromScene({
    id: payload.id,
    conditions: [...payload.conditions],
  }, { allowAnyTarget: true }),
})

const canManageScene = computed(() => (
  isGm.value
  && canViewMap.value
  && mapInteractionMode.value === MAP_INTERACTION_MODES.LIVE_PLAY
))
const sceneControlsDisabled = computed(() => !livePlayCommandsAllowed.value)
const startSceneFromPanel = () => {
  if (!import.meta.client) return
  const enteredName = window.prompt(`Scene name (max ${MAP_SCENE_NAME_MAX_LENGTH} characters)`)
  const name = normalizeMapSceneName(enteredName)
  if (!name) return
  void livePlayCommands.setScene({ name })
}

const endSceneFromPanel = () => {
  void livePlayCommands.setScene({ name: null })
}

let publishSyncedActionSplash: MapActionSplashPublishHandler | null = null
let publishSyncedMoveAnimations: MapActionMoveAnimationsPublishHandler | null = null
let publishSyncedMoveFeedback: MapActionMoveFeedbackPublishHandler | null = null
let publishSyncedPokeballFeedback: MapActionPokeballFeedbackPublishHandler | null = null
let publishSyncedPokeballResult: MapActionPokeballResultPublishHandler | null = null
const {
  actionSplash,
  showActionSplash,
  replayActionSplash,
  clearActionSplash,
} = useMapActionSplash({
  spawnedPokemon,
  initiativeRows,
  publishActionSplash: (request) => publishSyncedActionSplash?.(request),
  durationMs: actionSplashDisplayDurationMs,
  leadInMs: actionSplashDisplayDurationMs,
})
const {
  enqueueAndBroadcastMoveAnimations,
  replayMoveAnimations,
} = useMapActionMoveAnimations({
  enqueueLocalMoveAnimations,
  publishMoveAnimations: (request) => publishSyncedMoveAnimations?.(request),
})
const {
  remoteMoveAutomationFeedback,
  broadcastMoveFeedback,
  replayMoveFeedback,
  clearRemoteMoveFeedback,
} = useMapActionMoveFeedback({
  publishMoveFeedback: (request) => publishSyncedMoveFeedback?.(request),
})
const {
  remotePokeballCaptureFeedback,
  remotePokeballCaptureResult,
  remotePokeballCaptureError,
  enqueueAndBroadcastPokeballThrow,
  broadcastPokeballFeedback,
  replayPokeballFeedback,
  broadcastPokeballResult,
  replayPokeballResult,
  scheduleRemotePokeballCaptureResultFallback,
  clearRemotePokeballCapture,
  clearRemotePokeballCaptureFeedback,
  dismissRemotePokeballCaptureResult,
} = useMapActionPokeballCapture({
  enqueueAndBroadcastMoveAnimations,
  publishPokeballFeedback: (request) => publishSyncedPokeballFeedback?.(request),
  publishPokeballResult: (request) => publishSyncedPokeballResult?.(request),
})

const scheduleAcceptedRealtimePokeballCaptureResultNow = (event: LivePlayAcceptedRealtimeEvent): void => {
  // The acting browser normally publishes transient pokeball-result map-actions.
  // Authoritative accepted-command patches are the fallback so remote live-play
  // viewers still get the capture modal if that transient publish is missed.
  if (isRealtimeEcho(event, getClientId())) return
  const capture = pokeballCaptureFromAcceptedRealtimeEvent(event)
  if (!capture) return
  scheduleRemotePokeballCaptureResultFallback({
    result: capture.result,
    error: capture.result.hit ? null : capture.result.failureReason ?? 'The Poké Ball missed.',
  })
}
scheduleAcceptedRealtimePokeballCaptureResult = scheduleAcceptedRealtimePokeballCaptureResultNow
for (const event of queuedAcceptedRealtimeCaptureEvents.splice(0)) {
  scheduleAcceptedRealtimePokeballCaptureResultNow(event)
}

const mapActionEventSync = useMapActionEventSync({
  slug,
  profileId: computed(() => (isPlayer.value ? selectedProfileId.value : null)),
  handlers: {
    onActionSplash: (event) => replayActionSplash({
      userId: event.actorPlacementId,
      actionName: event.payload.actionName,
      verb: event.payload.verb,
    }),
    onMoveAnimations: async (event) => {
      await replayMoveAnimations(event.payload.events)
    },
    onMoveFeedback: (event) => {
      clearRemotePokeballCapture()
      replayMoveFeedback(event.payload.feedback)
    },
    onPokeballFeedback: (event) => {
      clearRemoteMoveFeedback()
      replayPokeballFeedback(event.payload.feedback)
    },
    onPokeballResult: (event) => {
      clearRemoteMoveFeedback()
      replayPokeballResult(event.payload)
    },
  },
})
publishSyncedActionSplash = (request) => mapActionEventSync.publishActionSplash(request)
publishSyncedMoveAnimations = (request) => mapActionEventSync.publishMoveAnimations(request)
publishSyncedMoveFeedback = (request) => mapActionEventSync.publishMoveFeedback(request)
publishSyncedPokeballFeedback = (request) => mapActionEventSync.publishPokeballFeedback(request)
publishSyncedPokeballResult = (request) => mapActionEventSync.publishPokeballResult(request)

const acceptedMovePresentation = useAcceptedMovePresentation({
  enqueueMoveAnimations: replayMoveAnimations,
  enqueueAndPublishMoveAnimations: enqueueAndBroadcastMoveAnimations,
})
presentAcceptedMove = (presentation, publishHint): void => {
  acceptedMovePresentation.present(presentation, { publishHint })
}
acceptedMoveWasPresented = acceptedMovePresentation.hasPresented
for (const queued of queuedAcceptedMovePresentations.splice(0)) {
  presentAcceptedMove(queued.presentation, queued.publishHint)
}

watch(mapDataRevision, () => {
  clearRemoteMoveFeedback()
  if (remotePokeballCaptureResult.value) clearRemotePokeballCaptureFeedback()
  else clearRemotePokeballCapture()
})

onBeforeUnmount(() => {
  clearActionSplash()
  clearRemoteMoveFeedback()
  clearRemotePokeballCapture()
})

let expireActiveOrdersLocallyAfterInitiativeAdvance: (advance: {
  before: { activeId: string | null; round: number }
  after: { activeId: string | null; round: number }
}) => void = () => {}

const orderTimelinePoint = () => ({
  activeId: activeInitiativeId.value ?? null,
  round: initiativeRound.value,
})

const previousInitiativeFromControls = async () => {
  if (!isSetupEditMode()) {
    await Promise.resolve(previousInitiative())
    return
  }
  await Promise.resolve(previousInitiative())
}

const nextInitiativeFromControls = async () => {
  if (!isSetupEditMode()) {
    await Promise.resolve(nextInitiative())
    return
  }
  const before = orderTimelinePoint()
  await Promise.resolve(nextInitiative())
  expireActiveOrdersLocallyAfterInitiativeAdvance({ before, after: orderTimelinePoint() })
}

const {
  lastError: tokenSheetMutationError,
  modifyHp: modifyHpViaSetupSheetSave,
  modifyCombatStages: modifyCombatStagesViaSetupSheetSave,
  modifyConditions: modifyConditionsViaSetupSheetSave,
  grantExperience: grantExperienceViaSetupSheetSave,
  modifyAbilityActivation,
  updatePlacedSheet,
} = useTokenSheetMutations({
  map,
  sheetLookup,
  canControlPlacement,
  playerProfileId: computed(() => (isPlayer.value ? selectedProfileId.value : null)),
  interactionMode: mapInteractionMode,
})

const modifyHpFromScene: typeof modifyHpViaSetupSheetSave = async (payload, options) => {
  if (mapInteractionMode.value === MAP_INTERACTION_MODES.SETUP_EDIT) {
    if (payload.temporaryHp !== undefined && map.value) {
      setTemporaryHpForPlacement(map.value, payload.id, payload.temporaryHp)
    }
    await modifyHpViaSetupSheetSave(payload, options)
    return
  }
  await livePlayCommands.modifyHp({
    placementId: payload.id,
    currentHp: payload.currentHp,
    ...(payload.temporaryHp === undefined ? {} : { temporaryHp: payload.temporaryHp }),
    ...(payload.injuries === undefined ? {} : { injuries: payload.injuries }),
  })
}

const modifyCombatStagesFromScene: typeof modifyCombatStagesViaSetupSheetSave = async (payload, options) => {
  if (mapInteractionMode.value === MAP_INTERACTION_MODES.SETUP_EDIT) {
    await modifyCombatStagesViaSetupSheetSave(payload, options)
    return
  }
  await livePlayCommands.modifyCombatStages({
    placementId: payload.id,
    stages: payload.stages,
  })
}

const modifyConditionsFromScene: typeof modifyConditionsViaSetupSheetSave = async (payload, options) => {
  if (mapInteractionMode.value === MAP_INTERACTION_MODES.SETUP_EDIT) {
    await modifyConditionsViaSetupSheetSave(payload, options)
    return
  }
  const pendingPredictionOpIdsBeforeConditions = new Set(Object.keys(livePlayCommands.pendingPredictions.value))
  const dispatch = livePlayCommands.modifyConditions({
    placementId: payload.id,
    action: 'replace',
    conditions: payload.conditions,
  })
  const predictedConditions = newPendingConditionsPredictionForPlacement(pendingPredictionOpIdsBeforeConditions, payload.id)
  if (predictedConditions) rememberLivePlayPredictedToken(predictedConditions, livePlayTokenLabel(payload.id))

  const result = await dispatch
  if (result.opId) forgetLivePlayPredictedToken(result.opId)
}

const grantExperienceFromScene: typeof grantExperienceViaSetupSheetSave = async (payload, options) => {
  if (mapInteractionMode.value === MAP_INTERACTION_MODES.SETUP_EDIT) {
    await grantExperienceViaSetupSheetSave(payload, options)
    return
  }
  await livePlayCommands.grantExperience({
    placementId: payload.id,
    amount: payload.amount,
  })
}

const dispatchMoveAutomationAuthoritatively: MoveAutomationAuthoritativeDispatchHandler = async (request) => {
  if (isSetupEditMode()) return undefined

  const result = await livePlayCommands.resolveMove({
    intent: request.intent,
    candidateScopePlacementIds: request.candidateScopePlacementIds,
  })

  if (!result.dispatched) {
    return {
      accepted: false,
      ...(result.message ? { message: result.message } : {}),
    }
  }

  return {
    accepted: true,
    move: result.move,
    presentationHandled: acceptedMoveWasPresented(result.opId),
    ...(result.presentationError ? { presentationError: result.presentationError } : {}),
  }
}

const moveTokenFromMoveAutomation = async (payload: { id: string; position: GridAnchor }) => {
  if (isSetupEditMode()) {
    const placement = placementById(payload.id)
    if (placement && canControlPlacement(payload.id)) placement.position = { ...payload.position }
    return
  }
  await livePlayCommands.moveToken({
    placementId: payload.id,
    position: payload.position,
  })
}

const applyMoveFieldEffectFromScene = async (effect: Parameters<typeof applyMoveFieldEffectLocally>[0]) => {
  if (isSetupEditMode()) {
    applyMoveFieldEffectLocally(effect)
    return
  }
  if (!canEditMap.value) return
  if (effect.kind === 'weather') {
    await livePlayCommands.setFieldEffect({
      category: 'weather',
      kind: effect.value as MapWeatherKind,
      source: effect.source ?? 'Move automation',
    })
    return
  }
  if (effect.kind === 'terrain') {
    await livePlayCommands.setFieldEffect({
      category: 'terrain',
      kind: effect.value as MapTerrainKind,
      source: effect.source ?? 'Move automation',
    })
    return
  }
  if (effect.kind === 'room') {
    await livePlayCommands.setFieldEffect({
      category: 'room',
      kind: effect.value as MapRoomKind,
      source: effect.source ?? 'Move automation',
    })
  }
}

const placeHazardDirect = async (hazard: Parameters<typeof placeHazard>[0]) => {
  if (isSetupEditMode()) {
    placeHazard(hazard)
    return
  }
  if (!canEditMap.value) return
  await livePlayCommands.placeHazard({ hazard })
}

const removeHazardDirect = async (cell: Parameters<typeof removeHazard>[0]) => {
  if (isSetupEditMode()) {
    removeHazard(cell)
    return
  }
  if (!canEditMap.value) return
  await livePlayCommands.removeHazard({ cell })
}

const placeHazardFromScene = (hazard: Parameters<typeof placeHazard>[0]) => {
  if (isSetupEditMode()) {
    placeHazard(hazard)
    return
  }
  if (!canEditMap.value) return
  livePlayHazardBrushBatcher.queueUpsert(hazard)
}

const removeHazardFromScene = (cell: Parameters<typeof removeHazard>[0]) => {
  if (isSetupEditMode()) {
    removeHazard(cell)
    return
  }
  if (!canEditMap.value) return
  livePlayHazardBrushBatcher.queueRemove(cell)
}

const placeVoxelFromScene: typeof placeVoxel = (voxel) => {
  if (isSetupEditMode()) {
    placeVoxel(voxel)
    return
  }
  if (!canEditMap.value) return
  livePlayTerrainBrushBatcher.queueUpsert(voxel)
}

const removeVoxelFromScene: typeof removeVoxel = (cell) => {
  if (isSetupEditMode()) {
    removeVoxel(cell)
    return
  }
  if (!canEditMap.value) return
  livePlayTerrainBrushBatcher.queueRemove(cell)
}

const sendOutPokemonFromScene: typeof sendOutPokemon = (payload) => {
  if (isSetupEditMode()) return sendOutPokemon(payload)

  const placement = createSendOutPokemonPlacement(payload)
  if (!placement) return false

  void livePlayCommands.sendOutPokemon({
    trainerId: payload.trainerId,
    pokemonSlug: payload.pokemonSlug,
    tokenId: placement.id,
    position: payload.position,
    facing: placement.facing,
  }).then((result) => {
    if (result.dispatched) clearSelection()
  })
  return true
}

const {
  moveAutomationTargeting,
  moveAutomationTargetBranchSelection,
  moveAutomationFeedback,
  moveUsageError,
  moveDispatchPending,
  tokenMoveOptionsById,
  openMoveAutomation: openMoveAutomationPanel,
  useMoveAgainstTarget,
  cancelMoveAutomationTargeting: cancelMoveAutomationTargetingPanel,
  selectMoveAutomationTarget: selectMoveAutomationTargetPanel,
  confirmMoveAutomationTargetCount: confirmMoveAutomationTargetCountPanel,
  selectMoveAutomationTargetBranch: selectMoveAutomationTargetBranchPanel,
  selectMoveAutomationAreaTemplate: selectMoveAutomationAreaTemplatePanel,
  selectMoveAutomationAreaDirection: selectMoveAutomationAreaDirectionPanel,
  aimMoveAutomationArea: aimMoveAutomationAreaPanel,
} = useMoveAutomationPanel({
  map,
  spawnedPokemon,
  pokemonBySlug,
  trainerBySlug,
  canEditMap,
  canControlPlacement,
  modifyHp: modifyHpFromScene,
  modifyCombatStages: modifyCombatStagesFromScene,
  modifyConditions: modifyConditionsFromScene,
  applyMoveFieldEffect: applyMoveFieldEffectFromScene,
  placeHazard: placeHazardDirect,
  moveToken: moveTokenFromMoveAutomation,
  dispatchAuthoritativeMove: dispatchMoveAutomationAuthoritatively,
  enqueueMoveAnimations: enqueueAndBroadcastMoveAnimations,
  onMoveUse: (event) => showActionSplash({ userId: event.userId, actionName: event.moveName }),
  onMoveFeedback: (event) => {
    clearRemoteMoveFeedback()
    clearRemotePokeballCapture()
    broadcastMoveFeedback(event.feedback)
  },
  onRangedAttackOfOpportunity: event => (
    attackOfOpportunityTriggers?.provokeRangedAttackOfOpportunity(event)
  ),
})

attackOfOpportunityTriggers = useAttackOfOpportunityTriggers({
  dispatchTrigger: (payload) => {
    if (isSetupEditMode()) return undefined
    return livePlayCommands.updateAttackOfOpportunity(payload).then((result) => result.dispatched)
  },
})


const {
  abilityAutomationTargeting,
  tokenAbilityOptionsById,
  openAbilityAutomation,
  cancelAbilityAutomationTargeting,
  selectAbilityAutomationTarget,
} = useAbilityAutomationPanel({
  map,
  spawnedPokemon,
  pokemonBySlug,
  trainerBySlug,
  canControlPlacement,
  modifyCombatStages: modifyCombatStagesFromScene,
  modifyConditions: modifyConditionsFromScene,
  modifyAbilityActivation,
  dispatchAbilityUse: tableActionDispatchers.dispatchAbilityUse,
  onBeforeNonImmediateAction: event => (
    showActionSplash({ userId: event.userId, actionName: event.abilityName })
  ),
})

const {
  maneuverActionTargeting,
  tokenManeuverOptionsById,
  useManeuver,
  cancelManeuverActionTargeting,
  selectManeuverActionTarget,
} = useManeuverActionPanel({
  map,
  spawnedPokemon,
  trainerBySlug,
  canControlPlacement,
  dispatchManeuverUse: tableActionDispatchers.dispatchManeuverUse,
  onBeforeManeuverAction: event => (
    showActionSplash({ userId: event.userId, actionName: event.maneuverName })
  ),
})

const orderActionPanel = useOrderActionPanel({
  map,
  spawnedPokemon,
  trainerBySlug,
  canControlPlacement,
  dispatchOrderUse: tableActionDispatchers.dispatchOrderUse,
  onBeforeOrderAction: event => (
    showActionSplash({ userId: event.userId, actionName: event.orderName })
  ),
})
const {
  orderActionTargeting,
  tokenOrderOptionsById,
  useOrder,
  cancelOrderActionTargeting,
  selectOrderActionTarget,
} = orderActionPanel
expireActiveOrdersLocallyAfterInitiativeAdvance = orderActionPanel.expireActiveOrdersLocallyAfterInitiativeAdvance

const applyPokeballCaptureOutcomeForSetupEdit = async (event: PokeballCaptureOutcomeEvent) => {
  const sheetUpdated = await updatePlacedSheet(
    event.trainerId,
    (kind, sheet) => {
      if (kind !== 'trainer') return sheet
      const updated = deepCloneJson(sheet as TrainerSheet)
      applyPokeballCaptureOutcomeToTrainerSheet(updated, event)
      return updated
    },
    'throwPokeball',
  )

  if (sheetUpdated && event.result.success) {
    const targetUpdated = await updatePlacedSheet(
      event.targetId,
      (kind, sheet) => {
        if (kind !== 'pokemon') return sheet
        const updated = deepCloneJson(sheet as CharacterSheet)
        applyPokeballCaptureOutcomeToPokemonSheet(updated, event)
        return updated
      },
      'capturePokeball',
      { allowAnyTarget: true },
    )

    if (targetUpdated) {
      deletePlacement(event.targetId)
      if (selectedId.value === event.targetId) clearSelection()
    }
  }
}

const dispatchPokeballCaptureAttempt = async (request: {
  trainerId: string
  targetId: string
  pokeballName: string
}): Promise<PokeballCaptureOutcomeEvent | false | undefined> => {
  if (isSetupEditMode()) return undefined
  const result = await livePlayCommands.throwPokeball({
    trainerPlacementId: request.trainerId,
    targetPlacementId: request.targetId,
    pokeballName: request.pokeballName,
  })
  if (!result.dispatched || !result.response?.capture) return false
  const capture = result.response.capture
  if (capture.result.success && selectedId.value === capture.targetId) clearSelection()
  return capture
}

const {
  pokeballCaptureTargeting,
  pokeballCaptureResult,
  pokeballCaptureFeedback,
  pokeballCaptureError,
  tokenPokeballOptionsById,
  openPokeballCapture,
  selectPokeballCaptureTarget,
  cancelPokeballCaptureTargeting,
  dismissPokeballCaptureResult,
} = usePokeballCapturePanel({
  map,
  spawnedPokemon,
  pokemonBySlug,
  trainerBySlug,
  canControlPlacement,
  applyCaptureOutcome: applyPokeballCaptureOutcomeForSetupEdit,
  dispatchCaptureAttempt: dispatchPokeballCaptureAttempt,
  onBeforePokeballThrow: (event) => showActionSplash({
    userId: event.userId,
    actionName: event.pokeballName,
    verb: 'throws',
  }),
  onPokeballThrow: (event) => {
    clearRemoteMoveFeedback()
    clearRemotePokeballCapture()
    enqueueAndBroadcastPokeballThrow(event)
  },
  onPokeballFeedback: (event) => {
    clearRemoteMoveFeedback()
    clearRemotePokeballCapture()
    broadcastPokeballFeedback(event.feedback)
  },
  onPokeballResult: (event) => {
    broadcastPokeballResult(event)
  },
})

const displayedPokeballCaptureResult = computed(() => (
  pokeballCaptureResult.value ?? remotePokeballCaptureResult.value
))

const dismissDisplayedPokeballCaptureResult = () => {
  if (pokeballCaptureResult.value) dismissPokeballCaptureResult()
  else dismissRemotePokeballCaptureResult()
}

const pokeballCaptureTrainerAccentColor = computed(() => {
  const result = displayedPokeballCaptureResult.value
  if (!result) return null

  const trainerToken = spawnedPokemon.value.find((pokemon) => pokemon.id === result.trainerId)
  if (!trainerToken) return null
  if (trainerToken.accentColor) return trainerToken.accentColor

  return trainerToken.sheetKind === 'trainer'
    ? trainerBySlug.value.get(trainerToken.sheetSlug)?.accentColor ?? null
    : null
})

const actionAutomationTargeting = computed(() =>
  moveAutomationTargeting.value
  ?? pokeballCaptureTargeting.value
  ?? abilityAutomationTargeting.value
  ?? maneuverActionTargeting.value
  ?? orderActionTargeting.value,
)
const actionAutomationFeedback = computed(() => (
  moveAutomationFeedback.value
  ?? pokeballCaptureFeedback.value
  ?? remotePokeballCaptureFeedback.value
  ?? remoteMoveAutomationFeedback.value
))

const boundedPresenceCount = (count: number, max: number = LIVE_PLAY_PRESENCE_MAX_INTENT_COUNT): number => (
  Math.min(Math.max(0, Math.floor(count)), max)
)

const visiblePresenceTokenCount = (tokenIds: readonly string[] | undefined): number | undefined => {
  if (tokenIds === undefined) return undefined
  const visibleIds = new Set(tokenIds.filter((tokenId) => visiblePresenceTokenIdSet.value.has(tokenId)))
  return boundedPresenceCount(visibleIds.size)
}

const gridCellsEqual = (a: LivePlayPresenceGridCell | undefined, b: LivePlayPresenceGridCell | undefined): boolean => (
  a === b || (a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.z === b.z)
)

const presenceIntentsEqual = (a: LivePlayPresenceIntentState, b: LivePlayPresenceIntentState): boolean => (
  a.kind === b.kind
  && a.sourceTokenId === b.sourceTokenId
  && a.candidateCount === b.candidateCount
  && a.targetCount === b.targetCount
  && gridCellsEqual(a.cell, b.cell)
  && a.area?.cellCount === b.area?.cellCount
)

const presenceIntentForTargetingOverlay = (
  targeting: MoveAutomationTargetingOverlayState | null | undefined,
): LivePlayPresenceIntentState | null => {
  if (!targeting) return null
  const sourceTokenId = presenceTokenIdIfVisible(targeting.userId)
  if (!sourceTokenId) return null
  const candidateCount = visiblePresenceTokenCount(targeting.candidateIds)
  const targetCount = visiblePresenceTokenCount(targeting.selectedTargetIds ?? targeting.affectedIds)
  const cell = presencePingCellIfVisible(targeting.areaAimCenter)
  const areaCellCount = targeting.areaCells?.length
  return {
    kind: 'targeting',
    sourceTokenId,
    ...(candidateCount === undefined ? {} : { candidateCount }),
    ...(targetCount === undefined ? {} : { targetCount }),
    ...(cell === null ? {} : { cell }),
    ...(areaCellCount ? { area: { cellCount: boundedPresenceCount(areaCellCount, LIVE_PLAY_PRESENCE_MAX_INTENT_AREA_CELLS) } } : {}),
  }
}

const presenceIntentForTargetBranchSelection = (): LivePlayPresenceIntentState | null => {
  const selection = moveAutomationTargetBranchSelection.value
  const sourceTokenId = presenceTokenIdIfVisible(selection?.userId)
  if (!selection || !sourceTokenId) return null
  return {
    kind: 'targeting',
    sourceTokenId,
    candidateCount: boundedPresenceCount(selection.options.length),
  }
}

const presenceIntentForMovementPreview = (): LivePlayPresenceIntentState | null => {
  const preview = previewState.value
  const sourceTokenId = presenceTokenIdIfVisible(selectedId.value)
  const cell = presencePingCellIfVisible(preview.position)
  if (!sourceTokenId || !preview.position || preview.pathLength <= 0) return null
  return {
    kind: 'moving-token',
    sourceTokenId,
    ...(cell === null ? {} : { cell }),
  }
}

const presenceIntentForLiveMapEditing = (): LivePlayPresenceIntentState | null => {
  if (isSetupEditMode() || !mapActionEditingEnabled.value) return null
  return buildMode.value || hazardMode.value ? { kind: 'targeting' } : null
}

const activeOwnPresenceIntent = computed<LivePlayPresenceIntentState>(() => (
  presenceIntentForTargetingOverlay(actionAutomationTargeting.value)
  ?? presenceIntentForTargetBranchSelection()
  ?? presenceIntentForMovementPreview()
  ?? presenceIntentForLiveMapEditing()
  ?? (mapPresence.ownPresence.value.ping ? { kind: 'placing-ping' } : { kind: 'idle' })
))

const syncOwnPresenceIntent = (publish = true): void => {
  if (!mapPresenceEnabled.value) {
    clearOwnPresenceForContextChange()
    return
  }

  const intent = activeOwnPresenceIntent.value
  if (presenceIntentsEqual(mapPresence.ownPresence.value.intent, intent)) return
  void mapPresence.updateOwnPresence({ intent }, { publish })
}

watch(
  [activeOwnPresenceIntent, mapPresenceEnabled],
  () => syncOwnPresenceIntent(),
  { immediate: true },
)

const moveAutomationDispatchInFlight = () => moveDispatchPending.value

const cancelMoveAutomationTargeting = () => {
  if (moveAutomationDispatchInFlight()) return
  cancelMoveAutomationTargetingPanel()
}

const selectMoveAutomationTarget = (targetId: string) => {
  if (moveAutomationDispatchInFlight()) return
  void selectMoveAutomationTargetPanel(targetId)
}

const confirmMoveAutomationTargetCount = () => {
  if (moveAutomationDispatchInFlight()) return
  void confirmMoveAutomationTargetCountPanel()
}

const selectMoveAutomationTargetBranch = (branchId: string) => {
  if (moveAutomationDispatchInFlight()) return
  selectMoveAutomationTargetBranchPanel(branchId)
}

const selectMoveAutomationAreaTemplate = (templateId: string) => {
  if (moveAutomationDispatchInFlight()) return
  selectMoveAutomationAreaTemplatePanel(templateId)
}

const selectMoveAutomationAreaDirection = (direction: Parameters<typeof selectMoveAutomationAreaDirectionPanel>[0]) => {
  if (moveAutomationDispatchInFlight()) return
  selectMoveAutomationAreaDirectionPanel(direction)
}

const aimMoveAutomationArea = (aimCell: GridAnchor) => {
  if (moveAutomationDispatchInFlight()) return
  aimMoveAutomationAreaPanel(aimCell)
}

const openMoveAutomationFromContext = (payload: { id: string; moveName?: string | null }) => {
  if (moveAutomationDispatchInFlight()) return
  cancelPokeballCaptureTargeting()
  cancelAbilityAutomationTargeting()
  cancelManeuverActionTargeting()
  cancelOrderActionTargeting()
  openMoveAutomationPanel(payload)
}

const openPokeballCaptureFromContext = (payload: { id: string; pokeballName: string }) => {
  if (moveAutomationDispatchInFlight()) return
  clearRemotePokeballCapture()
  cancelMoveAutomationTargeting()
  cancelAbilityAutomationTargeting()
  cancelManeuverActionTargeting()
  cancelOrderActionTargeting()
  openPokeballCapture(payload)
}

const useManeuverFromContext = (payload: { id: string; maneuverName?: string | null }) => {
  if (moveAutomationDispatchInFlight()) return
  cancelMoveAutomationTargeting()
  cancelPokeballCaptureTargeting()
  cancelAbilityAutomationTargeting()
  cancelOrderActionTargeting()
  void useManeuver(payload)
}

const openAbilityAutomationFromContext = (payload: { id: string; abilityName?: string | null }) => {
  if (moveAutomationDispatchInFlight()) return
  cancelMoveAutomationTargeting()
  cancelPokeballCaptureTargeting()
  cancelManeuverActionTargeting()
  cancelOrderActionTargeting()
  void openAbilityAutomation(payload)
}

const useOrderFromContext = (payload: { id: string; orderName?: string | null }) => {
  if (moveAutomationDispatchInFlight()) return
  cancelMoveAutomationTargeting()
  cancelPokeballCaptureTargeting()
  cancelManeuverActionTargeting()
  cancelAbilityAutomationTargeting()
  void useOrder(payload)
}

const selectActionAutomationTarget = (targetId: string) => {
  if (moveAutomationDispatchInFlight()) return
  if (moveAutomationTargeting.value) {
    selectMoveAutomationTarget(targetId)
    return
  }
  if (pokeballCaptureTargeting.value) {
    selectPokeballCaptureTarget(targetId)
    return
  }
  if (abilityAutomationTargeting.value) {
    void selectAbilityAutomationTarget(targetId)
    return
  }
  if (maneuverActionTargeting.value) {
    void selectManeuverActionTarget(targetId)
    return
  }
  if (orderActionTargeting.value) void selectOrderActionTarget(targetId)
}

const sceneActionError = computed(() => (
  livePlayCommands.lastError.value
  ?? tokenSheetMutationError.value
  ?? pokeballCaptureError.value
  ?? remotePokeballCaptureError.value
  ?? moveUsageError.value
))

const cancelActionAutomationTargeting = () => {
  if (moveAutomationDispatchInFlight()) return
  if (moveAutomationTargeting.value || moveAutomationTargetBranchSelection.value) {
    cancelMoveAutomationTargeting()
    return
  }
  if (pokeballCaptureTargeting.value) {
    cancelPokeballCaptureTargeting()
    return
  }
  if (abilityAutomationTargeting.value) {
    cancelAbilityAutomationTargeting()
    return
  }
  if (maneuverActionTargeting.value) {
    cancelManeuverActionTargeting()
    return
  }
  cancelOrderActionTargeting()
}

const sharedMapInteractionModeBusy = computed(() => (
  sharedMapInteractionModeStatus.value === 'loading' || sharedMapInteractionModeStatus.value === 'saving'
))
const setupEditActiveForGm = computed(() => isSetupEditMode())
const {
  encounterSides,
  encounterSideError,
  addEncounterSide,
  updateEncounterSide,
  setEncounterSideStatus,
  assignPlacementsToEncounterSide,
  clearEncounterSideError,
} = useMapEncounterSides({
  map,
  isGm,
  setupEditActive: setupEditActiveForGm,
})
const {
  shopOptions: mapShopInterfaceShopOptions,
  shopListStatus: mapShopInterfaceShopListStatus,
  shopListErrorMessage: mapShopInterfaceShopListErrorMessage,
  mapShopInterfaces,
  loadShopOptions: loadMapShopInterfaceShopOptions,
  addShopInterface: addMapShopInterface,
  updateShopInterface: updateMapShopInterface,
  removeShopInterface: removeMapShopInterface,
} = useMapShopInterfaces({
  map,
  isGm,
  setupEditActive: setupEditActiveForGm,
})

watch([adminPanelOpen, isGm], ([open, gm]) => {
  if (!open || !gm) return
  void loadMapShopInterfaceShopOptions()
}, { immediate: true })

const setGroundLevelYFromAdmin = (value: string) => {
  if (!isSetupEditMode()) return
  setGroundLevelY(value)
}

const setMapPlayerVisibleFromAdmin = (value: boolean) => {
  if (!isSetupEditMode()) return
  setMapPlayerVisible(value)
}

const clearCombatLogFromAdmin = () => {
  if (!isSetupEditMode()) return
  clearCombatLog()
}

const setMapInteractionModeFromAdmin = async (mode: MapInteractionMode) => {
  if (mode === MAP_INTERACTION_MODES.LIVE_PLAY && mapInteractionMode.value === MAP_INTERACTION_MODES.SETUP_EDIT) {
    await saveMapNow()
    if (status.value === 'error') return
  }
  await setSharedMapInteractionMode(mode)
}

useMapGmModeGuard({
  isGm,
  buildMode,
  hazardMode,
  adminPanelOpen,
  selectedId,
  canControlPlacement,
  clearSelection,
})

const { viewSheet, viewPokedex } = useMapTokenNavigation({
  map,
  pokemonBySlug,
  canControlPlacement,
  placementById,
  resolvePath: (path) => router.resolve(path).href,
})

useMapDimensionReconciliation({
  map,
  spawnedPokemon,
  selectedId,
  clearSelection,
})
</script>

<template>
  <MapEditorLayout>
    <template #nav>
      <MapNavigationRail />
    </template>

    <template #scene>
      <MapScenePanel
        ref="gridRef"
        :map="map"
        :can-view-map="canViewMap"
        :status="sceneStatus"
        :error="sceneError"
        :slug="slug"
        :map-data-revision="mapDataRevision"
        :spawned-pokemon="spawnedPokemon"
        :selected-id="selectedId"
        :controllable-placement-ids="livePlayActionablePlacementIds"
        :active-initiative-id="activeInitiativeId"
        :initiative-rows="sortedInitiativeRows"
        :initiative-round="initiativeRound"
        :can-manage-initiative="initiativeControlsEnabled"
        :initiative-auto-focus-enabled="initiativeAutoFocusEnabled"
        :active-scene="activeScene"
        :can-manage-scene="canManageScene"
        :scene-controls-disabled="sceneControlsDisabled"
        :map-voxels="mapVoxels"
        :map-hazards="mapHazards"
        :map-field-effects="mapFieldEffects"
        :map-ground-level-y="mapGroundLevelY"
        :layer-visibility="layerVisibility"
        :build-mode="buildMode && mapActionEditingEnabled"
        :build-tool="buildTool"
        :build-material="buildMaterial"
        :build-color="buildColor"
        :build-ghost-voxel="buildGhostVoxel"
        :ghost-voxels-faded="ghostVoxelsFaded"
        :smart-terrain-cutaway-enabled="smartTerrainCutawayEnabled"
        :hazard-mode="hazardMode && mapActionEditingEnabled"
        :hazard-tool="hazardTool"
        :hazard-kind="hazardKind"
        :can-delete-tokens="isGm"
        :token-control-notice="tokenControlNotice"
        :live-play-state="livePlayConnectionState"
        :live-play-status-message="livePlayStatusMessage"
        :live-play-pending-token-ids="livePlayPendingPredictionTokenIds"
        :live-play-pending-conditions-by-token-id="livePlayPendingConditionsByTokenId"
        :live-play-correction-token-ids="livePlayCorrectionTokenIds"
        :live-play-correction-motion-token-ids="livePlayCorrectionMotionTokenIds"
        :live-play-snap-correction-token-ids="transientLivePlaySnapCorrectionTokenIds"
        :live-play-remote-accepted-token-ids="livePlayRemoteAcceptedMotionTokenIds"
        :remote-token-attention="remoteTokenAttention"
        :presence-pings="mapPresencePings"
        :presence-intent-overlays="remotePresenceIntentOverlays"
        :presence-server-time-offset-ms="mapPresenceServerTimeOffsetMs"
        :can-request-gm-attention="canRequestGmAttention"
        :live-play-token-correction-notice="livePlayTokenCorrectionNotice"
        :move-automation-targeting="actionAutomationTargeting"
        :move-automation-target-branch-selection="moveAutomationTargetBranchSelection"
        :move-automation-feedback="actionAutomationFeedback"
        :move-animations="visibleMoveAnimations"
        :move-animations-reduced-motion="moveAnimationsReducedMotion"
        :move-vfx-debug-harness-enabled="moveVfxDebugHarnessEnabled"
        :action-splash="actionSplash"
        :action-splash-speed-lines-duration-ms="actionSplashSpeedLinesDurationMs"
        :move-usage-error="sceneActionError"
        :pending-move-response-windows="pendingMoveResponses.windows.value"
        :pending-move-response-state-by-window="pendingMoveResponses.responseStateByWindow.value"
        :pending-move-response-actor-labels="pendingMoveResponseActorLabels"
        :pending-move-response-owner-label="pendingMoveResponseOwnerLabel"
        :pending-move-responses-loading="pendingMoveResponses.loadStatus.value === 'loading'"
        :pending-move-responses-error="pendingMoveResponses.loadError.value"
        :can-manage-pending-move-responses="isGm"
        :token-move-options-by-id="tokenMoveOptionsById"
        :token-maneuver-options-by-id="tokenManeuverOptionsById"
        :token-ability-options-by-id="tokenAbilityOptionsById"
        :token-order-options-by-id="tokenOrderOptionsById"
        :token-send-out-options-by-id="tokenSendOutOptionsById"
        :token-pokeball-options-by-id="tokenPokeballOptionsById"
        @select-pokemon="selectPokemon"
        @hover-pokemon="setHoveredPresenceToken"
        @place-presence-ping="placePresencePingFromScene"
        @request-gm-attention="requestGmAttentionFromScene"
        @focus-initiative-entry="focusInitiativeEntry"
        @previous-initiative="previousInitiativeFromControls"
        @next-initiative="nextInitiativeFromControls"
        @start-scene="startSceneFromPanel"
        @end-scene="endSceneFromPanel"
        @move-pokemon="movePokemon"
        @turn-pokemon="turnPokemon"
        @delete-pokemon="deletePokemon"
        @modify-hp="modifyHpFromScene"
        @modify-combat-stages="modifyCombatStagesFromScene"
        @modify-conditions="modifyConditionsFromScene"
        @grant-experience="grantExperienceFromScene"
        @use-move="openMoveAutomationFromContext"
        @use-maneuver="useManeuverFromContext"
        @use-ability="openAbilityAutomationFromContext"
        @use-order="useOrderFromContext"
        @send-out-pokemon="sendOutPokemonFromScene"
        @throw-pokeball="openPokeballCaptureFromContext"
        @view-sheet="viewSheet"
        @view-pokedex="viewPokedex"
        @preview-change="updatePreview"
        @place-voxel="placeVoxelFromScene"
        @remove-voxel="removeVoxelFromScene"
        @place-hazard="placeHazardFromScene"
        @remove-hazard="removeHazardFromScene"
        @select-move-target="selectActionAutomationTarget"
        @confirm-move-target-count="confirmMoveAutomationTargetCount"
        @select-move-area-template="selectMoveAutomationAreaTemplate"
        @select-move-area-direction="selectMoveAutomationAreaDirection"
        @aim-move-area="aimMoveAutomationArea"
        @select-move-target-branch="selectMoveAutomationTargetBranch"
        @cancel-move-targeting="cancelActionAutomationTargeting"
        @preview-move-vfx="previewMoveVfxDebugKind"
        @preview-all-move-vfx="previewAllMoveVfxDebug"
        @clear-move-vfx="clearMoveAnimations"
        @move-vfx-settled="pruneSettledMoveAnimations"
        @token-motion-debug-metrics="updateLivePlayTokenMotionDebugMetrics"
        @choose-pending-move-response="pendingMoveResponses.choose($event)"
        @pass-pending-move-response="pendingMoveResponses.pass($event)"
        @force-pass-pending-move-response="pendingMoveResponses.forcePass($event)"
        @cancel-pending-move-resolution="pendingMoveResponses.cancel($event)"
        @retry-pending-move-response="pendingMoveResponses.retry($event)"
        @refresh-pending-move-responses="pendingMoveResponses.refresh()"
      />

      <MapPresencePanel
        v-if="map && canViewMap"
        :entries="mapPresenceEntries"
        :status="mapPresenceStatus"
        :server-time-offset-ms="mapPresenceServerTimeOffsetMs"
        :can-request-gm-attention="canRequestGmAttention"
        :selected-token-label="selectedId ? livePlayTokenLabel(selectedId) : null"
        @request-selected-token-attention="requestGmAttentionForSelectedToken"
        @focus-attention="focusPresenceAttentionTarget"
      />

      <LivePlayCommandRecoveryPanel
        v-if="livePlayCommandRecoveryGate.panelVisible.value"
        :entries="livePlayCommands.outboxEntries.value"
        :recovery-status="livePlayCommands.outboxRecoveryStatus.value"
        :recovery-error="livePlayCommands.outboxRecoveryError.value"
        :block-message="livePlayCommandRecoveryGate.blockMessage.value"
        :interaction-mode="mapInteractionMode"
        :retrying-op-id="livePlayCommandRecoveryGate.retryingOpId.value"
        :checking-op-id="livePlayCommandRecoveryGate.checkingOpId.value"
        :confirming-abandon-op-id="livePlayCommandRecoveryGate.confirmingAbandonOpId.value"
        :abandoning-op-id="livePlayCommandRecoveryGate.abandoningOpId.value"
        :status-result-by-op-id="livePlayCommandRecoveryGate.statusResultByOpId.value"
        :retry-disabled-message="livePlayRetryDisabledMessage"
        :resolution-notice="livePlayCommandRecoveryGate.resolutionNotice.value"
        @refresh="refreshLivePlayCommandRecovery"
        @retry="retryLivePlayCommandRecoveryEntry"
        @check-status="checkLivePlayCommandRecoveryEntryStatus"
        @request-abandon-confirmation="requestLivePlayCommandAbandonConfirmation"
        @cancel-abandon-confirmation="cancelLivePlayCommandAbandonConfirmation"
        @confirm-abandon="confirmLivePlayCommandAbandonment"
        @clear-resolution-notice="clearLivePlayCommandRecoveryResolutionNotice"
      />

      <LivePlayLatencyDebugPanel
        v-if="livePlayLatencyDebugEnabled"
        :traces="livePlayCommands.commandTraces.value"
        :presence-metrics="mapPresenceDebugMetrics"
        :token-motion-metrics="livePlayTokenMotionDebugMetrics"
      />
    </template>

    <template #modals>
      <StartTurnModal
        v-if="activeStartTurnModal"
        :character-name="activeStartTurnModal.characterName"
        :character-meta="activeStartTurnModal.characterMeta"
        :profile-url="activeStartTurnModal.profileUrl"
        :accent-color="activeStartTurnModal.accentColor"
        :round="activeStartTurnModal.round"
        :can-manage="isGm"
        :busy="startTurnModalBusy"
        :conditions="activeStartTurnModal.conditions"
        @close="closeStartTurnModal"
        @roll-condition="resolveStartTurnModalCondition($event, 'roll')"
        @skip-condition="resolveStartTurnModalCondition($event, 'skip')"
        @remove-condition="resolveStartTurnModalCondition($event, 'remove')"
      />

      <PokeballCaptureResultModal
        v-if="displayedPokeballCaptureResult"
        :key="displayedPokeballCaptureResult.id"
        :result="displayedPokeballCaptureResult"
        :accent-color="pokeballCaptureTrainerAccentColor"
        @close="dismissDisplayedPokeballCaptureResult"
      />

      <FieldEffectsMenuModal
        v-if="map && canViewMap && fieldEffectsMenuOpen"
        :can-edit-map="mapActionEditingEnabled"
        :field-effect-count="fieldEffectCount"
        :hazard-mode="hazardMode"
        :hazard-count="hazardCount"
        :hazard-clear-pending="livePlayClearHazardsPending"
        :hazard-tool="hazardTool"
        :hazard-kind="hazardKind"
        :active-hazard-def="activeHazardDef"
        :hazard-palette="hazardPalette"
        :weather-coexist-next="weatherCoexistNext"
        :active-weather-effects="activeWeatherEffects"
        :active-terrain-effects="activeTerrainEffects"
        :active-room-effects="activeRoomEffects"
        :weather-palette="weatherPalette"
        :terrain-palette="terrainPalette"
        :room-palette="roomPalette"
        :weather-definition="weatherDefinition"
        :terrain-definition="terrainDefinition"
        :room-definition="roomDefinition"
        :weather-is-active="weatherIsActive"
        :terrain-is-active="terrainIsActive"
        :room-is-active="roomIsActive"
        :duration-label="durationLabel"
        @close="closeFieldEffectsMenu"
        @set-mode="setMode"
        @set-hazard-tool="setHazardTool"
        @select-hazard-kind="selectHazardKind"
        @clear-all-hazards="clearAllHazardsFromMenu"
        @set-weather="setWeatherFromMenu"
        @remove-weather="removeWeatherFromMenu"
        @clear-weather="clearWeatherFromMenu"
        @update-weather-coexist-next="setWeatherCoexistNext"
        @toggle-terrain="toggleTerrainFromMenu"
        @remove-terrain="removeTerrainFromMenu"
        @toggle-room="toggleRoomFromMenu"
        @remove-room="removeRoomFromMenu"
        @set-weather-rounds="setWeatherRoundsFromMenu"
        @set-terrain-rounds="setTerrainRoundsFromMenu"
        @set-room-rounds="setRoomRoundsFromMenu"
        @tick-durations="tickFieldEffectDurationsFromMenu"
        @clear-all="clearAllFieldEffectsFromMenu"
      />

      <SheetsMenuModal
        v-if="map && canViewMap && canSpawnTokens && sheetsMenuOpen"
        @close="closeSheetsMenu"
        :busy="spawnSheetPending"
        @select="spawnSheetFromMenu"
      />

      <InitiativeMenuModal
        v-if="map && canViewMap && initiativeMenuOpen"
        :rows="initiativeRows"
        :sorted-rows="sortedInitiativeRows"
        :active-id="activeInitiativeId"
        :round="initiativeRound"
        :selected-id="selectedId"
        :can-manage="initiativeControlsEnabled"
        :has-initiative-values="hasInitiativeValues"
        :manual-order-active="manualInitiativeOrderActive"
        @close="closeInitiativeMenu"
        @set-round="setInitiativeRound"
        @previous="previousInitiativeFromControls"
        @next="nextInitiativeFromControls"
        @fill-from-speed="fillInitiativeFromSpeed"
        @clear-active="clearActiveInitiative"
        @clear-values="clearInitiativeValues"
        @set-active-and-focus="setActiveInitiativeAndFocus"
        @focus="focusInitiativeEntry"
        @set-initiative-input="setInitiativeInput"
        @set-initiative-from-speed="setInitiativeFromSpeed"
        @move-row="moveInitiativeRow"
        @reorder="reorderInitiativeRows"
        @clear-manual-order="setManualInitiativeOrder(null)"
      />

      <MapAdminPanel
        v-if="map && isGm && adminPanelOpen"
        :ground-level-y-max="groundLevelYMax"
        :map-ground-level-y="mapGroundLevelY"
        :map-specific-y-min="mapSpecificYMin"
        :map-specific-y-max="mapSpecificYMax"
        :player-visible="map.playerVisible"
        :combat-log-entry-count="combatLogEntryCount"
        :interaction-mode="sharedMapInteractionMode"
        :interaction-mode-busy="sharedMapInteractionModeBusy"
        :interaction-mode-error="sharedMapInteractionModeError"
        :setup-edit-active="setupEditActiveForGm"
        :encounter-sides="encounterSides"
        :placements="map.placements"
        :selected-placement-id="selectedId"
        :encounter-side-error="encounterSideError"
        :shop-interfaces="mapShopInterfaces"
        :shops="mapShopInterfaceShopOptions"
        :shop-list-status="mapShopInterfaceShopListStatus"
        :shop-list-error="mapShopInterfaceShopListErrorMessage"
        @close="adminPanelOpen = false"
        @set-ground-level-y="setGroundLevelYFromAdmin"
        @update-player-visible="setMapPlayerVisibleFromAdmin"
        @clear-combat-log="clearCombatLogFromAdmin"
        @set-interaction-mode="setMapInteractionModeFromAdmin"
        @create-encounter-side="addEncounterSide"
        @update-encounter-side="updateEncounterSide"
        @set-encounter-side-status="setEncounterSideStatus"
        @assign-encounter-side="assignPlacementsToEncounterSide"
        @clear-encounter-side-error="clearEncounterSideError"
        @reload-shops="loadMapShopInterfaceShopOptions"
        @add-shop-interface="addMapShopInterface"
        @update-shop-interface="updateMapShopInterface"
        @remove-shop-interface="removeMapShopInterface"
      />
    </template>
  </MapEditorLayout>
</template>
