import { createHash } from 'node:crypto'
import { createError } from 'h3'
import type { AuthRole } from '#shared/auth'
import {
  CapabilityAdjudicationValidationError,
  parseResolveCapabilityAdjudicationCommand,
  type CapabilityAdjudicationResult,
  type ResolveCapabilityAdjudicationCommand,
} from '#shared/capabilityAutomation/adjudications'
import { normalizeRevision, nextRevision } from '#shared/sessionRevisions'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { TabletopMap } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import { buildCapabilityClientCapabilityBundle } from '../domain/capabilityAutomation/clientCapabilities'
import { CAPABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../domain/capabilityAutomation/registry'
import {
  createSqliteCapabilityAdjudicationRepository,
  type CapabilityAdjudicationRepository,
} from '../storage/capabilityAdjudicationRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteCapabilityResolutionOperationRepository } from '../storage/capabilityResolutionOperationRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import { setupMapSaveRealtimeAppendInputs } from '../realtime/setupDocumentRealtime'
import {
  defaultPersistedRealtimeEventPublisher,
  defaultPersistedRealtimePublicationFailureReporter,
  publishPersistedRealtimeEventsAfterCommit,
  type PersistedRealtimeEventPublisher,
  type PersistedRealtimePublicationFailureReporter,
} from '../realtime/persistedBatchPublication'
import { listRepositorySheets, type ListSheetsRepository } from './listSheets'
import {
  executeCapabilityActionUseCase,
  type ExecuteCapabilityActionDependencies,
} from './executeCapabilityAction'

export interface ResolveCapabilityAdjudicationDependencies {
  readonly database?: RotomDatabase
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'list' | 'applyLivePlayUpdate'> & ListSheetsRepository
  readonly adjudicationRepository?: CapabilityAdjudicationRepository
  readonly realtimeEventRepository?: Pick<RealtimeEventRepository, 'appendMany'>
  readonly now?: () => number
  readonly publishPersistedRealtimeEvent?: PersistedRealtimeEventPublisher
  readonly reportAfterCommitPublicationFailure?: PersistedRealtimePublicationFailureReporter
  readonly executeDependencies?: ExecuteCapabilityActionDependencies
}

const fail = (statusCode: number, statusMessage: string): never => { throw createError({ statusCode, statusMessage }) }
const parseCommand = (value: unknown): ResolveCapabilityAdjudicationCommand => {
  try { return parseResolveCapabilityAdjudicationCommand(value) }
  catch (error) {
    if (error instanceof CapabilityAdjudicationValidationError) fail(400, 'Invalid Capability adjudication command.')
    throw error
  }
}

/** Resolve or reject one exact, durable, server-retained Capability request. */
export const resolveCapabilityAdjudicationUseCase = (input: {
  readonly role: AuthRole
  readonly command: unknown
}, dependencies: ResolveCapabilityAdjudicationDependencies = {}): CapabilityAdjudicationResult => {
  if (input.role !== 'gm') fail(403, 'Only the GM may resolve Capability adjudications.')
  const command = parseCommand(input.command)
  const resolutionCommandSha256 = createHash('sha256')
    .update(stableJsonStringify(command)).digest('hex')
  const database = dependencies.database ?? getRotomDatabase()
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const adjudications = dependencies.adjudicationRepository ?? createSqliteCapabilityAdjudicationRepository(database)
  const realtimeEvents = dependencies.realtimeEventRepository ?? createSqliteRealtimeEventRepository({ database })
  const now = dependencies.now?.() ?? Date.now()
  const pending = adjudications.find(command.requestId) ?? fail(404, 'Capability adjudication request is missing.')
  if (pending.command.mapSlug !== command.mapSlug) fail(409, 'Capability adjudication map identity changed.')
  if (pending.status !== 'pending') {
    if (pending.resolutionOperationId === command.operationId) {
      if (pending.resolutionCommandSha256 !== resolutionCommandSha256) {
        fail(409, 'Capability adjudication resolution operation ID was reused with changed input.')
      }
      if (pending.status === 'expired') fail(409, 'Capability adjudication request expired.')
      const map = mapRepository.getBySlug(command.mapSlug) ?? fail(404, 'Capability map is missing.')
      const resolution = pending.status === 'accepted'
        ? createSqliteCapabilityResolutionOperationRepository(database).find(command.operationId)?.result ?? null
        : null
      return {
        schemaVersion: 1, operationId: command.operationId, requestId: command.requestId,
        mapSlug: command.mapSlug, mapRevision: resolution?.mapRevision ?? normalizeRevision(map.revision),
        decision: pending.status === 'accepted' ? 'accept' : 'reject', resolution,
      }
    }
    fail(409, 'Capability adjudication was already resolved.')
  }
  if (pending.expiresAt <= now) {
    const currentMap = mapRepository.getBySlug(command.mapSlug) ?? fail(404, 'Capability map is missing.')
    const currentRevision = normalizeRevision(currentMap.revision)
    const summaries = currentMap.encounterState?.capabilityRuntime?.pendingAdjudications ?? []
    const hasSummary = summaries.some(entry => entry.requestId === command.requestId)
    const nextMap: TabletopMap | null = hasSummary ? {
      ...deepCloneJson(currentMap),
      encounterState: {
        ...currentMap.encounterState!,
        capabilityRuntime: {
          ...currentMap.encounterState!.capabilityRuntime!,
          pendingAdjudications: summaries.filter(entry => entry.requestId !== command.requestId),
        },
      },
      revision: nextRevision(currentRevision),
      updatedAt: now,
    } : null
    const events = database.withTransaction(() => {
      if (nextMap && mapRepository.applyLivePlayUpdate({
        slug: command.mapSlug, expectedRevision: currentRevision, nextMap,
      }) === 'stale') fail(409, 'Capability map changed while expiring adjudication state.')
      if (adjudications.resolve({
        requestId: command.requestId,
        expectedStatus: 'pending',
        status: 'expired',
        resolvedAt: now,
        resolutionOperationId: command.operationId,
        resolutionCommandSha256,
      }) === 'stale') fail(409, 'Capability adjudication was resolved concurrently.')
      return nextMap
        ? realtimeEvents.appendMany(setupMapSaveRealtimeAppendInputs(nextMap).map(event => ({ ...event, timestamp: now })))
        : []
    })
    publishPersistedRealtimeEventsAfterCommit({
      events,
      operation: 'capability-adjudication-expiry',
      publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
      reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
    })
    fail(409, 'Capability adjudication request expired.')
  }
  const map = mapRepository.getBySlug(command.mapSlug) ?? fail(404, 'Capability map is missing.')
  const revision = normalizeRevision(map.revision)
  if (revision !== command.baseRevision) fail(409, 'Capability adjudication projection is stale.')
  const summary = map.encounterState?.capabilityRuntime?.pendingAdjudications
    .find(entry => entry.requestId === command.requestId)
    ?? fail(409, 'Capability adjudication public summary is missing.')

  if (command.decision === 'reject') {
    const nextMap: TabletopMap = {
      ...deepCloneJson(map),
      encounterState: {
        ...map.encounterState!,
        capabilityRuntime: {
          ...map.encounterState!.capabilityRuntime!,
          pendingAdjudications: map.encounterState!.capabilityRuntime!.pendingAdjudications
            .filter(entry => entry.requestId !== command.requestId),
        },
      },
      revision: nextRevision(revision),
      updatedAt: now,
    }
    const events = database.withTransaction(() => {
      if (mapRepository.applyLivePlayUpdate({ slug: command.mapSlug, expectedRevision: revision, nextMap }) === 'stale') {
        fail(409, 'Capability map changed before adjudication rejection.')
      }
      if (adjudications.resolve({
        requestId: command.requestId,
        expectedStatus: 'pending',
        status: 'rejected',
        resolvedAt: now,
        resolutionOperationId: command.operationId,
        resolutionCommandSha256,
      }) === 'stale') fail(409, 'Capability adjudication was resolved concurrently.')
      return realtimeEvents.appendMany(setupMapSaveRealtimeAppendInputs(nextMap).map(event => ({ ...event, timestamp: now })))
    })
    publishPersistedRealtimeEventsAfterCommit({
      events, operation: 'capability-adjudication-rejection',
      publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedRealtimeEventPublisher,
      reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultPersistedRealtimePublicationFailureReporter,
    })
    return {
      schemaVersion: 1, operationId: command.operationId, requestId: command.requestId,
      mapSlug: command.mapSlug, mapRevision: normalizeRevision(nextMap.revision), decision: 'reject', resolution: null,
    }
  }

  const pokemonSheets = listRepositorySheets<CharacterSheet>(sheetRepository, 'pokemon')
  const trainerSheets = listRepositorySheets<TrainerSheet>(sheetRepository, 'trainer')
  const bundle = buildCapabilityClientCapabilityBundle({
    role: 'gm', map, mapRevision: revision, pokemonSheets, trainerSheets, now,
  })
  const offer = bundle.placements.find(placement => placement.placementId === summary.actorPlacementId)?.offers
    .find(candidate => candidate.capabilityInstanceId === summary.capabilityInstanceId
      && candidate.canonicalId === summary.canonicalId && candidate.actionId === summary.actionId)
    ?? fail(409, 'Capability adjudication source offer is no longer effective.')
  if (!offer.available) fail(409, offer.unavailableReasonCodes[0] ?? 'Capability adjudication source is unavailable.')
  const runtime = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require(summary.canonicalId)
  if (runtime.definitionHash !== pending.definitionHash) fail(409, 'Capability definition changed while adjudication was pending.')
  const resolution = executeCapabilityActionUseCase({
    role: 'gm',
    approvedAdjudication: {
      requestId: command.requestId,
      definitionHash: pending.definitionHash,
      resolutionCommandSha256,
    },
    command: {
      ...pending.command,
      operationId: command.operationId,
      baseRevision: revision,
      offerId: offer.offerId,
      selections: {
        ...pending.command.selections,
        optionId: command.optionId ?? pending.command.selections.optionId,
        description: command.description ?? pending.command.selections.description,
        gmConfirmed: true,
      },
    },
  }, {
    database,
    mapRepository,
    sheetRepository,
    adjudicationRepository: adjudications,
    realtimeEventRepository: realtimeEvents,
    now: () => now,
    publishPersistedRealtimeEvent: dependencies.publishPersistedRealtimeEvent,
    reportAfterCommitPublicationFailure: dependencies.reportAfterCommitPublicationFailure,
    ...dependencies.executeDependencies,
  })
  return {
    schemaVersion: 1, operationId: command.operationId, requestId: command.requestId,
    mapSlug: command.mapSlug, mapRevision: resolution.mapRevision, decision: 'accept', resolution,
  }
}
