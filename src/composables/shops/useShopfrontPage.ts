import { computed, getCurrentScope, onMounted, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { ShopTableDocument } from '~/types/shop'
import type { LoadShopResponse } from '~/composables/shops/shopLibraryApi'
import { subscribeChannel, type RealtimeEvent } from '~/composables/useRealtime'
import type { ApiClient } from '~/utils/apiClient'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import { deepCloneJson } from '~/utils/serialization'
import { applyShopRealtimeEvent } from '~/utils/shopRealtime'
import { shopChannel } from '#shared/realtime'
import { useApiClient } from '~/composables/useApiClient'

export type ShopfrontLoadStatus = 'loading' | 'ready' | 'error'

export type ShopRealtimeChannelSubscriber = (
  channel: string,
  handler: (event: RealtimeEvent) => void,
) => () => void

export interface UseShopfrontPageDependencies {
  readonly slug: Readonly<Ref<string | null | undefined>>
  readonly apiClient?: Pick<ApiClient, 'getJson'>
  readonly clientId?: string
  readonly subscribeRealtimeChannel?: ShopRealtimeChannelSubscriber
  readonly realtimeEnabled?: boolean
  readonly autoLoadOnMounted?: boolean
}

export interface UseShopfrontPageReturn {
  readonly shop: Ref<ShopTableDocument | null>
  readonly loadStatus: Ref<ShopfrontLoadStatus>
  readonly loadErrorMessage: Ref<string | null>
  readonly loadShop: () => Promise<ShopTableDocument | null>
  readonly handleRealtimeShopEvent: (event: RealtimeEvent) => void
}

const emptySlug = (value: unknown): boolean => String(value ?? '').trim().length === 0

const cloneShop = (shop: ShopTableDocument): ShopTableDocument => deepCloneJson(shop)

export const useShopfrontPage = (
  dependencies: UseShopfrontPageDependencies,
): UseShopfrontPageReturn => {
  const apiClient = dependencies.apiClient ?? useApiClient()
  const clientId = dependencies.clientId ?? getClientId()
  const shop = ref<ShopTableDocument | null>(null)
  const loadStatus = ref<ShopfrontLoadStatus>('loading')
  const loadErrorMessage = ref<string | null>(null)
  const requestedSlug = computed(() => String(dependencies.slug.value ?? '').trim())
  let unsubscribeRealtime: (() => void) | null = null
  let subscribedRealtimeSlug: string | null = null

  const adoptShop = (nextShop: ShopTableDocument | null): void => {
    shop.value = nextShop ? cloneShop(nextShop) : null
  }

  const handleRealtimeShopEvent = (event: RealtimeEvent): void => {
    const result = applyShopRealtimeEvent(event, {
      currentDocument: shop.value,
      clientId,
      expectedSlug: requestedSlug.value,
    })

    if (result.status === 'adopted' || result.status === 'unchanged') {
      adoptShop(result.document)
      loadStatus.value = 'ready'
      loadErrorMessage.value = null
      return
    }

    if (result.status === 'deleted') {
      adoptShop(null)
      loadStatus.value = 'error'
      loadErrorMessage.value = 'This shop table was deleted.'
    }
  }

  const realtimeSubscriber = (): ShopRealtimeChannelSubscriber | null => {
    if (dependencies.realtimeEnabled === false) return null
    if (dependencies.subscribeRealtimeChannel) return dependencies.subscribeRealtimeChannel
    if (typeof window === 'undefined') return null
    return subscribeChannel
  }

  const subscribeToRealtimeSlug = (): void => {
    const slug = requestedSlug.value
    const subscriber = realtimeSubscriber()
    if (!slug || !subscriber) {
      unsubscribeRealtime?.()
      unsubscribeRealtime = null
      subscribedRealtimeSlug = null
      return
    }

    if (subscribedRealtimeSlug === slug) return
    unsubscribeRealtime?.()
    subscribedRealtimeSlug = slug
    unsubscribeRealtime = subscriber(shopChannel(slug), handleRealtimeShopEvent)
  }

  const loadShop = async (): Promise<ShopTableDocument | null> => {
    if (emptySlug(requestedSlug.value)) {
      adoptShop(null)
      loadStatus.value = 'error'
      loadErrorMessage.value = 'No shop slug was provided.'
      return null
    }

    loadStatus.value = 'loading'
    loadErrorMessage.value = null

    try {
      const response = await apiClient.getJson<LoadShopResponse>(SHOP_API_PATHS.load, {
        params: { slug: requestedSlug.value },
      })
      adoptShop(response.shop)
      loadStatus.value = 'ready'
      return shop.value
    } catch (error: unknown) {
      adoptShop(null)
      loadStatus.value = 'error'
      loadErrorMessage.value = getErrorMessage(error, {
        fallback: 'This shopfront is not available.',
      })
      return null
    }
  }

  if (dependencies.autoLoadOnMounted !== false) {
    onMounted(() => {
      void loadShop()
    })

    watch(requestedSlug, (nextSlug, previousSlug) => {
      if (nextSlug !== previousSlug) void loadShop()
    })
  }

  subscribeToRealtimeSlug()
  watch(requestedSlug, subscribeToRealtimeSlug)

  if (getCurrentScope()) {
    onScopeDispose(() => {
      unsubscribeRealtime?.()
      unsubscribeRealtime = null
      subscribedRealtimeSlug = null
    })
  }

  return {
    shop,
    loadStatus,
    loadErrorMessage,
    loadShop,
    handleRealtimeShopEvent,
  }
}
