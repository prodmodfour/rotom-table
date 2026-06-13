<script setup lang="ts">
import { computed } from 'vue'
import { characterSheetsBySlug } from '~~/data/characterSheets'
import { normalizeCharacterSheet } from '~/utils/sheetNormalize'
import { useEditableSheetResource } from '~/composables/sheets/useEditableSheetResource'
import { useSheetRenameUrlSync } from '~/composables/sheets/useSheetRenameUrlSync'
import { syncNatureModForSheet } from '~/composables/sheets/usePokemonNatureControls'
import { syncPokemonTutorPointsForSheet } from '~/utils/sheets/pokemonTutorPoints'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import { trainerAccentColorForPokemonSheet } from '~/utils/trainerAccent'
import { getErrorMessage } from '~/utils/errorMessages'
import { routeSlugParam } from '~/utils/routeParams'
import {
  buildSheetLoadQuery,
  PLAYER_PROFILE_REQUIRED_FOR_LINKED_SHEET_MESSAGE,
  sheetApiProfileContext,
} from '~/utils/sheetApiRequests'
import type { CharacterSheet } from '~/types/characterSheet'

// ---------------------------------------------------------------------------
// Resolve the static sheet for this URL, then deep-clone + normalize it into
// an editable reactive copy. Every mutation auto-persists to disk via
// `/api/sheets/save` (see useEditableSheet).
// ---------------------------------------------------------------------------

// Route the page key off the slug so navigating from one Pokémon's sheet
// to another's forces a fresh component instance — otherwise Vue would
// reuse this one and our editable copy would still point at the old slug.
definePageMeta({
  key: (route) => `sheet-${routeSlugParam(route.params)}`,
})

const route = useRoute()
const { isGm, isPlayer } = useAuth()
const { selectedProfileId, loadRememberedProfile } = usePlayerProfiles()
if (import.meta.client && isPlayer.value) loadRememberedProfile()

const slug = routeSlugParam(route.params)
const staticBaseSheet = characterSheetsBySlug.get(slug) ?? null
const currentSheetProfileContext = () => sheetApiProfileContext(isPlayer.value, selectedProfileId.value)
const sheetLoadQuery = computed(() => buildSheetLoadQuery({
  kind: 'pokemon',
  slug,
  profileContext: currentSheetProfileContext(),
}))
const {
  data: runtimeSheetResult,
  error: runtimeSheetError,
  status: runtimeSheetStatus,
} = await useFetch<{ sheet: CharacterSheet } | null>(SHEET_API_PATHS.load, {
  default: () => null,
  immediate: true,
  key: `pokemon-sheet-${slug}`,
  query: sheetLoadQuery,
  server: !isPlayer.value,
})
const runtimeSheetLoading = computed(() => runtimeSheetStatus.value === 'idle' || runtimeSheetStatus.value === 'pending')
const staticFallbackSheet = import.meta.dev ? null : staticBaseSheet
const baseSheet = computed(() => {
  if (runtimeSheetResult.value?.sheet) return runtimeSheetResult.value.sheet
  if (isPlayer.value && runtimeSheetLoading.value && !runtimeSheetError.value) return null
  return staticFallbackSheet
})
const {
  sheet,
  editorCapabilities,
  saveStatus,
  saveError,
  renamedTo,
} = useEditableSheetResource<CharacterSheet>({
  baseSheet,
  kind: 'pokemon',
  isPlayer,
  isGm,
  normalize: normalizeCharacterSheet,
  prepareInitial: (sheet) => {
    syncNatureModForSheet(sheet)
    syncPokemonTutorPointsForSheet(sheet)
  },
  profileContext: currentSheetProfileContext,
})

useSheetRenameUrlSync({
  kind: 'pokemon',
  initialSlug: slug,
  renamedTo,
})

const sheetFolder = computed(() => sheet.value?.folder ?? '')
const sheetLoadErrorMessage = computed(() => {
  if (!runtimeSheetError.value) return null
  const message = getErrorMessage(runtimeSheetError.value)
  if (isPlayer.value && !selectedProfileId.value && message.includes('linked to the selected player profile')) {
    return PLAYER_PROFILE_REQUIRED_FOR_LINKED_SHEET_MESSAGE
  }
  return message
})
const sheetNotFoundTitle = computed(() => (
  runtimeSheetLoading.value && !runtimeSheetError.value ? 'Opening sheet…' : 'Sheet not found'
))
const sheetNotFoundMessage = computed(() => {
  if (runtimeSheetLoading.value && !runtimeSheetError.value) return 'Loading live campaign sheet for slug'
  return sheetLoadErrorMessage.value ?? 'No sheet exists for slug'
})
const sheetPathLabel = computed(() => {
  if (!sheet.value) return null
  return sheet.value.nickname || sheet.value.slug
})
const { trainerBySlug } = useLiveSheets()
const linkedTrainerAccentColor = computed(() => trainerAccentColorForPokemonSheet(
  trainerBySlug.value.values(),
  sheet.value,
))

useHead(() => ({
  title: sheet.value
    ? `${sheet.value.nickname} (${sheet.value.species}) · Sheets`
    : 'Sheet not found · Rotom Table',
}))

</script>

<template>
  <SheetPageShell
    :has-sheet="Boolean(sheet)"
    :save-status="saveStatus"
    :save-error="saveError"
    :sheet-folder="sheetFolder"
    :sheet-path-label="sheetPathLabel"
  >
    <PokemonSheetEditor
      v-if="sheet"
      :sheet="sheet"
      :capabilities="editorCapabilities"
      :accent-color="linkedTrainerAccentColor"
    />

    <template #not-found>
      <SheetNotFoundCard
        :title="sheetNotFoundTitle"
        :message="sheetNotFoundMessage"
        :slug="slug"
      />
    </template>
  </SheetPageShell>
</template>
