export interface WorldSpriteFacingVector2 {
  x: number
  z: number
}

export interface WorldSpriteFacingDirection {
  x: number
  y: number
}

export interface WorldSpriteFacingInput {
  cameraPosition?: WorldSpriteFacingVector2 | null
  center: WorldSpriteFacingVector2
  facingDirection: WorldSpriteFacingDirection
  turned?: boolean
}

export type WorldSpriteFacingAsset = 'front' | 'back'

export interface WorldSpriteFacingView {
  readonly asset: WorldSpriteFacingAsset
  readonly mirrorX: boolean
}

const FRONT_VIEW: WorldSpriteFacingView = { asset: 'front', mirrorX: false }
const BACK_VIEW: WorldSpriteFacingView = { asset: 'back', mirrorX: false }
const FRONT_MIRRORED_VIEW: WorldSpriteFacingView = { asset: 'front', mirrorX: true }
const BACK_MIRRORED_VIEW: WorldSpriteFacingView = { asset: 'back', mirrorX: true }
// Split the camera circle into four 90° sectors. The side sectors reuse
// the available front/back art mirrored horizontally to approximate the
// missing left/right three-quarter views.
const DIAGONAL_VIEW_THRESHOLD = Math.SQRT1_2

const normalizeFacingDirection = (
  facingDirection: WorldSpriteFacingDirection,
  turned: boolean,
): WorldSpriteFacingDirection | null => {
  const turnScalar = turned ? -1 : 1
  const x = facingDirection.x * turnScalar
  const y = facingDirection.y * turnScalar
  const length = Math.hypot(x, y)
  if (length === 0) return null
  return { x: x / length, y: y / length }
}

export const resolveWorldSpriteFacing = ({
  cameraPosition,
  center,
  facingDirection,
  turned = false,
}: WorldSpriteFacingInput): WorldSpriteFacingView => {
  if (!cameraPosition) return FRONT_VIEW

  const toCameraX = cameraPosition.x - center.x
  const toCameraZ = cameraPosition.z - center.z
  const distance = Math.hypot(toCameraX, toCameraZ)
  if (distance === 0) return FRONT_VIEW

  const facing = normalizeFacingDirection(facingDirection, turned)
  if (!facing) return FRONT_VIEW

  const cameraX = toCameraX / distance
  const cameraZ = toCameraZ / distance
  const dot = facing.x * cameraX + facing.y * cameraZ

  if (dot >= DIAGONAL_VIEW_THRESHOLD) return FRONT_VIEW
  if (dot <= -DIAGONAL_VIEW_THRESHOLD) return BACK_VIEW

  const cross = facing.x * cameraZ - facing.y * cameraX
  return cross < 0 ? FRONT_MIRRORED_VIEW : BACK_MIRRORED_VIEW
}

export const shouldUseFrontWorldSprite = (input: WorldSpriteFacingInput): boolean =>
  resolveWorldSpriteFacing(input).asset === 'front'
