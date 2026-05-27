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
import { isRealtimeEcho, sheetChannel } from '#shared/realtime'
import { slugify } from '#shared/paths'
import { createAutosaveResourceController } from '~/utils/autosaveResource'
import { runLatestAutosave } from '~/utils/autosaveSaveRunner'
import { bindAutosaveUnloadFlushers, sendJsonWithUnloadFallback } from '~/utils/autosaveUnload'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import { deepCloneJson } from '~/utils/serialization'
import {
  buildSheetSaveBody,
  type SheetApiProfileContext,
} from '~/utils/sheetApiRequests'
import { stablePersistableSheetJson, toPersistableSheetPayload } from '~/utils/sheets/persistence'
import { useApiClient } from './useApiClient'
import { subscribeChannel, type RealtimeEvent } from './useRealtime'
import type { SheetKind } from '#shared/sheets'

export type { SheetKind } from '#shared/sheets'
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface UseEditableSheetOptions {
  /** Milliseconds to wait after the last change before saving. */
  debounceMs?: number
  /** Supplies the current player profile identity for player-owned sheet saves. */
  profileContext?: () => SheetApiProfileContext
  /** Require a selected profile before saving profile-linked private sheets. */
  requiresSelectedPlayerProfile?: () => boolean
}

export interface UseEditableSheetReturn<T> {
  sheet: Ref<T>
  saveStatus: Ref<SaveStatus>
  saveError: Ref<string | null>
  /** Set to the new slug when this sheet was renamed on save or in another tab. */
  renamedTo: Ref<string | null>
  /** Force an immediate save (e.g. on row add/delete you may want it now). */
  saveNow: () => Promise<void>
  /** Cancel any pending debounced save. */
  cancelPendingSave: () => void
}

interface SaveSheetResponse<T> {
  ok: true
  slug?: string
  path?: string
  sheet?: T
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
  const renamedTo = ref<string | null>(null)
  const clientId = getClientId()
  const { postJson } = useApiClient()

  const toPersistedPayload = (value: T): Record<string, unknown> => toPersistableSheetPayload(value)
  const displayNameFor = (value: T): string => {
    const record = value as Record<string, unknown>
    const displayName = kind === 'pokemon' ? record.nickname : record.name
    return typeof displayName === 'string' ? displayName.trim() : ''
  }
  const needsSlugSync = (value: T): boolean => {
    const desiredSlug = slugify(displayNameFor(value))
    return Boolean(desiredSlug && desiredSlug !== value.slug)
  }
  const currentProfileContext = (): SheetApiProfileContext | undefined => options.profileContext?.()
  const requiresSelectedPlayerProfile = (): boolean => options.requiresSelectedPlayerProfile?.() === true
  const buildSaveBody = (payload: Record<string, unknown>): Record<string, unknown> => buildSheetSaveBody({
    kind,
    slug: sheet.value.slug,
    sheet: payload,
    clientId,
    profileContext: currentProfileContext(),
    requireSelectedPlayerProfile: requiresSelectedPlayerProfile(),
  })

  const jsonFor = (value: T): string => stablePersistableSheetJson(value)
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

  let unsubscribe: (() => void) | null = null
  let subscribedSlug: string | null = null

  const handleRealtimeEvent = (event: RealtimeEvent) => {
    if (isRealtimeEcho(event, clientId)) return
    const payload = event.data as
      | { kind?: SheetKind; slug?: string; oldSlug?: string; newSlug?: string; sheet?: T }
      | undefined
    if (event.type === 'updated' && payload?.sheet) {
      const incoming = deepCloneJson(payload.sheet)
      autosave.snapshot.markClean(incoming)
      sheet.value = incoming
      if (incoming.slug) subscribeToSheetSlug(incoming.slug)
      saveStatus.value = 'saved'
    } else if (event.type === 'renamed' && payload?.newSlug) {
      autosave.cancelPendingSave()
      if (payload.sheet) {
        const incoming = deepCloneJson(payload.sheet)
        autosave.snapshot.markClean(incoming)
        sheet.value = incoming
      } else {
        sheet.value.slug = payload.newSlug
        autosave.snapshot.markClean(sheet.value)
      }
      subscribeToSheetSlug(payload.newSlug)
      renamedTo.value = payload.newSlug
      saveStatus.value = 'saved'
    }
  }

  const subscribeToSheetSlug = (nextSlug: string) => {
    if (typeof window === 'undefined' || subscribedSlug === nextSlug) return
    unsubscribe?.()
    subscribedSlug = nextSlug
    unsubscribe = subscribeChannel(sheetChannel(kind, nextSlug), handleRealtimeEvent)
  }

  const cancelPendingSave = () => {
    autosave.cancelPendingSave()
  }

  const performSave = async () => {
    const payload = toPersistedPayload(sheet.value)
    const payloadJson = stablePersistableSheetJson(sheet.value)
    if (autosave.snapshot.isCleanJson(payloadJson) && !needsSlugSync(sheet.value)) {
      if (saveStatus.value === 'saving') autosave.statusController.markSaved()
      return
    }

    await runLatestAutosave({
      guard: autosave.guard,
      status: autosave.statusController,
      save: () => postJson<SaveSheetResponse<T>>(SHEET_API_PATHS.save, buildSaveBody(payload)),
      onSuccess: (result, { latest }) => {
        const persistedSheet = result.sheet ? deepCloneJson(result.sheet) : null
        const persistedSlug = result.slug ?? persistedSheet?.slug
        if (latest && persistedSlug && persistedSlug !== sheet.value.slug) {
          sheet.value.slug = persistedSlug
          subscribeToSheetSlug(persistedSlug)
          renamedTo.value = persistedSlug
        }

        if (persistedSheet) {
          autosave.snapshot.markClean(persistedSheet)
        } else if (persistedSlug && persistedSlug !== payload.slug) {
          autosave.snapshot.markCleanJson(stablePersistableSheetJson({ ...payload, slug: persistedSlug }))
        } else {
          autosave.snapshot.markCleanJson(payloadJson)
        }
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

  if (typeof window !== 'undefined' && needsSlugSync(sheet.value)) {
    saveStatus.value = 'saving'
    void saveNow()
  }

  // Cross-tab sync: replace the editable copy when another tab edits
  // the same sheet on disk. If the file is renamed, follow the new
  // slug's channel without remounting the editor.
  subscribeToSheetSlug(initial.slug)

  const flushWithBeacon = () => {
    if (!hasUnsavedChanges()) return
    autosave.cancelPendingSave()

    const payload = toPersistedPayload(sheet.value)
    const payloadJson = stablePersistableSheetJson(sheet.value)
    let body: string
    try {
      body = JSON.stringify(buildSaveBody(payload))
    } catch (error) {
      saveStatus.value = 'error'
      saveError.value = getErrorMessage(error)
      return
    }

    sendJsonWithUnloadFallback(SHEET_API_PATHS.save, body)

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

  return { sheet, saveStatus, saveError, renamedTo, saveNow, cancelPendingSave }
}
