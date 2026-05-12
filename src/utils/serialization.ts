/**
 * JSON-only serialization helpers.
 *
 * These utilities intentionally operate on JSON-shaped values. They do not
 * preserve class instances, Dates, Maps, Sets, functions, circular references,
 * or object identity.
 */

export const deepCloneJson = <T>(value: T): T => {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export const stableJsonStringify = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    return Object.keys(item as Record<string, unknown>)
      .sort()
      .reduce((out, key) => {
        const current = (item as Record<string, unknown>)[key]
        if (current !== undefined) out[key] = current
        return out
      }, {} as Record<string, unknown>)
  }) ?? 'undefined'

export const sameJsonValue = (a: unknown, b: unknown): boolean =>
  stableJsonStringify(a) === stableJsonStringify(b)

export const omitUndefinedJsonFields = <T extends Record<string, unknown>>(value: T): Partial<T> => {
  const out: Partial<T> = {}
  for (const key of Object.keys(value) as Array<keyof T>) {
    if (value[key] !== undefined) out[key] = value[key]
  }
  return out
}
