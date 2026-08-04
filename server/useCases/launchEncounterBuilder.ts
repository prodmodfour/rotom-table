import { createHash } from 'node:crypto'
import {
  EncounterBuilderValidationError,
  parseLaunchEncounterBuilderRequest,
  type LaunchEncounterBuilderRequest,
  type LaunchEncounterBuilderResult,
} from '#shared/encounterDocuments/builder'
import { createEncounterDocument, parseEncounterDocument } from '#shared/encounterDocuments/model'
import { encounterRecipeScaffold } from '#shared/encounterDocuments/recipes'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  spawnGeneratedEncountersUseCase,
  type SpawnGeneratedEncountersDependencies,
} from './spawnGeneratedEncounters'
import { createSqliteEncounterDocumentRepository, type EncounterDocumentRepository } from '../storage/encounterDocumentRepository'
import {
  createSqliteEncounterLaunchOperationRepository,
  type EncounterLaunchOperationRepository,
} from '../storage/encounterLaunchOperationRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { encounterDocumentRealtimeAppendInputs } from '../realtime/encounterDocumentRealtime'

export class LaunchEncounterBuilderUseCaseError extends UseCaseHttpError<number> {}

export interface LaunchEncounterBuilderDependencies extends SpawnGeneratedEncountersDependencies {
  readonly encounterRepository?: EncounterDocumentRepository
  readonly launchOperationRepository?: EncounterLaunchOperationRepository
}

const sha256 = (request: LaunchEncounterBuilderRequest): string => createHash('sha256')
  .update(stableJsonStringify(request))
  .digest('hex')

const runtimeRepositories = (dependencies: LaunchEncounterBuilderDependencies) => {
  const database = dependencies.database
    ?? dependencies.encounterRepository?.database
    ?? dependencies.launchOperationRepository?.database
    ?? getRotomDatabase()
  if (dependencies.encounterRepository?.database && dependencies.encounterRepository.database !== database) {
    throw new Error('Encounter launch repository must share the spawn transaction database.')
  }
  if (dependencies.launchOperationRepository?.database && dependencies.launchOperationRepository.database !== database) {
    throw new Error('Encounter launch operation repository must share the spawn transaction database.')
  }
  return {
    database,
    encounters: dependencies.encounterRepository ?? createSqliteEncounterDocumentRepository(database),
    launches: dependencies.launchOperationRepository ?? createSqliteEncounterLaunchOperationRepository(database),
  }
}

const priorResult = (
  request: LaunchEncounterBuilderRequest,
  hash: string,
  launches: EncounterLaunchOperationRepository,
): LaunchEncounterBuilderResult | null => {
  const prior = launches.get(request.launchId)
  if (!prior) return null
  if (prior.requestSha256 !== hash) {
    throw new LaunchEncounterBuilderUseCaseError(409, 'Encounter launch ID was already used for different intent.')
  }
  return prior.result
}

const parseRequest = (value: unknown): LaunchEncounterBuilderRequest => {
  try { return parseLaunchEncounterBuilderRequest(value) }
  catch (error) {
    if (error instanceof EncounterBuilderValidationError) throw new LaunchEncounterBuilderUseCaseError(400, error.message)
    throw error
  }
}

export const launchEncounterBuilderUseCase = async (
  value: unknown,
  dependencies: LaunchEncounterBuilderDependencies = {},
): Promise<LaunchEncounterBuilderResult> => {
  const request = parseRequest(value)
  const repositories = runtimeRepositories(dependencies)
  const requestSha256 = sha256(request)
  const replay = priorResult(request, requestSha256, repositories.launches)
  if (replay) return replay
  if (repositories.encounters.get(request.encounterId)) {
    throw new LaunchEncounterBuilderUseCaseError(409, 'Encounter ID already exists.')
  }
  const recipeScaffold = encounterRecipeScaffold(request.recipe, request.encounterId)
  let accepted: LaunchEncounterBuilderResult | null = null
  try {
    await spawnGeneratedEncountersUseCase({
      region: request.source.region,
      table: request.source.table,
      countMin: request.cast.length,
      countMax: request.cast.length,
      outRoot: request.source.outRoot,
      preview: false,
      rolled: request.cast.map(member => ({ species: member.species, level: member.level, roll: member.roll })),
      mapSlug: request.mapSlug,
      ...(request.clientId ? { clientId: request.clientId } : {}),
    }, {
      ...dependencies,
      database: repositories.database,
      startInitiativeAfterSpawn: request.startInitiative,
      activateLivePlayAfterSpawn: true,
      spawnSideIdForIndex: index => request.cast[index]?.sideId ?? null,
      afterPersistInTransaction: ({ map, placements }) => {
        const concurrentReplay = priorResult(request, requestSha256, repositories.launches)
        if (concurrentReplay) throw new LaunchEncounterBuilderUseCaseError(409, 'Encounter launch was accepted concurrently; retry exact launch.')
        if (repositories.encounters.get(request.encounterId)) throw new LaunchEncounterBuilderUseCaseError(409, 'Encounter ID already exists.')
        if (placements.length !== request.cast.length || placements.some(placement => !placement.placementId || placement.error)) {
          throw new LaunchEncounterBuilderUseCaseError(409, 'Every reviewed cast member must generate and receive a battlefield placement before launch.')
        }
        const participantIds = placements.map(placement => placement.placementId!)
        const base = createEncounterDocument({
          encounterId: request.encounterId,
          name: request.name,
          linkedMapSlug: request.mapSlug,
          recipe: request.recipe,
          now: dependencies.now?.() ?? Date.now(),
        })
        const document = parseEncounterDocument({
          ...base,
          lifecycle: 'active',
          presentation: request.presentation,
          hiddenParticipantIds: participantIds.filter((_participantId, index) => request.cast[index]?.hidden),
          castRoles: participantIds.map((participantId, index) => ({ participantId, role: request.cast[index]!.role })),
          objectives: recipeScaffold.objectives,
          clocks: recipeScaffold.clocks,
          phases: recipeScaffold.phases,
          activePhaseId: recipeScaffold.activePhaseId,
          stakes: { public: request.publicStakes, gm: request.gmStakes },
          notes: request.notes,
        })
        repositories.encounters.create(document)
        accepted = {
          ok: true,
          launchId: request.launchId,
          encounterId: request.encounterId,
          encounterRevision: document.revision,
          mapSlug: request.mapSlug,
          mapRevision: map.revision ?? 0,
          spawned: placements.length,
        }
        repositories.launches.save({
          launchId: request.launchId,
          encounterId: request.encounterId,
          requestSha256,
          request,
          result: accepted,
          createdAt: dependencies.now?.() ?? Date.now(),
        })
        const encounterEvents = encounterDocumentRealtimeAppendInputs({
          document,
          kind: 'created',
          previousRevision: null,
          operationId: request.launchId,
          timestamp: document.updatedAt,
        })
        const extensionEvents = dependencies.afterPersistInTransaction?.({ map, placements }) ?? []
        return [...encounterEvents, ...extensionEvents]
      },
    })
  }
  catch (error) {
    const concurrent = priorResult(request, requestSha256, repositories.launches)
    if (concurrent) return concurrent
    if (error instanceof LaunchEncounterBuilderUseCaseError) throw error
    if (typeof error === 'object' && error !== null && typeof (error as { statusCode?: unknown }).statusCode === 'number') {
      throw new LaunchEncounterBuilderUseCaseError(
        Number((error as { statusCode: number }).statusCode),
        String((error as { statusMessage?: unknown, message?: unknown }).statusMessage ?? (error as { message?: unknown }).message ?? 'Encounter launch failed.'),
      )
    }
    throw error
  }
  if (!accepted) throw new Error('Encounter launch committed without a result receipt.')
  return accepted
}
