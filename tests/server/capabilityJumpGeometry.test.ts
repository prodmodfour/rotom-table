import { describe, expect, it } from 'vitest'
import type { GridAnchor, MapVoxelV2, TabletopMap } from '~/types/map'
import {
  rasterizeCapabilityJumpTrajectory,
  resolveCapabilityJumpTrajectory,
  type CapabilityJumpFootprint,
} from '../../server/domain/capabilityAutomation/jumpGeometry'

const blockingVoxel = (x: number, y: number, z: number): MapVoxelV2 => ({
  x,
  y,
  z,
  materialId: 'airship_wall_bulkhead',
  blocksMovement: true,
})

const mapFixture = (voxels: readonly MapVoxelV2[] = []): TabletopMap => ({
  schemaVersion: 2,
  slug: 'jump-geometry',
  name: 'Jump Geometry',
  dimensions: { x: 12, y: 16, z: 8 },
  groundLevelY: 0,
  voxels: [...voxels],
  placements: [],
})

const actor = (overrides: Partial<CapabilityJumpFootprint> = {}): CapabilityJumpFootprint => ({
  id: 'actor',
  position: { x: 1, y: 0, z: 1 },
  base: 1,
  clearance: 1,
  ...overrides,
})

const maximumStep = (left: GridAnchor, right: GridAnchor): number => Math.max(
  Math.abs(right.x - left.x),
  Math.abs(right.y - left.y),
  Math.abs(right.z - left.z),
)

describe('Capability Jump geometry', () => {
  it('uses the requested apex as the true maximum for unequal elevations and reverses exactly', () => {
    const origin = { x: 1, y: 0, z: 2 }
    const destination = { x: 9, y: 4, z: 5 }
    const path = rasterizeCapabilityJumpTrajectory(origin, destination, 4)

    expect(path[0]).toEqual(origin)
    expect(path.at(-1)).toEqual(destination)
    expect(Math.max(...path.map(anchor => anchor.y))).toBe(4)
    expect(rasterizeCapabilityJumpTrajectory(destination, origin, 4))
      .toEqual([...path].reverse())
  })

  it('deterministically rasterizes steep arcs without skipping grid layers', () => {
    const origin = { x: 2, y: 0, z: 2 }
    const destination = { x: 3, y: 0, z: 2 }
    const path = rasterizeCapabilityJumpTrajectory(origin, destination, 12)

    expect(rasterizeCapabilityJumpTrajectory(origin, destination, 12)).toEqual(path)
    expect([...new Set(path.map(anchor => anchor.y))].sort((left, right) => left - right))
      .toEqual(Array.from({ length: 13 }, (_, y) => y))
    expect(path.slice(1).every((anchor, index) => maximumStep(path[index]!, anchor) <= 1)).toBe(true)
  })

  it('checks terrain collisions against the actor full base and clearance', () => {
    const map = mapFixture([blockingVoxel(3, 1, 2)])
    const destination = { x: 5, y: 0, z: 1 }
    const largeActor = actor({ base: 2, clearance: 2 })

    expect(resolveCapabilityJumpTrajectory({
      map,
      actor: largeActor,
      otherPlacements: [],
      destination,
      effectiveHighJump: 0,
    })).toEqual({ legal: false, path: [], reasonCode: 'jump-trajectory-blocked' })

    expect(resolveCapabilityJumpTrajectory({
      map,
      actor: actor(),
      otherPlacements: [],
      destination,
      effectiveHighJump: 0,
    }).legal).toBe(true)
  })

  it('requires support beneath every base cell at an elevated landing', () => {
    const destination = { x: 4, y: 2, z: 1 }
    const supports = [
      blockingVoxel(4, 1, 1),
      blockingVoxel(5, 1, 1),
      blockingVoxel(4, 1, 2),
      blockingVoxel(5, 1, 2),
    ]
    const jumpingActor = actor({ base: 2, clearance: 2 })

    expect(resolveCapabilityJumpTrajectory({
      map: mapFixture(supports.slice(0, 3)),
      actor: jumpingActor,
      otherPlacements: [],
      destination,
      effectiveHighJump: 2,
    })).toEqual({ legal: false, path: [], reasonCode: 'jump-endpoint-unsupported' })

    const supported = resolveCapabilityJumpTrajectory({
      map: mapFixture(supports),
      actor: jumpingActor,
      otherPlacements: [],
      destination,
      effectiveHighJump: 2,
    })
    expect(supported.legal).toBe(true)
    expect(supported.path.at(-1)).toEqual(destination)
  })
})
