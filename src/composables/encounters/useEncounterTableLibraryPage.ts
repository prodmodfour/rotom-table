import { computed, ref } from 'vue'
import { useLibraryContextMenu } from '~/composables/library/useLibraryContextMenu'
import { useLibraryContextSubmit } from '~/composables/library/useLibraryContextSubmit'
import { useLibraryDragDrop } from '~/composables/library/useLibraryDragDrop'
import { useLibraryDropMove } from '~/composables/library/useLibraryDropMove'
import { useLibraryFolderCreation } from '~/composables/library/useLibraryFolderCreation'
import { useLibraryFolderNavigation } from '~/composables/library/useLibraryFolderNavigation'
import { useLibraryGridView } from '~/composables/library/useLibraryGridView'
import { useApiClient } from '~/composables/useApiClient'
import { useAuth } from '~/composables/useAuth'
import { useWindowKeydown } from '~/composables/useWindowKeydown'
import type { EncounterTable, EncounterTableEntry } from '~/types/encounterTable'
import {
  useEncounterTableLibraryActions,
  type EncounterTableContextTarget,
  type EncounterTableDragPayload,
} from '~/composables/encounters/useEncounterTableLibraryActions'
import { useEncounterTableLibraryCreation } from '~/composables/encounters/useEncounterTableLibraryCreation'
import { useEncounterTableLibraryData } from '~/composables/encounters/useEncounterTableLibraryData'
import { ENCOUNTER_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import { buildEncounterTableFolderSet, countFilteredEncounterTables, encounterTableFolder, encounterTableLibraryKey, filterVisibleEncounterTables } from '~/utils/encounterTableLibrary'
import { describeEntries, formatRegionLabel } from '~/utils/encounterTables'
import { ENCOUNTER_TABLES_PATH } from '~/utils/encounterRoutes'
import { isEscapeKey } from '~/utils/keyboardShortcuts'

export const useEncounterTableLibraryPage = () => {
  const { postJson } = useApiClient()
  const { isGm: rawIsGm } = useAuth()
  const canManage = computed<boolean>(() => rawIsGm.value === true)

  const {
    tables,
    items,
    extraFolders,
    loading,
    loadError,
  } = useEncounterTableLibraryData()

  const allFolders = computed(() => buildEncounterTableFolderSet(items.value, extraFolders))

  const { currentPath, goToFolder, breadcrumbs } = useLibraryFolderNavigation({
    routePath: ENCOUNTER_TABLES_PATH,
    formatSegment: formatRegionLabel,
  })

  const {
    searchTerm,
    visibleItems: visibleTables,
    visibleFolders,
    hasAnything,
    totalCount,
    filteredCount,
  } = useLibraryGridView<EncounterTableEntry>({
    items,
    folderPaths: allFolders,
    currentPath,
    folderOf: encounterTableFolder,
    formatFolderLabel: formatRegionLabel,
    filterVisibleItems: filterVisibleEncounterTables,
    countFilteredItems: countFilteredEncounterTables,
  })

  const selectedId = ref<string | null>(null)

  const selectedEntry = computed(() => {
    if (selectedId.value) {
      const selected = tables.get(selectedId.value)
      if (selected) return selected
    }
    return visibleTables.value[0] ?? items.value[0] ?? null
  })

  const selectedRows = computed(() => selectedEntry.value ? describeEntries(selectedEntry.value.table) : [])
  const activeSelectedId = computed(() => selectedEntry.value ? encounterTableLibraryKey(selectedEntry.value) : null)
  const savingTable = ref(false)
  const saveError = ref<string | null>(null)

  const selectEntry = (entry: EncounterTableEntry) => {
    selectedId.value = encounterTableLibraryKey(entry)
  }

  const { creating, createError, createNewFolder } = useLibraryFolderCreation({
    canCreate: canManage,
    currentPath,
    folderPaths: allFolders,
    createFolder: (folder) => postJson(ENCOUNTER_API_PATHS.createFolder, { folder }),
    onCreated: (folder) => extraFolders.add(folder),
  })

  const { createNewTable } = useEncounterTableLibraryCreation({
    canCreate: canManage,
    currentPath,
    state: { creating, createError },
    createTable: (folder) => postJson<{ ok: true; entry: EncounterTableEntry }>(ENCOUNTER_API_PATHS.create, { folder }),
    onCreated: (entry) => {
      tables.set(encounterTableLibraryKey(entry), entry)
      selectEntry(entry)
    },
  })

  const saveSelectedTable = async (entry: EncounterTableEntry, table: EncounterTable): Promise<boolean> => {
    if (!canManage.value || savingTable.value) return false

    savingTable.value = true
    saveError.value = null
    try {
      const result = await postJson<{ ok: true; entry: EncounterTableEntry }>(ENCOUNTER_API_PATHS.save, {
        region: entry.region,
        key: entry.key,
        table,
      })
      const oldId = encounterTableLibraryKey(entry)
      tables.delete(oldId)
      tables.set(encounterTableLibraryKey(result.entry), result.entry)
      selectedId.value = encounterTableLibraryKey(result.entry)
      return true
    } catch (err: unknown) {
      saveError.value = getErrorMessage(err)
      return false
    } finally {
      savingTable.value = false
    }
  }

  const tableActions = useEncounterTableLibraryActions({
    currentPath,
    allFolders,
    tables,
    extraFolders,
    goToFolder,
    moveTable: ({ region, key, folder }) => postJson<{ entry: EncounterTableEntry }>(ENCOUNTER_API_PATHS.move, { region, key, folder }),
    moveFolder: ({ from, to }) => postJson(ENCOUNTER_API_PATHS.moveFolder, { from, to }),
    renameTable: ({ region, key, name }) => postJson<{ entry: EncounterTableEntry }>(ENCOUNTER_API_PATHS.rename, { region, key, name }),
    deleteTable: ({ region, key }) => postJson(ENCOUNTER_API_PATHS.deleteTable, { region, key }),
    deleteFolder: ({ folder }) => postJson(ENCOUNTER_API_PATHS.deleteFolder, { folder }),
  })

  const {
    drag,
    hoverTarget,
    startDrag,
    canDropOn,
    onDragEnd,
    onDropEnter,
    onDropOver,
    onDropLeave,
    takeDropPayload,
  } = useLibraryDragDrop<EncounterTableDragPayload>({
    canDrag: canManage,
    canDropPayloadOn: tableActions.canDropPayloadOn,
  })

  const isDraggingTable = (entry: EncounterTableEntry): boolean =>
    drag.value?.type === 'table' && drag.value.id === encounterTableLibraryKey(entry)

  const isDraggingFolder = (path: string): boolean =>
    drag.value?.type === 'folder' && drag.value.path === path

  const onTableDragStart = (event: DragEvent, item: EncounterTableEntry) => {
    startDrag(event, {
      type: 'table',
      id: encounterTableLibraryKey(item),
      region: item.region,
      key: item.key,
    }, {
      mimeType: 'application/x-rotom-encounter-table',
      value: encounterTableLibraryKey(item),
    })
  }

  const onFolderDragStart = (event: DragEvent, path: string) => {
    if (!path) {
      event.preventDefault()
      return
    }
    startDrag(event, { type: 'folder', path }, {
      mimeType: 'application/x-rotom-encounter-table-folder',
      value: path,
    })
  }

  const { moveError, onDrop } = useLibraryDropMove<EncounterTableDragPayload>({
    takeDropPayload,
    movePayload: tableActions.movePayload,
  })

  const {
    ctx,
    openContext,
    closeContext,
    ctxTargetLabel,
    ctxMoveDestinations,
    enterMove,
    enterRename,
    enterDelete,
  } = useLibraryContextMenu<EncounterTableContextTarget>({
    canOpen: canManage,
    targetLabel: tableActions.targetLabel,
    renameInputForTarget: tableActions.renameInputForTarget,
    moveDestinationsForTarget: tableActions.moveDestinationsForTarget,
  })

  const { submitContext } = useLibraryContextSubmit<EncounterTableContextTarget>({
    ctx,
    closeContext,
    onMove: tableActions.moveTarget,
    onRename: tableActions.renameTarget,
    onDelete: tableActions.deleteTarget,
  })

  useWindowKeydown((event) => {
    if (isEscapeKey(event)) closeContext()
  })

  return {
    canManage,
    searchTerm,
    visibleTables,
    visibleFolders,
    hasAnything,
    totalCount,
    filteredCount,
    currentPath,
    breadcrumbs,
    goToFolder,
    selectedId: activeSelectedId,
    selectedEntry,
    selectedRows,
    selectEntry,
    savingTable,
    saveError,
    saveSelectedTable,
    drag,
    hoverTarget,
    canDropOn,
    onDragEnd,
    onDropEnter,
    onDropOver,
    onDropLeave,
    onDrop,
    loading,
    loadError,
    moveError,
    isDraggingTable,
    isDraggingFolder,
    onTableDragStart,
    onFolderDragStart,
    creating,
    createError,
    createNewFolder,
    createNewTable,
    ctx,
    openContext,
    closeContext,
    ctxTargetLabel,
    ctxMoveDestinations,
    enterMove,
    enterRename,
    enterDelete,
    submitContext,
  }
}
