import { toPokedexSlug } from '~/utils/pokedex/searchText'

export const POKEDEX_PATH = '/pokedex'

export const pokedexPath = (): typeof POKEDEX_PATH => POKEDEX_PATH

export const isPokedexPath = (path: string): boolean => path.startsWith(POKEDEX_PATH)

export const pokedexEntryPathForSlug = (slug: string): string =>
  `${POKEDEX_PATH}/${encodeURIComponent(slug)}`

export const pokedexEntryPathForSpecies = (species: string | null | undefined): string | null => {
  if (!species) return null
  const slug = toPokedexSlug(species)
  return slug ? pokedexEntryPathForSlug(slug) : null
}
