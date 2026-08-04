export const BREEDING_ID_SCHEMA_VERSION = 1 as const
export const BREEDING_CANONICAL_LOCAL_ID_MAX_LENGTH = 64 as const

const LOCAL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CAMPAIGN_OPTION_ID = /^breeding\.[a-z0-9]+(?:-[a-z0-9]+)*$/
const OFFER_OPTION_ID = /^option:v1:[0-9a-f]{32}$/
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/
const COMBINING_MARK = /\p{M}/gu

declare const speciesIdBrand: unique symbol
declare const familyIdBrand: unique symbol
declare const eggGroupIdBrand: unique symbol
declare const moveIdBrand: unique symbol
declare const abilityIdBrand: unique symbol
declare const campaignOptionIdBrand: unique symbol
declare const offerOptionIdBrand: unique symbol

export type BreedingSpeciesId = string & { readonly [speciesIdBrand]: true }
export type BreedingFamilyId = string & { readonly [familyIdBrand]: true }
export type BreedingEggGroupId = string & { readonly [eggGroupIdBrand]: true }
export type BreedingMoveId = string & { readonly [moveIdBrand]: true }
export type BreedingAbilityId = string & { readonly [abilityIdBrand]: true }
export type BreedingCampaignOptionId = string & { readonly [campaignOptionIdBrand]: true }
export type BreedingOfferOptionId = string & { readonly [offerOptionIdBrand]: true }

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
