import type { MoveAutomationTransaction } from '~/types/moveAutomation'
import { appendMoveLogEntry, DEFAULT_MOVE_LOG_ENTRIES } from '~/utils/moveLog'

export const DEFAULT_MOVE_AUTOMATION_LOG_ENTRIES = DEFAULT_MOVE_LOG_ENTRIES

export const appendMoveAutomationLogEntry = (
  metadata: Record<string, unknown> | undefined,
  transaction: MoveAutomationTransaction,
  options: { now?: () => number; maxLogEntries?: number; operationId?: string } = {},
): Record<string, unknown> => appendMoveLogEntry(
  metadata,
  {
    ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
    userId: transaction.userId,
    userName: transaction.userName,
    moveName: transaction.moveName,
    scriptKind: transaction.scriptKind,
    scriptVersion: transaction.scriptVersion,
    lines: transaction.logLines,
  },
  options,
)
