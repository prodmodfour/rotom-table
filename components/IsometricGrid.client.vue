<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import TokenContextMenu from '~/components/isometric/TokenContextMenu.vue'
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
import { canPlacePokemon, findPathForPokemon, getPokemonCenter } from '~/utils/grid'
import {
  buildAllVoxelOccupancy,
  defaultBuilderVoxelColor,
  parseHexColor,
  voxelMaterialId,
  withDefaultBuilderVoxelColor,
} from '~/utils/voxels'
import { buildMapOccupancy } from '~/utils/mapOccupancy'
import { normalizeMapHazardLayer } from '~/utils/mapHazards'
import { normalizeMapFieldEffects } from '~/utils/mapFieldEffects'
import { POKEMON_TYPES } from '~/utils/typeChart'
import {
  MANUAL_DAMAGE_BASE_TABLE,
  formatDamageBaseFormula,
  rollDamageBase,
} from '~/utils/ptuDamage'
import {
  COMBAT_STAGE_ROWS,
  clampCombatStage,
} from '~/utils/combatStages'
import { normalizeConditionNames } from '~/utils/statusConditions'
import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'
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
import type { VoxelRenderStyle } from '~/utils/isometric/blockTextures'
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
import { updateElevationBadge } from '~/utils/isometric/tokenHud'
import {
  WORLD_SPRITE_HALO_MAX_ALPHA,
  WORLD_SPRITE_HALO_MIN_ALPHA,
  nowMs,
} from '~/utils/isometric/worldSprites'
import { createTokenMovePreviewRenderer } from '~/utils/isometric/tokenMovePreview'
import {
  createTokenContextMenuState,
  type TokenContextMenuState,
} from '~/utils/isometric/contextMenu'
import {
  EMPTY_MOVE_PREVIEW,
  getMovePreviewAnchor,
  getNextMovePreviewElevationAnchor,
} from '~/utils/isometric/movementPreview'
import {
  createHpDialogState,
  getHpDialogDelta,
  getHpDialogPreview,
  updateHpDialogFromPokemon,
  type HpDialogState,
} from '~/utils/isometric/tokenHpDialog'
import {
  createCombatStagesDialogState,
  createConditionsDialogState,
  formatCombatStage,
  getAdjustedCombatStage,
  getNormalizedCombatDialogStages,
  isCombatStagesDialogChanged,
  isConditionsDialogChanged,
  updateConditionsDialogFromPokemon,
  type CombatStagesDialogState,
  type ConditionsDialogState,
} from '~/utils/isometric/tokenStatusDialogs'
import {
  createDamageDialogState,
  getDamageDialogAttackBonus,
  getDamageDialogAttacker,
  getDamageDialogAttackerOptions,
  getDamageDialogDbDefinition,
  getDamageDialogDefense,
  getDamageDialogHpLoss,
  getDamageDialogMultiplier,
  getDamageDialogMultiplierLabel,
  getDamageDialogMultiplierTone,
  getDamageDialogPreview,
  getDamageDialogRawAmount,
  updateDamageDialogFromPokemon,
  type DamageDialogState,
} from '~/utils/isometric/tokenDamageDialog'
import {
  animatePokemonRenderObject,
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

// Subtle directional tint matching the cage's implied light: lit
// quadrant is full brightness, shadowed quadrant dims to 0.92.
// Applied to WebGL sprite material colors.
const SPRITE_BRIGHTNESS_LIT = 1.0
const SPRITE_BRIGHTNESS_SHADOW = 0.92

// Directional halo: replaces the wrapper's static yellow halo with one
// that breathes with camera angle — brighter when the sprite faces the
// implied light, dimmer (not zero) when backlit.
const DEFAULT_LAYER_VISIBILITY: LayerVisibility = {
  terrain: true,
  shadows: true,
  tokens: true,
  grid: true,
  hazards: true,
  fieldEffects: true,
}

const visibleLayers = () => ({ ...DEFAULT_LAYER_VISIBILITY, ...(props.layerVisibility ?? {}) })

const normalizedGroundLevelY = () => {
  const height = Number(props.dimensions.y)
  const max = Number.isFinite(height) ? Math.max(0, Math.floor(height) - 1) : 0
  const n = Number(props.groundLevelY ?? 0)
  if (!Number.isFinite(n)) return 0
  return Math.min(max, Math.max(0, Math.round(n)))
}

const container = ref<HTMLDivElement | null>(null)
const contextMenu = ref<TokenContextMenuState | null>(null)

const combatStagesDialog = ref<CombatStagesDialogState | null>(null)
const combatStagesDialogChanged = computed(() => isCombatStagesDialogChanged(combatStagesDialog.value))

const conditionsDialog = ref<ConditionsDialogState | null>(null)
const conditionsDialogChanged = computed(() => isConditionsDialogChanged(conditionsDialog.value))

const hpDialog = ref<HpDialogState | null>(null)
const hpAmountInput = ref<HTMLInputElement | null>(null)
const hpDialogDelta = computed(() => getHpDialogDelta(hpDialog.value))
const hpDialogPreview = computed(() => getHpDialogPreview(hpDialog.value))

const damageDialog = ref<DamageDialogState | null>(null)
const damageAmountInput = ref<HTMLInputElement | null>(null)
const damageDialogDbDef = computed(() => getDamageDialogDbDefinition(damageDialog.value))
const damageDialogRawAmount = computed(() => getDamageDialogRawAmount(damageDialog.value))
const damageDialogDefense = computed(() => getDamageDialogDefense(damageDialog.value))
// Tokens on the grid the user can pick as the attacker, sorted by display name.
const damageDialogAttackerOptions = computed(() => getDamageDialogAttackerOptions(props.pokemons))
const damageDialogAttacker = computed(() => getDamageDialogAttacker(damageDialog.value, props.pokemons))
// Atk / Sp.Atk added to DB rolls only; flat damage already includes offence.
const damageDialogAttackBonus = computed(() => getDamageDialogAttackBonus(
  damageDialog.value,
  damageDialogAttacker.value,
))
const damageDialogMultiplier = computed(() => getDamageDialogMultiplier(damageDialog.value))
const damageDialogHpLoss = computed(() => getDamageDialogHpLoss(
  damageDialog.value,
  damageDialogAttacker.value,
))
const damageDialogPreview = computed(() => getDamageDialogPreview(
  damageDialog.value,
  damageDialogAttacker.value,
))
const damageDialogMultiplierTone = computed(() => getDamageDialogMultiplierTone(damageDialogMultiplier.value))
const damageDialogMultiplierLabel = computed(() => getDamageDialogMultiplierLabel(damageDialogMultiplier.value))

const controllableIdSet = computed(() => new Set(props.controllableIds ?? props.pokemons.map((pokemon) => pokemon.id)))
const canControlPokemon = (id: string | null | undefined): id is string =>
  Boolean(id && controllableIdSet.value.has(id))

const selectedPokemon = computed(
  () => props.pokemons.find((pokemon) => pokemon.id === props.selectedId) ?? null,
)
const renderedTerrainVoxels = computed(() => props.voxels)
const renderedHazards = computed(() => props.hazards ?? [])
const renderedFieldEffects = computed(() => normalizeMapFieldEffects(props.fieldEffects))
const fieldEffectsRevision = computed(() => JSON.stringify(renderedFieldEffects.value))
const hazardRevision = computed(() =>
  renderedHazards.value
    .map((hazard) => [
      hazard.kind,
      hazard.x,
      hazard.y,
      hazard.z,
      hazard.layer ?? '',
      hazard.owner ?? '',
    ].join('\u001e'))
    .join('\u001d'),
)
const terrainVoxelRevision = computed(() =>
  renderedTerrainVoxels.value
    .map((voxel) => [
      voxel.x,
      voxel.y,
      voxel.z,
      voxelMaterialId(voxel),
      voxel.color ?? '',
      voxel.blocksMovement ?? '',
      voxel.blocksSight ?? '',
      (voxel.tags ?? []).join('\u001f'),
    ].join('\u001e'))
    .join('\u001d'),
)
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

const scene = new THREE.Scene()
const raycaster = new THREE.Raycaster()
const gridGroup = new THREE.Group()
const worldGroup = new THREE.Group()
const previewGroup = new THREE.Group()
const voxelContainer = new THREE.Group()
const fieldEffectContainer = new THREE.Group()
const hazardContainer = new THREE.Group()
const clock = new THREE.Clock()

scene.add(gridGroup)
scene.add(worldGroup)
scene.add(previewGroup)
worldGroup.add(fieldEffectContainer)
worldGroup.add(voxelContainer)
worldGroup.add(hazardContainer)

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
let activePreview: PreviewState = { ...EMPTY_MOVE_PREVIEW }
let activePreviewCanPlace = false
let activePreviewAnchor: GridAnchor | null = null
let pointerDown = { x: 0, y: 0 }
let pointerTravel = 0
let lastPointerCoords: { clientX: number; clientY: number } | null = null
let hoveredPokemonId: string | null = null

const getPreviewLayerY = () => activePreviewAnchor?.y ?? selectedPokemon.value?.position.y ?? 0

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
  gridRenderer.setVisible({
    grid: visibleLayers().grid,
    movement: Boolean(selectedPokemon.value) || props.buildMode || Boolean(props.hazardMode),
  })
}

const buildGrid = () => {
  gridRenderer.sync(props.dimensions)
  updateGridVisibility()
}

const setHoveredPokemonId = (id: string | null) => {
  if (hoveredPokemonId === id) {
    return
  }

  const previousId = hoveredPokemonId
  hoveredPokemonId = id

  if (previousId && previousId !== id) {
    const previous = renderObjects.get(previousId)
    if (previous) previous.elevationBadge.visible = false
  }

  if (id) {
    const next = renderObjects.get(id)
    if (next) {
      updateElevationBadge({
        badge: next.elevationBadge,
        center: next.currentCenter,
        base: next.base,
        elevation: next.elevation,
        groundLevelY: normalizedGroundLevelY(),
        camera,
        show: visibleLayers().tokens,
      })
    }
  }
}

const buildRenderObject = (pokemon: SpawnedPokemon): PokemonRenderObject =>
  createPokemonRenderObject(pokemon, { scene, worldGroup })

const applyRenderObjectPosition = (renderObject: PokemonRenderObject) => {
  applyPokemonRenderObjectPosition(renderObject, {
    camera,
    activeTurnId: props.activeTurnId,
    groundLevelY: normalizedGroundLevelY(),
    hoveredPokemonId,
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
  const nextIds = new Set(props.pokemons.map((pokemon) => pokemon.id))

  for (const [id, renderObject] of renderObjects.entries()) {
    if (nextIds.has(id)) {
      continue
    }

    if (hoveredPokemonId === id) {
      setHoveredPokemonId(null)
    }

    disposePokemonRenderObject(renderObject)
    renderObjects.delete(id)
  }

  for (const pokemon of props.pokemons) {
    let renderObject = renderObjects.get(pokemon.id)

    if (!renderObject) {
      renderObject = buildRenderObject(pokemon)
      renderObjects.set(pokemon.id, renderObject)
      applyRenderObjectPosition(renderObject)
    }

    updatePokemonRenderObjectFromSpawn(renderObject, pokemon)
  }

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
  const layers = visibleLayers()
  gridRenderer.setVisible({
    grid: layers.grid,
    movement: Boolean(selectedPokemon.value) || props.buildMode || Boolean(props.hazardMode),
  })
  voxelRenderer.setVisible(layers.terrain)
  fieldEffectRenderer.setVisible(layers.fieldEffects)
  hazardRenderer.setVisible(layers.hazards)

  for (const renderObject of renderObjects.values()) {
    setPokemonRenderObjectLayerVisibility(renderObject, layers)
  }
}

const ensureBuildGhost = () => buildGhostRenderer.ensure()
const disposeBuildGhost = () => buildGhostRenderer.dispose()
const hideBuildGhost = () => buildGhostRenderer.hide()

const ensureHazardGhost = () => hazardGhostRenderer.ensure(props.hazardKind ?? 'spikes')
const disposeHazardGhost = () => hazardGhostRenderer.dispose()
const hideHazardGhost = () => hazardGhostRenderer.hide()

const currentBuildVoxelStyle = (cell?: { x: number; y: number; z: number }): VoxelRenderStyle => {
  const style: VoxelRenderStyle = { materialId: props.buildMaterial }
  if (props.buildColor && parseHexColor(props.buildColor) !== null) {
    style.color = props.buildColor
  } else if (cell) {
    const color = defaultBuilderVoxelColor({ ...cell, materialId: props.buildMaterial })
    if (color) style.color = color
  }
  return style
}

const ensurePreviewObjects = () => {
  if (selectedPokemon.value) {
    tokenMovePreviewRenderer.ensure(selectedPokemon.value)
  }
}

const clearPreviewVisuals = () => {
  activePreview = { ...EMPTY_MOVE_PREVIEW }
  activePreviewCanPlace = false
  activePreviewAnchor = null
  tokenMovePreviewRenderer.clear()
  emit('preview-change', { ...EMPTY_MOVE_PREVIEW })
}

const updatePreviewAtAnchor = (anchor: GridAnchor | null) => {
  if (!selectedPokemon.value) {
    clearPreviewVisuals()
    return
  }

  ensurePreviewObjects()

  if (!anchor) {
    clearPreviewVisuals()
    return
  }

  const selected = selectedPokemon.value
  // Destination placement ignores terrain occupancy so the table can be used
  // as a free-positioning tool, but pathfinding below still treats terrain as
  // blocking and therefore won't show a legal route through/into blocks.
  const canForcePlace = canPlacePokemon(
    selected,
    anchor,
    props.pokemons,
    props.dimensions,
    selected.id,
  )
  const path = canForcePlace
    ? findPathForPokemon(
        selected,
        selected.position,
        anchor,
        props.pokemons,
        props.dimensions,
        selected.id,
        mapMovementOccupancy.value,
      )
    : null
  const reachable = Boolean(path)
  const previewUpdated = tokenMovePreviewRenderer.update({
    pokemon: selected,
    anchor,
    canForcePlace,
    reachable,
    path,
    groundLevelY: normalizedGroundLevelY(),
    camera,
  })

  if (!previewUpdated) {
    clearPreviewVisuals()
    return
  }

  activePreviewAnchor = anchor
  activePreviewCanPlace = canForcePlace
  activePreview = {
    position: anchor,
    reachable,
    pathLength: path ? Math.max(path.length - 1, 0) : 0,
  }
  emit('preview-change', { ...activePreview })
}

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

const updatePreviewFromPointer = (event: MouseEvent | PointerEvent) => {
  if (!selectedPokemon.value) {
    clearPreviewVisuals()
    return
  }

  const previewLayerY = getPreviewLayerY()
  const point = getMoveGridIntersection(event, previewLayerY)

  const anchor = getMovePreviewAnchor({
    point,
    pokemon: selectedPokemon.value,
    dimensions: props.dimensions,
    yLevel: previewLayerY,
  })

  if (!anchor) {
    clearPreviewVisuals()
    return
  }

  updatePreviewAtAnchor(anchor)
}

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

const updateBuildGhost = (target: BuildTarget | null) => {
  buildGhostRenderer.update(target, {
    buildMode: props.buildMode,
    styleForCell: currentBuildVoxelStyle,
  })
}

const updateBuildPreviewFromPointer = (event: MouseEvent | PointerEvent) => {
  if (!props.buildMode) {
    hideBuildGhost()
    return
  }
  const target = pickBuildTarget(event, props.buildTool)
  updateBuildGhost(target)
}

const replayBuildPreview = () => {
  if (!props.buildMode || !lastPointerCoords) return
  const synthetic = {
    clientX: lastPointerCoords.clientX,
    clientY: lastPointerCoords.clientY,
  } as MouseEvent
  updateBuildPreviewFromPointer(synthetic)
}

const performBuildAction = (event: MouseEvent | PointerEvent, tool: BuildTool) => {
  const target = pickBuildTarget(event, tool)
  if (!target) return
  if (target.action === 'remove') {
    emit('remove-voxel', target.cell)
    return
  }
  if (!target.valid) return
  const voxel: MapVoxelV2 = withDefaultBuilderVoxelColor({
    x: target.cell.x,
    y: target.cell.y,
    z: target.cell.z,
    materialId: props.buildMaterial,
    ...(props.buildColor ? { color: props.buildColor } : {}),
  })
  emit('place-voxel', voxel)
}

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

const updateHazardGhost = (target: HazardTarget | null) => {
  hazardGhostRenderer.update(target, {
    hazardMode: Boolean(props.hazardMode),
    kind: props.hazardKind ?? 'spikes',
  })
}

const updateHazardPreviewFromPointer = (event: MouseEvent | PointerEvent) => {
  if (!props.hazardMode) {
    hideHazardGhost()
    return
  }
  const target = pickHazardTarget(event, props.hazardTool ?? 'pencil')
  updateHazardGhost(target)
}

const replayHazardPreview = () => {
  if (!props.hazardMode || !lastPointerCoords) return
  const synthetic = {
    clientX: lastPointerCoords.clientX,
    clientY: lastPointerCoords.clientY,
  } as MouseEvent
  updateHazardPreviewFromPointer(synthetic)
}

const performHazardAction = (event: MouseEvent | PointerEvent, tool: BuildTool) => {
  const target = pickHazardTarget(event, tool)
  if (!target || !target.valid) return
  if (target.action === 'remove') {
    emit('remove-hazard', target.cell)
    return
  }
  const kind = props.hazardKind ?? 'spikes'
  const hazard: MapHazardV2 = {
    kind,
    x: target.cell.x,
    y: target.cell.y,
    z: target.cell.z,
  }
  const layer = normalizeMapHazardLayer(kind, undefined)
  if (layer !== undefined) hazard.layer = layer
  emit('place-hazard', hazard)
}

const closeContextMenu = () => {
  contextMenu.value = null
}

const openContextMenu = (event: MouseEvent, id: string) => {
  if (!canControlPokemon(id) || !container.value) {
    return
  }

  const target = props.pokemons.find((pokemon) => pokemon.id === id)
  if (!target) return

  contextMenu.value = createTokenContextMenuState({
    pokemon: target,
    clientX: event.clientX,
    clientY: event.clientY,
    bounds: container.value.getBoundingClientRect(),
    canDeleteTokens: props.canDeleteTokens,
  })
}

const handleContextTurn = () => {
  if (!contextMenu.value || !canControlPokemon(contextMenu.value.id)) {
    return
  }

  emit('turn-pokemon', contextMenu.value.id)
  closeContextMenu()
}

const closeHpDialog = () => {
  hpDialog.value = null
}

const handleContextModifyHp = () => {
  if (!contextMenu.value || !canControlPokemon(contextMenu.value.id)) {
    return
  }

  const target = props.pokemons.find((pokemon) => pokemon.id === contextMenu.value!.id)
  if (!target) {
    closeContextMenu()
    return
  }

  hpDialog.value = createHpDialogState(target)
  closeContextMenu()
  void nextTick(() => {
    hpAmountInput.value?.focus()
    hpAmountInput.value?.select()
  })
}

const handleHpDialogSubmit = () => {
  if (!hpDialog.value || !canControlPokemon(hpDialog.value.id)) return
  if (hpDialogDelta.value === 0) return
  if (hpDialogPreview.value === hpDialog.value.currentHp) {
    closeHpDialog()
    return
  }

  emit('modify-hp', { id: hpDialog.value.id, currentHp: hpDialogPreview.value })
  closeHpDialog()
}

const closeCombatStagesDialog = () => {
  combatStagesDialog.value = null
}

const handleContextModifyCombatStages = () => {
  if (!contextMenu.value || !canControlPokemon(contextMenu.value.id)) {
    return
  }

  const target = props.pokemons.find((pokemon) => pokemon.id === contextMenu.value!.id)
  if (!target) {
    closeContextMenu()
    return
  }

  combatStagesDialog.value = createCombatStagesDialogState(target)
  closeContextMenu()
}

const adjustCombatStage = (key: CombatStageKey, delta: number) => {
  if (!combatStagesDialog.value) return
  combatStagesDialog.value.stages[key] = getAdjustedCombatStage(
    combatStagesDialog.value.stages[key],
    delta,
  )
}

const normalizeCombatStageInput = (key: CombatStageKey) => {
  if (!combatStagesDialog.value) return
  combatStagesDialog.value.stages[key] = clampCombatStage(combatStagesDialog.value.stages[key])
}

const handleCombatStagesDialogSubmit = () => {
  if (!combatStagesDialog.value || !canControlPokemon(combatStagesDialog.value.id)) return
  const stages = getNormalizedCombatDialogStages(combatStagesDialog.value)
  combatStagesDialog.value.stages = { ...stages }
  if (!combatStagesDialogChanged.value) {
    closeCombatStagesDialog()
    return
  }

  emit('modify-combat-stages', { id: combatStagesDialog.value.id, stages })
  closeCombatStagesDialog()
}

const closeConditionsDialog = () => {
  conditionsDialog.value = null
}

const handleContextApplyRemoveConditions = () => {
  if (!contextMenu.value || !canControlPokemon(contextMenu.value.id)) {
    return
  }

  const target = props.pokemons.find((pokemon) => pokemon.id === contextMenu.value!.id)
  if (!target) {
    closeContextMenu()
    return
  }

  conditionsDialog.value = createConditionsDialogState(target)
  closeContextMenu()
}

const handleContextUseMove = () => {
  if (!contextMenu.value || !canControlPokemon(contextMenu.value.id)) {
    return
  }

  emit('use-move', contextMenu.value.id)
  closeContextMenu()
}

const handleContextViewSheet = () => {
  if (!contextMenu.value || !canControlPokemon(contextMenu.value.id)) {
    return
  }

  emit('view-sheet', contextMenu.value.id)
  closeContextMenu()
}

const handleContextViewPokedex = () => {
  if (!contextMenu.value || !canControlPokemon(contextMenu.value.id)) {
    return
  }

  emit('view-pokedex', contextMenu.value.id)
  closeContextMenu()
}

const handleConditionsDialogSubmit = () => {
  if (!conditionsDialog.value || !canControlPokemon(conditionsDialog.value.id)) return
  const conditions = normalizeConditionNames(conditionsDialog.value.conditions)
  conditionsDialog.value.conditions = [...conditions]
  if (!conditionsDialogChanged.value) {
    closeConditionsDialog()
    return
  }

  emit('modify-conditions', { id: conditionsDialog.value.id, conditions })
  closeConditionsDialog()
}

const closeDamageDialog = () => {
  damageDialog.value = null
}

const handleContextDealDamage = () => {
  if (!contextMenu.value || !canControlPokemon(contextMenu.value.id)) {
    return
  }

  const target = props.pokemons.find((pokemon) => pokemon.id === contextMenu.value!.id)
  if (!target) {
    closeContextMenu()
    return
  }

  damageDialog.value = createDamageDialogState(target)
  closeContextMenu()
  void nextTick(() => {
    damageAmountInput.value?.focus()
    damageAmountInput.value?.select()
  })
}

const handleDamageDialogDbChange = () => {
  // Stale rolls confuse the breakdown — clear so the user re-rolls the
  // formula they actually selected.
  if (damageDialog.value) damageDialog.value.roll = null
}

const handleDamageDialogRoll = () => {
  if (!damageDialog.value) return
  const def = damageDialogDbDef.value
  if (!def) return
  damageDialog.value.roll = rollDamageBase(def)
}

const handleDamageDialogSubmit = () => {
  if (!damageDialog.value || !canControlPokemon(damageDialog.value.id)) return
  if (damageDialogRawAmount.value === 0) return
  if (damageDialogPreview.value === damageDialog.value.currentHp) {
    closeDamageDialog()
    return
  }

  emit('modify-hp', { id: damageDialog.value.id, currentHp: damageDialogPreview.value })
  closeDamageDialog()
}

const handleContextDelete = () => {
  if (!props.canDeleteTokens || !contextMenu.value || !canControlPokemon(contextMenu.value.id)) {
    return
  }

  emit('delete-pokemon', contextMenu.value.id)
  closeContextMenu()
}

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

  if (activePreview.position && activePreviewCanPlace) {
    emit('move-pokemon', {
      id: props.selectedId,
      position: activePreview.position,
    })
  }
}

const handleRightClick = (event: MouseEvent) => {
  event.preventDefault()

  if (props.buildMode) {
    if (pointerTravel <= 6) {
      performBuildAction(event, 'eraser')
    }
    return
  }

  if (props.hazardMode) {
    if (pointerTravel <= 6) {
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
  pointerDown = { x: event.clientX, y: event.clientY }
  pointerTravel = 0
}

const handlePointerMove = (event: PointerEvent) => {
  pointerTravel = Math.max(
    pointerTravel,
    Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y),
  )
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

  const nextAnchor = getNextMovePreviewElevationAnchor({
    currentAnchor: activePreview.position ?? selectedPokemon.value.position,
    pokemon: selectedPokemon.value,
    dimensions: props.dimensions,
    deltaY: event.deltaY,
  })

  if (!nextAnchor) return

  updatePreviewAtAnchor(nextAnchor)
}

const handlePointerUp = (event: PointerEvent) => {
  if (pointerTravel > 6 || event.button !== 0) {
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
    if (damageDialog.value) {
      closeDamageDialog()
      return
    }

    if (hpDialog.value) {
      closeHpDialog()
      return
    }

    if (conditionsDialog.value) {
      closeConditionsDialog()
      return
    }

    if (combatStagesDialog.value) {
      closeCombatStagesDialog()
      return
    }

    if (contextMenu.value) {
      closeContextMenu()
      return
    }

    emit('select-pokemon', null)
  }
}

const animate = () => {
  animationFrame = window.requestAnimationFrame(animate)

  if (!renderer || !cssRenderer || !camera || !controls) {
    return
  }

  const delta = Math.min(clock.getDelta(), 0.1)
  const damping = 1 - Math.exp(-delta * 12)

  for (const renderObject of renderObjects.values()) {
    if (renderObject.currentCenter.distanceToSquared(renderObject.targetCenter) < 0.000001) {
      renderObject.currentCenter.copy(renderObject.targetCenter)
    } else {
      renderObject.currentCenter.lerp(renderObject.targetCenter, damping)
    }

    applyRenderObjectPosition(renderObject)
  }

  controls.update()

  fieldEffectRenderer.update(delta, clock.elapsedTime)

  // Light alignment: camera's XZ offset dotted against the cage's
  // implied light direction. +1 = lit quadrant, -1 = shadowed.
  // Lerps to a material color scalar shared across every sprite this
  // frame (ortho camera → all sprites see the same direction).
  const cameraXZ = new THREE.Vector2(
    camera.position.x - controls.target.x,
    camera.position.z - controls.target.z,
  )
  const lightAlignment = cameraXZ.lengthSq() > 0
    ? cameraXZ.normalize().dot(DEFAULT_FACING_DIRECTION)
    : 1
  const lightAlignment01 = (lightAlignment + 1) / 2
  const spriteBrightness = THREE.MathUtils.lerp(
    SPRITE_BRIGHTNESS_SHADOW,
    SPRITE_BRIGHTNESS_LIT,
    lightAlignment01,
  )
  // Directional halo: same gruvbox yellow glow the wrapper used to
  // paint statically, now lerped between min/max alpha by camera
  // alignment so the sprite picks up "light" as it rotates into the
  // lit quadrant. Single halo, native palette, responsive.
  const haloAlpha = THREE.MathUtils.lerp(
    WORLD_SPRITE_HALO_MIN_ALPHA,
    WORLD_SPRITE_HALO_MAX_ALPHA,
    lightAlignment01,
  )
  const frameNowMs = nowMs()

  for (const renderObject of renderObjects.values()) {
    animatePokemonRenderObject(renderObject, {
      camera,
      facingDirection: DEFAULT_FACING_DIRECTION,
      damping,
      frameNowMs,
      spriteBrightness,
      haloAlpha,
    })
  }

  tokenMovePreviewRenderer.animate({
    pokemon: selectedPokemon.value,
    positionY: activePreview.position?.y ?? selectedPokemon.value?.position.y ?? null,
    camera,
    facingDirection: DEFAULT_FACING_DIRECTION,
    frameNowMs,
    spriteBrightness,
    haloAlpha,
  })

  renderer.render(scene, camera)
  cssRenderer.render(scene, camera)
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

    if (selectedPokemon.value && activePreviewAnchor) {
      updatePreviewAtAnchor(activePreviewAnchor)
    } else if (!selectedPokemon.value) {
      clearPreviewVisuals()
    }

    if (hpDialog.value) {
      const live = props.pokemons.find((pokemon) => pokemon.id === hpDialog.value!.id)
      if (!live) {
        closeHpDialog()
      } else {
        hpDialog.value = updateHpDialogFromPokemon(hpDialog.value, live)
      }
    }

    if (damageDialog.value) {
      const live = props.pokemons.find((pokemon) => pokemon.id === damageDialog.value!.id)
      if (!live) {
        closeDamageDialog()
      } else {
        damageDialog.value = updateDamageDialogFromPokemon(
          damageDialog.value,
          live,
          props.pokemons,
        )
      }
    }

    if (conditionsDialog.value) {
      const live = props.pokemons.find((pokemon) => pokemon.id === conditionsDialog.value!.id)
      if (!live) {
        closeConditionsDialog()
      } else {
        conditionsDialog.value = updateConditionsDialogFromPokemon(conditionsDialog.value, live)
      }
    }

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

    if (selectedPokemon.value && activePreviewAnchor) {
      // Voxels affect pathfinding — refresh the move preview.
      updatePreviewAtAnchor(activePreviewAnchor)
    }

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
      tokenMovePreviewRenderer.disposeOwner()
      return
    }

    activePreviewAnchor = null
    activePreview = { ...EMPTY_MOVE_PREVIEW }
    ensurePreviewObjects()
    emit('preview-change', { ...EMPTY_MOVE_PREVIEW })
  },
)

watch(
  () => props.controllableIds?.join('|') ?? '',
  () => {
    if (props.selectedId && !canControlPokemon(props.selectedId)) emit('select-pokemon', null)
    if (contextMenu.value && !canControlPokemon(contextMenu.value.id)) closeContextMenu()
    if (hpDialog.value && !canControlPokemon(hpDialog.value.id)) closeHpDialog()
    if (combatStagesDialog.value && !canControlPokemon(combatStagesDialog.value.id)) closeCombatStagesDialog()
    if (conditionsDialog.value && !canControlPokemon(conditionsDialog.value.id)) closeConditionsDialog()
    if (damageDialog.value && !canControlPokemon(damageDialog.value.id)) closeDamageDialog()
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
    if (selectedPokemon.value && activePreviewAnchor) updatePreviewAtAnchor(activePreviewAnchor)
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

    if (selectedPokemon.value && activePreviewAnchor) {
      updatePreviewAtAnchor(activePreviewAnchor)
    } else if (!selectedPokemon.value) {
      clearPreviewVisuals()
    }

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

    <div
      v-if="hpDialog"
      class="hp-dialog-backdrop"
      @pointerdown.self="closeHpDialog"
      @contextmenu.prevent
    >
      <form
        class="hp-dialog"
        @submit.prevent="handleHpDialogSubmit"
        @pointerdown.stop
      >
        <header class="hp-dialog__header">
          <h3>Modify HP</h3>
          <p class="hp-dialog__species">{{ hpDialog.species }}</p>
        </header>

        <div class="hp-dialog__readout">
          <span class="hp-dialog__current">{{ hpDialog.currentHp }} / {{ hpDialog.maxHp }}</span>
          <span class="hp-dialog__arrow" aria-hidden="true">→</span>
          <span
            class="hp-dialog__preview"
            :class="{
              'is-damage': hpDialogDelta < 0,
              'is-heal': hpDialogDelta > 0,
            }"
          >{{ hpDialogPreview }} / {{ hpDialog.maxHp }}</span>
        </div>

        <div class="hp-dialog__mode" role="group" aria-label="Operation">
          <button
            type="button"
            class="hp-dialog__mode-button"
            :class="{ 'is-active': hpDialog.mode === 'damage' }"
            :aria-pressed="hpDialog.mode === 'damage'"
            @click="hpDialog.mode = 'damage'"
          >
            − Lose
          </button>
          <button
            type="button"
            class="hp-dialog__mode-button"
            :class="{ 'is-active': hpDialog.mode === 'heal' }"
            :aria-pressed="hpDialog.mode === 'heal'"
            @click="hpDialog.mode = 'heal'"
          >
            + Gain
          </button>
        </div>

        <label class="hp-dialog__field">
          <span>Amount</span>
          <input
            ref="hpAmountInput"
            v-model="hpDialog.amount"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            placeholder="0"
          />
        </label>

        <footer class="hp-dialog__footer">
          <button
            type="button"
            class="hp-dialog__button hp-dialog__button--ghost"
            @click="closeHpDialog"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="hp-dialog__button hp-dialog__button--primary"
            :disabled="hpDialogDelta === 0 || hpDialogPreview === hpDialog.currentHp"
          >
            Apply
          </button>
        </footer>
      </form>
    </div>

    <div
      v-if="combatStagesDialog"
      class="hp-dialog-backdrop"
      @pointerdown.self="closeCombatStagesDialog"
      @contextmenu.prevent
    >
      <form
        class="hp-dialog hp-dialog--wide"
        @submit.prevent="handleCombatStagesDialogSubmit"
        @pointerdown.stop
      >
        <header class="hp-dialog__header">
          <h3>Change Combat Stages</h3>
          <p class="hp-dialog__species">{{ combatStagesDialog.species }}</p>
        </header>

        <div class="combat-stage-dialog__rows">
          <div
            v-for="row in COMBAT_STAGE_ROWS"
            :key="row.key"
            class="combat-stage-dialog__row"
          >
            <span class="combat-stage-dialog__label">{{ row.label }}</span>
            <button
              type="button"
              class="combat-stage-dialog__step"
              :disabled="clampCombatStage(combatStagesDialog.stages[row.key]) <= -6"
              :aria-label="`Lower ${row.label} combat stage`"
              @click="adjustCombatStage(row.key, -1)"
            >−</button>
            <input
              v-model.number="combatStagesDialog.stages[row.key]"
              class="combat-stage-dialog__input"
              type="number"
              min="-6"
              max="6"
              step="1"
              inputmode="numeric"
              :aria-label="`${row.label} combat stage`"
              @change="normalizeCombatStageInput(row.key)"
            />
            <button
              type="button"
              class="combat-stage-dialog__step"
              :disabled="clampCombatStage(combatStagesDialog.stages[row.key]) >= 6"
              :aria-label="`Raise ${row.label} combat stage`"
              @click="adjustCombatStage(row.key, 1)"
            >+</button>
            <span
              class="combat-stage-dialog__preview"
              :class="{
                'is-positive': clampCombatStage(combatStagesDialog.stages[row.key]) > 0,
                'is-negative': clampCombatStage(combatStagesDialog.stages[row.key]) < 0,
              }"
            >{{ formatCombatStage(combatStagesDialog.stages[row.key]) }}</span>
          </div>
        </div>

        <p class="hp-dialog__note">Combat stages are saved to the source character sheet and clamped from −6 to +6.</p>

        <footer class="hp-dialog__footer">
          <button
            type="button"
            class="hp-dialog__button hp-dialog__button--ghost"
            @click="closeCombatStagesDialog"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="hp-dialog__button hp-dialog__button--primary"
            :disabled="!combatStagesDialogChanged"
          >
            Apply
          </button>
        </footer>
      </form>
    </div>

    <div
      v-if="conditionsDialog"
      class="hp-dialog-backdrop"
      @pointerdown.self="closeConditionsDialog"
      @contextmenu.prevent
    >
      <form
        class="hp-dialog hp-dialog--wide"
        @submit.prevent="handleConditionsDialogSubmit"
        @pointerdown.stop
      >
        <header class="hp-dialog__header">
          <h3>Apply/Remove Conditions</h3>
          <p class="hp-dialog__species">{{ conditionsDialog.species }}</p>
        </header>

        <ConditionPicker
          v-model="conditionsDialog.conditions"
          class="conditions-dialog__picker"
          compact
          tag-size="sm"
        />

        <p class="hp-dialog__note">Conditions are saved to the source character sheet and shown on every map token for that sheet.</p>

        <footer class="hp-dialog__footer">
          <button
            type="button"
            class="hp-dialog__button hp-dialog__button--ghost"
            @click="closeConditionsDialog"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="hp-dialog__button hp-dialog__button--primary"
            :disabled="!conditionsDialogChanged"
          >
            Apply
          </button>
        </footer>
      </form>
    </div>

    <div
      v-if="damageDialog"
      class="hp-dialog-backdrop"
      @pointerdown.self="closeDamageDialog"
      @contextmenu.prevent
    >
      <form
        class="hp-dialog"
        @submit.prevent="handleDamageDialogSubmit"
        @pointerdown.stop
      >
        <header class="hp-dialog__header">
          <h3>Deal damage</h3>
          <p class="hp-dialog__species">
            {{ damageDialog.species }}
            <span v-if="damageDialog.defenderTypes.length" class="hp-dialog__types">
              <span aria-hidden="true">·</span>
              <TypeBadge
                v-for="type in damageDialog.defenderTypes"
                :key="type"
                :type="type"
                size="xs"
              />
            </span>
          </p>
        </header>

        <div class="hp-dialog__readout">
          <span class="hp-dialog__current">{{ damageDialog.currentHp }} / {{ damageDialog.maxHp }}</span>
          <span class="hp-dialog__arrow" aria-hidden="true">→</span>
          <span
            class="hp-dialog__preview"
            :class="{ 'is-damage': damageDialogHpLoss > 0 }"
          >{{ damageDialogPreview }} / {{ damageDialog.maxHp }}</span>
          <span
            v-if="damageDialogMultiplierTone"
            class="hp-dialog__multiplier"
            :class="damageDialogMultiplierTone"
          >×{{ damageDialogMultiplierLabel }}</span>
        </div>

        <div class="hp-dialog__mode" role="group" aria-label="Damage category">
          <button
            type="button"
            class="hp-dialog__mode-button"
            :class="{ 'is-active': damageDialog.mode === 'physical' }"
            :aria-pressed="damageDialog.mode === 'physical'"
            @click="damageDialog.mode = 'physical'"
          >
            <DamageClassBadge category="Physical" size="xs" />
            <span class="hp-dialog__mode-stat">Def {{ damageDialog.def }}</span>
          </button>
          <button
            type="button"
            class="hp-dialog__mode-button"
            :class="{ 'is-active': damageDialog.mode === 'special' }"
            :aria-pressed="damageDialog.mode === 'special'"
            @click="damageDialog.mode = 'special'"
          >
            <DamageClassBadge category="Special" size="xs" />
            <span class="hp-dialog__mode-stat">Sp.Def {{ damageDialog.sdef }}</span>
          </button>
        </div>

        <label class="hp-dialog__field">
          <span>Attack type</span>
          <div class="hp-dialog__select-row">
            <TypeBadge :type="damageDialog.attackType" size="xs" />
            <select v-model="damageDialog.attackType">
              <option v-for="type in POKEMON_TYPES" :key="type" :value="type">{{ type }}</option>
            </select>
          </div>
        </label>

        <div class="hp-dialog__mode" role="group" aria-label="Damage source">
          <button
            type="button"
            class="hp-dialog__mode-button"
            :class="{ 'is-active': damageDialog.source === 'flat' }"
            :aria-pressed="damageDialog.source === 'flat'"
            @click="damageDialog.source = 'flat'"
          >
            Set damage
          </button>
          <button
            type="button"
            class="hp-dialog__mode-button"
            :class="{ 'is-active': damageDialog.source === 'db' }"
            :aria-pressed="damageDialog.source === 'db'"
            @click="damageDialog.source = 'db'"
          >
            Damage Base
          </button>
        </div>

        <label v-if="damageDialog.source === 'flat'" class="hp-dialog__field">
          <span>Damage</span>
          <input
            ref="damageAmountInput"
            v-model="damageDialog.amount"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            placeholder="0"
          />
        </label>

        <template v-else>
          <label class="hp-dialog__field">
            <span>Attacker</span>
            <select v-model="damageDialog.attackerId">
              <option :value="null">None</option>
              <option
                v-for="attacker in damageDialogAttackerOptions"
                :key="attacker.id"
                :value="attacker.id"
              >{{ attacker.species }} · Atk {{ attacker.atk }} / Sp.Atk {{ attacker.satk }}</option>
            </select>
          </label>

          <label class="hp-dialog__field">
            <span>Damage Base</span>
            <select v-model.number="damageDialog.db" @change="handleDamageDialogDbChange">
              <option
                v-for="entry in MANUAL_DAMAGE_BASE_TABLE"
                :key="entry.db"
                :value="entry.db"
              >DB {{ entry.db }} · {{ formatDamageBaseFormula(entry) }}</option>
            </select>
          </label>

          <p class="hp-dialog__note">
            DB is taken as final — STAB and other DB modifiers aren't applied.
          </p>

          <div class="hp-dialog__roll">
            <button
              type="button"
              class="hp-dialog__button hp-dialog__button--ghost"
              @click="handleDamageDialogRoll"
            >{{ damageDialog.roll ? 'Re-roll' : 'Roll' }}</button>
            <p v-if="damageDialog.roll" class="hp-dialog__roll-result">
              <span>[{{ damageDialog.roll.rolls.join(', ') }}]</span>
              <span aria-hidden="true">+</span>
              <span>{{ damageDialog.roll.mod }}</span>
              <span aria-hidden="true">=</span>
              <strong>{{ damageDialog.roll.total }}</strong>
            </p>
            <p v-else class="hp-dialog__roll-empty">No roll yet</p>
          </div>
        </template>

        <p
          v-if="damageDialogMultiplier === 0 && damageDialogRawAmount > 0"
          class="hp-dialog__breakdown is-immune"
        >
          <strong class="hp-dialog__immune-line">
            <span>Immune to</span>
            <TypeBadge :type="damageDialog.attackType" size="xs" />
            <span>— 0 HP lost</span>
          </strong>
        </p>
        <p v-else class="hp-dialog__breakdown">
          <span>{{ damageDialogRawAmount }} dmg</span>
          <template v-if="damageDialogAttackBonus > 0">
            <span aria-hidden="true">+</span>
            <span>{{ damageDialogAttackBonus }} {{ damageDialog.mode === 'physical' ? 'Atk' : 'Sp.Atk' }}</span>
          </template>
          <span aria-hidden="true">−</span>
          <span>{{ damageDialogDefense }} {{ damageDialog.mode === 'physical' ? 'Def' : 'Sp.Def' }}</span>
          <span aria-hidden="true">×</span>
          <span>{{ damageDialogMultiplierLabel }}</span>
          <span aria-hidden="true">=</span>
          <strong>{{ damageDialogHpLoss }} HP lost</strong>
        </p>

        <footer class="hp-dialog__footer">
          <button
            type="button"
            class="hp-dialog__button hp-dialog__button--ghost"
            @click="closeDamageDialog"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="hp-dialog__button hp-dialog__button--primary"
            :disabled="damageDialogRawAmount === 0 || damageDialogPreview === damageDialog.currentHp"
          >
            Apply
          </button>
        </footer>
      </form>
    </div>
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

.hp-dialog-backdrop {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: grid;
  place-items: center;
  background: rgba(29, 32, 33, 0.45);
  backdrop-filter: blur(2px);
}

.hp-dialog {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  width: min(320px, 90vw);
  padding: 1rem 1.1rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
}

.hp-dialog--wide {
  width: min(420px, 92vw);
}

.combat-stage-dialog__rows {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.combat-stage-dialog__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 4.25rem auto 3rem;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
}

.combat-stage-dialog__label {
  color: var(--ink);
  font-size: 0.88rem;
  letter-spacing: 0.02em;
}

.combat-stage-dialog__step {
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-soft);
  color: var(--ink-bright);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.combat-stage-dialog__step:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.combat-stage-dialog__step:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.combat-stage-dialog__input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-soft);
  color: var(--ink);
  padding: 0.45rem 0.55rem;
  outline: none;
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.combat-stage-dialog__input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.combat-stage-dialog__preview {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--ink-muted);
  font-weight: 700;
}

.combat-stage-dialog__preview.is-positive {
  color: #b8bb26;
}

.combat-stage-dialog__preview.is-negative {
  color: #fb4934;
}

.conditions-dialog__picker {
  max-height: min(48vh, 420px);
  overflow: auto;
  padding-right: 0.2rem;
}

.hp-dialog__header {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.hp-dialog__header h3 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
}

.hp-dialog__species {
  margin: 0;
  font-size: 0.82rem;
  color: var(--ink-muted);
  letter-spacing: 0.02em;
}

.hp-dialog__types {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
  color: var(--ink);
}

.hp-dialog__readout {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  font-variant-numeric: tabular-nums;
  font-size: 0.95rem;
  color: var(--ink);
}

.hp-dialog__arrow {
  color: var(--ink-muted);
}

.hp-dialog__preview.is-damage {
  color: #fb4934;
}

.hp-dialog__preview.is-heal {
  color: #b8bb26;
}

.hp-dialog__multiplier {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.12rem 0.55rem;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  font-weight: 600;
  border: 1px solid currentColor;
}

.hp-dialog__multiplier.is-weak {
  color: #fb4934;
  background: rgba(251, 73, 52, 0.12);
}

.hp-dialog__multiplier.is-resist {
  color: #b8bb26;
  background: rgba(184, 187, 38, 0.12);
}

.hp-dialog__multiplier.is-immune {
  color: var(--ink-muted);
  background: var(--paper);
}

.hp-dialog__mode {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

.hp-dialog__mode-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.7rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.hp-dialog__mode-button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.hp-dialog__mode-button.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.hp-dialog__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.hp-dialog__field span {
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.hp-dialog__select-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.45rem;
}

.hp-dialog__mode-stat {
  white-space: nowrap;
}

.hp-dialog__field input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.65rem 0.8rem;
  outline: none;
  font: inherit;
  font-variant-numeric: tabular-nums;
}

.hp-dialog__field input:focus,
.hp-dialog__field select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.hp-dialog__field select {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.6rem 0.8rem;
  outline: none;
  font: inherit;
  cursor: pointer;
}

.hp-dialog__roll {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.hp-dialog__roll .hp-dialog__button {
  flex: 0 0 auto;
}

.hp-dialog__roll-result {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  margin: 0;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}

.hp-dialog__roll-result strong {
  color: var(--ink-bright);
  font-weight: 600;
}

.hp-dialog__roll-empty {
  margin: 0;
  font-size: 0.82rem;
  color: var(--ink-muted);
  font-style: italic;
}

.hp-dialog__note {
  margin: -0.25rem 0 0;
  font-size: 0.78rem;
  color: var(--ink-muted);
  letter-spacing: 0.01em;
  line-height: 1.4;
}

.hp-dialog__breakdown {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  gap: 0.35rem;
  margin: 0;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-muted);
}

.hp-dialog__breakdown.is-immune {
  color: var(--ink-muted);
  border-style: dashed;
}

.hp-dialog__breakdown strong {
  color: var(--ink-bright);
  font-weight: 600;
}

.hp-dialog__immune-line {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.hp-dialog__footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

.hp-dialog__button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  padding: 0.55rem 0.8rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.hp-dialog__button--ghost {
  background: var(--paper);
  color: var(--ink);
}

.hp-dialog__button--ghost:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.hp-dialog__button--primary {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.hp-dialog__button--primary:hover:not(:disabled) {
  background: var(--accent);
  color: var(--paper);
}

.hp-dialog__button--primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
