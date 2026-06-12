import { findMove } from '~~/data/ptuReference'
import { moveUsageKey } from '~/utils/moveUsage'

export interface SheetMoveRecord {
  readonly name: string
  readonly frequency?: string
}

export interface ResolvedSheetMove {
  readonly moveName: string
  readonly moveKey: string
  readonly frequency: string
}

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const nonEmptyString = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || null
}

export const sheetMovesForUsage = (sheet: Record<string, unknown>): SheetMoveRecord[] => {
  const movelist = sheet.movelist
  if (!Array.isArray(movelist)) return []

  return movelist.flatMap((move): SheetMoveRecord[] => {
    if (!isRecord(move)) return []
    const name = nonEmptyString(move.name)
    if (!name) return []
    const frequency = nonEmptyString(move.frequency)
    return [{ name, ...(frequency ? { frequency } : {}) }]
  })
}

export const resolveSheetMoveForUsage = (
  sheet: Record<string, unknown>,
  requestedMoveName: string,
): ResolvedSheetMove | null => {
  const requestedKey = moveUsageKey(requestedMoveName)
  if (!requestedKey) return null

  for (const move of sheetMovesForUsage(sheet)) {
    const reference = findMove(move.name)
    const canonicalName = reference?.name ?? move.name
    const candidateKeys = new Set([
      moveUsageKey(move.name),
      moveUsageKey(canonicalName),
    ])
    if (!candidateKeys.has(requestedKey)) continue

    const frequency = nonEmptyString(reference?.frequency) ?? nonEmptyString(move.frequency)
    return {
      moveName: canonicalName,
      moveKey: moveUsageKey(canonicalName) || requestedKey,
      frequency: frequency ?? '',
    }
  }

  return null
}
