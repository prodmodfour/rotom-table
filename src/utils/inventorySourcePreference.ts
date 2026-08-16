import {
  ITEM_INVENTORY_SECTIONS,
  ITEM_SOURCE_CONTAINER_KINDS,
  type ItemInventorySection,
  type ItemSourceContainerKind,
} from '#shared/itemAutomation/inventory'
import type { InventorySourceSelectionOptionV1 } from '#shared/itemAutomation/inventorySourceSelection'

export const INVENTORY_SOURCE_PREFERENCE_STORAGE_KEY = 'rotom-table:inventory-source-presentation:v1'

export interface InventorySourcePresentationPreferenceV1 {
  readonly schemaVersion: 1
  readonly preferredContainerKind: ItemSourceContainerKind
  readonly preferredSection: ItemInventorySection
}

const CONTAINER_KINDS = new Set<string>(ITEM_SOURCE_CONTAINER_KINDS)
const SECTIONS = new Set<string>(ITEM_INVENTORY_SECTIONS)

export const parseInventorySourcePresentationPreference = (
  value: unknown,
): InventorySourcePresentationPreferenceV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Inventory source presentation preference must be an object.')
  }
  const input = value as Record<string, unknown>
  const fields = ['schemaVersion', 'preferredContainerKind', 'preferredSection']
  if (Object.keys(input).length !== fields.length || fields.some(field => !Object.hasOwn(input, field))
    || input.schemaVersion !== 1
    || typeof input.preferredContainerKind !== 'string' || !CONTAINER_KINDS.has(input.preferredContainerKind)
    || typeof input.preferredSection !== 'string' || !SECTIONS.has(input.preferredSection)) {
    throw new Error('Inventory source presentation preference has an invalid shape.')
  }
  return Object.freeze({
    schemaVersion: 1,
    preferredContainerKind: input.preferredContainerKind as ItemSourceContainerKind,
    preferredSection: input.preferredSection as ItemInventorySection,
  })
}

export const loadInventorySourcePresentationPreference = (): InventorySourcePresentationPreferenceV1 | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(INVENTORY_SOURCE_PREFERENCE_STORAGE_KEY)
    if (raw === null) return null
    return parseInventorySourcePresentationPreference(JSON.parse(raw))
  }
  catch {
    try { window.localStorage.removeItem(INVENTORY_SOURCE_PREFERENCE_STORAGE_KEY) }
    catch { /* Presentation storage must never block authoritative inventory actions. */ }
    return null
  }
}

/** Stores presentation ordering only; no sheet, row, offer, operation, or principal identity is retained. */
export const rememberInventorySourcePresentationPreference = (input: {
  readonly containerKind: ItemSourceContainerKind
  readonly section: ItemInventorySection
}): InventorySourcePresentationPreferenceV1 => {
  const preference = parseInventorySourcePresentationPreference({
    schemaVersion: 1,
    preferredContainerKind: input.containerKind,
    preferredSection: input.section,
  })
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(INVENTORY_SOURCE_PREFERENCE_STORAGE_KEY, JSON.stringify(preference)) }
    catch { /* Presentation storage must never block authoritative inventory actions. */ }
  }
  return preference
}

export const orderInventorySourceOptions = (
  options: readonly InventorySourceSelectionOptionV1[],
  preference: InventorySourcePresentationPreferenceV1 | null,
): readonly InventorySourceSelectionOptionV1[] => Object.freeze([...options].sort((left, right) => {
  if (preference) {
    const leftPreferred = left.containerKind === preference.preferredContainerKind && left.section === preference.preferredSection
    const rightPreferred = right.containerKind === preference.preferredContainerKind && right.section === preference.preferredSection
    if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1
  }
  return left.containerLabel.localeCompare(right.containerLabel)
    || left.sectionLabel.localeCompare(right.sectionLabel)
    || left.rowIndex - right.rowIndex
}))
