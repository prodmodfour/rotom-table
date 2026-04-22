export interface PokemonSizeRecord {
  species: string
  size: string
  width: number
  height: number
  base: number
  clearance: number
}

export interface SpriteManifestRecord {
  species: string
  slug: string
  source_gen: string
  asset_kind: string
  remote_url: string
  local_path: string
  bytes: number
}

export interface SpriteCrop {
  canvasWidth: number
  canvasHeight: number
  left: number
  top: number
  width: number
  height: number
}

export interface PokemonCatalogEntry extends PokemonSizeRecord {
  slug: string
  spriteUrl: string
  spriteCrop?: SpriteCrop
}

export interface TrainerSizeRecord {
  trainer: string
  slug: string
  width: number
  height: number
  base: number
  clearance: number
  artist: string | null
}

export interface TrainerSpriteManifestRecord {
  trainer: string
  slug: string
  artist: string | null
  remote_url: string
  local_path: string
  bytes: number
  pixel_width: number
  pixel_height: number
  canvas_width?: number
  canvas_height?: number
  bbox_left?: number
  bbox_top?: number
  bbox_width?: number
  bbox_height?: number
}

export interface GridDimensions {
  x: number
  y: number
  z: number
}

export interface GridAnchor {
  x: number
  y: number
  z: number
}

export interface SpawnedPokemon extends PokemonCatalogEntry {
  id: string
  position: GridAnchor
}
