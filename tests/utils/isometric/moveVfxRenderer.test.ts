import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { MOVE_VFX_KIND, type MoveAnimationEvent, type MoveProjectileAnimationEvent, type MoveVfxKind } from '~/types/moveAnimation'
import type { MoveVfxPaletteEntry } from '~/utils/moveAnimationPalette'
import { createMoveVfxRenderer } from '~/utils/isometric/moveVfxRenderer'
import type { PokemonRenderObject } from '~/utils/isometric/types'

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

const projectilePalette: MoveVfxPaletteEntry = {
  key: 'Fire',
  label: 'Test Fire',
  primary: '#123456',
  accent: '#ffeeaa',
  glow: '#aa3300',
}

const projectileEvent = (overrides: Partial<MoveProjectileAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'move-vfx-projectile',
  moveName: 'Ember',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 1000,
  kind: MOVE_VFX_KIND.projectile,
  targetId: 'target-1',
  palette: projectilePalette,
  ...overrides,
}) as MoveAnimationEvent

const makeRenderObject = (overrides: Partial<PokemonRenderObject> = {}): PokemonRenderObject => ({
  id: 'user-1',
  currentCenter: new THREE.Vector3(0, 0, 0),
  targetCenter: new THREE.Vector3(0, 0, 0),
  width: 2,
  height: 2,
  base: 2,
  clearance: 2,
  ...overrides,
}) as PokemonRenderObject

const expectVectorClose = (actual: THREE.Vector3, expected: [number, number, number]) => {
  expect(actual.x).toBeCloseTo(expected[0])
  expect(actual.y).toBeCloseTo(expected[1])
  expect(actual.z).toBeCloseTo(expected[2])
}

const projectileMeshNamed = (
  group: THREE.Object3D,
  name: string,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === name)
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
}

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
    expect(renderer.debugSnapshot()).toEqual({
      activeCount: 0,
      instanceGroupCount: 0,
      needsAnimationFrame: false,
      visible: false,
      layerVisible: true,
      disposed: false,
    })
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
    expect(renderer.debugSnapshot()).toEqual({
      activeCount: 1,
      instanceGroupCount: 1,
      needsAnimationFrame: true,
      visible: false,
      layerVisible: false,
      disposed: false,
    })
  })

  it('ages out hidden events without resurrecting completed effects when made visible again', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const event = selfPulseEvent()

    renderer.sync([event], { visible: false })
    renderer.animate({ frameNowMs: 659, delta: 0.016, visible: false })

    expect(renderer.activeCount()).toBe(1)
    expect(renderer.group.visible).toBe(false)
    expect(renderer.needsAnimationFrame()).toBe(true)

    renderer.animate({ frameNowMs: 660, delta: 0.016, visible: false })
    renderer.sync([event], { visible: true })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.group.visible).toBe(false)
    expect(renderer.needsAnimationFrame()).toBe(false)
  })

  it('expires wall-clock-completed hidden-tab instances before a resumed render frame', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const shortEvent = selfPulseEvent('move-vfx-short')
    const lingeringEvent = selfPulseEvent('move-vfx-linger')

    renderer.sync([
      shortEvent,
      { ...lingeringEvent, durationMs: 1200 },
    ], { visible: true })

    expect(renderer.expireCompleted(659)).toBe(0)
    expect(renderer.activeCount()).toBe(2)
    expect(renderer.group.visible).toBe(true)

    expect(renderer.expireCompleted(660)).toBe(1)
    expect(renderer.activeCount()).toBe(1)
    expect(renderer.group.children.map((child) => child.name)).toEqual([
      'move-vfx-instance:move-vfx-linger',
    ])
    expect(renderer.needsAnimationFrame()).toBe(true)

    renderer.sync([shortEvent, lingeringEvent], { visible: true })

    expect(renderer.activeCount()).toBe(1)
    expect(renderer.group.children.map((child) => child.name)).toEqual([
      'move-vfx-instance:move-vfx-linger',
    ])
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

  it('renders projectile events as palette-coloured spheres travelling between locked token anchors', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 0, 0) })
    const renderObjects = new Map([
      [user.id, user],
      [target.id, target],
    ])

    renderer.sync([projectileEvent()], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const core = projectileMeshNamed(instanceGroup, 'move-vfx-projectile-core')
    const glow = projectileMeshNamed(instanceGroup, 'move-vfx-projectile-glow')

    expect(instanceGroup).toBeInstanceOf(THREE.Group)
    expect(instanceGroup.children).toHaveLength(2)
    expectVectorClose(instanceGroup.position, [0, 1.16, 0])
    expect(core.material.color.getHexString()).toBe('ffeeaa')
    expect(glow.material.color.getHexString()).toBe('123456')
    expect(core.material.transparent).toBe(true)
    expect(core.material.depthWrite).toBe(false)
    expect(core.renderOrder).toBe(34)
    expect(core.scale.x).toBeCloseTo(0.266)

    renderer.animate({ frameNowMs: 600, delta: 0.016, renderObjects })

    expectVectorClose(instanceGroup.position, [2, 1.16, 0])

    target.currentCenter.set(12, 0, 0)
    renderer.animate({ frameNowMs: 1099, delta: 0.016, renderObjects })

    expect(instanceGroup.position.x).toBeGreaterThan(3.9)
    expect(instanceGroup.position.x).toBeLessThan(4.01)

    renderer.animate({ frameNowMs: 1100, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
  })

  it('uses grid-cell fallbacks for projectile targets when the token render object is missing', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const renderObjects = new Map([[user.id, user]])

    renderer.sync([
      projectileEvent({
        targetId: 'missing-target',
        targetCell: { x: 5, y: 0, z: 2 },
      }),
    ], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    expect(instanceGroup.children).toHaveLength(2)

    renderer.animate({ frameNowMs: 600, delta: 0.016, renderObjects })

    expectVectorClose(instanceGroup.position, [2.75, 0.58, 1.25])
  })

  it('falls back to a no-op projectile when anchors cannot be resolved', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1' })
    const renderObjects = new Map([[user.id, user]])

    renderer.sync([projectileEvent({ targetId: 'missing-target' })], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    expect(instanceGroup.children).toHaveLength(0)
    expect(renderer.activeCount()).toBe(1)

    renderer.animate({ frameNowMs: 1100, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
  })

  it('disposes projectile geometry and materials when projectile events are removed', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 0, 0) })
    const renderObjects = new Map([
      [user.id, user],
      [target.id, target],
    ])

    renderer.sync([projectileEvent()], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const meshes = instanceGroup.children as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[]
    const geometryDisposeSpies = meshes.map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = meshes.map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    renderer.sync([])

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(instanceGroup.children).toHaveLength(0)
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce()
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce()
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
    expect(renderer.debugSnapshot()).toEqual({
      activeCount: 0,
      instanceGroupCount: 0,
      needsAnimationFrame: false,
      visible: false,
      layerVisible: false,
      disposed: true,
    })

    expect(() => {
      renderer.sync([selfPulseEvent('move-vfx-after-dispose')])
      renderer.animate({ frameNowMs: 200, delta: 0.016 })
    }).not.toThrow()
    expect(scene.children).not.toContain(renderer.group)
  })
})
