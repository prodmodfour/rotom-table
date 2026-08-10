import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createBreedingConsentWorkflowProjectionV1 } from '../../../server/domain/breeding/consentWorkflow'
import { useBreedingConsentWorkflow } from '../../../src/composables/breeding/useBreedingConsentWorkflow'

const PROJECT_ID = 'breeding-project:v1:77777777777777777777777777777777'
const EGG_ID = 'pokemon-egg:v1:77777777777777777777777777777777'
const SOURCE_ID = 'egg-transfer-consent:v1:77777777777777777777777777777777'
const projectCard = (active = false) => ({
  projectId: PROJECT_ID as never,
  projectRevision: active ? 2 : 1,
  coarseStatus: active ? 'in-progress' as const : 'awaiting-consent' as const,
  ownParent: { pokemonSheetSlug: 'pokemon-parent', expectedSheetRevision: 3, displayName: 'Leaf', current: true },
  breederDisplayName: 'Breeder',
  consent: active
    ? { consentId: 'breeding-consent:v1:77777777777777777777777777777777' as never, status: 'active' as const, scopes: ['own-parent-contribution-attribution', 'own-parent-safe-summary', 'project-participation'] as const, expiresAtCampaignMinute: 44_000 }
    : { consentId: null, status: 'waiting' as const, scopes: ['own-parent-contribution-attribution', 'own-parent-safe-summary', 'project-participation'] as const, expiresAtCampaignMinute: null },
  canGrant: !active,
  canRevoke: active,
  ownerTrainerSlug: null,
  participantTrainerSlug: null,
  recovery: { state: 'none' as const, pendingSinceCampaignMinute: null },
  gmReview: null,
})
const projection = (active = false) => createBreedingConsentWorkflowProjectionV1({
  audience: 'player',
  context: { trainerSheetSlug: 'trainer-owner', trainerRevision: 4, displayName: 'Owner' },
  generatedAtCampaignMinute: 800,
  notifications: { projectRequests: active ? 0 : 1, transferInvitations: 0, readyTransfers: 0, total: active ? 0 : 1 },
  projectRequestsTruncated: false,
  eggTransfersTruncated: false,
  projectRequests: [projectCard(active)],
  eggTransfers: [],
  gmPolicy: null,
  transition: active ? 'project-consent-granted' : 'none',
})
const install = (responses: readonly unknown[], player = true) => {
  const postJson = vi.fn()
  responses.forEach(response => postJson.mockResolvedValueOnce(response))
  vi.stubGlobal('useAuth', () => ({ isPlayer: ref(player) }))
  vi.stubGlobal('useApiClient', () => ({ postJson }))
  vi.stubGlobal('usePlayerProfiles', () => ({ selectedProfileId: ref('profile_owner_0077') }))
  return postJson
}
afterEach(() => vi.unstubAllGlobals())

describe('useBreedingConsentWorkflow', () => {
  it('loads one private Trainer context and sends selector-only Project consent', async () => {
    const postJson = install([projection(), projection(true)])
    const workflow = useBreedingConsentWorkflow()
    await workflow.load('trainer-owner')
    expect(postJson).toHaveBeenNthCalledWith(1, '/api/breeding/consent', {
      schemaVersion: 1,
      profileId: 'profile_owner_0077',
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
    await workflow.grantProjectConsent(projection().projectRequests[0]!)
    expect(postJson).toHaveBeenNthCalledWith(2, '/api/breeding/consent', expect.objectContaining({
      intent: 'grant-project-consent',
      projectId: PROJECT_ID,
      expectedProjectRevision: 1,
      parentSheetSlug: 'pokemon-parent',
      confirmed: true,
    }))
    expect(JSON.stringify(postJson.mock.calls[1])).not.toContain('consentScopes')
    expect(workflow.projection.value?.transition).toBe('project-consent-granted')
  })

  it('keeps transfer setup local and submits no ownership, mechanics, or consent evidence claims', async () => {
    const offered = createBreedingConsentWorkflowProjectionV1({
      audience: 'player',
      context: { trainerSheetSlug: 'trainer-owner', trainerRevision: 4, displayName: 'Owner' },
      generatedAtCampaignMinute: 800,
      notifications: { projectRequests: 0, transferInvitations: 0, readyTransfers: 0, total: 0 },
      projectRequestsTruncated: false,
      eggTransfersTruncated: false,
      projectRequests: [],
      eggTransfers: [{
        offerConsentId: SOURCE_ID as never,
        ownConsentId: SOURCE_ID as never,
        eggId: EGG_ID as never,
        eggRevision: 2,
        audience: 'source-owner',
        state: 'offered',
        expiresAtCampaignMinute: 44_000,
        canAccept: false,
        canTransfer: false,
        canRevoke: true,
        ownConsentActive: true,
        recovery: { state: 'none', pendingSinceCampaignMinute: null },
      }],
      gmPolicy: null,
      transition: 'egg-transfer-offered',
    })
    const postJson = install([projection(), offered])
    const workflow = useBreedingConsentWorkflow()
    await workflow.load('trainer-owner')
    workflow.openTransferSetup(EGG_ID, 2)
    expect(postJson).toHaveBeenCalledTimes(1)
    await workflow.offerEggTransfer('trainer-recipient')
    expect(postJson).toHaveBeenNthCalledWith(2, '/api/breeding/consent', expect.objectContaining({
      intent: 'offer-egg-transfer', eggId: EGG_ID, expectedEggRevision: 2,
      destinationTrainerSlug: 'trainer-recipient', confirmed: true,
    }))
    const serialized = JSON.stringify(postJson.mock.calls[1])
    expect(serialized).not.toMatch(/ownerTrainerSlug|consentEvidence|command|mechanics|roll/u)
    expect(workflow.transferSetup.value).toBeNull()
  })

  it('uses null Profile selectors for GM views and rejects a tampered response', async () => {
    const gm = createBreedingConsentWorkflowProjectionV1({
      audience: 'gm',
      context: { trainerSheetSlug: 'trainer-owner', trainerRevision: 4, displayName: 'Owner' },
      generatedAtCampaignMinute: 800,
      notifications: { projectRequests: 0, transferInvitations: 0, readyTransfers: 0, total: 0 },
      projectRequestsTruncated: false,
      eggTransfersTruncated: false,
      projectRequests: [],
      eggTransfers: [],
      gmPolicy: { setupOverrideOnly: true, positiveConsentSubstitutionAllowed: false, transferRequiresTwoPositiveConsents: true },
      transition: 'none',
    })
    const postJson = install([{ ...gm, generatedAtCampaignMinute: 801 }], false)
    const workflow = useBreedingConsentWorkflow()
    await workflow.load('trainer-owner')
    expect(postJson).toHaveBeenCalledWith('/api/breeding/consent', expect.objectContaining({ profileId: null, intent: 'view' }))
    expect(workflow.error.value).toContain('does not match')
    expect(workflow.projection.value).toBeNull()
  })
})
