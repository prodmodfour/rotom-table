import {
  MOVE_AUTOMATION_AREA_DIRECTIONS,
  type MoveAutomationAreaDirection,
} from '~/types/moveAutomation'
import type { GridAnchor } from '~/types/pokemon'
import { ptuAlternatingDiagonalDistance } from '~/utils/ptuGridDistance'

export interface MoveAutomationAreaDirectionDefinition {
  readonly id: MoveAutomationAreaDirection
  readonly label: string
  readonly dx: -1 | 0 | 1
  readonly dy: -1 | 0 | 1
  readonly dz: -1 | 0 | 1
}

export interface MoveAutomationAreaDirectionVector {
  readonly x: -1 | 0 | 1
  readonly y: -1 | 0 | 1
  readonly z: -1 | 0 | 1
}

export interface MoveAutomationPassDirectionStep {
  readonly index: number
  readonly position: GridAnchor
  /** PTU alternating-diagonal distance from the starting anchor. */
  readonly distance: number
}

const DIRECTION_METADATA: Record<
  MoveAutomationAreaDirection,
  Omit<MoveAutomationAreaDirectionDefinition, 'id'>
> = {
  north: { label: 'north', dx: 0, dy: 0, dz: -1 },
  'north-east': { label: 'north-east', dx: 1, dy: 0, dz: -1 },
  east: { label: 'east', dx: 1, dy: 0, dz: 0 },
  'south-east': { label: 'south-east', dx: 1, dy: 0, dz: 1 },
  south: { label: 'south', dx: 0, dy: 0, dz: 1 },
  'south-west': { label: 'south-west', dx: -1, dy: 0, dz: 1 },
  west: { label: 'west', dx: -1, dy: 0, dz: 0 },
  'north-west': { label: 'north-west', dx: -1, dy: 0, dz: -1 },
  up: { label: 'up', dx: 0, dy: 1, dz: 0 },
  down: { label: 'down', dx: 0, dy: -1, dz: 0 },
}

export const MOVE_AUTOMATION_AREA_DIRECTION_DEFINITIONS: readonly MoveAutomationAreaDirectionDefinition[] = (
  MOVE_AUTOMATION_AREA_DIRECTIONS.map(id => ({ id, ...DIRECTION_METADATA[id] }))
)

export const moveAutomationAreaDirectionDefinition = (
  direction: MoveAutomationAreaDirection | undefined,
): MoveAutomationAreaDirectionDefinition | null => (
  MOVE_AUTOMATION_AREA_DIRECTION_DEFINITIONS.find(item => item.id === direction) ?? null
)

export const moveAutomationAreaDirectionVector = (
  direction: MoveAutomationAreaDirection,
): MoveAutomationAreaDirectionVector | null => {
  const definition = moveAutomationAreaDirectionDefinition(direction)
  return definition
    ? { x: definition.dx, y: definition.dy, z: definition.dz }
    : null
}

export const moveAutomationDirectionStepDistance = (
  step: number,
  direction: MoveAutomationAreaDirectionDefinition,
): number => direction.dx !== 0 && direction.dz !== 0
  ? ptuAlternatingDiagonalDistance(step)
  : step

const offsetPosition = (
  origin: GridAnchor,
  direction: MoveAutomationAreaDirectionDefinition,
  step: number,
): GridAnchor => ({
  x: origin.x + direction.dx * step,
  y: origin.y + direction.dy * step,
  z: origin.z + direction.dz * step,
})

/** Enumerate straight-line Pass geometry without deciding movement legality. */
export const buildMoveAutomationPassDirectionSteps = (options: {
  readonly origin: GridAnchor
  readonly direction: MoveAutomationAreaDirection
  readonly maximumDistance: number
}): MoveAutomationPassDirectionStep[] => {
  const direction = moveAutomationAreaDirectionDefinition(options.direction)
  if (!direction || !Number.isSafeInteger(options.maximumDistance) || options.maximumDistance <= 0) return []

  const steps: MoveAutomationPassDirectionStep[] = []
  for (
    let index = 1;
    moveAutomationDirectionStepDistance(index, direction) <= options.maximumDistance;
    index += 1
  ) {
    steps.push({
      index,
      position: offsetPosition(options.origin, direction, index),
      distance: moveAutomationDirectionStepDistance(index, direction),
    })
  }
  return steps
}
