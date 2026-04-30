/**
 * Tabletop map documents.
 *
 * A `TabletopMap` is a saved tabletop layout: dimensions plus a list of
 * `MapPlacement` records that point at character sheets by slug. The
 * sheet itself is the source of truth for sprite, footprint, HP, name,
 * etc. — placements only carry the *map-specific* data (where the
 * token sits, whether it's flipped). That means a single Pokémon can
 * appear on multiple maps and edits to its sheet propagate to every
 * map showing it.
 */
import type { GridAnchor, GridDimensions } from './pokemon'

export type { GridAnchor, GridDimensions }

export type SheetKind = 'pokemon' | 'trainer'

export interface MapPlacement {
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

export type VoxelMaterial =
  | 'grass'
  | 'dirt'
  | 'stone'
  | 'water'
  | 'sand'
  | 'snow'
  | 'wood'
  | 'lava'
  | 'path'

export interface GridVoxel {
  x: number
  y: number
  z: number
  material: VoxelMaterial
  /** Optional ``"#rrggbb"`` override for biomes outside the preset palette. */
  color?: string
}

export interface TabletopMap {
  /** URL slug, also the on-disk filename stem (`<slug>.json`). */
  slug: string
  name: string
  /**
   * Optional folder label. When omitted the loader derives it from the
   * file's directory under `data/maps/`.
   */
  folder?: string
  dimensions: GridDimensions
  placements: MapPlacement[]
  /** Current turn + round state for the collapsible initiative tracker. */
  initiative?: InitiativeTrackerState
  /** Sparse list of 1×1×1 terrain blocks. */
  voxels: GridVoxel[]
  createdAt?: number
  updatedAt?: number
}

export interface MapSummary {
  slug: string
  name: string
  folder: string
  dimensions: GridDimensions
  placementCount: number
  updatedAt?: number
}

/** @deprecated Use MapPlacement. */
export type GridPlacement = MapPlacement
/** @deprecated Use TabletopMap. */
export type Grid = TabletopMap
/** @deprecated Use MapSummary. */
export type GridSummary = MapSummary
