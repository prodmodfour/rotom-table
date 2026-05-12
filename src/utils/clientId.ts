/**
 * Per-page-load client id used for echo suppression on realtime events.
 *
 * Generated fresh on first call within a JS runtime — i.e. once per
 * tab/window, regardless of how the tab was opened. We deliberately
 * avoid `sessionStorage` because Chrome copies it into duplicated tabs
 * (and into "Open link in new tab" navigations from the same origin),
 * which would give two distinct tabs the same id and cause one tab's
 * broadcast to be wrongly filtered out as its own echo.
 *
 * Surviving reloads isn't useful here either: a reload re-subscribes
 * to the SSE stream from scratch, so a fresh id is fine.
 */
export interface ClientIdProviderOptions {
  hasWindow?: () => boolean
  random?: () => number
  now?: () => number
}

export const formatClientId = (random: number, now: number): string =>
  `c-${random.toString(36).slice(2, 10)}-${now.toString(36)}`

export const createClientIdProvider = (options: ClientIdProviderOptions = {}): (() => string) => {
  let cached: string | null = null

  return () => {
    if (cached) return cached

    const hasWindow = options.hasWindow?.() ?? typeof window !== 'undefined'
    if (!hasWindow) return 'ssr'

    const random = options.random?.() ?? Math.random()
    const now = options.now?.() ?? Date.now()
    cached = formatClientId(random, now)
    return cached
  }
}

export const getClientId = createClientIdProvider()
