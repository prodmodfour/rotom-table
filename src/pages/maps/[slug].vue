<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import FieldEffectsMenuModal from '~/components/map/FieldEffectsMenuModal.vue'
import InitiativeMenuModal from '~/components/map/InitiativeMenuModal.vue'
import MapAdminPanel from '~/components/map/MapAdminPanel.vue'
import MapEditorLayout from '~/components/map/MapEditorLayout.vue'
import MapNavigationRail from '~/components/map/MapNavigationRail.vue'
import MapScenePanel from '~/components/map/MapScenePanel.vue'
import PokeballCaptureResultModal from '~/components/map/PokeballCaptureResultModal.vue'
import SheetsMenuModal from '~/components/map/SheetsMenuModal.vue'
import { useEditableMap } from '~/composables/useEditableMap'
import { useLiveSheets } from '~/composables/useLiveSheets'
import { useApiClient } from '~/composables/useApiClient'
import { useDocumentMapTokenActions } from '~/composables/map-editor/useDocumentMapTokenActions'
import { useFieldEffectsEditor } from '~/composables/map-editor/useFieldEffectsEditor'
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
import { useMapTokenNavigation } from '~/composables/map-editor/useMapTokenNavigation'
import { useAbilityAutomationPanel } from '~/composables/map-editor/useAbilityAutomationPanel'
import { useMoveAnimationQueue } from '~/composables/map-editor/useMoveAnimationQueue'
import { useActionSplashSettings } from '~/composables/useActionSplashSettings'
import { useMoveAnimationSettings } from '~/composables/useMoveAnimationSettings'
import { useMoveAutomationPanel } from '~/composables/map-editor/useMoveAutomationPanel'
import {
  createMoveVfxDebugPreviewEvents,
  isMoveVfxDebugHarnessEnabled,
} from '~/utils/moveVfxDebugHarness'
import { useManeuverActionPanel } from '~/composables/map-editor/useManeuverActionPanel'
import { useOrderActionPanel } from '~/composables/map-editor/useOrderActionPanel'
import { usePokeballCapturePanel } from '~/composables/map-editor/usePokeballCapturePanel'
import { MAP_INTERACTION_MODES, type MapInteractionMode } from '#shared/mapInteractionMode'
import { useTerrainBuilder } from '~/composables/map-editor/useTerrainBuilder'
import {
  useAttackOfOpportunityPanel,
  type AttackOfOpportunitySuppressionContext,
} from '~/utils/attackOfOpportunity'
import { useTokenSheetMutations } from '~/composables/map-editor/useTokenSheetMutations'
import { useTokenControls } from '~/composables/map-editor/useTokenControls'
import { buildClientPlayerProfileTokenControlModel } from '~/utils/playerProfileTokenControl'
import {
  isPlayerCharacterAttackOfOpportunityPair,
  playerCharacterSheetKeysForProfiles,
} from '~/utils/playerCharacterTokens'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { clearCombatLogMetadata, countCombatLogMessages } from '~/utils/combatLog'
import { applyPokeballCaptureOutcomeToTrainerSheet } from '~/utils/pokeballCapture'
import { isSameAnchor } from '~/utils/gridGeometry'
import { mapEditorPath, mapLibraryPath } from '~/utils/mapRoutes'
import { deepCloneJson } from '~/utils/serialization'
import { nextTokenFacingForPlacement } from '~/utils/tokenFacing'
import { routeSlugParam } from '~/utils/routeParams'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveVfxKind } from '~/types/moveAnimation'
import type { TrainerSheet } from '~/types/trainerSheet'

definePageMeta({
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

const mapInteractionMode = ref<MapInteractionMode>(MAP_INTERACTION_MODES.LIVE_PLAY)
const {
  map,
  status,
  error,
  renamedTo,
  mapDataRevision,
  mapRevision,
  livePlayCommandsBlocked,
  livePlayRealtimeNotice,
  applyPersistedMap,
} = useEditableMap(slug, {
  interactionMode: mapInteractionMode,
  playerProfileId: computed(() => (isPlayer.value ? selectedProfileId.value : null)),
})
const { pokemonBySlug, trainerBySlug, reloadRuntimeSheets } = useLiveSheets()
const { postJson } = useApiClient()
const applyDocumentSheetUpdate = (update: { kind: 'pokemon' | 'trainer'; slug: string; sheet: Record<string, unknown> }) => {
  if (update.kind === 'pokemon') {
    const previous = pokemonBySlug.value.get(update.slug)
    pokemonBySlug.value.set(update.slug, { ...(previous ?? {}), ...update.sheet } as CharacterSheet)
    return
  }
  const previous = trainerBySlug.value.get(update.slug)
  trainerBySlug.value.set(update.slug, { ...(previous ?? {}), ...update.sheet } as TrainerSheet)
}
const documentTokenActions = useDocumentMapTokenActions({
  slug,
  playerProfileId: computed(() => (isPlayer.value ? selectedProfileId.value : null)),
  mapRevision,
  livePlayCommandBlocked: livePlayCommandsBlocked,
  livePlayCommandBlockedMessage: livePlayRealtimeNotice,
  applyPersistedMap,
  applySheetUpdate: applyDocumentSheetUpdate,
})

watch(renamedTo, (newSlug) => {
  if (newSlug) router.replace(mapEditorPath(newSlug))
})
const playerProfileTokenControlModel = computed(() => buildClientPlayerProfileTokenControlModel({
  role: role.value,
  profile: selectedProfile.value,
  placements: map.value?.placements ?? [],
}))
const playerCharacterSheetKeys = computed(() => playerCharacterSheetKeysForProfiles(playerProfiles.value))
const shouldSuppressPlayerCharacterAttackOfOpportunity = ({
  attacker,
  provoker,
}: Pick<AttackOfOpportunitySuppressionContext, 'attacker' | 'provoker'>) => (
  isPlayerCharacterAttackOfOpportunityPair({
    attacker,
    provoker,
    playerCharacterSheetKeys: playerCharacterSheetKeys.value,
    pokemonBySlug: pokemonBySlug.value,
    trainerBySlug: trainerBySlug.value,
  })
)
const persistSpawnedPlacement = (placement: SheetPlacement) => {
  void documentTokenActions.spawnToken({
    placement: deepCloneJson(placement),
    unloadFallback: true,
  })
}
const tokenControlNotice = computed(() => {
  if (livePlayRealtimeNotice.value) return livePlayRealtimeNotice.value
  if (documentTokenActions.lastError.value) {
    return `Token action failed: ${documentTokenActions.lastError.value}`
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
}

const gridRef = ref<MapScenePanelHandle | null>(null)

const {
  moveAnimationsEnabled,
  moveAnimationsReducedMotion,
} = useMoveAnimationSettings()
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
// realtime replacements, document-backed token actions, and rename/delete
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

if (import.meta.client && isPlayer.value) loadRememberedProfile()

const syncPlayerProfilesForMapControl = async () => {
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
  if (isPlayer.value) await reloadRuntimeSheets({ profileId: selectedProfileId.value })
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

watch([isGm, isPlayer], ([nextIsGm, nextIsPlayer]) => {
  if (nextIsGm || nextIsPlayer) void syncPlayerProfilesForMapControl()
})

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
  canSendOutPokemon,
  placementById,
  clearSelection,
  updatePreview,
  spawnSheet,
  sendOutPokemon,
  selectPlacement,
  deletePlacement,
} = useTokenControls({
  map,
  pokemonBySlug,
  trainerBySlug,
  mapVoxels,
  mapGroundLevelY,
  canSpawnTokens,
  canControlAllTokens: isGm,
  persistSpawnedPlacement,
  tokenControl: {
    enabled: computed(() => true),
    controllablePlacementIds: computed(() => playerProfileTokenControlModel.value.controllablePlacementIds),
  },
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
  deletePlacement(id)
}
const shouldUseDocumentTableActionRoutes = () => isPlayer.value

const turnPokemon = (id: string) => {
  const placement = placementById(id)
  if (!placement || !canControlPlacement(id)) return
  const facing = nextTokenFacingForPlacement(placement)
  void documentTokenActions.turnToken({ placementId: id, facing }).then((result) => {
    if (result.dispatched) clearSelection()
  })
}

let attackOfOpportunityPanel: ReturnType<typeof useAttackOfOpportunityPanel> | null = null
const movePokemon = (payload: { id: string; position: GridAnchor }) => {
  const from = spawnedPokemon.value.find((pokemon) => pokemon.id === payload.id)?.position
    ?? placementById(payload.id)?.position
  const previousPosition = from ? { ...from } : null

  if (!canControlPlacement(payload.id)) return
  void documentTokenActions.moveToken({
    placementId: payload.id,
    position: payload.position,
    pathLength: previewState.value.pathLength,
  }).then((result) => {
    if (!result.dispatched) return
    clearSelection()
    const currentPosition = placementById(payload.id)?.position
    if (!previousPosition || !currentPosition || isSameAnchor(previousPosition, currentPosition)) return
    attackOfOpportunityPanel?.clearAttackOfOpportunityPromptsForNonImmediateAction()
    attackOfOpportunityPanel?.provokeMovementAttackOfOpportunity({
      provokerId: payload.id,
      from: previousPosition,
      to: { ...currentPosition },
    })
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
  setWeather,
  removeWeather,
  clearWeather,
  toggleTerrain,
  removeTerrain,
  toggleRoom,
  removeRoom,
  setWeatherRounds,
  setTerrainRounds,
  setRoomRounds,
  durationLabel,
  tickFieldEffectDurations,
  clearAllFieldEffects,
  applyMoveFieldEffect,
} = useFieldEffectsEditor({ map, canEditMap })

const combatLogEntryCount = computed(() => countCombatLogMessages(map.value?.metadata))

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

const setupEditModeActive = computed(() => isGm.value && (buildMode.value || hazardMode.value || adminPanelOpen.value))
watch(setupEditModeActive, (active) => {
  mapInteractionMode.value = active ? MAP_INTERACTION_MODES.SETUP_EDIT : MAP_INTERACTION_MODES.LIVE_PLAY
}, { immediate: true })

const {
  initiativeRows,
  sortedInitiativeRows,
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
  nextInitiative,
  previousInitiative,
} = useInitiativeTracker({
  map,
  spawnedPokemon,
  pokemonBySlug,
  trainerBySlug,
  canManageInitiative,
  focusEntry: (id) => {
    gridRef.value?.focusPokemon(id)
  },
})

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
  clearRemotePokeballCapture,
  dismissRemotePokeballCaptureResult,
} = useMapActionPokeballCapture({
  enqueueAndBroadcastMoveAnimations,
  publishPokeballFeedback: (request) => publishSyncedPokeballFeedback?.(request),
  publishPokeballResult: (request) => publishSyncedPokeballResult?.(request),
})

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

watch(mapDataRevision, () => {
  clearRemoteMoveFeedback()
  clearRemotePokeballCapture()
})

onBeforeUnmount(() => {
  clearActionSplash()
  clearRemoteMoveFeedback()
  clearRemotePokeballCapture()
})

let expireActiveOrdersAfterInitiativeAdvance: (advance: {
  before: { activeId: string | null; round: number }
  after: { activeId: string | null; round: number }
}) => void = () => {}

const orderTimelinePoint = () => ({
  activeId: activeInitiativeId.value ?? null,
  round: initiativeRound.value,
})

const previousInitiativeAndExpireAoo = () => {
  attackOfOpportunityPanel?.clearAttackOfOpportunityPromptsForNonImmediateAction()
  previousInitiative()
}

const nextInitiativeAndExpireAoo = () => {
  const before = orderTimelinePoint()
  attackOfOpportunityPanel?.clearAttackOfOpportunityPromptsForNonImmediateAction()
  nextInitiative()
  expireActiveOrdersAfterInitiativeAdvance({ before, after: orderTimelinePoint() })
}

const {
  lastError: tokenSheetMutationError,
  modifyHp,
  modifyCombatStages,
  modifyConditions,
  modifyAbilityActivation,
  updatePlacedSheet,
} = useTokenSheetMutations({
  map,
  sheetLookup,
  canControlPlacement,
  playerProfileId: computed(() => (isPlayer.value ? selectedProfileId.value : null)),
  interactionMode: mapInteractionMode,
})

const modifyHpFromScene: typeof modifyHp = async (payload, options) => {
  await modifyHp(payload, options)
}

const modifyCombatStagesFromScene: typeof modifyCombatStages = async (payload, options) => {
  await modifyCombatStages(payload, options)
}

const modifyConditionsFromScene: typeof modifyConditions = async (payload, options) => {
  await modifyConditions(payload, options)
}

interface RecordMoveUsageResponse {
  ok: true
  map?: TabletopMap
  sheet?: Record<string, unknown>
  sheetKind?: 'pokemon' | 'trainer'
  sheetSlug?: string
}

const applyRecordedMapUsage = (incoming: TabletopMap | undefined) => {
  if (!incoming) return
  if (isPlayer.value) {
    applyPersistedMap(incoming)
    return
  }
  if (!map.value) return
  map.value.moveUsage = incoming.moveUsage
  map.value.updatedAt = incoming.updatedAt
}

const mergeRecordedSheet = <TSheet extends { slug: string }>(
  sheets: Map<string, TSheet>,
  slug: string,
  incoming: Record<string, unknown>,
) => {
  const previous = sheets.get(slug)
  sheets.set(slug, { ...(previous ?? {}), ...incoming } as TSheet)
}

const applyRecordedSheetUsage = (response: RecordMoveUsageResponse) => {
  if (!response.sheet || !response.sheetSlug || !response.sheetKind) return
  if (response.sheetKind === 'pokemon') {
    mergeRecordedSheet<CharacterSheet>(pokemonBySlug.value, response.sheetSlug, response.sheet)
    return
  }
  mergeRecordedSheet<TrainerSheet>(trainerBySlug.value, response.sheetSlug, response.sheet)
}

const recordMoveUsage = async (request: { placementId: string; moveName: string }) => {
  const response = await postJson<RecordMoveUsageResponse>(MAP_API_PATHS.useMove, {
    slug,
    placementId: request.placementId,
    moveName: request.moveName,
    clientId: getClientId(),
    ...(isPlayer.value && selectedProfileId.value ? { profileId: selectedProfileId.value } : {}),
  })
  applyRecordedMapUsage(response.map)
  applyRecordedSheetUsage(response)
}

const applyMoveFieldEffectFromScene: typeof applyMoveFieldEffect = (effect) => {
  applyMoveFieldEffect(effect)
}

const placeHazardFromScene: typeof placeHazard = (hazard) => {
  placeHazard(hazard)
}

const removeHazardFromScene: typeof removeHazard = (cell) => {
  removeHazard(cell)
}

const placeVoxelFromScene: typeof placeVoxel = (voxel) => {
  placeVoxel(voxel)
}

const removeVoxelFromScene: typeof removeVoxel = (cell) => {
  removeVoxel(cell)
}

const sendOutPokemonFromScene: typeof sendOutPokemon = (payload) => {
  if (!canSendOutPokemon(payload)) return false
  return sendOutPokemon(payload)
}

const {
  moveAutomationTargeting,
  moveAutomationFeedback,
  moveUsageError,
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
  selectMoveAutomationAreaDirection,
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
  placeHazard: placeHazardFromScene,
  recordMoveUsage,
  enqueueMoveAnimations: enqueueAndBroadcastMoveAnimations,
  onMoveUse: (event) => showActionSplash({ userId: event.userId, actionName: event.moveName }),
  onMoveFeedback: (event) => {
    clearRemoteMoveFeedback()
    clearRemotePokeballCapture()
    broadcastMoveFeedback(event.feedback)
  },
  onBeforeNonImmediateAction: () => {
    attackOfOpportunityPanel?.clearAttackOfOpportunityPromptsForNonImmediateAction()
  },
  onRangedAttackOfOpportunity: (event) => {
    attackOfOpportunityPanel?.provokeRangedAttackOfOpportunity(event)
  },
})

attackOfOpportunityPanel = useAttackOfOpportunityPanel({
  map,
  spawnedPokemon,
  tokenMoveOptionsById,
  canControlPlacement,
  shouldSuppressAttackOfOpportunity: shouldSuppressPlayerCharacterAttackOfOpportunity,
  performStruggleAttack: ({ attackerId, targetId, moveName, prompt }) => useMoveAgainstTarget({
    id: attackerId,
    targetId,
    moveName,
    skipActionNotifications: true,
    logLine: `${prompt.attackerName} makes an Attack of Opportunity against ${prompt.provokerName}.`,
  }),
})

const {
  attackOfOpportunityPrompts,
  useAttackOfOpportunity,
} = attackOfOpportunityPanel

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
  dispatchAbilityUse: (event) => {
    if (!shouldUseDocumentTableActionRoutes()) return undefined
    void documentTokenActions.useAbility({
      placementId: event.userId,
      abilityName: event.abilityName,
      ...(event.targetTokenId ? { targetPlacementId: event.targetTokenId } : {}),
    })
    return true
  },
  onBeforeNonImmediateAction: (event) => {
    attackOfOpportunityPanel?.clearAttackOfOpportunityPromptsForNonImmediateAction()
    return showActionSplash({ userId: event.userId, actionName: event.abilityName })
  },
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
  dispatchManeuverUse: (event) => {
    if (!shouldUseDocumentTableActionRoutes()) return undefined
    void documentTokenActions.useManeuver({
      placementId: event.userId,
      maneuverName: event.maneuverName,
      ...(event.targetTokenId ? { targetPlacementId: event.targetTokenId } : {}),
    })
    return true
  },
  onBeforeManeuverAction: (event) => {
    attackOfOpportunityPanel?.clearAttackOfOpportunityPromptsForNonImmediateAction()
    return showActionSplash({ userId: event.userId, actionName: event.maneuverName })
  },
})

const orderActionPanel = useOrderActionPanel({
  map,
  spawnedPokemon,
  trainerBySlug,
  canControlPlacement,
  dispatchOrderUse: (event) => {
    if (!shouldUseDocumentTableActionRoutes()) return undefined
    void documentTokenActions.useOrder({
      placementId: event.userId,
      orderName: event.orderName,
      ...(event.targetTokenId ? { targetPlacementId: event.targetTokenId } : {}),
    })
    return true
  },
  onBeforeOrderAction: (event) => {
    attackOfOpportunityPanel?.clearAttackOfOpportunityPromptsForNonImmediateAction()
    return showActionSplash({ userId: event.userId, actionName: event.orderName })
  },
})
const {
  orderActionTargeting,
  tokenOrderOptionsById,
  useOrder,
  cancelOrderActionTargeting,
  selectOrderActionTarget,
} = orderActionPanel
expireActiveOrdersAfterInitiativeAdvance = orderActionPanel.expireActiveOrdersAfterInitiativeAdvance

const applyPokeballCaptureOutcome = async (event: Parameters<typeof applyPokeballCaptureOutcomeToTrainerSheet>[1] & { trainerId: string; targetId: string }) => {
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

  if (sheetUpdated && event.result.success && isGm.value) deletePlacement(event.targetId)
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
  applyCaptureOutcome: applyPokeballCaptureOutcome,
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

const openMoveAutomationFromContext = (payload: { id: string; moveName?: string | null }) => {
  cancelPokeballCaptureTargeting()
  cancelAbilityAutomationTargeting()
  cancelManeuverActionTargeting()
  cancelOrderActionTargeting()
  openMoveAutomation(payload)
}

const openPokeballCaptureFromContext = (payload: { id: string; pokeballName: string }) => {
  clearRemotePokeballCapture()
  cancelMoveAutomationTargeting()
  cancelAbilityAutomationTargeting()
  cancelManeuverActionTargeting()
  cancelOrderActionTargeting()
  openPokeballCapture(payload)
}

const useManeuverFromContext = (payload: { id: string; maneuverName?: string | null }) => {
  cancelMoveAutomationTargeting()
  cancelPokeballCaptureTargeting()
  cancelAbilityAutomationTargeting()
  cancelOrderActionTargeting()
  useManeuver(payload)
}

const openAbilityAutomationFromContext = (payload: { id: string; abilityName?: string | null }) => {
  cancelMoveAutomationTargeting()
  cancelPokeballCaptureTargeting()
  cancelManeuverActionTargeting()
  cancelOrderActionTargeting()
  void openAbilityAutomation(payload)
}

const useOrderFromContext = (payload: { id: string; orderName?: string | null }) => {
  cancelMoveAutomationTargeting()
  cancelPokeballCaptureTargeting()
  cancelManeuverActionTargeting()
  cancelAbilityAutomationTargeting()
  useOrder(payload)
}

const selectActionAutomationTarget = (targetId: string) => {
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
    selectManeuverActionTarget(targetId)
    return
  }
  if (orderActionTargeting.value) selectOrderActionTarget(targetId)
}

const sceneActionError = computed(() => (
  documentTokenActions.lastError.value
  ?? tokenSheetMutationError.value
  ?? pokeballCaptureError.value
  ?? remotePokeballCaptureError.value
  ?? moveUsageError.value
))

const cancelActionAutomationTargeting = () => {
  if (moveAutomationTargeting.value) {
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

const applySpiteReactionPromptFromScene = async (id: string) => {
  const prompt = spiteReactionPrompts.value.find((item) => item.id === id)
  if (prompt) await showActionSplash({ userId: prompt.defenderId, actionName: 'Spite' })
  await applySpiteReactionPrompt(id)
}

const applyCuteCharmReactionPromptFromScene = async (id: string) => {
  const prompt = cuteCharmReactionPrompts.value.find((item) => item.id === id)
  if (prompt) await showActionSplash({ userId: prompt.defenderId, actionName: 'Cute Charm' })
  await applyCuteCharmReactionPrompt(id)
}

const applyPoisonPointReactionPromptFromScene = async (id: string) => {
  const prompt = poisonPointReactionPrompts.value.find((item) => item.id === id)
  if (prompt) await showActionSplash({ userId: prompt.defenderId, actionName: 'Poison Point' })
  await applyPoisonPointReactionPrompt(id)
}

const applyMoxieTriggerPromptFromScene = async (id: string) => {
  const prompt = moxieTriggerPrompts.value.find((item) => item.id === id)
  if (prompt) await showActionSplash({ userId: prompt.attackerId, actionName: 'Moxie' })
  await applyMoxieTriggerPrompt(id)
}

const applyCelebrateTriggerPromptFromScene = async (id: string) => {
  const prompt = celebrateTriggerPrompts.value.find((item) => item.id === id)
  if (prompt) await showActionSplash({ userId: prompt.attackerId, actionName: 'Celebrate' })
  applyCelebrateTriggerPrompt(id)
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
        :status="status"
        :error="error"
        :slug="slug"
        :spawned-pokemon="spawnedPokemon"
        :selected-id="selectedId"
        :controllable-placement-ids="controllablePlacementIds"
        :active-initiative-id="activeInitiativeId"
        :initiative-rows="sortedInitiativeRows"
        :initiative-round="initiativeRound"
        :can-manage-initiative="canManageInitiative"
        :map-voxels="mapVoxels"
        :map-hazards="mapHazards"
        :map-field-effects="mapFieldEffects"
        :map-ground-level-y="mapGroundLevelY"
        :layer-visibility="layerVisibility"
        :build-mode="buildMode && canEditMap"
        :build-tool="buildTool"
        :build-material="buildMaterial"
        :build-color="buildColor"
        :build-ghost-voxel="buildGhostVoxel"
        :ghost-voxels-faded="ghostVoxelsFaded"
        :hazard-mode="hazardMode && canEditMap"
        :hazard-tool="hazardTool"
        :hazard-kind="hazardKind"
        :can-delete-tokens="isGm"
        :token-control-notice="tokenControlNotice"
        :move-automation-targeting="actionAutomationTargeting"
        :move-automation-feedback="actionAutomationFeedback"
        :move-animations="visibleMoveAnimations"
        :move-animations-reduced-motion="moveAnimationsReducedMotion"
        :move-vfx-debug-harness-enabled="moveVfxDebugHarnessEnabled"
        :action-splash="actionSplash"
        :action-splash-speed-lines-duration-ms="actionSplashSpeedLinesDurationMs"
        :move-usage-error="sceneActionError"
        :spite-reaction-prompts="spiteReactionPrompts"
        :cute-charm-reaction-prompts="cuteCharmReactionPrompts"
        :poison-point-reaction-prompts="poisonPointReactionPrompts"
        :moxie-trigger-prompts="moxieTriggerPrompts"
        :celebrate-trigger-prompts="celebrateTriggerPrompts"
        :attack-of-opportunity-prompts="attackOfOpportunityPrompts"
        :token-move-options-by-id="tokenMoveOptionsById"
        :token-maneuver-options-by-id="tokenManeuverOptionsById"
        :token-ability-options-by-id="tokenAbilityOptionsById"
        :token-order-options-by-id="tokenOrderOptionsById"
        :token-send-out-options-by-id="tokenSendOutOptionsById"
        :token-pokeball-options-by-id="tokenPokeballOptionsById"
        @select-pokemon="selectPokemon"
        @focus-initiative-entry="focusInitiativeEntry"
        @previous-initiative="previousInitiativeAndExpireAoo"
        @next-initiative="nextInitiativeAndExpireAoo"
        @move-pokemon="movePokemon"
        @turn-pokemon="turnPokemon"
        @delete-pokemon="deletePokemon"
        @modify-hp="modifyHpFromScene"
        @modify-combat-stages="modifyCombatStagesFromScene"
        @modify-conditions="modifyConditionsFromScene"
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
        @select-move-area-direction="selectMoveAutomationAreaDirection"
        @cancel-move-targeting="cancelActionAutomationTargeting"
        @preview-move-vfx="previewMoveVfxDebugKind"
        @preview-all-move-vfx="previewAllMoveVfxDebug"
        @clear-move-vfx="clearMoveAnimations"
        @move-vfx-settled="pruneSettledMoveAnimations"
        @dismiss-spite-reaction="dismissSpiteReactionPrompt"
        @apply-spite-reaction="applySpiteReactionPromptFromScene"
        @dismiss-cute-charm-reaction="dismissCuteCharmReactionPrompt"
        @apply-cute-charm-reaction="applyCuteCharmReactionPromptFromScene"
        @dismiss-poison-point-reaction="dismissPoisonPointReactionPrompt"
        @apply-poison-point-reaction="applyPoisonPointReactionPromptFromScene"
        @dismiss-moxie-trigger="dismissMoxieTriggerPrompt"
        @apply-moxie-trigger="applyMoxieTriggerPromptFromScene"
        @dismiss-celebrate-trigger="dismissCelebrateTriggerPrompt"
        @apply-celebrate-trigger="applyCelebrateTriggerPromptFromScene"
        @use-attack-of-opportunity="useAttackOfOpportunity"
      />
    </template>

    <template #modals>
      <PokeballCaptureResultModal
        v-if="displayedPokeballCaptureResult"
        :result="displayedPokeballCaptureResult"
        :accent-color="pokeballCaptureTrainerAccentColor"
        @close="dismissDisplayedPokeballCaptureResult"
      />

      <FieldEffectsMenuModal
        v-if="map && canViewMap && fieldEffectsMenuOpen"
        :can-edit-map="canEditMap"
        :field-effect-count="fieldEffectCount"
        :hazard-mode="hazardMode"
        :hazard-count="hazardCount"
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
        @clear-all-hazards="clearAllHazards"
        @set-weather="setWeather"
        @remove-weather="removeWeather"
        @clear-weather="clearWeather"
        @update-weather-coexist-next="setWeatherCoexistNext"
        @toggle-terrain="toggleTerrain"
        @remove-terrain="removeTerrain"
        @toggle-room="toggleRoom"
        @remove-room="removeRoom"
        @set-weather-rounds="setWeatherRounds"
        @set-terrain-rounds="setTerrainRounds"
        @set-room-rounds="setRoomRounds"
        @tick-durations="tickFieldEffectDurations"
        @clear-all="clearAllFieldEffects"
      />

      <SheetsMenuModal
        v-if="map && canViewMap && canSpawnTokens && sheetsMenuOpen"
        @close="closeSheetsMenu"
        @select="spawnSheet"
      />

      <InitiativeMenuModal
        v-if="map && canViewMap && initiativeMenuOpen"
        :rows="initiativeRows"
        :sorted-rows="sortedInitiativeRows"
        :active-id="activeInitiativeId"
        :round="initiativeRound"
        :selected-id="selectedId"
        :can-manage="canManageInitiative"
        :has-initiative-values="hasInitiativeValues"
        @close="closeInitiativeMenu"
        @set-round="setInitiativeRound"
        @previous="previousInitiativeAndExpireAoo"
        @next="nextInitiativeAndExpireAoo"
        @fill-from-speed="fillInitiativeFromSpeed"
        @clear-active="clearActiveInitiative"
        @clear-values="clearInitiativeValues"
        @set-active-and-focus="setActiveInitiativeAndFocus"
        @focus="focusInitiativeEntry"
        @set-initiative-input="setInitiativeInput"
        @set-initiative-from-speed="setInitiativeFromSpeed"
      />

      <MapAdminPanel
        v-if="map && isGm && adminPanelOpen"
        :ground-level-y-max="groundLevelYMax"
        :map-ground-level-y="mapGroundLevelY"
        :map-specific-y-min="mapSpecificYMin"
        :map-specific-y-max="mapSpecificYMax"
        :player-visible="map.playerVisible"
        :combat-log-entry-count="combatLogEntryCount"
        @close="adminPanelOpen = false"
        @set-ground-level-y="setGroundLevelY"
        @update-player-visible="setMapPlayerVisible"
        @clear-combat-log="clearCombatLog"
      />
    </template>
  </MapEditorLayout>
</template>
