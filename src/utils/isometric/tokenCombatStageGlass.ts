import * as THREE from 'three'
import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'
import { clampCombatStage } from '~/utils/combatStages'
import { disposeObject3D } from '~/utils/isometric/resourceDisposal'

interface TokenCombatStageGlassSlot {
  key: CombatStageKey
  label: string
  row: number
  column: number
}

export interface TokenCombatStageGlassSlotValue extends TokenCombatStageGlassSlot {
  value: number
  visible: boolean
}

export interface TokenCombatStageGlass {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  texture: THREE.CanvasTexture
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  renderedKey: string
  active: boolean
}

const GLASS_CANVAS_WIDTH = 256
const GLASS_CANVAS_HEIGHT = 192
const GLASS_ASPECT = GLASS_CANVAS_WIDTH / GLASS_CANVAS_HEIGHT
const GLASS_WIDTH_FACTOR = 0.94
const GLASS_HEIGHT_FACTOR = 0.82
const GLASS_FRONT_OFFSET = 0.014
const GLASS_RENDER_ORDER = 8

const SLOT_MARGIN_X = 10
const SLOT_MARGIN_Y = 18
const SLOT_VALUE_GAP = 5
const TOKEN_COMBAT_STAGE_FONT_FAMILY = '"Atkinson Hyperlegible", Inter, Arial, sans-serif'
const SLOT_LABEL_FONT = `900 24px ${TOKEN_COMBAT_STAGE_FONT_FAMILY}`
const SLOT_VALUE_FONT = `900 28px ${TOKEN_COMBAT_STAGE_FONT_FAMILY}`
const SLOT_LABEL_COLOR = '#f7f7f2'
const SLOT_POSITIVE_COLOR = '#7cff4f'
const SLOT_NEGATIVE_COLOR = '#ff554a'
const SLOT_OUTLINE_COLOR = 'rgba(0, 0, 0, 0.98)'
const SLOT_LABEL_OUTLINE_WIDTH = 5
const SLOT_VALUE_OUTLINE_WIDTH = 5

const fallbackFrontNormal = new THREE.Vector3(1, 0, 1).normalize()
const reusableFrontNormal = new THREE.Vector3()

// Fixed row/column positions: zero-valued stages render as empty glass so
// visible stages never slide into another stat's spot.
export const TOKEN_COMBAT_STAGE_GLASS_SLOTS = [
  { key: 'acc', label: 'ACC', row: 0, column: 0 },
  { key: 'atk', label: 'ATK', row: 0, column: 1 },
  { key: 'def', label: 'DEF', row: 1, column: 0 },
  { key: 'satk', label: 'SATK', row: 1, column: 1 },
  { key: 'sdef', label: 'SDEF', row: 2, column: 0 },
  { key: 'spd', label: 'SPD', row: 2, column: 1 },
] as const satisfies readonly TokenCombatStageGlassSlot[]

export const formatCombatStageGlassValue = (value: unknown): string => {
  const normalized = clampCombatStage(value)
  return normalized > 0 ? `+${normalized}` : String(normalized)
}

export const tokenCombatStageGlassSlotValues = (stages: CombatStageMap): TokenCombatStageGlassSlotValue[] =>
  TOKEN_COMBAT_STAGE_GLASS_SLOTS.map((slot) => {
    const value = clampCombatStage(stages[slot.key])
    return {
      ...slot,
      value,
      visible: value !== 0,
    }
  })

export const tokenCombatStageGlassHasActiveValues = (stages: CombatStageMap): boolean =>
  tokenCombatStageGlassSlotValues(stages).some((slot) => slot.visible)

export const tokenCombatStageGlassTextureKey = (stages: CombatStageMap): string =>
  tokenCombatStageGlassSlotValues(stages)
    .map((slot) => `${slot.key}:${slot.value}`)
    .join('|')

const drawOutlinedText = (
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: {
    font: string
    fill: string
    lineWidth: number
  },
) => {
  context.font = options.font
  context.lineWidth = options.lineWidth
  context.strokeStyle = SLOT_OUTLINE_COLOR
  context.fillStyle = options.fill
  context.strokeText(text, x, y)
  context.fillText(text, x, y)
}

const drawCombatStageSlot = (
  context: CanvasRenderingContext2D,
  slot: TokenCombatStageGlassSlotValue,
) => {
  if (!slot.visible) return

  const columnWidth = (GLASS_CANVAS_WIDTH - SLOT_MARGIN_X * 2) / 2
  const rowHeight = (GLASS_CANVAS_HEIGHT - SLOT_MARGIN_Y * 2) / 3
  const centerX = SLOT_MARGIN_X + columnWidth * (slot.column + 0.5)
  const centerY = SLOT_MARGIN_Y + rowHeight * (slot.row + 0.5)
  const valueText = formatCombatStageGlassValue(slot.value)

  context.font = SLOT_LABEL_FONT
  const labelWidth = context.measureText(slot.label).width
  context.font = SLOT_VALUE_FONT
  const valueWidth = context.measureText(valueText).width
  const textStartX = centerX - (labelWidth + SLOT_VALUE_GAP + valueWidth) / 2
  const valueStartX = textStartX + labelWidth + SLOT_VALUE_GAP

  drawOutlinedText(context, slot.label, textStartX, centerY, {
    font: SLOT_LABEL_FONT,
    fill: SLOT_LABEL_COLOR,
    lineWidth: SLOT_LABEL_OUTLINE_WIDTH,
  })
  drawOutlinedText(context, valueText, valueStartX, centerY, {
    font: SLOT_VALUE_FONT,
    fill: slot.value > 0 ? SLOT_POSITIVE_COLOR : SLOT_NEGATIVE_COLOR,
    lineWidth: SLOT_VALUE_OUTLINE_WIDTH,
  })
}

const renderTokenCombatStageGlassTexture = (
  glass: TokenCombatStageGlass,
  stages: CombatStageMap,
) => {
  const { context } = glass
  context.clearRect(0, 0, GLASS_CANVAS_WIDTH, GLASS_CANVAS_HEIGHT)
  context.textAlign = 'left'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  context.lineCap = 'round'
  context.miterLimit = 2

  for (const slot of tokenCombatStageGlassSlotValues(stages)) {
    drawCombatStageSlot(context, slot)
  }

  glass.texture.needsUpdate = true
}

const getTokenCombatStageGlassFrontNormal = (
  center: THREE.Vector3,
  camera: THREE.Camera | null,
): THREE.Vector3 => {
  if (!camera) return fallbackFrontNormal

  reusableFrontNormal.set(
    camera.position.x - center.x,
    0,
    camera.position.z - center.z,
  )

  return reusableFrontNormal.lengthSq() > 0.000001
    ? reusableFrontNormal.normalize()
    : fallbackFrontNormal
}

const tokenCombatStageGlassSize = (base: number, clearance: number) => {
  const maxWidth = Math.max(0.05, base * GLASS_WIDTH_FACTOR)
  const maxHeight = Math.max(0.05, clearance * GLASS_HEIGHT_FACTOR)
  const width = Math.min(maxWidth, maxHeight * GLASS_ASPECT)
  return {
    width,
    height: width / GLASS_ASPECT,
  }
}

export const buildTokenCombatStageGlass = (): TokenCombatStageGlass => {
  const canvas = document.createElement('canvas')
  canvas.width = GLASS_CANVAS_WIDTH
  canvas.height = GLASS_CANVAS_HEIGHT

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create token combat stage glass canvas')

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    alphaTest: 0.02,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
  mesh.renderOrder = GLASS_RENDER_ORDER
  mesh.visible = false

  return {
    mesh,
    texture,
    canvas,
    context,
    renderedKey: '',
    active: false,
  }
}

export const updateTokenCombatStageGlass = ({
  glass,
  center,
  base,
  clearance,
  stages,
  camera,
  show = true,
}: {
  glass: TokenCombatStageGlass
  center: THREE.Vector3
  base: number
  clearance: number
  stages: CombatStageMap
  camera: THREE.Camera | null
  show?: boolean
}) => {
  const active = tokenCombatStageGlassHasActiveValues(stages)
  glass.active = active

  if (!show || !active) {
    glass.mesh.visible = false
    return
  }

  const textureKey = tokenCombatStageGlassTextureKey(stages)
  if (glass.renderedKey !== textureKey) {
    renderTokenCombatStageGlassTexture(glass, stages)
    glass.renderedKey = textureKey
  }

  const frontNormal = getTokenCombatStageGlassFrontNormal(center, camera)
  const size = tokenCombatStageGlassSize(base, clearance)
  glass.mesh.scale.set(size.width, size.height, 1)
  glass.mesh.rotation.set(0, Math.atan2(frontNormal.x, frontNormal.z), 0)
  glass.mesh.position.set(
    center.x + frontNormal.x * (base / 2 + GLASS_FRONT_OFFSET),
    center.y + clearance * 0.52,
    center.z + frontNormal.z * (base / 2 + GLASS_FRONT_OFFSET),
  )
  glass.mesh.visible = true
}

export const disposeTokenCombatStageGlass = (glass: TokenCombatStageGlass) => {
  glass.texture.dispose()
  disposeObject3D(glass.mesh)
}
