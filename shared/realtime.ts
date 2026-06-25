import type { LivePlayPatch } from './livePlayCommands'
import type { SheetKind } from './sheets'

export interface RealtimeEvent<TData = unknown> {
  /** Durable global sequence when the event came from the replayable event log. */
  readonly sequence?: number
  /** Channel name, e.g. `map:foo` or `sheets`. */
  channel: string
  /** Operation type, e.g. `updated`, `deleted`, `renamed`, `moved`. */
  type: string
  /** Optional authoritative revision for map-scoped events. */
  revision?: number
  /** Previous authoritative revision when the event represents a revision step. */
  previousRevision?: number
  /** Optional operation id for live-play command events. */
  opId?: string
  /** Optional live-play patches accepted by the server. */
  patches?: LivePlayPatch[]
  /** Optional structured payload. */
  data?: TData
  /** Originating tab's client id, used for echo suppression. */
  clientId?: string
  /** Server timestamp (ms) so clients can ignore stale events. */
  timestamp: number
}

export const mapsChannel = 'maps'
export const sheetsChannel = 'sheets'

export const LIVE_PLAY_REALTIME_EVENT_TYPES = {
  COMMAND_ACCEPTED: 'live-play-command-accepted',
  COMMAND_REJECTED: 'live-play-command-rejected',
  MAP_RECONCILED: 'live-play-map-reconciled',
} as const

export type LivePlayRealtimeEventType = (
  typeof LIVE_PLAY_REALTIME_EVENT_TYPES
)[keyof typeof LIVE_PLAY_REALTIME_EVENT_TYPES]

export interface LivePlayRealtimeEvent<TData = unknown> extends RealtimeEvent<TData> {
  channel: `map:${string}`
  type: LivePlayRealtimeEventType
  mapSlug: string
  revision: number
  previousRevision?: number
  opId?: string
  patches?: LivePlayPatch[]
}

export const mapChannel = (slug: string): `map:${string}` => `map:${slug}`
export const sheetChannel = (kind: SheetKind, slug: string): `sheet:${SheetKind}:${string}` =>
  `sheet:${kind}:${slug}`

export const REALTIME_EVENT_TYPES = [
  'created',
  'updated',
  'deleted',
  'renamed',
  'moved',
  'folder-created',
  'folder-deleted',
  'folder-moved',
] as const

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number]

export const normalizeRealtimeClientId = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

export const isRealtimeEcho = (
  event: Pick<RealtimeEvent, 'clientId'> | null | undefined,
  clientId: string | null | undefined,
): boolean => typeof clientId === 'string' && event?.clientId === clientId
