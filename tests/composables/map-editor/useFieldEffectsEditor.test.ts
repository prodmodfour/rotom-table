import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  durationLabel,
  parseRoundInputValue,
  useFieldEffectsEditor,
} from '~/composables/map-editor/useFieldEffectsEditor'
import type { TabletopMap } from '~/types/map'

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'field-effects-test',
  name: 'Field Effects Test',
  dimensions: { x: 5, y: 3, z: 5 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
})

describe('useFieldEffectsEditor', () => {
  it('parses and labels round values', () => {
    expect(parseRoundInputValue('')).toBeNull()
    expect(parseRoundInputValue('3.9')).toBe(3)
    expect(parseRoundInputValue('-2')).toBe(0)
    expect(parseRoundInputValue('not-a-number')).toBeNull()
    expect(durationLabel(null)).toBe('')
    expect(durationLabel(4)).toBe('4')
  })

  it('sets weather and supports one coexist follow-up', () => {
    const map = ref(mapFixture())
    const editor = useFieldEffectsEditor({ map, canEditMap: computed(() => true) })

    editor.setWeather('sunny')
    expect(map.value.fieldEffects?.weather?.map((effect) => effect.kind)).toEqual(['sunny'])

    editor.weatherCoexistNext.value = true
    editor.setWeather('rainy')
    expect(map.value.fieldEffects?.weather?.map((effect) => effect.kind)).toEqual(['sunny', 'rainy'])
    expect(editor.weatherCoexistNext.value).toBe(false)
  })

  it('ticks durations and clears all effects behind confirmation', () => {
    const map = ref(mapFixture())
    const editor = useFieldEffectsEditor({ map, canEditMap: computed(() => true), confirmClearAll: () => true })

    editor.setWeather('hail')
    editor.toggleTerrain('grassy')
    editor.toggleRoom('trick')
    map.value.fieldEffects!.weather![0].rounds = 1
    map.value.fieldEffects!.terrains![0].rounds = 2

    editor.tickFieldEffectDurations()
    expect(map.value.fieldEffects?.weather).toEqual([])
    expect(map.value.fieldEffects?.terrains?.[0]?.rounds).toBe(1)
    expect(map.value.fieldEffects?.rooms).toHaveLength(1)

    editor.clearAllFieldEffects()
    expect(map.value.fieldEffects).toEqual({ weather: [], terrains: [], rooms: [] })
  })

  it('applies move automation field effects with sources', () => {
    const map = ref(mapFixture())
    const editor = useFieldEffectsEditor({ map, canEditMap: computed(() => true) })

    editor.applyMoveFieldEffect({ kind: 'terrain', value: 'electric', source: 'Thunder move' })
    expect(map.value.fieldEffects?.terrains).toMatchObject([{ kind: 'electric', source: 'Thunder move' }])

    editor.applyMoveFieldEffect({ kind: 'room', value: 'magic' })
    expect(map.value.fieldEffects?.rooms).toMatchObject([{ kind: 'magic', source: 'Move automation' }])
  })

  it('does not mutate field effects without edit permission', () => {
    const map = ref(mapFixture())
    map.value.fieldEffects = {
      weather: [{ kind: 'rainy', rounds: 2 }],
      terrains: [{ kind: 'grassy', rounds: 3 }],
      rooms: [{ kind: 'trick', rounds: 4 }],
    }
    const editor = useFieldEffectsEditor({
      map,
      canEditMap: computed(() => false),
      confirmClearAll: () => true,
    })
    const original = JSON.parse(JSON.stringify(map.value.fieldEffects))

    editor.setWeather('sunny')
    editor.removeWeather('rainy')
    editor.clearWeather()
    editor.toggleTerrain('electric')
    editor.removeTerrain('grassy')
    editor.toggleRoom('magic')
    editor.removeRoom('trick')
    editor.tickFieldEffectDurations()
    editor.clearAllFieldEffects()
    editor.applyMoveFieldEffect({ kind: 'weather', value: 'hail' })

    expect(map.value.fieldEffects).toEqual(original)
  })
})
