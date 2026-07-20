import type { GridAnchor } from '~/types/map'
import { isSameAnchor } from '~/utils/gridGeometry'

export interface PendingTokenMovementPath {
  readonly destination: GridAnchor
  readonly path: readonly GridAnchor[]
}

export interface PendingTokenMovementPathAdvance {
  readonly animationPath?: readonly GridAnchor[]
  readonly remaining: PendingTokenMovementPath | null
}

const cloneAnchor = (anchor: GridAnchor): GridAnchor => ({
  x: anchor.x,
  y: anchor.y,
  z: anchor.z,
})

const clonePath = (path: readonly GridAnchor[]): GridAnchor[] => path.map(cloneAnchor)
const immutablePath = (path: readonly GridAnchor[]): readonly GridAnchor[] => Object.freeze(
  clonePath(path).map(anchor => Object.freeze(anchor)),
)

export const createPendingTokenMovementPath = (input: {
  readonly destination: GridAnchor
  readonly path: readonly GridAnchor[] | null | undefined
}): PendingTokenMovementPath | null => {
  const path = input.path ?? []
  const finalAnchor = path[path.length - 1]
  if (path.length < 2 || !finalAnchor || !isSameAnchor(finalAnchor, input.destination)) return null
  return Object.freeze({
    destination: Object.freeze(cloneAnchor(input.destination)),
    path: immutablePath(path),
  })
}

/**
 * Consume only the newly authoritative prefix. A pre-step interruption keeps
 * the suffix so resumed movement can continue forward instead of replaying or
 * reversing the original route.
 */
export const advancePendingTokenMovementPath = (
  pending: PendingTokenMovementPath,
  authoritativePosition: GridAnchor,
): PendingTokenMovementPathAdvance => {
  const index = pending.path.findIndex(anchor => isSameAnchor(anchor, authoritativePosition))
  if (index < 0) return { remaining: null }

  if (isSameAnchor(authoritativePosition, pending.destination)) {
    return {
      animationPath: immutablePath(pending.path),
      remaining: null,
    }
  }

  // The authoritative token has not advanced beyond the current checkpoint.
  // Retain the route without starting a no-op presentation track.
  if (index === 0) return { remaining: pending }

  const prefix = pending.path.slice(0, index + 1)
  const suffix = pending.path.slice(index)
  return {
    animationPath: immutablePath(prefix),
    remaining: Object.freeze({
      destination: Object.freeze(cloneAnchor(pending.destination)),
      path: immutablePath(suffix),
    }),
  }
}
