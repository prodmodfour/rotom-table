import { describe, expect, it } from 'vitest'
import { getPokedexEntry } from '~~/data/characterSheets'
import {
  mergeDefaultCapabilities,
  pokedexOtherCapabilityDefaults,
  removeDefaultCapabilitiesForStorage,
  resolvePokemonNaturewalk,
  resolvePokemonOtherCapabilities,
} from '~/utils/sheets/pokemonCapabilities'

describe('pokemon capability list helpers', () => {
  it('omits Naturewalk from Pokédex other capability defaults', () => {
    expect(pokedexOtherCapabilityDefaults(getPokedexEntry('Pikachu')))
      .toEqual(['Zapper', 'Underdog'])
  })

  it('merges Pokédex defaults with sparse sheet extras and value overrides', () => {
    expect(mergeDefaultCapabilities(
      ['Teleporter 2', 'Aura  Reader', 'Underdog'],
      ['Teleporter 4', 'Aura Reader', 'Custom Sense'],
    )).toEqual(['Aura Reader', 'Underdog', 'Teleporter 4', 'Custom Sense'])
  })

  it('keeps legacy sheet Naturewalk entries out of Other while preserving the Naturewalk value', () => {
    const species = getPokedexEntry('Miltank')
    const capabilities = { other: ['Milk Collection', 'Naturewalk (Urban)', 'Custom Sense'] }

    expect(resolvePokemonNaturewalk(species, capabilities)).toBe('Urban')
    expect(resolvePokemonOtherCapabilities(species, capabilities)).toEqual(['Milk Collection', 'Custom Sense'])
  })

  it('stores only non-default non-Naturewalk capabilities from a displayed CSV list', () => {
    expect(removeDefaultCapabilitiesForStorage(
      ['Teleporter 2', 'Underdog', 'Naturewalk (Forest, Urban)', 'Teleporter 4', 'Custom Sense'],
      ['Teleporter 2', 'Underdog'],
    )).toEqual(['Teleporter 4', 'Custom Sense'])
  })

  it('layers move-granted Other capabilities without storing automatic grants', () => {
    const species = getPokedexEntry('Abra')
    const moveDefaults = {
      other: ['Firestarter'],
      valuedBonuses: [{ capability: 'Teleporter', bonus: 4 }],
    }

    expect(resolvePokemonOtherCapabilities(species, undefined, moveDefaults)).toEqual([
      'Teleporter 6',
      'Telekinetic',
      'Telepath',
      'Underdog',
      'Firestarter',
    ])

    expect(removeDefaultCapabilitiesForStorage(
      ['Teleporter 6', 'Firestarter', 'Custom Sense'],
      pokedexOtherCapabilityDefaults(species),
      moveDefaults,
    )).toEqual(['Custom Sense'])

    expect(removeDefaultCapabilitiesForStorage(
      ['Teleporter 8', 'Firestarter', 'Custom Sense'],
      pokedexOtherCapabilityDefaults(species),
      moveDefaults,
    )).toEqual(['Teleporter 4', 'Custom Sense'])
  })
})
