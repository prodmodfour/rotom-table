import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { MOVE_VFX_KIND, type MoveAnimationEvent } from '~/types/moveAnimation'
import { createMoveVfxRenderer } from '~/utils/isometric/moveVfxRenderer'

const selfPulseEvent = (id = 'move-vfx-test'): MoveAnimationEvent => ({
  id,
  moveName: 'Test Move',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 560,
  kind: MOVE_VFX_KIND.selfPulse,
})

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

  it('accepts synced events without starting an animation continuation yet', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([selfPulseEvent()])

    expect(renderer.activeCount()).toBe(1)
    expect(renderer.group.visible).toBe(true)
    expect(renderer.needsAnimationFrame()).toBe(false)

    renderer.sync([], { visible: true })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.visible).toBe(false)
  })

  it('respects shell-level visibility while retaining synced event count', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([selfPulseEvent()], { visible: false })

    expect(renderer.activeCount()).toBe(1)
    expect(renderer.group.visible).toBe(false)
  })

  it('disposes cleanly and idempotently', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([selfPulseEvent()])
    renderer.dispose()
    renderer.dispose()

    expect(scene.children).not.toContain(renderer.group)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.activeCount()).toBe(0)
    expect(renderer.needsAnimationFrame()).toBe(false)

    expect(() => {
      renderer.sync([selfPulseEvent('move-vfx-after-dispose')])
      renderer.animate({ frameNowMs: 200, delta: 0.016 })
    }).not.toThrow()
    expect(scene.children).not.toContain(renderer.group)
  })
})
