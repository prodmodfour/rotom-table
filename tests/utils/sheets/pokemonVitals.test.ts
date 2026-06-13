import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import { resolvePokemonHpProgress, resolvePokemonVitalsProgress } from '~/utils/sheets/pokemonVitals'

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

describe('pokemon vitals progress helpers', () => {
  it('resolves injury-adjusted Pokémon HP progress', () => {
    expect(resolvePokemonHpProgress(makeAbraSheet())).toEqual({
      currentHp: 14,
      maxHp: 31,
      fullMaxHp: 39,
      percent: expect.closeTo(45.16129, 5),
    })
  })

  it('defaults missing current HP to the effective maximum HP', () => {
    expect(resolvePokemonHpProgress(makeAbraSheet({ combat: { injuries: 0 } }))).toMatchObject({
      currentHp: 39,
      maxHp: 39,
      fullMaxHp: 39,
      percent: 100,
    })
  })

  it('combines HP and current-level experience progress for player Pokémon cards', () => {
    expect(resolvePokemonVitalsProgress(makeAbraSheet())).toMatchObject({
      hp: { currentHp: 14, maxHp: 31, fullMaxHp: 39 },
      experience: {
        level: 14,
        nextLevel: 15,
        currentExp: 25,
        neededExp: 30,
        remainingExp: 5,
      },
    })
  })
})
