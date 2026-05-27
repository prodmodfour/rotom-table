import { describe, expect, it, vi } from 'vitest'
import {
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
  type ClientId,
  type GmKey,
  type JoinCode,
  type PlayerId,
  type SessionId,
} from '#shared/sessionIdentity'
import {
  canActorControlResource,
  type SessionControllableResourceRef,
} from '#shared/sessionPermissions'
import { INITIAL_SESSION_REVISION, parseSessionRevision } from '#shared/sessionRevisions'
import type { AuthoritativeSessionState } from '#shared/sessionState'
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
  getGmSessionManagementUseCase,
  type GetGmSessionManagementInput,
} from '~~/server/useCases/getGmSessionManagement'
import {
  getPlayerSessionProfilesUseCase,
} from '~~/server/useCases/getPlayerSessionProfiles'
import {
  getPlayerSessionStateUseCase,
  type GetPlayerSessionStateInput,
} from '~~/server/useCases/getPlayerSessionState'
import {
  joinPlayerSessionUseCase,
  type JoinPlayerSessionInput,
} from '~~/server/useCases/joinPlayerSession'
import { startGmSessionUseCase } from '~~/server/useCases/startGmSession'
import {
  updatePlayerAssignmentUseCase,
  type UpdatePlayerAssignmentInput,
} from '~~/server/useCases/updatePlayerAssignment'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: '1' }
const disabledEnv: Record<string, string | undefined> = {}

const startedAt = '2026-05-26T13:00:00.000Z'
const firstJoinedAt = '2026-05-26T13:05:00.000Z'
const secondJoinedAt = '2026-05-26T13:06:00.000Z'
const assignedAt = '2026-05-26T13:10:00.000Z'

const sessionId = parseSessionId('session_lobbyflow001')
const joinCode = parseJoinCode('LBY234')
const unknownJoinCode = parseJoinCode('MSS234')
const gmKey = parseGmKey('gmkey_lobbyabcdefghijklmnopqrstuvwxyz')
const wrongGmKey = parseGmKey('gmkey_wronglobbyabcdefghijklmnopqr')
const gmClientId = parseClientId('client_lobbyGM1')
const firstPlayerId = parsePlayerId('player_lobby001')
const secondPlayerId = parsePlayerId('player_lobby002')
const missingPlayerId = parsePlayerId('player_lobby999')
const firstClientId = parseClientId('client_lobbyP01')
const secondClientId = parseClientId('client_lobbyP02')
const pickedProfileClientId = parseClientId('client_lobbyP03')
const duplicateDisplayName = parseSessionDisplayName('Misty')

const pikachuSheet = {
  kind: 'sheet',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} satisfies SessionControllableResourceRef

const pikachuToken = {
  kind: 'token',
  tokenId: 'token-pikachu',
  mapSlug: 'training-yard',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} satisfies SessionControllableResourceRef

type SnapshotWriter = (
  state: AuthoritativeSessionState,
  options?: WriteSessionSnapshotOptions,
) => WriteSessionSnapshotResult

const createSnapshotWriter = () => vi.fn((
  state: AuthoritativeSessionState,
  options?: WriteSessionSnapshotOptions,
): WriteSessionSnapshotResult => {
  const writtenAt = options?.clock?.() ?? assignedAt
  return {
    directoryPath: `/tmp/${state.sessionId}`,
    filePath: `/tmp/${state.sessionId}/snapshot.json`,
    bytesWritten: JSON.stringify(state).length,
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

const createLobbyHarness = () => {
  const store = createInMemorySessionStore<AuthoritativeSessionState>()
  const writeSnapshot = createSnapshotWriter()
  const clock = queueFactory([startedAt, firstJoinedAt, secondJoinedAt, assignedAt])

  return { store, writeSnapshot, clock }
}

const startLobbySession = (
  store: InMemorySessionStore<AuthoritativeSessionState>,
  writeSnapshot: SnapshotWriter,
  clock: () => string = () => startedAt,
) => startGmSessionUseCase({}, {
  env: enabledEnv,
  store,
  clock,
  generateSessionId: constantFactory<SessionId>(sessionId),
  generateJoinCode: constantFactory<JoinCode>(joinCode),
  generateGmKey: constantFactory<GmKey>(gmKey),
  generateClientId: constantFactory<ClientId>(gmClientId),
  writeSnapshot,
})

const joinLobbyPlayer = (
  store: InMemorySessionStore<AuthoritativeSessionState>,
  writeSnapshot: SnapshotWriter,
  clock: () => string,
  input: JoinPlayerSessionInput,
  playerId: PlayerId,
  clientId: ClientId,
) => joinPlayerSessionUseCase(input, {
  env: enabledEnv,
  store,
  clock,
  generatePlayerId: constantFactory(playerId),
  generateClientId: constantFactory(clientId),
  writeSnapshot,
})

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

describe('Live session join/lobby endpoint flow coverage', () => {
  it('covers start, duplicate-name joins, GM management, player state, and assignment permissions together', () => {
    const { store, writeSnapshot, clock } = createLobbyHarness()

    const start = startLobbySession(store, writeSnapshot, clock)
    const firstJoin = joinLobbyPlayer(
      store,
      writeSnapshot,
      clock,
      { displayName: 'Misty' },
      firstPlayerId,
      firstClientId,
    )
    const secondJoin = joinLobbyPlayer(
      store,
      writeSnapshot,
      clock,
      { joinCode, displayName: 'Misty' },
      secondPlayerId,
      secondClientId,
    )

    expect(start.session.revision).toBe(INITIAL_SESSION_REVISION)
    expect(firstJoin.session.revision).toBe(parseSessionRevision(1))
    expect(secondJoin.session.revision).toBe(parseSessionRevision(2))
    expect(firstJoin.player).toMatchObject({
      playerId: firstPlayerId,
      clientId: firstClientId,
      displayName: duplicateDisplayName,
    })
    expect(secondJoin.player).toMatchObject({
      playerId: secondPlayerId,
      clientId: secondClientId,
      displayName: duplicateDisplayName,
    })
    expect(firstJoin.player.playerId).not.toBe(secondJoin.player.playerId)

    const playerProfiles = getPlayerSessionProfilesUseCase({ env: enabledEnv, store })
    expect(playerProfiles.session).toMatchObject({
      sessionId,
      revision: parseSessionRevision(2),
    })
    expect(playerProfiles.profiles.map((profile) => profile.playerId)).toEqual([
      firstPlayerId,
      secondPlayerId,
    ])
    expect(playerProfiles.profiles.map((profile) => profile.displayName)).toEqual([
      duplicateDisplayName,
      duplicateDisplayName,
    ])
    expect(playerProfiles).not.toHaveProperty('join')
    expect(playerProfiles).not.toHaveProperty('gmKey')
    expect(JSON.stringify(playerProfiles)).not.toContain(String(gmKey))
    expect(JSON.stringify(playerProfiles)).not.toContain(String(joinCode))

    const pickedProfile = joinLobbyPlayer(
      store,
      writeSnapshot,
      clock,
      { playerId: firstPlayerId },
      secondPlayerId,
      pickedProfileClientId,
    )
    expect(pickedProfile.player).toMatchObject({
      playerId: firstPlayerId,
      clientId: pickedProfileClientId,
      displayName: duplicateDisplayName,
    })
    expect(pickedProfile.session.revision).toBe(parseSessionRevision(2))

    const managementAfterJoins = getGmSessionManagementUseCase({ sessionId, gmKey }, {
      env: enabledEnv,
      store,
    })
    expect(managementAfterJoins.session).toMatchObject({
      sessionId,
      revision: parseSessionRevision(2),
      playerCount: 2,
      assignmentCount: 2,
      connectedClientCount: 0,
    })
    expect(managementAfterJoins.join.joinCode).toBe(joinCode)
    expect(managementAfterJoins.players.map((player) => player.displayName)).toEqual([
      duplicateDisplayName,
      duplicateDisplayName,
    ])
    expect(managementAfterJoins.players.map((player) => player.playerId)).toEqual([
      firstPlayerId,
      secondPlayerId,
    ])
    expect(managementAfterJoins).not.toHaveProperty('gmKey')

    const firstStateBeforeAssignment = getPlayerSessionStateUseCase({
      sessionId,
      playerId: firstPlayerId,
      clientId: firstClientId,
      displayName: duplicateDisplayName,
    }, {
      env: enabledEnv,
      store,
    })
    expect(firstStateBeforeAssignment.assignment.controllableResources).toEqual([])
    expect(firstStateBeforeAssignment.visibility).toEqual({
      selectedMapAttached: false,
      currentMapVisible: false,
      currentMapAvailable: false,
      currentMap: null,
      visibleMapSlugs: [],
      visibleMaps: [],
    })
    expect(firstStateBeforeAssignment).not.toHaveProperty('join')
    expect(firstStateBeforeAssignment).not.toHaveProperty('gmKey')
    expect(firstStateBeforeAssignment).not.toHaveProperty('players')

    const assignment = updatePlayerAssignmentUseCase({
      sessionId,
      gmKey,
      gmClientId,
      playerId: firstPlayerId,
      action: 'assign',
      resources: [pikachuSheet, pikachuToken],
    }, {
      env: enabledEnv,
      store,
      clock,
      writeSnapshot,
    })
    expect(assignment.session.revision).toBe(parseSessionRevision(3))
    expect(assignment.assignment.controllableResources).toEqual([pikachuSheet, pikachuToken])
    expect(assignment.assignment.visibleResources).toEqual([pikachuSheet, pikachuToken])
    expect(assignment).not.toHaveProperty('gmKey')

    const firstStateAfterAssignment = getPlayerSessionStateUseCase({
      sessionId,
      playerId: firstPlayerId,
      clientId: firstClientId,
      displayName: duplicateDisplayName,
    }, {
      env: enabledEnv,
      store,
    })
    const secondStateAfterAssignment = getPlayerSessionStateUseCase({
      sessionId,
      playerId: secondPlayerId,
      clientId: secondClientId,
      displayName: duplicateDisplayName,
    }, {
      env: enabledEnv,
      store,
    })

    expect(firstStateAfterAssignment.session.revision).toBe(parseSessionRevision(3))
    expect(firstStateAfterAssignment.assignment.controllableResources).toEqual([pikachuSheet, pikachuToken])
    expect(secondStateAfterAssignment.assignment.controllableResources).toEqual([])

    expect(canActorControlResource(
      firstStateAfterAssignment.player.actor,
      [firstStateAfterAssignment.assignment],
      pikachuToken,
    )).toMatchObject({ allowed: true, role: 'player' })
    expect(canActorControlResource(
      secondStateAfterAssignment.player.actor,
      [secondStateAfterAssignment.assignment],
      pikachuToken,
    )).toMatchObject({ allowed: false, reason: 'resource-not-visible' })

    const managementAfterAssignment = getGmSessionManagementUseCase({ sessionId, gmKey }, {
      env: enabledEnv,
      store,
    })
    expect(managementAfterAssignment.session).toMatchObject({
      revision: parseSessionRevision(3),
      playerCount: 2,
      assignmentCount: 2,
    })
    expect(managementAfterAssignment.assignments).toEqual([
      firstStateAfterAssignment.assignment,
      secondStateAfterAssignment.assignment,
    ])
    expect(writeSnapshot).toHaveBeenCalledTimes(4)
  })

  it('rejects invalid join codes and unauthorized assignment attempts without mutating lobby state', () => {
    const { store, writeSnapshot, clock } = createLobbyHarness()
    startLobbySession(store, writeSnapshot, clock)

    expectHttpError(
      () => joinPlayerSessionUseCase({ joinCode: 'I0I0I0', displayName: 'Misty' }, {
        env: enabledEnv,
        store,
        clock,
        generatePlayerId: constantFactory(firstPlayerId),
        generateClientId: constantFactory(firstClientId),
        writeSnapshot,
      }),
      {
        statusCode: 400,
        message: 'joinCode must match /^[A-HJ-NP-Z2-9]{6,12}$/',
      },
    )
    expectHttpError(
      () => joinPlayerSessionUseCase({ joinCode: unknownJoinCode, displayName: 'Misty' }, {
        env: enabledEnv,
        store,
        clock,
        generatePlayerId: constantFactory(firstPlayerId),
        generateClientId: constantFactory(firstClientId),
        writeSnapshot,
      }),
      {
        statusCode: 404,
        message: 'No active live session was found for the supplied join code',
      },
    )
    expect(store.get(sessionId)?.state?.players).toEqual([])
    expect(writeSnapshot).toHaveBeenCalledTimes(1)

    joinLobbyPlayer(
      store,
      writeSnapshot,
      clock,
      { joinCode, displayName: 'Misty' },
      firstPlayerId,
      firstClientId,
    )
    const revisionAfterJoin = store.get(sessionId)?.revision

    expectHttpError(
      () => updatePlayerAssignmentUseCase({
        sessionId,
        gmKey: wrongGmKey,
        gmClientId,
        playerId: firstPlayerId,
        action: 'assign',
        resources: [pikachuSheet],
      }, {
        env: enabledEnv,
        store,
        clock,
        writeSnapshot,
      }),
      {
        statusCode: 403,
        message: 'The supplied GM key is not authorized to update player assignments for this live session',
      },
    )
    expectHttpError(
      () => updatePlayerAssignmentUseCase({
        sessionId,
        gmKey,
        gmClientId,
        playerId: missingPlayerId,
        action: 'assign',
        resources: [pikachuSheet],
      }, {
        env: enabledEnv,
        store,
        clock,
        writeSnapshot,
      }),
      {
        statusCode: 404,
        message: 'No joined player was found for the supplied player ID',
      },
    )
    expectHttpError(
      () => updatePlayerAssignmentUseCase({
        sessionId,
        gmKey,
        gmClientId,
        playerId: firstPlayerId,
        action: 'assign',
        resources: [{ kind: 'map', mapSlug: 'training-yard' }],
      }, {
        env: enabledEnv,
        store,
        clock,
        writeSnapshot,
      }),
      {
        statusCode: 400,
        message: 'resources[0].kind must be sheet or token',
      },
    )

    const playerState = getPlayerSessionStateUseCase({
      sessionId,
      playerId: firstPlayerId,
      clientId: firstClientId,
      displayName: duplicateDisplayName,
    }, {
      env: enabledEnv,
      store,
    })
    expect(store.get(sessionId)?.revision).toBe(revisionAfterJoin)
    expect(playerState.assignment.controllableResources).toEqual([])
    expect(writeSnapshot).toHaveBeenCalledTimes(2)
  })

  it('fails closed across start, join, management, player-state, and assignment endpoints when hosting is disabled', () => {
    const { store, writeSnapshot } = createLobbyHarness()
    startLobbySession(store, writeSnapshot)
    joinLobbyPlayer(
      store,
      writeSnapshot,
      () => firstJoinedAt,
      { joinCode, displayName: 'Misty' },
      firstPlayerId,
      firstClientId,
    )
    writeSnapshot.mockClear()

    const cases: readonly {
      readonly name: string
      readonly action: () => unknown
    }[] = [
      {
        name: 'start',
        action: () => startGmSessionUseCase({}, {
          env: disabledEnv,
          store: createInMemorySessionStore<AuthoritativeSessionState>(),
          writeSnapshot,
          generateSessionId: constantFactory(sessionId),
          generateJoinCode: constantFactory(joinCode),
          generateGmKey: constantFactory(gmKey),
          generateClientId: constantFactory(gmClientId),
        }),
      },
      {
        name: 'join',
        action: () => joinPlayerSessionUseCase({ joinCode, displayName: 'Misty' }, {
          env: disabledEnv,
          store,
          writeSnapshot,
          generatePlayerId: constantFactory(secondPlayerId),
          generateClientId: constantFactory(secondClientId),
        }),
      },
      {
        name: 'management',
        action: () => getGmSessionManagementUseCase({ sessionId, gmKey } satisfies GetGmSessionManagementInput, {
          env: disabledEnv,
          store,
        }),
      },
      {
        name: 'player-profiles',
        action: () => getPlayerSessionProfilesUseCase({
          env: disabledEnv,
          store,
        }),
      },
      {
        name: 'player-state',
        action: () => getPlayerSessionStateUseCase({
          sessionId,
          playerId: firstPlayerId,
          clientId: firstClientId,
          displayName: duplicateDisplayName,
        } satisfies GetPlayerSessionStateInput, {
          env: disabledEnv,
          store,
        }),
      },
      {
        name: 'assignment',
        action: () => updatePlayerAssignmentUseCase({
          sessionId,
          gmKey,
          gmClientId,
          playerId: firstPlayerId,
          action: 'assign',
          resources: [pikachuSheet],
        } satisfies UpdatePlayerAssignmentInput, {
          env: disabledEnv,
          store,
          writeSnapshot,
        }),
      },
    ]

    for (const { name, action } of cases) {
      expectHttpError(action, {
        statusCode: 403,
        message: 'live session hosting is disabled. Set ROTOM_ENABLE_SESSION_HOST=1 to enable session endpoints.',
      })
      expect(name).toBeTruthy()
    }

    expect(store.get(sessionId)?.state?.players).toHaveLength(1)
    expect(store.get(sessionId)?.state?.assignments[0]?.controllableResources).toEqual([])
    expect(writeSnapshot).not.toHaveBeenCalled()
  })
})
