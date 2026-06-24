import { ref, type Ref } from 'vue'
import type { MapTokenSheetSelection } from '~/composables/map-editor/useTokenControls'
import type { SheetPlacement } from '~/types/map'

interface ReadonlyValueRef<TValue> {
  readonly value: TValue
}

export interface MapPageSpawnDispatchResult {
  readonly dispatched: boolean
}

export interface UseMapPageTokenSpawningOptions {
  readonly isSetupEditMode: () => boolean
  readonly authoritativeSnapshotReady: ReadonlyValueRef<boolean>
  readonly createSpawnPlacement: (selection: MapTokenSheetSelection) => SheetPlacement | null
  readonly spawnSheetForSetupEdit: (selection: MapTokenSheetSelection) => boolean
  readonly spawnToken: (payload: { placement: SheetPlacement }) => Promise<MapPageSpawnDispatchResult>
}

export interface UseMapPageTokenSpawningReturn {
  readonly spawnSheetPending: Ref<boolean>
  readonly spawnSheetFromMenu: (selection: MapTokenSheetSelection) => Promise<boolean>
}

export const useMapPageTokenSpawning = ({
  isSetupEditMode,
  authoritativeSnapshotReady,
  createSpawnPlacement,
  spawnSheetForSetupEdit,
  spawnToken,
}: UseMapPageTokenSpawningOptions): UseMapPageTokenSpawningReturn => {
  const spawnSheetPending = ref(false)

  const spawnSheetFromMenu = async (selection: MapTokenSheetSelection): Promise<boolean> => {
    if (spawnSheetPending.value) return false
    if (isSetupEditMode()) return spawnSheetForSetupEdit(selection)
    if (!authoritativeSnapshotReady.value) return false

    const placement = createSpawnPlacement(selection)
    if (!placement) return false

    spawnSheetPending.value = true
    try {
      const result = await spawnToken({ placement })
      return result.dispatched === true
    } catch {
      return false
    } finally {
      spawnSheetPending.value = false
    }
  }

  return {
    spawnSheetPending,
    spawnSheetFromMenu,
  }
}
