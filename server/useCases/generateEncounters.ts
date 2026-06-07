import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  EncounterGenerationInputError,
  randomEncounterGenerateCount,
  readEncounterGenerateRequest,
  rollEncounterTable,
  type GenerateEncounterBody,
} from '../utils/encounterGeneration'
import { createEncounterOutputPlan } from '../utils/encounterOutput'
import { readEncounterTableFile } from '../utils/encounterTableFiles'
import {
  runPokegenForRolledEncounters,
  type EncounterGeneratedFileResult,
} from '../utils/pokegenBatch'
import {
  resolveGenerateEncountersRuntime,
  type GenerateEncountersRuntimeOverrides,
} from '../utils/generateEncountersRuntime'
import type { RolledEncounter } from '~/types/encounterTable'

export { readEncounterTableFile } from '../utils/encounterTableFiles'
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
  count: number
}

export type GenerateEncountersDependencies = GenerateEncountersRuntimeOverrides

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

export const generateEncountersUseCase = async (
  body: GenerateEncounterBody | null | undefined,
  dependencies: GenerateEncountersDependencies = {},
): Promise<GenerateEncountersResult> => {
  const runtime = resolveGenerateEncountersRuntime(dependencies)

  let cleanupDir: string | null = null

  try {
    const request = readEncounterGenerateRequest(body)
    const table = readEncounterTableFile(request.region, request.tableKey, {
      encounterRoot: runtime.encounterRoot,
      pathExists: runtime.pathExists,
      readTextFile: runtime.readTextFile,
    })
    const count = randomEncounterGenerateCount(request.countRange, runtime.random)
    const rolled = Array.from({ length: count }, () => rollEncounterTable(table, runtime.random))
      .filter((encounter): encounter is RolledEncounter => Boolean(encounter))
    const output = createEncounterOutputPlan({
      tableKey: request.tableKey,
      count,
      outRoot: request.outRoot,
      preview: request.preview,
    }, {
      projectRoot: runtime.projectRoot,
      pathExists: runtime.pathExists,
      ensureDirectory: runtime.ensureDirectory,
      makeTempDir: runtime.makeTempDir,
      now: runtime.now,
      ...(runtime.uniqueOutputDir ? { uniqueOutputDir: runtime.uniqueOutputDir } : {}),
    })
    const dir = output.dir
    if (output.cleanup) cleanupDir = dir

    const batch = await runPokegenForRolledEncounters({
      rolled,
      dir,
      slugPrefix: output.slugPrefix,
      preview: request.preview,
      pathExists: runtime.pathExists,
      listDirectory: runtime.listDirectory,
      readTextFile: runtime.readTextFile,
      runPokegen: runtime.runPokegen,
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
      count,
    }
  } catch (error) {
    throw normalizeGenerateEncountersError(error)
  } finally {
    if (cleanupDir) {
      try {
        runtime.cleanupDirectory(cleanupDir)
      } catch {
        /* best-effort preview cleanup */
      }
    }
  }
}
