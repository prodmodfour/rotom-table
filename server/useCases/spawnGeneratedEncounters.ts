import { basename, extname, join as joinPath } from 'node:path'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sheetsChannel, type RealtimeEvent } from '#shared/realtime'
import { placementsToSpawned, type SheetLookup } from '~/utils/placement'
import { catalogEntryForPokemonSheet, pokemonHpSnapshot } from '~/utils/sheetSpawn'
import { deepCloneJson } from '~/utils/serialization'
import { DEFAULT_TOKEN_FACING_DIRECTION } from '~/utils/tokenFacing'
import { findEncounterSpawnPosition } from '~/utils/encounterSpawnPlacement'
import type { PositionedGridFootprint } from '~/utils/gridGeometry'
import { normalizeMapGroundLevelY } from '../utils/mapNormalization'
import { readJsonFile } from '../utils/jsonFiles'
import { listSheetFilesWithFolders } from '../utils/sheetStorage'
import {
  DEFAULT_ENCOUNTER_GENERATE_OUT_ROOT,
  EncounterGenerationInputError,
  sanitizeEncounterOutRoot,
  type GenerateEncounterBody,
} from '../utils/encounterGeneration'
import {
  generateEncountersUseCase,
  normalizeGenerateEncountersError,
  type GenerateEncountersDependencies,
  type GenerateEncountersResult,
} from './generateEncounters'
import { normalizeLoadMapSlug, loadMapUseCase } from './loadMap'
import { saveMapUseCase, type SaveMapResult } from './saveMap'
import { createPlacementId as defaultCreatePlacementId } from '~/utils/placement'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

export class SpawnGeneratedEncountersUseCaseError extends UseCaseHttpError<number> {}

export interface SpawnEncounterBody extends GenerateEncounterBody {
  mapSlug?: unknown
  clientId?: unknown
}

export interface SpawnGeneratedEncounterPlacement {
  file: string
  slug: string
  placementId?: string
  position?: GridAnchor
  error?: string
}

export interface SpawnGeneratedEncounterSummary {
  mapSlug: string
  mapName: string
  spawned: number
  failures: number
  placements: SpawnGeneratedEncounterPlacement[]
}

export interface SpawnGeneratedEncountersResult extends GenerateEncountersResult {
  spawn: SpawnGeneratedEncounterSummary
  mapPath?: string
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

interface PersistedMapResult {
  path?: string
  map: TabletopMap
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

export interface SpawnGeneratedEncountersDependencies extends GenerateEncountersDependencies {
  loadMap?: (slug: string) => TabletopMap
  saveMap?: (slug: string, map: TabletopMap, clientId?: string) => PersistedMapResult
  listPokemonSheets?: () => Iterable<CharacterSheet>
  listTrainerSheets?: () => Iterable<TrainerSheet>
  readGeneratedPokemonSheet?: (dir: string, fileName: string) => CharacterSheet
  createPlacementId?: () => string
}

const GENERATED_SHEET_ROOT = 'data/sheets'

const assertSpawnOutputRoot = (outRoot: string): void => {
  const normalized = sanitizeEncounterOutRoot(outRoot)
  if (normalized !== GENERATED_SHEET_ROOT && !normalized.startsWith(`${GENERATED_SHEET_ROOT}/`)) {
    throw new SpawnGeneratedEncountersUseCaseError(
      400,
      'Spawn output root must be data/sheets or a subfolder of data/sheets',
    )
  }
}

const normalizeSpawnClientId = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined

const outputFolderFromRelDir = (relDir: string): string => relDir
  .replace(/^data\/sheets\/?/, '')
  .replace(/^\/+|\/+$/g, '')

const fileSlug = (fileName: string): string => {
  const ext = extname(fileName)
  return basename(fileName, ext || undefined)
}

const successfulJsonFiles = (result: GenerateEncountersResult): string[] => result.files
  .filter((file) => !file.error && file.name.toLowerCase().endsWith('.json'))
  .map((file) => file.name)

const defaultReadGeneratedPokemonSheet = (dir: string, fileName: string): CharacterSheet =>
  readJsonFile<CharacterSheet>(joinPath(dir, fileName))

const sheetMap = <TSheet extends { slug: string }>(sheets: Iterable<TSheet>): Map<string, TSheet> => {
  const map = new Map<string, TSheet>()
  for (const sheet of sheets) map.set(sheet.slug, sheet)
  return map
}

const buildSheetLookup = (dependencies: SpawnGeneratedEncountersDependencies): SheetLookup => ({
  pokemon: sheetMap(dependencies.listPokemonSheets?.() ?? listSheetFilesWithFolders<CharacterSheet>('pokemon')),
  trainer: sheetMap(dependencies.listTrainerSheets?.() ?? listSheetFilesWithFolders<TrainerSheet>('trainer')),
})

const sheetCreatedEvents = ({
  sheets,
  folder,
  clientId,
}: {
  sheets: readonly CharacterSheet[]
  folder: string
  clientId?: string
}): Array<Omit<RealtimeEvent, 'timestamp'>> => sheets.map((sheet) => ({
  channel: sheetsChannel,
  type: 'updated',
  clientId,
  data: {
    kind: 'pokemon',
    slug: sheet.slug,
    sheet: { ...sheet, folder },
  },
}))

interface GeneratedSheetRecord {
  file: string
  slug: string
  sheet?: CharacterSheet
  error?: string
}

const readGeneratedSheets = (
  result: GenerateEncountersResult,
  readGeneratedPokemonSheet: (dir: string, fileName: string) => CharacterSheet,
): GeneratedSheetRecord[] => successfulJsonFiles(result).map((file) => {
  try {
    const sheet = readGeneratedPokemonSheet(result.dir, file)
    return { file, slug: String(sheet.slug || fileSlug(file)), sheet }
  } catch (error) {
    return {
      file,
      slug: fileSlug(file),
      error: (error as Error).message || 'Could not read generated sheet',
    }
  }
})

const generatedSheetCatalogError = (sheet: CharacterSheet): string | null => {
  if (!catalogEntryForPokemonSheet(sheet)) return `No Pokémon catalog entry for ${sheet.species || sheet.slug}`
  return null
}

const appendPlacementsForGeneratedSheets = ({
  map,
  generatedSheets,
  lookup,
  random,
  createPlacementId,
}: {
  map: TabletopMap
  generatedSheets: readonly GeneratedSheetRecord[]
  lookup: SheetLookup
  random: () => number
  createPlacementId: () => string
}): SpawnGeneratedEncounterPlacement[] => {
  const placed: PositionedGridFootprint[] = placementsToSpawned(map, lookup)
    .map((pokemon) => ({
      id: pokemon.id,
      position: pokemon.position,
      base: pokemon.base,
      clearance: pokemon.clearance,
    }))
  const results: SpawnGeneratedEncounterPlacement[] = []
  const groundLevelY = normalizeMapGroundLevelY(map.groundLevelY, map.dimensions.y)

  for (const generated of generatedSheets) {
    if (!generated.sheet) {
      results.push({ file: generated.file, slug: generated.slug, error: generated.error ?? 'Could not read generated sheet' })
      continue
    }

    const catalogError = generatedSheetCatalogError(generated.sheet)
    if (catalogError) {
      results.push({ file: generated.file, slug: generated.slug, error: catalogError })
      continue
    }

    const catalog = catalogEntryForPokemonSheet(generated.sheet)!
    const hp = pokemonHpSnapshot(generated.sheet)
    const position = findEncounterSpawnPosition({
      candidate: {
        base: catalog.base,
        clearance: catalog.clearance,
        movementCapabilities: hp.movementCapabilities,
      },
      placed,
      dimensions: map.dimensions,
      voxels: map.voxels,
      groundLevelY,
      random,
    })

    if (!position) {
      results.push({ file: generated.file, slug: generated.slug, error: 'No sensible open map position found' })
      continue
    }

    const placement: SheetPlacement = {
      id: createPlacementId(),
      sheetKind: 'pokemon',
      sheetSlug: generated.sheet.slug,
      position,
      facing: DEFAULT_TOKEN_FACING_DIRECTION,
      turned: false,
    }
    map.placements.push(placement)
    placed.push({
      ...catalog,
      id: placement.id,
      position,
    })
    results.push({
      file: generated.file,
      slug: generated.sheet.slug,
      placementId: placement.id,
      position,
    })
  }

  return results
}

const defaultLoadMap = (slug: string): TabletopMap => loadMapUseCase({ role: 'gm', slug }).map

const defaultSaveMap = (slug: string, map: TabletopMap, clientId?: string): SaveMapResult => saveMapUseCase({
  role: 'gm',
  slug,
  map,
  clientId,
})

const normalizeSpawnGeneratedEncountersError = (error: unknown): unknown => {
  if (error instanceof SpawnGeneratedEncountersUseCaseError) return error
  if (error instanceof EncounterGenerationInputError) {
    return new SpawnGeneratedEncountersUseCaseError(error.statusCode, error.message)
  }
  const generatedError = normalizeGenerateEncountersError(error)
  if (generatedError !== error) return generatedError
  if (typeof error === 'object' && error !== null && typeof (error as { statusCode?: unknown }).statusCode === 'number') {
    return new SpawnGeneratedEncountersUseCaseError(
      (error as { statusCode: number }).statusCode,
      String((error as { message?: unknown; statusMessage?: unknown }).message ?? (error as { statusMessage?: unknown }).statusMessage ?? 'Encounter spawn failed'),
    )
  }
  return error
}

export const spawnGeneratedEncountersUseCase = async (
  body: SpawnEncounterBody | null | undefined,
  dependencies: SpawnGeneratedEncountersDependencies = {},
): Promise<SpawnGeneratedEncountersResult> => {
  try {
    const mapSlug = normalizeLoadMapSlug(body?.mapSlug)
    const clientId = normalizeSpawnClientId(body?.clientId)
    if (body?.preview) {
      throw new SpawnGeneratedEncountersUseCaseError(400, 'Spawn generation cannot be preview-only')
    }
    assertSpawnOutputRoot(String(body?.outRoot ?? DEFAULT_ENCOUNTER_GENERATE_OUT_ROOT))

    const loadMap = dependencies.loadMap ?? defaultLoadMap
    const saveMap = dependencies.saveMap ?? defaultSaveMap
    const map = deepCloneJson(loadMap(mapSlug))

    const generated = await generateEncountersUseCase({
      ...body,
      preview: false,
    }, dependencies)
    const readGeneratedPokemonSheet = dependencies.readGeneratedPokemonSheet ?? defaultReadGeneratedPokemonSheet
    const generatedSheets = readGeneratedSheets(generated, readGeneratedPokemonSheet)
    const readableSheets = generatedSheets
      .map((entry) => entry.sheet)
      .filter((sheet): sheet is CharacterSheet => Boolean(sheet))

    const lookup = buildSheetLookup(dependencies)
    for (const sheet of readableSheets) lookup.pokemon.set(sheet.slug, sheet)

    const placements = appendPlacementsForGeneratedSheets({
      map,
      generatedSheets,
      lookup,
      random: dependencies.random ?? Math.random,
      createPlacementId: dependencies.createPlacementId ?? defaultCreatePlacementId,
    })
    const spawned = placements.filter((placement) => !placement.error)
    const spawnFailures = placements.length - spawned.length
    const persisted = spawned.length > 0
      ? saveMap(mapSlug, map, clientId)
      : { map, events: [] }
    const folder = outputFolderFromRelDir(generated.relDir)

    return {
      ...generated,
      spawn: {
        mapSlug,
        mapName: persisted.map.name,
        spawned: spawned.length,
        failures: spawnFailures,
        placements,
      },
      ...(persisted.path ? { mapPath: persisted.path } : {}),
      events: [
        ...sheetCreatedEvents({ sheets: readableSheets, folder, clientId }),
        ...persisted.events,
      ],
    }
  } catch (error) {
    throw normalizeSpawnGeneratedEncountersError(error)
  }
}
