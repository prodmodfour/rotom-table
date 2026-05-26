import type { SessionSnapshotMessage } from '#shared/sessionMessages'
import type { Revision } from '#shared/sessionRevisions'
import type {
  SessionMapSnapshotStatus,
  SessionMapStatus,
} from '~/composables/map-editor/useSessionMap'
import type {
  SessionSocketHeartbeatStatus,
  SessionSocketHelloStatus,
  SessionSocketReconnectStatus,
  SessionSocketStatus,
} from '~/composables/useSessionSocket'

export type SessionConnectionStatusKind = 'reconnecting' | 'recovered-snapshot' | 'disconnected' | 'stale'
export type SessionConnectionStatusTone = 'info' | 'success' | 'warning' | 'danger'

export interface SessionConnectionStatusNotice {
  readonly kind: SessionConnectionStatusKind
  readonly tone: SessionConnectionStatusTone
  readonly title: string
  readonly summary: string
  readonly detail: string
  readonly currentRevision: Revision | null
  readonly actionLabel?: string
}

export interface BuildSessionConnectionStatusNoticeInput {
  readonly enabled: boolean
  readonly status: SessionMapStatus
  readonly socketStatus: SessionSocketStatus
  readonly helloStatus: SessionSocketHelloStatus
  readonly heartbeatStatus: SessionSocketHeartbeatStatus
  readonly reconnectStatus: SessionSocketReconnectStatus
  readonly snapshotStatus: SessionMapSnapshotStatus
  readonly hasAuthoritativeSessionState: boolean
  readonly lastKnownRevision: Revision | null
  readonly lastSnapshot: SessionSnapshotMessage<unknown> | null
  readonly lastError?: string | null
}

const reconnectingStatuses = new Set<SessionMapStatus>([
  'connecting',
  'handshaking',
  'loading-snapshot',
])

const closedSocketStatuses = new Set<SessionSocketStatus>([
  'closed',
  'error',
  'unavailable',
])

const revisionFromInput = (input: BuildSessionConnectionStatusNoticeInput): Revision | null => (
  input.lastKnownRevision ?? input.lastSnapshot?.currentRevision ?? null
)

const cleanDetail = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized.length === 0) return null
  return normalized.length > 160 ? `${normalized.slice(0, 159).trimEnd()}…` : normalized
}

const revisionPhrase = (revision: Revision | null): string => (
  revision === null ? 'unknown revision' : `revision ${revision}`
)

const staleNotice = (
  input: BuildSessionConnectionStatusNoticeInput,
  title: string,
  summary: string,
  detail: string,
): SessionConnectionStatusNotice => ({
  kind: 'stale',
  tone: 'warning',
  title,
  summary,
  detail,
  currentRevision: revisionFromInput(input),
  actionLabel: 'Refresh snapshot',
})

export const buildSessionConnectionStatusNotice = (
  input: BuildSessionConnectionStatusNoticeInput,
): SessionConnectionStatusNotice | null => {
  if (!input.enabled) return null

  const currentRevision = revisionFromInput(input)

  if (input.snapshotStatus === 'missing-map') {
    return staleNotice(
      input,
      'Session snapshot did not include this map',
      'The session map view is not authoritative for the current map yet.',
      'Ask the GM to make this session map visible or refresh after assignments change.'
    )
  }

  if (input.heartbeatStatus === 'stale') {
    return staleNotice(
      input,
      'Session heartbeat is stale',
      'This browser stopped receiving timely session socket heartbeat traffic from session hosting.',
      'Treat the visible session map as read-only until a fresh authoritative snapshot is recovered.'
    )
  }

  if (closedSocketStatuses.has(input.socketStatus)) {
    const fallbackDetail = input.socketStatus === 'unavailable'
      ? 'Session socket support is unavailable in this browser/runtime.'
      : input.socketStatus === 'error'
        ? 'The session socket reported an error.'
        : 'The session socket is closed.'
    return {
      kind: 'disconnected',
      tone: 'danger',
      title: 'Disconnected from session hosting',
      summary: input.hasAuthoritativeSessionState
        ? `Showing the last authoritative session map at ${revisionPhrase(currentRevision)}.`
        : 'No authoritative session map snapshot is currently available for this map.',
      detail: cleanDetail(input.lastError) ?? fallbackDetail,
      currentRevision,
      actionLabel: 'Reconnect',
    }
  }

  if (input.reconnectStatus === 'snapshot-required') {
    if (input.hasAuthoritativeSessionState) {
      return staleNotice(
        input,
        'Waiting for a fresh session snapshot',
        `Your visible session map may be stale after ${revisionPhrase(currentRevision)}.`,
        'Session hosting could not replay every missed event, so the client is waiting for a full authoritative snapshot.',
      )
    }

    return {
      kind: 'reconnecting',
      tone: 'info',
      title: 'Loading authoritative snapshot',
      summary: 'Session hosting requested snapshot recovery for this session map view.',
      detail: 'Session commands should wait until the reconnect snapshot has arrived.',
      currentRevision,
    }
  }

  if (input.snapshotStatus === 'requested' && input.hasAuthoritativeSessionState) {
    return staleNotice(
      input,
      'Refreshing session authority',
      `Showing the last authoritative session map at ${revisionPhrase(currentRevision)} while a fresh snapshot is requested.`,
      'Avoid making repeat actions until the refreshed snapshot arrives.',
    )
  }

  if (
    input.socketStatus === 'connecting' ||
    input.helloStatus === 'queued' ||
    input.helloStatus === 'sent' ||
    reconnectingStatuses.has(input.status) ||
    input.snapshotStatus === 'requested'
  ) {
    return {
      kind: 'reconnecting',
      tone: 'info',
      title: 'Reconnecting to session hosting',
      summary: input.hasAuthoritativeSessionState
        ? `Keeping the last session map visible at ${revisionPhrase(currentRevision)} while the session socket reconnects.`
        : 'Opening the session socket and asking session hosting for the authoritative session map.',
      detail: 'Session commands will queue or wait for hello/snapshot recovery before the server applies them.',
      currentRevision,
    }
  }

  if (
    input.reconnectStatus === 'snapshot-received' ||
    (input.lastSnapshot?.reason === 'reconnect' && input.snapshotStatus === 'received')
  ) {
    return {
      kind: 'recovered-snapshot',
      tone: 'success',
      title: 'Recovered authoritative snapshot',
      summary: `Live session state is current through ${revisionPhrase(currentRevision)}.`,
      detail: 'The session map view was rebuilt from the GM-hosted authoritative snapshot rather than a local autosave.',
      currentRevision,
    }
  }

  return null
}
