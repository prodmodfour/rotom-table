export const INITIATIVE_ORDER_DIRECTIONS = ['highest-first', 'lowest-first'] as const
export type InitiativeOrderDirection = (typeof INITIATIVE_ORDER_DIRECTIONS)[number]

export interface InitiativeOrderEntry {
  readonly id: string
  readonly displayName: string
  readonly hasExplicitInitiative: boolean
  readonly initiativeScore: number
}

const compareText = (left: string, right: string): number => {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

const tieBreakerText = (value: string): string => value.trim().toLowerCase()

export const normalizeInitiativeValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

export const compareInitiativeOrderEntries = (
  left: InitiativeOrderEntry,
  right: InitiativeOrderEntry,
  direction: InitiativeOrderDirection = 'highest-first',
): number => {
  if (left.hasExplicitInitiative !== right.hasExplicitInitiative) {
    return left.hasExplicitInitiative ? -1 : 1
  }

  if (left.initiativeScore !== right.initiativeScore) {
    return direction === 'lowest-first'
      ? left.initiativeScore - right.initiativeScore
      : right.initiativeScore - left.initiativeScore
  }

  const normalizedNameComparison = compareText(
    tieBreakerText(left.displayName),
    tieBreakerText(right.displayName),
  )
  if (normalizedNameComparison !== 0) return normalizedNameComparison

  const displayNameComparison = compareText(left.displayName, right.displayName)
  if (displayNameComparison !== 0) return displayNameComparison

  return compareText(left.id, right.id)
}

export const sortInitiativeOrderEntries = <TEntry extends InitiativeOrderEntry>(
  entries: readonly TEntry[],
  direction: InitiativeOrderDirection = 'highest-first',
): TEntry[] => [...entries].sort((left, right) => (
  compareInitiativeOrderEntries(left, right, direction)
))

export const orderInitiativeEntries = <TEntry extends InitiativeOrderEntry>(
  entries: readonly TEntry[],
  manualOrderIds?: readonly string[] | null,
  direction: InitiativeOrderDirection = 'highest-first',
): TEntry[] => {
  const calculated = sortInitiativeOrderEntries(entries, direction)
  if (!manualOrderIds?.length) return calculated

  const byId = new Map(calculated.map((entry) => [entry.id, entry]))
  const used = new Set<string>()
  const ordered: TEntry[] = []

  for (const id of manualOrderIds) {
    const entry = byId.get(id)
    if (!entry || used.has(id)) continue
    ordered.push(entry)
    used.add(id)
  }

  for (const entry of calculated) {
    if (!used.has(entry.id)) ordered.push(entry)
  }

  return ordered
}

export const initiativeOrderIds = (
  entries: readonly InitiativeOrderEntry[],
  manualOrderIds?: readonly string[] | null,
  direction: InitiativeOrderDirection = 'highest-first',
): string[] => orderInitiativeEntries(entries, manualOrderIds, direction).map((entry) => entry.id)
