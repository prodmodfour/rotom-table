import { SLUG_RE } from '../paths'
import {
  parseAuthorizedSheetItemActionOffer,
  parseSheetItemActionOffer,
  type AuthorizedSheetItemActionOffer,
  type SheetItemActionOfferV1,
} from './sheetActions'

export const GROUP_INVENTORY_ITEM_ACTION_SCHEMA_VERSION = 1 as const
export const GROUP_INVENTORY_ITEM_ACTION_LIMITS = Object.freeze({
  actors: 64,
  offers: 256,
  textLength: 500,
  identifierLength: 200,
})

export interface GroupInventoryItemActorOptionV1 {
  /** Opaque current actor choice; it is not a Trainer or Profile identity. */
  readonly actorSelectionId: string
  readonly label: string
  readonly revision: number
  readonly selected: boolean
}

export interface GroupInventoryItemActionProjectionV1 {
  readonly schemaVersion: typeof GROUP_INVENTORY_ITEM_ACTION_SCHEMA_VERSION
  readonly groupSlug: string
  readonly groupRevision: number
  readonly generatedAt: number
  readonly selectedActorSelectionId: string | null
  readonly actors: readonly GroupInventoryItemActorOptionV1[]
  /** Offers use the existing target/choice anatomy and always reference the selected actor and shared source. */
  readonly offers: readonly SheetItemActionOfferV1[]
}

export interface DeclareGroupInventoryItemActionIntentV1 {
  readonly schemaVersion: typeof GROUP_INVENTORY_ITEM_ACTION_SCHEMA_VERSION
  readonly groupSlug: string
  readonly groupRevision: number
  readonly actorSelectionId: string
  readonly offerId: string
  readonly action: 'use'
}

export interface AuthorizedGroupInventoryItemActionV1 {
  readonly schemaVersion: typeof GROUP_INVENTORY_ITEM_ACTION_SCHEMA_VERSION
  readonly groupSlug: string
  readonly groupRevision: number
  readonly actorSelectionId: string
  readonly offer: AuthorizedSheetItemActionOffer
}

export class GroupInventoryItemActionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GroupInventoryItemActionValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u
const ACTOR_SELECTION_ID_PATTERN = /^group-item-actor:v1:[a-f0-9]{32}$/u

const fail = (message: string): never => { throw new GroupInventoryItemActionValidationError(message) }
const record = (value: unknown, label: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`)
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], label: string): void => {
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(value, field)) || Object.keys(value).some(field => !allowed.has(field))) {
    fail(`${label} has an invalid shape.`)
  }
}
const text = (
  value: unknown,
  label: string,
  maximum: number = GROUP_INVENTORY_ITEM_ACTION_LIMITS.textLength,
): string => {
  if (typeof value !== 'string' || !value || value !== value.trim()
    || value.length > maximum || CONTROL_CHARACTER_PATTERN.test(value)) fail(`${label} must be bounded safe text.`)
  return value as string
}
const slug = (value: unknown, label: string): string => {
  const parsed = text(value, label, GROUP_INVENTORY_ITEM_ACTION_LIMITS.identifierLength)
  return SLUG_RE.test(parsed) ? parsed : fail(`${label} must be a valid slug.`)
}
const integer = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(`${label} must be a safe non-negative integer.`)
  return Number(value)
}
const actorSelectionId = (value: unknown, label: string): string => {
  const parsed = text(value, label, GROUP_INVENTORY_ITEM_ACTION_LIMITS.identifierLength)
  return ACTOR_SELECTION_ID_PATTERN.test(parsed) ? parsed : fail(`${label} must be an opaque group item actor choice.`)
}
const bool = (value: unknown, label: string): boolean => typeof value === 'boolean'
  ? value
  : fail(`${label} must be boolean.`)
const array = (value: unknown, label: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} must be a bounded array.`)
  return value as readonly unknown[]
}

const parseActor = (value: unknown, label: string): GroupInventoryItemActorOptionV1 => {
  const input = record(value, label)
  exact(input, ['actorSelectionId', 'label', 'revision', 'selected'], label)
  return Object.freeze({
    actorSelectionId: actorSelectionId(input.actorSelectionId, `${label}.actorSelectionId`),
    label: text(input.label, `${label}.label`, 200),
    revision: integer(input.revision, `${label}.revision`),
    selected: bool(input.selected, `${label}.selected`),
  })
}

export const parseGroupInventoryItemActionProjection = (
  value: unknown,
): GroupInventoryItemActionProjectionV1 => {
  const input = record(value, 'groupInventoryItemActionProjection')
  exact(input, [
    'schemaVersion', 'groupSlug', 'groupRevision', 'generatedAt',
    'selectedActorSelectionId', 'actors', 'offers',
  ], 'groupInventoryItemActionProjection')
  if (input.schemaVersion !== GROUP_INVENTORY_ITEM_ACTION_SCHEMA_VERSION) {
    fail('groupInventoryItemActionProjection uses an unsupported schema version.')
  }
  const actors = array(
    input.actors,
    'groupInventoryItemActionProjection.actors',
    GROUP_INVENTORY_ITEM_ACTION_LIMITS.actors,
  ).map((entry, index) => parseActor(entry, `groupInventoryItemActionProjection.actors[${index}]`))
  if (new Set(actors.map(actor => actor.actorSelectionId)).size !== actors.length) {
    fail('groupInventoryItemActionProjection actors must have unique identities.')
  }
  const selectedActorSelectionId = input.selectedActorSelectionId === null
    ? null
    : actorSelectionId(input.selectedActorSelectionId, 'groupInventoryItemActionProjection.selectedActorSelectionId')
  const selectedActors = actors.filter(actor => actor.selected)
  if ((selectedActorSelectionId === null && selectedActors.length !== 0)
    || (selectedActorSelectionId !== null
      && (selectedActors.length !== 1 || selectedActors[0]?.actorSelectionId !== selectedActorSelectionId))) {
    fail('groupInventoryItemActionProjection selected actor is inconsistent.')
  }
  const offers = array(
    input.offers,
    'groupInventoryItemActionProjection.offers',
    GROUP_INVENTORY_ITEM_ACTION_LIMITS.offers,
  ).map((entry, index) => parseSheetItemActionOffer(entry, `groupInventoryItemActionProjection.offers[${index}]`))
  if (new Set(offers.map(offer => offer.offerId)).size !== offers.length
    || new Set(offers.map(offer => offer.source.sourceSelectionId)).size !== offers.length) {
    fail('groupInventoryItemActionProjection offers must have unique identities.')
  }
  const selected = selectedActors[0]
  if ((!selected && offers.length > 0) || offers.some(offer => (
    offer.source.containerKind !== 'group'
    || offer.source.containerLabel !== 'Group inventory'
    || offer.actor.revision !== selected?.revision
    || offer.actor.label !== selected?.label
  ))) {
    fail('groupInventoryItemActionProjection offers do not match the selected shared-inventory actor.')
  }
  return Object.freeze({
    schemaVersion: GROUP_INVENTORY_ITEM_ACTION_SCHEMA_VERSION,
    groupSlug: slug(input.groupSlug, 'groupInventoryItemActionProjection.groupSlug'),
    groupRevision: integer(input.groupRevision, 'groupInventoryItemActionProjection.groupRevision'),
    generatedAt: integer(input.generatedAt, 'groupInventoryItemActionProjection.generatedAt'),
    selectedActorSelectionId,
    actors: Object.freeze(actors),
    offers: Object.freeze(offers),
  })
}

export const parseDeclareGroupInventoryItemActionIntent = (
  value: unknown,
): DeclareGroupInventoryItemActionIntentV1 => {
  const input = record(value, 'declareGroupInventoryItemActionIntent')
  exact(input, [
    'schemaVersion', 'groupSlug', 'groupRevision', 'actorSelectionId', 'offerId', 'action',
  ], 'declareGroupInventoryItemActionIntent')
  if (input.schemaVersion !== GROUP_INVENTORY_ITEM_ACTION_SCHEMA_VERSION || input.action !== 'use') {
    fail('declareGroupInventoryItemActionIntent uses an unsupported schema or action.')
  }
  return Object.freeze({
    schemaVersion: GROUP_INVENTORY_ITEM_ACTION_SCHEMA_VERSION,
    groupSlug: slug(input.groupSlug, 'declareGroupInventoryItemActionIntent.groupSlug'),
    groupRevision: integer(input.groupRevision, 'declareGroupInventoryItemActionIntent.groupRevision'),
    actorSelectionId: actorSelectionId(input.actorSelectionId, 'declareGroupInventoryItemActionIntent.actorSelectionId'),
    offerId: text(input.offerId, 'declareGroupInventoryItemActionIntent.offerId', 1_024),
    action: 'use',
  })
}

export const parseAuthorizedGroupInventoryItemAction = (
  value: unknown,
): AuthorizedGroupInventoryItemActionV1 => {
  const input = record(value, 'authorizedGroupInventoryItemAction')
  exact(input, ['schemaVersion', 'groupSlug', 'groupRevision', 'actorSelectionId', 'offer'], 'authorizedGroupInventoryItemAction')
  if (input.schemaVersion !== GROUP_INVENTORY_ITEM_ACTION_SCHEMA_VERSION) {
    fail('authorizedGroupInventoryItemAction uses an unsupported schema version.')
  }
  const groupSlug = slug(input.groupSlug, 'authorizedGroupInventoryItemAction.groupSlug')
  const groupRevision = integer(input.groupRevision, 'authorizedGroupInventoryItemAction.groupRevision')
  const offer = parseAuthorizedSheetItemActionOffer(input.offer)
  if (offer.source.containerKind !== 'group'
    || offer.itemCommand.source.kind !== 'group'
    || offer.itemCommand.source.slug !== groupSlug
    || offer.itemCommand.source.expectedRevision !== groupRevision) {
    fail('authorizedGroupInventoryItemAction command authority does not match its shared source.')
  }
  return Object.freeze({
    schemaVersion: GROUP_INVENTORY_ITEM_ACTION_SCHEMA_VERSION,
    groupSlug,
    groupRevision,
    actorSelectionId: actorSelectionId(input.actorSelectionId, 'authorizedGroupInventoryItemAction.actorSelectionId'),
    offer,
  })
}
