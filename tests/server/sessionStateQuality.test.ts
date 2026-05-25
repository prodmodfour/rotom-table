import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  parseOpId,
  type SessionCommandEnvelope,
} from '#shared/sessionCommands'
import {
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parsePlayerId,
  parseSessionId,
  sanitizeSessionDisplayName,
} from '#shared/sessionIdentity'
import type { PlayerSessionActor, SessionActor } from '#shared/sessionPermissions'
import {
  parseMapRevision,
  parseSessionRevision,
  type SessionRevision,
} from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
  getSessionMapState,
  type AuthoritativeSessionState,
} from '#shared/sessionState'
import { cleanupExpiredSessions } from '~~/server/utils/sessionCleanup'
import {
  SESSION_EVENT_LOG_FILE_NAME,
  appendSessionEventLogEntry,
  sessionEventLogFilePathFor,
} from '~~/server/utils/sessionEventLog'
import { createInMemorySessionOperationTracker } from '~~/server/utils/sessionOperationTracker'
import { applyAcceptedSessionCommandEffect } from '~~/server/utils/sessionRevisionApplication'
import {
  SESSION_SNAPSHOT_FILE_NAME,
  SESSION_SNAPSHOT_TEMP_FILE_PREFIX,
  recoverSessionStateFromSnapshot,
  sessionSnapshotFilePathFor,
  writeSessionSnapshot,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

interface TokenPositionFixture {
  readonly x: number
  readonly y: number
  readonly z: number
}

interface TokenFixture {
  readonly id: string
  readonly sheetSlug: string
  readonly position: TokenPositionFixture
}

interface MapDocumentFixture {
  readonly slug: string
  readonly name: string
  readonly tokens: readonly TokenFixture[]
}

interface MoveTokenPayloadFixture {
  readonly tokenId: string
  readonly mapSlug: string
  readonly to: TokenPositionFixture
}

interface TokenMovedPatchPayloadFixture {
  readonly tokenId: string
  readonly mapSlug: string
  readonly from: TokenPositionFixture
  readonly to: TokenPositionFixture
}

const sessionId = parseSessionId('session_quality00001')
const joinCode = parseJoinCode('QAL234')
const gmKey = parseGmKey('gmkey_qualityabcdefghijklmnopqrstuvwxyz')
const gmClientId = parseClientId('client_qualityGM01')
const playerClientId = parseClientId('client_qualityPL01')
const playerId = parsePlayerId('player_quality01')
const displayName = sanitizeSessionDisplayName('Quality Player')
const opId = parseOpId('op_quality0001')
const createdAt = '2026-05-25T09:00:00.000Z'
const processedAt = '2026-05-25T09:01:00.000Z'
const snapshotWrittenAt = '2026-05-25T09:01:00.050Z'
const duplicateProcessedAt = '2026-05-25T09:02:00.000Z'
const oneHourMs = 60 * 60 * 1000

const gmActor: SessionActor = {
  role: 'gm',
  clientId: gmClientId,
}

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId,
  clientId: playerClientId,
  displayName,
}

const tokenResource = {
  kind: 'token',
  tokenId: 'token_pikachu',
  mapSlug: 'viridian-gym',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const

let roots: string[] = []

const tempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-session-quality-'))
  roots.push(root)
  return root
}

const createViridianDocument = (position: TokenPositionFixture): MapDocumentFixture => ({
  slug: 'viridian-gym',
  name: 'Viridian Gym',
  tokens: [
    {
      id: tokenResource.tokenId,
      sheetSlug: tokenResource.sheetSlug,
      position,
    },
  ],
})

const pewterDocument: MapDocumentFixture = {
  slug: 'pewter-gym',
  name: 'Pewter Gym',
  tokens: [
    {
      id: 'token_geodude',
      sheetSlug: 'geodude',
      position: { x: 1, y: 1, z: 0 },
    },
  ],
}

const createInitialState = (): AuthoritativeSessionState<MapDocumentFixture> =>
  createAuthoritativeSessionState<MapDocumentFixture>({
    sessionId,
    createdAt,
    updatedAt: createdAt,
    revision: parseSessionRevision(0),
    selectedMapSlug: 'viridian-gym',
    maps: [
      createAuthoritativeSessionMapState<MapDocumentFixture>({
        mapSlug: 'viridian-gym',
        revision: parseMapRevision(0),
        document: createViridianDocument({ x: 4, y: 8, z: 0 }),
      }),
      createAuthoritativeSessionMapState<MapDocumentFixture>({
        mapSlug: 'pewter-gym',
        revision: parseMapRevision(7),
        document: pewterDocument,
      }),
    ],
    connectedClients: [
      {
        clientId: gmClientId,
        actor: gmActor,
        status: 'connected',
        connectedAt: createdAt,
        lastSeenAt: createdAt,
        lastSeenRevision: parseSessionRevision(0),
      },
      {
        clientId: playerClientId,
        actor: playerActor,
        status: 'connected',
        connectedAt: createdAt,
        lastSeenAt: createdAt,
        lastSeenRevision: parseSessionRevision(0),
      },
    ],
    players: [
      {
        playerId,
        displayName,
        joinedAt: createdAt,
        updatedAt: createdAt,
      },
    ],
    assignments: [
      {
        playerId,
        displayName,
        controllableResources: [tokenResource],
        visibleResources: [
          { kind: 'map', mapSlug: 'viridian-gym' },
          tokenResource,
        ],
        updatedAt: createdAt,
        updatedByClientId: gmClientId,
      },
    ],
  })

const createMoveCommand = (
  overrides: Partial<SessionCommandEnvelope<'moveToken', MoveTokenPayloadFixture, SessionActor, SessionRevision>> = {},
): SessionCommandEnvelope<'moveToken', MoveTokenPayloadFixture, SessionActor, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: playerActor,
  type: 'moveToken',
  opId,
  baseRevision: parseSessionRevision(0),
  scopes: [
    {
      lane: 'token',
      mapSlug: 'viridian-gym',
      resource: tokenResource,
    },
  ],
  payload: {
    tokenId: tokenResource.tokenId,
    mapSlug: 'viridian-gym',
    to: { x: 5, y: 8, z: 0 },
  },
  metadata: {
    clientIssuedAt: '2026-05-25T09:00:59.000Z',
    clientSequence: 1,
    traceId: 'trace-quality-move-original',
  },
  ...overrides,
})

const expectStateStored = (
  state: AuthoritativeSessionState<MapDocumentFixture> | undefined,
): AuthoritativeSessionState<MapDocumentFixture> => {
  if (state === undefined) throw new Error('expected authoritative state to be stored')
  return state
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

describe('session state quality lifecycle', () => {
  it('covers create, mutate, snapshot, recover, duplicate opId, cleanup, and revision increments together', () => {
    const root = tempRoot()
    const store = createInMemorySessionStore<AuthoritativeSessionState<MapDocumentFixture>>()
    const tracker = createInMemorySessionOperationTracker()
    const initialState = createInitialState()

    const created = store.create({
      sessionId,
      joinCode,
      gmKey,
      revision: initialState.revision,
      createdAt,
      updatedAt: createdAt,
      state: initialState,
    })

    expect(created).toMatchObject({
      sessionId,
      joinCode,
      gmKey,
      revision: parseSessionRevision(0),
      status: 'active',
      state: {
        revision: parseSessionRevision(0),
        selectedMapSlug: 'viridian-gym',
      },
    })
    expect(store.findActiveByJoinCode(joinCode)?.sessionId).toBe(sessionId)

    const command = createMoveCommand()
    expect(tracker.check(command, {
      currentRevision: initialState.revision,
      processedAt,
    })).toMatchObject({
      status: 'new',
      scopeKey: `${sessionId}:${playerClientId}:${opId}`,
    })

    const movedDocument = createViridianDocument(command.payload.to)
    const applied = applyAcceptedSessionCommandEffect({
      state: initialState,
      command,
      eventType: 'tokenMoved',
      eventPayload: {
        tokenId: tokenResource.tokenId,
        mapSlug: 'viridian-gym',
        from: { x: 4, y: 8, z: 0 },
        to: command.payload.to,
      } satisfies TokenMovedPatchPayloadFixture,
      mapEffects: [
        {
          mapSlug: 'viridian-gym',
          document: movedDocument,
        },
      ],
    }, {
      processedAt,
      eventId: 'event_quality_move_1',
      eventLogMetadata: {
        source: 'session-state-quality-test',
        attributes: { snapshotExpected: true },
      },
    })

    expect(applied.previousRevision).toBe(parseSessionRevision(0))
    expect(applied.currentRevision).toBe(parseSessionRevision(1))
    expect(applied.state.revision).toBe(parseSessionRevision(1))
    expect(applied.state.updatedAt).toBe(processedAt)
    expect(applied.mapRevisionChanges).toEqual([
      {
        mapSlug: 'viridian-gym',
        previousRevision: parseMapRevision(0),
        currentRevision: parseMapRevision(1),
        document: movedDocument,
      },
    ])
    expect(getSessionMapState(applied.state, 'viridian-gym')).toMatchObject({
      revision: parseMapRevision(1),
      document: movedDocument,
    })
    expect(getSessionMapState(applied.state, 'pewter-gym')).toMatchObject({
      revision: parseMapRevision(7),
      document: pewterDocument,
    })

    const updated = store.setState(sessionId, applied.state, {
      revision: applied.currentRevision,
      updatedAt: applied.processedAt,
    })
    const storedState = expectStateStored(updated?.state)
    tracker.rememberResult(command, applied.result, { recordedAt: applied.processedAt })

    expect(updated).toMatchObject({
      revision: parseSessionRevision(1),
      updatedAt: processedAt,
      state: { revision: parseSessionRevision(1), updatedAt: processedAt },
    })
    expect(storedState).toEqual(applied.state)
    expect(tracker.recordCount).toBe(1)

    const snapshotResult = writeSessionSnapshot(storedState, {
      rootDir: root,
      clock: () => snapshotWrittenAt,
      tempFileName: () => `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}quality`,
      flushToDisk: false,
    })
    const eventLogResult = appendSessionEventLogEntry(applied.eventLogEntry, {
      rootDir: root,
      flushToDisk: false,
    })

    expect(snapshotResult.filePath).toBe(join(root, sessionId, SESSION_SNAPSHOT_FILE_NAME))
    expect(snapshotResult.filePath).toBe(sessionSnapshotFilePathFor(sessionId, { rootDir: root }))
    expect(snapshotResult.snapshot).toMatchObject({
      sessionId,
      revision: parseSessionRevision(1),
      writtenAt: snapshotWrittenAt,
      state: {
        revision: parseSessionRevision(1),
        selectedMapSlug: 'viridian-gym',
      },
    })
    expect(eventLogResult.filePath).toBe(join(root, sessionId, SESSION_EVENT_LOG_FILE_NAME))
    expect(eventLogResult.filePath).toBe(sessionEventLogFilePathFor(sessionId, { rootDir: root }))
    const [eventLogJson] = readFileSync(eventLogResult.filePath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(eventLogJson).toMatchObject({
      kind: 'command',
      sessionId,
      revision: 1,
      command: { type: 'moveToken', opId },
      result: { status: 'accepted', currentRevision: 1 },
      metadata: { source: 'session-state-quality-test' },
    })

    const recovery = recoverSessionStateFromSnapshot<MapDocumentFixture>(sessionId, { rootDir: root })
    if (!recovery.recovered) throw new Error(recovery.message)
    expect(recovery.revision).toBe(parseSessionRevision(1))
    expect(recovery.state).toEqual(storedState)
    expect(getSessionMapState(recovery.state, 'viridian-gym')?.document.tokens[0]?.position).toEqual({
      x: 5,
      y: 8,
      z: 0,
    })

    const restartedStore = createInMemorySessionStore<AuthoritativeSessionState<MapDocumentFixture>>()
    restartedStore.create({
      sessionId,
      joinCode,
      gmKey,
      revision: recovery.revision,
      createdAt: recovery.state.createdAt,
      updatedAt: recovery.state.updatedAt,
      state: recovery.state,
    })
    expect(restartedStore.get(sessionId)?.state).toEqual(storedState)
    expect(restartedStore.get(sessionId)?.revision).toBe(parseSessionRevision(1))

    const retryCommand = createMoveCommand({
      metadata: {
        clientIssuedAt: '2026-05-25T09:02:00.000Z',
        clientSequence: 2,
        traceId: 'trace-quality-move-retry',
      },
    })
    const duplicate = tracker.check(retryCommand, {
      currentRevision: recovery.revision,
      processedAt: duplicateProcessedAt,
    })

    expect(duplicate.status).toBe('duplicate')
    if (duplicate.status !== 'duplicate') throw new Error('expected duplicate retry')
    expect(duplicate.result).toMatchObject({
      status: 'duplicate',
      idempotent: true,
      currentRevision: parseSessionRevision(1),
      original: {
        status: 'accepted',
        revision: parseSessionRevision(1),
      },
      metadata: {
        serverProcessedAt: duplicateProcessedAt,
        traceId: 'trace-quality-move-retry',
      },
    })
    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(1))
    expect(expectStateStored(store.get(sessionId)?.state)).toEqual(storedState)

    const retainCleanup = cleanupExpiredSessions(store, {
      now: '2026-05-25T09:30:00.000Z',
      idleTimeoutMs: oneHourMs,
      endedRetentionMs: oneHourMs,
      operationTracker: tracker,
    })
    expect(retainCleanup.retained).toHaveLength(1)
    expect(retainCleanup.retained[0]).toMatchObject({
      action: 'retain',
      reason: 'active-not-idle',
      sessionId,
    })
    expect(tracker.recordCount).toBe(1)
    expect(store.get(sessionId)?.status).toBe('active')

    const idleCleanup = cleanupExpiredSessions(store, {
      now: '2026-05-25T10:01:00.000Z',
      idleTimeoutMs: oneHourMs,
      endedRetentionMs: 0,
      operationTracker: tracker,
    })
    expect(idleCleanup.ended).toEqual([
      {
        sessionId,
        reason: 'idle-timeout',
        record: expect.objectContaining({
          status: 'ended',
          revision: parseSessionRevision(1),
          endedAt: '2026-05-25T10:01:00.000Z',
          state: storedState,
        }),
        operationRecordsCleared: true,
      },
    ])
    expect(idleCleanup.deleted).toEqual([])
    expect(store.findActiveByJoinCode(joinCode)).toBeUndefined()
    expect(store.getByJoinCode(joinCode)?.status).toBe('ended')
    expect(tracker.recordCount).toBe(0)
    expect(existsSync(snapshotResult.filePath)).toBe(true)
    expect(existsSync(eventLogResult.filePath)).toBe(true)

    const pruneCleanup = cleanupExpiredSessions(store, {
      now: '2026-05-25T11:02:00.000Z',
      idleTimeoutMs: oneHourMs,
      endedRetentionMs: oneHourMs,
      operationTracker: tracker,
    })
    expect(pruneCleanup.deleted).toEqual([
      {
        sessionId,
        reason: 'ended-retention-expired',
        deleted: true,
        operationRecordsCleared: false,
      },
    ])
    expect(store.get(sessionId)).toBeUndefined()
    expect(store.getByJoinCode(joinCode)).toBeUndefined()
    expect(existsSync(snapshotResult.filePath)).toBe(true)
    expect(existsSync(eventLogResult.filePath)).toBe(true)
  })
})
