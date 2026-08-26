import { computed, onMounted, ref, watch } from 'vue'
import { GM_CAMPAIGN_TOOLKIT_CHANNEL, isGmCampaignToolkitInvalidationV1 } from '#shared/gmToolkit/realtime'
import { useApiClient } from '~/composables/useApiClient'
import { useRealtimeChannel, type RealtimeEvent } from '~/composables/useRealtime'
import { getErrorMessage } from '~/utils/errorMessages'
import { ENCOUNTER_API_PATHS } from '~/utils/apiRoutes'
import {
  gmEncounterTableDocumentToDraft,
  type EncounterTableDocumentV1,
  type EncounterTableExportV1,
  type EncounterTableLibraryProjectionV1,
  type GmEncounterTableDetailResponseV1,
  type GmEncounterTableDraftV1,
  type GmEncounterTableListResponseV1,
  type GmEncounterTableMutationResponseV1,
} from '~/types/gmCampaignToolkit'

export type EncounterTableStatusFilter = 'active' | 'archived' | 'all'

const defaultDraft = (): GmEncounterTableDraftV1 => ({
  name: 'Untitled encounter table',
  environmentTags: ['Urban'],
  predicates: { timeOfDay: [], weather: [] },
  rows: [
    { kind: 'species', speciesId: 'Pidgey', weight: 1, minLevel: 1, maxLevel: 5, predicates: { timeOfDay: [], weather: [] } },
    { kind: 'nothing', weight: 60, predicates: { timeOfDay: [], weather: [] } },
  ],
  groupSizePolicy: { kind: 'fixed', minimum: 1, maximum: 1, perAdditionalTrainer: 0 },
  notes: '',
})

let operationSequence = 0
const operationId = (): string => {
  const uuid = globalThis.crypto?.randomUUID?.()
  operationSequence += 1
  return `gm-table-${uuid ?? `${Date.now()}-${operationSequence}`}`
}

const isConflict = (message: string): boolean => /changed before|already used|conflict|revision/i.test(message)

export const useGmCampaignToolkitTables = () => {
  const { getJson, postJson } = useApiClient()
  const tables = ref<EncounterTableLibraryProjectionV1[]>([])
  const selectedTableId = ref<string | null>(null)
  const selectedTable = ref<EncounterTableDocumentV1 | null>(null)
  const sourceReview = ref<GmEncounterTableDetailResponseV1['sourceReview'] | null>(null)
  const draft = ref<GmEncounterTableDraftV1 | null>(null)
  const loading = ref(false)
  const detailLoading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const conflict = ref<string | null>(null)
  const announcement = ref('')
  const searchTerm = ref('')
  const statusFilter = ref<EncounterTableStatusFilter>('active')
  const environmentFilter = ref('all')
  const minimumLevel = ref<number | null>(null)
  const maximumLevel = ref<number | null>(null)
  const editorMode = ref<'view' | 'edit' | 'create'>('view')
  const pendingOperation = ref<{ key: string; operationId: string } | null>(null)

  const requestOperationId = (key: string): string => {
    if (pendingOperation.value?.key === key) return pendingOperation.value.operationId
    const next = operationId()
    pendingOperation.value = { key, operationId: next }
    return next
  }

  const environments = computed(() => [...new Set(tables.value.flatMap(table => table.environmentTags))]
    .sort((left, right) => left.localeCompare(right)))

  const visibleTables = computed(() => {
    const query = searchTerm.value.trim().toLocaleLowerCase()
    return tables.value.filter((table) => {
      if (statusFilter.value !== 'all' && table.status !== statusFilter.value) return false
      if (environmentFilter.value !== 'all' && !table.environmentTags.includes(environmentFilter.value)) return false
      if (minimumLevel.value !== null && table.levelRange.maximum < minimumLevel.value) return false
      if (maximumLevel.value !== null && table.levelRange.minimum > maximumLevel.value) return false
      return !query || `${table.name} ${table.environmentTags.join(' ')}`.toLocaleLowerCase().includes(query)
    })
  })

  const selectedProjection = computed(() => tables.value.find(table => table.tableId === selectedTableId.value) ?? null)
  const dirty = computed(() => selectedTable.value !== null && draft.value !== null
    && JSON.stringify(gmEncounterTableDocumentToDraft(selectedTable.value)) !== JSON.stringify(draft.value))

  const loadDetail = async (id: string): Promise<void> => {
    detailLoading.value = true
    error.value = null
    try {
      const response = await getJson<GmEncounterTableDetailResponseV1>(ENCOUNTER_API_PATHS.table(id))
      selectedTable.value = response.table
      sourceReview.value = response.sourceReview
      draft.value = gmEncounterTableDocumentToDraft(response.table)
      selectedTableId.value = id
      editorMode.value = 'view'
      conflict.value = null
    } catch (caught) {
      error.value = getErrorMessage(caught)
    } finally { detailLoading.value = false }
  }

  const refresh = async (preserveSelection = true): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const response = await getJson<GmEncounterTableListResponseV1>(ENCOUNTER_API_PATHS.list, {
        params: { includeArchived: statusFilter.value !== 'active' },
      })
      tables.value = [...response.tables]
      const selectedExists = response.tables.some(table => table.tableId === selectedTableId.value)
      const next = preserveSelection && selectedExists ? selectedTableId.value : visibleTables.value[0]?.tableId ?? response.tables[0]?.tableId ?? null
      const nextProjection = response.tables.find(table => table.tableId === next)
      if (next && (!preserveSelection || next !== selectedTable.value?.tableId || nextProjection?.revision !== selectedTable.value?.revision)) await loadDetail(next)
      if (!next) {
        selectedTableId.value = null
        selectedTable.value = null
        sourceReview.value = null
        draft.value = null
      }
    } catch (caught) {
      error.value = getErrorMessage(caught)
    } finally { loading.value = false }
  }

  const selectTable = async (table: EncounterTableLibraryProjectionV1): Promise<void> => {
    if (dirty.value && !globalThis.confirm?.('Discard unsaved table changes?')) return
    await loadDetail(table.tableId)
  }

  const beginCreate = (): void => {
    selectedTableId.value = null
    selectedTable.value = null
    sourceReview.value = null
    draft.value = defaultDraft()
    editorMode.value = 'create'
    error.value = null
    conflict.value = null
  }

  const beginEdit = (): void => {
    if (!selectedTable.value) return
    draft.value = gmEncounterTableDocumentToDraft(selectedTable.value)
    editorMode.value = 'edit'
  }

  const cancelEdit = (): void => {
    if (selectedTable.value) draft.value = gmEncounterTableDocumentToDraft(selectedTable.value)
    else draft.value = null
    editorMode.value = 'view'
    conflict.value = null
    pendingOperation.value = null
  }

  const settleMutation = async (
    path: string,
    body: Record<string, unknown>,
    key: string,
    acceptedMessage: string,
  ): Promise<GmEncounterTableMutationResponseV1 | null> => {
    saving.value = true
    error.value = null
    conflict.value = null
    const op = requestOperationId(`${key}:${JSON.stringify(body)}`)
    try {
      const result = await postJson<GmEncounterTableMutationResponseV1>(path, { ...body, operationId: op })
      pendingOperation.value = null
      selectedTable.value = result.table
      selectedTableId.value = result.table.tableId
      draft.value = gmEncounterTableDocumentToDraft(result.table)
      editorMode.value = 'view'
      announcement.value = result.exactRetry ? `${acceptedMessage} Previous result recovered.` : acceptedMessage
      await refresh(true)
      return result
    } catch (caught) {
      const message = getErrorMessage(caught)
      if (isConflict(message)) conflict.value = message
      else error.value = message
      return null
    } finally { saving.value = false }
  }

  const saveDraft = async (): Promise<boolean> => {
    if (!draft.value) return false
    const result = editorMode.value === 'create'
      ? await settleMutation(ENCOUNTER_API_PATHS.create, { draft: draft.value }, 'create', 'Encounter table created.')
      : selectedTable.value
        ? await settleMutation(ENCOUNTER_API_PATHS.save, {
            tableId: selectedTable.value.tableId,
            expectedRevision: selectedTable.value.revision,
            draft: draft.value,
          }, `save:${selectedTable.value.tableId}:${selectedTable.value.revision}`, 'Encounter table saved.')
        : null
    return result !== null
  }

  const archiveOrRestore = async (): Promise<void> => {
    const table = selectedTable.value
    if (!table) return
    const archiving = table.status === 'active'
    if (archiving && !globalThis.confirm?.(`Archive “${table.name}”? Existing preparation links will keep their pinned revision.`)) return
    await settleMutation(archiving ? ENCOUNTER_API_PATHS.archive : ENCOUNTER_API_PATHS.restore, {
      tableId: table.tableId,
      expectedRevision: table.revision,
    }, `${archiving ? 'archive' : 'restore'}:${table.tableId}:${table.revision}`, archiving ? 'Encounter table archived.' : 'Encounter table restored.')
  }

  const copySelected = async (): Promise<void> => {
    const table = selectedTable.value
    if (!table) return
    await settleMutation(ENCOUNTER_API_PATHS.copy, {
      tableId: table.tableId,
      expectedRevision: table.revision,
      name: `${table.name} copy`,
    }, `copy:${table.tableId}:${table.revision}`, 'Encounter table copied.')
  }

  const exportSelected = async (): Promise<void> => {
    const table = selectedTable.value
    if (!table) return
    error.value = null
    try {
      const payload = await getJson<EncounterTableExportV1>(ENCOUNTER_API_PATHS.export(table.tableId))
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${table.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLocaleLowerCase() || 'encounter-table'}.v1.json`
      anchor.click()
      URL.revokeObjectURL(url)
      announcement.value = 'Encounter table export downloaded.'
    } catch (caught) { error.value = getErrorMessage(caught) }
  }

  const importFile = async (file: File): Promise<void> => {
    error.value = null
    try {
      const parsed = JSON.parse(await file.text()) as unknown
      await settleMutation(ENCOUNTER_API_PATHS.import, { export: parsed }, `import:${file.name}:${file.size}:${file.lastModified}`, 'Encounter table imported.')
    } catch (caught) { error.value = getErrorMessage(caught) }
  }

  const reloadAfterConflict = async (): Promise<void> => {
    pendingOperation.value = null
    if (selectedTableId.value) await loadDetail(selectedTableId.value)
  }

  useRealtimeChannel(GM_CAMPAIGN_TOOLKIT_CHANNEL, (event: RealtimeEvent) => {
    if (event.type !== 'encounter-table-invalidated' || !isGmCampaignToolkitInvalidationV1(event.data)) return
    if (event.data.documentId === selectedTableId.value && dirty.value) {
      conflict.value = 'This table changed in another GM tab. Keep this draft for comparison or reload the accepted revision.'
      return
    }
    void refresh(true)
  })

  watch(statusFilter, () => { void refresh(true) })
  onMounted(() => { void refresh(false) })

  return {
    tables,
    visibleTables,
    selectedTable,
    sourceReview,
    selectedProjection,
    draft,
    loading,
    detailLoading,
    saving,
    error,
    conflict,
    announcement,
    searchTerm,
    statusFilter,
    environmentFilter,
    minimumLevel,
    maximumLevel,
    environments,
    editorMode,
    dirty,
    refresh,
    selectTable,
    beginCreate,
    beginEdit,
    cancelEdit,
    saveDraft,
    archiveOrRestore,
    copySelected,
    exportSelected,
    importFile,
    reloadAfterConflict,
  }
}
