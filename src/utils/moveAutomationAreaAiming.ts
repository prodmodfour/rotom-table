import type { MoveAutomationAreaDirection } from '~/types/moveAutomation'

export interface MoveAutomationAreaAimPoint {
  x: number
  z: number
}

export interface MoveAutomationAreaDirectionUpdateThrottle {
  currentRequestedDirection: () => MoveAutomationAreaDirection | null
  syncCurrentDirection: (direction: MoveAutomationAreaDirection | null | undefined) => void
  shouldEmitDirection: (
    direction: MoveAutomationAreaDirection | null | undefined,
    currentDirection?: MoveAutomationAreaDirection | null,
  ) => boolean
  reset: () => void
}

const OCTANT_RADIANS = Math.PI / 4
const POINTER_AIM_DEAD_ZONE = 0.25

const DIRECTIONS_BY_OCTANT: readonly MoveAutomationAreaDirection[] = [
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
  'north',
  'north-east',
]

const normalizedOctantIndex = (angleRadians: number): number => {
  const rounded = Math.round(angleRadians / OCTANT_RADIANS)
  return ((rounded % DIRECTIONS_BY_OCTANT.length) + DIRECTIONS_BY_OCTANT.length) % DIRECTIONS_BY_OCTANT.length
}

export const moveAutomationAreaDirectionFromDelta = (
  delta: MoveAutomationAreaAimPoint,
  deadZone = POINTER_AIM_DEAD_ZONE,
): MoveAutomationAreaDirection | null => {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.z)) return null
  if (Math.hypot(delta.x, delta.z) < deadZone) return null

  return DIRECTIONS_BY_OCTANT[normalizedOctantIndex(Math.atan2(delta.z, delta.x))] ?? null
}

export const moveAutomationAreaDirectionFromPoint = (
  origin: MoveAutomationAreaAimPoint,
  point: MoveAutomationAreaAimPoint,
  deadZone = POINTER_AIM_DEAD_ZONE,
): MoveAutomationAreaDirection | null => moveAutomationAreaDirectionFromDelta({
  x: point.x - origin.x,
  z: point.z - origin.z,
}, deadZone)

const normalizeMoveAutomationAreaDirection = (
  direction: MoveAutomationAreaDirection | null | undefined,
): MoveAutomationAreaDirection | null => direction ?? null

export const createMoveAutomationAreaDirectionUpdateThrottle = (
  initialDirection?: MoveAutomationAreaDirection | null,
): MoveAutomationAreaDirectionUpdateThrottle => {
  let lastRequestedDirection = normalizeMoveAutomationAreaDirection(initialDirection)

  const syncCurrentDirection = (direction: MoveAutomationAreaDirection | null | undefined) => {
    lastRequestedDirection = normalizeMoveAutomationAreaDirection(direction)
  }

  return {
    currentRequestedDirection: () => lastRequestedDirection,
    syncCurrentDirection,
    shouldEmitDirection: (direction, currentDirection) => {
      const nextDirection = normalizeMoveAutomationAreaDirection(direction)
      if (!nextDirection) return false

      const appliedDirection = normalizeMoveAutomationAreaDirection(currentDirection)
      if (nextDirection === appliedDirection || nextDirection === lastRequestedDirection) return false

      lastRequestedDirection = nextDirection
      return true
    },
    reset: () => syncCurrentDirection(null),
  }
}
