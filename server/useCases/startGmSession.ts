import type { ClientId, GmKey, JoinCode, SessionId } from '#shared/sessionIdentity'
import { INITIAL_SESSION_REVISION, type SessionRevision } from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionState,
  type AuthoritativeSessionState,
} from '#shared/sessionState'
import { assertSessionHostEnabled, type SessionHostRuntimeEnv } from '../utils/sessionHosting'
import {
  generateClientId as defaultGenerateClientId,
  generateGmKey as defaultGenerateGmKey,
  generateJoinCode as defaultGenerateJoinCode,
  generateSessionId as defaultGenerateSessionId,
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

export class StartGmSessionUseCaseError<TStatusCode extends number = number>
  extends UseCaseHttpError<TStatusCode> {}

export type StartGmSessionClock = () => string
export type StartGmSessionIdFactory<TValue> = () => TValue
export type StartGmSessionSnapshotWriter<TMapDocument = unknown> = (
  state: AuthoritativeSessionState<TMapDocument>,
  options?: WriteSessionSnapshotOptions<TMapDocument>,
) => WriteSessionSnapshotResult<TMapDocument>

export interface StartGmSessionInput {}

export interface StartGmSessionDependencies<TMapDocument = unknown> {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>
  readonly clock?: StartGmSessionClock
  readonly generateSessionId?: StartGmSessionIdFactory<SessionId>
  readonly generateJoinCode?: StartGmSessionIdFactory<JoinCode>
  readonly generateGmKey?: StartGmSessionIdFactory<GmKey>
  readonly generateClientId?: StartGmSessionIdFactory<ClientId>
  readonly writeSnapshot?: StartGmSessionSnapshotWriter<TMapDocument>
  readonly maxGenerateAttempts?: number
}

export interface StartedGmSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface StartedGmIdentityDetails {
  readonly gmKey: GmKey
  readonly clientId: ClientId
}

export interface StartedSessionJoinDetails {
  readonly joinCode: JoinCode
}

export interface StartedSessionSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface StartGmSessionUseCaseResult<TMapDocument = unknown> {
  readonly session: StartedGmSessionDetails
  readonly gm: StartedGmIdentityDetails
  readonly join: StartedSessionJoinDetails
  readonly snapshot: StartedSessionSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TMapDocument>>
  readonly state: AuthoritativeSessionState<TMapDocument>
}

const DEFAULT_GENERATE_ATTEMPTS = 16

const defaultClock: StartGmSessionClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const normalizeGenerateAttempts = (value: number | undefined): number => {
  const attempts = value ?? DEFAULT_GENERATE_ATTEMPTS
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new StartGmSessionUseCaseError(500, 'maxGenerateAttempts must be a positive integer')
  }
  return attempts
}

const allocateUniqueSessionId = <TMapDocument>(
  store: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>,
  generateSessionId: StartGmSessionIdFactory<SessionId>,
  maxAttempts: number,
): SessionId => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const sessionId = generateSessionId()
    if (!store.has(sessionId)) return sessionId
  }

  throw new StartGmSessionUseCaseError(
    503,
    'Unable to allocate a unique session ID for a new live session',
  )
}

const allocateUniqueJoinCode = <TMapDocument>(
  store: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>,
  generateJoinCode: StartGmSessionIdFactory<JoinCode>,
  maxAttempts: number,
): JoinCode => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const joinCode = generateJoinCode()
    if (store.getByJoinCode(joinCode) === undefined) return joinCode
  }

  throw new StartGmSessionUseCaseError(
    503,
    'Unable to allocate a unique player join code for a new live session',
  )
}

export const startGmSessionUseCase = <TMapDocument = unknown>(
  _input: StartGmSessionInput = {},
  dependencies: StartGmSessionDependencies<TMapDocument> = {},
): StartGmSessionUseCaseResult<TMapDocument> => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TMapDocument>
  >)
  const clock = dependencies.clock ?? defaultClock
  const generateSessionId = dependencies.generateSessionId ?? defaultGenerateSessionId
  const generateJoinCode = dependencies.generateJoinCode ?? defaultGenerateJoinCode
  const generateGmKey = dependencies.generateGmKey ?? defaultGenerateGmKey
  const generateClientId = dependencies.generateClientId ?? defaultGenerateClientId
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot
  const maxGenerateAttempts = normalizeGenerateAttempts(dependencies.maxGenerateAttempts)

  const sessionId = allocateUniqueSessionId(activeStore, generateSessionId, maxGenerateAttempts)
  const joinCode = allocateUniqueJoinCode(activeStore, generateJoinCode, maxGenerateAttempts)
  const gmKey = generateGmKey()
  const gmClientId = generateClientId()
  const createdAt = clock()
  const state = createAuthoritativeSessionState<TMapDocument>({
    sessionId,
    createdAt,
    updatedAt: createdAt,
    revision: INITIAL_SESSION_REVISION,
  })

  const record = activeStore.create({
    sessionId,
    joinCode,
    gmKey,
    revision: state.revision,
    createdAt,
    updatedAt: createdAt,
    state,
  })

  let snapshot: WriteSessionSnapshotResult<TMapDocument>
  try {
    snapshot = snapshotWriter(state, { clock: () => createdAt })
  } catch (error) {
    activeStore.delete(sessionId)
    throw new StartGmSessionUseCaseError(
      500,
      `Failed to write initial session snapshot: ${messageFromError(error)}`,
    )
  }

  return {
    session: {
      sessionId,
      status: record.status,
      revision: record.revision,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    gm: {
      gmKey,
      clientId: gmClientId,
    },
    join: {
      joinCode,
    },
    snapshot: {
      writtenAt: snapshot.snapshot.writtenAt,
      revision: snapshot.snapshot.revision,
    },
    record,
    state,
  }
}
