import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useHazardBuilder } from '../../../composables/map-editor/useHazardBuilder'
import type { TabletopMap } from '../../../types/map'

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'hazard-test',
  name: 'Hazard Test',
  dimensions: { x: 5, y: 1, z: 5 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
})

describe('useHazardBuilder', () => {
  it('places hazards and stacks toxic spikes layers', () => {
    const map = ref(mapFixture())
    const builder = useHazardBuilder({
      map,
      mapHazards: computed(() => map.value?.hazards ?? []),
      canEditMap: computed(() => true),
    })

    builder.placeHazard({ kind: 'toxic-spikes', x: 1.4, y: 0, z: 1.6 })
    builder.placeHazard({ kind: 'toxic-spikes', x: 1, y: 0, z: 2 })

    expect(map.value.hazards).toHaveLength(1)
    expect(map.value.hazards![0]).toMatchObject({ kind: 'toxic-spikes', x: 1, y: 0, z: 2, layer: 2 })
  })

  it('removes hazards by cell and clears all hazards', () => {
    const map = ref(mapFixture())
    map.value.hazards = [
      { kind: 'spikes', x: 1, y: 0, z: 1 },
      { kind: 'sticky-web', x: 2, y: 0, z: 2 },
    ]
    const builder = useHazardBuilder({
      map,
      mapHazards: computed(() => map.value?.hazards ?? []),
      canEditMap: computed(() => true),
      confirmClearAll: () => true,
    })

    builder.removeHazard({ x: 1, y: 0, z: 1 })
    expect(map.value.hazards).toEqual([{ kind: 'sticky-web', x: 2, y: 0, z: 2 }])

    builder.clearAllHazards()
    expect(map.value.hazards).toEqual([])
  })

  it('does not mutate hazards without edit permission', () => {
    const map = ref(mapFixture())
    const builder = useHazardBuilder({
      map,
      mapHazards: computed(() => map.value?.hazards ?? []),
      canEditMap: computed(() => false),
    })

    builder.placeHazard({ kind: 'spikes', x: 0, y: 0, z: 0 })
    expect(map.value.hazards).toEqual([])
  })
})
