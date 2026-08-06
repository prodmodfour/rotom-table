import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../automation/stableJson'
import { cloneStrictJson, deepFreezeStrictJson, type StrictJsonObject } from '../automation/strictJson'
import { isSlug } from '../paths'
import { isPlayerProfileId, type PlayerProfileId } from '../playerProfiles'
import { computeRulesetSourceSha256 } from '../ruleset/sourceHash'
import {
  parseBreedingParentDiscoveryProjectionV1,
  parseBreedingParentSelectionV1,
  type BreedingParentDiscoveryProjectionV1,
  type BreedingParentSelectionRefV1,
} from './parentDiscovery'

export const BREEDING_PROJECT_WIZARD_API_PATH = '/api/breeding/projects/wizard' as const
export const BREEDING_PROJECT_WIZARD_INITIAL_MINUTES = 240 as const
export const BREEDING_PROJECT_WIZARD_CHECK_DC = 12 as const
export const BREEDING_PROJECT_WIZARD_ADDITIONAL_MINUTES = 240 as const

export interface BreedingProjectWizardRequestV1 {
  readonly schemaVersion: 1
  readonly profileId: PlayerProfileId | null
  readonly destinationTrainerSlug: string
  readonly breederTrainerSlug: string
  readonly parentRefs: readonly BreedingParentSelectionRefV1[]
}

export interface BreedingProjectWizardTrainerContextV1 {
  readonly trainerSheetSlug: string
  readonly trainerRevision: number
  readonly displayName: string
}

export interface BreedingProjectWizardTimelineV1 {
  readonly timeAuthority: 'campaign-clock'
  readonly initialCampaignMinutes: 240
  readonly breederCheckDifficultyClass: 12
  readonly additionalCampaignMinutes: 240
  readonly minimumCampaignMinutesBeforeEgg: 480
}

export type BreedingProjectWizardConsentStatus =
  | 'selection-incomplete'
  | 'not-required'
  | 'review-required'
export type BreedingProjectWizardReviewStatus =
  | 'selection-incomplete'
  | 'pair-unavailable'
  | 'requires-final-validation'

export interface BreedingProjectWizardProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm' | 'owner'
  readonly generatedAtCampaignMinute: number
  readonly destination: BreedingProjectWizardTrainerContextV1
  readonly breeder: BreedingProjectWizardTrainerContextV1
  readonly parentDiscovery: BreedingParentDiscoveryProjectionV1
  readonly timeline: BreedingProjectWizardTimelineV1
  readonly consentStatus: BreedingProjectWizardConsentStatus
  readonly reviewStatus: BreedingProjectWizardReviewStatus
  readonly securityPolicyDefinitionSha256: string
  readonly projectionDefinitionSha256: string
}

export class BreedingProjectWizardContractError extends Error {
  readonly code:
    | 'breeding.project-wizard.invalid-document'
    | 'breeding.project-wizard.invalid-id'
    | 'breeding.project-wizard.invalid-invariant'
  readonly path: string

  constructor(code: BreedingProjectWizardContractError['code'], path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingProjectWizardContractError'
    this.code = code
    this.path = path
  }
}

export class BreedingProjectWizardVerificationError extends Error {
  readonly code:
    | 'breeding.project-wizard.hash-mismatch'
    | 'breeding.project-wizard.security-policy-mismatch'
    | 'breeding.project-wizard.hash-unavailable'

  constructor(code: BreedingProjectWizardVerificationError['code'], message: string) {
    super(message)
    this.name = 'BreedingProjectWizardVerificationError'
    this.code = code
  }
}

const SHA256 = /^[0-9a-f]{64}$/u
const CONTROL = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u
const fail = (
  code: BreedingProjectWizardContractError['code'],
  path: string,
  message: string,
): never => { throw new BreedingProjectWizardContractError(code, path, message) }
const record = (value: unknown, fields: readonly string[], path: string): StrictJsonObject => {
  const cloned = cloneStrictJson(value, path, {
    limits: {
      depth: 4,
      nodes: 64,
      objectFields: 12,
      arrayEntries: 2,
      stringLength: 200,
      objectKeyLength: 80,
    },
    rootLabel: path,
    valueLabel: 'Breeding Project wizard value',
    failNotJson: (field, detail) => fail('breeding.project-wizard.invalid-document', field, detail),
    failLimit: (field, detail) => fail('breeding.project-wizard.invalid-document', field, detail),
  })
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) {
    return fail('breeding.project-wizard.invalid-document', path, 'must be one plain object.')
  }
  const row = cloned as StrictJsonObject
  const actual = Object.keys(row).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])) {
    return fail('breeding.project-wizard.invalid-document', path, 'must contain exactly the declared fields.')
  }
  return row
}
const shallowExact = (value: unknown, fields: readonly string[], path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('breeding.project-wizard.invalid-document', path, 'must be one plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.project-wizard.invalid-document', path, 'must be plain data without symbols.')
  }
  for (const field of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('breeding.project-wizard.invalid-document', `${path}.${field}`, 'must be an enumerable data field.')
    }
  }
  const row = value as Record<string, unknown>
  const actual = Object.keys(row).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])) {
    return fail('breeding.project-wizard.invalid-document', path, 'must contain exactly the declared fields.')
  }
  return row
}
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160
  ? value
  : fail('breeding.project-wizard.invalid-id', path, 'must be a bounded Trainer slug.')
const integer = (value: unknown, path: string): number => Number.isSafeInteger(value) && Number(value) >= 0
  ? Number(value)
  : fail('breeding.project-wizard.invalid-document', path, 'must be a safe nonnegative integer.')
const text = (value: unknown, path: string): string => typeof value === 'string'
  && value.length > 0 && Array.from(value).length <= 120
  && value.trim() === value && value.normalize('NFKC') === value && !CONTROL.test(value)
  ? value
  : fail('breeding.project-wizard.invalid-document', path, 'must be bounded safe normalized display text.')
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.project-wizard.invalid-document', path, 'must be a lowercase SHA-256 digest.')

export const BREEDING_PROJECT_WIZARD_SECURITY_POLICY_DEFINITION_SHA256 = hash(
  securityPolicyJson.definitionSha256,
  'securityPolicy.definitionSha256',
)

export const parseBreedingProjectWizardRequestV1 = (
  value: unknown,
  path = 'projectWizardRequest',
): BreedingProjectWizardRequestV1 => {
  const row = record(value, [
    'schemaVersion',
    'profileId',
    'destinationTrainerSlug',
    'breederTrainerSlug',
    'parentRefs',
  ], path)
  if (row.schemaVersion !== 1) {
    return fail('breeding.project-wizard.invalid-document', `${path}.schemaVersion`, 'must equal 1.')
  }
  const selection = parseBreedingParentSelectionV1({
    schemaVersion: 1,
    parentRefs: row.parentRefs,
  }, `${path}.parentSelection`)
  return deepFreezeStrictJson({
    schemaVersion: 1,
    profileId: row.profileId === null
      ? null
      : isPlayerProfileId(row.profileId)
        ? row.profileId
        : fail('breeding.project-wizard.invalid-id', `${path}.profileId`, 'must be a Player Profile ID or null.'),
    destinationTrainerSlug: slug(row.destinationTrainerSlug, `${path}.destinationTrainerSlug`),
    breederTrainerSlug: slug(row.breederTrainerSlug, `${path}.breederTrainerSlug`),
    parentRefs: selection.parentRefs,
  }) as BreedingProjectWizardRequestV1
}

const parseTrainerContext = (
  value: unknown,
  path: string,
): BreedingProjectWizardTrainerContextV1 => {
  const row = shallowExact(value, ['trainerSheetSlug', 'trainerRevision', 'displayName'], path)
  return deepFreezeStrictJson({
    trainerSheetSlug: slug(row.trainerSheetSlug, `${path}.trainerSheetSlug`),
    trainerRevision: integer(row.trainerRevision, `${path}.trainerRevision`),
    displayName: text(row.displayName, `${path}.displayName`),
  }) as BreedingProjectWizardTrainerContextV1
}

const parseTimeline = (value: unknown, path: string): BreedingProjectWizardTimelineV1 => {
  const row = shallowExact(value, [
    'timeAuthority',
    'initialCampaignMinutes',
    'breederCheckDifficultyClass',
    'additionalCampaignMinutes',
    'minimumCampaignMinutesBeforeEgg',
  ], path)
  if (row.timeAuthority !== 'campaign-clock'
    || row.initialCampaignMinutes !== BREEDING_PROJECT_WIZARD_INITIAL_MINUTES
    || row.breederCheckDifficultyClass !== BREEDING_PROJECT_WIZARD_CHECK_DC
    || row.additionalCampaignMinutes !== BREEDING_PROJECT_WIZARD_ADDITIONAL_MINUTES
    || row.minimumCampaignMinutesBeforeEgg
      !== BREEDING_PROJECT_WIZARD_INITIAL_MINUTES + BREEDING_PROJECT_WIZARD_ADDITIONAL_MINUTES) {
    return fail('breeding.project-wizard.invalid-invariant', path, 'must use the exact reviewed Project timeline.')
  }
  return deepFreezeStrictJson({
    timeAuthority: 'campaign-clock',
    initialCampaignMinutes: BREEDING_PROJECT_WIZARD_INITIAL_MINUTES,
    breederCheckDifficultyClass: BREEDING_PROJECT_WIZARD_CHECK_DC,
    additionalCampaignMinutes: BREEDING_PROJECT_WIZARD_ADDITIONAL_MINUTES,
    minimumCampaignMinutesBeforeEgg: BREEDING_PROJECT_WIZARD_INITIAL_MINUTES
      + BREEDING_PROJECT_WIZARD_ADDITIONAL_MINUTES,
  }) as BreedingProjectWizardTimelineV1
}

export const parseBreedingProjectWizardProjectionV1 = (
  value: unknown,
  path = 'projectWizard',
): BreedingProjectWizardProjectionV1 => {
  const row = shallowExact(value, [
    'schemaVersion',
    'audience',
    'generatedAtCampaignMinute',
    'destination',
    'breeder',
    'parentDiscovery',
    'timeline',
    'consentStatus',
    'reviewStatus',
    'securityPolicyDefinitionSha256',
    'projectionDefinitionSha256',
  ], path)
  if (row.schemaVersion !== 1 || (row.audience !== 'gm' && row.audience !== 'owner')) {
    return fail('breeding.project-wizard.invalid-document', path, 'must be a v1 owner or GM wizard projection.')
  }
  const generatedAtCampaignMinute = integer(
    row.generatedAtCampaignMinute,
    `${path}.generatedAtCampaignMinute`,
  )
  const destination = parseTrainerContext(row.destination, `${path}.destination`)
  const breeder = parseTrainerContext(row.breeder, `${path}.breeder`)
  const parentDiscovery = parseBreedingParentDiscoveryProjectionV1(
    row.parentDiscovery,
    `${path}.parentDiscovery`,
  )
  const timeline = parseTimeline(row.timeline, `${path}.timeline`)
  if (parentDiscovery.audience !== row.audience
    || parentDiscovery.generatedAtCampaignMinute !== generatedAtCampaignMinute) {
    return fail('breeding.project-wizard.invalid-invariant', `${path}.parentDiscovery`, 'must match the wizard audience and campaign checkpoint.')
  }
  const selected = parentDiscovery.selectedParentRefs
  const selectedCandidates = new Map(parentDiscovery.trainerSheets
    .flatMap(trainer => trainer.candidates)
    .map(candidate => [candidate.parentSheetSlug, candidate] as const))
  const expectedConsent: BreedingProjectWizardConsentStatus = selected.length !== 2
    ? 'selection-incomplete'
    : selected.some(ref => selectedCandidates.get(ref.pokemonSheetSlug)?.ownerTrainerSlug
      !== destination.trainerSheetSlug)
      ? 'review-required'
      : 'not-required'
  const expectedReview: BreedingProjectWizardReviewStatus = selected.length !== 2
    ? 'selection-incomplete'
    : parentDiscovery.compatibilityPreview?.status === 'requires-validation'
      ? 'requires-final-validation'
      : 'pair-unavailable'
  if (row.consentStatus !== expectedConsent || row.reviewStatus !== expectedReview) {
    return fail('breeding.project-wizard.invalid-invariant', path, 'selection, consent, and review statuses must agree exactly.')
  }
  return deepFreezeStrictJson({
    schemaVersion: 1,
    audience: row.audience,
    generatedAtCampaignMinute,
    destination,
    breeder,
    parentDiscovery,
    timeline,
    consentStatus: row.consentStatus,
    reviewStatus: row.reviewStatus,
    securityPolicyDefinitionSha256: hash(
      row.securityPolicyDefinitionSha256,
      `${path}.securityPolicyDefinitionSha256`,
    ),
    projectionDefinitionSha256: hash(
      row.projectionDefinitionSha256,
      `${path}.projectionDefinitionSha256`,
    ),
  }) as BreedingProjectWizardProjectionV1
}

export const verifyBreedingProjectWizardProjectionV1 = async (
  value: unknown,
  path = 'projectWizard',
): Promise<BreedingProjectWizardProjectionV1> => {
  const projection = parseBreedingProjectWizardProjectionV1(value, path)
  if (projection.securityPolicyDefinitionSha256
    !== BREEDING_PROJECT_WIZARD_SECURITY_POLICY_DEFINITION_SHA256) {
    throw new BreedingProjectWizardVerificationError(
      'breeding.project-wizard.security-policy-mismatch',
      'Breeding Project wizard projection does not use the current security policy.',
    )
  }
  const { projectionDefinitionSha256, ...definition } = projection
  let actual: string
  try {
    actual = await computeRulesetSourceSha256(stableJsonStringify(definition))
  }
  catch {
    throw new BreedingProjectWizardVerificationError(
      'breeding.project-wizard.hash-unavailable',
      'Breeding Project wizard projection verification is unavailable.',
    )
  }
  if (actual !== projectionDefinitionSha256) {
    throw new BreedingProjectWizardVerificationError(
      'breeding.project-wizard.hash-mismatch',
      'Breeding Project wizard projection hash does not match its exact audience definition.',
    )
  }
  return projection
}
