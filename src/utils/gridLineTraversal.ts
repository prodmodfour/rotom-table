import type { GridAnchor } from '~/types/pokemon'

export const gridCellKey = (cell: GridAnchor): string =>
  `${cell.x},${cell.y},${cell.z}`

/**
 * Return the grid cells crossed by a segment between two cell centres.
 *
 * This is the shared, renderer-independent 3D DDA used by authoritative
 * geometry. When a segment crosses multiple axis boundaries at the same time,
 * it advances those axes together; this preserves the diagonal/corner policy
 * already used by move-area line-of-effect geometry.
 */
export const gridCellsBetweenCellCenters = (
  from: GridAnchor,
  to: GridAnchor,
): GridAnchor[] => {
  const current: GridAnchor = { ...from }
  const target: GridAnchor = { ...to }
  const cells: GridAnchor[] = [{ ...current }]
  if (current.x === target.x && current.y === target.y && current.z === target.z) {
    return cells
  }

  const start = { x: from.x + 0.5, y: from.y + 0.5, z: from.z + 0.5 }
  const end = { x: to.x + 0.5, y: to.y + 0.5, z: to.z + 0.5 }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const dz = end.z - start.z
  const stepX = Math.sign(dx)
  const stepY = Math.sign(dy)
  const stepZ = Math.sign(dz)
  const tDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dx)
  const tDeltaY = stepY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dy)
  const tDeltaZ = stepZ === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dz)
  let tMaxX = stepX === 0
    ? Number.POSITIVE_INFINITY
    : stepX > 0
      ? (from.x + 1 - start.x) / dx
      : (start.x - from.x) / -dx
  let tMaxY = stepY === 0
    ? Number.POSITIVE_INFINITY
    : stepY > 0
      ? (from.y + 1 - start.y) / dy
      : (start.y - from.y) / -dy
  let tMaxZ = stepZ === 0
    ? Number.POSITIVE_INFINITY
    : stepZ > 0
      ? (from.z + 1 - start.z) / dz
      : (start.z - from.z) / -dz
  const epsilon = 1e-9
  const guardLimit = Math.abs(target.x - current.x)
    + Math.abs(target.y - current.y)
    + Math.abs(target.z - current.z)
    + 3
  let guard = 0

  while (
    (current.x !== target.x || current.y !== target.y || current.z !== target.z)
    && guard < guardLimit
  ) {
    const nextT = Math.min(tMaxX, tMaxY, tMaxZ)
    if (tMaxX <= nextT + epsilon) {
      current.x += stepX
      tMaxX += tDeltaX
    }
    if (tMaxY <= nextT + epsilon) {
      current.y += stepY
      tMaxY += tDeltaY
    }
    if (tMaxZ <= nextT + epsilon) {
      current.z += stepZ
      tMaxZ += tDeltaZ
    }
    cells.push({ ...current })
    guard += 1
  }

  return cells
}
