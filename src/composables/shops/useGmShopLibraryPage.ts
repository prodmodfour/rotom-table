import { computed, onMounted, ref, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import type { ShopTableDocument } from '~/types/shop'
import type { ApiClient } from '~/utils/apiClient'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import { shopEditorPath } from '~/utils/shopRoutes'
import { useApiClient } from '~/composables/useApiClient'
import { useAuth } from '~/composables/useAuth'

export type GmShopLibraryStatus = 'loading' | 'empty' | 'ready' | 'error'
export type GmShopCreateStatus = 'idle' | 'creating'

export interface ShopListResponse {
  readonly shops: readonly ShopTableDocument[]
}

export interface CreateShopResponse {
  readonly ok: true
  readonly shop: ShopTableDocument
}

export interface UseGmShopLibraryPageDependencies {
  readonly isGm?: Readonly<Ref<boolean>>
  readonly apiClient?: Pick<ApiClient, 'getJson' | 'postJson'>
  readonly clientId?: string
  readonly pushRoute?: (path: string) => Promise<unknown> | unknown
  readonly autoLoadOnMounted?: boolean
}

const createdShopRequestBody = (clientId: string): Record<string, string> => ({
  baseSlug: 'shop',
  name: 'New Shop',
  clientId,
})

const upsertShop = (shops: Ref<ShopTableDocument[]>, shop: ShopTableDocument): void => {
  const nextShops = shops.value.filter((existing) => existing.slug !== shop.slug)
  nextShops.unshift(shop)
  shops.value = nextShops
}

export const useGmShopLibraryPage = (dependencies: UseGmShopLibraryPageDependencies = {}) => {
  const auth = dependencies.isGm ? null : useAuth()
  const isGm = computed(() => (dependencies.isGm?.value ?? auth?.isGm.value) === true)
  const apiClient = dependencies.apiClient ?? useApiClient()
  const router = dependencies.pushRoute ? null : useRouter()
  const clientId = dependencies.clientId ?? getClientId()

  const shops = ref<ShopTableDocument[]>([])
  const status = ref<GmShopLibraryStatus>(isGm.value ? 'loading' : 'empty')
  const loadErrorMessage = ref<string | null>(null)
  const createStatus = ref<GmShopCreateStatus>('idle')
  const createErrorMessage = ref<string | null>(null)

  const isCreatingShop = computed(() => createStatus.value === 'creating')
  const canCreateShop = computed(() => isGm.value && createStatus.value !== 'creating')

  const resetForNonGm = (): void => {
    shops.value = []
    status.value = 'empty'
    loadErrorMessage.value = null
    createErrorMessage.value = null
  }

  const loadGmShops = async (): Promise<ShopTableDocument[]> => {
    if (!isGm.value) {
      resetForNonGm()
      return []
    }

    status.value = 'loading'
    loadErrorMessage.value = null

    try {
      const response = await apiClient.getJson<ShopListResponse>(SHOP_API_PATHS.list)
      shops.value = [...response.shops]
      status.value = shops.value.length > 0 ? 'ready' : 'empty'
      return shops.value
    } catch (error: unknown) {
      loadErrorMessage.value = getErrorMessage(error)
      status.value = 'error'
      return []
    }
  }

  const pushRoute = async (path: string): Promise<void> => {
    if (dependencies.pushRoute) {
      await dependencies.pushRoute(path)
      return
    }
    await router?.push(path)
  }

  const createShop = async (): Promise<ShopTableDocument | null> => {
    if (!canCreateShop.value) return null

    createStatus.value = 'creating'
    createErrorMessage.value = null

    try {
      const response = await apiClient.postJson<CreateShopResponse>(
        SHOP_API_PATHS.create,
        createdShopRequestBody(clientId),
      )
      upsertShop(shops, response.shop)
      status.value = 'ready'
      await pushRoute(shopEditorPath(response.shop.slug))
      return response.shop
    } catch (error: unknown) {
      createErrorMessage.value = getErrorMessage(error)
      return null
    } finally {
      createStatus.value = 'idle'
    }
  }

  if (dependencies.autoLoadOnMounted !== false) {
    onMounted(() => {
      void loadGmShops()
    })
  }

  return {
    isGm,
    shops,
    status,
    loadErrorMessage,
    createStatus,
    createErrorMessage,
    isCreatingShop,
    canCreateShop,
    loadGmShops,
    createShop,
  }
}
