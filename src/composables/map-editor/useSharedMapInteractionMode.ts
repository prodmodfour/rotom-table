import { ref, type Ref } from 'vue'
import {
  DEFAULT_MAP_INTERACTION_MODE,
  MAP_INTERACTION_MODE_REALTIME_EVENT_TYPE,
  isMapInteractionMode,
  parseMapInteractionMode,
  type MapInteractionMode,
  type MapInteractionModeRealtimePayload,
} from '#shared/mapInteractionMode'
import { isRealtimeEcho, mapChannel, type RealtimeEvent } from '#shared/realtime'
import { useApiClient } from '~/composables/useApiClient'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { useRealtimeChannel } from '~/composables/useRealtime'

export type SharedMapInteractionModeStatus = 'loading' | 'idle' | 'saving' | 'error'

export interface SharedMapInteractionModeResponse {
  readonly slug: string
  readonly interactionMode: MapInteractionMode
  readonly updatedAt: number
  readonly previousInteractionMode?: MapInteractionMode
  readonly syncedMapForLivePlay?: boolean
}

export interface ApplyAuthoritativeMapInteractionModeInput {
  readonly slug: string
  readonly interactionMode: MapInteractionMode
  readonly updatedAt: number
}

export interface UseSharedMapInteractionModeOptions {
  readonly autoLoad?: boolean
}

export interface UseSharedMapInteractionModeReturn {
  readonly interactionMode: Ref<MapInteractionMode>
  readonly status: Ref<SharedMapInteractionModeStatus>
  readonly error: Ref<string | null>
  readonly updatedAt: Ref<number>
  readonly load: () => Promise<void>
  readonly setInteractionMode: (mode: MapInteractionMode) => Promise<void>
  readonly applyAuthoritativeMode: (state: ApplyAuthoritativeMapInteractionModeInput) => void
}

const isModePayload = (value: unknown): value is MapInteractionModeRealtimePayload => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.slug === 'string'
    && isMapInteractionMode(record.interactionMode)
    && typeof record.updatedAt === 'number'
}

export const useSharedMapInteractionMode = (
  slug: string,
  options: UseSharedMapInteractionModeOptions = {},
): UseSharedMapInteractionModeReturn => {
  const interactionMode = ref<MapInteractionMode>(DEFAULT_MAP_INTERACTION_MODE)
  const status = ref<SharedMapInteractionModeStatus>('loading')
  const error = ref<string | null>(null)
  const updatedAt = ref(0)
  const clientId = getClientId()
  const { getJson, postJson } = useApiClient()

  const applyAuthoritativeMode = (response: ApplyAuthoritativeMapInteractionModeInput) => {
    const parsedMode = parseMapInteractionMode(response.interactionMode)
    if (response.slug !== slug || !parsedMode) return
    interactionMode.value = parsedMode
    updatedAt.value = response.updatedAt
    status.value = 'idle'
    error.value = null
  }

  const load = async () => {
    status.value = 'loading'
    error.value = null
    try {
      const response = await getJson<SharedMapInteractionModeResponse>(MAP_API_PATHS.interactionMode, {
        params: { slug },
      })
      applyAuthoritativeMode(response)
    } catch (err) {
      status.value = 'error'
      error.value = getErrorMessage(err, { fallback: 'Map mode could not be loaded' })
    }
  }

  const setInteractionMode = async (mode: MapInteractionMode) => {
    if (!isMapInteractionMode(mode)) return
    if (mode === interactionMode.value && status.value !== 'error') return
    status.value = 'saving'
    error.value = null
    try {
      const response = await postJson<SharedMapInteractionModeResponse>(MAP_API_PATHS.interactionMode, {
        slug,
        interactionMode: mode,
        clientId,
      })
      applyAuthoritativeMode(response)
    } catch (err) {
      status.value = 'error'
      error.value = getErrorMessage(err, { fallback: 'Map mode could not be changed' })
    }
  }

  const handleRealtimeModeEvent = (event: RealtimeEvent) => {
    if (event.type !== MAP_INTERACTION_MODE_REALTIME_EVENT_TYPE) return
    if (isRealtimeEcho(event, clientId)) return
    if (!isModePayload(event.data) || event.data.slug !== slug) return
    if (event.data.updatedAt < updatedAt.value) return
    interactionMode.value = event.data.interactionMode
    updatedAt.value = event.data.updatedAt
    if (status.value === 'saving') status.value = 'idle'
    error.value = null
  }

  useRealtimeChannel(mapChannel(slug), handleRealtimeModeEvent)
  if (options.autoLoad !== false) void load()

  return {
    interactionMode,
    status,
    error,
    updatedAt,
    load,
    setInteractionMode,
    applyAuthoritativeMode,
  }
}
