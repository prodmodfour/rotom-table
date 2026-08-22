import { isSlug } from '#shared/paths'
import { normalizeRevision } from '#shared/sessionRevisions'
import { parseSerializedEquipmentInventoryState } from '#shared/itemAutomation/equipment'
import { parseItemShardInventoryVariant } from '#shared/itemAutomation/exploration'
import type { InventoryEntry } from '~/types/trainerSheet'
import { TRAINER_INVENTORY_SECTIONS } from '~/utils/sheets/trainerInventorySections'
import type { TrainerInventoryKey } from '~/utils/sheets/trainerInventorySections'

export const GROUP_INVENTORY_MAIN_SLUG = 'main'
export const GROUP_INVENTORY_ROW_ID_PREFIX = 'group-item'
export const GROUP_INVENTORY_MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER

export type GroupInventorySlug = string
export type GroupInventorySectionKey = TrainerInventoryKey
export type GroupInventoryEntryId = string

export interface GroupInventoryEntry extends InventoryEntry {
  id: GroupInventoryEntryId
}

export type GroupInventory = Record<GroupInventorySectionKey, GroupInventoryEntry[]>

export interface GroupInventoryDocument {
  slug: GroupInventorySlug
  revision: number
  updatedAt: number
  money: number
  inventory: GroupInventory
  notes?: string
}

export interface GroupInventoryRowIdContext {
  readonly section: GroupInventorySectionKey
  readonly index: number
}

export type GroupInventoryRowIdGenerator = (context: GroupInventoryRowIdContext) => string

export interface GroupInventoryNormalizationOptions {
  readonly slug?: unknown
  readonly now?: number
  readonly generateRowId?: GroupInventoryRowIdGenerator
}

interface RowIdNormalizationState {
  readonly generateRowId: GroupInventoryRowIdGenerator
  readonly usedRowIds: Set<string>
  fallbackRowIdCounter: number
}

type NormalizedEntryOptionalStringField = 'cost' | 'description' | 'mod' | 'slot'

export const GROUP_INVENTORY_SECTION_KEYS = TRAINER_INVENTORY_SECTIONS.map((section) => section.key)

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

const coerceSafeNonNegativeInteger = (value: unknown, fallback = 0): number => {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN

  if (!Number.isFinite(numericValue)) return fallback
  if (numericValue <= 0) return 0
  return Math.min(Math.floor(numericValue), GROUP_INVENTORY_MAX_SAFE_INTEGER)
}

const normalizeGroupInventorySlug = (value: unknown, fallback: string = GROUP_INVENTORY_MAIN_SLUG): GroupInventorySlug => {
  const trimmed = trimString(value)
  return trimmed && isSlug(trimmed) ? trimmed : fallback
}

const normalizeUpdatedAt = (value: unknown, fallback: number): number => coerceSafeNonNegativeInteger(value, fallback)

export const createGroupInventoryRowId: GroupInventoryRowIdGenerator = () => {
  const randomUuid = globalThis.crypto?.randomUUID?.()
  if (randomUuid) return `${GROUP_INVENTORY_ROW_ID_PREFIX}-${randomUuid}`

  const timestamp = Date.now().toString(36)
  const entropy = Math.random().toString(36).slice(2, 10)
  return `${GROUP_INVENTORY_ROW_ID_PREFIX}-${timestamp}-${entropy}`
}

export const createEmptyGroupInventory = (): GroupInventory => Object.fromEntries(
  GROUP_INVENTORY_SECTION_KEYS.map((key) => [key, []]),
) as unknown as GroupInventory

export const createDefaultGroupInventoryDocument = (
  options: GroupInventoryNormalizationOptions = {},
): GroupInventoryDocument => ({
  slug: normalizeGroupInventorySlug(options.slug),
  revision: 0,
  updatedAt: coerceSafeNonNegativeInteger(options.now, Date.now()),
  money: 0,
  inventory: createEmptyGroupInventory(),
})

const normalizeRowId = (value: unknown): string | null => {
  const trimmed = trimString(value)
  return trimmed ? trimmed : null
}

const fallbackRowId = (state: RowIdNormalizationState): string => {
  do {
    state.fallbackRowIdCounter += 1
    const candidate = `${GROUP_INVENTORY_ROW_ID_PREFIX}-${state.fallbackRowIdCounter.toString(36)}`
    if (!state.usedRowIds.has(candidate)) return candidate
  } while (state.fallbackRowIdCounter < Number.MAX_SAFE_INTEGER)

  throw new Error('Unable to allocate a unique group inventory row id.')
}

const uniqueRowId = (
  preferredId: unknown,
  context: GroupInventoryRowIdContext,
  state: RowIdNormalizationState,
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

const sectionUsesQuantity = (section: GroupInventorySectionKey): boolean => section !== 'equipment'

const normalizeEntryCost = (entry: GroupInventoryEntry, value: unknown): void => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    entry.cost = value
    return
  }

  const normalizedCost = normalizeOptionalString(value)
  if (normalizedCost !== undefined) entry.cost = normalizedCost
}

const normalizeEntryOptionalStringField = (
  entry: GroupInventoryEntry,
  field: NormalizedEntryOptionalStringField,
  value: unknown,
): void => {
  if (field === 'cost') {
    normalizeEntryCost(entry, value)
    return
  }

  const normalizedValue = normalizeOptionalString(value)
  if (normalizedValue !== undefined) entry[field] = normalizedValue
}

const normalizeGroupInventoryEntry = (
  rawEntry: Record<string, unknown> | string,
  section: GroupInventorySectionKey,
  index: number,
  rowIdState: RowIdNormalizationState,
): GroupInventoryEntry => {
  const source = typeof rawEntry === 'string' ? { name: rawEntry } : rawEntry
  const entry: GroupInventoryEntry = {
    id: uniqueRowId(source.id, { section, index }, rowIdState),
    name: trimString(source.name) ?? '',
  }

  if (Object.hasOwn(source, 'serializedEquipment')) {
    entry.serializedEquipment = parseSerializedEquipmentInventoryState(source.serializedEquipment)
    if (Object.hasOwn(source, 'itemVariant')) throw new Error('Serialized equipment cannot also carry stack item variant authority.')
  }
  else if (sectionUsesQuantity(section) && Object.hasOwn(source, 'qty')) {
    entry.qty = coerceSafeNonNegativeInteger(source.qty)
  }
  if (!Object.hasOwn(source, 'serializedEquipment') && Object.hasOwn(source, 'itemVariant')) {
    entry.itemVariant = parseItemShardInventoryVariant(source.itemVariant)
  }
  if (Object.hasOwn(source, 'contestPoffinStatId')) {
    if (entry.name !== 'Poffin' || typeof source.contestPoffinStatId !== 'string' || !['beauty','cool','cute','smart','tough'].includes(source.contestPoffinStatId)) throw new Error('Group inventory contains an invalid crafted Poffin Contest-stat identity.')
    entry.contestPoffinStatId = source.contestPoffinStatId as NonNullable<InventoryEntry['contestPoffinStatId']>
  }
  for (const field of ['cost', 'description', 'mod', 'slot'] as const) {
    if (Object.hasOwn(source, field)) normalizeEntryOptionalStringField(entry, field, source[field])
  }

  return entry
}

const sectionRowsFromUnknown = (value: unknown): (Record<string, unknown> | string)[] => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> | string => isRecord(entry) || typeof entry === 'string')
  }

  if (!isRecord(value)) return []

  if (Object.hasOwn(value, 'name') || Object.hasOwn(value, 'id')) return [value]

  return Object.values(value).filter((entry): entry is Record<string, unknown> | string => (
    isRecord(entry) || typeof entry === 'string'
  ))
}

export const normalizeGroupInventory = (
  value: unknown,
  options: GroupInventoryNormalizationOptions = {},
): GroupInventory => {
  const source = isRecord(value) ? value : {}
  const rowIdState: RowIdNormalizationState = {
    generateRowId: options.generateRowId ?? createGroupInventoryRowId,
    usedRowIds: new Set<string>(),
    fallbackRowIdCounter: 0,
  }

  const inventory = Object.fromEntries(
    GROUP_INVENTORY_SECTION_KEYS.map((section) => [
      section,
      sectionRowsFromUnknown(source[section]).map((entry, index) => (
        normalizeGroupInventoryEntry(entry, section, index, rowIdState)
      )),
    ]),
  ) as GroupInventory
  const serializedIds = GROUP_INVENTORY_SECTION_KEYS.flatMap(section => inventory[section]
    .flatMap(entry => entry.serializedEquipment?.instanceId ? [entry.serializedEquipment.instanceId] : []))
  if (new Set(serializedIds).size !== serializedIds.length) {
    throw new Error('Group inventory contains a duplicate serialized equipment identity.')
  }
  return inventory
}

export const normalizeGroupInventoryDocument = (
  value: unknown,
  options: GroupInventoryNormalizationOptions = {},
): GroupInventoryDocument => {
  const source = isRecord(value) ? value : {}
  const now = coerceSafeNonNegativeInteger(options.now, Date.now())
  const normalizedDocument: GroupInventoryDocument = {
    slug: normalizeGroupInventorySlug(source.slug, normalizeGroupInventorySlug(options.slug)),
    revision: normalizeRevision(source.revision),
    updatedAt: normalizeUpdatedAt(source.updatedAt, now),
    money: coerceSafeNonNegativeInteger(source.money),
    inventory: normalizeGroupInventory(source.inventory, options),
  }

  const notes = normalizeOptionalString(source.notes)
  if (notes !== undefined) normalizedDocument.notes = notes

  return normalizedDocument
}
