import { computed, ref, watch } from 'vue'
import { getErrorMessage } from '~/utils/errorMessages'
import type { PokedexEntryMutationResponse } from '~/utils/pokedex/admin'
import type { PokedexEntryDetail } from '~/utils/pokedex/entryIndex'

interface BooleanRef {
  readonly value: boolean
}

interface EntryRef {
  readonly value: PokedexEntryDetail | null
}

export interface UsePokedexAdminPanelOptions {
  isGm: BooleanRef
  selectedEntry: EntryRef
  afterMutation: (previousSlug: string, entry: PokedexEntryDetail) => Promise<void>
  onRestoredEntry?: (entry: PokedexEntryDetail) => void
  restoreFromBooks: (slug: string) => Promise<PokedexEntryMutationResponse>
}

export const usePokedexAdminPanel = ({
  isGm,
  selectedEntry,
  afterMutation,
  onRestoredEntry,
  restoreFromBooks,
}: UsePokedexAdminPanelOptions) => {
  const isOpen = ref(false)
  const errorMessage = ref<string | null>(null)
  const statusMessage = ref<string | null>(null)
  const isRestoring = ref(false)
  const selectedSpeciesName = computed(() => selectedEntry.value?.species ?? null)

  const resetMessages = (): void => {
    errorMessage.value = null
    statusMessage.value = null
  }

  const close = (): void => {
    isOpen.value = false
  }

  const open = (): void => {
    if (!isGm.value) return

    resetMessages()
    isOpen.value = true
  }

  const restoreSelectedEntryFromBooks = async (): Promise<void> => {
    const currentEntry = selectedEntry.value
    if (!isGm.value || !currentEntry || isRestoring.value) return

    resetMessages()
    isRestoring.value = true

    try {
      const result = await restoreFromBooks(currentEntry.slug)
      await afterMutation(currentEntry.slug, result.entry)
      onRestoredEntry?.(result.entry)
      statusMessage.value = `Restored ${result.entry.species} from PTU markdown books.`
    } catch (error) {
      errorMessage.value = getErrorMessage(error, { fallback: 'Unable to restore Pokédex entry.' })
    } finally {
      isRestoring.value = false
    }
  }

  watch(() => isGm.value, (nextIsGm) => {
    if (nextIsGm) return
    close()
  })

  return {
    close,
    errorMessage,
    isOpen,
    isRestoring,
    open,
    restoreSelectedEntryFromBooks,
    selectedSpeciesName,
    statusMessage,
  }
}
