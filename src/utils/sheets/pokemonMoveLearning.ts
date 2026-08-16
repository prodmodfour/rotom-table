import type { CharacterSheetAppliedMove, CharacterSheetMove } from '~/types/characterSheet'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const isMoveRow = (value: unknown): value is CharacterSheetMove => (
  isRecord(value) && typeof value.name === 'string' && value.name.trim().length > 0
)

const isAppliedMoveRow = (value: unknown): value is CharacterSheetAppliedMove => (
  isRecord(value)
  && typeof value.name === 'string'
  && value.name.trim().length > 0
  && (value.source === 'tm' || value.source === 'tutor')
)

const currentLockedNames = (rows: readonly CharacterSheetMove[]): ReadonlySet<string> => new Set(
  rows.filter(row => row.itemMoveLearningLocked === true).map(row => row.name),
)

const controlledRowsRoundTrip = <TRow extends CharacterSheetMove>(input: {
  readonly candidate: unknown
  readonly current: unknown
  readonly applied: boolean
}): readonly TRow[] => {
  const currentRows = Array.isArray(input.current)
    ? input.current.filter(input.applied ? isAppliedMoveRow : isMoveRow) as TRow[]
    : []
  const candidateRows = Array.isArray(input.candidate)
    ? input.candidate.filter(input.applied ? isAppliedMoveRow : isMoveRow) as TRow[]
    : []
  const lockedNames = currentLockedNames(currentRows)
  if (lockedNames.size === 0) {
    return candidateRows.map(row => {
      const detached = structuredClone(row)
      delete detached.itemMoveLearningLocked
      return detached
    })
  }
  const valid = currentRows.every((row, index) => {
    if (row.itemMoveLearningLocked !== true) return true
    const candidate = candidateRows[index]
    return candidate?.name === row.name && candidate.itemMoveLearningLocked === true
  }) && [...lockedNames].every(name => (
    candidateRows.filter(row => row.name === name).length === 1
  )) && candidateRows.every((row, index) => (
    row.itemMoveLearningLocked !== true || currentRows[index]?.itemMoveLearningLocked === true
  ))
  if (!valid) return structuredClone(currentRows)
  return candidateRows.map((row, index) => {
    const current = currentRows[index]
    if (current?.itemMoveLearningLocked === true) return structuredClone(current)
    const detached = structuredClone(row)
    delete detached.itemMoveLearningLocked
    return detached
  })
}

/**
 * Setup saves may edit ordinary Move rows but cannot forge, remove, reorder, or
 * rewrite item-controlled Move rows. Invalid attempts preserve the complete
 * current array so a partial client document cannot corrupt slot provenance.
 */
export const preservePokemonItemControlledMovesForSetupSave = <
  TSheet extends Record<string, unknown>,
>(candidate: TSheet, current: Record<string, unknown>): TSheet => {
  const result = { ...candidate } as Record<string, unknown>
  const movelist = controlledRowsRoundTrip<CharacterSheetMove>({
    candidate: candidate.movelist,
    current: current.movelist,
    applied: false,
  })
  const appliedMoves = controlledRowsRoundTrip<CharacterSheetAppliedMove>({
    candidate: candidate.appliedMoves,
    current: current.appliedMoves,
    applied: true,
  })
  if (movelist.length > 0 || Array.isArray(current.movelist) || Array.isArray(candidate.movelist)) {
    result.movelist = movelist
  }
  else delete result.movelist
  if (appliedMoves.length > 0 || Array.isArray(current.appliedMoves) || Array.isArray(candidate.appliedMoves)) {
    result.appliedMoves = appliedMoves
  }
  else delete result.appliedMoves
  return result as TSheet
}
