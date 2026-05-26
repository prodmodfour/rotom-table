import { describe, expect, it, vi } from 'vitest'
import {
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
  type ClientId,
  type PlayerId,
} from '#shared/sessionIdentity'
import { INITIAL_SESSION_REVISION, incrementSessionRevision } from '#shared/sessionRevisions'
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
import {
  joinPlayerSessionUseCase,
  type JoinPlayerSessionInput,
} from '~~/server/useCases/joinPlayerSession'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: '1' }
const createdAt = '2026-05-25T10:00:00.000Z'
const joinedAt = '2026-05-25T10:05:00.000Z'
const endedAt = '2026-05-25T10:10:00.000Z'

const sessionId = parseSessionId('session_join00000001')
const joinCode = parseJoinCode('PLYR234')
const unknownJoinCode = parseJoinCode('MSS234')
const gmKey = parseGmKey('gmkey_joinabcdefghijklmnopqrstuvwxyz')
const playerId = parsePlayerId('player_join0001')
const nextPlayerId = parsePlayerId('player_join0002')
const existingPlayerId = parsePlayerId('player_existing01')
const clientId = parseClientId('client_join0001')
const nextClientId = parseClientId('client_join0002')
const existingClientId = parseClientId('client_existing1')
const mistyDisplayName = parseSessionDisplayName('Misty Water')
const brockDisplayName = parseSessionDisplayName('Brock')

const defaultInput: JoinPlayerSessionInput = {
  joinCode: ' pl-yr 234 ',
  displayName: '  Misty\n<Water>\t ',
}

type SnapshotWriter = (
  state: AuthoritativeSessionState,
  options?: WriteSessionSnapshotOptions,
) => WriteSessionSnapshotResult

const createSnapshotWriter = () => vi.fn((
  state: AuthoritativeSessionState,
  options?: WriteSessionSnapshotOptions,
): WriteSessionSnapshotResult => {
  const writtenAt = options?.clock?.() ?? joinedAt
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

const createBaseState = (
  overrides: Partial<Parameters<typeof createAuthoritativeSessionState>[0]> = {},
): AuthoritativeSessionState => createAuthoritativeSessionState({
  sessionId,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
})

const createStoreWithSession = (overrides: {
  readonly state?: AuthoritativeSessionState
  readonly status?: 'active' | 'ended'
} = {}): InMemorySessionStore<AuthoritativeSessionState> => {
  const store = createInMemorySessionStore<AuthoritativeSessionState>()
  const state = overrides.state ?? createBaseState()
  store.create({
    sessionId,
    joinCode,
    gmKey,
    revision: state.revision,
    createdAt,
    updatedAt: state.updatedAt,
    state,
  })

  if (overrides.status === 'ended') {
    store.end(sessionId, { endedAt })
  }

  return store
}

const joinSession = (overrides: {
  readonly input?: JoinPlayerSessionInput
  readonly store?: InMemorySessionStore<AuthoritativeSessionState>
  readonly writeSnapshot?: SnapshotWriter
  readonly generatePlayerId?: () => PlayerId
  readonly generateClientId?: () => ClientId
  readonly maxGenerateAttempts?: number
  readonly env?: Record<string, string | undefined>
} = {}) => {
  const store = overrides.store ?? createStoreWithSession()
  const writeSnapshot = overrides.writeSnapshot ?? createSnapshotWriter()

  return joinPlayerSessionUseCase(overrides.input ?? defaultInput, {
    env: overrides.env ?? enabledEnv,
    store,
    clock: () => joinedAt,
    generatePlayerId: overrides.generatePlayerId ?? constantFactory(playerId),
    generateClientId: overrides.generateClientId ?? constantFactory(clientId),
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

describe('joinPlayerSessionUseCase', () => {
  it('fails closed when session hosting is not explicitly enabled', () => {
    const store = createStoreWithSession()
    const writeSnapshot = createSnapshotWriter()

    expectHttpError(
      () => joinSession({ store, writeSnapshot, env: {} }),
      {
        statusCode: 403,
        message: 'live session hosting is disabled. Set ROTOM_ENABLE_SESSION_HOST=1 to enable session endpoints.',
      },
    )
    expect(store.get(sessionId)?.state?.players).toEqual([])
    expect(writeSnapshot).not.toHaveBeenCalled()
  })

  it('joins an active session with a normalized code and sanitized display name', () => {
    const store = createStoreWithSession()
    const writeSnapshot = createSnapshotWriter()

    const result = joinSession({ store, writeSnapshot })
    const nextRevision = incrementSessionRevision(INITIAL_SESSION_REVISION)

    expect(result.session).toEqual({
      sessionId,
      status: 'active',
      revision: nextRevision,
      createdAt,
      updatedAt: joinedAt,
    })
    expect(result.player).toEqual({
      playerId,
      clientId,
      displayName: mistyDisplayName,
      joinedAt,
      actor: {
        role: 'player',
        playerId,
        clientId,
        displayName: mistyDisplayName,
      },
    })
    expect(result.snapshot).toEqual({
      writtenAt: joinedAt,
      revision: nextRevision,
    })

    const stored = store.get(sessionId)
    expect(stored).toMatchObject({
      sessionId,
      joinCode,
      revision: nextRevision,
      status: 'active',
      updatedAt: joinedAt,
    })
    expect(stored?.state?.revision).toBe(nextRevision)
    expect(stored?.state?.updatedAt).toBe(joinedAt)
    expect(stored?.state?.players).toEqual([
      {
        playerId,
        displayName: mistyDisplayName,
        joinedAt,
        updatedAt: joinedAt,
      },
    ])
    expect(stored?.state?.assignments).toEqual([
      {
        playerId,
        displayName: mistyDisplayName,
        controllableResources: [],
        visibleResources: [],
        updatedAt: joinedAt,
      },
    ])
    expect(stored?.state?.connectedClients).toEqual([])
    expect(writeSnapshot).toHaveBeenCalledTimes(1)
    expect(writeSnapshot.mock.calls[0]?.[0]).toEqual(stored?.state)
  })

  it('allows duplicate display names while keeping session-local player IDs distinct', () => {
    const store = createStoreWithSession()

    const first = joinSession({
      store,
      generatePlayerId: constantFactory(playerId),
      generateClientId: constantFactory(clientId),
      input: { joinCode, displayName: 'Misty' },
    })
    const second = joinSession({
      store,
      generatePlayerId: constantFactory(nextPlayerId),
      generateClientId: constantFactory(nextClientId),
      input: { joinCode, displayName: 'Misty' },
    })

    expect(first.player.displayName).toBe('Misty')
    expect(second.player.displayName).toBe('Misty')
    expect(first.player.playerId).not.toBe(second.player.playerId)
    expect(store.get(sessionId)?.state?.players.map((player) => player.playerId)).toEqual([
      playerId,
      nextPlayerId,
    ])
  })

  it('rejects malformed join input before mutating state', () => {
    const store = createStoreWithSession()
    const writeSnapshot = createSnapshotWriter()

    expectHttpError(
      () => joinSession({
        store,
        writeSnapshot,
        input: { joinCode: 'I0I0I0', displayName: 'Ash' },
      }),
      {
        statusCode: 400,
        message: 'joinCode must match /^[A-HJ-NP-Z2-9]{6,12}$/',
      },
    )
    expectHttpError(
      () => joinSession({ store, writeSnapshot, input: { joinCode, displayName: '<> \n\t' } }),
      {
        statusCode: 400,
        message: 'displayName is required',
      },
    )
    expect(store.get(sessionId)?.state?.players).toEqual([])
    expect(writeSnapshot).not.toHaveBeenCalled()
  })

  it('rejects unknown or ended join codes without creating a player identity', () => {
    const activeStore = createStoreWithSession()
    const endedStore = createStoreWithSession({ status: 'ended' })
    const writeSnapshot = createSnapshotWriter()

    expectHttpError(
      () => joinSession({
        store: activeStore,
        writeSnapshot,
        input: { joinCode: unknownJoinCode, displayName: 'Ash' },
      }),
      {
        statusCode: 404,
        message: 'No active live session was found for the supplied join code',
      },
    )
    expectHttpError(
      () => joinSession({
        store: endedStore,
        writeSnapshot,
        input: { joinCode, displayName: 'Ash' },
      }),
      {
        statusCode: 409,
        message: 'The live session for this join code is no longer active',
      },
    )
    expect(activeStore.get(sessionId)?.state?.players).toEqual([])
    expect(endedStore.get(sessionId)?.state?.players).toEqual([])
    expect(writeSnapshot).not.toHaveBeenCalled()
  })

  it('retries generated player and client IDs that already exist in session state', () => {
    const state = createBaseState({
      players: [
        {
          playerId: existingPlayerId,
          displayName: brockDisplayName,
          joinedAt: createdAt,
          updatedAt: createdAt,
        },
      ],
      assignments: [
        {
          playerId: existingPlayerId,
          displayName: brockDisplayName,
          controllableResources: [],
          visibleResources: [],
          updatedAt: createdAt,
        },
      ],
      connectedClients: [
        {
          clientId: existingClientId,
          actor: {
            role: 'player',
            playerId: existingPlayerId,
            clientId: existingClientId,
            displayName: brockDisplayName,
          },
          status: 'disconnected',
          connectedAt: createdAt,
          lastSeenAt: createdAt,
        },
      ],
    })
    const store = createStoreWithSession({ state })

    const result = joinSession({
      store,
      input: { joinCode, displayName: 'Ash' },
      generatePlayerId: queueFactory([existingPlayerId, nextPlayerId]),
      generateClientId: queueFactory([existingClientId, nextClientId]),
    })

    expect(result.player.playerId).toBe(nextPlayerId)
    expect(result.player.clientId).toBe(nextClientId)
    expect(store.get(sessionId)?.state?.players.map((player) => player.playerId)).toEqual([
      existingPlayerId,
      nextPlayerId,
    ])
  })

  it('rolls back the in-memory player join if the snapshot cannot be written', () => {
    const store = createStoreWithSession()
    const writeSnapshot = vi.fn(() => {
      throw new Error('disk full')
    })

    expectHttpError(
      () => joinSession({ store, writeSnapshot }),
      {
        statusCode: 500,
        message: 'Failed to write joined-player session snapshot: disk full',
      },
    )

    const stored = store.get(sessionId)
    expect(stored?.revision).toBe(INITIAL_SESSION_REVISION)
    expect(stored?.updatedAt).toBe(createdAt)
    expect(stored?.state).toEqual(createBaseState())
  })
})
