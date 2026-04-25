<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import IsometricGrid from '~/components/IsometricGrid.client.vue'
import { pokemonCatalog } from '~/data/pokemonCatalog'
import { trainerCatalog } from '~/data/trainerCatalog'
import type { GridAnchor, GridDimensions, PokemonCatalogEntry, SpawnedPokemon } from '~/types/pokemon'
import type { PreviewState } from '~/utils/grid'
import {
  DEFAULT_GRID_DIMENSIONS,
  findFirstAvailablePosition,
  normalizeDimensions,
  reconcilePokemonPositions,
} from '~/utils/grid'

const createPokemonId = () => `pkm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const gridDimensions = reactive<GridDimensions>({
  ...DEFAULT_GRID_DIMENSIONS,
})

const searchTerm = ref('')
const trainerSearchTerm = ref('')
const spawnedPokemon = ref<SpawnedPokemon[]>([])
const selectedId = ref<string | null>(null)
const previewState = ref<PreviewState>({
  position: null,
  reachable: false,
  pathLength: 0,
})

const filterCatalogEntries = (entries: PokemonCatalogEntry[], query: string) => {
  const normalizedQuery = query.trim().toLowerCase()
  const catalogEntries = [...entries]

  if (!normalizedQuery) {
    return catalogEntries
  }

  return catalogEntries
    .filter((entry) => entry.species.toLowerCase().includes(normalizedQuery))
    .sort((left, right) => {
      const leftName = left.species.toLowerCase()
      const rightName = right.species.toLowerCase()
      const leftStarts = leftName.startsWith(normalizedQuery) ? 0 : 1
      const rightStarts = rightName.startsWith(normalizedQuery) ? 0 : 1

      if (leftStarts !== rightStarts) {
        return leftStarts - rightStarts
      }

      return leftName.localeCompare(rightName)
    })
}

const filteredPokemon = computed(() => filterCatalogEntries(pokemonCatalog, searchTerm.value))
const filteredTrainers = computed(() => filterCatalogEntries(trainerCatalog, trainerSearchTerm.value))

const selectedPokemon = computed(
  () => spawnedPokemon.value.find((pokemon) => pokemon.id === selectedId.value) ?? null,
)

const spawnEntry = (entry: PokemonCatalogEntry) => {
  const position = findFirstAvailablePosition(entry, spawnedPokemon.value, gridDimensions)

  if (!position) {
    return
  }

  spawnedPokemon.value = [
    ...spawnedPokemon.value,
    {
      ...entry,
      id: createPokemonId(),
      position,
      turned: false,
    },
  ]

  selectedId.value = null
  previewState.value = {
    position: null,
    reachable: false,
    pathLength: 0,
  }
}

const selectPokemon = (id: string | null) => {
  selectedId.value = id

  if (!id) {
    previewState.value = {
      position: null,
      reachable: false,
      pathLength: 0,
    }
  }
}

const deletePokemon = (id: string) => {
  const target = spawnedPokemon.value.find((pokemon) => pokemon.id === id)
  spawnedPokemon.value = spawnedPokemon.value.filter((pokemon) => pokemon.id !== id)

  if (selectedId.value === id) {
    selectPokemon(null)
  }

}

const turnPokemon = (id: string) => {
  const target = spawnedPokemon.value.find((pokemon) => pokemon.id === id)

  if (!target) {
    return
  }

  spawnedPokemon.value = spawnedPokemon.value.map((pokemon) =>
    pokemon.id === id
      ? {
          ...pokemon,
          turned: !pokemon.turned,
        }
      : pokemon,
  )

}

const movePokemon = (payload: { id: string; position: GridAnchor }) => {
  const target = spawnedPokemon.value.find((pokemon) => pokemon.id === payload.id)

  if (!target) {
    return
  }

  spawnedPokemon.value = spawnedPokemon.value.map((pokemon) =>
    pokemon.id === payload.id
      ? {
          ...pokemon,
          position: payload.position,
        }
      : pokemon,
  )

  selectPokemon(null)
}

const updatePreview = (nextPreview: PreviewState) => {
  previewState.value = nextPreview
}

const formatPosition = (position: GridAnchor) => `(${position.x}, ${position.y}, ${position.z})`

watch(
  () => [gridDimensions.x, gridDimensions.y, gridDimensions.z] as const,
  ([x, y, z]) => {
    const normalized = normalizeDimensions({ x, y, z })

    if (normalized.x !== x) {
      gridDimensions.x = normalized.x
    }

    if (normalized.y !== y) {
      gridDimensions.y = normalized.y
    }

    if (normalized.z !== z) {
      gridDimensions.z = normalized.z
    }

    const reconciliation = reconcilePokemonPositions(spawnedPokemon.value, normalized)

    if (
      reconciliation.pokemons.length !== spawnedPokemon.value.length ||
      reconciliation.pokemons.some((pokemon, index) => {
        const current = spawnedPokemon.value[index]
        return (
          !current ||
          current.id !== pokemon.id ||
          current.position.x !== pokemon.position.x ||
          current.position.y !== pokemon.position.y ||
          current.position.z !== pokemon.position.z
        )
      })
    ) {
      spawnedPokemon.value = reconciliation.pokemons
    }

    if (selectedId.value && !spawnedPokemon.value.some((pokemon) => pokemon.id === selectedId.value)) {
      selectPokemon(null)
    }

    if (reconciliation.removedIds.length > 0) {
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="layout-shell">
    <aside class="sidebar">
      <AppNavigation />

      <section class="panel-card">
        <div class="panel-heading">
          <h2>Grid dimensions</h2>
          <span class="badge">{{ gridDimensions.x }} × {{ gridDimensions.y }} × {{ gridDimensions.z }}</span>
        </div>

        <div class="dimension-grid">
          <label>
            <span>Width (X)</span>
            <input v-model.number="gridDimensions.x" type="number" min="1" max="200" />
          </label>
          <label>
            <span>Height (Y)</span>
            <input v-model.number="gridDimensions.y" type="number" min="1" max="200" />
          </label>
          <label>
            <span>Depth (Z)</span>
            <input v-model.number="gridDimensions.z" type="number" min="1" max="200" />
          </label>
        </div>

      </section>

      <section class="panel-card grow-panel">
        <div class="panel-heading">
          <h2>Spawn Pokémon</h2>
          <span class="badge">{{ filteredPokemon.length }} shown</span>
        </div>

        <label class="search-field">
          <span class="sr-only">Search Pokémon</span>
          <input v-model.trim="searchTerm" type="search" placeholder="Search species…" />
        </label>

        <div class="spawn-results">
          <button
            v-for="entry in filteredPokemon"
            :key="entry.slug"
            class="spawn-row"
            type="button"
            @click="spawnEntry(entry)"
          >
            <span class="spawn-name">{{ entry.species }}</span>
            <span class="spawn-meta">
              {{ entry.width.toFixed(2) }}m × {{ entry.height.toFixed(2) }}m sprite ·
              {{ entry.base }} × {{ entry.base }} base · {{ entry.clearance }}m clearance
            </span>
          </button>
        </div>
      </section>

      <section class="panel-card grow-panel">
        <div class="panel-heading">
          <h2>Spawn Trainers</h2>
          <span class="badge">{{ filteredTrainers.length }} shown</span>
        </div>

        <label class="search-field">
          <span class="sr-only">Search Trainers</span>
          <input v-model.trim="trainerSearchTerm" type="search" placeholder="Search trainers…" />
        </label>

        <div class="spawn-results">
          <button
            v-for="entry in filteredTrainers"
            :key="entry.slug"
            class="spawn-row"
            type="button"
            @click="spawnEntry(entry)"
          >
            <span class="spawn-name">{{ entry.species }}</span>
            <span class="spawn-meta">
              {{ entry.width.toFixed(2) }}m × {{ entry.height.toFixed(2) }}m sprite ·
              {{ entry.base }} × {{ entry.base }} base · {{ entry.clearance }}m clearance
            </span>
          </button>
        </div>
      </section>

    </aside>

    <main class="scene-column">
      <ClientOnly>
        <IsometricGrid
          :dimensions="gridDimensions"
          :pokemons="spawnedPokemon"
          :selected-id="selectedId"
          @select-pokemon="selectPokemon"
          @move-pokemon="movePokemon"
          @turn-pokemon="turnPokemon"
          @delete-pokemon="deletePokemon"
          @preview-change="updatePreview"
        />

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

.panel-card {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
}

.panel-heading h2 {
  margin: 0;
  font-family: var(--serif);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
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

.badge.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.dimension-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.dimension-grid label,
.search-field {
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

.search-field {
  margin-bottom: 0.85rem;
}

.spawn-results,
.roster-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  overflow: auto;
}

.grow-panel .spawn-results {
  max-height: 27vh;
}

.roster-panel .roster-list {
  max-height: 22vh;
}

.spawn-row,
.roster-main,
.delete-button,
.secondary-button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.spawn-row,
.roster-main {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.3rem;
  padding: 0.7rem 0.85rem;
  text-align: left;
}

.spawn-row:hover,
.roster-main:hover,
.delete-button:hover,
.secondary-button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.spawn-name {
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-bright);
}

.spawn-meta,
.roster-main span {
  color: var(--ink-muted);
  font-size: 0.8rem;
  line-height: 1.4;
}

.roster-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
}

.roster-row.active .roster-main {
  border-color: var(--rule-active);
  background: var(--paper-active);
}

.delete-button,
.secondary-button {
  padding: 0.65rem 0.9rem;
  white-space: nowrap;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
  margin: 1rem 0;
}

.preview-grid div {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  padding: 0.65rem 0.8rem;
  background: var(--paper-inset);
}

.preview-grid dt {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
}

.preview-grid dd {
  margin: 0.3rem 0 0;
  font-weight: 700;
  color: var(--ink-bright);
}

.accent-card {
  border-color: var(--rule-strong);
}

.status-copy {
  padding: 0 0.2rem 1rem;
  color: var(--ink-soft);
}

.scene-loading {
  display: grid;
  place-items: center;
  min-height: 100vh;
  color: var(--ink-muted);
  background: var(--paper);
  font-style: italic;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
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

  .grow-panel .spawn-results,
  .roster-panel .roster-list {
    max-height: 32vh;
  }
}

@media (max-width: 640px) {
  .dimension-grid,
  .preview-grid {
    grid-template-columns: 1fr;
  }

  .roster-row {
    grid-template-columns: 1fr;
  }
}
</style>
