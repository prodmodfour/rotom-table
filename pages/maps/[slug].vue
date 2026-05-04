<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import IsometricGrid, { type BuildTool } from '~/components/IsometricGrid.client.vue'
import SheetBrowser, { type SheetSelection } from '~/components/SheetBrowser.vue'
import SaveIndicator from '~/components/SaveIndicator.vue'
import { useEditableMap } from '~/composables/useEditableMap'
import { useLiveSheets } from '~/composables/useLiveSheets'
import {
  catalogEntryForPokemonSheet,
  catalogEntryForTrainerSheet,
} from '~/utils/sheetSpawn'
import {
  findFirstAvailablePosition,
  normalizeDimensions,
  reconcilePokemonPositions,
} from '~/utils/grid'
import { createPlacementId, placementsToSpawned } from '~/utils/placement'
import {
  VOXEL_MATERIALS,
  buildAllVoxelOccupancy,
  cellInsidePokemonFootprint,
  filterVoxelsInBounds,
  getMaterialDef,
  hexColorString,
  voxelKey,
} from '~/utils/voxels'
import { buildMapOccupancy } from '~/utils/mapOccupancy'
import { getClientId } from '~/utils/clientId'
import { COMBAT_STAGE_KEYS, COMBAT_STAT_STAGE_KEYS, clampCombatStage } from '~/utils/combatStages'
import { resolveStats } from '~/data/characterSheets'
import { resolveTrainerStats } from '~/data/trainerSheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { GridAnchor, InitiativeTrackerState, MapVoxelV2, VoxelMaterial } from '~/types/map'
import type { PreviewState } from '~/utils/grid'
import type { SaveStatus } from '~/composables/useEditableSheet'

definePageMeta({
  key: (route) => `map-${route.params.slug}`,
})

const route = useRoute()
const router = useRouter()
const { isGm, isPlayer } = useAuth()
const slug = String(route.params.slug ?? '')

const { map, status, error, renamedTo } = useEditableMap(slug)
const { pokemonBySlug, trainerBySlug } = useLiveSheets()

watch(renamedTo, (newSlug) => {
  if (newSlug) router.replace(`/maps/${newSlug}`)
})

useHead(() => ({
  title: map.value ? `${map.value.name} · Maps` : 'Maps · Rotom Table',
}))

interface IsometricGridHandle {
  focusPokemon: (id: string) => boolean
}

const selectedId = ref<string | null>(null)
const gridRef = ref<IsometricGridHandle | null>(null)
const previewState = ref<PreviewState>({ position: null, reachable: false, pathLength: 0 })
const sidebarCollapsed = ref(false)
const initiativeCollapsed = ref(false)
const adminPanelOpen = ref(false)

const buildMode = ref(false)
const canEditMap = computed(() => isGm.value)
const canManageInitiative = computed(() => isGm.value)
const canSpawnTokens = computed(() => isGm.value)
const buildTool = ref<BuildTool>('pencil')
const buildMaterial = ref<VoxelMaterial>('airship_floor_metal')
const buildColor = ref<string | null>(null)

const layerVisibility = ref({
  terrain: true,
  shadows: true,
  tokens: true,
  grid: true,
})
const layerOptions = [
  'terrain',
  'shadows',
  'tokens',
  'grid',
] as const

const sheetLookup = computed(() => ({
  pokemon: pokemonBySlug.value!,
  trainer: trainerBySlug.value!,
}))

const spawnedPokemon = computed(() => placementsToSpawned(map.value, sheetLookup.value))
const mapVoxels = computed<MapVoxelV2[]>(() => map.value?.voxels ?? [])
const canViewMap = computed(() => !map.value || !isPlayer.value || map.value.playerVisible === true)
const controllablePlacementIds = computed(() => {
  if (!map.value) return []
  if (isGm.value) return map.value.placements.map((placement) => placement.id)
  return map.value.placements
    .filter((placement) => {
      const sheets = placement.sheetKind === 'pokemon' ? pokemonBySlug.value : trainerBySlug.value
      return sheets?.get(placement.sheetSlug)?.player === true
    })
    .map((placement) => placement.id)
})
const controllablePlacementIdSet = computed(() => new Set(controllablePlacementIds.value))
const canControlPlacement = (id: string): boolean => controllablePlacementIdSet.value.has(id)
const voxelCount = computed(() => mapVoxels.value.length)

const clampGroundLevelY = (value: unknown, height: number): number => {
  const h = Number(height)
  const max = Number.isFinite(h) ? Math.max(0, Math.floor(h) - 1) : 0
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(max, Math.max(0, Math.round(n)))
}

const groundLevelYMax = computed(() => Math.max(0, (map.value?.dimensions.y ?? 1) - 1))
const mapGroundLevelY = computed(() =>
  clampGroundLevelY(map.value?.groundLevelY ?? 0, map.value?.dimensions.y ?? 1),
)
const mapSpecificYMin = computed(() => -mapGroundLevelY.value)
const mapSpecificYMax = computed(() =>
  map.value ? map.value.dimensions.y - 1 - mapGroundLevelY.value : 0,
)

const setGroundLevelY = (event: Event) => {
  if (!map.value || !canEditMap.value) return
  map.value.groundLevelY = clampGroundLevelY(
    (event.target as HTMLInputElement).value,
    map.value.dimensions.y,
  )
}

const handleAdminShortcut = (event: KeyboardEvent) => {
  if (!isGm.value) return
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    adminPanelOpen.value = !adminPanelOpen.value
    return
  }

  if (event.key === 'Escape' && adminPanelOpen.value) {
    adminPanelOpen.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleAdminShortcut)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleAdminShortcut)
})

watch(
  [() => map.value?.slug, isPlayer],
  () => {
    if (map.value && isPlayer.value && map.value.playerVisible !== true) {
      void router.replace('/maps')
    }
  },
  { immediate: true },
)

watch(isGm, (gm) => {
  if (gm) return
  buildMode.value = false
  adminPanelOpen.value = false
  if (selectedId.value && !canControlPlacement(selectedId.value)) selectPokemon(null)
})

type InitiativeKind = 'pokemon' | 'trainer'

interface InitiativeSpritePreview {
  url: string | null
  isSpriteSheet: boolean
  frameWidth: number
  frameHeight: number
  scale: number
}

interface InitiativeRow {
  id: string
  name: string
  meta: string
  sprite: InitiativeSpritePreview
  currentHp: number
  maxHp: number
  initiative: number | null
  speed: number
}

const normalizeInitiativeValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

const speedForPlacement = (kind: InitiativeKind, sheetSlug: string): number => {
  if (kind === 'pokemon') {
    const sheet = pokemonBySlug.value?.get(sheetSlug)
    if (!sheet) return 0
    return resolveStats(sheet).find((row) => row.key === 'spd')?.total ?? 0
  }
  const sheet = trainerBySlug.value?.get(sheetSlug)
  if (!sheet) return 0
  return resolveTrainerStats(sheet).find((row) => row.key === 'spd')?.total ?? 0
}

const metaForPlacement = (kind: InitiativeKind, sheetSlug: string): string => {
  if (kind === 'pokemon') {
    const sheet = pokemonBySlug.value?.get(sheetSlug)
    return sheet ? `${sheet.species} · Lv ${sheet.level}` : 'Pokémon'
  }
  const sheet = trainerBySlug.value?.get(sheetSlug)
  const className = sheet?.classes?.[0]?.name
  if (!sheet) return 'Trainer'
  return className ? `Trainer · Lv ${sheet.level} · ${className}` : `Trainer · Lv ${sheet.level}`
}

const initiativeSpriteScale = (width: number, height: number): number =>
  Math.min(1, 32 / Math.max(width, height, 1))

const initiativeSpriteFor = (pokemon: SpawnedPokemon): InitiativeSpritePreview => {
  const animation = pokemon.spriteAnimation
  if (animation) {
    return {
      url: animation.url,
      isSpriteSheet: true,
      frameWidth: animation.frameWidth,
      frameHeight: animation.frameHeight,
      scale: initiativeSpriteScale(animation.frameWidth, animation.frameHeight),
    }
  }

  return {
    url: pokemon.spriteUrl ?? null,
    isSpriteSheet: false,
    frameWidth: 32,
    frameHeight: 32,
    scale: 1,
  }
}

const initiativeSpriteFrameStyle = (entry: InitiativeRow): Record<string, string> => ({
  backgroundImage: entry.sprite.url ? `url(${entry.sprite.url})` : 'none',
  width: `${entry.sprite.frameWidth}px`,
  height: `${entry.sprite.frameHeight}px`,
  transform: `scale(${entry.sprite.scale})`,
})

const initiativeRows = computed<InitiativeRow[]>(() => {
  const placements = new Map((map.value?.placements ?? []).map((placement) => [placement.id, placement]))
  return spawnedPokemon.value.map((pokemon) => {
    const placement = placements.get(pokemon.id)
    return {
      id: pokemon.id,
      name: pokemon.species,
      meta: metaForPlacement(pokemon.sheetKind, pokemon.sheetSlug),
      sprite: initiativeSpriteFor(pokemon),
      currentHp: Math.max(0, Math.floor(pokemon.currentHp)),
      maxHp: Math.max(0, Math.floor(pokemon.maxHp)),
      initiative: normalizeInitiativeValue(placement?.initiative),
      speed: speedForPlacement(pokemon.sheetKind, pokemon.sheetSlug),
    }
  })
})

const sortedInitiativeRows = computed<InitiativeRow[]>(() =>
  [...initiativeRows.value].sort((a, b) => {
    const aHasInitiative = a.initiative !== null
    const bHasInitiative = b.initiative !== null
    if (aHasInitiative !== bHasInitiative) return aHasInitiative ? -1 : 1
    if (a.initiative !== null && b.initiative !== null && a.initiative !== b.initiative) {
      return b.initiative - a.initiative
    }
    if (a.speed !== b.speed) return b.speed - a.speed
    return a.name.localeCompare(b.name)
  }),
)

const validInitiativeIds = computed(() => new Set(initiativeRows.value.map((row) => row.id)))
const activeInitiativeId = computed(() => {
  const id = map.value?.initiative?.activeId ?? null
  return id && validInitiativeIds.value.has(id) ? id : null
})
const initiativeRound = computed(() => {
  const round = Math.floor(Number(map.value?.initiative?.round ?? 1))
  return Number.isFinite(round) && round > 0 ? round : 1
})
const hasInitiativeValues = computed(() =>
  (map.value?.placements ?? []).some((placement) => normalizeInitiativeValue(placement.initiative) !== null),
)

const materialCanBeBuilt = (material: { transparent?: boolean; tags?: readonly string[] }) =>
  !material.transparent || (material.tags ?? []).includes('water')

const visibleVoxelMaterials = computed(() => VOXEL_MATERIALS.filter(materialCanBeBuilt))
const activeMaterialDef = computed(() => getMaterialDef(buildMaterial.value))
const colorPickerValue = computed(() =>
  buildColor.value ?? hexColorString(activeMaterialDef.value.baseColor),
)

const saveIndicatorStatus = computed<SaveStatus | null>(() => {
  if (status.value === 'saving') return 'saving'
  if (status.value === 'saved') return 'saved'
  if (status.value === 'error') return 'error'
  return null
})

const ensureInitiativeState = (): InitiativeTrackerState | null => {
  if (!map.value) return null
  if (!map.value.initiative || typeof map.value.initiative !== 'object') {
    map.value.initiative = { activeId: null, round: 1 }
  }
  const round = Math.floor(Number(map.value.initiative.round ?? 1))
  map.value.initiative.round = Number.isFinite(round) && round > 0 ? round : 1
  return map.value.initiative
}

const placementById = (id: string) => map.value?.placements.find((placement) => placement.id === id) ?? null

const hpPercent = (entry: InitiativeRow): string => {
  if (entry.maxHp <= 0) return '0%'
  const percent = Math.max(0, Math.min(100, (entry.currentHp / entry.maxHp) * 100))
  return `${percent}%`
}

const hpTier = (entry: InitiativeRow): 'critical' | 'wounded' | 'healthy' => {
  if (entry.maxHp <= 0) return 'critical'
  const ratio = Math.max(0, Math.min(1, entry.currentHp / entry.maxHp))
  if (ratio <= 0.25) return 'critical'
  if (ratio <= 0.5) return 'wounded'
  return 'healthy'
}

const focusInitiativeEntry = (id: string) => {
  gridRef.value?.focusPokemon(id)
}

const setActiveInitiative = (id: string) => {
  if (!canManageInitiative.value) return
  const state = ensureInitiativeState()
  if (!state) return
  state.activeId = id
}

const setActiveInitiativeAndFocus = (id: string) => {
  setActiveInitiative(id)
  focusInitiativeEntry(id)
}

const setInitiativeInput = (id: string, event: Event) => {
  if (!canManageInitiative.value) return
  const placement = placementById(id)
  if (!placement) return
  const raw = (event.target as HTMLInputElement).value.trim()
  if (!raw) {
    delete placement.initiative
    return
  }
  const n = Number(raw)
  if (!Number.isFinite(n)) return
  placement.initiative = Math.max(-999, Math.min(999, Math.trunc(n)))
}

const setInitiativeFromSpeed = (id: string, speed: number) => {
  if (!canManageInitiative.value) return
  const placement = placementById(id)
  if (!placement) return
  if (!Number.isFinite(speed)) return
  placement.initiative = Math.max(-999, Math.min(999, Math.trunc(speed)))
}

const setInitiativeRound = (event: Event) => {
  if (!canManageInitiative.value) return
  const state = ensureInitiativeState()
  if (!state) return
  const raw = (event.target as HTMLInputElement).value.trim()
  if (!raw) {
    state.round = 1
    return
  }
  const n = Number(raw)
  state.round = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1
}

const fillInitiativeFromSpeed = () => {
  if (!map.value || !canManageInitiative.value) return
  const speeds = new Map(initiativeRows.value.map((entry) => [entry.id, entry.speed]))
  for (const placement of map.value.placements) {
    const speed = speeds.get(placement.id)
    if (speed !== undefined) placement.initiative = speed
  }
}

const clearInitiativeValues = () => {
  if (!map.value || !canManageInitiative.value) return
  for (const placement of map.value.placements) delete placement.initiative
  const state = ensureInitiativeState()
  if (state) {
    state.activeId = null
    state.round = 1
  }
}

const clearActiveInitiative = () => {
  if (!map.value?.initiative || !canManageInitiative.value) return
  map.value.initiative.activeId = null
}

const nextInitiative = () => {
  if (!canManageInitiative.value) return
  const order = sortedInitiativeRows.value
  if (!order.length) return
  const state = ensureInitiativeState()
  if (!state) return

  const ids = order.map((entry) => entry.id)
  const currentIndex = state.activeId ? ids.indexOf(state.activeId) : -1
  const nextIndex = currentIndex >= 0 && currentIndex < ids.length - 1 ? currentIndex + 1 : 0
  if (currentIndex === ids.length - 1) state.round = initiativeRound.value + 1
  state.activeId = ids[nextIndex]
}

const previousInitiative = () => {
  if (!canManageInitiative.value) return
  const order = sortedInitiativeRows.value
  if (!order.length) return
  const state = ensureInitiativeState()
  if (!state) return

  const ids = order.map((entry) => entry.id)
  const currentIndex = state.activeId ? ids.indexOf(state.activeId) : -1
  const previousIndex = currentIndex > 0 ? currentIndex - 1 : ids.length - 1
  if (currentIndex === 0) state.round = Math.max(1, initiativeRound.value - 1)
  state.activeId = ids[previousIndex]
}

const spawnSheet = (selection: SheetSelection) => {
  if (!map.value || !canSpawnTokens.value) return
  const catalog =
    selection.kind === 'pokemon'
      ? catalogEntryForPokemonSheet(selection.sheet)
      : catalogEntryForTrainerSheet(selection.sheet)
  if (!catalog) return
  const occupiedKeys = buildMapOccupancy({
    voxels: mapVoxels.value,
  })
  const position = findFirstAvailablePosition(
    catalog,
    spawnedPokemon.value,
    map.value.dimensions,
    null,
    occupiedKeys,
    mapGroundLevelY.value,
  )
  if (!position) return

  map.value.placements.push({
    id: createPlacementId(),
    sheetKind: selection.kind,
    sheetSlug: selection.sheet.slug,
    position,
    turned: false,
  })
  selectedId.value = null
  previewState.value = { position: null, reachable: false, pathLength: 0 }
}

const selectPokemon = (id: string | null) => {
  if (buildMode.value) return
  if (id && !canControlPlacement(id)) return
  selectedId.value = id
  if (!id) previewState.value = { position: null, reachable: false, pathLength: 0 }
}

const deletePokemon = (id: string) => {
  if (!map.value || !isGm.value || !canControlPlacement(id)) return
  map.value.placements = map.value.placements.filter((p) => p.id !== id)
  if (map.value.initiative?.activeId === id) map.value.initiative.activeId = null
  if (selectedId.value === id) selectPokemon(null)
}

const turnPokemon = (id: string) => {
  if (!map.value || !canControlPlacement(id)) return
  const placement = map.value.placements.find((p) => p.id === id)
  if (!placement) return
  placement.turned = !placement.turned
}

const movePokemon = (payload: { id: string; position: GridAnchor }) => {
  if (!map.value || !canControlPlacement(payload.id)) return
  const placement = map.value.placements.find((p) => p.id === payload.id)
  if (!placement) return
  placement.position = payload.position
  selectPokemon(null)
}

const modifyHp = async (payload: { id: string; currentHp: number }) => {
  if (!map.value || !canControlPlacement(payload.id)) return
  const placement = map.value.placements.find((p) => p.id === payload.id)
  if (!placement) return

  const clientId = getClientId()
  const clamped = Math.max(0, Math.floor(payload.currentHp))

  if (placement.sheetKind === 'pokemon') {
    const sheets = pokemonBySlug.value
    if (!sheets) return
    const original = sheets.get(placement.sheetSlug)
    if (!original) return
    const updated = JSON.parse(JSON.stringify(original)) as CharacterSheet
    updated.combat = { ...(updated.combat ?? {}), currentHp: clamped }
    sheets.set(placement.sheetSlug, updated)

    try {
      const payloadOut: Record<string, unknown> = { ...(updated as unknown as Record<string, unknown>) }
      delete payloadOut.folder
      await $fetch('/api/sheets/save', {
        method: 'POST',
        body: { kind: 'pokemon', slug: placement.sheetSlug, sheet: payloadOut, clientId },
      })
    } catch (err) {
      sheets.set(placement.sheetSlug, original)
      console.error('[modifyHp] save failed', err)
    }
    return
  }

  const sheets = trainerBySlug.value
  if (!sheets) return
  const original = sheets.get(placement.sheetSlug)
  if (!original) return
  const updated = JSON.parse(JSON.stringify(original)) as TrainerSheet
  updated.currentHp = clamped
  sheets.set(placement.sheetSlug, updated)

  try {
    const payloadOut: Record<string, unknown> = { ...(updated as unknown as Record<string, unknown>) }
    delete payloadOut.folder
    await $fetch('/api/sheets/save', {
      method: 'POST',
      body: { kind: 'trainer', slug: placement.sheetSlug, sheet: payloadOut, clientId },
    })
  } catch (err) {
    sheets.set(placement.sheetSlug, original)
    console.error('[modifyHp] save failed', err)
  }
}

const modifyCombatStages = async (payload: { id: string; stages: CombatStageMap }) => {
  if (!map.value || !canControlPlacement(payload.id)) return
  const placement = map.value.placements.find((p) => p.id === payload.id)
  if (!placement) return

  const clientId = getClientId()
  const stages = Object.fromEntries(
    COMBAT_STAGE_KEYS.map((key) => [key, clampCombatStage(payload.stages[key])]),
  ) as CombatStageMap

  if (placement.sheetKind === 'pokemon') {
    const sheets = pokemonBySlug.value
    if (!sheets) return
    const original = sheets.get(placement.sheetSlug)
    if (!original) return
    const updated = JSON.parse(JSON.stringify(original)) as CharacterSheet
    updated.stats = { ...(updated.stats ?? {}) }
    for (const key of COMBAT_STAT_STAGE_KEYS) {
      updated.stats[key] = { ...(updated.stats[key] ?? {}), stage: stages[key] }
    }
    updated.combatStages = { ...(updated.combatStages ?? {}), acc: stages.acc }
    sheets.set(placement.sheetSlug, updated)

    try {
      const payloadOut: Record<string, unknown> = { ...(updated as unknown as Record<string, unknown>) }
      delete payloadOut.folder
      await $fetch('/api/sheets/save', {
        method: 'POST',
        body: { kind: 'pokemon', slug: placement.sheetSlug, sheet: payloadOut, clientId },
      })
    } catch (err) {
      sheets.set(placement.sheetSlug, original)
      console.error('[modifyCombatStages] save failed', err)
    }
    return
  }

  const sheets = trainerBySlug.value
  if (!sheets) return
  const original = sheets.get(placement.sheetSlug)
  if (!original) return
  const updated = JSON.parse(JSON.stringify(original)) as TrainerSheet
  updated.stats = { ...(updated.stats ?? {}) }
  for (const key of COMBAT_STAT_STAGE_KEYS) {
    updated.stats[key] = { ...(updated.stats[key] ?? {}), stage: stages[key] }
  }
  updated.combatStages = { ...(updated.combatStages ?? {}), acc: stages.acc }
  sheets.set(placement.sheetSlug, updated)

  try {
    const payloadOut: Record<string, unknown> = { ...(updated as unknown as Record<string, unknown>) }
    delete payloadOut.folder
    await $fetch('/api/sheets/save', {
      method: 'POST',
      body: { kind: 'trainer', slug: placement.sheetSlug, sheet: payloadOut, clientId },
    })
  } catch (err) {
    sheets.set(placement.sheetSlug, original)
    console.error('[modifyCombatStages] save failed', err)
  }
}

const updatePreview = (next: PreviewState) => {
  previewState.value = next
}

const placeVoxel = (voxel: MapVoxelV2) => {
  if (!map.value || !canEditMap.value) return
  const next = map.value.voxels.filter(
    (v) => !(v.x === voxel.x && v.y === voxel.y && v.z === voxel.z),
  )
  next.push(voxel)
  map.value.voxels = next
}

const removeVoxel = (cell: { x: number; y: number; z: number }) => {
  if (!map.value || !canEditMap.value) return
  map.value.voxels = map.value.voxels.filter(
    (v) => !(v.x === cell.x && v.y === cell.y && v.z === cell.z),
  )
}

const setMode = (mode: 'play' | 'build') => {
  if (mode === 'build' && !canEditMap.value) return
  const next = mode === 'build'
  if (buildMode.value === next) return
  buildMode.value = next
  if (next) {
    selectedId.value = null
    previewState.value = { position: null, reachable: false, pathLength: 0 }
  }
}

const selectMaterial = (material: VoxelMaterial) => {
  if (!canEditMap.value || !materialCanBeBuilt(getMaterialDef(material))) return
  buildMaterial.value = material
  buildColor.value = null
}

const setTool = (tool: BuildTool) => {
  if (!canEditMap.value) return
  buildTool.value = tool
}

const handleColorInput = (event: Event) => {
  if (!canEditMap.value) return
  const value = (event.target as HTMLInputElement).value
  buildColor.value = value
}

const clearCustomColor = () => {
  if (!canEditMap.value) return
  buildColor.value = null
}

const fillGround = () => {
  if (!map.value || !canEditMap.value) return
  const dims = map.value.dimensions
  const voxelOccupancy = buildAllVoxelOccupancy(mapVoxels.value)
  const mapOccupancy = buildMapOccupancy({
    voxels: mapVoxels.value,
  })
  const additions: MapVoxelV2[] = []
  const groundY = mapGroundLevelY.value
  for (let z = 0; z < dims.z; z += 1) {
    for (let x = 0; x < dims.x; x += 1) {
      const key = voxelKey(x, groundY, z)
      if (voxelOccupancy.has(key)) continue
      if (mapOccupancy.has(key)) continue
      if (cellInsidePokemonFootprint(x, groundY, z, spawnedPokemon.value)) continue
      const voxel: MapVoxelV2 = { x, y: groundY, z, materialId: buildMaterial.value }
      if (buildColor.value) voxel.color = buildColor.value
      additions.push(voxel)
    }
  }
  if (!additions.length) return
  map.value.voxels = [...map.value.voxels, ...additions]
}

const clearAllVoxels = () => {
  if (!map.value || !canEditMap.value) return
  if (!map.value.voxels.length) return
  const ok = window.confirm(
    `Remove all ${map.value.voxels.length} terrain blocks? This cannot be undone.`,
  )
  if (!ok) return
  map.value.voxels = []
}

watch(
  () => map.value?.dimensions,
  (dims) => {
    if (!dims || !map.value) return
    const normalized = normalizeDimensions(dims)
    if (normalized.x !== dims.x) map.value.dimensions.x = normalized.x
    if (normalized.y !== dims.y) map.value.dimensions.y = normalized.y
    if (normalized.z !== dims.z) map.value.dimensions.z = normalized.z

    if (map.value.groundLevelY !== undefined) {
      const normalizedGroundLevelY = clampGroundLevelY(map.value.groundLevelY, normalized.y)
      if (normalizedGroundLevelY !== map.value.groundLevelY) {
        map.value.groundLevelY = normalizedGroundLevelY
      }
    }

    const trimmedVoxels = filterVoxelsInBounds(map.value.voxels, normalized)
    if (trimmedVoxels.length !== map.value.voxels.length) {
      map.value.voxels = trimmedVoxels
    }

    const reconciliation = reconcilePokemonPositions(
      spawnedPokemon.value,
      normalized,
      trimmedVoxels,
      // Manual token placement is allowed to overlap terrain. Dimension
      // reconciliation should only fix out-of-bounds/token-overlap issues,
      // not eject characters a GM intentionally tucked into terrain blocks.
      new Set<string>(),
    )
    const byId = new Map(reconciliation.pokemons.map((p) => [p.id, p.position]))
    map.value.placements = map.value.placements.flatMap((placement) => {
      const next = byId.get(placement.id)
      if (!next) return []
      return [{ ...placement, position: next }]
    })
    if (selectedId.value && !map.value.placements.some((p) => p.id === selectedId.value)) {
      selectPokemon(null)
    }
  },
  { deep: true },
)

watch(
  () => [map.value?.initiative?.activeId ?? null, initiativeRows.value.map((row) => row.id).join('|')] as const,
  ([activeId]) => {
    if (!activeId || !map.value?.initiative) return
    if (!validInitiativeIds.value.has(activeId)) map.value.initiative.activeId = null
  },
)

watch(
  () => [selectedId.value, controllablePlacementIds.value.join('|')] as const,
  ([id]) => {
    if (id && !canControlPlacement(id)) selectPokemon(null)
  },
)
</script>

<template>
  <div
    class="layout-shell"
    :class="{
      'layout-shell--sidebar-collapsed': sidebarCollapsed,
      'layout-shell--initiative-collapsed': initiativeCollapsed,
    }"
  >
    <aside
      class="sidebar"
      :class="{ 'sidebar--collapsed': sidebarCollapsed }"
      :aria-label="sidebarCollapsed ? 'Collapsed map sidebar' : 'Map sidebar'"
    >
      <div class="sidebar-toggle-row">
        <button
          type="button"
          class="sidebar-toggle"
          :aria-expanded="!sidebarCollapsed"
          aria-controls="map-sidebar-content"
          :aria-label="sidebarCollapsed ? 'Expand map sidebar' : 'Collapse map sidebar'"
          :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          <span aria-hidden="true">{{ sidebarCollapsed ? '›' : '‹' }}</span>
          <span class="sidebar-toggle__label">{{ sidebarCollapsed ? 'Expand' : 'Collapse' }}</span>
        </button>
      </div>

      <div id="map-sidebar-content" v-show="!sidebarCollapsed" class="sidebar-content">
        <AppNavigation />

        <div class="header-row">
          <NuxtLink to="/maps" class="back-link">← All maps</NuxtLink>
          <SaveIndicator
            v-if="saveIndicatorStatus"
            :status="saveIndicatorStatus"
            :error="error"
          />
        </div>

        <section v-if="map && canViewMap" class="panel-card">
        <div class="panel-heading">
          <h2>{{ map.name }}</h2>
          <span class="badge">
            {{ map.dimensions.x }} × {{ map.dimensions.y }} × {{ map.dimensions.z }}
          </span>
        </div>

        <label v-if="isGm" class="visibility-toggle" :class="{ active: map.playerVisible }">
          <input v-model="map.playerVisible" type="checkbox" />
          Player visible
        </label>
        <p v-else class="permission-note">
          Player view: this map is visible, but GM-only map settings are locked.
        </p>

        <div class="dimension-grid">
          <label>
            <span>Width (X)</span>
            <input v-model.number="map.dimensions.x" type="number" min="1" max="200" :disabled="!canEditMap" />
          </label>
          <label>
            <span>Height (Y)</span>
            <input v-model.number="map.dimensions.y" type="number" min="1" max="200" :disabled="!canEditMap" />
          </label>
          <label>
            <span>Depth (Z)</span>
            <input v-model.number="map.dimensions.z" type="number" min="1" max="200" :disabled="!canEditMap" />
          </label>
        </div>
      </section>

      <section v-if="map && canViewMap" class="panel-card terrain-panel">
        <div class="panel-heading">
          <h2>Terrain</h2>
          <span class="badge">{{ voxelCount }} block{{ voxelCount === 1 ? '' : 's' }}</span>
        </div>

        <div v-if="canEditMap" class="mode-row" role="group" aria-label="Editor mode">
          <button
            type="button"
            class="mode-button"
            :class="{ 'is-active': !buildMode }"
            :aria-pressed="!buildMode"
            @click="setMode('play')"
          >
            Play
          </button>
          <button
            type="button"
            class="mode-button"
            :class="{ 'is-active': buildMode }"
            :aria-pressed="buildMode"
            @click="setMode('build')"
          >
            Build
          </button>
        </div>
        <p v-else class="permission-note">
          Terrain editing is GM-only.
        </p>

        <template v-if="buildMode && canEditMap">
          <div class="tool-row" role="group" aria-label="Build tool">
            <button
              type="button"
              class="tool-button"
              :class="{ 'is-active': buildTool === 'pencil' }"
              :aria-pressed="buildTool === 'pencil'"
              @click="setTool('pencil')"
            >
              Pencil
            </button>
            <button
              type="button"
              class="tool-button"
              :class="{ 'is-active': buildTool === 'eraser' }"
              :aria-pressed="buildTool === 'eraser'"
              @click="setTool('eraser')"
            >
              Eraser
            </button>
          </div>

          <div class="materials-grid" role="group" aria-label="Terrain material">
            <button
              v-for="material in visibleVoxelMaterials"
              :key="material.material"
              type="button"
              class="material-swatch"
              :class="{
                'is-active': buildMaterial === material.material && !buildColor,
              }"
              :aria-pressed="buildMaterial === material.material && !buildColor"
              @click="selectMaterial(material.material)"
            >
              <span
                class="swatch-color"
                :style="{ background: hexColorString(material.baseColor) }"
                aria-hidden="true"
              />
              <span class="swatch-label">{{ material.label }}</span>
            </button>
          </div>

          <div class="color-row">
            <label class="color-picker">
              <span>Custom color</span>
              <input
                type="color"
                :value="colorPickerValue"
                @input="handleColorInput"
              />
            </label>
            <button
              v-if="buildColor"
              type="button"
              class="ghost-button"
              @click="clearCustomColor"
            >
              Reset
            </button>
          </div>

          <p class="hint">
            Left click to {{ buildTool === 'pencil' ? 'place' : 'erase' }}, right click to
            erase. Click a voxel face to stack on top.
          </p>

          <div class="bulk-row">
            <button
              type="button"
              class="bulk-button"
              :disabled="buildTool === 'eraser'"
              @click="fillGround"
            >
              Fill ground
            </button>
            <button
              type="button"
              class="bulk-button bulk-button--danger"
              :disabled="!voxelCount"
              @click="clearAllVoxels"
            >
              Clear all
            </button>
          </div>

          <div class="build-section layer-panel">
            <div class="panel-heading panel-heading--compact">
              <h2>Layers</h2>
              <span class="badge">visibility</span>
            </div>
            <div class="layer-grid">
              <label v-for="layer in layerOptions" :key="layer" class="layer-toggle">
                <input v-model="layerVisibility[layer]" type="checkbox" />
                <span>{{ layer.replace(/([A-Z])/g, ' $1') }}</span>
              </label>
            </div>
          </div>
        </template>
      </section>

        <SheetBrowser v-if="map && canSpawnTokens" @select="spawnSheet" />
      </div>
    </aside>

    <main class="scene-column">
      <ClientOnly>
        <IsometricGrid
          v-if="map && canViewMap"
          ref="gridRef"
          :dimensions="map.dimensions"
          :pokemons="spawnedPokemon"
          :selected-id="selectedId"
          :controllable-ids="controllablePlacementIds"
          :active-turn-id="activeInitiativeId"
          :voxels="mapVoxels"
          :ground-level-y="mapGroundLevelY"
          :layer-visibility="layerVisibility"
          :build-mode="buildMode && canEditMap"
          :build-tool="buildTool"
          :build-material="buildMaterial"
          :build-color="buildColor"
          :can-delete-tokens="isGm"
          @select-pokemon="selectPokemon"
          @move-pokemon="movePokemon"
          @turn-pokemon="turnPokemon"
          @delete-pokemon="deletePokemon"
          @modify-hp="modifyHp"
          @modify-combat-stages="modifyCombatStages"
          @preview-change="updatePreview"
          @place-voxel="placeVoxel"
          @remove-voxel="removeVoxel"
        />
        <div v-else-if="status === 'loading'" class="scene-loading">Loading map…</div>
        <div v-else-if="status === 'not-found'" class="scene-loading">
          <p>Map <code>{{ slug }}</code> not found.</p>
          <NuxtLink to="/maps" class="back-link">← Back to maps</NuxtLink>
        </div>
        <div v-else class="scene-loading">
          <p>{{ error ?? 'Could not load map.' }}</p>
        </div>

        <template #fallback>
          <div class="scene-loading">Loading the three.js tabletop…</div>
        </template>
      </ClientOnly>
    </main>

    <aside
      class="initiative-sidebar"
      :class="{ 'initiative-sidebar--collapsed': initiativeCollapsed }"
      :aria-label="initiativeCollapsed ? 'Collapsed initiative tracker' : 'Initiative tracker'"
    >
      <div class="initiative-toggle-row">
        <button
          type="button"
          class="initiative-toggle"
          :aria-expanded="!initiativeCollapsed"
          aria-controls="initiative-tracker-content"
          :aria-label="initiativeCollapsed ? 'Expand initiative tracker' : 'Collapse initiative tracker'"
          :title="initiativeCollapsed ? 'Expand initiative' : 'Collapse initiative'"
          @click="initiativeCollapsed = !initiativeCollapsed"
        >
          <span aria-hidden="true">{{ initiativeCollapsed ? '‹' : '›' }}</span>
          <span class="initiative-toggle__label">{{ initiativeCollapsed ? 'Expand' : 'Collapse' }}</span>
        </button>
      </div>

      <div
        id="initiative-tracker-content"
        v-show="!initiativeCollapsed"
        class="initiative-content"
      >
        <section v-if="map && canViewMap" class="panel-card initiative-panel">
          <div class="panel-heading initiative-heading">
            <div class="initiative-title-block">
              <h2>Initiative</h2>
              <label class="round-field">
                <span>Round</span>
                <input
                  type="number"
                  min="1"
                  :value="initiativeRound"
                  aria-label="Initiative round"
                  :disabled="!canManageInitiative"
                  @input="setInitiativeRound"
                />
              </label>
            </div>
            <span class="badge">
              {{ initiativeRows.length }} character{{ initiativeRows.length === 1 ? '' : 's' }}
            </span>
          </div>

          <div class="initiative-actions" role="group" aria-label="Turn controls">
            <button
              type="button"
              class="initiative-action"
              :disabled="!initiativeRows.length || !canManageInitiative"
              @click="previousInitiative"
            >
              Previous
            </button>
            <button
              type="button"
              class="initiative-action initiative-action--primary"
              :disabled="!initiativeRows.length || !canManageInitiative"
              @click="nextInitiative"
            >
              {{ activeInitiativeId ? 'Next turn' : 'Start' }}
            </button>
          </div>

          <div class="initiative-tools" role="group" aria-label="Initiative utilities">
            <button
              type="button"
              class="initiative-tool"
              :disabled="!initiativeRows.length || !canManageInitiative"
              @click="fillInitiativeFromSpeed"
            >
              Use All Speed
            </button>
            <button
              type="button"
              class="initiative-tool"
              :disabled="!activeInitiativeId || !canManageInitiative"
              @click="clearActiveInitiative"
            >
              Clear turn
            </button>
            <button
              type="button"
              class="initiative-tool initiative-tool--danger"
              :disabled="(!hasInitiativeValues && !activeInitiativeId) || !canManageInitiative"
              @click="clearInitiativeValues"
            >
              Reset
            </button>
          </div>

          <ol v-if="sortedInitiativeRows.length" class="initiative-list">
            <li
              v-for="(entry, index) in sortedInitiativeRows"
              :key="entry.id"
              class="initiative-row"
              :class="{
                'is-active': activeInitiativeId === entry.id,
                'is-selected': selectedId === entry.id,
                'is-fainted': entry.currentHp <= 0,
              }"
            >
              <button
                type="button"
                class="initiative-row__turn"
                :class="{ 'is-active': activeInitiativeId === entry.id }"
                :aria-pressed="activeInitiativeId === entry.id"
                :aria-label="`Set ${entry.name} as the current turn`"
                :disabled="!canManageInitiative"
                @click="setActiveInitiativeAndFocus(entry.id)"
              >
                <span class="initiative-row__sprite" aria-hidden="true">
                  <span
                    v-if="entry.sprite.isSpriteSheet && entry.sprite.url"
                    class="initiative-row__sprite-frame"
                    :style="initiativeSpriteFrameStyle(entry)"
                  />
                  <img
                    v-else-if="entry.sprite.url"
                    :src="entry.sprite.url"
                    alt=""
                    draggable="false"
                  />
                  <span v-else class="initiative-row__sprite-fallback">
                    {{ entry.name.slice(0, 1) }}
                  </span>
                </span>
                <span class="sr-only">Turn order {{ index + 1 }}</span>
              </button>

              <button
                type="button"
                class="initiative-row__body"
                :aria-label="`Center camera on ${entry.name}`"
                :title="`Center camera on ${entry.name}`"
                @click="focusInitiativeEntry(entry.id)"
              >
                <span class="initiative-row__main">
                  <span class="initiative-row__name">{{ entry.name }}</span>
                  <span class="initiative-row__meta">{{ entry.meta }} · SPD {{ entry.speed }}</span>
                </span>
                <span class="initiative-row__hp" :data-hp-tier="hpTier(entry)">
                  <span>{{ entry.currentHp }}/{{ entry.maxHp }} HP</span>
                  <span class="initiative-row__hp-track" :data-hp-tier="hpTier(entry)" aria-hidden="true">
                    <span :style="{ width: hpPercent(entry) }" />
                  </span>
                </span>
              </button>

              <div class="initiative-row__score">
                <label>
                  <span>Init</span>
                  <input
                    type="number"
                    inputmode="numeric"
                    :value="entry.initiative ?? ''"
                    placeholder="—"
                    :aria-label="`${entry.name} initiative`"
                    :disabled="!canManageInitiative"
                    @input="setInitiativeInput(entry.id, $event)"
                  />
                </label>
                <button
                  type="button"
                  class="initiative-row__speed-button"
                  :title="`Set initiative to Speed (${entry.speed})`"
                  :aria-label="`Use ${entry.name}'s Speed (${entry.speed}) for initiative`"
                  :disabled="!canManageInitiative"
                  @click="setInitiativeFromSpeed(entry.id, entry.speed)"
                >
                  Use Speed
                </button>
              </div>
            </li>
          </ol>

          <p v-else class="initiative-empty">
            Spawn Pokémon or trainers onto the map to track turn order.
          </p>
        </section>
      </div>
    </aside>

    <div
      v-if="map && isGm && adminPanelOpen"
      class="admin-panel-backdrop"
      role="presentation"
      @pointerdown.self="adminPanelOpen = false"
    >
      <section
        class="admin-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-panel-title"
        @pointerdown.stop
      >
        <div class="admin-panel__header">
          <div>
            <p class="admin-panel__eyebrow">Admin · Ctrl+Shift+A</p>
            <h2 id="admin-panel-title">Map control panel</h2>
          </div>
          <button
            type="button"
            class="admin-panel__close"
            aria-label="Close admin control panel"
            @click="adminPanelOpen = false"
          >
            ×
          </button>
        </div>

        <div class="admin-field">
          <label for="admin-ground-level-y">
            <span>Map-specific Y=0 / ground level</span>
            <input
              id="admin-ground-level-y"
              type="number"
              min="0"
              :max="groundLevelYMax"
              :value="mapGroundLevelY"
              @input="setGroundLevelY"
            />
          </label>
          <p class="admin-field__hint">
            Set the absolute Y layer that should be shown as ground Y=0.
            Absolute Y=0 remains the lowest layer of the map.
          </p>
        </div>

        <dl class="admin-y-summary">
          <div>
            <dt>Absolute ground layer</dt>
            <dd>{{ mapGroundLevelY }}</dd>
          </div>
          <div>
            <dt>Map-specific Y range</dt>
            <dd>{{ mapSpecificYMin }} … {{ mapSpecificYMax }}</dd>
          </div>
        </dl>
      </section>
    </div>
  </div>
</template>

<style scoped>
.layout-shell {
  --map-sidebar-width: minmax(310px, 380px);
  --initiative-sidebar-width: minmax(300px, 360px);

  display: grid;
  grid-template-columns: var(--map-sidebar-width) minmax(0, 1fr) var(--initiative-sidebar-width);
  min-height: 100vh;
  gap: 0;
  background: var(--paper);
  transition: grid-template-columns 0.2s ease;
}

.layout-shell--sidebar-collapsed {
  --map-sidebar-width: 56px;
}

.layout-shell--initiative-collapsed {
  --initiative-sidebar-width: 56px;
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
  padding: 0.85rem;
  border-right: 1px solid var(--rule);
  background: var(--paper);
  max-height: 100vh;
  overflow: auto;
  transition: padding 0.2s ease;
}

.sidebar--collapsed {
  align-items: center;
  padding: 0.65rem 0.45rem;
  overflow: hidden;
}

.sidebar-content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
  min-height: 0;
}

.sidebar-toggle-row {
  display: flex;
  justify-content: flex-end;
  padding: 0 0.25rem;
}

.sidebar--collapsed .sidebar-toggle-row {
  justify-content: center;
  padding: 0;
}

.sidebar-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-soft);
  color: var(--ink-soft);
  padding: 0.4rem 0.7rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  line-height: 1;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.sidebar-toggle:hover,
.sidebar-toggle:focus-visible {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  outline: none;
}

.sidebar-toggle span[aria-hidden='true'] {
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 0.8;
}

.sidebar--collapsed .sidebar-toggle {
  width: 38px;
  height: 38px;
  padding: 0;
}

.sidebar--collapsed .sidebar-toggle__label {
  display: none;
}

.scene-column {
  min-width: 0;
  min-height: 100vh;
  background: var(--paper);
}

.initiative-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
  padding: 0.85rem;
  border-left: 1px solid var(--rule);
  background: var(--paper);
  max-height: 100vh;
  overflow: auto;
  transition: padding 0.2s ease;
}

.initiative-sidebar--collapsed {
  align-items: center;
  padding: 0.65rem 0.45rem;
  overflow: hidden;
}

.initiative-content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
  min-height: 0;
}

.initiative-toggle-row {
  display: flex;
  justify-content: flex-start;
  padding: 0 0.25rem;
}

.initiative-sidebar--collapsed .initiative-toggle-row {
  justify-content: center;
  padding: 0;
}

.initiative-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-soft);
  color: var(--ink-soft);
  padding: 0.4rem 0.7rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  line-height: 1;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.initiative-toggle:hover,
.initiative-toggle:focus-visible {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  outline: none;
}

.initiative-toggle span[aria-hidden='true'] {
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 0.8;
}

.initiative-sidebar--collapsed .initiative-toggle {
  width: 38px;
  height: 38px;
  padding: 0;
}

.initiative-sidebar--collapsed .initiative-toggle__label {
  display: none;
}

.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0 0.25rem;
}

.back-link {
  color: var(--ink-soft);
  text-decoration: none;
  font-size: 0.9rem;
  letter-spacing: 0.02em;
}

.back-link:hover {
  color: var(--ink-bright);
  text-decoration: underline;
  text-decoration-color: var(--rule-strong);
}

.panel-card {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.panel-heading h2 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.visibility-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  width: fit-content;
  margin: 0 0 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-soft);
  padding: 0.35rem 0.7rem;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.visibility-toggle.active {
  border-color: rgba(184, 187, 38, 0.55);
  background: rgba(184, 187, 38, 0.12);
  color: var(--good);
}

.visibility-toggle input {
  width: auto;
}

.permission-note {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.86rem;
  line-height: 1.45;
}

.dimension-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.dimension-grid label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.dimension-grid span {
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.65rem 0.8rem;
  outline: none;
}

input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

input:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.terrain-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.build-section {
  border-top: 1px solid var(--rule-soft);
  margin-top: 0.15rem;
  padding-top: 0.85rem;
}

.panel-heading--compact {
  margin-bottom: 0.6rem;
}

.mode-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

.mode-button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.8rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.mode-button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.mode-button.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.tool-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

.tool-button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.5rem 0.7rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.tool-button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.tool-button.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.materials-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem;
}

.material-swatch {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.3rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  padding: 0.4rem;
  cursor: pointer;
  font: inherit;
  text-align: center;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.material-swatch:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.material-swatch.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.swatch-color {
  display: block;
  height: 28px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.25);
}

.swatch-label {
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  color: var(--ink);
}

.material-swatch.is-active .swatch-label {
  color: var(--accent);
}

.layer-panel {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.layer-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
}

.layer-toggle {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  padding: 0.45rem 0.55rem;
  color: var(--ink);
  font-size: 0.8rem;
  text-transform: capitalize;
}

.layer-toggle input {
  width: auto;
  accent-color: var(--accent);
}

.color-row {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}

.color-picker {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.color-picker span {
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.color-picker input[type='color'] {
  width: 100%;
  height: 38px;
  padding: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  cursor: pointer;
}

.ghost-button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink-soft);
  padding: 0.5rem 0.7rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.ghost-button:hover {
  border-color: var(--rule-strong);
  color: var(--ink-bright);
}

.hint {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  line-height: 1.4;
}

.bulk-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

.bulk-button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.5rem 0.7rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.bulk-button:hover:not(:disabled) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.bulk-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bulk-button--danger {
  color: #fb4934;
}

.bulk-button--danger:hover:not(:disabled) {
  border-color: #fb4934;
  background: rgba(251, 73, 52, 0.08);
}

.initiative-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.initiative-heading {
  align-items: flex-start;
  margin-bottom: 0;
}

.initiative-title-block {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.55rem;
}

.round-field {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--ink-muted);
  font-size: 0.76rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.round-field input {
  width: 72px;
  padding: 0.42rem 0.55rem;
  text-align: center;
}

.initiative-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.45rem;
}

.initiative-tools {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem;
}

.initiative-action,
.initiative-tool {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.5rem 0.65rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.initiative-action:hover:not(:disabled),
.initiative-tool:hover:not(:disabled) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.initiative-action:disabled,
.initiative-tool:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.initiative-action--primary {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.initiative-tool--danger {
  color: #fb4934;
}

.initiative-tool--danger:hover:not(:disabled) {
  border-color: #fb4934;
  background: rgba(251, 73, 52, 0.08);
}

.initiative-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.initiative-row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) 78px;
  align-items: stretch;
  gap: 0.5rem;
  border: 1px solid var(--rule-soft);
  border-radius: 13px;
  background: var(--paper);
  padding: 0.5rem;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.initiative-row.is-active {
  border-color: var(--accent);
  background: linear-gradient(135deg, rgba(250, 189, 47, 0.15), rgba(40, 40, 40, 0.92));
  box-shadow: 0 0 0 1px rgba(250, 189, 47, 0.15);
}

.initiative-row.is-selected:not(.is-active) {
  border-color: var(--info);
}

.initiative-row.is-fainted {
  opacity: 0.66;
}

.initiative-row__turn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  overflow: hidden;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-soft);
  color: var(--ink-soft);
  cursor: pointer;
  font: inherit;
  font-weight: 800;
  padding: 0;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.initiative-row__turn:hover,
.initiative-row__turn:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}

.initiative-row__turn.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.initiative-row__sprite {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-height: 40px;
  overflow: hidden;
  border-radius: 8px;
}

.initiative-row__sprite-frame {
  display: block;
  flex: 0 0 auto;
  background-position: left top;
  background-repeat: no-repeat;
  image-rendering: pixelated;
  transform-origin: center;
}

.initiative-row__sprite img {
  display: block;
  max-width: 34px;
  max-height: 34px;
  object-fit: contain;
  image-rendering: pixelated;
}

.initiative-row__sprite-fallback {
  color: var(--ink-bright);
  font-weight: 800;
  text-transform: uppercase;
}

.initiative-row__body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 0.35rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 0;
  text-align: left;
}

.initiative-row__body:hover .initiative-row__name,
.initiative-row__body:focus-visible .initiative-row__name {
  color: var(--accent);
}

.initiative-row__body:focus-visible {
  outline: 2px solid rgba(250, 189, 47, 0.35);
  outline-offset: 3px;
}

.initiative-row__main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.15rem;
}

.initiative-row__name {
  overflow: hidden;
  color: var(--ink-bright);
  font-weight: 800;
  letter-spacing: 0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.initiative-row__meta {
  overflow: hidden;
  color: var(--ink-muted);
  font-size: 0.74rem;
  letter-spacing: 0.03em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.initiative-row__hp {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  color: var(--good);
  font-size: 0.74rem;
}

.initiative-row__hp[data-hp-tier='wounded'] {
  color: var(--warn);
}

.initiative-row__hp[data-hp-tier='critical'] {
  color: var(--bad);
}

.initiative-row__hp-track {
  display: block;
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--paper-inset);
}

.initiative-row__hp-track > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--good);
}

.initiative-row__hp-track[data-hp-tier='wounded'] > span {
  background: var(--warn);
}

.initiative-row__hp-track[data-hp-tier='critical'] > span,
.initiative-row.is-fainted .initiative-row__hp-track > span {
  background: var(--bad);
}

.initiative-row__score {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.28rem;
  min-width: 0;
}

.initiative-row__score label {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  min-width: 0;
}

.initiative-row__score span {
  color: var(--ink-muted);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-align: center;
  text-transform: uppercase;
}

.initiative-row__score input {
  padding: 0.45rem 0.25rem;
  text-align: center;
}

.initiative-row__speed-button {
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-soft);
  color: var(--ink-soft);
  padding: 0.28rem 0.25rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1;
  white-space: nowrap;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.initiative-row__speed-button:hover,
.initiative-row__speed-button:focus-visible {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  outline: none;
}

.initiative-empty {
  margin: 0;
  border: 1px dashed var(--rule-soft);
  border-radius: 12px;
  padding: 1rem;
  color: var(--ink-muted);
  font-size: 0.86rem;
  line-height: 1.45;
  text-align: center;
}

.admin-panel-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(29, 32, 33, 0.58);
  backdrop-filter: blur(2px);
}

.admin-panel {
  width: min(440px, 100%);
  border: 1px solid var(--rule-strong);
  border-radius: 18px;
  background: var(--paper);
  box-shadow: var(--shadow-card);
  padding: 1rem;
}

.admin-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.admin-panel__eyebrow {
  margin: 0 0 0.2rem;
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.admin-panel h2 {
  margin: 0;
  font-family: var(--font-book);
  color: var(--ink-bright);
}

.admin-panel__close {
  width: 34px;
  height: 34px;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-soft);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  font-size: 1.4rem;
  line-height: 1;
}

.admin-panel__close:hover,
.admin-panel__close:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}

.admin-field label {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.admin-field label span {
  color: var(--ink-muted);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.admin-field__hint {
  margin: 0.55rem 0 0;
  color: var(--ink-soft);
  font-size: 0.86rem;
  line-height: 1.45;
}

.admin-y-summary {
  display: grid;
  gap: 0.55rem;
  margin: 1rem 0 0;
}

.admin-y-summary div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  padding: 0.65rem 0.75rem;
}

.admin-y-summary dt,
.admin-y-summary dd {
  margin: 0;
}

.admin-y-summary dt {
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.admin-y-summary dd {
  color: var(--accent);
  font-weight: 800;
  white-space: nowrap;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.scene-loading {
  display: grid;
  place-items: center;
  min-height: 100vh;
  color: var(--ink-muted);
  background: var(--paper);
  font-style: italic;
  gap: 0.6rem;
  text-align: center;
}

@media (max-width: 1100px) {
  .layout-shell,
  .layout-shell--sidebar-collapsed,
  .layout-shell--initiative-collapsed {
    grid-template-columns: 1fr;
  }

  .sidebar {
    max-height: none;
    border-right: 0;
    border-bottom: 1px solid var(--rule);
  }

  .initiative-sidebar {
    max-height: none;
    border-left: 0;
    border-top: 1px solid var(--rule);
  }
}

@media (max-width: 640px) {
  .dimension-grid,
  .initiative-tools,
  .initiative-actions {
    grid-template-columns: 1fr;
  }

  .initiative-row {
    grid-template-columns: 38px minmax(0, 1fr) 70px;
  }
}
</style>
