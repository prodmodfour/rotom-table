import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { MOVE_VFX_KIND, type MoveAnimationEvent, type MoveAreaPulseAnimationEvent, type MoveArcAnimationEvent, type MoveBadgeAnimationEvent, type MoveBeamAnimationEvent, type MoveBuffDebuffAnimationEvent, type MoveConeSweepAnimationEvent, type MoveCritAnimationEvent, type MoveDashAnimationEvent, type MoveHealingAnimationEvent, type MoveImpactRingAnimationEvent, type MoveLineSweepAnimationEvent, type MoveMeleeLungeAnimationEvent, type MoveMissAnimationEvent, type MoveProjectileAnimationEvent, type MoveRadialBurstAnimationEvent, type MoveSelfPulseAnimationEvent, type MoveStatusAnimationEvent, type MoveTargetFlashAnimationEvent, type MoveVfxKind } from '~/types/moveAnimation'
import { MOVE_VFX_TONE_COLORS, MOVE_VFX_TYPE_COLORS, type MoveVfxPaletteEntry } from '~/utils/moveAnimationPalette'
import { createMoveVfxRenderer } from '~/utils/isometric/moveVfxRenderer'
import type { PokemonRenderObject } from '~/utils/isometric/types'

class FakeBadgeElement {
  readonly tagName: string
  readonly style: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  readonly dataset: Record<string, string> = {}
  readonly children: FakeBadgeElement[] = []
  className = ''
  textContent = ''
  parentNode: FakeBadgeElement | null = null
  ownerDocument: FakeBadgeDocument
  removed = false

  constructor(tagName: string, ownerDocument: FakeBadgeDocument) {
    this.tagName = tagName.toUpperCase()
    this.ownerDocument = ownerDocument
  }

  setAttribute(name: string, value: string | boolean) {
    this.attributes.set(name, String(value))
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  appendChild(child: FakeBadgeElement): FakeBadgeElement {
    child.parentNode = this
    this.children.push(child)
    return child
  }

  remove() {
    this.removed = true
    if (!this.parentNode) return

    const index = this.parentNode.children.indexOf(this)
    if (index >= 0) this.parentNode.children.splice(index, 1)
    this.parentNode = null
  }

  cloneNode(): FakeBadgeElement {
    const clone = new FakeBadgeElement(this.tagName, this.ownerDocument)
    clone.className = this.className
    clone.textContent = this.textContent
    Object.assign(clone.style, this.style)
    Object.assign(clone.dataset, this.dataset)
    for (const [key, value] of this.attributes) clone.attributes.set(key, value)
    return clone
  }
}

interface FakeBadgeDocument {
  defaultView: { Element: typeof FakeBadgeElement }
  createElement: (tagName: string) => FakeBadgeElement
}

const installFakeBadgeDocument = () => {
  const fakeDocument: FakeBadgeDocument = {
    defaultView: { Element: FakeBadgeElement },
    createElement: (tagName: string) => new FakeBadgeElement(tagName, fakeDocument),
  }
  vi.stubGlobal('document', fakeDocument)
  vi.stubGlobal('HTMLElement', FakeBadgeElement)
  return () => vi.unstubAllGlobals()
}

const selfPulseEvent = (
  idOrOverrides: string | (Partial<Omit<MoveSelfPulseAnimationEvent, 'palette' | 'tone'>> & {
    palette?: MoveVfxPaletteEntry | undefined
    tone?: unknown
  }) = 'move-vfx-test',
): MoveAnimationEvent => {
  const overrides = typeof idOrOverrides === 'string' ? { id: idOrOverrides } : idOrOverrides

  return {
    id: 'move-vfx-test',
    moveName: 'Test Move',
    userId: 'user-1',
    createdAtMs: 100,
    durationMs: 560,
    kind: MOVE_VFX_KIND.selfPulse,
    ...overrides,
  } as MoveAnimationEvent
}

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

const dashEvent = (overrides: Partial<MoveDashAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'move-vfx-dash',
  moveName: 'Pass',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 1000,
  kind: MOVE_VFX_KIND.dash,
  destinationCell: { x: 4, y: 0, z: 0 },
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

const areaPulseEvent = (overrides: Partial<MoveAreaPulseAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'move-vfx-area-pulse',
  moveName: 'Surf',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 560,
  kind: MOVE_VFX_KIND.areaPulse,
  areaCells: [
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 1 },
  ],
  palette: projectilePalette,
  ...overrides,
}) as MoveAnimationEvent

const radialBurstEvent = (overrides: Partial<MoveRadialBurstAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'move-vfx-radial-burst',
  moveName: 'Surf',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 560,
  kind: MOVE_VFX_KIND.radialBurst,
  areaCells: [
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 1 },
  ],
  palette: projectilePalette,
  ...overrides,
}) as MoveAnimationEvent

const lineSweepEvent = (overrides: Partial<MoveLineSweepAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'move-vfx-line-sweep',
  moveName: 'Ice Beam Line',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 960,
  kind: MOVE_VFX_KIND.lineSweep,
  areaCells: [
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ],
  palette: projectilePalette,
  ...overrides,
}) as MoveAnimationEvent

const coneSweepEvent = (overrides: Partial<MoveConeSweepAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'move-vfx-cone-sweep',
  moveName: 'Flame Cone',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 960,
  kind: MOVE_VFX_KIND.coneSweep,
  areaCells: [
    { x: 0, y: 0, z: -1 },
    { x: 1, y: 0, z: -2 },
  ],
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

const critEvent = (overrides: Partial<MoveCritAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'move-vfx-crit',
  moveName: 'Psybeam',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 260,
  kind: MOVE_VFX_KIND.crit,
  targetId: 'target-1',
  palette: projectilePalette,
  ...overrides,
}) as MoveAnimationEvent

const healingEvent = (overrides: Partial<MoveHealingAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'move-vfx-healing',
  moveName: 'Recover',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 560,
  kind: MOVE_VFX_KIND.healing,
  targetId: 'target-1',
  ...overrides,
}) as MoveAnimationEvent

const buffDebuffEvent = (overrides: Partial<MoveBuffDebuffAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'move-vfx-buff-debuff',
  moveName: 'Swords Dance',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 560,
  kind: MOVE_VFX_KIND.buffDebuff,
  targetId: 'target-1',
  tone: 'buff',
  direction: 'buff',
  ...overrides,
}) as MoveAnimationEvent

const statusEvent = (overrides: Partial<MoveStatusAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'move-vfx-status',
  moveName: 'Thunder Wave',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 560,
  kind: MOVE_VFX_KIND.status,
  targetId: 'target-1',
  ...overrides,
}) as MoveAnimationEvent

const badgeEvent = (overrides: Partial<MoveBadgeAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'move-vfx-badge',
  moveName: 'Thunder Wave',
  userId: 'user-1',
  createdAtMs: 100,
  durationMs: 560,
  kind: MOVE_VFX_KIND.badge,
  targetId: 'target-1',
  label: 'Status',
  tone: 'status',
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

const dashStreakNamed = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === 'move-vfx-dash-streak')
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
}

const dashAfterimageMeshes = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] => {
  const meshes = group.children.filter((child) => child.name.startsWith('move-vfx-dash-afterimage-'))
  expect(meshes).toHaveLength(4)
  return meshes as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[]
}

const dashDestinationRingNamed = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === 'move-vfx-dash-destination-ring')
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

const areaPulseCellsMeshNamed = (
  group: THREE.Object3D,
): THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === 'move-vfx-area-pulse-cells')
  expect(mesh).toBeInstanceOf(THREE.InstancedMesh)
  return mesh as THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
}

const areaSweepCellsMeshNamed = (
  group: THREE.Object3D,
): THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === 'move-vfx-area-sweep-cells')
  expect(mesh).toBeInstanceOf(THREE.InstancedMesh)
  return mesh as THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
}

const radialBurstRingNamed = (
  group: THREE.Object3D,
  name: string,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === name)
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
}

const radialBurstRayMeshes = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>[] => {
  const meshes = group.children.filter((child) => child.name.startsWith('move-vfx-radial-burst-ray-'))
  expect(meshes).toHaveLength(8)
  return meshes as THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>[]
}

const instanceMatrixPosition = (
  mesh: THREE.InstancedMesh,
  index: number,
): THREE.Vector3 => {
  const matrix = new THREE.Matrix4()
  mesh.getMatrixAt(index, matrix)
  return new THREE.Vector3().setFromMatrixPosition(matrix)
}

const instanceMatrixScale = (
  mesh: THREE.InstancedMesh,
  index: number,
): THREE.Vector3 => {
  const matrix = new THREE.Matrix4()
  mesh.getMatrixAt(index, matrix)
  return new THREE.Vector3().setFromMatrixScale(matrix)
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

const critBurstRingNamed = (
  group: THREE.Object3D,
  name: string,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === name)
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
}

const critBurstSpokeMeshes = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>[] => {
  const meshes = group.children.filter((child) => child.name.startsWith('move-vfx-crit-burst-spoke-'))
  expect(meshes).toHaveLength(8)
  return meshes as THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>[]
}

const selfPulseRingNamed = (
  group: THREE.Object3D,
  name: string,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === name)
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
}

const selfPulseShellNamed = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === 'move-vfx-self-pulse-shell')
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
}

const healingRingNamed = (
  group: THREE.Object3D,
  name: string,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === name)
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
}

const healingMoteMeshes = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] => {
  const meshes = group.children.filter((child) => child.name.startsWith('move-vfx-healing-mote-'))
  expect(meshes).toHaveLength(6)
  return meshes as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[]
}

const buffDebuffRingNamed = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === 'move-vfx-buff-debuff-ring')
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
}

const buffDebuffParticleMeshes = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>[] => {
  const meshes = group.children.filter((child) => child.name.startsWith('move-vfx-buff-debuff-particle-'))
  expect(meshes).toHaveLength(5)
  return meshes as THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>[]
}

const statusCloudRingNamed = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === 'move-vfx-status-cloud-ring')
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
}

const statusCloudShellNamed = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> => {
  const mesh = group.children.find((child) => child.name === 'move-vfx-status-cloud-shell')
  expect(mesh).toBeInstanceOf(THREE.Mesh)
  return mesh as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
}

const statusCloudMoteMeshes = (
  group: THREE.Object3D,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] => {
  const meshes = group.children.filter((child) => child.name.startsWith('move-vfx-status-cloud-mote-'))
  expect(meshes).toHaveLength(5)
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
      css3DActive: false,
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

  it('marks all VFX objects pointer-transparent for map raycasts', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const renderObjects = new Map([
      ['user-1', makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })],
      ['target-1', makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(2, 0, 0) })],
    ])

    renderer.sync([projectileEvent()], { renderObjects })

    const traversed: THREE.Object3D[] = []
    renderer.group.traverse((object) => traversed.push(object))
    expect(traversed.length).toBeGreaterThan(1)
    expect(traversed.every((object) => object.userData.moveVfxPointerTransparent === true)).toBe(true)

    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(1, 0.6, 4),
      new THREE.Vector3(0, 0, -1).normalize(),
    )
    expect(raycaster.intersectObject(renderer.group, true)).toEqual([])
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

  it('disposes active instances when their tracked render objects disappear during sync', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(3, 0, 0) })
    const renderObjects = new Map([
      [user.id, user],
      [target.id, target],
    ])
    const event = projectileEvent()

    renderer.sync([event], { renderObjects })
    const instanceGroup = renderer.group.children[0]
    const core = projectileMeshNamed(instanceGroup, 'move-vfx-projectile-core')
    const geometryDispose = vi.spyOn(core.geometry, 'dispose')
    const materialDispose = vi.spyOn(core.material, 'dispose')

    renderer.sync([event], { renderObjects: new Map([[user.id, user]]) })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()

    renderer.sync([event], { renderObjects: new Map([[user.id, user]]) })
    expect(renderer.activeCount()).toBe(0)

    renderer.sync([], { renderObjects })
    renderer.sync([event], { renderObjects })
    expect(renderer.activeCount()).toBe(1)
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
      css3DActive: false,
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

  it('keeps delayed event groups hidden until their effective start time', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const event = selfPulseEvent({
      id: 'move-vfx-delayed',
      durationMs: 100,
      startOffsetMs: 120,
    })

    renderer.sync([event])

    const instanceGroup = renderer.group.children[0]
    expect(instanceGroup?.name).toBe('move-vfx-instance:move-vfx-delayed')
    expect(instanceGroup?.visible).toBe(false)
    expect(renderer.activeCount()).toBe(1)
    expect(renderer.needsAnimationFrame()).toBe(true)

    renderer.animate({ frameNowMs: 219, delta: 0.016 })

    expect(renderer.activeCount()).toBe(1)
    expect(instanceGroup?.visible).toBe(false)

    renderer.animate({ frameNowMs: 220, delta: 0.016 })

    expect(renderer.activeCount()).toBe(1)
    expect(instanceGroup?.visible).toBe(true)

    renderer.animate({ frameNowMs: 320, delta: 0.016 })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
  })

  it('disposes delayed events cleanly when they are cleared before starting', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const event = selfPulseEvent({
      id: 'move-vfx-delayed-clear',
      durationMs: 100,
      startOffsetMs: 500,
    })

    renderer.sync([event])
    expect(renderer.group.children[0]?.visible).toBe(false)

    renderer.sync([])

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
  })

  it('creates safe lifecycle instances through the factory for every registered effect kind', () => {
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

  it('renders self pulse events as token-scaled aura rings and shell around the locked user anchor', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({
      id: 'user-1',
      currentCenter: new THREE.Vector3(2, 1, 3),
      base: 2,
      width: 1.5,
      height: 3,
      clearance: 2.4,
    })
    const renderObjects = new Map([[user.id, user]])

    renderer.sync([selfPulseEvent({ palette: projectilePalette })], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const baseRing = selfPulseRingNamed(instanceGroup, 'move-vfx-self-pulse-base-ring')
    const risingRing = selfPulseRingNamed(instanceGroup, 'move-vfx-self-pulse-rising-ring')
    const shell = selfPulseShellNamed(instanceGroup)
    const initialBaseScale = baseRing.scale.x
    const initialRisingY = risingRing.position.y

    expect(instanceGroup.children).toHaveLength(3)
    expectVectorClose(instanceGroup.position, [2, 1, 3])
    expectVectorClose(baseRing.position, [0, 0.09, 0])
    expect(shell.position.y).toBeCloseTo(1.02)
    expect(baseRing.material.color.getHexString()).toBe('ffeeaa')
    expect(risingRing.material.color.getHexString()).toBe('aa3300')
    expect(shell.material.color.getHexString()).toBe('123456')
    expect(baseRing.material.transparent).toBe(true)
    expect(baseRing.material.depthTest).toBe(true)
    expect(baseRing.material.depthWrite).toBe(false)
    expect(shell.material.depthWrite).toBe(false)
    expect(baseRing.renderOrder).toBe(32)
    expect(risingRing.renderOrder).toBe(33)
    expect(shell.renderOrder).toBe(35)
    expect(baseRing.rotation.x).toBeCloseTo(-Math.PI / 2)
    expect(risingRing.rotation.x).toBeCloseTo(-Math.PI / 2)
    expect(baseRing.visible).toBe(true)
    expect(risingRing.visible).toBe(true)
    expect(shell.visible).toBe(true)

    renderer.animate({ frameNowMs: 380, delta: 0.016, renderObjects })

    expect(baseRing.scale.x).toBeGreaterThan(initialBaseScale)
    expect(risingRing.position.y).toBeGreaterThan(initialRisingY)
    expect(risingRing.position.y).toBeLessThan(1.9)
    expect(shell.scale.y).toBeGreaterThan(1.8)
    expect(shell.material.opacity).toBeGreaterThan(0)

    const lockedSelfPulsePoint = instanceGroup.position.clone()
    const selfPulseMeshes = [baseRing, risingRing, shell]
    const geometryDisposeSpies = selfPulseMeshes.map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = selfPulseMeshes.map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    user.currentCenter.set(8, 4, 3)
    renderer.animate({ frameNowMs: 520, delta: 0.016, renderObjects })

    expect(instanceGroup.position.equals(lockedSelfPulsePoint)).toBe(true)

    renderer.animate({ frameNowMs: 660, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce()
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce()
  })

  it('uses semantic self pulse tones with grid-cell fallback anchors', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([
      selfPulseEvent({
        id: 'move-vfx-self-pulse-heal',
        userId: 'missing-user',
        originCell: { x: 4, y: 2, z: 1 },
        palette: undefined,
        tone: 'heal',
      }),
      selfPulseEvent({
        id: 'move-vfx-self-pulse-unknown',
        userId: 'missing-user-2',
        originCell: { x: 6, y: 0, z: 2 },
        palette: undefined,
        tone: 'mystery',
      }),
    ], { renderObjects: new Map() })

    const healingGroup = renderer.group.children[0]
    const unknownGroup = renderer.group.children[1]
    const healingRing = selfPulseRingNamed(healingGroup, 'move-vfx-self-pulse-base-ring')
    const unknownRing = selfPulseRingNamed(unknownGroup, 'move-vfx-self-pulse-base-ring')
    const healingShell = selfPulseShellNamed(healingGroup)

    expect(renderer.activeCount()).toBe(2)
    expectVectorClose(healingGroup.position, [4.5, 2, 1.5])
    expectVectorClose(unknownGroup.position, [6.5, 0, 2.5])
    expect(healingRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.healing.accent.slice(1))
    expect(healingShell.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.healing.primary.slice(1))
    expect(unknownRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.neutral.accent.slice(1))
    expect(healingRing.material).not.toBe(unknownRing.material)
  })

  it('uses a simple fade pulse for reduced-motion self aura events', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(2, 0, 1) })
    const renderObjects = new Map([[user.id, user]])

    renderer.sync([selfPulseEvent({ id: 'move-vfx-self-pulse-reduced', palette: projectilePalette })], { renderObjects, reducedMotion: true })

    const instanceGroup = renderer.group.children[0]
    const baseRing = selfPulseRingNamed(instanceGroup, 'move-vfx-self-pulse-base-ring')
    const risingRing = selfPulseRingNamed(instanceGroup, 'move-vfx-self-pulse-rising-ring')
    const shell = selfPulseShellNamed(instanceGroup)
    const initialBaseScale = baseRing.scale.x

    expect(baseRing.visible).toBe(true)
    expect(risingRing.visible).toBe(false)
    expect(risingRing.material.opacity).toBe(0)
    expect(shell.visible).toBe(false)
    expect(shell.material.opacity).toBe(0)

    renderer.animate({ frameNowMs: 380, delta: 0.016, renderObjects, reducedMotion: true })

    expect(baseRing.visible).toBe(true)
    expect(baseRing.scale.x).toBeGreaterThan(initialBaseScale)
    expect(baseRing.scale.x).toBeLessThan(initialBaseScale * 1.3)
    expect(risingRing.visible).toBe(false)
    expect(shell.visible).toBe(false)
  })

  it('falls back to a no-op self pulse when no user anchor can be resolved', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([selfPulseEvent({ userId: 'missing-user' })], { renderObjects: new Map() })

    const instanceGroup = renderer.group.children[0]
    expect(instanceGroup.children).toHaveLength(0)
    expect(renderer.activeCount()).toBe(1)

    renderer.animate({ frameNowMs: 660, delta: 0.016, renderObjects: new Map() })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
  })

  it('renders healing events as semantic rising rings and motes around a locked target anchor', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const target = makeRenderObject({
      id: 'target-1',
      currentCenter: new THREE.Vector3(4, 1, 0),
      base: 2,
      width: 1.5,
      height: 3,
      clearance: 2.4,
    })
    const renderObjects = new Map([[target.id, target]])

    renderer.sync([healingEvent({ palette: undefined })], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const baseRing = healingRingNamed(instanceGroup, 'move-vfx-healing-base-ring')
    const risingRing = healingRingNamed(instanceGroup, 'move-vfx-healing-rising-ring')
    const motes = healingMoteMeshes(instanceGroup)
    const initialRisingY = risingRing.position.y
    const initialBaseScale = baseRing.scale.x

    expect(instanceGroup.children).toHaveLength(8)
    expectVectorClose(instanceGroup.position, [4, 1, 0])
    expectVectorClose(baseRing.position, [0, 0.09, 0])
    expect(baseRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.healing.accent.slice(1))
    expect(risingRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.healing.glow.slice(1))
    expect(motes[0]?.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.healing.accent.slice(1))
    expect(motes[1]?.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.healing.primary.slice(1))
    expect(baseRing.material.transparent).toBe(true)
    expect(baseRing.material.depthTest).toBe(true)
    expect(baseRing.material.depthWrite).toBe(false)
    expect(baseRing.renderOrder).toBe(32)
    expect(risingRing.renderOrder).toBe(33)
    expect(motes.every((mote) => mote.renderOrder === 36)).toBe(true)
    expect(baseRing.rotation.x).toBeCloseTo(-Math.PI / 2)
    expect(baseRing.visible).toBe(true)
    expect(risingRing.visible).toBe(true)
    expect(motes.every((mote) => mote.visible)).toBe(true)

    renderer.animate({ frameNowMs: 380, delta: 0.016, renderObjects })

    expect(baseRing.scale.x).toBeGreaterThan(initialBaseScale)
    expect(risingRing.position.y).toBeGreaterThan(initialRisingY)
    expect(motes[0]?.position.y).toBeGreaterThan(0)
    expect(motes[0]?.material.opacity).toBeGreaterThan(0)

    const lockedHealingPoint = instanceGroup.position.clone()
    const healingMeshes = [baseRing, risingRing, ...motes]
    const geometryDisposeSpies = healingMeshes.map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = healingMeshes.map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    target.currentCenter.set(12, 3, 0)
    renderer.animate({ frameNowMs: 520, delta: 0.016, renderObjects })

    expect(instanceGroup.position.equals(lockedHealingPoint)).toBe(true)

    renderer.animate({ frameNowMs: 660, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce()
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce()
  })

  it('uses user anchors for self healing and target-cell fallbacks with palette overrides', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(2, 0, 1), base: 1 })
    const renderObjects = new Map([[user.id, user]])

    renderer.sync([
      healingEvent({ id: 'move-vfx-healing-self', targetId: undefined, targetCell: undefined, palette: undefined }),
      healingEvent({
        id: 'move-vfx-healing-cell',
        targetId: 'missing-target',
        targetCell: { x: 5, y: 2, z: 2 },
        palette: projectilePalette,
      }),
    ], { renderObjects })

    const selfGroup = renderer.group.children[0]
    const cellGroup = renderer.group.children[1]
    const selfRing = healingRingNamed(selfGroup, 'move-vfx-healing-base-ring')
    const cellRing = healingRingNamed(cellGroup, 'move-vfx-healing-base-ring')

    expect(renderer.activeCount()).toBe(2)
    expectVectorClose(selfGroup.position, [2, 0, 1])
    expectVectorClose(cellGroup.position, [5.5, 2, 2.5])
    expect(selfRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.healing.accent.slice(1))
    expect(cellRing.material.color.getHexString()).toBe(projectilePalette.accent.slice(1))
    expect(selfRing.material).not.toBe(cellRing.material)
  })

  it('uses a simple fade pulse for reduced-motion healing events', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 0, 0) })
    const renderObjects = new Map([[target.id, target]])

    renderer.sync([healingEvent({ palette: undefined })], { renderObjects, reducedMotion: true })

    const instanceGroup = renderer.group.children[0]
    const baseRing = healingRingNamed(instanceGroup, 'move-vfx-healing-base-ring')
    const risingRing = healingRingNamed(instanceGroup, 'move-vfx-healing-rising-ring')
    const motes = healingMoteMeshes(instanceGroup)
    const initialBaseScale = baseRing.scale.x

    expect(baseRing.visible).toBe(true)
    expect(risingRing.visible).toBe(false)
    expect(motes.every((mote) => !mote.visible)).toBe(true)

    renderer.animate({ frameNowMs: 380, delta: 0.016, renderObjects, reducedMotion: true })

    expect(baseRing.visible).toBe(true)
    expect(baseRing.material.opacity).toBeGreaterThan(0)
    expect(baseRing.scale.x).toBeGreaterThan(initialBaseScale)
    expect(risingRing.visible).toBe(false)
    expect(risingRing.material.opacity).toBe(0)
    expect(motes.every((mote) => !mote.visible && mote.material.opacity === 0)).toBe(true)
  })

  it('falls back to a no-op healing pulse when no target or user anchor can be resolved', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([healingEvent({ userId: 'missing-user', targetId: undefined })], { renderObjects: new Map() })

    const instanceGroup = renderer.group.children[0]
    expect(instanceGroup.children).toHaveLength(0)
    expect(renderer.activeCount()).toBe(1)

    renderer.animate({ frameNowMs: 660, delta: 0.016, renderObjects: new Map() })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
  })

  it('renders buff and debuff events as distinguishable particles around locked affected targets', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const targetBuff = makeRenderObject({
      id: 'target-1',
      currentCenter: new THREE.Vector3(4, 1, 0),
      base: 2,
      width: 1.5,
      height: 3,
      clearance: 2.4,
    })
    const targetDebuff = makeRenderObject({
      id: 'target-2',
      currentCenter: new THREE.Vector3(-2, 0, 3),
      base: 1.2,
      width: 1.2,
      height: 1.6,
      clearance: 1.4,
    })
    const renderObjects = new Map([
      [targetBuff.id, targetBuff],
      [targetDebuff.id, targetDebuff],
    ])

    renderer.sync([
      buffDebuffEvent({ id: 'move-vfx-buff', targetId: 'target-1', tone: 'buff', direction: 'buff', palette: undefined }),
      buffDebuffEvent({ id: 'move-vfx-debuff', moveName: 'Leer', targetId: 'target-2', tone: 'debuff', direction: 'debuff', palette: undefined }),
    ], { renderObjects })

    const buffGroup = renderer.group.children[0]
    const debuffGroup = renderer.group.children[1]
    const buffRing = buffDebuffRingNamed(buffGroup)
    const debuffRing = buffDebuffRingNamed(debuffGroup)
    const buffParticles = buffDebuffParticleMeshes(buffGroup)
    const debuffParticles = buffDebuffParticleMeshes(debuffGroup)
    const initialBuffParticleY = buffParticles[0]?.position.y ?? 0
    const initialDebuffParticleY = debuffParticles[0]?.position.y ?? 0

    expect(renderer.activeCount()).toBe(2)
    expect(buffGroup.children).toHaveLength(6)
    expect(debuffGroup.children).toHaveLength(6)
    expectVectorClose(buffGroup.position, [4, 1, 0])
    expectVectorClose(debuffGroup.position, [-2, 0, 3])
    expect(buffRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.buff.glow.slice(1))
    expect(debuffRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.debuff.glow.slice(1))
    expect(buffParticles[0]?.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.buff.accent.slice(1))
    expect(buffParticles[1]?.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.buff.primary.slice(1))
    expect(debuffParticles[0]?.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.debuff.accent.slice(1))
    expect(buffRing.material.transparent).toBe(true)
    expect(buffRing.material.depthTest).toBe(true)
    expect(buffRing.material.depthWrite).toBe(false)
    expect(buffParticles[0]?.material.depthWrite).toBe(false)
    expect(buffRing.renderOrder).toBe(32)
    expect(debuffRing.renderOrder).toBe(32)
    expect(buffParticles.every((particle) => particle.renderOrder === 36)).toBe(true)
    expect(debuffParticles.every((particle) => particle.renderOrder === 36)).toBe(true)
    expect(buffRing.rotation.x).toBeCloseTo(-Math.PI / 2)
    expect(debuffRing.position.y).toBeGreaterThan(buffRing.position.y)
    expect(buffParticles[0]?.rotation.x).toBeCloseTo(0)
    expect(debuffParticles[0]?.rotation.x).toBeCloseTo(Math.PI)
    expect(buffParticles.every((particle) => particle.visible)).toBe(true)
    expect(debuffParticles.every((particle) => particle.visible)).toBe(true)

    renderer.animate({ frameNowMs: 380, delta: 0.016, renderObjects })

    expect(buffParticles[0]?.position.y).toBeGreaterThan(initialBuffParticleY)
    expect(debuffParticles[0]?.position.y).toBeLessThan(initialDebuffParticleY)
    expect(buffParticles[0]?.material.opacity).toBeGreaterThan(0)
    expect(debuffParticles[0]?.material.opacity).toBeGreaterThan(0)

    const lockedBuffPoint = buffGroup.position.clone()
    const buffMeshes = [buffRing, ...buffParticles]
    const debuffMeshes = [debuffRing, ...debuffParticles]
    const geometryDisposeSpies = [...buffMeshes, ...debuffMeshes].map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = [...buffMeshes, ...debuffMeshes].map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    targetBuff.currentCenter.set(10, 4, 0)
    renderer.animate({ frameNowMs: 520, delta: 0.016, renderObjects })

    expect(buffGroup.position.equals(lockedBuffPoint)).toBe(true)

    renderer.animate({ frameNowMs: 660, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce()
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce()
  })

  it('uses target-cell fallback, palette overrides, and reduced motion for buff/debuff events', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([
      buffDebuffEvent({
        id: 'move-vfx-buff-debuff-cell',
        targetId: 'missing-target',
        targetCell: { x: 5, y: 2, z: 2 },
        tone: undefined,
        direction: 'debuff',
        palette: projectilePalette,
      }),
    ], { renderObjects: new Map(), reducedMotion: true })

    const instanceGroup = renderer.group.children[0]
    const ring = buffDebuffRingNamed(instanceGroup)
    const particles = buffDebuffParticleMeshes(instanceGroup)
    const initialRingScale = ring.scale.x

    expect(renderer.activeCount()).toBe(1)
    expectVectorClose(instanceGroup.position, [5.5, 2, 2.5])
    expect(ring.material.color.getHexString()).toBe(projectilePalette.glow.slice(1))
    expect(ring.visible).toBe(true)
    expect(particles.every((particle) => !particle.visible)).toBe(true)

    renderer.animate({ frameNowMs: 380, delta: 0.016, renderObjects: new Map(), reducedMotion: true })

    expect(ring.visible).toBe(true)
    expect(ring.scale.x).toBeGreaterThan(initialRingScale)
    expect(ring.material.opacity).toBeGreaterThan(0)
    expect(particles.every((particle) => !particle.visible && particle.material.opacity === 0)).toBe(true)
  })

  it('falls back to a no-op buff/debuff effect when no affected anchor can be resolved', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([
      buffDebuffEvent({ userId: 'missing-user', targetId: undefined, targetCell: undefined }),
    ], { renderObjects: new Map() })

    const instanceGroup = renderer.group.children[0]
    expect(instanceGroup.children).toHaveLength(0)
    expect(renderer.activeCount()).toBe(1)

    renderer.animate({ frameNowMs: 660, delta: 0.016, renderObjects: new Map() })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
  })

  it('renders status events as condition-coloured clouds around locked affected targets', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const target = makeRenderObject({
      id: 'target-1',
      currentCenter: new THREE.Vector3(4, 1, 0),
      base: 2,
      width: 1.5,
      height: 3,
      clearance: 2.4,
    })
    const renderObjects = new Map([[target.id, target]])

    renderer.sync([statusEvent({ conditionNames: ['Burned'] })], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const ring = statusCloudRingNamed(instanceGroup)
    const shell = statusCloudShellNamed(instanceGroup)
    const motes = statusCloudMoteMeshes(instanceGroup)
    const initialRingScale = ring.scale.x
    const initialMoteX = motes[0]?.position.x ?? 0

    expect(renderer.activeCount()).toBe(1)
    expect(instanceGroup.children).toHaveLength(7)
    expectVectorClose(instanceGroup.position, [4, 1, 0])
    expectVectorClose(ring.position, [0, 0.105, 0])
    expect(ring.material.color.getHexString()).toBe(MOVE_VFX_TYPE_COLORS.Fire.accent.slice(1))
    expect(shell.material.color.getHexString()).toBe(MOVE_VFX_TYPE_COLORS.Fire.primary.slice(1))
    expect(motes[0]?.material.color.getHexString()).toBe(MOVE_VFX_TYPE_COLORS.Fire.primary.slice(1))
    expect(motes[1]?.material.color.getHexString()).toBe(MOVE_VFX_TYPE_COLORS.Fire.glow.slice(1))
    expect(ring.material.transparent).toBe(true)
    expect(ring.material.depthTest).toBe(true)
    expect(ring.material.depthWrite).toBe(false)
    expect(shell.material.depthWrite).toBe(false)
    expect(motes[0]?.material.depthWrite).toBe(false)
    expect(ring.renderOrder).toBe(32)
    expect(shell.renderOrder).toBe(35)
    expect(motes.every((mote) => mote.renderOrder === 36)).toBe(true)
    expect(ring.rotation.x).toBeCloseTo(-Math.PI / 2)
    expect(ring.visible).toBe(true)
    expect(shell.visible).toBe(true)
    expect(motes.every((mote) => mote.visible)).toBe(true)

    renderer.animate({ frameNowMs: 380, delta: 0.016, renderObjects })

    expect(ring.scale.x).toBeGreaterThan(initialRingScale)
    expect(motes[0]?.position.x).not.toBeCloseTo(initialMoteX)
    expect(motes[0]?.position.y).toBeGreaterThan(0)
    expect(motes[0]?.material.opacity).toBeGreaterThan(0)
    expect(shell.material.opacity).toBeGreaterThan(0)

    const lockedStatusPoint = instanceGroup.position.clone()
    const statusMeshes = [ring, shell, ...motes]
    const geometryDisposeSpies = statusMeshes.map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = statusMeshes.map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    target.currentCenter.set(10, 4, 0)
    renderer.animate({ frameNowMs: 520, delta: 0.016, renderObjects })

    expect(instanceGroup.position.equals(lockedStatusPoint)).toBe(true)

    renderer.animate({ frameNowMs: 660, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce()
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce()
  })

  it('uses combined condition hints, target-cell fallbacks, palette overrides, and reduced motion for status clouds', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([
      statusEvent({
        id: 'move-vfx-status-cell',
        targetId: 'missing-target',
        targetCell: { x: 5, y: 2, z: 2 },
        conditionNames: ['Unknown haze', 'Paralysis'],
        palette: undefined,
      }),
      statusEvent({
        id: 'move-vfx-status-palette',
        targetId: 'missing-target-2',
        targetCell: { x: 6, y: 0, z: 3 },
        conditionName: 'Poisoned',
        palette: projectilePalette,
      }),
    ], { renderObjects: new Map(), reducedMotion: true })

    const cellGroup = renderer.group.children[0]
    const paletteGroup = renderer.group.children[1]
    const cellRing = statusCloudRingNamed(cellGroup)
    const cellShell = statusCloudShellNamed(cellGroup)
    const cellMotes = statusCloudMoteMeshes(cellGroup)
    const paletteRing = statusCloudRingNamed(paletteGroup)
    const initialRingScale = cellRing.scale.x

    expect(renderer.activeCount()).toBe(2)
    expectVectorClose(cellGroup.position, [5.5, 2, 2.5])
    expectVectorClose(paletteGroup.position, [6.5, 0, 3.5])
    expect(cellRing.material.color.getHexString()).toBe(MOVE_VFX_TYPE_COLORS.Electric.accent.slice(1))
    expect(paletteRing.material.color.getHexString()).toBe(projectilePalette.accent.slice(1))
    expect(cellRing.visible).toBe(true)
    expect(cellShell.visible).toBe(false)
    expect(cellMotes.every((mote) => !mote.visible)).toBe(true)

    renderer.animate({ frameNowMs: 380, delta: 0.016, renderObjects: new Map(), reducedMotion: true })

    expect(cellRing.visible).toBe(true)
    expect(cellRing.scale.x).toBeGreaterThan(initialRingScale)
    expect(cellRing.material.opacity).toBeGreaterThan(0)
    expect(cellShell.visible).toBe(false)
    expect(cellShell.material.opacity).toBe(0)
    expect(cellMotes.every((mote) => !mote.visible && mote.material.opacity === 0)).toBe(true)
  })

  it('falls back to a generic status cloud for unknown conditions and no-ops when no affected anchor can be resolved', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(1, 0, 2) })
    const renderObjects = new Map([[user.id, user]])

    renderer.sync([
      statusEvent({ id: 'move-vfx-status-unknown', targetId: undefined, conditionName: 'Mystery Fog', palette: undefined }),
      statusEvent({ id: 'move-vfx-status-missing', userId: 'missing-user', targetId: undefined, targetCell: undefined }),
    ], { renderObjects })

    const unknownGroup = renderer.group.children[0]
    const missingGroup = renderer.group.children[1]
    const unknownRing = statusCloudRingNamed(unknownGroup)

    expect(renderer.activeCount()).toBe(2)
    expectVectorClose(unknownGroup.position, [1, 0, 2])
    expect(unknownRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.status.accent.slice(1))
    expect(missingGroup.children).toHaveLength(0)

    renderer.animate({ frameNowMs: 660, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
  })

  it('renders explicit badge events as short non-interactive CSS3D labels above affected anchors', () => {
    const cleanup = installFakeBadgeDocument()

    try {
      const scene = new THREE.Scene()
      const renderer = createMoveVfxRenderer(scene)
      const target = makeRenderObject({
        id: 'target-1',
        currentCenter: new THREE.Vector3(3, 1, 2),
        base: 1.5,
        width: 1.5,
        height: 2,
        clearance: 2,
      })
      const renderObjects = new Map([[target.id, target]])

      renderer.sync([
        badgeEvent({
          label: 'Badly Poisoned Status',
          tone: 'debuff',
          palette: undefined,
        }),
      ], { renderObjects })

      const instanceGroup = renderer.group.children[0]
      const badge = instanceGroup.children.find((child) => child.name === 'move-vfx-badge') as (THREE.Object3D & { element: FakeBadgeElement }) | undefined
      expect(badge).toBeDefined()
      expect(renderer.activeCount()).toBe(1)
      expect(renderer.needsAnimationFrame()).toBe(true)
      expect(renderer.needsCss3DFrame()).toBe(true)
      expect(renderer.debugSnapshot().css3DActive).toBe(true)
      expectVectorClose(instanceGroup.position, [3, 3.35, 2])
      expect(instanceGroup.children).toHaveLength(1)
      expect(badge?.element.textContent).toBe('Badly Poiso…')
      expect(badge?.element.getAttribute('aria-hidden')).toBe('true')
      expect(badge?.element.getAttribute('role')).toBe('presentation')
      expect(badge?.element.style.pointerEvents).toBe('none')
      expect(badge?.element.style.userSelect).toBe('none')
      expect(badge?.element.style.zIndex).toBe('10')
      expect(badge?.element.style.color).toBe(MOVE_VFX_TONE_COLORS.debuff.accent)
      expect(badge?.userData.moveVfxBadgeLabel).toBe('Badly Poiso…')

      renderer.animate({ frameNowMs: 380, delta: 0.016, renderObjects })

      expect(badge?.visible).toBe(true)
      expect(Number(badge?.element.style.opacity)).toBeGreaterThan(0)
      expect(badge?.scale.x).toBeGreaterThan(0)

      target.currentCenter.set(12, 4, 8)
      renderer.animate({ frameNowMs: 520, delta: 0.016, renderObjects })

      expectVectorClose(instanceGroup.position, [3, 3.35, 2])

      renderer.animate({ frameNowMs: 660, delta: 0.016, renderObjects })

      expect(renderer.activeCount()).toBe(0)
      expect(renderer.needsCss3DFrame()).toBe(false)
      expect(renderer.group.children).toHaveLength(0)
      expect(badge?.element.removed).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('keeps badge events as no-ops without an explicit readable label or DOM support', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([
      badgeEvent({ id: 'move-vfx-empty-badge', label: '   ' }),
      badgeEvent({ id: 'move-vfx-no-dom-badge', label: 'Heal', targetCell: { x: 2, y: 1, z: 3 } }),
    ], { renderObjects: new Map() })

    expect(renderer.activeCount()).toBe(2)
    expect(renderer.needsAnimationFrame()).toBe(true)
    expect(renderer.needsCss3DFrame()).toBe(false)
    expect(renderer.group.children[0]?.children).toHaveLength(0)
    expect(renderer.group.children[1]?.children).toHaveLength(0)

    renderer.animate({ frameNowMs: 660, delta: 0.016, renderObjects: new Map() })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
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
    expect(core.renderOrder).toBe(35)
    expect(trailSegments.map((segment) => segment.name)).toEqual([
      'move-vfx-projectile-trail-1',
      'move-vfx-projectile-trail-2',
      'move-vfx-projectile-trail-3',
      'move-vfx-projectile-trail-4',
    ])
    expect(trailSegments[0].material.color.getHexString()).toBe('aa3300')
    expect(trailSegments[0].renderOrder).toBe(34)
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

  it('uses reduced-motion target pulses for projectile and arc events without travel or trails', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 0, 0) })
    const renderObjects = new Map([
      [user.id, user],
      [target.id, target],
    ])

    renderer.sync([
      projectileEvent({ id: 'move-vfx-projectile-reduced' }),
      arcEvent({ id: 'move-vfx-arc-reduced', arcHeight: 1.2 }),
    ], { renderObjects, reducedMotion: true })

    const projectileGroup = renderer.group.children[0]
    const arcGroup = renderer.group.children[1]
    const projectileCore = projectileMeshNamed(projectileGroup, 'move-vfx-projectile-core')
    const projectileGlow = projectileMeshNamed(projectileGroup, 'move-vfx-projectile-glow')
    const projectileTrails = projectileTrailMeshes(projectileGroup)
    const arcCore = projectileMeshNamed(arcGroup, 'move-vfx-arc-core')
    const arcTrails = arcTrailMeshes(arcGroup)
    const projectileInitialScale = projectileCore.scale.x
    const arcInitialScale = arcCore.scale.x

    expectVectorClose(projectileGroup.position, [4, 1.16, 0])
    expectVectorClose(arcGroup.position, [4, 1.16, 0])
    expect(projectileCore.visible).toBe(true)
    expect(projectileGlow.visible).toBe(true)
    expect(projectileTrails.every((segment) => !segment.visible && segment.material.opacity === 0)).toBe(true)
    expect(arcTrails.every((segment) => !segment.visible && segment.material.opacity === 0)).toBe(true)

    renderer.animate({ frameNowMs: 600, delta: 0.016, renderObjects, reducedMotion: true })

    expectVectorClose(projectileGroup.position, [4, 1.16, 0])
    expectVectorClose(arcGroup.position, [4, 1.16, 0])
    expect(projectileCore.scale.x).toBeGreaterThan(projectileInitialScale)
    expect(projectileCore.scale.x).toBeLessThan(projectileInitialScale * 1.35)
    expect(arcCore.scale.x).toBeGreaterThan(arcInitialScale)
    expect(arcCore.scale.x).toBeLessThan(arcInitialScale * 1.35)
    expect(projectileTrails.every((segment) => !segment.visible && segment.material.opacity === 0)).toBe(true)
    expect(arcTrails.every((segment) => !segment.visible && segment.material.opacity === 0)).toBe(true)
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
    expect(core.renderOrder).toBe(35)
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

  it('uses a reduced-motion target pulse instead of an animated beam line', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 0, 0) })
    const renderObjects = new Map([
      [user.id, user],
      [target.id, target],
    ])

    renderer.sync([beamEvent({ id: 'move-vfx-beam-reduced' })], { renderObjects, reducedMotion: true })

    const instanceGroup = renderer.group.children[0]
    const glow = beamCylinderNamed(instanceGroup, 'move-vfx-beam-glow')
    const core = beamCylinderNamed(instanceGroup, 'move-vfx-beam-core')
    const ring = beamRingNamed(instanceGroup, 'move-vfx-beam-impact-ring')
    const initialRingScale = ring.scale.x

    expect(instanceGroup.children).toHaveLength(3)
    expectVectorClose(instanceGroup.position, [2, 1.16, 0])
    expect(glow.visible).toBe(false)
    expect(core.visible).toBe(false)
    expect(glow.material.opacity).toBe(0)
    expect(core.material.opacity).toBe(0)
    expect(ring.visible).toBe(true)
    expect(ring.position.y).toBeCloseTo(2)

    renderer.animate({ frameNowMs: 600, delta: 0.016, renderObjects, reducedMotion: true })

    expect(glow.visible).toBe(false)
    expect(core.visible).toBe(false)
    expect(ring.visible).toBe(true)
    expect(ring.scale.x).toBeGreaterThan(initialRingScale)
    expect(ring.scale.x).toBeLessThan(initialRingScale * 1.4)
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
    expect(ghost.renderOrder).toBe(35)
    expect(streak.renderOrder).toBe(34)
    expect(impactRing.renderOrder).toBe(34)
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

  it('uses a reduced-motion contact pulse for melee lunges without ghost travel', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 0, 0) })
    const renderObjects = new Map([
      [user.id, user],
      [target.id, target],
    ])

    renderer.sync([meleeLungeEvent({ id: 'move-vfx-melee-lunge-reduced' })], { renderObjects, reducedMotion: true })

    const instanceGroup = renderer.group.children[0]
    const streak = meleeLungeStreakNamed(instanceGroup)
    const ghost = meleeLungeGhostNamed(instanceGroup)
    const impactRing = meleeLungeImpactRingNamed(instanceGroup)

    expect(ghost.visible).toBe(false)
    expect(streak.visible).toBe(false)
    expect(impactRing.visible).toBe(false)

    renderer.animate({ frameNowMs: 600, delta: 0.016, renderObjects, reducedMotion: true })

    expect(ghost.visible).toBe(false)
    expect(ghost.material.opacity).toBe(0)
    expect(streak.visible).toBe(false)
    expect(streak.material.opacity).toBe(0)
    expect(impactRing.visible).toBe(true)
    expectVectorClose(impactRing.position, [4, 0, 0])
    expect(impactRing.scale.x).toBeGreaterThan(0.3)
    expect(impactRing.scale.x).toBeLessThan(1.1)
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

  it('renders dash events as VFX-owned afterimage paths without moving token placement', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const renderObjects = new Map([[user.id, user]])
    const userPlacement = user.currentCenter.clone()

    renderer.sync([dashEvent()], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const streak = dashStreakNamed(instanceGroup)
    const afterimages = dashAfterimageMeshes(instanceGroup)
    const destinationRing = dashDestinationRingNamed(instanceGroup)
    expect(instanceGroup.children).toHaveLength(6)
    expectVectorClose(instanceGroup.position, [0, 0, 0])
    expect(streak.material.color.getHexString()).toBe('aa3300')
    expect(afterimages[0]?.material.color.getHexString()).toBe('123456')
    expect(afterimages[1]?.material.color.getHexString()).toBe('ffeeaa')
    expect(destinationRing.material.color.getHexString()).toBe('ffeeaa')
    expect(streak.material.transparent).toBe(true)
    expect(streak.material.depthTest).toBe(true)
    expect(streak.material.depthWrite).toBe(false)
    expect(streak.material.side).toBe(THREE.DoubleSide)
    expect(streak.material.blending).toBe(THREE.AdditiveBlending)
    expect(streak.renderOrder).toBe(34)
    expect(afterimages.every((afterimage) => afterimage.renderOrder === 35)).toBe(true)
    expect(destinationRing.renderOrder).toBe(34)
    expect(destinationRing.rotation.x).toBeCloseTo(-Math.PI / 2)
    expect(streak.visible).toBe(false)
    expect(afterimages.every((afterimage) => !afterimage.visible)).toBe(true)
    expect(destinationRing.visible).toBe(false)

    renderer.animate({ frameNowMs: 600, delta: 0.016, renderObjects })

    expect(streak.visible).toBe(true)
    expect(streak.position.x).toBeGreaterThan(1.5)
    expect(streak.position.z).toBeGreaterThan(0.1)
    expect(streak.scale.y).toBeGreaterThan(4)
    expect(afterimages.every((afterimage) => afterimage.visible)).toBe(true)
    expect(afterimages[0]?.position.x).toBeGreaterThan(0)
    expect(afterimages[3]?.position.x).toBeGreaterThan(afterimages[0]?.position.x ?? 0)
    expect(destinationRing.visible).toBe(true)
    expectVectorClose(destinationRing.position, [4.5, 0.105, 0.5])
    expect(destinationRing.material.opacity).toBeGreaterThan(0)
    expect(user.currentCenter.equals(userPlacement)).toBe(true)

    const lockedDashStart = instanceGroup.position.clone()
    const dashMeshes = [streak, ...afterimages, destinationRing] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[]
    const geometryDisposeSpies = dashMeshes.map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = dashMeshes.map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    user.currentCenter.set(10, 0, 0)
    renderer.animate({ frameNowMs: 601, delta: 0.016, renderObjects })

    expect(instanceGroup.position.equals(lockedDashStart)).toBe(true)
    expect(destinationRing.position.x).toBeCloseTo(4.5)
    expect(user.currentCenter.equals(userPlacement)).toBe(false)

    renderer.animate({ frameNowMs: 1100, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce()
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce()
  })

  it('uses path-cell destination fallback and reduced-motion destination pulses for dash events', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([
      dashEvent({
        userId: 'missing-user',
        originCell: { x: 0, y: 0, z: 0 },
        destinationCell: undefined,
        pathCells: [
          { x: Number.NaN, y: 0, z: 0 },
          { x: 2, y: 1, z: 1 },
        ],
        palette: undefined,
      }),
    ], { renderObjects: new Map(), reducedMotion: true })

    const instanceGroup = renderer.group.children[0]
    const streak = dashStreakNamed(instanceGroup)
    const afterimages = dashAfterimageMeshes(instanceGroup)
    const destinationRing = dashDestinationRingNamed(instanceGroup)
    const initialRingScale = destinationRing.scale.x

    expect(instanceGroup.children).toHaveLength(6)
    expectVectorClose(instanceGroup.position, [0.5, 0, 0.5])
    expectVectorClose(destinationRing.position, [2, 1.105, 1])
    expect(destinationRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.neutral.accent.slice(1))
    expect(destinationRing.visible).toBe(true)
    expect(streak.visible).toBe(false)
    expect(streak.material.opacity).toBe(0)
    expect(afterimages.every((afterimage) => !afterimage.visible && afterimage.material.opacity === 0)).toBe(true)

    renderer.animate({ frameNowMs: 600, delta: 0.016, reducedMotion: true })

    expect(destinationRing.visible).toBe(true)
    expect(destinationRing.scale.x).toBeGreaterThan(initialRingScale)
    expect(destinationRing.scale.x).toBeLessThan(initialRingScale * 1.3)
    expect(streak.visible).toBe(false)
    expect(afterimages.every((afterimage) => !afterimage.visible && afterimage.material.opacity === 0)).toBe(true)
  })

  it('falls back to a self pulse for dash events without destination data', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(2, 0, 1) })
    const renderObjects = new Map([[user.id, user]])

    renderer.sync([dashEvent({ destinationCell: undefined, pathCells: undefined })], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const baseRing = selfPulseRingNamed(instanceGroup, 'move-vfx-self-pulse-base-ring')
    const shell = selfPulseShellNamed(instanceGroup)

    expect(instanceGroup.children).toHaveLength(3)
    expectVectorClose(instanceGroup.position, [2, 0, 1])
    expect(baseRing.material.color.getHexString()).toBe(projectilePalette.accent.slice(1))
    expect(shell.material.color.getHexString()).toBe(projectilePalette.primary.slice(1))
    expect(instanceGroup.children.some((child) => child.name === 'move-vfx-dash-streak')).toBe(false)
  })

  it('falls back to a no-op dash when a destination is present but no start anchor can be resolved', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([dashEvent({ userId: 'missing-user' })], { renderObjects: new Map() })

    const instanceGroup = renderer.group.children[0]
    expect(instanceGroup.children).toHaveLength(0)
    expect(renderer.activeCount()).toBe(1)

    renderer.animate({ frameNowMs: 1100, delta: 0.016, renderObjects: new Map() })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
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
    expectVectorClose(ring.position, [0, 0.105, 0])
    expect(shell.material.color.getHexString()).toBe('123456')
    expect(ring.material.color.getHexString()).toBe('ffeeaa')
    expect(shell.material.transparent).toBe(true)
    expect(shell.material.depthWrite).toBe(false)
    expect(shell.renderOrder).toBe(35)
    expect(ring.renderOrder).toBe(34)
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

  it('applies optional target flash shake as VFX-only overlay motion and disables it for reduced motion', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 0, 0) })
    const renderObjects = new Map([[target.id, target]])

    renderer.sync([targetFlashEvent({ id: 'move-vfx-target-flash-shake', tone: 'hit', shake: true })], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    expectVectorClose(instanceGroup.position, [4, 0, 0])

    renderer.animate({ frameNowMs: 160, delta: 0.016, renderObjects })

    expect(instanceGroup.position.distanceTo(target.currentCenter)).toBeGreaterThan(0.005)
    expect(instanceGroup.position.distanceTo(target.currentCenter)).toBeLessThan(0.09)
    expectVectorClose(target.currentCenter, [4, 0, 0])

    renderer.dispose()
    expectVectorClose(target.currentCenter, [4, 0, 0])

    const reducedRenderer = createMoveVfxRenderer(new THREE.Scene())
    reducedRenderer.sync([
      targetFlashEvent({ id: 'move-vfx-target-flash-reduced-shake', tone: 'hit', shake: true }),
    ], { renderObjects, reducedMotion: true })

    const reducedGroup = reducedRenderer.group.children[0]
    reducedRenderer.animate({ frameNowMs: 160, delta: 0.016, renderObjects })

    expectVectorClose(reducedGroup.position, [4, 0, 0])
    expectVectorClose(target.currentCenter, [4, 0, 0])
  })

  it('keeps reduced-motion target outcome accents readable without shake, clouds, or starburst spokes', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(0, 0, 0) })
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 0, 0) })
    const renderObjects = new Map([
      [user.id, user],
      [target.id, target],
    ])

    renderer.sync([
      targetFlashEvent({ id: 'move-vfx-target-flash-reduced', tone: 'hit', shake: true }),
      impactRingEvent({ id: 'move-vfx-impact-ring-reduced', tone: 'hit' }),
      missEvent({ id: 'move-vfx-miss-reduced' }),
      critEvent({ id: 'move-vfx-crit-reduced' }),
    ], { renderObjects, reducedMotion: true })

    const targetFlashGroup = renderer.group.children[0]
    const impactGroup = renderer.group.children[1]
    const missGroup = renderer.group.children[2]
    const critGroup = renderer.group.children[3]
    const targetRing = targetFlashRingNamed(targetFlashGroup)
    const targetShell = targetFlashShellNamed(targetFlashGroup)
    const impactRing = impactRingNamed(impactGroup)
    const missRing = missPuffRingNamed(missGroup)
    const missClouds = missPuffCloudMeshes(missGroup)
    const critInnerRing = critBurstRingNamed(critGroup, 'move-vfx-crit-burst-inner-ring')
    const critOuterRing = critBurstRingNamed(critGroup, 'move-vfx-crit-burst-outer-ring')
    const critSpokes = critBurstSpokeMeshes(critGroup)
    const targetInitialScale = targetRing.scale.x
    const impactInitialScale = impactRing.scale.x

    expectVectorClose(targetFlashGroup.position, [4, 0, 0])
    expect(targetShell.visible).toBe(true)
    expect(targetRing.visible).toBe(true)
    expect(missClouds.every((cloud) => !cloud.visible && cloud.material.opacity === 0)).toBe(true)
    expect(critSpokes.every((spoke) => !spoke.visible && spoke.material.opacity === 0)).toBe(true)

    renderer.animate({ frameNowMs: 190, delta: 0.016, renderObjects, reducedMotion: true })

    expectVectorClose(targetFlashGroup.position, [4, 0, 0])
    expect(targetRing.scale.x).toBeGreaterThan(targetInitialScale)
    expect(targetRing.scale.x).toBeLessThan(targetInitialScale * 1.3)
    expect(targetShell.material.opacity).toBeGreaterThan(0)
    expect(impactRing.visible).toBe(true)
    expect(impactRing.scale.x).toBeGreaterThan(impactInitialScale)
    expect(impactRing.scale.x).toBeLessThan(impactInitialScale * 1.4)
    expect(missRing.visible).toBe(true)
    expect(missClouds.every((cloud) => !cloud.visible && cloud.material.opacity === 0)).toBe(true)
    expect(critInnerRing.visible).toBe(true)
    expect(critOuterRing.visible).toBe(true)
    expect(critSpokes.every((spoke) => !spoke.visible && spoke.material.opacity === 0)).toBe(true)
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
    expectVectorClose(ring.position, [0, 0.105, 0])
    expect(ring.material.color.getHexString()).toBe('ffeeaa')
    expect(ring.material.transparent).toBe(true)
    expect(ring.material.depthTest).toBe(true)
    expect(ring.material.depthWrite).toBe(false)
    expect(ring.material.polygonOffset).toBe(true)
    expect(ring.material.polygonOffsetFactor).toBe(-1)
    expect(ring.material.polygonOffsetUnits).toBe(-2)
    expect(ring.renderOrder).toBe(34)
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

  it('renders area pulse events as instanced cell overlays over locked confirmed cells', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const cells = [
      { x: 1, y: 0, z: 0 },
      { x: 3, y: 2, z: 4 },
      { x: -1, y: 1, z: 2 },
    ]

    renderer.sync([areaPulseEvent({ areaCells: cells })])

    const instanceGroup = renderer.group.children[0]
    const mesh = areaPulseCellsMeshNamed(instanceGroup)
    const firstInitialScale = instanceMatrixScale(mesh, 0).x
    const firstInitialOpacity = mesh.material.opacity

    expect(instanceGroup.children).toHaveLength(1)
    expect(instanceGroup.position.equals(new THREE.Vector3(0, 0, 0))).toBe(true)
    expect(mesh.count).toBe(cells.length)
    expect(mesh.geometry).toBeInstanceOf(THREE.PlaneGeometry)
    expect(mesh.material.color.getHexString()).toBe(projectilePalette.primary.slice(1))
    expect(mesh.material.transparent).toBe(true)
    expect(mesh.material.depthTest).toBe(true)
    expect(mesh.material.depthWrite).toBe(false)
    expect(mesh.material.side).toBe(THREE.DoubleSide)
    expect(mesh.material.blending).toBe(THREE.AdditiveBlending)
    expect(mesh.material.polygonOffset).toBe(true)
    expect(mesh.material.polygonOffsetFactor).toBe(-1)
    expect(mesh.material.polygonOffsetUnits).toBe(-2)
    expect(mesh.renderOrder).toBe(32)
    expect(mesh.visible).toBe(true)
    expectVectorClose(instanceMatrixPosition(mesh, 0), [1.5, 0.09, 0.5])
    expectVectorClose(instanceMatrixPosition(mesh, 1), [3.5, 2.09, 4.5])
    expect(firstInitialScale).toBeCloseTo(0.68)
    expect(firstInitialOpacity).toBeGreaterThan(0)
    expect(firstInitialOpacity).toBeLessThan(0.09)

    renderer.animate({ frameNowMs: 380, delta: 0.016 })

    expect(mesh.count).toBe(cells.length)
    expect(instanceMatrixScale(mesh, 0).x).toBeGreaterThan(firstInitialScale)
    expect(instanceMatrixScale(mesh, 1).x).toBeCloseTo(instanceMatrixScale(mesh, 0).x)
    expect(mesh.material.opacity).toBeGreaterThan(firstInitialOpacity)
    expectVectorClose(instanceMatrixPosition(mesh, 2), [-0.5, 1.09, 2.5])

    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose')
    const materialDispose = vi.spyOn(mesh.material, 'dispose')

    renderer.animate({ frameNowMs: 660, delta: 0.016 })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
  })

  it('uses fallback palettes, ignores invalid cells, and no-ops empty area pulse events safely', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([
      areaPulseEvent({
        id: 'move-vfx-area-pulse-neutral',
        areaCells: [
          { x: 0, y: 0, z: 0 },
          { x: Number.NaN, y: 0, z: 1 },
        ],
        palette: undefined,
      }),
      areaPulseEvent({ id: 'move-vfx-area-pulse-empty', areaCells: [] }),
    ], { reducedMotion: true })

    const neutralGroup = renderer.group.children[0]
    const emptyGroup = renderer.group.children[1]
    const mesh = areaPulseCellsMeshNamed(neutralGroup)
    const initialScale = instanceMatrixScale(mesh, 0).x

    expect(renderer.activeCount()).toBe(2)
    expect(mesh.count).toBe(1)
    expect(mesh.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.neutral.primary.slice(1))
    expect(mesh.visible).toBe(true)
    expect(initialScale).toBeCloseTo(0.9)
    expect(emptyGroup.children).toHaveLength(0)

    renderer.animate({ frameNowMs: 380, delta: 0.016, reducedMotion: true })

    expect(instanceMatrixScale(mesh, 0).x).toBeGreaterThan(initialScale)
    expect(instanceMatrixScale(mesh, 0).x).toBeLessThan(1.03)
    expect(mesh.material.opacity).toBeGreaterThan(0)

    renderer.animate({ frameNowMs: 660, delta: 0.016, reducedMotion: true })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
  })

  it('renders radial burst events as center-out rings and rays from close user anchors', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const user = makeRenderObject({ id: 'user-1', currentCenter: new THREE.Vector3(2.5, 0, 2.5) })
    const renderObjects = new Map([[user.id, user]])
    const cells = [
      { x: 2, y: 0, z: 2 },
      { x: 4, y: 0, z: 2 },
      { x: 2, y: 0, z: 4 },
      { x: 1, y: 0, z: 3 },
    ]

    renderer.sync([radialBurstEvent({
      areaCells: cells,
      areaOrigin: { x: 2, y: 0, z: 2 },
      originCell: { x: 2, y: 0, z: 2 },
    })], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const innerRing = radialBurstRingNamed(instanceGroup, 'move-vfx-radial-burst-inner-ring')
    const outerRing = radialBurstRingNamed(instanceGroup, 'move-vfx-radial-burst-outer-ring')
    const rays = radialBurstRayMeshes(instanceGroup)
    const initialInnerScale = innerRing.scale.x
    const initialRayLength = rays[0]?.scale.y ?? 0

    expect(instanceGroup.children).toHaveLength(10)
    expectVectorClose(instanceGroup.position, [2.5, 0, 2.5])
    expectVectorClose(innerRing.position, [0, 0.105, 0])
    expectVectorClose(outerRing.position, [0, 0.111, 0])
    expect(innerRing.material.color.getHexString()).toBe(projectilePalette.accent.slice(1))
    expect(outerRing.material.color.getHexString()).toBe(projectilePalette.primary.slice(1))
    expect(rays[0]?.material.color.getHexString()).toBe(projectilePalette.glow.slice(1))
    expect(innerRing.material.transparent).toBe(true)
    expect(innerRing.material.depthTest).toBe(true)
    expect(innerRing.material.depthWrite).toBe(false)
    expect(innerRing.material.side).toBe(THREE.DoubleSide)
    expect(innerRing.material.blending).toBe(THREE.AdditiveBlending)
    expect(innerRing.renderOrder).toBe(33)
    expect(rays.every((ray) => ray.renderOrder === 34)).toBe(true)
    expect(rays.every((ray) => ray.visible)).toBe(true)
    expect(initialInnerScale).toBeGreaterThan(0.5)
    expect(initialRayLength).toBeGreaterThan(0.2)
    expect(innerRing.material.opacity).toBeGreaterThan(0)

    renderer.animate({ frameNowMs: 380, delta: 0.016, renderObjects })

    expect(innerRing.scale.x).toBeGreaterThan(initialInnerScale)
    expect(outerRing.scale.x).toBeGreaterThan(innerRing.scale.x)
    expect(rays[0]?.scale.y).toBeGreaterThan(initialRayLength)
    expect(rays[0]?.position.x).toBeGreaterThan(0)
    expect(rays[0]?.position.y).toBeCloseTo(0.117)

    const lockedCenter = instanceGroup.position.clone()
    const geometryDisposeSpies = [innerRing, outerRing, ...rays].map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = [innerRing, outerRing, ...rays].map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    user.currentCenter.set(12, 0, 12)
    renderer.animate({ frameNowMs: 520, delta: 0.016, renderObjects })

    expect(instanceGroup.position.equals(lockedCenter)).toBe(true)

    renderer.animate({ frameNowMs: 660, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(geometryDisposeSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true)
    expect(materialDisposeSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true)
  })

  it('uses centroid fallback, fallback palette, invalid-cell filtering, and reduced motion for radial bursts', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const cells = [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 0, y: 0, z: 2 },
      { x: Number.NaN, y: 0, z: 9 },
    ]

    renderer.sync([
      radialBurstEvent({
        id: 'move-vfx-radial-centroid',
        areaCells: cells,
        palette: undefined,
      }),
      radialBurstEvent({
        id: 'move-vfx-radial-empty',
        areaCells: [],
        palette: undefined,
      }),
    ], { renderObjects: new Map(), reducedMotion: true })

    const centroidGroup = renderer.group.children[0]
    const emptyGroup = renderer.group.children[1]
    const innerRing = radialBurstRingNamed(centroidGroup, 'move-vfx-radial-burst-inner-ring')
    const outerRing = radialBurstRingNamed(centroidGroup, 'move-vfx-radial-burst-outer-ring')
    const rays = radialBurstRayMeshes(centroidGroup)
    const initialScale = innerRing.scale.x

    expectVectorClose(centroidGroup.position, [1.8333333333333333, 0, 1.1666666666666667])
    expect(innerRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.neutral.accent.slice(1))
    expect(outerRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.neutral.primary.slice(1))
    expect(rays.every((ray) => !ray.visible && ray.material.opacity === 0)).toBe(true)
    expect(emptyGroup.children).toHaveLength(0)

    renderer.animate({ frameNowMs: 380, delta: 0.016, reducedMotion: true })

    expect(innerRing.scale.x).toBeGreaterThan(initialScale)
    expect(innerRing.scale.x).toBeLessThan(initialScale * 1.2)
    expect(outerRing.visible).toBe(true)
    expect(rays.every((ray) => !ray.visible && ray.material.opacity === 0)).toBe(true)

    renderer.animate({ frameNowMs: 660, delta: 0.016, reducedMotion: true })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
  })

  it('renders line sweep events as directional instanced cell reveals from the user outward', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const cells = [
      { x: 3, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ]

    renderer.sync([lineSweepEvent({
      areaCells: cells,
      areaOrigin: { x: 0, y: 0, z: 0 },
      originCell: { x: 0, y: 0, z: 0 },
      areaDirection: 'east',
    })])

    const instanceGroup = renderer.group.children[0]
    const mesh = areaSweepCellsMeshNamed(instanceGroup)
    const firstInitialScale = instanceMatrixScale(mesh, 0).x
    const secondInitialScale = instanceMatrixScale(mesh, 1).x
    const thirdInitialScale = instanceMatrixScale(mesh, 2).x
    const firstInitialOpacity = mesh.material.opacity

    expect(instanceGroup.children).toHaveLength(1)
    expect(mesh.count).toBe(3)
    expect(mesh.geometry).toBeInstanceOf(THREE.PlaneGeometry)
    expect(mesh.material.color.getHexString()).toBe(projectilePalette.accent.slice(1))
    expect(mesh.material.transparent).toBe(true)
    expect(mesh.material.depthTest).toBe(true)
    expect(mesh.material.depthWrite).toBe(false)
    expect(mesh.material.side).toBe(THREE.DoubleSide)
    expect(mesh.material.blending).toBe(THREE.AdditiveBlending)
    expect(mesh.renderOrder).toBe(33)
    expect(mesh.visible).toBe(true)
    expectVectorClose(instanceMatrixPosition(mesh, 0), [1.5, 0.105, 0.5])
    expectVectorClose(instanceMatrixPosition(mesh, 1), [2.5, 0.105, 0.5])
    expectVectorClose(instanceMatrixPosition(mesh, 2), [3.5, 0.105, 0.5])
    expect(firstInitialScale).toBeCloseTo(0.42)
    expect(secondInitialScale).toBeLessThan(0.01)
    expect(thirdInitialScale).toBeLessThan(0.01)
    expect(firstInitialOpacity).toBeGreaterThan(0)

    renderer.animate({ frameNowMs: 580, delta: 0.016 })

    expect(instanceMatrixScale(mesh, 0).x).toBeGreaterThan(firstInitialScale)
    expect(instanceMatrixScale(mesh, 1).x).toBeGreaterThan(0.4)
    expect(instanceMatrixScale(mesh, 2).x).toBeLessThan(0.01)
    expect(mesh.material.opacity).toBeGreaterThan(firstInitialOpacity)

    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose')
    const materialDispose = vi.spyOn(mesh.material, 'dispose')

    renderer.animate({ frameNowMs: 1060, delta: 0.016 })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
  })

  it('uses the same sweep primitive for cones and falls back to all-at-once pulses when direction is missing', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const cells = [
      { x: 0, y: 0, z: -1 },
      { x: 1, y: 0, z: -2 },
      { x: Number.NaN, y: 0, z: -3 },
    ]

    renderer.sync([
      coneSweepEvent({
        id: 'move-vfx-cone-no-direction',
        areaCells: cells,
        palette: undefined,
      }),
      lineSweepEvent({
        id: 'move-vfx-line-empty',
        areaCells: [],
      }),
    ], { reducedMotion: true })

    const coneGroup = renderer.group.children[0]
    const emptyGroup = renderer.group.children[1]
    const mesh = areaSweepCellsMeshNamed(coneGroup)
    const firstScale = instanceMatrixScale(mesh, 0).x
    const secondScale = instanceMatrixScale(mesh, 1).x

    expect(renderer.activeCount()).toBe(2)
    expect(mesh.count).toBe(2)
    expect(mesh.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.neutral.accent.slice(1))
    expect(mesh.visible).toBe(true)
    expect(firstScale).toBeCloseTo(secondScale)
    expect(firstScale).toBeCloseTo(0.9)
    expectVectorClose(instanceMatrixPosition(mesh, 0), [0.5, 0.09, -0.5])
    expectVectorClose(instanceMatrixPosition(mesh, 1), [1.5, 0.09, -1.5])
    expect(emptyGroup.children).toHaveLength(0)

    renderer.animate({ frameNowMs: 580, delta: 0.016, reducedMotion: true })

    expect(instanceMatrixScale(mesh, 0).x).toBeGreaterThan(firstScale)
    expect(instanceMatrixScale(mesh, 0).x).toBeLessThan(1.03)
    expect(instanceMatrixScale(mesh, 1).x).toBeCloseTo(instanceMatrixScale(mesh, 0).x)
    expect(mesh.material.opacity).toBeGreaterThan(0)

    renderer.animate({ frameNowMs: 1060, delta: 0.016, reducedMotion: true })

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
    expectVectorClose(ring.position, [0, 0.105, 0])
    expect(ring.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.miss.accent.slice(1))
    expect(clouds[0]?.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.miss.primary.slice(1))
    expect(clouds[1]?.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.miss.glow.slice(1))
    expect(ring.material.color.getHexString()).not.toBe(projectilePalette.accent.slice(1))
    expect(ring.material.transparent).toBe(true)
    expect(ring.material.depthTest).toBe(true)
    expect(ring.material.depthWrite).toBe(false)
    expect(ring.renderOrder).toBe(33)
    expect(clouds.every((cloud) => cloud.renderOrder === 35)).toBe(true)
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

  it('renders crit burst events as short starbursts with crit accents and move palette colour', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)
    const target = makeRenderObject({ id: 'target-1', currentCenter: new THREE.Vector3(4, 1, 0) })
    const renderObjects = new Map([[target.id, target]])

    renderer.sync([critEvent()], { renderObjects })

    const instanceGroup = renderer.group.children[0]
    const outerRing = critBurstRingNamed(instanceGroup, 'move-vfx-crit-burst-outer-ring')
    const innerRing = critBurstRingNamed(instanceGroup, 'move-vfx-crit-burst-inner-ring')
    const spokes = critBurstSpokeMeshes(instanceGroup)
    expect(instanceGroup.children).toHaveLength(10)
    expectVectorClose(instanceGroup.position, [4, 1, 0])
    expectVectorClose(innerRing.position, [0, 0.12, 0])
    expectVectorClose(outerRing.position, [0, 0.162, 0])
    expect(outerRing.material.color.getHexString()).toBe('123456')
    expect(innerRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.crit.accent.slice(1))
    expect(spokes[0]?.material.color.getHexString()).toBe('ffeeaa')
    expect(spokes[1]?.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.crit.primary.slice(1))
    expect(outerRing.material.transparent).toBe(true)
    expect(outerRing.material.depthTest).toBe(true)
    expect(outerRing.material.depthWrite).toBe(false)
    expect(outerRing.renderOrder).toBe(38)
    expect(innerRing.renderOrder).toBe(38)
    expect(spokes.every((spoke) => spoke.renderOrder === 39)).toBe(true)
    expect(outerRing.visible).toBe(false)
    expect(innerRing.visible).toBe(false)
    expect(spokes.every((spoke) => !spoke.visible)).toBe(true)

    renderer.animate({ frameNowMs: 190, delta: 0.016, renderObjects })

    expect(outerRing.visible).toBe(true)
    expect(innerRing.visible).toBe(true)
    expect(spokes.every((spoke) => spoke.visible)).toBe(true)
    expect(innerRing.material.opacity).toBeGreaterThan(outerRing.material.opacity)
    expect(outerRing.scale.x).toBeGreaterThan(innerRing.scale.x)
    expect(spokes[0]?.position.y).toBeCloseTo(1)
    expect(spokes[0]?.scale.y).toBeGreaterThan(0.7)

    const lockedCritPoint = instanceGroup.position.clone()
    const geometryDisposeSpies = [outerRing, innerRing, ...spokes].map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))
    const materialDisposeSpies = [outerRing, innerRing, ...spokes].map((mesh) => vi.spyOn(mesh.material, 'dispose'))

    target.currentCenter.set(12, 3, 0)
    renderer.animate({ frameNowMs: 240, delta: 0.016, renderObjects })

    expect(instanceGroup.position.equals(lockedCritPoint)).toBe(true)

    renderer.animate({ frameNowMs: 360, delta: 0.016, renderObjects })

    expect(renderer.activeCount()).toBe(0)
    expect(renderer.group.children).toHaveLength(0)
    expect(renderer.needsAnimationFrame()).toBe(false)
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce()
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce()
  })

  it('uses grid-cell fallback anchors and semantic colours for crit bursts without a target token', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([
      critEvent({
        targetId: 'missing-target',
        targetCell: { x: 5, y: 2, z: 2 },
        palette: undefined,
      }),
    ], { renderObjects: new Map() })

    const instanceGroup = renderer.group.children[0]
    const outerRing = critBurstRingNamed(instanceGroup, 'move-vfx-crit-burst-outer-ring')
    const innerRing = critBurstRingNamed(instanceGroup, 'move-vfx-crit-burst-inner-ring')
    const spokes = critBurstSpokeMeshes(instanceGroup)

    expect(instanceGroup.children).toHaveLength(10)
    expectVectorClose(instanceGroup.position, [5.5, 2, 2.5])
    expect(outerRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.crit.glow.slice(1))
    expect(innerRing.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.crit.accent.slice(1))
    expect(spokes[0]?.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.crit.accent.slice(1))
    expect(spokes[1]?.material.color.getHexString()).toBe(MOVE_VFX_TONE_COLORS.crit.primary.slice(1))
  })

  it('falls back to a no-op crit burst when no target anchor can be resolved', () => {
    const scene = new THREE.Scene()
    const renderer = createMoveVfxRenderer(scene)

    renderer.sync([critEvent({ targetId: 'missing-target' })], { renderObjects: new Map() })

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
      css3DActive: false,
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
