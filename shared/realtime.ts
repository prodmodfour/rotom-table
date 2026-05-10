import type { SheetKind } from './sheets'

export interface RealtimeEvent<TData = unknown> {
  /** Channel name, e.g. `map:foo` or `sheets`. */
  channel: string
  /** Operation type, e.g. `updated`, `deleted`, `renamed`, `moved`. */
  type: string
  /** Optional structured payload. */
  data?: TData
  /** Originating tab's client id, used for echo suppression. */
  clientId?: string
  /** Server timestamp (ms) so clients can ignore stale events. */
  timestamp: number
}

export const mapsChannel = 'maps'
export const sheetsChannel = 'sheets'

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
