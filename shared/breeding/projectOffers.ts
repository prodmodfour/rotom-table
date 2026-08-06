import { parseCampaignOperationOfferV1, type CampaignOperationOfferV1 } from '../campaignOperationOffers'
import { parseBreedingOperationIdSyntax, type BreedingOperationId } from './ids'

export const BREEDING_PROJECT_CAMPAIGN_OFFER_SCHEMA_VERSION = 1 as const
export interface BreedingProjectCampaignOfferAuthorityV1 {
  readonly schemaVersion: 1
  readonly offer: CampaignOperationOfferV1
  readonly commandOperationId: BreedingOperationId
  readonly commandSha256: string
  readonly actorAuthorityDefinitionSha256: string
  readonly ownerTrainerControlDefinitionSha256: string | null
  readonly breederTrainerControlDefinitionSha256: string | null
  readonly breederAuthorityDefinitionSha256: string | null
  readonly referenceVersionsDefinitionSha256: string
  readonly securityPolicyDefinitionSha256: string
  readonly authorityDefinitionSha256: string
}

export type BreedingProjectCampaignOfferValidationCode =
  | 'breeding.project-offer.invalid-document'
  | 'breeding.project-offer.unknown-field'
  | 'breeding.project-offer.invalid-invariant'
export class BreedingProjectCampaignOfferValidationError extends Error {
  readonly code: BreedingProjectCampaignOfferValidationCode
  readonly path: string
  constructor(code: BreedingProjectCampaignOfferValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingProjectCampaignOfferValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const fail = (
  code: BreedingProjectCampaignOfferValidationCode,
  path: string,
  message: string,
): never => { throw new BreedingProjectCampaignOfferValidationError(code, path, message) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('breeding.project-offer.invalid-document', path, 'must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.project-offer.invalid-document', path, 'must be plain data without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.project-offer.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) {
    fail('breeding.project-offer.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.project-offer.invalid-document', path, 'must be a lowercase SHA-256 digest.')
const nullableHash = (value: unknown, path: string): string | null => value === null ? null : hash(value, path)
const freeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
    Object.freeze(value)
  }
  return value
}

export const parseBreedingProjectCampaignOfferAuthorityV1 = (
  value: unknown,
  path = 'breedingProjectCampaignOfferAuthority',
): BreedingProjectCampaignOfferAuthorityV1 => {
  const row = exact(value, [
    'schemaVersion', 'offer', 'commandOperationId', 'commandSha256',
    'actorAuthorityDefinitionSha256', 'ownerTrainerControlDefinitionSha256',
    'breederTrainerControlDefinitionSha256', 'breederAuthorityDefinitionSha256',
    'referenceVersionsDefinitionSha256', 'securityPolicyDefinitionSha256',
    'authorityDefinitionSha256',
  ], path)
  if (row.schemaVersion !== 1) {
    fail('breeding.project-offer.invalid-document', `${path}.schemaVersion`, 'must equal 1.')
  }
  const offer = parseCampaignOperationOfferV1(row.offer, `${path}.offer`)
  if (offer.workspaceId !== 'breeding' || offer.operationFamilyId !== 'breeding-project'
    || (offer.actionId !== 'breeding.project.preview' && offer.actionId !== 'breeding.project.create')) {
    fail('breeding.project-offer.invalid-invariant', `${path}.offer`, 'must be a Breeding Project campaign operation.')
  }
  const ownerControl = nullableHash(
    row.ownerTrainerControlDefinitionSha256,
    `${path}.ownerTrainerControlDefinitionSha256`,
  )
  const breederControl = nullableHash(
    row.breederTrainerControlDefinitionSha256,
    `${path}.breederTrainerControlDefinitionSha256`,
  )
  const breederAuthority = nullableHash(
    row.breederAuthorityDefinitionSha256,
    `${path}.breederAuthorityDefinitionSha256`,
  )
  const preview = offer.actionId === 'breeding.project.preview'
  const expectedInputs = preview
    ? ['parent-pair', 'project-options']
    : ['confirmation', 'parent-pair', 'project-options']
  const expectedPresentation = preview
    ? {
        labelId: 'breeding.project.preview.label',
        descriptionId: 'breeding.project.preview.description',
        tone: 'neutral',
      }
    : {
        labelId: 'breeding.project.create.label',
        descriptionId: 'breeding.project.create.description',
        tone: 'primary',
      }
  if (offer.requiredInputKinds.length !== expectedInputs.length
    || offer.requiredInputKinds.some((entry, index) => entry !== expectedInputs[index])
    || offer.presentation.labelId !== expectedPresentation.labelId
    || offer.presentation.descriptionId !== expectedPresentation.descriptionId
    || offer.presentation.tone !== expectedPresentation.tone) {
    fail('breeding.project-offer.invalid-invariant', `${path}.offer`, 'must use the bounded Breeding Project action presentation contract.')
  }
  if (offer.audience === 'gm') {
    if (offer.actor.kind !== 'campaign' || offer.actor.resourceId !== 'campaign'
      || offer.source.kind !== 'system' || offer.source.canonicalId !== 'breeding.v1'
      || ownerControl !== null || breederControl !== null || breederAuthority !== null
      || offer.availability.status !== 'available') {
      fail('breeding.project-offer.invalid-invariant', path, 'GM offers use only current campaign system authority.')
    }
  }
  else {
    if (offer.actor.kind !== 'trainer-sheet'
      || offer.source.kind !== 'edge' || offer.source.canonicalId !== 'Breeder'
      || ownerControl === null || breederControl === null
      || (offer.availability.status === 'available') !== (breederAuthority !== null)
      || (offer.availability.status === 'unavailable'
        && offer.availability.reasonId !== 'breeding.offer.breeder-edge-required')) {
      fail('breeding.project-offer.invalid-invariant', path, 'owner offers require current Trainer control and effective Breeder evidence.')
    }
  }
  return freeze({
    schemaVersion: 1,
    offer,
    commandOperationId: parseBreedingOperationIdSyntax(row.commandOperationId)
      ?? fail('breeding.project-offer.invalid-document', `${path}.commandOperationId`, 'must be a Breeding operation ID.'),
    commandSha256: hash(row.commandSha256, `${path}.commandSha256`),
    actorAuthorityDefinitionSha256: hash(row.actorAuthorityDefinitionSha256, `${path}.actorAuthorityDefinitionSha256`),
    ownerTrainerControlDefinitionSha256: ownerControl,
    breederTrainerControlDefinitionSha256: breederControl,
    breederAuthorityDefinitionSha256: breederAuthority,
    referenceVersionsDefinitionSha256: hash(row.referenceVersionsDefinitionSha256, `${path}.referenceVersionsDefinitionSha256`),
    securityPolicyDefinitionSha256: hash(row.securityPolicyDefinitionSha256, `${path}.securityPolicyDefinitionSha256`),
    authorityDefinitionSha256: hash(row.authorityDefinitionSha256, `${path}.authorityDefinitionSha256`),
  })
}
