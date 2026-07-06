import { describe, expect, it } from 'vitest'
import spriteManifest from '~~/data/pokemonSpriteManifest.json'
import backSpriteManifest from '~~/data/pokemonBackSpriteManifest.json'
import { pokemonCatalogBySpecies } from '~~/data/pokemonCatalog'
import { trainerCatalog } from '~~/data/trainerCatalog'
import type { BackSpriteManifestRecord, SpriteManifestRecord } from '~/types/pokemon'
import { toSpriteVisualBounds } from '~/utils/pokemonSpriteVisualBounds'

const frontSpriteEntry = (species: string): SpriteManifestRecord | undefined => (
  (spriteManifest as SpriteManifestRecord[]).find((entry) => entry.species === species)
)

const backSpriteEntry = (species: string): BackSpriteManifestRecord | undefined => (
  (backSpriteManifest as BackSpriteManifestRecord[]).find((entry) => entry.species === species)
)

const isFullCanvasBounds = (bounds: SpriteManifestRecord['visual_bounds']): boolean => (
  Boolean(bounds)
    && bounds!.left === 0
    && bounds!.top === 0
    && bounds!.width === bounds!.canvas_width
    && bounds!.height === bounds!.canvas_height
)

describe('pokemon catalog visual bounds', () => {
  it('maps front and back manifest visual bounds onto pokemon catalog entries', () => {
    const frontManifestEntry = frontSpriteEntry('Aegislash')
    const backManifestEntry = backSpriteEntry('Aegislash')

    expect(frontManifestEntry?.visual_bounds).toBeDefined()
    expect(backManifestEntry?.visual_bounds).toBeDefined()

    const catalogEntry = pokemonCatalogBySpecies.get('Aegislash')

    expect(catalogEntry?.spriteVisualBounds)
      .toEqual(toSpriteVisualBounds(frontManifestEntry!.visual_bounds))
    expect(catalogEntry?.backSpriteVisualBounds)
      .toEqual(toSpriteVisualBounds(backManifestEntry!.visual_bounds))
  })

  it('keeps curated floating QA overrides visual-only while grounded examples remain planted', () => {
    for (const species of ['Gastly', 'Magnemite', 'Goldeen', 'Flabébé']) {
      const frontBounds = frontSpriteEntry(species)?.visual_bounds

      expect(frontBounds?.floating).toBe(true)
      expect(isFullCanvasBounds(frontBounds)).toBe(false)
    }

    for (const species of ['Gastly', 'Magnemite', 'Goldeen']) {
      const backBounds = backSpriteEntry(species)?.visual_bounds

      expect(backBounds?.floating).toBe(true)
      expect(isFullCanvasBounds(backBounds)).toBe(false)
    }

    for (const species of ['Bulbasaur', 'Snorlax']) {
      expect(frontSpriteEntry(species)?.visual_bounds?.floating).toBe(false)
      expect(backSpriteEntry(species)?.visual_bounds?.floating).toBe(false)
    }
  })

  it('does not add pokemon visual-bounds fields to trainer catalog entries', () => {
    expect(trainerCatalog.length).toBeGreaterThan(0)
    expect(trainerCatalog.every((entry) => (
      entry.spriteVisualBounds === undefined && entry.backSpriteVisualBounds === undefined
    ))).toBe(true)
  })
})
