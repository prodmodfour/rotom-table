/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import EquipmentContributionInspector from '~/components/sheets/EquipmentContributionInspector.vue'
import type { EquipmentContributionProjectionV1 } from '#shared/itemAutomation/equipmentContributions'

const projection = (): EquipmentContributionProjectionV1 => ({
  schemaVersion: 1,
  owner: { kind: 'trainer', slug: 'ash' },
  equipmentRevision: 7,
  inactiveSourceCount: 1,
  values: [{
    metricId: 'skill-check-modifier:athletics',
    metric: 'skill-check-modifier',
    targetId: 'athletics',
    label: 'Athletics modifier',
    base: 1,
    sources: [{
      sourceLabel: 'Running Shoes',
      contributionId: 'equipment.running-shoes.athletics',
      operation: 'add',
      value: 2,
      applied: 2,
      cap: 3,
      conditionLabels: [],
    }],
    final: 3,
    conflict: false,
    unavailableReason: null,
  }, {
    metricId: 'capability-value:swim',
    metric: 'capability-value',
    targetId: 'swim',
    label: 'Swim · Fully submerged',
    base: 4,
    sources: [{
      sourceLabel: 'Flippers',
      contributionId: 'equipment.flippers.swim',
      operation: 'add',
      value: 2,
      applied: 2,
      cap: null,
      conditionLabels: ['Fully submerged'],
    }],
    final: 6,
    conflict: false,
    unavailableReason: null,
  }],
})

describe('EquipmentContributionInspector', () => {
  it('shows inspectable base, named sources, caps, conditions, and final values', () => {
    const wrapper = mount(EquipmentContributionInspector, { props: { projection: projection() } })

    expect(wrapper.text()).toContain('Effective values')
    expect(wrapper.text()).toContain('Active equipment only')
    expect(wrapper.text()).toContain('Base')
    expect(wrapper.text()).toContain('Running Shoes')
    expect(wrapper.text()).toContain('Cap')
    expect(wrapper.text()).toContain('Final')
    expect(wrapper.text()).toContain('Fully submerged')
    expect(wrapper.text()).toContain('1 inactive source contributes no values.')
    expect(wrapper.findAll('details[open]')).toHaveLength(2)
    expect(wrapper.get('summary').attributes('aria-label')).toBeUndefined()
    expect(wrapper.get('.equipment-contribution-equation').attributes('aria-label'))
      .toContain('Base 1. Running Shoes adds 2, capped at 3. Final 3.')
    expect(wrapper.html()).not.toContain('equipped-item:v1:')
    expect(wrapper.html()).not.toContain('canonicalRecordSha256')
  })

  it('fails closed visibly when contribution overrides conflict', () => {
    const value = projection().values[0]!
    const wrapper = mount(EquipmentContributionInspector, {
      props: {
        projection: {
          ...projection(),
          values: [{
            ...value,
            sources: [{
              sourceLabel: 'Heavy Armor',
              contributionId: 'equipment.heavy-armor.speed-default-stage',
              operation: 'set', value: -1, applied: 0, cap: null, conditionLabels: [],
            }, {
              sourceLabel: 'Stat Boosters',
              contributionId: 'equipment.stat-boosters.default-stage',
              operation: 'set', value: 1, applied: 0, cap: null, conditionLabels: [],
            }],
            final: value.base,
            conflict: true,
            unavailableReason: 'Conflicting equipment sources set different default values.',
          }],
        },
      },
    })

    expect(wrapper.get('[role="status"]').text()).toContain('Conflicting equipment sources')
    expect(wrapper.text()).toContain('before relying on this value')
    expect(wrapper.get('ul[aria-label="Conflicting equipment sources"]').text()).toContain('Heavy ArmorSet -1')
    expect(wrapper.get('ul[aria-label="Conflicting equipment sources"]').text()).toContain('Stat BoostersSet +1')
  })
})
