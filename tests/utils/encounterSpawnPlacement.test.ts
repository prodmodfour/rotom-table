import { describe, expect, it } from 'vitest'
import {
  evaluateEncounterSpawnAnchors,
  findEncounterSpawnPosition,
} from '~/utils/encounterSpawnPlacement'
import type { MapVoxelV2 } from '~/types/map'

const dimensions = { x: 3, y: 4, z: 3 }
const baseCandidate = {
  base: 1,
  clearance: 1,
  movementCapabilities: { overland: 5 },
}

const water = (x: number, y: number, z: number): MapVoxelV2 => ({
  x,
  y,
  z,
  materialId: 'shallow_water',
})

describe('encounter spawn placement', () => {
  it('keeps non-aerial creatures out of air', () => {
    const anchors = evaluateEncounterSpawnAnchors({
      candidate: baseCandidate,
      placed: [],
      dimensions,
      groundLevelY: 0,
      voxels: [],
    })

    expect(new Set(anchors.map((anchor) => anchor.position.y))).toEqual(new Set([0]))
  })

  it('allows levitating creatures only up to their reachable height', () => {
    const anchors = evaluateEncounterSpawnAnchors({
      candidate: {
        base: 1,
        clearance: 1,
        movementCapabilities: { overland: 3, levitate: 2 },
      },
      placed: [],
      dimensions,
      groundLevelY: 0,
      voxels: [],
    })

    expect(new Set(anchors.map((anchor) => anchor.position.y))).toEqual(new Set([0, 1]))
  })

  it('prefers water when Swim is better than Overland and water has room', () => {
    const selected = findEncounterSpawnPosition({
      candidate: {
        base: 1,
        clearance: 1,
        movementCapabilities: { overland: 2, swim: 6 },
      },
      placed: [],
      dimensions,
      groundLevelY: 0,
      voxels: [water(2, 0, 2)],
      random: () => 0,
    })

    expect(selected).toEqual({ x: 2, y: 0, z: 2 })
  })

  it('falls back to dry land when preferred swimmers have no available water space', () => {
    const selected = findEncounterSpawnPosition({
      candidate: {
        base: 1,
        clearance: 1,
        movementCapabilities: { overland: 2, swim: 6 },
      },
      placed: [{ position: { x: 2, y: 0, z: 2 }, base: 1, clearance: 1 }],
      dimensions: { x: 3, y: 1, z: 3 },
      groundLevelY: 0,
      voxels: [water(2, 0, 2)],
      random: () => 0,
    })

    expect(selected).toEqual({ x: 0, y: 0, z: 0 })
  })
})
