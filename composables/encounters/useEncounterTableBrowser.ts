import { computed, ref } from 'vue'
import {
  countEncounterRegionTables,
  describeEntries,
  encounterRegions,
  encounterTables,
  filterEncounterTablesByRegion,
  findEncounterTableInEntries,
  firstEncounterTable,
} from '~/utils/encounterTables'
import type { EncounterTableEntry } from '~/types/encounterTable'

export interface UseEncounterTableBrowserOptions {
  entries?: readonly EncounterTableEntry[]
  regions?: readonly string[]
}

export const useEncounterTableBrowser = ({
  entries = encounterTables,
  regions = encounterRegions,
}: UseEncounterTableBrowserOptions = {}) => {
  const searchTerm = ref('')
  const filteredByRegion = computed(() =>
    filterEncounterTablesByRegion({
      entries,
      regions,
      query: searchTerm.value,
    }),
  )

  const initialEntry = firstEncounterTable(entries)
  const selectedRegion = ref<string | null>(initialEntry?.region ?? null)
  const selectedKey = ref<string | null>(initialEntry?.key ?? null)

  const selectEntry = (region: string, key: string) => {
    selectedRegion.value = region
    selectedKey.value = key
  }

  const selectedEntry = computed(() =>
    findEncounterTableInEntries(entries, selectedRegion.value, selectedKey.value),
  )

  const selectedRows = computed(() =>
    selectedEntry.value ? describeEntries(selectedEntry.value.table) : [],
  )

  const totalCount = entries.length
  const filteredCount = computed(() => countEncounterRegionTables(filteredByRegion.value))

  return {
    searchTerm,
    filteredByRegion,
    selectedRegion,
    selectedKey,
    selectEntry,
    selectedEntry,
    selectedRows,
    totalCount,
    filteredCount,
  }
}
