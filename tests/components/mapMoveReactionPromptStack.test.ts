/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MapMoveReactionPromptStack from '~/components/map/MapMoveReactionPromptStack.vue'
import { LOCAL_MOVE_REACTION_ASSISTANCE_NOTICE } from '~/utils/moveAutomationAssistedFollowUps'

describe('MapMoveReactionPromptStack', () => {
  it('labels every browser-local reaction as an assisted non-durable follow-up', async () => {
    const wrapper = mount(MapMoveReactionPromptStack, {
      props: {
        moxiePrompts: [{
          id: 'moxie-1',
          attackerId: 'attacker',
          attackerName: 'Sandile',
          moveName: 'Bite',
          faintedTargetIds: ['target'],
          faintedTargetNames: ['Abra'],
        }],
        celebratePrompts: [{
          id: 'celebrate-1',
          attackerId: 'attacker',
          attackerName: 'Sandile',
          moveName: 'Bite',
          hitTargetIds: ['target'],
          hitTargetNames: ['Abra'],
        }],
        cuteCharmPrompts: [{
          id: 'cute-charm-1',
          defenderId: 'defender',
          defenderName: 'Skitty',
          attackerId: 'attacker',
          attackerName: 'Sandile',
          moveName: 'Bite',
        }],
        poisonPointPrompts: [{
          id: 'poison-point-1',
          defenderId: 'defender',
          defenderName: 'Nidoran',
          attackerId: 'attacker',
          attackerName: 'Sandile',
          moveName: 'Bite',
        }],
        spitePrompts: [{
          id: 'spite-1',
          defenderId: 'defender',
          defenderName: 'Shuppet',
          attackerId: 'attacker',
          attackerName: 'Sandile',
          moveName: 'Bite',
        }],
      },
    })

    expect(wrapper.findAll('.reaction-prompt__eyebrow').map((entry) => entry.text())).toEqual([
      'Assisted follow-up · Moxie',
      'Assisted follow-up · Celebrate',
      'Assisted follow-up · Cute Charm',
      'Assisted follow-up · Poison Point',
      'Assisted follow-up · Spite',
    ])
    expect(wrapper.findAll('.reaction-prompt__limitation')).toHaveLength(5)
    expect(wrapper.findAll('.reaction-prompt__limitation').every(
      (entry) => entry.text() === LOCAL_MOVE_REACTION_ASSISTANCE_NOTICE,
    )).toBe(true)
    expect(wrapper.text()).toContain('cannot interrupt that move')
    expect(wrapper.text()).toContain('not restored after refresh or reconnect')

    for (const button of wrapper.findAll('.reaction-prompt__apply')) await button.trigger('click')

    expect(wrapper.emitted('apply-moxie')).toEqual([['moxie-1']])
    expect(wrapper.emitted('apply-celebrate')).toEqual([['celebrate-1']])
    expect(wrapper.emitted('apply-cute-charm')).toEqual([['cute-charm-1']])
    expect(wrapper.emitted('apply-poison-point')).toEqual([['poison-point-1']])
    expect(wrapper.emitted('apply')).toEqual([['spite-1']])
  })
})
