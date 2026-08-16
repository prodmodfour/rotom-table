<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEncounterGenerationPage } from '~/composables/encounters/useEncounterGenerationPage'
import { useEncounterTableLibraryData } from '~/composables/encounters/useEncounterTableLibraryData'
import { useMapLibraryData } from '~/composables/library/useMapLibraryData'
import { getClientId } from '~/utils/clientId'
import { useApiClient } from '~/composables/useApiClient'
import {
  parseTrainerItemExplorationAuthority,
  type TrainerItemExplorationAuthority,
} from '~/composables/sheets/useTrainerItemExploration'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'
import type { EncounterGenerationExplorationAuthorityInput } from '~/utils/encounterGeneration'

useHead({
  title: 'Generate · Rotom Table',
})

const route = useRoute()
const router = useRouter()
const encounterTableData = useEncounterTableLibraryData()
const mapLibraryData = useMapLibraryData({ clientId: getClientId() })
const mapsLoading = mapLibraryData.loading
const mapsLoadError = mapLibraryData.loadError
const spawnMaps = computed(() => Array.from(mapLibraryData.maps.values()))
const routeRepelTrainerSlug = computed(() => {
  const value = typeof route.query.trainer === 'string' ? route.query.trainer : ''
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : ''
})
const routeRepelAuthority = ref<TrainerItemExplorationAuthority | null>(null)
const routeRepelLoading = ref(false)
const routeRepelError = ref<string | null>(null)
let routeRepelLoadSequence = 0
const { getJson } = useApiClient()
watch(routeRepelTrainerSlug, async (trainerSlug) => {
  const sequence = ++routeRepelLoadSequence
  routeRepelAuthority.value = null
  routeRepelError.value = null
  if (!trainerSlug) return
  routeRepelLoading.value = true
  try {
    const loaded = parseTrainerItemExplorationAuthority(await getJson<unknown>(ITEM_API_PATHS.exploration, {
      params: { trainerSlug },
    }), trainerSlug)
    if (sequence !== routeRepelLoadSequence) return
    if (!loaded.projection.repels.some(repel => repel.active)) {
      routeRepelError.value = 'This Trainer no longer has an active route Repel. Refresh the Trainer activity before generating.'
      return
    }
    routeRepelAuthority.value = loaded
  }
  catch (error) {
    if (sequence === routeRepelLoadSequence) {
      routeRepelError.value = error instanceof Error ? error.message : 'Route Repel authority could not be loaded.'
    }
  }
  finally {
    if (sequence === routeRepelLoadSequence) routeRepelLoading.value = false
  }
}, { immediate: true })
const activeRouteRepel = computed(() => routeRepelAuthority.value?.projection.repels
  .filter(repel => repel.active)
  .sort((left, right) => right.maximumAffectedWildLevel - left.maximumAffectedWildLevel
    || right.expiresAtCampaignMinute - left.expiresAtCampaignMinute)[0] ?? null)
const explorationAuthority = computed<EncounterGenerationExplorationAuthorityInput | null>(() => (
  routeRepelAuthority.value && activeRouteRepel.value
    ? {
        trainerSlug: routeRepelAuthority.value.trainerSlug,
        trainerRevision: routeRepelAuthority.value.trainerRevision,
        campaignClockRevision: routeRepelAuthority.value.campaignClockRevision,
      }
    : null
))
const routeRepelBlocked = computed(() => Boolean(routeRepelTrainerSlug.value) && explorationAuthority.value === null)

const {
  region,
  regions,
  tableKey,
  countMin,
  countMax,
  outRoot,
  preview,
  spawnMapSlug,
  tablesForRegion,
  selectedTable,
  rolledPreview,
  rollPreview,
  generating,
  spawning,
  busy,
  canSpawn,
  error,
  result,
  generate,
  spawn,
  openFiles,
  toggleFile,
} = useEncounterGenerationPage({
  query: route.query,
  entries: encounterTableData.items,
  maps: spawnMaps,
  explorationAuthority,
  commandsBlocked: routeRepelBlocked,
  replaceQuery: async (query) => {
    await router.replace({
      query: {
        ...query,
        ...(routeRepelTrainerSlug.value ? { trainer: routeRepelTrainerSlug.value } : {}),
      },
    })
  },
})
</script>

<template>
  <div class="generate-layout">
    <header class="generate-header">
      <AppNavigation />
    </header>

    <main class="generate-main">
      <EncounterGenerateSetupCard
        v-model:region="region"
        v-model:table-key="tableKey"
        v-model:count-min="countMin"
        v-model:count-max="countMax"
        v-model:out-root="outRoot"
        v-model:preview="preview"
        v-model:spawn-map-slug="spawnMapSlug"
        :regions="regions"
        :tables-for-region="tablesForRegion"
        :selected-table="selectedTable"
        :spawn-maps="spawnMaps"
        :maps-loading="mapsLoading"
        :maps-load-error="mapsLoadError"
        :generating="busy || routeRepelBlocked"
        :folder-generating="generating"
        :spawning="spawning"
        :can-spawn="canSpawn"
        @roll-preview="rollPreview"
        @generate="generate"
        @spawn="spawn"
      />

      <section
        v-if="routeRepelTrainerSlug"
        class="route-repel-context"
        :class="{ 'route-repel-context--blocked': routeRepelBlocked }"
        aria-labelledby="route-repel-context-heading"
        :aria-busy="routeRepelLoading"
      >
        <div class="route-repel-context__heading">
          <p>Exploration authority</p>
          <h2 id="route-repel-context-heading">Route ward</h2>
        </div>
        <div class="route-repel-context__detail">
          <p v-if="routeRepelLoading" role="status">Loading the exact current Trainer and campaign-clock authority…</p>
          <p v-else-if="routeRepelError" role="alert">{{ routeRepelError }}</p>
          <template v-else-if="activeRouteRepel && routeRepelAuthority">
            <strong>{{ activeRouteRepel.itemLabel }}</strong>
            <span>
              {{ routeRepelAuthority.trainerSlug }} · filters wild Pokémon at Level
              {{ activeRouteRepel.maximumAffectedWildLevel }} or lower · through campaign minute
              {{ activeRouteRepel.expiresAtCampaignMinute.toLocaleString() }}
            </span>
            <small>The server revalidates this exact Trainer revision and campaign clock before generation and again inside spawn commit.</small>
          </template>
        </div>
        <NuxtLink to="/generate">Clear route context</NuxtLink>
      </section>

      <EncounterRolledPreviewCard
        v-if="rolledPreview.length"
        :encounters="rolledPreview"
      />

      <EncounterGenerateErrorCard v-if="error" :message="error" />

      <EncounterGenerateResultCard
        v-if="result"
        :result="result"
        :table-key="tableKey"
        :count="result.count ?? result.rolled.length"
        :open-files="openFiles"
        @toggle-file="toggleFile"
      />
    </main>
  </div>
</template>

<style scoped>
.generate-layout {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  min-height: 100vh;
  background: var(--paper);
  color: var(--ink);
}

.generate-header {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.generate-main {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.route-repel-context {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem 1rem;
  border: 1px solid var(--rule);
  border-inline-start: 4px solid var(--rt-pending);
  border-radius: 0 14px 14px 0;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.85rem 1rem;
}
.route-repel-context--blocked { border-inline-start-color: var(--rt-danger); }
.route-repel-context__heading p,
.route-repel-context__heading h2,
.route-repel-context__detail p { margin: 0; }
.route-repel-context__heading p { color: var(--ink-muted); font-size: 0.7rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
.route-repel-context__heading h2 { color: var(--ink-bright); font-family: var(--font-book); font-size: 1.1rem; }
.route-repel-context__detail { display: grid; gap: 0.15rem; min-width: 0; }
.route-repel-context strong { color: var(--rt-pending); }
.route-repel-context span,
.route-repel-context small,
.route-repel-context__detail p { color: var(--ink-soft); font-size: 0.8rem; line-height: 1.45; }
.route-repel-context small { color: var(--ink-muted); }
.route-repel-context a { min-height: 2.75rem; align-self: center; color: var(--ink-bright); }
@media (max-width: 720px) {
  .route-repel-context { grid-template-columns: minmax(0, 1fr); }
  .route-repel-context a { grid-column: 1; grid-row: auto; }
  .route-repel-context a { min-height: 2.75rem; }
}

</style>
