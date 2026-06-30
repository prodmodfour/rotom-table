import { isSlug } from '#shared/paths'
import { normalizeRevision } from '#shared/sessionRevisions'
import { TRAINER_INVENTORY_SECTIONS, type TrainerInventoryKey } from '~/utils/sheets/trainerInventorySections'

export const SHOP_TABLE_ROW_ID_PREFIX = 'shop-entry'
export const SHOP_DEFAULT_SLUG = 'shop'
export const SHOP_DEFAULT_NAME = 'New Shop'
export const SHOP_MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER

export const SHOP_PAYMENT_SOURCE_KINDS = ['trainer', 'groupInventory'] as const
export const SHOP_DELIVERY_TARGET_KINDS = ['trainer', 'groupInventory'] as const

export type ShopPaymentSourceKind = (typeof SHOP_PAYMENT_SOURCE_KINDS)[number]
export type ShopDeliveryTargetKind = (typeof SHOP_DELIVERY_TARGET_KINDS)[number]
export type ShopStockValue = number | null
export type ShopEntrySectionKey = TrainerInventoryKey

export const SHOP_DEFAULT_PAYMENT_SOURCES: readonly ShopPaymentSourceKind[] = ['trainer']
export const SHOP_DEFAULT_DELIVERY_TARGETS: readonly ShopDeliveryTargetKind[] = ['trainer']
export const SHOP_ENTRY_SECTION_KEYS = TRAINER_INVENTORY_SECTIONS.map((section) => section.key) as readonly ShopEntrySectionKey[]
export const SHOP_DEFAULT_ENTRY_SECTION: ShopEntrySectionKey = 'keyItems'

export interface ShopEntry {
  id: string
  itemName: string
  section: ShopEntrySectionKey
  price: number
  stock: ShopStockValue
  maxPerPurchase?: number
  playerDescription?: string
  gmNotes?: string
  tags?: string[]
}

export interface ShopTableDocument {
  slug: string
  revision: number
  updatedAt: number
  name: string
  folder?: string
  description?: string
  playerVisible: boolean
  open: boolean
  allowedPaymentSources: ShopPaymentSourceKind[]
  allowedDeliveryTargets: ShopDeliveryTargetKind[]
  entries: ShopEntry[]
  gmNotes?: string
}

export interface ShopEntryRowIdContext {
  readonly index: number
  readonly itemName: string
  readonly section: ShopEntrySectionKey
}

export type ShopEntryRowIdGenerator = (context: ShopEntryRowIdContext) => string

export interface ShopTableNormalizationOptions {
  readonly slug?: unknown
  readonly name?: unknown
  readonly now?: number
  readonly generateRowId?: ShopEntryRowIdGenerator
}

interface ShopEntryRowIdState {
  readonly generateRowId: ShopEntryRowIdGenerator
  readonly usedRowIds: Set<string>
  fallbackRowIdCounter: number
}

type OptionalShopEntryStringField = 'playerDescription' | 'gmNotes'

const SHOP_PAYMENT_SOURCE_KIND_SET = new Set<ShopPaymentSourceKind>(SHOP_PAYMENT_SOURCE_KINDS)
const SHOP_DELIVERY_TARGET_KIND_SET = new Set<ShopDeliveryTargetKind>(SHOP_DELIVERY_TARGET_KINDS)
const SHOP_ENTRY_SECTION_KEY_SET = new Set<ShopEntrySectionKey>(SHOP_ENTRY_SECTION_KEYS)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const trimString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  return value.trim()
}

const normalizeOptionalString = (value: unknown): string | undefined => {
  const trimmed = trimString(value)
  return trimmed ? trimmed : undefined
}

const normalizeRequiredString = (value: unknown, fallback: string): string => {
  const trimmed = trimString(value)
  return trimmed ? trimmed : fallback
}

const coerceSafeNonNegativeInteger = (value: unknown, fallback = 0): number => {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN

  if (!Number.isFinite(numericValue)) return fallback
  if (numericValue <= 0) return 0
  return Math.min(Math.floor(numericValue), SHOP_MAX_SAFE_INTEGER)
}

const normalizeUpdatedAt = (value: unknown, fallback: number): number => coerceSafeNonNegativeInteger(value, fallback)

const normalizeBoolean = (value: unknown): boolean => (
  value === true
  || value === 1
  || (typeof value === 'string' && value.trim().toLowerCase() === 'true')
)

const normalizeShopSlug = (value: unknown, fallback: string = SHOP_DEFAULT_SLUG): string => {
  const trimmed = trimString(value)
  return trimmed && isSlug(trimmed) ? trimmed : fallback
}

const normalizeSectionAliasKey = (value: string): string => (
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
)

const createShopEntrySectionAliasMap = (): Map<string, ShopEntrySectionKey> => {
  const aliases = new Map<string, ShopEntrySectionKey>()

  for (const section of TRAINER_INVENTORY_SECTIONS) {
    aliases.set(normalizeSectionAliasKey(section.key), section.key)
    aliases.set(normalizeSectionAliasKey(section.title), section.key)
  }

  aliases.set('keyitem', 'keyItems')
  aliases.set('item', 'keyItems')
  aliases.set('items', 'keyItems')
  aliases.set('pokemonitem', 'pokemonItems')
  aliases.set('pokemonitems', 'pokemonItems')
  aliases.set('pokeball', 'pokeBalls')
  aliases.set('pokeballs', 'pokeBalls')
  aliases.set('medicine', 'medicalKit')
  aliases.set('medical', 'medicalKit')
  aliases.set('food', 'foodStuff')
  aliases.set('foods', 'foodStuff')
  aliases.set('gear', 'equipment')

  return aliases
}

const SHOP_ENTRY_SECTION_ALIAS_MAP = createShopEntrySectionAliasMap()

export const isShopPaymentSourceKind = (value: unknown): value is ShopPaymentSourceKind => (
  typeof value === 'string' && SHOP_PAYMENT_SOURCE_KIND_SET.has(value as ShopPaymentSourceKind)
)

export const isShopDeliveryTargetKind = (value: unknown): value is ShopDeliveryTargetKind => (
  typeof value === 'string' && SHOP_DELIVERY_TARGET_KIND_SET.has(value as ShopDeliveryTargetKind)
)

export const isShopEntrySectionKey = (value: unknown): value is ShopEntrySectionKey => (
  typeof value === 'string' && SHOP_ENTRY_SECTION_KEY_SET.has(value as ShopEntrySectionKey)
)

export const normalizeShopEntrySection = (
  value: unknown,
  fallback: ShopEntrySectionKey = SHOP_DEFAULT_ENTRY_SECTION,
): ShopEntrySectionKey => {
  const trimmed = trimString(value)
  if (!trimmed) return fallback
  if (isShopEntrySectionKey(trimmed)) return trimmed
  return SHOP_ENTRY_SECTION_ALIAS_MAP.get(normalizeSectionAliasKey(trimmed)) ?? fallback
}

const normalizeKindList = <TKind extends string>(
  value: unknown,
  isKind: (candidate: unknown) => candidate is TKind,
  fallback: readonly TKind[],
): TKind[] => {
  const rawValues = Array.isArray(value) ? value : [value]
  const normalized: TKind[] = []

  for (const rawValue of rawValues) {
    const trimmed = trimString(rawValue)
    if (!trimmed || !isKind(trimmed) || normalized.includes(trimmed)) continue
    normalized.push(trimmed)
  }

  return normalized.length > 0 ? normalized : [...fallback]
}

export const normalizeShopPaymentSources = (value: unknown): ShopPaymentSourceKind[] => (
  normalizeKindList(value, isShopPaymentSourceKind, SHOP_DEFAULT_PAYMENT_SOURCES)
)

export const normalizeShopDeliveryTargets = (value: unknown): ShopDeliveryTargetKind[] => (
  normalizeKindList(value, isShopDeliveryTargetKind, SHOP_DEFAULT_DELIVERY_TARGETS)
)

const normalizeRowId = (value: unknown): string | null => {
  const trimmed = trimString(value)
  return trimmed ? trimmed : null
}

const fallbackRowId = (state: ShopEntryRowIdState): string => {
  do {
    state.fallbackRowIdCounter += 1
    const candidate = `${SHOP_TABLE_ROW_ID_PREFIX}-${state.fallbackRowIdCounter.toString(36)}`
    if (!state.usedRowIds.has(candidate)) return candidate
  } while (state.fallbackRowIdCounter < Number.MAX_SAFE_INTEGER)

  throw new Error('Unable to allocate a unique shop entry row id.')
}

export const createShopEntryRowId: ShopEntryRowIdGenerator = ({ index }) => (
  `${SHOP_TABLE_ROW_ID_PREFIX}-${(index + 1).toString(36)}`
)

const uniqueRowId = (
  preferredId: unknown,
  context: ShopEntryRowIdContext,
  state: ShopEntryRowIdState,
): string => {
  const normalizedPreferredId = normalizeRowId(preferredId)
  if (normalizedPreferredId && !state.usedRowIds.has(normalizedPreferredId)) {
    state.usedRowIds.add(normalizedPreferredId)
    return normalizedPreferredId
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const generatedId = normalizeRowId(state.generateRowId(context))
    if (generatedId && !state.usedRowIds.has(generatedId)) {
      state.usedRowIds.add(generatedId)
      return generatedId
    }
  }

  const generatedFallbackId = fallbackRowId(state)
  state.usedRowIds.add(generatedFallbackId)
  return generatedFallbackId
}

export const normalizeShopStock = (value: unknown): ShopStockValue => {
  if (value == null) return null

  const trimmed = trimString(value)
  if (trimmed === '') return null
  if (trimmed && ['unlimited', 'infinite', 'infinity'].includes(trimmed.toLowerCase())) return null

  return coerceSafeNonNegativeInteger(value)
}

const normalizeOptionalPositiveInteger = (value: unknown): number | undefined => {
  if (value == null) return undefined
  const normalized = coerceSafeNonNegativeInteger(value)
  return normalized > 0 ? normalized : undefined
}

const normalizeTags = (value: unknown): string[] | undefined => {
  const rawTags = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const tags: string[] = []

  for (const rawTag of rawTags) {
    const tag = normalizeOptionalString(rawTag)
    if (tag && !tags.includes(tag)) tags.push(tag)
  }

  return tags.length > 0 ? tags : undefined
}

const setOptionalEntryStringField = (
  entry: ShopEntry,
  field: OptionalShopEntryStringField,
  value: unknown,
): void => {
  const normalized = normalizeOptionalString(value)
  if (normalized !== undefined) entry[field] = normalized
}

const normalizeShopEntry = (
  rawEntry: Record<string, unknown> | string,
  index: number,
  rowIdState: ShopEntryRowIdState,
): ShopEntry => {
  const source = typeof rawEntry === 'string' ? { itemName: rawEntry } : rawEntry
  const section = normalizeShopEntrySection(source.section)
  const itemName = normalizeRequiredString(source.itemName, normalizeRequiredString(source.name, ''))
  const entry: ShopEntry = {
    id: uniqueRowId(source.id, { index, itemName, section }, rowIdState),
    itemName,
    section,
    price: coerceSafeNonNegativeInteger(source.price),
    stock: normalizeShopStock(source.stock),
  }

  const maxPerPurchase = normalizeOptionalPositiveInteger(source.maxPerPurchase)
  if (maxPerPurchase !== undefined) entry.maxPerPurchase = maxPerPurchase

  setOptionalEntryStringField(entry, 'playerDescription', source.playerDescription ?? source.description)
  setOptionalEntryStringField(entry, 'gmNotes', source.gmNotes)

  const tags = normalizeTags(source.tags)
  if (tags !== undefined) entry.tags = tags

  return entry
}

const shopEntriesFromUnknown = (value: unknown): (Record<string, unknown> | string)[] => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> | string => isRecord(entry) || typeof entry === 'string')
  }

  if (!isRecord(value)) return []

  if (Object.hasOwn(value, 'itemName') || Object.hasOwn(value, 'name') || Object.hasOwn(value, 'id')) return [value]

  return Object.values(value).filter((entry): entry is Record<string, unknown> | string => (
    isRecord(entry) || typeof entry === 'string'
  ))
}

export const normalizeShopEntries = (
  value: unknown,
  options: Pick<ShopTableNormalizationOptions, 'generateRowId'> = {},
): ShopEntry[] => {
  const rowIdState: ShopEntryRowIdState = {
    generateRowId: options.generateRowId ?? createShopEntryRowId,
    usedRowIds: new Set<string>(),
    fallbackRowIdCounter: 0,
  }

  return shopEntriesFromUnknown(value).map((entry, index) => normalizeShopEntry(entry, index, rowIdState))
}

export const createDefaultShopTableDocument = (
  options: ShopTableNormalizationOptions = {},
): ShopTableDocument => ({
  slug: normalizeShopSlug(options.slug),
  revision: 0,
  updatedAt: coerceSafeNonNegativeInteger(options.now, Date.now()),
  name: normalizeRequiredString(options.name, SHOP_DEFAULT_NAME),
  playerVisible: false,
  open: false,
  allowedPaymentSources: [...SHOP_DEFAULT_PAYMENT_SOURCES],
  allowedDeliveryTargets: [...SHOP_DEFAULT_DELIVERY_TARGETS],
  entries: [],
})

export const normalizeShopTableDocument = (
  value: unknown,
  options: ShopTableNormalizationOptions = {},
): ShopTableDocument => {
  const source = isRecord(value) ? value : {}
  const now = coerceSafeNonNegativeInteger(options.now, Date.now())
  const document: ShopTableDocument = {
    slug: normalizeShopSlug(source.slug, normalizeShopSlug(options.slug)),
    revision: normalizeRevision(source.revision),
    updatedAt: normalizeUpdatedAt(source.updatedAt, now),
    name: normalizeRequiredString(source.name, normalizeRequiredString(options.name, SHOP_DEFAULT_NAME)),
    playerVisible: normalizeBoolean(source.playerVisible),
    open: normalizeBoolean(source.open),
    allowedPaymentSources: normalizeShopPaymentSources(source.allowedPaymentSources),
    allowedDeliveryTargets: normalizeShopDeliveryTargets(source.allowedDeliveryTargets),
    entries: normalizeShopEntries(source.entries, options),
  }

  const folder = normalizeOptionalString(source.folder)
  if (folder !== undefined) document.folder = folder

  const description = normalizeOptionalString(source.description)
  if (description !== undefined) document.description = description

  const gmNotes = normalizeOptionalString(source.gmNotes)
  if (gmNotes !== undefined) document.gmNotes = gmNotes

  return document
}
