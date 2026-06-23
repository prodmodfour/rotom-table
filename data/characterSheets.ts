import pokedexData from '~~/data/reference/pokedex.json'
import type { CharacterSheet } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'
import { pokemonCatalogBySpecies } from '~~/data/pokemonCatalog'
import { toPokedexSlug } from '~/utils/pokedex/searchFieldValues'
// ---------------------------------------------------------------------------
// Campaign Pokémon sheets are runtime SQLite documents. Do not eager-load
// ``data/sheets`` JSON into the client bundle as a fallback authority.
// These legacy exports remain empty for old imports; sheet UIs hydrate through
// SQLite-backed APIs instead.
// ---------------------------------------------------------------------------

export const characterSheets: CharacterSheet[] = []

export const characterSheetsBySlug = new Map<string, CharacterSheet>()

// ---------------------------------------------------------------------------
// Species/catalog lookups are app-owned reference data and may remain static.
// ---------------------------------------------------------------------------

const pokedexRecords = pokedexData as PokedexRecord[]

const pokedexBySpecies = new Map<string, PokedexRecord>(
  pokedexRecords.map((entry) => [entry.species, entry]),
)

const pokedexBySpeciesSlug = new Map<string, PokedexRecord>()
for (const entry of pokedexRecords) {
  const slug = toPokedexSlug(entry.species)
  if (slug && !pokedexBySpeciesSlug.has(slug)) pokedexBySpeciesSlug.set(slug, entry)
}

export const getPokedexEntry = (species: string): PokedexRecord | null => {
  const exactEntry = pokedexBySpecies.get(species)
  if (exactEntry) return exactEntry

  const slug = toPokedexSlug(species)
  return slug ? pokedexBySpeciesSlug.get(slug) ?? null : null
}

export const getSpriteUrl = (species: string): string | null =>
  pokemonCatalogBySpecies.get(species)?.spriteUrl ?? null
