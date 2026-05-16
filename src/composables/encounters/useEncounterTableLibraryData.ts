import { computed, onMounted, reactive, ref } from 'vue'
import type { EncounterTableEntry } from '~/types/encounterTable'
import { useApiClient } from '~/composables/useApiClient'
import { ENCOUNTER_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import { encounterTables as staticEncounterTables } from '~/utils/encounterTables'
import { encounterTableLibraryKey } from '~/utils/encounterTableLibrary'

export interface EncounterTableListFetchResult {
  tables: EncounterTableEntry[]
}

export interface EncounterTableFolderFetchResult {
  folders: string[]
}

export interface UseEncounterTableLibraryDataOptions {
  initialEntries?: ReadonlyArray<EncounterTableEntry>
  autoRefreshOnMounted?: boolean
  fetchTables?: () => Promise<EncounterTableListFetchResult>
  fetchFolders?: () => Promise<EncounterTableFolderFetchResult>
}

const defaultFetchTables = (): Promise<EncounterTableListFetchResult> =>
  useApiClient().getJson<EncounterTableListFetchResult>(ENCOUNTER_API_PATHS.list)

const defaultFetchFolders = (): Promise<EncounterTableFolderFetchResult> =>
  useApiClient().getJson<EncounterTableFolderFetchResult>(ENCOUNTER_API_PATHS.folders)

export const useEncounterTableLibraryData = (
  options: UseEncounterTableLibraryDataOptions = {},
) => {
  const initialEntries = options.initialEntries ?? staticEncounterTables
  const tables = reactive<Map<string, EncounterTableEntry>>(new Map())
  const extraFolders = reactive(new Set<string>())
  const loading = ref(initialEntries.length === 0)
  const loadError = ref<string | null>(null)

  for (const entry of initialEntries) tables.set(encounterTableLibraryKey(entry), entry)

  const fetchTables = options.fetchTables ?? defaultFetchTables
  const fetchFolders = options.fetchFolders ?? defaultFetchFolders

  const refresh = async (): Promise<void> => {
    loading.value = true
    loadError.value = null
    try {
      const [list, folders] = await Promise.all([
        fetchTables(),
        fetchFolders(),
      ])
      tables.clear()
      for (const entry of list.tables) tables.set(encounterTableLibraryKey(entry), entry)
      extraFolders.clear()
      for (const folder of folders.folders) extraFolders.add(folder)
    } catch (err: unknown) {
      loadError.value = getErrorMessage(err)
    } finally {
      loading.value = false
    }
  }

  const items = computed(() => Array.from(tables.values()))

  if (options.autoRefreshOnMounted !== false) {
    onMounted(() => {
      void refresh()
    })
  }

  return {
    tables,
    items,
    extraFolders,
    loading,
    loadError,
    refresh,
  }
}
