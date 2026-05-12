import { computed, watch, type ComputedRef, type Ref } from 'vue'
import type { TabletopMap, MapHazardV2, MapVoxelV2 } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import { reconcileMapForDimensions } from '~/utils/mapDimensionReconciliation'
import { clampMapGroundLevelY, mapSpecificYBounds, maxGroundLevelY } from '~/utils/mapGroundLevel'

interface BooleanRef {
  readonly value: boolean
}

export type MapDimensionAxis = 'x' | 'y' | 'z'

export interface UseMapDimensionControlsOptions {
  map: Ref<TabletopMap | null>
  canEditMap: BooleanRef
  isGm: BooleanRef
}

export interface UseMapDimensionControlsResult {
  mapVoxels: ComputedRef<MapVoxelV2[]>
  mapHazards: ComputedRef<MapHazardV2[]>
  groundLevelYMax: ComputedRef<number>
  mapGroundLevelY: ComputedRef<number>
  mapSpecificYRange: ComputedRef<{ groundLevelY: number; min: number; max: number }>
  mapSpecificYMin: ComputedRef<number>
  mapSpecificYMax: ComputedRef<number>
  setMapPlayerVisible: (value: boolean) => void
  setMapDimension: (axis: MapDimensionAxis, value: number | string) => void
  setGroundLevelY: (value: string | number) => void
}

export interface UseMapDimensionReconciliationOptions {
  map: Ref<TabletopMap | null>
  spawnedPokemon: ComputedRef<readonly SpawnedPokemon[]> | Ref<readonly SpawnedPokemon[]>
  selectedId: Ref<string | null>
  clearSelection: () => void
}

export const useMapDimensionControls = ({
  map,
  canEditMap,
  isGm,
}: UseMapDimensionControlsOptions): UseMapDimensionControlsResult => {
  const mapVoxels = computed<MapVoxelV2[]>(() => map.value?.voxels ?? [])
  const mapHazards = computed<MapHazardV2[]>(() => map.value?.hazards ?? [])

  const groundLevelYMax = computed(() => maxGroundLevelY(map.value?.dimensions.y ?? 1))
  const mapGroundLevelY = computed(() =>
    clampMapGroundLevelY({ y: map.value?.dimensions.y ?? 1 }, map.value?.groundLevelY ?? 0),
  )
  const mapSpecificYRange = computed(() =>
    mapSpecificYBounds({ y: map.value?.dimensions.y ?? 1 }, map.value?.groundLevelY ?? 0),
  )
  const mapSpecificYMin = computed(() => mapSpecificYRange.value.min)
  const mapSpecificYMax = computed(() => mapSpecificYRange.value.max)

  const setMapPlayerVisible = (value: boolean) => {
    if (!map.value || !isGm.value) return
    map.value.playerVisible = value
  }

  const setMapDimension = (axis: MapDimensionAxis, value: number | string) => {
    if (!map.value || !canEditMap.value) return
    map.value.dimensions[axis] = value as number
  }

  const setGroundLevelY = (value: string | number) => {
    if (!map.value || !canEditMap.value) return
    map.value.groundLevelY = clampMapGroundLevelY(map.value.dimensions, value)
  }

  return {
    mapVoxels,
    mapHazards,
    groundLevelYMax,
    mapGroundLevelY,
    mapSpecificYRange,
    mapSpecificYMin,
    mapSpecificYMax,
    setMapPlayerVisible,
    setMapDimension,
    setGroundLevelY,
  }
}

export const useMapDimensionReconciliation = ({
  map,
  spawnedPokemon,
  selectedId,
  clearSelection,
}: UseMapDimensionReconciliationOptions): void => {
  watch(
    () => map.value?.dimensions,
    (dims) => {
      if (!dims || !map.value) return
      const reconciled = reconcileMapForDimensions({
        map: map.value,
        spawnedPokemon: spawnedPokemon.value,
        selectedId: selectedId.value,
      })

      if (reconciled.dimensions.x !== dims.x) map.value.dimensions.x = reconciled.dimensions.x
      if (reconciled.dimensions.y !== dims.y) map.value.dimensions.y = reconciled.dimensions.y
      if (reconciled.dimensions.z !== dims.z) map.value.dimensions.z = reconciled.dimensions.z

      if (reconciled.groundLevelY !== undefined && reconciled.groundLevelY !== map.value.groundLevelY) {
        map.value.groundLevelY = reconciled.groundLevelY
      }

      if (reconciled.voxels.length !== map.value.voxels.length) {
        map.value.voxels = reconciled.voxels
      }

      if (reconciled.hazards.length !== (map.value.hazards ?? []).length) {
        map.value.hazards = reconciled.hazards
      }

      map.value.placements = reconciled.placements
      if (reconciled.selectedPlacementRemoved) clearSelection()
    },
    { deep: true },
  )
}
