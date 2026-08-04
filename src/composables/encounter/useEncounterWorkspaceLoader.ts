import { computed, onBeforeUnmount, onMounted, readonly, ref, watch, type Ref } from 'vue'
import type { EncounterWorkspaceViewModel } from '#shared/encounterWorkspace/model'
import {
  encounterWorkspaceAdoptionCursor,
  planEncounterWorkspaceAdoption,
  type EncounterWorkspaceAdoptionSource,
} from '#shared/encounterWorkspace/adoption'
import { ENCOUNTER_WORKSPACE_API_PATHS } from '~/utils/apiRoutes'
import {
  ENCOUNTER_DOCUMENT_REALTIME_EVENT_TYPES,
  encounterChannel,
  type RealtimeEvent,
} from '#shared/realtime'
import { subscribeChannel } from '~/composables/useRealtime'

export type EncounterWorkspaceLoadStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'inaccessible'
  | 'stale'
  | 'error'

const errorStatusCode = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { statusCode?: unknown, status?: unknown, response?: { status?: unknown } }
  const value = candidate.statusCode ?? candidate.status ?? candidate.response?.status
  return typeof value === 'number' ? value : null
}

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'The authoritative encounter workspace could not be loaded.'
}

export const useEncounterWorkspaceLoader = (input: {
  readonly mapSlug: Ref<string> | Readonly<Ref<string>>
  readonly audience?: Ref<string | null> | Readonly<Ref<string | null>>
  readonly refreshIntervalMs?: number
}) => {
  const { isPlayer } = useAuth()
  const profiles = usePlayerProfiles()
  const { getJson } = useApiClient()
  const workspace = ref<EncounterWorkspaceViewModel | null>(null)
  const status = ref<EncounterWorkspaceLoadStatus>('idle')
  const message = ref<string | null>(null)
  const connection = ref<'connected' | 'reconnecting' | 'offline'>('connected')
  const mounted = ref(false)
  let requestSequence = 0
  let refreshTimer: ReturnType<typeof setInterval> | null = null
  let unsubscribeEncounter: (() => void) | null = null

  const load = async (source: EncounterWorkspaceAdoptionSource = 'reload'): Promise<void> => {
    const sequence = ++requestSequence
    if (!workspace.value) status.value = 'loading'
    message.value = null
    try {
      const incoming = await getJson<EncounterWorkspaceViewModel>(ENCOUNTER_WORKSPACE_API_PATHS.load, {
        params: {
          slug: input.mapSlug.value,
          profileId: isPlayer.value ? profiles.selectedProfileId.value : null,
          audience: input.audience?.value ?? null,
        },
      })
      if (sequence !== requestSequence) return
      const plan = planEncounterWorkspaceAdoption({
        current: workspace.value ? encounterWorkspaceAdoptionCursor(workspace.value) : null,
        incoming,
        source,
      })
      if (plan.kind === 'reject') {
        status.value = workspace.value ? 'stale' : 'error'
        message.value = 'The response belongs to a different battlefield. Reload this encounter.'
        return
      }
      if (plan.kind === 'adopt') workspace.value = incoming
      connection.value = incoming.system.connection === 'ready' ? 'connected' : 'reconnecting'
      status.value = incoming.participants.length === 0 ? 'empty' : 'ready'
    }
    catch (error) {
      if (sequence !== requestSequence) return
      const code = errorStatusCode(error)
      if (code === 401 || code === 403 || code === 404) {
        status.value = 'inaccessible'
      }
      else {
        status.value = workspace.value ? 'stale' : 'error'
      }
      message.value = errorMessage(error)
      connection.value = navigator.onLine ? 'reconnecting' : 'offline'
    }
  }

  const handleEncounterRealtime = (event: RealtimeEvent): void => {
    if (event.type !== ENCOUNTER_DOCUMENT_REALTIME_EVENT_TYPES.CREATED
      && event.type !== ENCOUNTER_DOCUMENT_REALTIME_EVENT_TYPES.UPDATED) return
    const currentRevision = workspace.value?.source.encounterRevision
    if (typeof event.revision === 'number' && currentRevision !== null && currentRevision !== undefined
      && event.revision <= currentRevision) return
    void load('reconnect')
  }
  const subscribeEncounter = (): void => {
    unsubscribeEncounter?.()
    unsubscribeEncounter = subscribeChannel(encounterChannel(input.mapSlug.value), handleEncounterRealtime)
  }

  const handleOnline = (): void => {
    connection.value = 'reconnecting'
    void load('reconnect')
  }
  const handleOffline = (): void => {
    connection.value = 'offline'
    if (workspace.value) status.value = 'stale'
    message.value = 'Connection lost. Commands remain unavailable until the encounter is reconciled.'
  }
  const handleVisibility = (): void => {
    if (document.visibilityState === 'visible') void load('reconnect')
  }

  onMounted(async () => {
    mounted.value = true
    subscribeEncounter()
    if (isPlayer.value) {
      profiles.loadRememberedProfile()
      try {
        await profiles.reloadProfiles({ silent: true, clearMissingSelection: true })
      }
      catch {
        // The workspace request below owns the visible inaccessible/error state.
      }
    }
    await load('initial')
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibility)
    const interval = Math.max(5_000, input.refreshIntervalMs ?? 15_000)
    refreshTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void load('reconnect')
    }, interval)
  })

  onBeforeUnmount(() => {
    requestSequence += 1
    if (refreshTimer) clearInterval(refreshTimer)
    unsubscribeEncounter?.()
    unsubscribeEncounter = null
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    document.removeEventListener('visibilitychange', handleVisibility)
  })

  watch([input.mapSlug, () => profiles.selectedProfileId.value, input.audience ?? ref(null)], ([nextEncounterId], [previousEncounterId]) => {
    if (!mounted.value) return
    if (nextEncounterId !== previousEncounterId) subscribeEncounter()
    void load('back-forward')
  })

  return Object.freeze({
    workspace: readonly(workspace),
    status: readonly(status),
    message: readonly(message),
    connection: readonly(connection),
    selectedProfileId: readonly(profiles.selectedProfileId),
    commandsBlocked: computed(() => (
      connection.value !== 'connected'
      || status.value === 'stale'
      || workspace.value?.system.commandsBlocked === true
    )),
    refresh: () => load('reload'),
  })
}
