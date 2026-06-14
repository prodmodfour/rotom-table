import { describe, expect, it } from 'vitest'
import { resolvePokemonSheetTypes } from '~/utils/sheets/pokemonTypes'
import type { CharacterSheet } from '~/types/characterSheet'

const makePokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'bolt',
  nickname: 'Bolt',
  species: 'Pikachu',
  level: 12,
  ...overrides,
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
