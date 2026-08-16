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
  buildEncounterSpawnRequestBody,
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
  type EncounterGenerationExplorationAuthorityInput,
  type EncounterSpawnRequestBody,
} from '~/utils/encounterGeneration'
import { getClientId } from '~/utils/clientId'
import type { EncounterTableEntry, RolledEncounter } from '~/types/encounterTable'
import type { MapSummary } from '~/types/map'

const queryString = (value: unknown, fallback = ''): string => String(value ?? fallback)
const cloneRolledEncounters = (rolled: readonly RolledEncounter[]): RolledEncounter[] => rolled.map((encounter) => ({ ...encounter }))

export interface UseEncounterGenerationPageOptions {
  query: Record<string, unknown>
  replaceQuery?: (query: { region: string; table: string; map?: string }) => void | Promise<void>
  entries?: MaybeRefOrGetter<readonly EncounterTableEntry[]>
  maps?: MaybeRefOrGetter<readonly MapSummary[]>
  fetchGenerate?: (body: EncounterGenerateRequestBody) => Promise<EncounterGenerateResult>
  fetchSpawn?: (body: EncounterSpawnRequestBody) => Promise<EncounterGenerateResult>
  clientId?: () => string
  random?: () => number
  explorationAuthority?: MaybeRefOrGetter<EncounterGenerationExplorationAuthorityInput | null>
  commandsBlocked?: MaybeRefOrGetter<boolean>
}

export const useEncounterGenerationPage = ({
  query,
  replaceQuery,
  entries = encounterTables,
  maps = [],
  fetchGenerate = (body) => useApiClient().postJson<EncounterGenerateResult>(ENCOUNTER_API_PATHS.generate, body),
  fetchSpawn = (body) => useApiClient().postJson<EncounterGenerateResult>(ENCOUNTER_API_PATHS.spawn, body),
  clientId = getClientId,
  random = Math.random,
  explorationAuthority = null,
  commandsBlocked = false,
}: UseEncounterGenerationPageOptions) => {
  const allTables = computed(() => Array.from(toValue(entries)))
  const allMaps = computed(() => Array.from(toValue(maps)))
  const regions = computed(() => encounterRegionsForEntries(allTables.value))
  const initialEntry = allTables.value[0] ?? null
  const initialSelection = initialEncounterGenerationSelection(query, initialEntry)
  const region = ref<string>(initialSelection.region)
  const tableKey = ref<string>(initialSelection.tableKey)
  const countMin = ref<number>(DEFAULT_ENCOUNTER_COUNT_RANGE.min)
  const countMax = ref<number>(DEFAULT_ENCOUNTER_COUNT_RANGE.max)
  const outRoot = ref<string>(DEFAULT_ENCOUNTER_OUT_ROOT)
  const preview = ref<boolean>(false)
  const spawnMapSlug = ref<string>(queryString(query.map, ''))

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
  const selectedSpawnMap = computed(() => allMaps.value.find((map) => map.slug === spawnMapSlug.value) ?? null)
  const currentExplorationAuthority = computed(() => toValue(explorationAuthority))
  const blocked = computed(() => toValue(commandsBlocked))

  watch(allMaps, (next) => {
    if (next.length === 0) return
    if (!next.some((map) => map.slug === spawnMapSlug.value)) spawnMapSlug.value = next[0]?.slug ?? ''
  }, { immediate: true })

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
  const rolledPreviewCount = ref<number>(DEFAULT_ENCOUNTER_COUNT_RANGE.min)
  const rollPreview = () => {
    if (!selectedTable.value) return
    const encounterCount = randomEncounterGenerateCount({ min: countMin.value, max: countMax.value }, random)
    rolledPreviewCount.value = encounterCount
    rolledPreview.value = rollEncounters(selectedTable.value.table, encounterCount, random)
  }

  watch(
    [selectedTable, countMin, countMax],
    () => {
      if (selectedTable.value) rollPreview()
    },
    { immediate: true },
  )

  const generating = ref(false)
  const spawning = ref(false)
  const busy = computed(() => generating.value || spawning.value)
  const error = ref<string | null>(null)
  const result = ref<EncounterGenerateResult | null>(null)

  const applyGenerationResult = (nextResult: EncounterGenerateResult) => {
    result.value = nextResult
    rolledPreviewCount.value = nextResult.count ?? nextResult.rolled.length
    rolledPreview.value = cloneRolledEncounters(nextResult.rolled)
  }

  const generate = async () => {
    if (!selectedTable.value || busy.value || blocked.value) return
    generating.value = true
    error.value = null
    result.value = null
    try {
      applyGenerationResult(await fetchGenerate(buildEncounterGenerateRequestBody({
        region: region.value,
        tableKey: tableKey.value,
        countMin: rolledPreviewCount.value,
        countMax: rolledPreviewCount.value,
        outRoot: outRoot.value,
        preview: preview.value,
        rolled: rolledPreview.value,
        exploration: currentExplorationAuthority.value,
      })))
    } catch (err: unknown) {
      error.value = errorMessageForEncounterGenerate(err)
    } finally {
      generating.value = false
    }
  }

  const spawn = async () => {
    if (!selectedTable.value || !selectedSpawnMap.value || preview.value || busy.value || blocked.value) return
    spawning.value = true
    error.value = null
    result.value = null
    try {
      applyGenerationResult(await fetchSpawn(buildEncounterSpawnRequestBody({
        region: region.value,
        tableKey: tableKey.value,
        countMin: rolledPreviewCount.value,
        countMax: rolledPreviewCount.value,
        outRoot: outRoot.value,
        mapSlug: spawnMapSlug.value,
        clientId: clientId(),
        rolled: rolledPreview.value,
        exploration: currentExplorationAuthority.value,
      })))
    } catch (err: unknown) {
      error.value = errorMessageForEncounterGenerate(err)
    } finally {
      spawning.value = false
    }
  }

  const canSpawn = computed(() => Boolean(selectedTable.value && selectedSpawnMap.value && !preview.value && !blocked.value))

  const openFiles = ref<Set<string>>(new Set())
  const toggleFile = (name: string) => {
    openFiles.value = toggleOpenGenerateFile(openFiles.value, name)
  }
  const isOpen = (name: string) => openFiles.value.has(name)

  watch([region, tableKey, spawnMapSlug], () => {
    void replaceQuery?.({
      region: region.value,
      table: tableKey.value,
      ...(spawnMapSlug.value ? { map: spawnMapSlug.value } : {}),
    })
  })

  return {
    region,
    regions,
    tableKey,
    countMin,
    countMax,
    outRoot,
    preview,
    spawnMapSlug,
    spawnMaps: allMaps,
    tablesForRegion,
    selectedTable,
    selectedSpawnMap,
    currentExplorationAuthority,
    blocked,
    rolledPreview,
    rollPreview,
    generating,
    spawning,
    busy,
    canSpawn,
    error,
    result,
    generate,
    spawn,
    openFiles,
    toggleFile,
    isOpen,
  }
}
