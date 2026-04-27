/**
 * Tabletop grid documents.
 *
 * A `Grid` is a saved tabletop layout: dimensions plus a list of
 * `GridPlacement` records that point at character sheets by slug. The
 * sheet itself is the source of truth for sprite, footprint, HP, name,
 * etc. — placements only carry the *grid-specific* data (where the
 * token sits, whether it's flipped). That means a single Pokémon can
 * appear on multiple grids and edits to its sheet propagate to every
 * grid showing it.
 */
import type { GridAnchor, GridDimensions } from './pokemon'

export type { GridAnchor, GridDimensions }

export type SheetKind = 'pokemon' | 'trainer'

export interface GridPlacement {
  /** Stable id used to address this placement (move, delete, turn). */
  id: string
  sheetKind: SheetKind
  sheetSlug: string
  position: GridAnchor
  /** Whether the sprite is facing away from the camera. */
  turned?: boolean
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

export interface Grid {
  /** URL slug, also the on-disk filename stem (`<slug>.json`). */
  slug: string
  name: string
  /**
   * Optional folder label. When omitted the loader derives it from the
   * file's directory under `data/grids/`.
   */
  folder?: string
  dimensions: GridDimensions
  placements: GridPlacement[]
  /** Sparse list of 1×1×1 terrain blocks. */
  voxels: GridVoxel[]
  createdAt?: number
  updatedAt?: number
}

export interface GridSummary {
  slug: string
  name: string
  folder: string
  dimensions: GridDimensions
  placementCount: number
  updatedAt?: number
}
