import { groupInventoryChannel, isRealtimeEcho, type RealtimeEvent } from '#shared/realtime'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  normalizeGroupInventoryDocument,
  type GroupInventoryDocument,
} from '~/types/groupInventory'
import { stableJsonStringify } from '~/utils/serialization'

export type GroupInventoryRealtimeApplicationResult =
  | { readonly status: 'ignored' }
  | { readonly status: 'ignored-echo' }
  | { readonly status: 'ignored-stale' }
  | { readonly status: 'unchanged'; readonly document: GroupInventoryDocument }
  | { readonly status: 'adopted'; readonly document: GroupInventoryDocument }
  | { readonly status: 'invalid'; readonly message: string }

export interface ApplyGroupInventoryRealtimeEventOptions {
  readonly currentDocument?: GroupInventoryDocument | null
  readonly clientId?: string | null
  readonly expectedSlug?: string
}

interface GroupInventoryRealtimePayload {
  readonly slug?: unknown
  readonly document?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const safeRevision = (value: unknown): number | null => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
)

const normalizeIncomingDocument = (
  payload: GroupInventoryRealtimePayload | undefined,
  expectedSlug: string,
): GroupInventoryDocument | null => {
  if (!payload || typeof payload.slug !== 'string') return null
  if (payload.slug !== expectedSlug) return null
  if (!isRecord(payload.document)) return null

  const document = normalizeGroupInventoryDocument(payload.document, { slug: expectedSlug })
  return document.slug === expectedSlug ? document : null
}

const isSameDocument = (
  left: GroupInventoryDocument | null | undefined,
  right: GroupInventoryDocument,
): boolean => !!left && stableJsonStringify(left) === stableJsonStringify(right)

export const applyGroupInventoryRealtimeEvent = (
  event: Pick<RealtimeEvent, 'channel' | 'type' | 'revision' | 'clientId' | 'data'>,
  options: ApplyGroupInventoryRealtimeEventOptions = {},
): GroupInventoryRealtimeApplicationResult => {
  const expectedSlug = options.expectedSlug ?? GROUP_INVENTORY_MAIN_SLUG
  if (event.channel !== groupInventoryChannel(expectedSlug) || event.type !== 'updated') {
    return { status: 'ignored' }
  }
  if (isRealtimeEcho(event, options.clientId)) return { status: 'ignored-echo' }

  const document = normalizeIncomingDocument(event.data as GroupInventoryRealtimePayload | undefined, expectedSlug)
  if (!document) return { status: 'invalid', message: 'Group inventory realtime update did not include a complete document.' }

  const eventRevision = safeRevision(event.revision)
  if (eventRevision !== null && eventRevision !== document.revision) {
    return { status: 'invalid', message: 'Group inventory realtime event revision did not match its document.' }
  }

  const currentRevision = safeRevision(options.currentDocument?.revision)
  if (currentRevision !== null && document.revision < currentRevision) return { status: 'ignored-stale' }
  if (isSameDocument(options.currentDocument, document)) return { status: 'unchanged', document }

  return { status: 'adopted', document }
}
