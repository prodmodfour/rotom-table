/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MapAttackOfOpportunityOverlay from '~/components/map/MapAttackOfOpportunityOverlay.vue'
import { pendingMoveResponseWindowKey } from '~/composables/map-editor/usePendingMoveResponses'
import type { PendingMoveResponseWindowView } from '#shared/moveAutomation/responseViews'

const opportunityWindow = (): PendingMoveResponseWindowView => ({
  schemaVersion: 1,
  resolution: {
    schemaVersion: 1,
    resolutionId: 'resolution-aoo-1',
    actorPlacementId: 'moving-token',
    canonicalMoveId: 'Attack of Opportunity',
    phase: 'movement',
    status: 'pending',
    outstandingWindowCount: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  window: {
    windowId: 'attack-of-opportunity.window.1',
    kind: 'reaction',
    phase: 'movement',
    reasonCode: 'maneuver.attack-of-opportunity.movement',
    promptKey: 'maneuver.attack-of-opportunity.pre-step',
    options: [{
      id: 'attack-of-opportunity.move.struggle',
      labelKey: 'attack-of-opportunity.struggle',
    }],
    allowPass: true,
    timing: 'movement-step',
    priority: 0,
    depth: 0,
  },
})

describe('MapAttackOfOpportunityOverlay', () => {
  it('puts the authorized reaction in a prominent checkpoint card', async () => {
    const view = opportunityWindow()
    const wrapper = mount(MapAttackOfOpportunityOverlay, {
      attachTo: document.body,
      props: {
        summaries: [view.resolution],
        windows: [view],
        actorLabels: { 'moving-token': 'Bulbasaur' },
        eligibleOwnerLabel: 'Defender controller',
        canManage: true,
      },
    })

    await wrapper.vm.$nextTick()
    expect(wrapper.get('.aoo-overlay').attributes('aria-live')).toBe('assertive')
    expect(document.activeElement).toBe(wrapper.get('[data-option-id="attack-of-opportunity.move.struggle"]').element)
    expect(wrapper.text()).toContain('Reaction required')
    expect(wrapper.text()).toContain('Movement paused')
    expect(wrapper.text()).toContain('Bulbasaur is about to leave a threatened space')
    expect(wrapper.text()).toContain('movement will resume from this checkpoint')
    expect(wrapper.text()).toContain('Responder: Defender controller')
    expect(wrapper.text()).not.toContain('post-movement timing remains assisted')

    await wrapper.get('[data-option-id="attack-of-opportunity.move.struggle"]').trigger('click')
    await wrapper.get('.aoo-card__pass').trigger('click')
    await wrapper.get('.aoo-card__focus').trigger('click')
    const gmButtons = wrapper.findAll('.aoo-card__gm-controls button')
    await gmButtons[0]!.trigger('click')
    await gmButtons[1]!.trigger('click')

    const reference = {
      resolutionId: 'resolution-aoo-1',
      windowId: 'attack-of-opportunity.window.1',
    }
    expect(wrapper.emitted('choose')).toEqual([[
      { ...reference, optionId: 'attack-of-opportunity.move.struggle' },
    ]])
    expect(wrapper.emitted('pass')).toEqual([[reference]])
    expect(wrapper.emitted('focusActor')).toEqual([['moving-token']])
    expect(wrapper.emitted('forcePass')).toEqual([[reference]])
    expect(wrapper.emitted('cancel')).toEqual([['resolution-aoo-1']])
    wrapper.unmount()
  })

  it('uses ranged-action copy without claiming that movement will resume', () => {
    const movement = opportunityWindow()
    if (movement.window.kind !== 'reaction') throw new Error('Expected reaction fixture')
    const ranged: PendingMoveResponseWindowView = {
      ...movement,
      resolution: { ...movement.resolution, phase: 'cleanup' },
      window: {
        ...movement.window,
        phase: 'cleanup',
        timing: 'cleanup',
        reasonCode: 'maneuver.attack-of-opportunity.ranged-attack',
      },
    }
    const wrapper = mount(MapAttackOfOpportunityOverlay, {
      props: {
        summaries: [ranged.resolution],
        windows: [ranged],
        actorLabels: { 'moving-token': 'Bulbasaur' },
        eligibleOwnerLabel: 'Defender controller',
      },
    })

    expect(wrapper.text()).toContain('completed an action that provoked this reaction')
    expect(wrapper.text()).not.toContain('movement will resume')
  })

  it('shows a neutral waiting state to viewers without an authorized response window', async () => {
    const view = opportunityWindow()
    const wrapper = mount(MapAttackOfOpportunityOverlay, {
      props: {
        summaries: [view.resolution],
        windows: [],
        actorLabels: { 'moving-token': 'Bulbasaur' },
        eligibleOwnerLabel: 'Current participant',
      },
    })

    expect(wrapper.find('.aoo-waiting').exists()).toBe(true)
    expect(wrapper.text()).toContain('Waiting for an eligible defender to attack or pass')
    expect(wrapper.find('.aoo-card__actions').exists()).toBe(false)

    await wrapper.get('.aoo-waiting .aoo-card__focus').trigger('click')
    expect(wrapper.emitted('focusActor')).toEqual([['moving-token']])
  })

  it('locks response actions and offers exact retry when delivery is uncertain', async () => {
    const view = opportunityWindow()
    const reference = {
      resolutionId: view.resolution.resolutionId,
      windowId: view.window.windowId,
    }
    const wrapper = mount(MapAttackOfOpportunityOverlay, {
      props: {
        summaries: [view.resolution],
        windows: [view],
        eligibleOwnerLabel: 'Defender controller',
        stateByWindow: {
          [pendingMoveResponseWindowKey(reference)]: {
            status: 'uncertain',
            opId: 'op_aooretry001',
            message: 'The response outcome is uncertain.',
          },
        },
      },
    })

    expect(wrapper.get('[data-option-id="attack-of-opportunity.move.struggle"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('The response outcome is uncertain.')
    await wrapper.get('.aoo-card__uncertain button').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([['op_aooretry001']])
    expect(wrapper.emitted('choose')).toBeUndefined()
  })
})
