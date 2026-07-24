/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MapAbilityAutomationPanel from '~/components/map/MapAbilityAutomationPanel.vue'

const idle = { kind: 'idle' } as const

describe('MapAbilityAutomationPanel', () => {
  it('renders keyboard buttons for server-issued modes and generic options', async () => {
    const modes = mount(MapAbilityAutomationPanel, {
      props: {
        modeSelection: {
          placementId: 'actor', abilityInstanceId: 'base:actor:0', canonicalId: 'Abominable',
          displayName: 'Abominable',
          modes: [
            { modeId: 'first', kind: 'activated', invocable: true, targeting: [] },
            { modeId: 'second', kind: 'activated', invocable: true, targeting: [] },
          ],
        },
        declaration: null,
        status: { kind: 'selecting' },
      },
    })
    expect(modes.get('section').attributes('aria-label')).toBe('Ability automation')
    await modes.findAll('.choices button')[1]!.trigger('click')
    expect(modes.emitted('selectMode')).toEqual([['second']])

    const choices = mount(MapAbilityAutomationPanel, {
      props: {
        modeSelection: null,
        declaration: {
          offer: {
            schemaVersion: 1, offerId: 'offer:1', offerSha256: 'a'.repeat(64),
            mapSlug: 'arena-map', mapRevision: 4, expiresAt: 10_000,
            actorPlacementId: 'actor', abilityInstanceId: 'base:actor:0',
            canonicalId: 'Abominable', modeId: 'activate',
            declarations: [{
              declarationId: 'target', kind: 'token', minSelections: 1, maxSelections: 1,
              options: [{ optionId: 'target:one', presentationKey: 'ability.target', hint: { kind: 'placement', placementId: 'target' } }],
            }],
          },
          selectedOptionIds: { target: [] },
        },
        status: { kind: 'selecting' },
      },
    })
    const option = choices.get('fieldset button')
    expect(option.attributes('aria-pressed')).toBe('false')
    await option.trigger('click')
    expect(choices.emitted('toggleOption')).toEqual([['target', 'target:one']])
    expect(choices.get('.declarations > button').attributes()).toHaveProperty('disabled')
  })

  it('announces pending, accepted, and uncertain recovery states without mechanics', async () => {
    const pendingResult = {
      schemaVersion: 1, kind: 'pending', operationId: 'intent:1', resolutionId: 'resolution:1',
      mapSlug: 'arena-map', previousRevision: 4, revision: 5, status: 'pending', phase: 'effect',
      outstandingWindowCount: 1, createdAt: 1_000, updatedAt: 1_000,
      presentation: { key: 'ability.resolution.pending', outcome: null },
    } as const
    const wrapper = mount(MapAbilityAutomationPanel, {
      props: { modeSelection: null, declaration: null, status: { kind: 'pending', result: pendingResult } },
    })
    expect(wrapper.text()).toContain('Waiting for an authoritative response')
    await wrapper.setProps({
      status: {
        kind: 'accepted',
        result: {
          schemaVersion: 1, kind: 'accepted', operationId: 'intent:1', resolutionId: 'resolution:1',
          mapSlug: 'arena-map', previousRevision: 4, revision: 5, status: 'committed',
          presentation: { key: 'ability.resolution.completed', outcome: 'applied' },
        },
        controllerPresentationKey: 'ability.anticipation.super-effective-present',
      },
    })
    expect(wrapper.text()).toContain('target has at least one super-effective damaging move')
    await wrapper.setProps({
      status: {
        kind: 'accepted',
        result: {
          schemaVersion: 1, kind: 'accepted', operationId: 'intent:2', resolutionId: 'resolution:2',
          mapSlug: 'arena-map', previousRevision: 5, revision: 6, status: 'committed',
          presentation: { key: 'ability.resolution.completed', outcome: 'applied' },
        },
        controllerPresentationKey: 'ability.forewarn.moves-revealed',
        controllerPresentationValues: ['Giga Impact', 'Hyper Beam'],
      },
    })
    expect(wrapper.text()).toContain('Highest Damage Dice Moves: Giga Impact, Hyper Beam.')
    await wrapper.setProps({ status: { kind: 'uncertain', message: 'Connection lost', intentId: 'intent:1' } })
    expect(wrapper.get('[role="alert"]').text()).toContain('Connection lost')
    await wrapper.get('[role="alert"] button').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([[]])
    await wrapper.setProps({ status: idle })
    expect(wrapper.find('section').exists()).toBe(false)
  })
})
