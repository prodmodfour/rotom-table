<script setup lang="ts">
import { computed, watch } from 'vue'
import IsometricGrid from '~/components/IsometricGrid.client.vue'
import SheetBrowser, { type SheetSelection } from '~/components/SheetBrowser.vue'
import SaveIndicator from '~/components/SaveIndicator.vue'
import { useEditableGrid } from '~/composables/useEditableGrid'
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
import type { GridAnchor } from '~/types/grid'
import type { PreviewState } from '~/utils/grid'
import type { SaveStatus } from '~/composables/useEditableSheet'

definePageMeta({
  key: (route) => `grid-${route.params.slug}`,
})

const route = useRoute()
const router = useRouter()
const slug = String(route.params.slug ?? '')

const { grid, status, error, renamedTo } = useEditableGrid(slug)
const { pokemonBySlug, trainerBySlug } = useLiveSheets()

watch(renamedTo, (newSlug) => {
  if (newSlug) router.replace(`/grids/${newSlug}`)
})

useHead(() => ({
  title: grid.value ? `${grid.value.name} · Tabletop` : 'Tabletop · Rotom Table',
}))

const selectedId = ref<string | null>(null)
const previewState = ref<PreviewState>({ position: null, reachable: false, pathLength: 0 })

const sheetLookup = computed(() => ({
  pokemon: pokemonBySlug.value!,
  trainer: trainerBySlug.value!,
}))

const spawnedPokemon = computed(() => placementsToSpawned(grid.value, sheetLookup.value))

const saveIndicatorStatus = computed<SaveStatus | null>(() => {
  if (status.value === 'saving') return 'saving'
  if (status.value === 'saved') return 'saved'
  if (status.value === 'error') return 'error'
  return null
})

const spawnSheet = (selection: SheetSelection) => {
  if (!grid.value) return
  const catalog =
    selection.kind === 'pokemon'
      ? catalogEntryForPokemonSheet(selection.sheet)
      : catalogEntryForTrainerSheet(selection.sheet)
  if (!catalog) return
  const position = findFirstAvailablePosition(catalog, spawnedPokemon.value, grid.value.dimensions)
  if (!position) return

  grid.value.placements.push({
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
  selectedId.value = id
  if (!id) previewState.value = { position: null, reachable: false, pathLength: 0 }
}

const deletePokemon = (id: string) => {
  if (!grid.value) return
  grid.value.placements = grid.value.placements.filter((p) => p.id !== id)
  if (selectedId.value === id) selectPokemon(null)
}

const turnPokemon = (id: string) => {
  if (!grid.value) return
  const placement = grid.value.placements.find((p) => p.id === id)
  if (!placement) return
  placement.turned = !placement.turned
}

const movePokemon = (payload: { id: string; position: GridAnchor }) => {
  if (!grid.value) return
  const placement = grid.value.placements.find((p) => p.id === payload.id)
  if (!placement) return
  placement.position = payload.position
  selectPokemon(null)
}

const updatePreview = (next: PreviewState) => {
  previewState.value = next
}

watch(
  () => grid.value?.dimensions,
  (dims) => {
    if (!dims || !grid.value) return
    const normalized = normalizeDimensions(dims)
    if (normalized.x !== dims.x) grid.value.dimensions.x = normalized.x
    if (normalized.y !== dims.y) grid.value.dimensions.y = normalized.y
    if (normalized.z !== dims.z) grid.value.dimensions.z = normalized.z

    const reconciliation = reconcilePokemonPositions(spawnedPokemon.value, normalized)
    const byId = new Map(reconciliation.pokemons.map((p) => [p.id, p.position]))
    grid.value.placements = grid.value.placements.flatMap((placement) => {
      const next = byId.get(placement.id)
      if (!next) return []
      return [{ ...placement, position: next }]
    })
    if (selectedId.value && !grid.value.placements.some((p) => p.id === selectedId.value)) {
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
        <NuxtLink to="/grids" class="back-link">← All grids</NuxtLink>
        <SaveIndicator
          v-if="saveIndicatorStatus"
          :status="saveIndicatorStatus"
          :error="error"
        />
      </div>

      <section v-if="grid" class="panel-card">
        <div class="panel-heading">
          <h2>{{ grid.name }}</h2>
          <span class="badge">
            {{ grid.dimensions.x }} × {{ grid.dimensions.y }} × {{ grid.dimensions.z }}
          </span>
        </div>

        <div class="dimension-grid">
          <label>
            <span>Width (X)</span>
            <input v-model.number="grid.dimensions.x" type="number" min="1" max="200" />
          </label>
          <label>
            <span>Height (Y)</span>
            <input v-model.number="grid.dimensions.y" type="number" min="1" max="200" />
          </label>
          <label>
            <span>Depth (Z)</span>
            <input v-model.number="grid.dimensions.z" type="number" min="1" max="200" />
          </label>
        </div>
      </section>

      <SheetBrowser v-if="grid" @select="spawnSheet" />
    </aside>

    <main class="scene-column">
      <ClientOnly>
        <IsometricGrid
          v-if="grid"
          :dimensions="grid.dimensions"
          :pokemons="spawnedPokemon"
          :selected-id="selectedId"
          @select-pokemon="selectPokemon"
          @move-pokemon="movePokemon"
          @turn-pokemon="turnPokemon"
          @delete-pokemon="deletePokemon"
          @preview-change="updatePreview"
        />
        <div v-else-if="status === 'loading'" class="scene-loading">Loading grid…</div>
        <div v-else-if="status === 'not-found'" class="scene-loading">
          <p>Grid <code>{{ slug }}</code> not found.</p>
          <NuxtLink to="/grids" class="back-link">← Back to grids</NuxtLink>
        </div>
        <div v-else class="scene-loading">
          <p>{{ error ?? 'Could not load grid.' }}</p>
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
  font-family: var(--serif);
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
