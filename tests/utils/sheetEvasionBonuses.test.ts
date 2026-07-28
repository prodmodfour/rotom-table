import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import { pokemonEvasionModifiers } from '~/utils/sheetEvasionBonuses'

describe('sheet Evasion bonuses after Ability runtime retirement', () => {
  it('ignores historical browser activation flags for Sand Veil and Snow Cloak', () => {
    const base = {
      slug: 'veil',
      nickname: 'Veil',
      species: 'Eevee',
      level: 1,
      combat: { evasion: { vsAtkBonus: 1, vsSatkBonus: 2, vsAnyBonus: 3 } },
      abilities: [],
      items: {},
    } as CharacterSheet
    const expected = pokemonEvasionModifiers(base)

    expect(pokemonEvasionModifiers({
      ...base,
      abilities: [{ name: 'Sand Veil', activated: true }],
    })).toEqual(expected)
    expect(pokemonEvasionModifiers({
      ...base,
      abilities: [{ name: 'Snow Cloak', activated: true }],
    })).toEqual(expected)
  })
})
