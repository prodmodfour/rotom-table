/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import BreedingProjectWizard from '../../src/components/breeding/BreedingProjectWizard.vue'
import type { BreedingWorkshopOwnershipContextV1 } from '../../shared/breeding/workshop'
import { createBreedingProjectWizardProjectionV1 } from '../../server/domain/breeding/projectWizard'

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
const mountWizard = (overrides: Record<string, unknown> = {}) => mount(BreedingProjectWizard, {
  attachTo: document.body,
  props: {
    open: true,
    projection: projection(false),
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

  it('shows consent and the campaign-clock timeline in a non-mutating review', () => {
    const wrapper = mountWizard({
      projection: projection(true),
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
    const create = wrapper.findAll('button').find(button => button.text().includes('Create project'))
    expect(create?.attributes('disabled')).toBeDefined()
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
