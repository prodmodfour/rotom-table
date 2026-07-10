import { describe, expect, it, vi } from 'vitest'
import {
  MOVE_AUTOMATION_ROUGH_COVER_ACCURACY_MODIFIER,
  MoveAutomationLineOfSightError,
  createMoveAutomationLineOfSightResolver,
  resolveMoveAutomationLineOfSight,
  type MoveAutomationLineOfSightPlacement,
  type MoveAutomationLineOfSightPolicy,
} from '~~/server/domain/moveAutomation/lineOfSight'
import type { MapVoxelV2 } from '~/types/map'

const placement = (
  id: string,
  x: number,
  y = 1,
  z = 0,
  overrides: Partial<MoveAutomationLineOfSightPlacement> = {},
): MoveAutomationLineOfSightPlacement => ({
  id,
  position: { x, y, z },
  base: 1,
  clearance: 1,
  ...overrides,
})

const voxel = (
  x: number,
  y: number,
  z: number,
  overrides: Partial<MapVoxelV2> = {},
): MapVoxelV2 => ({
  x,
  y,
  z,
  materialId: 'airship_wall_bulkhead',
  ...overrides,
})

const resolve = (options: {
  readonly voxels?: readonly MapVoxelV2[]
  readonly placements?: readonly MoveAutomationLineOfSightPlacement[]
  readonly sourcePlacementId?: string
  readonly targetPlacementId?: string
  readonly policy?: MoveAutomationLineOfSightPolicy
} = {}) => resolveMoveAutomationLineOfSight({
  voxels: options.voxels ?? [],
  placements: options.placements ?? [placement('actor', 0), placement('target', 4)],
  sourcePlacementId: options.sourcePlacementId ?? 'actor',
  targetPlacementId: options.targetPlacementId ?? 'target',
  policy: options.policy,
})

describe('authoritative move line of sight', () => {
  it('derives clear visibility across the complete target footprint', () => {
    const result = resolve({
      placements: [
        placement('actor', 0),
        placement('target', 4, 1, 0, { base: 2, clearance: 2 }),
      ],
    })

    expect(result).toMatchObject({
      sourcePlacementId: 'actor',
      targetPlacementId: 'target',
      targetable: true,
      accuracyModifier: 0,
      visibility: 'full',
      cover: 'none',
      reasonCode: 'line-of-sight-clear',
      originCell: { x: 0, y: 1, z: 0 },
      targetCell: { x: 4, y: 1, z: 0 },
      targetFootprintCellCount: 8,
      blockingVoxelCells: [],
      blockingPlacementIds: [],
      coverVoxelCells: [],
      coverPlacementIds: [],
      consultedPlacementIds: ['actor', 'target'],
    })
    expect(result.visibleTargetCells).toHaveLength(8)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.visibleTargetCells)).toBe(true)
    expect(Object.isFrozen(result.visibleTargetCells[0])).toBe(true)
  })

  it('uses explicit and material sight flags without trusting render opacity', () => {
    const wall = voxel(2, 1, 0)
    expect(resolve({ voxels: [wall] })).toMatchObject({
      targetable: false,
      visibility: 'none',
      cover: 'blocked',
      reasonCode: 'line-of-sight-blocked-voxel',
      blockingVoxelCells: [{ x: 2, y: 1, z: 0 }],
    })

    expect(resolve({
      voxels: [{ ...wall, blocksSight: false }],
    })).toMatchObject({
      targetable: true,
      reasonCode: 'line-of-sight-clear',
    })

    expect(resolve({
      voxels: [voxel(2, 1, 0, {
        materialId: 'reinforced_glass',
      })],
    })).toMatchObject({
      targetable: true,
      reasonCode: 'line-of-sight-clear',
    })

    expect(resolve({
      voxels: [voxel(2, 1, 0, {
        materialId: 'airship_floor_metal',
        blocksSight: true,
      })],
    })).toMatchObject({
      targetable: false,
      reasonCode: 'line-of-sight-blocked-voxel',
    })
  })

  it('allows targeting a partially visible raised footprint and records the occluder', () => {
    const result = resolve({
      placements: [
        placement('actor', 0),
        placement('target', 4, 1, 0, { clearance: 2 }),
      ],
      voxels: [voxel(3, 1, 0)],
    })

    expect(result).toMatchObject({
      targetable: true,
      accuracyModifier: 0,
      visibility: 'partial',
      cover: 'none',
      reasonCode: 'line-of-sight-clear',
      blockingVoxelCells: [{ x: 3, y: 1, z: 0 }],
      targetFootprintCellCount: 2,
    })
    expect(result.visibleTargetCells).toEqual([{ x: 4, y: 2, z: 0 }])
    expect(result.targetCell).toEqual({ x: 4, y: 2, z: 0 })
  })

  it('treats ordinary intervening combatants as non-stacking Rough Terrain cover', () => {
    const result = resolve({
      placements: [
        placement('actor', 0),
        placement('cover-a', 1),
        placement('cover-b', 2),
        placement('target', 4),
      ],
      voxels: [
        voxel(3, 0, 0, {
          materialId: 'meadow_grass',
          blocksSight: false,
          tags: ['rough'],
        }),
      ],
    })

    expect(result).toMatchObject({
      targetable: true,
      visibility: 'full',
      cover: 'rough-terrain',
      reasonCode: 'line-of-sight-rough-cover',
      accuracyModifier: MOVE_AUTOMATION_ROUGH_COVER_ACCURACY_MODIFIER,
      coverPlacementIds: ['cover-a', 'cover-b'],
      coverVoxelCells: [{ x: 3, y: 0, z: 0 }],
      consultedPlacementIds: ['actor', 'cover-a', 'cover-b', 'target'],
    })
  })

  it('lets authoritative placement state make a combatant Blocking Terrain', () => {
    const result = resolve({
      placements: [
        placement('actor', 0),
        placement('inflated', 2, 1, 0, { blocksSight: true }),
        placement('target', 4),
      ],
    })

    expect(result).toMatchObject({
      targetable: false,
      visibility: 'none',
      cover: 'blocked',
      reasonCode: 'line-of-sight-blocked-placement',
      blockingPlacementIds: ['inflated'],
      consultedPlacementIds: ['actor', 'inflated', 'target'],
    })
  })

  it('applies only server-selected blocking and Rough Terrain exceptions', () => {
    const placements = [
      placement('actor', 0),
      placement('inflated', 2, 1, 0, { blocksSight: true }),
      placement('target', 4),
    ]
    const roughFloor = voxel(1, 0, 0, {
      materialId: 'meadow_grass',
      blocksSight: false,
      tags: ['cover'],
    })

    expect(resolve({
      placements,
      voxels: [roughFloor],
      policy: { ignoreBlockingTerrain: true },
    })).toMatchObject({
      targetable: true,
      cover: 'rough-terrain',
      accuracyModifier: MOVE_AUTOMATION_ROUGH_COVER_ACCURACY_MODIFIER,
    })

    expect(resolve({
      placements,
      voxels: [roughFloor],
      policy: { ignoreBlockingTerrain: true, ignoreRoughTerrain: true },
    })).toMatchObject({
      targetable: true,
      cover: 'none',
      accuracyModifier: 0,
      policy: {
        ignoreBlockingTerrain: true,
        ignoreRoughTerrain: true,
      },
    })
  })

  it('fails closed for missing identities and malformed authoritative geometry', () => {
    expect(resolve({ sourcePlacementId: 'missing' })).toMatchObject({
      targetable: false,
      visibility: 'unavailable',
      reasonCode: 'line-of-sight-source-missing',
      consultedPlacementIds: ['target'],
    })
    expect(resolve({ targetPlacementId: 'missing' })).toMatchObject({
      targetable: false,
      visibility: 'unavailable',
      reasonCode: 'line-of-sight-target-missing',
      consultedPlacementIds: ['actor'],
    })

    expect(() => resolve({
      placements: [placement('actor', 0), placement('actor', 2)],
    })).toThrowError(expect.objectContaining({
      name: MoveAutomationLineOfSightError.name,
      code: 'duplicate-placement-id',
    }))
    expect(() => resolve({
      placements: [placement('actor', 0, 1, 0, { base: 33 }), placement('target', 4)],
    })).toThrowError(expect.objectContaining({ code: 'invalid-placement' }))
    expect(() => resolve({
      voxels: [voxel(2, 1, 0, { x: 0.5 })],
    })).toThrowError(expect.objectContaining({ code: 'invalid-voxel' }))
  })

  it('snapshots inputs and reports consulted footprints through the read-set seam', () => {
    const voxels = [voxel(2, 1, 0, { blocksSight: false })]
    const placements = [
      placement('actor', 0),
      placement('cover', 2),
      placement('target', 4),
    ]
    const recordPlacementRead = vi.fn()
    const resolver = createMoveAutomationLineOfSightResolver({
      voxels,
      placements,
      recordPlacementRead,
    })

    voxels[0]!.blocksSight = true
    placements[1]!.position.x = 20
    const result = resolver.resolve('actor', 'target')

    expect(result).toMatchObject({
      targetable: true,
      cover: 'rough-terrain',
      accuracyModifier: MOVE_AUTOMATION_ROUGH_COVER_ACCURACY_MODIFIER,
      coverPlacementIds: ['cover'],
    })
    expect(recordPlacementRead.mock.calls.map(([id]) => id)).toEqual([
      'actor',
      'cover',
      'target',
    ])
    expect(Object.isFrozen(resolver)).toBe(true)
  })
})
