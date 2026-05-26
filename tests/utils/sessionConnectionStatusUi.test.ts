import { describe, expect, it } from 'vitest'
import { SESSION_MESSAGE_SCHEMA_VERSION, type SessionSnapshotMessage } from '#shared/sessionMessages'
import { parseSessionId } from '#shared/sessionIdentity'
import { parseSessionRevision, type Revision, type SessionRevision } from '#shared/sessionRevisions'
import {
  buildSessionConnectionStatusNotice,
  type BuildSessionConnectionStatusNoticeInput,
} from '~/utils/sessionConnectionStatusUi'

const SESSION_ID = parseSessionId('session_statusui0001')
const REVISION_2 = parseSessionRevision(2)
const REVISION_3 = parseSessionRevision(3)

const reconnectSnapshot = (revision: SessionRevision = REVISION_3): SessionSnapshotMessage<unknown, SessionRevision> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'snapshot',
  direction: 'server',
  sessionId: SESSION_ID,
  reason: 'reconnect',
  currentRevision: revision,
  replayAvailable: false,
  snapshot: {
    sessionId: SESSION_ID,
    revision,
    maps: [],
  },
})

const baseInput = (
  overrides: Partial<BuildSessionConnectionStatusNoticeInput> = {},
): BuildSessionConnectionStatusNoticeInput => ({
  enabled: true,
  status: 'ready',
  socketStatus: 'open',
  helloStatus: 'accepted',
  heartbeatStatus: 'active',
  reconnectStatus: 'idle',
  snapshotStatus: 'idle',
  hasAuthoritativeSessionState: true,
  lastKnownRevision: REVISION_2 as Revision,
  lastSnapshot: null,
  lastError: null,
  ...overrides,
})

describe('buildSessionConnectionStatusNotice', () => {
  it('does not render connection UI outside explicit session mode', () => {
    expect(buildSessionConnectionStatusNotice(baseInput({ enabled: false }))).toBeNull()
  })

  it('shows reconnecting while the socket or hello handshake is pending', () => {
    const notice = buildSessionConnectionStatusNotice(baseInput({
      status: 'handshaking',
      socketStatus: 'connecting',
      helloStatus: 'queued',
      hasAuthoritativeSessionState: false,
      lastKnownRevision: null,
    }))

    expect(notice).toMatchObject({
      kind: 'reconnecting',
      tone: 'info',
      title: 'Reconnecting to session host',
      currentRevision: null,
    })
    expect(notice?.summary).toContain('Opening the session WebSocket')
    expect(notice?.actionLabel).toBeUndefined()
  })

  it('shows recovered snapshot state after reconnect fallback arrives', () => {
    const snapshot = reconnectSnapshot(REVISION_3)
    const notice = buildSessionConnectionStatusNotice(baseInput({
      reconnectStatus: 'snapshot-received',
      snapshotStatus: 'received',
      lastKnownRevision: REVISION_3,
      lastSnapshot: snapshot,
    }))

    expect(notice).toMatchObject({
      kind: 'recovered-snapshot',
      tone: 'success',
      title: 'Recovered authoritative snapshot',
      currentRevision: REVISION_3,
    })
    expect(notice?.summary).toContain('revision 3')
    expect(notice?.detail).toContain('authoritative snapshot')
  })

  it('shows disconnected state while keeping the last authoritative revision visible', () => {
    const notice = buildSessionConnectionStatusNotice(baseInput({
      socketStatus: 'closed',
      heartbeatStatus: 'idle',
      lastKnownRevision: REVISION_2,
      lastError: 'Socket closed by the browser.\nRetry soon.',
    }))

    expect(notice).toMatchObject({
      kind: 'disconnected',
      tone: 'danger',
      title: 'Disconnected from session host',
      currentRevision: REVISION_2,
      actionLabel: 'Reconnect',
    })
    expect(notice?.summary).toContain('last authoritative table state')
    expect(notice?.detail).toBe('Socket closed by the browser. Retry soon.')
  })

  it('shows stale state for heartbeat timeouts before a reconnect snapshot is recovered', () => {
    const notice = buildSessionConnectionStatusNotice(baseInput({
      socketStatus: 'closing',
      heartbeatStatus: 'stale',
      reconnectStatus: 'idle',
      lastKnownRevision: REVISION_2,
    }))

    expect(notice).toMatchObject({
      kind: 'stale',
      tone: 'warning',
      title: 'Session heartbeat is stale',
      currentRevision: REVISION_2,
      actionLabel: 'Refresh snapshot',
    })
    expect(notice?.detail).toContain('read-only')
  })

  it('marks previously loaded table state stale while snapshot fallback is required', () => {
    const notice = buildSessionConnectionStatusNotice(baseInput({
      reconnectStatus: 'snapshot-required',
      snapshotStatus: 'requested',
      hasAuthoritativeSessionState: true,
      lastKnownRevision: REVISION_2,
    }))

    expect(notice).toMatchObject({
      kind: 'stale',
      tone: 'warning',
      title: 'Waiting for a fresh session snapshot',
      actionLabel: 'Refresh snapshot',
    })
    expect(notice?.summary).toContain('revision 2')
  })

  it('warns safely when the reconnect snapshot lacks the current map', () => {
    const notice = buildSessionConnectionStatusNotice(baseInput({
      snapshotStatus: 'missing-map',
      lastSnapshot: reconnectSnapshot(REVISION_3),
      lastKnownRevision: null,
    }))

    expect(notice).toMatchObject({
      kind: 'stale',
      tone: 'warning',
      title: 'Session snapshot did not include this map',
      currentRevision: REVISION_3,
      actionLabel: 'Refresh snapshot',
    })
    expect(JSON.stringify(notice)).not.toContain('gmkey')
  })
})
