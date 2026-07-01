import { isSlug } from '#shared/paths'
import type { ShopCheckoutOrigin } from '#shared/livePlayCommands'

export const SHOP_LIBRARY_PATH = '/shops' as const
export const SHOPFRONT_ROUTE_PATH = `${SHOP_LIBRARY_PATH}/[slug]` as const
export const SHOP_EDITOR_ROUTE_PATH = `${SHOPFRONT_ROUTE_PATH}/edit` as const
export const SHOPFRONT_ORIGIN_QUERY_VALUE = 'mapInterface' as const

export interface MapShopfrontPathInput {
  readonly shopSlug: string
  readonly mapSlug: string
  readonly interfaceId: string
  readonly actorPlacementId?: string | null
}

export const shopLibraryPath = (): typeof SHOP_LIBRARY_PATH => SHOP_LIBRARY_PATH

export const shopfrontPath = (slug: string): string => (
  `${SHOP_LIBRARY_PATH}/${encodeURIComponent(slug)}`
)

export const shopEditorPath = (slug: string): string => `${shopfrontPath(slug)}/edit`

const trimmedOptionalQueryValue = (value: unknown): string | null => {
  const candidate = Array.isArray(value) ? value[0] : value
  if (typeof candidate !== 'string') return null
  const trimmed = candidate.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const mapShopfrontPath = (input: MapShopfrontPathInput): string => {
  const query = new URLSearchParams({
    origin: SHOPFRONT_ORIGIN_QUERY_VALUE,
    mapSlug: input.mapSlug,
    interfaceId: input.interfaceId,
  })
  const actorPlacementId = trimmedOptionalQueryValue(input.actorPlacementId)
  if (actorPlacementId) query.set('actorPlacementId', actorPlacementId)
  return `${shopfrontPath(input.shopSlug)}?${query.toString()}`
}

export const shopCheckoutOriginFromRouteQuery = (
  query: Record<string, unknown>,
): ShopCheckoutOrigin | null => {
  if (trimmedOptionalQueryValue(query.origin) !== SHOPFRONT_ORIGIN_QUERY_VALUE) return null

  const mapSlug = trimmedOptionalQueryValue(query.mapSlug)
  const interfaceId = trimmedOptionalQueryValue(query.interfaceId)
  if (!mapSlug || !isSlug(mapSlug) || !interfaceId) return null

  const actorPlacementId = trimmedOptionalQueryValue(query.actorPlacementId)
  return {
    kind: 'mapInterface',
    mapSlug,
    interfaceId,
    ...(actorPlacementId ? { actorPlacementId } : {}),
  }
}

const normalizePath = (path: string): string => {
  const [withoutHash] = path.split('#', 1)
  const [withoutQuery] = withoutHash.split('?', 1)
  if (!withoutQuery || withoutQuery === '/') return '/'
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : withoutQuery
}

export const isShopPath = (pathInput: string): boolean => {
  const path = normalizePath(pathInput)
  return path === SHOP_LIBRARY_PATH || path.startsWith(`${SHOP_LIBRARY_PATH}/`)
}

export const isShopEditorPath = (pathInput: string): boolean => {
  const path = normalizePath(pathInput)
  const segments = path.split('/').filter(Boolean)
  return segments.length === 3
    && segments[0] === SHOP_LIBRARY_PATH.slice(1)
    && segments[2] === 'edit'
}
