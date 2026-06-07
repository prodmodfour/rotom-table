import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useApiClient } from '~/composables/useApiClient'
import { ENCOUNTER_API_PATHS } from '~/utils/apiRoutes'
import {
  encounterRegionsForEntries,
  encounterTables,
  findEncounterTableInEntries,
  rollEncounters,
  tablesInRegionFromEntries,
} from '~/utils/encounterTables'
import {
  buildEncounterGenerateRequestBody,
  clampEncounterGenerateCount,
  coerceTableKeyForRegion,
  DEFAULT_ENCOUNTER_COUNT_RANGE,
  DEFAULT_ENCOUNTER_OUT_ROOT,
  errorMessageForEncounterGenerate,
  initialEncounterGenerationSelection,
  randomEncounterGenerateCount,
  toggleOpenGenerateFile,
  type EncounterGenerateRequestBody,
  type EncounterGenerateResult,
} from '~/utils/encounterGeneration'
import type { EncounterTableEntry, RolledEncounter } from '~/types/encounterTable'

export interface UseEncounterGenerationPageOptions {
  query: Record<string, unknown>
  replaceQuery?: (query: { region: string; table: string }) => void | Promise<void>
  entries?: MaybeRefOrGetter<readonly EncounterTableEntry[]>
  fetchGenerate?: (body: EncounterGenerateRequestBody) => Promise<EncounterGenerateResult>
}

export const useEncounterGenerationPage = ({
  query,
  replaceQuery,
  entries = encounterTables,
  fetchGenerate = (body) => useApiClient().postJson<EncounterGenerateResult>(ENCOUNTER_API_PATHS.generate, body),
}: UseEncounterGenerationPageOptions) => {
  const allTables = computed(() => Array.from(toValue(entries)))
  const regions = computed(() => encounterRegionsForEntries(allTables.value))
  const initialEntry = allTables.value[0] ?? null
  const initialSelection = initialEncounterGenerationSelection(query, initialEntry)
  const region = ref<string>(initialSelection.region)
  const tableKey = ref<string>(initialSelection.tableKey)
  const countMin = ref<number>(DEFAULT_ENCOUNTER_COUNT_RANGE.min)
  const countMax = ref<number>(DEFAULT_ENCOUNTER_COUNT_RANGE.max)
  const outRoot = ref<string>(DEFAULT_ENCOUNTER_OUT_ROOT)
  const preview = ref<boolean>(false)

  watch(region, (next) => {
    tableKey.value = coerceTableKeyForRegion(tableKey.value, tablesInRegionFromEntries(allTables.value, next))
  })

  watch(allTables, (next) => {
    if (!region.value && !tableKey.value && next[0]) {
      region.value = next[0].region
      tableKey.value = next[0].key
      return
    }
    if (region.value && !tableKey.value) {
      tableKey.value = coerceTableKeyForRegion(tableKey.value, tablesInRegionFromEntries(next, region.value))
    }
  })

  const tablesForRegion = computed(() => tablesInRegionFromEntries(allTables.value, region.value))
  const selectedTable = computed(() => findEncounterTableInEntries(allTables.value, region.value, tableKey.value))

  watch(countMin, (next) => {
    const clamped = clampEncounterGenerateCount(next)
    if (countMin.value !== clamped) countMin.value = clamped
    if (countMax.value < clamped) countMax.value = clamped
  })

  watch(countMax, (next) => {
    const clamped = clampEncounterGenerateCount(next)
    if (countMax.value !== clamped) countMax.value = clamped
    if (countMin.value > clamped) countMin.value = clamped
  })

  const rolledPreview = ref<RolledEncounter[]>([])
  const rollPreview = () => {
    if (!selectedTable.value) return
    const encounterCount = randomEncounterGenerateCount({ min: countMin.value, max: countMax.value })
    rolledPreview.value = rollEncounters(selectedTable.value.table, encounterCount)
  }

  watch(
    [selectedTable, countMin, countMax],
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
        countMin: countMin.value,
        countMax: countMax.value,
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
    regions,
    tableKey,
    countMin,
    countMax,
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
