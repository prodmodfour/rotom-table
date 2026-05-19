<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import { moveAutomationAreaDirectionFromPoint } from '~/utils/moveAutomationAreaAiming'
import type { CombatStageMap } from '~/types/combatStages'
import type {
  MoveAutomationAreaDirection,
  MoveAutomationFeedbackState,
  MoveAutomationTargetingOverlayState,
} from '~/types/moveAutomation'
import type { BuildTool } from '#shared/mapEditor'
import type { TokenAbilityMenuOption } from '~/utils/mapTokenAbilities'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'
import {
  POKEBALL_THROW_RANGE_SQUARES,
  type TokenSendOutOption,
} from '~/utils/mapTokenSendOut'
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
  tokenAbilityOptionsById?: Record<string, TokenAbilityMenuOption[]>
  tokenSendOutOptionsById?: Record<string, TokenSendOutOption[]>
  moveAutomationTargeting?: MoveAutomationTargetingOverlayState | null
  moveAutomationFeedback?: MoveAutomationFeedbackState | null
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
  (event: 'use-ability', payload: { id: string; abilityName?: string | null }): void
  (event: 'send-out-pokemon', payload: { trainerId: string; pokemonSlug: string; position: GridAnchor }): void
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
}>()

const visibleLayers = () => resolveIsometricLayerVisibility(props.layerVisibility)

const normalizedGroundLevelY = () => clampIsometricGroundLevelY(props.dimensions, props.groundLevelY)

const container = ref<HTMLDivElement | null>(null)
const targetReticleButtons = ref<Array<{ id: string; left: number; top: number }>>([])

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
}

const beginSendOutPlacement = (payload: { trainerId: string; pokemonSlug: string }) => {
  if (!canControlPokemon(payload.trainerId)) return
  if (!findSendOutOption(payload.trainerId, payload.pokemonSlug)) return

  sendOutPlacement.value = payload
  emitPokemonSelection(null)
}

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
  handleContextUseAbility,
  handleContextSendOutPokemon,
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
    useAbility: (payload) => emit('use-ability', payload),
    sendOutPokemon: beginSendOutPlacement,
    viewSheet: (id) => emit('view-sheet', id),
    viewPokedex: (id) => emit('view-pokedex', id),
  },
})

const selectedPokemon = computed(
  () => props.pokemons.find((pokemon) => pokemon.id === props.selectedId) ?? null,
)
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
const moveTargetingReticleRenderer = createMoveTargetingReticleRenderer(scene)
const moveAreaTemplateRenderer = createMoveAreaTemplateRenderer(scene)
const moveAutomationFeedbackRenderer = createMoveAutomationFeedbackRenderer(scene)
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

const updateMoveAreaDirectionFromPointer = (event: MouseEvent | PointerEvent) => {
  const direction = moveAreaDirectionFromPointer(event)
  if (!direction || direction === props.moveAutomationTargeting?.areaDirection) return
  emit('select-move-area-direction', direction)
}

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

watch(activeSendOutRequest, (request) => {
  if (controls) controls.enableZoom = !request && !selectedPokemon.value

  if (!request) {
    sendOutInteraction.clearPreviewVisuals()
    if (sendOutPlacement.value) clearSendOutPlacement()
    return
  }

  sendOutInteraction.resetForRequestChange()
})

watch([terrainVoxelRevision, () => props.dimensions], () => {
  if (!activeSendOutRequest.value) return
  sendOutInteraction.refreshAfterStateChange()
})

watch([() => props.buildMode, () => props.hazardMode], ([buildActive, hazardActive]) => {
  if (!activeSendOutRequest.value || (!buildActive && !hazardActive)) return
  sendOutInteraction.cancel()
})

watch(() => props.moveAutomationTargeting, (targeting) => {
  if (!targeting) return
  closeContextMenu()
  sendOutInteraction.cancel()
  clearPreviewVisuals()
})

const syncTargetReticleButtons = (show: boolean) => {
  if (!show) {
    if (targetReticleButtons.value.length) targetReticleButtons.value = []
    return
  }

  const next = (props.moveAutomationTargeting?.candidateIds ?? []).flatMap((id) => {
    const renderObject = renderObjects.get(id)
    const point = renderObject ? worldPointToContainerPoint(moveTargetReticleCenter(renderObject)) : null
    return point ? [{ id, left: point.x, top: point.y }] : []
  })
  const current = targetReticleButtons.value
  const unchanged = next.length === current.length && next.every((entry, index) => {
    const old = current[index]
    return old?.id === entry.id
      && Math.abs(old.left - entry.left) < 0.5
      && Math.abs(old.top - entry.top) < 0.5
  })
  if (!unchanged) targetReticleButtons.value = next
}

const updateMoveAutomationOverlays = () => {
  const layers = visibleLayers()
  const targeting = props.moveAutomationTargeting
  const showClickableTargetReticles = Boolean(targeting?.mode === 'target' && layers.tokens)
  const showAreaTemplate = Boolean(targeting?.mode === 'area-confirmation')
  const areaAffectedIds = targeting?.mode === 'area-confirmation'
    ? targeting.affectedIds ?? targeting.candidateIds
    : []
  const showAreaTargetReticles = Boolean(showAreaTemplate && layers.tokens && areaAffectedIds.length)
  syncTargetReticleButtons(showClickableTargetReticles)
  moveAreaTemplateRenderer.update({
    cells: targeting?.areaCells ?? [],
    show: showAreaTemplate,
  })
  moveTargetingReticleRenderer.update({
    candidateIds: areaAffectedIds,
    renderObjects,
    show: showAreaTargetReticles,
  })
  moveAutomationFeedbackRenderer.update({
    feedback: props.moveAutomationFeedback,
    renderObjects,
    show: layers.tokens,
  })
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
    selectedPokemon: sendOutInteraction.activePokemon() ?? selectedPokemon.value,
    previewPositionY: activeSendOutRequest.value ? sendOutInteraction.previewPositionY() : movementInteraction.previewPositionY(),
    camera,
    renderer,
    cssRenderer,
    scene,
    facingDirection: DEFAULT_FACING_DIRECTION,
    beforeRender: updateMoveAutomationOverlays,
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
  },
})
</script>

<template>
  <div ref="container" class="scene-root">
    <div v-if="props.moveAutomationTargeting" class="move-targeting-hud" @contextmenu.prevent>
      <div class="move-targeting-hud__copy">
        <strong>{{ props.moveAutomationTargeting.moveName }}</strong>
        <template v-if="props.moveAutomationTargeting.mode === 'area-confirmation'">
          <span>
            Confirm {{ props.moveAutomationTargeting.rangeLabel }}: {{ props.moveAutomationTargeting.affectedIds?.length ?? 0 }} affected.
            <template v-if="props.moveAutomationTargeting.areaDirectionOptions?.length">
              Move the cursor around the user to rotate, or use a direction button; click to use the move.
            </template>
            <template v-else>
              Click the battlefield to use the move.
            </template>
          </span>
        </template>
        <template v-else>
          <span v-if="props.moveAutomationTargeting.candidateIds.length">
            Choose a target within {{ props.moveAutomationTargeting.rangeLabel }}.
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
          @click.stop="emit('select-move-area-direction', option.direction)"
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

    <div v-if="props.moveAutomationTargeting?.mode === 'target'" class="move-targeting-click-layer" @contextmenu.prevent>
      <button
        v-for="button in targetReticleButtons"
        :key="button.id"
        class="move-target-reticle-button"
        type="button"
        :style="{ left: `${button.left}px`, top: `${button.top}px` }"
        aria-label="Select move target"
        @pointerdown.stop
        @click.stop="emit('select-move-target', button.id)"
      >
        <span class="move-target-reticle" aria-hidden="true" />
      </button>
    </div>

    <TokenContextMenu
      v-if="contextMenu"
      :menu="contextMenu"
      :can-delete-tokens="props.canDeleteTokens"
      :moves="props.tokenMoveOptionsById?.[contextMenu.id] ?? []"
      :abilities="props.tokenAbilityOptionsById?.[contextMenu.id] ?? []"
      :send-out-options="sendOutOptionsForToken(contextMenu.id)"
      @view-sheet="handleContextViewSheet"
      @view-pokedex="handleContextViewPokedex"
      @turn="handleContextTurn"
      @modify-hp="handleContextModifyHp"
      @modify-combat-stages="handleContextModifyCombatStages"
      @apply-remove-conditions="handleContextApplyRemoveConditions"
      @use-move="handleContextUseMove"
      @use-ability="handleContextUseAbility"
      @send-out-pokemon="handleContextSendOutPokemon"
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

.move-targeting-hud {
  position: absolute;
  z-index: 10;
  top: 1rem;
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

.move-targeting-click-layer {
  position: absolute;
  z-index: 9;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
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

.move-target-reticle-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 8px;
}

</style>
