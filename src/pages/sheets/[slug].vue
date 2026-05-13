<script setup lang="ts">
import { characterSheetsBySlug } from '~~/data/characterSheets'
import { normalizeCharacterSheet } from '~/utils/sheetNormalize'
import { useEditableSheetResource } from '~/composables/sheets/useEditableSheetResource'
import { syncNatureModForSheet } from '~/composables/sheets/usePokemonNatureControls'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import { routeSlugParam } from '~/utils/routeParams'
import { sheetEditorPath } from '~/utils/sheetRoutes'
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
const router = useRouter()
const { isGm, isPlayer } = useAuth()
const slug = routeSlugParam(route.params)
const staticBaseSheet = characterSheetsBySlug.get(slug) ?? null
const { data: runtimeSheetResult } = await useFetch<{ sheet: CharacterSheet } | null>(SHEET_API_PATHS.load, {
  default: () => null,
  immediate: import.meta.dev,
  key: `pokemon-sheet-${slug}`,
  query: { kind: 'pokemon', slug },
})
const baseSheet = runtimeSheetResult.value?.sheet ?? (import.meta.dev ? null : staticBaseSheet)
const {
  sheet,
  saveStatus,
  saveError,
  renamedTo,
} = useEditableSheetResource<CharacterSheet>({
  baseSheet,
  kind: 'pokemon',
  isPlayer,
  normalize: normalizeCharacterSheet,
  prepareInitial: syncNatureModForSheet,
})

watch(renamedTo, (newSlug) => {
  if (newSlug && newSlug !== slug) router.replace(sheetEditorPath('pokemon', newSlug))
})

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
  >
    <PokemonSheetEditor
      v-if="sheet"
      :sheet="sheet"
      :is-gm="isGm"
    />

    <template #not-found>
      <SheetNotFoundCard
        title="Sheet not found"
        message="No sheet exists for slug"
        :slug="slug"
      />
    </template>
  </SheetPageShell>
</template>
