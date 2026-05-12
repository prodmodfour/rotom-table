export const normalizeReferenceSearch = (value: string): string => value.trim().toLowerCase()

export const matchesReferenceSearch = (
  values: readonly string[],
  normalizedQuery: string,
): boolean => {
  if (!normalizedQuery) return true
  return values.some((value) => normalizeReferenceSearch(value).includes(normalizedQuery))
}
