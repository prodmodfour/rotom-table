<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import FieldEffectsMenuModal from '~/components/map/FieldEffectsMenuModal.vue'
import InitiativeMenuModal from '~/components/map/InitiativeMenuModal.vue'
import MapAdminPanel from '~/components/map/MapAdminPanel.vue'
import MapEditorLayout from '~/components/map/MapEditorLayout.vue'
import MapNavigationRail from '~/components/map/MapNavigationRail.vue'
import MapScenePanel from '~/components/map/MapScenePanel.vue'
import SheetsMenuModal from '~/components/map/SheetsMenuModal.vue'
import { useEditableMap } from '~/composables/useEditableMap'
import { useLiveSheets } from '~/composables/useLiveSheets'
import { useApiClient } from '~/composables/useApiClient'
import { useDocumentMapTokenActions } from '~/composables/map-editor/useDocumentMapTokenActions'
import { useFieldEffectsEditor } from '~/composables/map-editor/useFieldEffectsEditor'
import { useHazardBuilder } from '~/composables/map-editor/useHazardBuilder'
import { useInitiativeTracker } from '~/composables/map-editor/useInitiativeTracker'
import { useMapAccess, useMapGmModeGuard } from '~/composables/map-editor/useMapAccess'
import {
  useMapDimensionControls,
  useMapDimensionReconciliation,
} from '~/composables/map-editor/useMapDimensions'
import { useMapEditorUiState } from '~/composables/map-editor/useMapEditorUiState'
import { useMapTokenNavigation } from '~/composables/map-editor/useMapTokenNavigation'
import { useAbilityAutomationPanel } from '~/composables/map-editor/useAbilityAutomationPanel'
import { useMoveAutomationPanel } from '~/composables/map-editor/useMoveAutomationPanel'
import { useManeuverActionPanel } from '~/composables/map-editor/useManeuverActionPanel'
import { useOrderActionPanel } from '~/composables/map-editor/useOrderActionPanel'
import { useTerrainBuilder } from '~/composables/map-editor/useTerrainBuilder'
import { useAttackOfOpportunityPanel } from '~/utils/attackOfOpportunity'
import { useTokenSheetMutations } from '~/composables/map-editor/useTokenSheetMutations'
import { useSessionMap } from '~/composables/map-editor/useSessionMap'
import { useSessionMapSceneCommands } from '~/composables/map-editor/useSessionMapSceneCommands'
import {
  useSessionMoveTokenDispatch,
  isSessionModeQueryEnabled,
  type SessionMoveTokenSocket,
} from '~/composables/map-editor/useSessionMoveTokenDispatch'
import { useTokenControls } from '~/composables/map-editor/useTokenControls'
import type { AuthoritativeSessionState } from '#shared/sessionState'
import { buildClientPlayerProfileTokenControlModel } from '~/utils/playerProfileTokenControl'
import { buildSessionTokenControlModel } from '~/utils/sessionTokenControl'
import {
  formatSessionCommandRejectionNotice,
  runSessionCommandRejectionRefreshAction,
} from '~/utils/sessionCommandRejectionUi'
import { buildSessionConnectionStatusNotice } from '~/utils/sessionConnectionStatusUi'
import { buildSessionPresencePanelModel } from '~/utils/sessionPresencePanel'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { isSameAnchor } from '~/utils/gridGeometry'
import { mapEditorPath, mapLibraryPath } from '~/utils/mapRoutes'
import { nextTokenFacingForPlacement } from '~/utils/tokenFacing'
import { routeSlugParam } from '~/utils/routeParams'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

definePageMeta({
  key: (route) => `map-${routeSlugParam(route.params)}`,
})

const route = useRoute()
const router = useRouter()
const { role, isGm, isPlayer } = useAuth()
const slug = routeSlugParam(route.params)
const sessionMoveTokenEnabled = computed(() => isSessionModeQueryEnabled(route.query.session))
const {
  selectedProfile,
  selectedProfileId,
  loadRememberedProfile,
  reloadProfiles,
  lastError: playerProfileError,
} = usePlayerProfiles()

const {
  map: localEditableMap,
  status,
  error,
  renamedTo,
  applyPersistedMap,
} = useEditableMap(slug, {
  autosaveEnabled: computed(() => !sessionMoveTokenEnabled.value),
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
  applyPersistedMap,
  applySheetUpdate: applyDocumentSheetUpdate,
})

watch(renamedTo, (newSlug) => {
  if (newSlug) router.replace(mapEditorPath(newSlug))
})
const sessionMap = useSessionMap({
  enabled: sessionMoveTokenEnabled,
  localMap: localEditableMap,
  mapSlug: slug,
})
const sessionMoveTokenDispatch = useSessionMoveTokenDispatch({
  enabled: sessionMoveTokenEnabled,
  mapSlug: slug,
  socket: sessionMap.socket as unknown as SessionMoveTokenSocket,
  hasAuthoritativeSessionState: sessionMap.mapState.hasAuthoritativeSessionState,
})
const map = sessionMap.map
const sessionSceneCommands = useSessionMapSceneCommands({
  enabled: sessionMoveTokenEnabled,
  map,
  mapSlug: slug,
  session: sessionMap,
})
const mapStatus = computed(() => (
  sessionMoveTokenEnabled.value && map.value
    ? 'idle'
    : status.value
))
const sessionSnapshotState = computed(() => (
  sessionMap.socket.lastSnapshot.value?.snapshot as AuthoritativeSessionState<TabletopMap> | undefined
) ?? null)
const sessionTokenControlModel = computed(() => buildSessionTokenControlModel({
  enabled: sessionMoveTokenEnabled.value,
  identity: sessionMap.identity.value,
  mapSlug: slug,
  placements: map.value?.placements ?? [],
  assignments: sessionSnapshotState.value?.assignments,
  hasAuthoritativeSessionState: sessionMap.mapState.hasAuthoritativeSessionState.value,
}))
const playerProfileTokenControlModel = computed(() => buildClientPlayerProfileTokenControlModel({
  role: role.value,
  profile: selectedProfile.value,
  placements: map.value?.placements ?? [],
}))
const tokenControlNotice = computed(() => {
  if (sessionMoveTokenEnabled.value) return sessionTokenControlModel.value.notice
  if (isPlayer.value && documentTokenActions.lastError.value) {
    return `Token action failed: ${documentTokenActions.lastError.value}`
  }
  if (isPlayer.value && playerProfileError.value) {
    return `Player profile unavailable: ${playerProfileError.value}`
  }
  return playerProfileTokenControlModel.value.notice
})
const sessionMapReadyForCommands = computed(() => sessionMap.mapState.hasAuthoritativeSessionState.value)
const canUseSessionTokenSendOut = computed(() => (
  sessionMoveTokenEnabled.value
    ? sessionMap.identity.value !== null && sessionMapReadyForCommands.value
    : canSpawnTokens.value
))
const canUseSessionTokenDelete = computed(() => (
  sessionMoveTokenEnabled.value
    ? sessionMap.identity.value?.role === 'gm' && sessionMapReadyForCommands.value
    : isGm.value
))

useHead(() => ({
  title: map.value ? `${map.value.name} · Maps` : 'Maps · Rotom Table',
}))

interface MapScenePanelHandle {
  focusPokemon: (id: string) => boolean
}

const gridRef = ref<MapScenePanelHandle | null>(null)

if (import.meta.client && isPlayer.value) loadRememberedProfile()

const syncPlayerProfileForMapControl = async () => {
  if (!import.meta.client || !isPlayer.value) return
  loadRememberedProfile()
  try {
    await reloadProfiles({ clearMissingSelection: true })
  } catch {
    // Keep the map view available; token-control notices surface the profile loading problem.
  }
  await reloadRuntimeSheets({ profileId: selectedProfileId.value })
}

onMounted(() => {
  if (sessionMoveTokenEnabled.value) sessionMap.loadSessionSnapshot()
  sessionMoveTokenDispatch.loadRememberedIdentity()
  void syncPlayerProfileForMapControl()
})

watch(sessionMoveTokenEnabled, (enabled) => {
  if (!enabled) return
  sessionMap.loadSessionSnapshot()
  sessionMoveTokenDispatch.loadRememberedIdentity()
})

watch(isPlayer, (nextIsPlayer) => {
  if (nextIsPlayer) void syncPlayerProfileForMapControl()
})

watch(
  [
    sessionMoveTokenEnabled,
    () => sessionMap.identity.value,
    () => sessionMap.mapState.sessionRevision.value,
  ],
  ([enabled, identity]) => {
    if (!enabled || identity?.role !== 'player') return
    void reloadRuntimeSheets()
  },
  { immediate: true },
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
  sessionModeEnabled: sessionMoveTokenEnabled,
  hasAuthoritativeSessionState: sessionMap.mapState.hasAuthoritativeSessionState,
  redirectHiddenPlayerMap: () => router.replace(mapLibraryPath()),
})

const {
  mapVoxels,
  mapHazards,
  groundLevelYMax,
  mapGroundLevelY,
  mapSpecificYMin,
  mapSpecificYMax,
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
  placementById,
  clearSelection,
  updatePreview,
  spawnSheet,
  sendOutPokemon,
  selectPlacement,
  deletePlacement,
  turnPlacement,
  movePlacement,
} = useTokenControls({
  map,
  pokemonBySlug,
  trainerBySlug,
  mapVoxels,
  mapGroundLevelY,
  canSpawnTokens,
  canControlAllTokens: isGm,
  canDeleteTokens: canUseSessionTokenDelete,
  canSendOutTokens: canUseSessionTokenSendOut,
  tokenControl: {
    enabled: computed(() => !sessionMoveTokenEnabled.value),
    controllablePlacementIds: computed(() => playerProfileTokenControlModel.value.controllablePlacementIds),
  },
  sessionMoveTokenDispatcher: sessionMoveTokenDispatch,
  sessionTokenControl: {
    enabled: sessionMoveTokenEnabled,
    controllablePlacementIds: computed(() => sessionTokenControlModel.value.controllablePlacementIds),
  },
})

const selectPokemon = (id: string | null) => {
  if (buildMode.value) return
  selectPlacement(id)
}
const deletePokemon = (id: string) => {
  if (sessionMoveTokenEnabled.value) {
    const result = sessionSceneCommands.dispatchDeletePokemon(id)
    if (result.dispatched) clearSelection()
    return
  }
  deletePlacement(id)
}
const shouldUseDocumentTokenActions = () => isPlayer.value && !sessionMoveTokenEnabled.value

const turnPokemon = (id: string) => {
  if (shouldUseDocumentTokenActions()) {
    const placement = placementById(id)
    if (!placement || !canControlPlacement(id)) return
    const facing = nextTokenFacingForPlacement(placement)
    void documentTokenActions.turnToken({ placementId: id, facing }).then((result) => {
      if (result.dispatched) clearSelection()
    })
    return
  }
  turnPlacement(id)
}

let attackOfOpportunityPanel: ReturnType<typeof useAttackOfOpportunityPanel> | null = null
const movePokemon = (payload: { id: string; position: GridAnchor }) => {
  const from = spawnedPokemon.value.find((pokemon) => pokemon.id === payload.id)?.position
    ?? placementById(payload.id)?.position
  const previousPosition = from ? { ...from } : null

  if (shouldUseDocumentTokenActions()) {
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
    return
  }

  movePlacement(payload)

  const currentPosition = placementById(payload.id)?.position
  if (!previousPosition || !currentPosition || isSameAnchor(previousPosition, currentPosition)) return
  attackOfOpportunityPanel?.clearAttackOfOpportunityPromptsForNonImmediateAction()
  attackOfOpportunityPanel?.provokeMovementAttackOfOpportunity({
    provokerId: payload.id,
    from: previousPosition,
    to: { ...currentPosition },
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
  if (sessionMoveTokenEnabled.value) {
    sessionSceneCommands.dispatchPreviousInitiative()
    return
  }
  previousInitiative()
}

const nextInitiativeAndExpireAoo = () => {
  const before = orderTimelinePoint()
  attackOfOpportunityPanel?.clearAttackOfOpportunityPromptsForNonImmediateAction()
  if (sessionMoveTokenEnabled.value) {
    sessionSceneCommands.dispatchNextInitiative()
    return
  }
  nextInitiative()
  expireActiveOrdersAfterInitiativeAdvance({ before, after: orderTimelinePoint() })
}

const {
  lastError: tokenSheetMutationError,
  modifyHp,
  modifyCombatStages,
  modifyConditions,
  modifyAbilityActivation,
} = useTokenSheetMutations({
  map,
  sheetLookup,
  canControlPlacement,
  playerProfileId: computed(() => (isPlayer.value ? selectedProfileId.value : null)),
})

const modifyHpFromScene: typeof modifyHp = async (payload, options) => {
  if (sessionMoveTokenEnabled.value) {
    sessionSceneCommands.dispatchModifyHp(payload)
    return
  }
  await modifyHp(payload, options)
}

const modifyCombatStagesFromScene: typeof modifyCombatStages = async (payload, options) => {
  if (sessionMoveTokenEnabled.value) {
    sessionSceneCommands.dispatchModifyCombatStages(payload)
    return
  }
  await modifyCombatStages(payload, options)
}

const modifyConditionsFromScene: typeof modifyConditions = async (payload, options) => {
  if (sessionMoveTokenEnabled.value) {
    sessionSceneCommands.dispatchModifyConditions(payload)
    return
  }
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
  if (!incoming || !map.value) return
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
  if (sessionMoveTokenEnabled.value) {
    const result = sessionSceneCommands.dispatchUseMove({
      id: request.placementId,
      moveName: request.moveName,
    })
    if (!result.dispatched) throw new Error(result.message)
    return
  }

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
  if (sessionMoveTokenEnabled.value) {
    sessionSceneCommands.dispatchApplyFieldEffect(effect)
    return
  }
  applyMoveFieldEffect(effect)
}

const placeHazardFromScene: typeof placeHazard = (hazard) => {
  if (sessionMoveTokenEnabled.value) {
    sessionSceneCommands.dispatchPlaceHazard(hazard)
    return
  }
  placeHazard(hazard)
}

const removeHazardFromScene: typeof removeHazard = (cell) => {
  if (sessionMoveTokenEnabled.value) {
    sessionSceneCommands.dispatchRemoveHazard(cell)
    return
  }
  removeHazard(cell)
}

const placeVoxelFromScene: typeof placeVoxel = (voxel) => {
  if (sessionMoveTokenEnabled.value) {
    sessionSceneCommands.dispatchPlaceVoxel(voxel)
    return
  }
  placeVoxel(voxel)
}

const removeVoxelFromScene: typeof removeVoxel = (cell) => {
  if (sessionMoveTokenEnabled.value) {
    sessionSceneCommands.dispatchRemoveVoxel(cell)
    return
  }
  removeVoxel(cell)
}

const sendOutPokemonFromScene: typeof sendOutPokemon = (payload) => {
  if (sessionMoveTokenEnabled.value) {
    const result = sessionSceneCommands.dispatchSendOutPokemon(payload)
    if (result.dispatched) clearSelection()
    return
  }
  sendOutPokemon(payload)
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
    if (sessionMoveTokenEnabled.value) {
      return sessionSceneCommands.dispatchUseAbility({
        id: event.userId,
        abilityName: event.abilityName,
        targetTokenId: event.targetTokenId,
      }).dispatched
    }
    if (!shouldUseDocumentTokenActions()) return undefined
    void documentTokenActions.useAbility({
      placementId: event.userId,
      abilityName: event.abilityName,
      ...(event.targetTokenId ? { targetPlacementId: event.targetTokenId } : {}),
    })
    return true
  },
  onBeforeNonImmediateAction: () => {
    attackOfOpportunityPanel?.clearAttackOfOpportunityPromptsForNonImmediateAction()
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
    if (sessionMoveTokenEnabled.value) {
      return sessionSceneCommands.dispatchUseManeuver({
        id: event.userId,
        maneuverName: event.maneuverName,
        targetTokenId: event.targetTokenId,
      }).dispatched
    }
    if (!shouldUseDocumentTokenActions()) return undefined
    void documentTokenActions.useManeuver({
      placementId: event.userId,
      maneuverName: event.maneuverName,
      ...(event.targetTokenId ? { targetPlacementId: event.targetTokenId } : {}),
    })
    return true
  },
  onBeforeManeuverAction: () => {
    attackOfOpportunityPanel?.clearAttackOfOpportunityPromptsForNonImmediateAction()
  },
})

const orderActionPanel = useOrderActionPanel({
  map,
  spawnedPokemon,
  trainerBySlug,
  canControlPlacement,
  dispatchOrderUse: (event) => {
    if (sessionMoveTokenEnabled.value) {
      return sessionSceneCommands.dispatchUseOrder({
        id: event.userId,
        orderName: event.orderName,
        targetTokenId: event.targetTokenId,
      }).dispatched
    }
    if (!shouldUseDocumentTokenActions()) return undefined
    void documentTokenActions.useOrder({
      placementId: event.userId,
      orderName: event.orderName,
      ...(event.targetTokenId ? { targetPlacementId: event.targetTokenId } : {}),
    })
    return true
  },
  onBeforeOrderAction: () => {
    attackOfOpportunityPanel?.clearAttackOfOpportunityPromptsForNonImmediateAction()
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

const actionAutomationTargeting = computed(() =>
  moveAutomationTargeting.value
  ?? abilityAutomationTargeting.value
  ?? maneuverActionTargeting.value
  ?? orderActionTargeting.value,
)

const dismissedSessionCommandRejectionOpId = ref<string | null>(null)
const sessionCommandRejectionNotice = computed(() => {
  if (!sessionMoveTokenEnabled.value) return null
  const rejectMessage = sessionMap.lastCommandReject.value
  if (rejectMessage === null) return null
  if (dismissedSessionCommandRejectionOpId.value === rejectMessage.result.opId) return null
  return formatSessionCommandRejectionNotice(rejectMessage)
})

const sessionPresencePanel = computed(() => {
  if (!sessionMoveTokenEnabled.value) return null
  return buildSessionPresencePanelModel({
    identity: sessionMap.identity.value,
    presence: sessionMap.lastPresence.value,
    snapshot: sessionMap.socket.lastSnapshot.value,
  })
})

const sessionConnectionStatusNotice = computed(() => buildSessionConnectionStatusNotice({
  enabled: sessionMoveTokenEnabled.value,
  status: sessionMap.status.value,
  socketStatus: sessionMap.socket.status.value,
  helloStatus: sessionMap.socket.helloStatus.value,
  heartbeatStatus: sessionMap.socket.heartbeatStatus.value,
  reconnectStatus: sessionMap.socket.reconnectStatus.value,
  snapshotStatus: sessionMap.snapshotStatus.value,
  hasAuthoritativeSessionState: sessionMap.mapState.hasAuthoritativeSessionState.value,
  lastKnownRevision: sessionMap.socket.lastKnownRevision.value,
  lastSnapshot: sessionMap.socket.lastSnapshot.value,
  lastError: sessionMap.socket.lastError.value,
}))

watch(
  () => sessionMap.lastCommandReject.value?.result.opId ?? null,
  (opId, previousOpId) => {
    if (opId !== previousOpId) dismissedSessionCommandRejectionOpId.value = null
  },
)

const dismissSessionCommandRejection = () => {
  const opId = sessionMap.lastCommandReject.value?.result.opId
  if (opId !== undefined) dismissedSessionCommandRejectionOpId.value = opId
}

const refreshSessionSnapshotAfterRejection = () => runSessionCommandRejectionRefreshAction({
  resetDismissal: () => {
    dismissedSessionCommandRejectionOpId.value = null
  },
  refreshSessionSnapshot: sessionMap.refreshSessionSnapshot,
})

const openMoveAutomationFromContext = (payload: { id: string; moveName?: string | null }) => {
  cancelAbilityAutomationTargeting()
  cancelManeuverActionTargeting()
  cancelOrderActionTargeting()
  openMoveAutomation(payload)
}

const useManeuverFromContext = (payload: { id: string; maneuverName?: string | null }) => {
  cancelMoveAutomationTargeting()
  cancelAbilityAutomationTargeting()
  cancelOrderActionTargeting()
  useManeuver(payload)
}

const openAbilityAutomationFromContext = (payload: { id: string; abilityName?: string | null }) => {
  cancelMoveAutomationTargeting()
  cancelManeuverActionTargeting()
  cancelOrderActionTargeting()
  void openAbilityAutomation(payload)
}

const useOrderFromContext = (payload: { id: string; orderName?: string | null }) => {
  cancelMoveAutomationTargeting()
  cancelManeuverActionTargeting()
  cancelAbilityAutomationTargeting()
  useOrder(payload)
}

const selectActionAutomationTarget = (targetId: string) => {
  if (moveAutomationTargeting.value) {
    selectMoveAutomationTarget(targetId)
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

const sceneActionError = computed(() => {
  if (!sessionMoveTokenEnabled.value) {
    return documentTokenActions.lastError.value ?? tokenSheetMutationError.value ?? moveUsageError.value
  }
  const tokenDispatchError = sessionMap.lastCommandReject.value === null
    ? sessionMoveTokenDispatch.lastError.value
    : null
  return sessionSceneCommands.lastError.value ?? tokenDispatchError ?? moveUsageError.value
})

const cancelActionAutomationTargeting = () => {
  if (moveAutomationTargeting.value) {
    cancelMoveAutomationTargeting()
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
        :status="mapStatus"
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
        :can-delete-tokens="canUseSessionTokenDelete"
        :token-control-notice="tokenControlNotice"
        :move-automation-targeting="actionAutomationTargeting"
        :move-automation-feedback="moveAutomationFeedback"
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
        :session-command-rejection="sessionCommandRejectionNotice"
        :session-connection-status="sessionConnectionStatusNotice"
        :session-presence="sessionPresencePanel"
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
        @dismiss-spite-reaction="dismissSpiteReactionPrompt"
        @apply-spite-reaction="applySpiteReactionPrompt"
        @dismiss-cute-charm-reaction="dismissCuteCharmReactionPrompt"
        @apply-cute-charm-reaction="applyCuteCharmReactionPrompt"
        @dismiss-poison-point-reaction="dismissPoisonPointReactionPrompt"
        @apply-poison-point-reaction="applyPoisonPointReactionPrompt"
        @dismiss-moxie-trigger="dismissMoxieTriggerPrompt"
        @apply-moxie-trigger="applyMoxieTriggerPrompt"
        @dismiss-celebrate-trigger="dismissCelebrateTriggerPrompt"
        @apply-celebrate-trigger="applyCelebrateTriggerPrompt"
        @use-attack-of-opportunity="useAttackOfOpportunity"
        @refresh-session-snapshot="refreshSessionSnapshotAfterRejection"
        @dismiss-session-command-rejection="dismissSessionCommandRejection"
      />
    </template>

    <template #modals>
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
        @close="adminPanelOpen = false"
        @set-ground-level-y="setGroundLevelY"
      />
    </template>
  </MapEditorLayout>
</template>
