import type { GridDimensions, MapHazardKind, MapHazardV2 } from '~/types/map'

export const MAIN_MAP_HAZARD_KINDS = [
  'spikes',
  'toxic-spikes',
  'sticky-web',
  'stealth-rock',
  'fire',
] as const satisfies readonly MapHazardKind[]

export interface MapHazardDefinition {
  kind: MapHazardKind
  label: string
  shortLabel: string
  color: string
  description: string
}

export const MAP_HAZARD_DEFINITIONS: Record<MapHazardKind, MapHazardDefinition> = {
  'spikes': {
    kind: 'spikes',
    label: 'Spikes',
    shortLabel: 'SPK',
    color: '#bdae93',
    description: 'Ground hazard: Slow Terrain; grounded foes lose a Tick and become Slowed.',
  },
  'toxic-spikes': {
    kind: 'toxic-spikes',
    label: 'Toxic Spikes',
    shortLabel: 'TOX',
    color: '#b16286',
    description: 'Ground hazard: Poison + Slowed; second layer Badly Poisons instead.',
  },
  'sticky-web': {
    kind: 'sticky-web',
    label: 'Sticky Web',
    shortLabel: 'WEB',
    color: '#d79921',
    description: 'Web hazard: Slow Terrain; lowers Speed CS and Slows foes that run into it.',
  },
  'stealth-rock': {
    kind: 'stealth-rock',
    label: 'Stealth Rock',
    shortLabel: 'ROK',
    color: '#a89984',
    description: 'Rock hazard: triggers within 2m, deals one Tick with Rock weakness/resistance.',
  },
  'fire': {
    kind: 'fire',
    label: 'Fire Hazard',
    shortLabel: 'FIR',
    color: '#fb4934',
    description: 'Special hazard: burns on begin/end turn; passing through costs a Tick.',
  },
}

const HAZARD_KIND_SET = new Set<MapHazardKind>(MAIN_MAP_HAZARD_KINDS)

export const isMapHazardKind = (value: unknown): value is MapHazardKind =>
  typeof value === 'string' && HAZARD_KIND_SET.has(value as MapHazardKind)

export const normalizeMapHazardKind = (value: unknown): MapHazardKind =>
  isMapHazardKind(value) ? value : 'spikes'

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
