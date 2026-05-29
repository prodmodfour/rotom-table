import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { MOVE_VFX_KIND, type MoveAnimationEvent, type MoveVfxKind } from '~/types/moveAnimation'
import { createMoveVfxRenderer } from '~/utils/isometric/moveVfxRenderer'

const selfPulseEvent = (id = 'move-vfx-test'): MoveAnimationEvent => ({
  id,
  moveName: 'Test Move',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 560,
  kind: MOVE_VFX_KIND.selfPulse,
})

const eventForKind = (kind: MoveVfxKind, id = `move-vfx-${kind}`): MoveAnimationEvent => ({
  ...selfPulseEvent(id),
  kind,
}) as MoveAnimationEvent

const attachDisposableMesh = (group: THREE.Object3D) => {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshBasicMaterial()
  group.add(new THREE.Mesh(geometry, material))

  return {
    geometryDispose: vi.spyOn(geometry, 'dispose'),
    materialDispose: vi.spyOn(material, 'dispose'),
  }
}

describe('move VFX renderer shell', () => {
  it('constructs a dedicated hidden group and adds it to the scene', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    expect(scene.children).toContain(renderer.group)
    expect(renderer.group.name).toBe('move-vfx-root')
    expect(renderer.group.visible).toBe(false)
    expect(renderer.activeCount()).toBe(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
  })

  it('can use a caller-provided group', () => {
    const scene = new THREE.Scene()
    const group = new THREE.Group()
    group.name = 'custom-move-vfx-group'

    const renderer = createMoveVfxRenderer({ scene, group })

    expect(renderer.group).toBe(group)
    expect(scene.children).toContain(group)
    expect(group.name).toBe('custom-move-vfx-group')
  })

  it('tracks synced events as disposable lifecycle instance groups', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([selfPulseEvent()])

    const instanceGroup = renderer.group.children[0]
    expect(renderer.activeCount()).toBe(1)
    expect(renderer.group.visible).toBe(true)
    expect(renderer.needsAnimationFrame()).toBe(true)
    expect(instanceGroup).toBeInstanceOf(THREE.Group)
    expect(instanceGroup.name).toBe('move-vfx-instance:move-vfx-test')

    renderer.sync([], { visible: true })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.group.visible).toBe(false)
    expect(renderer.needsAnimationFrame()).toBe(false)
  })

  it('respects shell-level visibility while retaining synced event count', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([selfPulseEvent()], { visible: false })

    expect(renderer.activeCount()).toBe(1)
    expect(renderer.group.visible).toBe(false)
    expect(renderer.needsAnimationFrame()).toBe(true)
  })

  it('creates a safe placeholder instance through the factory for every registered effect kind', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const kinds = Object.values(MOVE_VFX_KIND) as MoveVfxKind[]
    const events = kinds.map((kind) => eventForKind(kind))

    expect(() => renderer.sync(events)).not.toThrow()

    expect(renderer.activeCount()).toBe(kinds.length)
    expect(renderer.group.children).toHaveLength(kinds.length)
    expect(renderer.needsAnimationFrame()).toBe(true)

    renderer.animate({ frameNowMs: 660, delta: 0.016 })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
  })

  it('falls back to a safe no-op instance for unknown runtime effect kinds', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const unknownEvent = {
      ...selfPulseEvent('move-vfx-unknown'),
      kind: 'future-effect',
    } as unknown as MoveAnimationEvent

    expect(() => renderer.sync([unknownEvent])).not.toThrow()

    expect(renderer.activeCount()).toBe(1)
    expect(renderer.group.children).toHaveLength(1)
    expect(renderer.group.children[0].name).toBe('move-vfx-instance:move-vfx-unknown')

    renderer.animate({ frameNowMs: 660, delta: 0.016 })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
  })

  it('does not duplicate a lifecycle instance when the same event id is synced repeatedly', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const event = selfPulseEvent()

    renderer.sync([event])
    const firstInstanceGroup = renderer.group.children[0]
    renderer.sync([event])

    expect(renderer.activeCount()).toBe(1)
    expect(renderer.group.children).toHaveLength(1)
    expect(renderer.group.children[0]).toBe(firstInstanceGroup)
  })

  it('disposes an instance and its primitive resources when the event is removed', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([selfPulseEvent()])
    const instanceGroup = renderer.group.children[0]
    const { geometryDispose, materialDispose } = attachDisposableMesh(instanceGroup)

    renderer.sync([])

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(instanceGroup.children).toHaveLength(0)
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
  })

  it('disposes completed instances during animation frames', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([selfPulseEvent()])
    const instanceGroup = renderer.group.children[0]
    const { geometryDispose, materialDispose } = attachDisposableMesh(instanceGroup)

    renderer.animate({ frameNowMs: 660, delta: 0.016 })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(instanceGroup.children).toHaveLength(0)
    expect(renderer.group.visible).toBe(false)
    expect(renderer.needsAnimationFrame()).toBe(false)
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
  })

  it('keeps active instances until their duration elapses', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([selfPulseEvent()])
    const instanceGroup = renderer.group.children[0]

    renderer.animate({ frameNowMs: 659, delta: 0.016 })

    expect(renderer.activeCount()).toBe(1)
    expect(renderer.group.children).toHaveLength(1)
    expect(renderer.group.children[0]).toBe(instanceGroup)
    expect(renderer.needsAnimationFrame()).toBe(true)
  })

  it('does not recreate a completed event until it has disappeared from synced input', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const event = selfPulseEvent()

    renderer.sync([event])
    renderer.animate({ frameNowMs: 660, delta: 0.016 })
    renderer.sync([event])

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)

    renderer.sync([])
    renderer.sync([event])

    expect(renderer.activeCount()).toBe(1)
    expect(renderer.group.children).toHaveLength(1)
  })

  it('disposes all active instances cleanly and idempotently', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([selfPulseEvent(), selfPulseEvent('move-vfx-second')])
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

    expect(() => {
      renderer.sync([selfPulseEvent('move-vfx-after-dispose')])
      renderer.animate({ frameNowMs: 200, delta: 0.016 })
    }).not.toThrow()
    expect(scene.children).not.toContain(renderer.group)
  })
})
