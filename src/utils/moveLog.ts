import type { MoveLogArgumentValue } from '#shared/moveAutomation/effects'
import type { MoveSpecPhase } from '#shared/moveAutomation/spec'

export const DEFAULT_MOVE_LOG_ENTRIES = 100

export interface MoveStructuredLogArgument {
  readonly key: string
  readonly value: MoveLogArgumentValue
}

/** Durable locale-independent projection of one reviewed MoveSpec log operation. */
export interface MoveStructuredLogProjection {
  readonly operationId: string
  readonly phase: MoveSpecPhase
  readonly reasonCode: string
  readonly messageKey: string
  readonly recipientIds: readonly string[]
  readonly arguments: readonly MoveStructuredLogArgument[]
}

export interface MoveLogTransaction {
  readonly userId: string
  readonly userName: string
  readonly moveName: string
  readonly lines: readonly string[]
  readonly scriptKind?: string
  readonly scriptVersion?: number
  readonly definitionHash?: string
  readonly structured?: readonly MoveStructuredLogProjection[]
}

export interface MoveLogEntry {
  readonly at: number
  readonly userId: string
  readonly userName: string
  readonly moveName: string
  readonly lines: string[]
  readonly scriptKind?: string
  readonly scriptVersion?: number
  readonly definitionHash?: string
  readonly structured?: MoveStructuredLogProjection[]
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

export const createMoveStructuredLogProjection = (
  input: MoveStructuredLogProjection,
): MoveStructuredLogProjection => ({
  operationId: input.operationId,
  phase: input.phase,
  reasonCode: input.reasonCode,
  messageKey: input.messageKey,
  recipientIds: [...input.recipientIds],
  arguments: input.arguments.map(argument => ({ ...argument })),
})

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
    ...(transaction.definitionHash === undefined ? {} : { definitionHash: transaction.definitionHash }),
    ...(transaction.structured === undefined
      ? {}
      : { structured: transaction.structured.map(createMoveStructuredLogProjection) }),
  }
  next.moveLog = [...previous, entry].slice(-(options.maxLogEntries ?? DEFAULT_MOVE_LOG_ENTRIES))
  return next
}
