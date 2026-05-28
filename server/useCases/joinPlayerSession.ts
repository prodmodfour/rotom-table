import {
  normalizeJoinCodeInput,
  parseJoinCode,
  parsePlayerId,
  parseSessionDisplayName,
  sanitizeSessionDisplayNameString,
  type ClientId,
  type JoinCode,
  type PlayerId,
  type SessionDisplayName,
  type SessionId,
} from '#shared/sessionIdentity'
import type { PlayerSessionActor, SessionVisibleResourceRef } from '#shared/sessionPermissions'
import { incrementSessionRevision, type SessionRevision } from '#shared/sessionRevisions'
import {
  findSessionPlayerRecord,
  isSessionMapVisibleByDefaultToPlayers,
  upsertSessionPlayerAssignment,
  upsertSessionPlayerRecord,
  type AuthoritativeSessionState,
  type SessionPlayerRecord,
} from '#shared/sessionState'
import { assertSessionHostEnabled, type SessionHostRuntimeEnv } from '../utils/sessionHosting'
import {
  generateClientId as defaultGenerateClientId,
  generatePlayerId as defaultGeneratePlayerId,
} from '../utils/sessionIdentityGenerators'
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

export class JoinPlayerSessionUseCaseError<TStatusCode extends number = number>
  extends UseCaseHttpError<TStatusCode> {}

export interface JoinPlayerSessionInput {
  /**
   * Legacy/manual join-code override. When omitted, players join the currently
   * running active session on this server.
   */
  readonly joinCode?: unknown
  /** Display name for creating a legacy session-local player identity. */
  readonly displayName?: unknown
  /** Existing session-local player identity to pick in the currently running session. */
  readonly playerId?: unknown
}

export type JoinPlayerSessionClock = () => string
export type JoinPlayerSessionIdFactory<TValue> = () => TValue
export type JoinPlayerSessionSnapshotWriter<TMapDocument = unknown> = (
  state: AuthoritativeSessionState<TMapDocument>,
  options?: WriteSessionSnapshotOptions<TMapDocument>,
) => WriteSessionSnapshotResult<TMapDocument>

export interface JoinPlayerSessionDependencies<TMapDocument = unknown> {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>
  readonly clock?: JoinPlayerSessionClock
  readonly generatePlayerId?: JoinPlayerSessionIdFactory<PlayerId>
  readonly generateClientId?: JoinPlayerSessionIdFactory<ClientId>
  readonly writeSnapshot?: JoinPlayerSessionSnapshotWriter<TMapDocument>
  readonly maxGenerateAttempts?: number
}

export interface JoinedPlayerSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface JoinedPlayerIdentityDetails {
  readonly playerId: PlayerId
  readonly clientId: ClientId
  readonly displayName: SessionDisplayName
  readonly joinedAt: string
  readonly actor: PlayerSessionActor
}

export interface JoinedSessionSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface JoinPlayerSessionUseCaseResult<TMapDocument = unknown> {
  readonly session: JoinedPlayerSessionDetails
  readonly player: JoinedPlayerIdentityDetails
  readonly snapshot: JoinedSessionSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TMapDocument>>
  readonly state: AuthoritativeSessionState<TMapDocument>
}

type JoinableSessionStoreRecord<TMapDocument> = SessionStoreRecord<
  AuthoritativeSessionState<TMapDocument>
> & {
  readonly state: AuthoritativeSessionState<TMapDocument>
}

const DEFAULT_GENERATE_ATTEMPTS = 16

const defaultClock: JoinPlayerSessionClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const normalizeGenerateAttempts = (value: number | undefined): number => {
  const attempts = value ?? DEFAULT_GENERATE_ATTEMPTS
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new JoinPlayerSessionUseCaseError(500, 'maxGenerateAttempts must be a positive integer')
  }
  return attempts
}

const hasJoinCodeInput = (value: unknown): boolean => {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return normalizeJoinCodeInput(value).length > 0
  return true
}

const hasPlayerProfileInput = (value: unknown): boolean => {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  return true
}

const normalizeJoinCodeForJoin = (value: unknown): JoinCode => {
  try {
    return parseJoinCode(value)
  } catch (error) {
    throw new JoinPlayerSessionUseCaseError(400, messageFromError(error))
  }
}

const normalizePlayerIdForProfileSelection = (value: unknown): PlayerId => {
  try {
    return parsePlayerId(value)
  } catch (error) {
    throw new JoinPlayerSessionUseCaseError(400, messageFromError(error))
  }
}

const normalizeDisplayNameForJoin = (value: unknown): SessionDisplayName => {
  if (typeof value !== 'string') {
    throw new JoinPlayerSessionUseCaseError(400, 'displayName is required')
  }

  const sanitized = sanitizeSessionDisplayNameString(value)
  if (sanitized.length === 0) {
    throw new JoinPlayerSessionUseCaseError(400, 'displayName is required')
  }

  try {
    return parseSessionDisplayName(sanitized)
  } catch (error) {
    throw new JoinPlayerSessionUseCaseError(400, messageFromError(error))
  }
}

const allocateUniquePlayerId = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  generatePlayerId: JoinPlayerSessionIdFactory<PlayerId>,
  maxAttempts: number,
): PlayerId => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const playerId = generatePlayerId()
    const playerExists = state.players.some((player) => player.playerId === playerId)
    const assignmentExists = state.assignments.some((assignment) => assignment.playerId === playerId)
    if (!playerExists && !assignmentExists) return playerId
  }

  throw new JoinPlayerSessionUseCaseError(
    503,
    'Unable to allocate a unique player ID for this live session',
  )
}

const allocateUniqueClientId = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  generateClientId: JoinPlayerSessionIdFactory<ClientId>,
  maxAttempts: number,
): ClientId => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const clientId = generateClientId()
    const clientExists = state.connectedClients.some((client) => client.clientId === clientId)
    if (!clientExists) return clientId
  }

  throw new JoinPlayerSessionUseCaseError(
    503,
    'Unable to allocate a unique client ID for this live session',
  )
}

const assertJoinableRecord = <TMapDocument>(
  record: SessionStoreRecord<AuthoritativeSessionState<TMapDocument>>,
  endedMessage: string,
): JoinableSessionStoreRecord<TMapDocument> => {
  if (record.status !== 'active') {
    throw new JoinPlayerSessionUseCaseError(409, endedMessage)
  }

  if (record.state === undefined) {
    throw new JoinPlayerSessionUseCaseError(
      500,
      'The live session has no authoritative state available for player join',
    )
  }

  return record as JoinableSessionStoreRecord<TMapDocument>
}

const getJoinableRecordByCode = <TMapDocument>(
  store: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>,
  joinCode: JoinCode,
): JoinableSessionStoreRecord<TMapDocument> => {
  const record = store.getByJoinCode(joinCode)
  if (record === undefined) {
    throw new JoinPlayerSessionUseCaseError(
      404,
      'No active live session was found for the supplied join code',
    )
  }

  return assertJoinableRecord(record, 'The live session for this join code is no longer active')
}

const getCurrentJoinableRecord = <TMapDocument>(
  store: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>,
): JoinableSessionStoreRecord<TMapDocument> => {
  const activeRecords = store.listActive()
  const record = activeRecords[activeRecords.length - 1]
  if (record === undefined) {
    throw new JoinPlayerSessionUseCaseError(
      404,
      'No active live session is currently running on this server',
    )
  }

  return assertJoinableRecord(record, 'The currently running live session is no longer active')
}

const getJoinableRecord = <TMapDocument>(
  store: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>,
  joinCodeInput: unknown,
): JoinableSessionStoreRecord<TMapDocument> => {
  if (!hasJoinCodeInput(joinCodeInput)) return getCurrentJoinableRecord(store)

  return getJoinableRecordByCode(store, normalizeJoinCodeForJoin(joinCodeInput))
}

const getDefaultVisibleMapResources = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
): readonly SessionVisibleResourceRef[] =>
  state.maps
    .filter(isSessionMapVisibleByDefaultToPlayers)
    .map((map) => ({ kind: 'map' as const, mapSlug: map.mapSlug }))

const createJoinedPlayerState = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  playerId: PlayerId,
  displayName: SessionDisplayName,
  joinedAt: string,
): AuthoritativeSessionState<TMapDocument> => {
  const nextRevision = incrementSessionRevision(state.revision)
  const player: SessionPlayerRecord = {
    playerId,
    displayName,
    joinedAt,
    updatedAt: joinedAt,
  }
  const visibleResources = getDefaultVisibleMapResources(state)

  const withPlayer = upsertSessionPlayerRecord(state, player, {
    revision: nextRevision,
    updatedAt: joinedAt,
  })

  return upsertSessionPlayerAssignment(withPlayer, {
    playerId,
    displayName,
    controllableResources: [],
    visibleResources,
    updatedAt: joinedAt,
  }, {
    revision: nextRevision,
    updatedAt: joinedAt,
  })
}

export const joinPlayerSessionUseCase = <TMapDocument = unknown>(
  input: JoinPlayerSessionInput = {},
  dependencies: JoinPlayerSessionDependencies<TMapDocument> = {},
): JoinPlayerSessionUseCaseResult<TMapDocument> => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TMapDocument>
  >)
  const clock = dependencies.clock ?? defaultClock
  const generatePlayerId = dependencies.generatePlayerId ?? defaultGeneratePlayerId
  const generateClientId = dependencies.generateClientId ?? defaultGenerateClientId
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot
  const maxGenerateAttempts = normalizeGenerateAttempts(dependencies.maxGenerateAttempts)

  const record = getJoinableRecord(activeStore, input.joinCode)
  const currentState = record.state

  if (hasPlayerProfileInput(input.playerId)) {
    const playerId = normalizePlayerIdForProfileSelection(input.playerId)
    const player = findSessionPlayerRecord(currentState.players, playerId)
    if (player === undefined) {
      throw new JoinPlayerSessionUseCaseError(
        404,
        'No joined player profile was found for the supplied player ID',
      )
    }

    if (input.displayName !== undefined && input.displayName !== null) {
      const suppliedDisplayName = normalizeDisplayNameForJoin(input.displayName)
      if (suppliedDisplayName !== player.displayName) {
        throw new JoinPlayerSessionUseCaseError(
          403,
          'The supplied display name does not match the selected player profile',
        )
      }
    }

    const clientId = allocateUniqueClientId(currentState, generateClientId, maxGenerateAttempts)
    const actor: PlayerSessionActor = {
      role: 'player',
      playerId: player.playerId,
      clientId,
      displayName: player.displayName,
    }

    return {
      session: {
        sessionId: record.sessionId,
        status: record.status,
        revision: record.revision,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      },
      player: {
        playerId: player.playerId,
        clientId,
        displayName: player.displayName,
        joinedAt: player.joinedAt,
        actor,
      },
      snapshot: {
        writtenAt: record.updatedAt,
        revision: record.revision,
      },
      record,
      state: currentState,
    }
  }

  const displayName = normalizeDisplayNameForJoin(input.displayName)
  const playerId = allocateUniquePlayerId(currentState, generatePlayerId, maxGenerateAttempts)
  const clientId = allocateUniqueClientId(currentState, generateClientId, maxGenerateAttempts)
  const joinedAt = clock()
  const nextState = createJoinedPlayerState(currentState, playerId, displayName, joinedAt)

  const updatedRecord = activeStore.setState(record.sessionId, nextState, {
    revision: nextState.revision,
    updatedAt: joinedAt,
  })
  if (updatedRecord === undefined) {
    throw new JoinPlayerSessionUseCaseError(
      409,
      'The live session ended before the player could join',
    )
  }

  let snapshot: WriteSessionSnapshotResult<TMapDocument>
  try {
    snapshot = snapshotWriter(nextState, { clock: () => joinedAt })
  } catch (error) {
    activeStore.setState(record.sessionId, currentState, {
      revision: record.revision,
      updatedAt: record.updatedAt,
    })
    throw new JoinPlayerSessionUseCaseError(
      500,
      `Failed to write joined-player session snapshot: ${messageFromError(error)}`,
    )
  }

  const actor: PlayerSessionActor = {
    role: 'player',
    playerId,
    clientId,
    displayName,
  }

  return {
    session: {
      sessionId: updatedRecord.sessionId,
      status: updatedRecord.status,
      revision: updatedRecord.revision,
      createdAt: updatedRecord.createdAt,
      updatedAt: updatedRecord.updatedAt,
    },
    player: {
      playerId,
      clientId,
      displayName,
      joinedAt,
      actor,
    },
    snapshot: {
      writtenAt: snapshot.snapshot.writtenAt,
      revision: snapshot.snapshot.revision,
    },
    record: updatedRecord,
    state: nextState,
  }
}
