import pokedexData from '~~/ptu-data/data/pokedex.json'
import spriteManifest from '~~/data/pokemonSpriteManifest.json'
import {
  buildPokedexEntries,
  buildPokedexEntryBySlug,
  toPokedexEntrySummary,
  type DisplayPokedexEntry,
  type IndexedPokedexEntry,
  type PokedexEntryDetail,
  type PokedexEntrySummary,
} from '~/utils/pokedex/entryIndex'
import type { PokedexRecord, SpriteManifestRecord } from '~/types/pokemon'

let entriesCache: DisplayPokedexEntry[] | null = null
let entryBySlugCache: Map<string, DisplayPokedexEntry> | null = null
let summariesCache: PokedexEntrySummary[] | null = null
let searchEntriesCache: IndexedPokedexEntry[] | null = null

const spriteUrlBySpecies = new Map(
  (spriteManifest as SpriteManifestRecord[]).map((entry) => [
    entry.species,
    `/sprites/${entry.local_path.replace(/^sprites\//, '')}`,
  ]),
)

const getPokedexEntries = (): DisplayPokedexEntry[] => {
  entriesCache ??= buildPokedexEntries(pokedexData as PokedexRecord[])
  return entriesCache
}

const getPokedexEntryBySlug = (): Map<string, DisplayPokedexEntry> => {
  entryBySlugCache ??= buildPokedexEntryBySlug(getPokedexEntries())
  return entryBySlugCache
}

const toSerializableIndexedEntry = (entry: DisplayPokedexEntry): IndexedPokedexEntry => ({
  ...entry,
})

const toDetailResponse = (entry: DisplayPokedexEntry): PokedexEntryDetail => ({
  ...entry,
  spriteUrl: spriteUrlBySpecies.get(entry.species) ?? null,
})

export const listPokedexEntrySummaries = (): PokedexEntrySummary[] => {
  summariesCache ??= getPokedexEntries().map(toPokedexEntrySummary)
  return summariesCache
}

export const listPokedexSearchEntries = (): IndexedPokedexEntry[] => {
  searchEntriesCache ??= getPokedexEntries().map(toSerializableIndexedEntry)
  return searchEntriesCache
}

export const findPokedexEntryDetail = (slug: string | null): PokedexEntryDetail | null => {
  const entry = slug ? getPokedexEntryBySlug().get(slug) : getPokedexEntries()[0]
  return entry ? toDetailResponse(entry) : null
}
