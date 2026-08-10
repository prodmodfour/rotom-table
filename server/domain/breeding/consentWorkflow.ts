import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_CONSENT_WORKFLOW_SECURITY_POLICY_DEFINITION_SHA256,
  parseBreedingConsentWorkflowProjectionV1,
  type BreedingConsentWorkflowProjectionV1,
} from '#shared/breeding/consentWorkflow'

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

export const breedingConsentWorkflowProjectionDefinitionSha256 = (
  value: BreedingConsentWorkflowProjectionV1,
): string => {
  const { projectionDefinitionSha256: _projectionDefinitionSha256, ...definition } = value
  return sha256(definition)
}

export const parseAuthoritativeBreedingConsentWorkflowProjectionV1 = (
  value: unknown,
): BreedingConsentWorkflowProjectionV1 => {
  const projection = parseBreedingConsentWorkflowProjectionV1(value)
  if (breedingConsentWorkflowProjectionDefinitionSha256(projection) !== projection.projectionDefinitionSha256) {
    throw new Error('Breeding consent workflow projection hash does not match current authority.')
  }
  return projection
}

export const createBreedingConsentWorkflowProjectionV1 = (
  value: Omit<BreedingConsentWorkflowProjectionV1, 'schemaVersion' | 'securityPolicyDefinitionSha256' | 'projectionDefinitionSha256'>,
): BreedingConsentWorkflowProjectionV1 => {
  const definition = {
    schemaVersion: 1 as const,
    ...value,
    securityPolicyDefinitionSha256: BREEDING_CONSENT_WORKFLOW_SECURITY_POLICY_DEFINITION_SHA256,
  }
  return parseAuthoritativeBreedingConsentWorkflowProjectionV1({
    ...definition,
    projectionDefinitionSha256: sha256(definition),
  })
}
