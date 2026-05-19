import { describe, expect, it } from 'vitest'
import { toEditablePokedexRecord, withoutPokedexRuntimeFields } from '~/utils/pokedex/persistence'

describe('pokedex persistence helpers', () => {
  it('removes runtime-only fields from editable records', () => {
    expect(withoutPokedexRuntimeFields({
      species: 'Pikachu',
      id: '25-pikachu',
      slug: 'pikachu',
      nationalDexNumber: 25,
      spriteUrl: '/sprites/pikachu.gif',
      searchText: 'pikachu electric',
      searchTexts: { any: 'pikachu' },
    })).toEqual({ species: 'Pikachu' })
  })

  it('returns null for missing entries', () => {
    expect(toEditablePokedexRecord(null)).toBeNull()
  })
})
