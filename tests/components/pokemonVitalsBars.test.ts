/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PokemonVitalsBars from '~/components/sheets/PokemonVitalsBars.vue'
import type { CharacterSheet } from '~/types/characterSheet'

const makeAbraSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'test-abra',
  nickname: 'Test Abra',
  species: 'Abra',
  level: 14,
  stats: { hp: { added: 2 } },
  combat: { currentHp: 14, injuries: 2 },
  totalExp: 215,
  ...overrides,
})

const inlineSizePercent = (selector: string, wrapper: ReturnType<typeof mount>): number => {
  const value = (wrapper.find(selector).element as HTMLElement).style.inlineSize
  return Number.parseFloat(value)
}

describe('PokemonVitalsBars', () => {
  it('renders trainer-page HP bars using full Max HP with the injury-blocked fill', () => {
    const wrapper = mount(PokemonVitalsBars, {
      props: { sheet: makeAbraSheet() },
    })

    const hpTrack = wrapper.find('.pokemon-vitals-bars__row--hp .pokemon-vitals-bars__track')
    expect(hpTrack.attributes('data-hp-tier')).toBe('wounded')
    expect(hpTrack.attributes('aria-valuemax')).toBe('39')
    expect(hpTrack.attributes('aria-valuenow')).toBe('14')
    expect(hpTrack.attributes('aria-valuetext')).toContain('injuries block 8 HP')

    expect(wrapper.find('.pokemon-vitals-bars__fill--hp').classes()).toContain('pokemon-vitals-bars__fill--hp-wounded')
    expect(inlineSizePercent('.pokemon-vitals-bars__fill--hp', wrapper)).toBeCloseTo((14 / 39) * 100, 5)

    const blocked = wrapper.find('.pokemon-vitals-bars__blocked')
    expect(blocked.exists()).toBe(true)
    expect(blocked.classes()).toContain('hp-bar__blocked')
    expect(inlineSizePercent('.pokemon-vitals-bars__blocked', wrapper)).toBeCloseTo((8 / 39) * 100, 5)
  })

  it('omits the injury-blocked fill when Max HP is not capped by injuries', () => {
    const wrapper = mount(PokemonVitalsBars, {
      props: { sheet: makeAbraSheet({ combat: { currentHp: 39, injuries: 0 } }) },
    })

    expect(wrapper.find('.pokemon-vitals-bars__blocked').exists()).toBe(false)
    expect(wrapper.find('.pokemon-vitals-bars__track').attributes('data-hp-tier')).toBe('healthy')
    expect(inlineSizePercent('.pokemon-vitals-bars__fill--hp', wrapper)).toBe(100)
  })
})
