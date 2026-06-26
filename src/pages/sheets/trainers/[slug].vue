<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { normalizeTrainerSheet } from '~/utils/sheetNormalize'
import { useEditableSheetResource } from '~/composables/sheets/useEditableSheetResource'
import { useSheetRenameUrlSync } from '~/composables/sheets/useSheetRenameUrlSync'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import { routeSlugParam } from '~/utils/routeParams'
import {
  buildSheetLoadQuery,
  PLAYER_PROFILE_REQUIRED_FOR_LINKED_SHEET_MESSAGE,
  sheetApiProfileContext,
} from '~/utils/sheetApiRequests'
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
const { selectedProfileId, loadRememberedProfile } = usePlayerProfiles()
const { reloadRuntimeSheets } = useLiveSheets()
if (import.meta.client && isPlayer.value) loadRememberedProfile()

const slug = routeSlugParam(route.params)
const currentSheetProfileContext = () => sheetApiProfileContext(isPlayer.value, selectedProfileId.value)
const sheetLoadQuery = computed(() => buildSheetLoadQuery({
  kind: 'trainer',
  slug,
  profileContext: currentSheetProfileContext(),
}))
const {
  data: runtimeSheetResult,
  error: runtimeSheetError,
  status: runtimeSheetStatus,
} = await useFetch<{ sheet: TrainerSheet } | null>(SHEET_API_PATHS.load, {
  default: () => null,
  immediate: true,
  key: `trainer-sheet-${slug}`,
  query: sheetLoadQuery,
  server: !isPlayer.value,
})
const runtimeSheetLoading = computed(() => runtimeSheetStatus.value === 'idle' || runtimeSheetStatus.value === 'pending')
const baseSheet = computed(() => runtimeSheetResult.value?.sheet ?? null)
const {
  sheet,
  editorCapabilities,
  saveStatus,
  saveError,
  renamedTo,
} = useEditableSheetResource<TrainerSheet>({
  baseSheet,
  kind: 'trainer',
  isPlayer,
  isGm,
  normalize: normalizeTrainerSheet,
  profileContext: currentSheetProfileContext,
})

useSheetRenameUrlSync({
  kind: 'trainer',
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
  runtimeSheetLoading.value && !runtimeSheetError.value ? 'Opening trainer sheet…' : 'Trainer not found'
))
const sheetNotFoundMessage = computed(() => {
  if (runtimeSheetLoading.value && !runtimeSheetError.value) return 'Loading live campaign trainer sheet for slug'
  return sheetLoadErrorMessage.value ?? 'No trainer for slug'
})
const sheetPathLabel = computed(() => {
  if (!sheet.value) return null
  return sheet.value.name || sheet.value.slug
})

const syncLiveSheetsForPlayerProfile = async () => {
  if (!import.meta.client || !isPlayer.value) return
  loadRememberedProfile()
  await reloadRuntimeSheets({ profileId: selectedProfileId.value })
}

onMounted(() => {
  void syncLiveSheetsForPlayerProfile()
})

watch(selectedProfileId, () => {
  void syncLiveSheetsForPlayerProfile()
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
    :show-path-breadcrumbs="!isPlayer"
  >
    <TrainerSheetEditor
      v-if="sheet"
      :sheet="sheet"
      :capabilities="editorCapabilities"
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
