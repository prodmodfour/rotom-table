/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import BreedingWorkshopShell from '../../src/components/breeding/BreedingWorkshopShell.vue'
import type {
  BreedingWorkshopOwnershipContextV1,
  BreedingWorkshopProjectionV1,
} from '../../shared/breeding/workshop'

const owner: BreedingWorkshopOwnershipContextV1 = {
  trainerSheetSlug: 'trainer-owner',
  trainerRevision: 4,
  displayName: 'Mira',
  availability: 'available',
  unavailableReasonId: null,
  hasProjects: false,
  hasEggs: false,
}
const projection = (
  overrides: Partial<BreedingWorkshopProjectionV1> = {},
): BreedingWorkshopProjectionV1 => ({
  schemaVersion: 1,
  audience: 'owner',
  generatedAtCampaignMinute: 720,
  profileSelectionRequired: false,
  ownershipCursor: null,
  nextOwnershipCursor: null,
  ownershipContexts: [owner],
  selectedOwnershipContext: owner,
  emptyState: 'selected-context-empty',
  securityPolicyDefinitionSha256: 'a'.repeat(64),
  projectionDefinitionSha256: 'b'.repeat(64),
  ...overrides,
})
const mountShell = (props: Partial<InstanceType<typeof BreedingWorkshopShell>['$props']> = {}) => mount(
  BreedingWorkshopShell,
  {
    attachTo: document.body,
    props: {
      projection: projection(),
      ownershipContexts: [owner],
      loading: false,
      loadingMore: false,
      error: null,
      profileSwitchPath: '/login?redirect=/breeding',
      ...props,
    },
    global: {
      stubs: {
        NuxtLink: {
          props: ['to'],
          template: '<a :href="to"><slot /></a>',
        },
      },
    },
  },
)

afterEach(() => document.body.replaceChildren())

describe('Breeding Workshop shell', () => {
  it('presents profile selection as a labelled, keyboard-reachable empty state', () => {
    const profileRequired = projection({
      profileSelectionRequired: true,
      ownershipContexts: [],
      selectedOwnershipContext: null,
      emptyState: 'profile-required',
    })
    const wrapper = mountShell({ projection: profileRequired, ownershipContexts: [] })
    expect(wrapper.get('h1').text()).toBe('Breeding Workshop')
    expect(wrapper.get('[data-testid="breeding-profile-required"] h2').text())
      .toBe('Choose a player profile')
    const link = wrapper.get('a')
    expect(link.text()).toBe('Choose profile')
    expect(link.attributes('href')).toBe('/login?redirect=/breeding')
    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('exposes ownership selection, activity regions, campaign time, and pagination without raw mechanics', async () => {
    const second: BreedingWorkshopOwnershipContextV1 = {
      ...owner,
      trainerSheetSlug: 'trainer-second',
      displayName: 'Brock',
      trainerRevision: 2,
      hasProjects: true,
      hasEggs: true,
    }
    const wrapper = mountShell({
      projection: projection({
        nextOwnershipCursor: 'trainer-second',
        ownershipContexts: [owner, second],
      }),
      ownershipContexts: [owner, second],
    })
    expect(wrapper.get('[aria-label="Current campaign minute"]').text()).toContain('720')
    expect(wrapper.get('label').text()).toContain('Trainer')
    expect(wrapper.get('select').attributes('value')).toBe('trainer-owner')
    expect(wrapper.get('#breeding-projects-title').text()).toBe('Breeding projects')
    expect(wrapper.get('#breeding-eggs-title').text()).toBe('Eggs')
    expect(wrapper.text()).not.toMatch(/operation|definition hash|parent identity/i)

    await wrapper.get('select').setValue('trainer-second')
    expect(wrapper.emitted('selectOwnership')).toEqual([['trainer-second']])
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('loadMore')).toEqual([[]])
  })

  it('announces load errors and gives retry a visible non-hover path', async () => {
    const wrapper = mountShell({
      projection: null,
      ownershipContexts: [],
      error: 'The campaign database is unavailable.',
    })
    const alert = wrapper.get('[role="alert"]')
    expect(alert.get('h2').text()).toBe('The Workshop could not load')
    expect(alert.text()).toContain('The campaign database is unavailable.')
    const retry = alert.get('button')
    expect(retry.text()).toContain('Retry')
    await retry.trigger('click')
    expect(wrapper.emitted('retry')).toEqual([[]])
  })

  it('keeps stale linked ownership visible with a concise safe reason', () => {
    const unavailable: BreedingWorkshopOwnershipContextV1 = {
      trainerSheetSlug: 'trainer-missing',
      trainerRevision: null,
      displayName: 'trainer-missing',
      availability: 'unavailable',
      unavailableReasonId: 'breeding.workshop.trainer-unavailable',
      hasProjects: false,
      hasEggs: false,
    }
    const wrapper = mountShell({
      projection: projection({
        ownershipContexts: [unavailable],
        selectedOwnershipContext: unavailable,
        emptyState: 'selected-context-unavailable',
      }),
      ownershipContexts: [unavailable],
    })
    const alert = wrapper.get('[data-testid="breeding-context-unavailable"]')
    expect(alert.attributes('role')).toBe('alert')
    expect(alert.text()).toContain('linked Trainer no longer exists')
    expect(wrapper.find('#breeding-projects-title').exists()).toBe(false)
  })
})
