import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseBreedingSpeciesIdSyntax, type BreedingSpeciesId } from '#shared/breeding/ids'
import { isSlug } from '#shared/paths'
import {
  BREEDING_SPECIES_ACQUISITION_INTEGRATION_POLICY_DEFINITION_SHA256,
  createBreedingSpeciesAcquisitionSourceEvidenceV1,
  type BreedingSpeciesAcquisitionSourceEvidenceV1,
} from '../domain/breeding/speciesAcquisitionIntegration'
import { canonicalBreedingSpeciesIdentity } from '../domain/breeding/canonicalIds'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import type { PersistedSheet } from '../storage/sheetRepository'
import { recordSpeciesAcquisition, type RecordSpeciesAcquisitionResultV1 } from './recordTrainerSpeciesAcquisition'

const SHA256 = /^[0-9a-f]{64}$/
const REVIEW_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

export type ReviewedSpeciesAcquisitionKind = 'migration' | 'gm-reviewed'
export interface ReviewedSpeciesAcquisitionAuthorityV1 {
  readonly schemaVersion: 1
  readonly sourceKind: ReviewedSpeciesAcquisitionKind
  readonly reviewId: string
  readonly sourceArtifactDefinitionSha256: string
  readonly reviewerAuthorityDefinitionSha256: string
  readonly trainerSheetSlug: string
  readonly trainerRevisionBeforeReward: number
  readonly speciesId: BreedingSpeciesId
  readonly campaignMinute: number
  readonly integrationPolicyDefinitionSha256: string
  readonly definitionSha256: string
}

export class ReviewedSpeciesAcquisitionError extends Error {
  readonly code:
    | 'breeding.species-acquisition-review.invalid-input'
    | 'breeding.species-acquisition-review.stale-authority'
  readonly field: string
  constructor(code: ReviewedSpeciesAcquisitionError['code'], field: string, message: string) {
    super(`Reviewed Species acquisition ${field}: ${message}`)
    this.name = 'ReviewedSpeciesAcquisitionError'
    this.code = code
    this.field = field
  }
}

const fail = (
  code: ReviewedSpeciesAcquisitionError['code'],
  field: string,
  message: string,
): never => {
  throw new ReviewedSpeciesAcquisitionError(code, field, message)
}
const exact = (value: unknown, fields: readonly string[], path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.species-acquisition-review.invalid-input', path, 'must be one plain exact object.')
  }
  const row = value as Record<string, unknown>
  const actual = Object.getOwnPropertyNames(row).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])) {
    return fail('breeding.species-acquisition-review.invalid-input', path, 'must contain exactly the declared fields.')
  }
  for (const field of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(row, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.species-acquisition-review.invalid-input', `${path}.${field}`, 'must be an enumerable data field.')
    }
  }
  return row
}
const integer = (value: unknown, field: string): number => (
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < Number.MAX_SAFE_INTEGER
    ? Number(value)
    : fail('breeding.species-acquisition-review.invalid-input', field, 'must be a bounded safe nonnegative integer.')
)
const hash = (value: unknown, field: string): string => (
  typeof value === 'string' && SHA256.test(value)
    ? value
    : fail('breeding.species-acquisition-review.invalid-input', field, 'must be a lowercase SHA-256 digest.')
)

const withoutHash = (
  value: ReviewedSpeciesAcquisitionAuthorityV1,
): Omit<ReviewedSpeciesAcquisitionAuthorityV1, 'definitionSha256'> => {
  const { definitionSha256: _definitionSha256, ...definition } = value
  return definition
}

export const parseReviewedSpeciesAcquisitionAuthorityV1 = (
  value: unknown,
  path = 'reviewAuthority',
): ReviewedSpeciesAcquisitionAuthorityV1 => {
  const row = exact(value, [
    'schemaVersion',
    'sourceKind',
    'reviewId',
    'sourceArtifactDefinitionSha256',
    'reviewerAuthorityDefinitionSha256',
    'trainerSheetSlug',
    'trainerRevisionBeforeReward',
    'speciesId',
    'campaignMinute',
    'integrationPolicyDefinitionSha256',
    'definitionSha256',
  ], path)
  if (row.schemaVersion !== 1
    || (row.sourceKind !== 'migration' && row.sourceKind !== 'gm-reviewed')) {
    return fail('breeding.species-acquisition-review.invalid-input', `${path}.sourceKind`, 'must be migration or gm-reviewed.')
  }
  const speciesId = parseBreedingSpeciesIdSyntax(row.speciesId)
  if (!speciesId || !canonicalBreedingSpeciesIdentity(speciesId)) {
    return fail('breeding.species-acquisition-review.invalid-input', `${path}.speciesId`, 'must identify one app-owned canonical Species.')
  }
  const authority = Object.freeze({
    schemaVersion: 1 as const,
    sourceKind: row.sourceKind,
    reviewId: typeof row.reviewId === 'string' && REVIEW_ID.test(row.reviewId)
      ? row.reviewId
      : fail('breeding.species-acquisition-review.invalid-input', `${path}.reviewId`, 'must be a bounded typed review ID.'),
    sourceArtifactDefinitionSha256: hash(row.sourceArtifactDefinitionSha256, `${path}.sourceArtifactDefinitionSha256`),
    reviewerAuthorityDefinitionSha256: hash(row.reviewerAuthorityDefinitionSha256, `${path}.reviewerAuthorityDefinitionSha256`),
    trainerSheetSlug: isSlug(row.trainerSheetSlug) && row.trainerSheetSlug.length <= 160
      ? row.trainerSheetSlug
      : fail('breeding.species-acquisition-review.invalid-input', `${path}.trainerSheetSlug`, 'must be a canonical bounded slug.'),
    trainerRevisionBeforeReward: integer(row.trainerRevisionBeforeReward, `${path}.trainerRevisionBeforeReward`),
    speciesId,
    campaignMinute: integer(row.campaignMinute, `${path}.campaignMinute`),
    integrationPolicyDefinitionSha256: hash(row.integrationPolicyDefinitionSha256, `${path}.integrationPolicyDefinitionSha256`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  }) as ReviewedSpeciesAcquisitionAuthorityV1
  if (authority.integrationPolicyDefinitionSha256
    !== BREEDING_SPECIES_ACQUISITION_INTEGRATION_POLICY_DEFINITION_SHA256) {
    return fail('breeding.species-acquisition-review.stale-authority', `${path}.integrationPolicyDefinitionSha256`, 'must match current integration policy.')
  }
  if (sha256(withoutHash(authority)) !== authority.definitionSha256) {
    return fail('breeding.species-acquisition-review.stale-authority', `${path}.definitionSha256`, 'must hash the exact reviewed authority.')
  }
  return authority
}

export const createReviewedSpeciesAcquisitionAuthorityV1 = (
  value: Omit<ReviewedSpeciesAcquisitionAuthorityV1, 'schemaVersion' | 'integrationPolicyDefinitionSha256' | 'definitionSha256'>,
): ReviewedSpeciesAcquisitionAuthorityV1 => {
  const definition = {
    schemaVersion: 1 as const,
    ...value,
    integrationPolicyDefinitionSha256:
      BREEDING_SPECIES_ACQUISITION_INTEGRATION_POLICY_DEFINITION_SHA256,
  }
  return parseReviewedSpeciesAcquisitionAuthorityV1({
    ...definition,
    definitionSha256: sha256(definition),
  })
}

export interface SettleReviewedSpeciesAcquisitionOptions {
  readonly database?: RotomDatabase
  readonly sheetUpdatedAt: number
  readonly resolveCurrentReviewAuthority: (
    submitted: ReviewedSpeciesAcquisitionAuthorityV1,
  ) => unknown
}

export interface SettleReviewedSpeciesAcquisitionResultV1 {
  readonly settlement: RecordSpeciesAcquisitionResultV1
  readonly trainerSheet: PersistedSheet
}

/** Executes only a current, source-hash-bound server review; it is not a browser command. */
export const settleReviewedSpeciesAcquisition = (
  authorityValue: unknown,
  options: SettleReviewedSpeciesAcquisitionOptions,
): SettleReviewedSpeciesAcquisitionResultV1 => {
  const authority = parseReviewedSpeciesAcquisitionAuthorityV1(authorityValue)
  const database = options.database ?? getRotomDatabase()
  const clock = createSqliteCampaignClockRepository(database).get()
  if (clock.campaignMinute !== authority.campaignMinute) {
    return fail('breeding.species-acquisition-review.stale-authority', 'campaignMinute', 'must match the current campaign checkpoint.')
  }
  let currentValue: unknown
  try {
    currentValue = options.resolveCurrentReviewAuthority(authority)
  }
  catch {
    return fail('breeding.species-acquisition-review.stale-authority', 'reviewAuthority', 'current review resolution failed.')
  }
  const current = parseReviewedSpeciesAcquisitionAuthorityV1(currentValue, 'currentReviewAuthority')
  if (stableJsonStringify(current) !== stableJsonStringify(authority)) {
    return fail('breeding.species-acquisition-review.stale-authority', 'reviewAuthority', 'must equal current server review authority exactly.')
  }
  const evidence = createBreedingSpeciesAcquisitionSourceEvidenceV1({
    sourceKind: authority.sourceKind,
    sourceAuthorityKind: authority.sourceKind === 'migration'
      ? 'reviewed-migration'
      : 'gm-reviewed',
    sourceEventId: `review:${sha256({
      sourceKind: authority.sourceKind,
      reviewId: authority.reviewId,
    }).slice(0, 32)}`,
    sourceAuthorityDefinitionSha256: authority.definitionSha256,
    trainerSheetSlug: authority.trainerSheetSlug,
    trainerRevisionBeforeReward: authority.trainerRevisionBeforeReward,
    speciesId: authority.speciesId,
    pokemonSheetSlug: null,
    pokemonSheetRevision: null,
    campaignMinute: authority.campaignMinute,
  })
  const settlement = recordSpeciesAcquisition({ sourceEvidence: evidence }, {
    database,
    sheetUpdatedAt: options.sheetUpdatedAt,
    validateCurrentSourceAuthority: (submitted: BreedingSpeciesAcquisitionSourceEvidenceV1) => {
      const rebuilt = parseReviewedSpeciesAcquisitionAuthorityV1(
        options.resolveCurrentReviewAuthority(authority),
        'currentReviewAuthority',
      )
      if (stableJsonStringify(rebuilt) !== stableJsonStringify(authority)
        || submitted.definitionSha256 !== evidence.definitionSha256
        || submitted.sourceAuthorityDefinitionSha256 !== authority.definitionSha256) {
        throw new Error('Reviewed source authority changed.')
      }
      return true
    },
  })
  return Object.freeze({ settlement, trainerSheet: settlement.trainerSheet })
}
