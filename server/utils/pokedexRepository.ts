import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import spriteManifest from '~~/data/pokemonSpriteManifest.json'
import backSpriteManifest from '~~/data/pokemonBackSpriteManifest.json'
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
import type { BackSpriteManifestRecord, PokedexRecord, SpriteManifestRecord } from '~/types/pokemon'
import { pokemonProfileSpriteUrl } from '~/utils/profileSprites'
import { toSpriteVisualBounds } from '~/utils/pokemonSpriteVisualBounds'
import { PROJECT_ROOT } from './fsPaths'
import { CAMPAIGN_POKEDEX_OVERRIDES_PATH, campaignPathLabel } from './campaignPaths'
import { tryReadJsonFile, writeJsonFile } from './jsonFiles'

const POKEDEX_REFERENCE_PATH = join(PROJECT_ROOT, 'data', 'reference', 'pokedex.json')
const POKEDEX_OVERRIDE_FILE_VERSION = 1

interface PokedexReferenceOverridesFile {
  version?: number
  entries?: Record<string, unknown>
}

type PokedexReferenceOverrides = Record<string, PokedexRecord>

export class PokedexEntryConflictError extends Error {}

let baseRecordsCache: PokedexRecord[] | null = null
let overrideRecordsCache: PokedexReferenceOverrides | null = null
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

const profileSpriteUrlBySpecies = new Map(
  (spriteManifest as SpriteManifestRecord[]).map((entry) => [
    entry.species,
    pokemonProfileSpriteUrl(entry.slug),
  ]),
)

const spriteVisualBoundsBySpecies = new Map(
  (spriteManifest as SpriteManifestRecord[]).map((entry) => [
    entry.species,
    toSpriteVisualBounds(entry.visual_bounds),
  ]),
)

const backSpriteVisualBoundsBySpecies = new Map(
  (backSpriteManifest as BackSpriteManifestRecord[]).map((entry) => [
    entry.species,
    toSpriteVisualBounds(entry.visual_bounds),
  ]),
)

const resetDerivedPokedexCaches = (): void => {
  recordsCache = null
  entriesCache = null
  entryBySlugCache = null
  summariesCache = null
  searchEntriesCache = null
}

export const resetPokedexRepositoryCaches = (): void => {
  baseRecordsCache = null
  overrideRecordsCache = null
  resetDerivedPokedexCaches()
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

const readBasePokedexRecordsFromDisk = (): PokedexRecord[] => {
  if (!existsSync(POKEDEX_REFERENCE_PATH)) return []

  const parsed = JSON.parse(readFileSync(POKEDEX_REFERENCE_PATH, 'utf8'))
  return Array.isArray(parsed) ? parsed as PokedexRecord[] : []
}

const getBasePokedexRecords = (): PokedexRecord[] => {
  baseRecordsCache ??= readBasePokedexRecordsFromDisk()
  return baseRecordsCache
}

const entrySlug = (entry: Pick<PokedexRecord, 'species'>): string => toPokedexSlug(entry.species)

const normalizedOverrideKey = (value: string): string | null => {
  const slug = toPokedexSlug(value)
  return slug || null
}

const readPokedexOverridesFromDisk = (): PokedexReferenceOverrides => {
  const parsed = tryReadJsonFile<PokedexReferenceOverridesFile | Record<string, unknown>>(
    CAMPAIGN_POKEDEX_OVERRIDES_PATH,
  )
  if (!isRecord(parsed)) return {}

  const rawEntries = isRecord(parsed.entries) ? parsed.entries : parsed
  const overrides: PokedexReferenceOverrides = {}

  for (const [rawKey, rawEntry] of Object.entries(rawEntries)) {
    const key = normalizedOverrideKey(rawKey)
    if (!key || !isRecord(rawEntry)) continue

    const entry = toEditablePokedexRecord(rawEntry)
    if (!entry) continue
    overrides[key] = entry
  }

  return overrides
}

const getPokedexOverrides = (): PokedexReferenceOverrides => {
  overrideRecordsCache ??= readPokedexOverridesFromDisk()
  return overrideRecordsCache
}

const sortPokedexOverrides = (
  overrides: PokedexReferenceOverrides,
): PokedexReferenceOverrides => Object.fromEntries(
  Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)),
)

const replacePokedexOverrides = (overrides: PokedexReferenceOverrides): void => {
  const persistedOverrides = sortPokedexOverrides(overrides)
  writeJsonFile(CAMPAIGN_POKEDEX_OVERRIDES_PATH, {
    version: POKEDEX_OVERRIDE_FILE_VERSION,
    entries: persistedOverrides,
  })
  overrideRecordsCache = persistedOverrides
  resetDerivedPokedexCaches()
}

const applyPokedexOverrides = (
  records: PokedexRecord[],
  overrides: PokedexReferenceOverrides,
): PokedexRecord[] => records.map((record) => overrides[entrySlug(record)] ?? record)

const getPokedexRecords = (): PokedexRecord[] => {
  recordsCache ??= applyPokedexOverrides(getBasePokedexRecords(), getPokedexOverrides())
  return recordsCache
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
  profileSpriteUrl: profileSpriteUrlBySpecies.get(entry.species) ?? null,
  spriteVisualBounds: spriteVisualBoundsBySpecies.get(entry.species),
  backSpriteVisualBounds: backSpriteVisualBoundsBySpecies.get(entry.species),
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

const findPokedexRecordIndexBySlug = (slug: string): number => (
  getPokedexRecords().findIndex((entry) => entrySlug(entry) === slug)
)

const toStableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(toStableJsonValue)
  if (!isRecord(value)) return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, toStableJsonValue(child)]),
  )
}

const recordsAreEqual = (
  a: PokedexRecord,
  b: PokedexRecord,
): boolean => (
  JSON.stringify(toStableJsonValue(a)) === JSON.stringify(toStableJsonValue(b))
)

export const replacePokedexEntryBySlug = (
  slug: string,
  entry: PokedexRecord,
): { entry: PokedexEntryDetail; path: string } | null => {
  const records = getPokedexRecords()
  const baseRecords = getBasePokedexRecords()
  const index = findPokedexRecordIndexBySlug(slug)
  if (index < 0) return null

  const baseRecord = baseRecords[index]
  if (!baseRecord) return null

  const persisted = toEditablePokedexRecord(entry as Record<string, unknown>)
  if (!persisted) return null

  const nextSlug = entrySlug(persisted)
  const conflictingIndex = records.findIndex((candidate, candidateIndex) => (
    candidateIndex !== index && entrySlug(candidate) === nextSlug
  ))
  if (conflictingIndex >= 0) {
    throw new PokedexEntryConflictError(`Pokédex entry slug already exists: ${nextSlug}`)
  }

  const overrideKey = entrySlug(baseRecord)
  const nextOverrides = { ...getPokedexOverrides() }
  if (recordsAreEqual(persisted, baseRecord)) {
    delete nextOverrides[overrideKey]
  } else {
    nextOverrides[overrideKey] = persisted
  }
  replacePokedexOverrides(nextOverrides)

  const updatedEntry = getPokedexEntryBySlug().get(nextSlug)
  return updatedEntry
    ? { entry: toDetailResponse(updatedEntry), path: campaignPathLabel(CAMPAIGN_POKEDEX_OVERRIDES_PATH) }
    : null
}
