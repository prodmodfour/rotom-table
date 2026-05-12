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

export const shouldUseFrontWorldSprite = ({
  cameraPosition,
  center,
  facingDirection,
  turned = false,
}: WorldSpriteFacingInput): boolean => {
  if (!cameraPosition) return true

  const toCameraX = cameraPosition.x - center.x
  const toCameraZ = cameraPosition.z - center.z
  const distanceSquared = toCameraX * toCameraX + toCameraZ * toCameraZ
  if (distanceSquared === 0) return true

  const distance = Math.sqrt(distanceSquared)
  const turnScalar = turned ? -1 : 1
  const facingX = facingDirection.x * turnScalar
  const facingZ = facingDirection.y * turnScalar
  const dot = facingX * (toCameraX / distance) + facingZ * (toCameraZ / distance)

  return dot >= 0
}
