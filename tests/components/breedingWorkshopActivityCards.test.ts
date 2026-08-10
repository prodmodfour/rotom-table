/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import BreedingWorkshopActivityCards from '../../src/components/breeding/BreedingWorkshopActivityCards.vue'
import { createBreedingWorkshopActivityProjectionV1 } from '../../server/domain/breeding/workshopActivity'
import type { BreedingWorkshopEggCardV1, BreedingWorkshopProjectCardV1 } from '../../shared/breeding/workshopActivity'

const project: BreedingWorkshopProjectCardV1 = {
  aggregateKind: 'breeding-project',
  projectId: 'breeding-project:v1:11111111111111111111111111111111' as never,
  revision: 3,
  status: 'initial-time-in-progress',
  breederDisplayName: 'Mira',
  parents: [
    { parentIndex: 0, relationship: 'owned', displayName: 'Ember', pokemonSheetSlug: 'pokemon-ember', consentStatus: 'not-required' },
    { parentIndex: 1, relationship: 'participating', displayName: 'Participating parent', pokemonSheetSlug: null, consentStatus: 'waiting' },
  ],
  progress: { stage: 'initial-time', accumulatedCampaignMinutes: 120, targetCampaignMinutes: 480, percent: 25 },
  history: [{ kind: 'created', campaignMinute: 10 }, { kind: 'initial-time-started', campaignMinute: 10 }],
  recovery: { state: 'none', pendingSinceCampaignMinute: null, canRefresh: false },
  createdAtCampaignMinute: 10,
  updatedAtCampaignMinute: 20,
  statusChangedAtCampaignMinute: 10,
}
const egg: BreedingWorkshopEggCardV1 = {
  aggregateKind: 'pokemon-egg',
  eggId: 'pokemon-egg:v1:22222222222222222222222222222222' as never,
  revision: 2,
  status: 'incubating',
  sourceKind: 'breeding',
  speciesName: 'Charmander',
  natureName: 'Cuddly',
  abilityName: 'Blaze',
  genderId: 'female',
  startingLevel: 1,
  progress: { stage: 'incubating', accumulatedCampaignMinutes: 600, targetCampaignMinutes: 1_200, percent: 50, paused: false },
  history: [{ kind: 'created', campaignMinute: 12 }, { kind: 'ownership-transferred', campaignMinute: 20 }],
  recovery: { state: 'none', pendingSinceCampaignMinute: null, canRefresh: false },
  transfer: { state: 'available', action: 'start', reasonId: null, counterpartyTrainerSlug: null, expiresAtCampaignMinute: null },
  childSheetSlug: null,
  createdAtCampaignMinute: 12,
  updatedAtCampaignMinute: 30,
  statusChangedAtCampaignMinute: 12,
}
const projection = (options: {
  readonly projects?: readonly BreedingWorkshopProjectCardV1[]
  readonly eggs?: readonly BreedingWorkshopEggCardV1[]
} = {}) => createBreedingWorkshopActivityProjectionV1({
  audience: 'owner',
  trainer: { trainerSheetSlug: 'trainer-owner', trainerRevision: 4, displayName: 'Mira' },
  generatedAtCampaignMinute: 40,
  projectsTruncated: false,
  eggsTruncated: false,
  projects: options.projects ?? [project],
  eggs: options.eggs ?? [egg],
})
const mountCards = (props: Partial<InstanceType<typeof BreedingWorkshopActivityCards>['$props']> = {}) => mount(
  BreedingWorkshopActivityCards,
  {
    attachTo: document.body,
    props: { projection: projection(), loading: false, error: null, ...props },
  },
)
afterEach(() => document.body.replaceChildren())

describe('Breeding Workshop activity cards', () => {
  it('presents labelled Project and Egg cards with exact progress, status, traits, and native history', () => {
    const wrapper = mountCards()
    expect(wrapper.get('#breeding-activity-title').text()).toBe('Projects and Eggs')
    expect(wrapper.get('#breeding-project-card-list-title').text()).toBe('Breeding Projects')
    expect(wrapper.get('#breeding-egg-card-list-title').text()).toBe('Eggs')
    expect(wrapper.text()).toContain('Ember × Participating parent')
    expect(wrapper.text()).toContain('120 / 480 campaign minutes')
    expect(wrapper.text()).toContain('Charmander Egg')
    expect(wrapper.text()).toContain('600 / 1200 campaign minutes')
    expect(wrapper.text()).toContain('Cuddly')
    expect(wrapper.text()).toContain('Blaze')
    const progress = wrapper.findAll('progress')
    expect(progress[0]?.attributes('aria-label')).toContain('120 of 480')
    expect(progress[1]?.attributes('aria-label')).toContain('600 of 1200')
    expect(wrapper.findAll('details').some(detail => detail.text().includes('History (2)'))).toBe(true)
  })

  it('never renders aggregate IDs or a redacted participating-parent identity as normal labels', () => {
    const wrapper = mountCards()
    const text = wrapper.text()
    expect(text).not.toContain(project.projectId)
    expect(text).not.toContain(egg.eggId)
    expect(text).not.toContain('pokemon-private')
    expect(text).not.toMatch(/definition hash|operation id|profile_/i)
    expect(text).toContain('Participating parent · waiting')
  })

  it('opens a keyboard-reachable transfer handoff without optimistic ownership change', async () => {
    const wrapper = mountCards()
    const transfer = wrapper.findAll('details').find(detail => detail.text().includes('Transfer Egg'))!
    const summary = transfer.get('summary')
    expect(summary.attributes('tabindex')).not.toBe('-1')
    await summary.trigger('click')
    const button = transfer.get('button')
    expect(button.text()).toBe('Open transfer setup')
    await button.trigger('click')
    expect(wrapper.emitted('requestTransfer')).toEqual([[egg.eggId, egg.revision]])
    const status = wrapper.get('.breeding-activity__notice[role="status"]')
    expect(status.text()).toContain('Ownership will not change until both owners give current consent')
  })

  it('separates uncertain recovery from ordinary actions and provides a visible authoritative refresh', async () => {
    const recoveringEgg: BreedingWorkshopEggCardV1 = {
      ...egg,
      recovery: { state: 'pending', pendingSinceCampaignMinute: 35, canRefresh: true },
      transfer: {
        state: 'unavailable', action: 'none',
        reasonId: 'breeding.workshop-transfer.pending-recovery',
        counterpartyTrainerSlug: null, expiresAtCampaignMinute: null,
      },
    }
    const wrapper = mountCards({ projection: projection({ projects: [], eggs: [recoveringEgg] }) })
    const recovery = wrapper.get('.breeding-card__recovery[role="status"]')
    expect(recovery.text()).toContain('Recovery check required')
    expect(recovery.text()).toContain('Refresh authoritative state before transfer')
    await recovery.get('button').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([[]])
    expect(wrapper.text()).toContain('Transfer unavailable')
  })

  it('announces loading, empty, and error states with visible retry paths', async () => {
    const loading = mountCards({ projection: null, loading: true })
    expect(loading.get('[role="status"]').text()).toContain('Loading current activity')
    loading.unmount()

    const empty = mountCards({ projection: projection({ projects: [], eggs: [] }) })
    expect(empty.get('[data-testid="breeding-activity-empty"] h3').text()).toBe('No durable activity yet')
    empty.unmount()

    const failed = mountCards({ projection: null, error: 'Current storage is unavailable.' })
    const alert = failed.get('[role="alert"]')
    expect(alert.text()).toContain('Current storage is unavailable.')
    await alert.get('button').trigger('click')
    expect(failed.emitted('retry')).toEqual([[]])
  })
})
