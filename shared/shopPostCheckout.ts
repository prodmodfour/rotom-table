import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from './automation/strictJson'
import { isSlug } from './paths'
import { isLivePlayOpId } from './livePlayCommands'
import { ITEM_INVENTORY_SECTIONS, type ItemInventorySection } from './itemAutomation/inventory'

export const SHOP_POST_CHECKOUT_SCHEMA_VERSION = 1 as const
export const SHOP_POST_CHECKOUT_ACTION_KINDS = [
  'inspect', 'use', 'equip', 'give', 'move-to-group', 'transfer-to-trainer',
] as const
export type ShopPostCheckoutActionKind = (typeof SHOP_POST_CHECKOUT_ACTION_KINDS)[number]
export type ShopPostCheckoutLocationKind = 'trainer-inventory' | 'group-inventory'
export type ShopPostCheckoutActionProjectionStatus = 'idle' | 'loading' | 'ready' | 'error'

export const SHOP_POST_CHECKOUT_LIMITS = Object.freeze({
  continuations: 64,
  actionsPerContinuation: 6,
  textLength: 300,
  identifierLength: 200,
})

export interface ShopCheckoutContinuationSourceV1 {
  readonly locationKind: ShopPostCheckoutLocationKind
  readonly containerLabel: string
  readonly section: ItemInventorySection
  readonly sectionLabel: string
  readonly rowLabel: string
}

export interface ShopCheckoutContinuationV1 {
  /** Opaque exact-delivery identity. Never display this value. */
  readonly continuationId: string
  readonly itemLabel: string
  readonly quantity: number
  readonly source: ShopCheckoutContinuationSourceV1
}

export interface ShopCheckoutContinuationReceiptV1 {
  readonly schemaVersion: typeof SHOP_POST_CHECKOUT_SCHEMA_VERSION
  readonly continuations: readonly ShopCheckoutContinuationV1[]
}

export interface ShopPostCheckoutActionV1 {
  readonly actionId: string
  readonly kind: ShopPostCheckoutActionKind
  readonly label: string
  readonly enabled: boolean
  readonly unavailableReason: string | null
  /** Exact app-relative handoff. It never commits mechanics by navigation alone. */
  readonly href: string | null
}

export interface ShopPostCheckoutActionItemV1 extends ShopCheckoutContinuationV1 {
  readonly actions: readonly ShopPostCheckoutActionV1[]
  readonly destinationSummary: string | null
}

export interface ShopPostCheckoutActionProjectionV1 {
  readonly schemaVersion: typeof SHOP_POST_CHECKOUT_SCHEMA_VERSION
  readonly generatedAt: number
  readonly items: readonly ShopPostCheckoutActionItemV1[]
}

export interface ShopPostCheckoutActionRequestV1 {
  readonly schemaVersion: typeof SHOP_POST_CHECKOUT_SCHEMA_VERSION
  readonly shopSlug: string
  readonly checkoutOperationId: string
  readonly continuationIds: readonly string[]
}

export class ShopPostCheckoutValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'ShopPostCheckoutValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const CONTINUATION_ID_RE = /^shop-continuation:v1:[a-f0-9]{32}$/u
const ACTION_ID_RE = /^shop-post-action:v1:[a-f0-9]{32}$/u
const LOCATION_KINDS = new Set<string>(['trainer-inventory', 'group-inventory'])
const ACTION_KINDS = new Set<string>(SHOP_POST_CHECKOUT_ACTION_KINDS)
const SECTIONS = new Set<string>(ITEM_INVENTORY_SECTIONS)
const CONTROL_RE = /[\u0000-\u001f\u007f]/u

const fail = (path: string, detail: string): never => { throw new ShopPostCheckoutValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(value, field)) || Object.keys(value).some(field => !allowed.has(field))) {
    fail(path, 'has an invalid shape.')
  }
}
const text = (value: unknown, path: string, maximum: number = SHOP_POST_CHECKOUT_LIMITS.textLength): string => {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > maximum || CONTROL_RE.test(value)) {
    fail(path, 'must be bounded safe text.')
  }
  return value as string
}
const integer = (value: unknown, path: string, positive = false): number => {
  if (!Number.isSafeInteger(value) || Number(value) < (positive ? 1 : 0)) {
    fail(path, `must be a safe ${positive ? 'positive' : 'non-negative'} integer.`)
  }
  return Number(value)
}
const list = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) fail(path, 'must be a bounded array.')
  return value as readonly unknown[]
}
const identifier = (value: unknown, path: string, pattern: RegExp): string => {
  const parsed = text(value, path, SHOP_POST_CHECKOUT_LIMITS.identifierLength)
  if (!pattern.test(parsed)) fail(path, 'must be a versioned opaque identifier.')
  return parsed
}
const detach = (value: unknown, label: string): unknown => cloneStrictJson(value, label, {
  limits: {
    depth: 8,
    nodes: 4_096,
    objectFields: 12,
    arrayEntries: SHOP_POST_CHECKOUT_LIMITS.continuations,
    stringLength: SHOP_POST_CHECKOUT_LIMITS.textLength,
    objectKeyLength: 80,
  },
  rootLabel: label,
  valueLabel: `${label}s`,
  failNotJson: (path, detail) => fail(path, detail),
  failLimit: (path, detail) => fail(path, detail),
})

const parseSource = (value: unknown, path: string): ShopCheckoutContinuationSourceV1 => {
  const input = record(value, path)
  exact(input, ['locationKind', 'containerLabel', 'section', 'sectionLabel', 'rowLabel'], path)
  if (typeof input.locationKind !== 'string' || !LOCATION_KINDS.has(input.locationKind)) {
    fail(`${path}.locationKind`, 'contains an unsupported value.')
  }
  if (typeof input.section !== 'string' || !SECTIONS.has(input.section)) {
    fail(`${path}.section`, 'contains an unsupported inventory section.')
  }
  return Object.freeze({
    locationKind: input.locationKind as ShopPostCheckoutLocationKind,
    containerLabel: text(input.containerLabel, `${path}.containerLabel`, 200),
    section: input.section as ItemInventorySection,
    sectionLabel: text(input.sectionLabel, `${path}.sectionLabel`, 100),
    rowLabel: text(input.rowLabel, `${path}.rowLabel`, 100),
  })
}

const parseContinuation = (value: unknown, path: string): ShopCheckoutContinuationV1 => {
  const input = record(value, path)
  exact(input, ['continuationId', 'itemLabel', 'quantity', 'source'], path)
  return Object.freeze({
    continuationId: identifier(input.continuationId, `${path}.continuationId`, CONTINUATION_ID_RE),
    itemLabel: text(input.itemLabel, `${path}.itemLabel`, 200),
    quantity: integer(input.quantity, `${path}.quantity`, true),
    source: parseSource(input.source, `${path}.source`),
  })
}

const parseContinuationList = (value: unknown, path: string): readonly ShopCheckoutContinuationV1[] => {
  const continuations = list(value, path, SHOP_POST_CHECKOUT_LIMITS.continuations)
    .map((entry, index) => parseContinuation(entry, `${path}[${index}]`))
  if (!continuations.length || new Set(continuations.map(row => row.continuationId)).size !== continuations.length) {
    fail(path, 'must contain unique exact delivery continuations.')
  }
  return Object.freeze(continuations)
}

export const parseShopCheckoutContinuationReceipt = (value: unknown): ShopCheckoutContinuationReceiptV1 => {
  const input = record(detach(value, 'shopCheckoutContinuationReceipt'), 'shopCheckoutContinuationReceipt')
  exact(input, ['schemaVersion', 'continuations'], 'shopCheckoutContinuationReceipt')
  if (input.schemaVersion !== SHOP_POST_CHECKOUT_SCHEMA_VERSION) {
    fail('shopCheckoutContinuationReceipt.schemaVersion', 'must be 1.')
  }
  return deepFreezeStrictJson({
    schemaVersion: SHOP_POST_CHECKOUT_SCHEMA_VERSION,
    continuations: parseContinuationList(input.continuations, 'shopCheckoutContinuationReceipt.continuations'),
  })
}

const parseAction = (value: unknown, path: string): ShopPostCheckoutActionV1 => {
  const input = record(value, path)
  exact(input, ['actionId', 'kind', 'label', 'enabled', 'unavailableReason', 'href'], path)
  if (typeof input.kind !== 'string' || !ACTION_KINDS.has(input.kind)) fail(`${path}.kind`, 'contains an unsupported action.')
  if (typeof input.enabled !== 'boolean') fail(`${path}.enabled`, 'must be boolean.')
  const enabled = input.enabled as boolean
  const reason = input.unavailableReason === null ? null : text(input.unavailableReason, `${path}.unavailableReason`)
  const href = input.href === null ? null : text(input.href, `${path}.href`)
  if (href !== null && (!href.startsWith('/') || href.startsWith('//'))) fail(`${path}.href`, 'must be an app-relative path.')
  if ((enabled && (reason !== null || href === null))
    || (!enabled && (reason === null || href !== null))) {
    fail(path, 'must pair enabled state with one handoff or one unavailable reason.')
  }
  return Object.freeze({
    actionId: identifier(input.actionId, `${path}.actionId`, ACTION_ID_RE),
    kind: input.kind as ShopPostCheckoutActionKind,
    label: text(input.label, `${path}.label`, 100),
    enabled,
    unavailableReason: reason,
    href,
  })
}

export const parseShopPostCheckoutActionProjection = (value: unknown): ShopPostCheckoutActionProjectionV1 => {
  const input = record(detach(value, 'shopPostCheckoutActionProjection'), 'shopPostCheckoutActionProjection')
  exact(input, ['schemaVersion', 'generatedAt', 'items'], 'shopPostCheckoutActionProjection')
  if (input.schemaVersion !== SHOP_POST_CHECKOUT_SCHEMA_VERSION) {
    fail('shopPostCheckoutActionProjection.schemaVersion', 'must be 1.')
  }
  const items = list(input.items, 'shopPostCheckoutActionProjection.items', SHOP_POST_CHECKOUT_LIMITS.continuations)
    .map((entry, index): ShopPostCheckoutActionItemV1 => {
      const path = `shopPostCheckoutActionProjection.items[${index}]`
      const row = record(entry, path)
      exact(row, ['continuationId', 'itemLabel', 'quantity', 'source', 'actions', 'destinationSummary'], path)
      const continuation = parseContinuation({
        continuationId: row.continuationId,
        itemLabel: row.itemLabel,
        quantity: row.quantity,
        source: row.source,
      }, path)
      const actions = list(row.actions, `${path}.actions`, SHOP_POST_CHECKOUT_LIMITS.actionsPerContinuation)
        .map((action, actionIndex) => parseAction(action, `${path}.actions[${actionIndex}]`))
      if (!actions.length || new Set(actions.map(action => action.kind)).size !== actions.length
        || new Set(actions.map(action => action.actionId)).size !== actions.length) {
        fail(`${path}.actions`, 'must contain unique action kinds and identities.')
      }
      return Object.freeze({
        ...continuation,
        actions: Object.freeze(actions),
        destinationSummary: row.destinationSummary === null
          ? null
          : text(row.destinationSummary, `${path}.destinationSummary`),
      })
    })
  if (!items.length || new Set(items.map(item => item.continuationId)).size !== items.length) {
    fail('shopPostCheckoutActionProjection.items', 'must contain unique continuation identities.')
  }
  return deepFreezeStrictJson({
    schemaVersion: SHOP_POST_CHECKOUT_SCHEMA_VERSION,
    generatedAt: integer(input.generatedAt, 'shopPostCheckoutActionProjection.generatedAt'),
    items,
  })
}

export const parseShopPostCheckoutActionRequest = (value: unknown): ShopPostCheckoutActionRequestV1 => {
  const input = record(detach(value, 'shopPostCheckoutActionRequest'), 'shopPostCheckoutActionRequest')
  exact(input, ['schemaVersion', 'shopSlug', 'checkoutOperationId', 'continuationIds'], 'shopPostCheckoutActionRequest')
  if (input.schemaVersion !== SHOP_POST_CHECKOUT_SCHEMA_VERSION) fail('shopPostCheckoutActionRequest.schemaVersion', 'must be 1.')
  if (!isSlug(input.shopSlug)) fail('shopPostCheckoutActionRequest.shopSlug', 'must be a valid shop slug.')
  const shopSlug = input.shopSlug as string
  if (!isLivePlayOpId(input.checkoutOperationId)) {
    fail('shopPostCheckoutActionRequest.checkoutOperationId', 'must be a valid checkout operation identity.')
  }
  const checkoutOperationId = input.checkoutOperationId as string
  const continuationIds = list(
    input.continuationIds,
    'shopPostCheckoutActionRequest.continuationIds',
    SHOP_POST_CHECKOUT_LIMITS.continuations,
  ).map((id, index) => identifier(id, `shopPostCheckoutActionRequest.continuationIds[${index}]`, CONTINUATION_ID_RE))
  if (!continuationIds.length || new Set(continuationIds).size !== continuationIds.length) {
    fail('shopPostCheckoutActionRequest.continuationIds', 'must contain unique continuation identities.')
  }
  return deepFreezeStrictJson({
    schemaVersion: SHOP_POST_CHECKOUT_SCHEMA_VERSION,
    shopSlug,
    checkoutOperationId,
    continuationIds,
  })
}
