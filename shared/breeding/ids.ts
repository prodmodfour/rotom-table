export const BREEDING_ID_SCHEMA_VERSION = 1 as const
export const BREEDING_CANONICAL_LOCAL_ID_MAX_LENGTH = 64 as const

const LOCAL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CAMPAIGN_OPTION_ID = /^breeding\.[a-z0-9]+(?:-[a-z0-9]+)*$/
const OFFER_OPTION_ID = /^option:v1:[0-9a-f]{32}$/
const PROJECT_ID = /^breeding-project:v1:[0-9a-f]{32}$/
const EGG_ID = /^pokemon-egg:v1:[0-9a-f]{32}$/
const OPERATION_ID = /^breeding-operation:v1:[0-9a-f]{32}$/
const CHECK_RECORD_ID = /^breeding-check:v1:[0-9a-f]{32}$/
const ROLL_RECORD_ID = /^breeding-roll:v1:[0-9a-f]{32}$/
const BREEDING_ORIGIN_ID = /^pokemon-breeding-origin:v1:[0-9a-f]{32}$/
const INHERITANCE_LEARNING_RECORD_ID = /^inheritance-learning:v1:[0-9a-f]{32}$/
const CONSENT_ID = /^breeding-consent:v1:[0-9a-f]{32}$/
const EGG_TRANSFER_CONSENT_ID = /^egg-transfer-consent:v1:[0-9a-f]{32}$/
const OFFER_ID = /^breeding-offer:v1:[0-9a-f]{32}$/
const ADJUDICATION_ID = /^breeding-adjudication:v1:[0-9a-f]{32}$/
const READ_SET_ID = /^breeding-read-set:v1:[0-9a-f]{32}$/
const OVERRIDE_ID = /^breeding-override:v1:[0-9a-f]{32}$/
const ARCHIVE_ID = /^breeding-archive:v1:[0-9a-f]{32}$/
const ARCHIVE_REQUEST_ID = /^breeding-archive-request:v1:[0-9a-f]{32}$/
const MIGRATION_ID = /^breeding-migration:v1:[0-9a-f]{32}$/
const LEGACY_REVIEW_ID = /^breeding-legacy-review:v1:[0-9a-f]{32}$/
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/
const COMBINING_MARK = /\p{M}/gu

declare const speciesIdBrand: unique symbol
declare const familyIdBrand: unique symbol
declare const eggGroupIdBrand: unique symbol
declare const moveIdBrand: unique symbol
declare const abilityIdBrand: unique symbol
declare const campaignOptionIdBrand: unique symbol
declare const offerOptionIdBrand: unique symbol
declare const projectIdBrand: unique symbol
declare const eggIdBrand: unique symbol
declare const operationIdBrand: unique symbol
declare const checkRecordIdBrand: unique symbol
declare const rollRecordIdBrand: unique symbol
declare const breedingOriginIdBrand: unique symbol
declare const inheritanceLearningRecordIdBrand: unique symbol
declare const breedingConsentIdBrand: unique symbol
declare const pokemonEggTransferConsentIdBrand: unique symbol
declare const breedingOfferIdBrand: unique symbol
declare const breedingAdjudicationIdBrand: unique symbol
declare const breedingReadSetIdBrand: unique symbol
declare const breedingOverrideIdBrand: unique symbol
declare const breedingArchiveIdBrand: unique symbol
declare const breedingArchiveRequestIdBrand: unique symbol
declare const breedingMigrationIdBrand: unique symbol
declare const breedingLegacyReviewIdBrand: unique symbol

export type BreedingSpeciesId = string & { readonly [speciesIdBrand]: true }
export type BreedingFamilyId = string & { readonly [familyIdBrand]: true }
export type BreedingEggGroupId = string & { readonly [eggGroupIdBrand]: true }
export type BreedingMoveId = string & { readonly [moveIdBrand]: true }
export type BreedingAbilityId = string & { readonly [abilityIdBrand]: true }
export type BreedingCampaignOptionId = string & { readonly [campaignOptionIdBrand]: true }
export type BreedingOfferOptionId = string & { readonly [offerOptionIdBrand]: true }
export type BreedingProjectId = string & { readonly [projectIdBrand]: true }
export type PokemonEggId = string & { readonly [eggIdBrand]: true }
export type BreedingOperationId = string & { readonly [operationIdBrand]: true }
export type BreedingCheckRecordId = string & { readonly [checkRecordIdBrand]: true }
export type BreedingRollRecordId = string & { readonly [rollRecordIdBrand]: true }
export type PokemonBreedingOriginId = string & { readonly [breedingOriginIdBrand]: true }
export type BreedingInheritanceLearningRecordId = string & { readonly [inheritanceLearningRecordIdBrand]: true }
export type BreedingConsentId = string & { readonly [breedingConsentIdBrand]: true }
export type PokemonEggTransferConsentId = string & { readonly [pokemonEggTransferConsentIdBrand]: true }
export type BreedingOfferId = string & { readonly [breedingOfferIdBrand]: true }
export type BreedingAdjudicationId = string & { readonly [breedingAdjudicationIdBrand]: true }
export type BreedingReadSetId = string & { readonly [breedingReadSetIdBrand]: true }
export type BreedingOverrideId = string & { readonly [breedingOverrideIdBrand]: true }
export type BreedingArchiveId = string & { readonly [breedingArchiveIdBrand]: true }
export type BreedingArchiveRequestId = string & { readonly [breedingArchiveRequestIdBrand]: true }
export type BreedingMigrationId = string & { readonly [breedingMigrationIdBrand]: true }
export type BreedingLegacyReviewId = string & { readonly [breedingLegacyReviewIdBrand]: true }

export const BREEDING_OFFER_OPTION_KINDS = Object.freeze([
  'species',
  'family',
  'nature',
  'ability',
  'gender',
  'move',
  'parent-role',
  'hatch-duration',
  'baby-template',
  'special-result',
  'inheritance-slot',
] as const)
export type BreedingOfferOptionKind = typeof BREEDING_OFFER_OPTION_KINDS[number]

export type BreedingCanonicalIdCompileFailureReason =
  | 'invalid-source-name'
  | 'empty-canonical-id'
  | 'overlong-canonical-id'

export type BreedingCanonicalIdCompileResult =
  | { readonly ok: true, readonly id: string }
  | { readonly ok: false, readonly reason: BreedingCanonicalIdCompileFailureReason }

/** Syntax validation only. Runtime membership must also be checked in the server catalog. */
export const isBreedingCanonicalLocalIdSyntax = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length >= 1
  && value.length <= BREEDING_CANONICAL_LOCAL_ID_MAX_LENGTH
  && LOCAL_ID.test(value)
)

export const parseBreedingSpeciesIdSyntax = (value: unknown): BreedingSpeciesId | null => (
  isBreedingCanonicalLocalIdSyntax(value) ? value as BreedingSpeciesId : null
)
export const parseBreedingEggGroupIdSyntax = (value: unknown): BreedingEggGroupId | null => (
  isBreedingCanonicalLocalIdSyntax(value) ? value as BreedingEggGroupId : null
)
export const parseBreedingMoveIdSyntax = (value: unknown): BreedingMoveId | null => (
  isBreedingCanonicalLocalIdSyntax(value) ? value as BreedingMoveId : null
)
export const parseBreedingAbilityIdSyntax = (value: unknown): BreedingAbilityId | null => (
  isBreedingCanonicalLocalIdSyntax(value) ? value as BreedingAbilityId : null
)

export const parseBreedingFamilyIdSyntax = (value: unknown): BreedingFamilyId | null => {
  if (typeof value !== 'string' || !value.startsWith('family:')) return null
  return parseBreedingSpeciesIdSyntax(value.slice('family:'.length))
    ? value as BreedingFamilyId
    : null
}

export const breedingFamilyIdForRoot = (rootSpeciesId: BreedingSpeciesId): BreedingFamilyId => (
  `family:${rootSpeciesId}` as BreedingFamilyId
)

export const parseBreedingCampaignOptionIdSyntax = (value: unknown): BreedingCampaignOptionId | null => (
  typeof value === 'string' && value.length <= 96 && CAMPAIGN_OPTION_ID.test(value)
    ? value as BreedingCampaignOptionId
    : null
)

export const parseBreedingOfferOptionIdSyntax = (value: unknown): BreedingOfferOptionId | null => (
  typeof value === 'string' && OFFER_OPTION_ID.test(value)
    ? value as BreedingOfferOptionId
    : null
)

export const parseBreedingProjectIdSyntax = (value: unknown): BreedingProjectId | null => (
  typeof value === 'string' && PROJECT_ID.test(value) ? value as BreedingProjectId : null
)
export const parsePokemonEggIdSyntax = (value: unknown): PokemonEggId | null => (
  typeof value === 'string' && EGG_ID.test(value) ? value as PokemonEggId : null
)
export const parseBreedingOperationIdSyntax = (value: unknown): BreedingOperationId | null => (
  typeof value === 'string' && OPERATION_ID.test(value) ? value as BreedingOperationId : null
)
export const parseBreedingCheckRecordIdSyntax = (value: unknown): BreedingCheckRecordId | null => (
  typeof value === 'string' && CHECK_RECORD_ID.test(value) ? value as BreedingCheckRecordId : null
)
export const parseBreedingRollRecordIdSyntax = (value: unknown): BreedingRollRecordId | null => (
  typeof value === 'string' && ROLL_RECORD_ID.test(value) ? value as BreedingRollRecordId : null
)
export const parsePokemonBreedingOriginIdSyntax = (value: unknown): PokemonBreedingOriginId | null => (
  typeof value === 'string' && BREEDING_ORIGIN_ID.test(value) ? value as PokemonBreedingOriginId : null
)
export const parseBreedingInheritanceLearningRecordIdSyntax = (value: unknown): BreedingInheritanceLearningRecordId | null => (
  typeof value === 'string' && INHERITANCE_LEARNING_RECORD_ID.test(value) ? value as BreedingInheritanceLearningRecordId : null
)
export const parseBreedingConsentIdSyntax = (value: unknown): BreedingConsentId | null => (
  typeof value === 'string' && CONSENT_ID.test(value) ? value as BreedingConsentId : null
)
export const parsePokemonEggTransferConsentIdSyntax = (value: unknown): PokemonEggTransferConsentId | null => (
  typeof value === 'string' && EGG_TRANSFER_CONSENT_ID.test(value) ? value as PokemonEggTransferConsentId : null
)
export const parseBreedingOfferIdSyntax = (value: unknown): BreedingOfferId | null => (
  typeof value === 'string' && OFFER_ID.test(value) ? value as BreedingOfferId : null
)
export const parseBreedingAdjudicationIdSyntax = (value: unknown): BreedingAdjudicationId | null => (
  typeof value === 'string' && ADJUDICATION_ID.test(value) ? value as BreedingAdjudicationId : null
)
export const parseBreedingReadSetIdSyntax = (value: unknown): BreedingReadSetId | null => (
  typeof value === 'string' && READ_SET_ID.test(value) ? value as BreedingReadSetId : null
)
export const parseBreedingOverrideIdSyntax = (value: unknown): BreedingOverrideId | null => (
  typeof value === 'string' && OVERRIDE_ID.test(value) ? value as BreedingOverrideId : null
)
export const parseBreedingArchiveIdSyntax = (value: unknown): BreedingArchiveId | null => (
  typeof value === 'string' && ARCHIVE_ID.test(value) ? value as BreedingArchiveId : null
)
export const parseBreedingArchiveRequestIdSyntax = (value: unknown): BreedingArchiveRequestId | null => (
  typeof value === 'string' && ARCHIVE_REQUEST_ID.test(value) ? value as BreedingArchiveRequestId : null
)
export const parseBreedingMigrationIdSyntax = (value: unknown): BreedingMigrationId | null => (
  typeof value === 'string' && MIGRATION_ID.test(value) ? value as BreedingMigrationId : null
)
export const parseBreedingLegacyReviewIdSyntax = (value: unknown): BreedingLegacyReviewId | null => (
  typeof value === 'string' && LEGACY_REVIEW_ID.test(value) ? value as BreedingLegacyReviewId : null
)

/**
 * Maintenance/compiler-only mapping frozen as `breeding-source-name-id-v1`.
 * Commands and runtime labels must never call this to recover an identity.
 */
export const compileBreedingCanonicalLocalId = (sourceName: unknown): BreedingCanonicalIdCompileResult => {
  if (typeof sourceName !== 'string'
    || sourceName.length < 1
    || sourceName.length > 240
    || CONTROL_CHARACTER.test(sourceName)) {
    return { ok: false, reason: 'invalid-source-name' }
  }
  const id = sourceName
    .replace(/♀/gu, ' female ')
    .replace(/♂/gu, ' male ')
    .replace(/&/gu, ' and ')
    .normalize('NFKD')
    .replace(COMBINING_MARK, '')
    .replace(/['`’‘]/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')

  if (!id) return { ok: false, reason: 'empty-canonical-id' }
  if (id.length > BREEDING_CANONICAL_LOCAL_ID_MAX_LENGTH) {
    return { ok: false, reason: 'overlong-canonical-id' }
  }
  return { ok: true, id }
}
