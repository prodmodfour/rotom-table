import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import BreedingConsentCenter from '../../src/components/breeding/BreedingConsentCenter.vue'
import BreedingHatchDecisionFlow from '../../src/components/breeding/BreedingHatchDecisionFlow.vue'
import BreedingWorkshopActivityCards from '../../src/components/breeding/BreedingWorkshopActivityCards.vue'
import BreedingWorkshopShell from '../../src/components/breeding/BreedingWorkshopShell.vue'
import fixtures from '../fixtures/breeding/workshop-browser-projections-v1.json'

afterEach(() => document.body.replaceChildren())

describe('Breeding Workshop in Nuxt', () => {
  it('hydrates the role-private shell and activity hierarchy without aggregate IDs', async () => {
    const shell = await mountSuspended(BreedingWorkshopShell, {
      attachTo: document.body,
      props: {
        projection: fixtures.player.workshop as never,
        ownershipContexts: fixtures.player.workshop.ownershipContexts as never,
        loading: false,
        loadingMore: false,
        error: null,
        profileSwitchPath: '/login?redirect=/breeding',
      },
    })
    const activity = await mountSuspended(BreedingWorkshopActivityCards, {
      attachTo: document.body,
      props: { projection: fixtures.player.activity as never, loading: false, error: null },
    })
    expect(shell.get('h1').text()).toBe('Breeding Workshop')
    expect(activity.get('#breeding-activity-title').text()).toBe('Projects and Eggs')
    expect(activity.text()).toContain('Leaf × Participating parent')
    expect(activity.text()).not.toContain('Secret Parent')
    for (const id of Object.values(fixtures.aggregateIds)) {
      expect(`${shell.text()} ${activity.text()}`).not.toContain(id)
    }
  })

  it('hydrates the consent dialog with modal naming, initial focus, and no counterpart identity', async () => {
    const wrapper = await mountSuspended(BreedingConsentCenter, {
      attachTo: document.body,
      props: {
        projection: fixtures.player.consent as never,
        loading: false,
        submitting: false,
        error: null,
        transferSetup: { eggId: fixtures.aggregateIds.eggId, eggRevision: 4 },
      },
    })
    await wrapper.vm.$nextTick()
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.getAttribute('aria-labelledby')).toBe('breeding-transfer-setup-title')
    expect(document.activeElement).toBe(dialog.querySelector('input'))
    expect(dialog.textContent).not.toContain('trainer-secret')
    expect(dialog.textContent).not.toContain(fixtures.aggregateIds.eggId)
  })

  it('hydrates the hatch decision as a named keyboard modal with native destination choices', async () => {
    const wrapper = await mountSuspended(BreedingHatchDecisionFlow, {
      attachTo: document.body,
      props: {
        open: true,
        projection: fixtures.player.hatch as never,
        loading: false,
        submitting: false,
        error: null,
      },
    })
    await wrapper.vm.$nextTick()
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement?.id).toBe('hatch-flow-title')
    expect(dialog.querySelectorAll('input[type="radio"]')).toHaveLength(2)
    expect(dialog.textContent).not.toContain(fixtures.aggregateIds.eggId)
  })
})
