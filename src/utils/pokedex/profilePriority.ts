import type { PlayerProfile } from '#shared/playerProfiles'
import {
  playerProfileTokenControlLinkedTrainerPokemonSlugs,
  type PlayerProfileTokenControlLinkedTrainerSheetSource,
} from '#shared/playerProfileTokenControl'
import type { IndexedPokedexEntry } from '~/utils/pokedex/entryIndex'
import { toPokedexSlug } from '~/utils/pokedex/searchText'

export interface PokedexProfilePriorityPokemonSheet {
  readonly species?: unknown
}

export interface PokedexProfilePriorityOptions {
  readonly profile: PlayerProfile | null | undefined
  readonly linkedTrainerSheets: PlayerProfileTokenControlLinkedTrainerSheetSource | undefined
  readonly pokemonBySlug: ReadonlyMap<string, PokedexProfilePriorityPokemonSheet>
}

export interface PokedexProfilePriorityResponse {
  readonly slugs: readonly string[]
}

const pokedexSlugForPokemonSheet = (
  sheet: PokedexProfilePriorityPokemonSheet | null | undefined,
): string | null => {
  const species = typeof sheet?.species === 'string' ? sheet.species : ''
  const slug = toPokedexSlug(species)
  return slug || null
}

export const profileLinkedPokemonPokedexSlugs = ({
  profile,
  linkedTrainerSheets,
  pokemonBySlug,
}: PokedexProfilePriorityOptions): ReadonlySet<string> => {
  const linkedPokemonSlugs = playerProfileTokenControlLinkedTrainerPokemonSlugs(profile, linkedTrainerSheets)
  const pokedexSlugs = new Set<string>()

  for (const pokemonSlug of linkedPokemonSlugs) {
    const pokedexSlug = pokedexSlugForPokemonSheet(pokemonBySlug.get(pokemonSlug))
    if (pokedexSlug) pokedexSlugs.add(pokedexSlug)
  }

  return pokedexSlugs
}

export const prioritizePokedexEntries = <TEntry extends Pick<IndexedPokedexEntry, 'slug'>>(
  entries: TEntry[],
  prioritySlugs: ReadonlySet<string>,
): TEntry[] => {
  if (prioritySlugs.size === 0) return entries

  const priorityEntries: TEntry[] = []
  const remainingEntries: TEntry[] = []

  for (const entry of entries) {
    if (prioritySlugs.has(entry.slug)) priorityEntries.push(entry)
    else remainingEntries.push(entry)
  }

  return priorityEntries.length === 0
    ? entries
    : [...priorityEntries, ...remainingEntries]
}
