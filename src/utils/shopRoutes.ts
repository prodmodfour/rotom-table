export const SHOP_LIBRARY_PATH = '/shops' as const
export const SHOPFRONT_ROUTE_PATH = `${SHOP_LIBRARY_PATH}/[slug]` as const
export const SHOP_EDITOR_ROUTE_PATH = `${SHOPFRONT_ROUTE_PATH}/edit` as const

export const shopLibraryPath = (): typeof SHOP_LIBRARY_PATH => SHOP_LIBRARY_PATH

export const shopfrontPath = (slug: string): string => (
  `${SHOP_LIBRARY_PATH}/${encodeURIComponent(slug)}`
)

export const shopEditorPath = (slug: string): string => `${shopfrontPath(slug)}/edit`

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
