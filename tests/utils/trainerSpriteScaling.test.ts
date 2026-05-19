import { describe, expect, it } from 'vitest'
import type { PokemonCatalogEntry } from '~/types/pokemon'
import {
  DEFAULT_TRAINER_HEIGHT_METRES,
  parseTrainerSheetHeightMetres,
  scaleTrainerSpriteToSheetHeight,
} from '~/utils/trainerSpriteScaling'

const trainerEntry = (overrides: Partial<PokemonCatalogEntry> = {}): PokemonCatalogEntry => ({
  species: 'Trainer',
  slug: 'trainer',
  size: 'Trainer',
  width: 1,
  height: 2,
  base: 1,
  clearance: 2,
  spriteUrl: '/trainer.png',
  entityKind: 'trainer',
  ...overrides,
})

describe('trainer sprite scaling', () => {
  it('treats numeric trainer sheet heights as metres', () => {
    expect(parseTrainerSheetHeightMetres('1.72')).toBe(1.72)
    expect(parseTrainerSheetHeightMetres('1,65')).toBe(1.65)
    expect(parseTrainerSheetHeightMetres('1.8m')).toBe(1.8)
  })

  it('falls back to the default trainer height when the sheet height is invalid', () => {
    expect(parseTrainerSheetHeightMetres(undefined)).toBe(DEFAULT_TRAINER_HEIGHT_METRES)
    expect(parseTrainerSheetHeightMetres('')).toBe(DEFAULT_TRAINER_HEIGHT_METRES)
    expect(parseTrainerSheetHeightMetres("5'4\"")).toBe(DEFAULT_TRAINER_HEIGHT_METRES)
    expect(parseTrainerSheetHeightMetres('0')).toBe(DEFAULT_TRAINER_HEIGHT_METRES)
  })

  it('scales trainer sprites to the resolved sheet height', () => {
    const scaled = scaleTrainerSpriteToSheetHeight(trainerEntry(), '1.7')

    expect(scaled.height).toBe(1.7)
    expect(scaled.width).toBeCloseTo(0.85)
    expect(scaled.clearance).toBe(2)
  })

  it('uses the default trainer height when scaling invalid sheet heights', () => {
    const scaled = scaleTrainerSpriteToSheetHeight(trainerEntry(), 'not metres')

    expect(scaled.height).toBe(DEFAULT_TRAINER_HEIGHT_METRES)
    expect(scaled.width).toBeCloseTo(0.85)
    expect(scaled.clearance).toBe(2)
  })
})
