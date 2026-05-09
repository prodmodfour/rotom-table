import { describe, expect, it } from 'vitest'
import type { SpawnedPokemon } from '~/types/pokemon'
import {
  EMPTY_MOVE_PREVIEW,
  getMovePreviewAnchor,
  getNextMovePreviewElevationAnchor,
} from '~/utils/isometric/movementPreview'

const pokemon = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id: 'token-1',
  species: 'Pikachu',
  slug: 'pikachu',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/pikachu.png',
  entityKind: 'pokemon',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
  position: { x: 0, y: 0, z: 0 },
  level: 1,
  currentHp: 10,
  maxHp: 20,
  atk: 1,
  satk: 1,
  def: 1,
  sdef: 1,
  defenderTypes: [],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
  ...overrides,
} as SpawnedPokemon)

describe('isometric movement preview helpers', () => {
  it('exports the empty preview state shape used by the renderer adapter', () => {
    expect(EMPTY_MOVE_PREVIEW).toEqual({
      position: null,
      reachable: false,
      pathLength: 0,
    })
  })

  it('builds a clamped token anchor from a grid intersection point', () => {
    expect(getMovePreviewAnchor({
      point: { x: 3.6, z: 4.4 },
      pokemon: pokemon({ base: 2, clearance: 2 }),
      dimensions: { x: 8, y: 5, z: 8 },
      yLevel: 9,
    })).toEqual({ x: 3, y: 3, z: 3 })

    expect(getMovePreviewAnchor({
      point: { x: 8, z: 8 },
      pokemon: pokemon({ base: 2, clearance: 1 }),
      dimensions: { x: 8, y: 5, z: 8 },
      yLevel: 0,
    })).toEqual({ x: 6, y: 0, z: 6 })
  })

  it('rejects pointer hits outside the grid or tokens that cannot fit dimensions', () => {
    expect(getMovePreviewAnchor({
      point: { x: -0.1, z: 2 },
      pokemon: pokemon(),
      dimensions: { x: 4, y: 4, z: 4 },
      yLevel: 0,
    })).toBeNull()

    expect(getMovePreviewAnchor({
      point: { x: 2, z: 2 },
      pokemon: pokemon({ base: 5 }),
      dimensions: { x: 4, y: 4, z: 4 },
      yLevel: 0,
    })).toBeNull()
  })

  it('steps preview elevation with mouse-wheel direction and clamps bounds', () => {
    const mon = pokemon({ clearance: 2 })
    const dimensions = { x: 6, y: 5, z: 6 }

    expect(getNextMovePreviewElevationAnchor({
      currentAnchor: { x: 1, y: 1, z: 1 },
      pokemon: mon,
      dimensions,
      deltaY: -100,
    })).toEqual({ x: 1, y: 2, z: 1 })

    expect(getNextMovePreviewElevationAnchor({
      currentAnchor: { x: 1, y: 3, z: 1 },
      pokemon: mon,
      dimensions,
      deltaY: -100,
    })).toBeNull()

    expect(getNextMovePreviewElevationAnchor({
      currentAnchor: { x: 1, y: 0, z: 1 },
      pokemon: mon,
      dimensions,
      deltaY: 100,
    })).toBeNull()
  })
})
