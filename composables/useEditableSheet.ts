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
import { isRealtimeEcho, sheetChannel } from '~/shared/realtime'
import {
  bindAutosaveUnloadFlushers,
  createAutosaveResourceController,
  runLatestAutosave,
  sendJsonWithUnloadFallback,
} from '~/utils/autosave'
import { deepCloneJson, stableJsonStringify } from '~/utils/serialization'
import { subscribeChannel } from './useRealtime'
import type { SheetKind } from '~/shared/sheets'

export type { SheetKind } from '~/shared/sheets'
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

export function useEditableSheet<T extends { slug: string }>(
  initial: T,
  kind: SheetKind,
  options: UseEditableSheetOptions = {},
): UseEditableSheetReturn<T> {
  const { debounceMs = 200 } = options

  const sheet = ref(deepCloneJson(initial)) as Ref<T>
  const saveStatus = ref<SaveStatus>('idle')
  const saveError = ref<string | null>(null)
  const clientId = getClientId()

  const toPersistedPayload = (value: T): Record<string, unknown> => {
    const payload: Record<string, unknown> = { ...(value as unknown as Record<string, unknown>) }
    delete payload.folder
    return payload
  }

  const jsonFor = (value: T): string => stableJsonStringify(toPersistedPayload(value))
  // Mirrors what's persisted on disk; used by the deep watcher to skip
  // saves when the only change came from an SSE update.
  const autosave = createAutosaveResourceController<T, SaveStatus>({
    refs: { status: saveStatus, error: saveError },
    labels: { saving: 'saving', saved: 'saved', error: 'error' },
    serialize: jsonFor,
    initialValue: initial,
    save: () => performSave(),
    debounceMs,
    markPending: () => {
      saveStatus.value = 'saving'
    },
  })
  const hasUnsavedChanges = (): boolean => autosave.snapshot.isDirty(sheet.value)

  const cancelPendingSave = () => {
    autosave.cancelPendingSave()
  }

  const performSave = async () => {
    const payload = toPersistedPayload(sheet.value)
    const payloadJson = stableJsonStringify(payload)
    if (autosave.snapshot.isCleanJson(payloadJson)) {
      if (saveStatus.value === 'saving') autosave.statusController.markSaved()
      return
    }

    await runLatestAutosave({
      guard: autosave.guard,
      status: autosave.statusController,
      save: () =>
        $fetch('/api/sheets/save', {
          method: 'POST',
          body: { kind, slug: sheet.value.slug, sheet: payload, clientId },
        }),
      onSuccess: () => {
        autosave.snapshot.markCleanJson(payloadJson)
      },
      error: { logPrefix: '[useEditableSheet] save failed' },
    })
  }

  const saveNow = async () => {
    await autosave.saveNow()
  }

  watch(
    sheet,
    (current) => {
      autosave.scheduleIfDirty(current)
    },
    { deep: true },
  )

  // Cross-tab sync: replace the editable copy when another tab edits
  // the same sheet on disk.
  let unsubscribe: (() => void) | null = null
  if (typeof window !== 'undefined') {
    unsubscribe = subscribeChannel(sheetChannel(kind, initial.slug), (event) => {
      if (isRealtimeEcho(event, clientId)) return
      const payload = event.data as
        | { kind?: SheetKind; slug?: string; sheet?: T }
        | undefined
      if (event.type === 'updated' && payload?.sheet) {
        const incoming = deepCloneJson(payload.sheet)
        autosave.snapshot.markClean(incoming)
        sheet.value = incoming
        saveStatus.value = 'saved'
      }
    })
  }

  const flushWithBeacon = () => {
    if (!hasUnsavedChanges()) return
    autosave.cancelPendingSave()

    const payload = toPersistedPayload(sheet.value)
    const payloadJson = stableJsonStringify(payload)
    const body = JSON.stringify({ kind, slug: sheet.value.slug, sheet: payload, clientId })

    sendJsonWithUnloadFallback('/api/sheets/save', body)

    // Treat this tab as clean once the unload request was attempted so
    // `beforeunload` + `pagehide` don't queue duplicate writes.
    autosave.snapshot.markCleanJson(payloadJson)
    saveStatus.value = 'saved'
  }

  let removeUnloadFlushers: (() => void) | null = bindAutosaveUnloadFlushers(flushWithBeacon)

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      if (hasUnsavedChanges()) void autosave.saveNow()
      unsubscribe?.()
      unsubscribe = null
      removeUnloadFlushers?.()
      removeUnloadFlushers = null
    })
  }

  return { sheet, saveStatus, saveError, saveNow, cancelPendingSave }
}
