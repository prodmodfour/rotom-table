import { describe, expect, it } from 'vitest'
import spriteManifest from '~~/data/pokemonSpriteManifest.json'
import backSpriteManifest from '~~/data/pokemonBackSpriteManifest.json'
import { pokemonCatalogBySpecies } from '~~/data/pokemonCatalog'
import { trainerCatalog } from '~~/data/trainerCatalog'
import type { BackSpriteManifestRecord, SpriteManifestRecord } from '~/types/pokemon'
import { toSpriteVisualBounds } from '~/utils/pokemonSpriteVisualBounds'

describe('pokemon catalog visual bounds', () => {
  it('maps front and back manifest visual bounds onto pokemon catalog entries', () => {
    const frontManifestEntry = (spriteManifest as SpriteManifestRecord[])
      .find((entry) => entry.species === 'Aegislash')
    const backManifestEntry = (backSpriteManifest as BackSpriteManifestRecord[])
      .find((entry) => entry.species === 'Aegislash')

    expect(frontManifestEntry?.visual_bounds).toBeDefined()
    expect(backManifestEntry?.visual_bounds).toBeDefined()

    const catalogEntry = pokemonCatalogBySpecies.get('Aegislash')

    expect(catalogEntry?.spriteVisualBounds)
      .toEqual(toSpriteVisualBounds(frontManifestEntry!.visual_bounds))
    expect(catalogEntry?.backSpriteVisualBounds)
      .toEqual(toSpriteVisualBounds(backManifestEntry!.visual_bounds))
  })

  it('does not add pokemon visual-bounds fields to trainer catalog entries', () => {
    expect(trainerCatalog.length).toBeGreaterThan(0)
    expect(trainerCatalog.every((entry) => (
      entry.spriteVisualBounds === undefined && entry.backSpriteVisualBounds === undefined
    ))).toBe(true)
  })
})
