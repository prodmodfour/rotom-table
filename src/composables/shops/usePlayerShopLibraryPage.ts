import { computed, onMounted, ref, type Ref } from 'vue'
import type { ShopTableDocument } from '~/types/shop'
import type { ShopListResponse } from '~/composables/shops/shopLibraryApi'
import type { ApiClient } from '~/utils/apiClient'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import { isOpenPlayerVisibleShop } from '~/utils/shopLibrary'
import { useApiClient } from '~/composables/useApiClient'

export type PlayerShopLibraryStatus = 'loading' | 'empty' | 'ready' | 'error'

export interface UsePlayerShopLibraryPageDependencies {
  readonly isEnabled?: Readonly<Ref<boolean>>
  readonly apiClient?: Pick<ApiClient, 'getJson'>
  readonly autoLoadOnMounted?: boolean
}

const playerVisibleShopsFromResponse = (
  response: ShopListResponse,
): ShopTableDocument[] => response.shops.filter(isOpenPlayerVisibleShop)

export const usePlayerShopLibraryPage = (
  dependencies: UsePlayerShopLibraryPageDependencies = {},
) => {
  const isEnabled = computed(() => dependencies.isEnabled?.value ?? true)
  const apiClient = dependencies.apiClient ?? useApiClient()

  const shops = ref<ShopTableDocument[]>([])
  const status = ref<PlayerShopLibraryStatus>(isEnabled.value ? 'loading' : 'empty')
  const loadErrorMessage = ref<string | null>(null)

  const resetForDisabled = (): void => {
    shops.value = []
    status.value = 'empty'
    loadErrorMessage.value = null
  }

  const loadPlayerShops = async (): Promise<ShopTableDocument[]> => {
    if (!isEnabled.value) {
      resetForDisabled()
      return []
    }

    status.value = 'loading'
    loadErrorMessage.value = null

    try {
      const response = await apiClient.getJson<ShopListResponse>(SHOP_API_PATHS.list)
      shops.value = playerVisibleShopsFromResponse(response)
      status.value = shops.value.length > 0 ? 'ready' : 'empty'
      return shops.value
    } catch (error: unknown) {
      shops.value = []
      loadErrorMessage.value = getErrorMessage(error)
      status.value = 'error'
      return []
    }
  }

  if (dependencies.autoLoadOnMounted !== false) {
    onMounted(() => {
      void loadPlayerShops()
    })
  }

  return {
    shops,
    status,
    loadErrorMessage,
    loadPlayerShops,
  }
}
