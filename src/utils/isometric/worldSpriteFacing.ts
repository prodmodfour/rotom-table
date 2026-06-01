export interface WorldSpriteFacingVector2 {
  x: number
  z: number
}

export interface WorldSpriteFacingDirection {
  x: number
  y: number
}

export interface WorldSpriteFacingInput {
  /**
   * Absolute camera position. Kept as a fallback for callers that do not have
   * a projected camera direction available.
   */
  cameraPosition?: WorldSpriteFacingVector2 | null
  /**
   * XZ direction from the sprite toward the camera. Prefer this for
   * orthographic cameras because every sprite shares the same view direction.
   */
  toCameraDirection?: WorldSpriteFacingVector2 | null
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
// missing left/right three-quarter views. Keep the side sectors ordered so
// rotating a default-camera-facing token visually progresses through:
// front -> mirrored front -> back -> mirrored back.
const DIAGONAL_VIEW_THRESHOLD = Math.SQRT1_2

const DIAGONAL_VIEW_THRESHOLD_EPSILON = 1e-9

type NormalizedWorldSpriteFacingDirection = Readonly<WorldSpriteFacingDirection>

const normalizeFacingDirection = (
  facingDirection: WorldSpriteFacingDirection,
  turned: boolean,
): NormalizedWorldSpriteFacingDirection | null => {
  const turnScalar = turned ? -1 : 1
  const x = facingDirection.x * turnScalar
  const y = facingDirection.y * turnScalar
  const length = Math.hypot(x, y)
  if (length === 0) return null
  return { x: x / length, y: y / length }
}

const normalizeXzDirection = (
  direction: WorldSpriteFacingVector2 | null | undefined,
): NormalizedWorldSpriteFacingDirection | null => {
  if (!direction) return null
  const length = Math.hypot(direction.x, direction.z)
  if (length === 0) return null
  return { x: direction.x / length, y: direction.z / length }
}

const resolveToCameraDirection = (
  toCameraDirection: WorldSpriteFacingVector2 | null | undefined,
  cameraPosition: WorldSpriteFacingVector2 | null | undefined,
  center: WorldSpriteFacingVector2,
): NormalizedWorldSpriteFacingDirection | null => {
  const projectedDirection = normalizeXzDirection(toCameraDirection)
  if (projectedDirection) return projectedDirection
  if (!cameraPosition) return null
  return normalizeXzDirection({
    x: cameraPosition.x - center.x,
    z: cameraPosition.z - center.z,
  })
}

export const resolveWorldSpriteFacing = ({
  cameraPosition,
  toCameraDirection,
  center,
  facingDirection,
  turned = false,
}: WorldSpriteFacingInput): WorldSpriteFacingView => {
  const camera = resolveToCameraDirection(toCameraDirection, cameraPosition, center)
  if (!camera) return FRONT_VIEW

  const facing = normalizeFacingDirection(facingDirection, turned)
  if (!facing) return FRONT_VIEW

  const dot = facing.x * camera.x + facing.y * camera.y

  if (dot > DIAGONAL_VIEW_THRESHOLD + DIAGONAL_VIEW_THRESHOLD_EPSILON) return FRONT_VIEW
  if (dot < -DIAGONAL_VIEW_THRESHOLD - DIAGONAL_VIEW_THRESHOLD_EPSILON) return BACK_VIEW

  const cross = facing.x * camera.y - facing.y * camera.x
  return cross > 0 ? FRONT_MIRRORED_VIEW : BACK_MIRRORED_VIEW
}

export const worldSpriteMirrorXForAvailableAsset = (
  view: WorldSpriteFacingView,
  hasBackSprite: boolean,
): boolean => {
  if (hasBackSprite || view.asset === 'front') return view.mirrorX
  return !view.mirrorX
}

export const shouldUseFrontWorldSprite = (input: WorldSpriteFacingInput): boolean =>
  resolveWorldSpriteFacing(input).asset === 'front'
