import type { GridDimensions } from '~/types/pokemon'

export const maxGroundLevelY = (height: unknown): number => {
  const numericHeight = Number(height)
  return Number.isFinite(numericHeight) ? Math.max(0, Math.floor(numericHeight) - 1) : 0
}

export const clampMapGroundLevelY = (
  dimensions: Pick<GridDimensions, 'y'>,
  groundLevelY: unknown,
): number => {
  const n = Number(groundLevelY ?? 0)
  if (!Number.isFinite(n)) return 0
  return Math.min(maxGroundLevelY(dimensions.y), Math.max(0, Math.round(n)))
}

export const mapSpecificYBounds = (dimensions: Pick<GridDimensions, 'y'>, groundLevelY: unknown) => {
  const ground = clampMapGroundLevelY(dimensions, groundLevelY)
  const height = Number(dimensions.y)
  const maxAbsoluteY = Number.isFinite(height) ? Math.max(0, Math.floor(height) - 1) : 0
  return {
    groundLevelY: ground,
    min: ground === 0 ? 0 : -ground,
    max: maxAbsoluteY - ground,
  }
}
