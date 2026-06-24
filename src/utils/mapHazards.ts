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

export type MapHazardPlacementFailureCode = 'invalid-hazard' | 'out-of-bounds'

export interface ApplyMapHazardPlacementSuccess {
  readonly ok: true
  readonly hazards: readonly MapHazardV2[]
  readonly hazard: MapHazardV2
  readonly changed: boolean
}

export interface ApplyMapHazardPlacementFailure {
  readonly ok: false
  readonly code: MapHazardPlacementFailureCode
  readonly message: string
  readonly hazard?: MapHazardV2
}

export type ApplyMapHazardPlacementResult = ApplyMapHazardPlacementSuccess | ApplyMapHazardPlacementFailure

const cloneMapHazard = (hazard: MapHazardV2): MapHazardV2 => ({
  kind: hazard.kind,
  x: hazard.x,
  y: hazard.y,
  z: hazard.z,
  ...(hazard.layer === undefined ? {} : { layer: hazard.layer }),
  ...(hazard.owner === undefined ? {} : { owner: hazard.owner }),
})

const normalizeMapHazardPlacement = (value: unknown): MapHazardV2 | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!isMapHazardKind(record.kind)) return null
  const x = Number(record.x)
  const y = Number(record.y)
  const z = Number(record.z)
  if (![x, y, z].every((axis) => Number.isFinite(axis))) return null
  const hazard: MapHazardV2 = {
    kind: record.kind,
    x: Math.round(x),
    y: Math.round(y),
    z: Math.round(z),
  }
  const layer = normalizeMapHazardLayer(hazard.kind, record.layer)
  if (layer !== undefined) hazard.layer = layer
  if (typeof record.owner === 'string' && record.owner.trim()) hazard.owner = record.owner.trim()
  return hazard
}

export const applyMapHazardPlacement = (options: {
  readonly hazards: readonly MapHazardV2[] | null | undefined
  readonly hazard: unknown
  readonly dimensions: GridDimensions
}): ApplyMapHazardPlacementResult => {
  const hazard = normalizeMapHazardPlacement(options.hazard)
  if (!hazard) {
    return {
      ok: false,
      code: 'invalid-hazard',
      message: 'Generated hazard is invalid.',
    }
  }
  if (!hazardInBounds(hazard, options.dimensions)) {
    return {
      ok: false,
      code: 'out-of-bounds',
      message: `Hazard ${hazard.kind} at ${hazard.x},${hazard.y},${hazard.z} is outside the map bounds.`,
      hazard: cloneMapHazard(hazard),
    }
  }

  let placed: MapHazardV2 | undefined
  let changed = false
  const key = mapHazardKey(hazard)
  const next = (options.hazards ?? []).map((existing) => {
    const cloned = cloneMapHazard(existing)
    if (mapHazardKey(cloned) !== key) return cloned
    placed = cloneMapHazard(cloned)
    if (hazard.kind !== 'toxic-spikes') return cloned

    const previousLayer = cloned.layer ?? 1
    const nextLayer = Math.min(2, previousLayer + 1)
    placed = { ...cloned, layer: nextLayer }
    if (nextLayer !== previousLayer) changed = true
    return cloneMapHazard(placed)
  })

  if (placed === undefined) {
    placed = cloneMapHazard(hazard)
    next.push(cloneMapHazard(hazard))
    changed = true
  }

  return {
    ok: true,
    hazards: next,
    hazard: cloneMapHazard(placed),
    changed,
  }
}
