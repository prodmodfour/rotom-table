import { ref, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { getErrorMessage } from '~/utils/errorMessages'
import type { TabletopMap } from '~/types/map'

export interface CreatedMapResult {
  map: TabletopMap
}

export interface MapLibraryCreationState {
  creating: Ref<boolean>
  createError: Ref<string | null>
}

export interface UseMapLibraryCreationOptions {
  canCreate: MaybeRefOrGetter<boolean>
  currentPath: MaybeRefOrGetter<string>
  createMap: (folder: string) => Promise<CreatedMapResult> | CreatedMapResult
  onCreated?: (map: TabletopMap) => void
  navigateToMap: (slug: string) => void
  state?: MapLibraryCreationState
}

/**
 * Map-library specific creation flow.
 *
 * The maps page shares its create busy/error state between "New map" and
 * "New folder" so the two buttons disable together and both failures render in
 * the same intro alert. The page injects that shared state plus the concrete
 * API/navigation behavior while this composable owns the creation guard,
 * request lifecycle, and error normalization.
 */
export const useMapLibraryCreation = (options: UseMapLibraryCreationOptions) => {
  const creating = options.state?.creating ?? ref(false)
  const createError = options.state?.createError ?? ref<string | null>(null)

  const createNewMap = async (): Promise<TabletopMap | null> => {
    if (!toValue(options.canCreate) || creating.value) return null

    creating.value = true
    createError.value = null

    try {
      const result = await options.createMap(toValue(options.currentPath))
      options.onCreated?.(result.map)
      options.navigateToMap(result.map.slug)
      return result.map
    } catch (err: unknown) {
      createError.value = getErrorMessage(err)
      return null
    } finally {
      creating.value = false
    }
  }

  return {
    creating,
    createError,
    createNewMap,
  }
}
