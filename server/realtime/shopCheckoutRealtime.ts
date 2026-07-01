import { createHash } from 'node:crypto'
import {
  LIVE_PLAY_COMMAND_TYPES,
  type ShopCheckoutCommandAccepted,
  type ShopCheckoutCommandRejected,
  type ShopCheckoutLivePlayCommand,
} from '#shared/livePlayCommands'
import { LIVE_PLAY_REALTIME_EVENT_TYPES, shopChannel, shopsChannel } from '#shared/realtime'
import {
  MAX_REALTIME_EVENT_DEDUPE_KEY_LENGTH,
  cloneRealtimeJsonValue,
  createRealtimeEventMaterial,
  stringifyCanonicalRealtimeJson,
  type RealtimeEventDraft,
} from '#shared/realtimeEventLog'
import { isSlug, SLUG_PATTERN_DESCRIPTION } from '#shared/paths'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { ShopTableDocument } from '~/types/shop'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'
import { groupInventoryUpdatedRealtimeAppendInputs } from './groupInventoryRealtime'
import {
  normalizeAuthoritativeSheetDocumentUpdate,
  normalizeRealtimeEventClientIdForEventLog,
  sheetDocumentUpdatedRealtimeAppendInput,
} from './sheetDocumentRealtime'

export type ShopCheckoutShopRealtimeDestination = 'document' | 'summary'
export type ShopCheckoutTrainerSheetRealtimeDestination = 'specific' | 'global'

export interface ShopRealtimeSummary {
  readonly slug: string
  readonly revision: number
  readonly updatedAt: number
  readonly name: string
  readonly folder?: string
  readonly description?: string
  readonly playerVisible: boolean
  readonly open: boolean
  readonly entryCount: number
}

export interface ShopCheckoutRealtimeAppendInputsOptions {
  readonly command: ShopCheckoutLivePlayCommand & { readonly clientId?: unknown }
  readonly result: ShopCheckoutCommandAccepted
  readonly clientId?: unknown
}

export interface ShopCheckoutRejectedRealtimeAppendInputOptions {
  readonly command: ShopCheckoutLivePlayCommand & { readonly clientId?: unknown }
  readonly result: ShopCheckoutCommandRejected
  readonly clientId?: unknown
}

interface NormalizedAuthoritativeShopDocumentUpdate {
  readonly slug: string
  readonly revision: number
  readonly updatedAt: number
  readonly document: ShopTableDocument
}

const assertSlug = (value: unknown, label: string): string => {
  if (!isSlug(value)) throw new Error(`${label} must match ${SLUG_PATTERN_DESCRIPTION}`)
  return value
}

const assertSafeNonNegativeInteger = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a safe non-negative integer`)
  }
  return value
}

const assertRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a complete JSON-safe object`)
  }
  return value as Record<string, unknown>
}

const stripUndefinedEventFields = (event: Record<string, unknown>): RealtimeEventDraft => {
  const stripped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event)) {
    if (value !== undefined) stripped[key] = value
  }
  return stripped as RealtimeEventDraft
}

const dedupeHash = (identity: unknown): string => createHash('sha256')
  .update(stringifyCanonicalRealtimeJson(identity, 'shop checkout realtime dedupe identity'))
  .digest('hex')

const boundedDedupeKey = (input: {
  readonly raw: string
  readonly prefix: string
  readonly destination: string
  readonly identity: unknown
}): string => {
  if (input.raw.length <= MAX_REALTIME_EVENT_DEDUPE_KEY_LENGTH) return input.raw
  return `${input.prefix}:${dedupeHash(input.identity)}:${input.destination}`
}

const normalizeAuthoritativeShopDocumentUpdate = (
  document: ShopTableDocument,
): NormalizedAuthoritativeShopDocumentUpdate => {
  const detachedDocument = assertRecord(cloneRealtimeJsonValue(document, 'shop checkout shop'), 'shop checkout shop')
  const slug = assertSlug(detachedDocument.slug, 'shop.slug')
  const revision = assertSafeNonNegativeInteger(detachedDocument.revision, 'shop.revision')
  const updatedAt = assertSafeNonNegativeInteger(detachedDocument.updatedAt, 'shop.updatedAt')
  return {
    slug,
    revision,
    updatedAt,
    document: detachedDocument as unknown as ShopTableDocument,
  }
}

const eventInput = (input: {
  readonly event: RealtimeEventDraft
  readonly access: AppendRealtimeEventInput['access']
  readonly dedupeKey: string
}): AppendRealtimeEventInput => {
  const material = createRealtimeEventMaterial(input)
  return {
    event: material.event,
    access: material.access,
    ...(material.dedupeKey === undefined ? {} : { dedupeKey: material.dedupeKey }),
  }
}

const shopCheckoutShopRealtimeDedupeKey = (input: {
  readonly shopSlug: string
  readonly opId: string
  readonly revision: number
  readonly destination: ShopCheckoutShopRealtimeDestination
}): string => {
  const shopSlug = assertSlug(input.shopSlug, 'shop slug')
  const revision = assertSafeNonNegativeInteger(input.revision, 'shop revision')
  const raw = `shop-checkout:shop:${shopSlug}:${input.opId}:${revision}:${input.destination}`
  return boundedDedupeKey({
    raw,
    prefix: 'shop-checkout:shop',
    destination: input.destination,
    identity: {
      kind: 'shop-checkout-shop',
      shopSlug,
      opId: input.opId,
      revision,
      destination: input.destination,
    },
  })
}

const shopCheckoutCommandRealtimeDedupeKey = (input: {
  readonly shopSlug: string
  readonly opId: string
  readonly disposition: 'accepted' | 'rejected'
}): string => {
  const shopSlug = assertSlug(input.shopSlug, 'shop slug')
  const raw = `shop-checkout-command:${shopSlug}:${input.opId}:${input.disposition}`
  return boundedDedupeKey({
    raw,
    prefix: 'shop-checkout-command',
    destination: input.disposition,
    identity: {
      kind: 'shop-checkout-command-terminal',
      shopSlug,
      opId: input.opId,
      disposition: input.disposition,
    },
  })
}

const acceptedCommandResultForRealtime = (
  result: ShopCheckoutCommandAccepted,
): ShopCheckoutCommandAccepted => cloneRealtimeJsonValue({
  ...result,
  documents: {
    shop: result.documents.shop,
  },
}, 'shop checkout accepted command result') as ShopCheckoutCommandAccepted

const rejectedCommandResultForRealtime = (
  result: ShopCheckoutCommandRejected,
): ShopCheckoutCommandRejected => {
  const { currentState: _currentState, ...safeResult } = result
  return cloneRealtimeJsonValue(safeResult, 'shop checkout rejected command result') as ShopCheckoutCommandRejected
}

const shopCheckoutAcceptedCommandRealtimeAppendInput = (input: {
  readonly command: ShopCheckoutLivePlayCommand
  readonly result: ShopCheckoutCommandAccepted
  readonly clientId?: string
}): AppendRealtimeEventInput => eventInput({
  event: stripUndefinedEventFields({
    channel: shopChannel(input.result.shopSlug),
    type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED,
    revision: input.result.shopRevision,
    previousRevision: input.result.previousShopRevision,
    opId: input.result.opId,
    ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
    data: {
      commandType: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
      shopSlug: input.result.shopSlug,
      result: acceptedCommandResultForRealtime(input.result),
    },
  }),
  access: {
    kind: 'shop-access' as const,
    shopSlug: input.result.shopSlug,
  },
  dedupeKey: shopCheckoutCommandRealtimeDedupeKey({
    shopSlug: input.result.shopSlug,
    opId: input.command.opId,
    disposition: 'accepted',
  }),
})

export const shopCheckoutTrainerSheetRealtimeDedupeKey = (input: {
  readonly opId: string
  readonly slug: string
  readonly revision: number
  readonly destination: ShopCheckoutTrainerSheetRealtimeDestination
}): string => {
  const slug = assertSlug(input.slug, 'trainer sheet slug')
  const revision = assertSafeNonNegativeInteger(input.revision, 'trainer sheet revision')
  const raw = `shop-checkout-sheet:trainer:${slug}:${input.opId}:${revision}:${input.destination}`
  return boundedDedupeKey({
    raw,
    prefix: 'shop-checkout-sheet:trainer',
    destination: input.destination,
    identity: {
      kind: 'shop-checkout-sheet',
      sheetKind: 'trainer',
      sheetSlug: slug,
      opId: input.opId,
      revision,
      destination: input.destination,
    },
  })
}

export const summarizeShopForRealtime = (shop: ShopTableDocument): ShopRealtimeSummary => {
  const update = normalizeAuthoritativeShopDocumentUpdate(shop)
  const summary: ShopRealtimeSummary = {
    slug: update.slug,
    revision: update.revision,
    updatedAt: update.updatedAt,
    name: update.document.name,
    ...(update.document.folder === undefined ? {} : { folder: update.document.folder }),
    ...(update.document.description === undefined ? {} : { description: update.document.description }),
    playerVisible: update.document.playerVisible,
    open: update.document.open,
    entryCount: update.document.entries.length,
  }
  return cloneRealtimeJsonValue(summary, 'shop realtime summary') as ShopRealtimeSummary
}

const shopDocumentRealtimeAppendInputs = (input: {
  readonly shop: ShopTableDocument
  readonly command: ShopCheckoutLivePlayCommand
  readonly clientId?: string
}): readonly AppendRealtimeEventInput[] => {
  const update = normalizeAuthoritativeShopDocumentUpdate(input.shop)
  const access = {
    kind: 'shop-access' as const,
    shopSlug: update.slug,
  }
  return [
    eventInput({
      event: stripUndefinedEventFields({
        channel: shopChannel(update.slug),
        type: 'updated',
        revision: update.revision,
        ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
        data: {
          slug: update.slug,
          document: update.document,
        },
      }),
      access,
      dedupeKey: shopCheckoutShopRealtimeDedupeKey({
        shopSlug: update.slug,
        opId: input.command.opId,
        revision: update.revision,
        destination: 'document',
      }),
    }),
    eventInput({
      event: stripUndefinedEventFields({
        channel: shopsChannel,
        type: 'updated',
        revision: update.revision,
        ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
        data: {
          slug: update.slug,
          summary: summarizeShopForRealtime(update.document),
        },
      }),
      access,
      dedupeKey: shopCheckoutShopRealtimeDedupeKey({
        shopSlug: update.slug,
        opId: input.command.opId,
        revision: update.revision,
        destination: 'summary',
      }),
    }),
  ]
}

const trainerSheetRealtimeAppendInputs = (input: {
  readonly trainerSheet: TrainerSheet
  readonly command: ShopCheckoutLivePlayCommand
  readonly clientId?: string
}): readonly AppendRealtimeEventInput[] => {
  const update = normalizeAuthoritativeSheetDocumentUpdate({
    kind: 'trainer',
    slug: input.trainerSheet.slug,
    sheet: input.trainerSheet as unknown as Record<string, unknown>,
  }, 'shop checkout trainer sheet')
  const revision = update.sheet.revision as number

  return [
    sheetDocumentUpdatedRealtimeAppendInput({
      update,
      destination: 'specific',
      clientId: input.clientId,
      dedupeKey: shopCheckoutTrainerSheetRealtimeDedupeKey({
        opId: input.command.opId,
        slug: update.slug,
        revision,
        destination: 'specific',
      }),
    }),
    sheetDocumentUpdatedRealtimeAppendInput({
      update,
      destination: 'global',
      clientId: input.clientId,
      dedupeKey: shopCheckoutTrainerSheetRealtimeDedupeKey({
        opId: input.command.opId,
        slug: update.slug,
        revision,
        destination: 'global',
      }),
    }),
  ]
}

const groupInventoryRealtimeAppendInputs = (input: {
  readonly groupInventory: GroupInventoryDocument
  readonly clientId?: string
}): readonly AppendRealtimeEventInput[] => groupInventoryUpdatedRealtimeAppendInputs(
  input.groupInventory,
  input.clientId,
  'shop-checkout',
)

export const shopCheckoutRejectedRealtimeAppendInput = (
  options: ShopCheckoutRejectedRealtimeAppendInputOptions,
): AppendRealtimeEventInput => {
  const clientId = normalizeRealtimeEventClientIdForEventLog(options.clientId ?? options.command.clientId)
  const shopSlug = assertSlug(options.result.shopSlug ?? options.command.payload.shopSlug, 'shop checkout rejected shop slug')
  const result = rejectedCommandResultForRealtime({
    ...options.result,
    shopSlug,
  })

  return eventInput({
    event: stripUndefinedEventFields({
      channel: shopChannel(shopSlug),
      type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_REJECTED,
      ...(result.currentShopRevision === undefined ? {} : { revision: result.currentShopRevision }),
      opId: result.opId,
      ...(clientId === undefined ? {} : { clientId }),
      data: {
        commandType: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
        shopSlug,
        result,
      },
    }),
    access: {
      kind: 'shop-access' as const,
      shopSlug,
    },
    dedupeKey: shopCheckoutCommandRealtimeDedupeKey({
      shopSlug,
      opId: options.command.opId,
      disposition: 'rejected',
    }),
  })
}

export const shopCheckoutRealtimeAppendInputs = (
  options: ShopCheckoutRealtimeAppendInputsOptions,
): readonly AppendRealtimeEventInput[] => {
  const clientId = normalizeRealtimeEventClientIdForEventLog(options.clientId ?? options.command.clientId)
  const documents = options.result.documents

  return [
    ...shopDocumentRealtimeAppendInputs({
      shop: documents.shop,
      command: options.command,
      clientId,
    }),
    ...(documents.groupInventories ?? []).flatMap((groupInventory) => groupInventoryRealtimeAppendInputs({
      groupInventory,
      clientId,
    })),
    ...(documents.trainerSheets ?? []).flatMap((trainerSheet) => trainerSheetRealtimeAppendInputs({
      trainerSheet,
      command: options.command,
      clientId,
    })),
    shopCheckoutAcceptedCommandRealtimeAppendInput({
      command: options.command,
      result: options.result,
      clientId,
    }),
  ]
}
