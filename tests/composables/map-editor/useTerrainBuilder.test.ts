import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useTerrainBuilder } from '~/composables/map-editor/useTerrainBuilder'
import type { TabletopMap } from '~/types/map'

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'terrain-test',
  name: 'Terrain Test',
  dimensions: { x: 2, y: 1, z: 2 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
})

describe('useTerrainBuilder', () => {
  it('places, replaces, and removes voxels', () => {
    const map = ref(mapFixture())
    const builder = useTerrainBuilder({
      map,
      mapVoxels: computed(() => map.value?.voxels ?? []),
      mapGroundLevelY: computed(() => 0),
      spawnedPokemon: computed(() => []),
      canEditMap: computed(() => true),
    })

    builder.placeVoxel({ x: 0, y: 0, z: 0, materialId: 'grass' })
    builder.placeVoxel({ x: 0, y: 0, z: 0, materialId: 'stone' })
    expect(map.value.voxels).toHaveLength(1)
    expect(map.value.voxels[0].materialId).toBe('stone')

    builder.removeVoxel({ x: 0, y: 0, z: 0 })
    expect(map.value.voxels).toEqual([])
  })

  it('fills and clears the ground plane', () => {
    const map = ref(mapFixture())
    const builder = useTerrainBuilder({
      map,
      mapVoxels: computed(() => map.value?.voxels ?? []),
      mapGroundLevelY: computed(() => 0),
      spawnedPokemon: computed(() => []),
      canEditMap: computed(() => true),
      confirmClearAll: () => true,
    })

    builder.fillGround()
    expect(map.value.voxels).toHaveLength(4)

    builder.clearAllVoxels()
    expect(map.value.voxels).toEqual([])
  })

  it('tracks ghost voxel build and fade toggles', () => {
    const map = ref(mapFixture())
    const builder = useTerrainBuilder({
      map,
      mapVoxels: computed(() => map.value?.voxels ?? []),
      mapGroundLevelY: computed(() => 0),
      spawnedPokemon: computed(() => []),
      canEditMap: computed(() => true),
    })

    expect(builder.buildGhostVoxel.value).toBe(false)
    expect(builder.ghostVoxelsFaded.value).toBe(false)

    builder.setBuildGhostVoxel(true)
    builder.setGhostVoxelsFaded(true)
    builder.fillGround()

    expect(builder.buildGhostVoxel.value).toBe(true)
    expect(builder.ghostVoxelsFaded.value).toBe(true)
    expect(map.value.voxels).toHaveLength(4)
    expect(map.value.voxels.every((voxel) => voxel.ghost === true)).toBe(true)
  })

  it('does not mutate terrain without edit permission', () => {
    const map = ref(mapFixture())
    const builder = useTerrainBuilder({
      map,
      mapVoxels: computed(() => map.value?.voxels ?? []),
      mapGroundLevelY: computed(() => 0),
      spawnedPokemon: computed(() => []),
      canEditMap: computed(() => false),
    })

    builder.placeVoxel({ x: 0, y: 0, z: 0, materialId: 'grass' })
    builder.fillGround()
    expect(map.value.voxels).toEqual([])
  })
})
