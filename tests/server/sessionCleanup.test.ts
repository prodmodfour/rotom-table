import { describe, expect, it, vi } from 'vitest'
import { parseGmKey, parseJoinCode, parseSessionId, type SessionId } from '#shared/sessionIdentity'
import {
  cleanupExpiredSessions,
  createSessionCleanupPolicy,
  endSessionExplicitly,
  getEndedSessionAge,
  getSessionCleanupDecision,
  getSessionRecordLastActivity,
  SESSION_CLEANUP_DEFAULT_ENDED_RETENTION_MS,
  SESSION_CLEANUP_DEFAULT_IDLE_TIMEOUT_MS,
  type SessionOperationTrackerCleanupHandle,
} from '~~/server/utils/sessionCleanup'
import {
  createInMemorySessionStore,
  type CreateSessionStoreRecordInput,
} from '~~/server/utils/sessionStore'

interface SessionStateFixture {
  readonly updatedAt?: string
  readonly connectedClients?: readonly {
    readonly connectedAt?: string
    readonly lastSeenAt?: string
    readonly disconnectedAt?: string
  }[]
  readonly players?: readonly {
    readonly joinedAt?: string
    readonly updatedAt?: string
  }[]
  readonly assignments?: readonly {
    readonly updatedAt?: string
  }[]
}

const sessionId = parseSessionId('session_cleanup00001')
const otherSessionId = parseSessionId('session_cleanup00002')
const thirdSessionId = parseSessionId('session_cleanup00003')
const missingSessionId = parseSessionId('session_cleanup99999')
const joinCode = parseJoinCode('ABC234')
const otherJoinCode = parseJoinCode('DEF567')
const thirdJoinCode = parseJoinCode('GHJ789')
const gmKey = parseGmKey('gmkey_cleanupabcdefghijklmnopqrstuvwxyz')
const otherGmKey = parseGmKey('gmkey_cleanupabcdefghijklmnopqrstuvwx')
const thirdGmKey = parseGmKey('gmkey_cleanupabcdefghijklmnopqrstuvwy')

const hourMs = 60 * 60 * 1000

const createSessionInput = (
  overrides: Partial<CreateSessionStoreRecordInput<SessionStateFixture>> = {},
): CreateSessionStoreRecordInput<SessionStateFixture> => ({
  sessionId,
  joinCode,
  gmKey,
  createdAt: '2026-05-25T00:00:00.000Z',
  updatedAt: '2026-05-25T00:00:00.000Z',
  ...overrides,
})

const createTracker = (
  returnValue = true,
): { readonly tracker: SessionOperationTrackerCleanupHandle, readonly clearSession: ReturnType<typeof vi.fn> } => {
  const clearSession = vi.fn((_clearedSessionId: SessionId) => returnValue)
  return {
    tracker: { clearSession },
    clearSession,
  }
}

describe('session cleanup and expiration policy', () => {
  it('defines safe default policy durations and validates overrides', () => {
    expect(SESSION_CLEANUP_DEFAULT_IDLE_TIMEOUT_MS).toBe(12 * hourMs)
    expect(SESSION_CLEANUP_DEFAULT_ENDED_RETENTION_MS).toBe(24 * hourMs)
    expect(createSessionCleanupPolicy()).toEqual({
      idleTimeoutMs: 12 * hourMs,
      endedRetentionMs: 24 * hourMs,
    })
    expect(createSessionCleanupPolicy({ idleTimeoutMs: hourMs, endedRetentionMs: 0 })).toEqual({
      idleTimeoutMs: hourMs,
      endedRetentionMs: 0,
    })

    expect(() => createSessionCleanupPolicy({ idleTimeoutMs: 0 })).toThrow(
      'idleTimeoutMs must be a positive safe integer millisecond duration',
    )
    expect(() => createSessionCleanupPolicy({ endedRetentionMs: -1 })).toThrow(
      'endedRetentionMs must be a non-negative safe integer millisecond duration',
    )
  })

  it('decides active idle expiration and ended-record retention deterministically', () => {
    const store = createInMemorySessionStore<SessionStateFixture>()
    const active = store.create(createSessionInput({
      updatedAt: '2026-05-25T10:00:00.000Z',
    }))

    expect(getSessionRecordLastActivity(active, '2026-05-25T11:00:00.000Z')).toEqual({
      sessionId,
      lastActivityAt: '2026-05-25T10:00:00.000Z',
      lastActivityAgeMs: hourMs,
    })
    expect(getSessionCleanupDecision(active, {
      now: '2026-05-25T11:00:00.000Z',
      idleTimeoutMs: 2 * hourMs,
    })).toMatchObject({
      action: 'retain',
      reason: 'active-not-idle',
      idleForMs: hourMs,
    })
    expect(getSessionCleanupDecision(active, {
      now: '2026-05-25T12:00:00.000Z',
      idleTimeoutMs: 2 * hourMs,
    })).toMatchObject({
      action: 'end-idle',
      reason: 'idle-timeout',
      idleForMs: 2 * hourMs,
    })

    const ended = store.end(sessionId, { endedAt: '2026-05-25T12:30:00.000Z' })
    expect(ended).toBeDefined()
    expect(getEndedSessionAge(ended!, '2026-05-25T13:00:00.000Z')).toEqual({
      sessionId,
      endedAt: '2026-05-25T12:30:00.000Z',
      endedAgeMs: 30 * 60 * 1000,
    })
    expect(getSessionCleanupDecision(ended!, {
      now: '2026-05-25T13:00:00.000Z',
      endedRetentionMs: hourMs,
    })).toMatchObject({
      action: 'retain',
      reason: 'ended-retained',
    })
    expect(getSessionCleanupDecision(ended!, {
      now: '2026-05-25T13:30:00.000Z',
      endedRetentionMs: hourMs,
    })).toMatchObject({
      action: 'delete-ended',
      reason: 'ended-retention-expired',
      endedForMs: hourMs,
    })
  })

  it('uses authoritative state and presence timestamps as server-owned activity', () => {
    const store = createInMemorySessionStore<SessionStateFixture>()
    const record = store.create(createSessionInput({
      updatedAt: '2026-05-25T10:00:00.000Z',
      state: {
        updatedAt: '2026-05-25T10:05:00.000Z',
        connectedClients: [
          {
            connectedAt: '2026-05-25T10:01:00.000Z',
            lastSeenAt: '2026-05-25T12:45:00.000Z',
          },
        ],
        players: [{ joinedAt: '2026-05-25T10:02:00.000Z', updatedAt: '2026-05-25T10:02:00.000Z' }],
        assignments: [{ updatedAt: '2026-05-25T10:03:00.000Z' }],
      },
    }))

    expect(getSessionRecordLastActivity(record, '2026-05-25T13:00:00.000Z')).toEqual({
      sessionId,
      lastActivityAt: '2026-05-25T12:45:00.000Z',
      lastActivityAgeMs: 15 * 60 * 1000,
    })
    expect(getSessionCleanupDecision(record, {
      now: '2026-05-25T13:00:00.000Z',
      idleTimeoutMs: hourMs,
    })).toMatchObject({
      action: 'retain',
      reason: 'active-not-idle',
      lastActivityAt: '2026-05-25T12:45:00.000Z',
    })
  })

  it('provides an explicit idempotent end-session path and clears process-local op records', () => {
    const store = createInMemorySessionStore<SessionStateFixture>()
    store.create(createSessionInput())
    const { tracker, clearSession } = createTracker()

    const ended = endSessionExplicitly(store, sessionId, {
      endedAt: '2026-05-25T01:00:00.000Z',
      operationTracker: tracker,
    })

    expect(ended).toMatchObject({
      ok: true,
      status: 'ended',
      sessionId,
      reason: 'gm-ended',
      operationRecordsCleared: true,
      record: {
        status: 'ended',
        endedAt: '2026-05-25T01:00:00.000Z',
        updatedAt: '2026-05-25T01:00:00.000Z',
      },
    })
    expect(store.findActiveByJoinCode(joinCode)).toBeUndefined()
    expect(store.getByJoinCode(joinCode)?.status).toBe('ended')
    expect(clearSession).toHaveBeenCalledWith(sessionId)

    const alreadyEnded = endSessionExplicitly(store, sessionId, {
      endedAt: '2026-05-25T02:00:00.000Z',
      operationTracker: tracker,
    })
    expect(alreadyEnded).toMatchObject({
      ok: true,
      status: 'already-ended',
      record: {
        endedAt: '2026-05-25T01:00:00.000Z',
      },
    })
    expect(store.get(sessionId)?.endedAt).toBe('2026-05-25T01:00:00.000Z')
    expect(clearSession).toHaveBeenCalledTimes(2)

    const missing = endSessionExplicitly(store, missingSessionId, { operationTracker: tracker })
    expect(missing).toEqual({
      ok: false,
      status: 'not-found',
      sessionId: missingSessionId,
      reason: 'gm-ended',
      operationRecordsCleared: false,
    })
    expect(clearSession).toHaveBeenCalledTimes(2)
  })

  it('ends idle active sessions without deleting them during the same cleanup pass', () => {
    const store = createInMemorySessionStore<SessionStateFixture>()
    store.create(createSessionInput({
      updatedAt: '2026-05-25T10:00:00.000Z',
    }))
    store.create(createSessionInput({
      sessionId: otherSessionId,
      joinCode: otherJoinCode,
      gmKey: otherGmKey,
      updatedAt: '2026-05-25T12:30:00.000Z',
    }))
    const { tracker, clearSession } = createTracker()

    const result = cleanupExpiredSessions(store, {
      now: '2026-05-25T13:00:00.000Z',
      idleTimeoutMs: 2 * hourMs,
      endedRetentionMs: 0,
      operationTracker: tracker,
    })

    expect(result.evaluated).toBe(2)
    expect(result.ended.map((entry) => entry.sessionId)).toEqual([sessionId])
    expect(result.deleted).toEqual([])
    expect(result.retained.map((decision) => decision.sessionId)).toEqual([otherSessionId])
    expect(store.get(sessionId)).toMatchObject({
      status: 'ended',
      endedAt: '2026-05-25T13:00:00.000Z',
    })
    expect(store.getByJoinCode(joinCode)?.status).toBe('ended')
    expect(store.findActiveByJoinCode(joinCode)).toBeUndefined()
    expect(store.get(otherSessionId)?.status).toBe('active')
    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(clearSession).toHaveBeenCalledWith(sessionId)
  })

  it('prunes only previously ended records after the retention window', () => {
    const store = createInMemorySessionStore<SessionStateFixture>()
    store.create(createSessionInput())
    store.create(createSessionInput({
      sessionId: otherSessionId,
      joinCode: otherJoinCode,
      gmKey: otherGmKey,
    }))
    store.create(createSessionInput({
      sessionId: thirdSessionId,
      joinCode: thirdJoinCode,
      gmKey: thirdGmKey,
      updatedAt: '2026-05-25T12:45:00.000Z',
    }))
    store.end(sessionId, { endedAt: '2026-05-25T10:00:00.000Z' })
    store.end(otherSessionId, { endedAt: '2026-05-25T12:30:00.000Z' })
    const { tracker, clearSession } = createTracker()

    const result = cleanupExpiredSessions(store, {
      now: '2026-05-25T13:00:00.000Z',
      idleTimeoutMs: 12 * hourMs,
      endedRetentionMs: 2 * hourMs,
      operationTracker: tracker,
    })

    expect(result.deleted).toEqual([
      {
        sessionId,
        reason: 'ended-retention-expired',
        deleted: true,
        operationRecordsCleared: true,
      },
    ])
    expect(result.ended).toEqual([])
    expect(result.retained.map((decision) => [decision.sessionId, decision.reason])).toEqual([
      [otherSessionId, 'ended-retained'],
      [thirdSessionId, 'active-not-idle'],
    ])
    expect(store.get(sessionId)).toBeUndefined()
    expect(store.getByJoinCode(joinCode)).toBeUndefined()
    expect(store.get(otherSessionId)?.status).toBe('ended')
    expect(store.get(thirdSessionId)?.status).toBe('active')
    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(clearSession).toHaveBeenCalledWith(sessionId)
  })
})
