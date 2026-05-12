export type SearchBucketValue = string | number | null | undefined

export type SearchBuckets<TKey extends string> = Record<TKey, string[]>
export type BuiltSearchTexts<TKey extends string> = Record<TKey, string>

export const normalizeSearchText = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/['\u2019]/g, '')
  .replace(/[^a-z0-9#]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

export const createSearchBuckets = <TKey extends string>(keys: readonly TKey[]): SearchBuckets<TKey> => Object.fromEntries(
  keys.map((key) => [key, [] as string[]]),
) as SearchBuckets<TKey>

export const addSearchValue = (values: string[], value: SearchBucketValue) => {
  if (value === undefined || value === null) return

  const stringValue = String(value).trim()
  if (stringValue) values.push(stringValue)
}

export const addSearchValues = (values: string[], ...rawValues: SearchBucketValue[]) => {
  for (const value of rawValues) {
    addSearchValue(values, value)
  }
}

export const addSearchValuesToBucket = <TKey extends string>(
  buckets: SearchBuckets<TKey>,
  key: TKey,
  aggregateKey: TKey | null,
  ...rawValues: SearchBucketValue[]
) => {
  addSearchValues(buckets[key], ...rawValues)

  if (aggregateKey && aggregateKey !== key) {
    addSearchValues(buckets[aggregateKey], ...rawValues)
  }
}

export const buildSearchText = (values: string[]): string => {
  const normalizedValues = new Set<string>()

  for (const value of values) {
    const normalized = normalizeSearchText(value)
    if (!normalized) continue

    normalizedValues.add(normalized)

    // Also index a no-space version so "thunderpunch" and "tm35" work even
    // when the source data says "Thunder Punch" or "TM 35".
    const compact = normalized.replace(/\s+/g, '')
    if (compact && compact !== normalized) {
      normalizedValues.add(compact)
    }
  }

  return Array.from(normalizedValues).join(' ')
}

export const buildSearchTextsFromBuckets = <TKey extends string>(
  keys: readonly TKey[],
  buckets: SearchBuckets<TKey>,
): BuiltSearchTexts<TKey> => Object.fromEntries(
  keys.map((key) => [key, buildSearchText(buckets[key])]),
) as BuiltSearchTexts<TKey>
