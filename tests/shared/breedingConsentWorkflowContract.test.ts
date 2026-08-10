import { createHash } from 'node:crypto'
import contractJson from '../../data/breeding-automation/consent-workflow-presentation-contract.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { describe, expect, it } from 'vitest'
import {
  BREEDING_CONSENT_WORKFLOW_SECURITY_POLICY_DEFINITION_SHA256,
  parseBreedingConsentWorkflowRequestV1,
  verifyBreedingConsentWorkflowProjectionV1,
} from '../../shared/breeding/consentWorkflow'
import { createBreedingConsentWorkflowProjectionV1 } from '../../server/domain/breeding/consentWorkflow'

const request = () => ({
  schemaVersion: 1,
  profileId: 'profile_owner_0001',
  trainerSheetSlug: 'trainer-owner',
  intent: 'view',
  projectId: null,
  expectedProjectRevision: null,
  parentSheetSlug: null,
  consentId: null,
  eggId: null,
  expectedEggRevision: null,
  destinationTrainerSlug: null,
  transferConsentId: null,
  confirmed: false,
})

const projection = () => createBreedingConsentWorkflowProjectionV1({
  audience: 'player',
  context: { trainerSheetSlug: 'trainer-owner', trainerRevision: 2, displayName: 'Owner' },
  generatedAtCampaignMinute: 100,
  notifications: { projectRequests: 1, transferInvitations: 0, readyTransfers: 0, total: 1 },
  projectRequestsTruncated: false,
  eggTransfersTruncated: false,
  projectRequests: [{
    projectId: 'breeding-project:v1:11111111111111111111111111111111' as any,
    projectRevision: 0,
    coarseStatus: 'awaiting-consent',
    ownParent: { pokemonSheetSlug: 'pokemon-parent', expectedSheetRevision: 3, displayName: 'Leaf', current: true },
    breederDisplayName: 'Breeder',
    consent: {
      consentId: null,
      status: 'waiting',
      scopes: ['own-parent-contribution-attribution', 'own-parent-safe-summary', 'project-participation'],
      expiresAtCampaignMinute: null,
    },
    canGrant: true,
    canRevoke: false,
    ownerTrainerSlug: null,
    participantTrainerSlug: null,
    recovery: { state: 'none', pendingSinceCampaignMinute: null },
    gmReview: null,
  }],
  eggTransfers: [],
  gmPolicy: null,
  transition: 'none',
})

describe('BR-077 private consent workflow contract', () => {
  it('binds the reviewed presentation evidence to the strict route, privacy, and no-substitution policy', () => {
    expect(contractJson.definitionSha256).toBe(createHash('sha256').update(stableJsonStringify(contractJson.definition)).digest('hex'))
    expect(contractJson.definition).toMatchObject({
      ticket: 'BR-077',
      scope: { apiRoute: '/api/breeding/consent', clientMechanicsAuthority: 'none' },
      gmPolicy: { setupOverrideCreatesConsent: false, EggTransferWithoutTwoPositiveConsents: 'forbidden' },
      recovery: { ordinaryActionsWhilePending: 'all-disabled', commandPayloadProjection: 'forbidden' },
      privacy: { playerTransferCounterpartIdentity: 'structurally-absent' },
    })
  })
  it('accepts selector-only intent shapes and rejects enriched or contradictory mutations', () => {
    expect(parseBreedingConsentWorkflowRequestV1(request())).toEqual(request())
    expect(() => parseBreedingConsentWorkflowRequestV1({ ...request(), mechanics: true })).toThrow()
    expect(() => parseBreedingConsentWorkflowRequestV1({ ...request(), intent: 'grant-project-consent', confirmed: true })).toThrow()
    expect(parseBreedingConsentWorkflowRequestV1({
      ...request(),
      intent: 'grant-project-consent',
      projectId: 'breeding-project:v1:11111111111111111111111111111111',
      expectedProjectRevision: 0,
      parentSheetSlug: 'pokemon-parent',
      confirmed: true,
    }).intent).toBe('grant-project-consent')
  })

  it('verifies self-hashed role projections and structurally excludes GM fields from players', async () => {
    const value = projection()
    expect(value.securityPolicyDefinitionSha256).toBe(BREEDING_CONSENT_WORKFLOW_SECURITY_POLICY_DEFINITION_SHA256)
    await expect(verifyBreedingConsentWorkflowProjectionV1(value)).resolves.toEqual(value)
    await expect(verifyBreedingConsentWorkflowProjectionV1({
      ...value,
      notifications: { ...value.notifications, total: 2 },
    })).rejects.toThrow()
    expect(() => createBreedingConsentWorkflowProjectionV1({
      ...value,
      gmPolicy: { setupOverrideOnly: true, positiveConsentSubstitutionAllowed: false, transferRequiresTwoPositiveConsents: true },
    } as any)).toThrow()
  })
})
