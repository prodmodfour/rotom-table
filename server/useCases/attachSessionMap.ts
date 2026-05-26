import {
  shouldGrantAttachedMapVisibilityToFuturePlayers,
  shouldGrantAttachedMapVisibilityToJoinedPlayers,
  shouldSelectAttachedSessionMap,
  validateAttachSessionMapInput,
  type AttachSessionMapInput,
  type AttachSessionMapResult,
  type AttachSessionMapValidationIssue,
} from '#shared/sessionMapAttachment'
import type { GmKey, SessionId } from '#shared/sessionIdentity'
import type { PlayerAssignmentRecord } from '#shared/sessionPermissions'
import {
  INITIAL_MAP_REVISION,
  incrementSessionRevision,
  type MapRevision,
  type SessionRevision,
} from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
  type AuthoritativeSessionMapState,
  type AuthoritativeSessionState,
  type SessionMapSlug,
} from '#shared/sessionState'
import type { TabletopMap } from '~/types/map'
import { findMapFile, readMapFile } from '../utils/mapStorage'
import { assertSessionHostEnabled, type SessionHostRuntimeEnv } from '../utils/sessionHosting'
import {
  writeSessionSnapshot,
  type WriteSessionSnapshotOptions,
  type WriteSessionSnapshotResult,
} from '../utils/sessionSnapshots'
import {
  sessionStore,
  type InMemorySessionStore,
  type SessionStoreRecord,
  type SessionStoreStatus,
} from '../utils/sessionStore'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class AttachSessionMapUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export type AttachSessionMapClock = () => string
export type AttachSessionMapPathFinder = (mapSlug: SessionMapSlug) => string | null
export type AttachSessionMapReader<TMapDocument = TabletopMap> = (filePath: string) => TMapDocument
export type AttachSessionMapSnapshotWriter<TMapDocument = TabletopMap> = (
  state: AuthoritativeSessionState<TMapDocument>,
  options?: WriteSessionSnapshotOptions<TMapDocument>,
) => WriteSessionSnapshotResult<TMapDocument>

export type AttachSessionMapUseCaseInput = AttachSessionMapInput

export interface AttachSessionMapDependencies<TMapDocument = TabletopMap> {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>
  readonly clock?: AttachSessionMapClock
  readonly findMapPath?: AttachSessionMapPathFinder
  readonly readMap?: AttachSessionMapReader<TMapDocument>
  readonly writeSnapshot?: AttachSessionMapSnapshotWriter<TMapDocument>
}

export interface AttachedSessionMapSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AttachSessionMapUseCaseResult<TMapDocument = TabletopMap>
  extends AttachSessionMapResult {
  readonly session: AttachSessionMapResult['session'] & AttachedSessionMapSessionDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TMapDocument>>
  readonly state: AuthoritativeSessionState<TMapDocument>
}

type AttachableSessionRecord<TMapDocument> = SessionStoreRecord<
  AuthoritativeSessionState<TMapDocument>
> & {
  readonly state: AuthoritativeSessionState<TMapDocument>
}

type LoadedSessionMapDocument<TMapDocument> = {
  readonly filePath: string
  readonly document: TMapDocument
}

const defaultClock: AttachSessionMapClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const validationIssueSummary = (issues: readonly AttachSessionMapValidationIssue[]): string =>
  issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')

const normalizeAttachSessionMapInput = (input: AttachSessionMapUseCaseInput) => {
  const validation = validateAttachSessionMapInput(input)
  if (!validation.valid) {
    throw new AttachSessionMapUseCaseError(
      400,
      `attach session map input is invalid: ${validationIssueSummary(validation.issues)}`,
    )
  }

  return validation.input
}

const getAttachableSessionRecord = <TMapDocument>(
  store: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>,
  sessionId: SessionId,
  gmKey: GmKey,
): AttachableSessionRecord<TMapDocument> => {
  const record = store.get(sessionId)
  if (record === undefined) {
    throw new AttachSessionMapUseCaseError(
      404,
      'No live session was found for the supplied session ID',
    )
  }

  if (record.gmKey !== gmKey) {
    throw new AttachSessionMapUseCaseError(
      403,
      'The supplied GM key is not authorized to attach maps to this live session',
    )
  }

  if (record.status !== 'active') {
    throw new AttachSessionMapUseCaseError(
      409,
      'The live session must be active before a map can be attached',
    )
  }

  if (record.state === undefined) {
    throw new AttachSessionMapUseCaseError(
      500,
      'The live session has no authoritative state available for map attachment',
    )
  }

  return record as AttachableSessionRecord<TMapDocument>
}

const clonePersistedMapDocument = <TMapDocument>(document: TMapDocument): TMapDocument => {
  if (typeof structuredClone === 'function') {
    return structuredClone(document) as TMapDocument
  }

  const json = JSON.stringify(document)
  if (json === undefined) {
    throw new Error('Persisted map document could not be serialized for live session ownership')
  }

  return JSON.parse(json) as TMapDocument
}

const loadPersistedSessionMap = <TMapDocument>(
  mapSlug: SessionMapSlug,
  findMapPath: AttachSessionMapPathFinder,
  readMap: AttachSessionMapReader<TMapDocument>,
): LoadedSessionMapDocument<TMapDocument> => {
  const filePath = findMapPath(mapSlug)
  if (filePath === null) {
    throw new AttachSessionMapUseCaseError(404, `Map ${mapSlug}.json not found`)
  }

  try {
    return {
      filePath,
      document: clonePersistedMapDocument(readMap(filePath)),
    }
  } catch (error) {
    if (error instanceof AttachSessionMapUseCaseError) throw error
    throw new AttachSessionMapUseCaseError(
      400,
      `Map ${mapSlug}.json could not be attached: ${messageFromError(error)}`,
    )
  }
}

const existingMapRevisionFor = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  mapSlug: SessionMapSlug,
): MapRevision =>
  state.maps.find((map) => map.mapSlug === mapSlug)?.revision ?? INITIAL_MAP_REVISION

const upsertAttachedMap = <TMapDocument>(
  maps: readonly AuthoritativeSessionMapState<TMapDocument>[],
  map: AuthoritativeSessionMapState<TMapDocument>,
): readonly AuthoritativeSessionMapState<TMapDocument>[] => [
  ...maps.filter((candidate) => candidate.mapSlug !== map.mapSlug),
  map,
]

const visibleMapResource = (mapSlug: SessionMapSlug) => ({
  kind: 'map' as const,
  mapSlug,
})

const assignmentHasVisibleMap = (
  assignment: PlayerAssignmentRecord,
  mapSlug: SessionMapSlug,
): boolean =>
  assignment.visibleResources.some(
    (resource) => resource.kind === 'map' && resource.mapSlug === mapSlug,
  )

const cloneAssignment = (assignment: PlayerAssignmentRecord): PlayerAssignmentRecord => ({
  ...assignment,
  controllableResources: assignment.controllableResources.map((resource) => ({ ...resource })),
  visibleResources: assignment.visibleResources.map((resource) => ({ ...resource })),
})

const grantAttachedMapVisibilityToJoinedPlayers = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  mapSlug: SessionMapSlug,
  updatedAt: string,
  updatedByClientId: PlayerAssignmentRecord['updatedByClientId'] | undefined,
): {
  readonly assignments: readonly PlayerAssignmentRecord[]
  readonly visiblePlayerIds: AttachSessionMapResult['visibility']['visiblePlayerIds']
} => {
  const assignmentsByPlayerId = new Map(
    state.assignments.map((assignment) => [assignment.playerId, cloneAssignment(assignment)]),
  )
  const visiblePlayerIds = new Set<AttachSessionMapResult['visibility']['visiblePlayerIds'][number]>()
  const mapResource = visibleMapResource(mapSlug)

  for (const player of state.players) {
    const currentAssignment = assignmentsByPlayerId.get(player.playerId)
    const nextAssignment: PlayerAssignmentRecord = currentAssignment === undefined
      ? {
          playerId: player.playerId,
          displayName: player.displayName,
          controllableResources: [],
          visibleResources: [mapResource],
          updatedAt,
          ...(updatedByClientId === undefined ? {} : { updatedByClientId }),
        }
      : assignmentHasVisibleMap(currentAssignment, mapSlug)
        ? currentAssignment
        : {
            ...currentAssignment,
            visibleResources: [...currentAssignment.visibleResources, mapResource],
            updatedAt,
            ...(updatedByClientId === undefined ? {} : { updatedByClientId }),
          }

    assignmentsByPlayerId.set(player.playerId, nextAssignment)
    if (assignmentHasVisibleMap(nextAssignment, mapSlug)) {
      visiblePlayerIds.add(player.playerId)
    }
  }

  return {
    assignments: [...assignmentsByPlayerId.values()],
    visiblePlayerIds: [...visiblePlayerIds].sort((left, right) => left.localeCompare(right)),
  }
}

const visiblePlayerIdsForMap = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  mapSlug: SessionMapSlug,
): AttachSessionMapResult['visibility']['visiblePlayerIds'] =>
  state.assignments
    .filter((assignment) => assignmentHasVisibleMap(assignment, mapSlug))
    .map((assignment) => assignment.playerId)
    .sort((left, right) => left.localeCompare(right))

export const attachSessionMapUseCase = <TMapDocument = TabletopMap>(
  input: AttachSessionMapUseCaseInput = {},
  dependencies: AttachSessionMapDependencies<TMapDocument> = {},
): AttachSessionMapUseCaseResult<TMapDocument> => {
  assertSessionHostEnabled(dependencies.env)

  const request = normalizeAttachSessionMapInput(input)
  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TMapDocument>
  >)
  const clock = dependencies.clock ?? defaultClock
  const findMapPath = dependencies.findMapPath ?? findMapFile
  const readMap = dependencies.readMap ?? (readMapFile as AttachSessionMapReader<TMapDocument>)
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot

  const record = getAttachableSessionRecord(activeStore, request.sessionId, request.gmKey)
  const currentState = record.state
  const loadedMap = loadPersistedSessionMap(request.mapSlug, findMapPath, readMap)
  const attachedAt = clock()
  const nextRevision = incrementSessionRevision(currentState.revision)
  const previousSelectedMapSlug = currentState.selectedMapSlug
  const mapRevision = existingMapRevisionFor(currentState, request.mapSlug)
  const grantsJoinedPlayers = shouldGrantAttachedMapVisibilityToJoinedPlayers(
    request.visibilityBehavior,
  )
  const grantsFuturePlayers = shouldGrantAttachedMapVisibilityToFuturePlayers(
    request.visibilityBehavior,
  )
  const attachedMap = createAuthoritativeSessionMapState<TMapDocument>({
    mapSlug: request.mapSlug,
    revision: mapRevision,
    playerVisibleByDefault: grantsFuturePlayers,
    document: loadedMap.document,
  })
  const selectedMapSlug = shouldSelectAttachedSessionMap(request.selectedMapBehavior)
    ? request.mapSlug
    : currentState.selectedMapSlug
  const baseNextState = createAuthoritativeSessionState<TMapDocument>({
    sessionId: currentState.sessionId,
    revision: nextRevision,
    selectedMapSlug,
    maps: upsertAttachedMap(currentState.maps, attachedMap),
    connectedClients: currentState.connectedClients,
    players: currentState.players,
    assignments: currentState.assignments,
    createdAt: currentState.createdAt,
    updatedAt: attachedAt,
  })
  const visibilityUpdate = grantsJoinedPlayers
    ? grantAttachedMapVisibilityToJoinedPlayers(
        baseNextState,
        request.mapSlug,
        attachedAt,
        request.gmClientId,
      )
    : {
        assignments: baseNextState.assignments,
        visiblePlayerIds: visiblePlayerIdsForMap(baseNextState, request.mapSlug),
      }
  const nextState = createAuthoritativeSessionState<TMapDocument>({
    sessionId: baseNextState.sessionId,
    revision: nextRevision,
    selectedMapSlug: baseNextState.selectedMapSlug,
    maps: baseNextState.maps,
    connectedClients: baseNextState.connectedClients,
    players: baseNextState.players,
    assignments: visibilityUpdate.assignments,
    createdAt: baseNextState.createdAt,
    updatedAt: attachedAt,
  })

  const updatedRecord = activeStore.setState(record.sessionId, nextState, {
    revision: nextRevision,
    updatedAt: attachedAt,
  })
  if (updatedRecord === undefined) {
    throw new AttachSessionMapUseCaseError(
      409,
      'The live session ended before the map could be attached',
    )
  }

  let snapshot: WriteSessionSnapshotResult<TMapDocument>
  try {
    snapshot = snapshotWriter(nextState, { clock: () => attachedAt })
  } catch (error) {
    activeStore.setState(record.sessionId, currentState, {
      revision: record.revision,
      updatedAt: record.updatedAt,
    })
    throw new AttachSessionMapUseCaseError(
      500,
      `Failed to write attached-map session snapshot: ${messageFromError(error)}`,
    )
  }

  return {
    session: {
      sessionId: updatedRecord.sessionId,
      status: updatedRecord.status,
      revision: updatedRecord.revision,
      selectedMapSlug: nextState.selectedMapSlug,
      mapCount: nextState.maps.length,
      createdAt: updatedRecord.createdAt,
      updatedAt: updatedRecord.updatedAt,
    },
    map: {
      mapSlug: request.mapSlug,
      revision: mapRevision,
      selected: nextState.selectedMapSlug === request.mapSlug,
    },
    selection: {
      behavior: request.selectedMapBehavior,
      previousSelectedMapSlug,
      selectedMapSlug: nextState.selectedMapSlug,
    },
    visibility: {
      behavior: request.visibilityBehavior,
      grantsJoinedPlayers,
      grantsFuturePlayers,
      visiblePlayerIds: visibilityUpdate.visiblePlayerIds,
    },
    snapshot: {
      writtenAt: snapshot.snapshot.writtenAt,
      revision: snapshot.snapshot.revision,
    },
    record: updatedRecord,
    state: nextState,
  }
}
