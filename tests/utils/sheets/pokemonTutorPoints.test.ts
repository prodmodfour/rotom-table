import { describe, expect, it } from 'vitest'
import {
  computePokemonTutorPointsEarned,
  syncPokemonTutorPointsForSheet,
} from '~/utils/sheets/pokemonTutorPoints'
import type { CharacterSheet } from '~/types/characterSheet'

describe('pokemon tutor points', () => {
  it('computes the PTU level-derived earned tutor point total', () => {
    expect(computePokemonTutorPointsEarned(undefined)).toBe(1)
    expect(computePokemonTutorPointsEarned(1)).toBe(1)
    expect(computePokemonTutorPointsEarned(4)).toBe(1)
    expect(computePokemonTutorPointsEarned(5)).toBe(2)
    expect(computePokemonTutorPointsEarned(10)).toBe(3)
    expect(computePokemonTutorPointsEarned(100)).toBe(21)
  })

  it('syncs earned tutor points while preserving manually tracked spent points', () => {
    const sheet = {
      slug: 'spark',
      nickname: 'Spark',
      species: 'Pikachu',
      level: 15,
      tutorPoints: { earned: 99, spent: 2 },
    } satisfies CharacterSheet

    syncPokemonTutorPointsForSheet(sheet)

    expect(sheet.tutorPoints).toEqual({ earned: 4, spent: 2 })
  })
})
