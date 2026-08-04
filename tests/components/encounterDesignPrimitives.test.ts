/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import EncounterActionCard from '~/components/encounter/EncounterActionCard.vue'
import EncounterDecisionCard from '~/components/encounter/EncounterDecisionCard.vue'
import EncounterInspectorPanel from '~/components/encounter/EncounterInspectorPanel.vue'
import EncounterMotionCue from '~/components/encounter/EncounterMotionCue.vue'
import EncounterParticipantCard from '~/components/encounter/EncounterParticipantCard.vue'
import EncounterStatusChip from '~/components/encounter/EncounterStatusChip.vue'
import EncounterUtilityControl from '~/components/encounter/EncounterUtilityControl.vue'
import type {
  EncounterActionSummary,
  EncounterDecisionSummary,
  EncounterParticipantSummary,
} from '#shared/encounterWorkspace/primitives'

const participant: EncounterParticipantSummary = {
  id: 'luxray',
  name: 'Luxray',
  role: 'Active Pokémon',
  side: { id: 'scarlet', label: 'Mira team', symbol: '◆', color: '#d94b5b' },
  relationship: 'Ally',
  hp: { current: 58, maximum: 68, temporary: 5 },
  conditions: ['Focused'],
  currentTurn: true,
}

const action: EncounterActionSummary = {
  id: 'thunder-fang',
  name: 'Thunder Fang',
  category: 'Attacks and Moves',
  source: 'Move',
  timing: 'Standard Action',
  cost: '1 Standard Action',
  usage: 'At-Will',
  scope: 'One adjacent foe',
  availability: 'available',
}

const decision: EncounterDecisionSummary = {
  id: 'static-response',
  ownerLabel: 'Mira may respond',
  headline: 'Static can activate',
  prompt: 'Choose whether to use Static.',
  publicSummary: 'Waiting for one response.',
  canPass: true,
  canCancel: true,
  options: [
    { id: 'use', label: 'Use Static', selected: true },
    { id: 'invalid', label: 'Invalid target', disabled: true, disabledReason: 'Not eligible.' },
  ],
}

afterEach(() => document.body.replaceChildren())

describe('encounter design primitives', () => {
  it('gives participant identity, side, vitals, condition, selection, and inspection accessible paths', async () => {
    const wrapper = mount(EncounterParticipantCard, {
      attachTo: document.body,
      props: { participant, selected: true, variant: 'owner' },
    })
    expect(wrapper.attributes('aria-label')).toContain('Luxray, Active Pokémon, Mira team, Ally')
    expect(wrapper.attributes('aria-label')).toContain('58 of 68 Hit Points')
    expect(wrapper.text()).toContain('◆')
    expect(wrapper.text()).toContain('Mira team')
    expect(wrapper.get('[data-rt-state="selected"]').exists()).toBe(true)
    expect(wrapper.get('button[aria-pressed="true"]').text()).toContain('Focused')

    await wrapper.get('button[aria-pressed="true"]').trigger('click')
    await wrapper.get('button[aria-label="Inspect Luxray"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['luxray']])
    expect(wrapper.emitted('inspect')).toEqual([['luxray']])
  })

  it('keeps expected unavailable actions and their safe reasons visible', async () => {
    const wrapper = mount(EncounterActionCard, {
      props: {
        action: { ...action, availability: 'unavailable', unavailableReason: 'Standard Action already spent.' },
      },
    })
    expect(wrapper.attributes('data-rt-state')).toBe('unavailable')
    expect(wrapper.text()).toContain('Unavailable: Standard Action already spent.')
    expect(wrapper.get('button[disabled]').text()).toBe('Unavailable')
    await wrapper.get('button:not([disabled])').trigger('click')
    expect(wrapper.emitted('activate')).toBeUndefined()
    expect(wrapper.emitted('inspect')).toEqual([['thunder-fang']])
  })

  it('focuses the active decision heading and uses generic native option/pass/cancel controls', async () => {
    const wrapper = mount(EncounterDecisionCard, {
      attachTo: document.body,
      props: { decision, active: true, focusOnActivate: true },
    })
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    const heading = wrapper.get('h2')
    expect(document.activeElement).toBe(heading.element)
    expect(wrapper.attributes('data-rt-layer')).toBe('decision')
    expect(wrapper.text()).toContain('Others see: Waiting for one response.')
    expect(wrapper.get('button[disabled]').text()).toContain('Not eligible.')

    await wrapper.findAll('.encounter-decision__option')[0]!.trigger('click')
    await wrapper.findAll('footer button')[0]!.trigger('click')
    await wrapper.findAll('footer button')[1]!.trigger('click')
    expect(wrapper.emitted('choose')).toEqual([['static-response', 'use']])
    expect(wrapper.emitted('pass')).toEqual([['static-response']])
    expect(wrapper.emitted('cancel')).toEqual([['static-response']])
  })

  it('makes interactive status and utility controls distinct from read-only status', async () => {
    const readonly = mount(EncounterStatusChip, { props: { label: 'Poisoned', tone: 'danger' } })
    expect(readonly.element.tagName).toBe('SPAN')
    const interactive = mount(EncounterStatusChip, {
      props: { label: 'Selected', tone: 'focus', interactive: true, selected: true },
    })
    expect(interactive.element.tagName).toBe('BUTTON')
    expect(interactive.attributes('aria-pressed')).toBe('true')
    await interactive.trigger('click')
    expect(interactive.emitted('activate')).toEqual([[]])

    const utility = mount(EncounterUtilityControl, {
      props: { label: 'Open tactical view', shortcut: 'T', expanded: false, controls: 'lens' },
    })
    expect(utility.attributes('aria-expanded')).toBe('false')
    expect(utility.attributes('aria-controls')).toBe('lens')
    expect(utility.get('kbd').text()).toBe('T')
    await utility.trigger('click')
    expect(utility.emitted('activate')).toEqual([[]])
  })

  it('omits unauthorized inspector content structurally and exposes authorized detail through details/summary', () => {
    const denied = mount(EncounterInspectorPanel, {
      props: { title: 'Private trace', authorized: false },
      slots: { default: 'secret-option-id' },
    })
    expect(denied.html()).toBe('<!--v-if-->')
    expect(denied.text()).not.toContain('secret-option-id')

    const allowed = mount(EncounterInspectorPanel, {
      props: { title: 'Why available?', authorized: true, open: true },
      slots: { default: 'Three contributions.' },
    })
    expect(allowed.element.tagName).toBe('DETAILS')
    expect(allowed.attributes()).toHaveProperty('open')
    expect(allowed.get('summary').text()).toContain('Why available?')
    expect(allowed.text()).toContain('Three contributions.')
  })

  it('binds every finite motion cue to the shared vocabulary without an ambient loop', () => {
    for (const cue of ['pulse', 'lock', 'sweep', 'travel', 'impact', 'settle', 'correct'] as const) {
      const wrapper = mount(EncounterMotionCue, { props: { cue }, slots: { default: cue } })
      expect(wrapper.attributes('data-rt-motion')).toBe(cue)
      expect(wrapper.text()).toBe(cue)
    }
  })
})
