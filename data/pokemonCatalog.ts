import sizeData from '~/pokemon_sizes/pokemon.json'
import spriteManifest from '~/pokemon_sizes/sprite_manifest.json'
import backSpriteManifest from '~/pokemon_sizes/back_sprite_manifest.json'
import type {
  BackSpriteManifestRecord,
  PokemonCatalogEntry,
  PokemonSizeRecord,
  SpriteManifestRecord,
} from '~/types/pokemon'

const manifestBySpecies = new Map(
  (spriteManifest as SpriteManifestRecord[]).map((entry) => [entry.species, entry]),
)

const backManifestBySpecies = new Map(
  (backSpriteManifest as BackSpriteManifestRecord[]).map((entry) => [entry.species, entry]),
)

export const pokemonCatalog: PokemonCatalogEntry[] = (sizeData as PokemonSizeRecord[])
  .map((entry) => {
    const sprite = manifestBySpecies.get(entry.species)

    if (!sprite) {
      return null
    }

    const backSprite = backManifestBySpecies.get(entry.species)

    return {
      ...entry,
      slug: sprite.slug,
      spriteUrl: `/sprites/${sprite.local_path.replace(/^sprites\//, '')}`,
      backSpriteUrl: backSprite
        ? `/sprites/${backSprite.local_path.replace(/^sprites\//, '')}`
        : undefined,
      entityKind: 'pokemon',
    }
  })
  .filter((entry): entry is PokemonCatalogEntry => entry !== null)
  .sort((left, right) => left.species.localeCompare(right.species))

export const pokemonCatalogBySpecies = new Map(
  pokemonCatalog.map((entry) => [entry.species, entry]),
)
