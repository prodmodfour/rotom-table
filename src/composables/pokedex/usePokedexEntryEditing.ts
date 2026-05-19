import { ref, watch } from 'vue'
import { getErrorMessage } from '~/utils/errorMessages'
import type { PokedexEntryMutationResponse } from '~/utils/pokedex/admin'
import type { PokedexEntryDetail } from '~/utils/pokedex/entryIndex'
import { toEditablePokedexRecord } from '~/utils/pokedex/persistence'

interface BooleanRef {
  readonly value: boolean
}

interface EntryRef {
  readonly value: PokedexEntryDetail | null
}

export interface UsePokedexEntryEditingOptions {
  isGm: BooleanRef
  selectedEntry: EntryRef
  afterMutation: (previousSlug: string, entry: PokedexEntryDetail) => Promise<void>
  saveEntry: (slug: string, entry: Record<string, unknown>) => Promise<PokedexEntryMutationResponse>
}

const editableEntryJson = (entry: PokedexEntryDetail | null): string | null => {
  const editableEntry = toEditablePokedexRecord(entry as Record<string, unknown> | null)
  return editableEntry ? JSON.stringify(editableEntry, null, 2) : null
}

const parseEntryDraft = (draftJson: string): Record<string, unknown> => {
  const parsed = JSON.parse(draftJson) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Pokédex entry JSON must be an object.')
  }
  return parsed as Record<string, unknown>
}

export const usePokedexEntryEditing = ({
  isGm,
  selectedEntry,
  afterMutation,
  saveEntry,
}: UsePokedexEntryEditingOptions) => {
  const isEditMode = ref(false)
  const draftJson = ref('')
  const errorMessage = ref<string | null>(null)
  const statusMessage = ref<string | null>(null)
  const isSaving = ref(false)

  const resetMessages = (): void => {
    errorMessage.value = null
    statusMessage.value = null
  }

  const replaceDraftWithEntry = (entry: PokedexEntryDetail): void => {
    draftJson.value = JSON.stringify(toEditablePokedexRecord(entry), null, 2)
  }

  const enterEditMode = (): void => {
    if (!isGm.value) return

    const draft = editableEntryJson(selectedEntry.value)
    if (!draft) return

    draftJson.value = draft
    resetMessages()
    isEditMode.value = true
  }

  const exitEditMode = (): void => {
    if (isSaving.value) return

    isEditMode.value = false
    resetMessages()
  }

  const saveEditedEntry = async (): Promise<void> => {
    const currentEntry = selectedEntry.value
    if (!isGm.value || !currentEntry || isSaving.value) return

    resetMessages()

    let entry: Record<string, unknown>
    try {
      entry = parseEntryDraft(draftJson.value)
    } catch (error) {
      errorMessage.value = getErrorMessage(error, { fallback: 'Invalid Pokédex entry JSON.' })
      return
    }

    isSaving.value = true
    try {
      const result = await saveEntry(currentEntry.slug, entry)
      await afterMutation(currentEntry.slug, result.entry)
      replaceDraftWithEntry(result.entry)
      statusMessage.value = `Saved ${result.entry.species}.`
    } catch (error) {
      errorMessage.value = getErrorMessage(error, { fallback: 'Unable to save Pokédex entry.' })
    } finally {
      isSaving.value = false
    }
  }

  watch(() => selectedEntry.value?.slug ?? null, (nextSlug, previousSlug) => {
    if (!previousSlug || nextSlug === previousSlug || !isEditMode.value) return

    isEditMode.value = false
    resetMessages()
  })

  watch(() => isGm.value, (nextIsGm) => {
    if (nextIsGm) return

    isEditMode.value = false
    resetMessages()
  })

  return {
    draftJson,
    enterEditMode,
    errorMessage,
    exitEditMode,
    isEditMode,
    isSaving,
    replaceDraftWithEntry,
    saveEditedEntry,
    statusMessage,
  }
}
