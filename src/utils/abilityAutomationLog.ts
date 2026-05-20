import type { AbilityAutomationLogEntry, AbilityAutomationTransaction } from '~/types/abilityAutomation'

export const DEFAULT_ABILITY_AUTOMATION_LOG_ENTRIES = 100

export const appendAbilityAutomationLogEntry = (
  metadata: Record<string, unknown> | undefined,
  transaction: AbilityAutomationTransaction,
  options: { now?: () => number; maxLogEntries?: number } = {},
): Record<string, unknown> => {
  const next = { ...(metadata ?? {}) }
  const previous = Array.isArray(next.abilityLog) ? next.abilityLog : []
  const entry: AbilityAutomationLogEntry = {
    at: options.now?.() ?? Date.now(),
    userId: transaction.userId,
    userName: transaction.userName,
    abilityName: transaction.abilityName,
    category: transaction.category,
    lines: transaction.logLines,
  }
  next.abilityLog = [...previous, entry].slice(-(options.maxLogEntries ?? DEFAULT_ABILITY_AUTOMATION_LOG_ENTRIES))
  return next
}
