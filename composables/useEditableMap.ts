/**
 * useEditableMap — reactive wrapper around a saved map document.
 *
 * Loads the map from `/api/maps/load`, debounces saves through
 * `/api/maps/save`, and syncs with other tabs/devices via the
 * `/api/events` SSE stream:
 *
 *   • Edits in *this* tab mutate the reactive ref → deep watcher
 *     debounces a save → the server broadcasts the post-save state
 *     back to every subscriber on `map:<slug>`. Echoes from this
 *     same tab (matched by `clientId`) are dropped.
 *   • Edits in *other* tabs/devices arrive as SSE events; we replace
 *     the local ref's contents and update our "last server snapshot"
 *     so the watcher doesn't trigger a redundant save.
 *   • If another tab renames the map (so the slug changes on disk),
 *     we set `renamedTo` so the page can navigate to the new URL.
 *
 * Conflict resolution is last-writer-wins: simultaneous edits in two
 * tabs may overwrite each other within the ~200 ms debounce window,
 * which is acceptable for a single-user dev tool.
 */
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { getClientId } from '~/utils/clientId'
import { useRealtimeChannel } from './useRealtime'
import type { TabletopMap } from '~/types/map'

export type MapSaveStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'not-found'

export interface UseEditableMapReturn {
  map: Ref<TabletopMap | null>
  status: Ref<MapSaveStatus>
  error: Ref<string | null>
  /** Set to the new slug when this map was renamed in another tab. */
  renamedTo: Ref<string | null>
  saveNow: () => Promise<void>
  reload: () => Promise<void>
}

const stableJson = (value: unknown): string => JSON.stringify(value)

export const useEditableMap = (slug: string, debounceMs = 200): UseEditableMapReturn => {
  const map = ref<TabletopMap | null>(null)
  const status = ref<MapSaveStatus>('loading')
  const error = ref<string | null>(null)
  const renamedTo = ref<string | null>(null)

  let lastServerJson = ''
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  let saveSeq = 0
  const clientId = getClientId()

  const cancelPending = () => {
    if (pendingTimer != null) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
  }

  const performSave = async () => {
    cancelPending()
    if (!map.value) return
    const seq = ++saveSeq
    const snapshot: TabletopMap = JSON.parse(JSON.stringify(map.value))
    status.value = 'saving'
    error.value = null
    try {
      const result = await $fetch<{ map: TabletopMap }>('/api/maps/save', {
        method: 'POST',
        body: { slug, map: snapshot, clientId },
      })
      if (seq !== saveSeq) return
      // Adopt the persisted version (server stamps `updatedAt`).
      lastServerJson = stableJson(result.map)
      // Splice in the new updatedAt without disturbing other fields the
      // user may have edited mid-flight.
      if (map.value) map.value.updatedAt = result.map.updatedAt
      status.value = 'saved'
    } catch (err: unknown) {
      if (seq !== saveSeq) return
      status.value = 'error'
      const e = err as { statusMessage?: string; data?: { statusMessage?: string }; message?: string }
      error.value = e?.statusMessage ?? e?.data?.statusMessage ?? e?.message ?? String(err)
      console.error('[useEditableMap] save failed', err)
    }
  }

  const saveNow = async () => {
    cancelPending()
    await performSave()
  }

  const reload = async () => {
    status.value = 'loading'
    error.value = null
    try {
      const data = await $fetch<{ map: TabletopMap }>('/api/maps/load', { params: { slug } })
      lastServerJson = stableJson(data.map)
      map.value = data.map
      status.value = 'idle'
    } catch (err: unknown) {
      const e = err as { statusCode?: number; statusMessage?: string; message?: string }
      if (e?.statusCode === 404) {
        status.value = 'not-found'
        map.value = null
        return
      }
      status.value = 'error'
      error.value = e?.statusMessage ?? e?.message ?? String(err)
      console.error('[useEditableMap] load failed', err)
    }
  }

  watch(
    map,
    (current) => {
      if (!current) return
      const json = stableJson(current)
      if (json === lastServerJson) return
      cancelPending()
      status.value = 'saving'
      pendingTimer = setTimeout(() => {
        pendingTimer = null
        void performSave()
      }, debounceMs)
    },
    { deep: true },
  )

  useRealtimeChannel(`map:${slug}`, (event) => {
    if (event.clientId === clientId) return
    if (event.type === 'updated' && event.data) {
      const incoming = event.data as TabletopMap
      lastServerJson = stableJson(incoming)
      map.value = incoming
      status.value = 'idle'
    } else if (event.type === 'deleted') {
      status.value = 'not-found'
      map.value = null
    } else if (event.type === 'renamed' && event.data) {
      const payload = event.data as { newSlug?: string; map?: TabletopMap }
      if (!payload.newSlug) return
      // The file moved on disk — drop any pending save (its slug is
      // gone) and let the page navigate to the new URL.
      cancelPending()
      if (payload.map) {
        lastServerJson = stableJson(payload.map)
        map.value = payload.map
      }
      status.value = 'idle'
      renamedTo.value = payload.newSlug
    }
  })

  onBeforeUnmount(() => {
    if (pendingTimer != null) {
      cancelPending()
      // Skip flushing the pending save when the slug was renamed away
      // from us — the old filename no longer exists on disk.
      if (!renamedTo.value) void performSave()
    }
  })

  void reload()

  return { map, status, error, renamedTo, saveNow, reload }
}
