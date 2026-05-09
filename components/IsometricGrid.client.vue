<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS3DRenderer, CSS3DSprite } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { GridAnchor, GridDimensions, SpawnedPokemon, SpriteAnimation, SpriteCrop } from '~/types/pokemon'
import type {
  LayerVisibility,
  MapFieldEffects,
  MapHazardKind,
  MapHazardV2,
  MapVoxelV2,
  VoxelMaterial,
} from '~/types/map'
import type { PreviewState } from '~/utils/grid'
import { canPlacePokemon, findPathForPokemon, getAnchorCenter, getPokemonCenter } from '~/utils/grid'
import {
  buildAllVoxelOccupancy,
  cellInsidePokemonFootprint,
  defaultBuilderVoxelColor,
  parseHexColor,
  voxelKey,
  voxelMaterialId,
  withDefaultBuilderVoxelColor,
} from '~/utils/voxels'
import { buildMapOccupancy } from '~/utils/mapOccupancy'
import { normalizeMapHazardLayer } from '~/utils/mapHazards'
import { normalizeMapFieldEffects } from '~/utils/mapFieldEffects'
import { POKEMON_TYPES, computeMultiplier, formatMultiplier } from '~/utils/typeChart'
import {
  COMBAT_STAGE_KEYS,
  COMBAT_STAGE_ROWS,
  COMBAT_STAGE_SHORT_LABELS,
  clampCombatStage,
  normalizeCombatStages,
} from '~/utils/combatStages'
import { conditionTagSvg, normalizeConditionNames } from '~/utils/statusConditions'
import { itemSpriteUrl } from '~/utils/itemSprites'
import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'
import type { BuildTool } from '~/shared/mapEditor'
import { disposeBlockTextureCache, type VoxelRenderStyle } from '~/utils/isometric/blockTextures'
import {
  buildVolumeMaterials,
  paintVolumeMaterials,
} from '~/utils/isometric/materials'
import { disposeObject3D } from '~/utils/isometric/resourceDisposal'
import {
  acquireAnimatedSpriteTexture,
  acquireStaticSpriteTexture,
  disposeSpriteSharedTextures,
  disposeSpriteTextureCaches,
  getContactShadowTexture,
  getSpriteHaloTexture,
  getTransparentSpriteTexture,
  type SpriteVisualAsset,
} from '~/utils/isometric/spriteTextures'
import type {
  BuildTarget,
  HazardTarget,
  PokemonRenderObject,
  WorldSpriteState,
} from '~/utils/isometric/types'
import { createVoxelRenderer } from '~/utils/isometric/voxelRenderer'
import {
  createHazardRenderer,
  disposeHazardTextureCache,
} from '~/utils/isometric/hazardRenderer'
import { createFieldEffectRenderer } from '~/utils/isometric/fieldEffectRenderer'
import { createGridRenderer } from '~/utils/isometric/gridRenderer'
import { createBuildGhostRenderer, createHazardGhostRenderer } from '~/utils/isometric/previewGhosts'

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

const ELEVATION_BADGE_PIXELS_PER_METRE = 48
const TOKEN_STATUS_CSS_WIDTH_PX = 80
const TOKEN_STATUS_BASE_CSS_HEIGHT_PX = 18
const TOKEN_STATUS_LABEL_LINE_CSS_HEIGHT_PX = 11
const TOKEN_STATUS_TURN_CHEVRON_CSS_HEIGHT_PX = 8
const TOKEN_STATUS_STAGE_ROW_CSS_HEIGHT_PX = 10
const TOKEN_STATUS_CONDITION_ROW_CSS_HEIGHT_PX = 15
const TOKEN_STATUS_HEAD_GAP_EXTRA = 0.3
// Matches the scaled size that Miltank landed on; every token now uses this
// same tabletop marker size instead of resizing by sprite dimensions.
const TOKEN_STATUS_WORLD_WIDTH = 1.05
const ISO_POLAR_ANGLE = THREE.MathUtils.degToRad(54.735610317245346)
const ISO_AZIMUTH_ANGLE = THREE.MathUtils.degToRad(45)
const FOCUS_CAMERA_TARGET_HEIGHT_FACTOR = 0.35
const FOCUS_CAMERA_VISIBLE_UNITS_PER_SUBJECT = 4
const FOCUS_CAMERA_MIN_VISIBLE_UNITS = 7
const FOCUS_CAMERA_MAX_VISIBLE_UNITS = 14
const DEFAULT_FACING_DIRECTION = new THREE.Vector2(
  Math.cos(ISO_AZIMUTH_ANGLE),
  Math.sin(ISO_AZIMUTH_ANGLE),
)

// Subtle directional tint matching the cage's implied light: lit
// quadrant is full brightness, shadowed quadrant dims to 0.92.
// Applied to WebGL sprite material colors.
const SPRITE_BRIGHTNESS_LIT = 1.0
const SPRITE_BRIGHTNESS_SHADOW = 0.92

// Selection lift: selected pokemon pops up while the shadow stays
// anchored and grows more diffuse. Visible separation between sprite
// and shadow is the strongest "this thing is in 3D" cue available.
const SPRITE_LIFT_AMOUNT = 0.08
const SHADOW_LIFT_SCALE = 1.3
const SHADOW_LIFT_OPACITY = 0.55

// Slight ellipse along the cage's shadow axis (±X). Mimics how shadows
// fall away from a light source instead of reading as a perfect circle.
const SHADOW_X_STRETCH = 1.15

// Directional halo: replaces the wrapper's static yellow halo with one
// that breathes with camera angle — brighter when the sprite faces the
// implied light, dimmer (not zero) when backlit. Same gruvbox yellow
// the wrapper used to have, just responsive now. One halo that means
// something instead of two halos compounding.
const SPRITE_HALO_MIN_ALPHA = 0.1
const SPRITE_HALO_MAX_ALPHA = 0.28

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

const mapSpecificY = (absoluteY: number) => Math.round(absoluteY) - normalizedGroundLevelY()

const formatElevationDelta = (localY: number): string =>
  localY > 0 ? `+${localY} ↑` : `${localY} ↓`

const EMPTY_PREVIEW: PreviewState = {
  position: null,
  reachable: false,
  pathLength: 0,
}

interface DamageBaseDef {
  db: number
  count: number
  sides: number
  mod: number
}

// PTU PHB Damage Base table. Mods are always positive in this table; the
// formatter assumes that and skips a +0 suffix only because no entry has it.
const DAMAGE_BASE_TABLE: DamageBaseDef[] = [
  { db: 1,  count: 1, sides: 6,  mod: 1 },
  { db: 2,  count: 1, sides: 6,  mod: 3 },
  { db: 3,  count: 1, sides: 6,  mod: 5 },
  { db: 4,  count: 1, sides: 6,  mod: 7 },
  { db: 5,  count: 1, sides: 8,  mod: 8 },
  { db: 6,  count: 2, sides: 6,  mod: 8 },
  { db: 7,  count: 2, sides: 6,  mod: 10 },
  { db: 8,  count: 2, sides: 8,  mod: 10 },
  { db: 9,  count: 2, sides: 10, mod: 10 },
  { db: 10, count: 3, sides: 8,  mod: 10 },
  { db: 11, count: 3, sides: 10, mod: 10 },
  { db: 12, count: 3, sides: 12, mod: 10 },
  { db: 13, count: 4, sides: 10, mod: 10 },
  { db: 14, count: 4, sides: 10, mod: 15 },
  { db: 15, count: 4, sides: 10, mod: 20 },
  { db: 16, count: 5, sides: 10, mod: 20 },
  { db: 17, count: 5, sides: 12, mod: 25 },
  { db: 18, count: 6, sides: 12, mod: 25 },
  { db: 19, count: 6, sides: 12, mod: 30 },
  { db: 20, count: 6, sides: 12, mod: 35 },
  { db: 21, count: 6, sides: 12, mod: 40 },
  { db: 22, count: 6, sides: 12, mod: 45 },
  { db: 23, count: 6, sides: 12, mod: 50 },
  { db: 24, count: 7, sides: 12, mod: 50 },
  { db: 25, count: 8, sides: 12, mod: 50 },
  { db: 26, count: 8, sides: 12, mod: 55 },
  { db: 27, count: 8, sides: 12, mod: 60 },
  { db: 28, count: 8, sides: 12, mod: 65 },
]

const formatDbFormula = (def: DamageBaseDef): string =>
  `${def.count}d${def.sides}+${def.mod}`

const rollDamageBase = (def: DamageBaseDef): { rolls: number[]; total: number } => {
  const rolls: number[] = []
  for (let i = 0; i < def.count; i += 1) {
    rolls.push(1 + Math.floor(Math.random() * def.sides))
  }
  const total = rolls.reduce((sum, n) => sum + n, 0) + def.mod
  return { rolls, total }
}

const container = ref<HTMLDivElement | null>(null)
const contextMenu = ref<{ x: number; y: number; id: string; canTurn: boolean; canViewPokedex: boolean } | null>(null)

interface CombatStagesDialogState {
  id: string
  species: string
  originalStages: CombatStageMap
  stages: CombatStageMap
}

const combatStagesDialog = ref<CombatStagesDialogState | null>(null)

const combatStagesDialogChanged = computed(() => {
  const dialog = combatStagesDialog.value
  if (!dialog) return false
  return COMBAT_STAGE_KEYS.some(
    (key) => clampCombatStage(dialog.stages[key]) !== dialog.originalStages[key],
  )
})

interface ConditionsDialogState {
  id: string
  species: string
  originalConditions: string[]
  conditions: string[]
}

const conditionsDialog = ref<ConditionsDialogState | null>(null)

const conditionsDialogChanged = computed(() => {
  const dialog = conditionsDialog.value
  if (!dialog) return false
  const current = normalizeConditionNames(dialog.conditions)
  const original = normalizeConditionNames(dialog.originalConditions)
  if (current.length !== original.length) return true
  return current.some((name, index) => name !== original[index])
})

interface HpDialogState {
  id: string
  species: string
  currentHp: number
  maxHp: number
  mode: 'damage' | 'heal'
  amount: string
}

const hpDialog = ref<HpDialogState | null>(null)
const hpAmountInput = ref<HTMLInputElement | null>(null)

const hpDialogDelta = computed(() => {
  if (!hpDialog.value) return 0
  const parsed = Number.parseInt(hpDialog.value.amount, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return hpDialog.value.mode === 'damage' ? -parsed : parsed
})

const hpDialogPreview = computed(() => {
  if (!hpDialog.value) return 0
  const next = hpDialog.value.currentHp + hpDialogDelta.value
  return Math.max(0, Math.min(hpDialog.value.maxHp, next))
})

interface DamageRollResult {
  db: number
  formula: string
  rolls: number[]
  mod: number
  total: number
}

interface DamageDialogState {
  id: string
  species: string
  currentHp: number
  maxHp: number
  def: number
  sdef: number
  defenderTypes: string[]
  mode: 'physical' | 'special'
  attackType: string
  source: 'flat' | 'db'
  amount: string
  db: number
  roll: DamageRollResult | null
  attackerId: string | null
}

const damageDialog = ref<DamageDialogState | null>(null)
const damageAmountInput = ref<HTMLInputElement | null>(null)

const damageDialogDbDef = computed(() => {
  if (!damageDialog.value) return null
  return DAMAGE_BASE_TABLE.find((entry) => entry.db === damageDialog.value!.db) ?? null
})

const damageDialogRawAmount = computed(() => {
  if (!damageDialog.value) return 0
  if (damageDialog.value.source === 'db') {
    return damageDialog.value.roll?.total ?? 0
  }
  const parsed = Number.parseInt(damageDialog.value.amount, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return parsed
})

const damageDialogDefense = computed(() => {
  if (!damageDialog.value) return 0
  return damageDialog.value.mode === 'physical'
    ? damageDialog.value.def
    : damageDialog.value.sdef
})

// Tokens on the grid the user can pick as the attacker, sorted by
// display name so the dropdown reads alphabetically.
const damageDialogAttackerOptions = computed(() =>
  [...props.pokemons].sort((a, b) => a.species.localeCompare(b.species)),
)

const damageDialogAttacker = computed(() => {
  if (!damageDialog.value?.attackerId) return null
  return props.pokemons.find((p) => p.id === damageDialog.value!.attackerId) ?? null
})

// Atk / Sp.Atk added to the rolled total. Only applied in DB mode —
// flat damage assumes the user already baked the offence stat in.
const damageDialogAttackBonus = computed(() => {
  if (!damageDialog.value || damageDialog.value.source !== 'db') return 0
  const attacker = damageDialogAttacker.value
  if (!attacker) return 0
  return damageDialog.value.mode === 'physical' ? attacker.atk : attacker.satk
})

const damageDialogMultiplier = computed(() => {
  if (!damageDialog.value) return 1
  return computeMultiplier(damageDialog.value.attackType, damageDialog.value.defenderTypes)
})

const damageDialogHpLoss = computed(() => {
  if (damageDialogRawAmount.value === 0) return 0
  // Immunity short-circuits before the 1-floor — a 0× hit deals 0.
  if (damageDialogMultiplier.value === 0) return 0
  const beforeDefense = damageDialogRawAmount.value + damageDialogAttackBonus.value
  const afterDefense = beforeDefense - damageDialogDefense.value
  const scaled = Math.floor(afterDefense * damageDialogMultiplier.value)
  // PTU floor: any successful hit deals at least 1 HP regardless of defense.
  return Math.max(1, scaled)
})

const damageDialogPreview = computed(() => {
  if (!damageDialog.value) return 0
  return Math.max(0, damageDialog.value.currentHp - damageDialogHpLoss.value)
})

const damageDialogMultiplierTone = computed(() => {
  const m = damageDialogMultiplier.value
  if (m === 0) return 'is-immune'
  if (m < 1) return 'is-resist'
  if (m > 1) return 'is-weak'
  return null
})

const damageDialogMultiplierLabel = computed(() =>
  formatMultiplier(damageDialogMultiplier.value),
)

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
// raycast stay O(footprint) instead of O(voxels) — most cells have 0
// or 1 voxels above ground, so the sorted-array scan is trivial.
const voxelColumnsByXZ = computed(() => {
  const columns = new Map<string, number[]>()
  for (const v of renderedTerrainVoxels.value) {
    const key = `${v.x},${v.z}`
    const list = columns.get(key)
    if (list) list.push(v.y)
    else columns.set(key, [v.y])
  }
  return columns
})

/**
 * Shadow surface Y for a pokemon's footprint. Walks every (x, z) cell
 * the cage covers, picks the highest voxel top that's at or below the
 * sprite's foot, and returns the max across all cells. Falls back to
 * the floor (y = 0) when nothing's below.
 *
 * Without this, a flying mon's shadow stays glued to its foot —
 * floating in mid-air over voxels, missing the surface entirely.
 */
const getShadowSurfaceY = (
  centerX: number,
  centerZ: number,
  base: number,
  footY: number,
): number => {
  const columns = voxelColumnsByXZ.value
  if (columns.size === 0) return 0

  const minX = Math.floor(centerX - base / 2)
  const minZ = Math.floor(centerZ - base / 2)
  // Tiny epsilon: treat a voxel top exactly at footY as "below" so a
  // mon standing flush on a voxel still gets a shadow on that voxel.
  const ceiling = footY + 0.001

  let surface = 0
  for (let dx = 0; dx < base; dx += 1) {
    for (let dz = 0; dz < base; dz += 1) {
      const column = columns.get(`${minX + dx},${minZ + dz}`)
      if (!column) continue
      for (const y of column) {
        const top = y + 1
        if (top <= ceiling && top > surface) surface = top
      }
    }
  }
  return surface
}

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
let renderer: THREE.WebGLRenderer | null = null
let cssRenderer: CSS3DRenderer | null = null
let camera: THREE.OrthographicCamera | null = null
let controls: OrbitControls | null = null
let resizeObserver: ResizeObserver | null = null
let animationFrame = 0
let ghostSprite: THREE.Sprite | null = null
let ghostSpriteState: WorldSpriteState | null = null
let previewElevationBadge: CSS3DSprite | null = null
let previewVolume: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial[]> | null = null
let previewEdges: THREE.LineSegments | null = null
let previewPathLine: THREE.Line | null = null
let previewOwnerId: string | null = null
let activePreview: PreviewState = { ...EMPTY_PREVIEW }
let activePreviewCanPlace = false
let activePreviewAnchor: GridAnchor | null = null
let pointerDown = { x: 0, y: 0 }
let pointerTravel = 0
let lastPointerCoords: { clientX: number; clientY: number } | null = null
let hoveredPokemonId: string | null = null

const getPreviewLayerY = () => activePreviewAnchor?.y ?? selectedPokemon.value?.position.y ?? 0

const getSceneTarget = () =>
  new THREE.Vector3(props.dimensions.x / 2, 0, props.dimensions.z / 2)

const nowMs = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

const spriteAnimationFrameAt = (animation: SpriteAnimation, elapsedMs: number) => {
  const fallbackDuration = animation.durationsMs.at(-1) ?? 100
  const totalDuration = animation.totalDurationMs > 0
    ? animation.totalDurationMs
    : animation.durationsMs.reduce((sum, duration) => sum + duration, 0)

  if (animation.frames <= 1 || totalDuration <= 0) return 0

  let remaining = ((elapsedMs % totalDuration) + totalDuration) % totalDuration
  for (let i = 0; i < animation.frames; i += 1) {
    const duration = animation.durationsMs[i] ?? fallbackDuration
    if (remaining < duration) return i
    remaining -= duration
  }
  return animation.frames - 1
}

const applyAnimationFrame = (state: WorldSpriteState, timestampMs: number) => {
  const animation = state.animationMeta
  const texture = state.texture
  if (!animation || !texture) return

  const frame = spriteAnimationFrameAt(animation, timestampMs - state.animationStartedAtMs)
  if (frame === state.currentFrame) return

  const columns = Math.max(1, animation.columns)
  const rows = Math.max(1, animation.rows)
  const column = frame % columns
  const row = Math.floor(frame / columns)
  texture.repeat.set(1 / columns, 1 / rows)
  texture.offset.set(
    column / columns,
    1 - (row + 1) / rows,
  )
  texture.needsUpdate = true
  state.currentFrame = frame
}

const spriteAssetKey = (asset: SpriteVisualAsset) => {
  const crop = asset.crop
    ? `${asset.crop.canvasWidth},${asset.crop.canvasHeight},${asset.crop.left},${asset.crop.top},${asset.crop.width},${asset.crop.height}`
    : 'full'
  return `${asset.animation?.url ?? asset.url}|${asset.animation ? 'animated' : 'static'}|${crop}`
}

const setWorldSpriteAsset = (state: WorldSpriteState, asset: SpriteVisualAsset) => {
  const key = spriteAssetKey(asset)
  if (state.assetKey === key) return

  const token = state.loadToken + 1
  state.loadToken = token
  state.assetKey = key

  const handle = asset.animation
    ? acquireAnimatedSpriteTexture(asset.animation.url)
    : acquireStaticSpriteTexture(asset.url, asset.crop)

  handle.promise
    .then((texture) => {
      if (state.loadToken !== token || state.assetKey !== key) {
        handle.release()
        return
      }

      const previousRelease = state.releaseTexture
      state.texture = texture
      state.releaseTexture = handle.release
      state.animationMeta = asset.animation ?? null
      state.currentFrame = -1
      if (state.animationMeta) {
        applyAnimationFrame(state, nowMs())
      }
      state.material.map = texture
      state.material.needsUpdate = true
      previousRelease?.()
    })
    .catch((error) => {
      handle.release()
      if (state.loadToken === token && state.assetKey === key) {
        state.assetKey = null
        console.warn('Failed to load sprite texture', asset.animation?.url ?? asset.url, error)
      }
    })
}

const setWorldSpriteVisible = (state: WorldSpriteState | null, visible: boolean) => {
  if (!state) return
  state.sprite.visible = visible
  state.halo.visible = visible
}

const setWorldSpriteInvalid = (state: WorldSpriteState | null, invalid: boolean) => {
  if (!state) return
  state.invalid = invalid
}

const updateWorldSpriteLighting = (
  state: WorldSpriteState,
  brightness: number,
  haloAlpha: number,
) => {
  if (state.ghost) {
    if (state.invalid) {
      state.material.opacity = 0.28
      state.material.color.setRGB(
        Math.min(1.4, brightness * 1.05),
        Math.min(1.0, brightness * 0.68),
        Math.min(1.0, brightness * 0.62),
      )
      state.haloMaterial.color.setHex(0xfb4934)
      state.haloMaterial.opacity = 0.16
    } else {
      state.material.opacity = 0.4
      state.material.color.setScalar(Math.min(1.35, brightness * 1.2))
      state.haloMaterial.color.setHex(0xd5c4a1)
      state.haloMaterial.opacity = 0.18
    }
    return
  }

  state.material.color.setScalar(brightness)
  state.haloMaterial.color.setHex(0xfabd2f)
  state.haloMaterial.opacity = haloAlpha
}

const buildWorldSprite = (pokemon: SpawnedPokemon, ghost = false): WorldSpriteState => {
  const material = new THREE.SpriteMaterial({
    map: getTransparentSpriteTexture(),
    alphaTest: 0.5,
    transparent: ghost,
    opacity: ghost ? 0.4 : 1,
    depthTest: true,
    depthWrite: !ghost,
    toneMapped: false,
  })
  const sprite = new THREE.Sprite(material)
  // Bottom-center anchoring keeps the feet planted at the token's
  // ground/elevation Y while preserving the old visual footprint/height.
  sprite.center.set(0.5, 0)
  sprite.scale.set(Math.max(0.1, pokemon.width), Math.max(0.1, pokemon.height), 1)
  sprite.visible = true

  const haloMaterial = new THREE.SpriteMaterial({
    map: getSpriteHaloTexture(),
    color: ghost ? 0xd5c4a1 : 0xfabd2f,
    transparent: true,
    opacity: ghost ? 0.18 : SPRITE_HALO_MIN_ALPHA,
    alphaTest: 0.02,
    // Halo is transparent eye-candy: depth-test it against terrain and
    // sprites, but never write depth or it would occlude real pixels.
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.LessDepth,
    toneMapped: false,
  })
  const halo = new THREE.Sprite(haloMaterial)
  halo.center.set(0.5, 0)
  halo.scale.set(Math.max(0.1, pokemon.width) * 1.25, Math.max(0.1, pokemon.height) * 1.15, 1)
  halo.visible = true

  const state: WorldSpriteState = {
    sprite,
    material,
    halo,
    haloMaterial,
    texture: null,
    releaseTexture: null,
    assetKey: null,
    loadToken: 0,
    animationMeta: null,
    animationStartedAtMs: nowMs(),
    currentFrame: -1,
    ghost,
    invalid: false,
  }

  setWorldSpriteAsset(state, {
    url: pokemon.spriteUrl,
    animation: pokemon.spriteAnimation,
    crop: pokemon.spriteCrop,
  })

  return state
}

const disposeWorldSprite = (state: WorldSpriteState | null) => {
  if (!state) return
  state.loadToken += 1
  state.releaseTexture?.()
  state.releaseTexture = null
  state.texture = null
  state.material.map = null
  state.sprite.parent?.remove(state.sprite)
  state.material.dispose()
  state.halo.parent?.remove(state.halo)
  state.haloMaterial.dispose()
}

const buildElevationBadge = (ghost = false) => {
  const wrapper = document.createElement('div')
  wrapper.className = `elevation-badge${ghost ? ' is-ghost' : ''}`
  wrapper.setAttribute('aria-hidden', 'true')
  wrapper.style.pointerEvents = 'none'

  const badge = new CSS3DSprite(wrapper)
  badge.element.style.pointerEvents = 'none'
  badge.scale.setScalar(1 / ELEVATION_BADGE_PIXELS_PER_METRE)
  badge.visible = false
  return badge
}

const formatTokenLevel = (level: number): string => {
  if (!Number.isFinite(level)) return '?'
  return String(Math.max(1, Math.floor(level)))
}

const tokenStatusNameWords = (displayName: string): string[] => {
  const words = displayName.trim().split(/\s+/).filter(Boolean)
  return words.length ? words : ['Unknown']
}

const tokenStatusLabelLineCount = (displayName: string): number => {
  const nameLines = tokenStatusNameWords(displayName).length
  return nameLines > 1 ? nameLines + 1 : 1
}

const activeCombatStageEntries = (stages: CombatStageMap) =>
  COMBAT_STAGE_KEYS
    .map((key) => ({ key, value: clampCombatStage(stages[key]) }))
    .filter((entry) => entry.value !== 0)

const formatCombatStage = (value: unknown): string => {
  const normalized = clampCombatStage(value)
  return normalized > 0 ? `+${normalized}` : String(normalized)
}

const tokenStatusCssHeight = (
  displayName: string,
  stages: CombatStageMap,
  conditions: readonly string[],
  activeTurn: boolean,
): number => {
  const stageCount = activeCombatStageEntries(stages).length
  const conditionCount = normalizeConditionNames(conditions).length
  const turnHeight = activeTurn ? TOKEN_STATUS_TURN_CHEVRON_CSS_HEIGHT_PX : 0
  const stageRows = stageCount === 0 ? 0 : Math.ceil(stageCount / 2)
  const conditionRows = conditionCount === 0 ? 0 : Math.ceil(conditionCount / 2)
  const labelExtraHeight = (tokenStatusLabelLineCount(displayName) - 1) * TOKEN_STATUS_LABEL_LINE_CSS_HEIGHT_PX
  return TOKEN_STATUS_BASE_CSS_HEIGHT_PX
    + labelExtraHeight
    + turnHeight
    + (stageRows ? 1 + stageRows * TOKEN_STATUS_STAGE_ROW_CSS_HEIGHT_PX : 0)
    + (conditionRows ? 1 + conditionRows * TOKEN_STATUS_CONDITION_ROW_CSS_HEIGHT_PX : 0)
}

const updateTokenStatusLabel = (
  element: HTMLElement,
  displayName: string,
  level: number,
) => {
  const label = element.querySelector<HTMLElement>('.token-status__label')
  const name = element.querySelector<HTMLElement>('.token-status__name')
  const separator = element.querySelector<HTMLElement>('.token-status__separator')
  const levelNode = element.querySelector<HTMLElement>('.token-status__level')
  const words = tokenStatusNameWords(displayName)
  const stacked = words.length > 1

  label?.classList.toggle('is-stacked-name', stacked)
  if (separator) separator.hidden = stacked

  if (name) {
    const nameKey = words.join('\n')
    if (name.dataset.displayName !== nameKey) {
      name.replaceChildren()
      for (const word of words) {
        const wordNode = document.createElement('span')
        wordNode.className = 'token-status__name-word'
        wordNode.textContent = word
        name.appendChild(wordNode)
      }
      name.dataset.displayName = nameKey
    }
  }

  if (levelNode) {
    const levelText = `Lv ${formatTokenLevel(level)}`
    if (levelNode.textContent !== levelText) levelNode.textContent = levelText
  }
}

const updateTokenCombatStages = (element: HTMLElement, stages: CombatStageMap) => {
  const strip = element.querySelector<HTMLElement>('.token-status__cs-strip')
  if (!strip) return

  const entries = activeCombatStageEntries(stages)
  strip.replaceChildren()
  strip.hidden = entries.length === 0

  for (const { key, value } of entries) {
    const chip = document.createElement('span')
    chip.className = `token-status__cs-chip ${value > 0 ? 'is-positive' : 'is-negative'}`
    chip.textContent = `${COMBAT_STAGE_SHORT_LABELS[key]} ${formatCombatStage(value)}`
    strip.appendChild(chip)
  }
}

const updateTokenConditions = (element: HTMLElement, conditions: readonly string[]) => {
  const strip = element.querySelector<HTMLElement>('.token-status__condition-strip')
  if (!strip) return

  const entries = normalizeConditionNames(conditions)
  strip.replaceChildren()
  strip.hidden = entries.length === 0

  for (const condition of entries) {
    const chip = document.createElement('span')
    chip.className = 'token-status__condition-chip'
    chip.innerHTML = conditionTagSvg(condition, 'xs')
    strip.appendChild(chip)
  }
}

const updateTokenItems = (element: HTMLElement, items: readonly string[]) => {
  const stack = element.querySelector<HTMLElement>('.token-status__item-stack')
  if (!stack) return

  const entries = items.map((item) => item.trim()).filter(Boolean)
  const key = entries.join('\u001f')
  if (stack.dataset.itemNamesKey === key) return
  stack.dataset.itemNamesKey = key

  stack.replaceChildren()
  let iconCount = 0

  for (const item of entries) {
    const src = itemSpriteUrl(item)
    const icon = src ? document.createElement('img') : document.createElement('span')
    icon.className = `token-status__item-icon${src ? '' : ' token-status__item-icon--fallback'}`
    icon.title = item
    icon.setAttribute('aria-hidden', 'true')

    if (src && icon instanceof HTMLImageElement) {
      icon.src = src
      icon.alt = ''
      icon.loading = 'lazy'
      icon.decoding = 'async'
    } else {
      icon.textContent = item.charAt(0).toUpperCase() || '•'
    }

    stack.appendChild(icon)
    iconCount += 1
  }

  stack.hidden = iconCount === 0
}

const updateTokenActiveTurn = (element: HTMLElement, activeTurn: boolean) => {
  element.classList.toggle('is-active-turn', activeTurn)
}

const applyTokenStatusScale = (status: CSS3DSprite) => {
  status.scale.setScalar(TOKEN_STATUS_WORLD_WIDTH / TOKEN_STATUS_CSS_WIDTH_PX)
}

const buildHpBar = (pokemon: SpawnedPokemon) => {
  const wrapper = document.createElement('div')
  wrapper.className = 'token-status'
  wrapper.setAttribute('aria-hidden', 'true')
  wrapper.style.pointerEvents = 'none'

  const turnChevron = document.createElement('div')
  turnChevron.className = 'token-status__turn-chevron'
  turnChevron.textContent = '⌄'

  const label = document.createElement('div')
  label.className = 'token-status__label'

  const name = document.createElement('span')
  name.className = 'token-status__name'

  const separator = document.createElement('span')
  separator.className = 'token-status__separator'
  separator.textContent = ' · '

  const level = document.createElement('span')
  level.className = 'token-status__level'

  label.append(name, separator, level)

  const combatStages = document.createElement('div')
  combatStages.className = 'token-status__cs-strip'
  combatStages.hidden = true

  const conditions = document.createElement('div')
  conditions.className = 'token-status__condition-strip'
  conditions.hidden = true

  const hpRow = document.createElement('div')
  hpRow.className = 'token-status__hp-row'

  const track = document.createElement('div')
  track.className = 'hp-bar'

  const fill = document.createElement('div')
  fill.className = 'hp-bar__fill'
  track.appendChild(fill)

  const itemStack = document.createElement('div')
  itemStack.className = 'token-status__item-stack'
  itemStack.hidden = true

  hpRow.append(track, itemStack)
  wrapper.append(turnChevron, combatStages, conditions, label, hpRow)
  updateTokenStatusLabel(wrapper, pokemon.species, pokemon.level)
  updateTokenCombatStages(wrapper, normalizeCombatStages(pokemon.combatStages))
  updateTokenConditions(wrapper, pokemon.conditions)
  updateTokenItems(wrapper, pokemon.tokenItems)

  // CSS3DSprite billboards to the camera so the status reads as a compact
  // floating HUD regardless of orbit angle.
  const bar = new CSS3DSprite(wrapper)
  bar.element.style.pointerEvents = 'none'
  applyTokenStatusScale(bar)
  bar.visible = false
  return bar
}

/**
 * Flat circular contact shadow under a pokemon sprite. Slightly larger
 * than the cage footprint so the soft alpha rim spills past the cage
 * edges, anchoring the billboarded sprite to the ground.
 */
const buildContactShadow = (
  pokemon: SpawnedPokemon,
): THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> => {
  // Scale by clearance so a Wailord doesn't share Cutiefly's shadow.
  // Base term keeps small/wide mons grounded; clearance term grows the
  // disc as the cage gets taller without making it absurdly wide.
  const radius = Math.max(pokemon.base, 0.5) * 0.55 + pokemon.clearance * 0.06
  const geometry = new THREE.CircleGeometry(radius, 32)
  const material = new THREE.MeshBasicMaterial({
    map: getContactShadowTexture(),
    transparent: true,
    depthTest: true,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  // Lay flat on the XZ plane so the disc reads as ground shadow.
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

const shouldUseFrontSprite = (center: THREE.Vector3, turned = false) => {
  if (!camera) {
    return true
  }

  const toCamera = new THREE.Vector2(camera.position.x - center.x, camera.position.z - center.z)

  if (toCamera.lengthSq() === 0) {
    return true
  }

  toCamera.normalize()
  const facing = DEFAULT_FACING_DIRECTION.clone().multiplyScalar(turned ? -1 : 1)

  return facing.dot(toCamera) >= 0
}

const updateSpriteFacing = (
  state: WorldSpriteState,
  center: THREE.Vector3,
  frontSpriteUrl: string,
  frontSpriteAnimation?: SpriteAnimation,
  backSpriteUrl?: string,
  backSpriteAnimation?: SpriteAnimation,
  spriteCrop?: SpriteCrop,
  turned = false,
) => {
  const useBack = Boolean(backSpriteUrl && !shouldUseFrontSprite(center, turned))
  setWorldSpriteAsset(state, useBack
    ? {
        url: backSpriteUrl!,
        animation: backSpriteAnimation,
      }
    : {
        url: frontSpriteUrl,
        animation: frontSpriteAnimation,
        crop: spriteCrop,
      })
}

const fallbackFrustumHeight = () =>
  Math.max(props.dimensions.x, props.dimensions.y, props.dimensions.z) * 1.7

const currentFrustumHeight = () => {
  if (!camera) return fallbackFrustumHeight()
  return Math.abs(camera.top - camera.bottom) || fallbackFrustumHeight()
}

const maxUsefulCameraZoom = () => Math.max(5, currentFrustumHeight() / FOCUS_CAMERA_MIN_VISIBLE_UNITS)

const setOrthographicFrustum = () => {
  if (!camera || !container.value) {
    return
  }

  const bounds = container.value.getBoundingClientRect()
  const aspect = bounds.width / Math.max(bounds.height, 1)
  const frustumSize = fallbackFrustumHeight()

  camera.left = (-frustumSize * aspect) / 2
  camera.right = (frustumSize * aspect) / 2
  camera.top = frustumSize / 2
  camera.bottom = -frustumSize / 2
  camera.near = -frustumSize * 6
  camera.far = frustumSize * 6
  camera.updateProjectionMatrix()
  if (controls) controls.maxZoom = maxUsefulCameraZoom()
}

const syncRendererSize = () => {
  if (!renderer || !cssRenderer || !container.value) {
    return
  }

  const bounds = container.value.getBoundingClientRect()
  renderer.setSize(bounds.width, bounds.height)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  cssRenderer.setSize(bounds.width, bounds.height)
  setOrthographicFrustum()
}

const alignCameraToGrid = (initial = false) => {
  if (!camera || !controls) {
    return
  }

  const nextTarget = getSceneTarget()

  if (initial) {
    const radius = Math.max(props.dimensions.x, props.dimensions.y, props.dimensions.z) * 2.1
    camera.position.set(
      nextTarget.x + radius * Math.sin(ISO_POLAR_ANGLE) * Math.cos(ISO_AZIMUTH_ANGLE),
      nextTarget.y + radius * Math.cos(ISO_POLAR_ANGLE),
      nextTarget.z + radius * Math.sin(ISO_POLAR_ANGLE) * Math.sin(ISO_AZIMUTH_ANGLE),
    )
  } else {
    const offset = camera.position.clone().sub(controls.target)
    camera.position.copy(nextTarget.clone().add(offset))
  }

  controls.target.copy(nextTarget)
  controls.update()
}

const fallbackCameraOffset = () => {
  const radius = Math.max(props.dimensions.x, props.dimensions.y, props.dimensions.z) * 2.1
  return new THREE.Vector3(
    radius * Math.sin(ISO_POLAR_ANGLE) * Math.cos(ISO_AZIMUTH_ANGLE),
    radius * Math.cos(ISO_POLAR_ANGLE),
    radius * Math.sin(ISO_POLAR_ANGLE) * Math.sin(ISO_AZIMUTH_ANGLE),
  )
}

const focusZoomForPokemon = (pokemon: SpawnedPokemon) => {
  if (!camera || !controls) return 1

  const subjectSpan = Math.max(
    pokemon.base,
    pokemon.clearance,
    pokemon.width,
    pokemon.height,
    1,
  )
  const desiredVisibleHeight = THREE.MathUtils.clamp(
    subjectSpan * FOCUS_CAMERA_VISIBLE_UNITS_PER_SUBJECT,
    FOCUS_CAMERA_MIN_VISIBLE_UNITS,
    FOCUS_CAMERA_MAX_VISIBLE_UNITS,
  )
  const frustumHeight = currentFrustumHeight()
  const minZoom = Number.isFinite(controls.minZoom) ? controls.minZoom : 0.1
  const maxZoom = Math.max(
    Number.isFinite(controls.maxZoom) ? controls.maxZoom : 0,
    maxUsefulCameraZoom(),
  )

  return THREE.MathUtils.clamp(frustumHeight / desiredVisibleHeight, minZoom, maxZoom)
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
  const targetHeight = Math.max(pokemon.clearance, pokemon.height, 1)
  const nextTarget = new THREE.Vector3(
    center.x,
    center.y + targetHeight * FOCUS_CAMERA_TARGET_HEIGHT_FACTOR,
    center.z,
  )
  const offset = camera.position.clone().sub(controls.target)
  const nextOffset = offset.lengthSq() > 0.0001 ? offset : fallbackCameraOffset()

  controls.target.copy(nextTarget)
  camera.position.copy(nextTarget.clone().add(nextOffset))
  camera.zoom = focusZoomForPokemon(pokemon)
  camera.updateProjectionMatrix()
  controls.update()
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

const getElevationBadgeOffset = (center: THREE.Vector3, base: number) => {
  const inset = Math.min(0.18, base / 4)
  const edgeOffset = Math.max(base / 2 - inset, 0)

  if (!camera) {
    return {
      x: edgeOffset,
      z: edgeOffset,
    }
  }

  return {
    x: (camera.position.x >= center.x ? 1 : -1) * edgeOffset,
    z: (camera.position.z >= center.z ? 1 : -1) * edgeOffset,
  }
}

const updateElevationBadge = (
  badge: CSS3DSprite,
  center: THREE.Vector3,
  base: number,
  elevation: number,
  show = true,
) => {
  const localY = mapSpecificY(elevation)
  if (!show || localY === 0) {
    badge.visible = false
    return
  }

  const offset = getElevationBadgeOffset(center, base)
  badge.position.set(center.x + offset.x, center.y + 0.08, center.z + offset.z)
  badge.element.textContent = formatElevationDelta(localY)
  badge.visible = true
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
      updateElevationBadge(
        next.elevationBadge,
        next.currentCenter,
        next.base,
        next.elevation,
        visibleLayers().tokens,
      )
    }
  }
}

const hpTierForRatio = (ratio: number): 'critical' | 'wounded' | 'healthy' => {
  if (ratio <= 0.25) return 'critical'
  if (ratio <= 0.5) return 'wounded'
  return 'healthy'
}

const updateHpBar = (
  bar: CSS3DSprite,
  center: THREE.Vector3,
  spriteHeight: number,
  displayName: string,
  level: number,
  currentHp: number,
  maxHp: number,
  combatStages: CombatStageMap,
  conditions: readonly string[],
  tokenItems: readonly string[],
  activeTurn: boolean,
  show = true,
) => {
  // Hide the whole token HUD when the token layer is disabled or HP data is
  // not meaningful. CSS3DRenderer rewrites DOM display from object.visible,
  // so keep this on the CSS3D object instead of only touching element.style.
  if (!show || maxHp <= 0) {
    bar.visible = false
    return
  }

  const ratio = Math.max(0, Math.min(1, currentHp / maxHp))
  const fill = bar.element.querySelector<HTMLElement>('.hp-bar__fill')
  if (fill) {
    fill.style.width = `${ratio * 100}%`
  }

  const track = bar.element.querySelector<HTMLElement>('.hp-bar')
  if (track) {
    track.dataset.hpTier = hpTierForRatio(ratio)
  }
  updateTokenStatusLabel(bar.element, displayName, level)
  updateTokenCombatStages(bar.element, combatStages)
  updateTokenConditions(bar.element, conditions)
  updateTokenItems(bar.element, tokenItems)
  updateTokenActiveTurn(bar.element, activeTurn)

  // Floats just above the sprite's head. WebGL world sprites are
  // bottom-anchored at ``center.y``, so the top edge is
  // ``center.y + spriteHeight``. The offset accounts for the scaled DOM
  // height so smaller sprites keep the HUD tucked close instead of floating
  // as a detached nameplate.
  const overlayHalfHeight = tokenStatusCssHeight(displayName, combatStages, conditions, activeTurn) * bar.scale.y / 2
  const headGap = THREE.MathUtils.clamp(spriteHeight * 0.06, 0.025, 0.08) + TOKEN_STATUS_HEAD_GAP_EXTRA
  bar.position.set(center.x, center.y + spriteHeight + overlayHalfHeight + headGap, center.z)
  bar.visible = true
}

const buildRenderObject = (pokemon: SpawnedPokemon): PokemonRenderObject => {
  const spriteState = buildWorldSprite(pokemon)
  const sprite = spriteState.sprite
  const elevationBadge = buildElevationBadge()
  const hpBar = buildHpBar(pokemon)
  const shadow = buildContactShadow(pokemon)
  const volumeGeometry = new THREE.BoxGeometry(pokemon.base, pokemon.clearance, pokemon.base)
  // Per-face gruvbox shading: top=fg3, Z-sides=fg4, X-sides=gray.
  // Sits in the foreground brightness band so the cage reads above
  // the bg-band terrain instead of merging with it.
  const volume = new THREE.Mesh(
    volumeGeometry,
    buildVolumeMaterials('idle', 0.28),
  )

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(volumeGeometry),
    new THREE.LineBasicMaterial({
      color: 0xa89984, // fg4
      transparent: true,
      opacity: 0.55,
      depthTest: true,
      depthWrite: false,
    }),
  )

  const pickWidth = Math.max(pokemon.base, pokemon.width, 1)
  const pickHeight = Math.max(pokemon.clearance, pokemon.height, 1)
  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(pickWidth, pickHeight, pickWidth),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    }),
  )
  proxy.userData.pokemonId = pokemon.id

  const center = getPokemonCenter(pokemon)
  const currentCenter = new THREE.Vector3(center.x, center.y, center.z)
  const targetCenter = currentCenter.clone()

  worldGroup.add(shadow)
  worldGroup.add(volume)
  worldGroup.add(edges)
  worldGroup.add(spriteState.halo)
  worldGroup.add(sprite)
  worldGroup.add(proxy)
  scene.add(elevationBadge)
  scene.add(hpBar)

  return {
    id: pokemon.id,
    sprite,
    spriteState,
    elevationBadge,
    hpBar,
    volume,
    edges,
    proxy,
    shadow,
    currentCenter,
    targetCenter,
    width: pokemon.width,
    height: pokemon.height,
    base: pokemon.base,
    clearance: pokemon.clearance,
    elevation: pokemon.position.y,
    spriteUrl: pokemon.spriteUrl,
    backSpriteUrl: pokemon.backSpriteUrl,
    spriteAnimation: pokemon.spriteAnimation,
    backSpriteAnimation: pokemon.backSpriteAnimation,
    spriteCrop: pokemon.spriteCrop,
    turned: Boolean(pokemon.turned),
    displayName: pokemon.species,
    level: pokemon.level,
    currentHp: pokemon.currentHp,
    maxHp: pokemon.maxHp,
    combatStages: normalizeCombatStages(pokemon.combatStages),
    conditions: normalizeConditionNames(pokemon.conditions),
    tokenItems: [...pokemon.tokenItems],
    liftFactor: 0,
    liftTarget: 0,
  }
}

const applyRenderObjectPosition = (renderObject: PokemonRenderObject) => {
  renderObject.sprite.position.set(
    renderObject.currentCenter.x,
    renderObject.currentCenter.y,
    renderObject.currentCenter.z,
  )
  renderObject.spriteState.halo.position.copy(renderObject.sprite.position)
  renderObject.volume.position.set(
    renderObject.currentCenter.x,
    renderObject.currentCenter.y + renderObject.clearance / 2,
    renderObject.currentCenter.z,
  )
  renderObject.edges.position.copy(renderObject.volume.position)
  renderObject.proxy.position.set(
    renderObject.currentCenter.x,
    renderObject.currentCenter.y + Math.max(renderObject.height, renderObject.clearance) / 2,
    renderObject.currentCenter.z,
  )
  // Voxel-aware projection: shadow drops to whatever surface is
  // beneath the sprite (floor or highest voxel top in the footprint),
  // not glued to the sprite's foot. Tiny y-offset dodges z-fighting
  // with the floor plane / voxel top.
  const surfaceY = getShadowSurfaceY(
    renderObject.currentCenter.x,
    renderObject.currentCenter.z,
    renderObject.base,
    renderObject.currentCenter.y,
  )
  renderObject.shadow.position.set(
    renderObject.currentCenter.x,
    surfaceY + 0.005,
    renderObject.currentCenter.z,
  )
  const layers = visibleLayers()
  updateElevationBadge(
    renderObject.elevationBadge,
    renderObject.currentCenter,
    renderObject.base,
    renderObject.elevation,
    hoveredPokemonId === renderObject.id && layers.tokens,
  )
  updateHpBar(
    renderObject.hpBar,
    renderObject.currentCenter,
    renderObject.height,
    renderObject.displayName,
    renderObject.level,
    renderObject.currentHp,
    renderObject.maxHp,
    renderObject.combatStages,
    renderObject.conditions,
    renderObject.tokenItems,
    props.activeTurnId === renderObject.id,
    layers.tokens,
  )
}

const refreshPokemonStyles = () => {
  for (const pokemon of props.pokemons) {
    const renderObject = renderObjects.get(pokemon.id)

    if (!renderObject) {
      continue
    }

    const selected = props.selectedId === pokemon.id
    // Re-tint the per-face material array with the appropriate
    // gruvbox terrain ramp instead of a single solid color.
    paintVolumeMaterials(
      renderObject.volume.material,
      selected ? 'selected' : 'idle',
      selected ? 0.32 : 0.28,
    )
    ;(renderObject.edges.material as THREE.LineBasicMaterial).color.set(selected ? 0xfbf1c7 : 0xa89984)
    // Idle edges fade so the cage reads via faces; selection sharpens
    // them back up so the active token has a clear hard outline.
    ;(renderObject.edges.material as THREE.LineBasicMaterial).opacity = selected ? 0.95 : 0.35
    renderObject.liftTarget = selected ? 1 : 0
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

    disposeWorldSprite(renderObject.spriteState)
    disposeObject3D(renderObject.elevationBadge)
    disposeObject3D(renderObject.hpBar)
    disposeObject3D(renderObject.volume)
    disposeObject3D(renderObject.edges)
    disposeObject3D(renderObject.proxy)
    disposeObject3D(renderObject.shadow)
    renderObjects.delete(id)
  }

  for (const pokemon of props.pokemons) {
    let renderObject = renderObjects.get(pokemon.id)

    if (!renderObject) {
      renderObject = buildRenderObject(pokemon)
      renderObjects.set(pokemon.id, renderObject)
      applyRenderObjectPosition(renderObject)
    }

    const center = getPokemonCenter(pokemon)
    renderObject.targetCenter.set(center.x, center.y, center.z)
    renderObject.elevation = pokemon.position.y
    renderObject.spriteUrl = pokemon.spriteUrl
    renderObject.backSpriteUrl = pokemon.backSpriteUrl
    renderObject.spriteAnimation = pokemon.spriteAnimation
    renderObject.backSpriteAnimation = pokemon.backSpriteAnimation
    renderObject.spriteCrop = pokemon.spriteCrop
    renderObject.turned = Boolean(pokemon.turned)
    renderObject.displayName = pokemon.species
    renderObject.level = pokemon.level
    renderObject.currentHp = pokemon.currentHp
    renderObject.maxHp = pokemon.maxHp
    renderObject.combatStages = normalizeCombatStages(pokemon.combatStages)
    renderObject.conditions = normalizeConditionNames(pokemon.conditions)
    renderObject.tokenItems = [...pokemon.tokenItems]
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
    const tokens = layers.tokens
    renderObject.sprite.visible = tokens
    renderObject.spriteState.halo.visible = tokens
    renderObject.volume.visible = tokens
    renderObject.edges.visible = tokens
    renderObject.proxy.visible = tokens
    renderObject.elevationBadge.visible = tokens && renderObject.elevationBadge.visible
    renderObject.hpBar.visible = tokens && renderObject.hpBar.visible
    renderObject.elevationBadge.element.style.display = tokens ? '' : 'none'
    renderObject.hpBar.element.style.display = tokens ? '' : 'none'
    renderObject.shadow.visible = layers.shadows && tokens
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
  if (!selectedPokemon.value) {
    return
  }

  if (
    previewOwnerId === selectedPokemon.value.id &&
    ghostSprite &&
    ghostSpriteState &&
    previewElevationBadge &&
    previewVolume &&
    previewEdges &&
    previewPathLine
  ) {
    return
  }

  disposeWorldSprite(ghostSpriteState)
  disposeObject3D(previewElevationBadge)
  disposeObject3D(previewVolume)
  disposeObject3D(previewEdges)
  ghostSprite = null
  ghostSpriteState = null
  previewElevationBadge = null
  previewVolume = null
  previewEdges = null

  const selected = selectedPokemon.value
  previewOwnerId = selected.id
  ghostSpriteState = buildWorldSprite(selected, true)
  ghostSprite = ghostSpriteState.sprite
  setWorldSpriteVisible(ghostSpriteState, false)
  previewGroup.add(ghostSpriteState.halo)
  previewGroup.add(ghostSprite)

  previewElevationBadge = buildElevationBadge(true)
  previewElevationBadge.visible = false
  scene.add(previewElevationBadge)

  // Preview volume gets the same per-face shading as live pokemon
  // boxes, but tinted with gruvbox yellow (reachable) or red
  // (unreachable) instead of the warm gray ramp.
  previewVolume = new THREE.Mesh(
    new THREE.BoxGeometry(selected.base, selected.clearance, selected.base),
    buildVolumeMaterials('reachable', 0.24),
  )
  previewVolume.visible = false
  previewGroup.add(previewVolume)

  previewEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(selected.base, selected.clearance, selected.base)),
    new THREE.LineBasicMaterial({
      color: 0xfbf1c7, // fg0 - bright cream highlight on the yellow box
      transparent: true,
      opacity: 0.92,
      depthTest: true,
      depthWrite: false,
    }),
  )
  previewEdges.visible = false
  previewGroup.add(previewEdges)

  if (!previewPathLine) {
    previewPathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0xfabd2f, // gruvbox yellow path trail
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        depthWrite: false,
      }),
    )
    previewPathLine.visible = false
    previewGroup.add(previewPathLine)
  }
}

const clearPreviewVisuals = () => {
  activePreview = { ...EMPTY_PREVIEW }
  activePreviewCanPlace = false
  activePreviewAnchor = null

  if (ghostSpriteState) {
    setWorldSpriteVisible(ghostSpriteState, false)
    setWorldSpriteInvalid(ghostSpriteState, false)
  }

  if (previewElevationBadge) {
    previewElevationBadge.visible = false
  }

  if (previewVolume) {
    previewVolume.visible = false
  }

  if (previewEdges) {
    previewEdges.visible = false
  }

  if (previewPathLine) {
    previewPathLine.visible = false
    previewPathLine.geometry.dispose()
    previewPathLine.geometry = new THREE.BufferGeometry()
  }

  emit('preview-change', { ...EMPTY_PREVIEW })
}

const updatePreviewAtAnchor = (anchor: GridAnchor | null) => {
  if (!selectedPokemon.value) {
    clearPreviewVisuals()
    return
  }

  ensurePreviewObjects()

  if (!anchor || !ghostSprite || !ghostSpriteState || !previewElevationBadge || !previewVolume || !previewEdges) {
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
  const center = getAnchorCenter(anchor, selected.base)

  ghostSprite.position.set(center.x, anchor.y, center.z)
  ghostSpriteState.halo.position.copy(ghostSprite.position)
  setWorldSpriteVisible(ghostSpriteState, true)
  setWorldSpriteInvalid(ghostSpriteState, !canForcePlace)

  previewVolume.position.set(center.x, anchor.y + selected.clearance / 2, center.z)
  // Repaint all 6 faces with the appropriate brightness ramp.
  paintVolumeMaterials(
    previewVolume.material,
    reachable ? 'reachable' : 'unreachable',
    reachable ? 0.24 : 0.22,
  )
  previewVolume.visible = true

  ;(previewEdges.material as THREE.LineBasicMaterial).color.set(reachable ? 0xfbf1c7 : 0xfb4934)
  previewEdges.position.copy(previewVolume.position)
  previewEdges.visible = true

  updateElevationBadge(
    previewElevationBadge,
    new THREE.Vector3(center.x, anchor.y, center.z),
    selected.base,
    anchor.y,
  )

  if (previewPathLine) {
    const points =
      path?.map((step) => {
        const waypoint = getAnchorCenter(step, selected.base)
        return new THREE.Vector3(waypoint.x, waypoint.y + selected.clearance / 2, waypoint.z)
      }) ?? []

    previewPathLine.geometry.dispose()
    previewPathLine.geometry = new THREE.BufferGeometry().setFromPoints(points)
    previewPathLine.visible = points.length >= 2
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

const setPointerFromCoords = (coords: { clientX: number; clientY: number }) => {
  if (!renderer || !camera) {
    return null
  }

  const bounds = renderer.domElement.getBoundingClientRect()
  const pointer = new THREE.Vector2(
    ((coords.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((coords.clientY - bounds.top) / bounds.height) * 2 + 1,
  )

  raycaster.setFromCamera(pointer, camera)
  return pointer
}

const pickPokemonId = (event: MouseEvent | PointerEvent) => {
  if (!camera) {
    return null
  }

  setPointerFromCoords(event)
  const proxies = Array.from(renderObjects.values(), (renderObject) => renderObject.proxy)
  const intersections = raycaster.intersectObjects(proxies, false)
  const hit = intersections[0]?.object

  return (hit?.userData.pokemonId as string | undefined) ?? null
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

const getMoveGridIntersection = (event: MouseEvent | PointerEvent, yLevel: number) => {
  if (!camera) {
    return null
  }

  setPointerFromCoords(event)
  const point = new THREE.Vector3()
  const hit = raycaster.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -yLevel),
    point,
  )

  if (!hit) {
    return null
  }

  return point
}

const updatePreviewFromPointer = (event: MouseEvent | PointerEvent) => {
  if (!selectedPokemon.value) {
    clearPreviewVisuals()
    return
  }

  const previewLayerY = getPreviewLayerY()
  const point = getMoveGridIntersection(event, previewLayerY)

  if (
    !point ||
    point.x < 0 ||
    point.x > props.dimensions.x ||
    point.z < 0 ||
    point.z > props.dimensions.z
  ) {
    clearPreviewVisuals()
    return
  }

  const maxX = props.dimensions.x - selectedPokemon.value.base
  const maxY = props.dimensions.y - selectedPokemon.value.clearance
  const maxZ = props.dimensions.z - selectedPokemon.value.base

  if (maxX < 0 || maxY < 0 || maxZ < 0) {
    clearPreviewVisuals()
    return
  }

  const anchor = {
    x: Math.min(maxX, Math.max(0, Math.round(point.x - selectedPokemon.value.base / 2))),
    y: Math.min(maxY, Math.max(0, previewLayerY)),
    z: Math.min(maxZ, Math.max(0, Math.round(point.z - selectedPokemon.value.base / 2))),
  }

  updatePreviewAtAnchor(anchor)
}

const pickBuildTarget = (
  event: MouseEvent | PointerEvent,
  tool: BuildTool,
): BuildTarget | null => {
  if (!renderer || !camera) return null
  setPointerFromCoords(event)

  const floorPlane = gridRenderer.floorPlane()
  const targets: THREE.Object3D[] = []
  if (floorPlane) targets.push(floorPlane)
  targets.push(...voxelRenderer.meshes())

  const intersections = raycaster.intersectObjects(targets, false)
  const hit = intersections[0]
  if (!hit) return null

  let voxel: MapVoxelV2 | null = null
  if (hit.object !== floorPlane) {
    const mesh = hit.object as THREE.InstancedMesh
    const voxels = mesh.userData.voxels as MapVoxelV2[] | undefined
    if (voxels && hit.instanceId !== undefined) {
      voxel = voxels[hit.instanceId] ?? null
    }
  }

  if (tool === 'eraser') {
    if (!voxel) return null
    return {
      action: 'remove',
      cell: { x: voxel.x, y: voxel.y, z: voxel.z },
      valid: true,
    }
  }

  let cell: { x: number; y: number; z: number }
  if (voxel && hit.face) {
    const normal = hit.face.normal
    cell = {
      x: voxel.x + Math.round(normal.x),
      y: voxel.y + Math.round(normal.y),
      z: voxel.z + Math.round(normal.z),
    }
  } else {
    cell = {
      x: Math.floor(hit.point.x),
      y: 0,
      z: Math.floor(hit.point.z),
    }
  }

  const inBounds =
    cell.x >= 0 &&
    cell.x < props.dimensions.x &&
    cell.y >= 0 &&
    cell.y < props.dimensions.y &&
    cell.z >= 0 &&
    cell.z < props.dimensions.z
  const key = voxelKey(cell.x, cell.y, cell.z)
  const occupiedByVoxel = allVoxelOccupancy.value.has(key)
  const occupiedByBlockingObject = mapMovementOccupancy.value.has(key)
  const insidePokemon = cellInsidePokemonFootprint(cell.x, cell.y, cell.z, props.pokemons)

  return {
    action: 'place',
    cell,
    valid: inBounds && !occupiedByVoxel && !occupiedByBlockingObject && !insidePokemon,
  }
}

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

const hazardTargetFromHit = (hit: THREE.Intersection): { x: number; y: number; z: number; kind?: MapHazardKind } | null => {
  const hazard = hit.object.userData.hazard as MapHazardV2 | undefined
  if (hazard) return { x: hazard.x, y: hazard.y, z: hazard.z, kind: hazard.kind }

  const mesh = hit.object as THREE.InstancedMesh
  const voxels = mesh.userData.voxels as MapVoxelV2[] | undefined
  const voxel = voxels && hit.instanceId !== undefined ? voxels[hit.instanceId] : null
  if (voxel) return { x: voxel.x, y: voxel.y + 1, z: voxel.z }

  return null
}

const hazardTargetFromGroundPlane = (): { x: number; y: number; z: number; kind?: MapHazardKind } | null => {
  const point = new THREE.Vector3()
  const y = normalizedGroundLevelY()
  const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), point)
  if (!hit) return null
  return { x: Math.floor(point.x), y, z: Math.floor(point.z) }
}

const pickHazardTarget = (
  event: MouseEvent | PointerEvent,
  tool: BuildTool,
): HazardTarget | null => {
  if (!renderer || !camera) return null
  setPointerFromCoords(event)

  const targets: THREE.Object3D[] = []
  targets.push(...hazardRenderer.meshes())
  targets.push(...voxelRenderer.meshes())

  const intersections = raycaster.intersectObjects(targets, false)
  const target = intersections[0]
    ? hazardTargetFromHit(intersections[0])
    : hazardTargetFromGroundPlane()
  if (!target) return null

  const cell = { x: target.x, y: target.y, z: target.z }
  const inBounds =
    cell.x >= 0 &&
    cell.x < props.dimensions.x &&
    cell.y >= 0 &&
    cell.y < props.dimensions.y &&
    cell.z >= 0 &&
    cell.z < props.dimensions.z

  if (tool === 'eraser') {
    const hasHazard = renderedHazards.value.some(
      (hazard) => hazard.x === cell.x && hazard.y === cell.y && hazard.z === cell.z,
    )
    return {
      action: 'remove',
      cell,
      kind: target.kind,
      valid: inBounds && hasHazard,
    }
  }

  return {
    action: 'place',
    cell,
    valid: inBounds,
  }
}

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
  const canTurn = Boolean(target?.entityKind === 'pokemon' && target.backSpriteUrl)
  const canViewPokedex = target?.sheetKind === 'pokemon'
  const bounds = container.value.getBoundingClientRect()
  const menuWidth = 230
  const menuButtonCount = 6 + (canViewPokedex ? 1 : 0) + (canTurn ? 1 : 0) + (props.canDeleteTokens ? 1 : 0)
  const menuHeight = 13 + menuButtonCount * 40 + Math.max(0, menuButtonCount - 1) * 5
  const padding = 12

  contextMenu.value = {
    id,
    canTurn,
    canViewPokedex,
    x: Math.min(bounds.width - menuWidth - padding, Math.max(padding, event.clientX - bounds.left)),
    y: Math.min(bounds.height - menuHeight - padding, Math.max(padding, event.clientY - bounds.top)),
  }
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

  hpDialog.value = {
    id: target.id,
    species: target.species,
    currentHp: target.currentHp,
    maxHp: target.maxHp,
    mode: 'damage',
    amount: '',
  }
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

  const stages = normalizeCombatStages(target.combatStages)
  combatStagesDialog.value = {
    id: target.id,
    species: target.species,
    originalStages: { ...stages },
    stages: { ...stages },
  }
  closeContextMenu()
}

const adjustCombatStage = (key: CombatStageKey, delta: number) => {
  if (!combatStagesDialog.value) return
  combatStagesDialog.value.stages[key] = clampCombatStage(
    clampCombatStage(combatStagesDialog.value.stages[key]) + delta,
  )
}

const normalizeCombatStageInput = (key: CombatStageKey) => {
  if (!combatStagesDialog.value) return
  combatStagesDialog.value.stages[key] = clampCombatStage(combatStagesDialog.value.stages[key])
}

const handleCombatStagesDialogSubmit = () => {
  if (!combatStagesDialog.value || !canControlPokemon(combatStagesDialog.value.id)) return
  const stages = normalizeCombatStages(combatStagesDialog.value.stages)
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

  const conditions = normalizeConditionNames(target.conditions)
  conditionsDialog.value = {
    id: target.id,
    species: target.species,
    originalConditions: [...conditions],
    conditions: [...conditions],
  }
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

  damageDialog.value = {
    id: target.id,
    species: target.species,
    currentHp: target.currentHp,
    maxHp: target.maxHp,
    def: target.def,
    sdef: target.sdef,
    defenderTypes: [...target.defenderTypes],
    mode: 'physical',
    attackType: 'Normal',
    source: 'flat',
    amount: '',
    db: 1,
    roll: null,
    attackerId: null,
  }
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
  const { rolls, total } = rollDamageBase(def)
  damageDialog.value.roll = {
    db: def.db,
    formula: formatDbFormula(def),
    rolls,
    mod: def.mod,
    total,
  }
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

  const maxY = props.dimensions.y - selectedPokemon.value.clearance

  if (maxY < 0) {
    return
  }

  const currentAnchor = activePreview.position ?? selectedPokemon.value.position
  const direction = event.deltaY < 0 ? 1 : -1
  const nextY = Math.min(maxY, Math.max(0, currentAnchor.y + direction))

  if (nextY === currentAnchor.y) {
    return
  }

  updatePreviewAtAnchor({
    ...currentAnchor,
    y: nextY,
  })
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
    SPRITE_HALO_MIN_ALPHA,
    SPRITE_HALO_MAX_ALPHA,
    lightAlignment01,
  )
  const frameNowMs = nowMs()

  for (const renderObject of renderObjects.values()) {
    updateSpriteFacing(
      renderObject.spriteState,
      renderObject.currentCenter,
      renderObject.spriteUrl,
      renderObject.spriteAnimation,
      renderObject.backSpriteUrl,
      renderObject.backSpriteAnimation,
      renderObject.spriteCrop,
      renderObject.turned,
    )
    if (renderObject.spriteState.animationMeta) {
      applyAnimationFrame(renderObject.spriteState, frameNowMs)
    }
    updateWorldSpriteLighting(renderObject.spriteState, spriteBrightness, haloAlpha)

    // Selection lift: sprite + HP bar pop up, cage stays anchored,
    // shadow scales up and fades so it reads as a more diffuse blob
    // — the visible detachment is the "off the ground" cue.
    if (Math.abs(renderObject.liftFactor - renderObject.liftTarget) < 0.001) {
      renderObject.liftFactor = renderObject.liftTarget
    } else {
      renderObject.liftFactor = THREE.MathUtils.lerp(
        renderObject.liftFactor,
        renderObject.liftTarget,
        damping,
      )
    }

    if (renderObject.liftFactor > 0) {
      const lift = renderObject.liftFactor * SPRITE_LIFT_AMOUNT
      renderObject.sprite.position.y += lift
      renderObject.spriteState.halo.position.y += lift
      if (renderObject.hpBar.visible) {
        renderObject.hpBar.position.y += lift
      }
    }

    // Non-uniform: lift grows the disc, X-stretch elongates it along
    // the cage's shadow axis so it reads as an ellipse falling away
    // from the implied light, not a perfect circle.
    const shadowScale = THREE.MathUtils.lerp(1, SHADOW_LIFT_SCALE, renderObject.liftFactor)
    renderObject.shadow.scale.set(shadowScale * SHADOW_X_STRETCH, shadowScale, 1)
    renderObject.shadow.material.opacity = THREE.MathUtils.lerp(
      1,
      SHADOW_LIFT_OPACITY,
      renderObject.liftFactor,
    )
  }

  if (ghostSprite && ghostSpriteState && selectedPokemon.value) {
    const ghostCenter = new THREE.Vector3(
      ghostSprite.position.x,
      activePreview.position?.y ?? selectedPokemon.value.position.y,
      ghostSprite.position.z,
    )
    updateSpriteFacing(
      ghostSpriteState,
      ghostCenter,
      selectedPokemon.value.spriteUrl,
      selectedPokemon.value.spriteAnimation,
      selectedPokemon.value.backSpriteUrl,
      selectedPokemon.value.backSpriteAnimation,
      selectedPokemon.value.spriteCrop,
      Boolean(selectedPokemon.value.turned),
    )
    // Ghost gets the directional tint too so it previews how the
    // pokemon will be lit at the destination.
    if (ghostSpriteState.animationMeta) {
      applyAnimationFrame(ghostSpriteState, frameNowMs)
    }
    updateWorldSpriteLighting(ghostSpriteState, spriteBrightness, haloAlpha)
  }

  renderer.render(scene, camera)
  cssRenderer.render(scene, camera)
}

onMounted(() => {
  if (!container.value) {
    return
  }

  camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 200)
  camera.up.set(0, 1, 0)
  camera.zoom = 1.1

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setClearColor(0x1d2021, 1) // gruvbox bg0_h
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  renderer.domElement.style.touchAction = 'none'

  cssRenderer = new CSS3DRenderer()
  cssRenderer.domElement.style.position = 'absolute'
  cssRenderer.domElement.style.inset = '0'
  cssRenderer.domElement.style.pointerEvents = 'none'
  cssRenderer.domElement.style.overflow = 'hidden'

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false
  controls.enableDamping = true
  controls.screenSpacePanning = false
  controls.zoomToCursor = true
  controls.enableZoom = !selectedPokemon.value
  controls.minPolarAngle = ISO_POLAR_ANGLE
  controls.maxPolarAngle = ISO_POLAR_ANGLE
  controls.minZoom = 0.4
  controls.maxZoom = maxUsefulCameraZoom()
  controls.zoomSpeed = 1.1
  controls.rotateSpeed = 0.8

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

  renderer.domElement.addEventListener('pointerdown', handlePointerDown)
  renderer.domElement.addEventListener('pointermove', handlePointerMove)
  renderer.domElement.addEventListener('pointerup', handlePointerUp)
  renderer.domElement.addEventListener('pointerleave', handlePointerLeave)
  renderer.domElement.addEventListener('contextmenu', handleRightClick)
  renderer.domElement.addEventListener('wheel', handleWheel, { passive: false })
  window.addEventListener('keydown', handleEscape)

  resizeObserver = new ResizeObserver(() => {
    syncRendererSize()
  })
  resizeObserver.observe(container.value)

  animate()
})

onBeforeUnmount(() => {
  window.cancelAnimationFrame(animationFrame)
  window.removeEventListener('keydown', handleEscape)

  if (renderer) {
    renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
    renderer.domElement.removeEventListener('pointermove', handlePointerMove)
    renderer.domElement.removeEventListener('pointerup', handlePointerUp)
    renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
    renderer.domElement.removeEventListener('contextmenu', handleRightClick)
    renderer.domElement.removeEventListener('wheel', handleWheel)
  }

  resizeObserver?.disconnect()
  resizeObserver = null

  clearPreviewVisuals()
  disposeWorldSprite(ghostSpriteState)
  ghostSprite = null
  ghostSpriteState = null
  disposeObject3D(previewElevationBadge)
  disposeObject3D(previewVolume)
  disposeObject3D(previewEdges)
  disposeObject3D(previewPathLine)
  disposeBuildGhost()
  disposeHazardGhost()
  hazardRenderer.dispose()
  fieldEffectRenderer.dispose()
  voxelRenderer.dispose()
  disposeHazardTextureCache()
  disposeBlockTextureCache()
  disposeSpriteSharedTextures()

  for (const renderObject of renderObjects.values()) {
    disposeWorldSprite(renderObject.spriteState)
    disposeObject3D(renderObject.elevationBadge)
    disposeObject3D(renderObject.hpBar)
    disposeObject3D(renderObject.volume)
    disposeObject3D(renderObject.edges)
    disposeObject3D(renderObject.proxy)
    disposeObject3D(renderObject.shadow)
  }

  renderObjects.clear()
  disposeSpriteTextureCaches()
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
        hpDialog.value.currentHp = live.currentHp
        hpDialog.value.maxHp = live.maxHp
        hpDialog.value.species = live.species
      }
    }

    if (damageDialog.value) {
      const live = props.pokemons.find((pokemon) => pokemon.id === damageDialog.value!.id)
      if (!live) {
        closeDamageDialog()
      } else {
        damageDialog.value.currentHp = live.currentHp
        damageDialog.value.maxHp = live.maxHp
        damageDialog.value.species = live.species
        damageDialog.value.def = live.def
        damageDialog.value.sdef = live.sdef
        damageDialog.value.defenderTypes = [...live.defenderTypes]
        if (
          damageDialog.value.attackerId &&
          !props.pokemons.some((p) => p.id === damageDialog.value!.attackerId)
        ) {
          damageDialog.value.attackerId = null
        }
      }
    }

    if (conditionsDialog.value) {
      const live = props.pokemons.find((pokemon) => pokemon.id === conditionsDialog.value!.id)
      if (!live) {
        closeConditionsDialog()
      } else {
        conditionsDialog.value.species = live.species
        conditionsDialog.value.originalConditions = normalizeConditionNames(live.conditions)
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
      disposeWorldSprite(ghostSpriteState)
      disposeObject3D(previewElevationBadge)
      disposeObject3D(previewVolume)
      disposeObject3D(previewEdges)
      ghostSprite = null
      ghostSpriteState = null
      previewElevationBadge = null
      previewVolume = null
      previewEdges = null
      previewOwnerId = null
      return
    }

    activePreviewAnchor = null
    activePreview = { ...EMPTY_PREVIEW }
    ensurePreviewObjects()
    emit('preview-change', { ...EMPTY_PREVIEW })
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
    <div
      v-if="contextMenu"
      class="context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @contextmenu.prevent
      @pointerdown.stop
    >
      <button
        type="button"
        class="context-menu__button"
        @click.stop="handleContextViewSheet"
      >
        View Sheet
      </button>
      <button
        v-if="contextMenu.canViewPokedex"
        type="button"
        class="context-menu__button"
        @click.stop="handleContextViewPokedex"
      >
        View in Pokédex
      </button>
      <button
        v-if="contextMenu.canTurn"
        type="button"
        class="context-menu__button"
        @click.stop="handleContextTurn"
      >
        Turn sprite
      </button>
      <button
        type="button"
        class="context-menu__button"
        @click.stop="handleContextModifyHp"
      >
        Modify HP
      </button>
      <button
        type="button"
        class="context-menu__button"
        @click.stop="handleContextModifyCombatStages"
      >
        Change combat stages
      </button>
      <button
        type="button"
        class="context-menu__button"
        @click.stop="handleContextApplyRemoveConditions"
      >
        Apply/Remove Conditions
      </button>
      <button
        type="button"
        class="context-menu__button"
        @click.stop="handleContextUseMove"
      >
        Use Move
      </button>
      <button
        type="button"
        class="context-menu__button"
        @click.stop="handleContextDealDamage"
      >
        Deal damage
      </button>
      <button
        v-if="props.canDeleteTokens"
        type="button"
        class="context-menu__button"
        @click.stop="handleContextDelete"
      >
        Delete
      </button>
    </div>

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
                v-for="entry in DAMAGE_BASE_TABLE"
                :key="entry.db"
                :value="entry.db"
              >DB {{ entry.db }} · {{ formatDbFormula(entry) }}</option>
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

.context-menu {
  position: absolute;
  z-index: 8;
  min-width: 160px;
  padding: 0.4rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(8px);
}

.context-menu__button {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.6rem 0.8rem;
  text-align: left;
  cursor: pointer;
  letter-spacing: 0.02em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.context-menu__button + .context-menu__button {
  margin-top: 0.3rem;
}

.context-menu__button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
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
