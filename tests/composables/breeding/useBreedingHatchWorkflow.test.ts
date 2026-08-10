import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createBreedingHatchWorkflowProjectionV1 } from '../../../server/domain/breeding/hatchWorkflow'
import { useBreedingHatchWorkflow } from '../../../src/composables/breeding/useBreedingHatchWorkflow'

const EGG_ID = 'pokemon-egg:v1:75757575757575757575757575757575'
const BOX_OPTION_ID = 'option:v1:75757575757575757575757575757570'
const TEAM_OPTION_ID = 'option:v1:75757575757575757575757575757571'
const projection = (revision = 1, status: 'ready' | 'hatching' = 'ready') => createBreedingHatchWorkflowProjectionV1({
  audience: 'owner', trainerSheetSlug: 'trainer-owner',
  stage: status === 'ready' ? 'ready' : 'ready-to-complete',
  egg: { eggId: EGG_ID as never, revision, status, speciesName: 'Bulbasaur', updatedAtCampaignMinute: 700 },
  decision: status === 'ready'
    ? { kind: 'begin-hatch', canSubmit: true, requiresConfirmation: true, reasonId: null }
    : { kind: 'complete-hatch', canSubmit: true, requiresConfirmation: true, reasonId: null },
  special: { state: status === 'ready' ? 'not-rolled' : 'normal', outcomeId: null, gmReview: null },
  destination: status === 'ready'
    ? { teamCapacity: 6 as const, acceptedKind: null, options: [
        { optionId: BOX_OPTION_ID as never, kind: 'box' as const, availability: 'available' as const, reasonId: null, remainingTeamSlots: null },
        { optionId: TEAM_OPTION_ID as never, kind: 'team' as const, availability: 'available' as const, reasonId: null, remainingTeamSlots: 2 },
      ] }
    : { teamCapacity: 6 as const, acceptedKind: 'box' as const, options: [] },
  childReveal: null, recovery: { state: 'none', pendingSinceCampaignMinute: null },
  transition: status === 'ready' ? 'none' : 'hatch-started', generatedAtCampaignMinute: 700,
})
const install = (responses: readonly unknown[], player = true) => {
  const postJson = vi.fn()
  responses.forEach(response => postJson.mockResolvedValueOnce(response))
  vi.stubGlobal('useAuth', () => ({ isPlayer: ref(player) }))
  vi.stubGlobal('useApiClient', () => ({ postJson }))
  vi.stubGlobal('usePlayerProfiles', () => ({ selectedProfileId: ref('profile_owner_0075') }))
  return postJson
}
afterEach(() => vi.unstubAllGlobals())

describe('useBreedingHatchWorkflow', () => {
  it('inspects with current Profile selectors then confirms using the adopted Egg revision', async () => {
    const postJson = install([projection(), projection(2, 'hatching')])
    const workflow = useBreedingHatchWorkflow()
    await workflow.openFor('trainer-owner', EGG_ID, 1)
    expect(postJson).toHaveBeenNthCalledWith(1, '/api/breeding/hatch', {
      schemaVersion: 1, profileId: 'profile_owner_0075', trainerSheetSlug: 'trainer-owner', eggId: EGG_ID,
      expectedEggRevision: 1, intent: 'inspect', destinationOptionId: null, selectedOptionId: null, confirmed: false,
    })
    await workflow.begin(TEAM_OPTION_ID)
    expect(postJson).toHaveBeenNthCalledWith(2, '/api/breeding/hatch', expect.objectContaining({
      expectedEggRevision: 1, intent: 'begin', destinationOptionId: TEAM_OPTION_ID, confirmed: true,
    }))
    expect(workflow.projection.value?.egg.revision).toBe(2)
    expect(workflow.submitting.value).toBe(false)
  })

  it('omits Profile claims for GM requests and sends only an opaque special option', async () => {
    const optionId = 'option:v1:75757575757575757575757575757575'
    const gm = createBreedingHatchWorkflowProjectionV1({
      audience: 'gm', trainerSheetSlug: 'trainer-owner', stage: 'awaiting-gm',
      egg: { eggId: EGG_ID as never, revision: 2, status: 'awaiting-special-adjudication', speciesName: 'Bulbasaur', updatedAtCampaignMinute: 700 },
      decision: { kind: 'resolve-special', canSubmit: true, requiresConfirmation: true, reasonId: null },
      special: { state: 'pending-adjudication', outcomeId: null, gmReview: { rollTotal: 1, triggerIds: ['roll-1'], options: [
        { optionId: optionId as never, outcomeId: 'breeding.hatch-special.outcome.campaign-significance', label: 'Campaign significance', description: 'Story consequence.' },
        { optionId: 'option:v1:75757575757575757575757575757576' as never, outcomeId: 'breeding.hatch-special.outcome.distinctive-appearance', label: 'Distinctive appearance', description: 'Memorable appearance.' },
        { optionId: 'option:v1:75757575757575757575757575757577' as never, outcomeId: 'breeding.hatch-special.outcome.distinctive-temperament', label: 'Distinctive temperament', description: 'Memorable temperament.' },
      ] } },
      destination: { teamCapacity: 6, acceptedKind: 'box', options: [] },
      childReveal: null, recovery: { state: 'none', pendingSinceCampaignMinute: null }, transition: 'none', generatedAtCampaignMinute: 700,
    })
    const postJson = install([gm, { ...gm, projectionDefinitionSha256: '0'.repeat(64) }], false)
    const workflow = useBreedingHatchWorkflow()
    await workflow.openFor('trainer-owner', EGG_ID, 2)
    await workflow.resolveSpecial(optionId)
    expect(postJson).toHaveBeenNthCalledWith(2, '/api/breeding/hatch', expect.objectContaining({
      profileId: null, intent: 'resolve-special', selectedOptionId: optionId, confirmed: true,
    }))
    expect(workflow.error.value).toContain('does not match')
    expect(workflow.projection.value).toEqual(gm)
  })

  it('closes and invalidates a slower response from an old ownership context', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined
    const postJson = vi.fn(() => new Promise(resolve => { resolveRequest = resolve }))
    vi.stubGlobal('useAuth', () => ({ isPlayer: ref(true) }))
    vi.stubGlobal('useApiClient', () => ({ postJson }))
    vi.stubGlobal('usePlayerProfiles', () => ({ selectedProfileId: ref('profile_owner_0075') }))
    const workflow = useBreedingHatchWorkflow()
    const opening = workflow.openFor('trainer-owner', EGG_ID, 1)
    workflow.close()
    resolveRequest?.(projection())
    await opening
    expect(workflow.open.value).toBe(false)
    expect(workflow.projection.value).toBeNull()
  })
})
