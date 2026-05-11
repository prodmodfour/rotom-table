import { describe, expect, it } from 'vitest'
import {
  MAIN_MAP_HAZARD_KINDS,
  MAP_HAZARD_DEFINITIONS,
  isMapHazardKind,
  normalizeMapHazardKind,
} from '../../utils/mapHazardDefinitions'
import {
  filterMapHazardsInBounds,
  mapHazardCellKey,
  mapHazardKey,
  normalizeMapHazard,
  normalizeMapHazardLayer,
} from '../../utils/mapHazards'

describe('map hazard definitions', () => {
  it('keeps canonical hazard kinds aligned with definitions', () => {
    expect(MAIN_MAP_HAZARD_KINDS).toEqual([
      'spikes',
      'toxic-spikes',
      'sticky-web',
      'stealth-rock',
      'fire',
    ])
    expect(MAIN_MAP_HAZARD_KINDS.map((kind) => MAP_HAZARD_DEFINITIONS[kind].kind)).toEqual(
      MAIN_MAP_HAZARD_KINDS,
    )
    expect(MAP_HAZARD_DEFINITIONS['toxic-spikes']).toMatchObject({
      label: 'Toxic Spikes',
      shortLabel: 'TOX',
    })
  })

  it('guards and normalizes hazard kinds without accepting unsafe values', () => {
    expect(isMapHazardKind('spikes')).toBe(true)
    expect(isMapHazardKind('toxic-spikes')).toBe(true)
    expect(isMapHazardKind('fog')).toBe(false)
    expect(isMapHazardKind(null)).toBe(false)

    expect(normalizeMapHazardKind('sticky-web')).toBe('sticky-web')
    expect(normalizeMapHazardKind('../spikes')).toBe('spikes')
  })
})

describe('map hazard normalization', () => {
  it('normalizes layers only for Toxic Spikes', () => {
    expect(normalizeMapHazardLayer('toxic-spikes', 2.8)).toBe(2)
    expect(normalizeMapHazardLayer('toxic-spikes', 0)).toBe(1)
    expect(normalizeMapHazardLayer('toxic-spikes', 'nope')).toBe(1)
    expect(normalizeMapHazardLayer('spikes', 2)).toBeUndefined()
  })

  it('normalizes hazard records, keys, owners, and invalid records', () => {
    const hazard = normalizeMapHazard({
      kind: 'toxic-spikes',
      x: 1,
      y: 2,
      z: 3,
      layer: 4,
      owner: '  player-1  ',
    })

    expect(hazard).toEqual({
      kind: 'toxic-spikes',
      x: 1,
      y: 2,
      z: 3,
      layer: 2,
      owner: 'player-1',
    })
    expect(mapHazardCellKey(hazard!)).toBe('1,2,3')
    expect(mapHazardKey(hazard!)).toBe('toxic-spikes:1,2,3')

    expect(normalizeMapHazard({ kind: 'fog', x: 1, y: 2, z: 3 })).toBeNull()
    expect(normalizeMapHazard({ kind: 'fire', x: 1.5, y: 2, z: 3 })).toBeNull()
    expect(normalizeMapHazard(null)).toBeNull()
  })

  it('filters hazards to map dimensions', () => {
    const hazards = [
      { kind: 'spikes' as const, x: 0, y: 0, z: 0 },
      { kind: 'fire' as const, x: 2, y: 0, z: 0 },
      { kind: 'sticky-web' as const, x: 1, y: -1, z: 1 },
    ]

    expect(filterMapHazardsInBounds(hazards, { x: 2, y: 2, z: 2 })).toEqual([
      { kind: 'spikes', x: 0, y: 0, z: 0 },
    ])
  })
})
