/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PendingMoveMovementOverlay from '~/components/isometric/PendingMoveMovementOverlay.vue'

const choices = () => [{
  reference: {
    resolutionId: 'resolution-movement-1',
    windowId: 'movement.destination-window',
    optionId: 'movement.destination.1234abcd.3.0.1',
  },
  actorPlacementId: 'actor-token',
  canonicalMoveId: 'Quick Step',
  destination: { x: 3, y: 0, z: 1 },
  left: 120,
  top: 80,
  disabled: false,
}, {
  reference: {
    resolutionId: 'resolution-movement-2',
    windowId: 'movement.direction-window',
    optionId: 'movement.direction.5678abcd.north-east.4.0.0',
  },
  actorPlacementId: 'other-token',
  canonicalMoveId: 'Directional Step',
  destination: { x: 4, y: 0, z: 0 },
  direction: 'north-east' as const,
  left: 240,
  top: 160,
  disabled: true,
}]

describe('PendingMoveMovementOverlay', () => {
  it('projects authorized cells and submits only durable response IDs', async () => {
    const wrapper = mount(PendingMoveMovementOverlay, {
      props: { choices: choices() },
    })

    expect(wrapper.get('.pending-movement-choice-hud').text()).toContain(
      'Select a server-approved destination on the battlefield.',
    )
    const buttons = wrapper.findAll('.pending-movement-choice-button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.attributes('style')).toContain('left: 120px')
    expect(buttons[0]!.attributes('style')).toContain('top: 80px')
    expect(buttons[0]!.attributes('aria-label')).toBe(
      'Quick Step: choose movement destination (3, 0, 1)',
    )
    expect(buttons[1]!.attributes('aria-label')).toBe(
      'Directional Step: choose North East movement to (4, 0, 0)',
    )
    expect(buttons[1]!.text()).toContain('North East')

    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('choose')).toEqual([[
      {
        resolutionId: 'resolution-movement-1',
        windowId: 'movement.destination-window',
        optionId: 'movement.destination.1234abcd.3.0.1',
      },
    ]])
    expect(wrapper.emitted('choose')?.[0]?.[0]).not.toHaveProperty('destination')
    expect(wrapper.emitted('choose')?.[0]?.[0]).not.toHaveProperty('direction')

    await buttons[1]!.trigger('click')
    expect(wrapper.emitted('choose')).toHaveLength(1)
  })

  it('renders one move-specific prompt and disappears with no authorized options', async () => {
    const wrapper = mount(PendingMoveMovementOverlay, {
      props: { choices: [choices()[0]!] },
    })

    expect(wrapper.get('.pending-movement-choice-hud').text()).toContain(
      'Select a server-approved destination for Quick Step.',
    )
    await wrapper.setProps({ choices: [] })
    expect(wrapper.find('.pending-movement-choice-hud').exists()).toBe(false)
    expect(wrapper.find('.pending-movement-choice-layer').exists()).toBe(false)
  })
})
