import type { GridDimensions, MapHazardKind, MapHazardV2 } from '~/types/map'
import { isMapHazardKind } from '~/utils/mapHazardDefinitions'

export const normalizeMapHazardLayer = (
  kind: MapHazardKind,
  value: unknown,
): number | undefined => {
  if (kind !== 'toxic-spikes') return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.min(2, Math.max(1, Math.round(n)))
}

export const mapHazardCellKey = (hazard: Pick<MapHazardV2, 'x' | 'y' | 'z'>): string =>
  `${hazard.x},${hazard.y},${hazard.z}`

export const mapHazardKey = (hazard: Pick<MapHazardV2, 'kind' | 'x' | 'y' | 'z'>): string =>
  `${hazard.kind}:${hazard.x},${hazard.y},${hazard.z}`

export const normalizeMapHazard = (value: unknown): MapHazardV2 | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!isMapHazardKind(record.kind)) return null
  const kind = record.kind
  const x = Number(record.x)
  const y = Number(record.y)
  const z = Number(record.z)
  if (![x, y, z].every((axis) => Number.isInteger(axis))) return null
  const out: MapHazardV2 = { kind, x, y, z }
  const layer = normalizeMapHazardLayer(kind, record.layer)
  if (layer !== undefined) out.layer = layer
  if (typeof record.owner === 'string' && record.owner.trim()) out.owner = record.owner.trim()
  return out
}

export const hazardInBounds = (
  hazard: Pick<MapHazardV2, 'x' | 'y' | 'z'>,
  dimensions: GridDimensions,
): boolean =>
  hazard.x >= 0 &&
  hazard.x < dimensions.x &&
  hazard.y >= 0 &&
  hazard.y < dimensions.y &&
  hazard.z >= 0 &&
  hazard.z < dimensions.z

export const filterMapHazardsInBounds = (
  hazards: readonly MapHazardV2[],
  dimensions: GridDimensions,
): MapHazardV2[] => hazards.filter((hazard) => hazardInBounds(hazard, dimensions))
