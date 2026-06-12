import type {
  AutosaveUnloadEventTarget,
  JsonUnloadRequestResult,
  JsonUnloadRequestTransports,
} from './autosaveTypes'

/**
 * Best-effort JSON write for setup/edit page-unload autosaves. Prefer
 * sendBeacon when available because browsers are allowed to abort ordinary
 * async work during unload; fall back to fetch(..., keepalive: true) for
 * browsers/environments without beacon support.
 *
 * This helper is intentionally scoped to document setup/edit saves. Live-play
 * commands use explicit command dispatch with opId idempotency and must not
 * call unload/beacon fallback writes.
 */
export const sendSetupEditJsonWithUnloadFallback = (
  url: string,
  body: string,
  transports: JsonUnloadRequestTransports = {},
): JsonUnloadRequestResult => {
  const sendBeacon =
    transports.sendBeacon ??
    (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
      ? navigator.sendBeacon.bind(navigator)
      : undefined)

  if (sendBeacon) {
    try {
      const createBlob =
        transports.createBlob ??
        ((value: string, options: BlobPropertyBag): BodyInit => new Blob([value], options))
      if (sendBeacon(url, createBlob(body, { type: 'application/json' }))) {
        return { transport: 'beacon', queued: true }
      }
    } catch {
      // Fall through to keepalive fetch below.
    }
  }

  const fetcher =
    transports.fetch ??
    (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)

  if (fetcher) {
    try {
      void fetcher(url, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
      })
      return { transport: 'fetch', queued: true }
    } catch {
      // The page is unloading; there is nowhere useful to surface this.
    }
  }

  return { transport: 'none', queued: false }
}

/**
 * Binds the two browser lifecycle events used for unload autosave flushing and
 * returns an idempotent remover. Tests can inject a minimal event target.
 */
export const bindAutosaveUnloadFlushers = (
  flush: () => void,
  target: AutosaveUnloadEventTarget | undefined =
    typeof window !== 'undefined' ? window : undefined,
): (() => void) | null => {
  if (!target) return null

  target.addEventListener('pagehide', flush)
  target.addEventListener('beforeunload', flush)

  let removed = false
  return () => {
    if (removed) return
    removed = true
    target.removeEventListener('pagehide', flush)
    target.removeEventListener('beforeunload', flush)
  }
}
