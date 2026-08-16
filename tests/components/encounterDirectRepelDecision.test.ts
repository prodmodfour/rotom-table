/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import EncounterDirectRepelDecision from '~/components/encounter/workspace/EncounterDirectRepelDecision.vue'
import type { DirectRepelPositioningProjectionV1 } from '~/composables/encounter/useMapItemExploration'

const decision = (): DirectRepelPositioningProjectionV1 => ({
  decisionId: 'item-repel-position:v1:44444444444444444444444444444444',
  itemLabel: 'Repel',
  sourcePlacementId: 'trainer-placement',
  sourceLabel: 'Explorer',
  sourcePosition: { x: 1, y: 0, z: 1 },
  targetPlacementId: 'wild-placement',
  targetLabel: 'Wild Rattata',
  targetPosition: { x: 2, y: 0, z: 1 },
  destinationBounds: { x: [0, 9], y: [0, 2], z: [0, 5] },
  maximumAffectedWildLevel: 15,
  prompt: 'Choose one legal Shift endpoint farther from the source.',
})

describe('EncounterDirectRepelDecision', () => {
  it('requires a changed bounded exact endpoint and emits only the selected decision identity', async () => {
    const current = decision()
    const wrapper = mount(EncounterDirectRepelDecision, {
      props: { decisions: [current], status: 'idle', message: null, busy: false, commandsBlocked: false },
    })
    expect(wrapper.text()).toContain('Explorer')
    expect(wrapper.text()).toContain('Wild Rattata')
    expect(wrapper.text()).toContain('schedules forfeiture of its next Shift Action')
    const submit = wrapper.get('button[type="submit"]')
    expect(submit.attributes('disabled')).toBeDefined()
    const x = wrapper.findAll('input').find(input => input.attributes('aria-describedby') === 'direct-repel-x-bounds')!
    await x.setValue('5')
    expect(submit.attributes('disabled')).toBeUndefined()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('settle')).toEqual([[current.decisionId, { x: 5, y: 0, z: 1 }]])
  })

  it('locks endpoint editing while uncertain and exposes exact retry as the only recovery action', () => {
    const wrapper = mount(EncounterDirectRepelDecision, {
      props: {
        decisions: [decision()], status: 'uncertain', message: 'Settlement uncertain.',
        busy: false, commandsBlocked: false,
      },
    })
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    expect(wrapper.get('form button').attributes('disabled')).toBeDefined()
    const retry = wrapper.findAll('button').find(button => button.text().includes('Retry exact command'))!
    expect(retry.attributes('disabled')).toBeUndefined()
  })
})
