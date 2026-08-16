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
import type { TrainerSheet } from '~/types/trainerSheet'
import { strongestActiveRepel } from '../domain/itemAutomation/exploration'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../domain/itemAutomation/registry'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteSheetRepository } from '../storage/sheetRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'

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
  routeRepel: {
    readonly itemLabel: string
    readonly maximumAffectedWildLevel: number
    readonly expiresAtCampaignMinute: number
    readonly repelledRolls: number
  } | null
}

export interface GenerateEncountersDependencies extends GenerateEncountersRuntimeOverrides {
  readonly database?: RotomDatabase
}

type EncounterGenerateRequest = ReturnType<typeof readEncounterGenerateRequest>

const countForEncounterRequest = (
  request: EncounterGenerateRequest,
  random: () => number,
): number => {
  if (request.rolled === undefined) return randomEncounterGenerateCount(request.countRange, random)
  if (request.countRange.min === request.countRange.max) return request.countRange.min
  return Math.max(request.countRange.min, request.rolled.length)
}

const rolledEncountersForRequest = (
  request: EncounterGenerateRequest,
  count: number,
  table: Parameters<typeof rollEncounterTable>[0],
  random: () => number,
): RolledEncounter[] => request.rolled ?? Array.from({ length: count }, () => rollEncounterTable(table, random))
  .filter((encounter): encounter is RolledEncounter => Boolean(encounter))

export const activeRouteRepelForEncounterGeneration = (
  exploration: EncounterGenerateRequest['exploration'],
  database: RotomDatabase,
) => {
  if (!exploration) return null
  const stored = createSqliteSheetRepository<Record<string, unknown>>(database)
    .getByRef('trainer', exploration.trainerSlug)
  if (!stored) throw new GenerateEncountersUseCaseError(404, 'The route Repel Trainer is missing.')
  if (stored.revision !== exploration.trainerRevision) {
    throw new GenerateEncountersUseCaseError(409, 'The route Repel Trainer changed. Refresh before generation.')
  }
  const clock = createSqliteCampaignClockRepository(database).get()
  if (clock.revision !== exploration.campaignClockRevision) {
    throw new GenerateEncountersUseCaseError(409, 'The campaign clock changed. Refresh before generation.')
  }
  const trainer = {
    ...(structuredClone(stored.sheet) as unknown as TrainerSheet),
    slug: stored.slug,
    revision: stored.revision,
    updatedAt: stored.updatedAt,
  }
  let effect
  try { effect = strongestActiveRepel(trainer.serverPrivate?.itemExploration, clock.campaignMinute) }
  catch { throw new GenerateEncountersUseCaseError(409, 'The route Repel authority is malformed.') }
  if (!effect) throw new GenerateEncountersUseCaseError(409, 'No active route Repel covers this encounter generation.')
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(effect.canonicalItemId)
  const reviewed = definition?.spec.effects.find(candidate => candidate.operation === 'use-repel')
  if (!definition || definition.definitionSha256 !== effect.canonicalDefinitionSha256
    || !reviewed || reviewed.maximumAffectedWildLevel !== effect.maximumAffectedWildLevel
    || effect.expiresAtCampaignMinute !== effect.startedAtCampaignMinute + reviewed.durationMinutes) {
    throw new GenerateEncountersUseCaseError(409, 'The reviewed route Repel definition changed. Refresh before generation.')
  }
  return effect
}

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
    const count = countForEncounterRequest(request, runtime.random)
    const repel = activeRouteRepelForEncounterGeneration(
      request.exploration,
      dependencies.database ?? getRotomDatabase(),
    )
    const unfiltered = rolledEncountersForRequest(request, count, table, runtime.random)
    const rolled = repel
      ? unfiltered.filter(encounter => encounter.level > repel.maximumAffectedWildLevel)
      : unfiltered
    const repelledRolls = unfiltered.length - rolled.length
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
      writeTextFile: runtime.writeTextFile,
      random: runtime.random,
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
      routeRepel: repel ? {
        itemLabel: repel.canonicalItemId,
        maximumAffectedWildLevel: repel.maximumAffectedWildLevel,
        expiresAtCampaignMinute: repel.expiresAtCampaignMinute,
        repelledRolls,
      } : null,
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
