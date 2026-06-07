<script setup lang="ts">
import { usePokedexAdminPanel } from '~/composables/pokedex/usePokedexAdminPanel'
import { usePokedexBrowser } from '~/composables/pokedex/usePokedexBrowser'
import { usePokedexEntryEditing } from '~/composables/pokedex/usePokedexEntryEditing'
import { useApiClient } from '~/composables/useApiClient'
import { useAuth } from '~/composables/useAuth'
import { useWindowKeydown } from '~/composables/useWindowKeydown'
import { POKEDEX_API_PATHS } from '~/utils/apiRoutes'
import { isCtrlLetter, isCtrlShiftLetter, isEscapeKey } from '~/utils/keyboardShortcuts'
import type { PokedexEntryMutationResponse } from '~/utils/pokedex/admin'
import { pokedexEntryPath, type PokedexEntryDetail } from '~/utils/pokedex/entryIndex'
import { isPokedexPath } from '~/utils/pokedex/routes'

definePageMeta({
  // Keep the browser mounted between /pokedex and /pokedex/:pokemon_name so
  // selecting a Pokémon updates the detail pane in-place instead of feeling
  // like a whole new page load.
  key: 'pokedex-browser',
  scrollToTop: (to, from) => !(isPokedexPath(to.path) && isPokedexPath(from.path)),
})

const {
  capabilityTokens,
  dietSummary,
  displayedEvolutions,
  eggGroupSummary,
  eggMoveTokens,
  filterMode,
  filterOperators,
  filteredEntries,
  genderSummary,
  goToRandomPokemon,
  habitatSummary,
  heightLabel,
  isPlacementOnly,
  isSearchIndexLoading,
  pageNumber,
  pageTitle,
  ready,
  refreshPokedexData,
  requestedPokemonName,
  searchFilters,
  searchIndexErrorMessage,
  selectedEntry,
  selectedId,
  selectedSpriteUrl,
  skillPhrase,
  tmHmTokens,
  tutorMoveTokens,
  typeMatchupGroups,
  weightLabel,
} = usePokedexBrowser()

const apiClient = useApiClient()
const router = useRouter()
const { isGm } = useAuth()

const isTextEntryTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable
}

useHead(() => ({ title: pageTitle.value }))

const routeToMutatedEntry = async (
  previousSlug: string,
  entry: PokedexEntryDetail,
): Promise<void> => {
  await refreshPokedexData()

  if (entry.slug !== previousSlug) {
    await router.replace(pokedexEntryPath(entry))
  }
}

const saveEntry = (slug: string, entry: Record<string, unknown>): Promise<PokedexEntryMutationResponse> => (
  apiClient.postJson<PokedexEntryMutationResponse>(POKEDEX_API_PATHS.update, { slug, entry })
)

const restoreFromBooks = (slug: string): Promise<PokedexEntryMutationResponse> => (
  apiClient.postJson<PokedexEntryMutationResponse>(POKEDEX_API_PATHS.restoreFromBooks, { slug })
)

const {
  draftJson: entryDraftJson,
  enterEditMode,
  errorMessage: entryEditErrorMessage,
  exitEditMode,
  isEditMode,
  isSaving: isSavingEntry,
  replaceDraftWithEntry,
  saveEditedEntry,
  statusMessage: entryEditStatusMessage,
} = usePokedexEntryEditing({
  afterMutation: routeToMutatedEntry,
  isGm,
  saveEntry,
  selectedEntry,
})

const {
  close: closeAdminPanel,
  errorMessage: adminErrorMessage,
  isOpen: isAdminPanelOpen,
  isRestoring: isRestoringEntry,
  open: openAdminPanel,
  restoreSelectedEntryFromBooks,
  selectedSpeciesName,
  statusMessage: adminStatusMessage,
} = usePokedexAdminPanel({
  afterMutation: routeToMutatedEntry,
  isGm,
  onRestoredEntry: replaceDraftWithEntry,
  restoreFromBooks,
  selectedEntry,
})

useWindowKeydown((event) => {
  if (isCtrlLetter(event, 'r')) {
    event.preventDefault()
    if (!event.repeat) goToRandomPokemon()
    return
  }

  if (isCtrlLetter(event, 'e')) {
    if (!isGm.value || isEditMode.value) return

    event.preventDefault()
    if (!event.repeat) enterEditMode()
    return
  }

  if (isCtrlShiftLetter(event, 'a')) {
    if (!isGm.value || isTextEntryTarget(event.target)) return

    event.preventDefault()
    if (!event.repeat) openAdminPanel()
    return
  }

  if (isEscapeKey(event) && isAdminPanelOpen.value) {
    closeAdminPanel()
  }
})

await ready
</script>

<template>
  <div class="pokedex-layout">
    <PokedexSidebar
      v-model:filter-mode="filterMode"
      :entries="filteredEntries"
      :filter-operators="filterOperators"
      :is-search-index-loading="isSearchIndexLoading"
      :search-filters="searchFilters"
      :search-index-error-message="searchIndexErrorMessage"
      :selected-id="selectedId"
    />

    <PokedexEntryEditor
      v-if="isEditMode && selectedEntry"
      v-model:draft="entryDraftJson"
      :error-message="entryEditErrorMessage"
      :is-saving="isSavingEntry"
      :species="selectedEntry.species"
      :status-message="entryEditStatusMessage"
      @cancel="exitEditMode"
      @save="saveEditedEntry"
    />

    <PokedexEntryDetail
      v-else
      :capability-tokens="capabilityTokens"
      :diet-summary="dietSummary"
      :displayed-evolutions="displayedEvolutions"
      :egg-group-summary="eggGroupSummary"
      :egg-move-tokens="eggMoveTokens"
      :entry="selectedEntry"
      :gender-summary="genderSummary"
      :habitat-summary="habitatSummary"
      :height-label="heightLabel"
      :is-placement-only="isPlacementOnly"
      :page-number="pageNumber"
      :requested-pokemon-name="requestedPokemonName"
      :skill-phrase="skillPhrase"
      :sprite-url="selectedSpriteUrl"
      :tm-hm-tokens="tmHmTokens"
      :tutor-move-tokens="tutorMoveTokens"
      :type-matchup-groups="typeMatchupGroups"
      :weight-label="weightLabel"
    />

    <PokedexAdminPanel
      v-if="isAdminPanelOpen"
      :error-message="adminErrorMessage"
      :is-restoring="isRestoringEntry"
      :species="selectedSpeciesName"
      :status-message="adminStatusMessage"
      @close="closeAdminPanel"
      @restore-from-books="restoreSelectedEntryFromBooks"
    />
  </div>
</template>

<style scoped>
.pokedex-layout {
  display: grid;
  grid-template-columns: minmax(560px, 700px) minmax(0, 1fr);
  min-height: 100vh;
  background: var(--paper);
}

@media (max-width: 1040px) {
  .pokedex-layout {
    grid-template-columns: 1fr;
  }
}
</style>
