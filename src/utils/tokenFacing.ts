import type { MoveAutomationAreaDirection } from '~/types/moveAutomation'
import type { TokenFacingDirection } from '~/types/tokenFacing'

export const DEFAULT_TOKEN_FACING_DIRECTION: TokenFacingDirection = 'south-east'

// Isometric diagonals in 90° rotation order. Front art maps to
// south-east, back art maps to north-west; the other two directions
// are rendered by mirroring. The first rotation uses back art so the
// control gives visible feedback even for mostly-symmetric front sprites.
export const TOKEN_FACING_DIRECTIONS = [
  'south-east',
  'north-east',
  'north-west',
  'south-west',
] as const satisfies readonly TokenFacingDirection[]

type TokenFacingVector = Readonly<{ x: number; y: number }>

export interface TokenFacingPoint {
  x: number
  z: number
}

export interface TokenFacingDelta {
  dx: number
  dz: number
}

export interface MutableTokenFacingPlacement {
  facing?: TokenFacingDirection
  turned?: boolean
}

const TOKEN_FACING_DIRECTION_SET = new Set<string>(TOKEN_FACING_DIRECTIONS)

const TOKEN_FACING_VECTORS: Record<TokenFacingDirection, TokenFacingVector> = {
  'south-east': { x: 1, y: 1 },
  'south-west': { x: -1, y: 1 },
  'north-west': { x: -1, y: -1 },
  'north-east': { x: 1, y: -1 },
}

export const isTokenFacingDirection = (value: unknown): value is TokenFacingDirection =>
  typeof value === 'string' && TOKEN_FACING_DIRECTION_SET.has(value)

export const legacyTokenFacingFromTurned = (turned: unknown): TokenFacingDirection =>
  turned === true ? 'north-west' : DEFAULT_TOKEN_FACING_DIRECTION

export const tokenFacingForPlacement = (placement: {
  facing?: unknown
  turned?: unknown
}): TokenFacingDirection =>
  isTokenFacingDirection(placement.facing)
    ? placement.facing
    : legacyTokenFacingFromTurned(placement.turned)

export const tokenFacingStoresLegacyTurned = (facing: TokenFacingDirection): boolean =>
  facing === 'north-west'

export const nextTokenFacingDirection = (facing: TokenFacingDirection): TokenFacingDirection => {
  const index = TOKEN_FACING_DIRECTIONS.indexOf(facing)
  return TOKEN_FACING_DIRECTIONS[(index + 1) % TOKEN_FACING_DIRECTIONS.length]
}

export const nextTokenFacingForPlacement = (placement: {
  facing?: unknown
  turned?: unknown
}): TokenFacingDirection =>
  nextTokenFacingDirection(tokenFacingForPlacement(placement))

export const tokenFacingVector = (facing: TokenFacingDirection): TokenFacingVector =>
  TOKEN_FACING_VECTORS[facing]

const TOKEN_FACING_BY_SIGNS: Record<`${-1 | 1},${-1 | 1}`, TokenFacingDirection> = {
  '1,1': 'south-east',
  '-1,1': 'south-west',
  '-1,-1': 'north-west',
  '1,-1': 'north-east',
}

const AREA_DIRECTION_DELTAS: Partial<Record<MoveAutomationAreaDirection, TokenFacingDelta>> = {
  north: { dx: 0, dz: -1 },
  'north-east': { dx: 1, dz: -1 },
  east: { dx: 1, dz: 0 },
  'south-east': { dx: 1, dz: 1 },
  south: { dx: 0, dz: 1 },
  'south-west': { dx: -1, dz: 1 },
  west: { dx: -1, dz: 0 },
  'north-west': { dx: -1, dz: -1 },
}

const axisSign = (value: number): -1 | 1 => value < 0 ? -1 : 1

const cardinalTokenFacingSigns = (delta: TokenFacingDelta): { x: -1 | 1; z: -1 | 1 } | null => {
  if (delta.dx === 0 && delta.dz === 0) return null

  if (delta.dx === 0) {
    const z = axisSign(delta.dz)
    return { x: z, z }
  }

  if (delta.dz === 0) {
    const x = axisSign(delta.dx)
    return { x, z: x > 0 ? -1 : 1 }
  }

  return null
}

export const tokenFacingFromDelta = (
  delta: TokenFacingDelta,
  _currentFacing: TokenFacingDirection = DEFAULT_TOKEN_FACING_DIRECTION,
): TokenFacingDirection | null => {
  const cardinalSigns = cardinalTokenFacingSigns(delta)
  if (cardinalSigns) return TOKEN_FACING_BY_SIGNS[`${cardinalSigns.x},${cardinalSigns.z}`]
  if (delta.dx === 0 && delta.dz === 0) return null

  const x = axisSign(delta.dx)
  const z = axisSign(delta.dz)
  return TOKEN_FACING_BY_SIGNS[`${x},${z}`]
}

export const tokenFacingTowardPoint = (
  from: TokenFacingPoint,
  to: TokenFacingPoint,
  currentFacing: TokenFacingDirection = DEFAULT_TOKEN_FACING_DIRECTION,
): TokenFacingDirection | null => tokenFacingFromDelta({
  dx: to.x - from.x,
  dz: to.z - from.z,
}, currentFacing)

export const tokenFacingFromAreaDirection = (
  direction: MoveAutomationAreaDirection,
  currentFacing: TokenFacingDirection = DEFAULT_TOKEN_FACING_DIRECTION,
): TokenFacingDirection | null => {
  const delta = AREA_DIRECTION_DELTAS[direction]
  return delta ? tokenFacingFromDelta(delta, currentFacing) : null
}

export const setTokenFacingOnPlacement = (
  placement: MutableTokenFacingPlacement,
  facing: TokenFacingDirection,
): void => {
  placement.facing = facing
  placement.turned = tokenFacingStoresLegacyTurned(facing)
}

export const tokenFacingAreaDirection = (facing: TokenFacingDirection): MoveAutomationAreaDirection =>
  facing
