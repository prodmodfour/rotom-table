import { computed, ref, watch } from 'vue'
import { ENCOUNTER_API_PATHS } from '~/utils/apiRoutes'
import {
  encounterTables,
  findEncounterTable,
  rollEncounters,
  tablesInRegion,
} from '~/utils/encounterTables'
import {
  buildEncounterGenerateRequestBody,
  clampEncounterGenerateCount,
  coerceTableKeyForRegion,
  DEFAULT_ENCOUNTER_COUNT,
  DEFAULT_ENCOUNTER_OUT_ROOT,
  errorMessageForEncounterGenerate,
  initialEncounterGenerationSelection,
  toggleOpenGenerateFile,
  type EncounterGenerateRequestBody,
  type EncounterGenerateResult,
} from '~/utils/encounterGeneration'
import type { RolledEncounter } from '~/types/encounterTable'

export interface UseEncounterGenerationPageOptions {
  query: Record<string, unknown>
  replaceQuery?: (query: { region: string; table: string }) => void | Promise<void>
  fetchGenerate?: (body: EncounterGenerateRequestBody) => Promise<EncounterGenerateResult>
}

export const useEncounterGenerationPage = ({
  query,
  replaceQuery,
  fetchGenerate = (body) => $fetch<EncounterGenerateResult>(ENCOUNTER_API_PATHS.generate, { method: 'POST', body }),
}: UseEncounterGenerationPageOptions) => {
  const initialEntry = encounterTables[0] ?? null
  const initialSelection = initialEncounterGenerationSelection(query, initialEntry)
  const region = ref<string>(initialSelection.region)
  const tableKey = ref<string>(initialSelection.tableKey)
  const count = ref<number>(DEFAULT_ENCOUNTER_COUNT)
  const outRoot = ref<string>(DEFAULT_ENCOUNTER_OUT_ROOT)
  const preview = ref<boolean>(false)

  watch(region, (next) => {
    tableKey.value = coerceTableKeyForRegion(tableKey.value, tablesInRegion(next))
  })

  const tablesForRegion = computed(() => tablesInRegion(region.value))
  const selectedTable = computed(() => findEncounterTable(region.value, tableKey.value))

  const rolledPreview = ref<RolledEncounter[]>([])
  const rollPreview = () => {
    if (!selectedTable.value) return
    rolledPreview.value = rollEncounters(selectedTable.value.table, clampEncounterGenerateCount(count.value))
  }

  watch(
    [selectedTable, count],
    () => {
      if (selectedTable.value) rollPreview()
    },
    { immediate: true },
  )

  const generating = ref(false)
  const error = ref<string | null>(null)
  const result = ref<EncounterGenerateResult | null>(null)

  const generate = async () => {
    if (!selectedTable.value) return
    generating.value = true
    error.value = null
    result.value = null
    try {
      result.value = await fetchGenerate(buildEncounterGenerateRequestBody({
        region: region.value,
        tableKey: tableKey.value,
        count: count.value,
        outRoot: outRoot.value,
        preview: preview.value,
      }))
    } catch (err: unknown) {
      error.value = errorMessageForEncounterGenerate(err)
    } finally {
      generating.value = false
    }
  }

  const openFiles = ref<Set<string>>(new Set())
  const toggleFile = (name: string) => {
    openFiles.value = toggleOpenGenerateFile(openFiles.value, name)
  }
  const isOpen = (name: string) => openFiles.value.has(name)

  watch([region, tableKey], () => {
    void replaceQuery?.({ region: region.value, table: tableKey.value })
  })

  return {
    region,
    tableKey,
    count,
    outRoot,
    preview,
    tablesForRegion,
    selectedTable,
    rolledPreview,
    rollPreview,
    generating,
    error,
    result,
    generate,
    openFiles,
    toggleFile,
    isOpen,
  }
}
