import type { MapHazardKind } from '~/types/map'

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
    color: '#dfe3e8',
    description: 'Ground hazard: Slow Terrain; grounded foes lose a Tick and become Slowed.',
  },
  'toxic-spikes': {
    kind: 'toxic-spikes',
    label: 'Toxic Spikes',
    shortLabel: 'TOX',
    color: '#b56cff',
    description: 'Ground hazard: Poison + Slowed; second layer Badly Poisons instead.',
  },
  'sticky-web': {
    kind: 'sticky-web',
    label: 'Sticky Web',
    shortLabel: 'WEB',
    color: '#c49a4a',
    description: 'Web hazard: Slow Terrain; lowers Speed CS and Slows foes that run into it.',
  },
  'stealth-rock': {
    kind: 'stealth-rock',
    label: 'Stealth Rock',
    shortLabel: 'ROK',
    color: '#aeb5bd',
    description: 'Rock hazard: triggers within 2m, deals one Tick with Rock weakness/resistance.',
  },
  'fire': {
    kind: 'fire',
    label: 'Fire Hazard',
    shortLabel: 'FIR',
    color: '#ff4a55',
    description: 'Special hazard: burns on begin/end turn; passing through costs a Tick.',
  },
}

const HAZARD_KIND_SET = new Set<MapHazardKind>(MAIN_MAP_HAZARD_KINDS)

export const isMapHazardKind = (value: unknown): value is MapHazardKind =>
  typeof value === 'string' && HAZARD_KIND_SET.has(value as MapHazardKind)

export const normalizeMapHazardKind = (value: unknown): MapHazardKind =>
  isMapHazardKind(value) ? value : 'spikes'
