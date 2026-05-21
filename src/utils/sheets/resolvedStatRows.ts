export interface ResolvedStatTotalsRow<Key extends string = string> {
  key: Key
  baseTotal: number
  total: number
  effectiveStage: number
}

export const resolvedStatRowFor = <Row extends ResolvedStatTotalsRow>(
  rows: readonly Row[],
  key: Row['key'],
): Row | undefined => rows.find((row) => row.key === key)

export const resolvedStatTotal = <Row extends ResolvedStatTotalsRow>(
  rows: readonly Row[],
  key: Row['key'],
): number => resolvedStatRowFor(rows, key)?.total ?? 0

export const resolvedStatBaseTotal = <Row extends ResolvedStatTotalsRow>(
  rows: readonly Row[],
  key: Row['key'],
): number => resolvedStatRowFor(rows, key)?.baseTotal ?? 0

export const resolvedStatEffectiveStage = <Row extends ResolvedStatTotalsRow>(
  rows: readonly Row[],
  key: Row['key'],
): number => resolvedStatRowFor(rows, key)?.effectiveStage ?? 0
