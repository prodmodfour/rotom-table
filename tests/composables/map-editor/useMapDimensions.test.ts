import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  useMapDimensionControls,
  useMapDimensionReconciliation,
} from '~/composables/map-editor/useMapDimensions'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'

const makeMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'test-map',
  name: 'Test Map',
  dimensions: { x: 10, y: 4, z: 10 },
  groundLevelY: 2,
  voxels: [],
  hazards: [],
  placements: [],
  playerVisible: false,
  ...overrides,
})

const makeSpawnedPokemon = (
  id: string,
  overrides: Partial<SpawnedPokemon> = {},
): SpawnedPokemon => ({
  id,
  species: 'Testmon',
  slug: id,
  spriteUrl: '',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  entityKind: 'pokemon',
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  sheetSlug: id,
  level: 1,
  currentHp: 1,
  maxHp: 1,
  atk: 1,
  satk: 1,
  def: 1,
  sdef: 1,
  defenderTypes: [],
  combatStages: {},
  conditions: [],
  tokenItems: [],
  ...overrides,
} as SpawnedPokemon)

describe('useMapDimensionControls', () => {
  it('derives map geometry state and gates edits by role/capability', () => {
    const map = ref<TabletopMap | null>(makeMap({
      voxels: [{ x: 1, y: 0, z: 1, materialId: 'grass' }],
      hazards: [{ x: 2, y: 0, z: 2, kind: 'spikes' }],
    }))
    const canEditMap = ref(false)
    const isGm = ref(false)

    const controls = useMapDimensionControls({ map, canEditMap, isGm })

    expect(controls.mapVoxels.value).toHaveLength(1)
    expect(controls.mapHazards.value).toHaveLength(1)
    expect(controls.groundLevelYMax.value).toBe(3)
    expect(controls.mapGroundLevelY.value).toBe(2)
    expect(controls.mapSpecificYMin.value).toBe(-2)
    expect(controls.mapSpecificYMax.value).toBe(1)

    controls.setMapPlayerVisible(true)
    expect(map.value?.playerVisible).toBe(false)

    isGm.value = true
    controls.setMapPlayerVisible(true)
    expect(map.value?.playerVisible).toBe(true)

    controls.setMapDimension('x', 12)
    expect(map.value?.dimensions.x).toBe(10)

    canEditMap.value = true
    controls.setMapDimension('x', 12)
    controls.setGroundLevelY('99')

    expect(map.value?.dimensions.x).toBe(12)
    expect(map.value?.groundLevelY).toBe(3)
  })
})

describe('useMapDimensionReconciliation', () => {
  it('normalizes dimensions and reconciles dependent map state', async () => {
    const map = ref<TabletopMap | null>(makeMap({
      dimensions: { x: 4, y: 3, z: 4 },
      groundLevelY: 2,
      voxels: [
        { x: 0, y: 0, z: 0, materialId: 'grass' },
        { x: 9, y: 0, z: 0, materialId: 'stone' },
      ],
      hazards: [
        { x: 0, y: 0, z: 0, kind: 'spikes' },
        { x: 0, y: 0, z: 9, kind: 'fire' },
      ],
      placements: [
        { id: 'keep', sheetKind: 'pokemon', sheetSlug: 'keep', position: { x: 0, y: 0, z: 0 } },
        { id: 'remove', sheetKind: 'pokemon', sheetSlug: 'remove', position: { x: 0, y: 0, z: 0 } },
      ],
    }))
    const spawnedPokemon = ref<readonly SpawnedPokemon[]>([
      makeSpawnedPokemon('keep'),
      makeSpawnedPokemon('remove', { base: 99 }),
    ])
    const selectedId = ref<string | null>('remove')
    const clearSelection = vi.fn(() => { selectedId.value = null })

    useMapDimensionReconciliation({ map, spawnedPokemon, selectedId, clearSelection })

    map.value!.dimensions.x = 0
    map.value!.dimensions.y = 1
    map.value!.dimensions.z = 2
    await nextTick()
    await nextTick()

    expect(map.value?.dimensions).toEqual({ x: 1, y: 1, z: 2 })
    expect(map.value?.groundLevelY).toBe(0)
    expect(map.value?.voxels).toEqual([{ x: 0, y: 0, z: 0, materialId: 'grass' }])
    expect(map.value?.hazards).toEqual([{ x: 0, y: 0, z: 0, kind: 'spikes' }])
    expect(map.value?.placements).toEqual([
      { id: 'keep', sheetKind: 'pokemon', sheetSlug: 'keep', position: { x: 0, y: 0, z: 0 } },
    ])
    expect(clearSelection).toHaveBeenCalledTimes(1)
  })
})
