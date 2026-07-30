import { describe, expect, it } from 'vitest'
import { resolvePokemonSheetTypes } from '~/utils/sheets/pokemonTypes'
import type { CharacterSheet } from '~/types/characterSheet'
import { canonicalPokemonType, computeMultiplier } from '~/utils/typeChart'

const makePokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'bolt',
  nickname: 'Bolt',
  species: 'Pikachu',
  level: 12,
  ...overrides,
})

describe('type effectiveness', () => {
  it('canonicalizes lowercase authoritative token types before chart lookup', () => {
    expect(canonicalPokemonType(' psychic ')).toBe('Psychic')
    expect(computeMultiplier('psychic', ['dark'])).toBe(0)
    expect(computeMultiplier('fighting', ['normal'])).toBe(1.5)
    expect(computeMultiplier('unknown', ['normal'])).toBe(1)
  })
})

describe('pokemonTypes', () => {
  it('resolves species default types when a sheet has no override', () => {
    expect(resolvePokemonSheetTypes(makePokemon())).toEqual(['Electric'])
  })

  it('uses sheet type overrides and removes blank or duplicate badges', () => {
    expect(resolvePokemonSheetTypes(makePokemon({
      types: [' Fire ', 'fire', '', 'Flying'],
    }))).toEqual(['Fire', 'Flying'])
  })

  it('returns no badges for missing sheets or unknown species', () => {
    expect(resolvePokemonSheetTypes(null)).toEqual([])
    expect(resolvePokemonSheetTypes(makePokemon({ species: 'Not a Pokémon' }))).toEqual([])
  })
})
