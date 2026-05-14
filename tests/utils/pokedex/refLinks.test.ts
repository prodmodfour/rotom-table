import { describe, expect, it } from 'vitest'
import {
  normalizePokedexReferenceName,
  pokedexReferencePath,
  toPokedexReferenceSlug,
} from '~/utils/pokedex/refLinks'

describe('pokedex lightweight reference links', () => {
  it('builds URL slugs without importing the full reference index', () => {
    expect(toPokedexReferenceSlug('Power-Up Punch')).toBe('power-up-punch')
    expect(toPokedexReferenceSlug("Farfetch’d Trick")).toBe('farfetchd-trick')
  })

  it('strips pokedex-only ability and capability parameters', () => {
    expect(normalizePokedexReferenceName('ability', 'Type Aura (Electric)')).toBe('Type Aura')
    expect(normalizePokedexReferenceName('capability', 'Naturewalk (Grassland, Forest)')).toBe('Naturewalk')
    expect(normalizePokedexReferenceName('capability', 'Mountable 2')).toBe('Mountable')
    expect(normalizePokedexReferenceName('capability', 'Overland 6')).toBe('Overland')
    expect(normalizePokedexReferenceName('capability', 'Jump 2/3')).toBe('Jump')
  })

  it('creates reference paths and handles common aliases', () => {
    expect(pokedexReferencePath('move', 'Thunder Punch')).toBe('/moves/thunder-punch')
    expect(pokedexReferencePath('capability', 'Mountable 2')).toBe('/capabilities/mountable-x')
    expect(pokedexReferencePath('capability', 'Teleporter 4')).toBe('/capabilities/teleporter')
    expect(pokedexReferencePath('capability', 'Throw Range')).toBe('/capabilities/throwing-range')
    expect(pokedexReferencePath('move', '   ')).toBeNull()
  })
})
