import { isSlug, SLUG_PATTERN_DESCRIPTION } from '#shared/paths'
import {
  validateShopCheckoutCommandEnvelope,
  type LivePlayGroupInventoryScope,
  type LivePlayShopScope,
  type ShopCheckoutDeliveryTarget,
  type ShopCheckoutLineInput,
  type ShopCheckoutLivePlayCommand,
  type ShopCheckoutLivePlayScope,
  type ShopCheckoutOrigin,
  type ShopCheckoutParticipantReference,
  type ShopCheckoutPaymentSource,
  type ShopCheckoutPayload,
  type ShopCheckoutTrainerSheetScope,
} from '#shared/livePlayCommands'
import { rejectLivePlayCommand } from './commandExecutor'

type UnknownRecord = Record<string, unknown>

const rejectInvalid = (message: string): never => {
  rejectLivePlayCommand('invalid', message)
  throw new Error(message)
}

export interface RequiredShopCheckoutScope {
  readonly key: string
  readonly description: string
}

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const isSafeNonNegativeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
)

const isPositiveSafeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
)

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const expectRecord = (value: unknown, label: string): UnknownRecord => {
  if (!isRecord(value)) rejectInvalid(`${label} must be an object`)
  return value as UnknownRecord
}

const expectSlug = (value: unknown, label: string): string => {
  if (!isSlug(value)) rejectInvalid(`${label} must match ${SLUG_PATTERN_DESCRIPTION}`)
  return value as string
}

const expectRevision = (value: unknown, label: string): number => {
  if (!isSafeNonNegativeInteger(value)) {
    rejectInvalid(`${label} must be a safe non-negative integer revision`)
  }
  return value as number
}

const expectNonEmptyString = (value: unknown, label: string): string => {
  if (!isNonEmptyString(value)) rejectInvalid(`${label} must be a non-empty string`)
  return (value as string).trim()
}

const expectCheckoutParticipant = (
  value: unknown,
  label: string,
): ShopCheckoutParticipantReference => {
  const record = expectRecord(value, label)
  const kind = record.kind
  if (kind !== 'trainer' && kind !== 'groupInventory') {
    rejectInvalid(`${label}.kind must be trainer or groupInventory`)
  }

  return {
    kind: kind as ShopCheckoutParticipantReference['kind'],
    slug: expectSlug(record.slug, `${label}.slug`),
    revision: expectRevision(record.revision, `${label}.revision`),
  }
}

const expectCheckoutLine = (value: unknown, index: number): ShopCheckoutLineInput => {
  const label = `payload.lines[${index}]`
  const record = expectRecord(value, label)
  return {
    entryId: expectNonEmptyString(record.entryId, `${label}.entryId`),
    quantity: expectLineQuantity(record.quantity, `${label}.quantity`),
  }
}

const expectLineQuantity = (value: unknown, label: string): number => {
  if (!isPositiveSafeInteger(value)) rejectInvalid(`${label} must be a positive safe integer`)
  return value as number
}

const expectCheckoutLines = (value: unknown): readonly ShopCheckoutLineInput[] => {
  if (!Array.isArray(value)) rejectInvalid('payload.lines must be an array')
  const lines = value as unknown[]
  if (lines.length === 0) rejectInvalid('payload.lines must contain at least one line item')
  return lines.map(expectCheckoutLine)
}

const expectShopCheckoutOrigin = (value: unknown): ShopCheckoutOrigin | undefined => {
  if (value === undefined) return undefined

  const record = expectRecord(value, 'payload.origin')
  if (record.kind === 'shopPage') return { kind: 'shopPage' }

  if (record.kind !== 'mapInterface') {
    rejectInvalid('payload.origin.kind must be shopPage or mapInterface')
  }

  return {
    kind: 'mapInterface',
    mapSlug: expectSlug(record.mapSlug, 'payload.origin.mapSlug'),
    interfaceId: expectNonEmptyString(record.interfaceId, 'payload.origin.interfaceId'),
    ...(record.actorPlacementId === undefined
      ? {}
      : { actorPlacementId: expectNonEmptyString(record.actorPlacementId, 'payload.origin.actorPlacementId') }),
  }
}

export const parseShopCheckoutPayload = (value: unknown): ShopCheckoutPayload => {
  const record = expectRecord(value, 'payload')
  const origin = expectShopCheckoutOrigin(record.origin)

  return {
    shopSlug: expectSlug(record.shopSlug, 'payload.shopSlug'),
    shopRevision: expectRevision(record.shopRevision, 'payload.shopRevision'),
    paymentSource: expectCheckoutParticipant(record.paymentSource, 'payload.paymentSource') as ShopCheckoutPaymentSource,
    deliveryTarget: expectCheckoutParticipant(record.deliveryTarget, 'payload.deliveryTarget') as ShopCheckoutDeliveryTarget,
    lines: expectCheckoutLines(record.lines),
    ...(origin === undefined ? {} : { origin }),
  }
}

const shopScopeKey = (shopSlug: string, field: LivePlayShopScope['field']): string =>
  `shop:${shopSlug}:${field}`

const groupInventoryScopeKey = (slug: string, field: LivePlayGroupInventoryScope['field']): string =>
  `groupInventory:${slug}:${field}`

const trainerSheetScopeKey = (sheetSlug: string, field: ShopCheckoutTrainerSheetScope['field']): string =>
  `sheet:trainer:${sheetSlug}:${field}`

const scopeKey = (scope: ShopCheckoutLivePlayScope): string => {
  if (scope.kind === 'shop') return shopScopeKey(scope.shopSlug, scope.field)
  if (scope.kind === 'groupInventory') return groupInventoryScopeKey(scope.slug, scope.field)
  return trainerSheetScopeKey(scope.sheetSlug, scope.field)
}

const paymentSourceScope = (source: ShopCheckoutPaymentSource): RequiredShopCheckoutScope => (
  source.kind === 'groupInventory'
    ? {
        key: groupInventoryScopeKey(source.slug, 'money'),
        description: `group inventory payment money scope ${groupInventoryScopeKey(source.slug, 'money')}`,
      }
    : {
        key: trainerSheetScopeKey(source.slug, 'money'),
        description: `trainer payment money scope ${trainerSheetScopeKey(source.slug, 'money')}`,
      }
)

const deliveryTargetScope = (target: ShopCheckoutDeliveryTarget): RequiredShopCheckoutScope => (
  target.kind === 'groupInventory'
    ? {
        key: groupInventoryScopeKey(target.slug, 'inventory'),
        description: `group inventory delivery scope ${groupInventoryScopeKey(target.slug, 'inventory')}`,
      }
    : {
        key: trainerSheetScopeKey(target.slug, 'inventory'),
        description: `trainer delivery inventory scope ${trainerSheetScopeKey(target.slug, 'inventory')}`,
      }
)

export const requiredShopCheckoutScopes = (
  payload: Pick<ShopCheckoutPayload, 'shopSlug' | 'paymentSource' | 'deliveryTarget'>,
): readonly RequiredShopCheckoutScope[] => [
  {
    key: shopScopeKey(payload.shopSlug, 'purchase'),
    description: `shop purchase scope ${shopScopeKey(payload.shopSlug, 'purchase')}`,
  },
  {
    key: shopScopeKey(payload.shopSlug, 'stock'),
    description: `shop stock scope ${shopScopeKey(payload.shopSlug, 'stock')}`,
  },
  paymentSourceScope(payload.paymentSource),
  deliveryTargetScope(payload.deliveryTarget),
]

export const validateShopCheckoutCommandScopes = (
  command: Pick<ShopCheckoutLivePlayCommand, 'scopes'>,
  payload: Pick<ShopCheckoutPayload, 'shopSlug' | 'paymentSource' | 'deliveryTarget'>,
): void => {
  const requiredScopes = requiredShopCheckoutScopes(payload)
  const requiredByKey = new Map(requiredScopes.map((scope) => [scope.key, scope]))
  const submittedKeys = new Set<string>()

  for (const scope of command.scopes) {
    const key = scopeKey(scope)
    if (submittedKeys.has(key)) rejectInvalid(`shopCheckout scope ${key} was supplied more than once`)
    submittedKeys.add(key)
    if (!requiredByKey.has(key)) rejectInvalid(`shopCheckout scope ${key} does not match this checkout payload`)
  }

  for (const requiredScope of requiredScopes) {
    if (!submittedKeys.has(requiredScope.key)) {
      rejectInvalid(`shopCheckout scopes must include the ${requiredScope.description}`)
    }
  }
}

export const parseShopCheckoutLivePlayCommand = (value: unknown): ShopCheckoutLivePlayCommand => {
  const validation = validateShopCheckoutCommandEnvelope(value)
  if (validation.valid) {
    const command = validation.command
    const payload = parseShopCheckoutPayload(command.payload)
    validateShopCheckoutCommandScopes(command, payload)
    return command
  }

  const summary = validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  return rejectInvalid(`Invalid shop checkout live-play command envelope: ${summary}`)
}
