import { computed, onMounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { ShopListResponse } from '~/composables/shops/shopLibraryApi'
import { useApiClient } from '~/composables/useApiClient'
import type { MapShopInterface } from '~/types/map'
import type { ShopTableDocument } from '~/types/shop'
import type { ApiClient } from '~/utils/apiClient'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import { mapShopfrontPath } from '~/utils/shopRoutes'
import type { ShopCheckoutOrigin } from '#shared/livePlayCommands'

interface ReadonlyValueRef<TValue> {
  readonly value: TValue
}

export type MapShopfrontLauncherStatus = 'idle' | 'loading' | 'empty' | 'ready' | 'error'

export interface MapShopfrontLauncherEntry {
  readonly shopInterface: MapShopInterface
  readonly shop: ShopTableDocument
  readonly origin: Extract<ShopCheckoutOrigin, { kind: 'mapInterface' }>
  readonly to: string
}

export interface UseMapShopfrontLauncherDependencies {
  readonly mapSlug: ReadonlyValueRef<string | null | undefined>
  readonly shopInterfaces: ReadonlyValueRef<readonly MapShopInterface[]>
  readonly isGm: ReadonlyValueRef<boolean>
  readonly isPlayer: ReadonlyValueRef<boolean>
  readonly actorPlacementId?: ReadonlyValueRef<string | null | undefined>
  readonly apiClient?: Pick<ApiClient, 'getJson'>
  readonly autoLoadOnMounted?: boolean
}

export interface UseMapShopfrontLauncherReturn {
  readonly shops: Ref<readonly ShopTableDocument[]>
  readonly entries: ComputedRef<readonly MapShopfrontLauncherEntry[]>
  readonly status: ComputedRef<MapShopfrontLauncherStatus>
  readonly errorMessage: Ref<string | null>
  readonly loadShopfrontOptions: () => Promise<readonly ShopTableDocument[]>
}

const trimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const compareLauncherEntries = (
  left: MapShopfrontLauncherEntry,
  right: MapShopfrontLauncherEntry,
): number => {
  const labelOrder = left.shopInterface.label.localeCompare(right.shopInterface.label)
  if (labelOrder !== 0) return labelOrder
  const shopOrder = left.shop.name.localeCompare(right.shop.name)
  return shopOrder === 0 ? left.shopInterface.id.localeCompare(right.shopInterface.id) : shopOrder
}

const canActorUseMapShopLauncher = (
  isGm: boolean,
  isPlayer: boolean,
): boolean => isGm || isPlayer

const playerCanSeeInterface = (shopInterface: MapShopInterface): boolean => shopInterface.playerVisible === true

const playerCanOpenShop = (shop: ShopTableDocument): boolean => shop.open === true && shop.playerVisible === true

export const useMapShopfrontLauncher = ({
  mapSlug,
  shopInterfaces,
  isGm,
  isPlayer,
  actorPlacementId,
  apiClient: injectedApiClient,
  autoLoadOnMounted = true,
}: UseMapShopfrontLauncherDependencies): UseMapShopfrontLauncherReturn => {
  const apiClient = injectedApiClient ?? useApiClient()
  const shops = ref<ShopTableDocument[]>([])
  const rawStatus = ref<Exclude<MapShopfrontLauncherStatus, 'empty'>>('idle')
  const errorMessage = ref<string | null>(null)

  const normalizedMapSlug = computed(() => trimmedString(mapSlug.value))
  const normalizedActorPlacementId = computed(() => trimmedString(actorPlacementId?.value))
  const actorCanLaunch = computed(() => canActorUseMapShopLauncher(isGm.value, isPlayer.value))
  const shopBySlug = computed(() => new Map(shops.value.map((shop) => [shop.slug, shop] as const)))

  const entries = computed<readonly MapShopfrontLauncherEntry[]>(() => {
    const currentMapSlug = normalizedMapSlug.value
    if (!currentMapSlug || !actorCanLaunch.value) return []

    const nextEntries: MapShopfrontLauncherEntry[] = []
    for (const shopInterface of shopInterfaces.value) {
      if (!isGm.value && !playerCanSeeInterface(shopInterface)) continue

      const shop = shopBySlug.value.get(shopInterface.shopSlug)
      if (!shop) continue
      if (!isGm.value && !playerCanOpenShop(shop)) continue

      const origin: Extract<ShopCheckoutOrigin, { kind: 'mapInterface' }> = {
        kind: 'mapInterface',
        mapSlug: currentMapSlug,
        interfaceId: shopInterface.id,
        ...(normalizedActorPlacementId.value ? { actorPlacementId: normalizedActorPlacementId.value } : {}),
      }

      nextEntries.push({
        shopInterface,
        shop,
        origin,
        to: mapShopfrontPath({
          shopSlug: shop.slug,
          mapSlug: origin.mapSlug,
          interfaceId: origin.interfaceId,
          ...(origin.actorPlacementId ? { actorPlacementId: origin.actorPlacementId } : {}),
        }),
      })
    }

    return nextEntries.sort(compareLauncherEntries)
  })

  const status = computed<MapShopfrontLauncherStatus>(() => {
    if (rawStatus.value === 'ready') return entries.value.length > 0 ? 'ready' : 'empty'
    return rawStatus.value
  })

  const loadShopfrontOptions = async (): Promise<readonly ShopTableDocument[]> => {
    if (!actorCanLaunch.value) {
      shops.value = []
      rawStatus.value = 'idle'
      errorMessage.value = null
      return []
    }

    rawStatus.value = 'loading'
    errorMessage.value = null

    try {
      const response = await apiClient.getJson<ShopListResponse>(SHOP_API_PATHS.list)
      shops.value = [...response.shops]
      rawStatus.value = 'ready'
      return shops.value
    } catch (error: unknown) {
      shops.value = []
      rawStatus.value = 'error'
      errorMessage.value = getErrorMessage(error, {
        fallback: 'Mapped shopfronts could not be loaded.',
      })
      return []
    }
  }

  const loadSignature = computed(() => JSON.stringify({
    role: isGm.value ? 'gm' : isPlayer.value ? 'player' : 'guest',
    mapSlug: normalizedMapSlug.value,
    interfaces: shopInterfaces.value.map((shopInterface) => ({
      id: shopInterface.id,
      shopSlug: shopInterface.shopSlug,
      playerVisible: shopInterface.playerVisible === true,
    })),
  }))

  if (autoLoadOnMounted) {
    onMounted(() => {
      void loadShopfrontOptions()
    })

    watch(loadSignature, () => {
      if (typeof window === 'undefined') return
      void loadShopfrontOptions()
    })
  }

  return {
    shops,
    entries,
    status,
    errorMessage,
    loadShopfrontOptions,
  }
}
