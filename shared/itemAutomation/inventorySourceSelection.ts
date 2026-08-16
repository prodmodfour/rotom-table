import type { ItemInventorySection, ItemSourceContainerKind } from './inventory'
import type { SheetItemActionOfferV1, SheetItemActionProjectionV1 } from './sheetActions'

export const INVENTORY_SOURCE_SELECTION_SCHEMA_VERSION = 1 as const

export interface InventorySourceSelectionOptionV1 {
  readonly schemaVersion: typeof INVENTORY_SOURCE_SELECTION_SCHEMA_VERSION
  /** Opaque source choice used only to select another current server offer. */
  readonly sourceSelectionId: string
  /** Opaque current offer; never rendered as user-facing provenance. */
  readonly offerId: string
  readonly containerKind: ItemSourceContainerKind
  readonly containerLabel: string
  readonly section: ItemInventorySection
  readonly sectionLabel: string
  readonly rowIndex: number
  readonly rowLabel: string
  readonly itemLabel: string
  readonly quantity: number
  readonly selected: boolean
}

export interface InventorySourceSelectionV1 {
  readonly schemaVersion: typeof INVENTORY_SOURCE_SELECTION_SCHEMA_VERSION
  readonly canonicalItemId: string
  readonly totalQuantity: number
  readonly options: readonly InventorySourceSelectionOptionV1[]
}

const hasEnabledUse = (offer: SheetItemActionOfferV1): boolean => (
  offer.availability.enabled
  && offer.actions.some(action => action.kind === 'use' && action.enabled)
)

/**
 * Groups only current, enabled, canonical-equal server offers. Presentation row
 * labels are safe locators; the selected offer is still re-declared and
 * reauthorized by the server before any item command can be created.
 */
export const projectSheetItemInventorySources = (
  projection: SheetItemActionProjectionV1 | null,
  selectedOffer: SheetItemActionOfferV1 | null,
): InventorySourceSelectionV1 | null => {
  const canonicalItemId = selectedOffer?.source.canonicalId
  if (!projection || !selectedOffer || !canonicalItemId
    || !projection.offers.some(offer => offer.offerId === selectedOffer.offerId)
    || !hasEnabledUse(selectedOffer)) return null

  const options = projection.offers
    .filter(offer => offer.source.canonicalId === canonicalItemId && hasEnabledUse(offer))
    .sort((left, right) => left.source.section.localeCompare(right.source.section)
      || left.source.rowIndex - right.source.rowIndex)
    .map((offer): InventorySourceSelectionOptionV1 => Object.freeze({
      schemaVersion: INVENTORY_SOURCE_SELECTION_SCHEMA_VERSION,
      sourceSelectionId: offer.source.sourceSelectionId,
      offerId: offer.offerId,
      containerKind: offer.source.containerKind,
      containerLabel: offer.source.containerLabel,
      section: offer.source.section,
      sectionLabel: offer.source.sectionLabel,
      rowIndex: offer.source.rowIndex,
      rowLabel: offer.source.rowLabel,
      itemLabel: offer.source.displayName,
      quantity: offer.source.quantity,
      selected: offer.offerId === selectedOffer.offerId,
    }))
  if (!options.some(option => option.selected)) return null
  const totalQuantity = options.reduce((total, option) => {
    const next = total + option.quantity
    return Number.isSafeInteger(next) ? next : Number.MAX_SAFE_INTEGER
  }, 0)
  return Object.freeze({
    schemaVersion: INVENTORY_SOURCE_SELECTION_SCHEMA_VERSION,
    canonicalItemId,
    totalQuantity,
    options: Object.freeze(options),
  })
}
