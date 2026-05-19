import type { MoveAutomationAreaDirection } from '~/types/moveAutomation'

export interface MoveAutomationAreaAimPoint {
  x: number
  z: number
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

  return DIRECTIONS_BY_OCTANT[normalizedOctantIndex(Math.atan2(delta.z, delta.x))]
}

export const moveAutomationAreaDirectionFromPoint = (
  origin: MoveAutomationAreaAimPoint,
  point: MoveAutomationAreaAimPoint,
  deadZone = POINTER_AIM_DEAD_ZONE,
): MoveAutomationAreaDirection | null => moveAutomationAreaDirectionFromDelta({
  x: point.x - origin.x,
  z: point.z - origin.z,
}, deadZone)
