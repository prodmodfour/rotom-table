import {
  parseClientId,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
  type ClientId,
  type PlayerId,
  type SessionDisplayName,
  type SessionId,
} from '#shared/sessionIdentity'
import {
  findPlayerAssignment,
  type PlayerAssignmentRecord,
  type PlayerSessionActor,
  type SessionControllableResourceRef,
  type SessionVisibleResourceRef,
} from '#shared/sessionPermissions'
import type { MapRevision, SessionRevision } from '#shared/sessionRevisions'
import {
  findSessionConnectedClient,
  findSessionPlayerRecord,
  type AuthoritativeSessionState,
  type SessionMapSlug,
  type SessionPlayerRecord,
} from '#shared/sessionState'
import { assertSessionHostEnabled, type SessionHostRuntimeEnv } from '../utils/sessionHosting'
import {
  sessionStore,
  type InMemorySessionStore,
  type SessionStoreRecord,
  type SessionStoreStatus,
} from '../utils/sessionStore'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class GetPlayerSessionStateUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export interface GetPlayerSessionStateInput {
  readonly sessionId?: unknown
  readonly playerId?: unknown
  readonly clientId?: unknown
  readonly displayName?: unknown
}

export interface GetPlayerSessionStateDependencies<TMapDocument = unknown> {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>
}

export interface PlayerSessionStateDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
  readonly endedAt?: string
}

export interface PlayerSessionIdentityDetails {
  readonly playerId: PlayerId
  readonly clientId: ClientId
  readonly displayName: SessionDisplayName
  readonly joinedAt: string
  readonly updatedAt: string
  readonly actor: PlayerSessionActor
}

export type PlayerSessionAssignmentDetails = PlayerAssignmentRecord

export interface PlayerVisibleMapSummary {
  readonly mapSlug: SessionMapSlug
  readonly revision: MapRevision
  readonly selected: boolean
  readonly attached: true
  readonly availableForSessionMode: true
}

export interface PlayerSessionVisibilityDetails {
  readonly selectedMapAttached: boolean
  readonly currentMapVisible: boolean
  readonly currentMapAvailable: boolean
  readonly currentMap: PlayerVisibleMapSummary | null
  readonly visibleMapSlugs: readonly SessionMapSlug[]
  readonly visibleMaps: readonly PlayerVisibleMapSummary[]
}

export interface GetPlayerSessionStateUseCaseResult<TMapDocument = unknown> {
  readonly session: PlayerSessionStateDetails
  readonly player: PlayerSessionIdentityDetails
  readonly assignment: PlayerSessionAssignmentDetails
  readonly visibility: PlayerSessionVisibilityDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TMapDocument>>
  readonly state: AuthoritativeSessionState<TMapDocument>
}

type PlayerReadableSessionRecord<TMapDocument> = SessionStoreRecord<
  AuthoritativeSessionState<TMapDocument>
> & {
  readonly state: AuthoritativeSessionState<TMapDocument>
}

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const normalizeSessionIdForPlayerState = (value: unknown): SessionId => {
  try {
    return parseSessionId(value)
  } catch (error) {
    throw new GetPlayerSessionStateUseCaseError(400, messageFromError(error))
  }
}

const normalizePlayerIdForPlayerState = (value: unknown): PlayerId => {
  try {
    return parsePlayerId(value)
  } catch (error) {
    throw new GetPlayerSessionStateUseCaseError(400, messageFromError(error))
  }
}

const normalizeClientIdForPlayerState = (value: unknown): ClientId => {
  try {
    return parseClientId(value)
  } catch (error) {
    throw new GetPlayerSessionStateUseCaseError(400, messageFromError(error))
  }
}

const normalizeDisplayNameForPlayerState = (value: unknown): SessionDisplayName => {
  try {
    return parseSessionDisplayName(value)
  } catch (error) {
    throw new GetPlayerSessionStateUseCaseError(400, messageFromError(error))
  }
}

const getPlayerReadableSessionRecord = <TMapDocument>(
  store: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>,
  sessionId: SessionId,
): PlayerReadableSessionRecord<TMapDocument> => {
  const record = store.get(sessionId)
  if (record === undefined) {
    throw new GetPlayerSessionStateUseCaseError(
      404,
      'No live session was found for the supplied session ID',
    )
  }

  if (record.state === undefined) {
    throw new GetPlayerSessionStateUseCaseError(
      500,
      'The live session has no authoritative state available for player state reads',
    )
  }

  return record as PlayerReadableSessionRecord<TMapDocument>
}

const getAuthorizedPlayerRecord = (
  state: AuthoritativeSessionState,
  playerId: PlayerId,
  displayName: SessionDisplayName,
): SessionPlayerRecord => {
  const player = findSessionPlayerRecord(state.players, playerId)
  if (player === undefined || player.displayName !== displayName) {
    throw new GetPlayerSessionStateUseCaseError(
      403,
      'The supplied player identity is not authorized to read this live session',
    )
  }

  return player
}

const assertClientBelongsToPlayerIfPresent = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  playerId: PlayerId,
  clientId: ClientId,
): void => {
  const connectedClient = findSessionConnectedClient(state.connectedClients, clientId)
  if (connectedClient === undefined) return

  if (connectedClient.actor.role !== 'player' || connectedClient.actor.playerId !== playerId) {
    throw new GetPlayerSessionStateUseCaseError(
      403,
      'The supplied client ID is already associated with a different session actor',
    )
  }
}

const cloneControllableResources = (
  resources: readonly SessionControllableResourceRef[],
): readonly SessionControllableResourceRef[] => resources.map((resource) => ({ ...resource }))

const cloneVisibleResources = (
  resources: readonly SessionVisibleResourceRef[],
): readonly SessionVisibleResourceRef[] => resources.map((resource) => ({ ...resource }))

const cloneAssignment = (assignment: PlayerAssignmentRecord): PlayerSessionAssignmentDetails => ({
  ...assignment,
  controllableResources: cloneControllableResources(assignment.controllableResources),
  visibleResources: cloneVisibleResources(assignment.visibleResources),
})

const createEmptyAssignment = (player: SessionPlayerRecord): PlayerAssignmentRecord => ({
  playerId: player.playerId,
  displayName: player.displayName,
  controllableResources: [],
  visibleResources: [],
  updatedAt: player.updatedAt,
})

const summarizeVisibleMaps = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  assignment: PlayerAssignmentRecord,
): PlayerSessionVisibilityDetails => {
  const visibleMapSlugSet = new Set<SessionMapSlug>()
  for (const resource of assignment.visibleResources) {
    if (resource.kind === 'map') {
      visibleMapSlugSet.add(resource.mapSlug)
    }
  }

  const visibleMapSlugs = [...visibleMapSlugSet].sort((left, right) => left.localeCompare(right))
  const visibleMaps = state.maps
    .filter((map) => visibleMapSlugSet.has(map.mapSlug))
    .map((map) => ({
      mapSlug: map.mapSlug,
      revision: map.revision,
      selected: state.selectedMapSlug === map.mapSlug,
      attached: true as const,
      availableForSessionMode: true as const,
    }))

  const selectedMap = state.selectedMapSlug === null
    ? undefined
    : state.maps.find((map) => map.mapSlug === state.selectedMapSlug)
  const selectedMapAttached = selectedMap !== undefined
  const currentMap = selectedMapAttached && visibleMapSlugSet.has(selectedMap.mapSlug)
    ? visibleMaps.find((map) => map.mapSlug === selectedMap.mapSlug) ?? null
    : null

  return {
    selectedMapAttached,
    currentMapVisible: currentMap !== null,
    currentMapAvailable: currentMap?.availableForSessionMode === true,
    currentMap,
    visibleMapSlugs,
    visibleMaps,
  }
}

export const getPlayerSessionStateUseCase = <TMapDocument = unknown>(
  input: GetPlayerSessionStateInput = {},
  dependencies: GetPlayerSessionStateDependencies<TMapDocument> = {},
): GetPlayerSessionStateUseCaseResult<TMapDocument> => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TMapDocument>
  >)
  const sessionId = normalizeSessionIdForPlayerState(input.sessionId)
  const playerId = normalizePlayerIdForPlayerState(input.playerId)
  const clientId = normalizeClientIdForPlayerState(input.clientId)
  const displayName = normalizeDisplayNameForPlayerState(input.displayName)
  const record = getPlayerReadableSessionRecord(activeStore, sessionId)
  const state = record.state
  const player = getAuthorizedPlayerRecord(state, playerId, displayName)
  assertClientBelongsToPlayerIfPresent(state, playerId, clientId)

  const assignment = findPlayerAssignment(state.assignments, playerId) ?? createEmptyAssignment(player)
  const actor: PlayerSessionActor = {
    role: 'player',
    playerId,
    clientId,
    displayName,
  }

  return {
    session: {
      sessionId: record.sessionId,
      status: record.status,
      revision: record.revision,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.endedAt === undefined ? {} : { endedAt: record.endedAt }),
    },
    player: {
      playerId,
      clientId,
      displayName,
      joinedAt: player.joinedAt,
      updatedAt: player.updatedAt,
      actor,
    },
    assignment: cloneAssignment(assignment),
    visibility: summarizeVisibleMaps(state, assignment),
    record,
    state,
  }
}
