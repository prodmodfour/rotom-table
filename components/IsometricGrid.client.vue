<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import TokenActionDialogs from '~/components/isometric/TokenActionDialogs.vue'
import TokenContextMenu from '~/components/isometric/TokenContextMenu.vue'
import { useTokenActionController } from '~/composables/isometric/useTokenActionController'
import type { GridAnchor, GridDimensions, SpawnedPokemon } from '~/types/pokemon'
import type {
  LayerVisibility,
  MapFieldEffects,
  MapHazardKind,
  MapHazardV2,
  MapVoxelV2,
  VoxelMaterial,
} from '~/types/map'
import type { PreviewState } from '~/utils/grid'
import { getPokemonCenter } from '~/utils/grid'
import { buildAllVoxelOccupancy } from '~/utils/voxels'
import { buildMapOccupancy } from '~/utils/mapOccupancy'
import { normalizeMapFieldEffects } from '~/utils/mapFieldEffects'
import type { CombatStageMap } from '~/types/combatStages'
import type { BuildTool } from '~/shared/mapEditor'
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
  disposeIsometricSharedCaches,
  disposeIsometricSpriteTextureCaches,
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
import { syncPokemonRenderObjects } from '~/utils/isometric/tokenObjectSync'

export type { BuildTool } from '~/shared/mapEditor'

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
  hazardMode?: boolean
  hazardTool?: BuildTool
  hazardKind?: MapHazardKind
  canDeleteTokens?: boolean
}>()

const emit = defineEmits<{
  (event: 'select-pokemon', id: string | null): void
  (event: 'move-pokemon', payload: { id: string; position: GridAnchor }): void
  (event: 'turn-pokemon', id: string): void
  (event: 'delete-pokemon', id: string): void
  (event: 'modify-hp', payload: { id: string; currentHp: number }): void
  (event: 'modify-combat-stages', payload: { id: string; stages: CombatStageMap }): void
  (event: 'modify-conditions', payload: { id: string; conditions: string[] }): void
  (event: 'use-move', id: string): void
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
    useMove: (id) => emit('use-move', id),
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
let lastPointerCoords: { clientX: number; clientY: number } | null = null

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
  for (const pokemon of props.pokemons) {
    const renderObject = renderObjects.get(pokemon.id)

    if (!renderObject) {
      continue
    }

    paintPokemonRenderObjectStyle(renderObject, props.selectedId === pokemon.id)
  }
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
  voxelRenderer.sync(renderedTerrainVoxels.value)
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
  }),
  pickTarget: pickBuildTarget,
  updateGhost: (target, options) => buildGhostRenderer.update(target, options),
  hideGhost: hideBuildGhost,
  placeVoxel: (voxel) => emit('place-voxel', voxel),
  removeVoxel: (cell) => emit('remove-voxel', cell),
})
const updateBuildPreviewFromPointer = buildInteraction.updatePreviewFromPointer
const replayBuildPreview = () => buildInteraction.replayPreview(lastPointerCoords)
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
const replayHazardPreview = () => hazardInteraction.replayPreview(lastPointerCoords)
const performHazardAction = hazardInteraction.performAction

const handleLeftClick = (event: PointerEvent) => {
  closeContextMenu()
  const hitId = pickPokemonId(event)

  if (!props.selectedId) {
    if (canControlPokemon(hitId)) {
      emit('select-pokemon', hitId)
    }

    return
  }

  if (!canControlPokemon(props.selectedId)) {
    emit('select-pokemon', null)
    return
  }

  movementInteraction.performSelectedMove()
}

const handleRightClick = (event: MouseEvent) => {
  event.preventDefault()

  if (props.buildMode) {
    if (pointerTracker.isClick()) {
      performBuildAction(event, 'eraser')
    }
    return
  }

  if (props.hazardMode) {
    if (pointerTracker.isClick()) {
      performHazardAction(event, 'eraser')
    }
    return
  }

  const hitId = pickPokemonId(event)

  if (!canControlPokemon(hitId)) {
    closeContextMenu()
    return
  }

  openContextMenu(event, hitId)
}

const handlePointerDown = (event: PointerEvent) => {
  closeContextMenu()
  pointerTracker.start(event)
}

const handlePointerMove = (event: PointerEvent) => {
  pointerTracker.move(event)
  lastPointerCoords = { clientX: event.clientX, clientY: event.clientY }
  updateHoverFromPointer(event)

  if (props.buildMode) {
    updateBuildPreviewFromPointer(event)
    return
  }

  if (props.hazardMode) {
    updateHazardPreviewFromPointer(event)
    return
  }

  if (selectedPokemon.value && canControlPokemon(selectedPokemon.value.id)) {
    updatePreviewFromPointer(event)
  }
}

const handleWheel = (event: WheelEvent) => {
  if (!selectedPokemon.value || !canControlPokemon(selectedPokemon.value.id)) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  movementInteraction.stepPreviewElevation(event.deltaY)
}

const handlePointerUp = (event: PointerEvent) => {
  if (!pointerTracker.isClick() || event.button !== 0) {
    return
  }

  if (props.buildMode) {
    performBuildAction(event, props.buildTool)
    return
  }

  if (props.hazardMode) {
    performHazardAction(event, props.hazardTool ?? 'pencil')
    return
  }

  handleLeftClick(event)
}

const handlePointerLeave = () => {
  lastPointerCoords = null
  setHoveredPokemonId(null)
  if (props.buildMode) {
    hideBuildGhost()
  }
  if (props.hazardMode) {
    hideHazardGhost()
  }
}

const handleEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    if (closeTopmostOverlay()) return

    emit('select-pokemon', null)
  }
}

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
  window.addEventListener('keydown', handleEscape)

  cleanupResizeObserver = observeIsometricResize(container.value, () => {
    syncRendererSize()
  })

  animate()
})

onBeforeUnmount(() => {
  window.cancelAnimationFrame(animationFrame)
  window.removeEventListener('keydown', handleEscape)

  cleanupRendererDomEvents?.()
  cleanupRendererDomEvents = null

  cleanupResizeObserver?.()
  cleanupResizeObserver = null

  clearPreviewVisuals()
  tokenMovePreviewRenderer.dispose()
  disposeBuildGhost()
  disposeHazardGhost()
  hazardRenderer.dispose()
  fieldEffectRenderer.dispose()
  voxelRenderer.dispose()
  disposeIsometricSharedCaches()

  for (const renderObject of renderObjects.values()) {
    disposePokemonRenderObject(renderObject)
  }

  renderObjects.clear()
  disposeIsometricSpriteTextureCaches()
  gridRenderer.dispose()
  controls?.dispose()
  renderer?.dispose()
  cssRenderer?.domElement.remove()
  controls = null
  renderer = null
  cssRenderer = null
  camera = null
})

watch(
  () => props.pokemons,
  () => {
    if (!renderer) {
      return
    }

    syncPokemonObjects()

    movementInteraction.refreshAfterStateChange()

    syncDialogsFromPokemons()

    replayBuildPreview()
  },
  { deep: true },
)

watch(
  terrainVoxelRevision,
  () => {
    if (!renderer) {
      return
    }

    syncVoxelMeshes()

    // Voxels affect pathfinding — refresh the move preview.
    movementInteraction.refreshAfterStateChange()

    replayBuildPreview()
    replayHazardPreview()
  },
)

watch(
  hazardRevision,
  () => {
    if (!renderer) return
    syncHazardMeshes()
    replayHazardPreview()
  },
)

watch(
  fieldEffectsRevision,
  () => {
    if (!renderer) return
    syncFieldEffectMeshes()
  },
)

watch(
  () => props.selectedId,
  () => {
    if (props.selectedId && !canControlPokemon(props.selectedId)) {
      emit('select-pokemon', null)
      return
    }

    if (!renderer) {
      return
    }

    refreshPokemonStyles()
    updateGridVisibility()

    if (controls) {
      controls.enableZoom = !selectedPokemon.value
    }

    if (!selectedPokemon.value) {
      clearPreviewVisuals()
      closeContextMenu()
      movementInteraction.disposeOwner()
      return
    }

    movementInteraction.resetForSelectionChange()
  },
)

watch(
  () => props.controllableIds?.join('|') ?? '',
  () => {
    if (props.selectedId && !canControlPokemon(props.selectedId)) emit('select-pokemon', null)
    closeUnauthorizedActions()
  },
)

watch(
  () => props.layerVisibility,
  () => {
    if (!renderer) return
    updateGridVisibility()
    applyLayerVisibility()
  },
  { deep: true },
)

watch(
  () => props.buildMode,
  (active) => {
    if (!renderer) return

    updateGridVisibility()

    if (active) {
      closeContextMenu()
      clearPreviewVisuals()
      hideHazardGhost()
      ensureBuildGhost()
      replayBuildPreview()
    } else {
      hideBuildGhost()
    }
  },
)

watch(
  () => props.hazardMode,
  (active) => {
    if (!renderer) return

    updateGridVisibility()

    if (active) {
      closeContextMenu()
      clearPreviewVisuals()
      hideBuildGhost()
      ensureHazardGhost()
      replayHazardPreview()
    } else {
      hideHazardGhost()
    }
  },
)

watch(
  () => [props.buildTool, props.buildMaterial, props.buildColor] as const,
  () => {
    if (!renderer || !props.buildMode) return
    replayBuildPreview()
  },
)

watch(
  () => [props.hazardTool, props.hazardKind] as const,
  () => {
    if (!renderer || !props.hazardMode) return
    replayHazardPreview()
  },
)

watch(
  () => props.groundLevelY,
  () => {
    if (!renderer) return
    syncFieldEffectMeshes()
    movementInteraction.refreshAfterStateChange()
  },
)

watch(
  () => [props.dimensions.x, props.dimensions.y, props.dimensions.z] as const,
  () => {
    if (!renderer) {
      return
    }

    buildGrid()
    syncFieldEffectMeshes()
    updateGridVisibility()
    alignCameraToGrid(false)
    syncRendererSize()

    movementInteraction.refreshAfterStateChange()

    if (props.buildMode) {
      hideBuildGhost()
    }
    if (props.hazardMode) {
      hideHazardGhost()
    }
  },
)
</script>

<template>
  <div ref="container" class="scene-root">
    <TokenContextMenu
      v-if="contextMenu"
      :menu="contextMenu"
      :can-delete-tokens="props.canDeleteTokens"
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
