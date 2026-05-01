/**
 * Tabletop map documents.
 *
 * Schema v2 keeps the existing 3D/token model but makes map visuals
 * explicit: voxels point at visual materials, and decals/props/zones/doors
 * describe the extra grammar needed for readable tactical environments.
 */
import type { GridAnchor, GridDimensions } from './pokemon'

export type { GridAnchor, GridDimensions }

export type SheetKind = 'pokemon' | 'trainer'

export interface SheetPlacement {
  /** Stable id used to address this placement (move, delete, turn). */
  id: string
  sheetKind: SheetKind
  sheetSlug: string
  position: GridAnchor
  /** Map-local initiative value used by the encounter tracker. */
  initiative?: number | null
  /** Whether the sprite is facing away from the camera. */
  turned?: boolean
}

export interface InitiativeTrackerState {
  /** Placement id whose turn is currently active. */
  activeId?: string | null
  /** 1-based combat round counter. */
  round?: number
}

export type MapMaterialId = string

/**
 * Legacy terrain names remain accepted by the best-effort loader/build UI;
 * new maps should use `materialId` from the material registry.
 */
export type LegacyVoxelMaterial =
  | 'grass'
  | 'dirt'
  | 'stone'
  | 'water'
  | 'sand'
  | 'snow'
  | 'wood'
  | 'lava'
  | 'path'

export type VoxelMaterial = MapMaterialId

export interface MapVoxelV2 {
  x: number
  y: number
  z: number
  materialId: MapMaterialId
  /** Optional `#rrggbb` override for one-off generated maps. */
  color?: string
  blocksMovement?: boolean
  blocksSight?: boolean
  tags?: string[]
  /** @deprecated v1 compatibility only. */
  material?: LegacyVoxelMaterial | string
}

export type DecalSurface = 'floor' | 'ceiling' | 'north' | 'south' | 'east' | 'west'

export interface DecalPlacement {
  id: string
  decalId: string
  surface: DecalSurface
  position: GridAnchor
  rotation?: number
  scale?: { x: number; y?: number; z: number }
  tint?: string
  opacity?: number
  renderOrder?: number
  tags?: string[]
}

export interface PropPlacement {
  id: string
  propId: string
  /** Optional exact variant id. Omit to let the renderer/generator pick deterministically from the prop definition. */
  variant?: string
  position: GridAnchor
  rotation?: number
  scale?: number | { x: number; y: number; z: number }
  footprint?: { x: number; z: number }
  height?: number
  anchor?: 'center' | 'bottom-center' | 'grid-cell'
  blocksMovement?: boolean
  blocksSight?: boolean
  interactable?: boolean
  tags?: string[]
}

export interface ZoneDefinition {
  id: string
  name: string
  bounds: {
    x1: number
    y1?: number
    z1: number
    x2: number
    y2?: number
    z2: number
  }
  theme?: string
  icon?: string
  tint?: string
  borderStyle?: string
  /** Optional low-opacity floor wash; defaults to the renderer's subtle zone value. */
  floorWashOpacity?: number
  /** Optional themed corner marker decal id. Defaults to icon when omitted. */
  cornerMarker?: string
  ambientLight?: string
  tags?: string[]
}

export type DoorState = 'open' | 'closed' | 'locked'

export interface DoorPlacement {
  id: string
  doorId: string
  position: GridAnchor
  rotation?: number
  width?: number
  height?: number
  state?: DoorState
  connectsTo?: string
  tags?: string[]
}

export interface LightPlacement {
  id: string
  kind: 'ambient' | 'point' | 'emissive' | 'zone'
  position?: GridAnchor
  color?: string
  intensity?: number
  radius?: number
  zoneId?: string
}

export interface MaterialDefinition {
  id: string
  displayName: string
  color?: string
  texture?: string
  transparent?: boolean
  opacity?: number
  emissive?: string
  roughness?: number
  blocksMovementDefault?: boolean
  blocksSightDefault?: boolean
  tags?: string[]
}

export interface TabletopMapV2 {
  schemaVersion: 2
  /** URL slug, also the on-disk filename stem (`<slug>.json`). */
  slug: string
  name: string
  /** Optional folder label, derived from `data/maps/` when omitted. */
  folder?: string
  dimensions: GridDimensions
  assetPacks?: string[]
  voxels: MapVoxelV2[]
  placements: SheetPlacement[]
  decals?: DecalPlacement[]
  props?: PropPlacement[]
  zones?: ZoneDefinition[]
  doors?: DoorPlacement[]
  lights?: LightPlacement[]
  /** Current turn + round state for the collapsible initiative tracker. */
  initiative?: InitiativeTrackerState
  metadata?: Record<string, unknown>
  createdAt?: number
  updatedAt?: number
}

/** v1 on-disk compatibility shape. */
export interface TabletopMapV1 {
  schemaVersion?: 1
  slug: string
  name: string
  folder?: string
  dimensions: GridDimensions
  placements: SheetPlacement[]
  initiative?: InitiativeTrackerState
  voxels: Array<Omit<MapVoxelV2, 'materialId'> & { material: LegacyVoxelMaterial | string }>
  createdAt?: number
  updatedAt?: number
}

export type TabletopMap = TabletopMapV2

export interface MapSummary {
  slug: string
  name: string
  folder: string
  dimensions: GridDimensions
  placementCount: number
  schemaVersion?: number
  updatedAt?: number
}

export interface LayerVisibility {
  terrain: boolean
  decals: boolean
  props: boolean
  zones: boolean
  doors: boolean
  transparentObjects: boolean
  shadows: boolean
  tokens: boolean
  grid: boolean
}

/** @deprecated Use SheetPlacement. */
export type MapPlacement = SheetPlacement
/** @deprecated Use MapVoxelV2. */
export type GridVoxel = MapVoxelV2
/** @deprecated Use TabletopMapV2. */
export type Grid = TabletopMapV2
/** @deprecated Use MapSummary. */
export type GridSummary = MapSummary
