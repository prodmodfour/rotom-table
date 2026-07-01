import { isSlug, SLUG_PATTERN_DESCRIPTION } from '#shared/paths'
import { parsePlayerProfileId, type PlayerProfileId } from '#shared/playerProfiles'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  createLivePlayOpId,
  createShopCheckoutCommandScopes,
  parseLivePlayOpId,
  type LivePlayOpId,
  type LivePlayRandomUuidProvider,
  type ShopCheckoutDeliveryTarget,
  type ShopCheckoutLineInput,
  type ShopCheckoutLivePlayCommand,
  type ShopCheckoutOrigin,
  type ShopCheckoutParticipantReference,
  type ShopCheckoutPaymentSource,
} from '#shared/livePlayCommands'

export const SHOP_CHECKOUT_ORIGIN_SHOP_PAGE = { kind: 'shopPage' } as const

export type ShopCheckoutCommandBuildErrorCode =
  | 'invalid-op-id'
  | 'invalid-client-id'
  | 'invalid-profile-id'
  | 'invalid-shop-slug'
  | 'invalid-revision'
  | 'invalid-participant-kind'
  | 'invalid-participant-slug'
  | 'invalid-origin'
  | 'empty-cart'
  | 'invalid-entry-id'
  | 'invalid-quantity'

export class ShopCheckoutCommandBuildError extends Error {
  readonly code: ShopCheckoutCommandBuildErrorCode
  readonly path: string

  constructor(code: ShopCheckoutCommandBuildErrorCode, path: string, message: string) {
    super(message)
    this.name = 'ShopCheckoutCommandBuildError'
    this.code = code
    this.path = path
  }
}

export interface ShopCheckoutCommandBody extends ShopCheckoutLivePlayCommand {
  readonly clientId: string
  readonly profileId?: PlayerProfileId
}

export interface BuildShopCheckoutCommandInput {
  readonly shopSlug: string
  readonly shopRevision: number
  readonly paymentSource: ShopCheckoutPaymentSource
  readonly deliveryTarget: ShopCheckoutDeliveryTarget
  readonly lines: readonly ShopCheckoutLineInput[]
  readonly clientId: string
  readonly profileId?: PlayerProfileId | string | null
  readonly origin?: ShopCheckoutOrigin
  readonly opId?: LivePlayOpId | string
  readonly randomUuid?: LivePlayRandomUuidProvider
}

const fail = (
  code: ShopCheckoutCommandBuildErrorCode,
  path: string,
  message: string,
): never => {
  throw new ShopCheckoutCommandBuildError(code, path, message)
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const safeNonNegativeInteger = (value: unknown, path: string): number => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  return fail('invalid-revision', path, `${path} must be a safe non-negative integer revision.`)
}

const positiveSafeInteger = (value: unknown, path: string): number => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  return fail('invalid-quantity', path, `${path} must be a positive safe integer.`)
}

const nonEmptyString = (
  value: unknown,
  path: string,
  code: ShopCheckoutCommandBuildErrorCode,
): string => {
  if (typeof value !== 'string') return fail(code, path, `${path} must be a non-empty string.`)
  const trimmed = value.trim()
  if (!trimmed) return fail(code, path, `${path} must be a non-empty string.`)
  return trimmed
}

const slugString = (
  value: unknown,
  path: string,
  code: ShopCheckoutCommandBuildErrorCode,
): string => {
  const slug = nonEmptyString(value, path, code)
  if (!isSlug(slug)) return fail(code, path, `${path} must match ${SLUG_PATTERN_DESCRIPTION}.`)
  return slug
}

export const createShopCheckoutOpId = (
  randomUuid?: LivePlayRandomUuidProvider,
): LivePlayOpId => createLivePlayOpId(randomUuid)

const opIdForInput = (input: Pick<BuildShopCheckoutCommandInput, 'opId' | 'randomUuid'>): LivePlayOpId => {
  try {
    return input.opId === undefined
      ? createShopCheckoutOpId(input.randomUuid)
      : parseLivePlayOpId(input.opId, 'opId')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'opId must be a valid live-play operation ID.'
    return fail('invalid-op-id', 'opId', message)
  }
}

const normalizeProfileId = (profileId: BuildShopCheckoutCommandInput['profileId']): PlayerProfileId | null => {
  if (profileId == null) return null
  try {
    return parsePlayerProfileId(profileId, 'profileId')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'profileId must be a valid player profile ID.'
    return fail('invalid-profile-id', 'profileId', message)
  }
}

const normalizeParticipant = (
  participant: ShopCheckoutParticipantReference,
  path: string,
): ShopCheckoutParticipantReference => {
  if (!isRecord(participant)) {
    return fail('invalid-participant-kind', path, `${path} must be an object.`)
  }

  if (participant.kind !== 'trainer' && participant.kind !== 'groupInventory') {
    return fail(
      'invalid-participant-kind',
      `${path}.kind`,
      `${path}.kind must be trainer or groupInventory.`,
    )
  }

  return {
    kind: participant.kind,
    slug: slugString(participant.slug, `${path}.slug`, 'invalid-participant-slug'),
    revision: safeNonNegativeInteger(participant.revision, `${path}.revision`),
  }
}

const normalizeShopCheckoutOrigin = (origin: ShopCheckoutOrigin | undefined): ShopCheckoutOrigin => {
  if (origin === undefined || origin.kind === 'shopPage') return SHOP_CHECKOUT_ORIGIN_SHOP_PAGE

  if (!isRecord(origin) || origin.kind !== 'mapInterface') {
    return fail('invalid-origin', 'origin.kind', 'origin.kind must be shopPage or mapInterface.')
  }

  const actorPlacementId = origin.actorPlacementId === undefined
    ? null
    : nonEmptyString(origin.actorPlacementId, 'origin.actorPlacementId', 'invalid-origin')

  return {
    kind: 'mapInterface',
    mapSlug: slugString(origin.mapSlug, 'origin.mapSlug', 'invalid-origin'),
    interfaceId: nonEmptyString(origin.interfaceId, 'origin.interfaceId', 'invalid-origin'),
    ...(actorPlacementId === null ? {} : { actorPlacementId }),
  }
}

export const normalizeShopCheckoutCartLines = (
  lines: readonly ShopCheckoutLineInput[],
): readonly ShopCheckoutLineInput[] => {
  if (!Array.isArray(lines)) {
    return fail('empty-cart', 'lines', 'Checkout cart lines must be an array.')
  }

  if (lines.length === 0) {
    return fail('empty-cart', 'lines', 'Checkout requires at least one cart line.')
  }

  return lines.map((line, index) => {
    const path = `lines[${index}]`
    if (!isRecord(line)) {
      return fail('invalid-entry-id', path, `${path} must be an object.`)
    }

    return {
      entryId: nonEmptyString(line.entryId, `${path}.entryId`, 'invalid-entry-id'),
      quantity: positiveSafeInteger(line.quantity, `${path}.quantity`),
    }
  })
}

export const buildShopCheckoutScopes = createShopCheckoutCommandScopes

export const buildShopCheckoutCommand = (
  input: BuildShopCheckoutCommandInput,
): ShopCheckoutCommandBody => {
  const shopSlug = slugString(input.shopSlug, 'shopSlug', 'invalid-shop-slug')
  const paymentSource = normalizeParticipant(input.paymentSource, 'paymentSource') as ShopCheckoutPaymentSource
  const deliveryTarget = normalizeParticipant(input.deliveryTarget, 'deliveryTarget') as ShopCheckoutDeliveryTarget
  const payload: ShopCheckoutLivePlayCommand['payload'] = {
    shopSlug,
    shopRevision: safeNonNegativeInteger(input.shopRevision, 'shopRevision'),
    paymentSource,
    deliveryTarget,
    lines: normalizeShopCheckoutCartLines(input.lines),
    origin: normalizeShopCheckoutOrigin(input.origin),
  }
  const profileId = normalizeProfileId(input.profileId)

  return {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId: opIdForInput(input),
    type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
    scopes: buildShopCheckoutScopes(payload),
    payload,
    clientId: nonEmptyString(input.clientId, 'clientId', 'invalid-client-id'),
    ...(profileId === null ? {} : { profileId }),
  }
}
