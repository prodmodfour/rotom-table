import { isSlug } from '#shared/paths'
import type { GridAnchor, MapShopInterface } from '~/types/map'

export const MAP_SHOP_INTERFACE_ID_PREFIX = 'map-shop-interface'

export interface MapShopInterfaceIdContext {
  readonly index: number
  readonly shopSlug: string
  readonly label: string
}

export type MapShopInterfaceIdGenerator = (context: MapShopInterfaceIdContext) => string

export interface NormalizeMapShopInterfacesOptions {
  readonly generateId?: MapShopInterfaceIdGenerator
}

interface MapShopInterfaceIdState {
  readonly generateId: MapShopInterfaceIdGenerator
  readonly usedIds: Set<string>
  fallbackIdCounter: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const trimString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const normalizeShopSlug = (value: unknown): string | null => {
  const trimmed = trimString(value)
  return trimmed && isSlug(trimmed) ? trimmed : null
}

const normalizeLabel = (value: unknown, fallback: string): string => trimString(value) ?? fallback

const normalizeOptionalBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value
  if (value === 1) return true
  if (value === 0) return false
  if (typeof value !== 'string') return undefined

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return undefined
}

const finiteNumber = (value: unknown): number | null => {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN

  return Number.isFinite(numericValue) ? numericValue : null
}

const normalizePosition = (value: unknown): GridAnchor | undefined => {
  if (!isRecord(value)) return undefined

  const x = finiteNumber(value.x)
  const y = finiteNumber(value.y)
  const z = finiteNumber(value.z)
  if (x === null || y === null || z === null) return undefined

  return { x, y, z }
}

const normalizeInteractionRangeMeters = (value: unknown): number | undefined => {
  const range = finiteNumber(value)
  return range !== null && range > 0 ? range : undefined
}

export const createMapShopInterfaceId: MapShopInterfaceIdGenerator = ({ index }) => (
  `${MAP_SHOP_INTERFACE_ID_PREFIX}-${(index + 1).toString(36)}`
)

const normalizePreferredId = (value: unknown): string | null => trimString(value)

const fallbackId = (state: MapShopInterfaceIdState): string => {
  do {
    state.fallbackIdCounter += 1
    const candidate = `${MAP_SHOP_INTERFACE_ID_PREFIX}-${state.fallbackIdCounter.toString(36)}`
    if (!state.usedIds.has(candidate)) return candidate
  } while (state.fallbackIdCounter < Number.MAX_SAFE_INTEGER)

  throw new Error('Unable to allocate a unique map shop interface id.')
}

const uniqueInterfaceId = (
  preferredId: unknown,
  context: MapShopInterfaceIdContext,
  state: MapShopInterfaceIdState,
): string => {
  const normalizedPreferredId = normalizePreferredId(preferredId)
  if (normalizedPreferredId && !state.usedIds.has(normalizedPreferredId)) {
    state.usedIds.add(normalizedPreferredId)
    return normalizedPreferredId
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const generatedId = normalizePreferredId(state.generateId(context))
    if (generatedId && !state.usedIds.has(generatedId)) {
      state.usedIds.add(generatedId)
      return generatedId
    }
  }

  const generatedFallbackId = fallbackId(state)
  state.usedIds.add(generatedFallbackId)
  return generatedFallbackId
}

const normalizeMapShopInterface = (
  value: Record<string, unknown>,
  index: number,
  state: MapShopInterfaceIdState,
): MapShopInterface | null => {
  const shopSlug = normalizeShopSlug(value.shopSlug)
  if (!shopSlug) return null

  const label = normalizeLabel(value.label, shopSlug)
  const shopInterface: MapShopInterface = {
    id: uniqueInterfaceId(value.id, { index, shopSlug, label }, state),
    shopSlug,
    label,
  }

  const position = normalizePosition(value.position)
  if (position) shopInterface.position = position

  const interactionRangeMeters = normalizeInteractionRangeMeters(value.interactionRangeMeters)
  if (interactionRangeMeters !== undefined) shopInterface.interactionRangeMeters = interactionRangeMeters

  const playerVisible = normalizeOptionalBoolean(value.playerVisible)
  if (playerVisible !== undefined) shopInterface.playerVisible = playerVisible

  return shopInterface
}

const mapShopInterfaceEntriesFromUnknown = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) return value.filter(isRecord)
  if (!isRecord(value)) return []

  if (Object.hasOwn(value, 'shopSlug') || Object.hasOwn(value, 'id') || Object.hasOwn(value, 'label')) return [value]

  return Object.values(value).filter(isRecord)
}

export const normalizeMapShopInterfaces = (
  value: unknown,
  options: NormalizeMapShopInterfacesOptions = {},
): MapShopInterface[] => {
  const state: MapShopInterfaceIdState = {
    generateId: options.generateId ?? createMapShopInterfaceId,
    usedIds: new Set<string>(),
    fallbackIdCounter: 0,
  }

  const normalized: MapShopInterface[] = []
  for (const [index, entry] of mapShopInterfaceEntriesFromUnknown(value).entries()) {
    const shopInterface = normalizeMapShopInterface(entry, index, state)
    if (shopInterface) normalized.push(shopInterface)
  }

  return normalized
}
