import { describe, expect, it, vi } from 'vitest'
import {
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parseSessionId,
  type ClientId,
  type GmKey,
  type JoinCode,
  type SessionId,
} from '#shared/sessionIdentity'
import { INITIAL_SESSION_REVISION } from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionState,
  type AuthoritativeSessionState,
} from '#shared/sessionState'
import { SESSION_HOST_ENABLE_ENV } from '~~/server/utils/sessionHosting'
import {
  SESSION_SNAPSHOT_SCHEMA_VERSION,
  type WriteSessionSnapshotOptions,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import {
  createInMemorySessionStore,
  type InMemorySessionStore,
} from '~~/server/utils/sessionStore'
import { startGmSessionUseCase } from '~~/server/useCases/startGmSession'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: '1' }
const createdAt = '2026-05-25T10:00:00.000Z'
const existingCreatedAt = '2026-05-25T09:00:00.000Z'

const sessionId = parseSessionId('session_start0000001')
const nextSessionId = parseSessionId('session_start0000002')
const existingSessionId = parseSessionId('session_dupe00000001')
const joinCode = parseJoinCode('STRT234')
const nextJoinCode = parseJoinCode('NEXT234')
const existingJoinCode = parseJoinCode('DUPE234')
const gmKey = parseGmKey('gmkey_startabcdefghijklmnopqrstuvwxyz01')
const existingGmKey = parseGmKey('gmkey_existingabcdefghijklmnopqrstuvwxyz')
const gmClientId = parseClientId('client_startGM01')

type SnapshotWriter = (
  state: AuthoritativeSessionState,
  options?: WriteSessionSnapshotOptions,
) => WriteSessionSnapshotResult

const createSnapshotWriter = () => vi.fn((
  state: AuthoritativeSessionState,
  options?: WriteSessionSnapshotOptions,
): WriteSessionSnapshotResult => {
  const writtenAt = options?.clock?.() ?? '2026-05-25T10:00:00.000Z'
  return {
    directoryPath: `/tmp/${state.sessionId}`,
    filePath: `/tmp/${state.sessionId}/snapshot.json`,
    bytesWritten: 1,
    snapshot: {
      schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
      sessionId: state.sessionId,
      revision: state.revision,
      writtenAt,
      state,
    },
  }
})

const constantFactory = <TValue>(value: TValue) => () => value

const queueFactory = <TValue>(values: readonly TValue[]) => {
  let index = 0
  return () => {
    const value = values[Math.min(index, values.length - 1)]
    index += 1
    return value
  }
}

const createExistingState = (): AuthoritativeSessionState =>
  createAuthoritativeSessionState({
    sessionId: existingSessionId,
    createdAt: existingCreatedAt,
    updatedAt: existingCreatedAt,
  })

const startSession = (overrides: {
  readonly store?: InMemorySessionStore<AuthoritativeSessionState>
  readonly writeSnapshot?: SnapshotWriter
  readonly generateSessionId?: () => SessionId
  readonly generateJoinCode?: () => JoinCode
  readonly generateGmKey?: () => GmKey
  readonly generateClientId?: () => ClientId
  readonly maxGenerateAttempts?: number
  readonly env?: Record<string, string | undefined>
} = {}) => {
  const store = overrides.store ?? createInMemorySessionStore<AuthoritativeSessionState>()
  const writeSnapshot = overrides.writeSnapshot ?? createSnapshotWriter()

  return startGmSessionUseCase({}, {
    env: overrides.env ?? enabledEnv,
    store,
    clock: () => createdAt,
    generateSessionId: overrides.generateSessionId ?? constantFactory(sessionId),
    generateJoinCode: overrides.generateJoinCode ?? constantFactory(joinCode),
    generateGmKey: overrides.generateGmKey ?? constantFactory(gmKey),
    generateClientId: overrides.generateClientId ?? constantFactory(gmClientId),
    writeSnapshot,
    maxGenerateAttempts: overrides.maxGenerateAttempts,
  })
}

const expectHttpError = (
  action: () => unknown,
  expected: { readonly statusCode: number; readonly message: string },
) => {
  let thrown: unknown
  try {
    action()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toMatchObject(expected)
}

describe('startGmSessionUseCase', () => {
  it('fails closed when session hosting is not explicitly enabled', () => {
    const store = createInMemorySessionStore<AuthoritativeSessionState>()
    const writeSnapshot = createSnapshotWriter()

    expectHttpError(
      () => startSession({ store, writeSnapshot, env: {} }),
      {
        statusCode: 403,
        message: 'Track 2 session hosting is disabled. Set ROTOM_ENABLE_SESSION_HOST=1 to enable session endpoints.',
      },
    )
    expect(store.size).toBe(0)
    expect(writeSnapshot).not.toHaveBeenCalled()
  })

  it('creates an active authoritative session and returns GM/join details', () => {
    const store = createInMemorySessionStore<AuthoritativeSessionState>()
    const writeSnapshot = createSnapshotWriter()

    const result = startSession({ store, writeSnapshot })

    expect(result.session).toEqual({
      sessionId,
      status: 'active',
      revision: INITIAL_SESSION_REVISION,
      createdAt,
      updatedAt: createdAt,
    })
    expect(result.gm).toEqual({ gmKey, clientId: gmClientId })
    expect(result.join).toEqual({ joinCode })
    expect(result.snapshot).toEqual({
      writtenAt: createdAt,
      revision: INITIAL_SESSION_REVISION,
    })

    const stored = store.get(sessionId)
    expect(stored).toMatchObject({
      sessionId,
      joinCode,
      gmKey,
      revision: INITIAL_SESSION_REVISION,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    })
    expect(stored?.state).toEqual({
      schemaVersion: 1,
      sessionId,
      revision: INITIAL_SESSION_REVISION,
      selectedMapSlug: null,
      maps: [],
      connectedClients: [],
      players: [],
      assignments: [],
      createdAt,
      updatedAt: createdAt,
    })
    expect(store.getByJoinCode(joinCode)?.sessionId).toBe(sessionId)
    expect(writeSnapshot).toHaveBeenCalledTimes(1)
    expect(writeSnapshot.mock.calls[0]?.[0]).toEqual(stored?.state)
  })

  it('retries generated session IDs and join codes that are already present', () => {
    const store = createInMemorySessionStore<AuthoritativeSessionState>()
    store.create({
      sessionId: existingSessionId,
      joinCode: existingJoinCode,
      gmKey: existingGmKey,
      createdAt: existingCreatedAt,
      updatedAt: existingCreatedAt,
      state: createExistingState(),
    })

    const result = startSession({
      store,
      generateSessionId: queueFactory([existingSessionId, nextSessionId]),
      generateJoinCode: queueFactory([existingJoinCode, nextJoinCode]),
    })

    expect(result.session.sessionId).toBe(nextSessionId)
    expect(result.join.joinCode).toBe(nextJoinCode)
    expect(store.get(existingSessionId)?.joinCode).toBe(existingJoinCode)
    expect(store.get(nextSessionId)?.joinCode).toBe(nextJoinCode)
  })

  it('reports allocation failure when unique session IDs cannot be generated', () => {
    const store = createInMemorySessionStore<AuthoritativeSessionState>()
    const writeSnapshot = createSnapshotWriter()
    store.create({
      sessionId: existingSessionId,
      joinCode: existingJoinCode,
      gmKey: existingGmKey,
      createdAt: existingCreatedAt,
      updatedAt: existingCreatedAt,
      state: createExistingState(),
    })

    expectHttpError(
      () => startSession({
        store,
        writeSnapshot,
        generateSessionId: constantFactory(existingSessionId),
        maxGenerateAttempts: 2,
      }),
      {
        statusCode: 503,
        message: 'Unable to allocate a unique session ID for a new table session',
      },
    )
    expect(store.size).toBe(1)
    expect(writeSnapshot).not.toHaveBeenCalled()
  })

  it('rolls back the in-memory session if the initial snapshot cannot be written', () => {
    const store = createInMemorySessionStore<AuthoritativeSessionState>()
    const writeSnapshot = vi.fn(() => {
      throw new Error('disk full')
    })

    expectHttpError(
      () => startSession({ store, writeSnapshot }),
      {
        statusCode: 500,
        message: 'Failed to write initial session snapshot: disk full',
      },
    )
    expect(store.get(sessionId)).toBeUndefined()
    expect(store.getByJoinCode(joinCode)).toBeUndefined()
    expect(store.size).toBe(0)
  })
})
