/**
 * useEditableSheet — reactive wrapper around a Pokémon or trainer sheet.
 *
 * Takes a static sheet (loaded via `import.meta.glob`) and produces a
 * deep, reactive copy. Any mutation to the returned `ref` deep-watches
 * and POSTs the full updated sheet to `/api/sheets/save`, which persists
 * it to disk.
 *
 * Saves are debounced (default 200 ms after the last edit) so a flurry
 * of keystrokes coalesces into a single write. The composable exposes
 * `saveStatus` (`'idle' | 'saving' | 'saved' | 'error'`) and the latest
 * error so the page can surface a small "saved / saving…" indicator.
 *
 * Cross-tab sync: subscribes to `sheet:<kind>:<slug>` over the realtime
 * SSE channel. Edits made in another tab/device land here as
 * `updated` events; we replace the local sheet contents (and the
 * "last server snapshot" so the watcher doesn't echo a save).
 */
import { getCurrentInstance, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { getClientId } from '~/utils/clientId'
import { subscribeChannel } from './useRealtime'

export type SheetKind = 'pokemon' | 'trainer'
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface UseEditableSheetOptions {
  /** Milliseconds to wait after the last change before saving. */
  debounceMs?: number
}

export interface UseEditableSheetReturn<T> {
  sheet: Ref<T>
  saveStatus: Ref<SaveStatus>
  saveError: Ref<string | null>
  /** Force an immediate save (e.g. on row add/delete you may want it now). */
  saveNow: () => Promise<void>
  /** Cancel any pending debounced save. */
  cancelPendingSave: () => void
}

/** Deep clone a JSON-shaped value so the reactive ref doesn't share refs
 *  with the static module-level data (Vite freezes glob imports). */
const deepClone = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value))
}

const stableJson = (value: unknown): string => JSON.stringify(value)

export function useEditableSheet<T extends { slug: string }>(
  initial: T,
  kind: SheetKind,
  options: UseEditableSheetOptions = {},
): UseEditableSheetReturn<T> {
  const { debounceMs = 200 } = options

  const sheet = ref(deepClone(initial)) as Ref<T>
  const saveStatus = ref<SaveStatus>('idle')
  const saveError = ref<string | null>(null)
  const clientId = getClientId()

  const toPersistedPayload = (value: T): Record<string, unknown> => {
    const payload: Record<string, unknown> = { ...(value as unknown as Record<string, unknown>) }
    delete payload.folder
    return payload
  }

  const jsonFor = (value: T): string => stableJson(toPersistedPayload(value))
  const hasUnsavedChanges = (): boolean => jsonFor(sheet.value) !== lastServerJson

  // Track the latest "intended" payload so a save that races with a newer
  // edit always wins (the older save returns into a stale state).
  let saveSeq = 0
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  // Mirrors what's persisted on disk; used by the deep watcher to skip
  // saves when the only change came from an SSE update.
  let lastServerJson = jsonFor(initial)

  const cancelPendingSave = () => {
    if (pendingTimer != null) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
  }

  const performSave = async () => {
    cancelPendingSave()
    const payload = toPersistedPayload(sheet.value)
    const payloadJson = stableJson(payload)
    if (payloadJson === lastServerJson) {
      if (saveStatus.value === 'saving') saveStatus.value = 'saved'
      return
    }

    const seq = ++saveSeq
    saveStatus.value = 'saving'
    saveError.value = null
    try {
      await $fetch('/api/sheets/save', {
        method: 'POST',
        body: { kind, slug: sheet.value.slug, sheet: payload, clientId },
      })
      lastServerJson = payloadJson
      if (seq === saveSeq) saveStatus.value = 'saved'
    } catch (err: unknown) {
      if (seq !== saveSeq) return
      saveStatus.value = 'error'
      const e = err as { statusMessage?: string; data?: { statusMessage?: string }; message?: string }
      saveError.value = e?.statusMessage ?? e?.data?.statusMessage ?? e?.message ?? String(err)
      console.error('[useEditableSheet] save failed', err)
    }
  }

  const saveNow = async () => {
    cancelPendingSave()
    await performSave()
  }

  watch(
    sheet,
    (current) => {
      if (jsonFor(current) === lastServerJson) return
      cancelPendingSave()
      saveStatus.value = 'saving'
      pendingTimer = setTimeout(() => {
        pendingTimer = null
        void performSave()
      }, debounceMs)
    },
    { deep: true },
  )

  // Cross-tab sync: replace the editable copy when another tab edits
  // the same sheet on disk.
  let unsubscribe: (() => void) | null = null
  if (typeof window !== 'undefined') {
    unsubscribe = subscribeChannel(`sheet:${kind}:${initial.slug}`, (event) => {
      if (event.clientId === clientId) return
      const payload = event.data as
        | { kind?: SheetKind; slug?: string; sheet?: T }
        | undefined
      if (event.type === 'updated' && payload?.sheet) {
        const incoming = deepClone(payload.sheet)
        lastServerJson = jsonFor(incoming)
        sheet.value = incoming
        saveStatus.value = 'saved'
      }
    })
  }

  const flushWithBeacon = () => {
    if (!hasUnsavedChanges()) return
    cancelPendingSave()

    const payload = toPersistedPayload(sheet.value)
    const payloadJson = stableJson(payload)
    const body = JSON.stringify({ kind, slug: sheet.value.slug, sheet: payload, clientId })
    let queued = false

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        queued = navigator.sendBeacon(
          '/api/sheets/save',
          new Blob([body], { type: 'application/json' }),
        )
      }
    } catch {
      queued = false
    }

    if (!queued) {
      try {
        void fetch('/api/sheets/save', {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          keepalive: true,
        })
      } catch {
        // The page is unloading; there is nowhere useful to surface this.
      }
    }

    // If the browser accepted the unload request, treat this tab as clean so
    // `beforeunload` + `pagehide` don't queue duplicate writes.
    lastServerJson = payloadJson
    saveStatus.value = 'saved'
  }

  let removeUnloadFlushers: (() => void) | null = null
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushWithBeacon)
    window.addEventListener('beforeunload', flushWithBeacon)
    removeUnloadFlushers = () => {
      window.removeEventListener('pagehide', flushWithBeacon)
      window.removeEventListener('beforeunload', flushWithBeacon)
    }
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      if (hasUnsavedChanges()) void performSave()
      unsubscribe?.()
      unsubscribe = null
      removeUnloadFlushers?.()
      removeUnloadFlushers = null
    })
  }

  return { sheet, saveStatus, saveError, saveNow, cancelPendingSave }
}
