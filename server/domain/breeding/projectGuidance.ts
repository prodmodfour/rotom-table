import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_PROJECT_GUIDANCE_API_PATH,
  BREEDING_PROJECT_GUIDANCE_SECURITY_POLICY_DEFINITION_SHA256,
  parseBreedingProjectGuidanceProjectionV1,
  type BreedingProjectGuidanceProjectionV1,
} from '#shared/breeding/projectGuidance'
import { parseAuthoritativeBreedingProjectWizardProjectionV1 } from './projectWizard'

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

export const BREEDING_PROJECT_GUIDANCE_PRESENTATION_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-project-guidance-presentation-v1' as const,
  apiPath: BREEDING_PROJECT_GUIDANCE_API_PATH,
  authority: 'server-projected-current-campaign' as const,
  clientMechanicsAuthority: 'none' as const,
  reasonCatalog: 'closed-app-owned-presentation-catalog' as const,
  sourceContributions: 'current-Breeder-and-Dilettante-status-only' as const,
  gmDiagnostics: 'bounded-current-summary-without-authority-identities-or-hashes' as const,
  crossOwnerPrivateMechanics: 'not-evaluated-before-consent' as const,
})
export const BREEDING_PROJECT_GUIDANCE_PRESENTATION_POLICY_DEFINITION_SHA256 = sha256(
  BREEDING_PROJECT_GUIDANCE_PRESENTATION_POLICY_DEFINITION,
)

export class BreedingProjectGuidanceProjectionAuthorityError extends Error {
  readonly code:
    | 'breeding.project-guidance.hash-mismatch'
    | 'breeding.project-guidance.invalid-definition'
    | 'breeding.project-guidance.security-policy-mismatch'
  constructor(code: BreedingProjectGuidanceProjectionAuthorityError['code'], message: string) {
    super(message)
    this.name = 'BreedingProjectGuidanceProjectionAuthorityError'
    this.code = code
  }
}
const withoutHash = (
  value: BreedingProjectGuidanceProjectionV1,
): Omit<BreedingProjectGuidanceProjectionV1, 'projectionDefinitionSha256'> => {
  const { projectionDefinitionSha256: _hash, ...definition } = value
  return definition
}
export const parseAuthoritativeBreedingProjectGuidanceProjectionV1 = (
  value: unknown,
  path = 'projectGuidance',
): BreedingProjectGuidanceProjectionV1 => {
  const projection = parseBreedingProjectGuidanceProjectionV1(value, path)
  parseAuthoritativeBreedingProjectWizardProjectionV1(projection.wizard, `${path}.wizard`)
  if (projection.securityPolicyDefinitionSha256
    !== BREEDING_PROJECT_GUIDANCE_SECURITY_POLICY_DEFINITION_SHA256) {
    throw new BreedingProjectGuidanceProjectionAuthorityError(
      'breeding.project-guidance.security-policy-mismatch',
      'Breeding Project guidance does not use the current security policy.',
    )
  }
  if (sha256(withoutHash(projection)) !== projection.projectionDefinitionSha256) {
    throw new BreedingProjectGuidanceProjectionAuthorityError(
      'breeding.project-guidance.hash-mismatch',
      'Breeding Project guidance hash does not match its exact audience definition.',
    )
  }
  return projection
}
export const createBreedingProjectGuidanceProjectionV1 = (
  value: Omit<
    BreedingProjectGuidanceProjectionV1,
    'schemaVersion' | 'securityPolicyDefinitionSha256' | 'projectionDefinitionSha256'
  >,
): BreedingProjectGuidanceProjectionV1 => {
  const fields = [
    'wizard',
    'applicableReasonIds',
    'sourceContributions',
    'gmDiagnostics',
  ].sort()
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
    || Object.keys(value).sort().some((field, index) => field !== fields[index])
    || Object.keys(value).length !== fields.length
    || Object.getOwnPropertyNames(value).some((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return !descriptor?.enumerable || !('value' in descriptor)
    })) {
    throw new BreedingProjectGuidanceProjectionAuthorityError(
      'breeding.project-guidance.invalid-definition',
      'Breeding Project guidance definition must be one exact plain data object.',
    )
  }
  const candidate = parseBreedingProjectGuidanceProjectionV1({
    schemaVersion: 1,
    wizard: value.wizard,
    applicableReasonIds: value.applicableReasonIds,
    sourceContributions: value.sourceContributions,
    gmDiagnostics: value.gmDiagnostics,
    securityPolicyDefinitionSha256: BREEDING_PROJECT_GUIDANCE_SECURITY_POLICY_DEFINITION_SHA256,
    projectionDefinitionSha256: '0'.repeat(64),
  })
  const definition = withoutHash(candidate)
  return parseAuthoritativeBreedingProjectGuidanceProjectionV1({
    ...definition,
    projectionDefinitionSha256: sha256(definition),
  })
}
