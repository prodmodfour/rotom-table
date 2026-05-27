import { computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  buildMapFolderSet,
  filterVisibleMaps,
  tabletopMapToSummary,
} from '~/utils/mapLibrary'
import { useLibraryContextMenu } from '~/composables/library/useLibraryContextMenu'
import { useLibraryContextSubmit } from '~/composables/library/useLibraryContextSubmit'
import { useLibraryDragDrop } from '~/composables/library/useLibraryDragDrop'
import { useLibraryDropMove } from '~/composables/library/useLibraryDropMove'
import { useLibraryFolderCreation } from '~/composables/library/useLibraryFolderCreation'
import { useLibraryFolderNavigation } from '~/composables/library/useLibraryFolderNavigation'
import { useLibraryGridView } from '~/composables/library/useLibraryGridView'
import {
  useMapLibraryActions,
  type MapLibraryContextTarget,
  type MapLibraryDragPayload,
} from '~/composables/library/useMapLibraryActions'
import { useMapLibraryCreation } from '~/composables/library/useMapLibraryCreation'
import { useMapLibraryData } from '~/composables/library/useMapLibraryData'
import { useApiClient } from '~/composables/useApiClient'
import { useAuth } from '~/composables/useAuth'
import { useWindowKeydown } from '~/composables/useWindowKeydown'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { isEscapeKey } from '~/utils/keyboardShortcuts'
import { mapEditorPath, mapLibraryPath } from '~/utils/mapRoutes'
import { formatFolderLabel } from '~/utils/sheetFolders'
import type { MapSummary, TabletopMap } from '~/types/map'

type DragPayload = MapLibraryDragPayload
type CtxTarget = MapLibraryContextTarget

export const useMapLibraryPage = () => {
  const router = useRouter()
  const clientId = getClientId()
  const { postJson } = useApiClient()

  const { isGm: rawIsGm, isPlayer: rawIsPlayer } = useAuth()
  const isGm = computed<boolean>(() => rawIsGm.value === true)
  const isPlayer = computed<boolean>(() => rawIsPlayer.value === true)

  const {
    maps,
    extraFolders,
    loading,
    loadError,
    refresh,
  } = useMapLibraryData({ clientId })

  const items = computed(() => {
    const all = Array.from(maps.values())
    return isPlayer.value ? all.filter((map) => map.playerVisible === true) : all
  })

  const allFolders = computed(() => buildMapFolderSet(items.value, extraFolders, {
    includeExtraFolders: isGm.value,
  }))

  const { currentPath, goToFolder, breadcrumbs } = useLibraryFolderNavigation({
    routePath: mapLibraryPath(),
    formatSegment: formatFolderLabel,
  })

  const { creating, createError, createNewFolder } = useLibraryFolderCreation({
    canCreate: isGm,
    currentPath,
    folderPaths: allFolders,
    createFolder: (folder) => postJson(MAP_API_PATHS.createFolder, { folder, clientId }),
    onCreated: (folder) => extraFolders.add(folder),
  })

  const {
    searchTerm,
    visibleItems: visibleMaps,
    visibleFolders,
    hasAnything,
    totalCount: mapCount,
  } = useLibraryGridView<MapSummary>({
    items,
    folderPaths: allFolders,
    currentPath,
    filterVisibleItems: filterVisibleMaps,
    formatFolderLabel,
  })

  const mapActions = useMapLibraryActions({
    currentPath,
    allFolders,
    maps,
    extraFolders,
    goToFolder,
    refresh,
    formatFolderLabel,
    moveMap: ({ slug, folder }) => postJson(MAP_API_PATHS.move, { slug, folder, clientId }),
    moveFolder: ({ from, to }) => postJson(MAP_API_PATHS.moveFolder, { from, to, clientId }),
    renameMap: ({ slug, name }) => postJson<{ slug: string; name: string }>(MAP_API_PATHS.rename, { slug, name, clientId }),
    deleteMap: ({ slug }) => postJson(MAP_API_PATHS.deleteMap, { slug, clientId }),
    deleteFolder: ({ folder }) => postJson(MAP_API_PATHS.deleteFolder, { folder, clientId }),
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
  } = useLibraryDragDrop<DragPayload>({
    canDrag: isGm,
    canDropPayloadOn: mapActions.canDropPayloadOn,
  })

  const onMapDragStart = (event: DragEvent, item: MapSummary) => {
    startDrag(event, { type: 'map', slug: item.slug, from: item.folder }, {
      mimeType: 'application/x-rotom-map',
      value: item.slug,
    })
  }

  const onFolderDragStart = (event: DragEvent, path: string) => {
    if (!path) {
      event.preventDefault()
      return
    }
    startDrag(event, { type: 'folder', path }, {
      mimeType: 'application/x-rotom-map-folder',
      value: path,
    })
  }

  const { moving, moveError, onDrop } = useLibraryDropMove<DragPayload>({
    takeDropPayload,
    movePayload: mapActions.movePayload,
  })

  const { createNewMap } = useMapLibraryCreation({
    canCreate: isGm,
    currentPath,
    state: { creating, createError },
    createMap: (folder) => postJson<{ map: TabletopMap }>(MAP_API_PATHS.create, { folder, clientId }),
    onCreated: (map) => maps.set(map.slug, tabletopMapToSummary(map)),
    navigateToMap: (slug) => {
      void router.push(mapEditorPath(slug))
    },
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
  } = useLibraryContextMenu<CtxTarget>({
    canOpen: isGm,
    targetLabel: mapActions.targetLabel,
    renameInputForTarget: mapActions.renameInputForTarget,
    moveDestinationsForTarget: mapActions.moveDestinationsForTarget,
  })

  const { submitContext } = useLibraryContextSubmit<CtxTarget>({
    ctx,
    closeContext,
    onMove: mapActions.moveTarget,
    onRename: mapActions.renameTarget,
    onDelete: mapActions.deleteTarget,
  })

  useWindowKeydown((event) => {
    if (isEscapeKey(event)) closeContext()
  })

  return {
    isGm,
    searchTerm,
    visibleMaps,
    visibleFolders,
    hasAnything,
    mapCount,
    currentPath,
    breadcrumbs,
    goToFolder,
    drag,
    hoverTarget,
    canDropOn,
    onDragEnd,
    onDropEnter,
    onDropOver,
    onDropLeave,
    onDrop,
    moving,
    loading,
    loadError,
    moveError,
    onMapDragStart,
    onFolderDragStart,
    creating,
    createError,
    createNewFolder,
    createNewMap,
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
