import { createHash } from 'node:crypto'
import {
  EncounterBuilderValidationError,
  parseLaunchEncounterBuilderRequest,
  type EncounterBuilderCastMember,
  type LaunchEncounterBuilderRequest,
  type LaunchEncounterBuilderResult,
} from '#shared/encounterDocuments/builder'
import { createEncounterDocument, parseEncounterDocument } from '#shared/encounterDocuments/model'
import { encounterRecipeScaffold } from '#shared/encounterDocuments/recipes'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { AppendRealtimeEventInput, RealtimeEventRepository } from '../storage/realtimeEventRepository'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { createSqliteEncounterDocumentRepository, type EncounterDocumentRepository } from '../storage/encounterDocumentRepository'
import { createSqliteEncounterLaunchOperationRepository, type EncounterLaunchOperationRepository } from '../storage/encounterLaunchOperationRepository'
import { createSqliteGmWildGenerationRepository, type GmWildGenerationRepository } from '../storage/gmWildGenerationRepository'
import { createSqliteGmNpcGenerationRepository, type GmNpcGenerationRepository } from '../storage/gmNpcGenerationRepository'
import { createSqliteGmSessionPreparationRepository, type GmSessionPreparationRepository } from '../storage/gmSessionPreparationRepository'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteMapInteractionModeRepository, type MapInteractionModeRepository } from '../storage/mapInteractionModeRepository'
import { createSqliteRealtimeEventRepository } from '../storage/realtimeEventRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { encounterDocumentRealtimeAppendInputs } from '../realtime/encounterDocumentRealtime'
import { setupMapSaveRealtimeAppendInputs } from '../realtime/setupDocumentRealtime'
import { interactionModeRealtimeAppendInputs } from '../realtime/libraryMutationRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import { livePlayMapWriteQueue, type MapWriteQueue } from '../livePlay/mapWriteQueue'
import { MAP_INTERACTION_MODES, SETUP_MODE_REQUIRED_FOR_MAP_SAVE_MESSAGE } from '#shared/mapInteractionMode'
import { deepCloneJson } from '~/utils/serialization'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'
import { catalogEntryForPokemonSheet, catalogEntryForTrainerSheet, pokemonHpSnapshot, trainerHpSnapshot } from '~/utils/sheetSpawn'
import { findEncounterSpawnPosition } from '~/utils/encounterSpawnPlacement'
import type { PositionedGridFootprint } from '~/utils/gridGeometry'
import { normalizeMapGroundLevelY } from '../utils/mapNormalization'
import { DEFAULT_TOKEN_FACING_DIRECTION } from '~/utils/tokenFacing'
import { initiativeOrderIdsForPlacements } from '~/utils/initiativeOrderEntries'
import { createGmToolkitSeededRng } from '../domain/gmToolkit/seededRng'
import { parseSessionPreparationDocumentV1, type SessionPreparationDocumentV1 } from '#shared/gmToolkit/sessionPreparation'
import {
  EncounterBuilderHandoffError,
  resolveEncounterBuilderHandoff,
  type EncounterBuilderHandoffRepositories,
  type ResolvedEncounterBuilderHandoff,
} from '../domain/gmToolkit/encounterBuilderHandoff'
import { publishGmCampaignToolkitInvalidation } from '../utils/gmToolkitRealtime'

export class LaunchEncounterBuilderUseCaseError extends UseCaseHttpError<number> {}

type LaunchMapRepository = Pick<MapRepository<TabletopMap>, 'get' | 'getBySlug' | 'replaceSetupMap'> & { readonly database?: RotomDatabase }
type LaunchSheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'list' | 'getByRef'> & { readonly database?: RotomDatabase }
type LaunchModeRepository = Pick<MapInteractionModeRepository, 'get' | 'set'> & { readonly database?: RotomDatabase }
type LaunchRealtimeRepository = Pick<RealtimeEventRepository, 'appendMany'> & { readonly database?: RotomDatabase }

export interface LaunchEncounterBuilderDependencies {
  readonly database?: RotomDatabase
  readonly encounterRepository?: EncounterDocumentRepository
  readonly launchOperationRepository?: EncounterLaunchOperationRepository
  readonly wildGenerationRepository?: GmWildGenerationRepository
  readonly npcGenerationRepository?: GmNpcGenerationRepository
  readonly sessionPreparationRepository?: GmSessionPreparationRepository
  readonly mapRepository?: LaunchMapRepository
  readonly sheetRepository?: LaunchSheetRepository
  readonly mapInteractionModeRepository?: LaunchModeRepository
  readonly realtimeEventRepository?: LaunchRealtimeRepository
  readonly queue?: MapWriteQueue
  readonly now?: () => number
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
  readonly publishToolkitInvalidation?: typeof publishGmCampaignToolkitInvalidation
  readonly afterMapWrite?: () => void
  readonly afterPreparationWrite?: () => void
}

const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const parseRequest = (value: unknown): LaunchEncounterBuilderRequest => {
  try { return parseLaunchEncounterBuilderRequest(value) }
  catch (error) {
    if (error instanceof EncounterBuilderValidationError) throw new LaunchEncounterBuilderUseCaseError(400, error.message)
    throw error
  }
}

const runtime = (dependencies: LaunchEncounterBuilderDependencies) => {
  const candidates = [
    dependencies.encounterRepository?.database,
    dependencies.launchOperationRepository?.database,
    dependencies.wildGenerationRepository?.database,
    dependencies.npcGenerationRepository?.database,
    dependencies.sessionPreparationRepository?.database,
    dependencies.mapRepository?.database,
    dependencies.sheetRepository?.database,
    dependencies.mapInteractionModeRepository?.database,
    dependencies.realtimeEventRepository?.database,
  ].filter((value): value is RotomDatabase => Boolean(value))
  const database = dependencies.database ?? candidates[0] ?? getRotomDatabase()
  if (candidates.some(candidate => candidate !== database)) throw new Error('Encounter launch repositories must share one RotomDatabase')
  return {
    database,
    encounters: dependencies.encounterRepository ?? createSqliteEncounterDocumentRepository(database),
    launches: dependencies.launchOperationRepository ?? createSqliteEncounterLaunchOperationRepository(database),
    wild: dependencies.wildGenerationRepository ?? createSqliteGmWildGenerationRepository(database),
    npc: dependencies.npcGenerationRepository ?? createSqliteGmNpcGenerationRepository(database),
    preparations: dependencies.sessionPreparationRepository ?? createSqliteGmSessionPreparationRepository(database),
    maps: dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database),
    sheets: dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database),
    modes: dependencies.mapInteractionModeRepository ?? createSqliteMapInteractionModeRepository(database),
    realtime: dependencies.realtimeEventRepository ?? createSqliteRealtimeEventRepository({ database }),
  }
}

const priorResult = (
  request: LaunchEncounterBuilderRequest,
  requestSha256: string,
  launches: EncounterLaunchOperationRepository,
): LaunchEncounterBuilderResult | null => {
  const prior = launches.get(request.launchId)
  if (!prior) return null
  if (prior.requestSha256 !== requestSha256) throw new LaunchEncounterBuilderUseCaseError(409, 'Encounter launch ID was already used for different intent.')
  return { ...prior.result, exactRetry: true }
}

const sheetLookup = (repository: LaunchSheetRepository): SheetLookup => ({
  pokemon: new Map(repository.list('pokemon').map(stored => [stored.slug, { ...stored.document, slug: stored.slug, revision: stored.revision } as unknown as CharacterSheet])),
  trainer: new Map(repository.list('trainer').map(stored => [stored.slug, { ...stored.document, slug: stored.slug, revision: stored.revision } as unknown as TrainerSheet])),
})

const occupiedFootprints = (map: TabletopMap, lookup: SheetLookup): PositionedGridFootprint[] => (map.placements ?? []).map((placement) => {
  const spawned = placementToSpawned(placement, lookup, map)
  return spawned
    ? { id: spawned.id, position: spawned.position, base: spawned.base, clearance: spawned.clearance }
    : { id: placement.id, position: placement.position, base: 1, clearance: 1 }
})

const validateHandoff = (
  request: LaunchEncounterBuilderRequest,
  repositories: EncounterBuilderHandoffRepositories,
): ResolvedEncounterBuilderHandoff => {
  let resolved: ResolvedEncounterBuilderHandoff
  try { resolved = resolveEncounterBuilderHandoff(request.handoff, repositories) }
  catch (error) {
    if (error instanceof EncounterBuilderHandoffError) throw new LaunchEncounterBuilderUseCaseError(error.statusCode, error.message)
    throw error
  }
  for (const member of request.cast) {
    const allowed = resolved.allowedCast.get(`${member.sheet.kind}:${member.sheet.slug}`)
    if (!allowed || allowed.sourceCandidateId !== member.sourceCandidateId) {
      throw new LaunchEncounterBuilderUseCaseError(409, `Cast member ${member.castId} no longer matches the immutable Builder handoff.`)
    }
  }
  const sourceMap = resolved.projection.defaults.map
  if (sourceMap && (request.mapSlug !== sourceMap.slug || request.expectedMapRevision !== sourceMap.expectedRevision)) {
    throw new LaunchEncounterBuilderUseCaseError(409, 'Prepared scene map does not match the immutable Builder handoff.')
  }
  if (resolved.projection.defaults.storyLocked) {
    const defaults = resolved.projection.defaults
    if (request.publicStakes !== defaults.publicStakes || request.gmStakes !== defaults.gmStakes || request.notes !== defaults.notes) {
      throw new LaunchEncounterBuilderUseCaseError(409, 'Prepared scene material changed. Reopen Builder from the current preparation revision.')
    }
  }
  return resolved
}

const recordPreparationLaunch = (input: {
  readonly resolved: ResolvedEncounterBuilderHandoff
  readonly request: LaunchEncounterBuilderRequest
  readonly requestSha256: string
  readonly preparations: GmSessionPreparationRepository
  readonly launchedAt: string
  readonly afterWrite?: () => void
}): SessionPreparationDocumentV1 | null => {
  const binding = input.resolved.preparation
  if (!binding) return null
  const current = input.preparations.get(binding.preparationId)
  if (!current || current.revision !== binding.expectedRevision) throw new LaunchEncounterBuilderUseCaseError(409, 'Session preparation changed during launch.')
  if (current.launches.some(row => row.sceneId === binding.sceneId || row.launchId === input.request.launchId)) {
    throw new LaunchEncounterBuilderUseCaseError(409, 'Prepared scene already has immutable launch evidence.')
  }
  const next = parseSessionPreparationDocumentV1({
    ...current,
    revision: current.revision + 1,
    lifecycle: 'launched',
    launches: [...current.launches, {
      launchId: input.request.launchId,
      sceneId: binding.sceneId,
      encounterId: input.request.encounterId,
      mapSlug: input.request.mapSlug,
      launchedAt: input.launchedAt,
    }],
    updatedAt: input.launchedAt,
  })
  const stored = input.preparations.replace(next, current.revision)
  if (!stored) throw new LaunchEncounterBuilderUseCaseError(409, 'Session preparation changed during launch.')
  input.afterWrite?.()
  input.preparations.createOperation({
    operationId: `builder-launch-${sha256(input.request.launchId).slice(0, 32)}`,
    commandSha256: input.requestSha256,
    commandKind: 'record-launch',
    preparationId: current.preparationId,
    expectedRevision: current.revision,
    command: { schemaVersion: 1, kind: 'record-launch', launchId: input.request.launchId, sceneId: binding.sceneId, encounterId: input.request.encounterId, mapSlug: input.request.mapSlug },
    result: stored,
    createdAt: input.launchedAt,
  })
  return stored
}

const appendCastPlacements = (input: {
  readonly map: TabletopMap
  readonly cast: readonly EncounterBuilderCastMember[]
  readonly lookup: SheetLookup
  readonly requestSha256: string
}): readonly string[] => {
  const placed = occupiedFootprints(input.map, input.lookup)
  const existingIds = new Set((input.map.placements ?? []).map(row => row.id))
  const placementIds: string[] = []
  const rng = createGmToolkitSeededRng(input.requestSha256)
  const groundLevelY = normalizeMapGroundLevelY(input.map.groundLevelY, input.map.dimensions.y)

  for (const [index, member] of input.cast.entries()) {
    const sheet = input.lookup[member.sheet.kind].get(member.sheet.slug)
    if (!sheet) throw new LaunchEncounterBuilderUseCaseError(404, `Cast sheet ${member.sheet.slug} is missing.`)
    const catalog = member.sheet.kind === 'pokemon'
      ? catalogEntryForPokemonSheet(sheet as CharacterSheet)
      : catalogEntryForTrainerSheet(sheet as TrainerSheet)
    if (!catalog) throw new LaunchEncounterBuilderUseCaseError(409, `Cast sheet ${member.sheet.slug} has no canonical token catalog entry.`)
    const hp = member.sheet.kind === 'pokemon'
      ? pokemonHpSnapshot(sheet as CharacterSheet)
      : trainerHpSnapshot(sheet as TrainerSheet)
    const position = findEncounterSpawnPosition({
      candidate: { base: catalog.base, clearance: catalog.clearance, movementCapabilities: hp.movementCapabilities },
      placed,
      dimensions: input.map.dimensions,
      voxels: input.map.voxels,
      groundLevelY,
      random: () => rng.int(0, 0xffff_ffff, `placement-${index + 1}`) / 0x1_0000_0000,
    })
    if (!position) throw new LaunchEncounterBuilderUseCaseError(409, `No legal open position exists for ${member.sheet.slug}.`)
    if (member.sideId !== null && !input.map.encounterState?.sides[member.sideId]) {
      throw new LaunchEncounterBuilderUseCaseError(409, `Encounter side ${member.sideId} is not available on map ${input.map.slug}.`)
    }
    const placementId = `encounter-placement:v2:${input.requestSha256.slice(0, 16)}:${index + 1}`
    if (existingIds.has(placementId)) throw new LaunchEncounterBuilderUseCaseError(409, 'A deterministic placement identity already exists on this map.')
    existingIds.add(placementId)
    const placement: SheetPlacement = {
      id: placementId,
      sheetKind: member.sheet.kind,
      sheetSlug: member.sheet.slug,
      position,
      ...(member.sideId ? { sideId: member.sideId } : {}),
      facing: DEFAULT_TOKEN_FACING_DIRECTION,
      turned: false,
    }
    input.map.placements = [...(input.map.placements ?? []), placement]
    placed.push({ id: placementId, position, base: catalog.base, clearance: catalog.clearance })
    placementIds.push(placementId)
  }
  return placementIds
}

export const launchEncounterBuilderUseCase = async (
  value: unknown,
  dependencies: LaunchEncounterBuilderDependencies = {},
): Promise<LaunchEncounterBuilderResult> => {
  const request = parseRequest(value)
  const repositories = runtime(dependencies)
  const requestSha256 = sha256(request)
  const replay = priorResult(request, requestSha256, repositories.launches)
  if (replay) return replay
  const queue = dependencies.queue ?? livePlayMapWriteQueue
  let committedEvents: readonly PersistedRealtimeEvent[] = []
  const committedState: { preparation: SessionPreparationDocumentV1 | null } = { preparation: null }

  const result = await queue.withMapWriteQueue(request.mapSlug, () => repositories.database.withTransaction(() => {
    const concurrent = priorResult(request, requestSha256, repositories.launches)
    if (concurrent) return concurrent
    if (repositories.encounters.get(request.encounterId)) throw new LaunchEncounterBuilderUseCaseError(409, 'Encounter ID already exists.')
    const resolvedHandoff = validateHandoff(request, {
      database: repositories.database,
      wild: repositories.wild,
      npc: repositories.npc,
      preparations: repositories.preparations,
      maps: repositories.maps,
      sheets: repositories.sheets,
    })

    const currentMap = repositories.maps.getBySlug(request.mapSlug)
    if (!currentMap) throw new LaunchEncounterBuilderUseCaseError(404, 'Battlefield map is missing.')
    if ((currentMap.revision ?? 0) !== request.expectedMapRevision) throw new LaunchEncounterBuilderUseCaseError(409, 'Battlefield map changed. Refresh before launch.')
    if (repositories.modes.get(request.mapSlug).interactionMode !== MAP_INTERACTION_MODES.SETUP_EDIT) {
      throw new LaunchEncounterBuilderUseCaseError(409, SETUP_MODE_REQUIRED_FOR_MAP_SAVE_MESSAGE)
    }
    const lookup = sheetLookup(repositories.sheets)
    for (const member of request.cast) {
      const stored = repositories.sheets.getByRef(member.sheet.kind, member.sheet.slug)
      if (!stored || stored.revision !== member.sheet.expectedRevision) {
        throw new LaunchEncounterBuilderUseCaseError(409, `Cast sheet ${member.sheet.slug} changed. Refresh before launch.`)
      }
    }

    const nextMap = deepCloneJson(currentMap)
    const participantIds = appendCastPlacements({ map: nextMap, cast: request.cast, lookup, requestSha256 })
    if (request.startInitiative) {
      if (nextMap.initiative?.activeId) throw new LaunchEncounterBuilderUseCaseError(409, 'Initiative is already active on this battlefield.')
      const order = initiativeOrderIdsForPlacements(nextMap.placements, (kind, slug) => {
        const sheet = lookup[kind].get(slug)
        return sheet ? { sheet: sheet as unknown as Record<string, unknown> } : null
      }, nextMap.initiative?.manualOrderIds)
      if (order.length === 0) throw new LaunchEncounterBuilderUseCaseError(409, 'The battlefield has no initiative participants.')
      nextMap.initiative = { ...(nextMap.initiative ?? {}), activeId: order[0]!, round: 1 }
    }
    const now = (dependencies.now ?? Date.now)()
    const mapResult = repositories.maps.replaceSetupMap({ slug: request.mapSlug, expectedRevision: request.expectedMapRevision, map: nextMap, now })
    if (!mapResult?.changed) throw new LaunchEncounterBuilderUseCaseError(409, 'Battlefield map could not accept the reviewed cast.')
    dependencies.afterMapWrite?.()

    const recipe = encounterRecipeScaffold(request.recipe, request.encounterId)
    const base = createEncounterDocument({ encounterId: request.encounterId, name: request.name, linkedMapSlug: request.mapSlug, recipe: request.recipe, now })
    const sourceStory = resolvedHandoff.projection.defaults.storyLocked ? resolvedHandoff.projection.defaults : null
    const document = parseEncounterDocument({
      ...base,
      lifecycle: 'active',
      presentation: request.presentation,
      hiddenParticipantIds: participantIds.filter((_id, index) => request.cast[index]?.hidden),
      castRoles: participantIds.map((participantId, index) => ({ participantId, role: request.cast[index]!.role })),
      objectives: recipe.objectives,
      clocks: recipe.clocks,
      phases: recipe.phases,
      activePhaseId: recipe.activePhaseId,
      stakes: { public: sourceStory?.publicStakes ?? request.publicStakes, gm: sourceStory?.gmStakes ?? request.gmStakes },
      notes: sourceStory?.notes ?? request.notes,
    })
    repositories.encounters.create(document)
    const launchedAt = new Date(now).toISOString()
    committedState.preparation = recordPreparationLaunch({
      resolved: resolvedHandoff,
      request,
      requestSha256,
      preparations: repositories.preparations,
      launchedAt,
      afterWrite: dependencies.afterPreparationWrite,
    })
    const accepted: LaunchEncounterBuilderResult = {
      ok: true,
      exactRetry: false,
      launchId: request.launchId,
      encounterId: request.encounterId,
      encounterRevision: document.revision,
      mapSlug: request.mapSlug,
      mapRevision: mapResult.map.revision ?? 0,
      spawned: participantIds.length,
    }
    repositories.launches.save({ launchId: request.launchId, encounterId: request.encounterId, requestSha256, request, result: accepted, createdAt: now })
    repositories.modes.set({ slug: request.mapSlug, interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: now })
    const appendInputs: AppendRealtimeEventInput[] = [
      ...setupMapSaveRealtimeAppendInputs(deepCloneJson(mapResult.map), request.clientId ?? undefined),
      ...encounterDocumentRealtimeAppendInputs({ document, kind: 'created', previousRevision: null, operationId: request.launchId, timestamp: document.updatedAt }),
      ...interactionModeRealtimeAppendInputs({ slug: request.mapSlug, interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: now, clientId: request.clientId ?? undefined }),
    ]
    committedEvents = repositories.realtime.appendMany(appendInputs)
    return accepted
  }))

  if (!result.exactRetry) {
    publishPersistedRealtimeEventsAfterCommit({
      events: committedEvents,
      operation: `encounter launch ${request.launchId}`,
      publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
      reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
    })
    if (committedState.preparation) (dependencies.publishToolkitInvalidation ?? publishGmCampaignToolkitInvalidation)({
      schemaVersion: 1,
      domain: 'session-preparation',
      documentId: committedState.preparation.preparationId,
      revision: committedState.preparation.revision,
    }, request.launchId)
  }
  return result
}
