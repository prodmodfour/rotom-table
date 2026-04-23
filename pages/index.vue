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
const statusMessage = ref('')

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

const setStatus = (message: string) => {
  statusMessage.value = message
}

const spawnEntry = (entry: PokemonCatalogEntry) => {
  const position = findFirstAvailablePosition(entry, spawnedPokemon.value, gridDimensions)

  if (!position) {
    setStatus(`No room left in the current grid for ${entry.species}.`)
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
  setStatus(`Spawned ${entry.species} at (${position.x}, ${position.y}, ${position.z}).`)
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

  if (target) {
    setStatus(`Removed ${target.species} from the board.`)
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

  setStatus(`Turned ${target.species}.`)
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
  setStatus(`Moved ${target.species} to (${payload.position.x}, ${payload.position.y}, ${payload.position.z}).`)
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
      setStatus(
        `Grid resized. ${reconciliation.removedIds.length} board pieces no longer fit and were removed.`,
      )
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="layout-shell">
    <aside class="sidebar">
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

      <p v-if="statusMessage" class="status-copy">
        {{ statusMessage }}
      </p>
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
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  border-right: 1px solid rgba(96, 165, 250, 0.2);
  background:
    linear-gradient(180deg, rgba(4, 13, 30, 0.98), rgba(5, 11, 24, 0.94)),
    radial-gradient(circle at top, rgba(29, 78, 216, 0.18), transparent 55%);
  max-height: 100vh;
  overflow: auto;
}

.scene-column {
  min-width: 0;
  min-height: 100vh;
}

.panel-card {
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 18px;
  background: rgba(8, 20, 43, 0.82);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.22);
  padding: 1rem;
}

.panel-heading h2 {
  margin: 0;
}

.status-copy {
  margin: 0.75rem 0 0;
  color: rgba(219, 234, 254, 0.8);
  line-height: 1.5;
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
  padding: 0.28rem 0.7rem;
  background: rgba(37, 99, 235, 0.18);
  color: #bfdbfe;
  font-size: 0.78rem;
  white-space: nowrap;
}

.badge.active {
  background: rgba(14, 165, 233, 0.18);
  color: #bae6fd;
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
  font-size: 0.84rem;
  color: rgba(191, 219, 254, 0.86);
}

input {
  width: 100%;
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.96);
  color: #eff6ff;
  padding: 0.72rem 0.85rem;
  outline: none;
}

input:focus {
  border-color: rgba(125, 211, 252, 0.8);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.15);
}

.search-field {
  margin-bottom: 0.85rem;
}

.spawn-results,
.roster-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
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
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.8);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.15s ease;
}

.spawn-row,
.roster-main {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  padding: 0.85rem 0.9rem;
  text-align: left;
}

.spawn-row:hover,
.roster-main:hover,
.delete-button:hover,
.secondary-button:hover {
  border-color: rgba(125, 211, 252, 0.7);
  background: rgba(16, 33, 63, 0.92);
  transform: translateY(-1px);
}

.spawn-name {
  font-weight: 700;
}

.spawn-meta,
.roster-main span {
  color: rgba(191, 219, 254, 0.76);
  font-size: 0.83rem;
  line-height: 1.4;
}

.roster-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
}

.roster-row.active .roster-main {
  border-color: rgba(125, 211, 252, 0.82);
  background: rgba(11, 47, 92, 0.85);
}

.delete-button,
.secondary-button {
  padding: 0.7rem 0.95rem;
  white-space: nowrap;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 1rem 0;
}

.preview-grid div {
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-radius: 14px;
  padding: 0.75rem 0.85rem;
  background: rgba(9, 18, 35, 0.6);
}

.preview-grid dt {
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(125, 211, 252, 0.74);
}

.preview-grid dd {
  margin: 0.35rem 0 0;
  font-weight: 700;
}

.accent-card {
  border-color: rgba(125, 211, 252, 0.4);
}

.status-copy {
  padding: 0 0.2rem 1rem;
}

.scene-loading {
  display: grid;
  place-items: center;
  min-height: 100vh;
  color: rgba(219, 234, 254, 0.75);
  background: radial-gradient(circle at top, rgba(37, 99, 235, 0.15), transparent 45%), #050d1b;
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
    border-bottom: 1px solid rgba(96, 165, 250, 0.2);
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
