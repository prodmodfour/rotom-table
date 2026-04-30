<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
  buildVoxelOccupancy,
  cellInsidePokemonFootprint,
  filterVoxelsInBounds,
  getMaterialDef,
  hexColorString,
  voxelKey,
} from '~/utils/voxels'
import { getClientId } from '~/utils/clientId'
import { COMBAT_STAGE_KEYS, COMBAT_STAT_STAGE_KEYS, clampCombatStage } from '~/utils/combatStages'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { GridAnchor, GridVoxel, VoxelMaterial } from '~/types/map'
import type { PreviewState } from '~/utils/grid'
import type { SaveStatus } from '~/composables/useEditableSheet'

definePageMeta({
  key: (route) => `map-${route.params.slug}`,
})

const route = useRoute()
const router = useRouter()
const slug = String(route.params.slug ?? '')

const { map, status, error, renamedTo } = useEditableMap(slug)
const { pokemonBySlug, trainerBySlug } = useLiveSheets()

watch(renamedTo, (newSlug) => {
  if (newSlug) router.replace(`/maps/${newSlug}`)
})

useHead(() => ({
  title: map.value ? `${map.value.name} · Maps` : 'Maps · Rotom Table',
}))

const selectedId = ref<string | null>(null)
const previewState = ref<PreviewState>({ position: null, reachable: false, pathLength: 0 })

const buildMode = ref(false)
const buildTool = ref<BuildTool>('pencil')
const buildMaterial = ref<VoxelMaterial>('grass')
const buildColor = ref<string | null>(null)

const sheetLookup = computed(() => ({
  pokemon: pokemonBySlug.value!,
  trainer: trainerBySlug.value!,
}))

const spawnedPokemon = computed(() => placementsToSpawned(map.value, sheetLookup.value))
const mapVoxels = computed<GridVoxel[]>(() => map.value?.voxels ?? [])
const voxelCount = computed(() => mapVoxels.value.length)

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

const spawnSheet = (selection: SheetSelection) => {
  if (!map.value) return
  const catalog =
    selection.kind === 'pokemon'
      ? catalogEntryForPokemonSheet(selection.sheet)
      : catalogEntryForTrainerSheet(selection.sheet)
  if (!catalog) return
  const voxelKeys = buildVoxelOccupancy(mapVoxels.value)
  const position = findFirstAvailablePosition(
    catalog,
    spawnedPokemon.value,
    map.value.dimensions,
    null,
    voxelKeys,
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
  selectedId.value = id
  if (!id) previewState.value = { position: null, reachable: false, pathLength: 0 }
}

const deletePokemon = (id: string) => {
  if (!map.value) return
  map.value.placements = map.value.placements.filter((p) => p.id !== id)
  if (selectedId.value === id) selectPokemon(null)
}

const turnPokemon = (id: string) => {
  if (!map.value) return
  const placement = map.value.placements.find((p) => p.id === id)
  if (!placement) return
  placement.turned = !placement.turned
}

const movePokemon = (payload: { id: string; position: GridAnchor }) => {
  if (!map.value) return
  const placement = map.value.placements.find((p) => p.id === payload.id)
  if (!placement) return
  placement.position = payload.position
  selectPokemon(null)
}

const modifyHp = async (payload: { id: string; currentHp: number }) => {
  if (!map.value) return
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
  if (!map.value) return
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

const placeVoxel = (voxel: GridVoxel) => {
  if (!map.value) return
  const next = map.value.voxels.filter(
    (v) => !(v.x === voxel.x && v.y === voxel.y && v.z === voxel.z),
  )
  next.push(voxel)
  map.value.voxels = next
}

const removeVoxel = (cell: { x: number; y: number; z: number }) => {
  if (!map.value) return
  map.value.voxels = map.value.voxels.filter(
    (v) => !(v.x === cell.x && v.y === cell.y && v.z === cell.z),
  )
}

const setMode = (mode: 'play' | 'build') => {
  const next = mode === 'build'
  if (buildMode.value === next) return
  buildMode.value = next
  if (next) {
    selectedId.value = null
    previewState.value = { position: null, reachable: false, pathLength: 0 }
  }
}

const selectMaterial = (material: VoxelMaterial) => {
  buildMaterial.value = material
  buildColor.value = null
}

const setTool = (tool: BuildTool) => {
  buildTool.value = tool
}

const handleColorInput = (event: Event) => {
  const value = (event.target as HTMLInputElement).value
  buildColor.value = value
}

const clearCustomColor = () => {
  buildColor.value = null
}

const fillGround = () => {
  if (!map.value) return
  const dims = map.value.dimensions
  const occupancy = buildVoxelOccupancy(mapVoxels.value)
  const additions: GridVoxel[] = []
  for (let z = 0; z < dims.z; z += 1) {
    for (let x = 0; x < dims.x; x += 1) {
      if (occupancy.has(voxelKey(x, 0, z))) continue
      if (cellInsidePokemonFootprint(x, 0, z, spawnedPokemon.value)) continue
      const voxel: GridVoxel = { x, y: 0, z, material: buildMaterial.value }
      if (buildColor.value) voxel.color = buildColor.value
      additions.push(voxel)
    }
  }
  if (!additions.length) return
  map.value.voxels = [...map.value.voxels, ...additions]
}

const clearAllVoxels = () => {
  if (!map.value) return
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

    const trimmedVoxels = filterVoxelsInBounds(map.value.voxels, normalized)
    if (trimmedVoxels.length !== map.value.voxels.length) {
      map.value.voxels = trimmedVoxels
    }

    const reconciliation = reconcilePokemonPositions(
      spawnedPokemon.value,
      normalized,
      trimmedVoxels,
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
</script>

<template>
  <div class="layout-shell">
    <aside class="sidebar">
      <AppNavigation />

      <div class="header-row">
        <NuxtLink to="/maps" class="back-link">← All maps</NuxtLink>
        <SaveIndicator
          v-if="saveIndicatorStatus"
          :status="saveIndicatorStatus"
          :error="error"
        />
      </div>

      <section v-if="map" class="panel-card">
        <div class="panel-heading">
          <h2>{{ map.name }}</h2>
          <span class="badge">
            {{ map.dimensions.x }} × {{ map.dimensions.y }} × {{ map.dimensions.z }}
          </span>
        </div>

        <div class="dimension-grid">
          <label>
            <span>Width (X)</span>
            <input v-model.number="map.dimensions.x" type="number" min="1" max="200" />
          </label>
          <label>
            <span>Height (Y)</span>
            <input v-model.number="map.dimensions.y" type="number" min="1" max="200" />
          </label>
          <label>
            <span>Depth (Z)</span>
            <input v-model.number="map.dimensions.z" type="number" min="1" max="200" />
          </label>
        </div>
      </section>

      <section v-if="map" class="panel-card terrain-panel">
        <div class="panel-heading">
          <h2>Terrain</h2>
          <span class="badge">{{ voxelCount }} block{{ voxelCount === 1 ? '' : 's' }}</span>
        </div>

        <div class="mode-row" role="group" aria-label="Editor mode">
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

        <template v-if="buildMode">
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
              v-for="material in VOXEL_MATERIALS"
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
        </template>
      </section>

      <SheetBrowser v-if="map" @select="spawnSheet" />
    </aside>

    <main class="scene-column">
      <ClientOnly>
        <IsometricGrid
          v-if="map"
          :dimensions="map.dimensions"
          :pokemons="spawnedPokemon"
          :selected-id="selectedId"
          :voxels="mapVoxels"
          :build-mode="buildMode"
          :build-tool="buildTool"
          :build-material="buildMaterial"
          :build-color="buildColor"
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
  </div>
</template>

<style scoped>
.layout-shell {
  display: grid;
  grid-template-columns: minmax(310px, 380px) minmax(0, 1fr);
  min-height: 100vh;
  gap: 0;
  background: var(--paper);
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  border-right: 1px solid var(--rule);
  background: var(--paper);
  max-height: 100vh;
  overflow: auto;
}

.scene-column {
  min-width: 0;
  min-height: 100vh;
  background: var(--paper);
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

.terrain-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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
  .layout-shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    max-height: none;
    border-right: 0;
    border-bottom: 1px solid var(--rule);
  }
}

@media (max-width: 640px) {
  .dimension-grid {
    grid-template-columns: 1fr;
  }
}
</style>
