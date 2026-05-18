import type { GridAnchor } from '~/types/map'

export interface MovementLogEntry {
  at: number
  userId: string
  userName: string
  actionName: 'Movement'
  from: GridAnchor
  to: GridAnchor
  pathLength?: number
  lines: string[]
}

export interface MovementLogInput {
  userId: string
  userName: string
  from: GridAnchor
  to: GridAnchor
  pathLength?: number | null
}

export interface MovementLogAppendOptions {
  now?: () => number
  maxLogEntries?: number
}

const DEFAULT_MAX_LOG_ENTRIES = 100

const copyGridAnchor = (position: GridAnchor): GridAnchor => ({
  x: position.x,
  y: position.y,
  z: position.z,
})

const gridAnchorLabel = (position: GridAnchor): string =>
  `(${position.x}, ${position.y}, ${position.z})`

const pathLengthPhrase = (pathLength: number | null | undefined): string => {
  if (!pathLength || pathLength <= 0) return ''
  return ` ${pathLength} square${pathLength === 1 ? '' : 's'}`
}

export const sameGridAnchor = (left: GridAnchor, right: GridAnchor): boolean =>
  left.x === right.x && left.y === right.y && left.z === right.z

export const formatMovementLogLine = (input: MovementLogInput): string =>
  `${input.userName} moved${pathLengthPhrase(input.pathLength)} from ${gridAnchorLabel(input.from)} to ${gridAnchorLabel(input.to)}.`

export const appendMovementLogEntry = (
  metadata: Record<string, unknown> | undefined,
  input: MovementLogInput,
  options: MovementLogAppendOptions = {},
): Record<string, unknown> => {
  const next = { ...(metadata ?? {}) }
  const previous = Array.isArray(next.movementLog) ? next.movementLog : []
  const entry: MovementLogEntry = {
    at: options.now?.() ?? Date.now(),
    userId: input.userId,
    userName: input.userName,
    actionName: 'Movement',
    from: copyGridAnchor(input.from),
    to: copyGridAnchor(input.to),
    ...(input.pathLength && input.pathLength > 0 ? { pathLength: input.pathLength } : {}),
    lines: [formatMovementLogLine(input)],
  }

  next.movementLog = [...previous, entry].slice(-(options.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES))
  return next
}
