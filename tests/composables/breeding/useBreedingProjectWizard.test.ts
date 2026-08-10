import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BreedingParentSelectionRefV1 } from '../../../shared/breeding/parentDiscovery'
import { createBreedingProjectWizardProjectionV1 } from '../../../server/domain/breeding/projectWizard'
import { createBreedingProjectGuidanceProjectionV1 } from '../../../server/domain/breeding/projectGuidance'
import { createBreedingProjectChoicesProjectionV1 } from '../../../server/domain/breeding/projectChoices'
import { BREEDING_CAMPAIGN_OPTION_IDS } from '../../../server/domain/breeding/campaignOptions'
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
const guidanceResult = (
  parentRefs: readonly BreedingParentSelectionRefV1[] = [],
  audience: 'owner' | 'gm' = 'owner',
) => createBreedingProjectGuidanceProjectionV1({
  wizard: result(parentRefs, audience),
  applicableReasonIds: parentRefs.length === 2
    ? ['breeding.project-guidance.pair-requires-final-validation']
    : ['breeding.project-guidance.parent-selection-incomplete'],
  sourceContributions: [{
    sourceKind: 'trainer-edge',
    sourceCanonicalId: 'Breeder',
    status: 'active',
    contributionIds: ['breeding-project-request', 'breeder-dc12-timeline'],
    skillApplication: { skillId: 'pokemon-education', rank: 'Novice', skillTotal: 5 },
    reasonId: null,
  }],
  gmDiagnostics: audience === 'gm' ? {
    candidateCount: 2,
    selectableCandidateCount: 2,
    unavailableCandidateCount: 0,
    selectedParentCount: parentRefs.length,
    ownershipTopology: parentRefs.length === 2 ? 'same-owner' : 'incomplete',
    breederAuthorityStatus: 'active',
    maturityPolicy: 'minimum-level',
    minimumMaturityLevel: 20,
    consentStatus: parentRefs.length === 2 ? 'not-required' : 'selection-incomplete',
    compatibilityPreviewStatus: parentRefs.length === 2 ? 'requires-validation' : 'not-evaluated',
    locationPolicyId: 'campaign-workshop-off-map-v1',
    facilityRegistryState: 'empty-no-authority',
    finalValidationStatus: 'required-before-creation',
  } : null,
})
const choicesResult = (
  parentRefs: readonly BreedingParentSelectionRefV1[] = [],
  audience: 'owner' | 'gm' = 'owner',
  selected = false,
  created = false,
) => createBreedingProjectChoicesProjectionV1({
  guidance: guidanceResult(parentRefs, audience),
  skillChoice: { status: 'not-required', options: [] },
  traitChoices: [
    { traitKind: 'nature', requiredRank: 'Adept', effectiveRank: 'Novice', status: 'random-only', resolutionCheckpoint: 'egg-production' },
    { traitKind: 'ability', requiredRank: 'Expert', effectiveRank: 'Novice', status: 'random-only', resolutionCheckpoint: 'egg-production' },
    { traitKind: 'gender', requiredRank: 'Master', effectiveRank: 'Novice', status: 'random-only', resolutionCheckpoint: 'egg-production' },
  ],
  campaignSettings: [...BREEDING_CAMPAIGN_OPTION_IDS].sort().map(campaignOptionId => ({
    campaignOptionId,
    label: campaignOptionId,
    valueLabel: 'Current',
  })),
  maturityChoices: parentRefs.length === 2 && !created ? [{
    parentOrdinal: 1,
    parentLabel: 'Leaf',
    status: 'confirmation-required',
    option: {
      optionId: 'option:v1:11111111111111111111111111111111',
      label: 'Confirm Leaf is mature',
      description: 'Record the current reviewed parent revision.',
      selected,
    },
  }] : [],
  parentRoleChoice: { status: 'not-required', options: [] },
  confirmation: created ? {
    status: 'created', setupStatus: 'ready', canConfirm: false,
    explicitConfirmationRequired: true,
    messageId: 'breeding.project-choices.project-created',
    project: {
      projectId: 'breeding-project:v1:22222222222222222222222222222222',
      revision: 0,
      status: 'initial-time-in-progress',
    },
  } : parentRefs.length === 2 && selected ? {
    status: 'ready', setupStatus: 'ready', canConfirm: true,
    explicitConfirmationRequired: true,
    messageId: 'breeding.project-choices.ready-to-confirm', project: null,
  } : parentRefs.length === 2 ? {
    status: 'blocked', setupStatus: 'unavailable', canConfirm: false,
    explicitConfirmationRequired: true,
    messageId: 'breeding.project-choices.maturity-review-required', project: null,
  } : {
    status: 'incomplete', setupStatus: 'not-evaluated', canConfirm: false,
    explicitConfirmationRequired: true,
    messageId: 'breeding.project-choices.selection-incomplete', project: null,
  },
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
    const globals = installGlobals([choicesResult()])
    const wizard = useBreedingProjectWizard()
    await wizard.start('trainer-owner', 'profile_explicit079')

    expect(globals.postJson).toHaveBeenCalledWith('/api/breeding/projects/wizard/choices', expect.objectContaining({
      schemaVersion: 1,
      profileId: 'profile_explicit079',
      destinationTrainerSlug: 'trainer-owner',
      breederTrainerSlug: 'trainer-owner',
      parentRefs: [],
      selectedOptionIds: [],
      confirmed: false,
      draftId: expect.stringMatching(/^breeding-project-draft:v1:[0-9a-f]{32}$/u),
    }))
    expect(wizard.open.value).toBe(true)
    expect(wizard.parentCandidates.value.map(candidate => candidate.label)).toEqual(['Leaf', 'Bloom'])
    expect(wizard.error.value).toBeNull()
    expect(wizard.guidance.value?.sourceContributions[0]?.sourceCanonicalId).toBe('Breeder')
  })

  it('submits only selected identity and revision selectors and enables review after two', async () => {
    const firstRef = [{ pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 }]
    const bothRefs = [
      ...firstRef,
      { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 3 },
    ]
    const globals = installGlobals([
      choicesResult(), choicesResult(firstRef), choicesResult(bothRefs),
    ])
    const wizard = useBreedingProjectWizard()
    await wizard.start('trainer-owner')
    await wizard.toggleParent('pokemon-parent-a')
    await wizard.toggleParent('pokemon-parent-b')

    expect(globals.postJson).toHaveBeenLastCalledWith('/api/breeding/projects/wizard/choices', expect.objectContaining({
      schemaVersion: 1,
      profileId: 'profile_owner000',
      destinationTrainerSlug: 'trainer-owner',
      breederTrainerSlug: 'trainer-owner',
      parentRefs: bothRefs,
      selectedOptionIds: [],
      confirmed: false,
    }))
    expect(wizard.selectedParentSlugs.value).toEqual(new Set([
      'pokemon-parent-a',
      'pokemon-parent-b',
    ]))
    expect(wizard.canReview.value).toBe(true)
    wizard.activeStep.value = 2
    wizard.nextStep()
    expect(wizard.activeStep.value).toBe(3)
  })

  it('submits opaque options and a separate explicit confirmation, then adopts the created Project', async () => {
    const firstRef = [{ pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 }]
    const bothRefs = [
      ...firstRef,
      { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 3 },
    ]
    const globals = installGlobals([
      choicesResult(),
      choicesResult(firstRef),
      choicesResult(bothRefs),
      choicesResult(bothRefs, 'owner', true),
      choicesResult(bothRefs, 'owner', false, true),
    ])
    const wizard = useBreedingProjectWizard()
    await wizard.start('trainer-owner')
    await wizard.toggleParent('pokemon-parent-a')
    await wizard.toggleParent('pokemon-parent-b')
    const option = wizard.choices.value!.maturityChoices[0]!.option!
    await wizard.selectOption(option.optionId, [option.optionId])
    expect(wizard.choices.value?.confirmation.canConfirm).toBe(true)
    await wizard.confirmProject()

    expect(globals.postJson).toHaveBeenLastCalledWith('/api/breeding/projects/wizard/choices', expect.objectContaining({
      selectedOptionIds: [option.optionId],
      confirmed: true,
      parentRefs: bothRefs,
    }))
    expect(wizard.projectCreated.value).toBe(true)
    expect(wizard.choices.value?.confirmation.project?.status).toBe('initial-time-in-progress')
  })

  it('rejects hash drift without adopting response facts and clears state on close', async () => {
    const valid = choicesResult()
    installGlobals([{
      ...valid,
      guidance: {
        ...valid.guidance,
        wizard: {
          ...valid.guidance.wizard,
          destination: { ...valid.guidance.wizard.destination, displayName: 'Changed' },
        },
      },
    }])
    const wizard = useBreedingProjectWizard()
    await wizard.start('trainer-owner')

    expect(wizard.projection.value).toBeNull()
    expect(wizard.error.value).toContain('hash does not match')
    wizard.close()
    expect(wizard.open.value).toBe(false)
    expect(wizard.error.value).toBeNull()
    expect(wizard.parentRefs.value).toEqual([])
    expect(wizard.guidance.value).toBeNull()
  })

  it('uses null Profile selectors for GM requests', async () => {
    const globals = installGlobals([choicesResult([], 'gm')], false)
    const wizard = useBreedingProjectWizard()
    await wizard.start('trainer-owner')
    expect(globals.postJson.mock.calls[0]?.[1]).toMatchObject({ profileId: null })
  })
})
