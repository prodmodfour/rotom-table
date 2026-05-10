import { onMounted, reactive, ref } from 'vue'
import { mapsChannel, type RealtimeEvent } from '~/shared/realtime'
import type { MapSummary } from '~/types/map'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import { applyMapLibraryRealtimeEvent } from '~/utils/mapLibrary'
import { useRealtimeChannel } from '~/composables/useRealtime'

export interface MapLibraryDataFetchResult {
  maps: MapSummary[]
}

export interface MapLibraryFolderFetchResult {
  folders: string[]
}

export interface UseMapLibraryDataOptions {
  clientId: string
  autoRefreshOnMounted?: boolean
  fetchMapList?: () => Promise<MapLibraryDataFetchResult>
  fetchMapFolders?: () => Promise<MapLibraryFolderFetchResult>
  subscribeRealtime?: (handler: (event: RealtimeEvent) => void) => void
}

const defaultFetchMapList = (): Promise<MapLibraryDataFetchResult> =>
  $fetch<MapLibraryDataFetchResult>(MAP_API_PATHS.list)

const defaultFetchMapFolders = (): Promise<MapLibraryFolderFetchResult> =>
  $fetch<MapLibraryFolderFetchResult>(MAP_API_PATHS.folders)

export const useMapLibraryData = (options: UseMapLibraryDataOptions) => {
  const maps = reactive<Map<string, MapSummary>>(new Map())
  const extraFolders = reactive(new Set<string>())
  const loading = ref(true)
  const loadError = ref<string | null>(null)

  const fetchMapList = options.fetchMapList ?? defaultFetchMapList
  const fetchMapFolders = options.fetchMapFolders ?? defaultFetchMapFolders

  const refresh = async (): Promise<void> => {
    loading.value = true
    loadError.value = null
    try {
      const [list, folders] = await Promise.all([
        fetchMapList(),
        fetchMapFolders(),
      ])
      maps.clear()
      for (const summary of list.maps) maps.set(summary.slug, summary)
      extraFolders.clear()
      for (const folder of folders.folders) extraFolders.add(folder)
    } catch (err: unknown) {
      loadError.value = getErrorMessage(err)
    } finally {
      loading.value = false
    }
  }

  const handleRealtimeEvent = (event: RealtimeEvent): void => {
    applyMapLibraryRealtimeEvent({ maps, extraFolders }, event, options.clientId)
  }

  if (options.subscribeRealtime) {
    options.subscribeRealtime(handleRealtimeEvent)
  } else {
    useRealtimeChannel(mapsChannel, handleRealtimeEvent)
  }

  if (options.autoRefreshOnMounted !== false) {
    onMounted(() => {
      void refresh()
    })
  }

  return {
    maps,
    extraFolders,
    loading,
    loadError,
    refresh,
  }
}
