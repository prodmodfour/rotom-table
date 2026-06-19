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
import { useLivePlayCommands } from '~/composables/map-editor/useLivePlayCommands'
import { useLivePlayStateMachine } from '~/composables/map-editor/useLivePlayStateMachine'
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
import { useMapTokenNavigation } from '~/composables/map-editor/useMapTokenNavigation'
import { useAbilityAutomationPanel } from '~/composables/map-editor/useAbilityAutomationPanel'
import { useMoveAnimationQueue } from '~/composables/map-editor/useMoveAnimationQueue'
import { useActionSplashSettings } from '~/composables/useActionSplashSettings'
import { useInitiativeAutoFocusSettings } from '~/composables/useInitiativeAutoFocusSettings'
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
import { clearCombatLogMetadata, countCombatLogMessages } from '~/utils/combatLog'
import { textValueFromEvent } from '~/utils/domEvents'
import {
  applyPokeballCaptureOutcomeToPokemonSheet,
  applyPokeballCaptureOutcomeToTrainerSheet,
} from '~/utils/pokeballCapture'
import { isSameAnchor } from '~/utils/gridGeometry'
import { mapEditorPath, mapLibraryPath } from '~/utils/mapRoutes'
import { deepCloneJson } from '~/utils/serialization'
import { nextTokenFacingForPlacement } from '~/utils/tokenFacing'
import { routeSlugParam } from '~/utils/routeParams'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, MapRoomKind, MapTerrainKind, MapWeatherKind, SheetPlacement } from '~/types/map'
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

const {
  interactionMode: sharedMapInteractionMode,
  status: sharedMapInteractionModeStatus,
  error: sharedMapInteractionModeError,
  setInteractionMode: setSharedMapInteractionMode,
} = useSharedMapInteractionMode(slug)
const mapInPrepareMode = computed(() => sharedMapInteractionMode.value === MAP_INTERACTION_MODES.SETUP_EDIT)
const mapInteractionMode = computed<MapInteractionMode>(() => (
  isGm.value && mapInPrepareMode.value
    ? MAP_INTERACTION_MODES.SETUP_EDIT
    : MAP_INTERACTION_MODES.LIVE_PLAY
))
const isSetupEditMode = () => mapInteractionMode.value === MAP_INTERACTION_MODES.SETUP_EDIT
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
  reload: reloadAuthoritativeMap,
  applyPersistedMap,
} = useEditableMap(slug, {
  interactionMode: mapInteractionMode,
  playerProfileId: computed(() => (isPlayer.value ? selectedProfileId.value : null)),
})
const { pokemonBySlug, trainerBySlug, reloadRuntimeSheets } = useLiveSheets()
const applyLivePlaySheetUpdate = (update: { kind: 'pokemon' | 'trainer'; slug: string; sheet: Record<string, unknown> }) => {
  if (update.kind === 'pokemon') {
    const previous = pokemonBySlug.value.get(update.slug)
    pokemonBySlug.value.set(update.slug, { ...(previous ?? {}), ...update.sheet } as CharacterSheet)
    return
  }
  const previous = trainerBySlug.value.get(update.slug)
  trainerBySlug.value.set(update.slug, { ...(previous ?? {}), ...update.sheet } as TrainerSheet)
}
const runtimeSheetReloadContext = () => (
  isPlayer.value ? { profileId: selectedProfileId.value } : {}
)
const reconciliationSheetReloadContext = () => ({
  ...runtimeSheetReloadContext(),
  throwOnError: true,
})
const reconcileLivePlayState = async () => {
  await Promise.all([
    reloadAuthoritativeMap(),
    reloadRuntimeSheets(reconciliationSheetReloadContext()),
  ])
}
const livePlayStateMachine = useLivePlayStateMachine({
  mapStatus: status,
  mapError: error,
  realtimeStatus: realtimeReconciliationStatus,
  realtimeNotice: livePlayRealtimeNotice,
})
const livePlayConnectionState = livePlayStateMachine.state
const livePlayStatusMessage = computed(() => (
  mapInPrepareMode.value
    ? 'Prepare Map mode is active. Live-play commands are paused until the GM switches to Run Live Play.'
    : livePlayStateMachine.notice.value
))
const livePlayCommandBlockedMessage = computed(() => (
  mapInPrepareMode.value
    ? 'Map is in Prepare Map mode. Switch to Run Live Play before live-play commands.'
    : livePlayStateMachine.commandBlockMessage.value
))
const livePlayCommands = useLivePlayCommands({
  slug,
  playerProfileId: computed(() => (isPlayer.value ? selectedProfileId.value : null)),
  map,
  mapRevision,
  livePlayCommandBlocked: computed(() => mapInPrepareMode.value || !livePlayStateMachine.commandsAllowed.value),
  livePlayCommandBlockedMessage,
  applyPersistedMap,
  applySheetUpdate: applyLivePlaySheetUpdate,
  requestReconciliation: () => livePlayStateMachine.reconcile(reconcileLivePlayState),
  onCommandStarted: livePlayStateMachine.commandStarted,
  onCommandAccepted: livePlayStateMachine.commandAccepted,
  onCommandRejected: livePlayStateMachine.commandRejected,
  onCommandFailed: livePlayStateMachine.commandFailed,
  onCommandBlocked: livePlayStateMachine.commandBlocked,
  onCommandErrorCleared: livePlayStateMachine.clearCommandError,
})

watch(renamedTo, (newSlug) => {
  if (newSlug) router.replace(mapEditorPath(newSlug))
})
const playerProfileTokenControlModel = computed(() => buildClientPlayerProfileTokenControlModel({
  role: role.value,
  profile: selectedProfile.value,
  placements: map.value?.placements ?? [],
  linkedTrainerSheets: Array.from(trainerBySlug.value.values()),
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
  if (isSetupEditMode()) return
  void livePlayCommands.spawnToken({
    placement: deepCloneJson(placement),
  })
}
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
  createSendOutPokemonPlacement,
  placementById,
  clearSelection,
  updatePreview,
  spawnSheet,
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
  if (!canControlPlacement(id)) return
  if (isSetupEditMode()) {
    deletePlacement(id)
    return
  }
  void livePlayCommands.deleteToken({ placementId: id }).then((result) => {
    if (result.dispatched) clearSelection()
  })
}
const shouldUseTableActionRoutes = () => isPlayer.value

const turnPokemon = (id: string) => {
  const placement = placementById(id)
  if (!placement || !canControlPlacement(id)) return
  if (isSetupEditMode()) {
    turnPlacementForSetupEdit(id)
    clearSelection()
    return
  }
  const facing = nextTokenFacingForPlacement(placement)
  void livePlayCommands.turnToken({ placementId: id, facing }).then((result) => {
    if (result.dispatched) clearSelection()
  })
}

let attackOfOpportunityPanel: ReturnType<typeof useAttackOfOpportunityPanel> | null = null
const movePokemon = (payload: { id: string; position: GridAnchor }) => {
  const from = spawnedPokemon.value.find((pokemon) => pokemon.id === payload.id)?.position
    ?? placementById(payload.id)?.position
  const previousPosition = from ? { ...from } : null

  if (!canControlPlacement(payload.id)) return
  if (isSetupEditMode()) {
    movePlacementForSetupEdit(payload)
    return
  }
  void livePlayCommands.moveToken({
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

const livePlayActionablePlacementIds = computed(() => {
  if (isSetupEditMode()) return controllablePlacementIds.value
  if (mapInPrepareMode.value) return []
  return livePlayStateMachine.commandsAllowed.value ? controllablePlacementIds.value : []
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

  for (const hazard of mapHazards.value.map((item) => ({ ...item }))) {
    const result = await livePlayCommands.removeHazard({
      cell: { x: hazard.x, y: hazard.y, z: hazard.z, kind: hazard.kind },
    })
    if (!result.dispatched) break
  }
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
  const result = await livePlayCommands.removeFieldEffect({ category: 'weather' })
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
  const result = await livePlayCommands.removeFieldEffect({ category: 'all' })
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
    || livePlayConnectionState.value === 'ready'
  )
))

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
  clearRemotePokeballCaptureFeedback,
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
  if (remotePokeballCaptureResult.value) clearRemotePokeballCaptureFeedback()
  else clearRemotePokeballCapture()
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

const previousInitiativeAndExpireAoo = async () => {
  attackOfOpportunityPanel?.clearAttackOfOpportunityPromptsForNonImmediateAction()
  await Promise.resolve(previousInitiative())
}

const nextInitiativeAndExpireAoo = async () => {
  const before = orderTimelinePoint()
  attackOfOpportunityPanel?.clearAttackOfOpportunityPromptsForNonImmediateAction()
  await Promise.resolve(nextInitiative())
  expireActiveOrdersAfterInitiativeAdvance({ before, after: orderTimelinePoint() })
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
    await modifyHpViaSetupSheetSave(payload, options)
    return
  }
  await livePlayCommands.modifyHp({
    placementId: payload.id,
    currentHp: payload.currentHp,
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
  await livePlayCommands.modifyConditions({
    placementId: payload.id,
    action: 'replace',
    conditions: payload.conditions,
  })
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

const recordMoveUsage = async (request: { placementId: string; moveName: string }) => {
  const result = await livePlayCommands.useMove(request)
  if (!result.dispatched) throw new Error(result.message ?? 'Move usage could not be recorded.')
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

const placeHazardFromScene = async (hazard: Parameters<typeof placeHazard>[0]) => {
  if (isSetupEditMode()) {
    placeHazard(hazard)
    return
  }
  if (!canEditMap.value) return
  await livePlayCommands.placeHazard({ hazard })
}

const removeHazardFromScene = async (cell: Parameters<typeof removeHazard>[0]) => {
  if (isSetupEditMode()) {
    removeHazard(cell)
    return
  }
  if (!canEditMap.value) return
  await livePlayCommands.removeHazard({ cell })
}

const placeVoxelFromScene: typeof placeVoxel = (voxel) => {
  if (isSetupEditMode()) {
    placeVoxel(voxel)
    return
  }
  if (!canEditMap.value) return
  void livePlayCommands.buildTerrainVoxel({ voxel })
}

const removeVoxelFromScene: typeof removeVoxel = (cell) => {
  if (isSetupEditMode()) {
    removeVoxel(cell)
    return
  }
  if (!canEditMap.value) return
  void livePlayCommands.removeTerrainVoxel({ cell })
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
  moveToken: moveTokenFromMoveAutomation,
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
  removeAttackOfOpportunityPrompt,
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
    if (!shouldUseTableActionRoutes()) return undefined
    void livePlayCommands.useAbility({
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
    if (!shouldUseTableActionRoutes()) return undefined
    void livePlayCommands.useManeuver({
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
    if (!shouldUseTableActionRoutes()) return undefined
    void livePlayCommands.useOrder({
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

  if (sheetUpdated && event.result.success) {
    await updatePlacedSheet(
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

    if (isGm.value) {
      const result = await livePlayCommands.deleteToken({ placementId: event.targetId })
      if (result.dispatched && selectedId.value === event.targetId) clearSelection()
    }
  }
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
  livePlayCommands.lastError.value
  ?? tokenSheetMutationError.value
  ?? pokeballCaptureError.value
  ?? remotePokeballCaptureError.value
  ?? moveUsageError.value
))

const cancelActionAutomationTargeting = () => {
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

const sharedMapInteractionModeBusy = computed(() => (
  sharedMapInteractionModeStatus.value === 'loading' || sharedMapInteractionModeStatus.value === 'saving'
))
const setupEditActiveForGm = computed(() => isSetupEditMode())

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
        :status="status"
        :error="error"
        :slug="slug"
        :spawned-pokemon="spawnedPokemon"
        :selected-id="selectedId"
        :controllable-placement-ids="livePlayActionablePlacementIds"
        :active-initiative-id="activeInitiativeId"
        :initiative-rows="sortedInitiativeRows"
        :initiative-round="initiativeRound"
        :can-manage-initiative="initiativeControlsEnabled"
        :initiative-auto-focus-enabled="initiativeAutoFocusEnabled"
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
        :smart-terrain-cutaway-enabled="smartTerrainCutawayEnabled"
        :hazard-mode="hazardMode && canEditMap"
        :hazard-tool="hazardTool"
        :hazard-kind="hazardKind"
        :can-delete-tokens="isGm"
        :token-control-notice="tokenControlNotice"
        :live-play-state="livePlayConnectionState"
        :live-play-status-message="livePlayStatusMessage"
        :move-automation-targeting="actionAutomationTargeting"
        :move-automation-target-branch-selection="moveAutomationTargetBranchSelection"
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
        @select-move-target-branch="selectMoveAutomationTargetBranch"
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
        @clear-attack-of-opportunity="removeAttackOfOpportunityPrompt"
      />
    </template>

    <template #modals>
      <PokeballCaptureResultModal
        v-if="displayedPokeballCaptureResult"
        :key="displayedPokeballCaptureResult.id"
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
        @select="spawnSheet"
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
        :interaction-mode="sharedMapInteractionMode"
        :interaction-mode-busy="sharedMapInteractionModeBusy"
        :interaction-mode-error="sharedMapInteractionModeError"
        :setup-edit-active="setupEditActiveForGm"
        @close="adminPanelOpen = false"
        @set-ground-level-y="setGroundLevelYFromAdmin"
        @update-player-visible="setMapPlayerVisibleFromAdmin"
        @clear-combat-log="clearCombatLogFromAdmin"
        @set-interaction-mode="setMapInteractionModeFromAdmin"
      />
    </template>
  </MapEditorLayout>
</template>
