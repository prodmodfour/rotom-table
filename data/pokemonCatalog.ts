import pokedexData from '~~/ptu-data/data/pokedex.json'
import spriteManifest from '~~/data/pokemonSpriteManifest.json'
import backSpriteManifest from '~~/data/pokemonBackSpriteManifest.json'
import type {
  BackSpriteManifestRecord,
  PokedexRecord,
  PokemonCatalogEntry,
  SpriteAnimation,
  SpriteManifestRecord,
  SpriteAnimationRecord,
} from '~/types/pokemon'

const manifestBySpecies = new Map(
  (spriteManifest as SpriteManifestRecord[]).map((entry) => [entry.species, entry]),
)

const backManifestBySpecies = new Map(
  (backSpriteManifest as BackSpriteManifestRecord[]).map((entry) => [entry.species, entry]),
)

const toCatalogAnimation = (animation?: SpriteAnimationRecord): SpriteAnimation | undefined => (
  animation
    ? {
        url: `/${animation.spritesheet_path}`,
        frameWidth: animation.frame_width,
        frameHeight: animation.frame_height,
        frames: animation.frames,
        columns: animation.columns,
        rows: animation.rows,
        durationsMs: animation.durations_ms,
        totalDurationMs: animation.total_duration_ms,
      }
    : undefined
)

const hasPlacementData = (
  entry: PokedexRecord,
): entry is PokedexRecord & {
  size: string
  width: number
  height: number
  base: number
  clearance: number
} => (
  typeof entry.size === 'string' &&
  typeof entry.width === 'number' &&
  typeof entry.height === 'number' &&
  typeof entry.base === 'number' &&
  typeof entry.clearance === 'number'
)

export const pokemonCatalog: PokemonCatalogEntry[] = (pokedexData as PokedexRecord[])
  .map((entry): PokemonCatalogEntry | null => {
    if (!hasPlacementData(entry)) {
      return null
    }

    const sprite = manifestBySpecies.get(entry.species)

    if (!sprite) {
      return null
    }

    const backSprite = backManifestBySpecies.get(entry.species)

    return {
      species: entry.species,
      size: entry.size,
      width: entry.width,
      height: entry.height,
      base: entry.base,
      clearance: entry.clearance,
      slug: sprite.slug,
      spriteUrl: `/sprites/${sprite.local_path.replace(/^sprites\//, '')}`,
      backSpriteUrl: backSprite
        ? `/sprites/${backSprite.local_path.replace(/^sprites\//, '')}`
        : undefined,
      spriteAnimation: toCatalogAnimation(sprite.animation),
      backSpriteAnimation: toCatalogAnimation(backSprite?.animation),
      entityKind: 'pokemon',
    }
  })
  .filter((entry): entry is PokemonCatalogEntry => entry !== null)
  .sort((left, right) => left.species.localeCompare(right.species))

export const pokemonCatalogBySpecies = new Map(
  pokemonCatalog.map((entry) => [entry.species, entry]),
)
