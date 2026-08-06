import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BreedingParentSelectionRefV1 } from '../../../shared/breeding/parentDiscovery'
import { createBreedingProjectWizardProjectionV1 } from '../../../server/domain/breeding/projectWizard'
import { useBreedingProjectWizard } from '../../../src/composables/breeding/useBreedingProjectWizard'

const candidates = [
  {
    parentSheetSlug: 'pokemon-parent-a',
    parentSheetRevision: 2,
    ownerTrainerSlug: 'trainer-owner',
    ownerTrainerRevision: 4,
    rosterField: 'current-team' as const,
    label: 'Leaf',
    speciesId: 'bulbasaur' as const,
    genderId: 'female' as const,
    level: 25,
    availability: { status: 'selectable' as const, reasonIds: [] },
  },
  {
    parentSheetSlug: 'pokemon-parent-b',
    parentSheetRevision: 3,
    ownerTrainerSlug: 'trainer-owner',
    ownerTrainerRevision: 4,
    rosterField: 'current-team' as const,
    label: 'Bloom',
    speciesId: 'ivysaur' as const,
    genderId: 'male' as const,
    level: 28,
    availability: { status: 'selectable' as const, reasonIds: [] },
  },
]
const result = (
  parentRefs: readonly BreedingParentSelectionRefV1[] = [],
  audience: 'owner' | 'gm' = 'owner',
) => createBreedingProjectWizardProjectionV1({
  audience,
  generatedAtCampaignMinute: 300,
  destination: { trainerSheetSlug: 'trainer-owner', trainerRevision: 4, displayName: 'Mira' },
  breeder: { trainerSheetSlug: 'trainer-owner', trainerRevision: 4, displayName: 'Mira' },
  parentDiscovery: {
    schemaVersion: 1,
    audience,
    generatedAtCampaignMinute: 300,
    trainerSheets: [{ trainerSheetSlug: 'trainer-owner', trainerSheetRevision: 4, candidates }],
    selectedParentRefs: parentRefs,
    compatibilityPreview: parentRefs.length === 2 ? {
      previewId: 'breeding-parent-preview:v1:33333333333333333333333333333333',
      status: 'requires-validation',
      reasonIds: [],
      requiredValidationIds: [
        'breeding.parent-validation.compatibility',
        'breeding.parent-validation.consent',
        'breeding.parent-validation.current-revisions',
        'breeding.parent-validation.location-facility',
        'breeding.parent-validation.maturity',
        'breeding.parent-validation.ownership-control',
      ],
    } : null,
  },
  timeline: {
    timeAuthority: 'campaign-clock',
    initialCampaignMinutes: 240,
    breederCheckDifficultyClass: 12,
    additionalCampaignMinutes: 240,
    minimumCampaignMinutesBeforeEgg: 480,
  },
  consentStatus: parentRefs.length === 2 ? 'not-required' : 'selection-incomplete',
  reviewStatus: parentRefs.length === 2 ? 'requires-final-validation' : 'selection-incomplete',
})
const installGlobals = (responses: readonly unknown[], player = true) => {
  const postJson = vi.fn()
  responses.forEach(response => postJson.mockResolvedValueOnce(response))
  vi.stubGlobal('useAuth', () => ({ isPlayer: ref(player) }))
  vi.stubGlobal('usePlayerProfiles', () => ({ selectedProfileId: ref('profile_owner000') }))
  vi.stubGlobal('useApiClient', () => ({ postJson }))
  return { postJson }
}

afterEach(() => vi.unstubAllGlobals())

describe('useBreedingProjectWizard', () => {
  it('starts from one Trainer and adopts only a verified current server projection', async () => {
    const globals = installGlobals([result()])
    const wizard = useBreedingProjectWizard()
    await wizard.start('trainer-owner')

    expect(globals.postJson).toHaveBeenCalledWith('/api/breeding/projects/wizard', {
      schemaVersion: 1,
      profileId: 'profile_owner000',
      destinationTrainerSlug: 'trainer-owner',
      breederTrainerSlug: 'trainer-owner',
      parentRefs: [],
    })
    expect(wizard.open.value).toBe(true)
    expect(wizard.parentCandidates.value.map(candidate => candidate.label)).toEqual(['Leaf', 'Bloom'])
    expect(wizard.error.value).toBeNull()
  })

  it('submits only selected identity and revision selectors and enables review after two', async () => {
    const firstRef = [{ pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 }]
    const bothRefs = [
      ...firstRef,
      { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 3 },
    ]
    const globals = installGlobals([result(), result(firstRef), result(bothRefs)])
    const wizard = useBreedingProjectWizard()
    await wizard.start('trainer-owner')
    await wizard.toggleParent('pokemon-parent-a')
    await wizard.toggleParent('pokemon-parent-b')

    expect(globals.postJson).toHaveBeenLastCalledWith('/api/breeding/projects/wizard', {
      schemaVersion: 1,
      profileId: 'profile_owner000',
      destinationTrainerSlug: 'trainer-owner',
      breederTrainerSlug: 'trainer-owner',
      parentRefs: bothRefs,
    })
    expect(wizard.selectedParentSlugs.value).toEqual(new Set([
      'pokemon-parent-a',
      'pokemon-parent-b',
    ]))
    expect(wizard.canReview.value).toBe(true)
    wizard.activeStep.value = 2
    wizard.nextStep()
    expect(wizard.activeStep.value).toBe(3)
  })

  it('rejects hash drift without adopting response facts and clears state on close', async () => {
    const valid = result()
    installGlobals([{
      ...valid,
      destination: { ...valid.destination, displayName: 'Changed' },
    }])
    const wizard = useBreedingProjectWizard()
    await wizard.start('trainer-owner')

    expect(wizard.projection.value).toBeNull()
    expect(wizard.error.value).toContain('hash does not match')
    wizard.close()
    expect(wizard.open.value).toBe(false)
    expect(wizard.error.value).toBeNull()
    expect(wizard.parentRefs.value).toEqual([])
  })

  it('uses null Profile selectors for GM requests', async () => {
    const globals = installGlobals([result([], 'gm')], false)
    const wizard = useBreedingProjectWizard()
    await wizard.start('trainer-owner')
    expect(globals.postJson.mock.calls[0]?.[1]).toMatchObject({ profileId: null })
  })
})
