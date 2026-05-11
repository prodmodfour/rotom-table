import { describe, expect, it } from 'vitest'
import { canPlacePokemon, findFirstAvailablePosition, reconcilePokemonPositions } from '~/utils/gridPlacement'
import { findPathForPokemon } from '~/utils/gridPathfinding'
import type { SpawnedPokemon } from '~/types/pokemon'

const token = (id: string, overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id,
  species: 'Bulbasaur',
  slug: id,
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/sprite.png',
  entityKind: 'pokemon',
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  sheetSlug: id,
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

describe('grid placement and pathfinding helpers', () => {
  it('validates placement against bounds, tokens, exceptions, and terrain occupancy', () => {
    const dimensions = { x: 3, y: 1, z: 3 }
    const placed = [token('placed', { position: { x: 1, y: 0, z: 1 } })]

    expect(canPlacePokemon({ base: 1 }, { x: 0, y: 0, z: 0 }, placed, dimensions)).toBe(true)
    expect(canPlacePokemon({ base: 1 }, { x: 1, y: 0, z: 1 }, placed, dimensions)).toBe(false)
    expect(canPlacePokemon({ id: 'placed', base: 1 }, { x: 1, y: 0, z: 1 }, placed, dimensions, 'placed')).toBe(true)
    expect(canPlacePokemon({ base: 2 }, { x: 2, y: 0, z: 0 }, placed, dimensions)).toBe(false)
    expect(canPlacePokemon({ base: 1 }, { x: 0, y: 0, z: 0 }, [], dimensions, null, new Set(['0,0,0']))).toBe(false)
  })

  it('finds centered fallback positions while respecting preferred layers', () => {
    const dimensions = { x: 5, y: 3, z: 5 }
    expect(findFirstAvailablePosition({ base: 1 }, [], dimensions)).toEqual({ x: 2, y: 0, z: 2 })
    expect(findFirstAvailablePosition({ base: 1 }, [], dimensions, null, new Set(), 2)).toEqual({ x: 2, y: 2, z: 2 })
    expect(findFirstAvailablePosition({ base: 6 }, [], dimensions)).toBeNull()
  })

  it('finds paths around occupied cells and rejects unreachable goals', () => {
    const dimensions = { x: 3, y: 1, z: 3 }
    const blocker = token('blocker', { position: { x: 1, y: 0, z: 0 } })

    const path = findPathForPokemon({ base: 1 }, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, [blocker], dimensions)
    expect(path?.at(0)).toEqual({ x: 0, y: 0, z: 0 })
    expect(path?.at(-1)).toEqual({ x: 2, y: 0, z: 0 })
    expect(path).not.toContainEqual({ x: 1, y: 0, z: 0 })

    expect(findPathForPokemon({ base: 1 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, [blocker], dimensions)).toBeNull()
  })

  it('reconciles overlapping tokens and reports tokens that no longer fit', () => {
    const dimensions = { x: 2, y: 1, z: 1 }
    const result = reconcilePokemonPositions([
      token('a', { position: { x: 0, y: 0, z: 0 } }),
      token('b', { position: { x: 0, y: 0, z: 0 } }),
      token('c', { base: 2, position: { x: 0, y: 0, z: 0 } }),
    ], dimensions)

    expect(result.pokemons.map((pokemon) => [pokemon.id, pokemon.position])).toEqual([
      ['a', { x: 0, y: 0, z: 0 }],
      ['b', { x: 1, y: 0, z: 0 }],
    ])
    expect(result.removedIds).toEqual(['c'])
  })
})
