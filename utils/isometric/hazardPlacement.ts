import type { MapHazardKind, MapHazardV2 } from '~/types/map'
import { normalizeMapHazardLayer } from '~/utils/mapHazards'

export const DEFAULT_ISOMETRIC_HAZARD_KIND: MapHazardKind = 'spikes'

export interface HazardPlacementOptions {
  kind?: MapHazardKind | null
  cell: Pick<MapHazardV2, 'x' | 'y' | 'z'>
}

export const createHazardPlacement = ({
  kind = DEFAULT_ISOMETRIC_HAZARD_KIND,
  cell,
}: HazardPlacementOptions): MapHazardV2 => {
  const hazardKind = kind ?? DEFAULT_ISOMETRIC_HAZARD_KIND
  const hazard: MapHazardV2 = {
    kind: hazardKind,
    x: cell.x,
    y: cell.y,
    z: cell.z,
  }
  const layer = normalizeMapHazardLayer(hazardKind, undefined)
  if (layer !== undefined) hazard.layer = layer
  return hazard
}
