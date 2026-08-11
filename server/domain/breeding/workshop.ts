import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  breedingPerformanceOutputFitsBudget,
} from '#shared/breeding/performanceBudgets'
import {
  BREEDING_WORKSHOP_API_PATH,
  BREEDING_WORKSHOP_CONTEXT_PAGE_LIMIT,
  BREEDING_WORKSHOP_PATH,
  BREEDING_WORKSHOP_SECURITY_POLICY_DEFINITION_SHA256,
  parseBreedingWorkshopProjectionV1,
  type BreedingWorkshopProjectionV1,
} from '#shared/breeding/workshop'

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

export const BREEDING_WORKSHOP_PRESENTATION_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-workshop-presentation-v1' as const,
  routePath: BREEDING_WORKSHOP_PATH,
  apiPath: BREEDING_WORKSHOP_API_PATH,
  pageLimit: BREEDING_WORKSHOP_CONTEXT_PAGE_LIMIT,
  audienceProjection: 'server-only' as const,
  ownerAuthority: 'selected-player-profile-linked-trainers-only' as const,
  gmAuthority: 'authenticated-campaign-trainers' as const,
  localAuthority: 'none' as const,
  mapEncounterDependency: 'none' as const,
  activityPayload: 'boolean-summary-only' as const,
  clientPersistence: 'presentation-preferences-only' as const,
})
export const BREEDING_WORKSHOP_PRESENTATION_POLICY_DEFINITION_SHA256 = sha256(
  BREEDING_WORKSHOP_PRESENTATION_POLICY_DEFINITION,
)

export class BreedingWorkshopProjectionAuthorityError extends Error {
  readonly code:
    | 'breeding.workshop.hash-mismatch'
    | 'breeding.workshop.security-policy-mismatch'
    | 'breeding.workshop.invalid-definition'

  constructor(code: BreedingWorkshopProjectionAuthorityError['code'], message: string) {
    super(message)
    this.name = 'BreedingWorkshopProjectionAuthorityError'
    this.code = code
  }
}

const withoutProjectionHash = (
  value: BreedingWorkshopProjectionV1,
): Omit<BreedingWorkshopProjectionV1, 'projectionDefinitionSha256'> => {
  const { projectionDefinitionSha256: _projectionDefinitionSha256, ...definition } = value
  return definition
}

export const parseAuthoritativeBreedingWorkshopProjectionV1 = (
  value: unknown,
  path = 'workshop',
): BreedingWorkshopProjectionV1 => {
  const projection = parseBreedingWorkshopProjectionV1(value, path)
  if (!breedingPerformanceOutputFitsBudget('workshop', projection)) {
    throw new BreedingWorkshopProjectionAuthorityError(
      'breeding.workshop.invalid-definition',
      'Breeding Workshop projection exceeds the release byte budget.',
    )
  }
  if (projection.securityPolicyDefinitionSha256 !== BREEDING_WORKSHOP_SECURITY_POLICY_DEFINITION_SHA256) {
    throw new BreedingWorkshopProjectionAuthorityError(
      'breeding.workshop.security-policy-mismatch',
      'Breeding Workshop projection does not use the current security policy.',
    )
  }
  if (sha256(withoutProjectionHash(projection)) !== projection.projectionDefinitionSha256) {
    throw new BreedingWorkshopProjectionAuthorityError(
      'breeding.workshop.hash-mismatch',
      'Breeding Workshop projection hash does not match its exact audience definition.',
    )
  }
  return projection
}

export const createBreedingWorkshopProjectionV1 = (
  value: Omit<
    BreedingWorkshopProjectionV1,
    'schemaVersion' | 'securityPolicyDefinitionSha256' | 'projectionDefinitionSha256'
  >,
): BreedingWorkshopProjectionV1 => {
  const expectedFields = [
    'audience',
    'generatedAtCampaignMinute',
    'profileSelectionRequired',
    'ownershipCursor',
    'nextOwnershipCursor',
    'ownershipContexts',
    'selectedOwnershipContext',
    'emptyState',
  ].sort()
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).sort().some((field, index) => field !== expectedFields[index])
    || Object.getOwnPropertyNames(value).length !== expectedFields.length
    || Object.getOwnPropertyNames(value).some((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return descriptor?.enumerable !== true || !('value' in descriptor)
    })) {
    throw new BreedingWorkshopProjectionAuthorityError(
      'breeding.workshop.invalid-definition',
      'Breeding Workshop projection definition must be one exact plain data object.',
    )
  }
  const candidate = parseBreedingWorkshopProjectionV1({
    schemaVersion: 1,
    audience: value.audience,
    generatedAtCampaignMinute: value.generatedAtCampaignMinute,
    profileSelectionRequired: value.profileSelectionRequired,
    ownershipCursor: value.ownershipCursor,
    nextOwnershipCursor: value.nextOwnershipCursor,
    ownershipContexts: value.ownershipContexts,
    selectedOwnershipContext: value.selectedOwnershipContext,
    emptyState: value.emptyState,
    securityPolicyDefinitionSha256: BREEDING_WORKSHOP_SECURITY_POLICY_DEFINITION_SHA256,
    projectionDefinitionSha256: '0'.repeat(64),
  })
  const definition = withoutProjectionHash(candidate)
  return parseAuthoritativeBreedingWorkshopProjectionV1({
    ...definition,
    projectionDefinitionSha256: sha256(definition),
  })
}
