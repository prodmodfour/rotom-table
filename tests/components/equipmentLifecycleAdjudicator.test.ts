/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import EquipmentLifecycleAdjudicator from '~/components/sheets/EquipmentLifecycleAdjudicator.vue'
import { activeEquipmentState } from '../fixtures/equipment'

const instance = () => ({
  ...activeEquipmentState({
    ownerKind: 'trainer', ownerSlug: 'ash', slotId: 'mainHand', canonicalItemId: 'Hand Net',
    configuration: { configurationId: 'equipment.hand-net.v1', values: { durabilityMaximum: 50 } },
  }).instances[0]!,
  serializedState: {
    equipmentDurability: { schemaVersion: 1, current: 18, maximum: 50 },
  },
})

describe('EquipmentLifecycleAdjudicator', () => {
  it('shows GM-only reviewed durability without authority identities and emits one bounded change', async () => {
    const item = instance()
    const wrapper = mount(EquipmentLifecycleAdjudicator, { props: { instance: item } })
    expect(wrapper.text()).toContain('GM adjudication')
    expect(wrapper.text()).toContain('Durability 18 / 50 HP')
    expect(wrapper.text()).toContain('No change until accepted.')
    expect(wrapper.text()).not.toContain(item.instanceId)
    expect(wrapper.text()).not.toContain(item.source.sourceInstanceId)
    expect(wrapper.get('progress').attributes()).toMatchObject({ value: '18', max: '50' })

    await wrapper.get('#equipment-lifecycle-amount').setValue('8')
    await wrapper.get('#equipment-lifecycle-note').setValue('Net took 8 damage from the accepted attack.')
    expect(wrapper.text()).toContain('18 → 10 HP')
    const commit = wrapper.findAll('button').find(button => button.text() === 'Apply 8 damage')
    expect(commit).toBeDefined()
    await commit!.trigger('click')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      instanceId: item.instanceId,
      commandKind: 'damage',
      amount: 8,
      reason: undefined,
      note: 'Net took 8 damage from the accepted attack.',
    })
  })

  it('restores one exact durable source without rendering its private source identity', async () => {
    const active = instance()
    const privateSource = 'equipment-operation:v1:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    const suppressed = {
      ...active,
      revision: 2,
      activity: {
        status: 'suppressed' as const,
        reasons: [{ code: 'equipment.suppression.guided', sourceId: privateSource }],
      },
    }
    const wrapper = mount(EquipmentLifecycleAdjudicator, { props: { instance: suppressed } })
    expect(wrapper.text()).toContain('Restore activity')
    expect(wrapper.text()).not.toContain(privateSource)
    await wrapper.get('#equipment-lifecycle-note').setValue('The reviewed suppression source ended.')
    const commit = wrapper.findAll('button').find(button => button.text() === 'Restore activity')
    await commit!.trigger('click')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      commandKind: 'restore',
      reason: { code: 'equipment.suppression.guided', sourceId: privateSource },
    })
  })
})
