import { describe, expect, it } from 'vitest'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import { reconcileMapForDimensions } from '~/utils/mapDimensionReconciliation'

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

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'test-map',
  name: 'Test Map',
  dimensions: { x: 3, y: 3, z: 3 },
  groundLevelY: 1,
  voxels: [],
  hazards: [],
  placements: [],
  ...overrides,
})

describe('map dimension reconciliation', () => {
  it('normalizes dimensions and clamps ground level', () => {
    const result = reconcileMapForDimensions({
      map: mapFixture({
        dimensions: { x: 2.6, y: Number.NaN, z: -5 },
        groundLevelY: 999,
      }),
      spawnedPokemon: [],
    })

    expect(result.dimensions).toEqual({ x: 3, y: 12, z: 1 })
    expect(result.groundLevelY).toBe(11)
  })

  it('trims terrain and hazards outside normalized map bounds', () => {
    const result = reconcileMapForDimensions({
      map: mapFixture({
        dimensions: { x: 2, y: 2, z: 2 },
        voxels: [
          { x: 0, y: 0, z: 0, materialId: 'grass' },
          { x: 2, y: 0, z: 0, materialId: 'stone' },
        ],
        hazards: [
          { kind: 'spikes', x: 1, y: 0, z: 1 },
          { kind: 'fire', x: 1, y: 2, z: 1 },
        ],
      }),
      spawnedPokemon: [],
    })

    expect(result.voxels).toEqual([{ x: 0, y: 0, z: 0, materialId: 'grass' }])
    expect(result.hazards).toEqual([{ kind: 'spikes', x: 1, y: 0, z: 1 }])
  })

  it('reconciles placed token positions and reports removed selections', () => {
    const result = reconcileMapForDimensions({
      map: mapFixture({
        dimensions: { x: 2, y: 2, z: 2 },
        placements: [
          { id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 5, y: 0, z: 5 } },
          { id: 'token-2', sheetKind: 'pokemon', sheetSlug: 'large', position: { x: 0, y: 0, z: 0 } },
        ],
      }),
      spawnedPokemon: [
        pokemon({ id: 'token-1', position: { x: 5, y: 0, z: 5 } }),
        pokemon({ id: 'token-2', sheetSlug: 'large', base: 3, position: { x: 0, y: 0, z: 0 } }),
      ],
      selectedId: 'token-2',
    })

    expect(result.placements).toEqual([
      { id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 0, y: 0, z: 0 } },
    ])
    expect(result.selectedPlacementRemoved).toBe(true)
  })

  it('preserves placements whose sheets have not resolved yet', () => {
    const unresolvedPlacement = {
      id: 'runtime-sheet-token',
      sheetKind: 'pokemon' as const,
      sheetSlug: 'runtime-abra',
      position: { x: 1, y: 0, z: 1 },
    }
    const result = reconcileMapForDimensions({
      map: mapFixture({
        placements: [
          { id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 5, y: 0, z: 5 } },
          unresolvedPlacement,
        ],
      }),
      spawnedPokemon: [pokemon({ id: 'token-1', position: { x: 5, y: 0, z: 5 } })],
      selectedId: 'runtime-sheet-token',
    })

    expect(result.placements).toEqual([
      { id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 1, y: 0, z: 1 } },
      unresolvedPlacement,
    ])
    expect(result.selectedPlacementRemoved).toBe(false)
  })

  it('leaves absent ground-level metadata absent', () => {
    const result = reconcileMapForDimensions({
      map: mapFixture({ groundLevelY: undefined }),
      spawnedPokemon: [],
    })

    expect(result.groundLevelY).toBeUndefined()
  })
})
