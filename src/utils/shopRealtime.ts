import { isRealtimeEcho, shopChannel, type RealtimeEvent } from '#shared/realtime'
import { normalizeShopTableDocument, type ShopTableDocument } from '~/types/shop'
import { stableJsonStringify } from '~/utils/serialization'

export type ShopRealtimeApplicationResult =
  | { readonly status: 'ignored' }
  | { readonly status: 'ignored-echo' }
  | { readonly status: 'ignored-stale' }
  | { readonly status: 'unchanged'; readonly document: ShopTableDocument }
  | { readonly status: 'adopted'; readonly document: ShopTableDocument }
  | { readonly status: 'deleted' }
  | { readonly status: 'invalid'; readonly message: string }

export interface ApplyShopRealtimeEventOptions {
  readonly currentDocument?: ShopTableDocument | null
  readonly clientId?: string | null
  readonly expectedSlug?: string | null
}

interface ShopRealtimePayload {
  readonly slug?: unknown
  readonly document?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const safeRevision = (value: unknown): number | null => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
)

const normalizedExpectedSlug = (options: ApplyShopRealtimeEventOptions): string | null => {
  const explicit = typeof options.expectedSlug === 'string' ? options.expectedSlug.trim() : ''
  if (explicit) return explicit
  const current = typeof options.currentDocument?.slug === 'string' ? options.currentDocument.slug.trim() : ''
  return current || null
}

const normalizeIncomingDocument = (
  payload: ShopRealtimePayload | undefined,
  expectedSlug: string,
): ShopTableDocument | null => {
  if (!payload || typeof payload.slug !== 'string') return null
  if (payload.slug !== expectedSlug) return null
  if (!isRecord(payload.document)) return null

  const document = normalizeShopTableDocument(payload.document, { slug: expectedSlug })
  return document.slug === expectedSlug ? document : null
}

const isSameDocument = (
  left: ShopTableDocument | null | undefined,
  right: ShopTableDocument,
): boolean => !!left && stableJsonStringify(left) === stableJsonStringify(right)

export const applyShopRealtimeEvent = (
  event: Pick<RealtimeEvent, 'channel' | 'type' | 'revision' | 'clientId' | 'data'>,
  options: ApplyShopRealtimeEventOptions = {},
): ShopRealtimeApplicationResult => {
  const expectedSlug = normalizedExpectedSlug(options)
  if (!expectedSlug || event.channel !== shopChannel(expectedSlug)) return { status: 'ignored' }
  if (isRealtimeEcho(event, options.clientId)) return { status: 'ignored-echo' }

  const payload = event.data as ShopRealtimePayload | undefined

  if (event.type === 'deleted') {
    if (payload?.slug !== undefined && payload.slug !== expectedSlug) return { status: 'ignored' }
    return { status: 'deleted' }
  }

  if (event.type !== 'updated' && event.type !== 'created') return { status: 'ignored' }

  const document = normalizeIncomingDocument(payload, expectedSlug)
  if (!document) return { status: 'invalid', message: 'Shop realtime update did not include a complete document.' }

  const eventRevision = safeRevision(event.revision)
  if (eventRevision !== null && eventRevision !== document.revision) {
    return { status: 'invalid', message: 'Shop realtime event revision did not match its document.' }
  }

  const currentRevision = safeRevision(options.currentDocument?.revision)
  if (currentRevision !== null) {
    if (document.revision < currentRevision) return { status: 'ignored-stale' }
    if (document.revision === currentRevision && !isSameDocument(options.currentDocument, document)) {
      return {
        status: 'invalid',
        message: `Shop ${expectedSlug} realtime update diverged at revision ${document.revision}.`,
      }
    }
  }

  if (isSameDocument(options.currentDocument, document)) return { status: 'unchanged', document }

  return { status: 'adopted', document }
}
