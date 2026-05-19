import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
import { toPokedexSlug } from '~/utils/pokedex/searchText'
import { toEditablePokedexRecord } from '~/utils/pokedex/persistence'
import type { PokedexRecord, SpriteManifestRecord } from '~/types/pokemon'
import { PROJECT_ROOT, relativeToProjectRoot } from './fsPaths'

const POKEDEX_REFERENCE_PATH = join(PROJECT_ROOT, 'data', 'reference', 'pokedex.json')
const POKEDEX_JSON_INDENT = 2

export class PokedexEntryConflictError extends Error {}

let recordsCache: PokedexRecord[] | null = null
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

export const resetPokedexRepositoryCaches = (): void => {
  recordsCache = null
  entriesCache = null
  entryBySlugCache = null
  summariesCache = null
  searchEntriesCache = null
}

const readPokedexRecordsFromDisk = (): PokedexRecord[] => {
  if (!existsSync(POKEDEX_REFERENCE_PATH)) return []

  const parsed = JSON.parse(readFileSync(POKEDEX_REFERENCE_PATH, 'utf8'))
  return Array.isArray(parsed) ? parsed as PokedexRecord[] : []
}

const getPokedexRecords = (): PokedexRecord[] => {
  recordsCache ??= readPokedexRecordsFromDisk()
  return recordsCache
}

const replacePokedexRecords = (records: PokedexRecord[]): void => {
  writeFileSync(
    POKEDEX_REFERENCE_PATH,
    `${JSON.stringify(records, null, POKEDEX_JSON_INDENT)}\n`,
    'utf8',
  )
  recordsCache = records
  entriesCache = null
  entryBySlugCache = null
  summariesCache = null
  searchEntriesCache = null
}

const getPokedexEntries = (): DisplayPokedexEntry[] => {
  entriesCache ??= buildPokedexEntries(getPokedexRecords())
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

const entrySlug = (entry: Pick<PokedexRecord, 'species'>): string => toPokedexSlug(entry.species)

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

const findPokedexRecordIndexBySlug = (slug: string): number => (
  getPokedexRecords().findIndex((entry) => entrySlug(entry) === slug)
)

export const replacePokedexEntryBySlug = (
  slug: string,
  entry: PokedexRecord,
): { entry: PokedexEntryDetail; path: string } | null => {
  const records = getPokedexRecords()
  const index = findPokedexRecordIndexBySlug(slug)
  if (index < 0) return null

  const persisted = toEditablePokedexRecord(entry as Record<string, unknown>)
  if (!persisted) return null

  const nextSlug = entrySlug(persisted)
  const conflictingIndex = records.findIndex((candidate, candidateIndex) => (
    candidateIndex !== index && entrySlug(candidate) === nextSlug
  ))
  if (conflictingIndex >= 0) {
    throw new PokedexEntryConflictError(`Pokédex entry slug already exists: ${nextSlug}`)
  }

  const nextRecords = records.slice()
  nextRecords[index] = persisted
  replacePokedexRecords(nextRecords)

  const updatedEntry = getPokedexEntryBySlug().get(nextSlug)
  return updatedEntry
    ? { entry: toDetailResponse(updatedEntry), path: relativeToProjectRoot(POKEDEX_REFERENCE_PATH) }
    : null
}
