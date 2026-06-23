/**
 * useEditableMap — reactive wrapper around a saved map document.
 *
 * This composable supports map loading/realtime adoption plus explicit GM
 * setup/edit document saves. It is not the live gameplay authority model:
 * live multiplayer mutations must use server-authoritative commands with
 * revisions, `opId` idempotency, and authoritative patches/results.
 *
 * Loads the map from `/api/maps/load`, debounces setup/edit saves through
 * `/api/maps/save` only when `interactionMode` is `setup-edit`, and syncs
 * with other tabs/devices via the `/api/events`
 * SSE stream:
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
 * This whole-document flow has last-writer-wins characteristics and must not
 * be reused as live multiplayer conflict resolution.
 */
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { getClientId } from '~/utils/clientId'
import { MAP_INTERACTION_MODES, type MapInteractionMode } from '#shared/mapInteractionMode'
import {
  LIVE_PLAY_REALTIME_EVENT_TYPES,
  isRealtimeEcho,
  mapChannel,
  type RealtimeEvent,
} from '#shared/realtime'
import { normalizeRevision } from '#shared/sessionRevisions'
import { createAutosaveResourceController } from '~/utils/autosaveResource'
import { runLatestAutosave } from '~/utils/autosaveSaveRunner'
import { bindAutosaveUnloadFlushers, sendSetupEditJsonWithUnloadFallback } from '~/utils/autosaveUnload'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { clonePersistableMapPayload, stablePersistableMapJson } from '~/utils/maps/persistence'
import { applyLivePlayPatchesToMap } from '~/utils/livePlayPatches'
import { useApiClient } from './useApiClient'
import { subscribeRealtimeConnection, useRealtimeChannel } from './useRealtime'
import type { PlayerProfileId } from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'

export type MapSaveStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'not-found'
export type MapRealtimeReconciliationStatus = 'synced' | 'reconnecting' | 'reconciling' | 'reconciled' | 'error'

interface ReadonlyValueRef<T> {
  readonly value: T
}

interface BooleanRef {
  readonly value: boolean
}

interface MapSaveBody {
  slug: string
  map: TabletopMap
  clientId: string
  interactionMode: MapInteractionMode
  profileId?: PlayerProfileId
}

export interface UseEditableMapOptions {
  readonly debounceMs?: number
  /**
   * Explicitly declares which interaction surface owns current mutations.
   * Whole-map autosave is enabled only for `setup-edit`; omitted modes default
   * to `live-play` so normal gameplay cannot accidentally call `/api/maps/save`.
   */
  readonly interactionMode?: ReadonlyValueRef<MapInteractionMode>
  /**
   * Additional setup/edit autosave switch. External document actions can pause
   * autosave while they adopt server-persisted map responses, but this cannot
   * override live-play mode into whole-map saving.
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
  /**
   * Runtime-only revision that increments when a full persisted map payload is
   * adopted or the loaded map is cleared. Scene-local transient state can watch
   * this without treating autosave timestamp updates as a full map reload.
   */
  mapDataRevision: Ref<number>
  /** Current authoritative map document revision for live-play command baseRevision values. */
  mapRevision: Readonly<Ref<number>>
  /** Realtime/reload reconciliation state for user-visible live-play connection notices. */
  realtimeReconciliationStatus: Ref<MapRealtimeReconciliationStatus>
  /** True while local live-play commands must wait for authoritative reconciliation. */
  livePlayCommandsBlocked: Readonly<Ref<boolean>>
  /** Short user-facing realtime reconciliation notice, if any. */
  livePlayRealtimeNotice: Readonly<Ref<string | null>>
  saveNow: () => Promise<void>
  reload: () => Promise<void>
  applyPersistedMap: (incoming: TabletopMap) => void
}

const normalizeOptions = (options: number | UseEditableMapOptions): Required<Pick<UseEditableMapOptions, 'debounceMs'>> & {
  readonly interactionMode?: ReadonlyValueRef<MapInteractionMode>
  readonly autosaveEnabled?: BooleanRef
  readonly playerProfileId?: ReadonlyValueRef<PlayerProfileId | null | undefined>
} => (
  typeof options === 'number'
    ? { debounceMs: options }
    : {
        debounceMs: options.debounceMs ?? 200,
        interactionMode: options.interactionMode,
        autosaveEnabled: options.autosaveEnabled,
        playerProfileId: options.playerProfileId,
      }
)

export const useEditableMap = (
  slug: string,
  options: number | UseEditableMapOptions = 200,
): UseEditableMapReturn => {
  const {
    debounceMs,
    interactionMode: interactionModeRef,
    autosaveEnabled: autosaveEnabledRef,
    playerProfileId: playerProfileIdRef,
  } = normalizeOptions(options)
  const currentInteractionMode = (): MapInteractionMode => interactionModeRef?.value ?? MAP_INTERACTION_MODES.LIVE_PLAY
  const setupEditMode = computed(() => currentInteractionMode() === MAP_INTERACTION_MODES.SETUP_EDIT)
  const setupEditAutosaveRequested = computed(() => autosaveEnabledRef?.value ?? true)
  const setupEditAutosaveEnabled = computed(() => setupEditMode.value && setupEditAutosaveRequested.value)
  const map = ref<TabletopMap | null>(null)
  const status = ref<MapSaveStatus>('loading')
  const error = ref<string | null>(null)
  const renamedTo = ref<string | null>(null)
  const mapDataRevision = ref(0)
  const realtimeReconciliationStatus = ref<MapRealtimeReconciliationStatus>('synced')
  const mapRevision = computed(() => normalizeRevision(map.value?.revision))
  const livePlayCommandsBlocked = computed(() => (
    realtimeReconciliationStatus.value === 'reconnecting'
    || realtimeReconciliationStatus.value === 'reconciling'
    || realtimeReconciliationStatus.value === 'error'
  ))
  const livePlayRealtimeNotice = computed(() => {
    const revision = mapRevision.value
    switch (realtimeReconciliationStatus.value) {
      case 'reconnecting':
        return 'Realtime connection lost. Reconnecting before more live-play commands are sent.'
      case 'reconciling':
        return 'Reconnected. Reloading the authoritative map before live play resumes.'
      case 'reconciled':
        return `Live play reconciled at map revision ${revision}.`
      case 'error':
        return 'Realtime reconciliation failed. Reload the map before sending more live-play commands.'
      default:
        return null
    }
  })

  const clientId = getClientId()
  const { getJson, postJson } = useApiClient()
  const currentPlayerProfileId = (): PlayerProfileId | null => playerProfileIdRef?.value ?? null
  const buildMapSaveBody = (snapshot: TabletopMap): MapSaveBody => {
    const playerProfileId = currentPlayerProfileId()
    return {
      slug,
      map: snapshot,
      clientId,
      interactionMode: currentInteractionMode(),
      ...(playerProfileId ? { profileId: playerProfileId } : {}),
    }
  }
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
    next.revision = normalizeRevision(next.revision)
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
    target.revision = normalizeRevision(next.revision)
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
    assignIfChanged(target, 'activeScene', next.activeScene)
    assignIfChanged(target, 'temporaryHitPoints', next.temporaryHitPoints)
    assignIfChanged(target, 'moveUsage', next.moveUsage)
    assignIfChanged(target, 'metadata', next.metadata)
    assignIfChanged(target, 'createdAt', next.createdAt)
    assignIfChanged(target, 'updatedAt', next.updatedAt)
  }

  const documentRevision = (candidate: TabletopMap | null | undefined): number | null => {
    if (!candidate || !Object.prototype.hasOwnProperty.call(candidate, 'revision')) return null
    return normalizeRevision(candidate.revision)
  }

  const isStalePersistedMap = (incoming: TabletopMap): boolean => {
    const incomingRevision = documentRevision(incoming)
    const currentRevision = documentRevision(map.value)
    return incomingRevision !== null && currentRevision !== null && incomingRevision < currentRevision
  }

  const eventRevision = (event: Pick<RealtimeEvent, 'revision' | 'data'>): number | null => {
    if (typeof event.revision === 'number') return normalizeRevision(event.revision)
    return documentRevision(event.data as TabletopMap | null | undefined)
  }

  const eventPreviousRevision = (event: Pick<RealtimeEvent, 'previousRevision'>): number | null => (
    typeof event.previousRevision === 'number' ? normalizeRevision(event.previousRevision) : null
  )

  const revisionGapRequiresReconcile = (event: Pick<RealtimeEvent, 'revision' | 'previousRevision' | 'data'>): boolean => {
    const incomingRevision = eventRevision(event)
    if (incomingRevision === null) return false
    const currentRevision = documentRevision(map.value)
    if (currentRevision === null || incomingRevision <= currentRevision) return false

    const previousRevision = eventPreviousRevision(event)
    if (previousRevision !== null) return previousRevision !== currentRevision
    return incomingRevision > currentRevision + 1
  }

  const applyPersistedMap = (incoming: TabletopMap) => {
    if (isStalePersistedMap(incoming)) return
    // A full persisted map response/event is authoritative for setup/edit or
    // reconciliation. Cancel any queued whole-map write so adopting server
    // state does not echo the same document back through `/api/maps/save` a
    // debounce later.
    autosave.cancelPendingSave()
    autosave.snapshot.markClean(incoming)
    applyServerMap(incoming)
    mapDataRevision.value += 1
    status.value = 'idle'
    error.value = null
  }

  const performSave = async () => {
    if (!setupEditAutosaveEnabled.value || !map.value) return
    if (autosave.snapshot.isClean(map.value)) {
      if (status.value === 'saving') autosave.statusController.markSaved()
      return
    }

    const snapshot = clonePersistableMapPayload(map.value)

    await runLatestAutosave({
      guard: autosave.guard,
      status: autosave.statusController,
      save: () => postJson<{ map: TabletopMap }>(MAP_API_PATHS.save, buildMapSaveBody(snapshot)),
      onSuccess: (result, { latest }) => {
        if (!latest || isStalePersistedMap(result.map)) return
        // Adopt the persisted version (server stamps `updatedAt` and revision).
        autosave.snapshot.markClean(result.map)
        // Splice in server-owned metadata without disturbing other fields the
        // user may have edited mid-flight.
        if (map.value) {
          map.value.revision = normalizeRevision(result.map.revision)
          map.value.updatedAt = result.map.updatedAt
        }
      },
      error: { logPrefix: '[useEditableMap] save failed' },
    })
  }

  const saveNow = async () => {
    if (!setupEditAutosaveEnabled.value) {
      autosave.cancelPendingSave()
      if (!setupEditMode.value && map.value) autosave.snapshot.markClean(map.value)
      return
    }
    await autosave.saveNow()
  }

  const reload = async () => {
    status.value = 'loading'
    error.value = null
    try {
      const data = await getJson<{ map: TabletopMap; revision?: number }>(MAP_API_PATHS.load, { params: { slug } })
      applyPersistedMap({
        ...data.map,
        revision: data.revision ?? data.map.revision,
      })
    } catch (err: unknown) {
      const e = err as { statusCode?: number; statusMessage?: string; message?: string }
      if (e?.statusCode === 404) {
        status.value = 'not-found'
        map.value = null
        mapDataRevision.value += 1
        return
      }
      autosave.statusController.markError(err, { logPrefix: '[useEditableMap] load failed' })
    }
  }

  let reconciliationSequence = 0
  const reconcileAuthoritativeMap = async () => {
    const sequence = ++reconciliationSequence
    realtimeReconciliationStatus.value = 'reconciling'
    await reload()
    if (sequence !== reconciliationSequence) return
    realtimeReconciliationStatus.value = status.value === 'error' || status.value === 'not-found'
      ? 'error'
      : 'reconciled'
  }

  watch(
    map,
    (current) => {
      if (!setupEditMode.value) {
        autosave.cancelPendingSave()
        if (current) autosave.snapshot.markClean(current)
        if (status.value === 'saving') status.value = 'idle'
        return
      }
      if (!setupEditAutosaveRequested.value) return
      autosave.scheduleIfDirty(current)
    },
    { deep: true },
  )

  watch(setupEditAutosaveEnabled, (enabled) => {
    if (!enabled) {
      autosave.cancelPendingSave()
      if (!setupEditMode.value && map.value) {
        autosave.snapshot.markClean(map.value)
        if (status.value === 'saving') status.value = 'idle'
      }
      return
    }
    autosave.scheduleIfDirty(map.value)
  })

  const hasUnsavedChanges = (): boolean => (
    map.value !== null && autosave.snapshot.isDirty(map.value)
  )

  const flushWithBeacon = () => {
    if (!setupEditAutosaveEnabled.value || !map.value) return

    let dirty: boolean
    try {
      dirty = hasUnsavedChanges()
    } catch (err) {
      status.value = 'error'
      error.value = getErrorMessage(err)
      return
    }
    if (!dirty) return

    autosave.cancelPendingSave()

    let body: string
    let payloadJson: string
    try {
      const snapshot = clonePersistableMapPayload(map.value)
      body = JSON.stringify(buildMapSaveBody(snapshot))
      payloadJson = stablePersistableMapJson(map.value)
    } catch (err) {
      status.value = 'error'
      error.value = getErrorMessage(err)
      return
    }

    sendSetupEditJsonWithUnloadFallback(MAP_API_PATHS.save, body)

    // Treat this tab as clean once the unload request was attempted so
    // `beforeunload` + `pagehide` do not queue duplicate whole-map writes.
    autosave.snapshot.markCleanJson(payloadJson)
    status.value = 'saved'
    error.value = null
  }

  let removeUnloadFlushers: (() => void) | null = bindAutosaveUnloadFlushers(flushWithBeacon)

  const handleRealtimeMapEvent = (event: RealtimeEvent) => {
    if (isRealtimeEcho(event, clientId)) return
    const incomingRevision = eventRevision(event)
    const currentRevision = documentRevision(map.value)
    if (incomingRevision !== null && currentRevision !== null && incomingRevision < currentRevision) return

    if (event.type === 'updated' && event.data) {
      if (revisionGapRequiresReconcile(event)) {
        void reconcileAuthoritativeMap()
        return
      }
      const incoming = event.data as TabletopMap
      applyPersistedMap(incoming)
    } else if (event.type === LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED) {
      if (incomingRevision === null || !event.patches?.length) {
        void reconcileAuthoritativeMap()
        return
      }
      if (currentRevision !== null && incomingRevision <= currentRevision) return
      if (revisionGapRequiresReconcile(event)) {
        void reconcileAuthoritativeMap()
        return
      }

      const patchResult = applyLivePlayPatchesToMap({
        map: map.value,
        mapSlug: (event as { mapSlug?: string }).mapSlug ?? slug,
        previousRevision: event.previousRevision,
        revision: incomingRevision,
        patches: event.patches,
      })
      if (!patchResult.ok) {
        console.warn('[useEditableMap] live-play patch reconcile required', patchResult.message)
        void reconcileAuthoritativeMap()
        return
      }
      if (patchResult.applied && map.value) {
        autosave.cancelPendingSave()
        autosave.snapshot.markClean(map.value)
        status.value = 'idle'
        error.value = null
      }
    } else if (event.type === LIVE_PLAY_REALTIME_EVENT_TYPES.MAP_RECONCILED) {
      if (event.data && !revisionGapRequiresReconcile(event)) {
        applyPersistedMap(event.data as TabletopMap)
        realtimeReconciliationStatus.value = 'reconciled'
        return
      }
      if (incomingRevision !== null && currentRevision !== null && incomingRevision > currentRevision) {
        void reconcileAuthoritativeMap()
      }
    } else if (event.type === 'deleted') {
      status.value = 'not-found'
      map.value = null
      mapDataRevision.value += 1
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
  }

  const removeRealtimeConnection = subscribeRealtimeConnection((change) => {
    if (change.state === 'reconnecting') {
      realtimeReconciliationStatus.value = 'reconnecting'
      return
    }
    if (change.state === 'connected' && change.reconnected) {
      void reconcileAuthoritativeMap()
    }
  })

  useRealtimeChannel(mapChannel(slug), handleRealtimeMapEvent)

  onBeforeUnmount(() => {
    removeRealtimeConnection()
    removeUnloadFlushers?.()
    removeUnloadFlushers = null

    if (!autosave.task.hasPending()) return
    // Skip flushing the pending save when the slug was renamed away
    // from us — the old filename no longer exists on disk. Also cancel
    // pending document-backed writes while autosave is intentionally paused
    // or the page is in live-play mode so external command/action paths remain
    // the write authority.
    if (renamedTo.value || !setupEditAutosaveEnabled.value) {
      autosave.cancelPendingSave()
      return
    }
    void autosave.task.flushPending()
  })

  void reload()

  return {
    map,
    status,
    error,
    renamedTo,
    mapDataRevision,
    mapRevision,
    realtimeReconciliationStatus,
    livePlayCommandsBlocked,
    livePlayRealtimeNotice,
    saveNow,
    reload,
    applyPersistedMap,
  }
}
