import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ISOMETRIC_HAZARD_KIND,
  createHazardPlacement,
} from '~/utils/isometric/hazardPlacement'

describe('isometric hazard placement helpers', () => {
  it('builds standard hazard payloads without unused layer fields', () => {
    expect(createHazardPlacement({
      kind: 'spikes',
      cell: { x: 1, y: 0, z: 2 },
    })).toEqual({ kind: 'spikes', x: 1, y: 0, z: 2 })
  })

  it('applies the default first layer for toxic spikes placements', () => {
    expect(createHazardPlacement({
      kind: 'toxic-spikes',
      cell: { x: 3, y: 1, z: 4 },
    })).toEqual({ kind: 'toxic-spikes', x: 3, y: 1, z: 4, layer: 1 })
  })

  it('falls back to spikes when no active hazard kind is provided', () => {
    expect(DEFAULT_ISOMETRIC_HAZARD_KIND).toBe('spikes')
    expect(createHazardPlacement({
      kind: null,
      cell: { x: 0, y: 0, z: 0 },
    })).toEqual({ kind: 'spikes', x: 0, y: 0, z: 0 })
  })
})
