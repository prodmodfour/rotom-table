/**
 * Tabletop map documents.
 *
 * Maps store sparse terrain voxels, sheet placements, and lighting state.
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
  /** Absolute Y coordinate that is displayed as map-specific/ground Y=0. */
  groundLevelY?: number
  voxels: MapVoxelV2[]
  placements: SheetPlacement[]
  lights?: LightPlacement[]
  /** Current turn + round state for the collapsible initiative tracker. */
  initiative?: InitiativeTrackerState
  metadata?: Record<string, unknown>
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
  shadows: boolean
  tokens: boolean
  grid: boolean
}
