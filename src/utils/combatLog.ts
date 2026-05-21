export type CombatLogSource = 'move' | 'ability' | 'order' | 'maneuver' | 'movement'

export interface CombatLogMessage {
  id: string
  at: number
  source: CombatLogSource
  userName: string
  actionName: string
  title: string
  details: string[]
}

export interface CombatLogBuildOptions {
  maxMessages?: number
}

interface CombatLogSourceConfig {
  source: CombatLogSource
  metadataKey: string
  actionKey: string
  fallbackActionName: string
}

interface CombatLogEntry {
  at: number
  source: CombatLogSource
  sourceOrder: number
  entryIndex: number
  userName: string
  actionName: string
  lines: string[]
}

interface CombatLogMessageContent {
  title: string
  details: string[]
}

interface SortableCombatLogMessage extends CombatLogMessage {
  sourceOrder: number
  entryIndex: number
}

const COMBAT_LOG_SOURCES: readonly CombatLogSourceConfig[] = [
  { source: 'move', metadataKey: 'moveLog', actionKey: 'moveName', fallbackActionName: 'Move' },
  { source: 'ability', metadataKey: 'abilityLog', actionKey: 'abilityName', fallbackActionName: 'Ability' },
  { source: 'order', metadataKey: 'orderLog', actionKey: 'orderName', fallbackActionName: 'Order' },
  { source: 'maneuver', metadataKey: 'maneuverLog', actionKey: 'maneuverName', fallbackActionName: 'Maneuver' },
  { source: 'movement', metadataKey: 'movementLog', actionKey: 'actionName', fallbackActionName: 'Movement' },
]

const HIDDEN_LOG_LINE_PATTERNS: readonly RegExp[] = [
  /^Explicit move script v\d+ used\.$/i,
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringOrFallback = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

const numberOrFallback = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number') return fallback
  return Number.isFinite(value) ? value : fallback
}

const shouldShowLogLine = (line: string): boolean =>
  !HIDDEN_LOG_LINE_PATTERNS.some((pattern) => pattern.test(line))

const readLogLines = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter(shouldShowLogLine)
}

const readEntriesForSource = (
  metadata: Record<string, unknown>,
  config: CombatLogSourceConfig,
  sourceOrder: number,
): CombatLogEntry[] => {
  const rawEntries = metadata[config.metadataKey]
  if (!Array.isArray(rawEntries)) return []

  return rawEntries.flatMap((rawEntry, entryIndex): CombatLogEntry[] => {
    if (!isRecord(rawEntry)) return []

    const lines = readLogLines(rawEntry.lines)
    if (!lines.length) return []

    return [{
      at: numberOrFallback(rawEntry.at, 0),
      source: config.source,
      sourceOrder,
      entryIndex,
      userName: stringOrFallback(rawEntry.userName, 'Unknown'),
      actionName: stringOrFallback(rawEntry[config.actionKey], config.fallbackActionName),
      lines,
    }]
  })
}

const caseFold = (value: string): string => value.toLocaleLowerCase()

const stripMovementLineSubject = (line: string, userName: string): string => {
  const movedPrefix = `${userName} moved`
  if (caseFold(line).startsWith(caseFold(movedPrefix))) return line.slice(movedPrefix.length).trim()

  return line.match(/^.+?\s+moved\s+(.+)$/i)?.[1]?.trim() ?? line
}

const defaultMessageContent = (entry: CombatLogEntry): CombatLogMessageContent => ({
  title: entry.lines[0] ?? entry.actionName,
  details: entry.lines.slice(1),
})

const movementMessageContent = (entry: CombatLogEntry): CombatLogMessageContent => {
  const title = `${entry.userName} Moves`
  const [firstLine, ...remainingLines] = entry.lines
  if (!firstLine) return { title, details: [] }
  if (caseFold(firstLine) === caseFold(title)) return { title, details: remainingLines }

  return {
    title,
    details: [stripMovementLineSubject(firstLine, entry.userName), ...remainingLines].filter(Boolean),
  }
}

const messageContent = (entry: CombatLogEntry): CombatLogMessageContent =>
  entry.source === 'movement' ? movementMessageContent(entry) : defaultMessageContent(entry)

const toMessage = (entry: CombatLogEntry): SortableCombatLogMessage => {
  const { title, details } = messageContent(entry)
  return {
    id: `${entry.source}-${entry.at}-${entry.entryIndex}`,
    at: entry.at,
    source: entry.source,
    sourceOrder: entry.sourceOrder,
    entryIndex: entry.entryIndex,
    userName: entry.userName,
    actionName: entry.actionName,
    title,
    details,
  }
}

const sortMessages = (a: SortableCombatLogMessage, b: SortableCombatLogMessage): number =>
  a.at - b.at
  || a.sourceOrder - b.sourceOrder
  || a.entryIndex - b.entryIndex

const stripSortFields = ({
  sourceOrder: _sourceOrder,
  entryIndex: _entryIndex,
  ...message
}: SortableCombatLogMessage): CombatLogMessage => message

const applyMessageLimit = (
  messages: SortableCombatLogMessage[],
  maxMessages: number | undefined,
): SortableCombatLogMessage[] => {
  if (maxMessages === undefined) return messages
  if (!Number.isFinite(maxMessages) || maxMessages <= 0) return []
  return messages.slice(-Math.floor(maxMessages))
}

export const buildCombatLogMessages = (
  metadata: Record<string, unknown> | null | undefined,
  options: CombatLogBuildOptions = {},
): CombatLogMessage[] => {
  if (!metadata) return []

  const sortedMessages = COMBAT_LOG_SOURCES
    .flatMap((source, sourceOrder) => readEntriesForSource(metadata, source, sourceOrder))
    .map(toMessage)
    .sort(sortMessages)

  return applyMessageLimit(sortedMessages, options.maxMessages).map(stripSortFields)
}
