import { findItem, items } from '~~/data/ptuReference'
import { ptuItemOptionDetail } from '~/utils/reference/itemOptions'
import type { PtuItem } from '~/types/ptuReference'
import type { InventoryEntry } from '~/types/trainerSheet'
import type {
  TrainerInventoryKey,
  TrainerInventoryTableVariant,
} from '~/utils/sheets/trainerInventorySections'

export interface TrainerInventoryItemOption {
  readonly value: string
  readonly label: string
}

const AUTOFILL_FIELDS = ['qty', 'cost', 'description', 'mod', 'slot'] as const satisfies readonly (keyof InventoryEntry)[]

type TrainerInventoryAutofillField = (typeof AUTOFILL_FIELDS)[number]
type TrainerInventoryAutofillPatch = Partial<Pick<InventoryEntry, TrainerInventoryAutofillField>>

const SECTION_SEARCH_KEYWORDS = {
  keyItems: [
    'trainer essential',
    'crafting',
    'toolkit',
    'evolutionary',
    'hm',
    'tm',
    'repel',
    'rope',
    'gardening',
  ],
  pokemonItems: [
    'held item',
    'evolutionary',
    'vitamin',
    'x-item',
    'combat item',
    'tm',
    'hm',
    'pokemon toolkit',
  ],
  medicalKit: [
    'medicine',
    'medicines',
    'herb',
    'bandages',
    'poultices',
    'repel',
    'refreshment',
  ],
  pokeBalls: [
    'poke ball',
    'apricorn',
  ],
  foodStuff: [
    'food',
    'snack',
    'refreshment',
    'berry',
    'berries',
    'herb',
    'apricorn',
  ],
  equipment: [
    'equipment',
    'weapon',
    'accessory',
  ],
} as const satisfies Record<TrainerInventoryKey, readonly string[]>

const optionCache: Partial<Record<TrainerInventoryKey, readonly TrainerInventoryItemOption[]>> = {}

const normalizeSearchText = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

const inventoryItemSearchText = (item: PtuItem): string =>
  normalizeSearchText([
    item.name,
    ...item.aliases,
    ...item.categories,
    ...item.sections,
  ].join(' '))

const inventoryItemMatchesSection = (item: PtuItem, sectionKey: TrainerInventoryKey): boolean => {
  const haystack = inventoryItemSearchText(item)
  return SECTION_SEARCH_KEYWORDS[sectionKey].some((keyword) => haystack.includes(keyword))
}

const compareItemsForSection = (sectionKey: TrainerInventoryKey) => (a: PtuItem, b: PtuItem): number => {
  const aRank = inventoryItemMatchesSection(a, sectionKey) ? 0 : 1
  const bRank = inventoryItemMatchesSection(b, sectionKey) ? 0 : 1
  if (aRank !== bRank) return aRank - bRank
  return a.name.localeCompare(b.name)
}

export const trainerInventoryItemOptions = (sectionKey: TrainerInventoryKey): readonly TrainerInventoryItemOption[] => {
  const cached = optionCache[sectionKey]
  if (cached) return cached

  const options = [...items]
    .sort(compareItemsForSection(sectionKey))
    .map((item) => ({
      value: item.name,
      label: ptuItemOptionDetail(item),
    }))

  optionCache[sectionKey] = options
  return options
}

export const resolveTrainerInventoryItemReference = (
  entryOrName: Pick<InventoryEntry, 'name'> | string | null | undefined,
): PtuItem | null => {
  const name = typeof entryOrName === 'string' ? entryOrName : entryOrName?.name
  return name?.trim() ? findItem(name) : null
}

export const formatTrainerInventoryItemCost = (item: PtuItem): string => item.costs.join(', ')

export const formatTrainerInventoryItemDescription = (item: PtuItem): string => [
  ...item.effects,
  ...item.notes.map((note) => `Note: ${note}`),
].join('\n')

const captureModifierForItem = (item: PtuItem): string | undefined => {
  const match = item.effects.join(' ').match(/Capture Modifier\s*([+-]\d+)/i)
  return match?.[1]
}

const equipmentSlotForItem = (item: PtuItem): string | undefined => {
  const searchText = normalizeSearchText([
    inventoryItemSearchText(item),
    ...item.effects,
  ].join(' '))
  if (searchText.includes('head equipment') || searchText.includes('head item')) return 'Head'
  if (searchText.includes('body equipment') || searchText.includes('body item')) return 'Body'
  if (searchText.includes('feet equipment') || searchText.includes('feet item')) return 'Feet'
  if (searchText.includes('accessory item') || searchText.includes('accessory')) return 'Accessory'
  if (searchText.includes('hand equipment') || searchText.includes('hand item') || searchText.includes('weapon')) return 'Hand'
  return undefined
}

export const buildTrainerInventoryAutofillPatch = (
  item: PtuItem,
  variant: TrainerInventoryTableVariant,
): TrainerInventoryAutofillPatch => {
  const patch: TrainerInventoryAutofillPatch = {}
  if (variant !== 'equipment') patch.qty = 1

  const cost = formatTrainerInventoryItemCost(item)
  if (cost) patch.cost = cost

  const description = formatTrainerInventoryItemDescription(item)
  if (description) patch.description = description

  if (variant === 'pokeBalls') {
    const mod = captureModifierForItem(item)
    if (mod) patch.mod = mod
  }

  if (variant === 'equipment') {
    const slot = equipmentSlotForItem(item)
    if (slot) patch.slot = slot
  }

  return patch
}

const isBlankInventoryValue = (value: InventoryEntry[TrainerInventoryAutofillField]): boolean => (
  value == null || (typeof value === 'string' && value.trim() === '')
)

const parseCurrencyAmount = (value: InventoryEntry[TrainerInventoryAutofillField]): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^\$?\s*([\d,]+)$/)
  return match ? Number(match[1].replace(/,/g, '')) : null
}

const inventoryFieldValuesMatch = (
  field: TrainerInventoryAutofillField,
  current: InventoryEntry[TrainerInventoryAutofillField],
  autofilled: InventoryEntry[TrainerInventoryAutofillField],
): boolean => {
  if (field === 'cost') {
    const currentCurrency = parseCurrencyAmount(current)
    const autofilledCurrency = parseCurrencyAmount(autofilled)
    if (currentCurrency != null && autofilledCurrency != null) return currentCurrency === autofilledCurrency
  }

  return String(current ?? '').trim() === String(autofilled ?? '').trim()
}

const shouldApplyAutofillField = (
  entry: InventoryEntry,
  field: TrainerInventoryAutofillField,
  previousPatch: TrainerInventoryAutofillPatch,
): boolean => {
  const current = entry[field]
  if (isBlankInventoryValue(current)) return true

  const previousValue = previousPatch[field]
  return previousValue !== undefined && inventoryFieldValuesMatch(field, current, previousValue)
}

const assignAutofillField = (
  entry: InventoryEntry,
  field: TrainerInventoryAutofillField,
  value: InventoryEntry[TrainerInventoryAutofillField],
) => {
  ;(entry as Record<TrainerInventoryAutofillField, InventoryEntry[TrainerInventoryAutofillField]>)[field] = value
}

const clearAutofillField = (entry: InventoryEntry, field: TrainerInventoryAutofillField) => {
  delete entry[field]
}

const applyTrainerInventoryAutofillPatch = (
  entry: InventoryEntry,
  nextPatch: TrainerInventoryAutofillPatch,
  previousPatch: TrainerInventoryAutofillPatch = {},
): void => {
  for (const field of AUTOFILL_FIELDS) {
    const nextValue = nextPatch[field]
    if (nextValue === undefined || isBlankInventoryValue(nextValue)) {
      if (field === 'qty') continue

      const previousValue = previousPatch[field]
      const current = entry[field]
      if (previousValue !== undefined && inventoryFieldValuesMatch(field, current, previousValue)) {
        clearAutofillField(entry, field)
      }
      continue
    }

    if (shouldApplyAutofillField(entry, field, previousPatch)) {
      assignAutofillField(entry, field, nextValue)
    }
  }
}

export const autofillTrainerInventoryItem = (
  entry: InventoryEntry,
  variant: TrainerInventoryTableVariant,
): boolean => {
  const reference = resolveTrainerInventoryItemReference(entry)
  if (!reference) return false
  applyTrainerInventoryAutofillPatch(entry, buildTrainerInventoryAutofillPatch(reference, variant))
  return true
}

export const setTrainerInventoryItemName = (
  entry: InventoryEntry,
  rawName: string,
  variant: TrainerInventoryTableVariant,
): void => {
  const previousReference = resolveTrainerInventoryItemReference(entry)
  const previousPatch = previousReference
    ? buildTrainerInventoryAutofillPatch(previousReference, variant)
    : {}

  const trimmedName = rawName.trim()
  const nextReference = resolveTrainerInventoryItemReference(trimmedName)
  entry.name = nextReference?.name ?? trimmedName

  if (!nextReference) {
    applyTrainerInventoryAutofillPatch(entry, {}, previousPatch)
    return
  }

  applyTrainerInventoryAutofillPatch(
    entry,
    buildTrainerInventoryAutofillPatch(nextReference, variant),
    previousPatch,
  )
}
