import { createHash } from 'node:crypto'
import {
  parseShopCheckoutContinuationReceipt,
  parseShopPostCheckoutActionProjection,
  SHOP_POST_CHECKOUT_SCHEMA_VERSION,
  type ShopCheckoutContinuationReceiptV1,
  type ShopPostCheckoutActionItemV1,
  type ShopPostCheckoutActionKind,
  type ShopPostCheckoutActionProjectionV1,
  type ShopPostCheckoutActionV1,
} from '#shared/shopPostCheckout'
import type { ShopCheckoutDeliveryTarget } from '#shared/livePlayCommands'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { ShopCheckoutDeliveredInventorySource } from '~/utils/shopCheckout'
import { TRAINER_INVENTORY_SECTIONS } from '~/utils/sheets/trainerInventorySections'

const digest32 = (...parts: readonly string[]): string => createHash('sha256')
  .update(parts.join('\u001f'))
  .digest('hex')
  .slice(0, 32)

export const shopCheckoutContinuationId = (input: {
  readonly operationId: string
  readonly target: ShopCheckoutDeliveryTarget
  readonly targetRevision: number
  readonly section: string
  readonly rowId: string
  readonly receiptIndex: number
}): string => `shop-continuation:v1:${digest32(
  input.operationId,
  input.target.kind,
  input.target.slug,
  String(input.targetRevision),
  input.section,
  input.rowId,
  String(input.receiptIndex),
)}`

export const shopPostCheckoutActionId = (
  continuationId: string,
  kind: ShopPostCheckoutActionKind,
  authorityIdentity: string,
): string => `shop-post-action:v1:${digest32(continuationId, kind, authorityIdentity)}`

const safePublicLabel = (value: unknown, fallback: string, maximum: number): string => {
  const normalized = (typeof value === 'string' ? value : '')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return normalized.slice(0, maximum).trim() || fallback
}
const sectionLabel = (section: string): string => safePublicLabel(
  TRAINER_INVENTORY_SECTIONS.find(candidate => candidate.key === section)?.title ?? section,
  'Inventory',
  100,
)

const trainerLabel = (trainer: TrainerSheet): string => safePublicLabel(trainer.name, 'Trainer', 180)

export const createShopCheckoutContinuationReceipt = (input: {
  readonly operationId: string
  readonly target: ShopCheckoutDeliveryTarget
  readonly targetDocument: TrainerSheet | GroupInventoryDocument
  readonly sources: readonly ShopCheckoutDeliveredInventorySource[]
}): ShopCheckoutContinuationReceiptV1 => {
  const targetRevision = input.targetDocument.revision
  if (!Number.isSafeInteger(targetRevision) || Number(targetRevision) < 0) {
    throw new Error('Shop checkout continuation requires an exact accepted delivery revision.')
  }
  return parseShopCheckoutContinuationReceipt({
  schemaVersion: SHOP_POST_CHECKOUT_SCHEMA_VERSION,
  continuations: input.sources.map((source, receiptIndex) => ({
    continuationId: shopCheckoutContinuationId({
      operationId: input.operationId,
      target: input.target,
      targetRevision: Number(targetRevision),
      section: source.section,
      rowId: source.rowId,
      receiptIndex,
    }),
    itemLabel: safePublicLabel(source.itemName, 'Purchased item', 200),
    quantity: source.quantity,
    source: {
      locationKind: input.target.kind === 'trainer' ? 'trainer-inventory' : 'group-inventory',
      containerLabel: input.target.kind === 'trainer'
        ? `${trainerLabel(input.targetDocument as TrainerSheet)} inventory`
        : 'Shared group inventory',
      section: source.section,
      sectionLabel: sectionLabel(source.section),
      rowLabel: `Row ${source.rowIndex + 1}`,
    },
  })),
  })
}

const queryHref = (
  path: string,
  values: Readonly<Record<string, string>>,
): string => `${path}?${new URLSearchParams(values).toString()}`

export const trainerInventoryContinuationHref = (input: {
  readonly trainerSlug: string
  readonly action: 'use' | 'equip' | 'give' | 'transfer'
  readonly sourceSelectionId: string
}): string => queryHref(`/sheets/trainers/${encodeURIComponent(input.trainerSlug)}`, {
  inventoryAction: input.action,
  inventorySource: input.sourceSelectionId,
})

export const groupInventoryContinuationHref = (input: {
  readonly action: 'use' | 'transfer'
  readonly sourceSelectionId: string
  readonly actorSelectionId?: string
}): string => queryHref('/group-inventory', {
  inventoryAction: input.action,
  inventorySource: input.sourceSelectionId,
  ...(input.actorSelectionId ? { itemActor: input.actorSelectionId } : {}),
})

export const postCheckoutAction = (input: {
  readonly continuationId: string
  readonly kind: ShopPostCheckoutActionKind
  readonly label: string
  readonly authorityIdentity: string
  readonly href?: string | null
  readonly unavailableReason?: string | null
}): ShopPostCheckoutActionV1 => {
  const href = input.href ?? null
  const unavailableReason = href ? null : input.unavailableReason?.trim() || 'This action is not currently available.'
  return Object.freeze({
    actionId: shopPostCheckoutActionId(input.continuationId, input.kind, input.authorityIdentity),
    kind: input.kind,
    label: input.label,
    enabled: href !== null,
    unavailableReason,
    href,
  })
}

export const createShopPostCheckoutActionProjection = (input: {
  readonly generatedAt: number
  readonly items: readonly ShopPostCheckoutActionItemV1[]
}): ShopPostCheckoutActionProjectionV1 => parseShopPostCheckoutActionProjection({
  schemaVersion: SHOP_POST_CHECKOUT_SCHEMA_VERSION,
  generatedAt: input.generatedAt,
  items: input.items,
})
