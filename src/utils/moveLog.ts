export const DEFAULT_MOVE_LOG_ENTRIES = 100

export interface MoveLogTransaction {
  readonly userId: string
  readonly userName: string
  readonly moveName: string
  readonly lines: readonly string[]
  readonly scriptKind?: string
  readonly scriptVersion?: number
}

export interface MoveLogEntry {
  readonly at: number
  readonly userId: string
  readonly userName: string
  readonly moveName: string
  readonly lines: string[]
  readonly scriptKind?: string
  readonly scriptVersion?: number
}

const nonEmptyText = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || null
}

export const buildMoveUseLogLines = (
  userName: string,
  moveName: string,
  frequency?: string | null,
): string[] => [
  `${userName} used ${moveName}.`,
  ...(nonEmptyText(frequency) ? [`Frequency: ${nonEmptyText(frequency)}`] : []),
]

export const appendMoveLogEntry = (
  metadata: Record<string, unknown> | undefined,
  transaction: MoveLogTransaction,
  options: { now?: () => number; maxLogEntries?: number } = {},
): Record<string, unknown> => {
  const next = { ...(metadata ?? {}) }
  const previous = Array.isArray(next.moveLog) ? next.moveLog : []
  const entry: MoveLogEntry = {
    at: options.now?.() ?? Date.now(),
    userId: transaction.userId,
    userName: transaction.userName,
    moveName: transaction.moveName,
    lines: [...transaction.lines],
    ...(transaction.scriptKind === undefined ? {} : { scriptKind: transaction.scriptKind }),
    ...(transaction.scriptVersion === undefined ? {} : { scriptVersion: transaction.scriptVersion }),
  }
  next.moveLog = [...previous, entry].slice(-(options.maxLogEntries ?? DEFAULT_MOVE_LOG_ENTRIES))
  return next
}
