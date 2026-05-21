import { describe, expect, it } from 'vitest'
import { findMovementPathForPokemon } from '~/utils/mapMovementPathfinding'
import type { MapVoxelV2 } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'

const token = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id: 'mover',
  species: 'Bulbasaur',
  slug: 'bulbasaur',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/sprite.png',
  entityKind: 'pokemon',
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  sheetSlug: 'bulbasaur',
  level: 5,
  currentHp: 20,
  maxHp: 20,
  atk: 5,
  satk: 5,
  def: 5,
  sdef: 5,
  defenderTypes: [],
  movementCapabilities: { overland: 6 },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
  ...overrides,
})

const dimensions = { x: 6, y: 3, z: 6 }

const route = (pokemon: SpawnedPokemon, goal: SpawnedPokemon['position'], voxels: MapVoxelV2[] = []) =>
  findMovementPathForPokemon({
    pokemon,
    start: pokemon.position,
    goal,
    pokemons: [pokemon],
    dimensions,
    exceptId: pokemon.id,
    voxels,
    groundLevelY: 0,
  })

describe('map movement pathfinding', () => {
  it('counts diagonal movement with the PTU alternating 1m/2m rule', () => {
    const result = route(token({ movementCapabilities: { overland: 2 } }), { x: 2, y: 0, z: 2 })

    expect(result.distance).toBe(3)
    expect(result.movementLimit).toBe(2)
    expect(result.legal).toBe(false)
    expect(result.reason).toBe('too-far')
  })

  it('uses mixed movement capability averages for routes crossing terrain types', () => {
    const swimmer = token({ movementCapabilities: { overland: 3, swim: 1 } })
    const water: MapVoxelV2[] = [{ x: 1, y: 0, z: 0, materialId: 'deep_water' }]

    const result = route(swimmer, { x: 2, y: 0, z: 0 }, water)

    expect(result.distance).toBe(2)
    expect(result.capabilityLabels).toEqual(['Overland', 'Swim'])
    expect(result.movementLimit).toBe(2)
    expect(result.legal).toBe(true)
  })

  it('chooses a longer legal route over a shorter mixed-capability route that exceeds its average', () => {
    const cautious = token({
      position: { x: 0, y: 0, z: 1 },
      movementCapabilities: { overland: 6, swim: 1 },
    })
    const water: MapVoxelV2[] = [1, 2, 3].map((x) => ({ x, y: 0, z: 1, materialId: 'deep_water' }))

    const result = route(cautious, { x: 4, y: 0, z: 1 }, water)

    expect(result.legal).toBe(true)
    expect(result.distance).toBe(5)
    expect(result.capabilityLabels).toEqual(['Overland'])
  })

  it('uses full superior Sky over Overland by hovering above land', () => {
    const flyer = token({ movementCapabilities: { overland: 2, sky: 6 } })

    const result = route(flyer, { x: 4, y: 0, z: 0 })

    expect(result.legal).toBe(true)
    expect(result.distance).toBe(4)
    expect(result.movementLimit).toBe(6)
    expect(result.capabilityLabels).toEqual(['Sky'])
  })

  it('keeps superior Overland when Sky is slower than walking', () => {
    const flyer = token({ movementCapabilities: { overland: 6, sky: 4 } })

    const result = route(flyer, { x: 3, y: 0, z: 0 })

    expect(result.legal).toBe(true)
    expect(result.movementLimit).toBe(6)
    expect(result.capabilityLabels).toEqual(['Overland'])
  })

  it('uses Sky over water when hovering above water is better than swimming or missing Swim', () => {
    const flyer = token({ movementCapabilities: { overland: 1, sky: 5 } })
    const water: MapVoxelV2[] = [{ x: 1, y: 0, z: 0, materialId: 'deep_water' }]

    const result = route(flyer, { x: 2, y: 0, z: 0 }, water)

    expect(result.legal).toBe(true)
    expect(result.distance).toBe(2)
    expect(result.movementLimit).toBe(5)
    expect(result.capabilityLabels).toEqual(['Sky'])
  })

  it('reports zero adjusted movement as a 0m limit instead of a missing capability', () => {
    const stuck = token({ movementCapabilities: { overland: 0 } })

    const result = route(stuck, { x: 1, y: 0, z: 0 })

    expect(result.reason).toBe('too-far')
    expect(result.movementLimit).toBe(0)
    expect(result.capabilityLabels).toEqual(['Overland'])
  })

  it('rejects water terrain without Swim or an aerial capability', () => {
    const walker = token({ movementCapabilities: { overland: 6 } })
    const water: MapVoxelV2[] = [{ x: 1, y: 0, z: 0, materialId: 'deep_water' }]

    const result = route(walker, { x: 1, y: 0, z: 0 }, water)

    expect(result.path).toBeNull()
    expect(result.legal).toBe(false)
    expect(result.reason).toBe('missing-capability')
  })

  it('allows Burrow movement through burrow terrain and blocks it otherwise', () => {
    const earth: MapVoxelV2[] = [{ x: 1, y: 0, z: 0, materialId: 'burrow_dirt' }]

    expect(route(token({ movementCapabilities: { overland: 6 } }), { x: 1, y: 0, z: 0 }, earth).legal).toBe(false)
    expect(route(token({ movementCapabilities: { overland: 6, burrow: 3 } }), { x: 1, y: 0, z: 0 }, earth)).toMatchObject({
      distance: 1,
      movementLimit: 3,
      capabilityLabels: ['Burrow'],
      legal: true,
    })
  })
})
