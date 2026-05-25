import type { SessionId } from '#shared/sessionIdentity'
import type { AuthoritativeSessionState } from '#shared/sessionState'
import {
  sessionOperationTracker,
  type InMemorySessionOperationTracker,
} from './sessionOperationTracker'
import {
  sessionStore,
  type InMemorySessionStore,
  type SessionStoreRecord,
} from './sessionStore'

export const SESSION_CLEANUP_DEFAULT_IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000
export const SESSION_CLEANUP_DEFAULT_ENDED_RETENTION_MS = 24 * 60 * 60 * 1000

export const SESSION_END_REASONS = ['gm-ended', 'idle-timeout'] as const
export type SessionEndReason = (typeof SESSION_END_REASONS)[number]

export const SESSION_CLEANUP_ACTIONS = ['retain', 'end-idle', 'delete-ended'] as const
export type SessionCleanupAction = (typeof SESSION_CLEANUP_ACTIONS)[number]

export const SESSION_CLEANUP_DECISION_REASONS = [
  'active-not-idle',
  'idle-timeout',
  'ended-retained',
  'ended-retention-expired',
] as const
export type SessionCleanupDecisionReason = (typeof SESSION_CLEANUP_DECISION_REASONS)[number]

export type SessionCleanupClock = () => string

export interface SessionCleanupPolicy {
  /**
   * Active sessions whose latest server-owned activity is at least this old are
   * marked ended. Heartbeat/reconnect work should touch the store so live rooms
   * do not look idle.
   */
  readonly idleTimeoutMs: number
  /**
   * Ended records remain queryable in memory for this grace window before a
   * later cleanup pass prunes them. Snapshot and event-log files are never
   * deleted by the cleanup helper.
   */
  readonly endedRetentionMs: number
}

export interface CreateSessionCleanupPolicyInput {
  readonly idleTimeoutMs?: number
  readonly endedRetentionMs?: number
}

export const DEFAULT_SESSION_CLEANUP_POLICY: SessionCleanupPolicy = Object.freeze({
  idleTimeoutMs: SESSION_CLEANUP_DEFAULT_IDLE_TIMEOUT_MS,
  endedRetentionMs: SESSION_CLEANUP_DEFAULT_ENDED_RETENTION_MS,
})

export interface GetSessionCleanupDecisionOptions extends CreateSessionCleanupPolicyInput {
  readonly now?: string
  readonly clock?: SessionCleanupClock
}

export interface SessionActivitySummary {
  readonly sessionId: SessionId
  readonly lastActivityAt: string
  readonly lastActivityAgeMs: number
}

export interface SessionEndedAgeSummary {
  readonly sessionId: SessionId
  readonly endedAt: string
  readonly endedAgeMs: number
}

export type SessionCleanupDecision =
  | {
      readonly action: 'retain'
      readonly reason: 'active-not-idle'
      readonly sessionId: SessionId
      readonly status: 'active'
      readonly now: string
      readonly idleForMs: number
      readonly lastActivityAt: string
    }
  | {
      readonly action: 'end-idle'
      readonly reason: 'idle-timeout'
      readonly sessionId: SessionId
      readonly status: 'active'
      readonly now: string
      readonly idleForMs: number
      readonly lastActivityAt: string
    }
  | {
      readonly action: 'retain'
      readonly reason: 'ended-retained'
      readonly sessionId: SessionId
      readonly status: 'ended'
      readonly now: string
      readonly endedForMs: number
      readonly endedAt: string
    }
  | {
      readonly action: 'delete-ended'
      readonly reason: 'ended-retention-expired'
      readonly sessionId: SessionId
      readonly status: 'ended'
      readonly now: string
      readonly endedForMs: number
      readonly endedAt: string
    }

export type SessionOperationTrackerCleanupHandle = Pick<
  InMemorySessionOperationTracker,
  'clearSession'
>

export interface EndSessionExplicitlyOptions {
  readonly endedAt?: string
  readonly clock?: SessionCleanupClock
  readonly reason?: SessionEndReason
  /**
   * Defaults to the process-local sessionOperationTracker. Tests and future
   * server adapters may pass an isolated tracker.
   */
  readonly operationTracker?: SessionOperationTrackerCleanupHandle
  /** Defaults to true. */
  readonly clearOperationTracker?: boolean
}

export type EndSessionExplicitlyResult<TState = AuthoritativeSessionState> =
  | {
      readonly ok: true
      readonly status: 'ended'
      readonly sessionId: SessionId
      readonly reason: SessionEndReason
      readonly record: SessionStoreRecord<TState>
      readonly operationRecordsCleared: boolean
    }
  | {
      readonly ok: true
      readonly status: 'already-ended'
      readonly sessionId: SessionId
      readonly reason: SessionEndReason
      readonly record: SessionStoreRecord<TState>
      readonly operationRecordsCleared: boolean
    }
  | {
      readonly ok: false
      readonly status: 'not-found'
      readonly sessionId: SessionId
      readonly reason: SessionEndReason
      readonly operationRecordsCleared: false
    }

export interface CleanupExpiredSessionsOptions extends GetSessionCleanupDecisionOptions {
  readonly operationTracker?: SessionOperationTrackerCleanupHandle
  /** Defaults to true. */
  readonly clearOperationTracker?: boolean
}

export interface SessionCleanupEndedRecord<TState = AuthoritativeSessionState> {
  readonly sessionId: SessionId
  readonly reason: 'idle-timeout'
  readonly record: SessionStoreRecord<TState>
  readonly operationRecordsCleared: boolean
}

export interface SessionCleanupDeletedRecord {
  readonly sessionId: SessionId
  readonly reason: 'ended-retention-expired'
  readonly deleted: boolean
  readonly operationRecordsCleared: boolean
}

export interface SessionCleanupRunResult<TState = AuthoritativeSessionState> {
  readonly now: string
  readonly policy: SessionCleanupPolicy
  readonly evaluated: number
  readonly decisions: readonly SessionCleanupDecision[]
  readonly retained: readonly SessionCleanupDecision[]
  readonly ended: readonly SessionCleanupEndedRecord<TState>[]
  readonly deleted: readonly SessionCleanupDeletedRecord[]
}

type UnknownRecord = Record<string, unknown>

const defaultSessionCleanupClock: SessionCleanupClock = () => new Date().toISOString()

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const assertDurationMs = (
  value: number,
  label: string,
  options: { readonly allowZero: boolean },
): void => {
  const validLowerBound = options.allowZero ? value >= 0 : value > 0
  if (!Number.isSafeInteger(value) || !validLowerBound) {
    throw new Error(`${label} must be ${options.allowZero ? 'a non-negative' : 'a positive'} safe integer millisecond duration`)
  }
}

const parseTimestampMs = (timestamp: string | undefined): number | undefined => {
  if (timestamp === undefined) return undefined
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? parsed : undefined
}

const ageMs = (nowMs: number, timestampMs: number): number => Math.max(0, nowMs - timestampMs)

const latestTimestamp = (
  candidates: readonly (string | undefined)[],
  fallback: string,
): { readonly timestamp: string, readonly timestampMs: number } => {
  const fallbackMs = parseTimestampMs(fallback)
  const validCandidates = candidates
    .map((timestamp) => ({ timestamp, timestampMs: parseTimestampMs(timestamp) }))
    .filter(
      (candidate): candidate is { readonly timestamp: string, readonly timestampMs: number } =>
        candidate.timestamp !== undefined && candidate.timestampMs !== undefined,
    )

  if (validCandidates.length === 0) {
    return {
      timestamp: fallback,
      timestampMs: fallbackMs ?? 0,
    }
  }

  return validCandidates.reduce((latest, candidate) =>
    candidate.timestampMs > latest.timestampMs ? candidate : latest,
  )
}

const collectStateActivityTimestamps = (state: unknown): string[] => {
  if (!isRecord(state)) return []

  const timestamps: string[] = []
  if (typeof state.updatedAt === 'string') timestamps.push(state.updatedAt)

  if (Array.isArray(state.connectedClients)) {
    for (const client of state.connectedClients) {
      if (!isRecord(client)) continue
      if (typeof client.connectedAt === 'string') timestamps.push(client.connectedAt)
      if (typeof client.lastSeenAt === 'string') timestamps.push(client.lastSeenAt)
      if (typeof client.disconnectedAt === 'string') timestamps.push(client.disconnectedAt)
    }
  }

  if (Array.isArray(state.players)) {
    for (const player of state.players) {
      if (!isRecord(player)) continue
      if (typeof player.joinedAt === 'string') timestamps.push(player.joinedAt)
      if (typeof player.updatedAt === 'string') timestamps.push(player.updatedAt)
    }
  }

  if (Array.isArray(state.assignments)) {
    for (const assignment of state.assignments) {
      if (!isRecord(assignment)) continue
      if (typeof assignment.updatedAt === 'string') timestamps.push(assignment.updatedAt)
    }
  }

  return timestamps
}

const nowFromOptions = (options: { readonly now?: string, readonly clock?: SessionCleanupClock }): string =>
  options.now ?? options.clock?.() ?? defaultSessionCleanupClock()

const clearOperationTrackerForSession = (
  sessionId: SessionId,
  options: {
    readonly operationTracker?: SessionOperationTrackerCleanupHandle
    readonly clearOperationTracker?: boolean
  },
): boolean => {
  if (options.clearOperationTracker === false) return false
  return (options.operationTracker ?? sessionOperationTracker).clearSession(sessionId)
}

export const createSessionCleanupPolicy = (
  input: CreateSessionCleanupPolicyInput = {},
): SessionCleanupPolicy => {
  const idleTimeoutMs = input.idleTimeoutMs ?? DEFAULT_SESSION_CLEANUP_POLICY.idleTimeoutMs
  const endedRetentionMs = input.endedRetentionMs ?? DEFAULT_SESSION_CLEANUP_POLICY.endedRetentionMs

  assertDurationMs(idleTimeoutMs, 'idleTimeoutMs', { allowZero: false })
  assertDurationMs(endedRetentionMs, 'endedRetentionMs', { allowZero: true })

  return { idleTimeoutMs, endedRetentionMs }
}

export const getSessionRecordLastActivity = <TState>(
  record: SessionStoreRecord<TState>,
  now: string = defaultSessionCleanupClock(),
): SessionActivitySummary => {
  const latest = latestTimestamp(
    [record.createdAt, record.updatedAt, ...collectStateActivityTimestamps(record.state)],
    now,
  )
  const nowMs = parseTimestampMs(now) ?? latest.timestampMs

  return {
    sessionId: record.sessionId,
    lastActivityAt: latest.timestamp,
    lastActivityAgeMs: ageMs(nowMs, latest.timestampMs),
  }
}

export const getEndedSessionAge = <TState>(
  record: SessionStoreRecord<TState>,
  now: string = defaultSessionCleanupClock(),
): SessionEndedAgeSummary => {
  const latest = latestTimestamp([record.endedAt, record.updatedAt], now)
  const nowMs = parseTimestampMs(now) ?? latest.timestampMs

  return {
    sessionId: record.sessionId,
    endedAt: latest.timestamp,
    endedAgeMs: ageMs(nowMs, latest.timestampMs),
  }
}

export const getSessionCleanupDecision = <TState>(
  record: SessionStoreRecord<TState>,
  options: GetSessionCleanupDecisionOptions = {},
): SessionCleanupDecision => {
  const policy = createSessionCleanupPolicy(options)
  const now = nowFromOptions(options)

  if (record.status === 'active') {
    const activity = getSessionRecordLastActivity(record, now)
    return activity.lastActivityAgeMs >= policy.idleTimeoutMs
      ? {
          action: 'end-idle',
          reason: 'idle-timeout',
          sessionId: record.sessionId,
          status: record.status,
          now,
          idleForMs: activity.lastActivityAgeMs,
          lastActivityAt: activity.lastActivityAt,
        }
      : {
          action: 'retain',
          reason: 'active-not-idle',
          sessionId: record.sessionId,
          status: record.status,
          now,
          idleForMs: activity.lastActivityAgeMs,
          lastActivityAt: activity.lastActivityAt,
        }
  }

  const endedAge = getEndedSessionAge(record, now)
  return endedAge.endedAgeMs >= policy.endedRetentionMs
    ? {
        action: 'delete-ended',
        reason: 'ended-retention-expired',
        sessionId: record.sessionId,
        status: record.status,
        now,
        endedForMs: endedAge.endedAgeMs,
        endedAt: endedAge.endedAt,
      }
    : {
        action: 'retain',
        reason: 'ended-retained',
        sessionId: record.sessionId,
        status: record.status,
        now,
        endedForMs: endedAge.endedAgeMs,
        endedAt: endedAge.endedAt,
      }
}

export const endSessionExplicitly = <TState = AuthoritativeSessionState>(
  store: InMemorySessionStore<TState>,
  sessionId: SessionId,
  options: EndSessionExplicitlyOptions = {},
): EndSessionExplicitlyResult<TState> => {
  const reason = options.reason ?? 'gm-ended'
  const existing = store.get(sessionId)

  if (existing === undefined) {
    return {
      ok: false,
      status: 'not-found',
      sessionId,
      reason,
      operationRecordsCleared: false,
    }
  }

  const operationRecordsCleared = clearOperationTrackerForSession(sessionId, options)

  if (existing.status === 'ended') {
    return {
      ok: true,
      status: 'already-ended',
      sessionId,
      reason,
      record: existing,
      operationRecordsCleared,
    }
  }

  const endedAt = options.endedAt ?? options.clock?.() ?? defaultSessionCleanupClock()
  const record = store.end(sessionId, { endedAt })

  if (record === undefined) {
    return {
      ok: false,
      status: 'not-found',
      sessionId,
      reason,
      operationRecordsCleared: false,
    }
  }

  return {
    ok: true,
    status: 'ended',
    sessionId,
    reason,
    record,
    operationRecordsCleared,
  }
}

export const cleanupExpiredSessions = <TState = AuthoritativeSessionState>(
  store: InMemorySessionStore<TState>,
  options: CleanupExpiredSessionsOptions = {},
): SessionCleanupRunResult<TState> => {
  const policy = createSessionCleanupPolicy(options)
  const now = nowFromOptions(options)
  const decisions: SessionCleanupDecision[] = []
  const retained: SessionCleanupDecision[] = []
  const ended: SessionCleanupEndedRecord<TState>[] = []
  const deleted: SessionCleanupDeletedRecord[] = []

  for (const record of store.list()) {
    const decision = getSessionCleanupDecision(record, { ...policy, now })
    decisions.push(decision)

    if (decision.action === 'retain') {
      retained.push(decision)
      continue
    }

    if (decision.action === 'end-idle') {
      const result = endSessionExplicitly(store, decision.sessionId, {
        endedAt: now,
        reason: 'idle-timeout',
        operationTracker: options.operationTracker,
        clearOperationTracker: options.clearOperationTracker,
      })

      if (result.ok && result.status === 'ended') {
        ended.push({
          sessionId: decision.sessionId,
          reason: 'idle-timeout',
          record: result.record,
          operationRecordsCleared: result.operationRecordsCleared,
        })
      }
      continue
    }

    const operationRecordsCleared = clearOperationTrackerForSession(decision.sessionId, options)
    deleted.push({
      sessionId: decision.sessionId,
      reason: 'ended-retention-expired',
      deleted: store.delete(decision.sessionId),
      operationRecordsCleared,
    })
  }

  return {
    now,
    policy,
    evaluated: decisions.length,
    decisions,
    retained,
    ended,
    deleted,
  }
}

export const endDefaultSessionExplicitly = (
  sessionId: SessionId,
  options: EndSessionExplicitlyOptions = {},
): EndSessionExplicitlyResult<AuthoritativeSessionState> =>
  endSessionExplicitly(sessionStore, sessionId, options)

export const cleanupDefaultExpiredSessions = (
  options: CleanupExpiredSessionsOptions = {},
): SessionCleanupRunResult<AuthoritativeSessionState> => cleanupExpiredSessions(sessionStore, options)
