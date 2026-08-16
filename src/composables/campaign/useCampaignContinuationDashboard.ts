import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { breedingRealtimeChannel } from '#shared/breeding/realtime'
import {
  campaignAttentionChannel,
  encountersChannel,
  sheetsChannel,
} from '#shared/realtime'
import { CAMPAIGN_API_PATHS } from '~/utils/apiRoutes'
import {
  applyCampaignContinuationSnapshotResponse,
  beginCampaignContinuationSnapshotRequest,
  createCampaignContinuationSnapshotState,
  resetCampaignContinuationSnapshotContext,
} from '~/utils/campaignContinuationSnapshot'
import { useRealtimeClientPrincipalContext } from '~/utils/realtimeClientPrincipalContext'
import {
  subscribeRealtimeConnection,
  useRealtimeChannel,
} from '~/composables/useRealtime'

export type CampaignContinuationLoadStatus = 'idle' | 'loading' | 'refreshing' | 'ready' | 'error'

const errorMessage = (error: unknown): string => {
  if (typeof error === 'object' && error !== null) {
    const row = error as Record<string, unknown>
    const data = typeof row.data === 'object' && row.data !== null
      ? row.data as Record<string, unknown>
      : null
    for (const value of [data?.statusMessage, data?.message, row.statusMessage, row.message]) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return typeof error === 'string' && error.trim()
    ? error.trim()
    : 'Campaign continuation could not be loaded.'
}

export const useCampaignContinuationDashboard = () => {
  const apiClient = useApiClient()
  const { role } = useAuth()
  const principal = useRealtimeClientPrincipalContext()
  const status = ref<CampaignContinuationLoadStatus>('idle')
  const error = ref<string | null>(null)
  const contextKey = computed(() => principal.contextKey.value ?? role.value ?? 'anonymous')
  const snapshotState = shallowRef(createCampaignContinuationSnapshotState(contextKey.value))
  const projection = computed(() => snapshotState.value.projection)
  let reloadTimer: ReturnType<typeof setTimeout> | null = null

  const busy = computed(() => status.value === 'loading' || status.value === 'refreshing')

  const load = async (options: { readonly silent?: boolean } = {}): Promise<void> => {
    if (role.value !== 'gm' && role.value !== 'player') {
      snapshotState.value = resetCampaignContinuationSnapshotContext(snapshotState.value, 'anonymous')
      status.value = 'idle'
      return
    }
    snapshotState.value = resetCampaignContinuationSnapshotContext(snapshotState.value, contextKey.value)
    const begun = beginCampaignContinuationSnapshotRequest(snapshotState.value)
    snapshotState.value = begun.state
    const generation = begun.requestGeneration
    const requestedContext = contextKey.value
    status.value = projection.value && options.silent === true ? 'refreshing' : 'loading'
    if (options.silent !== true) error.value = null
    try {
      const response = await apiClient.getJson<unknown>(CAMPAIGN_API_PATHS.continuation, {
        params: role.value === 'player'
          ? { profileId: principal.selectedPlayerProfileId.value ?? undefined }
          : undefined,
      })
      if (generation !== snapshotState.value.latestRequestGeneration
        || requestedContext !== snapshotState.value.contextKey) return
      snapshotState.value = applyCampaignContinuationSnapshotResponse({
        current: snapshotState.value,
        contextKey: requestedContext,
        requestGeneration: generation,
        projection: response,
      })
      status.value = 'ready'
      error.value = null
    }
    catch (cause) {
      if (generation !== snapshotState.value.latestRequestGeneration
        || requestedContext !== snapshotState.value.contextKey) return
      status.value = 'error'
      error.value = errorMessage(cause)
    }
  }

  const scheduleReload = (): void => {
    if (reloadTimer !== null) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = null
      void load({ silent: true })
    }, 80)
  }

  useRealtimeChannel(campaignAttentionChannel, scheduleReload)
  useRealtimeChannel(sheetsChannel, scheduleReload)
  useRealtimeChannel(encountersChannel, scheduleReload)
  useRealtimeChannel(breedingRealtimeChannel('gm'), scheduleReload)
  useRealtimeChannel(breedingRealtimeChannel('owner'), scheduleReload)
  useRealtimeChannel(breedingRealtimeChannel('participating-owner'), scheduleReload)
  useRealtimeChannel(breedingRealtimeChannel('public'), scheduleReload)
  const unsubscribeConnection = subscribeRealtimeConnection((change) => {
    if (change.state === 'connected' && (change.reconnected || change.reason === 'replay-caught-up')) {
      scheduleReload()
    }
    if (change.reason === 'reconcile-required') scheduleReload()
  })

  watch(contextKey, (next, previous) => {
    if (next === previous) return
    snapshotState.value = resetCampaignContinuationSnapshotContext(snapshotState.value, next)
    error.value = null
    status.value = 'idle'
    void load()
  })

  onBeforeUnmount(() => {
    unsubscribeConnection()
    if (reloadTimer !== null) clearTimeout(reloadTimer)
  })

  return {
    projection,
    status,
    error,
    busy,
    load,
    refresh: () => load(),
  }
}
