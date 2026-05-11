import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GRID_DIMENSIONS,
  clampDimensionValue,
  footprintsOverlap,
  getAnchorCenter,
  getAnchorKey,
  getPokemonCenter,
  isAnchorWithinBounds,
  isSameAnchor,
  normalizeDimensions,
} from '~/utils/gridGeometry'
import type { SpawnedPokemon } from '~/types/pokemon'

const token = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id: 'token',
  species: 'Bulbasaur',
  slug: 'bulbasaur',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/sprite.png',
  entityKind: 'pokemon',
  position: { x: 1, y: 0, z: 2 },
  sheetKind: 'pokemon',
  sheetSlug: 'bulbasaur',
  level: 5,
  currentHp: 20,
  maxHp: 20,
  atk: 5,
  satk: 5,
  def: 5,
  sdef: 5,
  defenderTypes: ['Grass'],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
  ...overrides,
})

describe('grid geometry helpers', () => {
  it('normalizes dimensions with defaults, rounding, and bounds', () => {
    expect(DEFAULT_GRID_DIMENSIONS).toEqual({ x: 20, y: 12, z: 20 })
    expect(clampDimensionValue(Number.NaN, 12)).toBe(12)
    expect(clampDimensionValue(0)).toBe(1)
    expect(clampDimensionValue(250, 1, 200)).toBe(200)
    expect(clampDimensionValue(4.6)).toBe(5)

    expect(normalizeDimensions({ x: Number.NaN, y: 0.2, z: 500 })).toEqual({ x: 20, y: 1, z: 200 })
  })

  it('formats anchors and computes centers', () => {
    expect(getAnchorKey({ x: 1, y: 2, z: 3 })).toBe('1,2,3')
    expect(isSameAnchor({ x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: 1 })).toBe(true)
    expect(isSameAnchor(null, { x: 1, y: 0, z: 1 })).toBe(false)
    expect(getAnchorCenter({ x: 2, y: 1, z: 4 }, 2)).toEqual({ x: 3, y: 1, z: 5 })
    expect(getPokemonCenter(token({ position: { x: 3, y: 0, z: 5 }, base: 2 }))).toEqual({ x: 4, y: 0, z: 6 })
  })

  it('checks bounds and 3D footprint overlap', () => {
    const dimensions = { x: 4, y: 3, z: 4 }
    expect(isAnchorWithinBounds({ x: 2, y: 1, z: 2 }, { base: 2, clearance: 2 }, dimensions)).toBe(true)
    expect(isAnchorWithinBounds({ x: 3, y: 1, z: 2 }, { base: 2, clearance: 2 }, dimensions)).toBe(false)
    expect(isAnchorWithinBounds({ x: 2, y: 2, z: 2 }, { base: 2, clearance: 2 }, dimensions)).toBe(false)

    expect(footprintsOverlap({ x: 0, y: 0, z: 0 }, 2, 1, { x: 1, y: 0, z: 1 }, 1, 1)).toBe(true)
    expect(footprintsOverlap({ x: 0, y: 0, z: 0 }, 1, 1, { x: 1, y: 0, z: 0 }, 1, 1)).toBe(false)
    expect(footprintsOverlap({ x: 0, y: 0, z: 0 }, 1, 1, { x: 0, y: 1, z: 0 }, 1, 1)).toBe(false)
  })
})
