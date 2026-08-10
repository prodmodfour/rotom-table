import { createHash } from 'node:crypto'
import securityPolicyJson from '../../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_HATCH_WORKFLOW_API_PATH,
  BREEDING_HATCH_WORKFLOW_SECURITY_POLICY_DEFINITION_SHA256,
  parseBreedingHatchWorkflowProjectionV1,
  type BreedingHatchWorkflowProjectionV1,
} from '#shared/breeding/hatchWorkflow'

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

export const BREEDING_HATCH_WORKFLOW_PRESENTATION_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-hatch-workflow-presentation-v1' as const,
  apiPath: BREEDING_HATCH_WORKFLOW_API_PATH,
  requestAuthority: 'selectors-opaque-option-and-explicit-confirmation-only' as const,
  actorAuthority: 'current-authenticated-role-Profile-and-owner-Trainer' as const,
  lifecycleAuthority: 'existing-hatch-offer-special-and-completion-transactions' as const,
  randomAuthority: 'persist-before-application-and-never-redraw-on-retry' as const,
  ownerSpecialPrivacy: 'state-only-without-roll-trigger-option-or-adjudication-evidence' as const,
  gmSpecialPrivacy: 'bounded-current-roll-trigger-and-three-opaque-options' as const,
  pendingOperations: 'system-recovery-not-game-decision' as const,
  childReveal: 'accepted-Egg-child-sheet-and-destination-facts-only' as const,
  exactRetry: 'publication-silent-current-authority-replay' as const,
  browserMechanicsAuthority: 'none' as const,
})
export const BREEDING_HATCH_WORKFLOW_PRESENTATION_POLICY_DEFINITION_SHA256 = sha256(
  BREEDING_HATCH_WORKFLOW_PRESENTATION_POLICY_DEFINITION,
)

export class BreedingHatchWorkflowProjectionAuthorityError extends Error {
  readonly code:
    | 'breeding.hatch-workflow.hash-mismatch'
    | 'breeding.hatch-workflow.invalid-definition'
  constructor(code: BreedingHatchWorkflowProjectionAuthorityError['code'], message: string) {
    super(message)
    this.name = 'BreedingHatchWorkflowProjectionAuthorityError'
    this.code = code
  }
}
const withoutHash = (
  value: BreedingHatchWorkflowProjectionV1,
): Omit<BreedingHatchWorkflowProjectionV1, 'projectionDefinitionSha256'> => {
  const { projectionDefinitionSha256: _hash, ...definition } = value
  return definition
}
export const parseAuthoritativeBreedingHatchWorkflowProjectionV1 = (
  value: unknown,
  path = 'hatchWorkflow',
): BreedingHatchWorkflowProjectionV1 => {
  const projection = parseBreedingHatchWorkflowProjectionV1(value, path)
  if (projection.securityPolicyDefinitionSha256 !== BREEDING_HATCH_WORKFLOW_SECURITY_POLICY_DEFINITION_SHA256
    || projection.securityPolicyDefinitionSha256 !== securityPolicyJson.definitionSha256) {
    throw new BreedingHatchWorkflowProjectionAuthorityError(
      'breeding.hatch-workflow.invalid-definition',
      'Hatch workflow does not use the current security policy.',
    )
  }
  if (sha256(withoutHash(projection)) !== projection.projectionDefinitionSha256) {
    throw new BreedingHatchWorkflowProjectionAuthorityError(
      'breeding.hatch-workflow.hash-mismatch',
      'Hatch workflow hash does not match its exact audience definition.',
    )
  }
  return projection
}
export const createBreedingHatchWorkflowProjectionV1 = (
  value: Omit<BreedingHatchWorkflowProjectionV1, 'schemaVersion' | 'securityPolicyDefinitionSha256' | 'projectionDefinitionSha256'>,
): BreedingHatchWorkflowProjectionV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0) {
    throw new BreedingHatchWorkflowProjectionAuthorityError(
      'breeding.hatch-workflow.invalid-definition',
      'Hatch workflow definition must be one exact plain object.',
    )
  }
  const expected = [
    'audience', 'trainerSheetSlug', 'stage', 'egg', 'decision', 'special', 'childReveal',
    'recovery', 'transition', 'generatedAtCampaignMinute',
  ].sort()
  const fields = Object.getOwnPropertyNames(value)
  if (fields.length !== expected.length
    || [...fields].sort().some((field, index) => field !== expected[index])
    || fields.some((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return descriptor?.enumerable !== true || !('value' in descriptor)
    })) {
    throw new BreedingHatchWorkflowProjectionAuthorityError(
      'breeding.hatch-workflow.invalid-definition',
      'Hatch workflow definition must contain exactly the declared fields.',
    )
  }
  const definition = {
    schemaVersion: 1 as const,
    ...value,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  }
  return parseAuthoritativeBreedingHatchWorkflowProjectionV1({
    ...definition,
    projectionDefinitionSha256: sha256(definition),
  })
}
