/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import EquipmentEncounterActionSummary from '~/components/sheets/EquipmentEncounterActionSummary.vue'

const mountSummary = (sources: InstanceType<typeof EquipmentEncounterActionSummary>['$props']['sources']) => mount(
  EquipmentEncounterActionSummary,
  {
    props: { sources },
    global: { stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  },
)

describe('equipment encounter action summary', () => {
  it('explains reviewed encounter-only timing, targets, authority, and continuation without an inert use button', () => {
    const wrapper = mountSummary([{
      canonicalItemId: 'Weighted Nets', activityStatus: 'active',
    }])
    expect(wrapper.text()).toContain('Live encounter actions')
    expect(wrapper.text()).toContain('Throw Weighted Net')
    expect(wrapper.text()).toContain('Pull Weighted Net')
    expect(wrapper.text()).toContain('Standard Action · Pokémon within 4 meters')
    expect(wrapper.text()).toContain('Offered from the Action Dock only when current target, terrain, timing, and resource authority allow it.')
    expect(wrapper.get('a').attributes('href')).toContain('/play')
    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it('states the exact public inactivity reason without exposing custody identity', () => {
    const wrapper = mountSummary([{
      canonicalItemId: 'Glue Cannon', activityStatus: 'broken', unavailableReason: 'Durability is depleted.',
    }])
    expect(wrapper.text()).toContain('Fire Glue Cannon')
    expect(wrapper.text()).toContain('Unavailable while this item is broken · Durability is depleted.')
    expect(wrapper.text()).not.toContain('depleted..')
    expect(wrapper.html()).not.toContain('instanceId')
  })

  it('reports an action as active when any duplicate canonical source is active', () => {
    const wrapper = mountSummary([{
      canonicalItemId: 'Hand Net', activityStatus: 'broken', unavailableReason: 'Durability is depleted.',
    }, {
      canonicalItemId: 'Hand Net', activityStatus: 'active',
    }])
    expect(wrapper.findAll('li')).toHaveLength(1)
    expect(wrapper.get('li').attributes('data-available')).toBe('true')
    expect(wrapper.text()).toContain('Offered from the Action Dock')
    expect(wrapper.text()).not.toContain('Unavailable while')
  })
})
