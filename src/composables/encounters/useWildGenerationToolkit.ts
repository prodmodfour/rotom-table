import { computed, onMounted, ref, watch, type ComputedRef } from 'vue'
import type {
  WildGenerationCommitProjectionV1,
  WildGenerationExplorationRefV1,
  WildGenerationPreviewProjectionV1,
} from '#shared/gmToolkit/generation'
import type { EncounterTimeOfDay, EncounterWeather } from '#shared/gmToolkit/encounterTables'
import { useApiClient } from '~/composables/useApiClient'
import { getErrorMessage } from '~/utils/errorMessages'
import { ENCOUNTER_API_PATHS } from '~/utils/apiRoutes'
import type { GmEncounterTableListResponseV1, EncounterTableLibraryProjectionV1 } from '~/types/gmCampaignToolkit'

let sequence = 0
const operationId = (): string => {
  sequence += 1
  return `wild-generation-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${sequence}`}`
}

export interface WildGenerationToolkitOptions {
  readonly exploration?: ComputedRef<WildGenerationExplorationRefV1 | null>
  readonly commandsBlocked?: ComputedRef<boolean>
}

export const useWildGenerationToolkit = (options: WildGenerationToolkitOptions = {}) => {
  const { getJson, postJson } = useApiClient()
  const tables = ref<EncounterTableLibraryProjectionV1[]>([])
  const tableId = ref('')
  const requestedSlots = ref(3)
  const timeOfDay = ref<EncounterTimeOfDay | null>(null)
  const weather = ref<EncounterWeather | null>(null)
  const shinyChancePercent = ref(0)
  const heldItemName = ref('')
  const loadingTables = ref(false)
  const previewing = ref(false)
  const committing = ref(false)
  const error = ref<string | null>(null)
  const announcement = ref('')
  const preview = ref<WildGenerationPreviewProjectionV1 | null>(null)
  const committed = ref<WildGenerationCommitProjectionV1 | null>(null)
  const selectedCandidateIds = ref<string[]>([])
  const currentOperationId = ref(operationId())

  const selectedTable = computed(() => tables.value.find(table => table.tableId === tableId.value) ?? null)
  const canPreview = computed(() => Boolean(selectedTable.value)
    && options.commandsBlocked?.value !== true
    && Number.isInteger(requestedSlots.value) && requestedSlots.value >= 1 && requestedSlots.value <= 30
    && shinyChancePercent.value >= 0 && shinyChancePercent.value <= 100)
  const canCommit = computed(() => preview.value !== null
    && selectedCandidateIds.value.length >= 1 && selectedCandidateIds.value.length <= 10
    && !committing.value)

  const loadTables = async (): Promise<void> => {
    loadingTables.value = true
    error.value = null
    try {
      const response = await getJson<GmEncounterTableListResponseV1>(ENCOUNTER_API_PATHS.list)
      tables.value = [...response.tables.filter(table => table.status === 'active')]
      if (!tables.value.some(table => table.tableId === tableId.value)) tableId.value = tables.value[0]?.tableId ?? ''
    } catch (caught) { error.value = getErrorMessage(caught) }
    finally { loadingTables.value = false }
  }

  const clearPreview = (): void => {
    preview.value = null
    committed.value = null
    selectedCandidateIds.value = []
    currentOperationId.value = operationId()
  }

  const requestPreview = async (): Promise<void> => {
    const table = selectedTable.value
    if (!table || !canPreview.value) return
    previewing.value = true
    error.value = null
    committed.value = null
    try {
      const result = await postJson<WildGenerationPreviewProjectionV1>(ENCOUNTER_API_PATHS.generate, {
        schemaVersion: 1,
        mode: 'preview',
        operationId: currentOperationId.value,
        tableId: table.tableId,
        expectedTableRevision: table.revision,
        requestedSlots: requestedSlots.value,
        party: { trainerRefs: [] },
        environment: { timeOfDay: timeOfDay.value, weather: weather.value },
        policy: { shinyChancePercent: shinyChancePercent.value, heldItemName: heldItemName.value.trim() || null },
        exploration: options.exploration?.value ?? null,
      })
      preview.value = result
      selectedCandidateIds.value = result.candidates.slice(0, 10).map(candidate => candidate.candidateId)
      announcement.value = `Preview ready with ${result.candidates.length} Pokémon. Nothing has been saved.`
    } catch (caught) { error.value = getErrorMessage(caught) }
    finally { previewing.value = false }
  }

  const toggleCandidate = (candidateId: string, selected: boolean): void => {
    const next = selected
      ? [...new Set([...selectedCandidateIds.value, candidateId])]
      : selectedCandidateIds.value.filter(id => id !== candidateId)
    if (next.length <= 10) selectedCandidateIds.value = next
  }

  const commitPackage = async (): Promise<void> => {
    if (!preview.value || !canCommit.value) return
    committing.value = true
    error.value = null
    try {
      const result = await postJson<WildGenerationCommitProjectionV1>(ENCOUNTER_API_PATHS.generate, {
        schemaVersion: 1,
        mode: 'commit',
        operationId: currentOperationId.value,
        previewToken: preview.value.previewToken,
        selectedCandidateIds: selectedCandidateIds.value,
        folder: 'generated/wild',
      })
      committed.value = result
      announcement.value = result.exactRetry
        ? 'The previously committed package was recovered. No duplicate sheets were created.'
        : `${result.sheets.length} Pokémon committed as ordinary campaign sheets.`
    } catch (caught) { error.value = getErrorMessage(caught) }
    finally { committing.value = false }
  }

  const startAnother = (): void => {
    clearPreview()
    error.value = null
  }

  watch([tableId, requestedSlots, timeOfDay, weather, shinyChancePercent, heldItemName, ...(options.exploration ? [options.exploration] : [])], () => {
    if (preview.value && !committing.value && !committed.value) clearPreview()
  })
  onMounted(() => { void loadTables() })

  return {
    tables,
    tableId,
    selectedTable,
    requestedSlots,
    timeOfDay,
    weather,
    shinyChancePercent,
    heldItemName,
    loadingTables,
    previewing,
    committing,
    error,
    announcement,
    preview,
    committed,
    selectedCandidateIds,
    canPreview,
    canCommit,
    loadTables,
    requestPreview,
    toggleCandidate,
    commitPackage,
    startAnother,
  }
}
