import { computed, onMounted, ref, watch, type Ref } from 'vue'
import type { ShopTableDocument } from '~/types/shop'
import type { LoadShopResponse } from '~/composables/shops/shopLibraryApi'
import type { ApiClient } from '~/utils/apiClient'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import { deepCloneJson } from '~/utils/serialization'
import { useApiClient } from '~/composables/useApiClient'

export type ShopfrontLoadStatus = 'loading' | 'ready' | 'error'

export interface UseShopfrontPageDependencies {
  readonly slug: Readonly<Ref<string | null | undefined>>
  readonly apiClient?: Pick<ApiClient, 'getJson'>
  readonly autoLoadOnMounted?: boolean
}

export interface UseShopfrontPageReturn {
  readonly shop: Ref<ShopTableDocument | null>
  readonly loadStatus: Ref<ShopfrontLoadStatus>
  readonly loadErrorMessage: Ref<string | null>
  readonly loadShop: () => Promise<ShopTableDocument | null>
}

const emptySlug = (value: unknown): boolean => String(value ?? '').trim().length === 0

const cloneShop = (shop: ShopTableDocument): ShopTableDocument => deepCloneJson(shop)

export const useShopfrontPage = (
  dependencies: UseShopfrontPageDependencies,
): UseShopfrontPageReturn => {
  const apiClient = dependencies.apiClient ?? useApiClient()
  const shop = ref<ShopTableDocument | null>(null)
  const loadStatus = ref<ShopfrontLoadStatus>('loading')
  const loadErrorMessage = ref<string | null>(null)
  const requestedSlug = computed(() => String(dependencies.slug.value ?? '').trim())

  const adoptShop = (nextShop: ShopTableDocument | null): void => {
    shop.value = nextShop ? cloneShop(nextShop) : null
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

  return {
    shop,
    loadStatus,
    loadErrorMessage,
    loadShop,
  }
}
