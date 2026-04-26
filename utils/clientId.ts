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
let cached: string | null = null

export const getClientId = (): string => {
  if (cached) return cached
  if (typeof window === 'undefined') return 'ssr'
  cached = `c-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
  return cached
}
