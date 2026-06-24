import { describe, expect, it } from 'vitest'
import {
  MAP_ROOM_DEFINITIONS,
  MAP_ROOM_KINDS,
  MAP_TERRAIN_DEFINITIONS,
  MAP_TERRAIN_KINDS,
  MAP_WEATHER_DEFINITIONS,
  MAP_WEATHER_KINDS,
  isMapRoomKind,
  isMapTerrainKind,
  isMapWeatherKind,
} from '~/utils/mapFieldEffectDefinitions'
import {
  applyMoveFieldEffectToFieldEffects,
  createMapRoomEffect,
  createMapTerrainEffect,
  createMapWeatherEffect,
  mapFieldEffectCount,
  normalizeMapFieldEffects,
} from '~/utils/mapFieldEffects'

describe('map field effect definitions', () => {
  it('keeps canonical kind lists aligned with definition maps', () => {
    expect(MAP_WEATHER_KINDS).toEqual(['sunny', 'rainy', 'hail', 'sandstorm'])
    expect(MAP_TERRAIN_KINDS).toEqual(['electric', 'grassy', 'misty', 'psychic'])
    expect(MAP_ROOM_KINDS).toEqual(['magic', 'trick', 'wonder'])

    expect(MAP_WEATHER_KINDS.map((kind) => MAP_WEATHER_DEFINITIONS[kind].kind)).toEqual(MAP_WEATHER_KINDS)
    expect(MAP_TERRAIN_KINDS.map((kind) => MAP_TERRAIN_DEFINITIONS[kind].kind)).toEqual(MAP_TERRAIN_KINDS)
    expect(MAP_ROOM_KINDS.map((kind) => MAP_ROOM_DEFINITIONS[kind].kind)).toEqual(MAP_ROOM_KINDS)
  })

  it('guards valid field effect kinds without accepting unsafe values', () => {
    expect(isMapWeatherKind('sunny')).toBe(true)
    expect(isMapTerrainKind('electric')).toBe(true)
    expect(isMapRoomKind('trick')).toBe(true)

    expect(isMapWeatherKind('fog')).toBe(false)
    expect(isMapTerrainKind('sunny')).toBe(false)
    expect(isMapRoomKind(null)).toBe(false)
  })
})

describe('map field effect normalization', () => {
  it('creates default weather, terrain, and room effects from definitions', () => {
    expect(createMapWeatherEffect('rainy')).toEqual({ kind: 'rainy', rounds: 5 })
    expect(createMapTerrainEffect('grassy')).toEqual({ kind: 'grassy', rounds: 5, scope: 'field' })
    expect(createMapRoomEffect('trick')).toEqual({ kind: 'trick', rounds: 5, startsNextRound: true })
    expect(createMapRoomEffect('magic')).toEqual({ kind: 'magic', rounds: 5, startsNextRound: undefined })
  })

  it('normalizes valid effects, trims sources, clamps rounds, and dedupes by last kind', () => {
    const normalized = normalizeMapFieldEffects({
      weather: [
        { kind: 'sunny', rounds: 2, source: ' Sunny Day ' },
        { kind: 'sunny', rounds: 4, source: ' Override ' },
        { kind: 'fog', rounds: 3 },
      ],
      terrains: [
        { kind: 'electric', rounds: '', scope: 'area', source: '  ' },
        { kind: 'psychic', rounds: Number.NaN, scope: 'unknown', source: ' Psychic Terrain '.repeat(8) },
      ],
      rooms: [
        { kind: 'trick', rounds: -2 },
        { kind: 'magic', rounds: null, startsNextRound: true, source: 'Magic Room' },
      ],
    })

    const terrains = normalized.terrains ?? []
    expect(normalized.weather).toEqual([{ kind: 'sunny', rounds: 4, source: 'Override' }])
    expect(terrains[0]).toEqual({ kind: 'electric', rounds: null, scope: 'area' })
    expect(terrains[1]).toMatchObject({ kind: 'psychic', rounds: 5, scope: 'field' })
    expect(terrains[1]?.source).toHaveLength(80)
    expect(terrains[1]?.source?.startsWith('Psychic Terrain')).toBe(true)
    expect(normalized.rooms).toEqual([
      { kind: 'trick', rounds: 0, startsNextRound: true },
      { kind: 'magic', rounds: null, startsNextRound: true, source: 'Magic Room' },
    ])
  })

  it('falls back to empty collections and counts active effects', () => {
    expect(normalizeMapFieldEffects(null)).toEqual({ weather: [], terrains: [], rooms: [] })
    expect(mapFieldEffectCount(undefined)).toBe(0)
    expect(mapFieldEffectCount({
      weather: [{ kind: 'hail', rounds: 5 }],
      terrains: [{ kind: 'misty', rounds: 2, scope: 'field' }],
      rooms: [{ kind: 'wonder', rounds: 1 }],
    })).toBe(3)
  })
})

describe('move-generated field effect transitions', () => {
  it('replaces weather and upserts terrain and rooms without mutating inputs', () => {
    const previous = {
      weather: [{ kind: 'sunny' as const, rounds: 1, source: 'Old' }],
      terrains: [{ kind: 'electric' as const, rounds: 2, scope: 'field' as const, source: 'Old' }],
      rooms: [{ kind: 'magic' as const, rounds: 3, source: 'Old' }],
    }

    const rainy = applyMoveFieldEffectToFieldEffects(previous, { kind: 'weather', value: 'rainy', source: 'Rain Dance' })
    expect(rainy.ok && rainy.fieldEffects.weather).toEqual([{ kind: 'rainy', rounds: 5, source: 'Rain Dance' }])

    const grassy = applyMoveFieldEffectToFieldEffects(rainy.ok ? rainy.fieldEffects : previous, { kind: 'terrain', value: 'grassy' })
    expect(grassy.ok && grassy.fieldEffects.terrains).toEqual([
      { kind: 'electric', rounds: 2, scope: 'field', source: 'Old' },
      { kind: 'grassy', rounds: 5, scope: 'field', source: 'Move automation' },
    ])

    const room = applyMoveFieldEffectToFieldEffects(grassy.ok ? grassy.fieldEffects : previous, { kind: 'room', value: 'magic', source: 'Magic Room' })
    expect(room.ok && room.fieldEffects.rooms).toEqual([{ kind: 'magic', rounds: 5, source: 'Magic Room' }])
    expect(previous.weather).toEqual([{ kind: 'sunny', rounds: 1, source: 'Old' }])
  })

  it('fails closed for invalid generated effects', () => {
    expect(applyMoveFieldEffectToFieldEffects(undefined, { kind: 'weather', value: 'fog' as never })).toMatchObject({
      ok: false,
      code: 'invalid-field-effect',
    })
  })
})
