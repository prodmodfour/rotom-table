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

  it('renders server-issued movement coordinates without putting them in command intent', async () => {
    const view: PendingMoveResponseWindowView = {
      ...choiceWindow(),
      resolution: {
        ...choiceWindow().resolution,
        canonicalMoveId: 'Movement Choice',
        phase: 'movement',
      },
      window: {
        ...choiceWindow().window,
        windowId: 'movement.destination-window',
        phase: 'movement',
        promptKey: 'move.movement.choose-destination',
        options: [{
          id: 'movement.destination.1234abcd.3.0.1',
          labelKey: 'move.movement.destination',
          selection: {
            kind: 'movement-destination',
            setId: 'movement.destinations',
            destination: { x: 3, y: 0, z: 1 },
          },
        }, {
          id: 'movement.direction.1234abcd.north',
          labelKey: 'move.movement.direction.north',
          selection: {
            kind: 'movement-direction',
            setId: 'movement.directions',
            direction: 'north',
            destination: { x: 1, y: 0, z: 0 },
          },
        }],
      },
    }
    const wrapper = mount(MapMoveResponsePanel, {
      props: { windows: [view], eligibleOwnerLabel: 'Actor controller' },
    })

    expect(wrapper.text()).toContain('Cell (3, 0, 1)')
    expect(wrapper.text()).toContain('North → (1, 0, 0)')
    await wrapper.get('[data-option-id="movement.destination.1234abcd.3.0.1"]').trigger('click')
    expect(wrapper.emitted('choose')).toEqual([[
      {
        resolutionId: 'resolution-pending-1',
        windowId: 'movement.destination-window',
        optionId: 'movement.destination.1234abcd.3.0.1',
      },
    ]])
  })

  it('shows the explicit post-action limitation on durable opportunity responses', () => {
    const view: PendingMoveResponseWindowView = {
      ...choiceWindow(),
      resolution: {
        ...choiceWindow().resolution,
        canonicalMoveId: 'Attack of Opportunity',
        phase: 'cleanup',
      },
      window: {
        windowId: 'attack-of-opportunity.window.1',
        kind: 'reaction',
        phase: 'cleanup',
        reasonCode: 'maneuver.attack-of-opportunity.movement',
        promptKey: 'maneuver.attack-of-opportunity.resolve-after-provoking-action',
        options: [{
          id: 'attack-of-opportunity.move.struggle',
          labelKey: 'attack-of-opportunity.struggle',
        }],
        allowPass: true,
        timing: 'cleanup',
        priority: 0,
        depth: 0,
      },
    }
    const wrapper = mount(MapMoveResponsePanel, {
      props: {
        windows: [view],
        eligibleOwnerLabel: 'Defender controller',
      },
    })

    expect(wrapper.text()).toContain('Durable reaction')
    expect(wrapper.text()).toContain('durable, reconnect-safe')
    expect(wrapper.text()).toContain('post-movement timing remains assisted')
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
