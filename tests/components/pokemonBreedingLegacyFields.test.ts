/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import PokemonKnownMovesPanel from '../../src/components/sheets/PokemonKnownMovesPanel.vue'
import PokemonTrainingPanel from '../../src/components/sheets/PokemonTrainingPanel.vue'
import type { CharacterSheet } from '../../src/types/characterSheet'

const sheet = (): CharacterSheet => ({
  slug: 'pokemon-pika',
  nickname: 'Pika',
  species: 'Pikachu',
  level: 30,
  tutorPoints: { earned: 7, spent: 2 },
  skillBackground: { description: '', raised: [], lowered: [] },
  eggMoves: [{ name: 'Volt Tackle' }, { name: 'Present' }],
  inheritedMoves: { '20': 'Volt Tackle', '100': 'Present' },
  inheritedRemaining: 1,
  appliedMoves: [{ name: 'Thunderbolt', source: 'tm' }],
})

const EditableCellStub = {
  props: ['modelValue', 'readonly'],
  template: '<span class="editable-cell-stub" :data-readonly="readonly === true">{{ modelValue }}</span>',
}

const NuxtLinkStub = {
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
}

afterEach(() => document.body.replaceChildren())

describe('Pokémon sheet breeding compatibility retirement', () => {
  it('renders Egg Move compatibility as read-only and excludes it from the known-Move total', () => {
    const wrapper = mount(PokemonKnownMovesPanel, {
      props: {
        sheet: sheet(),
        unlockedLevelUpMoves: [{ level: 1, name: 'Thunder Shock' }],
      },
      global: { stubs: { EditableCell: EditableCellStub } },
    })

    expect(wrapper.get('.known-moves-summary .block-title').text()).toBe('Known Moves (2)')
    const compatibility = wrapper.get('.egg-move-compatibility')
    expect(compatibility.get('h2').text()).toBe('Egg Move Compatibility (2)')
    expect(compatibility.text()).toContain('Read-only compatibility data. These rows do not establish lineage or learned Moves.')
    expect(compatibility.text()).toContain('Volt Tackle')
    expect(compatibility.find('.editable-cell-stub').exists()).toBe(false)
    expect(compatibility.find('button').exists()).toBe(false)
    expect(compatibility.text()).not.toContain('Add row')
    expect(wrapper.emitted('addEggMove')).toBeUndefined()
    expect(wrapper.emitted('removeEggMove')).toBeUndefined()
  })

  it('locks accepted item-trained rows while retaining controls for editable legacy rows', async () => {
    const itemTrained = sheet()
    itemTrained.appliedMoves = [
      { name: 'Thunderbolt', source: 'tm', itemMoveLearningLocked: true },
      { name: 'Iron Tail', source: 'tutor' },
    ]
    const wrapper = mount(PokemonKnownMovesPanel, {
      props: { sheet: itemTrained, unlockedLevelUpMoves: [] },
      global: { stubs: { EditableCell: EditableCellStub } },
    })

    const rows = wrapper.findAll('tbody').at(2)?.findAll('tr') ?? []
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain('trained')
    expect(rows[0]?.text()).toContain('Item Action')
    expect(rows[0]?.findAll('.editable-cell-stub').every(cell => cell.attributes('data-readonly') === 'true')).toBe(true)
    expect(rows[0]?.find('button[title="Remove applied move"]').exists()).toBe(false)
    expect(rows[1]?.findAll('.editable-cell-stub').every(cell => cell.attributes('data-readonly') === 'false')).toBe(true)
    await rows[1]?.get('button[title="Remove applied move"]').trigger('click')
    expect(wrapper.emitted('removeAppliedMove')).toEqual([[1]])
  })

  it('renders all nine inheritance checkpoints and remaining candidates without mutation controls', () => {
    const wrapper = mount(PokemonTrainingPanel, {
      props: {
        sheet: sheet(),
        tutorPointsEarned: 7,
        tutorPointsLeft: 5,
        skillBgRaisedCsv: '',
        skillBgLoweredCsv: '',
      },
      global: {
        stubs: {
          EditableCell: EditableCellStub,
          NuxtLink: NuxtLinkStub,
        },
      },
    })

    const inheritance = wrapper.get('.inheritance-panel')
    expect(inheritance.get('h2').text()).toBe('Inheritance Checkpoints')
    expect(inheritance.text()).toContain('Only the Breeding Workshop can settle inheritance learning. Legacy values do not establish lineage.')
    expect(inheritance.findAll('.inherited-grid > div')).toHaveLength(9)
    expect(inheritance.text()).toContain('Lvl 100')
    expect(inheritance.text()).toContain('Volt Tackle')
    expect(inheritance.text()).toContain('Present')
    expect(inheritance.text()).toContain('Not learned')
    expect(inheritance.text()).toContain('Remaining candidates: 1')
    expect(inheritance.find('.editable-cell-stub').exists()).toBe(false)
    expect(inheritance.find('input, select, button').exists()).toBe(false)
    expect(inheritance.get('a').attributes('href')).toBe('/breeding')
    expect(inheritance.get('a').text()).toBe('Open Breeding Workshop')
    expect(wrapper.emitted('setInheritedMove')).toBeUndefined()
  })
})
