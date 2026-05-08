import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { BuildTool } from '~/shared/mapEditor'
import {
  MAIN_MAP_HAZARD_KINDS,
  MAP_HAZARD_DEFINITIONS,
  mapHazardKey,
  normalizeMapHazardLayer,
} from '~/utils/mapHazards'
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
    const normalized: MapHazardV2 = {
      kind: hazard.kind,
      x: Math.round(hazard.x),
      y: Math.round(hazard.y),
      z: Math.round(hazard.z),
    }
    const layer = normalizeMapHazardLayer(normalized.kind, hazard.layer)
    if (layer !== undefined) normalized.layer = layer
    if (typeof hazard.owner === 'string' && hazard.owner.trim()) normalized.owner = hazard.owner.trim()

    const key = mapHazardKey(normalized)
    let found = false
    const next = mapHazards.value.map((existing) => {
      if (mapHazardKey(existing) !== key) return existing
      found = true
      if (normalized.kind !== 'toxic-spikes') return existing
      return {
        ...existing,
        layer: Math.min(2, Math.max(existing.layer ?? 1, normalized.layer ?? 1) + 1),
      }
    })
    if (!found) next.push(normalized)
    map.value.hazards = next
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
