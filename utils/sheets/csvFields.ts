export const parseCsvList = (raw: string): string[] =>
  raw.split(',').map((value) => value.trim()).filter(Boolean)

export const formatCsvList = (values: readonly string[] | null | undefined): string =>
  values?.join(', ') ?? ''

export const parseAllowedCsvList = <TValue extends string>(
  raw: string,
  allowedValues: readonly TValue[],
): TValue[] => {
  const allowed = new Set<string>(allowedValues)
  return parseCsvList(raw).filter((value): value is TValue => allowed.has(value))
}

export const formatCsvSingleOrList = <TValue extends string>(
  value: TValue | readonly TValue[] | null | undefined,
): string => {
  if (!value) return ''
  return Array.isArray(value) ? value.join(', ') : value
}

export const toOptionalSingleOrList = <TValue extends string>(
  values: readonly TValue[],
): TValue | TValue[] | undefined => {
  if (values.length === 0) return undefined
  if (values.length === 1) return values[0]
  return [...values]
}
