import { parseBreedingOperationIdSyntax, parsePokemonEggIdSyntax, type BreedingOperationId, type PokemonEggId } from './ids'
import { isSlug } from '../paths'

export interface BreedingArtificialEggSourceAuthorityV1 {
  readonly schemaVersion: 1
  readonly eggId: PokemonEggId
  readonly ownerTrainerSlug: string
  readonly ownerTrainerRevision: number
  readonly ownerTrainerDefinitionSha256: string
  readonly createdByGmProfileId: string
  readonly featureHandoffDefinitionSha256: string
  readonly featureContributionDefinitionSha256: string
  readonly chemistryInventoryEntryId: string
  readonly chemistryUnitOrdinal: number
  readonly chemistryInventoryRowDefinitionSha256: string
  readonly cost: 3500
  readonly moneyBefore: number
  readonly moneyAfter: number
  readonly capturedAtCampaignMinute: number
  readonly definitionSha256: string
}

export interface BreedingArtificialEggCreationProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm' | 'owner'
  readonly eggId: PokemonEggId
  readonly eggRevision: 0
  readonly sourceKind: 'feature-artificial'
  readonly status: 'incubating'
  readonly startingLevel: 5
  readonly upgradeCount: 5 | 6
  readonly createdAtCampaignMinute: number
  readonly operationId: BreedingOperationId
}

export type BreedingArtificialEggValidationCode =
  | 'breeding.artificial-egg.invalid-document'
  | 'breeding.artificial-egg.unknown-field'
  | 'breeding.artificial-egg.invalid-invariant'
export class BreedingArtificialEggValidationError extends Error {
  readonly code: BreedingArtificialEggValidationCode
  readonly path: string
  constructor(code: BreedingArtificialEggValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingArtificialEggValidationError'
    this.code = code
    this.path = path
  }
}
type Row = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u
const fail = (code: BreedingArtificialEggValidationCode, path: string, message: string): never => { throw new BreedingArtificialEggValidationError(code, path, message) }
const exact = (value: unknown, fields: readonly string[], path: string): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.artificial-egg.invalid-document', path, 'must be a plain data object.')
  const row = value as Row; const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.getOwnPropertyNames(row).some(field => !allowed.has(field))) return fail('breeding.artificial-egg.unknown-field', path, 'must contain exactly the declared fields.')
  for (const field of fields) { const descriptor = Object.getOwnPropertyDescriptor(row, field); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.artificial-egg.invalid-document', `${path}.${field}`, 'must be an enumerable data field.') }
  return row
}
const integer = (value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum ? value as number : fail('breeding.artificial-egg.invalid-document', path, `must be a safe integer from ${minimum} through ${maximum}.`)
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value) ? value : fail('breeding.artificial-egg.invalid-document', path, 'must be a lowercase SHA-256 hash.')
const id = (value: unknown, path: string): string => typeof value === 'string' && ID.test(value) ? value : fail('breeding.artificial-egg.invalid-document', path, 'must be a bounded identifier.')

export const parseBreedingArtificialEggSourceAuthorityV1 = (value: unknown, path = 'artificialEggSourceAuthority'): BreedingArtificialEggSourceAuthorityV1 => {
  const row = exact(value, ['schemaVersion','eggId','ownerTrainerSlug','ownerTrainerRevision','ownerTrainerDefinitionSha256','createdByGmProfileId','featureHandoffDefinitionSha256','featureContributionDefinitionSha256','chemistryInventoryEntryId','chemistryUnitOrdinal','chemistryInventoryRowDefinitionSha256','cost','moneyBefore','moneyAfter','capturedAtCampaignMinute','definitionSha256'], path)
  const moneyBefore = integer(row.moneyBefore, `${path}.moneyBefore`)
  const moneyAfter = integer(row.moneyAfter, `${path}.moneyAfter`)
  if (row.schemaVersion !== 1 || row.cost !== 3500 || moneyBefore - moneyAfter !== 3500) return fail('breeding.artificial-egg.invalid-invariant', path, 'must freeze the exact $3500 Playing God cost and resulting balance.')
  const ownerTrainerSlug = typeof row.ownerTrainerSlug === 'string' && isSlug(row.ownerTrainerSlug) && row.ownerTrainerSlug.length <= 160 ? row.ownerTrainerSlug : fail('breeding.artificial-egg.invalid-document', `${path}.ownerTrainerSlug`, 'must be a sheet slug.')
  return Object.freeze({ schemaVersion:1, eggId:parsePokemonEggIdSyntax(row.eggId)??fail('breeding.artificial-egg.invalid-document',`${path}.eggId`,'must be an Egg ID.'), ownerTrainerSlug, ownerTrainerRevision:integer(row.ownerTrainerRevision,`${path}.ownerTrainerRevision`,0,2_147_483_647), ownerTrainerDefinitionSha256:hash(row.ownerTrainerDefinitionSha256,`${path}.ownerTrainerDefinitionSha256`), createdByGmProfileId:id(row.createdByGmProfileId,`${path}.createdByGmProfileId`), featureHandoffDefinitionSha256:hash(row.featureHandoffDefinitionSha256,`${path}.featureHandoffDefinitionSha256`), featureContributionDefinitionSha256:hash(row.featureContributionDefinitionSha256,`${path}.featureContributionDefinitionSha256`), chemistryInventoryEntryId:id(row.chemistryInventoryEntryId,`${path}.chemistryInventoryEntryId`), chemistryUnitOrdinal:integer(row.chemistryUnitOrdinal,`${path}.chemistryUnitOrdinal`,0,999_999), chemistryInventoryRowDefinitionSha256:hash(row.chemistryInventoryRowDefinitionSha256,`${path}.chemistryInventoryRowDefinitionSha256`), cost:3500, moneyBefore, moneyAfter, capturedAtCampaignMinute:integer(row.capturedAtCampaignMinute,`${path}.capturedAtCampaignMinute`), definitionSha256:hash(row.definitionSha256,`${path}.definitionSha256`) })
}

export const parseBreedingArtificialEggCreationProjectionV1 = (value: unknown, path = 'artificialEggProjection'): BreedingArtificialEggCreationProjectionV1 => {
  const row = exact(value, ['schemaVersion','audience','eggId','eggRevision','sourceKind','status','startingLevel','upgradeCount','createdAtCampaignMinute','operationId'], path)
  if (row.schemaVersion !== 1 || (row.audience !== 'gm' && row.audience !== 'owner') || row.eggRevision !== 0 || row.sourceKind !== 'feature-artificial' || row.status !== 'incubating' || row.startingLevel !== 5 || (row.upgradeCount !== 5 && row.upgradeCount !== 6)) return fail('breeding.artificial-egg.invalid-invariant', path, 'must be one bounded committed artificial-Egg projection.')
  return Object.freeze({ schemaVersion:1, audience:row.audience, eggId:parsePokemonEggIdSyntax(row.eggId)??fail('breeding.artificial-egg.invalid-document',`${path}.eggId`,'must be an Egg ID.'), eggRevision:0, sourceKind:'feature-artificial', status:'incubating', startingLevel:5, upgradeCount:row.upgradeCount, createdAtCampaignMinute:integer(row.createdAtCampaignMinute,`${path}.createdAtCampaignMinute`), operationId:parseBreedingOperationIdSyntax(row.operationId)??fail('breeding.artificial-egg.invalid-document',`${path}.operationId`,'must be an operation ID.') })
}
