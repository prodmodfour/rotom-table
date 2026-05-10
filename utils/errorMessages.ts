export interface ErrorMessageOptions {
  fallback?: string
}

const hasString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const getObjectField = (value: unknown, key: string): unknown => {
  if (!value || typeof value !== 'object') return undefined
  return (value as Record<string, unknown>)[key]
}

/**
 * Converts unknown fetch/runtime errors into a stable user-facing message.
 *
 * Nuxt `$fetch` errors may expose the HTTP message on either `statusMessage`
 * or `data.statusMessage`; plain runtime errors usually expose `message`.
 */
export const getErrorMessage = (
  error: unknown,
  options: ErrorMessageOptions = {},
): string => {
  if (hasString(error)) return error

  const data = getObjectField(error, 'data')
  const candidates = [
    getObjectField(error, 'statusMessage'),
    getObjectField(data, 'statusMessage'),
    getObjectField(data, 'message'),
    getObjectField(error, 'message'),
  ]

  for (const candidate of candidates) {
    if (hasString(candidate)) return candidate
  }

  if (error == null) return options.fallback ?? 'Unknown error'
  return String(error)
}
