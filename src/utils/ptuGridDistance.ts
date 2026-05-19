import { getClearanceValue, type PositionedGridFootprint } from '~/utils/gridGeometry'

export type PtuGridFootprint = Pick<PositionedGridFootprint, 'position' | 'base' | 'clearance'>

const normalizedStepCount = (value: number): number => Math.max(0, Math.floor(Math.abs(value)))

/**
 * PTU diagonal movement alternates costs: 1m for the first diagonal square,
 * 2m for the second, then 1m, then 2m, and so on.
 * See `books/markdown/core/07-combat.md`; Lines explicitly reuse this rule in
 * `books/markdown/core/10-indices-and-reference.md`.
 */
export const ptuAlternatingDiagonalDistance = (diagonalSteps: number): number => {
  const steps = normalizedStepCount(diagonalSteps)
  return steps + Math.floor(steps / 2)
}

export const ptuGridVectorDistance = (delta: { x: number; y?: number; z: number }): number => {
  const axes = [
    normalizedStepCount(delta.x),
    normalizedStepCount(delta.y ?? 0),
    normalizedStepCount(delta.z),
  ].sort((left, right) => right - left)

  return axes[0] + Math.floor(axes[1] / 2)
}

const axisSeparationDistance = (
  leftStart: number,
  leftSize: number,
  rightStart: number,
  rightSize: number,
): number => {
  if (leftStart <= rightStart) {
    const gap = rightStart - (leftStart + leftSize)
    return gap >= 0 ? gap + 1 : 0
  }

  const gap = leftStart - (rightStart + rightSize)
  return gap >= 0 ? gap + 1 : 0
}

export const ptuGridDistanceBetweenFootprints = (
  left: PtuGridFootprint,
  right: PtuGridFootprint,
): number => ptuGridVectorDistance({
  x: axisSeparationDistance(left.position.x, left.base, right.position.x, right.base),
  y: axisSeparationDistance(left.position.y, getClearanceValue(left), right.position.y, getClearanceValue(right)),
  z: axisSeparationDistance(left.position.z, left.base, right.position.z, right.base),
})
