import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_PROJECT_CHOICES_API_PATH,
  BREEDING_PROJECT_CHOICES_SECURITY_POLICY_DEFINITION_SHA256,
  parseBreedingProjectChoicesProjectionV1,
  type BreedingProjectChoicesProjectionV1,
} from '#shared/breeding/projectChoices'
import { parseAuthoritativeBreedingProjectGuidanceProjectionV1 } from './projectGuidance'

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

export const BREEDING_PROJECT_CHOICES_PRESENTATION_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-project-choices-presentation-v1' as const,
  apiPath: BREEDING_PROJECT_CHOICES_API_PATH,
  authority: 'current-server-rebuild' as const,
  clientMechanicsAuthority: 'none' as const,
  selectorAuthority: 'opaque-server-issued-option-ids-only' as const,
  traitChoices: Object.freeze({
    nature: Object.freeze({ requiredRank: 'Adept' as const, checkpoint: 'egg-production' as const }),
    ability: Object.freeze({ requiredRank: 'Expert' as const, checkpoint: 'egg-production' as const }),
    gender: Object.freeze({ requiredRank: 'Master' as const, checkpoint: 'egg-production' as const }),
  }),
  campaignOptions: 'current-snapshot-safe-labels' as const,
  confirmation: 'explicit-and-current-before-mutation' as const,
  privacy: 'no-provider-evidence-read-set-roll-or-private-cross-owner-mechanics' as const,
})
export const BREEDING_PROJECT_CHOICES_PRESENTATION_POLICY_DEFINITION_SHA256 = sha256(
  BREEDING_PROJECT_CHOICES_PRESENTATION_POLICY_DEFINITION,
)

export class BreedingProjectChoicesProjectionAuthorityError extends Error {
  readonly code:
    | 'breeding.project-choices.hash-mismatch'
    | 'breeding.project-choices.invalid-definition'
    | 'breeding.project-choices.security-policy-mismatch'
  constructor(code: BreedingProjectChoicesProjectionAuthorityError['code'], message: string) {
    super(message)
    this.name = 'BreedingProjectChoicesProjectionAuthorityError'
    this.code = code
  }
}

const withoutHash = (
  value: BreedingProjectChoicesProjectionV1,
): Omit<BreedingProjectChoicesProjectionV1, 'projectionDefinitionSha256'> => {
  const { projectionDefinitionSha256: _hash, ...definition } = value
  return definition
}

export const parseAuthoritativeBreedingProjectChoicesProjectionV1 = (
  value: unknown,
  path = 'projectChoices',
): BreedingProjectChoicesProjectionV1 => {
  const projection = parseBreedingProjectChoicesProjectionV1(value, path)
  parseAuthoritativeBreedingProjectGuidanceProjectionV1(projection.guidance, `${path}.guidance`)
  if (projection.securityPolicyDefinitionSha256
    !== BREEDING_PROJECT_CHOICES_SECURITY_POLICY_DEFINITION_SHA256) {
    throw new BreedingProjectChoicesProjectionAuthorityError(
      'breeding.project-choices.security-policy-mismatch',
      'Breeding Project choices do not use the current security policy.',
    )
  }
  if (sha256(withoutHash(projection)) !== projection.projectionDefinitionSha256) {
    throw new BreedingProjectChoicesProjectionAuthorityError(
      'breeding.project-choices.hash-mismatch',
      'Breeding Project choice hash does not match its exact audience definition.',
    )
  }
  return projection
}

export const createBreedingProjectChoicesProjectionV1 = (
  value: Omit<
    BreedingProjectChoicesProjectionV1,
    'schemaVersion' | 'securityPolicyDefinitionSha256' | 'projectionDefinitionSha256'
  >,
): BreedingProjectChoicesProjectionV1 => {
  const expected = [
    'guidance', 'skillChoice', 'traitChoices', 'campaignSettings', 'maturityChoices',
    'parentRoleChoice', 'confirmation',
  ].sort()
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0) {
    throw new BreedingProjectChoicesProjectionAuthorityError(
      'breeding.project-choices.invalid-definition',
      'Breeding Project choice definition must be one exact plain object.',
    )
  }
  const fields = Object.getOwnPropertyNames(value)
  if (fields.length !== expected.length
    || [...fields].sort().some((field, index) => field !== expected[index])
    || fields.some((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return descriptor?.enumerable !== true || !('value' in descriptor)
    })) {
    throw new BreedingProjectChoicesProjectionAuthorityError(
      'breeding.project-choices.invalid-definition',
      'Breeding Project choice definition must contain exactly the declared fields.',
    )
  }
  const candidate = parseBreedingProjectChoicesProjectionV1({
    schemaVersion: 1,
    ...value,
    securityPolicyDefinitionSha256: BREEDING_PROJECT_CHOICES_SECURITY_POLICY_DEFINITION_SHA256,
    projectionDefinitionSha256: '0'.repeat(64),
  })
  const definition = withoutHash(candidate)
  return parseAuthoritativeBreedingProjectChoicesProjectionV1({
    ...definition,
    projectionDefinitionSha256: sha256(definition),
  })
}
