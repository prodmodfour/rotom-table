import { describe, expect, it } from 'vitest'
import spriteManifest from '~~/data/pokemonSpriteManifest.json'
import backSpriteManifest from '~~/data/pokemonBackSpriteManifest.json'
import { findPokedexEntryDetail } from '../../server/utils/pokedexRepository'
import type { BackSpriteManifestRecord, SpriteManifestRecord } from '~/types/pokemon'
import { toSpriteVisualBounds } from '~/utils/pokemonSpriteVisualBounds'

describe('Pokédex repository visual bounds', () => {
  it('exposes front and back sprite visual bounds on detail responses', () => {
    const frontManifestEntry = (spriteManifest as SpriteManifestRecord[])
      .find((entry) => entry.species === 'Aegislash')
    const backManifestEntry = (backSpriteManifest as BackSpriteManifestRecord[])
      .find((entry) => entry.species === 'Aegislash')

    expect(frontManifestEntry?.visual_bounds).toBeDefined()
    expect(backManifestEntry?.visual_bounds).toBeDefined()

    const detail = findPokedexEntryDetail('aegislash')

    expect(detail?.spriteVisualBounds)
      .toEqual(toSpriteVisualBounds(frontManifestEntry!.visual_bounds))
    expect(detail?.backSpriteVisualBounds)
      .toEqual(toSpriteVisualBounds(backManifestEntry!.visual_bounds))
  })
})
