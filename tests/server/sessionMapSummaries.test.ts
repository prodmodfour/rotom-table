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
import { INITIAL_MAP_REVISION, INITIAL_SESSION_REVISION, parseSessionRevision } from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
  type AuthoritativeSessionState,
  type SessionMapSlug,
} from '#shared/sessionState'
import { SESSION_HOST_ENABLE_ENV } from '~~/server/utils/sessionHosting'
import {
  SESSION_SNAPSHOT_SCHEMA_VERSION,
  type WriteSessionSnapshotOptions,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'
import { getGmSessionManagementUseCase } from '~~/server/useCases/getGmSessionManagement'
import { getPlayerSessionStateUseCase } from '~~/server/useCases/getPlayerSessionState'
import { joinPlayerSessionUseCase } from '~~/server/useCases/joinPlayerSession'
import { startGmSessionUseCase } from '~~/server/useCases/startGmSession'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: '1' }
const startedAt = '2026-05-26T15:00:00.000Z'
const joinedAt = '2026-05-26T15:05:00.000Z'
const attachedAt = '2026-05-26T15:10:00.000Z'

const sessionId = parseSessionId('session_mapsummary01')
const joinCode = parseJoinCode('MAP234')
const gmKey = parseGmKey('gmkey_mapsummaryabcdefghijklmnopqr')
const gmClientId = parseClientId('client_mapsummarygm')
const playerId = parsePlayerId('player_mapsummary01')
const playerClientId = parseClientId('client_mapsummaryp1')
const displayName = parseSessionDisplayName('Riley')
const mapSlug = 'summary-session-map' as SessionMapSlug

type TestMapDocument = {
  readonly slug: string
  readonly name: string
  readonly placements: readonly unknown[]
}

type SnapshotWriter = (
  state: AuthoritativeSessionState<TestMapDocument>,
  options?: WriteSessionSnapshotOptions<TestMapDocument>,
) => WriteSessionSnapshotResult<TestMapDocument>

const constantFactory = <TValue>(value: TValue) => () => value

const queueFactory = <TValue>(values: readonly TValue[]) => {
  let index = 0
  return () => {
    const value = values[Math.min(index, values.length - 1)]
    index += 1
    return value
  }
}

const createSnapshotWriter = (): SnapshotWriter => vi.fn((
  state: AuthoritativeSessionState<TestMapDocument>,
  options?: WriteSessionSnapshotOptions<TestMapDocument>,
): WriteSessionSnapshotResult<TestMapDocument> => {
  const writtenAt = options?.clock?.() ?? state.updatedAt
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

describe('live session map summaries', () => {
  it('updates GM management and player-state summaries before and after a session map is available', () => {
    const store = createInMemorySessionStore<AuthoritativeSessionState<TestMapDocument>>()
    const writeSnapshot = createSnapshotWriter()
    const clock = queueFactory([startedAt, joinedAt, attachedAt])

    startGmSessionUseCase<TestMapDocument>({}, {
      env: enabledEnv,
      store,
      clock,
      generateSessionId: constantFactory<SessionId>(sessionId),
      generateJoinCode: constantFactory<JoinCode>(joinCode),
      generateGmKey: constantFactory<GmKey>(gmKey),
      generateClientId: constantFactory<ClientId>(gmClientId),
      writeSnapshot,
    })
    joinPlayerSessionUseCase<TestMapDocument>({ joinCode, displayName }, {
      env: enabledEnv,
      store,
      clock,
      generatePlayerId: constantFactory<PlayerId>(playerId),
      generateClientId: constantFactory<ClientId>(playerClientId),
      writeSnapshot,
    })

    const managementBeforeAttach = getGmSessionManagementUseCase<TestMapDocument>({ sessionId, gmKey }, {
      env: enabledEnv,
      store,
    })
    const playerBeforeAttach = getPlayerSessionStateUseCase<TestMapDocument>({
      sessionId,
      playerId,
      clientId: playerClientId,
      displayName,
    }, {
      env: enabledEnv,
      store,
    })

    expect(managementBeforeAttach.session).toMatchObject({
      selectedMapSlug: null,
      selectedMapRevision: null,
      selectedMapAttached: false,
      sessionMapAvailable: false,
      mapCount: 0,
      playerCount: 1,
      assignmentCount: 1,
    })
    expect(managementBeforeAttach.selectedMap).toBeNull()
    expect(managementBeforeAttach.maps).toEqual([])
    expect(playerBeforeAttach.visibility).toEqual({
      selectedMapAttached: false,
      currentMapVisible: false,
      currentMapAvailable: false,
      currentMap: null,
      visibleMapSlugs: [],
      visibleMaps: [],
    })

    const currentState = store.get(sessionId)?.state
    if (currentState === undefined) throw new Error('expected active test session state')
    const sessionMapState = createAuthoritativeSessionState<TestMapDocument>({
      sessionId,
      revision: parseSessionRevision(2),
      selectedMapSlug: mapSlug,
      maps: [
        createAuthoritativeSessionMapState<TestMapDocument>({
          mapSlug,
          revision: INITIAL_MAP_REVISION,
          playerVisibleByDefault: true,
          document: { slug: mapSlug, name: 'Summary Session Map', placements: [] },
        }),
      ],
      connectedClients: currentState.connectedClients,
      players: currentState.players,
      assignments: [
        {
          playerId,
          displayName,
          controllableResources: [],
          visibleResources: [{ kind: 'map', mapSlug }],
          updatedAt: attachedAt,
          updatedByClientId: gmClientId,
        },
      ],
      createdAt: currentState.createdAt,
      updatedAt: attachedAt,
    })
    expect(store.setState(sessionId, sessionMapState, {
      revision: sessionMapState.revision,
      updatedAt: attachedAt,
    })?.revision).toBe(sessionMapState.revision)
    writeSnapshot(sessionMapState, { clock: () => attachedAt })

    const managementAfterAttach = getGmSessionManagementUseCase<TestMapDocument>({ sessionId, gmKey }, {
      env: enabledEnv,
      store,
    })
    const playerAfterAttach = getPlayerSessionStateUseCase<TestMapDocument>({
      sessionId,
      playerId,
      clientId: playerClientId,
      displayName,
    }, {
      env: enabledEnv,
      store,
    })
    const attachedMapSummary = {
      mapSlug,
      revision: INITIAL_MAP_REVISION,
      selected: true,
      attached: true,
      availableForSessionMode: true,
      playerVisibleByDefault: true,
    }
    const playerMapSummary = {
      mapSlug,
      revision: INITIAL_MAP_REVISION,
      selected: true,
      attached: true,
      availableForSessionMode: true,
    }

    expect(managementAfterAttach.session).toMatchObject({
      revision: parseSessionRevision(2),
      selectedMapSlug: mapSlug,
      selectedMapRevision: INITIAL_MAP_REVISION,
      selectedMapAttached: true,
      sessionMapAvailable: true,
      mapCount: 1,
      playerCount: 1,
      assignmentCount: 1,
    })
    expect(managementAfterAttach.selectedMap).toEqual(attachedMapSummary)
    expect(managementAfterAttach.maps).toEqual([attachedMapSummary])
    expect(managementAfterAttach.players).toEqual([{ playerId, displayName, joinedAt, updatedAt: joinedAt }])
    expect(managementAfterAttach.assignments[0]?.visibleResources).toEqual([{ kind: 'map', mapSlug }])
    expect(managementAfterAttach).not.toHaveProperty('gmKey')
    expect(JSON.stringify(managementAfterAttach.selectedMap)).not.toContain('Summary Session Map')

    expect(playerAfterAttach.visibility).toEqual({
      selectedMapAttached: true,
      currentMapVisible: true,
      currentMapAvailable: true,
      currentMap: playerMapSummary,
      visibleMapSlugs: [mapSlug],
      visibleMaps: [playerMapSummary],
    })
    expect(playerAfterAttach).not.toHaveProperty('join')
    expect(playerAfterAttach).not.toHaveProperty('gmKey')
    expect(playerAfterAttach).not.toHaveProperty('players')
    expect(writeSnapshot).toHaveBeenCalledTimes(3)
  })
})
