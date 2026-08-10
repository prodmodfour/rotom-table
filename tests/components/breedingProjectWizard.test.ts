/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import BreedingProjectWizard from '../../src/components/breeding/BreedingProjectWizard.vue'
import type { BreedingWorkshopOwnershipContextV1 } from '../../shared/breeding/workshop'
import { createBreedingProjectWizardProjectionV1 } from '../../server/domain/breeding/projectWizard'
import { createBreedingProjectGuidanceProjectionV1 } from '../../server/domain/breeding/projectGuidance'

const owner: BreedingWorkshopOwnershipContextV1 = {
  trainerSheetSlug: 'trainer-owner',
  trainerRevision: 4,
  displayName: 'Mira',
  availability: 'available',
  unavailableReasonId: null,
  hasProjects: false,
  hasEggs: false,
}
const breeder: BreedingWorkshopOwnershipContextV1 = {
  ...owner,
  trainerSheetSlug: 'trainer-breeder',
  trainerRevision: 2,
  displayName: 'Brock',
}
const candidate = (slug: string, label: string, genderId: 'female' | 'male') => ({
  parentSheetSlug: slug,
  parentSheetRevision: 3,
  ownerTrainerSlug: 'trainer-owner',
  ownerTrainerRevision: 4,
  rosterField: 'current-team' as const,
  label,
  speciesId: slug.endsWith('a') ? 'bulbasaur' as const : 'ivysaur' as const,
  genderId,
  level: 25,
  availability: { status: 'selectable' as const, reasonIds: [] },
})
const projection = (selected: boolean) => createBreedingProjectWizardProjectionV1({
  audience: 'owner',
  generatedAtCampaignMinute: 800,
  destination: { trainerSheetSlug: 'trainer-owner', trainerRevision: 4, displayName: 'Mira' },
  breeder: { trainerSheetSlug: 'trainer-breeder', trainerRevision: 2, displayName: 'Brock' },
  parentDiscovery: {
    schemaVersion: 1,
    audience: 'owner',
    generatedAtCampaignMinute: 800,
    trainerSheets: [{
      trainerSheetSlug: 'trainer-owner',
      trainerSheetRevision: 4,
      candidates: [candidate('pokemon-parent-a', 'Leaf', 'female'), candidate('pokemon-parent-b', 'Bloom', 'male')],
    }],
    selectedParentRefs: selected ? [
      { pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 3 },
      { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 3 },
    ] : [],
    compatibilityPreview: selected ? {
      previewId: 'breeding-parent-preview:v1:22222222222222222222222222222222',
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
  consentStatus: selected ? 'not-required' : 'selection-incomplete',
  reviewStatus: selected ? 'requires-final-validation' : 'selection-incomplete',
})
const guidance = (selected: boolean) => createBreedingProjectGuidanceProjectionV1({
  wizard: projection(selected),
  applicableReasonIds: selected ? [
    'breeding.project-guidance.maturity-confirmation-required',
    'breeding.project-guidance.pair-requires-final-validation',
  ] : ['breeding.project-guidance.parent-selection-incomplete'],
  sourceContributions: [{
    sourceKind: 'trainer-edge',
    sourceCanonicalId: 'Breeder',
    status: 'active',
    contributionIds: ['breeding-project-request', 'breeder-dc12-timeline'],
    skillApplication: { skillId: 'pokemon-education', rank: 'Novice', skillTotal: 5 },
    reasonId: null,
  }],
  gmDiagnostics: null,
})
const unavailableProjection = () => {
  const base = projection(false)
  const firstTrainer = base.parentDiscovery.trainerSheets[0]!
  return createBreedingProjectWizardProjectionV1({
    audience: 'owner',
    generatedAtCampaignMinute: base.generatedAtCampaignMinute,
    destination: base.destination,
    breeder: base.breeder,
    parentDiscovery: {
      schemaVersion: 1,
      audience: 'owner',
      generatedAtCampaignMinute: base.generatedAtCampaignMinute,
      trainerSheets: [{
        trainerSheetSlug: firstTrainer.trainerSheetSlug,
        trainerSheetRevision: firstTrainer.trainerSheetRevision,
        candidates: [
          firstTrainer.candidates[0]!,
          {
            ...firstTrainer.candidates[1]!,
            availability: {
              status: 'unavailable',
              reasonIds: ['breeding.parent-discovery.gender-mismatch'],
            },
          },
        ],
      }],
      selectedParentRefs: [],
      compatibilityPreview: null,
    },
    timeline: base.timeline,
    consentStatus: 'selection-incomplete',
    reviewStatus: 'selection-incomplete',
  })
}
const gmGuidance = () => {
  const base = projection(false)
  const gmWizard = createBreedingProjectWizardProjectionV1({
    audience: 'gm',
    generatedAtCampaignMinute: base.generatedAtCampaignMinute,
    destination: base.destination,
    breeder: base.breeder,
    parentDiscovery: {
      ...base.parentDiscovery,
      audience: 'gm',
    },
    timeline: base.timeline,
    consentStatus: base.consentStatus,
    reviewStatus: base.reviewStatus,
  })
  return createBreedingProjectGuidanceProjectionV1({
    wizard: gmWizard,
    applicableReasonIds: ['breeding.project-guidance.parent-selection-incomplete'],
    sourceContributions: [{
      sourceKind: 'trainer-edge',
      sourceCanonicalId: 'Breeder',
      status: 'active',
      contributionIds: ['breeding-project-request', 'breeder-dc12-timeline'],
      skillApplication: { skillId: 'pokemon-education', rank: 'Novice', skillTotal: 5 },
      reasonId: null,
    }],
    gmDiagnostics: {
      candidateCount: 2,
      selectableCandidateCount: 2,
      unavailableCandidateCount: 0,
      selectedParentCount: 0,
      ownershipTopology: 'incomplete',
      breederAuthorityStatus: 'active',
      maturityPolicy: 'minimum-level',
      minimumMaturityLevel: 20,
      consentStatus: 'selection-incomplete',
      compatibilityPreviewStatus: 'not-evaluated',
      locationPolicyId: 'campaign-workshop-off-map-v1',
      facilityRegistryState: 'empty-no-authority',
      finalValidationStatus: 'required-before-creation',
    },
  })
}
const mountWizard = (overrides: Record<string, unknown> = {}) => mount(BreedingProjectWizard, {
  attachTo: document.body,
  props: {
    open: true,
    projection: projection(false),
    guidance: guidance(false),
    ownershipContexts: [owner, breeder],
    destinationTrainerSlug: 'trainer-owner',
    breederTrainerSlug: 'trainer-breeder',
    selectedParentSlugs: new Set<string>(),
    activeStep: 0,
    loading: false,
    error: null,
    canReview: false,
    ...overrides,
  },
})

afterEach(() => document.body.replaceChildren())

describe('Breeding Project wizard', () => {
  it('provides labelled keyboard controls for destination and Breeder steps', async () => {
    const wrapper = mountWizard()
    expect(wrapper.get('#breeding-project-wizard-title').text()).toBe('Plan a breeding project')
    expect(wrapper.get('[aria-label="Project setup progress"] [aria-current="step"]').text())
      .toContain('Destination')
    const destination = wrapper.get('select')
    expect(destination.element.closest('label')?.textContent).toContain('Destination Trainer')
    await destination.setValue('trainer-breeder')
    expect(wrapper.emitted('selectDestination')).toEqual([['trainer-breeder']])
    await wrapper.get('button[aria-label="Close project wizard"]').trigger('click')
    expect(wrapper.emitted('close')).toEqual([[]])
  })

  it('shows current source contributions and the authoritative Skill application', () => {
    const wrapper = mountWizard({ activeStep: 1 })
    expect(wrapper.get('#wizard-sources-title').text()).toBe('Current source contributions')
    expect(wrapper.text()).toContain('Breeder')
    expect(wrapper.text()).toContain('Active')
    expect(wrapper.text()).toContain('Pokémon Education · Novice · check total +5')
  })

  it('announces selection count, disables unavailable completion, and emits selectable parents', async () => {
    const wrapper = mountWizard({ activeStep: 2 })
    expect(wrapper.get('[role="status"]').text()).toContain('0 of 2 parents selected')
    const checks = wrapper.findAll('input[type="checkbox"]')
    expect(checks).toHaveLength(2)
    await checks[0]!.trigger('change')
    expect(wrapper.emitted('toggleParent')).toEqual([['pokemon-parent-a']])
    const review = wrapper.findAll('button').find(button => button.text().includes('Review project'))
    expect(review?.attributes('disabled')).toBeDefined()
  })

  it('discloses closed unavailable-parent reasons and recovery without enabling selection', async () => {
    const wizard = unavailableProjection()
    const unavailableGuidance = createBreedingProjectGuidanceProjectionV1({
      wizard,
      applicableReasonIds: ['breeding.project-guidance.parent-selection-incomplete'],
      sourceContributions: guidance(false).sourceContributions,
      gmDiagnostics: null,
    })
    const wrapper = mountWizard({
      projection: wizard,
      guidance: unavailableGuidance,
      activeStep: 2,
    })
    const checks = wrapper.findAll('input[type="checkbox"]')
    expect(checks[1]?.attributes('disabled')).toBeDefined()
    const details = wrapper.get('details')
    await details.get('summary').trigger('click')
    expect(details.text()).toContain('Gender conflicts with Species data')
    expect(details.text()).toContain('Next:')
  })

  it('shows consent and the campaign-clock timeline in a non-mutating review', () => {
    const wrapper = mountWizard({
      projection: projection(true),
      guidance: guidance(true),
      selectedParentSlugs: new Set(['pokemon-parent-a', 'pokemon-parent-b']),
      activeStep: 3,
      canReview: true,
    })
    expect(wrapper.get('#wizard-review-title').text()).toBe('Review the project plan')
    expect(wrapper.text()).toContain('Leaf and Bloom')
    expect(wrapper.text()).toContain('Same-owner selection')
    expect(wrapper.text()).toContain('240 initial campaign minutes')
    expect(wrapper.text()).toContain('Breeder check at DC 12')
    expect(wrapper.text()).toContain('Only the campaign clock advances this timeline')
    expect(wrapper.text()).toContain('current server validation are still required')
    expect(wrapper.text()).toContain('GM maturity confirmation is required')
    const create = wrapper.findAll('button').find(button => button.text().includes('Create project'))
    expect(create?.attributes('disabled')).toBeDefined()
  })

  it('shows bounded diagnostics to the GM audience without aggregate identifiers', () => {
    const gm = gmGuidance()
    const wrapper = mountWizard({
      projection: gm.wizard,
      guidance: gm,
      activeStep: 3,
    })
    const diagnostics = wrapper.get('[data-testid="breeding-project-gm-diagnostics"]')
    expect(diagnostics.text()).toContain('2 selectable · 0 unavailable')
    expect(diagnostics.text()).toContain('minimum-level · Level 20')
    expect(diagnostics.text()).toContain('Campaign Workshop · no facility authority')
    expect(diagnostics.text()).not.toMatch(/pokemon-parent|trainer-owner|definitionSha/iu)
  })

  it('exposes load failure and retry without hiding the close control', async () => {
    const wrapper = mountWizard({ projection: null, error: 'Current parent directory is unavailable.' })
    expect(wrapper.get('[role="alert"]').text()).toContain('Current parent directory is unavailable.')
    const retry = wrapper.findAll('button').find(button => button.text() === 'Retry')!
    await retry.trigger('click')
    expect(wrapper.emitted('retry')).toEqual([[]])
    expect(wrapper.find('button[aria-label="Close project wizard"]').exists()).toBe(true)
  })
})
