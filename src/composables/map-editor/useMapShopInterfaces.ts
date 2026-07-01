import { computed, ref, type Ref } from 'vue'
import type { ShopListResponse } from '~/composables/shops/shopLibraryApi'
import { useApiClient } from '~/composables/useApiClient'
import type { GridAnchor, MapShopInterface, TabletopMap } from '~/types/map'
import type { ShopTableDocument } from '~/types/shop'
import type { ApiClient } from '~/utils/apiClient'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import {
  MAP_SHOP_INTERFACE_ID_PREFIX,
  normalizeMapShopInterfaces,
} from '~/utils/mapShopInterfaces'

export type MapShopInterfaceShopListStatus = 'idle' | 'loading' | 'empty' | 'ready' | 'error'

interface ReadonlyValueRef<T> {
  readonly value: T
}

export interface MapShopInterfacePatch {
  readonly shopSlug?: string
  readonly label?: string
  readonly position?: GridAnchor | null
  readonly interactionRangeMeters?: number | null
  readonly playerVisible?: boolean
}

export interface UseMapShopInterfacesDependencies {
  readonly map: Ref<TabletopMap | null>
  readonly isGm: ReadonlyValueRef<boolean>
  readonly setupEditActive: ReadonlyValueRef<boolean>
  readonly apiClient?: Pick<ApiClient, 'getJson'>
}

const nonEmptyTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const finiteNumberOrNull = (value: unknown): number | null => {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN

  return Number.isFinite(numeric) ? numeric : null
}

const normalizePositiveRange = (value: unknown): number | undefined => {
  const range = finiteNumberOrNull(value)
  return range !== null && range > 0 ? range : undefined
}

const normalizePosition = (value: GridAnchor | null | undefined): GridAnchor | undefined => {
  if (!value) return undefined
  const x = finiteNumberOrNull(value.x)
  const y = finiteNumberOrNull(value.y)
  const z = finiteNumberOrNull(value.z)
  return x !== null && y !== null && z !== null ? { x, y, z } : undefined
}

const allocateMapShopInterfaceId = (interfaces: readonly MapShopInterface[]): string => {
  const usedIds = new Set(interfaces.map((shopInterface) => shopInterface.id))
  let index = interfaces.length
  do {
    index += 1
    const candidate = `${MAP_SHOP_INTERFACE_ID_PREFIX}-${index.toString(36)}`
    if (!usedIds.has(candidate)) return candidate
  } while (index < Number.MAX_SAFE_INTEGER)

  throw new Error('Unable to allocate a map shop interface id.')
}

const upsertNormalizedShopInterfaces = (
  map: TabletopMap,
  shopInterfaces: readonly MapShopInterface[],
): void => {
  map.shopInterfaces = normalizeMapShopInterfaces(shopInterfaces)
}

const shopName = (shop: ShopTableDocument): string => nonEmptyTrimmedString(shop.name) ?? shop.slug

const selectedShop = (shops: readonly ShopTableDocument[], shopSlug: string): ShopTableDocument | null => (
  shops.find((shop) => shop.slug === shopSlug) ?? null
)

const ensureExistingShopSlug = (shops: readonly ShopTableDocument[], shopSlug: string): string | null => (
  selectedShop(shops, shopSlug)?.slug ?? null
)

export const useMapShopInterfaces = ({
  map,
  isGm,
  setupEditActive,
  apiClient: injectedApiClient,
}: UseMapShopInterfacesDependencies) => {
  const apiClient = injectedApiClient ?? useApiClient()
  const shopOptions = ref<ShopTableDocument[]>([])
  const shopListStatus = ref<MapShopInterfaceShopListStatus>('idle')
  const shopListErrorMessage = ref<string | null>(null)

  const mapShopInterfaces = computed<readonly MapShopInterface[]>(() => map.value?.shopInterfaces ?? [])
  const canEditShopInterfaces = computed(() => isGm.value && setupEditActive.value && map.value !== null)

  const loadShopOptions = async (): Promise<readonly ShopTableDocument[]> => {
    if (!isGm.value) {
      shopOptions.value = []
      shopListStatus.value = 'idle'
      shopListErrorMessage.value = null
      return []
    }

    shopListStatus.value = 'loading'
    shopListErrorMessage.value = null

    try {
      const response = await apiClient.getJson<ShopListResponse>(SHOP_API_PATHS.list)
      shopOptions.value = [...response.shops]
      shopListStatus.value = shopOptions.value.length > 0 ? 'ready' : 'empty'
      return shopOptions.value
    } catch (error: unknown) {
      shopListErrorMessage.value = getErrorMessage(error)
      shopListStatus.value = 'error'
      return []
    }
  }

  const addShopInterface = (shopSlug: string): MapShopInterface | null => {
    if (!canEditShopInterfaces.value || !map.value) return null

    const existingShop = selectedShop(shopOptions.value, shopSlug)
    if (!existingShop) return null

    const currentInterfaces = map.value.shopInterfaces ?? []
    const shopInterface: MapShopInterface = {
      id: allocateMapShopInterfaceId(currentInterfaces),
      shopSlug: existingShop.slug,
      label: shopName(existingShop),
      playerVisible: false,
    }
    upsertNormalizedShopInterfaces(map.value, [...currentInterfaces, shopInterface])
    return shopInterface
  }

  const removeShopInterface = (id: string): void => {
    if (!canEditShopInterfaces.value || !map.value) return
    upsertNormalizedShopInterfaces(
      map.value,
      (map.value.shopInterfaces ?? []).filter((shopInterface) => shopInterface.id !== id),
    )
  }

  const updateShopInterface = (id: string, patch: MapShopInterfacePatch): void => {
    if (!canEditShopInterfaces.value || !map.value) return

    const currentInterfaces = map.value.shopInterfaces ?? []
    const nextInterfaces = currentInterfaces.map((shopInterface) => {
      if (shopInterface.id !== id) return shopInterface

      const nextShopSlug = patch.shopSlug === undefined
        ? shopInterface.shopSlug
        : ensureExistingShopSlug(shopOptions.value, patch.shopSlug) ?? shopInterface.shopSlug
      const label = patch.label === undefined
        ? shopInterface.label
        : nonEmptyTrimmedString(patch.label) ?? nextShopSlug
      const next: MapShopInterface = {
        id: shopInterface.id,
        shopSlug: nextShopSlug,
        label,
      }

      const position = patch.position === null
        ? undefined
        : patch.position === undefined
          ? shopInterface.position
          : normalizePosition(patch.position)
      if (position) next.position = position

      const interactionRangeMeters = patch.interactionRangeMeters === null
        ? undefined
        : patch.interactionRangeMeters === undefined
          ? shopInterface.interactionRangeMeters
          : normalizePositiveRange(patch.interactionRangeMeters)
      if (interactionRangeMeters !== undefined) next.interactionRangeMeters = interactionRangeMeters

      const playerVisible = patch.playerVisible === undefined ? shopInterface.playerVisible : patch.playerVisible
      if (playerVisible !== undefined) next.playerVisible = playerVisible

      return next
    })

    upsertNormalizedShopInterfaces(map.value, nextInterfaces)
  }

  return {
    shopOptions,
    shopListStatus,
    shopListErrorMessage,
    mapShopInterfaces,
    canEditShopInterfaces,
    loadShopOptions,
    addShopInterface,
    updateShopInterface,
    removeShopInterface,
  }
}
