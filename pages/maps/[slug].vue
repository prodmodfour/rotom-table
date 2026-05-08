<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import IsometricGrid from '~/components/IsometricGrid.client.vue'
import MapFieldEffectsPanel from '~/components/map/FieldEffectsPanel.vue'
import MapInitiativeTracker from '~/components/map/InitiativeTracker.vue'
import SheetBrowser from '~/components/SheetBrowser.vue'
import SaveIndicator from '~/components/SaveIndicator.vue'
import { useEditableMap } from '~/composables/useEditableMap'
import { useLiveSheets } from '~/composables/useLiveSheets'
import { useFieldEffectsEditor } from '~/composables/map-editor/useFieldEffectsEditor'
import { useHazardBuilder } from '~/composables/map-editor/useHazardBuilder'
import { useInitiativeTracker } from '~/composables/map-editor/useInitiativeTracker'
import { useMoveAutomationPanel } from '~/composables/map-editor/useMoveAutomationPanel'
import { useTerrainBuilder } from '~/composables/map-editor/useTerrainBuilder'
import {
  pokedexPathForSpecies,
  sheetPathForPlacement,
  useTokenControls,
} from '~/composables/map-editor/useTokenControls'
import {
  normalizeDimensions,
  reconcilePokemonPositions,
} from '~/utils/grid'
import { filterMapHazardsInBounds } from '~/utils/mapHazards'
import { filterVoxelsInBounds, hexColorString } from '~/utils/voxels'
import { getClientId } from '~/utils/clientId'
import {
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  applyHpToSheet,
  commitSheetUpdate,
  createSheetUpdateForPlacement,
  rollbackSheetUpdate,
  toPersistableSheetPayload,
  type PlacementSheetUpdater,
} from '~/utils/sheetMutations'
import type { CombatStageMap } from '~/types/combatStages'
import type {
  MapHazardV2,
  MapVoxelV2,
} from '~/types/map'
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

const gridRef = ref<IsometricGridHandle | null>(null)
const sidebarCollapsed = ref(false)
const initiativeCollapsed = ref(false)
const adminPanelOpen = ref(false)

type LeftSidebarSectionKey = 'details' | 'terrain' | 'fieldEffects'
const leftSidebarSectionsCollapsed = ref<Record<LeftSidebarSectionKey, boolean>>({
  details: false,
  terrain: false,
  fieldEffects: false,
})
const leftSectionCollapsed = (section: LeftSidebarSectionKey): boolean =>
  leftSidebarSectionsCollapsed.value[section]
const toggleLeftSection = (section: LeftSidebarSectionKey) => {
  leftSidebarSectionsCollapsed.value[section] = !leftSidebarSectionsCollapsed.value[section]
}

const canEditMap = computed(() => isGm.value)
const canManageInitiative = computed(() => isGm.value)
const canSpawnTokens = computed(() => isGm.value)

const layerVisibility = ref({
  terrain: true,
  shadows: true,
  tokens: true,
  grid: true,
  hazards: true,
  fieldEffects: true,
})
const layerOptions = [
  'terrain',
  'shadows',
  'tokens',
  'grid',
  'hazards',
  'fieldEffects',
] as const

const mapVoxels = computed<MapVoxelV2[]>(() => map.value?.voxels ?? [])
const mapHazards = computed<MapHazardV2[]>(() => map.value?.hazards ?? [])
const canViewMap = computed(() => !map.value || !isPlayer.value || map.value.playerVisible === true)

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

const {
  selectedId,
  previewState,
  sheetLookup,
  spawnedPokemon,
  controllablePlacementIds,
  canControlPlacement,
  placementById,
  clearSelection,
  updatePreview,
  spawnSheet,
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
  canDeleteTokens: isGm,
})

const selectPokemon = (id: string | null) => {
  if (buildMode.value) return
  selectPlacement(id)
}
const deletePokemon = deletePlacement
const turnPokemon = turnPlacement
const movePokemon = movePlacement

const voxelCount = computed(() => mapVoxels.value.length)
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
  visibleVoxelMaterials,
  colorPickerValue,
  placeVoxel,
  removeVoxel,
  selectMaterial,
  setTool,
  handleColorInput,
  clearCustomColor,
  fillGround,
  clearAllVoxels,
} = useTerrainBuilder({ map, mapVoxels, mapGroundLevelY, spawnedPokemon, canEditMap })

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
  hazardMode.value = false
  adminPanelOpen.value = false
  if (selectedId.value && !canControlPlacement(selectedId.value)) selectPokemon(null)
  if (moveAutomationId.value && !canControlPlacement(moveAutomationId.value)) closeMoveAutomation()
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

const saveIndicatorStatus = computed<SaveStatus | null>(() => {
  if (status.value === 'saving') return 'saving'
  if (status.value === 'saved') return 'saved'
  if (status.value === 'error') return 'error'
  return null
})

const updatePlacedSheet = async (
  id: string,
  update: PlacementSheetUpdater,
  logLabel: string,
  options: { allowAnyTarget?: boolean } = {},
) => {
  if (!map.value || (!options.allowAnyTarget && !canControlPlacement(id))) return
  const placement = map.value.placements.find((p) => p.id === id)
  if (!placement) return

  const context = createSheetUpdateForPlacement(
    placement,
    sheetLookup.value,
    update,
  )
  if (!context) return

  commitSheetUpdate(context)
  try {
    await $fetch('/api/sheets/save', {
      method: 'POST',
      body: {
        kind: context.kind,
        slug: context.slug,
        sheet: toPersistableSheetPayload(context.updated),
        clientId: getClientId(),
      },
    })
  } catch (err) {
    rollbackSheetUpdate(context)
    console.error(`[${logLabel}] save failed`, err)
  }
}

const modifyHp = async (
  payload: { id: string; currentHp: number },
  options: { allowAnyTarget?: boolean } = {},
) => updatePlacedSheet(
  payload.id,
  (kind, sheet) => applyHpToSheet(kind, sheet, payload.currentHp),
  'modifyHp',
  options,
)

const modifyCombatStages = async (
  payload: { id: string; stages: CombatStageMap },
  options: { allowAnyTarget?: boolean } = {},
) => updatePlacedSheet(
  payload.id,
  (kind, sheet) => applyCombatStagesToSheet(kind, sheet, payload.stages),
  'modifyCombatStages',
  options,
)

const modifyConditions = async (
  payload: { id: string; conditions: string[] },
  options: { allowAnyTarget?: boolean } = {},
) => updatePlacedSheet(
  payload.id,
  (kind, sheet) => applyConditionsToSheet(kind, sheet, payload.conditions),
  'modifyConditions',
  options,
)

const {
  moveAutomationId,
  moveAutomationUser,
  moveAutomationMoves,
  openMoveAutomation,
  closeMoveAutomation,
  applyMoveAutomation,
} = useMoveAutomationPanel({
  map,
  spawnedPokemon,
  pokemonBySlug,
  trainerBySlug,
  canEditMap,
  canControlPlacement,
  modifyHp,
  modifyCombatStages,
  modifyConditions,
  applyMoveFieldEffect,
  placeHazard,
})

const viewSheet = (id: string) => {
  if (!map.value || !canControlPlacement(id)) return
  const placement = placementById(id)
  if (!placement) return
  const target = router.resolve(sheetPathForPlacement(placement)).href
  window.open(target, '_blank', 'noopener')
}

const viewPokedex = (id: string) => {
  if (!map.value || !canControlPlacement(id)) return
  const placement = placementById(id)
  if (!placement || placement.sheetKind !== 'pokemon') return
  const targetPath = pokedexPathForSpecies(pokemonBySlug.value?.get(placement.sheetSlug)?.species)
  if (!targetPath) return
  const target = router.resolve(targetPath).href
  window.open(target, '_blank', 'noopener')
}

const setMode = (mode: 'play' | 'build' | 'hazards') => {
  if (mode !== 'play' && !canEditMap.value) return
  const nextBuild = mode === 'build'
  const nextHazards = mode === 'hazards'
  if (buildMode.value === nextBuild && hazardMode.value === nextHazards) return
  buildMode.value = nextBuild
  hazardMode.value = nextHazards
  if (nextBuild || nextHazards) clearSelection()
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

    const trimmedHazards = filterMapHazardsInBounds(mapHazards.value, normalized)
    if (trimmedHazards.length !== mapHazards.value.length) {
      map.value.hazards = trimmedHazards
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
      clearSelection()
    }
  },
  { deep: true },
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

        <section v-if="map && canViewMap" class="panel-card map-details-panel">
          <div class="panel-heading panel-heading--collapsible">
            <button
              type="button"
              class="section-toggle-button"
              :aria-expanded="!leftSectionCollapsed('details')"
              aria-controls="map-details-section"
              @click="toggleLeftSection('details')"
            >
              <span class="section-toggle-button__chevron" aria-hidden="true">
                {{ leftSectionCollapsed('details') ? '›' : '⌄' }}
              </span>
              <span class="section-toggle-button__title">{{ map.name }}</span>
            </button>
            <span class="badge">
              {{ map.dimensions.x }} × {{ map.dimensions.y }} × {{ map.dimensions.z }}
            </span>
          </div>

          <div id="map-details-section" v-show="!leftSectionCollapsed('details')" class="collapsible-section-body">
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
          </div>
        </section>

      <section v-if="map && canViewMap" class="panel-card terrain-panel">
        <div class="panel-heading panel-heading--collapsible">
          <button
            type="button"
            class="section-toggle-button"
            :aria-expanded="!leftSectionCollapsed('terrain')"
            aria-controls="map-terrain-section"
            @click="toggleLeftSection('terrain')"
          >
            <span class="section-toggle-button__chevron" aria-hidden="true">
              {{ leftSectionCollapsed('terrain') ? '›' : '⌄' }}
            </span>
            <span class="section-toggle-button__title">Terrain</span>
          </button>
          <span class="badge">
            {{ voxelCount }} block{{ voxelCount === 1 ? '' : 's' }} · {{ hazardCount }} hazard{{ hazardCount === 1 ? '' : 's' }}
          </span>
        </div>

        <div id="map-terrain-section" v-show="!leftSectionCollapsed('terrain')" class="collapsible-section-body">
        <div v-if="canEditMap" class="mode-row" role="group" aria-label="Editor mode">
          <button
            type="button"
            class="mode-button"
            :class="{ 'is-active': !buildMode && !hazardMode }"
            :aria-pressed="!buildMode && !hazardMode"
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
          <button
            type="button"
            class="mode-button"
            :class="{ 'is-active': hazardMode }"
            :aria-pressed="hazardMode"
            @click="setMode('hazards')"
          >
            Hazards
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

        <template v-if="hazardMode && canEditMap">
          <div class="tool-row" role="group" aria-label="Hazard tool">
            <button
              type="button"
              class="tool-button"
              :class="{ 'is-active': hazardTool === 'pencil' }"
              :aria-pressed="hazardTool === 'pencil'"
              @click="setHazardTool('pencil')"
            >
              Place
            </button>
            <button
              type="button"
              class="tool-button"
              :class="{ 'is-active': hazardTool === 'eraser' }"
              :aria-pressed="hazardTool === 'eraser'"
              @click="setHazardTool('eraser')"
            >
              Erase
            </button>
          </div>

          <div class="hazards-grid" role="group" aria-label="Hazard type">
            <button
              v-for="hazard in hazardPalette"
              :key="hazard.kind"
              type="button"
              class="hazard-swatch"
              :class="{ 'is-active': hazardKind === hazard.kind }"
              :aria-pressed="hazardKind === hazard.kind"
              :title="hazard.description"
              @click="selectHazardKind(hazard.kind)"
            >
              <span
                class="hazard-swatch__icon"
                :style="{ '--hazard-color': hazard.color }"
                aria-hidden="true"
              >{{ hazard.shortLabel }}</span>
              <span class="hazard-swatch__label">{{ hazard.label }}</span>
            </button>
          </div>

          <p class="hint">
            Left click to {{ hazardTool === 'pencil' ? `place ${activeHazardDef.label}` : 'erase hazards' }}.
            Right click erases all hazards on a square. Toxic Spikes stacks to 2 layers.
          </p>

          <div class="bulk-row">
            <button
              type="button"
              class="bulk-button bulk-button--danger"
              :disabled="!hazardCount"
              @click="clearAllHazards"
            >
              Clear hazards
            </button>
          </div>
        </template>
        </div>
      </section>

      <MapFieldEffectsPanel
        v-if="map && canViewMap"
        :collapsed="leftSectionCollapsed('fieldEffects')"
        :can-edit-map="canEditMap"
        :field-effect-count="fieldEffectCount"
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
        @toggle-collapsed="toggleLeftSection('fieldEffects')"
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
          :hazards="mapHazards"
          :field-effects="mapFieldEffects"
          :ground-level-y="mapGroundLevelY"
          :layer-visibility="layerVisibility"
          :build-mode="buildMode && canEditMap"
          :build-tool="buildTool"
          :build-material="buildMaterial"
          :build-color="buildColor"
          :hazard-mode="hazardMode && canEditMap"
          :hazard-tool="hazardTool"
          :hazard-kind="hazardKind"
          :can-delete-tokens="isGm"
          @select-pokemon="selectPokemon"
          @move-pokemon="movePokemon"
          @turn-pokemon="turnPokemon"
          @delete-pokemon="deletePokemon"
          @modify-hp="modifyHp"
          @modify-combat-stages="modifyCombatStages"
          @modify-conditions="modifyConditions"
          @use-move="openMoveAutomation"
          @view-sheet="viewSheet"
          @view-pokedex="viewPokedex"
          @preview-change="updatePreview"
          @place-voxel="placeVoxel"
          @remove-voxel="removeVoxel"
          @place-hazard="placeHazard"
          @remove-hazard="removeHazard"
        />
        <div v-else-if="status === 'loading'" class="scene-loading">Loading map…</div>
        <div v-else-if="status === 'not-found'" class="scene-loading">
          <p>Map <code>{{ slug }}</code> not found.</p>
          <NuxtLink to="/maps" class="back-link">← Back to maps</NuxtLink>
        </div>
        <div v-else class="scene-loading">
          <p>{{ error ?? 'Could not load map.' }}</p>
        </div>

        <MoveAutomationDialog
          v-if="moveAutomationUser"
          :user="moveAutomationUser"
          :moves="moveAutomationMoves"
          :all-tokens="spawnedPokemon"
          :field-effects="mapFieldEffects"
          :can-apply-map-effects="canEditMap"
          @close="closeMoveAutomation"
          @apply="applyMoveAutomation"
        />

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
        <MapInitiativeTracker
          v-if="map && canViewMap"
          :rows="initiativeRows"
          :sorted-rows="sortedInitiativeRows"
          :active-id="activeInitiativeId"
          :round="initiativeRound"
          :selected-id="selectedId"
          :can-manage="canManageInitiative"
          :has-initiative-values="hasInitiativeValues"
          @set-round="setInitiativeRound"
          @previous="previousInitiative"
          @next="nextInitiative"
          @fill-from-speed="fillInitiativeFromSpeed"
          @clear-active="clearActiveInitiative"
          @clear-values="clearInitiativeValues"
          @set-active-and-focus="setActiveInitiativeAndFocus"
          @focus="focusInitiativeEntry"
          @set-initiative-input="setInitiativeInput"
          @set-initiative-from-speed="setInitiativeFromSpeed"
        />
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

.panel-heading--collapsible {
  margin-bottom: 0;
}

.section-toggle-button {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  background: transparent;
  color: var(--ink-bright);
  padding: 0;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.section-toggle-button:hover,
.section-toggle-button:focus-visible {
  color: var(--accent);
}

.section-toggle-button:focus-visible {
  outline: 2px solid rgba(250, 189, 47, 0.35);
  outline-offset: 3px;
  border-radius: 8px;
}

.section-toggle-button__chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.15rem;
  height: 1.15rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  color: var(--accent);
  font-size: 0.9rem;
  font-weight: 800;
  line-height: 1;
}

.section-toggle-button__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-book);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.map-details-panel,
.collapsible-section-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
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

.hazards-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;
}

.hazard-swatch {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.45rem;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.hazard-swatch:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.hazard-swatch.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.hazard-swatch__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.45rem;
  min-height: 1.9rem;
  border: 1px solid color-mix(in srgb, var(--hazard-color) 65%, #1d2021);
  border-radius: 8px;
  background: color-mix(in srgb, var(--hazard-color) 24%, transparent);
  color: color-mix(in srgb, var(--hazard-color) 78%, #fbf1c7);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.hazard-swatch__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
}

.hazard-swatch.is-active .hazard-swatch__label {
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
  .dimension-grid {
    grid-template-columns: 1fr;
  }
}
</style>
