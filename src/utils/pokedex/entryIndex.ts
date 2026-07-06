import { compareByNationalDex, getNationalDexNumber } from '~/utils/nationalDex'
import { pokedexEntryPathForSlug } from '~/utils/pokedex/routes'
import { createLazyPokedexSearchTexts, toPokedexSlug, type PokedexSearchTexts } from '~/utils/pokedex/searchText'
import type { PokedexRecord } from '~/types/pokemon'

export type IndexedPokedexEntry = PokedexRecord & {
  id: string
  slug: string
  nationalDexNumber: number | null
}

export type DisplayPokedexEntry = IndexedPokedexEntry & {
  searchText: string
  searchTexts: PokedexSearchTexts
}

export type PokedexEntrySummary = Pick<IndexedPokedexEntry, 'id' | 'species' | 'slug' | 'nationalDexNumber' | 'types' | 'source_gen'>

export type PokedexEntryDetail = IndexedPokedexEntry & {
  spriteUrl: string | null
  profileSpriteUrl: string | null
}

export const attachLazyPokedexSearchTexts = <TEntry extends IndexedPokedexEntry>(
  entry: TEntry,
): TEntry & Pick<DisplayPokedexEntry, 'searchText' | 'searchTexts'> => {
  const searchTexts = createLazyPokedexSearchTexts(entry)

  return Object.defineProperties(entry, {
    searchText: {
      enumerable: false,
      get: () => searchTexts.any,
    },
    searchTexts: {
      enumerable: false,
      value: searchTexts,
    },
  }) as TEntry & Pick<DisplayPokedexEntry, 'searchText' | 'searchTexts'>
}

export const toIndexedPokedexEntry = (entry: PokedexRecord, index: number): IndexedPokedexEntry => {
  const slug = toPokedexSlug(entry.species)

  return {
    ...entry,
    id: `${index}-${slug || 'entry'}`,
    slug,
    nationalDexNumber: getNationalDexNumber(entry.species),
  }
}

export const toPokedexEntrySummary = (entry: IndexedPokedexEntry): PokedexEntrySummary => ({
  id: entry.id,
  species: entry.species,
  slug: entry.slug,
  nationalDexNumber: entry.nationalDexNumber,
  types: entry.types,
  source_gen: entry.source_gen,
})

export const buildSearchablePokedexEntries = (entries: IndexedPokedexEntry[]): DisplayPokedexEntry[] => (
  entries.map((entry) => attachLazyPokedexSearchTexts(entry))
)

export const buildPokedexEntries = (records: PokedexRecord[]): DisplayPokedexEntry[] => buildSearchablePokedexEntries(
  [...records]
    .filter((entry): entry is PokedexRecord => Boolean(entry?.species))
    .sort(compareByNationalDex)
    .map(toIndexedPokedexEntry),
)

export const buildPokedexEntryBySlug = <TEntry extends Pick<IndexedPokedexEntry, 'slug'>>(
  entries: readonly TEntry[],
): Map<string, TEntry> => {
  const entryBySlug = new Map<string, TEntry>()

  for (const entry of entries) {
    // A few upstream parser artifacts share the same bogus species label. Keep
    // the first so every real Pokémon still resolves to a stable name URL.
    if (!entry.slug || entryBySlug.has(entry.slug)) continue
    entryBySlug.set(entry.slug, entry)
  }

  return entryBySlug
}

export const pokedexEntryPath = (entry: Pick<IndexedPokedexEntry, 'slug'>): string =>
  pokedexEntryPathForSlug(entry.slug)

export const routeParamToPokedexSlug = (value: unknown): string | null => {
  const rawValue = Array.isArray(value) ? value[0] : value
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) return null

  // Accept copied URLs that use underscores, while links we generate use the
  // canonical hyphenated slug.
  return toPokedexSlug(rawValue.replace(/_/g, ' ')) || null
}
