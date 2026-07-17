/** Canonical Pokémon type identities shared by wire parsers and mechanics queries. */
export const POKEMON_TYPES = [
  'Normal',
  'Fighting',
  'Flying',
  'Poison',
  'Ground',
  'Rock',
  'Bug',
  'Ghost',
  'Steel',
  'Fire',
  'Water',
  'Grass',
  'Electric',
  'Psychic',
  'Ice',
  'Dragon',
  'Dark',
  'Fairy',
] as const

export type PokemonType = (typeof POKEMON_TYPES)[number]
export type PokemonTypeId = Lowercase<PokemonType>

export const POKEMON_TYPE_IDS = POKEMON_TYPES.map(
  type => type.toLowerCase() as PokemonTypeId,
) as readonly PokemonTypeId[]

const POKEMON_TYPE_BY_ID = new Map<PokemonTypeId, PokemonType>(
  POKEMON_TYPES.map(type => [type.toLowerCase() as PokemonTypeId, type]),
)

export const pokemonTypeForId = (value: string): PokemonType | null => (
  POKEMON_TYPE_BY_ID.get(value.trim().toLowerCase() as PokemonTypeId) ?? null
)

export const pokemonTypeId = (value: string): PokemonTypeId | null => {
  const type = pokemonTypeForId(value)
  return type ? type.toLowerCase() as PokemonTypeId : null
}
