import { computed, ref, type Ref } from 'vue'
import type { PokemonCatalogEntry } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

export function useTrainerPortraitPicker(
  sheet: Readonly<Ref<TrainerSheet | null>>,
  catalog: readonly PokemonCatalogEntry[],
) {
  const portraitPickerOpen = ref(false)
  const portraitQuery = ref('')

  const filteredPortraitOptions = computed(() => {
    const q = portraitQuery.value.trim().toLowerCase()
    if (!q) return catalog

    return catalog.filter(
      (entry) =>
        entry.species.toLowerCase().includes(q) ||
        (entry.slug?.toLowerCase().includes(q) ?? false),
    )
  })

  const openPortraitPicker = () => {
    portraitQuery.value = ''
    portraitPickerOpen.value = true
  }

  const closePortraitPicker = () => {
    portraitPickerOpen.value = false
  }

  const selectPortrait = (url: string) => {
    if (!sheet.value) return
    sheet.value.portraitUrl = url
    closePortraitPicker()
  }

  const clearPortrait = () => {
    if (!sheet.value) return
    sheet.value.portraitUrl = undefined
  }

  return {
    portraitPickerOpen,
    portraitQuery,
    filteredPortraitOptions,
    openPortraitPicker,
    closePortraitPicker,
    selectPortrait,
    clearPortrait,
  }
}
