import { describe, expect, it, vi } from 'vitest'
import {
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import {
  canActorControlResource,
  type SessionControllableResourceRef,
} from '#shared/sessionPermissions'
import { incrementSessionRevision, parseSessionRevision } from '#shared/sessionRevisions'
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
  updatePlayerAssignmentUseCase,
  type UpdatePlayerAssignmentInput,
} from '~~/server/useCases/updatePlayerAssignment'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: '1' }
const createdAt = '2026-05-25T10:00:00.000Z'
const joinedAt = '2026-05-25T10:05:00.000Z'
const updatedAt = '2026-05-25T10:20:00.000Z'
const endedAt = '2026-05-25T10:30:00.000Z'

const sessionId = parseSessionId('session_assign000001')
const unknownSessionId = parseSessionId('session_assign000002')
const joinCode = parseJoinCode('ASGN234')
const gmKey = parseGmKey('gmkey_assignabcdefghijklmnopqrstuvwxyz')
const wrongGmKey = parseGmKey('gmkey_wrongassignabcdefghijklmnopqrst')
const gmClientId = parseClientId('client_assignGM1')
const playerId = parsePlayerId('player_assign01')
const missingPlayerId = parsePlayerId('player_missing1')
const playerClientId = parseClientId('client_assignPL1')
const displayName = parseSessionDisplayName('Misty')
const baseRevision = parseSessionRevision(2)

const starmieSheet = {
  kind: 'sheet',
  sheetKind: 'pokemon',
  sheetSlug: 'starmie',
} satisfies SessionControllableResourceRef

const starmieToken = {
  kind: 'token',
  tokenId: 'token-starmie',
  mapSlug: 'viridian-gym',
  sheetKind: 'pokemon',
  sheetSlug: 'starmie',
} satisfies SessionControllableResourceRef

const psyduckToken = {
  kind: 'token',
  tokenId: 'token-psyduck',
  mapSlug: 'viridian-gym',
  sheetKind: 'pokemon',
  sheetSlug: 'psyduck',
} satisfies SessionControllableResourceRef

const defaultInput: UpdatePlayerAssignmentInput = {
  sessionId,
  gmKey,
  gmClientId,
  playerId,
  action: 'assign',
  resources: [starmieSheet, starmieToken],
}

type SnapshotWriter = (
  state: AuthoritativeSessionState,
  options?: WriteSessionSnapshotOptions,
) => WriteSessionSnapshotResult

const createSnapshotWriter = () => vi.fn((
  state: AuthoritativeSessionState,
  options?: WriteSessionSnapshotOptions,
): WriteSessionSnapshotResult => {
  const writtenAt = options?.clock?.() ?? updatedAt
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

const createBaseState = (
  overrides: Partial<Parameters<typeof createAuthoritativeSessionState>[0]> = {},
): AuthoritativeSessionState => createAuthoritativeSessionState({
  sessionId,
  revision: baseRevision,
  connectedClients: [
    {
      clientId: playerClientId,
      actor: {
        role: 'player',
        playerId,
        clientId: playerClientId,
        displayName,
      },
      status: 'connected',
      connectedAt: joinedAt,
      lastSeenAt: joinedAt,
      lastSeenRevision: baseRevision,
    },
  ],
  players: [
    {
      playerId,
      displayName,
      joinedAt,
      updatedAt: joinedAt,
    },
  ],
  assignments: [
    {
      playerId,
      displayName,
      controllableResources: [],
      visibleResources: [],
      updatedAt: joinedAt,
    },
  ],
  createdAt,
  updatedAt: createdAt,
  ...overrides,
})

const createStoreWithSession = (overrides: {
  readonly state?: AuthoritativeSessionState
  readonly includeState?: boolean
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
    ...(overrides.includeState === false ? {} : { state }),
  })

  if (overrides.status === 'ended') {
    store.end(sessionId, { endedAt })
  }

  return store
}

const updateAssignment = (overrides: {
  readonly input?: UpdatePlayerAssignmentInput
  readonly store?: InMemorySessionStore<AuthoritativeSessionState>
  readonly writeSnapshot?: SnapshotWriter
  readonly env?: Record<string, string | undefined>
} = {}) => {
  const store = overrides.store ?? createStoreWithSession()
  const writeSnapshot = overrides.writeSnapshot ?? createSnapshotWriter()

  return updatePlayerAssignmentUseCase(overrides.input ?? defaultInput, {
    env: overrides.env ?? enabledEnv,
    store,
    clock: () => updatedAt,
    writeSnapshot,
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

describe('updatePlayerAssignmentUseCase', () => {
  it('fails closed when session hosting is not explicitly enabled', () => {
    const store = createStoreWithSession()
    const writeSnapshot = createSnapshotWriter()

    expectHttpError(
      () => updateAssignment({ store, writeSnapshot, env: {} }),
      {
        statusCode: 403,
        message: 'live session hosting is disabled. Set ROTOM_ENABLE_SESSION_HOST=1 to enable session endpoints.',
      },
    )

    expect(store.get(sessionId)?.state).toEqual(createBaseState())
    expect(writeSnapshot).not.toHaveBeenCalled()
  })

  it('lets the GM assign player-controllable sheets and tokens', () => {
    const store = createStoreWithSession()
    const writeSnapshot = createSnapshotWriter()
    const nextRevision = incrementSessionRevision(baseRevision)

    const result = updateAssignment({ store, writeSnapshot })

    expect(result.session).toEqual({
      sessionId,
      status: 'active',
      revision: nextRevision,
      createdAt,
      updatedAt,
    })
    expect(result.player).toEqual({
      playerId,
      displayName,
      joinedAt,
      updatedAt: joinedAt,
    })
    expect(result.assignment).toEqual({
      playerId,
      displayName,
      controllableResources: [starmieSheet, starmieToken],
      visibleResources: [starmieSheet, starmieToken],
      updatedAt,
      updatedByClientId: gmClientId,
    })
    expect(result.change).toEqual({
      action: 'assign',
      resources: [starmieSheet, starmieToken],
    })
    expect(result.snapshot).toEqual({
      writtenAt: updatedAt,
      revision: nextRevision,
    })
    expect(result).not.toHaveProperty('gmKey')

    const stored = store.get(sessionId)
    expect(stored).toMatchObject({ revision: nextRevision, updatedAt })
    expect(stored?.state?.assignments).toEqual([result.assignment])
    expect(writeSnapshot).toHaveBeenCalledTimes(1)
    expect(writeSnapshot.mock.calls[0]?.[0]).toEqual(stored?.state)

    const actor = { role: 'player' as const, playerId, clientId: playerClientId, displayName }
    expect(canActorControlResource(actor, [result.assignment], starmieSheet)).toMatchObject({
      allowed: true,
      role: 'player',
    })
    expect(canActorControlResource(actor, [result.assignment], starmieToken)).toMatchObject({
      allowed: true,
      role: 'player',
    })
  })

  it('deduplicates already-assigned resources while preserving unrelated visibility', () => {
    const state = createBaseState({
      assignments: [
        {
          playerId,
          displayName,
          controllableResources: [starmieSheet],
          visibleResources: [{ kind: 'map', mapSlug: 'viridian-gym' }, starmieSheet],
          updatedAt: joinedAt,
        },
      ],
    })
    const store = createStoreWithSession({ state })

    const result = updateAssignment({
      store,
      input: {
        ...defaultInput,
        resources: [starmieSheet, starmieSheet, starmieToken, starmieToken],
      },
    })

    expect(result.assignment.controllableResources).toEqual([starmieSheet, starmieToken])
    expect(result.assignment.visibleResources).toEqual([
      { kind: 'map', mapSlug: 'viridian-gym' },
      starmieSheet,
      starmieToken,
    ])
  })

  it('lets the GM unassign controlled sheets and tokens without removing map visibility', () => {
    const state = createBaseState({
      assignments: [
        {
          playerId,
          displayName,
          controllableResources: [starmieSheet, starmieToken, psyduckToken],
          visibleResources: [
            { kind: 'map', mapSlug: 'viridian-gym' },
            starmieSheet,
            starmieToken,
            psyduckToken,
          ],
          updatedAt: joinedAt,
          updatedByClientId: gmClientId,
        },
      ],
    })
    const store = createStoreWithSession({ state })

    const result = updateAssignment({
      store,
      input: {
        ...defaultInput,
        action: 'unassign',
        resources: [starmieSheet, starmieToken],
      },
    })

    expect(result.assignment).toEqual({
      playerId,
      displayName,
      controllableResources: [psyduckToken],
      visibleResources: [{ kind: 'map', mapSlug: 'viridian-gym' }, psyduckToken],
      updatedAt,
      updatedByClientId: gmClientId,
    })

    const actor = { role: 'player' as const, playerId, clientId: playerClientId, displayName }
    expect(canActorControlResource(actor, [result.assignment], starmieSheet)).toMatchObject({
      allowed: false,
      reason: 'resource-not-visible',
    })
    expect(canActorControlResource(actor, [result.assignment], starmieToken)).toMatchObject({
      allowed: false,
      reason: 'resource-not-assigned',
    })
    expect(canActorControlResource(actor, [result.assignment], psyduckToken)).toMatchObject({
      allowed: true,
      role: 'player',
    })
  })

  it('rejects invalid resources, wrong GM keys, ended sessions, and missing players', () => {
    const store = createStoreWithSession()
    const endedStore = createStoreWithSession({ status: 'ended' })
    const writeSnapshot = createSnapshotWriter()

    expectHttpError(
      () => updateAssignment({
        store,
        writeSnapshot,
        input: { ...defaultInput, resources: [{ kind: 'map', mapSlug: 'viridian-gym' }] },
      }),
      {
        statusCode: 400,
        message: 'resources[0].kind must be sheet or token',
      },
    )
    expectHttpError(
      () => updateAssignment({
        store,
        writeSnapshot,
        input: { ...defaultInput, sessionId: unknownSessionId },
      }),
      {
        statusCode: 404,
        message: 'No live session was found for the supplied session ID',
      },
    )
    expectHttpError(
      () => updateAssignment({
        store,
        writeSnapshot,
        input: { ...defaultInput, gmKey: wrongGmKey },
      }),
      {
        statusCode: 403,
        message: 'The supplied GM key is not authorized to update player assignments for this live session',
      },
    )
    expectHttpError(
      () => updateAssignment({
        store,
        writeSnapshot,
        input: { ...defaultInput, playerId: missingPlayerId },
      }),
      {
        statusCode: 404,
        message: 'No joined player was found for the supplied player ID',
      },
    )
    expectHttpError(
      () => updateAssignment({ store: endedStore, writeSnapshot }),
      {
        statusCode: 409,
        message: 'The live session must be active before player assignments can be changed',
      },
    )

    expect(store.get(sessionId)?.state).toEqual(createBaseState())
    expect(writeSnapshot).not.toHaveBeenCalled()
  })

  it('reports corrupted records without authoritative state', () => {
    const store = createStoreWithSession({ includeState: false })

    expectHttpError(
      () => updateAssignment({ store }),
      {
        statusCode: 500,
        message: 'The live session has no authoritative state available for player assignment updates',
      },
    )
  })

  it('rolls back the in-memory assignment update if the snapshot cannot be written', () => {
    const state = createBaseState()
    const store = createStoreWithSession({ state })
    const writeSnapshot = vi.fn(() => {
      throw new Error('disk full')
    })

    expectHttpError(
      () => updateAssignment({ store, writeSnapshot }),
      {
        statusCode: 500,
        message: 'Failed to write player-assignment session snapshot: disk full',
      },
    )

    const stored = store.get(sessionId)
    expect(stored?.revision).toBe(baseRevision)
    expect(stored?.updatedAt).toBe(createdAt)
    expect(stored?.state).toEqual(state)
  })
})
