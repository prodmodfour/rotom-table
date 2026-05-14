import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { RealtimeEvent } from '#shared/realtime'
import type { SheetKind } from '#shared/sheets'

export interface LiveSheetMaps {
  pokemonBySlug: Map<string, CharacterSheet>
  trainerBySlug: Map<string, TrainerSheet>
}

export interface LiveSheetListPayload {
  pokemonSheets: readonly CharacterSheet[]
  trainerSheets: readonly TrainerSheet[]
}

interface SheetRealtimePayload {
  kind?: SheetKind
  slug?: string
  oldSlug?: string
  newSlug?: string
  folder?: string
  sheet?: CharacterSheet | TrainerSheet
}

const isSheetKind = (value: unknown): value is SheetKind => value === 'pokemon' || value === 'trainer'

const normalizeSlug = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const replaceMapEntries = <TSheet extends { slug: string }>(
  map: Map<string, TSheet>,
  sheets: readonly TSheet[],
): void => {
  map.clear()
  for (const sheet of sheets) map.set(sheet.slug, sheet)
}

const withPreservedFolder = <TSheet extends { folder?: string }>(
  incoming: TSheet,
  previous: TSheet | undefined,
): TSheet => {
  if (incoming.folder !== undefined || previous?.folder === undefined) return incoming
  return { ...incoming, folder: previous.folder }
}

const updatePokemonSheet = (
  maps: LiveSheetMaps,
  slug: string,
  sheet: CharacterSheet,
  oldSlug?: string,
): void => {
  const previous = (oldSlug ? maps.pokemonBySlug.get(oldSlug) : undefined) ?? maps.pokemonBySlug.get(slug)
  if (oldSlug) maps.pokemonBySlug.delete(oldSlug)
  maps.pokemonBySlug.set(slug, withPreservedFolder(sheet, previous))
}

const updateTrainerSheet = (
  maps: LiveSheetMaps,
  slug: string,
  sheet: TrainerSheet,
  oldSlug?: string,
): void => {
  const previous = (oldSlug ? maps.trainerBySlug.get(oldSlug) : undefined) ?? maps.trainerBySlug.get(slug)
  if (oldSlug) maps.trainerBySlug.delete(oldSlug)
  maps.trainerBySlug.set(slug, withPreservedFolder(sheet, previous))
}

export const buildLiveSheetMaps = (
  pokemonSheets: readonly CharacterSheet[],
  trainerSheets: readonly TrainerSheet[],
): LiveSheetMaps => ({
  pokemonBySlug: new Map(pokemonSheets.map((sheet) => [sheet.slug, sheet])),
  trainerBySlug: new Map(trainerSheets.map((sheet) => [sheet.slug, sheet])),
})

export const replaceLiveSheetMaps = (
  maps: LiveSheetMaps,
  payload: LiveSheetListPayload,
): void => {
  replaceMapEntries(maps.pokemonBySlug, payload.pokemonSheets)
  replaceMapEntries(maps.trainerBySlug, payload.trainerSheets)
}

export const applyLiveSheetRealtimeEvent = (
  maps: LiveSheetMaps,
  event: Pick<RealtimeEvent, 'type' | 'data'>,
): boolean => {
  const payload = event.data as SheetRealtimePayload | undefined
  if (!payload || !isSheetKind(payload.kind)) return false

  const slug = normalizeSlug(payload.slug)

  if (event.type === 'deleted') {
    if (!slug) return false
    return payload.kind === 'pokemon'
      ? maps.pokemonBySlug.delete(slug)
      : maps.trainerBySlug.delete(slug)
  }

  if (event.type === 'moved') {
    if (!slug || typeof payload.folder !== 'string') return false
    if (payload.kind === 'pokemon') {
      const sheet = maps.pokemonBySlug.get(slug)
      if (!sheet || sheet.folder === payload.folder) return false
      maps.pokemonBySlug.set(slug, { ...sheet, folder: payload.folder })
      return true
    }

    const sheet = maps.trainerBySlug.get(slug)
    if (!sheet || sheet.folder === payload.folder) return false
    maps.trainerBySlug.set(slug, { ...sheet, folder: payload.folder })
    return true
  }

  if (event.type === 'renamed') {
    const newSlug = normalizeSlug(payload.newSlug ?? payload.slug)
    const oldSlug = normalizeSlug(payload.oldSlug)
    if (!newSlug || !payload.sheet) return false

    if (payload.kind === 'pokemon') {
      updatePokemonSheet(maps, newSlug, payload.sheet as CharacterSheet, oldSlug)
    } else {
      updateTrainerSheet(maps, newSlug, payload.sheet as TrainerSheet, oldSlug)
    }
    return true
  }

  if (event.type === 'created' || event.type === 'updated') {
    if (!slug || !payload.sheet) return false

    if (payload.kind === 'pokemon') {
      updatePokemonSheet(maps, slug, payload.sheet as CharacterSheet)
    } else {
      updateTrainerSheet(maps, slug, payload.sheet as TrainerSheet)
    }
    return true
  }

  return false
}
