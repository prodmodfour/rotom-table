import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { MapVoxelV2 } from '~/types/map'
import {
  resolveSmartCutawayFocusTokenIds,
  resolveSmartTerrainCutawayVoxelKeys,
  smartCutawayFocusPointsForToken,
  smartGhostVoxelKeySetSignature,
  smartGhostVoxelKeySetsEqual,
} from '~/utils/isometric/smartTerrainCutaway'

const voxel = (x: number, y: number, z: number): MapVoxelV2 => ({
  x,
  y,
  z,
  materialId: 'airship_floor_metal',
})

const makeCamera = () => {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100)
  camera.position.set(0, 0, 0)
  camera.lookAt(0, 0, -1)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera
}

const makeHit = (
  object: THREE.Object3D,
  instanceId: number | undefined,
  distance: number,
): THREE.Intersection => ({
  distance,
  object,
  instanceId,
  point: new THREE.Vector3(),
} as THREE.Intersection)

describe('smart terrain cutaway utilities', () => {
  it('builds stable smart ghost key signatures and compares sets by value', () => {
    const left = new Set(['2,0,0', '0,0,0'])
    const right = new Set(['0,0,0', '2,0,0'])

    expect(smartGhostVoxelKeySetSignature(left)).toBe('0,0,0|2,0,0')
    expect(smartGhostVoxelKeySetSignature(new Set())).toBe('')
    expect(smartGhostVoxelKeySetsEqual(left, right)).toBe(true)
    expect(smartGhostVoxelKeySetsEqual(left, new Set(['2,0,0']))).toBe(false)
    expect(smartGhostVoxelKeySetsEqual(null, new Set())).toBe(true)
  })

  it('orders focus token ids by gameplay importance while de-duplicating overlaps', () => {
    expect(resolveSmartCutawayFocusTokenIds({
      selectedId: 'selected',
      activeTurnId: 'active',
      moveAutomationTargeting: {
        userId: 'user',
        moveName: 'Thunderbolt',
        mode: 'target',
        rangeLabel: '6m',
        rangeMeters: 6,
        affectedIds: ['affected', 'candidate'],
        candidateIds: ['candidate', 'selected'],
      },
      hoveredId: 'hovered',
      attackOfOpportunityPrompts: [{
        id: 'aoo-1',
        attackerId: 'attacker',
        attackerName: 'Attacker',
        provokerId: 'selected',
        provokerName: 'Selected',
        reason: 'movement',
        round: 1,
        struggleOptions: [],
      }],
    })).toEqual([
      'selected',
      'active',
      'user',
      'affected',
      'candidate',
      'attacker',
    ])

    expect(resolveSmartCutawayFocusTokenIds({
      selectedId: null,
      hoveredId: 'hovered',
    })).toEqual(['hovered'])
  })

  it('samples body, head, base, and shoulder-ish focus points for tokens', () => {
    const points = smartCutawayFocusPointsForToken({
      center: new THREE.Vector3(4, 1, 5),
      base: 2,
      height: 3,
      clearance: 2,
    })

    expect(points).toHaveLength(7)
    expect(points[0]).toEqual(expect.objectContaining({ x: 4, y: 2.5, z: 5 }))
    expect(points[1]!.y).toBeGreaterThan(points[0]!.y)
    expect(points[2]!.y).toBeGreaterThan(1)
    expect(points.some((point) => point.x > 4)).toBe(true)
    expect(points.some((point) => point.x < 4)).toBe(true)
    expect(points.some((point) => point.z > 5)).toBe(true)
    expect(points.some((point) => point.z < 5)).toBe(true)
  })

  it('resolves occluding voxel keys from ray hits before the focus point and dilates in x/z within the cap', () => {
    const mesh = new THREE.Object3D()
    mesh.userData.voxels = [voxel(1, 0, 1), voxel(3, 0, 1)]
    const scratch: THREE.Intersection[] = []
    const intersectObjects = vi.fn((_targets: THREE.Object3D[], _recursive: boolean, optionalTarget?: THREE.Intersection[]) => {
      optionalTarget?.push(
        makeHit(mesh, 0, 2),
        makeHit(mesh, 0, 2.2),
        makeHit(mesh, 1, 4),
        makeHit(mesh, 1, 8),
      )
      return optionalTarget ?? []
    })
    const raycaster = {
      ray: { origin: new THREE.Vector3(0, 0, 0) },
      setFromCamera: vi.fn(),
      intersectObjects,
    } as unknown as THREE.Raycaster

    const keys = resolveSmartTerrainCutawayVoxelKeys({
      camera: makeCamera(),
      raycaster,
      voxelMeshes: [mesh],
      focusPoints: [new THREE.Vector3(0, 0, -5)],
      terrainVoxelKeys: new Set([
        '1,0,1',
        '2,0,1',
        '0,0,1',
        '1,0,2',
        '1,0,0',
        '3,0,1',
      ]),
      maxVoxels: 6,
      maxHitsPerRay: 2,
      intersections: scratch,
    })

    expect(raycaster.setFromCamera).toHaveBeenCalledTimes(1)
    expect(intersectObjects).toHaveBeenCalledWith([mesh], false, scratch)
    expect(Array.from(keys)).toEqual([
      '1,0,1',
      '2,0,1',
      '0,0,1',
      '1,0,2',
      '1,0,0',
      '3,0,1',
    ])
  })

  it('can return undilated source hits and ignores intersections beyond the focus point', () => {
    const mesh = new THREE.Object3D()
    mesh.userData.voxels = [voxel(1, 0, 1), voxel(2, 0, 1)]
    const raycaster = {
      ray: { origin: new THREE.Vector3(0, 0, 0) },
      setFromCamera: vi.fn(),
      intersectObjects: vi.fn((_targets: THREE.Object3D[], _recursive: boolean, optionalTarget?: THREE.Intersection[]) => {
        optionalTarget?.push(
          makeHit(mesh, 0, 2),
          makeHit(mesh, 1, 7),
        )
        return optionalTarget ?? []
      }),
    } as unknown as THREE.Raycaster

    const keys = resolveSmartTerrainCutawayVoxelKeys({
      camera: makeCamera(),
      raycaster,
      voxelMeshes: [mesh],
      focusPoints: [new THREE.Vector3(0, 0, -5)],
      dilateXZ: false,
    })

    expect(Array.from(keys)).toEqual(['1,0,1'])
  })

  it('skips ray work when the requested voxel or per-ray hit cap is zero', () => {
    const mesh = new THREE.Object3D()
    const raycaster = {
      ray: { origin: new THREE.Vector3(0, 0, 0) },
      setFromCamera: vi.fn(),
      intersectObjects: vi.fn(),
    } as unknown as THREE.Raycaster

    expect(resolveSmartTerrainCutawayVoxelKeys({
      camera: makeCamera(),
      raycaster,
      voxelMeshes: [mesh],
      focusPoints: [new THREE.Vector3(0, 0, -5)],
      maxVoxels: 0,
    }).size).toBe(0)
    expect(resolveSmartTerrainCutawayVoxelKeys({
      camera: makeCamera(),
      raycaster,
      voxelMeshes: [mesh],
      focusPoints: [new THREE.Vector3(0, 0, -5)],
      maxHitsPerRay: 0,
    }).size).toBe(0)
    expect(raycaster.setFromCamera).not.toHaveBeenCalled()
    expect(raycaster.intersectObjects).not.toHaveBeenCalled()
  })
})
