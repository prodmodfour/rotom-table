import { describe, expect, it } from 'vitest'
import {
  SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  type SessionCommandAcceptedResult,
  type SessionCommandInvalidResult,
  type SessionCommandStaleResult,
} from '#shared/sessionCommandResults'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  parseOpId,
  type SessionCommandEnvelope,
} from '#shared/sessionCommands'
import {
  parseClientId,
  parsePlayerId,
  parseSessionId,
  sanitizeSessionDisplayName,
} from '#shared/sessionIdentity'
import type { PlayerSessionActor, SessionActor } from '#shared/sessionPermissions'
import { parseSessionRevision, type SessionRevision } from '#shared/sessionRevisions'
import {
  SESSION_OPERATION_IDEMPOTENCY_STATUSES,
  SESSION_OPERATION_TRACKER_DEFAULT_MAX_RECORDS_PER_SESSION,
  createDuplicateSessionCommandResult,
  createInMemorySessionOperationTracker,
  createSessionOperationCommandFingerprint,
  isTrackableSessionOperationResult,
  type TrackableSessionCommandResult,
} from '~~/server/utils/sessionOperationTracker'

interface TokenPositionFixture {
  readonly x: number
  readonly y: number
  readonly z: number
}

interface MoveTokenPayloadFixture {
  readonly tokenId: string
  readonly mapSlug: string
  readonly to: TokenPositionFixture
}

interface TokenMovedEventFixture {
  readonly eventType: 'tokenMoved'
  readonly tokenId: string
  readonly mapSlug: string
  readonly to: TokenPositionFixture
}

interface TokenStateFixture {
  readonly tokenId: string
  readonly mapSlug: string
  readonly position: TokenPositionFixture
}

const sessionId = parseSessionId('session_optrack00001')
const otherSessionId = parseSessionId('session_optrack00002')
const playerId = parsePlayerId('player_optrack01')
const playerClientId = parseClientId('client_optrack01')
const otherClientId = parseClientId('client_optrack02')
const displayName = sanitizeSessionDisplayName('Operation Tester')
const opId = parseOpId('op_operation0001')
const secondOpId = parseOpId('op_operation0002')
const otherSessionOpId = parseOpId('op_operation0003')
const processedAt = '2026-05-25T06:00:00.000Z'
const recordedAt = '2026-05-25T06:00:00.050Z'

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId,
  clientId: playerClientId,
  displayName,
}

const otherClientActor: PlayerSessionActor = {
  ...playerActor,
  clientId: otherClientId,
}

const tokenScope = {
  lane: 'token',
  mapSlug: 'viridian-gym',
  resource: {
    kind: 'token',
    tokenId: 'token_pikachu',
    mapSlug: 'viridian-gym',
    sheetKind: 'pokemon',
    sheetSlug: 'pikachu',
  },
} as const

const createMoveCommand = (
  overrides: Partial<SessionCommandEnvelope<'moveToken', MoveTokenPayloadFixture, SessionActor, SessionRevision>> = {},
): SessionCommandEnvelope<'moveToken', MoveTokenPayloadFixture, SessionActor, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: playerActor,
  type: 'moveToken',
  opId,
  baseRevision: parseSessionRevision(2),
  scopes: [tokenScope],
  payload: {
    tokenId: 'token_pikachu',
    mapSlug: 'viridian-gym',
    to: { x: 5, y: 8, z: 0 },
  },
  metadata: {
    clientIssuedAt: '2026-05-25T05:59:59.000Z',
    clientSequence: 7,
    traceId: 'trace-operation-original',
  },
  ...overrides,
})

const createAcceptedResult = (
  command: SessionCommandEnvelope<'moveToken', MoveTokenPayloadFixture, SessionActor, SessionRevision>,
  currentRevision = parseSessionRevision(3),
): SessionCommandAcceptedResult<'moveToken', TokenMovedEventFixture, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'accepted',
  accepted: true,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: command.type,
  actor: command.actor,
  currentRevision,
  scopes: command.scopes,
  event: {
    eventType: 'tokenMoved',
    tokenId: command.payload.tokenId,
    mapSlug: command.payload.mapSlug,
    to: command.payload.to,
  },
  metadata: {
    serverProcessedAt: processedAt,
    traceId: command.metadata?.traceId,
  },
})

const createStaleResult = (
  command: SessionCommandEnvelope<'moveToken', MoveTokenPayloadFixture, SessionActor, SessionRevision>,
): SessionCommandStaleResult<'moveToken', TokenStateFixture, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'stale',
  message: 'Token token_pikachu changed after the command was created.',
  retryable: true,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: command.type,
  actor: command.actor,
  currentRevision: parseSessionRevision(4),
  baseRevision: command.baseRevision,
  scopes: command.scopes,
  changedScopes: command.scopes,
  currentState: {
    tokenId: command.payload.tokenId,
    mapSlug: command.payload.mapSlug,
    position: { x: 6, y: 8, z: 0 },
  },
})

describe('server session operation tracker', () => {
  it('defines duplicate-operation tracker constants and trackable result narrowing', () => {
    expect(SESSION_OPERATION_TRACKER_DEFAULT_MAX_RECORDS_PER_SESSION).toBe(512)
    expect(SESSION_OPERATION_IDEMPOTENCY_STATUSES).toEqual([
      'new',
      'duplicate',
      'mismatched-opId',
    ])

    const command = createMoveCommand()
    const accepted = createAcceptedResult(command)
    const invalid = {
      schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
      status: 'rejected',
      accepted: false,
      reason: 'invalid',
      message: 'The command payload is malformed.',
      retryable: false,
      sessionId,
      opId,
      commandType: 'moveToken',
      actor: playerActor,
      currentRevision: parseSessionRevision(3),
      scopes: command.scopes,
      issues: [
        {
          path: 'payload.to.x',
          code: 'number.required',
          message: 'x is required',
        },
      ],
    } as const satisfies SessionCommandInvalidResult<'moveToken', SessionRevision>

    expect(isTrackableSessionOperationResult(accepted)).toBe(true)
    expect(isTrackableSessionOperationResult(invalid)).toBe(true)
  })

  it('records accepted operation IDs and returns idempotent duplicate acknowledgements', () => {
    const tracker = createInMemorySessionOperationTracker()
    const command = createMoveCommand()
    const accepted = createAcceptedResult(command)

    expect(tracker.check(command, {
      currentRevision: parseSessionRevision(2),
      processedAt,
    })).toEqual({
      status: 'new',
      scopeKey: `${sessionId}:${playerClientId}:${opId}`,
    })

    const record = tracker.rememberResult(command, accepted, { recordedAt })

    expect(record).toMatchObject({
      sessionId,
      clientId: playerClientId,
      opId,
      commandType: 'moveToken',
      original: {
        status: 'accepted',
        revision: parseSessionRevision(3),
      },
      recordedAt,
    })
    expect(record.commandFingerprint).toBe(createSessionOperationCommandFingerprint(command))
    expect(tracker.recordCount).toBe(1)

    const duplicate = tracker.check(command, {
      currentRevision: parseSessionRevision(5),
      processedAt: '2026-05-25T06:01:00.000Z',
    })

    expect(duplicate.status).toBe('duplicate')
    if (duplicate.status !== 'duplicate') throw new Error('expected duplicate')
    expect(duplicate.record.result).toEqual(accepted)
    expect(duplicate.result).toEqual({
      schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
      status: 'duplicate',
      duplicate: true,
      idempotent: true,
      sessionId,
      opId,
      commandType: 'moveToken',
      actor: playerActor,
      currentRevision: parseSessionRevision(5),
      scopes: command.scopes,
      original: {
        status: 'accepted',
        revision: parseSessionRevision(3),
      },
      metadata: {
        serverProcessedAt: '2026-05-25T06:01:00.000Z',
        traceId: 'trace-operation-original',
      },
    })
    expect(tracker.recordCount).toBe(1)
  })

  it('records rejected operation IDs and reports the original rejection reason on duplicates', () => {
    const tracker = createInMemorySessionOperationTracker()
    const command = createMoveCommand()
    const rejected = createStaleResult(command)

    const record = tracker.rememberResult(command, rejected, { recordedAt })
    const duplicate = createDuplicateSessionCommandResult(command, record, {
      currentRevision: parseSessionRevision(6),
      processedAt: '2026-05-25T06:02:00.000Z',
    })

    expect(record.original).toEqual({
      status: 'rejected',
      revision: parseSessionRevision(4),
      reason: 'stale',
    })
    expect(duplicate.original).toEqual(record.original)
    expect(duplicate.currentRevision).toBe(6)
    expect(duplicate.metadata).toEqual({
      serverProcessedAt: '2026-05-25T06:02:00.000Z',
      traceId: 'trace-operation-original',
    })
  })

  it('scopes opIds by session and client ID so unrelated retries do not collide', () => {
    const tracker = createInMemorySessionOperationTracker()
    const command = createMoveCommand()
    tracker.rememberResult(command, createAcceptedResult(command), { recordedAt })

    const sameOpDifferentClient = createMoveCommand({ actor: otherClientActor })
    const sameOpDifferentSession = createMoveCommand({ sessionId: otherSessionId })

    expect(tracker.check(sameOpDifferentClient, {
      currentRevision: parseSessionRevision(5),
      processedAt,
    })).toEqual({
      status: 'new',
      scopeKey: `${sessionId}:${otherClientId}:${opId}`,
    })
    expect(tracker.check(sameOpDifferentSession, {
      currentRevision: parseSessionRevision(5),
      processedAt,
    })).toEqual({
      status: 'new',
      scopeKey: `${otherSessionId}:${playerClientId}:${opId}`,
    })
  })

  it('treats retry metadata changes as the same user intent but detects material envelope reuse', () => {
    const tracker = createInMemorySessionOperationTracker()
    const command = createMoveCommand()
    const accepted = createAcceptedResult(command)
    tracker.rememberResult(command, accepted, { recordedAt })

    const retryWithNewMetadata = createMoveCommand({
      metadata: {
        clientIssuedAt: '2026-05-25T06:00:01.000Z',
        clientSequence: 8,
        traceId: 'trace-operation-retry',
      },
    })
    expect(createSessionOperationCommandFingerprint(retryWithNewMetadata)).toBe(
      createSessionOperationCommandFingerprint(command),
    )

    const retryDecision = tracker.check(retryWithNewMetadata, {
      currentRevision: parseSessionRevision(5),
      processedAt: '2026-05-25T06:03:00.000Z',
    })
    expect(retryDecision.status).toBe('duplicate')
    if (retryDecision.status !== 'duplicate') throw new Error('expected duplicate retry')
    expect(retryDecision.result.metadata).toEqual({
      serverProcessedAt: '2026-05-25T06:03:00.000Z',
      traceId: 'trace-operation-retry',
    })

    const changedPayload = createMoveCommand({
      payload: {
        tokenId: 'token_pikachu',
        mapSlug: 'viridian-gym',
        to: { x: 9, y: 8, z: 0 },
      },
    })
    const mismatch = tracker.check(changedPayload, {
      currentRevision: parseSessionRevision(5),
      processedAt,
    })

    expect(mismatch.status).toBe('mismatched-opId')
    if (mismatch.status !== 'mismatched-opId') throw new Error('expected mismatched opId')
    expect(mismatch.message).toContain(`${sessionId}:${playerClientId}:${opId}`)
    expect(mismatch.record.result).toEqual(accepted)
    expect(() => tracker.rememberResult(changedPayload, createAcceptedResult(changedPayload))).toThrow(
      'already recorded for a different command envelope',
    )
  })

  it('keeps only a bounded recent operation history per session', () => {
    const tracker = createInMemorySessionOperationTracker({ maxRecordsPerSession: 1 })
    const first = createMoveCommand({ opId })
    const second = createMoveCommand({ opId: secondOpId })
    const otherSession = createMoveCommand({
      sessionId: otherSessionId,
      opId: otherSessionOpId,
    })

    tracker.rememberResult(first, createAcceptedResult(first, parseSessionRevision(3)), {
      recordedAt: '2026-05-25T06:00:00.000Z',
    })
    tracker.rememberResult(otherSession, createAcceptedResult(otherSession, parseSessionRevision(1)), {
      recordedAt: '2026-05-25T06:00:01.000Z',
    })
    tracker.rememberResult(second, createAcceptedResult(second, parseSessionRevision(4)), {
      recordedAt: '2026-05-25T06:00:02.000Z',
    })

    expect(tracker.sessionCount).toBe(2)
    expect(tracker.recordCount).toBe(2)
    expect(tracker.list(sessionId).map((record) => record.opId)).toEqual([secondOpId])
    expect(tracker.check(first, {
      currentRevision: parseSessionRevision(4),
      processedAt,
    }).status).toBe('new')
    expect(tracker.check(second, {
      currentRevision: parseSessionRevision(4),
      processedAt,
    }).status).toBe('duplicate')
    expect(tracker.check(otherSession, {
      currentRevision: parseSessionRevision(4),
      processedAt,
    }).status).toBe('duplicate')
  })

  it('guards invalid tracking inputs and supports session-scoped cleanup', () => {
    expect(() => createInMemorySessionOperationTracker({ maxRecordsPerSession: 0 })).toThrow(
      'maxRecordsPerSession must be a positive safe integer',
    )

    const tracker = createInMemorySessionOperationTracker()
    const command = createMoveCommand()
    const record = tracker.rememberResult(command, createAcceptedResult(command), { recordedAt })
    const duplicate = createDuplicateSessionCommandResult(command, record, {
      currentRevision: parseSessionRevision(3),
      processedAt,
    })

    expect(() => tracker.rememberResult(command, duplicate)).toThrow(
      'Only accepted or rejected command results can be tracked',
    )

    const mismatchedResult = {
      ...createAcceptedResult(command),
      actor: otherClientActor,
    } satisfies TrackableSessionCommandResult
    expect(() => tracker.rememberResult(command, mismatchedResult)).toThrow(
      'Tracked command result actor clientId must match the command actor clientId',
    )

    expect(tracker.clearSession(sessionId)).toBe(true)
    expect(tracker.clearSession(sessionId)).toBe(false)
    expect(tracker.recordCount).toBe(0)

    tracker.rememberResult(command, createAcceptedResult(command), { recordedAt })
    tracker.clear()
    expect(tracker.sessionCount).toBe(0)
    expect(tracker.recordCount).toBe(0)
  })
})
