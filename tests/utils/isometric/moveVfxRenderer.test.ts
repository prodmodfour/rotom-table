import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { MOVE_VFX_KIND, type MoveAnimationEvent, type MoveArcAnimationEvent, type MoveBeamAnimationEvent, type MoveImpactRingAnimationEvent, type MoveMeleeLungeAnimationEvent, type MoveMissAnimationEvent, type MoveProjectileAnimationEvent, type MoveTargetFlashAnimationEvent, type MoveVfxKind } from '~/types/moveAnimation'
import { MOVE_VFX_TONE_COLORS, type MoveVfxPaletteEntry } from '~/utils/moveAnimationPalette'
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

const arcEvent = (overrides: Partial<MoveArcAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'move-vfx-arc',
  moveName: 'Rock Throw',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 1000,
  kind: MOVE_VFX_KIND.arc,
  targetId: 'target-1',
  palette: projectilePalette,
  ...overrides,
}) as MoveAnimationEvent

const beamEvent = (overrides: Partial<MoveBeamAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'move-vfx-beam',
  moveName: 'Psybeam',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 1000,
  kind: MOVE_VFX_KIND.beam,
  targetId: 'target-1',
  palette: projectilePalette,
  ...overrides,
}) as MoveAnimationEvent

const meleeLungeEvent = (overrides: Partial<MoveMeleeLungeAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'move-vfx-melee-lunge',
  moveName: 'Tackle',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 1000,
  kind: MOVE_VFX_KIND.meleeLunge,
  targetId: 'target-1',
  palette: projectilePalette,
  ...overrides,
}) as MoveAnimationEvent

const targetFlashEvent = (
  overrides: Partial<Omit<MoveTargetFlashAnimationEvent, 'palette' | 'tone'>> & {
    palette?: MoveVfxPaletteEntry | undefined
    tone?: unknown
  } = {},
): MoveAnimationEvent => ({
  id: 'move-vfx-target-flash',
  moveName: 'Thunder Wave',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 240,
  kind: MOVE_VFX_KIND.targetFlash,
  targetId: 'target-1',
  palette: projectilePalette,
  ...overrides,
}) as MoveAnimationEvent

const impactRingEvent = (
  overrides: Partial<Omit<MoveImpactRingAnimationEvent, 'palette' | 'tone'>> & {
    palette?: MoveVfxPaletteEntry | undefined
    tone?: unknown
  } = {},
): MoveAnimationEvent => ({
  id: 'move-vfx-impact-ring',
  moveName: 'Thunder Punch',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 260,
  kind: MOVE_VFX_KIND.impactRing,
  targetId: 'target-1',
  palette: projectilePalette,
  ...overrides,
}) as MoveAnimationEvent

const missEvent = (overrides: Partial<MoveMissAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'move-vfx-miss',
  moveName: 'Ember',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 260,
  kind: MOVE_VFX_KIND.miss,
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

const projectileTrailMeshes = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] => {
  const meshes = group.children.filter((child) => child.name.startsWith('move-vfx-projectile-trail-'))
  expect(meshes).toHaveLength(4)
  return meshes as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[]
}

const arcTrailMeshes = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] => {
  const meshes = group.children.filter((child) => child.name.startsWith('move-vfx-arc-trail-'))
  expect(meshes).toHaveLength(4)
  return meshes as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[]
}

const beamCylinderNamed = (
  group: THREE.Object3D,
  name: string,
): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === name)
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
}

const beamRingNamed = (
  group: THREE.Object3D,
  name: string,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === name)
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
}

const meleeLungeGhostNamed = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === 'move-vfx-melee-lunge-ghost')
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
}

const meleeLungeStreakNamed = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === 'move-vfx-melee-lunge-streak')
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
}

const meleeLungeImpactRingNamed = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === 'move-vfx-melee-lunge-impact-ring')
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
}

const targetFlashShellNamed = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === 'move-vfx-target-flash-shell')
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
}

const targetFlashRingNamed = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === 'move-vfx-target-flash-ring')
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
}

const impactRingNamed = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === 'move-vfx-impact-ring')
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
}

const missPuffRingNamed = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === 'move-vfx-miss-puff-ring')
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
}

const missPuffCloudMeshes = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] => {
  const meshes = group.children.filter((child) => child.name.startsWith('move-vfx-miss-puff-cloud-'))
  expect(meshes).toHaveLength(3)
  return meshes as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[]
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
    const trailSegments = projectileTrailMeshes(instanceGroup)

    expect(instanceGroup).toBeInstanceOf(THREE.Group)
    expect(instanceGroup.children).toHaveLength(6)
    expectVectorClose(instanceGroup.position, [0, 1.16, 0])
    expect(core.material.color.getHexString()).toBe('ffeeaa')
    expect(glow.material.color.getHexString()).toBe('123456')
    expect(core.material.transparent).toBe(true)
    expect(core.material.depthWrite).toBe(false)
    expect(core.renderOrder).toBe(34)
    expect(trailSegments.map((segment) => segment.name)).toEqual([
      'move-vfx-projectile-trail-1',
      'move-vfx-projectile-trail-2',
      'move-vfx-projectile-trail-3',
      'move-vfx-projectile-trail-4',
    ])
    expect(trailSegments[0].material.color.getHexString()).toBe('aa3300')
    expect(trailSegments[0].renderOrder).toBe(33)
    expect(trailSegments.every((segment) => segment.material.opacity === 0)).toBe(true)
    expect(core.scale.x).toBeCloseTo(0.266)

    renderer.animate({ frameNowMs: 600, delta: 0.016, renderObjects })

    expectVectorClose(instanceGroup.position, [2, 1.16, 0])
    expect(trailSegments[0].visible).toBe(true)
    expect(trailSegments[0].position.x).toBeLessThan(0)
    expect(trailSegments[3].position.x).toBeLessThan(trailSegments[0].position.x)
    expect(trailSegments[0].material.opacity).toBeGreaterThan(trailSegments[3].material.opacity)

    const projectileMeshes = [core, glow, ...trailSegments]
    const geometryDisposeSpies = projectileMeshes.map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = projectileMeshes.map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    target.currentCenter.set(12, 0, 0)
    renderer.animate({ frameNowMs: 1099, delta: 0.016, renderObjects })

    expect(instanceGroup.position.x).toBeGreaterThan(3.9)
    expect(instanceGroup.position.x).toBeLessThan(4.01)

    renderer.animate({ frameNowMs: 1100, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce()
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce()
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
    expect(instanceGroup.children).toHaveLength(6)
    expect(projectileTrailMeshes(instanceGroup)).toHaveLength(4)

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
    expect(meshes).toHaveLength(6)
    const geometryDisposeSpies = meshes.map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = meshes.map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    renderer.sync([])

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(instanceGroup.children).toHaveLength(0)
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce()
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce()
  })

  it('renders arc events as palette-coloured lob projectiles along a locked vertical curve', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 0, 0) })
    const renderObjects = new Map([
      [user.id, user],
      [target.id, target],
    ])

    renderer.sync([arcEvent({ arcHeight: 1.2 })], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const core = projectileMeshNamed(instanceGroup, 'move-vfx-arc-core')
    const glow = projectileMeshNamed(instanceGroup, 'move-vfx-arc-glow')
    const trailSegments = arcTrailMeshes(instanceGroup)

    expect(instanceGroup).toBeInstanceOf(THREE.Group)
    expect(instanceGroup.children).toHaveLength(6)
    expectVectorClose(instanceGroup.position, [0, 1.16, 0])
    expect(core.material.color.getHexString()).toBe('ffeeaa')
    expect(glow.material.color.getHexString()).toBe('123456')
    expect(core.material.transparent).toBe(true)
    expect(core.material.depthWrite).toBe(false)
    expect(core.renderOrder).toBe(34)
    expect(trailSegments.map((segment) => segment.name)).toEqual([
      'move-vfx-arc-trail-1',
      'move-vfx-arc-trail-2',
      'move-vfx-arc-trail-3',
      'move-vfx-arc-trail-4',
    ])
    expect(trailSegments[0].material.color.getHexString()).toBe('aa3300')
    expect(trailSegments.every((segment) => segment.material.opacity === 0)).toBe(true)
    expect(core.scale.x).toBeCloseTo(0.266)

    renderer.animate({ frameNowMs: 600, delta: 0.016, renderObjects })

    expectVectorClose(instanceGroup.position, [2, 2.36, 0])
    expect(trailSegments[0].visible).toBe(true)
    expect(trailSegments[0].position.x).toBeLessThan(0)
    expect(trailSegments[0].position.y).toBeLessThan(0)
    expect(trailSegments[3].position.x).toBeLessThan(trailSegments[0].position.x)
    expect(trailSegments[0].material.opacity).toBeGreaterThan(trailSegments[3].material.opacity)

    const arcMeshes = [core, glow, ...trailSegments]
    const geometryDisposeSpies = arcMeshes.map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = arcMeshes.map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    target.currentCenter.set(12, 0, 0)
    renderer.animate({ frameNowMs: 1099, delta: 0.016, renderObjects })

    expect(instanceGroup.position.x).toBeGreaterThan(3.9)
    expect(instanceGroup.position.x).toBeLessThan(4.01)
    expect(instanceGroup.position.y).toBeGreaterThan(1.15)
    expect(instanceGroup.position.y).toBeLessThan(1.18)

    renderer.animate({ frameNowMs: 1100, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce()
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce()
  })

  it('clamps requested arc event heights to keep long lobs bounded', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(20, 0, 0) })
    const renderObjects = new Map([
      [user.id, user],
      [target.id, target],
    ])

    renderer.sync([arcEvent({ arcHeight: 99 })], { renderObjects })
    renderer.animate({ frameNowMs: 600, delta: 0.016, renderObjects })

    const instanceGroup = renderer.group.children[0]
    expectVectorClose(instanceGroup.position, [10, 3.56, 0])
  })

  it('falls back to a no-op arc when anchors cannot be resolved', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1' })
    const renderObjects = new Map([[user.id, user]])

    renderer.sync([arcEvent({ targetId: 'missing-target' })], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    expect(instanceGroup.children).toHaveLength(0)
    expect(renderer.activeCount()).toBe(1)

    renderer.animate({ frameNowMs: 1100, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
  })

  it('renders beam events as palette-coloured cylinders between locked token anchors', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 0, 0) })
    const renderObjects = new Map([
      [user.id, user],
      [target.id, target],
    ])

    renderer.sync([beamEvent()], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const glow = beamCylinderNamed(instanceGroup, 'move-vfx-beam-glow')
    const core = beamCylinderNamed(instanceGroup, 'move-vfx-beam-core')
    expect(instanceGroup.children).toHaveLength(2)
    expectVectorClose(instanceGroup.position, [2, 1.16, 0])
    expect(glow.material.color.getHexString()).toBe('123456')
    expect(core.material.color.getHexString()).toBe('ffeeaa')
    expect(core.material.transparent).toBe(true)
    expect(core.material.depthWrite).toBe(false)
    expect(core.renderOrder).toBe(35)
    expect(core.scale.y).toBeCloseTo(4)
    expect(core.material.opacity).toBe(0)

    const geometryDisposeSpies = [glow, core].map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = [glow, core].map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    renderer.animate({ frameNowMs: 600, delta: 0.016, renderObjects })

    expect(core.material.opacity).toBeCloseTo(0.86)
    expect(glow.material.opacity).toBeCloseTo(0.3)
    expect(core.scale.x).toBeGreaterThan(0.12)

    target.currentCenter.set(12, 0, 0)
    renderer.animate({ frameNowMs: 900, delta: 0.016, renderObjects })

    expectVectorClose(instanceGroup.position, [2, 1.16, 0])
    expect(core.scale.y).toBeCloseTo(4)

    renderer.animate({ frameNowMs: 1100, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce()
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce()
  })

  it('uses area-cell centroid targets for beam events when no target token is provided', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const renderObjects = new Map([[user.id, user]])

    renderer.sync([
      beamEvent({
        targetId: undefined,
        areaCells: [
          { x: 2, y: 0, z: 0 },
          { x: 4, y: 0, z: 2 },
        ],
      }),
    ], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    expect(instanceGroup.children).toHaveLength(2)
    expectVectorClose(instanceGroup.position, [1.75, 0.58, 0.75])

    renderer.animate({ frameNowMs: 600, delta: 0.016, renderObjects })

    const core = beamCylinderNamed(instanceGroup, 'move-vfx-beam-core')
    expect(core.material.opacity).toBeGreaterThan(0)
    expect(core.scale.y).toBeGreaterThan(3.95)
    expect(core.scale.y).toBeLessThan(4.05)
  })

  it('adds an optional target-end impact ring for beam events that request it', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 0, 0) })
    const renderObjects = new Map([
      [user.id, user],
      [target.id, target],
    ])

    renderer.sync([beamEvent({ impact: true })], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const ring = beamRingNamed(instanceGroup, 'move-vfx-beam-impact-ring')
    expect(instanceGroup.children).toHaveLength(3)
    expect(ring.material.color.getHexString()).toBe('ffeeaa')
    expect(ring.renderOrder).toBe(36)
    expect(ring.position.y).toBeCloseTo(2)
    expect(ring.visible).toBe(false)

    renderer.animate({ frameNowMs: 600, delta: 0.016, renderObjects })

    expect(ring.visible).toBe(true)
    expect(ring.material.opacity).toBeGreaterThan(0)
    expect(ring.scale.x).toBeGreaterThan(0.4)

    const meshes = instanceGroup.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[]
    const geometryDisposeSpies = meshes.map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = meshes.map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    renderer.sync([])

    expect(renderer.activeCount()).toBe(0)
    expect(instanceGroup.children).toHaveLength(0)
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce()
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce()
  })

  it('falls back to a no-op beam when anchors cannot be resolved', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1' })
    const renderObjects = new Map([[user.id, user]])

    renderer.sync([beamEvent({ targetId: 'missing-target' })], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    expect(instanceGroup.children).toHaveLength(0)
    expect(renderer.activeCount()).toBe(1)

    renderer.animate({ frameNowMs: 1100, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
  })

  it('renders melee lunge events as VFX-owned overlay motion without moving token placement', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 0, 0) })
    const renderObjects = new Map([
      [user.id, user],
      [target.id, target],
    ])
    const userPlacement = user.currentCenter.clone()
    const targetPlacement = target.currentCenter.clone()

    renderer.sync([meleeLungeEvent()], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const streak = meleeLungeStreakNamed(instanceGroup)
    const ghost = meleeLungeGhostNamed(instanceGroup)
    const impactRing = meleeLungeImpactRingNamed(instanceGroup)
    expect(instanceGroup.children).toHaveLength(3)
    expectVectorClose(instanceGroup.position, [0, 0, 0])
    expect(ghost.material.color.getHexString()).toBe('123456')
    expect(streak.material.color.getHexString()).toBe('aa3300')
    expect(impactRing.material.color.getHexString()).toBe('ffeeaa')
    expect(ghost.material.transparent).toBe(true)
    expect(ghost.material.depthWrite).toBe(false)
    expect(ghost.renderOrder).toBe(36)
    expect(streak.renderOrder).toBe(35)
    expect(impactRing.renderOrder).toBe(37)
    expect(ghost.visible).toBe(false)
    expect(streak.visible).toBe(false)
    expect(impactRing.visible).toBe(false)

    renderer.animate({ frameNowMs: 600, delta: 0.016, renderObjects })

    expectVectorClose(ghost.position, [0.85, 1.16, 0])
    expectVectorClose(streak.position, [0.425, 1.16, 0])
    expectVectorClose(impactRing.position, [4, 0, 0])
    expect(ghost.visible).toBe(true)
    expect(streak.visible).toBe(true)
    expect(impactRing.visible).toBe(true)
    expect(streak.scale.y).toBeCloseTo(0.85)
    expect(impactRing.material.opacity).toBeGreaterThan(0)
    expect(user.currentCenter.equals(userPlacement)).toBe(true)
    expect(target.currentCenter.equals(targetPlacement)).toBe(true)

    const meleeMeshes = [streak, ghost, impactRing] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[]
    const geometryDisposeSpies = meleeMeshes.map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = meleeMeshes.map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    target.currentCenter.set(12, 0, 0)
    renderer.animate({ frameNowMs: 601, delta: 0.016, renderObjects })

    expect(ghost.position.x).toBeLessThan(0.86)
    expect(user.currentCenter.equals(userPlacement)).toBe(true)

    renderer.animate({ frameNowMs: 1100, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce()
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce()
  })

  it('uses grid-cell fallbacks for melee lunge targets when the token render object is missing', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const renderObjects = new Map([[user.id, user]])

    renderer.sync([
      meleeLungeEvent({
        targetId: 'missing-target',
        targetCell: { x: 5, y: 0, z: 2 },
      }),
    ], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const ghost = meleeLungeGhostNamed(instanceGroup)
    const impactRing = meleeLungeImpactRingNamed(instanceGroup)

    renderer.animate({ frameNowMs: 600, delta: 0.016, renderObjects })

    expect(ghost.position.x).toBeGreaterThan(0.7)
    expect(ghost.position.z).toBeGreaterThan(0.3)
    expectVectorClose(impactRing.position, [5.5, 0, 2.5])
  })

  it('falls back to a no-op melee lunge when anchors cannot be resolved', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1' })
    const renderObjects = new Map([[user.id, user]])

    renderer.sync([meleeLungeEvent({ targetId: 'missing-target' })], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    expect(instanceGroup.children).toHaveLength(0)
    expect(renderer.activeCount()).toBe(1)

    renderer.animate({ frameNowMs: 1100, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
  })

  it('disposes melee lunge resources when the event is removed mid-lunge', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 0, 0) })
    const renderObjects = new Map([
      [user.id, user],
      [target.id, target],
    ])
    const userPlacement = user.currentCenter.clone()

    renderer.sync([meleeLungeEvent()], { renderObjects })
    renderer.animate({ frameNowMs: 600, delta: 0.016, renderObjects })

    const instanceGroup = renderer.group.children[0]
    const meshes = instanceGroup.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[]
    expect(meshes).toHaveLength(3)
    const geometryDisposeSpies = meshes.map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = meshes.map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    renderer.sync([])

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(instanceGroup.children).toHaveLength(0)
    expect(user.currentCenter.equals(userPlacement)).toBe(true)
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce()
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce()
  })

  it('renders target flash events as per-target palette-coloured shells and footprint rings', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 0, 0) })
    const renderObjects = new Map([[target.id, target]])

    renderer.sync([targetFlashEvent({ tone: 'hit' })], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const ring = targetFlashRingNamed(instanceGroup)
    const shell = targetFlashShellNamed(instanceGroup)
    expect(instanceGroup.children).toHaveLength(2)
    expectVectorClose(instanceGroup.position, [4, 0, 0])
    expectVectorClose(shell.position, [0, 1, 0])
    expectVectorClose(ring.position, [0, 0.035, 0])
    expect(shell.material.color.getHexString()).toBe('123456')
    expect(ring.material.color.getHexString()).toBe('ffeeaa')
    expect(shell.material.transparent).toBe(true)
    expect(shell.material.depthWrite).toBe(false)
    expect(shell.renderOrder).toBe(38)
    expect(ring.renderOrder).toBe(37)
    expect(shell.visible).toBe(true)
    expect(ring.visible).toBe(true)
    expect(shell.scale.x).toBeGreaterThan(1)
    expect(ring.scale.x).toBeGreaterThan(0.8)

    const initialShellScale = shell.scale.x
    const initialRingOpacity = ring.material.opacity
    const geometryDisposeSpies = [ring, shell].map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = [ring, shell].map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    renderer.animate({ frameNowMs: 220, delta: 0.016, renderObjects })

    expect(shell.scale.x).toBeGreaterThan(initialShellScale)
    expect(ring.material.opacity).toBeGreaterThan(initialRingOpacity)

    target.currentCenter.set(12, 0, 0)
    renderer.animate({ frameNowMs: 300, delta: 0.016, renderObjects })

    expectVectorClose(instanceGroup.position, [4, 0, 0])

    renderer.animate({ frameNowMs: 340, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce()
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce()
  })

  it('uses semantic target flash tones and independent materials for simultaneous flashes', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const firstTarget = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(2, 0, 0) })
    const secondTarget = makeRenderObject({ id: 'target-2', currentCenter: new THREE.Vector3(6, 0, 1) })
    const renderObjects = new Map([
      [firstTarget.id, firstTarget],
      [secondTarget.id, secondTarget],
    ])

    renderer.sync([
      targetFlashEvent({ id: 'move-vfx-target-flash-heal', palette: undefined, tone: 'heal', targetId: 'target-1' }),
      targetFlashEvent({ id: 'move-vfx-target-flash-unknown', palette: undefined, tone: 'mystery', targetId: 'target-2' }),
    ], { renderObjects })

    const healGroup = renderer.group.children[0]
    const unknownGroup = renderer.group.children[1]
    const healShell = targetFlashShellNamed(healGroup)
    const healRing = targetFlashRingNamed(healGroup)
    const unknownShell = targetFlashShellNamed(unknownGroup)
    const unknownRing = targetFlashRingNamed(unknownGroup)

    expect(renderer.activeCount()).toBe(2)
    expectVectorClose(healGroup.position, [2, 0, 0])
    expectVectorClose(unknownGroup.position, [6, 0, 1])
    expect(healShell.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.healing.primary.slice(1))
    expect(healRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.healing.accent.slice(1))
    expect(unknownShell.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.neutral.primary.slice(1))
    expect(unknownRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.neutral.accent.slice(1))
    expect(healShell.material).not.toBe(unknownShell.material)
    expect(healRing.material).not.toBe(unknownRing.material)
  })

  it('uses grid-cell fallback anchors for target flashes when the target token is missing', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([
      targetFlashEvent({
        targetId: 'missing-target',
        targetCell: { x: 5, y: 0, z: 2 },
        palette: undefined,
        tone: 'status',
      }),
    ], { renderObjects: new Map() })

    const instanceGroup = renderer.group.children[0]
    const shell = targetFlashShellNamed(instanceGroup)
    const ring = targetFlashRingNamed(instanceGroup)

    expect(instanceGroup.children).toHaveLength(2)
    expectVectorClose(instanceGroup.position, [5.5, 0, 2.5])
    expectVectorClose(shell.position, [0, 0.72, 0])
    expect(ring.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.status.accent.slice(1))
  })

  it('falls back to a no-op target flash when no target anchor can be resolved', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([targetFlashEvent({ targetId: 'missing-target' })], { renderObjects: new Map() })

    const instanceGroup = renderer.group.children[0]
    expect(instanceGroup.children).toHaveLength(0)
    expect(renderer.activeCount()).toBe(1)

    renderer.animate({ frameNowMs: 340, delta: 0.016, renderObjects: new Map() })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
  })

  it('renders impact ring events as palette-coloured ground pulses with terrain-safe depth settings', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 1, 0) })
    const renderObjects = new Map([[target.id, target]])

    renderer.sync([impactRingEvent({ tone: 'hit' })], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const ring = impactRingNamed(instanceGroup)
    expect(instanceGroup.children).toHaveLength(1)
    expectVectorClose(instanceGroup.position, [4, 1, 0])
    expectVectorClose(ring.position, [0, 0.045, 0])
    expect(ring.material.color.getHexString()).toBe('ffeeaa')
    expect(ring.material.transparent).toBe(true)
    expect(ring.material.depthTest).toBe(true)
    expect(ring.material.depthWrite).toBe(false)
    expect(ring.renderOrder).toBe(37)
    expect(ring.rotation.x).toBeCloseTo(-Math.PI / 2)
    expect(ring.visible).toBe(false)

    renderer.animate({ frameNowMs: 230, delta: 0.016, renderObjects })

    expect(ring.visible).toBe(true)
    expect(ring.material.opacity).toBeGreaterThan(0)
    expect(ring.scale.x).toBeGreaterThan(1.2)

    const geometryDispose = vi.spyOn(ring.geometry, 'dispose')
    const materialDispose = vi.spyOn(ring.material, 'dispose')

    target.currentCenter.set(12, 3, 0)
    renderer.animate({ frameNowMs: 240, delta: 0.016, renderObjects })

    expectVectorClose(instanceGroup.position, [4, 1, 0])

    renderer.animate({ frameNowMs: 360, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
  })

  it('uses semantic impact ring tones with unknown tones falling back to neutral', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const firstTarget = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(2, 0, 0) })
    const secondTarget = makeRenderObject({ id: 'target-2', currentCenter: new THREE.Vector3(6, 0, 1) })
    const renderObjects = new Map([
      [firstTarget.id, firstTarget],
      [secondTarget.id, secondTarget],
    ])

    renderer.sync([
      impactRingEvent({ id: 'move-vfx-impact-ring-crit', palette: undefined, tone: 'crit', targetId: 'target-1' }),
      impactRingEvent({ id: 'move-vfx-impact-ring-unknown', palette: undefined, tone: 'mystery', targetId: 'target-2' }),
    ], { renderObjects })

    const critGroup = renderer.group.children[0]
    const unknownGroup = renderer.group.children[1]
    const critRing = impactRingNamed(critGroup)
    const unknownRing = impactRingNamed(unknownGroup)

    expect(renderer.activeCount()).toBe(2)
    expectVectorClose(critGroup.position, [2, 0, 0])
    expectVectorClose(unknownGroup.position, [6, 0, 1])
    expect(critRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.crit.accent.slice(1))
    expect(unknownRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.neutral.accent.slice(1))
    expect(critRing.material).not.toBe(unknownRing.material)
  })

  it('uses grid-cell fallback anchors for impact rings when the target token is missing', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([
      impactRingEvent({
        targetId: 'missing-target',
        targetCell: { x: 5, y: 2, z: 2 },
        palette: undefined,
        tone: 'heal',
      }),
    ], { renderObjects: new Map() })

    const instanceGroup = renderer.group.children[0]
    const ring = impactRingNamed(instanceGroup)

    expect(instanceGroup.children).toHaveLength(1)
    expectVectorClose(instanceGroup.position, [5.5, 2, 2.5])
    expect(ring.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.healing.accent.slice(1))
  })

  it('falls back to a no-op impact ring when no target anchor can be resolved', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([impactRingEvent({ targetId: 'missing-target' })], { renderObjects: new Map() })

    const instanceGroup = renderer.group.children[0]
    expect(instanceGroup.children).toHaveLength(0)
    expect(renderer.activeCount()).toBe(1)

    renderer.animate({ frameNowMs: 360, delta: 0.016, renderObjects: new Map() })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
  })

  it('renders miss puff events as neutral off-target puffs without hit colours', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 0, 0) })
    const renderObjects = new Map([
      [user.id, user],
      [target.id, target],
    ])

    renderer.sync([missEvent()], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const ring = missPuffRingNamed(instanceGroup)
    const clouds = missPuffCloudMeshes(instanceGroup)
    expect(instanceGroup.children).toHaveLength(4)
    expect(instanceGroup.position.x).toBeGreaterThan(4)
    expect(instanceGroup.position.x).toBeLessThan(4.7)
    expect(instanceGroup.position.y).toBeCloseTo(0)
    expect(instanceGroup.position.z).toBeCloseTo(0)
    expectVectorClose(ring.position, [0, 0.055, 0])
    expect(ring.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.miss.accent.slice(1))
    expect(clouds[0]?.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.miss.primary.slice(1))
    expect(clouds[1]?.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.miss.glow.slice(1))
    expect(ring.material.color.getHexString()).not.toBe(projectilePalette.accent.slice(1))
    expect(ring.material.transparent).toBe(true)
    expect(ring.material.depthTest).toBe(true)
    expect(ring.material.depthWrite).toBe(false)
    expect(ring.renderOrder).toBe(36)
    expect(clouds.every((cloud) => cloud.renderOrder === 37)).toBe(true)
    expect(ring.visible).toBe(false)
    expect(clouds.every((cloud) => !cloud.visible)).toBe(true)

    renderer.animate({ frameNowMs: 190, delta: 0.016, renderObjects })

    expect(ring.visible).toBe(true)
    expect(ring.material.opacity).toBeGreaterThan(0)
    expect(ring.material.opacity).toBeLessThan(0.31)
    expect(ring.scale.x).toBeGreaterThan(0.45)
    expect(clouds.every((cloud) => cloud.visible)).toBe(true)
    expect(clouds[0]?.position.y).toBeGreaterThan(0)
    expect(clouds[0]?.material.opacity).toBeLessThan(0.23)

    const lockedMissPoint = instanceGroup.position.clone()
    const geometryDisposeSpies = [ring, ...clouds].map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = [ring, ...clouds].map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    target.currentCenter.set(12, 0, 0)
    renderer.animate({ frameNowMs: 240, delta: 0.016, renderObjects })

    expect(instanceGroup.position.equals(lockedMissPoint)).toBe(true)

    renderer.animate({ frameNowMs: 360, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce()
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce()
  })

  it('uses grid-cell fallback anchors for miss puffs when the target token is missing', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([
      missEvent({
        targetId: 'missing-target',
        targetCell: { x: 5, y: 2, z: 2 },
      }),
    ], { renderObjects: new Map() })

    const instanceGroup = renderer.group.children[0]
    const ring = missPuffRingNamed(instanceGroup)
    const clouds = missPuffCloudMeshes(instanceGroup)

    expect(instanceGroup.children).toHaveLength(4)
    expect(instanceGroup.position.x).toBeCloseTo(5.5)
    expect(instanceGroup.position.y).toBeCloseTo(2)
    expect(instanceGroup.position.z).toBeGreaterThan(2.5)
    expect(ring.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.miss.accent.slice(1))
    expect(clouds[0]?.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.miss.primary.slice(1))
  })

  it('falls back to a no-op miss puff when no target anchor can be resolved', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([missEvent({ targetId: 'missing-target' })], { renderObjects: new Map() })

    const instanceGroup = renderer.group.children[0]
    expect(instanceGroup.children).toHaveLength(0)
    expect(renderer.activeCount()).toBe(1)

    renderer.animate({ frameNowMs: 360, delta: 0.016, renderObjects: new Map() })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
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
