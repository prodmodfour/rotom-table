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

export const tokenFacingAreaDirection = (facing: TokenFacingDirection): MoveAutomationAreaDirection =>
  facing
