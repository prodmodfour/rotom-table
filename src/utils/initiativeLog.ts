export const DEFAULT_INITIATIVE_LOG_ENTRIES = 100

export interface InitiativeLogEntry {
  at: number
  userId: string
  userName: string
  actionName: 'Initiative'
  lines: string[]
}

export interface InitiativeLogInput {
  userId: string
  userName: string
}

export interface InitiativeLogAppendOptions {
  now?: () => number
  maxLogEntries?: number
}

const normalizedCharacterName = (input: InitiativeLogInput): string => {
  const userName = input.userName.trim()
  if (userName) return userName

  const userId = input.userId.trim()
  return userId || 'Character'
}

export const formatInitiativeGainLogLine = (input: InitiativeLogInput): string =>
  `${normalizedCharacterName(input)} has gained initiative!`

export const createInitiativeLogEntry = (
  input: InitiativeLogInput,
  options: Pick<InitiativeLogAppendOptions, 'now'> = {},
): InitiativeLogEntry => {
  const userName = normalizedCharacterName(input)
  return {
    at: options.now?.() ?? Date.now(),
    userId: input.userId,
    userName,
    actionName: 'Initiative',
    lines: [formatInitiativeGainLogLine({ ...input, userName })],
  }
}

export const appendInitiativeLogRecord = (
  metadata: Record<string, unknown> | undefined,
  entry: InitiativeLogEntry,
  options: Pick<InitiativeLogAppendOptions, 'maxLogEntries'> = {},
): Record<string, unknown> => {
  const next = { ...(metadata ?? {}) }
  const previous = Array.isArray(next.initiativeLog) ? next.initiativeLog : []
  next.initiativeLog = [
    ...previous,
    entry,
  ].slice(-(options.maxLogEntries ?? DEFAULT_INITIATIVE_LOG_ENTRIES))
  return next
}

export const appendInitiativeLogEntry = (
  metadata: Record<string, unknown> | undefined,
  input: InitiativeLogInput,
  options: InitiativeLogAppendOptions = {},
): Record<string, unknown> => appendInitiativeLogRecord(
  metadata,
  createInitiativeLogEntry(input, { now: options.now }),
  { maxLogEntries: options.maxLogEntries },
)
