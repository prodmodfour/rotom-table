import { describe, expect, it } from 'vitest'
import { getPokedexEntry } from '~~/data/characterSheets'
import {
  mergeDefaultCapabilities,
  pokedexOtherCapabilityDefaults,
  removeDefaultCapabilitiesForStorage,
} from '~/utils/sheets/pokemonCapabilities'

describe('pokemon capability list helpers', () => {
  it('keeps Naturewalk in Pokédex other capability defaults', () => {
    expect(pokedexOtherCapabilityDefaults(getPokedexEntry('Pikachu')))
      .toContain('Naturewalk (Forest, Urban)')
  })

  it('merges Pokédex defaults with sparse sheet extras and value overrides', () => {
    expect(mergeDefaultCapabilities(
      ['Teleporter 2', 'Aura  Reader', 'Underdog'],
      ['Teleporter 4', 'Aura Reader', 'Custom Sense'],
    )).toEqual(['Aura Reader', 'Underdog', 'Teleporter 4', 'Custom Sense'])
  })

  it('stores only non-default capabilities from a displayed CSV list', () => {
    expect(removeDefaultCapabilitiesForStorage(
      ['Teleporter 2', 'Underdog', 'Teleporter 4', 'Custom Sense'],
      ['Teleporter 2', 'Underdog'],
    )).toEqual(['Teleporter 4', 'Custom Sense'])
  })
})
