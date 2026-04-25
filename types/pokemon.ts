export interface PokemonSizeRecord {
  species: string
  size: string
  width: number
  height: number
  base: number
  clearance: number
}

export interface PokedexBaseStats {
  hp: number
  atk: number
  def: number
  spatk: number
  spdef: number
  spd: number
}

export interface PokedexAbilities {
  basic?: string[]
  advanced?: string[]
  high?: string[]
}

export interface PokedexEvolution {
  stage: number
  species: string
  min_level?: number
}

export interface PokedexCapabilities {
  overland?: number
  sky?: number
  swim?: number
  levitate?: number
  burrow?: number
  jump?: string
  power?: number
  other?: string[]
}

export interface PokedexLevelUpMove {
  level: number
  name: string
  type: string
}

export interface PokedexTmHmMove {
  /** ``TM`` or ``HM`` — derived from the prefix in the source pokedex. */
  kind: 'TM' | 'HM'
  /** Two-or-three-digit machine number, zero-padded (e.g. ``"06"``, ``"100"``). */
  number: string
  name: string
}

export interface PokedexTutorMove {
  name: string
  /** True when the source marked the move with ``(N)`` for Heart Scale tutoring. */
  heart_scale: boolean
}

export interface PokedexRecord {
  species: string
  size?: string
  width?: number
  height?: number
  base?: number
  clearance?: number
  types?: string[]
  source_gen?: string
  weight?: number
  genderless?: boolean
  male_pct?: number | null
  female_pct?: number | null
  evolution_stage?: number
  evolutions_remaining?: number
  base_stats?: PokedexBaseStats
  abilities?: PokedexAbilities
  evolutions?: PokedexEvolution[]
  egg_groups?: string[]
  hatch_rate?: string | null
  diet?: string[]
  habitat?: string[]
  capabilities?: PokedexCapabilities
  skills?: Record<string, string>
  level_up_moves?: PokedexLevelUpMove[]
  tm_hm_moves?: PokedexTmHmMove[]
  egg_moves?: string[]
  tutor_moves?: PokedexTutorMove[]
  [key: string]: unknown
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

export interface BackSpriteManifestRecord {
  species: string
  slug: string
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
  backSpriteUrl?: string
  entityKind: 'pokemon' | 'trainer'
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
  turned?: boolean
}
