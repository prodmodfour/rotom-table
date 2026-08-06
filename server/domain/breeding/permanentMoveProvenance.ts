import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'

const isPlainRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  && Object.getOwnPropertySymbols(value).length === 0
)
const dataField = (value: object, field: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, field)
  return descriptor?.enumerable && 'value' in descriptor ? descriptor.value : undefined
}
const moveRows = (value: unknown): readonly CharacterSheetMove[] => Array.isArray(value)
  && Object.getPrototypeOf(value) === Array.prototype
  && Object.getOwnPropertyNames(value).length === value.length + 1
  ? value.filter((row): row is CharacterSheetMove => isPlainRecord(row) && typeof dataField(row, 'name') === 'string')
  : []

/**
 * Whole-sheet browser saves may edit ordinary Move rows, but cannot mint or
 * rewrite server-authored permanent-Move provenance. Preserve an existing
 * source only while its unique canonical display-name row remains present.
 */
export const preserveServerOwnedPermanentMoveProvenance = (
  current: CharacterSheet,
  candidate: CharacterSheet,
): CharacterSheet => {
  if (!Array.isArray(candidate.movelist)) return candidate
  const sourcesByName = new Map<string, unknown>()
  const ambiguous = new Set<string>()
  for (const row of moveRows(current.movelist)) {
    const name = dataField(row, 'name') as string
    const source = dataField(row, 'permanentMoveSource')
    if (source === undefined) continue
    if (sourcesByName.has(name)) ambiguous.add(name)
    else sourcesByName.set(name, source)
  }
  for (const name of ambiguous) sourcesByName.delete(name)
  const movelist = candidate.movelist.map((row): CharacterSheetMove => {
    if (!isPlainRecord(row)) return row
    const detached = { ...row }
    delete detached.permanentMoveSource
    const name = dataField(row, 'name')
    const source = typeof name === 'string' ? sourcesByName.get(name) : undefined
    return source === undefined ? detached as CharacterSheetMove : { ...detached, permanentMoveSource: source } as CharacterSheetMove
  })
  return { ...candidate, movelist }
}
