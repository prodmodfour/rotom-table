import { basename, extname, resolve as resolvePath } from 'node:path'
import { validateSlug } from '#shared/paths'
import { SETUP_MODE_REQUIRED_FOR_MAP_SAVE_MESSAGE, MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { AppendRealtimeEventInput, RealtimeEventRepository } from '../storage/realtimeEventRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { placementsToSpawned, type SheetLookup } from '~/utils/placement'
import { catalogEntryForPokemonSheet, pokemonHpSnapshot } from '~/utils/sheetSpawn'
import { deepCloneJson } from '~/utils/serialization'
import { DEFAULT_TOKEN_FACING_DIRECTION } from '~/utils/tokenFacing'
import { findEncounterSpawnPosition } from '~/utils/encounterSpawnPlacement'
import type { PositionedGridFootprint } from '~/utils/gridGeometry'
import { normalizeMapGroundLevelY } from '../utils/mapNormalization'
import {
  DEFAULT_ENCOUNTER_GENERATE_OUT_ROOT,
  EncounterGenerationInputError,
  assertEncounterPathInsideRoot,
  randomEncounterGenerateCount,
  readEncounterGenerateRequest,
  rollEncounterTable,
  sanitizeEncounterOutRoot,
  uniqueEncounterOutputDir,
  type GenerateEncounterBody,
} from '../utils/encounterGeneration'
import { encounterOutputSlugPrefix } from '../utils/encounterOutput'
import { readEncounterTableFile } from '../utils/encounterTableFiles'
import {
  resolveGenerateEncountersRuntime,
  type GenerateEncountersRuntime,
  type GenerateEncountersRuntimeOverrides,
} from '../utils/generateEncountersRuntime'
import { decorateGeneratedPokemonSheet } from '../utils/pokegenBatch'
import { normalizeGenerateEncountersError, type GenerateEncountersResult } from './generateEncounters'
import { normalizeLoadMapSlug } from './loadMap'
import { createPlacementId as defaultCreatePlacementId } from '~/utils/placement'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import {
  createSqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
  type StoredSheetDocument,
} from '../storage/sheetRepository'
import {
  createSqliteMapInteractionModeRepository,
  type MapInteractionModeRepository,
} from '../storage/mapInteractionModeRepository'
import { createSqliteRealtimeEventRepository } from '../storage/realtimeEventRepository'
import { livePlayMapWriteQueue, type MapWriteQueue } from '../livePlay/mapWriteQueue'
import { setupMapSaveRealtimeAppendInputs, setupSheetSaveRealtimeAppendInputs } from '../realtime/setupDocumentRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import { runtimeSheetNameSlug } from '../utils/sheetDocuments'

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
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

type SpawnMapRepository = Pick<MapRepository<TabletopMap>, 'getBySlug' | 'replaceSetupMap'> & {
  readonly database?: RotomDatabase
}

type SpawnSheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'list' | 'listFolders' | 'getByRef' | 'saveSetupSheet'> & {
  readonly database?: RotomDatabase
}

type SpawnModeRepository = Pick<MapInteractionModeRepository, 'get'> & {
  readonly database?: RotomDatabase
}

type SpawnRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface SpawnGeneratedEncountersDependencies extends GenerateEncountersRuntimeOverrides {
  database?: RotomDatabase
  mapRepository?: SpawnMapRepository
  sheetRepository?: SpawnSheetRepository
  mapInteractionModeRepository?: SpawnModeRepository
  realtimeEventRepository?: SpawnRealtimeEventRepository
  queue?: MapWriteQueue
  createPlacementId?: () => string
  publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
}

const GENERATED_SHEET_ROOT = 'data/sheets'
const MAX_SLUG_ALLOCATION_ATTEMPTS = 10000

interface GeneratedSheetRecord {
  file: string
  slug: string
  sheet?: CharacterSheet
  error?: string
}

interface SpawnGenerationPlan extends GenerateEncountersResult {
  readonly generatedSheets: readonly GeneratedSheetRecord[]
}

interface PreparedGeneratedSheet {
  readonly file: string
  readonly sourceSlug: string
  readonly slug: string
  readonly sheet: CharacterSheet
}

interface EncounterPersistenceResult {
  readonly relDir: string
  readonly dir: string
  readonly mapPath?: string
  readonly map: TabletopMap
  readonly placements: SpawnGeneratedEncounterPlacement[]
  readonly realtimeEvents: readonly PersistedRealtimeEvent[]
}

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

const relDirFromOutputFolder = (folder: string): string => folder ? `${GENERATED_SHEET_ROOT}/${folder}` : GENERATED_SHEET_ROOT

const fileSlug = (fileName: string): string => {
  const ext = extname(fileName)
  return basename(fileName, ext || undefined)
}

const encounterLabel = (species: string, level: number): string => `${species} Lv ${level}`

const parseGeneratedPokemonSheet = (content: string): CharacterSheet => {
  const parsed = JSON.parse(content) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('generated sheet JSON must be an object')
  }
  return parsed as CharacterSheet
}

const generatedSheetCatalogError = (sheet: CharacterSheet): string | null => {
  if (!catalogEntryForPokemonSheet(sheet)) return `No Pokémon catalog entry for ${sheet.species || sheet.slug}`
  return null
}

const sheetMap = <TSheet extends { slug: string }>(sheets: Iterable<TSheet>): Map<string, TSheet> => {
  const map = new Map<string, TSheet>()
  for (const sheet of sheets) map.set(sheet.slug, sheet)
  return map
}

const storedPokemonSheet = (stored: StoredSheetDocument<Record<string, unknown>>): CharacterSheet => ({
  ...(stored.document as Record<string, unknown>),
  slug: stored.slug,
  revision: stored.revision,
  folder: typeof (stored.document as Record<string, unknown>).folder === 'string'
    ? (stored.document as Record<string, unknown>).folder as string
    : '',
} as CharacterSheet)

const storedTrainerSheet = (stored: StoredSheetDocument<Record<string, unknown>>): TrainerSheet => ({
  ...(stored.document as Record<string, unknown>),
  slug: stored.slug,
  revision: stored.revision,
  folder: typeof (stored.document as Record<string, unknown>).folder === 'string'
    ? (stored.document as Record<string, unknown>).folder as string
    : '',
} as TrainerSheet)

const buildAuthoritativeSheetLookup = (sheetRepository: SpawnSheetRepository): SheetLookup => ({
  pokemon: sheetMap(sheetRepository.list('pokemon').map(storedPokemonSheet)),
  trainer: sheetMap(sheetRepository.list('trainer').map(storedTrainerSheet)),
})

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
  const placementIds = new Set((map.placements ?? []).map((placement) => placement.id))
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

    const placementId = createPlacementId()
    if (!placementId || placementIds.has(placementId)) {
      results.push({ file: generated.file, slug: generated.slug, error: 'Duplicate placement id generated' })
      continue
    }
    placementIds.add(placementId)

    const placement: SheetPlacement = {
      id: placementId,
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

const databaseFromDependencies = (dependencies: SpawnGeneratedEncountersDependencies): RotomDatabase => {
  const mapDatabase = dependencies.mapRepository?.database
  const sheetDatabase = dependencies.sheetRepository?.database
  const modeDatabase = dependencies.mapInteractionModeRepository?.database
  const realtimeDatabase = dependencies.realtimeEventRepository?.database
  const database = dependencies.database ?? mapDatabase ?? sheetDatabase ?? modeDatabase ?? realtimeDatabase ?? getRotomDatabase()
  const expected = [
    ['map repository', mapDatabase],
    ['sheet repository', sheetDatabase],
    ['map interaction mode repository', modeDatabase],
    ['realtime event repository', realtimeDatabase],
  ] as const
  for (const [label, repositoryDatabase] of expected) {
    if (repositoryDatabase && repositoryDatabase !== database) {
      throw new Error(`Encounter spawn ${label} must use the same RotomDatabase as the transaction`)
    }
  }
  return database
}

const createSpawnOutputPlan = (
  request: ReturnType<typeof readEncounterGenerateRequest>,
  count: number,
  runtime: GenerateEncountersRuntime,
): { readonly dir: string; readonly relDir: string; readonly slugPrefix: string } => {
  const parent = resolvePath(runtime.projectRoot, request.outRoot)
  assertEncounterPathInsideRoot(runtime.projectRoot, parent)
  const dir = (runtime.uniqueOutputDir ?? uniqueEncounterOutputDir)(
    parent,
    `${request.tableKey}_${count}`,
    runtime.pathExists,
  )
  const relDir = dir.slice(runtime.projectRoot.length + 1)
  return {
    dir,
    relDir,
    slugPrefix: encounterOutputSlugPrefix(runtime.projectRoot, dir, request.tableKey, false, runtime.now),
  }
}

const generateEncounterSheetsInMemory = async (
  body: SpawnEncounterBody | null | undefined,
  runtime: GenerateEncountersRuntime,
): Promise<SpawnGenerationPlan> => {
  const request = readEncounterGenerateRequest(body)
  const table = readEncounterTableFile(request.region, request.tableKey, {
    encounterRoot: runtime.encounterRoot,
    pathExists: runtime.pathExists,
    readTextFile: runtime.readTextFile,
  })
  const count = randomEncounterGenerateCount(request.countRange, runtime.random)
  const rolled = Array.from({ length: count }, () => rollEncounterTable(table, runtime.random))
    .filter((encounter): encounter is NonNullable<typeof encounter> => Boolean(encounter))
  const output = createSpawnOutputPlan(request, count, runtime)
  const files = [] as GenerateEncountersResult['files']
  const generatedSheets: GeneratedSheetRecord[] = []
  let failures = 0

  for (const [index, encounter] of rolled.entries()) {
    const run = await runtime.runPokegenSheet(encounter.species, encounter.level, output.slugPrefix, index + 1)
    if (!run.ok || !run.content) {
      failures += 1
      files.push({
        name: encounterLabel(encounter.species, encounter.level),
        error: run.stderr.trim() || 'pokegen failed',
      })
      continue
    }

    try {
      const sheet = decorateGeneratedPokemonSheet(parseGeneratedPokemonSheet(run.content), runtime.random)
      const name = run.fileName ?? `${String(sheet.slug || encounterLabel(encounter.species, encounter.level))}.json`
      files.push({ name })
      generatedSheets.push({
        file: name,
        slug: String(sheet.slug || fileSlug(name)),
        sheet,
      })
    } catch (error) {
      failures += 1
      const name = run.fileName ?? encounterLabel(encounter.species, encounter.level)
      files.push({ name, error: (error as Error).message || 'Could not decorate generated sheet' })
      generatedSheets.push({
        file: name,
        slug: fileSlug(name),
        error: (error as Error).message || 'Could not decorate generated sheet',
      })
    }
  }

  return {
    ok: true,
    dir: output.dir,
    relDir: output.relDir,
    rolled,
    files,
    failures,
    preview: false,
    beforeCount: 0,
    count,
    generatedSheets,
  }
}

const slugExists = (
  sheetRepository: SpawnSheetRepository,
  reserved: ReadonlySet<string>,
  slug: string,
): boolean => reserved.has(slug) || sheetRepository.getByRef('pokemon', slug) !== null

const allocatePokemonSlug = (
  sheetRepository: SpawnSheetRepository,
  reserved: ReadonlySet<string>,
  baseInput: string,
): string => {
  const root = runtimeSheetNameSlug(baseInput) || 'new-pokemon'
  if (!slugExists(sheetRepository, reserved, root)) return validateSlug(root, 'generated sheet slug')
  for (let index = 1; index < MAX_SLUG_ALLOCATION_ATTEMPTS; index += 1) {
    const candidate = `${root}-${index}`
    if (!slugExists(sheetRepository, reserved, candidate)) return validateSlug(candidate, 'generated sheet slug')
  }
  throw new Error('Could not allocate a free generated sheet slug')
}

const allocateEncounterFolder = (
  desiredFolder: string,
  existingFolders: readonly string[],
): string => {
  if (!desiredFolder) return ''
  const existing = new Set(existingFolders)
  if (!existing.has(desiredFolder)) return desiredFolder
  for (let index = 2; index < MAX_SLUG_ALLOCATION_ATTEMPTS; index += 1) {
    const candidate = `${desiredFolder}-${index}`
    if (!existing.has(candidate)) return candidate
  }
  throw new Error('Could not allocate a free encounter folder')
}

const prepareGeneratedSheets = ({
  generatedSheets,
  sheetRepository,
  folder,
  timestamp,
}: {
  generatedSheets: readonly GeneratedSheetRecord[]
  sheetRepository: SpawnSheetRepository
  folder: string
  timestamp: number
}): readonly PreparedGeneratedSheet[] => {
  const reserved = new Set<string>()
  const prepared: PreparedGeneratedSheet[] = []
  for (const generated of generatedSheets) {
    if (!generated.sheet) continue
    const sourceSlug = String(generated.sheet.slug || generated.slug || fileSlug(generated.file))
    const slug = allocatePokemonSlug(sheetRepository, reserved, sourceSlug)
    reserved.add(slug)
    prepared.push({
      file: generated.file,
      sourceSlug,
      slug,
      sheet: {
        ...(deepCloneJson(generated.sheet) as CharacterSheet),
        slug,
        folder,
        revision: 0,
        updatedAt: timestamp,
      } as unknown as CharacterSheet,
    })
  }
  return prepared
}

const generatedRecordsForPlacement = (
  generatedSheets: readonly GeneratedSheetRecord[],
  preparedSheets: readonly PreparedGeneratedSheet[],
): readonly GeneratedSheetRecord[] => {
  const preparedBySource = new Map<string, PreparedGeneratedSheet[]>()
  for (const prepared of preparedSheets) {
    const entries = preparedBySource.get(prepared.sourceSlug) ?? []
    entries.push(prepared)
    preparedBySource.set(prepared.sourceSlug, entries)
  }

  return generatedSheets.map((generated) => {
    if (!generated.sheet) return generated
    const sourceSlug = String(generated.sheet.slug || generated.slug || fileSlug(generated.file))
    const entries = preparedBySource.get(sourceSlug) ?? []
    const prepared = entries.shift()
    if (!prepared) return generated
    return {
      file: generated.file,
      slug: prepared.slug,
      sheet: prepared.sheet,
    }
  })
}

const timestampAppendInputs = (
  inputs: readonly AppendRealtimeEventInput[],
  timestamp: number,
): readonly AppendRealtimeEventInput[] => inputs.map((input) => ({ ...input, timestamp }))

const sheetAppendInputs = (
  sheet: PersistedSheet,
  clientId: string | undefined,
  timestamp: number,
): readonly AppendRealtimeEventInput[] => timestampAppendInputs(setupSheetSaveRealtimeAppendInputs({
  kind: 'pokemon',
  slug: sheet.slug,
  sheet: sheet.sheet,
  clientId,
}), timestamp)

const mapAppendInputs = (
  map: TabletopMap,
  clientId: string | undefined,
  timestamp: number,
): readonly AppendRealtimeEventInput[] => timestampAppendInputs(setupMapSaveRealtimeAppendInputs(deepCloneJson(map), clientId), timestamp)

const persistEncounterSpawn = ({
  mapSlug,
  clientId,
  generation,
  dependencies,
  database,
  mapRepository,
  sheetRepository,
  modeRepository,
  realtimeEventRepository,
  timestamp,
}: {
  mapSlug: string
  clientId?: string
  generation: SpawnGenerationPlan
  dependencies: SpawnGeneratedEncountersDependencies
  database: RotomDatabase
  mapRepository: SpawnMapRepository
  sheetRepository: SpawnSheetRepository
  modeRepository: SpawnModeRepository
  realtimeEventRepository: SpawnRealtimeEventRepository
  timestamp: number
}): EncounterPersistenceResult => database.withTransaction(() => {
  const currentMap = mapRepository.getBySlug(mapSlug)
  if (!currentMap) throw new SpawnGeneratedEncountersUseCaseError(404, `Map ${mapSlug}.json not found`)
  const mode = modeRepository.get(mapSlug).interactionMode
  if (mode !== MAP_INTERACTION_MODES.SETUP_EDIT) {
    throw new SpawnGeneratedEncountersUseCaseError(409, SETUP_MODE_REQUIRED_FOR_MAP_SAVE_MESSAGE)
  }

  const desiredFolder = outputFolderFromRelDir(generation.relDir)
  const folder = allocateEncounterFolder(desiredFolder, sheetRepository.listFolders('pokemon'))
  const relDir = relDirFromOutputFolder(folder)
  const dir = generation.dir.endsWith(generation.relDir)
    ? `${generation.dir.slice(0, -generation.relDir.length)}${relDir}`
    : generation.dir
  const preparedSheets = prepareGeneratedSheets({
    generatedSheets: generation.generatedSheets,
    sheetRepository,
    folder,
    timestamp,
  })
  const lookup = buildAuthoritativeSheetLookup(sheetRepository)
  for (const prepared of preparedSheets) lookup.pokemon.set(prepared.slug, prepared.sheet)

  const nextMap = deepCloneJson(currentMap)
  nextMap.placements = Array.isArray(nextMap.placements) ? [...nextMap.placements] : []
  const placementRecords = generatedRecordsForPlacement(generation.generatedSheets, preparedSheets)
  const placements = appendPlacementsForGeneratedSheets({
    map: nextMap,
    generatedSheets: placementRecords,
    lookup,
    random: dependencies.random ?? Math.random,
    createPlacementId: dependencies.createPlacementId ?? defaultCreatePlacementId,
  })
  const spawned = placements.filter((placement) => !placement.error)

  let authoritativeMap = currentMap
  let mapChanged = false
  if (spawned.length > 0) {
    const savedMap = mapRepository.replaceSetupMap({
      slug: mapSlug,
      expectedRevision: currentMap.revision ?? 0,
      map: nextMap,
      now: timestamp,
    })
    if (!savedMap) throw new SpawnGeneratedEncountersUseCaseError(404, `Map ${mapSlug}.json not found`)
    if (!savedMap.changed) throw new Error(`Map ${mapSlug} placements did not change during encounter spawn`)
    const rereadMap = mapRepository.getBySlug(mapSlug)
    if (!rereadMap) throw new SpawnGeneratedEncountersUseCaseError(404, `Map ${mapSlug}.json not found`)
    if (rereadMap.revision !== savedMap.map.revision || rereadMap.updatedAt !== savedMap.map.updatedAt) {
      throw new Error(`Map ${mapSlug} authoritative re-read did not match encounter spawn update`)
    }
    authoritativeMap = rereadMap
    mapChanged = true
  }

  const persistedSheets: PersistedSheet[] = []
  for (const prepared of preparedSheets) {
    if (sheetRepository.getByRef('pokemon', prepared.slug)) {
      throw new Error(`Generated Pokémon sheet ${prepared.slug} already exists`)
    }
    const persisted = sheetRepository.saveSetupSheet('pokemon', prepared.slug, prepared.sheet as unknown as Record<string, unknown>)
    if (persisted.revision !== 0 || persisted.sheet.slug !== prepared.slug) {
      throw new Error(`Generated Pokémon sheet ${prepared.slug} was not persisted with its initial identity`)
    }
    persistedSheets.push(persisted)
  }

  const appendInputs: AppendRealtimeEventInput[] = []
  for (const sheet of persistedSheets) appendInputs.push(...sheetAppendInputs(sheet, clientId, timestamp))
  if (mapChanged) appendInputs.push(...mapAppendInputs(authoritativeMap, clientId, timestamp))
  const realtimeEvents = realtimeEventRepository.appendMany(appendInputs)

  // Product behavior: generated sheets that cannot be placed still remain in
  // the allocated encounter folder, but no map revision is advanced for them.
  return {
    relDir,
    dir,
    ...(mapChanged ? { mapPath: logicalMapResourcePath(authoritativeMap) } : {}),
    map: authoritativeMap,
    placements,
    realtimeEvents,
  }
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

    const runtime = resolveGenerateEncountersRuntime(dependencies)
    const generation = await generateEncounterSheetsInMemory(body, runtime)

    const database = databaseFromDependencies(dependencies)
    const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database)
    const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database, mapRepository as unknown as MapRepository)
    const modeRepository = dependencies.mapInteractionModeRepository ?? createSqliteMapInteractionModeRepository(database)
    const realtimeEventRepository = dependencies.realtimeEventRepository ?? createSqliteRealtimeEventRepository({ database })
    const queue = dependencies.queue ?? livePlayMapWriteQueue
    const now = dependencies.now ?? Date.now

    const persistence = await queue.withMapWriteQueue(mapSlug, () => persistEncounterSpawn({
      mapSlug,
      clientId,
      generation,
      dependencies,
      database,
      mapRepository,
      sheetRepository,
      modeRepository,
      realtimeEventRepository,
      timestamp: now(),
    }))

    publishPersistedRealtimeEventsAfterCommit({
      events: persistence.realtimeEvents,
      operation: 'encounter-spawn',
      publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
      reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
    })

    const spawned = persistence.placements.filter((placement) => !placement.error)
    const spawnFailures = persistence.placements.length - spawned.length
    const { generatedSheets: _generatedSheets, ...generationResult } = generation

    return {
      ...generationResult,
      dir: persistence.dir,
      relDir: persistence.relDir,
      spawn: {
        mapSlug,
        mapName: persistence.map.name,
        spawned: spawned.length,
        failures: spawnFailures,
        placements: persistence.placements,
      },
      ...(persistence.mapPath ? { mapPath: persistence.mapPath } : {}),
      realtimeEvents: persistence.realtimeEvents,
    }
  } catch (error) {
    throw normalizeSpawnGeneratedEncountersError(error)
  }
}
