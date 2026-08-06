import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_PROJECT_WIZARD_ADDITIONAL_MINUTES,
  BREEDING_PROJECT_WIZARD_API_PATH,
  BREEDING_PROJECT_WIZARD_CHECK_DC,
  BREEDING_PROJECT_WIZARD_INITIAL_MINUTES,
  BREEDING_PROJECT_WIZARD_SECURITY_POLICY_DEFINITION_SHA256,
  parseBreedingProjectWizardProjectionV1,
  type BreedingProjectWizardProjectionV1,
} from '#shared/breeding/projectWizard'

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

export const BREEDING_PROJECT_WIZARD_PRESENTATION_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-project-wizard-presentation-v1' as const,
  apiPath: BREEDING_PROJECT_WIZARD_API_PATH,
  authority: 'server-projected-current-campaign' as const,
  clientMechanicsAuthority: 'none' as const,
  maximumSelectedParents: 2 as const,
  initialCampaignMinutes: BREEDING_PROJECT_WIZARD_INITIAL_MINUTES,
  checkDifficultyClass: BREEDING_PROJECT_WIZARD_CHECK_DC,
  additionalCampaignMinutes: BREEDING_PROJECT_WIZARD_ADDITIONAL_MINUTES,
  finalCreation: 'requires-later-current-server-validation-and-confirmation' as const,
})
export const BREEDING_PROJECT_WIZARD_PRESENTATION_POLICY_DEFINITION_SHA256 = sha256(
  BREEDING_PROJECT_WIZARD_PRESENTATION_POLICY_DEFINITION,
)

export class BreedingProjectWizardProjectionAuthorityError extends Error {
  readonly code:
    | 'breeding.project-wizard.invalid-definition'
    | 'breeding.project-wizard.hash-mismatch'
    | 'breeding.project-wizard.security-policy-mismatch'

  constructor(code: BreedingProjectWizardProjectionAuthorityError['code'], message: string) {
    super(message)
    this.name = 'BreedingProjectWizardProjectionAuthorityError'
    this.code = code
  }
}

const withoutHash = (
  value: BreedingProjectWizardProjectionV1,
): Omit<BreedingProjectWizardProjectionV1, 'projectionDefinitionSha256'> => {
  const { projectionDefinitionSha256: _hash, ...definition } = value
  return definition
}

export const parseAuthoritativeBreedingProjectWizardProjectionV1 = (
  value: unknown,
  path = 'projectWizard',
): BreedingProjectWizardProjectionV1 => {
  const projection = parseBreedingProjectWizardProjectionV1(value, path)
  if (projection.securityPolicyDefinitionSha256
    !== BREEDING_PROJECT_WIZARD_SECURITY_POLICY_DEFINITION_SHA256) {
    throw new BreedingProjectWizardProjectionAuthorityError(
      'breeding.project-wizard.security-policy-mismatch',
      'Breeding Project wizard projection does not use the current security policy.',
    )
  }
  if (sha256(withoutHash(projection)) !== projection.projectionDefinitionSha256) {
    throw new BreedingProjectWizardProjectionAuthorityError(
      'breeding.project-wizard.hash-mismatch',
      'Breeding Project wizard projection hash does not match its exact audience definition.',
    )
  }
  return projection
}

export const createBreedingProjectWizardProjectionV1 = (
  value: Omit<
    BreedingProjectWizardProjectionV1,
    'schemaVersion' | 'securityPolicyDefinitionSha256' | 'projectionDefinitionSha256'
  >,
): BreedingProjectWizardProjectionV1 => {
  const expected = [
    'audience',
    'generatedAtCampaignMinute',
    'destination',
    'breeder',
    'parentDiscovery',
    'timeline',
    'consentStatus',
    'reviewStatus',
  ].sort()
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0) {
    throw new BreedingProjectWizardProjectionAuthorityError(
      'breeding.project-wizard.invalid-definition',
      'Breeding Project wizard definition must be one exact plain data object.',
    )
  }
  const fields = Object.getOwnPropertyNames(value)
  if (fields.length !== expected.length
    || fields.sort().some((field, index) => field !== expected[index])
    || fields.some((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return descriptor?.enumerable !== true || !('value' in descriptor)
    })) {
    throw new BreedingProjectWizardProjectionAuthorityError(
      'breeding.project-wizard.invalid-definition',
      'Breeding Project wizard definition must contain exactly the declared data fields.',
    )
  }
  const candidate = parseBreedingProjectWizardProjectionV1({
    schemaVersion: 1,
    audience: value.audience,
    generatedAtCampaignMinute: value.generatedAtCampaignMinute,
    destination: value.destination,
    breeder: value.breeder,
    parentDiscovery: value.parentDiscovery,
    timeline: value.timeline,
    consentStatus: value.consentStatus,
    reviewStatus: value.reviewStatus,
    securityPolicyDefinitionSha256: BREEDING_PROJECT_WIZARD_SECURITY_POLICY_DEFINITION_SHA256,
    projectionDefinitionSha256: '0'.repeat(64),
  })
  const definition = withoutHash(candidate)
  return parseAuthoritativeBreedingProjectWizardProjectionV1({
    ...definition,
    projectionDefinitionSha256: sha256(definition),
  })
}
