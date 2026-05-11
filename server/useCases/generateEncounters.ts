import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath, resolve as resolvePath } from 'node:path'
import {
  EncounterGenerationInputError,
  readEncounterGenerateRequest,
  rollEncounterTable,
  safeEncounterTablePath,
  type GenerateEncounterBody,
} from '../utils/encounterGeneration'
import {
  createEncounterOutputPlan,
  type UniqueEncounterOutputDir,
} from '../utils/encounterOutput'
import {
  runPokegenForRolledEncounters,
  type EncounterGeneratedFileResult,
} from '../utils/pokegenBatch'
import { runPokegenScript, type RunPokegen } from '../utils/pokegenRunner'
import type { EncounterTable, RolledEncounter } from '~/types/encounterTable'

export type { EncounterGeneratedFileResult } from '../utils/pokegenBatch'
export type { PokegenRunResult, RunPokegen } from '../utils/pokegenRunner'

export class GenerateEncountersUseCaseError extends UseCaseHttpError<number> {}

export interface GenerateEncountersResult {
  ok: true
  dir: string
  relDir: string
  rolled: RolledEncounter[]
  files: EncounterGeneratedFileResult[]
  failures: number
  preview: boolean
  beforeCount: number
}

export interface GenerateEncountersDependencies {
  projectRoot?: string
  encounterRoot?: string
  pokegenScript?: string
  now?: () => number
  random?: () => number
  pathExists?: (path: string) => boolean
  readTextFile?: (path: string) => string
  listDirectory?: (path: string) => string[]
  ensureDirectory?: (path: string) => void
  makeTempDir?: (prefix: string) => string
  cleanupDirectory?: (path: string) => void
  uniqueOutputDir?: UniqueEncounterOutputDir
  runPokegen?: RunPokegen
}

const DEFAULT_PROJECT_ROOT = resolvePath(process.cwd())

const isStatusLikeError = (error: unknown): error is {
  statusCode?: unknown
  statusMessage?: unknown
  message?: unknown
} => typeof error === 'object' && error !== null

export const normalizeGenerateEncountersError = (error: unknown): unknown => {
  if (error instanceof GenerateEncountersUseCaseError) return error
  if (error instanceof EncounterGenerationInputError) {
    return new GenerateEncountersUseCaseError(error.statusCode, error.message)
  }
  if (isStatusLikeError(error) && typeof error.statusCode === 'number') {
    return new GenerateEncountersUseCaseError(
      error.statusCode,
      String(error.statusMessage ?? error.message ?? 'Encounter generation failed'),
    )
  }
  return error
}

export const readEncounterTableFile = (
  region: string,
  tableKey: string,
  dependencies: Pick<
    Required<GenerateEncountersDependencies>,
    'encounterRoot' | 'pathExists' | 'readTextFile'
  >,
): EncounterTable => {
  const tablePath = safeEncounterTablePath(dependencies.encounterRoot, region, tableKey)
  if (!dependencies.pathExists(tablePath)) {
    throw new GenerateEncountersUseCaseError(404, `Table ${region}/${tableKey} not found`)
  }
  return JSON.parse(dependencies.readTextFile(tablePath)) as EncounterTable
}

export const generateEncountersUseCase = async (
  body: GenerateEncounterBody | null | undefined,
  dependencies: GenerateEncountersDependencies = {},
): Promise<GenerateEncountersResult> => {
  const projectRoot = dependencies.projectRoot ?? DEFAULT_PROJECT_ROOT
  const encounterRoot = dependencies.encounterRoot ?? resolvePath(projectRoot, 'encounter_tables')
  const now = dependencies.now ?? Date.now
  const random = dependencies.random ?? Math.random
  const pathExists = dependencies.pathExists ?? existsSync
  const readTextFile = dependencies.readTextFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const listDirectory = dependencies.listDirectory ?? readdirSync
  const ensureDirectory = dependencies.ensureDirectory ?? ((path: string) => mkdirSync(path, { recursive: true }))
  const makeTempDir = dependencies.makeTempDir ?? ((prefix: string) => mkdtempSync(joinPath(tmpdir(), prefix)))
  const cleanupDirectory = dependencies.cleanupDirectory ?? ((path: string) => rmSync(path, { recursive: true, force: true }))
  const runPokegen = dependencies.runPokegen
    ?? ((species: string, level: number, outputDir: string, slugPrefix: string) =>
      runPokegenScript(species, level, outputDir, slugPrefix, {
        projectRoot,
        pokegenScript: dependencies.pokegenScript,
      }))

  let cleanupDir: string | null = null

  try {
    const request = readEncounterGenerateRequest(body)
    const table = readEncounterTableFile(request.region, request.tableKey, {
      encounterRoot,
      pathExists,
      readTextFile,
    })
    const rolled = Array.from({ length: request.count }, () => rollEncounterTable(table, random))
    const output = createEncounterOutputPlan(request, {
      projectRoot,
      pathExists,
      ensureDirectory,
      makeTempDir,
      now,
      ...(dependencies.uniqueOutputDir ? { uniqueOutputDir: dependencies.uniqueOutputDir } : {}),
    })
    const dir = output.dir
    if (output.cleanup) cleanupDir = dir

    const batch = await runPokegenForRolledEncounters({
      rolled,
      dir,
      slugPrefix: output.slugPrefix,
      preview: request.preview,
      pathExists,
      listDirectory,
      readTextFile,
      runPokegen,
    })

    return {
      ok: true,
      dir: output.responseDir,
      relDir: output.responseRelDir,
      rolled,
      files: batch.files,
      failures: batch.failures,
      preview: request.preview,
      beforeCount: batch.beforeCount,
    }
  } catch (error) {
    throw normalizeGenerateEncountersError(error)
  } finally {
    if (cleanupDir) {
      try {
        cleanupDirectory(cleanupDir)
      } catch {
        /* best-effort preview cleanup */
      }
    }
  }
}
