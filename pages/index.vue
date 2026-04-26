<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import IsometricGrid from '~/components/IsometricGrid.client.vue'
import SheetBrowser, { type SheetSelection } from '~/components/SheetBrowser.vue'
import type { GridAnchor, GridDimensions, SpawnedPokemon } from '~/types/pokemon'
import type { PreviewState } from '~/utils/grid'
import {
  DEFAULT_GRID_DIMENSIONS,
  findFirstAvailablePosition,
  normalizeDimensions,
  reconcilePokemonPositions,
} from '~/utils/grid'
import {
  catalogEntryForPokemonSheet,
  catalogEntryForTrainerSheet,
  pokemonHpSnapshot,
  trainerHpSnapshot,
} from '~/utils/sheetSpawn'

const createPokemonId = () => `pkm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const gridDimensions = reactive<GridDimensions>({
  ...DEFAULT_GRID_DIMENSIONS,
})

const spawnedPokemon = ref<SpawnedPokemon[]>([])
const selectedId = ref<string | null>(null)
const previewState = ref<PreviewState>({
  position: null,
  reachable: false,
  pathLength: 0,
})

const spawnSheet = (selection: SheetSelection) => {
  const catalogEntry =
    selection.kind === 'pokemon'
      ? catalogEntryForPokemonSheet(selection.sheet)
      : catalogEntryForTrainerSheet(selection.sheet)

  if (!catalogEntry) {
    return
  }

  const position = findFirstAvailablePosition(catalogEntry, spawnedPokemon.value, gridDimensions)

  if (!position) {
    return
  }

  const hp =
    selection.kind === 'pokemon'
      ? pokemonHpSnapshot(selection.sheet)
      : trainerHpSnapshot(selection.sheet)

  const displayName =
    selection.kind === 'pokemon' ? selection.sheet.nickname : selection.sheet.name

  spawnedPokemon.value = [
    ...spawnedPokemon.value,
    {
      ...catalogEntry,
      species: displayName,
      id: createPokemonId(),
      position,
      turned: false,
      sheetKind: selection.kind,
      sheetSlug: selection.sheet.slug,
      currentHp: hp.currentHp,
      maxHp: hp.maxHp,
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
  spawnedPokemon.value = spawnedPokemon.value.filter((pokemon) => pokemon.id !== id)

  if (selectedId.value === id) {
    selectPokemon(null)
  }
}

const turnPokemon = (id: string) => {
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

      <SheetBrowser @select="spawnSheet" />

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
