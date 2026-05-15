<script setup lang="ts">
import { computed } from 'vue'
import { trainerSheetsBySlug } from '~~/data/trainerSheets'
import { normalizeTrainerSheet } from '~/utils/sheetNormalize'
import { useEditableSheetResource } from '~/composables/sheets/useEditableSheetResource'
import { useSheetRenameUrlSync } from '~/composables/sheets/useSheetRenameUrlSync'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import { routeSlugParam } from '~/utils/routeParams'
import type { TrainerSheet } from '~/types/trainerSheet'

// ---------------------------------------------------------------------------
// Editable sheet wiring
// ---------------------------------------------------------------------------

// Route the page key off the slug so navigating between trainer sheets
// forces a fresh component instance and a clean editable state.
definePageMeta({
  key: (route) => `trainer-${routeSlugParam(route.params)}`,
})

const route = useRoute()
const { isGm, isPlayer } = useAuth()
const slug = routeSlugParam(route.params)
const staticBaseSheet = trainerSheetsBySlug.get(slug) ?? null
const { data: runtimeSheetResult } = await useFetch<{ sheet: TrainerSheet } | null>(SHEET_API_PATHS.load, {
  default: () => null,
  immediate: import.meta.dev,
  key: `trainer-sheet-${slug}`,
  query: { kind: 'trainer', slug },
})
const baseSheet = runtimeSheetResult.value?.sheet ?? (import.meta.dev ? null : staticBaseSheet)
const {
  sheet,
  saveStatus,
  saveError,
  renamedTo,
} = useEditableSheetResource<TrainerSheet>({
  baseSheet,
  kind: 'trainer',
  isPlayer,
  normalize: normalizeTrainerSheet,
})

useSheetRenameUrlSync({
  kind: 'trainer',
  initialSlug: slug,
  renamedTo,
})

const sheetFolder = computed(() => sheet.value?.folder ?? '')
const sheetPathLabel = computed(() => {
  if (!sheet.value) return null
  return sheet.value.name || sheet.value.slug
})

useHead(() => ({
  title: sheet.value ? `${sheet.value.name} · Trainer Sheet` : 'Trainer not found · Rotom Table',
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
    <TrainerSheetEditor
      v-if="sheet"
      :sheet="sheet"
      :is-gm="isGm"
    />

    <template #not-found>
      <SheetNotFoundCard
        title="Trainer not found"
        message="No trainer for slug"
        :slug="slug"
      />
    </template>
  </SheetPageShell>
</template>
