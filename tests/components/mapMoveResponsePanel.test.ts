/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MapMoveResponsePanel from '~/components/map/MapMoveResponsePanel.vue'
import { pendingMoveResponseWindowKey } from '~/composables/map-editor/usePendingMoveResponses'
import type { PendingMoveResponseWindowView } from '#shared/moveAutomation/responseViews'

const choiceWindow = (): PendingMoveResponseWindowView => ({
  schemaVersion: 1,
  resolution: {
    schemaVersion: 1,
    resolutionId: 'resolution-pending-1',
    actorPlacementId: 'actor-token',
    canonicalMoveId: 'Pending Test',
    phase: 'hit',
    status: 'pending',
    outstandingWindowCount: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  window: {
    windowId: 'window.branch',
    kind: 'choice',
    phase: 'hit',
    reasonCode: 'move.pending-test.choose',
    promptKey: 'move.pending-test.choose',
    options: [
      { id: 'option.attack', labelKey: 'move.pending-test.attack' },
      { id: 'option.support', labelKey: 'move.pending-test.support' },
    ],
    allowPass: true,
    priority: null,
  },
})

const reference = {
  resolutionId: 'resolution-pending-1',
  windowId: 'window.branch',
} as const

describe('MapMoveResponsePanel', () => {
  it('shows safe move context, eligible owner, options, pass, and GM controls', async () => {
    const wrapper = mount(MapMoveResponsePanel, {
      props: {
        windows: [choiceWindow()],
        actorLabels: { 'actor-token': 'Pikachu' },
        eligibleOwnerLabel: 'Game Master',
        canManage: true,
      },
    })

    expect(wrapper.text()).toContain('Durable choice')
    expect(wrapper.text()).toContain('Pending Test')
    expect(wrapper.text()).toContain('Pikachu')
    expect(wrapper.text()).toContain('Eligible responder')
    expect(wrapper.text()).toContain('Game Master')
    expect(wrapper.text()).toContain('Attack')
    expect(wrapper.text()).toContain('Support')
    expect(wrapper.find('.move-response-card__state').text()).toBe('pending')

    await wrapper.get('[data-option-id="option.attack"]').trigger('click')
    await wrapper.get('.move-response-card__pass').trigger('click')
    const gmButtons = wrapper.findAll('.move-response-card__gm-controls button')
    await gmButtons[0]!.trigger('click')
    await gmButtons[1]!.trigger('click')

    expect(wrapper.emitted('choose')).toEqual([[{ ...reference, optionId: 'option.attack' }]])
    expect(wrapper.emitted('pass')).toEqual([[reference]])
    expect(wrapper.emitted('forcePass')).toEqual([[reference]])
    expect(wrapper.emitted('cancel')).toEqual([['resolution-pending-1']])
  })

  it('locks labels out of command intent and exposes exact retry only for uncertainty', async () => {
    const view = choiceWindow()
    const key = pendingMoveResponseWindowKey(reference)
    const wrapper = mount(MapMoveResponsePanel, {
      props: {
        windows: [view],
        eligibleOwnerLabel: 'Misty',
        stateByWindow: {
          [key]: {
            status: 'uncertain',
            opId: 'op_response001',
            message: 'The terminal response was lost.',
          },
        },
      },
    })

    expect(wrapper.find('.move-response-card__state').text()).toBe('uncertain')
    expect(wrapper.text()).toContain('The terminal response was lost.')
    expect(wrapper.get('[data-option-id="option.attack"]').attributes('disabled')).toBeDefined()

    await wrapper.get('.move-response-card__uncertain button').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([['op_response001']])
    expect(wrapper.emitted('choose')).toBeUndefined()
  })
})
