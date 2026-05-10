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
 *   • Edits in *other* tabs/devices arrive as SSE events; we patch
 *     the local reactive map in place and update our "last server snapshot"
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
import { mapChannel } from '~/shared/realtime'
import {
  createAutosaveSnapshotTracker,
  createAutosaveStatusController,
  createDebouncedAutosaveTask,
  createLatestSaveGuard,
  runLatestAutosave,
} from '~/utils/autosave'
import { deepCloneJson, sameJsonValue, stableJsonStringify } from '~/utils/serialization'
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

export const useEditableMap = (slug: string, debounceMs = 200): UseEditableMapReturn => {
  const map = ref<TabletopMap | null>(null)
  const status = ref<MapSaveStatus>('loading')
  const error = ref<string | null>(null)
  const renamedTo = ref<string | null>(null)

  const autosaveStatus = createAutosaveStatusController<MapSaveStatus>(
    { status, error },
    { saving: 'saving', saved: 'saved', error: 'error' },
  )
  const serverSnapshot = createAutosaveSnapshotTracker<TabletopMap>(stableJsonStringify)
  const clientId = getClientId()
  const saveGuard = createLatestSaveGuard()
  const saveTask = createDebouncedAutosaveTask(() => performSave(), debounceMs)

  const assignIfChanged = <K extends keyof TabletopMap>(
    target: TabletopMap,
    key: K,
    value: TabletopMap[K],
  ) => {
    if (sameJsonValue(target[key], value)) return
    const targetRecord = target as unknown as Record<string, unknown>
    if (value === undefined) {
      delete targetRecord[key as string]
      return
    }
    targetRecord[key as string] = value
  }

  const applyServerMap = (incoming: TabletopMap) => {
    const next = deepCloneJson(incoming)
    if (!map.value) {
      map.value = next
      return
    }

    // Keep the root map object stable so realtime updates feel like live
    // edits instead of a component-level reload. Assign the heavyweight
    // arrays only when their semantic contents changed; token movement
    // events should not force the terrain renderer to rebuild thousands
    // of voxel instances.
    const target = map.value
    target.schemaVersion = next.schemaVersion
    target.slug = next.slug
    target.name = next.name
    if (next.folder === undefined) delete target.folder
    else target.folder = next.folder

    if (!target.dimensions) {
      target.dimensions = next.dimensions
    } else {
      if (target.dimensions.x !== next.dimensions.x) target.dimensions.x = next.dimensions.x
      if (target.dimensions.y !== next.dimensions.y) target.dimensions.y = next.dimensions.y
      if (target.dimensions.z !== next.dimensions.z) target.dimensions.z = next.dimensions.z
    }

    if (next.groundLevelY === undefined) delete target.groundLevelY
    else target.groundLevelY = next.groundLevelY

    if (next.playerVisible === undefined) delete target.playerVisible
    else target.playerVisible = next.playerVisible

    assignIfChanged(target, 'voxels', next.voxels)
    assignIfChanged(target, 'hazards', next.hazards)
    assignIfChanged(target, 'fieldEffects', next.fieldEffects)
    assignIfChanged(target, 'placements', next.placements)
    assignIfChanged(target, 'lights', next.lights)
    assignIfChanged(target, 'initiative', next.initiative)
    assignIfChanged(target, 'metadata', next.metadata)
    assignIfChanged(target, 'createdAt', next.createdAt)
    assignIfChanged(target, 'updatedAt', next.updatedAt)
  }

  const performSave = async () => {
    if (!map.value) return
    const snapshot: TabletopMap = JSON.parse(JSON.stringify(map.value))

    await runLatestAutosave({
      guard: saveGuard,
      status: autosaveStatus,
      save: () =>
        $fetch<{ map: TabletopMap }>('/api/maps/save', {
          method: 'POST',
          body: { slug, map: snapshot, clientId },
        }),
      onSuccess: (result, { latest }) => {
        if (!latest) return
        // Adopt the persisted version (server stamps `updatedAt`).
        serverSnapshot.markClean(result.map)
        // Splice in the new updatedAt without disturbing other fields the
        // user may have edited mid-flight.
        if (map.value) map.value.updatedAt = result.map.updatedAt
      },
      error: { logPrefix: '[useEditableMap] save failed' },
    })
  }

  const saveNow = async () => {
    await saveTask.runNow()
  }

  const reload = async () => {
    status.value = 'loading'
    error.value = null
    try {
      const data = await $fetch<{ map: TabletopMap }>('/api/maps/load', { params: { slug } })
      serverSnapshot.markClean(data.map)
      applyServerMap(data.map)
      status.value = 'idle'
    } catch (err: unknown) {
      const e = err as { statusCode?: number; statusMessage?: string; message?: string }
      if (e?.statusCode === 404) {
        status.value = 'not-found'
        map.value = null
        return
      }
      autosaveStatus.markError(err, { logPrefix: '[useEditableMap] load failed' })
    }
  }

  watch(
    map,
    (current) => {
      if (!current) return
      if (serverSnapshot.isClean(current)) return
      status.value = 'saving'
      saveTask.schedule()
    },
    { deep: true },
  )

  useRealtimeChannel(mapChannel(slug), (event) => {
    if (event.clientId === clientId) return
    if (event.type === 'updated' && event.data) {
      const incoming = event.data as TabletopMap
      serverSnapshot.markClean(incoming)
      applyServerMap(incoming)
      status.value = 'idle'
    } else if (event.type === 'deleted') {
      status.value = 'not-found'
      map.value = null
    } else if (event.type === 'renamed' && event.data) {
      const payload = event.data as { newSlug?: string; map?: TabletopMap }
      if (!payload.newSlug) return
      // The file moved on disk — drop any pending save (its slug is
      // gone) and let the page navigate to the new URL.
      saveTask.cancel()
      if (payload.map) {
        serverSnapshot.markClean(payload.map)
        applyServerMap(payload.map)
      }
      status.value = 'idle'
      renamedTo.value = payload.newSlug
    }
  })

  onBeforeUnmount(() => {
    if (!saveTask.hasPending()) return
    // Skip flushing the pending save when the slug was renamed away
    // from us — the old filename no longer exists on disk.
    if (renamedTo.value) {
      saveTask.cancel()
      return
    }
    void saveTask.flushPending()
  })

  void reload()

  return { map, status, error, renamedTo, saveNow, reload }
}
