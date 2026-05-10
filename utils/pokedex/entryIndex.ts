import { compareByNationalDex, getNationalDexNumber } from '~/utils/nationalDex'
import { pokedexEntryPathForSlug } from '~/utils/pokedex/routes'
import { buildPokedexSearchTexts, toPokedexSlug, type PokedexSearchTexts } from '~/utils/pokedex/searchText'
import type { PokedexRecord } from '~/types/pokemon'

export type DisplayPokedexEntry = PokedexRecord & {
  id: string
  slug: string
  nationalDexNumber: number | null
  searchText: string
  searchTexts: PokedexSearchTexts
}

export const buildPokedexEntries = (records: PokedexRecord[]): DisplayPokedexEntry[] => [...records]
  .filter((entry): entry is PokedexRecord => Boolean(entry?.species))
  .sort(compareByNationalDex)
  .map((entry, index) => {
    const slug = toPokedexSlug(entry.species)
    const displayEntry = {
      ...entry,
      id: `${index}-${slug || 'entry'}`,
      slug,
      nationalDexNumber: getNationalDexNumber(entry.species),
    }

    const searchTexts = buildPokedexSearchTexts(displayEntry)

    return {
      ...displayEntry,
      searchText: searchTexts.any,
      searchTexts,
    }
  })

export const buildPokedexEntryBySlug = (entries: DisplayPokedexEntry[]): Map<string, DisplayPokedexEntry> => {
  const entryBySlug = new Map<string, DisplayPokedexEntry>()

  for (const entry of entries) {
    // A few upstream parser artifacts share the same bogus species label. Keep
    // the first so every real Pokémon still resolves to a stable name URL.
    if (!entry.slug || entryBySlug.has(entry.slug)) continue
    entryBySlug.set(entry.slug, entry)
  }

  return entryBySlug
}

export const pokedexEntryPath = (entry: Pick<DisplayPokedexEntry, 'slug'>): string =>
  pokedexEntryPathForSlug(entry.slug)

export const routeParamToPokedexSlug = (value: unknown): string | null => {
  const rawValue = Array.isArray(value) ? value[0] : value
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) return null

  // Accept copied URLs that use underscores, while links we generate use the
  // canonical hyphenated slug.
  return toPokedexSlug(rawValue.replace(/_/g, ' ')) || null
}
