/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PokemonEvolutionAttentionCard from '~/components/sheets/PokemonEvolutionAttentionCard.vue'
import PokemonIdentityPanel from '~/components/sheets/PokemonIdentityPanel.vue'
import PokemonAbilitiesEdgesPanel from '~/components/sheets/PokemonAbilitiesEdgesPanel.vue'
import type { CharacterSheet } from '~/types/characterSheet'

const sheet = (): CharacterSheet => ({
  slug: 'volt', nickname: 'Volt', species: 'Raichu', level: 25, revision: 5,
  nature: 'Hardy', gender: 'Male', stats: { hp: { added: 5 } },
  abilities: [
    { name: 'Static', itemEvolutionLocked: true },
    { name: 'Motor Drive', itemEvolutionLocked: true },
  ],
  edges: [],
  itemEvolutionLocked: true,
  itemEvolutionAttention: {
    schemaVersion: 1,
    fromSpecies: 'Pikachu', toSpecies: 'Raichu', canonicalItemName: 'Thunder Stone', appliedAt: 20_000,
    statAllocation: { status: 'open', required: 35, allocated: 0 },
    moveOpportunities: [],
    abilityChanges: [{ from: 'Static', to: 'Static' }, { from: 'Cute Charm', to: 'Motor Drive' }],
    inactiveEquipmentItems: ['Eviolite'],
  },
})

const EditableCellStub = {
  name: 'EditableCell',
  inheritAttrs: false,
  props: ['modelValue', 'readonly', 'type'],
  template: '<span class="editable-cell-stub" :data-readonly="readonly === true" :data-type="type">{{ modelValue }}</span>',
}
const NuxtLinkStub = { props: ['to'], template: '<a :href="to"><slot /></a>' }

describe('Pokémon evolution workflow components', () => {
  it('keeps unresolved Stat work and zero Move decisions visible without private provenance', () => {
    const wrapper = mount(PokemonEvolutionAttentionCard, {
      props: { sheet: sheet(), statPointsSpent: 5, statPointsBudget: 35, statPointsLeft: 30, saveStatus: 'idle' },
    })
    expect(wrapper.text()).toContain('Follow-up required')
    expect(wrapper.text()).toContain('Pikachu')
    expect(wrapper.text()).toContain('Raichu')
    expect(wrapper.text()).toContain('5 / 35 Stat Points allocated')
    expect(wrapper.text()).toContain('No new Move decision')
    expect(wrapper.text()).toContain('Static → Static, Cute Charm → Motor Drive')
    expect(wrapper.text()).toContain('Equipment needs review')
    expect(wrapper.text()).toContain('Eviolite')
    expect(wrapper.html()).not.toContain('sourceOperationId')
    expect(wrapper.html()).not.toContain('ruleRecordSha256')
  })

  it('announces a locally complete allocation pending server certification and a resolved record', async () => {
    const source = sheet()
    const wrapper = mount(PokemonEvolutionAttentionCard, {
      props: { sheet: source, statPointsSpent: 35, statPointsBudget: 35, statPointsLeft: 0, saveStatus: 'idle' },
    })
    expect(wrapper.text()).toContain('All 35 Stat Points allocated · save to certify')
    await wrapper.setProps({
      sheet: {
        ...source,
        itemEvolutionAttention: {
          ...source.itemEvolutionAttention!,
          statAllocation: { status: 'resolved', required: 35, allocated: 35 },
        },
      },
    })
    expect(wrapper.text()).toContain('Evolution record')
    expect(wrapper.text()).toContain('35 Stat Points allocated')
  })

  it('renders accepted species as read-only and locks Level and Nature during allocation', () => {
    const wrapper = mount(PokemonIdentityPanel, {
      props: {
        sheet: sheet(), spriteUrl: null, sheetTypes: ['Electric'],
        levelFromExperience: 25, levelIsExperienceDerived: true, experienceToNextLevel: 1_000,
        genderOptions: ['Male', 'Female'], natureOptions: ['Hardy'],
        naturePlusDisplay: '—', natureMinusDisplay: '—', canEditSheet: true, canManagePlayerAccess: true,
        eggGroupsCsv: 'Field',
      },
      global: {
        stubs: {
          EditableCell: EditableCellStub,
          NuxtLink: NuxtLinkStub,
          TypeBadge: { props: ['type'], template: '<span>{{ type }}</span>' },
          ItemSprite: { template: '<span />' },
        },
      },
    })
    expect(wrapper.get('.identity__species .editable-cell-stub').attributes('data-readonly')).toBe('true')
    expect(wrapper.text()).toContain('Evolved')
    const readonlyValues = wrapper.findAll('.editable-cell-stub[data-readonly="true"]').map(row => row.text())
    expect(readonlyValues).toEqual(expect.arrayContaining(['Raichu', '25', 'Hardy']))
  })

  it('makes mapped Ability rows read-only and removes destructive row controls', () => {
    const source = sheet()
    const abilityRows = source.abilities!.map(ability => ({ ability, reference: null }))
    const wrapper = mount(PokemonAbilitiesEdgesPanel, {
      props: { sheet: source, abilityRows },
      global: { stubs: { EditableCell: EditableCellStub } },
    })
    const abilityTable = wrapper.findAll('section')[0]!
    expect(abilityTable.findAll('.editable-cell-stub[data-readonly="true"]')).toHaveLength(2)
    expect(abilityTable.text()).toContain('Evolved')
    expect(abilityTable.findAll('button[title="Remove ability"]')).toHaveLength(0)
    expect(abilityTable.find('button').text()).toContain('Add row')
  })
})
