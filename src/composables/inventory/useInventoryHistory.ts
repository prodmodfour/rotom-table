import { onMounted, ref, watch, type Ref } from 'vue'
import { parseInventoryHistoryProjection, type InventoryHistoryProjectionV1 } from '#shared/itemAutomation/inventoryHistory'
import type { PlayerProfileId } from '#shared/playerProfiles'
import { useApiClient } from '~/composables/useApiClient'
import type { ApiClient } from '~/utils/apiClient'
import { INVENTORY_ACTION_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'

export type InventoryHistoryLoadStatus = 'idle' | 'loading' | 'ready' | 'error'
export interface InventoryHistoryClientScope {
  readonly kind: 'trainer' | 'group'
  readonly slug: string
}
interface ReadonlyValueRef<T> { readonly value: T }

export interface UseInventoryHistoryOptions {
  readonly scope: ReadonlyValueRef<InventoryHistoryClientScope | null | undefined>
  readonly profileId?: ReadonlyValueRef<PlayerProfileId | string | null | undefined>
  readonly apiClient?: Pick<ApiClient, 'getJson'>
  readonly limit?: number
  readonly autoLoadOnMounted?: boolean
}

export interface UseInventoryHistoryReturn {
  readonly projection: Ref<InventoryHistoryProjectionV1 | null>
  readonly status: Ref<InventoryHistoryLoadStatus>
  readonly error: Ref<string | null>
  readonly load: () => Promise<void>
  readonly refresh: () => Promise<void>
}

export const useInventoryHistory = (options: UseInventoryHistoryOptions): UseInventoryHistoryReturn => {
  const apiClient = options.apiClient ?? useApiClient()
  const limit = options.limit ?? 20
  const projection = ref<InventoryHistoryProjectionV1 | null>(null)
  const status = ref<InventoryHistoryLoadStatus>('idle')
  const error = ref<string | null>(null)
  let requestSequence = 0
  let loadedSignature: string | null = null

  const signature = (): string | null => {
    const scope = options.scope.value
    if (!scope?.slug) return null
    return `${scope.kind}:${scope.slug}:profile:${options.profileId?.value ?? ''}`
  }

  const load = async (): Promise<void> => {
    const scope = options.scope.value
    const currentSignature = signature()
    const sequence = ++requestSequence
    if (!scope || !currentSignature) {
      projection.value = null
      loadedSignature = null
      status.value = 'idle'
      error.value = null
      return
    }
    if (loadedSignature !== currentSignature) projection.value = null
    status.value = 'loading'
    error.value = null
    try {
      const response = await apiClient.getJson<unknown>(INVENTORY_ACTION_API_PATHS.history, {
        params: {
          ...(scope.kind === 'trainer' ? { trainerSlug: scope.slug } : { groupSlug: scope.slug }),
          profileId: options.profileId?.value ?? undefined,
          limit,
        },
      })
      const parsed = parseInventoryHistoryProjection(response)
      if (sequence !== requestSequence || signature() !== currentSignature
        || parsed.scope.kind !== scope.kind) return
      projection.value = parsed
      loadedSignature = currentSignature
      status.value = 'ready'
    }
    catch (cause) {
      if (sequence !== requestSequence || signature() !== currentSignature) return
      status.value = 'error'
      error.value = getErrorMessage(cause, { fallback: 'Inventory activity could not be loaded.' })
    }
  }

  watch(
    () => signature(),
    (next, previous) => {
      if (next === previous) return
      requestSequence += 1
      projection.value = null
      loadedSignature = null
      status.value = 'idle'
      error.value = null
      if (next && options.autoLoadOnMounted === false) return
      if (next && import.meta.client) void load()
    },
  )

  if (options.autoLoadOnMounted !== false) onMounted(() => { void load() })

  return Object.freeze({ projection, status, error, load, refresh: load })
}
