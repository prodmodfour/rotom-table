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
      profileSpriteUrl: '/api/profile-sprites/pokemon/pikachu',
      spriteVisualBounds: {
        canvasWidth: 50,
        canvasHeight: 46,
        left: 0,
        top: 0,
        width: 50,
        height: 46,
        floating: false,
      },
      backSpriteVisualBounds: {
        canvasWidth: 80,
        canvasHeight: 80,
        left: 12,
        top: 10,
        width: 58,
        height: 60,
        floating: true,
      },
      searchText: 'pikachu electric',
      searchTexts: { any: 'pikachu' },
    })).toEqual({ species: 'Pikachu' })
  })

  it('returns null for missing entries', () => {
    expect(toEditablePokedexRecord(null)).toBeNull()
  })
})
