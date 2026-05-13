<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
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
import type { CombatStageMap } from '~/types/combatStages'
import type { BuildTool } from '#shared/mapEditor'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'
import {
  DEFAULT_FACING_DIRECTION,
  alignCameraToGrid as alignIsometricCameraToGrid,
  createIsometricCamera,
  createIsometricCssRenderer,
  createIsometricOrbitControls,
  createIsometricWebGLRenderer,
  focusCameraOnPokemon,
  maxUsefulCameraZoom,
  syncIsometricRendererSize,
} from '~/utils/isometric/cameraControls'
import { createPointerTravelTracker } from '~/utils/isometric/pointerTracker'
import { createIsometricPointerInteractionController } from '~/utils/isometric/pointerInteraction'
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
  getMoveGridIntersectionFromPointer,
  pickBuildTargetFromPointer,
  pickHazardTargetFromPointer,
  pickPokemonIdFromPointer,
} from '~/utils/isometric/interactionTargets'
import { createBuildGhostRenderer, createHazardGhostRenderer } from '~/utils/isometric/previewGhosts'
import { createTokenMovePreviewRenderer } from '~/utils/isometric/tokenMovePreview'
import {
  clampIsometricGroundLevelY,
  getFieldEffectsRevisionKey,
  getHazardsRevisionKey,
  getTerrainVoxelsRevisionKey,
  resolveIsometricLayerVisibility,
} from '~/utils/isometric/sceneState'
import { createIsometricTokenMovementInteractionController } from '~/utils/isometric/tokenMovementInteraction'
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
  bindIsometricRendererDomEvents,
  disposeIsometricRendererResources,
  observeIsometricResize,
} from '~/utils/isometric/lifecycle'
import { createIsometricSceneGraph } from '~/utils/isometric/sceneGraph'
import { stepIsometricAnimationFrame } from '~/utils/isometric/animationFrame'
import {
  applyIsometricLayerVisibility,
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
}>()

const emit = defineEmits<{
  (event: 'select-pokemon', id: string | null): void
  (event: 'move-pokemon', payload: { id: string; position: GridAnchor }): void
  (event: 'turn-pokemon', id: string): void
  (event: 'delete-pokemon', id: string): void
  (event: 'modify-hp', payload: { id: string; currentHp: number }): void
  (event: 'modify-combat-stages', payload: { id: string; stages: CombatStageMap }): void
  (event: 'modify-conditions', payload: { id: string; conditions: string[] }): void
  (event: 'use-move', payload: { id: string; moveName?: string | null }): void
  (event: 'view-sheet', id: string): void
  (event: 'view-pokedex', id: string): void
  (event: 'preview-change', preview: PreviewState): void
  (event: 'place-voxel', voxel: MapVoxelV2): void
  (event: 'remove-voxel', cell: { x: number; y: number; z: number }): void
  (event: 'place-hazard', hazard: MapHazardV2): void
  (event: 'remove-hazard', cell: { x: number; y: number; z: number; kind?: MapHazardKind }): void
}>()

const visibleLayers = () => resolveIsometricLayerVisibility(props.layerVisibility)

const normalizedGroundLevelY = () => clampIsometricGroundLevelY(props.dimensions, props.groundLevelY)

const container = ref<HTMLDivElement | null>(null)

const controllableIdSet = computed(() => new Set(props.controllableIds ?? props.pokemons.map((pokemon) => pokemon.id)))
const canControlPokemon = (id: string | null | undefined): id is string =>
  Boolean(id && controllableIdSet.value.has(id))

const {
  actionDialogs,
  contextMenu,
  hpDialog,
  hpDialogDelta,
  hpDialogPreview,
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
  emit: {
    turnPokemon: (id) => emit('turn-pokemon', id),
    deletePokemon: (id) => emit('delete-pokemon', id),
    modifyHp: (payload) => emit('modify-hp', payload),
    modifyCombatStages: (payload) => emit('modify-combat-stages', payload),
    modifyConditions: (payload) => emit('modify-conditions', payload),
    useMove: (payload) => emit('use-move', payload),
    viewSheet: (id) => emit('view-sheet', id),
    viewPokedex: (id) => emit('view-pokedex', id),
  },
})

const selectedPokemon = computed(
  () => props.pokemons.find((pokemon) => pokemon.id === props.selectedId) ?? null,
)
const renderedTerrainVoxels = computed(() => props.voxels)
const renderedHazards = computed(() => props.hazards ?? [])
const renderedFieldEffects = computed(() => normalizeMapFieldEffects(props.fieldEffects))
const fieldEffectsRevision = computed(() => getFieldEffectsRevisionKey(renderedFieldEffects.value))
const hazardRevision = computed(() => getHazardsRevisionKey(renderedHazards.value))
const terrainVoxelRevision = computed(() => getTerrainVoxelsRevisionKey(renderedTerrainVoxels.value))
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
const voxelRenderer = createVoxelRenderer(voxelContainer)
const hazardRenderer = createHazardRenderer(hazardContainer)
const fieldEffectRenderer = createFieldEffectRenderer(fieldEffectContainer)
const gridRenderer = createGridRenderer(gridGroup)
const buildGhostRenderer = createBuildGhostRenderer(previewGroup)
const hazardGhostRenderer = createHazardGhostRenderer(previewGroup)
const tokenMovePreviewRenderer = createTokenMovePreviewRenderer({ scene, group: previewGroup })
let renderer: THREE.WebGLRenderer | null = null
let cssRenderer: ReturnType<typeof createIsometricCssRenderer> | null = null
let camera: THREE.OrthographicCamera | null = null
let controls: ReturnType<typeof createIsometricOrbitControls> | null = null
let cleanupRendererDomEvents: (() => void) | null = null
let cleanupResizeObserver: (() => void) | null = null
let animationFrame = 0
const pointerTracker = createPointerTravelTracker()

const getPreviewLayerY = () => movementInteraction.activeAnchor()?.y ?? selectedPokemon.value?.position.y ?? 0

const syncRendererSize = () => {
  if (!renderer || !cssRenderer || !camera || !container.value) {
    return
  }

  syncIsometricRendererSize({
    renderer,
    cssRenderer,
    camera,
    controls,
    container: container.value,
    dimensions: props.dimensions,
  })
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
  updateGridVisibility()
}

const hoverController = createIsometricTokenHoverController({
  getRenderObject: (id) => renderObjects.get(id),
  updateHoveredRenderObject: (renderObject) => updateHoveredPokemonElevationBadge(renderObject, {
    groundLevelY: normalizedGroundLevelY(),
    camera,
    show: visibleLayers().tokens,
  }),
})

const setHoveredPokemonId = hoverController.set

const buildRenderObject = (pokemon: SpawnedPokemon): PokemonRenderObject =>
  createPokemonRenderObject(pokemon, { scene, worldGroup })

const applyRenderObjectPosition = (renderObject: PokemonRenderObject) => {
  applyPokemonRenderObjectPosition(renderObject, {
    camera,
    activeTurnId: props.activeTurnId,
    groundLevelY: normalizedGroundLevelY(),
    hoveredPokemonId: hoverController.id(),
    layers: visibleLayers(),
    getShadowSurfaceY,
  })
}

const refreshPokemonStyles = () => {
  syncPokemonRenderObjectSelectionStyles({
    renderObjects,
    pokemons: props.pokemons,
    selectedId: props.selectedId,
    paintRenderObjectStyle: (renderObject, selected) => paintPokemonRenderObjectStyle(renderObject, selected),
  })
  applyLayerVisibility()
}

const syncPokemonObjects = () => {
  syncPokemonRenderObjects({
    renderObjects,
    pokemons: props.pokemons,
    createRenderObject: buildRenderObject,
    onCreateRenderObject: applyRenderObjectPosition,
    updateRenderObject: updatePokemonRenderObjectFromSpawn,
    disposeRenderObject: disposePokemonRenderObject,
    clearHoverForToken: hoverController.clearIfHovered,
  })

  refreshPokemonStyles()
}

const syncVoxelMeshes = () => {
  voxelRenderer.sync(renderedTerrainVoxels.value, {
    ghostVoxelsFaded: props.ghostVoxelsFaded,
  })
  applyLayerVisibility()
}

const syncFieldEffectMeshes = () => {
  fieldEffectRenderer.sync({
    dimensions: props.dimensions,
    voxels: renderedTerrainVoxels.value,
    groundLevelY: normalizedGroundLevelY(),
    effects: renderedFieldEffects.value,
  })
  applyLayerVisibility()
}

const syncHazardMeshes = () => {
  hazardRenderer.sync(renderedHazards.value)
  applyLayerVisibility()
}

const applyLayerVisibility = () => {
  applyIsometricLayerVisibility({
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
const hideBuildGhost = () => buildGhostRenderer.hide()

const ensureHazardGhost = () => hazardGhostRenderer.ensure(props.hazardKind ?? 'spikes')
const disposeHazardGhost = () => hazardGhostRenderer.dispose()
const hideHazardGhost = () => hazardGhostRenderer.hide()

const pickPokemonId = (event: MouseEvent | PointerEvent) =>
  pickPokemonIdFromPointer({
    event,
    renderer,
    camera,
    raycaster,
    renderObjects: renderObjects.values(),
  })

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
  })

const movementInteraction = createIsometricTokenMovementInteractionController({
  getSelectedPokemon: () => selectedPokemon.value,
  getPokemons: () => props.pokemons,
  getDimensions: () => props.dimensions,
  getMapMovementOccupancy: () => mapMovementOccupancy.value,
  getPreviewLayerY,
  getGroundLevelY: normalizedGroundLevelY,
  getCamera: () => camera,
  getMoveGridIntersection,
  previewRenderer: tokenMovePreviewRenderer,
  emitPreviewChange: (preview) => emit('preview-change', preview),
  movePokemon: (payload) => emit('move-pokemon', payload),
})
const ensurePreviewObjects = movementInteraction.ensurePreviewObjects
const clearPreviewVisuals = movementInteraction.clearPreviewVisuals
const updatePreviewFromPointer = movementInteraction.updatePreviewFromPointer

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
    floorPlane: gridRenderer.floorPlane(),
    voxelMeshes: voxelRenderer.meshes(),
    dimensions: props.dimensions,
    pokemons: props.pokemons,
    allVoxelOccupancy: allVoxelOccupancy.value,
    mapMovementOccupancy: mapMovementOccupancy.value,
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
  hideGhost: hideBuildGhost,
  placeVoxel: (voxel) => emit('place-voxel', voxel),
  removeVoxel: (cell) => emit('remove-voxel', cell),
})
const updateBuildPreviewFromPointer = buildInteraction.updatePreviewFromPointer
const performBuildAction = buildInteraction.performAction

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
    hazardMeshes: hazardRenderer.meshes(),
    voxelMeshes: voxelRenderer.meshes(),
    hazards: renderedHazards.value,
    dimensions: props.dimensions,
    groundLevelY: normalizedGroundLevelY(),
  })

const hazardInteraction = createIsometricHazardInteractionController({
  getState: () => ({
    hazardMode: Boolean(props.hazardMode),
    hazardTool: props.hazardTool ?? 'pencil',
    hazardKind: props.hazardKind,
  }),
  pickTarget: pickHazardTarget,
  updateGhost: (target, options) => hazardGhostRenderer.update(target, options),
  hideGhost: hideHazardGhost,
  placeHazard: (hazard) => emit('place-hazard', hazard),
  removeHazard: (cell) => emit('remove-hazard', cell),
})
const updateHazardPreviewFromPointer = hazardInteraction.updatePreviewFromPointer
const performHazardAction = hazardInteraction.performAction

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
  selectPokemon: (id) => emit('select-pokemon', id),
  closeContextMenu,
  openContextMenu,
  updateHoverFromPointer,
  clearHoveredPokemon: () => setHoveredPokemonId(null),
  updateBuildPreviewFromPointer,
  updateHazardPreviewFromPointer,
  updateMovePreviewFromPointer: updatePreviewFromPointer,
  performSelectedMove: movementInteraction.performSelectedMove,
  stepPreviewElevation: movementInteraction.stepPreviewElevation,
  performBuildAction,
  performHazardAction,
  hideBuildGhost,
  hideHazardGhost,
  closeTopmostOverlay,
})
const replayBuildPreview = () => buildInteraction.replayPreview(pointerInteraction.lastPointerCoords())
const replayHazardPreview = () => hazardInteraction.replayPreview(pointerInteraction.lastPointerCoords())

const {
  handleRightClick,
  handlePointerDown,
  handlePointerMove,
  handleWheel,
  handlePointerUp,
  handlePointerLeave,
  handleEscape,
} = pointerInteraction

useWindowKeydown(handleEscape)

const animate = () => {
  animationFrame = window.requestAnimationFrame(animate)

  if (!renderer || !cssRenderer || !camera || !controls) {
    return
  }

  stepIsometricAnimationFrame({
    clock,
    renderObjects: renderObjects.values(),
    applyRenderObjectPosition,
    controls,
    fieldEffectRenderer,
    tokenMovePreviewRenderer,
    selectedPokemon: selectedPokemon.value,
    previewPositionY: movementInteraction.previewPositionY(),
    camera,
    renderer,
    cssRenderer,
    scene,
    facingDirection: DEFAULT_FACING_DIRECTION,
  })
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
  cleanupResizeObserver = observeIsometricResize(container.value, () => {
    syncRendererSize()
  })

  animate()
})

onBeforeUnmount(() => {
  window.cancelAnimationFrame(animationFrame)

  cleanupRendererDomEvents?.()
  cleanupRendererDomEvents = null

  cleanupResizeObserver?.()
  cleanupResizeObserver = null

  disposeIsometricRendererResources({
    clearPreviewVisuals,
    tokenMovePreviewRenderer,
    disposeBuildGhost,
    disposeHazardGhost,
    hazardRenderer,
    fieldEffectRenderer,
    voxelRenderer,
    renderObjects,
    disposeRenderObject: disposePokemonRenderObject,
    gridRenderer,
    controls,
    renderer,
    cssRenderer,
  })
  controls = null
  renderer = null
  cssRenderer = null
  camera = null
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
    selectPokemon: (id) => emit('select-pokemon', id),
    refreshPokemonStyles,
    updateGridVisibility,
    setControlsZoomEnabled: (enabled) => {
      if (controls) controls.enableZoom = enabled
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
  },
})
</script>

<template>
  <div ref="container" class="scene-root">
    <TokenContextMenu
      v-if="contextMenu"
      :menu="contextMenu"
      :can-delete-tokens="props.canDeleteTokens"
      :moves="props.tokenMoveOptionsById?.[contextMenu.id] ?? []"
      @view-sheet="handleContextViewSheet"
      @view-pokedex="handleContextViewPokedex"
      @turn="handleContextTurn"
      @modify-hp="handleContextModifyHp"
      @modify-combat-stages="handleContextModifyCombatStages"
      @apply-remove-conditions="handleContextApplyRemoveConditions"
      @use-move="handleContextUseMove"
      @deal-damage="handleContextDealDamage"
      @delete="handleContextDelete"
    />

    <TokenActionDialogs
      ref="actionDialogs"
      :hp-dialog="hpDialog"
      :hp-dialog-delta="hpDialogDelta"
      :hp-dialog-preview="hpDialogPreview"
      :combat-stages-dialog="combatStagesDialog"
      :combat-stages-dialog-changed="combatStagesDialogChanged"
      :conditions-dialog="conditionsDialog"
      :conditions-dialog-changed="conditionsDialogChanged"
      :damage-dialog="damageDialog"
      :damage-dialog-db-def="damageDialogDbDef"
      :damage-dialog-raw-amount="damageDialogRawAmount"
      :damage-dialog-defense="damageDialogDefense"
      :damage-dialog-attacker-options="damageDialogAttackerOptions"
      :damage-dialog-attack-bonus="damageDialogAttackBonus"
      :damage-dialog-multiplier="damageDialogMultiplier"
      :damage-dialog-hp-loss="damageDialogHpLoss"
      :damage-dialog-preview="damageDialogPreview"
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

</style>
