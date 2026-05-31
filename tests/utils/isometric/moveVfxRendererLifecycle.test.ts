import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { MOVE_VFX_KIND, type MoveAnimationEvent, type MoveSelfPulseAnimationEvent } from '~/types/moveAnimation'
import { createMoveVfxRenderer } from '~/utils/isometric/moveVfxRenderer'

const selfPulseEvent = (overrides: Partial<MoveSelfPulseAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'move-vfx-lifecycle',
  moveName: 'Lifecycle Pulse',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 560,
  kind: MOVE_VFX_KIND.selfPulse,
  ...overrides,
}) as MoveAnimationEvent

const firstInstanceGroup = (renderer: ReturnType<typeof createMoveVfxRenderer>): THREE.Group => {
  const instanceGroup = renderer.group.children[0]
  expect(instanceGroup).toBeInstanceOf(THREE.Group)
  return instanceGroup as THREE.Group
}

const attachDisposableMesh = (group: THREE.Object3D) => {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshBasicMaterial()
  const mesh = new THREE.Mesh(geometry, material)
  group.add(mesh)

  return {
    geometryDispose: vi.spyOn(geometry, 'dispose'),
    materialDispose: vi.spyOn(material, 'dispose'),
  }
}

describe('move VFX renderer lifecycle', () => {
  it('constructs a root group and adds it to the scene without requiring WebGL', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    expect(scene.children).toContain(renderer.group)
    expect(renderer.group.name).toBe('move-vfx-root')
    expect(renderer.group.visible).toBe(false)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.activeCount()).toBe(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    expect(renderer.debugSnapshot()).toEqual({
      activeCount: 0,
      instanceGroupCount: 0,
      needsAnimationFrame: false,
      visible: false,
      css3DActive: false,
      layerVisible: true,
      disposed: false,
    })
  })

  it('syncs an incoming event into one active instance group', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const event = selfPulseEvent()

    renderer.sync([event])

    const instanceGroup = firstInstanceGroup(renderer)
    expect(renderer.group.children).toHaveLength(1)
    expect(instanceGroup.name).toBe('move-vfx-instance:move-vfx-lifecycle')
    expect(renderer.group.visible).toBe(true)
    expect(renderer.activeCount()).toBe(1)
    expect(renderer.needsAnimationFrame()).toBe(true)
    expect(renderer.debugSnapshot()).toMatchObject({
      activeCount: 1,
      instanceGroupCount: 1,
      needsAnimationFrame: true,
      visible: true,
      disposed: false,
    })
  })

  it('removes and disposes an instance when its event leaves the synced input', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([selfPulseEvent()])
    const instanceGroup = firstInstanceGroup(renderer)
    const resources = attachDisposableMesh(instanceGroup)

    renderer.sync([])
    renderer.sync([])

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.group.visible).toBe(false)
    expect(renderer.needsAnimationFrame()).toBe(false)
    expect(instanceGroup.children).toHaveLength(0)
    expect(resources.geometryDispose).toHaveBeenCalledOnce()
    expect(resources.materialDispose).toHaveBeenCalledOnce()
  })

  it('disposes completed instances during animation frames', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([selfPulseEvent()])
    const instanceGroup = firstInstanceGroup(renderer)
    const resources = attachDisposableMesh(instanceGroup)

    renderer.animate({ frameNowMs: 659, delta: 0.016 })

    expect(renderer.activeCount()).toBe(1)
    expect(renderer.group.children).toHaveLength(1)
    expect(resources.geometryDispose).not.toHaveBeenCalled()
    expect(resources.materialDispose).not.toHaveBeenCalled()

    renderer.animate({ frameNowMs: 660, delta: 0.016 })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.group.visible).toBe(false)
    expect(renderer.needsAnimationFrame()).toBe(false)
    expect(instanceGroup.children).toHaveLength(0)
    expect(resources.geometryDispose).toHaveBeenCalledOnce()
    expect(resources.materialDispose).toHaveBeenCalledOnce()
  })

  it('returns to zero active groups after repeated animation batches settle', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    for (let cycle = 0; cycle < 6; cycle += 1) {
      const startMs = 1000 + cycle * 1000
      const events = [
        selfPulseEvent({ id: `move-vfx-stress-${cycle}-a`, createdAtMs: startMs, durationMs: 120 }),
        selfPulseEvent({ id: `move-vfx-stress-${cycle}-b`, createdAtMs: startMs, durationMs: 120 }),
      ]

      renderer.sync(events)
      expect(renderer.activeCount()).toBe(2)
      expect(renderer.group.children).toHaveLength(2)
      expect(renderer.needsAnimationFrame()).toBe(true)

      renderer.animate({ frameNowMs: startMs + 119, delta: 0.016 })
      expect(renderer.activeCount()).toBe(2)
      expect(renderer.group.children).toHaveLength(2)

      renderer.animate({ frameNowMs: startMs + 120, delta: 0.016 })
      expect(renderer.activeCount()).toBe(0)
      expect(renderer.group.children).toHaveLength(0)
      expect(renderer.needsAnimationFrame()).toBe(false)

      renderer.sync([])
      expect(renderer.debugSnapshot()).toMatchObject({
        activeCount: 0,
        instanceGroupCount: 0,
        needsAnimationFrame: false,
        visible: false,
      })
    }
  })

  it('disposes all active instances and removes the root group idempotently', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([
      selfPulseEvent(),
      selfPulseEvent({ id: 'move-vfx-lifecycle-second' }),
    ])
    const instanceGroups = [...renderer.group.children]
    const firstResources = attachDisposableMesh(instanceGroups[0])
    const secondResources = attachDisposableMesh(instanceGroups[1])

    renderer.dispose()
    renderer.dispose()

    expect(scene.children).not.toContain(renderer.group)
    expect(renderer.group.children).toHaveLength(0)
    expect(instanceGroups[0].children).toHaveLength(0)
    expect(instanceGroups[1].children).toHaveLength(0)
    expect(renderer.activeCount()).toBe(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    expect(firstResources.geometryDispose).toHaveBeenCalledOnce()
    expect(firstResources.materialDispose).toHaveBeenCalledOnce()
    expect(secondResources.geometryDispose).toHaveBeenCalledOnce()
    expect(secondResources.materialDispose).toHaveBeenCalledOnce()
    expect(renderer.debugSnapshot()).toMatchObject({
      activeCount: 0,
      instanceGroupCount: 0,
      needsAnimationFrame: false,
      visible: false,
      layerVisible: false,
      disposed: true,
    })

    expect(() => {
      renderer.sync([selfPulseEvent({ id: 'move-vfx-after-dispose' })])
      renderer.animate({ frameNowMs: 200, delta: 0.016 })
      renderer.dispose()
    }).not.toThrow()
    expect(scene.children).not.toContain(renderer.group)
  })
})
