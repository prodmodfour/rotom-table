<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import RenderMetricsOverlay from '~/components/isometric/RenderMetricsOverlay.vue'
import TokenActionDialogs from '~/components/isometric/TokenActionDialogs.vue'
import TokenContextMenu from '~/components/isometric/TokenContextMenu.vue'
import { useTokenActionController } from '~/composables/isometric/useTokenActionController'
import { useWindowKeydown } from '~/composables/useWindowKeydown'
import { useIsometricSceneWatchers } from '~/composables/isometric/useIsometricSceneWatchers'
import type { GridAnchor, GridDimensions, SpawnedPokemon } from '~/types/pokemon'
import type {
  LayerVisibility,
  MapFieldEffects,
  MapHazardKind,
  MapHazardV2,
  MapVoxelV2,
  VoxelMaterial,
} from '~/types/map'
import type { PreviewState } from '~/utils/gridPreview'
import { getPokemonCenter } from '~/utils/gridGeometry'
import { buildAllVoxelOccupancy } from '~/utils/voxelOccupancy'
import { buildMapOccupancy } from '~/utils/mapOccupancy'
import { normalizeMapFieldEffects } from '~/utils/mapFieldEffects'
import {
  createMoveAutomationAreaDirectionUpdateThrottle,
  moveAutomationAreaDirectionFromPoint,
} from '~/utils/moveAutomationAreaAiming'
import type { CombatStageMap } from '~/types/combatStages'
import type {
  MoveAutomationAreaDirection,
  MoveAutomationFeedbackState,
  MoveAutomationHpUpdate,
  MoveAutomationTargetHitChance,
  MoveAutomationTargetingOverlayState,
} from '~/types/moveAutomation'
import type { BuildTool } from '#shared/mapEditor'
import type { AttackOfOpportunityPrompt } from '~/utils/attackOfOpportunity'
import type { TokenAbilityMenuOption } from '~/utils/mapTokenAbilities'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'
import type { TokenManeuverMenuOption } from '~/utils/mapTokenManeuvers'
import type { TokenOrderMenuOption } from '~/utils/mapTokenOrders'
import {
  POKEBALL_THROW_RANGE_SQUARES,
  type TokenSendOutOption,
} from '~/utils/mapTokenSendOut'
import type { TokenPokeballOption } from '~/utils/pokeballCapture'
import {
  DEFAULT_FACING_DIRECTION,
  alignCameraToGrid as alignIsometricCameraToGrid,
  bindIsometricCameraControlChangeInvalidation,
  createIsometricCamera,
  createIsometricCssRenderer,
  createIsometricOrbitControls,
  createIsometricWebGLRenderer,
  focusCameraOnPokemon,
  maxUsefulCameraZoom,
  syncIsometricRendererSize,
  type IsometricRendererSizeState,
} from '~/utils/isometric/cameraControls'
import { createPointerTravelTracker } from '~/utils/isometric/pointerTracker'
import { createIsometricPointerInteractionController } from '~/utils/isometric/pointerInteraction'
import type { CoalescedPointerEventFrame } from '~/utils/isometric/pointerEventCoalescer'
import type {
  BuildTarget,
  HazardTarget,
  PokemonRenderObject,
} from '~/utils/isometric/types'
import { createVoxelRenderer } from '~/utils/isometric/voxelRenderer'
import { createHazardRenderer } from '~/utils/isometric/hazardRenderer'
import { createFieldEffectRenderer } from '~/utils/isometric/fieldEffectRenderer'
import { createGridRenderer } from '~/utils/isometric/gridRenderer'
import {
  createBuildHazardPickTargetCache,
  createPointerRaycastScratch,
  createRendererPointerBoundsCache,
  createTokenProxyPickTargetCache,
  getMoveGridIntersectionFromPointer,
  pickBuildTargetFromPointer,
  pickHazardTargetFromPointer,
  pickPokemonIdFromPointer,
} from '~/utils/isometric/interactionTargets'
import { createBuildGhostRenderer, createHazardGhostRenderer } from '~/utils/isometric/previewGhosts'
import { createTokenMovePreviewRenderer } from '~/utils/isometric/tokenMovePreview'
import { createTokenRenderGeometryCache } from '~/utils/isometric/tokenGeometryCache'
import {
  createMoveAreaTemplateRenderer,
  createMoveAutomationFeedbackRenderer,
  createMoveTargetingReticleRenderer,
} from '~/utils/isometric/moveAutomationOverlays'
import {
  clampIsometricGroundLevelY,
  getFieldEffectsRevisionKey,
  getHazardsRevisionKey,
  getTerrainVoxelsRevisionKey,
  resolveIsometricLayerVisibility,
} from '~/utils/isometric/sceneState'
import { createIsometricTokenMovementInteractionController } from '~/utils/isometric/tokenMovementInteraction'
import { createIsometricTokenSendOutInteractionController } from '~/utils/isometric/tokenSendOutInteraction'
import { movementPathPlacementRevision } from '~/utils/mapMovementPathCache'
import {
  applyPokemonRenderObjectPosition,
  createPokemonRenderObject,
  disposePokemonRenderObject,
  paintPokemonRenderObjectStyle,
  setPokemonRenderObjectLayerVisibility,
  updatePokemonRenderObjectFromSpawn,
} from '~/utils/isometric/tokenRenderer'
import { buildVoxelColumnsByXZ, getVoxelShadowSurfaceY } from '~/utils/isometric/shadows'
import {
  bindIsometricDocumentVisibilityChange,
  bindIsometricRendererDomEvents,
  disposeIsometricRendererResources,
  observeIsometricResize,
} from '~/utils/isometric/lifecycle'
import { createIsometricSceneGraph } from '~/utils/isometric/sceneGraph'
import { stepIsometricAnimationFrame } from '~/utils/isometric/animationFrame'
import {
  createIsometricLayerVisibilityApplicator,
  setIsometricGridVisibility,
} from '~/utils/isometric/layerVisibility'
import { createIsometricBuildInteractionController } from '~/utils/isometric/buildInteraction'
import { createIsometricHazardInteractionController } from '~/utils/isometric/hazardInteraction'
import {
  createIsometricTokenHoverController,
  updateHoveredPokemonElevationBadge,
} from '~/utils/isometric/tokenHover'
import {
  syncPokemonRenderObjects,
  syncPokemonRenderObjectSelectionStyles,
} from '~/utils/isometric/tokenObjectSync'
import { isIsometricRenderDebugEnabled } from '~/utils/isometric/renderDebugFlag'
import { createRenderFrameTimingSampler } from '~/utils/isometric/frameTimingSampler'
import {
  createEmptyIsometricRenderMetricsSnapshot,
  createIsometricRenderMetricsSnapshotWithFrameTiming,
  createIsometricRenderMetricsSnapshotWithPointerInteractions,
  createIsometricRenderMetricsSnapshotWithRendererInfo,
  type IsometricPointerRaycastKind,
} from '~/utils/isometric/renderMetrics'
import { createPointerInteractionMetricsSampler } from '~/utils/isometric/pointerMetricsSampler'
import { sampleWebGLRendererInfo } from '~/utils/isometric/rendererInfoSampler'
import {
  createIsometricRenderScheduler,
  type IsometricRenderScheduler,
  type IsometricRenderSchedulerReasonInput,
  type IsometricScheduledRenderFrame,
} from '~/utils/isometric/renderScheduler'
import {
  createIsometricAnimationContinuation,
  resolveIsometricFieldEffectAnimationContinuationSources,
  resolveIsometricMovementPreviewAnimationContinuationSources,
  resolveIsometricSpriteAnimationContinuationSources,
  resolveIsometricTokenMotionContinuationSources,
  toIsometricRenderSchedulerFrameResult,
} from '~/utils/isometric/renderLoop'
import { createCss3DRenderDirtyTracker } from '~/utils/isometric/css3DRenderDirtyTracker'

export type { BuildTool } from '#shared/mapEditor'

const props = defineProps<{
  dimensions: GridDimensions
  pokemons: SpawnedPokemon[]
  selectedId: string | null
  controllableIds?: string[]
  activeTurnId?: string | null
  voxels: MapVoxelV2[]
  hazards?: MapHazardV2[]
  fieldEffects?: MapFieldEffects
  groundLevelY?: number
  layerVisibility?: LayerVisibility
  buildMode: boolean
  buildTool: BuildTool
  buildMaterial: VoxelMaterial
  buildColor: string | null
  buildGhostVoxel: boolean
  ghostVoxelsFaded: boolean
  hazardMode?: boolean
  hazardTool?: BuildTool
  hazardKind?: MapHazardKind
  canDeleteTokens?: boolean
  tokenMoveOptionsById?: Record<string, TokenMoveMenuOption[]>
  tokenManeuverOptionsById?: Record<string, TokenManeuverMenuOption[]>
  tokenAbilityOptionsById?: Record<string, TokenAbilityMenuOption[]>
  tokenOrderOptionsById?: Record<string, TokenOrderMenuOption[]>
  tokenSendOutOptionsById?: Record<string, TokenSendOutOption[]>
  tokenPokeballOptionsById?: Record<string, TokenPokeballOption[]>
  moveAutomationTargeting?: MoveAutomationTargetingOverlayState | null
  moveAutomationFeedback?: MoveAutomationFeedbackState | null
  attackOfOpportunityPrompts?: AttackOfOpportunityPrompt[]
}>()

const emit = defineEmits<{
  (event: 'select-pokemon', id: string | null): void
  (event: 'move-pokemon', payload: { id: string; position: GridAnchor }): void
  (event: 'turn-pokemon', id: string): void
  (event: 'delete-pokemon', id: string): void
  (event: 'modify-hp', payload: MoveAutomationHpUpdate): void
  (event: 'modify-combat-stages', payload: { id: string; stages: CombatStageMap }): void
  (event: 'modify-conditions', payload: { id: string; conditions: string[] }): void
  (event: 'use-move', payload: { id: string; moveName?: string | null }): void
  (event: 'use-maneuver', payload: { id: string; maneuverName?: string | null }): void
  (event: 'use-ability', payload: { id: string; abilityName?: string | null }): void
  (event: 'use-order', payload: { id: string; orderName?: string | null }): void
  (event: 'send-out-pokemon', payload: { trainerId: string; pokemonSlug: string; position: GridAnchor }): void
  (event: 'throw-pokeball', payload: { id: string; pokeballName: string }): void
  (event: 'view-sheet', id: string): void
  (event: 'view-pokedex', id: string): void
  (event: 'preview-change', preview: PreviewState): void
  (event: 'place-voxel', voxel: MapVoxelV2): void
  (event: 'remove-voxel', cell: { x: number; y: number; z: number }): void
  (event: 'place-hazard', hazard: MapHazardV2): void
  (event: 'remove-hazard', cell: { x: number; y: number; z: number; kind?: MapHazardKind }): void
  (event: 'select-move-target', targetId: string): void
  (event: 'select-move-area-direction', direction: MoveAutomationAreaDirection): void
  (event: 'cancel-move-targeting'): void
  (event: 'use-attack-of-opportunity', payload: { promptId: string; moveName: string }): void
}>()

const visibleLayers = () => resolveIsometricLayerVisibility(props.layerVisibility)

const normalizedGroundLevelY = () => clampIsometricGroundLevelY(props.dimensions, props.groundLevelY)

const route = useRoute()
const container = ref<HTMLDivElement | null>(null)
const renderMetricsOverlayEnabled = computed(() => isIsometricRenderDebugEnabled({ query: route.query }))
const renderMetricsOverlaySnapshot = ref(createEmptyIsometricRenderMetricsSnapshot())

type TargetReticleButton = {
  id: string
  left: number
  top: number
  selected: boolean
  showsReticle: boolean
  hitChance?: MoveAutomationTargetHitChance
}

type AttackOfOpportunityButton = AttackOfOpportunityPrompt & {
  left: number
  top: number
}

const targetReticleButtons = ref<TargetReticleButton[]>([])
const attackOfOpportunityButtons = ref<AttackOfOpportunityButton[]>([])
const openAttackOfOpportunityMenuId = ref<string | null>(null)

const emitPokemonSelection = (id: string | null) => {
  if (props.moveAutomationTargeting) return
  emit('select-pokemon', id)
}

const controllableIdSet = computed(() => new Set(props.controllableIds ?? props.pokemons.map((pokemon) => pokemon.id)))
const canControlPokemon = (id: string | null | undefined): id is string =>
  Boolean(id && controllableIdSet.value.has(id))

const sendOutPlacement = ref<{ trainerId: string; pokemonSlug: string } | null>(null)
const sendOutOptionsForToken = (id: string | null | undefined): TokenSendOutOption[] =>
  id ? props.tokenSendOutOptionsById?.[id] ?? [] : []
const findSendOutOption = (trainerId: string, pokemonSlug: string): TokenSendOutOption | null =>
  sendOutOptionsForToken(trainerId).find((option) => option.pokemonSlug === pokemonSlug) ?? null
const activeSendOutRequest = computed(() => {
  const placement = sendOutPlacement.value
  if (!placement || !canControlPokemon(placement.trainerId)) return null

  const trainer = props.pokemons.find((pokemon) => pokemon.id === placement.trainerId)
  const option = findSendOutOption(placement.trainerId, placement.pokemonSlug)
  if (!trainer || !option) return null

  return {
    trainerId: placement.trainerId,
    pokemonSlug: placement.pokemonSlug,
    trainer,
    pokemon: option.preview,
    range: POKEBALL_THROW_RANGE_SQUARES,
  }
})

const clearSendOutPlacement = () => {
  sendOutPlacement.value = null
  requestScheduledSceneFrame('movement-preview')
}

const beginSendOutPlacement = (payload: { trainerId: string; pokemonSlug: string }) => {
  if (!canControlPokemon(payload.trainerId)) return
  if (!findSendOutOption(payload.trainerId, payload.pokemonSlug)) return

  sendOutPlacement.value = payload
  emitPokemonSelection(null)
  requestScheduledSceneFrame('movement-preview')
}

const {
  actionDialogs,
  contextMenu,
  hpDialog,
  hpDialogDelta,
  hpDialogPreview,
  hpDialogInjuryResult,
  hpDialogPreviewMaxHp,
  combatStagesDialog,
  combatStagesDialogChanged,
  conditionsDialog,
  conditionsDialogChanged,
  damageDialog,
  damageDialogDbDef,
  damageDialogRawAmount,
  damageDialogDefense,
  damageDialogAttackerOptions,
  damageDialogAttackBonus,
  damageDialogMultiplier,
  damageDialogHpLoss,
  damageDialogPreview,
  damageDialogInjuryResult,
  damageDialogPreviewMaxHp,
  damageDialogMultiplierTone,
  damageDialogMultiplierLabel,
  openContextMenu,
  closeContextMenu,
  handleContextTurn,
  handleContextModifyHp,
  closeHpDialog,
  handleHpDialogSubmit,
  handleContextModifyCombatStages,
  closeCombatStagesDialog,
  handleCombatStagesDialogSubmit,
  handleContextApplyRemoveConditions,
  closeConditionsDialog,
  handleConditionsDialogSubmit,
  handleContextUseMove,
  handleContextUseManeuver,
  handleContextUseAbility,
  handleContextUseOrder,
  handleContextSendOutPokemon,
  handleContextThrowPokeball,
  handleContextViewSheet,
  handleContextViewPokedex,
  handleContextDealDamage,
  closeDamageDialog,
  handleDamageDialogSubmit,
  handleContextDelete,
  syncDialogsFromPokemons,
  closeUnauthorizedActions,
  closeTopmostOverlay,
} = useTokenActionController({
  container,
  pokemons: () => props.pokemons,
  canDeleteTokens: () => props.canDeleteTokens,
  canControlPokemon,
  getSendOutOptionCount: (id) => sendOutOptionsForToken(id).length,
  emit: {
    turnPokemon: (id) => emit('turn-pokemon', id),
    deletePokemon: (id) => emit('delete-pokemon', id),
    modifyHp: (payload) => emit('modify-hp', payload),
    modifyCombatStages: (payload) => emit('modify-combat-stages', payload),
    modifyConditions: (payload) => emit('modify-conditions', payload),
    useMove: (payload) => emit('use-move', payload),
    useManeuver: (payload) => emit('use-maneuver', payload),
    useAbility: (payload) => emit('use-ability', payload),
    useOrder: (payload) => emit('use-order', payload),
    sendOutPokemon: beginSendOutPlacement,
    throwPokeball: (payload) => emit('throw-pokeball', payload),
    viewSheet: (id) => emit('view-sheet', id),
    viewPokedex: (id) => emit('view-pokedex', id),
  },
})

const selectedPokemon = computed(
  () => props.pokemons.find((pokemon) => pokemon.id === props.selectedId) ?? null,
)

const emptyMovementPreview = (): PreviewState => ({ position: null, reachable: false, pathLength: 0 })
const movementPreviewState = ref<PreviewState>(emptyMovementPreview())
const emitMovementPreviewChange = (preview: PreviewState) => {
  movementPreviewState.value = preview
  emit('preview-change', preview)
}
const movementPreviewHud = computed(() => {
  const preview = movementPreviewState.value
  if (!selectedPokemon.value || activeSendOutRequest.value || props.moveAutomationTargeting) return null
  if (!preview.position || preview.pathLength <= 0) return null

  return {
    reachable: preview.reachable,
    distance: preview.movementDistance ?? preview.pathLength,
    limit: preview.movementLimit,
    capabilityLabel: preview.movementCapabilityLabel ?? 'Movement',
    failureReason: preview.movementFailureReason,
  }
})
const conditionMoveOptions = computed(() => conditionsDialog.value
  ? props.tokenMoveOptionsById?.[conditionsDialog.value.id]?.map((move) => move.name) ?? []
  : [])
const conditionCrushOptions = computed(() => conditionsDialog.value
  ? props.pokemons
      .filter((pokemon) => pokemon.id !== conditionsDialog.value?.id)
      .map((pokemon) => pokemon.species)
  : [])
const renderedTerrainVoxels = computed(() => props.voxels)
const renderedHazards = computed(() => props.hazards ?? [])
const renderedFieldEffects = computed(() => normalizeMapFieldEffects(props.fieldEffects))
const fieldEffectsRevision = computed(() => getFieldEffectsRevisionKey(renderedFieldEffects.value))
const hazardRevision = computed(() => getHazardsRevisionKey(renderedHazards.value))
const terrainVoxelRevision = computed(() => getTerrainVoxelsRevisionKey(renderedTerrainVoxels.value))
const pokemonPlacementRevision = computed(() => movementPathPlacementRevision(props.pokemons))
const mapMovementOccupancy = computed(() =>
  buildMapOccupancy({
    voxels: renderedTerrainVoxels.value,
  }),
)
const allVoxelOccupancy = computed(() => buildAllVoxelOccupancy(renderedTerrainVoxels.value))

// Voxel y-values bucketed by ``x,z`` column key. Lets a shadow-cast
// lookup stay O(footprint) instead of O(voxels) — most cells have 0
// or 1 voxels above ground, so the scan is trivial.
const voxelColumnsByXZ = computed(() => buildVoxelColumnsByXZ(renderedTerrainVoxels.value))

const getShadowSurfaceY = (
  centerX: number,
  centerZ: number,
  base: number,
  footY: number,
): number => getVoxelShadowSurfaceY({
  columns: voxelColumnsByXZ.value,
  centerX,
  centerZ,
  base,
  footY,
})

const {
  scene,
  raycaster,
  gridGroup,
  worldGroup,
  previewGroup,
  voxelContainer,
  fieldEffectContainer,
  hazardContainer,
  clock,
} = createIsometricSceneGraph()

const renderObjects = new Map<string, PokemonRenderObject>()
const tokenGeometryCache = createTokenRenderGeometryCache()
const voxelRenderer = createVoxelRenderer(voxelContainer)
const hazardRenderer = createHazardRenderer(hazardContainer)
const fieldEffectRenderer = createFieldEffectRenderer(fieldEffectContainer)
const gridRenderer = createGridRenderer(gridGroup)
const buildGhostRenderer = createBuildGhostRenderer(previewGroup)
const hazardGhostRenderer = createHazardGhostRenderer(previewGroup)
const tokenMovePreviewRenderer = createTokenMovePreviewRenderer({
  scene,
  group: previewGroup,
  onTextureLoadComplete: requestTokenTextureRender,
})
const moveTargetingReticleRenderer = createMoveTargetingReticleRenderer(scene)
const moveAreaTemplateRenderer = createMoveAreaTemplateRenderer(scene)
const moveAutomationFeedbackRenderer = createMoveAutomationFeedbackRenderer(scene)
let renderer: THREE.WebGLRenderer | null = null
let cssRenderer: ReturnType<typeof createIsometricCssRenderer> | null = null
let camera: THREE.OrthographicCamera | null = null
let controls: ReturnType<typeof createIsometricOrbitControls> | null = null
let cleanupCameraControlChangeInvalidation: (() => void) | null = null
let cleanupDocumentVisibilityChange: (() => void) | null = null
let cleanupRendererDomEvents: (() => void) | null = null
let cleanupResizeObserver: (() => void) | null = null
let renderScheduler: IsometricRenderScheduler | null = null
let rendererSizeState: IsometricRendererSizeState | null = null
const pointerTracker = createPointerTravelTracker()
const rendererBoundsCache = createRendererPointerBoundsCache()
const pointerRaycastScratch = createPointerRaycastScratch()
const tokenProxyPickTargets = createTokenProxyPickTargetCache()
const buildHazardPickTargets = createBuildHazardPickTargetCache()
const renderFrameTimingSampler = createRenderFrameTimingSampler()
const pointerInteractionMetricsSampler = createPointerInteractionMetricsSampler()
const css3DRenderDirtyTracker = createCss3DRenderDirtyTracker()
const layerVisibilityApplicator = createIsometricLayerVisibilityApplicator()

const readRenderMetricsNowMs = (): number => {
  const performanceNow = globalThis.performance?.now

  if (typeof performanceNow === 'function') {
    return performanceNow.call(globalThis.performance)
  }

  return Date.now()
}

const recordScheduledFrameForMetricsOverlay = (frame: IsometricScheduledRenderFrame) => {
  if (!renderMetricsOverlayEnabled.value) {
    return
  }

  const frames = renderFrameTimingSampler.recordFrame({
    startedAtMs: frame.timestampMs,
    activeAnimation: frame.activeAnimation,
    reasons: frame.reasons,
  })

  renderMetricsOverlaySnapshot.value = createIsometricRenderMetricsSnapshotWithFrameTiming(
    renderMetricsOverlaySnapshot.value,
    frames,
    readRenderMetricsNowMs(),
  )
}

const sampleRendererInfoForMetricsOverlay = () => {
  if (!renderMetricsOverlayEnabled.value || !renderer) {
    return
  }

  const rendererInfo = sampleWebGLRendererInfo(renderer, { now: readRenderMetricsNowMs })

  if (!rendererInfo) {
    return
  }

  renderMetricsOverlaySnapshot.value = createIsometricRenderMetricsSnapshotWithRendererInfo(
    renderMetricsOverlaySnapshot.value,
    rendererInfo,
  )
}

const syncPointerMetricsForMetricsOverlay = () => {
  if (!renderMetricsOverlayEnabled.value) {
    return
  }

  renderMetricsOverlaySnapshot.value = createIsometricRenderMetricsSnapshotWithPointerInteractions(
    renderMetricsOverlaySnapshot.value,
    pointerInteractionMetricsSampler.snapshot(),
    readRenderMetricsNowMs(),
  )
}

const recordPointerMoveEventForMetricsOverlay = () => {
  if (!renderMetricsOverlayEnabled.value) {
    return
  }

  pointerInteractionMetricsSampler.recordPointerMoveEvent()
  syncPointerMetricsForMetricsOverlay()
}

const recordPointerMoveFrameForMetricsOverlay = (frame: CoalescedPointerEventFrame) => {
  if (!renderMetricsOverlayEnabled.value) {
    return
  }

  pointerInteractionMetricsSampler.recordPointerMoveFrame({
    coalescedEventCount: frame.coalescedEventCount,
  })
  syncPointerMetricsForMetricsOverlay()
}

const recordPointerRaycastForMetricsOverlay = (kind: IsometricPointerRaycastKind) => {
  if (!renderMetricsOverlayEnabled.value) {
    return
  }

  pointerInteractionMetricsSampler.recordRaycast(kind)
  syncPointerMetricsForMetricsOverlay()
}

const recordPathfindingRequestForMetricsOverlay = () => {
  if (!renderMetricsOverlayEnabled.value) {
    return
  }

  pointerInteractionMetricsSampler.recordPathfindingRequest()
  syncPointerMetricsForMetricsOverlay()
}

const recordPathfindingCacheHitForMetricsOverlay = () => {
  if (!renderMetricsOverlayEnabled.value) {
    return
  }

  pointerInteractionMetricsSampler.recordPathfindingCacheHit()
  syncPointerMetricsForMetricsOverlay()
}

const recordPathfindingCacheMissForMetricsOverlay = () => {
  if (!renderMetricsOverlayEnabled.value) {
    return
  }

  pointerInteractionMetricsSampler.recordPathfindingCacheMiss()
  syncPointerMetricsForMetricsOverlay()
}

const getPreviewLayerY = () => movementInteraction.activeAnchor()?.y ?? selectedPokemon.value?.position.y ?? 0

const syncRendererSize = (): boolean => {
  rendererBoundsCache.invalidate()

  if (!renderer || !cssRenderer || !camera || !container.value) {
    return false
  }

  const result = syncIsometricRendererSize({
    renderer,
    cssRenderer,
    camera,
    controls,
    container: container.value,
    dimensions: props.dimensions,
    previousSize: rendererSizeState,
  })
  rendererSizeState = result.size
  if (result.changed) css3DRenderDirtyTracker.markDirty('resize')

  return result.changed
}

const syncRendererSizeFromResizeObserver = () => {
  if (!syncRendererSize()) {
    return
  }

  renderScheduler?.requestRender('resize')
}

const alignCameraToGrid = (initial = false) => {
  if (!camera || !controls) {
    return
  }

  alignIsometricCameraToGrid({
    camera,
    controls,
    dimensions: props.dimensions,
    initial,
  })
}

const focusPokemon = (id: string): boolean => {
  if (!camera || !controls) return false

  const pokemon = props.pokemons.find((entry) => entry.id === id)
  if (!pokemon) return false

  const renderObject = renderObjects.get(id)
  const pokemonCenter = getPokemonCenter(pokemon)
  const center = renderObject?.targetCenter ?? new THREE.Vector3(
    pokemonCenter.x,
    pokemonCenter.y,
    pokemonCenter.z,
  )

  focusCameraOnPokemon({
    camera,
    controls,
    dimensions: props.dimensions,
    pokemon,
    center,
  })
  return true
}

defineExpose({ focusPokemon })

const updateGridVisibility = () => {
  setIsometricGridVisibility({
    layers: visibleLayers(),
    hasSelectedPokemon: Boolean(selectedPokemon.value),
    buildMode: props.buildMode,
    hazardMode: props.hazardMode,
    gridRenderer,
  })
}

const buildGrid = () => {
  gridRenderer.sync(props.dimensions)
  buildHazardPickTargets.setFloorPlane(gridRenderer.floorPlane())
  updateGridVisibility()
}

const hoverController = createIsometricTokenHoverController({
  getRenderObject: (id) => renderObjects.get(id),
  updateHoveredRenderObject: (renderObject) => updateHoveredPokemonElevationBadge(renderObject, {
    groundLevelY: normalizedGroundLevelY(),
    camera,
    show: visibleLayers().tokens,
  }),
  onHoverChange: () => requestScheduledSceneFrame('token-style'),
})

const setHoveredPokemonId = hoverController.set

const buildRenderObject = (pokemon: SpawnedPokemon): PokemonRenderObject =>
  createPokemonRenderObject(pokemon, {
    scene,
    worldGroup,
    onTextureLoadComplete: requestTokenTextureRender,
    geometryCache: tokenGeometryCache,
  })

const applyRenderObjectPosition = (renderObject: PokemonRenderObject): boolean => applyPokemonRenderObjectPosition(renderObject, {
  camera,
  activeTurnId: props.activeTurnId,
  groundLevelY: normalizedGroundLevelY(),
  hoveredPokemonId: hoverController.id(),
  layers: visibleLayers(),
  getShadowSurfaceY,
})

const refreshPokemonStyles = () => {
  syncPokemonRenderObjectSelectionStyles({
    renderObjects,
    pokemons: props.pokemons,
    selectedId: props.selectedId,
    paintRenderObjectStyle: (renderObject, selected) => paintPokemonRenderObjectStyle(renderObject, selected),
  })
  applyLayerVisibility({ force: true })
}

const onCreateRenderObject = (renderObject: PokemonRenderObject) => {
  tokenProxyPickTargets.add(renderObject)
  applyRenderObjectPosition(renderObject)
}

const disposeRenderObject = (renderObject: PokemonRenderObject) => {
  tokenProxyPickTargets.remove(renderObject)
  disposePokemonRenderObject(renderObject)
}

const syncPokemonObjects = () => {
  syncPokemonRenderObjects({
    renderObjects,
    pokemons: props.pokemons,
    createRenderObject: buildRenderObject,
    onCreateRenderObject,
    updateRenderObject: (renderObject, pokemon) => updatePokemonRenderObjectFromSpawn(renderObject, pokemon, {
      geometryCache: tokenGeometryCache,
    }),
    disposeRenderObject,
    clearHoverForToken: hoverController.clearIfHovered,
  })

  refreshPokemonStyles()
}

const syncVoxelMeshes = () => {
  voxelRenderer.sync(renderedTerrainVoxels.value, {
    ghostVoxelsFaded: props.ghostVoxelsFaded,
    terrainRevision: terrainVoxelRevision.value,
  })
  buildHazardPickTargets.setVoxelMeshes(voxelRenderer.meshes())
  applyLayerVisibility({ force: true })
}

const syncFieldEffectMeshes = () => {
  fieldEffectRenderer.sync({
    dimensions: props.dimensions,
    voxels: renderedTerrainVoxels.value,
    groundLevelY: normalizedGroundLevelY(),
    effects: renderedFieldEffects.value,
  })
  applyLayerVisibility({ force: true })
}

const syncHazardMeshes = () => {
  hazardRenderer.sync(renderedHazards.value)
  buildHazardPickTargets.setHazardMeshes(hazardRenderer.meshes())
  applyLayerVisibility({ force: true })
}

const applyLayerVisibility = (options: { force?: boolean } = {}) => {
  if (options.force) {
    layerVisibilityApplicator.invalidate()
  }

  return layerVisibilityApplicator.apply({
    layers: visibleLayers(),
    hasSelectedPokemon: Boolean(selectedPokemon.value),
    buildMode: props.buildMode,
    hazardMode: props.hazardMode,
    gridRenderer,
    voxelRenderer,
    fieldEffectRenderer,
    hazardRenderer,
    renderObjects: renderObjects.values(),
    setTokenLayerVisibility: setPokemonRenderObjectLayerVisibility,
  })
}

const ensureBuildGhost = () => buildGhostRenderer.ensure()
const disposeBuildGhost = () => buildGhostRenderer.dispose()
const hideBuildGhostRenderer = () => buildGhostRenderer.hide()

const ensureHazardGhost = () => hazardGhostRenderer.ensure(props.hazardKind ?? 'spikes')
const disposeHazardGhost = () => hazardGhostRenderer.dispose()
const hideHazardGhostRenderer = () => hazardGhostRenderer.hide()

const pickPokemonId = (event: MouseEvent | PointerEvent) =>
  pickPokemonIdFromPointer({
    event,
    renderer,
    camera,
    raycaster,
    renderObjects: renderObjects.values(),
    tokenProxyTargets: tokenProxyPickTargets,
    boundsCache: rendererBoundsCache,
    scratch: pointerRaycastScratch,
    recordRaycast: recordPointerRaycastForMetricsOverlay,
  })

const moveTargetingCandidateIdSet = () => new Set(props.moveAutomationTargeting?.candidateIds ?? [])

const areaDirectionButtonLabel = (direction: MoveAutomationAreaDirection): string => {
  switch (direction) {
    case 'north': return 'N'
    case 'north-east': return 'NE'
    case 'east': return 'E'
    case 'south-east': return 'SE'
    case 'south': return 'S'
    case 'south-west': return 'SW'
    case 'west': return 'W'
    case 'north-west': return 'NW'
    case 'up': return 'Up'
    case 'down': return 'Down'
  }
}

const worldPointToScreen = (point: THREE.Vector3): { x: number; y: number } | null => {
  if (!camera || !renderer) return null
  const bounds = renderer.domElement.getBoundingClientRect()
  const projected = point.clone().project(camera)
  return {
    x: bounds.left + (projected.x + 1) * bounds.width / 2,
    y: bounds.top + (1 - projected.y) * bounds.height / 2,
  }
}

const worldPointToContainerPoint = (point: THREE.Vector3): { x: number; y: number } | null => {
  const screenPoint = worldPointToScreen(point)
  const bounds = container.value?.getBoundingClientRect()
  if (!screenPoint || !bounds) return null
  return {
    x: screenPoint.x - bounds.left,
    y: screenPoint.y - bounds.top,
  }
}

const moveTargetReticleCenter = (renderObject: PokemonRenderObject): THREE.Vector3 => new THREE.Vector3(
  renderObject.currentCenter.x,
  renderObject.currentCenter.y + Math.max(renderObject.height * 0.58, 0.45),
  renderObject.currentCenter.z,
)

const attackOfOpportunityButtonCenter = (renderObject: PokemonRenderObject): THREE.Vector3 => new THREE.Vector3(
  renderObject.currentCenter.x,
  renderObject.currentCenter.y + Math.max(renderObject.height * 0.92, 0.85),
  renderObject.currentCenter.z,
)

const moveTargetScreenHitRadius = (renderObject: PokemonRenderObject, center: { x: number; y: number }): number => {
  const edge = worldPointToScreen(new THREE.Vector3(
    renderObject.currentCenter.x + Math.max(0.475, renderObject.base * 0.475),
    renderObject.currentCenter.y + Math.max(renderObject.height * 0.58, 0.45),
    renderObject.currentCenter.z,
  ))
  const projectedRadius = edge ? Math.hypot(edge.x - center.x, edge.y - center.y) : 0
  return THREE.MathUtils.clamp(Math.max(36, projectedRadius + 18), 36, 96)
}

const pickMoveTargetId = (event: MouseEvent | PointerEvent): string | null => {
  const candidateIds = moveTargetingCandidateIdSet()
  const hitId = pickPokemonId(event)
  if (hitId && candidateIds.has(hitId)) return hitId

  let best: { id: string; distance: number } | null = null
  for (const id of candidateIds) {
    const renderObject = renderObjects.get(id)
    if (!renderObject) continue
    const center = worldPointToScreen(moveTargetReticleCenter(renderObject))
    if (!center) continue
    const distance = Math.hypot(event.clientX - center.x, event.clientY - center.y)
    if (distance > moveTargetScreenHitRadius(renderObject, center)) continue
    if (!best || distance < best.distance) best = { id, distance }
  }
  return best?.id ?? null
}

const performMoveTargeting = (event: MouseEvent | PointerEvent): boolean => {
  if (props.moveAutomationTargeting?.mode === 'area-confirmation') {
    if (props.moveAutomationTargeting.canToggleTargets) {
      const hitId = pickMoveTargetId(event)
      if (hitId) {
        emit('select-move-target', hitId)
        return true
      }
    }
    updateMoveAreaDirectionFromPointer(event)
    emit('select-move-target', props.moveAutomationTargeting.userId)
    return true
  }

  const hitId = pickMoveTargetId(event)
  if (!hitId) return false
  emit('select-move-target', hitId)
  return true
}

const cancelMoveTargeting = (): boolean => {
  if (!props.moveAutomationTargeting) return false
  emit('cancel-move-targeting')
  return true
}

const updateHoverFromPointer = (event: PointerEvent) => {
  // Match normal link hover behaviour: touch/drag interactions don't leave a
  // sticky hover state behind, while every mouse move immediately re-picks the
  // token under the cursor (or clears the badge when there isn't one).
  if (event.pointerType === 'touch') {
    setHoveredPokemonId(null)
    return
  }

  setHoveredPokemonId(pickPokemonId(event))
}

const getMoveGridIntersection = (event: MouseEvent | PointerEvent, yLevel: number) =>
  getMoveGridIntersectionFromPointer({
    event,
    yLevel,
    renderer,
    camera,
    raycaster,
    boundsCache: rendererBoundsCache,
    scratch: pointerRaycastScratch,
    recordRaycast: recordPointerRaycastForMetricsOverlay,
  })

const moveAreaDirectionFromPointer = (event: MouseEvent | PointerEvent): MoveAutomationAreaDirection | null => {
  const targeting = props.moveAutomationTargeting
  if (targeting?.mode !== 'area-confirmation' || !targeting.areaDirectionOptions?.length) return null

  const user = props.pokemons.find((pokemon) => pokemon.id === targeting.userId)
  if (!user) return null

  const point = getMoveGridIntersection(event, user.position.y)
  if (!point) return null

  const direction = moveAutomationAreaDirectionFromPoint(getPokemonCenter(user), point)
  return direction && targeting.areaDirectionOptions.some((option) => option.direction === direction)
    ? direction
    : null
}

const moveAreaDirectionUpdateThrottle = createMoveAutomationAreaDirectionUpdateThrottle(
  props.moveAutomationTargeting?.areaDirection,
)

const selectMoveAreaDirection = (direction: MoveAutomationAreaDirection) => {
  if (props.moveAutomationTargeting?.mode !== 'area-confirmation') {
    moveAreaDirectionUpdateThrottle.reset()
    return
  }

  if (!moveAreaDirectionUpdateThrottle.shouldEmitDirection(
    direction,
    props.moveAutomationTargeting.areaDirection,
  )) return

  emit('select-move-area-direction', direction)
}

const updateMoveAreaDirectionFromPointer = (event: MouseEvent | PointerEvent) => {
  const direction = moveAreaDirectionFromPointer(event)
  if (!direction) return
  selectMoveAreaDirection(direction)
}

const movementInteraction = createIsometricTokenMovementInteractionController({
  getSelectedPokemon: () => selectedPokemon.value,
  getPokemons: () => props.pokemons,
  getDimensions: () => props.dimensions,
  getMapVoxels: () => renderedTerrainVoxels.value,
  getMapVoxelsRevision: () => terrainVoxelRevision.value,
  getPokemonPlacementRevision: () => pokemonPlacementRevision.value,
  getPreviewLayerY,
  getGroundLevelY: normalizedGroundLevelY,
  getCamera: () => camera,
  getMoveGridIntersection,
  previewRenderer: tokenMovePreviewRenderer,
  emitPreviewChange: emitMovementPreviewChange,
  movePokemon: (payload) => emit('move-pokemon', payload),
  recordPathfindingRequest: recordPathfindingRequestForMetricsOverlay,
  recordPathfindingCacheHit: recordPathfindingCacheHitForMetricsOverlay,
  recordPathfindingCacheMiss: recordPathfindingCacheMissForMetricsOverlay,
})
const ensurePreviewObjects = movementInteraction.ensurePreviewObjects
const clearPreviewVisuals = movementInteraction.clearPreviewVisuals
const updatePreviewFromPointer = movementInteraction.updatePreviewFromPointer

const sendOutInteraction = createIsometricTokenSendOutInteractionController({
  getActiveRequest: () => activeSendOutRequest.value,
  getPokemons: () => props.pokemons,
  getDimensions: () => props.dimensions,
  getMapMovementOccupancy: () => mapMovementOccupancy.value,
  getGroundLevelY: normalizedGroundLevelY,
  getCamera: () => camera,
  getMoveGridIntersection,
  previewRenderer: tokenMovePreviewRenderer,
  emitPreviewChange: (preview) => emit('preview-change', preview),
  sendOutPokemon: (payload) => emit('send-out-pokemon', payload),
  clearActiveRequest: clearSendOutPlacement,
})

const pickBuildTarget = (
  event: MouseEvent | PointerEvent,
  tool: BuildTool,
): BuildTarget | null =>
  pickBuildTargetFromPointer({
    event,
    tool,
    renderer,
    camera,
    raycaster,
    pickTargetCache: buildHazardPickTargets,
    dimensions: props.dimensions,
    pokemons: props.pokemons,
    allVoxelOccupancy: allVoxelOccupancy.value,
    mapMovementOccupancy: mapMovementOccupancy.value,
    boundsCache: rendererBoundsCache,
    scratch: pointerRaycastScratch,
    recordRaycast: recordPointerRaycastForMetricsOverlay,
  })

const buildInteraction = createIsometricBuildInteractionController({
  getState: () => ({
    buildMode: props.buildMode,
    buildTool: props.buildTool,
    buildMaterial: props.buildMaterial,
    buildColor: props.buildColor,
    buildGhostVoxel: props.buildGhostVoxel,
  }),
  pickTarget: pickBuildTarget,
  updateGhost: (target, options) => buildGhostRenderer.update(target, options),
  hideGhost: hideBuildGhostRenderer,
  placeVoxel: (voxel) => emit('place-voxel', voxel),
  removeVoxel: (cell) => emit('remove-voxel', cell),
})
const updateBuildPreviewFromPointer = buildInteraction.updatePreviewFromPointer
const performBuildAction = buildInteraction.performAction
const hideBuildGhost = buildInteraction.hideGhost

const pickHazardTarget = (
  event: MouseEvent | PointerEvent,
  tool: BuildTool,
): HazardTarget | null =>
  pickHazardTargetFromPointer({
    event,
    tool,
    renderer,
    camera,
    raycaster,
    pickTargetCache: buildHazardPickTargets,
    hazards: renderedHazards.value,
    dimensions: props.dimensions,
    groundLevelY: normalizedGroundLevelY(),
    boundsCache: rendererBoundsCache,
    scratch: pointerRaycastScratch,
    recordRaycast: recordPointerRaycastForMetricsOverlay,
  })

const hazardInteraction = createIsometricHazardInteractionController({
  getState: () => ({
    hazardMode: Boolean(props.hazardMode),
    hazardTool: props.hazardTool ?? 'pencil',
    hazardKind: props.hazardKind,
  }),
  pickTarget: pickHazardTarget,
  updateGhost: (target, options) => hazardGhostRenderer.update(target, options),
  hideGhost: hideHazardGhostRenderer,
  placeHazard: (hazard) => emit('place-hazard', hazard),
  removeHazard: (cell) => emit('remove-hazard', cell),
})
const updateHazardPreviewFromPointer = hazardInteraction.updatePreviewFromPointer
const performHazardAction = hazardInteraction.performAction
const hideHazardGhost = hazardInteraction.hideGhost

const requestRenderAfterPointerInteraction = () => requestScheduledSceneFrame('pointer')

const handlePointerMoveFrameForMetricsOverlay = (frame: CoalescedPointerEventFrame) => {
  recordPointerMoveFrameForMetricsOverlay(frame)
  requestRenderAfterPointerInteraction()
}

const pointerInteraction = createIsometricPointerInteractionController({
  pointerTracker,
  getSelectedId: () => props.selectedId,
  getSelectedPokemon: () => selectedPokemon.value,
  getBuildMode: () => props.buildMode,
  getBuildTool: () => props.buildTool,
  getHazardMode: () => props.hazardMode,
  getHazardTool: () => props.hazardTool,
  canControlPokemon,
  pickPokemonId,
  selectPokemon: emitPokemonSelection,
  closeContextMenu,
  openContextMenu,
  updateHoverFromPointer,
  clearHoveredPokemon: () => setHoveredPokemonId(null),
  updateBuildPreviewFromPointer,
  updateHazardPreviewFromPointer,
  updateMovePreviewFromPointer: updatePreviewFromPointer,
  performSelectedMove: movementInteraction.performSelectedMove,
  stepPreviewElevation: movementInteraction.stepPreviewElevation,
  getPlacementModeActive: () => Boolean(activeSendOutRequest.value),
  updatePlacementPreviewFromPointer: sendOutInteraction.updatePreviewFromPointer,
  performPlacement: sendOutInteraction.performSendOut,
  stepPlacementElevation: sendOutInteraction.stepPreviewElevation,
  cancelPlacement: sendOutInteraction.cancel,
  getTargetingModeActive: () => Boolean(props.moveAutomationTargeting),
  updateTargetingFromPointer: updateMoveAreaDirectionFromPointer,
  performTargeting: performMoveTargeting,
  cancelTargeting: cancelMoveTargeting,
  performBuildAction,
  performHazardAction,
  hideBuildGhost,
  hideHazardGhost,
  closeTopmostOverlay,
  onPointerMoveFrame: handlePointerMoveFrameForMetricsOverlay,
})
const replayBuildPreview = () => buildInteraction.replayPreview(pointerInteraction.lastPointerCoords())
const replayHazardPreview = () => hazardInteraction.replayPreview(pointerInteraction.lastPointerCoords())

const {
  handleRightClick: handleRightClickRaw,
  handlePointerDown: handlePointerDownRaw,
  handlePointerMove: handlePointerMoveRaw,
  handleWheel: handleWheelRaw,
  handlePointerUp: handlePointerUpRaw,
  handlePointerLeave: handlePointerLeaveRaw,
  handleEscape: handleEscapeRaw,
  dispose: disposePointerInteraction,
} = pointerInteraction

const handleRightClick = (event: MouseEvent) => {
  rendererBoundsCache.invalidate()
  handleRightClickRaw(event)
  requestRenderAfterPointerInteraction()
}
const handlePointerDown = (event: PointerEvent) => {
  rendererBoundsCache.invalidate()
  handlePointerDownRaw(event)
  requestRenderAfterPointerInteraction()
}
const handlePointerMove = (event: PointerEvent) => {
  recordPointerMoveEventForMetricsOverlay()
  handlePointerMoveRaw(event)
  requestRenderAfterPointerInteraction()
}
const handleWheel = (event: WheelEvent) => {
  handleWheelRaw(event)
  requestRenderAfterPointerInteraction()
}
const handlePointerUp = (event: PointerEvent) => {
  handlePointerUpRaw(event)
  requestRenderAfterPointerInteraction()
}
const handlePointerLeave = () => {
  handlePointerLeaveRaw()
  requestRenderAfterPointerInteraction()
}
const handleEscape = (event: KeyboardEvent) => {
  handleEscapeRaw(event)
  if (event.key === 'Escape') requestRenderAfterPointerInteraction()
}

useWindowKeydown(handleEscape)

watch(activeSendOutRequest, (request) => {
  if (controls) controls.enableZoom = !request && !selectedPokemon.value

  if (!request) {
    sendOutInteraction.clearPreviewVisuals()
    if (sendOutPlacement.value) clearSendOutPlacement()
    requestScheduledSceneFrame('movement-preview')
    return
  }

  sendOutInteraction.resetForRequestChange()
  requestScheduledSceneFrame('movement-preview')
})

watch([terrainVoxelRevision, () => props.dimensions], () => {
  if (!activeSendOutRequest.value) return
  sendOutInteraction.refreshAfterStateChange()
  requestScheduledSceneFrame('movement-preview')
})

watch([() => props.buildMode, () => props.hazardMode], ([buildActive, hazardActive]) => {
  if (!activeSendOutRequest.value || (!buildActive && !hazardActive)) return
  sendOutInteraction.cancel()
})

watch(() => props.moveAutomationTargeting, (targeting) => {
  moveAreaDirectionUpdateThrottle.syncCurrentDirection(targeting?.areaDirection)
  if (!targeting) return

  closeContextMenu()
  sendOutInteraction.cancel()
  clearPreviewVisuals()
  requestScheduledSceneFrame('movement-preview')
})

watch(
  () => props.moveAutomationTargeting,
  () => {
    if (!renderer) return
    requestScheduledSceneFrame('targeting')
  },
  { deep: true },
)

watch(
  () => props.moveAutomationFeedback,
  () => {
    if (!renderer) return
    requestScheduledSceneFrame('targeting')
  },
  { deep: true },
)

watch(
  () => props.attackOfOpportunityPrompts,
  () => {
    if (!renderer) return
    requestScheduledSceneFrame('targeting')
  },
  { deep: true },
)

const sameMoveTargetHitChance = (
  a: MoveAutomationTargetHitChance | undefined,
  b: MoveAutomationTargetHitChance | undefined,
): boolean => {
  if (!a || !b) return a === b
  return a.percent === b.percent
    && a.label === b.label
    && a.tone === b.tone
    && a.title === b.title
}

const areaSelectedTargetIdSet = (
  targeting: MoveAutomationTargetingOverlayState | null | undefined,
): Set<string> | null => {
  if (targeting?.mode !== 'area-confirmation') return null
  return new Set(targeting.affectedIds ?? targeting.candidateIds)
}

const syncTargetReticleButtons = (options: {
  show: boolean
  showsReticle: boolean
  selectedIds?: ReadonlySet<string> | null
}): boolean => {
  if (!options.show) {
    if (targetReticleButtons.value.length) {
      targetReticleButtons.value = []
      return true
    }
    return false
  }

  const targeting = props.moveAutomationTargeting
  const next = (targeting?.candidateIds ?? []).flatMap((id): TargetReticleButton[] => {
    const renderObject = renderObjects.get(id)
    const point = renderObject ? worldPointToContainerPoint(moveTargetReticleCenter(renderObject)) : null
    return point ? [{
      id,
      left: point.x,
      top: point.y,
      selected: options.selectedIds ? options.selectedIds.has(id) : true,
      showsReticle: options.showsReticle,
      hitChance: targeting?.hitChances?.[id],
    }] : []
  })
  const current = targetReticleButtons.value
  const unchanged = next.length === current.length && next.every((entry, index) => {
    const old = current[index]
    return old?.id === entry.id
      && Math.abs(old.left - entry.left) < 0.5
      && Math.abs(old.top - entry.top) < 0.5
      && old?.selected === entry.selected
      && old?.showsReticle === entry.showsReticle
      && sameMoveTargetHitChance(old?.hitChance, entry.hitChance)
  })
  if (!unchanged) {
    targetReticleButtons.value = next
    return true
  }
  return false
}

const syncAttackOfOpportunityButtons = (): boolean => {
  const layers = visibleLayers()
  const prompts = props.attackOfOpportunityPrompts ?? []
  if (!layers.tokens || !prompts.length) {
    let changed = false
    if (attackOfOpportunityButtons.value.length) {
      attackOfOpportunityButtons.value = []
      changed = true
    }
    if (openAttackOfOpportunityMenuId.value) {
      openAttackOfOpportunityMenuId.value = null
      changed = true
    }
    return changed
  }

  const next = prompts.flatMap((prompt): AttackOfOpportunityButton[] => {
    const renderObject = renderObjects.get(prompt.attackerId)
    const point = renderObject ? worldPointToContainerPoint(attackOfOpportunityButtonCenter(renderObject)) : null
    return point ? [{ ...prompt, left: point.x, top: point.y }] : []
  })
  const current = attackOfOpportunityButtons.value
  const unchanged = next.length === current.length && next.every((entry, index) => {
    const old = current[index]
    return old?.id === entry.id
      && Math.abs(old.left - entry.left) < 0.5
      && Math.abs(old.top - entry.top) < 0.5
      && old.struggleOptions.length === entry.struggleOptions.length
      && old.struggleOptions.every((move, moveIndex) => move.name === entry.struggleOptions[moveIndex]?.name)
  })
  let changed = false
  if (!unchanged) {
    attackOfOpportunityButtons.value = next
    changed = true
  }

  if (openAttackOfOpportunityMenuId.value && !next.some((button) => button.id === openAttackOfOpportunityMenuId.value)) {
    openAttackOfOpportunityMenuId.value = null
    changed = true
  }
  return changed
}

const useAttackOfOpportunityMove = (promptId: string, moveName: string) => {
  openAttackOfOpportunityMenuId.value = null
  emit('use-attack-of-opportunity', { promptId, moveName })
}

const toggleAttackOfOpportunityButton = (button: AttackOfOpportunityButton) => {
  if (button.struggleOptions.length <= 1) {
    const moveName = button.struggleOptions[0]?.name
    if (moveName) useAttackOfOpportunityMove(button.id, moveName)
    return
  }
  openAttackOfOpportunityMenuId.value = openAttackOfOpportunityMenuId.value === button.id ? null : button.id
}

const attackOfOpportunityTitle = (button: AttackOfOpportunityButton): string =>
  `${button.attackerName} may make an Attack of Opportunity against ${button.provokerName}.`

const attackOfOpportunityReasonLabel = (button: AttackOfOpportunityButton): string =>
  button.reason === 'movement' ? 'Provoked by movement' : 'Provoked by a ranged attack'

const targetReticleButtonTitle = (button: TargetReticleButton): string => {
  if (!button.showsReticle) return button.selected ? 'Exclude this target from the move' : 'Include this target in the move'
  return button.hitChance?.title ?? 'Select move target'
}

const targetReticleButtonLabel = (button: TargetReticleButton): string => {
  if (!button.showsReticle) return button.selected ? 'Exclude move target' : 'Include move target'
  return button.hitChance ? `Select target (${button.hitChance.label})` : 'Select move target'
}

const updateMoveAutomationOverlays = (): boolean => {
  const layers = visibleLayers()
  const targeting = props.moveAutomationTargeting
  const showClickableTargetReticles = Boolean(targeting?.mode === 'target' && layers.tokens)
  const canToggleAreaTargets = Boolean(targeting?.mode === 'area-confirmation' && targeting.canToggleTargets)
  const showAreaToggleButtons = Boolean(canToggleAreaTargets && layers.tokens)
  const showAreaTemplate = Boolean(targeting?.mode === 'area-confirmation')
  const areaReticleIds = targeting?.mode === 'area-confirmation' ? targeting.candidateIds : []
  const areaSelectedIds = areaSelectedTargetIdSet(targeting)
  const showAreaTargetReticles = Boolean(showAreaTemplate && layers.tokens && areaReticleIds.length)
  let cssUiChanged = syncTargetReticleButtons({
    show: showClickableTargetReticles || showAreaToggleButtons,
    showsReticle: showClickableTargetReticles,
    selectedIds: showAreaToggleButtons ? areaSelectedIds : null,
  })
  moveAreaTemplateRenderer.update({
    cells: targeting?.areaCells ?? [],
    show: showAreaTemplate,
  })
  cssUiChanged = moveTargetingReticleRenderer.update({
    candidateIds: areaReticleIds,
    selectedIds: areaSelectedIds ? Array.from(areaSelectedIds) : undefined,
    hitChances: targeting?.hitChances,
    renderObjects,
    show: showAreaTargetReticles,
  }) || cssUiChanged
  cssUiChanged = moveAutomationFeedbackRenderer.update({
    feedback: props.moveAutomationFeedback,
    renderObjects,
    show: layers.tokens,
  }) || cssUiChanged
  cssUiChanged = syncAttackOfOpportunityButtons() || cssUiChanged
  return cssUiChanged
}

// Continue scheduling only while concrete scene work is still active. A
// settled scene now relies on explicit dirty requests instead of a
// compatibility RAF source.
function resolveSceneAnimationContinuation() {
  return createIsometricAnimationContinuation([
    ...resolveIsometricTokenMotionContinuationSources(renderObjects.values()),
    ...resolveIsometricSpriteAnimationContinuationSources(renderObjects.values()),
    ...resolveIsometricMovementPreviewAnimationContinuationSources(tokenMovePreviewRenderer),
    ...resolveIsometricFieldEffectAnimationContinuationSources(fieldEffectRenderer),
  ])
}

function requestScheduledSceneFrame(reason: IsometricRenderSchedulerReasonInput) {
  renderScheduler?.requestRender(reason)
  renderScheduler?.setActiveAnimation(resolveSceneAnimationContinuation().active)
}

function requestTokenTextureRender() {
  requestScheduledSceneFrame('token-texture')
}

const documentIsHidden = (): boolean => typeof document !== 'undefined' && document.hidden

const pauseScheduledRenderLoopForHiddenTab = () => {
  renderScheduler?.pause()
}

const resumeScheduledRenderLoopFromHiddenTab = () => {
  renderScheduler?.resume()
  requestScheduledSceneFrame('hidden-tab-resume')
}

const renderOneShotScheduledFrame = (frame: IsometricScheduledRenderFrame): boolean => {
  if (!renderer || !cssRenderer || !camera || !controls) {
    return false
  }

  const animationContinuation = resolveSceneAnimationContinuation()
  css3DRenderDirtyTracker.markDirtyForRenderLayers(frame.dirtyLayers, frame.reasons)
  css3DRenderDirtyTracker.markDirtyForAnimationContinuation(animationContinuation)

  stepIsometricAnimationFrame({
    clock,
    renderObjects: renderObjects.values(),
    applyRenderObjectPosition,
    controls,
    fieldEffectRenderer,
    tokenMovePreviewRenderer,
    selectedPokemon: sendOutInteraction.activePokemon() ?? selectedPokemon.value,
    previewPositionY: activeSendOutRequest.value ? sendOutInteraction.previewPositionY() : movementInteraction.previewPositionY(),
    camera,
    renderer,
    cssRenderer,
    scene,
    facingDirection: DEFAULT_FACING_DIRECTION,
    beforeRender: updateMoveAutomationOverlays,
    css3DRenderDirtyTracker,
  })
  recordScheduledFrameForMetricsOverlay(frame)
  sampleRendererInfoForMetricsOverlay()

  return true
}

const renderScheduledFrame = (frame: IsometricScheduledRenderFrame) => {
  renderOneShotScheduledFrame(frame)

  return toIsometricRenderSchedulerFrameResult(resolveSceneAnimationContinuation())
}

const startScheduledRenderLoop = () => {
  renderScheduler?.dispose()
  renderScheduler = createIsometricRenderScheduler({
    renderFrame: renderScheduledFrame,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  })
  if (documentIsHidden()) {
    renderScheduler.pause()
  }
  css3DRenderDirtyTracker.markDirty('initial')
  renderScheduler.requestRender('initial')
  renderScheduler.setActiveAnimation(resolveSceneAnimationContinuation().active)
}

const stopScheduledRenderLoop = () => {
  renderScheduler?.dispose()
  renderScheduler = null
}

onMounted(() => {
  if (!container.value) {
    return
  }

  camera = createIsometricCamera()
  renderer = createIsometricWebGLRenderer()
  cssRenderer = createIsometricCssRenderer()
  controls = createIsometricOrbitControls(
    camera,
    renderer.domElement,
    maxUsefulCameraZoom(camera, props.dimensions),
  )
  controls.enableZoom = !selectedPokemon.value
  cleanupCameraControlChangeInvalidation = bindIsometricCameraControlChangeInvalidation({
    camera,
    controls,
    requestRender: (reason) => renderScheduler?.requestRender(reason),
  })

  container.value.append(renderer.domElement, cssRenderer.domElement)
  syncRendererSize()
  buildGrid()
  syncPokemonObjects()
  syncVoxelMeshes()
  syncFieldEffectMeshes()
  syncHazardMeshes()
  ensurePreviewObjects()
  if (props.buildMode) ensureBuildGhost()
  if (props.hazardMode) ensureHazardGhost()
  alignCameraToGrid(true)
  refreshPokemonStyles()

  cleanupRendererDomEvents = bindIsometricRendererDomEvents(renderer.domElement, {
    pointerdown: handlePointerDown,
    pointermove: handlePointerMove,
    pointerup: handlePointerUp,
    pointerleave: handlePointerLeave,
    contextmenu: handleRightClick,
    wheel: handleWheel,
  })
  cleanupResizeObserver = observeIsometricResize(container.value, syncRendererSizeFromResizeObserver)

  startScheduledRenderLoop()
  cleanupDocumentVisibilityChange = bindIsometricDocumentVisibilityChange(document, {
    pause: pauseScheduledRenderLoopForHiddenTab,
    resume: resumeScheduledRenderLoopFromHiddenTab,
  })
})

onBeforeUnmount(() => {
  stopScheduledRenderLoop()
  disposePointerInteraction()

  cleanupDocumentVisibilityChange?.()
  cleanupDocumentVisibilityChange = null

  cleanupRendererDomEvents?.()
  cleanupRendererDomEvents = null

  cleanupResizeObserver?.()
  cleanupResizeObserver = null

  cleanupCameraControlChangeInvalidation?.()
  cleanupCameraControlChangeInvalidation = null

  moveTargetingReticleRenderer.dispose()
  moveAreaTemplateRenderer.dispose()
  moveAutomationFeedbackRenderer.dispose()

  disposeIsometricRendererResources({
    clearPreviewVisuals,
    tokenMovePreviewRenderer,
    disposeBuildGhost,
    disposeHazardGhost,
    hazardRenderer,
    fieldEffectRenderer,
    voxelRenderer,
    renderObjects,
    disposeRenderObject,
    gridRenderer,
    controls,
    renderer,
    cssRenderer,
  })
  controls = null
  renderer = null
  cssRenderer = null
  camera = null
  rendererSizeState = null
  rendererBoundsCache.invalidate()
  tokenProxyPickTargets.clear()
  buildHazardPickTargets.clear()
  tokenGeometryCache.dispose()
})

useIsometricSceneWatchers({
  sources: {
    pokemons: () => props.pokemons,
    terrainVoxelRevision,
    hazardRevision,
    fieldEffectsRevision,
    selectedId: () => props.selectedId,
    selectedPokemon: () => selectedPokemon.value,
    controllableIdsKey: () => props.controllableIds?.join('|') ?? '',
    canControlPokemon,
    layerVisibility: () => props.layerVisibility,
    buildMode: () => props.buildMode,
    hazardMode: () => props.hazardMode,
    buildSettings: () => [props.buildTool, props.buildMaterial, props.buildColor, props.buildGhostVoxel] as const,
    ghostVoxelsFaded: () => props.ghostVoxelsFaded,
    hazardSettings: () => [props.hazardTool, props.hazardKind] as const,
    groundLevelY: () => props.groundLevelY,
    dimensionsKey: () => [props.dimensions.x, props.dimensions.y, props.dimensions.z] as const,
    activeTurnId: () => props.activeTurnId,
    isRendererReady: () => Boolean(renderer),
  },
  actions: {
    syncPokemonObjects,
    refreshMovementAfterStateChange: movementInteraction.refreshAfterStateChange,
    syncDialogsFromPokemons,
    replayBuildPreview,
    syncVoxelMeshes,
    replayHazardPreview,
    syncHazardMeshes,
    syncFieldEffectMeshes,
    selectPokemon: emitPokemonSelection,
    refreshPokemonStyles,
    updateGridVisibility,
    setControlsZoomEnabled: (enabled) => {
      if (controls) controls.enableZoom = enabled && !activeSendOutRequest.value
    },
    clearPreviewVisuals,
    closeContextMenu,
    disposePreviewOwner: movementInteraction.disposeOwner,
    resetMovementForSelectionChange: movementInteraction.resetForSelectionChange,
    closeUnauthorizedActions,
    applyLayerVisibility,
    hideBuildGhost,
    ensureBuildGhost,
    hideHazardGhost,
    ensureHazardGhost,
    buildGrid,
    alignCameraToGrid,
    syncRendererSize,
    requestRender: requestScheduledSceneFrame,
  },
})
</script>

<template>
  <div ref="container" class="scene-root">
    <div
      v-if="movementPreviewHud"
      class="movement-preview-hud"
      :class="{ 'is-unreachable': !movementPreviewHud.reachable }"
      aria-live="polite"
    >
      <strong>Movement</strong>
      <span>
        {{ movementPreviewHud.distance }}m
        <template v-if="movementPreviewHud.limit != null">
          / {{ movementPreviewHud.limit }}m
        </template>
        · {{ movementPreviewHud.capabilityLabel }}
      </span>
      <small v-if="movementPreviewHud.failureReason">
        {{ movementPreviewHud.failureReason }}
      </small>
    </div>

    <div v-if="props.moveAutomationTargeting" class="move-targeting-hud" @contextmenu.prevent>
      <div class="move-targeting-hud__copy">
        <strong>{{ props.moveAutomationTargeting.moveName }}</strong>
        <template v-if="props.moveAutomationTargeting.mode === 'area-confirmation'">
          <span>
            Confirm {{ props.moveAutomationTargeting.rangeLabel }}:
            <template v-if="props.moveAutomationTargeting.canToggleTargets">
              {{ props.moveAutomationTargeting.affectedIds?.length ?? 0 }} of {{ props.moveAutomationTargeting.candidateIds.length }} selected. Click reticles to include/exclude targets; click the battlefield to use the move.
            </template>
            <template v-else>
              {{ props.moveAutomationTargeting.affectedIds?.length ?? 0 }} affected.
              <template v-if="props.moveAutomationTargeting.areaDirectionOptions?.length">
                Move the cursor around the user to rotate, or use a direction button; click to use the move.
              </template>
              <template v-else>
                Click the battlefield to use the move.
              </template>
            </template>
          </span>
        </template>
        <template v-else>
          <span v-if="props.moveAutomationTargeting.candidateIds.length">
            {{ props.moveAutomationTargeting.targetPrompt ?? `Choose a target within ${props.moveAutomationTargeting.rangeLabel}.` }}
          </span>
          <span v-else>
            No targets in range {{ props.moveAutomationTargeting.rangeLabel }}.
          </span>
        </template>
      </div>
      <div
        v-if="props.moveAutomationTargeting.mode === 'area-confirmation' && props.moveAutomationTargeting.areaDirectionOptions?.length"
        class="move-targeting-hud__directions"
        aria-label="Area direction"
      >
        <button
          v-for="option in props.moveAutomationTargeting.areaDirectionOptions"
          :key="option.direction"
          class="move-targeting-hud__direction"
          :class="{ 'is-active': option.direction === props.moveAutomationTargeting.areaDirection }"
          type="button"
          :title="option.label"
          @pointerdown.stop
          @click.stop="selectMoveAreaDirection(option.direction)"
        >
          {{ areaDirectionButtonLabel(option.direction) }}
        </button>
      </div>
      <button
        class="move-targeting-hud__cancel"
        type="button"
        @pointerdown.stop
        @click.stop="emit('cancel-move-targeting')"
      >
        Cancel
      </button>
    </div>

    <RenderMetricsOverlay
      v-if="renderMetricsOverlayEnabled"
      enabled
      :metrics="renderMetricsOverlaySnapshot"
    />

    <div v-if="targetReticleButtons.length" class="move-targeting-click-layer" @contextmenu.prevent>
      <button
        v-for="button in targetReticleButtons"
        :key="button.id"
        class="move-target-reticle-button"
        :class="{ 'is-area-toggle': !button.showsReticle, 'is-unselected': !button.selected }"
        type="button"
        :style="{ left: `${button.left}px`, top: `${button.top}px` }"
        :aria-label="targetReticleButtonLabel(button)"
        :title="targetReticleButtonTitle(button)"
        @pointerdown.stop
        @click.stop="emit('select-move-target', button.id)"
      >
        <span
          v-if="button.showsReticle && button.hitChance"
          class="move-target-hit-chance"
          :class="[`is-${button.hitChance.tone}`, { 'is-unselected': !button.selected }]"
          :title="button.hitChance.title"
        >
          {{ button.hitChance.label }}
        </span>
        <span
          v-if="button.showsReticle"
          class="move-target-reticle"
          :class="[button.hitChance ? `is-${button.hitChance.tone}` : '', { 'is-unselected': !button.selected }]"
          aria-hidden="true"
        />
      </button>
    </div>

    <div v-if="attackOfOpportunityButtons.length" class="attack-of-opportunity-layer" @contextmenu.prevent>
      <div
        v-for="button in attackOfOpportunityButtons"
        :key="button.id"
        class="attack-of-opportunity-anchor"
        :style="{ left: `${button.left}px`, top: `${button.top}px` }"
      >
        <button
          class="attack-of-opportunity-button"
          type="button"
          :title="attackOfOpportunityTitle(button)"
          @pointerdown.stop
          @click.stop="toggleAttackOfOpportunityButton(button)"
        >
          AoO!
        </button>
        <div
          v-if="openAttackOfOpportunityMenuId === button.id && button.struggleOptions.length > 1"
          class="attack-of-opportunity-menu"
          role="menu"
          :aria-label="`Choose ${button.attackerName}'s Struggle attack`"
          @pointerdown.stop
          @click.stop
        >
          <div class="attack-of-opportunity-menu__heading">
            <strong>{{ button.provokerName }}</strong>
            <span>{{ attackOfOpportunityReasonLabel(button) }}</span>
          </div>
          <button
            v-for="move in button.struggleOptions"
            :key="move.name"
            class="attack-of-opportunity-menu__item"
            type="button"
            role="menuitem"
            @click="useAttackOfOpportunityMove(button.id, move.name)"
          >
            <span>{{ move.name }}</span>
            <small>
              <template v-if="move.type">{{ move.type }}</template>
              <template v-if="move.damageClass"> · {{ move.damageClass }}</template>
              <template v-if="move.damageBase != null"> · DB {{ move.damageBase }}</template>
            </small>
          </button>
        </div>
      </div>
    </div>

    <TokenContextMenu
      v-if="contextMenu"
      :menu="contextMenu"
      :can-delete-tokens="props.canDeleteTokens"
      :moves="props.tokenMoveOptionsById?.[contextMenu.id] ?? []"
      :maneuvers="props.tokenManeuverOptionsById?.[contextMenu.id] ?? []"
      :abilities="props.tokenAbilityOptionsById?.[contextMenu.id] ?? []"
      :orders="props.tokenOrderOptionsById?.[contextMenu.id] ?? []"
      :send-out-options="sendOutOptionsForToken(contextMenu.id)"
      :pokeballs="props.tokenPokeballOptionsById?.[contextMenu.id] ?? []"
      @view-sheet="handleContextViewSheet"
      @view-pokedex="handleContextViewPokedex"
      @turn="handleContextTurn"
      @modify-hp="handleContextModifyHp"
      @modify-combat-stages="handleContextModifyCombatStages"
      @apply-remove-conditions="handleContextApplyRemoveConditions"
      @use-move="handleContextUseMove"
      @use-maneuver="handleContextUseManeuver"
      @use-ability="handleContextUseAbility"
      @use-order="handleContextUseOrder"
      @send-out-pokemon="handleContextSendOutPokemon"
      @throw-pokeball="handleContextThrowPokeball"
      @deal-damage="handleContextDealDamage"
      @delete="handleContextDelete"
    />

    <TokenActionDialogs
      ref="actionDialogs"
      :hp-dialog="hpDialog"
      :hp-dialog-delta="hpDialogDelta"
      :hp-dialog-preview="hpDialogPreview"
      :hp-dialog-preview-max-hp="hpDialogPreviewMaxHp"
      :hp-dialog-injury-result="hpDialogInjuryResult"
      :combat-stages-dialog="combatStagesDialog"
      :combat-stages-dialog-changed="combatStagesDialogChanged"
      :conditions-dialog="conditionsDialog"
      :conditions-dialog-changed="conditionsDialogChanged"
      :condition-move-options="conditionMoveOptions"
      :condition-crush-options="conditionCrushOptions"
      :damage-dialog="damageDialog"
      :damage-dialog-db-def="damageDialogDbDef"
      :damage-dialog-raw-amount="damageDialogRawAmount"
      :damage-dialog-defense="damageDialogDefense"
      :damage-dialog-attacker-options="damageDialogAttackerOptions"
      :damage-dialog-attack-bonus="damageDialogAttackBonus"
      :damage-dialog-multiplier="damageDialogMultiplier"
      :damage-dialog-hp-loss="damageDialogHpLoss"
      :damage-dialog-preview="damageDialogPreview"
      :damage-dialog-preview-max-hp="damageDialogPreviewMaxHp"
      :damage-dialog-injury-result="damageDialogInjuryResult"
      :damage-dialog-multiplier-tone="damageDialogMultiplierTone"
      :damage-dialog-multiplier-label="damageDialogMultiplierLabel"
      @close-hp="closeHpDialog"
      @submit-hp="handleHpDialogSubmit"
      @close-combat-stages="closeCombatStagesDialog"
      @submit-combat-stages="handleCombatStagesDialogSubmit"
      @close-conditions="closeConditionsDialog"
      @submit-conditions="handleConditionsDialogSubmit"
      @close-damage="closeDamageDialog"
      @submit-damage="handleDamageDialogSubmit"
    />

  </div>
</template>

<style scoped>
.scene-root {
  position: relative;
  width: 100%;
  min-height: 100vh;
  overflow: hidden;
  background: var(--paper);
}

.movement-preview-hud {
  position: absolute;
  z-index: 10;
  top: var(--map-top-info-top, calc(var(--map-overlay-gutter, 0.75rem) + var(--map-initiative-info-bar-height, 4rem) + 0.6rem));
  left: 50%;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  max-width: min(96vw, 620px);
  padding: 0.58rem 0.78rem;
  border: 1px solid color-mix(in srgb, var(--good) 62%, var(--rule-strong));
  border-radius: 999px;
  background: color-mix(in srgb, var(--paper) 91%, transparent);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.32);
  color: var(--ink);
  font-size: 0.82rem;
  font-weight: 850;
  transform: translateX(-50%);
  pointer-events: none;
}

.movement-preview-hud strong {
  color: var(--good);
}

.movement-preview-hud small {
  color: var(--muted);
  font-size: 0.76rem;
  font-weight: 800;
}

.movement-preview-hud.is-unreachable {
  border-color: color-mix(in srgb, var(--bad) 70%, var(--rule-strong));
}

.movement-preview-hud.is-unreachable strong,
.movement-preview-hud.is-unreachable small {
  color: var(--bad);
}

.move-targeting-hud {
  position: absolute;
  z-index: 10;
  top: var(--map-top-info-top, calc(var(--map-overlay-gutter, 0.75rem) + var(--map-initiative-info-bar-height, 4rem) + 0.6rem));
  left: 50%;
  display: flex;
  align-items: center;
  gap: 0.85rem;
  max-width: min(96vw, 760px);
  padding: 0.72rem 0.86rem;
  border: 1px solid color-mix(in srgb, var(--accent) 62%, var(--rule-strong));
  border-radius: 999px;
  background: color-mix(in srgb, var(--paper) 91%, transparent);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.35);
  color: var(--ink);
  transform: translateX(-50%);
  pointer-events: none;
}

.move-targeting-hud__copy {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  min-width: 0;
  font-size: 0.8rem;
  line-height: 1.15;
}

.move-targeting-hud__copy strong {
  color: var(--accent);
  font-size: 0.92rem;
}

.move-targeting-hud__directions {
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.25rem;
  max-width: 18rem;
  pointer-events: auto;
}

.move-targeting-hud__direction,
.move-targeting-hud__cancel {
  flex: 0 0 auto;
  border: 1px solid var(--rule-strong);
  border-radius: 999px;
  background: var(--paper-accent);
  color: var(--ink);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  pointer-events: auto;
}

.move-targeting-hud__direction {
  min-width: 2.3rem;
  padding: 0.28rem 0.42rem;
  font-size: 0.74rem;
}

.move-targeting-hud__cancel {
  padding: 0.35rem 0.65rem;
}

.move-targeting-hud__direction:hover,
.move-targeting-hud__direction:focus-visible,
.move-targeting-hud__direction.is-active,
.move-targeting-hud__cancel:hover,
.move-targeting-hud__cancel:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
}

.move-targeting-hud__direction.is-active {
  background: color-mix(in srgb, var(--accent) 14%, var(--paper-accent));
}

.move-targeting-click-layer,
.attack-of-opportunity-layer {
  position: absolute;
  z-index: 9;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.attack-of-opportunity-layer {
  z-index: 11;
}

.attack-of-opportunity-anchor {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.32rem;
  transform: translateX(-50%);
  pointer-events: none;
}

.attack-of-opportunity-button {
  border: 1px solid color-mix(in srgb, var(--bad) 76%, white 18%);
  border-radius: 999px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--bad) 88%, white 12%), var(--bad));
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.32), 0 0 0 2px rgba(255, 255, 255, 0.28);
  color: var(--ink-bright);
  font: inherit;
  font-size: 0.75rem;
  font-weight: 950;
  letter-spacing: 0.04em;
  padding: 0.34rem 0.52rem;
  cursor: pointer;
  pointer-events: auto;
  text-transform: uppercase;
  transform: translateY(-100%);
}

.attack-of-opportunity-button:hover,
.attack-of-opportunity-button:focus-visible {
  filter: brightness(1.08);
  transform: translateY(calc(-100% - 1px));
}

.attack-of-opportunity-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.attack-of-opportunity-menu {
  min-width: 14rem;
  max-width: 18rem;
  padding: 0.45rem;
  border: 1px solid var(--rule-strong);
  border-radius: 0.85rem;
  background: color-mix(in srgb, var(--paper) 96%, transparent);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.38);
  color: var(--ink);
  pointer-events: auto;
}

.attack-of-opportunity-menu__heading {
  display: flex;
  flex-direction: column;
  gap: 0.08rem;
  padding: 0.2rem 0.35rem 0.4rem;
  border-bottom: 1px solid var(--rule);
  font-size: 0.74rem;
}

.attack-of-opportunity-menu__heading strong {
  color: var(--bad);
  font-size: 0.82rem;
}

.attack-of-opportunity-menu__item {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 0.08rem;
  margin-top: 0.25rem;
  padding: 0.42rem 0.5rem;
  border: 1px solid transparent;
  border-radius: 0.65rem;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.attack-of-opportunity-menu__item:hover,
.attack-of-opportunity-menu__item:focus-visible {
  border-color: color-mix(in srgb, var(--bad) 55%, var(--rule-strong));
  background: color-mix(in srgb, var(--bad) 11%, transparent);
}

.attack-of-opportunity-menu__item span {
  font-weight: 850;
}

.attack-of-opportunity-menu__item small {
  color: var(--muted);
  font-size: 0.7rem;
}

.move-target-reticle-button {
  position: absolute;
  width: 72px;
  height: 72px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: crosshair;
  transform: translate(-50%, -50%);
  pointer-events: auto;
}

.move-target-reticle-button.is-area-toggle {
  cursor: pointer;
}

.move-target-reticle-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 8px;
}

</style>
