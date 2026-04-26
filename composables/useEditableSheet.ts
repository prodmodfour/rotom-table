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
 * Dev-only: the underlying API endpoint refuses to run in production.
 */
import { getCurrentInstance, onBeforeUnmount, ref, watch, type Ref } from 'vue'

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

export function useEditableSheet<T extends { slug: string }>(
  initial: T,
  kind: SheetKind,
  options: UseEditableSheetOptions = {},
): UseEditableSheetReturn<T> {
  const { debounceMs = 200 } = options

  const sheet = ref(deepClone(initial)) as Ref<T>
  const saveStatus = ref<SaveStatus>('idle')
  const saveError = ref<string | null>(null)

  // Track the latest "intended" payload so a save that races with a newer
  // edit always wins (the older save returns into a stale state).
  let saveSeq = 0
  let pendingTimer: ReturnType<typeof setTimeout> | null = null

  const cancelPendingSave = () => {
    if (pendingTimer != null) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
  }

  const performSave = async () => {
    cancelPendingSave()
    const seq = ++saveSeq
    saveStatus.value = 'saving'
    saveError.value = null
    try {
      // Strip `folder` from the payload — the server re-derives it from the
      // file's path and we want a single source of truth.
      const payload: Record<string, unknown> = { ...(sheet.value as Record<string, unknown>) }
      delete payload.folder
      await $fetch('/api/sheets/save', {
        method: 'POST',
        body: { kind, slug: sheet.value.slug, sheet: payload },
      })
      // If a newer save has started in the meantime, leave its status alone.
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

  // Deep watch — any mutation (including nested array push/splice) triggers
  // a debounced save. The watcher is registered after construction so the
  // initial deep-clone above doesn't itself fire a save.
  watch(
    sheet,
    () => {
      cancelPendingSave()
      saveStatus.value = 'saving'
      pendingTimer = setTimeout(() => {
        pendingTimer = null
        void performSave()
      }, debounceMs)
    },
    { deep: true },
  )

  // If the component is torn down while a save is queued (page navigation,
  // hot reload), flush it synchronously so the user doesn't lose the last
  // few keystrokes. Only register when called from a component setup —
  // composables can also be invoked from non-component code in tests.
  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      if (pendingTimer != null) {
        cancelPendingSave()
        void performSave()
      }
    })
  }

  return { sheet, saveStatus, saveError, saveNow, cancelPendingSave }
}
