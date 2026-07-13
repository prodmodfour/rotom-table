/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MapCombatLog from '~/components/map/MapCombatLog.vue'
import type { CombatLogMessage } from '~/utils/combatLog'

const moveMessage = (): CombatLogMessage => ({
  id: 'move-1',
  at: 1_000,
  source: 'move',
  operationId: 'op_combatlog001',
  userName: 'Sparky',
  actionName: 'Scratch',
  title: 'Sparky used Scratch.',
  details: ['Target took damage.'],
})

describe('MapCombatLog operation details', () => {
  it('lets an authorized GM inspect the accepted move operation', async () => {
    const wrapper = mount(MapCombatLog, {
      props: {
        messages: [moveMessage()],
        canInspectMoveOperations: true,
      },
    })

    const button = wrapper.get('.combat-log__operation-button')
    expect(button.text()).toBe('Operation details')
    await button.trigger('click')
    expect(wrapper.emitted('inspectMoveOperation')).toEqual([['op_combatlog001']])
  })

  it('does not expose operation controls to players or unrelated log entries', () => {
    const player = mount(MapCombatLog, {
      props: { messages: [moveMessage()], canInspectMoveOperations: false },
    })
    expect(player.find('.combat-log__operation-button').exists()).toBe(false)

    const ability = mount(MapCombatLog, {
      props: {
        messages: [{ ...moveMessage(), source: 'ability' }],
        canInspectMoveOperations: true,
      },
    })
    expect(ability.find('.combat-log__operation-button').exists()).toBe(false)
  })
})
