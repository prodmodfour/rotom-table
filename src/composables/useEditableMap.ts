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
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { getClientId } from '~/utils/clientId'
import { isRealtimeEcho, mapChannel } from '#shared/realtime'
import { createAutosaveResourceController } from '~/utils/autosaveResource'
import { runLatestAutosave } from '~/utils/autosaveSaveRunner'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { clonePersistableMapPayload, stablePersistableMapJson } from '~/utils/maps/persistence'
import { useApiClient } from './useApiClient'
import { useRealtimeChannel } from './useRealtime'
import type { PlayerProfileId } from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'

export type MapSaveStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'not-found'

interface ReadonlyValueRef<T> {
  readonly value: T
}

interface BooleanRef {
  readonly value: boolean
}

export interface UseEditableMapOptions {
  readonly debounceMs?: number
  /**
   * Controls whether mutations to this persisted map ref may write through the
   * local-first whole-map autosave route. External document actions can pause
   * autosave while they adopt server-persisted map responses.
   */
  readonly autosaveEnabled?: BooleanRef
  readonly playerProfileId?: ReadonlyValueRef<PlayerProfileId | null | undefined>
}

export interface UseEditableMapReturn {
  map: Ref<TabletopMap | null>
  status: Ref<MapSaveStatus>
  error: Ref<string | null>
  /** Set to the new slug when this map was renamed in another tab. */
  renamedTo: Ref<string | null>
  saveNow: () => Promise<void>
  reload: () => Promise<void>
  applyPersistedMap: (incoming: TabletopMap) => void
}

const normalizeOptions = (options: number | UseEditableMapOptions): Required<Pick<UseEditableMapOptions, 'debounceMs'>> & {
  readonly autosaveEnabled?: BooleanRef
  readonly playerProfileId?: ReadonlyValueRef<PlayerProfileId | null | undefined>
} => (
  typeof options === 'number'
    ? { debounceMs: options }
    : {
        debounceMs: options.debounceMs ?? 200,
        autosaveEnabled: options.autosaveEnabled,
        playerProfileId: options.playerProfileId,
      }
)

export const useEditableMap = (
  slug: string,
  options: number | UseEditableMapOptions = 200,
): UseEditableMapReturn => {
  const { debounceMs, autosaveEnabled: autosaveEnabledRef, playerProfileId: playerProfileIdRef } = normalizeOptions(options)
  const autosaveEnabled = computed(() => autosaveEnabledRef?.value ?? true)
  const map = ref<TabletopMap | null>(null)
  const status = ref<MapSaveStatus>('loading')
  const error = ref<string | null>(null)
  const renamedTo = ref<string | null>(null)

  const clientId = getClientId()
  const { getJson, postJson } = useApiClient()
  const autosave = createAutosaveResourceController<TabletopMap, MapSaveStatus>({
    refs: { status, error },
    labels: { saving: 'saving', saved: 'saved', error: 'error' },
    serialize: stablePersistableMapJson,
    save: () => performSave(),
    debounceMs,
    markPending: () => {
      status.value = 'saving'
    },
  })

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
    assignIfChanged(target, 'moveUsage', next.moveUsage)
    assignIfChanged(target, 'metadata', next.metadata)
    assignIfChanged(target, 'createdAt', next.createdAt)
    assignIfChanged(target, 'updatedAt', next.updatedAt)
  }

  const applyPersistedMap = (incoming: TabletopMap) => {
    autosave.snapshot.markClean(incoming)
    applyServerMap(incoming)
    status.value = 'idle'
    error.value = null
  }

  const performSave = async () => {
    if (!autosaveEnabled.value || !map.value) return
    const snapshot = clonePersistableMapPayload(map.value)
    const playerProfileId = playerProfileIdRef?.value ?? null

    await runLatestAutosave({
      guard: autosave.guard,
      status: autosave.statusController,
      save: () => postJson<{ map: TabletopMap }>(MAP_API_PATHS.save, {
        slug,
        map: snapshot,
        clientId,
        ...(playerProfileId ? { profileId: playerProfileId } : {}),
      }),
      onSuccess: (result, { latest }) => {
        if (!latest) return
        // Adopt the persisted version (server stamps `updatedAt`).
        autosave.snapshot.markClean(result.map)
        // Splice in the new updatedAt without disturbing other fields the
        // user may have edited mid-flight.
        if (map.value) map.value.updatedAt = result.map.updatedAt
      },
      error: { logPrefix: '[useEditableMap] save failed' },
    })
  }

  const saveNow = async () => {
    if (!autosaveEnabled.value) {
      autosave.cancelPendingSave()
      return
    }
    await autosave.saveNow()
  }

  const reload = async () => {
    status.value = 'loading'
    error.value = null
    try {
      const data = await getJson<{ map: TabletopMap }>(MAP_API_PATHS.load, { params: { slug } })
      applyPersistedMap(data.map)
    } catch (err: unknown) {
      const e = err as { statusCode?: number; statusMessage?: string; message?: string }
      if (e?.statusCode === 404) {
        status.value = 'not-found'
        map.value = null
        return
      }
      autosave.statusController.markError(err, { logPrefix: '[useEditableMap] load failed' })
    }
  }

  watch(
    map,
    (current) => {
      if (!autosaveEnabled.value) return
      autosave.scheduleIfDirty(current)
    },
    { deep: true },
  )

  watch(autosaveEnabled, (enabled) => {
    if (!enabled) {
      autosave.cancelPendingSave()
      return
    }
    autosave.scheduleIfDirty(map.value)
  })

  useRealtimeChannel(mapChannel(slug), (event) => {
    if (isRealtimeEcho(event, clientId)) return
    if (event.type === 'updated' && event.data) {
      const incoming = event.data as TabletopMap
      applyPersistedMap(incoming)
    } else if (event.type === 'deleted') {
      status.value = 'not-found'
      map.value = null
    } else if (event.type === 'renamed' && event.data) {
      const payload = event.data as { newSlug?: string; map?: TabletopMap }
      if (!payload.newSlug) return
      // The file moved on disk — drop any pending save (its slug is
      // gone) and let the page navigate to the new URL.
      autosave.cancelPendingSave()
      if (payload.map) {
        applyPersistedMap(payload.map)
      }
      status.value = 'idle'
      renamedTo.value = payload.newSlug
    }
  })

  onBeforeUnmount(() => {
    if (!autosave.task.hasPending()) return
    // Skip flushing the pending save when the slug was renamed away
    // from us — the old filename no longer exists on disk. Also cancel
    // pending local-first writes while autosave is intentionally paused
    // so external document actions can remain the write authority.
    if (renamedTo.value || !autosaveEnabled.value) {
      autosave.cancelPendingSave()
      return
    }
    void autosave.task.flushPending()
  })

  void reload()

  return { map, status, error, renamedTo, saveNow, reload, applyPersistedMap }
}
