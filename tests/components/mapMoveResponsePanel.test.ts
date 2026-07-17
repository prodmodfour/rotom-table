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

  it('renders authorized item and destination metadata while submitting only the opaque option ID', async () => {
    const view: PendingMoveResponseWindowView = {
      ...choiceWindow(),
      resolution: {
        ...choiceWindow().resolution,
        canonicalMoveId: 'Item Choice',
        phase: 'after-damage',
      },
      window: {
        ...choiceWindow().window,
        windowId: 'item-choice.window',
        phase: 'after-damage',
        promptKey: 'move.item-choice.choose',
        options: [{
          id: 'item.choice.0123456789abcdef',
          labelKey: 'move.item.choice',
          itemChoice: {
            canonicalItemId: 'super-potion',
            destinationKind: 'target-held',
            destinationLabelKey: 'move.item.destination.target',
          },
        }],
      },
    }
    const wrapper = mount(MapMoveResponsePanel, {
      props: { windows: [view], eligibleOwnerLabel: 'Actor controller' },
    })

    expect(wrapper.text()).toContain('Super Potion → Target')
    expect(wrapper.text()).toContain('server-verified item and destination')
    expect(wrapper.text()).toContain('Private inventory locations stay hidden')
    await wrapper.get('[data-option-id="item.choice.0123456789abcdef"]').trigger('click')
    expect(wrapper.emitted('choose')).toEqual([[
      {
        resolutionId: 'resolution-pending-1',
        windowId: 'item-choice.window',
        optionId: 'item.choice.0123456789abcdef',
      },
    ]])
  })

  it('delegates multi-cell hazard choices to the battlefield overlay', async () => {
    const view: PendingMoveResponseWindowView = {
      ...choiceWindow(),
      resolution: {
        ...choiceWindow().resolution,
        resolutionId: 'resolution-hazard-1',
        canonicalMoveId: 'Spikes',
        phase: 'schedule',
      },
      window: {
        windowId: 'hazard.select-cells',
        kind: 'choice',
        phase: 'schedule',
        reasonCode: 'move.spikes.choose-cells',
        promptKey: 'move.spikes.choose-cells',
        options: [{
          id: 'hazard.cell.1234abcd.1.0.1',
          labelKey: 'move.hazard.select-cell',
        }],
        allowPass: false,
        priority: null,
        hazardCellSelection: {
          schemaVersion: 1,
          windowId: 'hazard.select-cells',
          promptKey: 'move.spikes.choose-cells',
          map: { slug: 'pending-arena', revision: 12 },
          move: {
            resolutionId: 'resolution-hazard-1',
            actorPlacementId: 'actor-token',
            canonicalMoveId: 'Spikes',
          },
          count: { kind: 'exact', count: 1 },
          origin: { x: 0, y: 0, z: 0 },
          range: 3,
          adjacency: 'orthogonal',
          connectedness: 'none',
          occupancy: 'empty-of-placements',
          geometry: { kind: 'horizontal-plane' },
          options: [{
            id: 'hazard.cell.1234abcd.1.0.1',
            cell: { x: 1, y: 0, z: 1 },
          }],
        },
      },
    }
    const wrapper = mount(MapMoveResponsePanel, {
      props: {
        windows: [view],
        eligibleOwnerLabel: 'Actor controller',
        canManage: true,
      },
    })

    expect(wrapper.text()).toContain('Select the authorized cells on the battlefield')
    expect(wrapper.findAll('.move-response-card__option')).toHaveLength(0)
    expect(wrapper.find('.move-response-card__pass').exists()).toBe(false)
    const gmButtons = wrapper.findAll('.move-response-card__gm-controls button')
    expect(gmButtons).toHaveLength(1)
    expect(gmButtons[0]!.text()).toContain('Cancel resolution')
    await gmButtons[0]!.trigger('click')
    expect(wrapper.emitted('cancel')).toEqual([['resolution-hazard-1']])
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
