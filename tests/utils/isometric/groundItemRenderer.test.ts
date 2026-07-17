import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { MapGroundItem } from '#shared/moveAutomation/groundItems'
import {
  GROUND_ITEM_MARKER_COLOR,
  GROUND_ITEM_MARKER_SELECTED_COLOR,
  GROUND_ITEM_MARKER_SELECTED_SCALE,
  GROUND_ITEM_MARKER_Y_OFFSET,
  createGroundItemRenderer,
} from '~/utils/isometric/groundItemRenderer'

const item = (id: string, x: number, quantity = 1): MapGroundItem => ({
  id,
  canonicalItemId: 'iron-ball',
  canonicalItemName: 'Iron Ball',
  quantity,
  position: { x, y: 1, z: 3 },
  sourceResource: { kind: 'map', slug: 'arena', revision: 5 },
  sourceOperationId: 'op_drop_item_0001',
  sideId: null,
  ownerPlacementId: null,
})

describe('isometric ground-item renderer', () => {
  it('renders bounded map items at their authoritative cells with stable pick identity', () => {
    const container = new THREE.Group()
    const renderer = createGroundItemRenderer(container)
    const items = [item('ground-item-a', 2), item('ground-item-b', 4, 3)]

    renderer.sync(items)
    const meshes = renderer.meshes()

    expect(meshes).toHaveLength(2)
    expect(container.children).toEqual(meshes)
    expect(meshes.map(mesh => mesh.userData.groundItemId)).toEqual([
      'ground-item-a',
      'ground-item-b',
    ])
    expect(meshes[0]?.position.toArray()).toEqual([2.5, 1 + GROUND_ITEM_MARKER_Y_OFFSET, 3.5])
    expect(meshes[0]?.userData.groundItem).toBe(items[0])

    const snapshot = renderer.meshes()
    snapshot.pop()
    expect(renderer.meshes()).toHaveLength(2)
  })

  it('highlights only the selected stable item ID and preserves selection across sync', () => {
    const container = new THREE.Group()
    const renderer = createGroundItemRenderer(container)
    renderer.sync([item('ground-item-a', 1), item('ground-item-b', 2)])

    renderer.setSelected('ground-item-b')
    let [first, second] = renderer.meshes()
    expect(first?.scale.x).toBe(1)
    expect(first?.material.color.getHex()).toBe(GROUND_ITEM_MARKER_COLOR)
    expect(second?.scale.x).toBe(GROUND_ITEM_MARKER_SELECTED_SCALE)
    expect(second?.material.color.getHex()).toBe(GROUND_ITEM_MARKER_SELECTED_COLOR)

    renderer.sync([item('ground-item-b', 3)])
    ;[second] = renderer.meshes()
    expect(second?.scale.x).toBe(GROUND_ITEM_MARKER_SELECTED_SCALE)
    expect(second?.material.color.getHex()).toBe(GROUND_ITEM_MARKER_SELECTED_COLOR)
  })

  it('disposes replaced and final marker resources', () => {
    const container = new THREE.Group()
    const renderer = createGroundItemRenderer(container)
    renderer.sync([item('ground-item-a', 1)])
    const first = renderer.meshes()[0]!
    const disposeGeometry = vi.spyOn(first.geometry, 'dispose')
    const disposeMaterial = vi.spyOn(first.material, 'dispose')

    renderer.sync([item('ground-item-b', 2)])
    expect(disposeGeometry).toHaveBeenCalledOnce()
    expect(disposeMaterial).toHaveBeenCalledOnce()
    expect(container.children).toHaveLength(1)

    const second = renderer.meshes()[0]!
    const disposeSecondGeometry = vi.spyOn(second.geometry, 'dispose')
    renderer.dispose()
    expect(disposeSecondGeometry).toHaveBeenCalledOnce()
    expect(container.children).toEqual([])
    expect(renderer.meshes()).toEqual([])
  })
})
