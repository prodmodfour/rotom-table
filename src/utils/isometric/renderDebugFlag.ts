export const ISOMETRIC_RENDER_DEBUG_QUERY_KEY = 'debug'

export const ISOMETRIC_RENDER_DEBUG_QUERY_VALUES = [
  'render',
  'render-metrics',
  'isometric-render',
] as const

export type IsometricRenderDebugQueryValue = typeof ISOMETRIC_RENDER_DEBUG_QUERY_VALUES[number]

export type IsometricRenderDebugQuerySource =
  | string
  | URLSearchParams
  | Record<string, unknown>
  | null
  | undefined

export interface IsometricRenderDebugLocationLike {
  search?: string | null
}

export interface IsometricRenderDebugFlagOptions {
  /** Explicit query source, such as Nuxt route.query or window.location.search. */
  query?: IsometricRenderDebugQuerySource
  /** Injectable client location for callers that do not already have route query state. */
  location?: IsometricRenderDebugLocationLike | null
  /** Injectable environment gate for tests and SSR-safe callers. Defaults to the Vite/Nuxt dev flag. */
  isDev?: boolean
  /** Keep the flag dev-safe by default; opt in only for explicit benchmark/debug builds. */
  allowProduction?: boolean
}

interface ImportMetaDebugEnvironment {
  readonly dev?: boolean
  readonly env?: {
    readonly DEV?: unknown
    readonly MODE?: unknown
  }
}

interface ProcessDebugEnvironment {
  readonly dev?: unknown
  readonly env?: {
    readonly NODE_ENV?: unknown
  }
}

const DEBUG_TOKEN_SEPARATOR = /[\s,]+/
const DEBUG_QUERY_KEYS = new Set([ISOMETRIC_RENDER_DEBUG_QUERY_KEY, `${ISOMETRIC_RENDER_DEBUG_QUERY_KEY}[]`])
const DEBUG_QUERY_VALUES = new Set<string>(ISOMETRIC_RENDER_DEBUG_QUERY_VALUES)

const defaultIsDevEnvironment = (): boolean => {
  const meta = import.meta as ImportMetaDebugEnvironment
  const processDebug = globalThis.process as ProcessDebugEnvironment | undefined

  return (
    meta.dev === true
    || meta.env?.DEV === true
    || meta.env?.DEV === 'true'
    || meta.env?.MODE === 'development'
    || processDebug?.dev === true
    || processDebug?.env?.NODE_ENV === 'development'
  )
}

const normalizeDebugToken = (value: string): string => value.trim().toLowerCase()

const splitDebugTokens = (value: string): string[] => (
  value
    .split(DEBUG_TOKEN_SEPARATOR)
    .map(normalizeDebugToken)
    .filter(Boolean)
)

const appendStringValues = (values: string[], value: unknown): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      appendStringValues(values, item)
    }

    return
  }

  if (typeof value === 'string') {
    values.push(value)
  }
}

const queryStringToSearchParams = (query: string): URLSearchParams => {
  const trimmed = query.trim()
  const withoutHash = trimmed.includes('#') ? trimmed.slice(0, trimmed.indexOf('#')) : trimmed
  const queryStartIndex = withoutHash.indexOf('?')
  const search = queryStartIndex >= 0 ? withoutHash.slice(queryStartIndex + 1) : withoutHash.replace(/^\?/, '')

  return new URLSearchParams(search)
}

const collectDebugQueryValues = (query: IsometricRenderDebugQuerySource): string[] => {
  if (!query) {
    return []
  }

  if (typeof query === 'string') {
    return collectDebugQueryValues(queryStringToSearchParams(query))
  }

  const values: string[] = []

  if (query instanceof URLSearchParams) {
    for (const key of DEBUG_QUERY_KEYS) {
      values.push(...query.getAll(key))
    }

    return values
  }

  for (const [key, value] of Object.entries(query)) {
    if (DEBUG_QUERY_KEYS.has(key)) {
      appendStringValues(values, value)
    }
  }

  return values
}

const readGlobalLocationSearch = (): string => {
  const location = globalThis.location as IsometricRenderDebugLocationLike | undefined

  return typeof location?.search === 'string' ? location.search : ''
}

/**
 * Detects an explicit isometric render-debug query request without reading any
 * renderer or UI state. Supports Nuxt route query objects and URL query strings.
 */
export const hasIsometricRenderDebugQueryFlag = (query: IsometricRenderDebugQuerySource): boolean => (
  collectDebugQueryValues(query).some((value) => splitDebugTokens(value).some((token) => DEBUG_QUERY_VALUES.has(token)))
)

/**
 * Client-safe render-debug gate. It is inert without an explicit query flag and
 * dev-only by default so normal production users cannot accidentally enable
 * Render diagnostics.
 */
export const isIsometricRenderDebugEnabled = ({
  query,
  location,
  isDev = defaultIsDevEnvironment(),
  allowProduction = false,
}: IsometricRenderDebugFlagOptions = {}): boolean => {
  const requested = hasIsometricRenderDebugQueryFlag(query ?? location?.search ?? readGlobalLocationSearch())

  if (!requested) {
    return false
  }

  return allowProduction || isDev
}
