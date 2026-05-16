import { ref, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import type { EncounterTableEntry } from '~/types/encounterTable'
import { getErrorMessage } from '~/utils/errorMessages'

export interface CreatedEncounterTableResult {
  ok: true
  entry: EncounterTableEntry
}

export interface EncounterTableCreationState {
  creating: Ref<boolean>
  createError: Ref<string | null>
}

export interface UseEncounterTableLibraryCreationOptions {
  canCreate: MaybeRefOrGetter<boolean>
  currentPath: MaybeRefOrGetter<string>
  createTable: (folder: string) => Promise<CreatedEncounterTableResult> | CreatedEncounterTableResult
  onCreated?: (entry: EncounterTableEntry) => void
  state?: EncounterTableCreationState
}

export const useEncounterTableLibraryCreation = (
  options: UseEncounterTableLibraryCreationOptions,
) => {
  const creating = options.state?.creating ?? ref(false)
  const createError = options.state?.createError ?? ref<string | null>(null)

  const createNewTable = async (): Promise<EncounterTableEntry | null> => {
    if (!toValue(options.canCreate) || creating.value) return null

    creating.value = true
    createError.value = null

    try {
      const result = await options.createTable(toValue(options.currentPath))
      options.onCreated?.(result.entry)
      return result.entry
    } catch (err: unknown) {
      createError.value = getErrorMessage(err)
      return null
    } finally {
      creating.value = false
    }
  }

  return {
    creating,
    createError,
    createNewTable,
  }
}
