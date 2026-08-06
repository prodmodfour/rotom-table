import {
  parseBreedingFamilyIdSyntax,
  parseBreedingOfferIdSyntax,
  parseBreedingOfferOptionIdSyntax,
  parseBreedingOperationIdSyntax,
  parseBreedingProjectIdSyntax,
  parseBreedingRollRecordIdSyntax,
  parseBreedingSpeciesIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingFamilyId,
  type BreedingOfferId,
  type BreedingOfferOptionId,
  type BreedingOperationId,
  type BreedingProjectId,
  type BreedingRollRecordId,
  type BreedingSpeciesId,
  type PokemonEggId,
} from './ids'
import { parsePokemonEggOffspringBlueprintV1, type PokemonEggOffspringBlueprintV1 } from './egg'
import { parseBreedingProductionSnapshotV1, type BreedingProductionSnapshotV1 } from './productionSnapshots'

export const BREEDING_OFFSPRING_RESOLUTION_RECORD_SCHEMA_VERSION = 1 as const
export const BREEDING_OFFSPRING_RESOLUTION_PROJECTION_SCHEMA_VERSION = 1 as const
export interface BreedingOffspringFamilyResolutionEvidenceV1 {
  readonly selectionKind: 'canonical-ditto' | 'core-d20' | 'gm-family-choice' | 'maternal-family'
  readonly selectedParentIndex: 0 | 1 | null
  readonly selectedRoleId: 'female-parent' | 'male-parent' | null
  readonly familyRollRecordId: BreedingRollRecordId | null
  readonly familyChoiceOfferId: BreedingOfferId | null
  readonly familyChoiceOptionId: BreedingOfferOptionId | null
  readonly familyChoiceEvidenceId: string | null
  readonly selectedFamilyId: BreedingFamilyId
  readonly compiledRootSpeciesId: BreedingSpeciesId
  readonly offspringSpeciesId: BreedingSpeciesId
  readonly speciesOverrideOfferId: BreedingOfferId | null
  readonly speciesOverrideOptionId: BreedingOfferOptionId | null
  readonly speciesOverrideEvidenceId: string | null
}
export interface BreedingOffspringSelectedOfferEvidenceV1 {
  readonly offerId: BreedingOfferId
  readonly offerRevision: 0
  readonly offerDefinitionSha256: string
  readonly choiceKind: 'ability' | 'baby-template' | 'family' | 'gender' | 'hatch-duration' | 'nature' | 'species'
  readonly optionId: BreedingOfferOptionId
  readonly canonicalValueId: string
  readonly valueDefinitionSha256: string
  readonly authorityEvidenceIds: readonly string[]
}
export interface BreedingOffspringResolutionRecordV1 {
  readonly schemaVersion: 1
  readonly projectId: BreedingProjectId
  readonly projectRevision: number
  readonly eggId: PokemonEggId
  readonly operationId: BreedingOperationId
  readonly commandSha256: string
  readonly productionSnapshot: BreedingProductionSnapshotV1
  readonly family: BreedingOffspringFamilyResolutionEvidenceV1
  readonly blueprint: PokemonEggOffspringBlueprintV1
  readonly hatchDurationRollRecordId: BreedingRollRecordId | null
  readonly rollRecordIds: readonly BreedingRollRecordId[]
  readonly selectedOffers: readonly BreedingOffspringSelectedOfferEvidenceV1[]
  readonly sourceEvidenceDefinitionHashes: readonly string[]
  readonly resolvedAtCampaignMinute: number
  readonly definitionSha256: string
}
export interface BreedingOffspringResolutionProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm' | 'owner'
  readonly status: 'prepared'
  readonly resolvedAtCampaignMinute: number
  readonly traitsResolved: true
  readonly inheritanceFrozen: true
}
export type BreedingOffspringProductionValidationCode =
  | 'breeding.offspring-production.invalid-document'
  | 'breeding.offspring-production.unknown-field'
  | 'breeding.offspring-production.invalid-id'
  | 'breeding.offspring-production.invalid-invariant'
export class BreedingOffspringProductionValidationError extends Error {
  readonly code: BreedingOffspringProductionValidationCode
  readonly path: string
  constructor(code: BreedingOffspringProductionValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingOffspringProductionValidationError'
    this.code = code
    this.path = path
  }
}
type Row = Record<string, unknown>
const SHA = /^[0-9a-f]{64}$/u
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u
const fail = (code: BreedingOffspringProductionValidationCode, path: string, message: string): never => { throw new BreedingOffspringProductionValidationError(code, path, message) }
const record = (value: unknown, path: string): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('breeding.offspring-production.invalid-document', path, 'must be a plain object.')
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.offspring-production.invalid-document', path, 'must be plain data without symbols.')
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.offspring-production.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
  }
  return value as Row
}
const exact = (value: unknown, fields: readonly string[], path: string): Row => {
  const row = record(value, path); const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) fail('breeding.offspring-production.unknown-field', path, 'must contain exactly the declared fields.')
  return row
}
const array = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) return fail('breeding.offspring-production.invalid-document', path, `must be a plain non-enriched array of at most ${maximum} entries.`)
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.offspring-production.invalid-document', `${path}[${index}]`, 'must be an enumerable entry.')
  }
  return value
}
const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum ? Number(value) : fail('breeding.offspring-production.invalid-document', path, 'must be a bounded nonnegative safe integer.')
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA.test(value) ? value : fail('breeding.offspring-production.invalid-document', path, 'must be a lowercase SHA-256 digest.')
const id = (value: unknown, path: string): string => typeof value === 'string' && ID.test(value) ? value : fail('breeding.offspring-production.invalid-id', path, 'must be a bounded stable identifier.')
const sorted = <Value extends string>(values: readonly Value[], path: string): readonly Value[] => {
  for (let index = 1; index < values.length; index += 1) if (values[index - 1]! >= values[index]!) fail('breeding.offspring-production.invalid-invariant', path, 'must be unique in strict code-point order.')
  return Object.freeze([...values])
}
const freeze = <Value>(value: Value): Value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value as Row)) freeze(child); Object.freeze(value) }; return value }
const nullable = <Value>(value: unknown, parser: (input: unknown) => Value | null, path: string): Value | null => value === null ? null : parser(value) ?? fail('breeding.offspring-production.invalid-id', path, 'has invalid stable ID syntax.')
const family = (value: unknown, path: string): BreedingOffspringFamilyResolutionEvidenceV1 => {
  const row = exact(value, ['selectionKind','selectedParentIndex','selectedRoleId','familyRollRecordId','familyChoiceOfferId','familyChoiceOptionId','familyChoiceEvidenceId','selectedFamilyId','compiledRootSpeciesId','offspringSpeciesId','speciesOverrideOfferId','speciesOverrideOptionId','speciesOverrideEvidenceId'], path)
  if (!['canonical-ditto','core-d20','gm-family-choice','maternal-family'].includes(row.selectionKind as string) || (row.selectedParentIndex !== null && row.selectedParentIndex !== 0 && row.selectedParentIndex !== 1) || (row.selectedRoleId !== null && row.selectedRoleId !== 'female-parent' && row.selectedRoleId !== 'male-parent')) fail('breeding.offspring-production.invalid-document', path, 'has invalid family selection fields.')
  const roll = nullable(row.familyRollRecordId, parseBreedingRollRecordIdSyntax, `${path}.familyRollRecordId`)
  const familyOffer = nullable(row.familyChoiceOfferId, parseBreedingOfferIdSyntax, `${path}.familyChoiceOfferId`)
  const familyOption = nullable(row.familyChoiceOptionId, parseBreedingOfferOptionIdSyntax, `${path}.familyChoiceOptionId`)
  const familyEvidence = row.familyChoiceEvidenceId === null ? null : id(row.familyChoiceEvidenceId, `${path}.familyChoiceEvidenceId`)
  const speciesOffer = nullable(row.speciesOverrideOfferId, parseBreedingOfferIdSyntax, `${path}.speciesOverrideOfferId`)
  const speciesOption = nullable(row.speciesOverrideOptionId, parseBreedingOfferOptionIdSyntax, `${path}.speciesOverrideOptionId`)
  const speciesEvidence = row.speciesOverrideEvidenceId === null ? null : id(row.speciesOverrideEvidenceId, `${path}.speciesOverrideEvidenceId`)
  if ((row.selectionKind === 'core-d20') !== (roll !== null) || (row.selectionKind === 'gm-family-choice') !== (familyOffer !== null) || (familyOffer === null) !== (familyOption === null) || (familyOption === null) !== (familyEvidence === null) || (speciesOffer === null) !== (speciesOption === null) || (speciesOption === null) !== (speciesEvidence === null)) fail('breeding.offspring-production.invalid-invariant', path, 'family roll and bounded choice evidence must match the selection kinds.')
  return freeze({ selectionKind: row.selectionKind as BreedingOffspringFamilyResolutionEvidenceV1['selectionKind'], selectedParentIndex: row.selectedParentIndex as 0|1|null, selectedRoleId: row.selectedRoleId as BreedingOffspringFamilyResolutionEvidenceV1['selectedRoleId'], familyRollRecordId: roll, familyChoiceOfferId: familyOffer, familyChoiceOptionId: familyOption, familyChoiceEvidenceId: familyEvidence, selectedFamilyId: parseBreedingFamilyIdSyntax(row.selectedFamilyId) ?? fail('breeding.offspring-production.invalid-id', `${path}.selectedFamilyId`, 'must be a Family ID.'), compiledRootSpeciesId: parseBreedingSpeciesIdSyntax(row.compiledRootSpeciesId) ?? fail('breeding.offspring-production.invalid-id', `${path}.compiledRootSpeciesId`, 'must be a Species ID.'), offspringSpeciesId: parseBreedingSpeciesIdSyntax(row.offspringSpeciesId) ?? fail('breeding.offspring-production.invalid-id', `${path}.offspringSpeciesId`, 'must be a Species ID.'), speciesOverrideOfferId: speciesOffer, speciesOverrideOptionId: speciesOption, speciesOverrideEvidenceId: speciesEvidence })
}
const OFFER_KINDS = new Set(['ability','baby-template','family','gender','hatch-duration','nature','species'])
const offer = (value: unknown, path: string): BreedingOffspringSelectedOfferEvidenceV1 => {
  const row = exact(value, ['offerId','offerRevision','offerDefinitionSha256','choiceKind','optionId','canonicalValueId','valueDefinitionSha256','authorityEvidenceIds'], path)
  if (row.offerRevision !== 0 || typeof row.choiceKind !== 'string' || !OFFER_KINDS.has(row.choiceKind)) fail('breeding.offspring-production.invalid-document', path, 'must identify one active v1 production offer.')
  const authority = array(row.authorityEvidenceIds, `${path}.authorityEvidenceIds`, 32).map((entry,index)=>id(entry,`${path}.authorityEvidenceIds[${index}]`)); if(authority.length<1)fail('breeding.offspring-production.invalid-invariant',`${path}.authorityEvidenceIds`,'cannot be empty.'); sorted(authority,`${path}.authorityEvidenceIds`)
  return freeze({ offerId: parseBreedingOfferIdSyntax(row.offerId) ?? fail('breeding.offspring-production.invalid-id',`${path}.offerId`,'must be an offer ID.'), offerRevision:0, offerDefinitionSha256:hash(row.offerDefinitionSha256,`${path}.offerDefinitionSha256`), choiceKind:row.choiceKind as BreedingOffspringSelectedOfferEvidenceV1['choiceKind'], optionId:parseBreedingOfferOptionIdSyntax(row.optionId)??fail('breeding.offspring-production.invalid-id',`${path}.optionId`,'must be an option ID.'), canonicalValueId:id(row.canonicalValueId,`${path}.canonicalValueId`), valueDefinitionSha256:hash(row.valueDefinitionSha256,`${path}.valueDefinitionSha256`), authorityEvidenceIds:Object.freeze(authority) })
}
export const breedingOffspringSelectedOfferEvidenceKey = (value: Pick<BreedingOffspringSelectedOfferEvidenceV1,'choiceKind'|'offerId'>): string => `${value.choiceKind}\u0000${value.offerId}`
export const parseBreedingOffspringResolutionRecordV1 = (value: unknown, path='offspringResolutionRecord'): BreedingOffspringResolutionRecordV1 => {
  const row=exact(value,['schemaVersion','projectId','projectRevision','eggId','operationId','commandSha256','productionSnapshot','family','blueprint','hatchDurationRollRecordId','rollRecordIds','selectedOffers','sourceEvidenceDefinitionHashes','resolvedAtCampaignMinute','definitionSha256'],path)
  if(row.schemaVersion!==1)fail('breeding.offspring-production.invalid-document',`${path}.schemaVersion`,'must equal 1.')
  const rolls=array(row.rollRecordIds,`${path}.rollRecordIds`,5).map((entry,index)=>parseBreedingRollRecordIdSyntax(entry)??fail('breeding.offspring-production.invalid-id',`${path}.rollRecordIds[${index}]`,'must be a roll ID.'));sorted(rolls,`${path}.rollRecordIds`)
  const offers=array(row.selectedOffers,`${path}.selectedOffers`,7).map((entry,index)=>offer(entry,`${path}.selectedOffers[${index}]`));sorted(offers.map(breedingOffspringSelectedOfferEvidenceKey),`${path}.selectedOffers`)
  const hashes=array(row.sourceEvidenceDefinitionHashes,`${path}.sourceEvidenceDefinitionHashes`,256).map((entry,index)=>hash(entry,`${path}.sourceEvidenceDefinitionHashes[${index}]`));sorted(hashes,`${path}.sourceEvidenceDefinitionHashes`)
  return freeze({schemaVersion:1,projectId:parseBreedingProjectIdSyntax(row.projectId)??fail('breeding.offspring-production.invalid-id',`${path}.projectId`,'must be a Project ID.'),projectRevision:integer(row.projectRevision,`${path}.projectRevision`,2_147_483_647),eggId:parsePokemonEggIdSyntax(row.eggId)??fail('breeding.offspring-production.invalid-id',`${path}.eggId`,'must be an Egg ID.'),operationId:parseBreedingOperationIdSyntax(row.operationId)??fail('breeding.offspring-production.invalid-id',`${path}.operationId`,'must be an operation ID.'),commandSha256:hash(row.commandSha256,`${path}.commandSha256`),productionSnapshot:parseBreedingProductionSnapshotV1(row.productionSnapshot,`${path}.productionSnapshot`),family:family(row.family,`${path}.family`),blueprint:parsePokemonEggOffspringBlueprintV1(row.blueprint,`${path}.blueprint`),hatchDurationRollRecordId:nullable(row.hatchDurationRollRecordId,parseBreedingRollRecordIdSyntax,`${path}.hatchDurationRollRecordId`),rollRecordIds:Object.freeze(rolls),selectedOffers:Object.freeze(offers),sourceEvidenceDefinitionHashes:Object.freeze(hashes),resolvedAtCampaignMinute:integer(row.resolvedAtCampaignMinute,`${path}.resolvedAtCampaignMinute`),definitionSha256:hash(row.definitionSha256,`${path}.definitionSha256`)})
}
export const parseBreedingOffspringResolutionProjectionV1=(value:unknown,path='offspringResolutionProjection'):BreedingOffspringResolutionProjectionV1=>{const row=exact(value,['schemaVersion','audience','status','resolvedAtCampaignMinute','traitsResolved','inheritanceFrozen'],path);if(row.schemaVersion!==1||(row.audience!=='gm'&&row.audience!=='owner')||row.status!=='prepared'||row.traitsResolved!==true||row.inheritanceFrozen!==true)fail('breeding.offspring-production.invalid-invariant',path,'must be one bounded prepared-resolution projection.');return freeze({schemaVersion:1,audience:row.audience,status:'prepared',resolvedAtCampaignMinute:integer(row.resolvedAtCampaignMinute,`${path}.resolvedAtCampaignMinute`),traitsResolved:true,inheritanceFrozen:true}) as BreedingOffspringResolutionProjectionV1}
