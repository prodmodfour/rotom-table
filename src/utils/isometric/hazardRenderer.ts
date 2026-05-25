import * as THREE from 'three'
import type { MapHazardKind, MapHazardV2 } from '~/types/map'
import { MAP_HAZARD_DEFINITIONS } from '~/utils/mapHazardDefinitions'
import { normalizeMapHazardLayer } from '~/utils/mapHazards'
import { parseHexColor } from '~/utils/voxelColors'
import { disposeObject3D } from './resourceDisposal'

export const HAZARD_DECAL_SIZE = 128
export const HAZARD_Y_OFFSET = 0.035

export interface HazardRenderer {
  sync(hazards: ReadonlyArray<MapHazardV2>): void
  dispose(): void
  setVisible(visible: boolean): void
  meshes(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[]
}

const hazardTextureCache = new Map<string, THREE.CanvasTexture>()

export const hazardColorNumber = (kind: MapHazardKind): number =>
  parseHexColor(MAP_HAZARD_DEFINITIONS[kind].color) ?? 0xff1f2d

const hazardCanvasColor = (kind: MapHazardKind, alpha = 1): string => {
  const hex = MAP_HAZARD_DEFINITIONS[kind].color.replace('#', '')
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const drawHazardTriangle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
  stroke = 'rgba(5, 6, 8, 0.85)',
) => {
  ctx.beginPath()
  ctx.moveTo(x, y - radius)
  ctx.lineTo(x + radius * 0.82, y + radius * 0.72)
  ctx.lineTo(x - radius * 0.82, y + radius * 0.72)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = stroke
  ctx.lineWidth = Math.max(3, radius * 0.16)
  ctx.stroke()
}

const drawHazardTexture = (
  kind: MapHazardKind,
  layer: number | undefined,
): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = HAZARD_DECAL_SIZE
  canvas.height = HAZARD_DECAL_SIZE
  const ctx = canvas.getContext('2d')!
  const cx = HAZARD_DECAL_SIZE / 2
  const cy = HAZARD_DECAL_SIZE / 2
  const color = hazardCanvasColor(kind)
  const faint = hazardCanvasColor(kind, 0.18)
  const mid = hazardCanvasColor(kind, 0.55)

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(5, 6, 8, 0.48)'
  ctx.beginPath()
  ctx.roundRect(7, 7, 114, 114, 18)
  ctx.fill()
  ctx.strokeStyle = mid
  ctx.lineWidth = 4
  ctx.stroke()

  if (kind === 'spikes') {
    ctx.fillStyle = faint
    ctx.beginPath()
    ctx.arc(cx, cy, 42, 0, Math.PI * 2)
    ctx.fill()
    drawHazardTriangle(ctx, 42, 72, 25, color)
    drawHazardTriangle(ctx, 70, 50, 31, '#f7f7f2')
    drawHazardTriangle(ctx, 88, 78, 23, color)
  } else if (kind === 'toxic-spikes') {
    ctx.fillStyle = faint
    ctx.beginPath()
    ctx.arc(cx, cy, 43, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 10
    ctx.lineCap = 'round'
    for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * 39, cy + Math.sin(angle) * 39)
      ctx.stroke()
    }
    ctx.fillStyle = '#f7f7f2'
    ctx.beginPath()
    ctx.arc(cx, cy, 15, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = color
    ctx.font = '900 30px Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(layer ?? 1), 101, 29)
  } else if (kind === 'sticky-web') {
    ctx.strokeStyle = 'rgba(247, 247, 242, 0.9)'
    ctx.lineWidth = 4
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * 50, cy + Math.sin(angle) * 50)
      ctx.stroke()
    }
    for (const radius of [18, 32, 48]) {
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.strokeStyle = color
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.arc(cx, cy, 52, 0, Math.PI * 2)
    ctx.stroke()
  } else if (kind === 'stealth-rock') {
    const rocks: Array<[number, number, number, string]> = [
      [45, 68, 28, color],
      [72, 51, 32, '#dfe3e8'],
      [86, 78, 24, '#66707a'],
      [58, 89, 18, '#aeb5bd'],
    ]
    for (const [x, y, r, fill] of rocks) drawHazardTriangle(ctx, x, y, r, fill)
  } else {
    const gradient = ctx.createRadialGradient(cx, cy + 18, 8, cx, cy, 52)
    gradient.addColorStop(0, 'rgba(255, 184, 77, 0.98)')
    gradient.addColorStop(0.42, color)
    gradient.addColorStop(1, 'rgba(184, 15, 34, 0.1)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(cx, 20)
    ctx.bezierCurveTo(88, 50, 102, 77, 79, 103)
    ctx.bezierCurveTo(66, 118, 38, 107, 34, 83)
    ctx.bezierCurveTo(31, 63, 45, 49, 48, 31)
    ctx.bezierCurveTo(56, 43, 62, 49, 70, 54)
    ctx.bezierCurveTo(75, 42, 72, 31, cx, 20)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(5, 6, 8, 0.72)'
    ctx.lineWidth = 4
    ctx.stroke()
  }

  ctx.fillStyle = 'rgba(247, 247, 242, 0.92)'
  ctx.font = '900 13px Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(MAP_HAZARD_DEFINITIONS[kind].shortLabel, cx, 111)

  return canvas
}

export const getHazardTexture = (kind: MapHazardKind, layer?: number): THREE.CanvasTexture => {
  const normalizedLayer = normalizeMapHazardLayer(kind, layer)
  const key = `${kind}:${normalizedLayer ?? 0}`
  const cached = hazardTextureCache.get(key)
  if (cached) return cached

  const texture = new THREE.CanvasTexture(drawHazardTexture(kind, normalizedLayer))
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.LinearMipMapLinearFilter
  texture.generateMipmaps = true
  hazardTextureCache.set(key, texture)
  return texture
}

export const disposeHazardTextureCache = () => {
  for (const texture of hazardTextureCache.values()) texture.dispose()
  hazardTextureCache.clear()
}

const hazardLayerOffset = (hazard: MapHazardV2, index: number): number => {
  const kindOffset = {
    'spikes': 0,
    'toxic-spikes': 0.008,
    'sticky-web': 0.016,
    'stealth-rock': 0.024,
    'fire': 0.032,
  } satisfies Record<MapHazardKind, number>
  return HAZARD_Y_OFFSET + kindOffset[hazard.kind] + index * 0.001
}

export const createHazardRenderer = (container: THREE.Group): HazardRenderer => {
  const hazardMeshes: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = []
  let visible = true

  const applyObjectVisibility = (object: THREE.Object3D, nextVisible: boolean) => {
    if (object.visible !== nextVisible) object.visible = nextVisible
  }

  return {
    sync(hazards) {
      for (const mesh of hazardMeshes.splice(0)) disposeObject3D(mesh)

      const perCellCount = new Map<string, number>()
      for (const hazard of hazards) {
        const cellKey = `${hazard.x},${hazard.y},${hazard.z}`
        const index = perCellCount.get(cellKey) ?? 0
        perCellCount.set(cellKey, index + 1)

        const geometry = new THREE.PlaneGeometry(0.92, 0.92)
        const material = new THREE.MeshBasicMaterial({
          map: getHazardTexture(hazard.kind, hazard.layer),
          color: 0xffffff,
          transparent: true,
          opacity: 0.94,
          depthTest: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.rotation.x = -Math.PI / 2
        mesh.position.set(
          hazard.x + 0.5,
          hazard.y + hazardLayerOffset(hazard, index),
          hazard.z + 0.5,
        )
        mesh.renderOrder = 12
        applyObjectVisibility(mesh, visible)
        mesh.userData.hazard = hazard
        container.add(mesh)
        hazardMeshes.push(mesh)
      }
    },

    dispose() {
      for (const mesh of hazardMeshes.splice(0)) disposeObject3D(mesh)
    },

    setVisible(nextVisible) {
      if (visible === nextVisible) return

      visible = nextVisible
      applyObjectVisibility(container, nextVisible)
      for (const mesh of hazardMeshes) applyObjectVisibility(mesh, nextVisible)
    },

    meshes() {
      return [...hazardMeshes]
    },
  }
}
