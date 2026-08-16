import type { LivePlayPatch } from './livePlayCommands'
import type { AcceptedEncounterPresentation } from './encounterPresentation'
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
  /** Generic presentation for an already accepted action. */
  presentation?: AcceptedEncounterPresentation
  /** Optional structured payload. */
  data?: TData
  /** Originating tab's client id, used for echo suppression. */
  clientId?: string
  /** Server timestamp (ms) so clients can ignore stale events. */
  timestamp: number
}

export const mapsChannel = 'maps'
export const sheetsChannel = 'sheets'
export const shopsChannel = 'shops'
export const campaignAttentionChannel = 'campaign-attention'

export const CAMPAIGN_ATTENTION_REALTIME_EVENT_TYPES = {
  INVALIDATED: 'campaign-attention-invalidated',
} as const

export type CampaignAttentionRealtimeEventType = typeof CAMPAIGN_ATTENTION_REALTIME_EVENT_TYPES[
  keyof typeof CAMPAIGN_ATTENTION_REALTIME_EVENT_TYPES
]
export const groupInventoryChannel = (slug: string): `group-inventory:${string}` => `group-inventory:${slug}`
export const encountersChannel = 'encounters'
export const encounterChannel = (encounterId: string): `encounter:${string}` => `encounter:${encounterId}`
export const encounterSettlementChannel = (
  encounterId: string,
): `encounter-settlement:${string}` => `encounter-settlement:${encounterId}`

export const ENCOUNTER_SETTLEMENT_REALTIME_EVENT_TYPES = {
  UPDATED: 'encounter-settlement-updated',
  CORRECTED: 'encounter-settlement-corrected',
} as const

export type EncounterSettlementRealtimeEventType = typeof ENCOUNTER_SETTLEMENT_REALTIME_EVENT_TYPES[
  keyof typeof ENCOUNTER_SETTLEMENT_REALTIME_EVENT_TYPES
]

export const ENCOUNTER_DOCUMENT_REALTIME_EVENT_TYPES = {
  CREATED: 'encounter-document-created',
  UPDATED: 'encounter-document-updated',
} as const

export type EncounterDocumentRealtimeEventType = typeof ENCOUNTER_DOCUMENT_REALTIME_EVENT_TYPES[keyof typeof ENCOUNTER_DOCUMENT_REALTIME_EVENT_TYPES]

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
  presentation?: AcceptedEncounterPresentation
}

export const mapChannel = (slug: string): `map:${string}` => `map:${slug}`
export const shopChannel = (slug: string): `shop:${string}` => `shop:${slug}`
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
