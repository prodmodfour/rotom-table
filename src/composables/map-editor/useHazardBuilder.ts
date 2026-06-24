import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { BuildTool } from '#shared/mapEditor'
import {
  MAIN_MAP_HAZARD_KINDS,
  MAP_HAZARD_DEFINITIONS,
} from '~/utils/mapHazardDefinitions'
import { applyMapHazardPlacement } from '~/utils/mapHazards'
import type { MapHazardKind, MapHazardV2, TabletopMap } from '~/types/map'

interface BooleanRef {
  readonly value: boolean
}

export interface UseHazardBuilderOptions {
  map: Ref<TabletopMap | null>
  mapHazards: ComputedRef<MapHazardV2[]>
  canEditMap: BooleanRef
  confirmClearAll?: (count: number) => boolean
}

export const useHazardBuilder = ({
  map,
  mapHazards,
  canEditMap,
  confirmClearAll,
}: UseHazardBuilderOptions) => {
  const hazardMode = ref(false)
  const hazardTool = ref<BuildTool>('pencil')
  const hazardKind = ref<MapHazardKind>('spikes')

  const activeHazardDef = computed(() => MAP_HAZARD_DEFINITIONS[hazardKind.value])
  const hazardPalette = MAIN_MAP_HAZARD_KINDS.map((kind) => MAP_HAZARD_DEFINITIONS[kind])

  const placeHazard = (hazard: MapHazardV2) => {
    if (!map.value || !canEditMap.value) return
    const result = applyMapHazardPlacement({
      hazards: mapHazards.value,
      hazard,
      dimensions: map.value.dimensions,
    })
    if (!result.ok) return
    map.value.hazards = [...result.hazards]
  }

  const removeHazard = (cell: { x: number; y: number; z: number; kind?: MapHazardKind }) => {
    if (!map.value || !canEditMap.value) return
    map.value.hazards = mapHazards.value.filter((hazard) => {
      const sameCell = hazard.x === cell.x && hazard.y === cell.y && hazard.z === cell.z
      if (!sameCell) return true
      return cell.kind ? hazard.kind !== cell.kind : false
    })
  }

  const clearAllHazards = () => {
    if (!map.value || !canEditMap.value || !mapHazards.value.length) return
    const count = mapHazards.value.length
    const ok = confirmClearAll
      ? confirmClearAll(count)
      : typeof window === 'undefined' || window.confirm(
        `Remove all ${count} hazard square${count === 1 ? '' : 's'}?`,
      )
    if (!ok) return
    map.value.hazards = []
  }

  const setHazardTool = (tool: BuildTool) => {
    if (!canEditMap.value) return
    hazardTool.value = tool
  }

  const selectHazardKind = (kind: MapHazardKind) => {
    if (!canEditMap.value) return
    hazardKind.value = kind
  }

  return {
    hazardMode,
    hazardTool,
    hazardKind,
    activeHazardDef,
    hazardPalette,
    placeHazard,
    removeHazard,
    clearAllHazards,
    setHazardTool,
    selectHazardKind,
  }
}
