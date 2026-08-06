export const CAMPAIGN_OPERATION_OFFER_SCHEMA_VERSION = 1 as const
export const CAMPAIGN_OPERATION_OFFER_AUDIENCES = Object.freeze(['gm', 'owner'] as const)
export const CAMPAIGN_OPERATION_OFFER_SOURCE_KINDS = Object.freeze(['edge', 'feature', 'system'] as const)
export const CAMPAIGN_OPERATION_OFFER_INPUT_KINDS = Object.freeze([
  'confirmation',
  'parent-pair',
  'project-options',
] as const)
export const CAMPAIGN_OPERATION_OFFER_TONES = Object.freeze(['neutral', 'primary', 'warning'] as const)
export type CampaignOperationOfferAudience = typeof CAMPAIGN_OPERATION_OFFER_AUDIENCES[number]
export type CampaignOperationOfferSourceKind = typeof CAMPAIGN_OPERATION_OFFER_SOURCE_KINDS[number]
export type CampaignOperationOfferInputKind = typeof CAMPAIGN_OPERATION_OFFER_INPUT_KINDS[number]
export type CampaignOperationOfferTone = typeof CAMPAIGN_OPERATION_OFFER_TONES[number]

export interface CampaignOperationOfferActorV1 {
  readonly kind: 'campaign' | 'trainer-sheet'
  readonly resourceId: string
  readonly revision: number | null
}
export interface CampaignOperationOfferSourceV1 {
  readonly kind: CampaignOperationOfferSourceKind
  readonly canonicalId: string
}
export interface CampaignOperationOfferAvailabilityV1 {
  readonly status: 'available' | 'unavailable'
  readonly reasonId: string | null
}
export interface CampaignOperationOfferPresentationV1 {
  readonly labelId: string
  readonly descriptionId: string
  readonly tone: CampaignOperationOfferTone
}
export interface CampaignOperationOfferV1 {
  readonly schemaVersion: 1
  readonly offerId: string
  readonly offerDefinitionSha256: string
  readonly audience: CampaignOperationOfferAudience
  readonly role: 'campaign-operation'
  readonly workspaceId: string
  readonly operationFamilyId: string
  readonly actionId: string
  readonly actor: CampaignOperationOfferActorV1
  readonly source: CampaignOperationOfferSourceV1
  readonly availability: CampaignOperationOfferAvailabilityV1
  readonly requiredInputKinds: readonly CampaignOperationOfferInputKind[]
  readonly presentation: CampaignOperationOfferPresentationV1
  readonly issuedAtCampaignMinute: number
  readonly expiresAtCampaignMinute: number
}
export interface CampaignOperationOfferDeclarationV1 {
  readonly schemaVersion: 1
  readonly offerId: string
  readonly offerDefinitionSha256: string
  readonly operationId: string
}

export type CampaignOperationOfferValidationCode =
  | 'campaign-operation-offer.invalid-document'
  | 'campaign-operation-offer.unknown-field'
  | 'campaign-operation-offer.invalid-id'
  | 'campaign-operation-offer.invalid-invariant'
export class CampaignOperationOfferValidationError extends Error {
  readonly code: CampaignOperationOfferValidationCode
  readonly path: string
  constructor(code: CampaignOperationOfferValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'CampaignOperationOfferValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const OFFER_ID = /^campaign-operation-offer:v1:[0-9a-f]{32}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u
const CANONICAL_ID = /^[A-Za-z0-9][A-Za-z0-9 ._:/()'’-]{0,159}$/u
const REASON_ID = /^[a-z][a-z0-9]+(?:[.-][a-z0-9]+)*$/u
const LOCALIZATION_ID = /^[a-z][a-z0-9]+(?:[.-][a-z0-9]+)*$/u
const AUDIENCES = new Set<string>(CAMPAIGN_OPERATION_OFFER_AUDIENCES)
const SOURCE_KINDS = new Set<string>(CAMPAIGN_OPERATION_OFFER_SOURCE_KINDS)
const INPUT_KINDS = new Set<string>(CAMPAIGN_OPERATION_OFFER_INPUT_KINDS)
const TONES = new Set<string>(CAMPAIGN_OPERATION_OFFER_TONES)
const fail = (code: CampaignOperationOfferValidationCode, path: string, message: string): never => {
  throw new CampaignOperationOfferValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('campaign-operation-offer.invalid-document', path, 'must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('campaign-operation-offer.invalid-document', path, 'must be plain data without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('campaign-operation-offer.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) {
    fail('campaign-operation-offer.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const array = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('campaign-operation-offer.invalid-document', path, `must be a plain array of at most ${maximum} entries.`)
  }
  if (Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail('campaign-operation-offer.unknown-field', path, 'cannot be sparse or enriched.')
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('campaign-operation-offer.invalid-document', `${path}[${index}]`, 'must be an enumerable entry.')
    }
  }
  return value
}
const integer = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return fail('campaign-operation-offer.invalid-document', path, 'must be a nonnegative safe integer.')
  }
  return Number(value)
}
const stableId = (value: unknown, path: string): string => typeof value === 'string' && STABLE_ID.test(value)
  ? value
  : fail('campaign-operation-offer.invalid-id', path, 'must be a bounded stable identifier.')
const canonicalId = (value: unknown, path: string): string => typeof value === 'string' && CANONICAL_ID.test(value)
  ? value
  : fail('campaign-operation-offer.invalid-id', path, 'must be a bounded canonical identifier.')
const localizationId = (value: unknown, path: string): string => typeof value === 'string' && LOCALIZATION_ID.test(value)
  ? value
  : fail('campaign-operation-offer.invalid-id', path, 'must be a localization identifier.')
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('campaign-operation-offer.invalid-document', path, 'must be a lowercase SHA-256 digest.')
const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key])
  return Object.freeze(value)
}

export const parseCampaignOperationOfferV1 = (
  value: unknown,
  path = 'campaignOperationOffer',
): CampaignOperationOfferV1 => {
  const row = exact(value, [
    'schemaVersion', 'offerId', 'offerDefinitionSha256', 'audience', 'role', 'workspaceId',
    'operationFamilyId', 'actionId', 'actor', 'source', 'availability', 'requiredInputKinds',
    'presentation', 'issuedAtCampaignMinute', 'expiresAtCampaignMinute',
  ], path)
  if (row.schemaVersion !== 1 || row.role !== 'campaign-operation'
    || typeof row.audience !== 'string' || !AUDIENCES.has(row.audience)) {
    fail('campaign-operation-offer.invalid-document', path, 'must be a schema-v1 campaign-operation offer.')
  }
  if (typeof row.offerId !== 'string' || !OFFER_ID.test(row.offerId)) {
    fail('campaign-operation-offer.invalid-id', `${path}.offerId`, 'must be a campaign-operation offer ID.')
  }
  const actor = exact(row.actor, ['kind', 'resourceId', 'revision'], `${path}.actor`)
  if (actor.kind !== 'campaign' && actor.kind !== 'trainer-sheet') {
    fail('campaign-operation-offer.invalid-document', `${path}.actor.kind`, 'must identify campaign or Trainer authority.')
  }
  const actorRevision = actor.revision === null ? null : integer(actor.revision, `${path}.actor.revision`)
  if ((actor.kind === 'campaign') !== (actorRevision === null)) {
    fail('campaign-operation-offer.invalid-invariant', `${path}.actor.revision`, 'campaign alone has no sheet revision.')
  }
  const source = exact(row.source, ['kind', 'canonicalId'], `${path}.source`)
  if (typeof source.kind !== 'string' || !SOURCE_KINDS.has(source.kind)) {
    fail('campaign-operation-offer.invalid-document', `${path}.source.kind`, 'must be a campaign source kind.')
  }
  const availability = exact(row.availability, ['status', 'reasonId'], `${path}.availability`)
  if (availability.status !== 'available' && availability.status !== 'unavailable') {
    fail('campaign-operation-offer.invalid-document', `${path}.availability.status`, 'must be available or unavailable.')
  }
  const reasonId = availability.reasonId === null ? null
    : typeof availability.reasonId === 'string' && REASON_ID.test(availability.reasonId)
      ? availability.reasonId
      : fail('campaign-operation-offer.invalid-id', `${path}.availability.reasonId`, 'must be a typed reason identifier.')
  if ((availability.status === 'available') !== (reasonId === null)) {
    fail('campaign-operation-offer.invalid-invariant', `${path}.availability`, 'unavailable alone requires one safe reason.')
  }
  const inputs = array(row.requiredInputKinds, `${path}.requiredInputKinds`, CAMPAIGN_OPERATION_OFFER_INPUT_KINDS.length)
    .map((entry, index) => typeof entry === 'string' && INPUT_KINDS.has(entry)
      ? entry as CampaignOperationOfferInputKind
      : fail('campaign-operation-offer.invalid-document', `${path}.requiredInputKinds[${index}]`, 'must be an input kind.'))
  for (let index = 1; index < inputs.length; index += 1) if (inputs[index - 1]! >= inputs[index]!) {
    fail('campaign-operation-offer.invalid-invariant', `${path}.requiredInputKinds`, 'must be unique in code-point order.')
  }
  const presentation = exact(row.presentation, ['labelId', 'descriptionId', 'tone'], `${path}.presentation`)
  if (typeof presentation.tone !== 'string' || !TONES.has(presentation.tone)) {
    fail('campaign-operation-offer.invalid-document', `${path}.presentation.tone`, 'must be a presentation tone.')
  }
  const issuedAtCampaignMinute = integer(row.issuedAtCampaignMinute, `${path}.issuedAtCampaignMinute`)
  const expiresAtCampaignMinute = integer(row.expiresAtCampaignMinute, `${path}.expiresAtCampaignMinute`)
  if (expiresAtCampaignMinute !== issuedAtCampaignMinute + 1) {
    fail('campaign-operation-offer.invalid-invariant', `${path}.expiresAtCampaignMinute`, 'must expire at the next campaign minute.')
  }
  return deepFreeze({
    schemaVersion: 1,
    offerId: row.offerId,
    offerDefinitionSha256: hash(row.offerDefinitionSha256, `${path}.offerDefinitionSha256`),
    audience: row.audience as CampaignOperationOfferAudience,
    role: 'campaign-operation',
    workspaceId: stableId(row.workspaceId, `${path}.workspaceId`),
    operationFamilyId: stableId(row.operationFamilyId, `${path}.operationFamilyId`),
    actionId: stableId(row.actionId, `${path}.actionId`),
    actor: {
      kind: actor.kind,
      resourceId: stableId(actor.resourceId, `${path}.actor.resourceId`),
      revision: actorRevision,
    },
    source: {
      kind: source.kind as CampaignOperationOfferSourceKind,
      canonicalId: canonicalId(source.canonicalId, `${path}.source.canonicalId`),
    },
    availability: { status: availability.status, reasonId },
    requiredInputKinds: inputs,
    presentation: {
      labelId: localizationId(presentation.labelId, `${path}.presentation.labelId`),
      descriptionId: localizationId(presentation.descriptionId, `${path}.presentation.descriptionId`),
      tone: presentation.tone as CampaignOperationOfferTone,
    },
    issuedAtCampaignMinute,
    expiresAtCampaignMinute,
  }) as CampaignOperationOfferV1
}

export const parseCampaignOperationOfferDeclarationV1 = (
  value: unknown,
  path = 'campaignOperationOfferDeclaration',
): CampaignOperationOfferDeclarationV1 => {
  const row = exact(value, ['schemaVersion', 'offerId', 'offerDefinitionSha256', 'operationId'], path)
  if (row.schemaVersion !== 1 || typeof row.offerId !== 'string' || !OFFER_ID.test(row.offerId)) {
    fail('campaign-operation-offer.invalid-document', path, 'must be a schema-v1 offer declaration.')
  }
  return deepFreeze({
    schemaVersion: 1,
    offerId: row.offerId as string,
    offerDefinitionSha256: hash(row.offerDefinitionSha256, `${path}.offerDefinitionSha256`),
    operationId: stableId(row.operationId, `${path}.operationId`),
  })
}
