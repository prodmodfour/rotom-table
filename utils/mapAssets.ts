import type { DoorState } from '~/types/map'

export interface DecalDefinition {
  id: string
  displayName: string
  texture: string
  defaultScale?: { x: number; z: number }
  tags?: string[]
}

export interface PropDefinition {
  id: string
  displayName: string
  texture: string
  footprint: { x: number; z: number }
  height: number
  width?: number
  anchor?: 'center' | 'bottom-center' | 'grid-cell'
  blocksMovementDefault?: boolean
  blocksSightDefault?: boolean
  interactableDefault?: boolean
  transparent?: boolean
  tags?: string[]
}

export interface DoorDefinition {
  id: string
  displayName: string
  color: string
  accent?: string
  transparent?: boolean
  opacity?: number
  defaultWidth: number
  defaultHeight: number
  tags?: string[]
}

const asset = (path: string) => `/assets/map/airship/${path}`

const decal = (id: string, displayName: string, tags: string[] = [], scale = { x: 1, z: 1 }): DecalDefinition => ({
  id,
  displayName,
  texture: asset(`decals/${id}.svg`),
  defaultScale: scale,
  tags,
})

const prop = (
  id: string,
  displayName: string,
  footprint: { x: number; z: number },
  height: number,
  tags: string[] = [],
  options: Partial<Omit<PropDefinition, 'id' | 'displayName' | 'texture' | 'footprint' | 'height' | 'tags'>> = {},
): PropDefinition => ({
  id,
  displayName,
  texture: asset(`props/${id}.svg`),
  footprint,
  height,
  width: Math.max(footprint.x, footprint.z),
  anchor: 'bottom-center',
  blocksMovementDefault: true,
  blocksSightDefault: false,
  tags,
  ...options,
})

const door = (
  id: string,
  displayName: string,
  color: string,
  accent: string,
  tags: string[] = [],
  options: Partial<Omit<DoorDefinition, 'id' | 'displayName' | 'color' | 'accent' | 'tags'>> = {},
): DoorDefinition => ({
  id,
  displayName,
  color,
  accent,
  defaultWidth: 2,
  defaultHeight: 2.4,
  tags,
  ...options,
})

export const DECAL_DEFINITIONS: readonly DecalDefinition[] = [
  decal('arrow', 'Directional Arrow', ['wayfinding'], { x: 1.2, z: 1.2 }),
  decal('hazard_stripes', 'Hazard Stripes', ['hazard', 'warning'], { x: 2, z: 1 }),
  decal('medical_cross', 'Medical Cross', ['medical'], { x: 1.2, z: 1.2 }),
  decal('snowflake', 'Snowflake Icon', ['ice', 'snow'], { x: 1.1, z: 1.1 }),
  decal('flame', 'Flame Icon', ['thermal', 'fire'], { x: 1.1, z: 1.1 }),
  decal('lightning', 'Lightning Icon', ['electric'], { x: 1.1, z: 1.1 }),
  decal('toxic', 'Biosecure Toxic Icon', ['poison', 'biosecure'], { x: 1.1, z: 1.1 }),
  decal('water_ripple', 'Water Ripple', ['water'], { x: 1.4, z: 1.4 }),
  decal('shoreline_trim', 'Shoreline Trim', ['water', 'edge'], { x: 1.8, z: 0.6 }),
  decal('ranger_insignia', 'Ranger Insignia', ['ranger', 'identity'], { x: 2.2, z: 2.2 }),
  decal('cargo_lift_outline', 'Cargo Lift Outline', ['cargo', 'lift'], { x: 3, z: 3 }),
  decal('decon_chevrons', 'Decontamination Chevrons', ['medical', 'biosecure'], { x: 2.2, z: 1 }),
  decal('staff_only', 'Staff Only Marking', ['staff', 'warning'], { x: 2.4, z: 0.8 }),
  decal('pawprints', 'Pawprints', ['habitat', 'pokemon'], { x: 1.6, z: 1 }),
  decal('egg_icon', 'Egg / Nursery Icon', ['nursery', 'egg'], { x: 1.2, z: 1.2 }),
  decal('quiet_moon', 'Quiet Nook Moon', ['quiet', 'rest'], { x: 1.2, z: 1.2 }),
  decal('observation_ring_mark', 'Observation Ring Mark', ['observation'], { x: 1.5, z: 1.5 }),
] as const

export const PROP_DEFINITIONS: readonly PropDefinition[] = [
  prop('berry_bush', 'Berry Bush', { x: 1, z: 1 }, 1.2, ['habitat', 'plant'], { blocksMovementDefault: false }),
  prop('small_tree', 'Small Tree', { x: 1, z: 1 }, 2.4, ['habitat', 'plant', 'tree']),
  prop('large_tree_cluster', 'Large Tree Cluster', { x: 2, z: 2 }, 3.8, ['habitat', 'plant', 'tree'], { blocksSightDefault: true }),
  prop('reed_patch', 'Reed Patch', { x: 1, z: 1 }, 1.6, ['habitat', 'wetland', 'plant'], { blocksMovementDefault: false }),
  prop('lily_pad', 'Lily Pad', { x: 1, z: 1 }, 0.25, ['habitat', 'water'], { blocksMovementDefault: false }),
  prop('rock_pile', 'Rock Pile', { x: 1, z: 1 }, 0.9, ['habitat', 'stone']),
  prop('burrow_entrance', 'Burrow Entrance', { x: 1, z: 1 }, 0.9, ['habitat', 'burrow'], { interactableDefault: true }),
  prop('cave_den', 'Cave Den', { x: 2, z: 1 }, 1.7, ['habitat', 'cave'], { interactableDefault: true, blocksSightDefault: true }),
  prop('perch_pole', 'Perch Pole', { x: 1, z: 1 }, 2.7, ['habitat', 'aviary'], { blocksMovementDefault: false }),
  prop('perch_tower', 'Perch Tower', { x: 1, z: 1 }, 4.2, ['habitat', 'aviary'], { blocksMovementDefault: true }),
  prop('nest_box', 'Nest Box', { x: 1, z: 1 }, 1.2, ['habitat', 'aviary', 'nursery']),
  prop('feeding_trough', 'Feeding Trough', { x: 2, z: 1 }, 0.8, ['habitat', 'food'], { blocksMovementDefault: false }),
  prop('egg_warmer', 'Egg Warmer / Nursery Pad', { x: 1, z: 1 }, 0.7, ['habitat', 'nursery', 'egg'], { blocksMovementDefault: false, interactableDefault: true }),
  prop('ice_crystal', 'Ice Crystal', { x: 1, z: 1 }, 1.8, ['habitat', 'ice'], { transparent: true }),
  prop('snow_mound', 'Snow Mound', { x: 1, z: 1 }, 0.7, ['habitat', 'snow'], { blocksMovementDefault: false }),
  prop('sand_scrub', 'Sand Scrub Plant', { x: 1, z: 1 }, 1.1, ['habitat', 'sand', 'scrub'], { blocksMovementDefault: false }),
  prop('thermal_vent', 'Thermal Vent', { x: 1, z: 1 }, 1.1, ['habitat', 'thermal'], { blocksMovementDefault: false }),
  prop('heat_rock', 'Heat Rock', { x: 1, z: 1 }, 0.8, ['habitat', 'thermal']),
  prop('charging_pylon', 'Charging Pylon', { x: 1, z: 1 }, 2.5, ['airship', 'electric', 'tech'], { interactableDefault: true }),
  prop('magnetic_coil', 'Magnetic Coil', { x: 1, z: 1 }, 1.4, ['airship', 'electric', 'tech']),
  prop('poison_scrubber', 'Poison Scrubber / Filtration Vent', { x: 1, z: 1 }, 1.8, ['airship', 'poison', 'biosecure'], { interactableDefault: true }),
  prop('console', 'Console', { x: 1, z: 1 }, 1.4, ['airship', 'command', 'tech'], { interactableDefault: true }),
  prop('wall_monitor', 'Wall Monitor', { x: 1, z: 1 }, 1.6, ['airship', 'wall', 'tech'], { blocksMovementDefault: false }),
  prop('pipe_bundle', 'Pipe Bundle', { x: 2, z: 1 }, 1.0, ['airship', 'engineering']),
  prop('vent_grille', 'Vent Grille', { x: 1, z: 1 }, 0.45, ['airship', 'vent'], { blocksMovementDefault: false }),
  prop('cargo_crate', 'Cargo Crate', { x: 1, z: 1 }, 1.1, ['airship', 'cargo']),
  prop('railing', 'Railing', { x: 2, z: 1 }, 1.1, ['airship', 'barrier'], { blocksMovementDefault: true }),
  prop('bulkhead_door_frame', 'Bulkhead Door Frame', { x: 2, z: 1 }, 2.7, ['airship', 'door']),
  prop('medical_bed', 'Medical Bed / Treatment Pad', { x: 2, z: 1 }, 0.9, ['airship', 'medical'], { interactableDefault: true }),
  prop('decon_sprayer', 'Decon Sprayer', { x: 1, z: 1 }, 1.9, ['airship', 'medical', 'biosecure'], { interactableDefault: true }),
  prop('warning_beacon', 'Warning Beacon', { x: 1, z: 1 }, 1.2, ['airship', 'warning'], { blocksMovementDefault: false }),
] as const

export const DOOR_DEFINITIONS: readonly DoorDefinition[] = [
  door('sliding_bulkhead_door', 'Sliding Bulkhead Door', '#4f5b66', '#f9c74f', ['airship', 'bulkhead']),
  door('habitat_gate', 'Habitat Gate', '#4a7c59', '#b7efc5', ['habitat', 'gate']),
  door('medical_airlock', 'Medical Airlock', '#d9f1f2', '#3aa6b9', ['medical', 'airlock']),
  door('engineering_hatch', 'Engineering Hatch', '#5e6570', '#f3722c', ['engineering', 'hatch']),
  door('cargo_lift_gate', 'Cargo Lift Gate', '#5b646e', '#f9c74f', ['cargo', 'lift'], { defaultWidth: 3 }),
  door('glass_habitat_gate', 'Glass Habitat Gate', '#8fd5ff', '#ffffff', ['glass', 'habitat'], { transparent: true, opacity: 0.38 }),
  door('biosecure_quarantine_door', 'Biosecure Quarantine Door', '#5f7d42', '#b5e48c', ['poison', 'biosecure', 'quarantine']),
] as const

export const DECAL_BY_ID = new Map(DECAL_DEFINITIONS.map((definition) => [definition.id, definition]))
export const PROP_BY_ID = new Map(PROP_DEFINITIONS.map((definition) => [definition.id, definition]))
export const DOOR_BY_ID = new Map(DOOR_DEFINITIONS.map((definition) => [definition.id, definition]))

export const getDecalDefinition = (id: string): DecalDefinition | null => DECAL_BY_ID.get(id) ?? null
export const getPropDefinition = (id: string): PropDefinition | null => PROP_BY_ID.get(id) ?? null
export const getDoorDefinition = (id: string): DoorDefinition | null => DOOR_BY_ID.get(id) ?? null

export const doorStateTint = (state: DoorState | undefined): number => {
  switch (state) {
    case 'open': return 0x8ec07c
    case 'locked': return 0xfb4934
    default: return 0xfabd2f
  }
}
