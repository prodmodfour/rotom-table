import type { ShopCheckoutLineInput, ShopCheckoutResultLine } from '#shared/livePlayCommands'
import {
  createGroupInventoryRowId,
  GROUP_INVENTORY_SECTION_KEYS,
  type GroupInventory,
  type GroupInventoryDocument,
  type GroupInventorySectionKey,
} from '~/types/groupInventory'
import type { ShopEntry, ShopTableDocument } from '~/types/shop'
import type { TrainerInventory, TrainerSheet } from '~/types/trainerSheet'
import {
  inventoryTransferEntriesCanMerge,
  inventoryTransferSectionUsesQuantity,
  mergeInventoryEntryIntoSection,
  InventoryTransferError,
  type InventoryTransferEntry,
  type InventoryTransferInventory,
  type InventoryTransferSnapshot,
  type InventoryTransferTargetRowIdGenerator,
} from '~/utils/groupInventoryTransfers'

export type ShopCheckoutCalculationErrorCode =
  | 'empty-checkout'
  | 'invalid-line-quantity'
  | 'missing-entry'
  | 'max-per-purchase-exceeded'
  | 'insufficient-stock'
  | 'insufficient-money'
  | 'invalid-total'

export class ShopCheckoutCalculationError extends Error {
  readonly code: ShopCheckoutCalculationErrorCode

  constructor(code: ShopCheckoutCalculationErrorCode, message: string) {
    super(message)
    this.name = 'ShopCheckoutCalculationError'
    this.code = code
  }
}

export interface ShopCheckoutCalculationLineInput extends Omit<ShopCheckoutLineInput, 'quantity'> {
  readonly quantity: unknown
}

export interface ShopCheckoutPurchasedEntry {
  readonly entry: ShopEntry
  readonly quantity: number
  readonly unitPrice: number
  readonly lineTotal: number
  readonly remainingStock: number | null
}

export interface CalculateShopCheckoutInput {
  readonly shop: ShopTableDocument
  readonly lines: readonly ShopCheckoutCalculationLineInput[]
}

export interface ShopCheckoutCalculationResult {
  readonly shop: ShopTableDocument
  readonly totalPrice: number
  readonly lines: readonly ShopCheckoutResultLine[]
  readonly purchasedEntries: readonly ShopCheckoutPurchasedEntry[]
}

export interface ApplyShopCheckoutDeliveryInput {
  readonly inventory: InventoryTransferInventory | null | undefined
  readonly purchasedEntries: readonly ShopCheckoutPurchasedEntry[]
  readonly createTargetRowId?: InventoryTransferTargetRowIdGenerator
}

export interface ApplyShopCheckoutGroupDeliveryInput {
  readonly groupInventory: GroupInventoryDocument
  readonly purchasedEntries: readonly ShopCheckoutPurchasedEntry[]
  readonly createTargetRowId?: InventoryTransferTargetRowIdGenerator
}

export interface ApplyShopCheckoutTrainerDeliveryInput {
  readonly trainerSheet: TrainerSheet
  readonly purchasedEntries: readonly ShopCheckoutPurchasedEntry[]
  readonly createTargetRowId?: InventoryTransferTargetRowIdGenerator
}

export interface ShopCheckoutMoneyDocument {
  readonly money?: number
}

export interface ShopCheckoutDeliveredInventorySource {
  readonly entryId: string
  readonly itemName: string
  readonly section: GroupInventorySectionKey
  readonly quantity: number
  readonly rowId: string
  readonly rowIndex: number
}

export interface ShopCheckoutInventoryDeliveryResult {
  readonly inventory: InventoryTransferSnapshot
  readonly sources: readonly ShopCheckoutDeliveredInventorySource[]
}

interface AggregatedLine {
  readonly entryId: string
  quantity: number
}

const MAX_SAFE_CHECKOUT_INTEGER = Number.MAX_SAFE_INTEGER

const trimText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const finiteNumberFromUnknown = (value: unknown): number | null => {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN

  return Number.isFinite(numericValue) ? numericValue : null
}

const coerceStoredNonNegativeInteger = (value: unknown): number => {
  const numericValue = finiteNumberFromUnknown(value)
  if (numericValue == null || numericValue <= 0) return 0
  return Math.min(Math.floor(numericValue), MAX_SAFE_CHECKOUT_INTEGER)
}

const requirePositiveSafeInteger = (value: unknown, label: string): number => {
  const numericValue = finiteNumberFromUnknown(value)
  if (numericValue == null || !Number.isSafeInteger(numericValue) || numericValue <= 0) {
    throw new ShopCheckoutCalculationError('invalid-line-quantity', `${label} must be a positive integer.`)
  }
  return numericValue
}

const requireSafeNonNegativeInteger = (value: unknown, label: string): number => {
  const numericValue = finiteNumberFromUnknown(value)
  if (numericValue == null || !Number.isSafeInteger(numericValue) || numericValue < 0) {
    throw new ShopCheckoutCalculationError('invalid-total', `${label} must be a safe non-negative integer.`)
  }
  return numericValue
}

const safeAdd = (left: number, right: number, label: string): number => {
  const total = left + right
  if (!Number.isSafeInteger(total)) {
    throw new ShopCheckoutCalculationError('invalid-total', `${label} exceeds the maximum safe integer.`)
  }
  return total
}

const safeMultiply = (left: number, right: number, label: string): number => {
  const total = left * right
  if (!Number.isSafeInteger(total)) {
    throw new ShopCheckoutCalculationError('invalid-total', `${label} exceeds the maximum safe integer.`)
  }
  return total
}

const normalizeEntryId = (value: unknown): string => trimText(value)

const normalizeUnitPrice = (value: unknown): number => coerceStoredNonNegativeInteger(value)

const normalizeFiniteStock = (value: unknown): number | null => value == null ? null : coerceStoredNonNegativeInteger(value)

const cloneShopEntry = (entry: ShopEntry): ShopEntry => {
  const clone: ShopEntry = { ...entry }
  if (entry.tags) clone.tags = [...entry.tags]
  return clone
}

const cloneShopDocumentWithEntries = (
  shop: ShopTableDocument,
  entries: readonly ShopEntry[],
): ShopTableDocument => ({
  ...shop,
  allowedPaymentSources: [...shop.allowedPaymentSources],
  allowedDeliveryTargets: [...shop.allowedDeliveryTargets],
  entries: entries.map(cloneShopEntry),
})

const aggregateCheckoutLines = (lines: readonly ShopCheckoutCalculationLineInput[]): AggregatedLine[] => {
  if (lines.length === 0) {
    throw new ShopCheckoutCalculationError('empty-checkout', 'Checkout requires at least one line item.')
  }

  const aggregatedLines = new Map<string, AggregatedLine>()

  for (const line of lines) {
    const entryId = normalizeEntryId(line.entryId)
    if (!entryId) {
      throw new ShopCheckoutCalculationError('missing-entry', 'Checkout line entryId is required.')
    }

    const quantity = requirePositiveSafeInteger(line.quantity, `Checkout quantity for entry ${entryId}`)
    const existingLine = aggregatedLines.get(entryId)
    if (existingLine) {
      existingLine.quantity = safeAdd(existingLine.quantity, quantity, `Checkout quantity for entry ${entryId}`)
      continue
    }

    aggregatedLines.set(entryId, { entryId, quantity })
  }

  return [...aggregatedLines.values()]
}

const entryById = (shop: ShopTableDocument): Map<string, ShopEntry> => new Map(
  shop.entries.map((entry) => [entry.id, entry]),
)

const assertMaxPerPurchase = (entry: ShopEntry, quantity: number): void => {
  const maxPerPurchase = entry.maxPerPurchase == null ? null : coerceStoredNonNegativeInteger(entry.maxPerPurchase)
  if (maxPerPurchase != null && maxPerPurchase > 0 && quantity > maxPerPurchase) {
    throw new ShopCheckoutCalculationError(
      'max-per-purchase-exceeded',
      `${entry.itemName || 'Shop entry'} is limited to ${maxPerPurchase} per purchase.`,
    )
  }
}

const calculateRemainingStock = (entry: ShopEntry, quantity: number): number | null => {
  const stock = normalizeFiniteStock(entry.stock)
  if (stock == null) return null
  if (quantity > stock) {
    throw new ShopCheckoutCalculationError(
      'insufficient-stock',
      `${entry.itemName || 'Shop entry'} only has ${stock} remaining in stock.`,
    )
  }
  return stock - quantity
}

const calculatePurchasedEntry = (entry: ShopEntry, quantity: number): ShopCheckoutPurchasedEntry => {
  assertMaxPerPurchase(entry, quantity)
  const remainingStock = calculateRemainingStock(entry, quantity)
  const unitPrice = normalizeUnitPrice(entry.price)
  const lineTotal = safeMultiply(unitPrice, quantity, `Line total for ${entry.itemName || entry.id}`)

  return {
    entry: cloneShopEntry(entry),
    quantity,
    unitPrice,
    lineTotal,
    remainingStock,
  }
}

const resultLineFromPurchasedEntry = (purchase: ShopCheckoutPurchasedEntry): ShopCheckoutResultLine => ({
  entryId: purchase.entry.id,
  itemName: purchase.entry.itemName,
  section: purchase.entry.section,
  quantity: purchase.quantity,
  unitPrice: purchase.unitPrice,
  lineTotal: purchase.lineTotal,
  stock: purchase.remainingStock,
})

const applyStockPlanToEntries = (
  entries: readonly ShopEntry[],
  purchases: readonly ShopCheckoutPurchasedEntry[],
): ShopEntry[] => {
  const remainingStockByEntryId = new Map(purchases.map((purchase) => [purchase.entry.id, purchase.remainingStock]))

  return entries.map((entry) => {
    if (!remainingStockByEntryId.has(entry.id)) return cloneShopEntry(entry)
    return {
      ...cloneShopEntry(entry),
      stock: remainingStockByEntryId.get(entry.id) ?? null,
    }
  })
}

export const calculateShopCheckout = (input: CalculateShopCheckoutInput): ShopCheckoutCalculationResult => {
  const aggregatedLines = aggregateCheckoutLines(input.lines)
  const entriesById = entryById(input.shop)
  const purchasedEntries: ShopCheckoutPurchasedEntry[] = []
  let totalPrice = 0

  for (const line of aggregatedLines) {
    const entry = entriesById.get(line.entryId)
    if (!entry) {
      throw new ShopCheckoutCalculationError('missing-entry', `Shop entry ${line.entryId} was not found.`)
    }

    const purchase = calculatePurchasedEntry(entry, line.quantity)
    purchasedEntries.push(purchase)
    totalPrice = safeAdd(totalPrice, purchase.lineTotal, 'Checkout total')
  }

  const entries = applyStockPlanToEntries(input.shop.entries, purchasedEntries)

  return {
    shop: cloneShopDocumentWithEntries(input.shop, entries),
    totalPrice,
    lines: purchasedEntries.map(resultLineFromPurchasedEntry),
    purchasedEntries,
  }
}

export const subtractShopCheckoutMoney = <TDocument extends ShopCheckoutMoneyDocument>(
  document: TDocument,
  amount: unknown,
): TDocument & { readonly money: number } => {
  const normalizedAmount = requireSafeNonNegativeInteger(amount, 'Checkout total')
  const currentMoney = coerceStoredNonNegativeInteger(document.money)

  if (normalizedAmount > currentMoney) {
    throw new ShopCheckoutCalculationError('insufficient-money', 'The payment source does not have enough money.')
  }

  return {
    ...document,
    money: currentMoney - normalizedAmount,
  } as TDocument & { readonly money: number }
}

const cloneInventoryRow = (entry: InventoryTransferEntry): InventoryTransferEntry => ({ ...entry })

const completeInventorySnapshot = (
  inventory: InventoryTransferInventory | null | undefined,
): InventoryTransferSnapshot => Object.fromEntries(
  GROUP_INVENTORY_SECTION_KEYS.map((section) => [
    section,
    (inventory?.[section] ?? []).map(cloneInventoryRow),
  ]),
) as InventoryTransferSnapshot

const copyShopEntryDescription = (target: InventoryTransferEntry, entry: ShopEntry): InventoryTransferEntry => {
  const playerDescription = trimText(entry.playerDescription)
  if (!playerDescription) return target
  return { ...target, description: playerDescription }
}

const inventoryEntryFromPurchase = (purchase: ShopCheckoutPurchasedEntry): InventoryTransferEntry => {
  const baseEntry: InventoryTransferEntry = {
    name: purchase.entry.itemName,
    ...(inventoryTransferSectionUsesQuantity(purchase.entry.section) ? { qty: purchase.quantity } : {}),
    ...(purchase.unitPrice > 0 ? { cost: purchase.unitPrice } : {}),
  }

  return copyShopEntryDescription(baseEntry, purchase.entry)
}

const mergePurchasedEntryIntoInventory = (
  inventory: InventoryTransferSnapshot,
  purchase: ShopCheckoutPurchasedEntry,
  createTargetRowId?: InventoryTransferTargetRowIdGenerator,
): InventoryTransferSnapshot => {
  const section = purchase.entry.section as GroupInventorySectionKey
  if (!inventoryTransferSectionUsesQuantity(section)) {
    let rows = inventory[section]
    for (let index = 0; index < purchase.quantity; index += 1) {
      rows = mergeInventoryEntryIntoSection({
        section,
        rows,
        entry: inventoryEntryFromPurchase(purchase),
        quantity: 1,
        createTargetRowId,
      })
    }
    return { ...inventory, [section]: rows }
  }
  return {
    ...inventory,
    [section]: mergeInventoryEntryIntoSection({
      section,
      rows: inventory[section],
      entry: inventoryEntryFromPurchase(purchase),
      quantity: purchase.quantity,
      createTargetRowId,
    }),
  }
}

const deliveredSource = (input: {
  readonly purchase: ShopCheckoutPurchasedEntry
  readonly quantity: number
  readonly rows: readonly InventoryTransferEntry[]
  readonly rowIndex: number
}): ShopCheckoutDeliveredInventorySource => {
  const row = input.rows[input.rowIndex]
  const rowId = row?.id?.trim()
  if (!row || !rowId) throw new InventoryTransferError('invalid-row-id', 'Shop delivery requires one stable exact destination row identity.')
  return Object.freeze({
    entryId: input.purchase.entry.id,
    itemName: input.purchase.entry.itemName,
    section: input.purchase.entry.section as GroupInventorySectionKey,
    quantity: input.quantity,
    rowId,
    rowIndex: input.rowIndex,
  })
}

export const mergeShopCheckoutEntriesIntoInventoryWithSources = (
  input: ApplyShopCheckoutDeliveryInput,
): ShopCheckoutInventoryDeliveryResult => {
  let inventory = completeInventorySnapshot(input.inventory)
  const sources: ShopCheckoutDeliveredInventorySource[] = []

  for (const purchase of input.purchasedEntries) {
    const section = purchase.entry.section as GroupInventorySectionKey
    const entry = inventoryEntryFromPurchase(purchase)
    if (!inventoryTransferSectionUsesQuantity(section)) {
      for (let index = 0; index < purchase.quantity; index += 1) {
        const previousRows = inventory[section]
        const rows = mergeInventoryEntryIntoSection({
          section,
          rows: previousRows,
          entry,
          quantity: 1,
          createTargetRowId: input.createTargetRowId,
        })
        sources.push(deliveredSource({ purchase, quantity: 1, rows, rowIndex: previousRows.length }))
        inventory = { ...inventory, [section]: rows }
      }
      continue
    }

    const previousRows = inventory[section]
    const mergeCandidate = { ...entry, qty: purchase.quantity }
    const existingIndex = previousRows.findIndex(row => inventoryTransferEntriesCanMerge(section, row, mergeCandidate))
    const rows = mergeInventoryEntryIntoSection({
      section,
      rows: previousRows,
      entry,
      quantity: purchase.quantity,
      createTargetRowId: input.createTargetRowId,
    })
    const rowIndex = existingIndex >= 0 ? existingIndex : rows.length - 1
    sources.push(deliveredSource({ purchase, quantity: purchase.quantity, rows, rowIndex }))
    inventory = { ...inventory, [section]: rows }
  }

  return Object.freeze({ inventory, sources: Object.freeze(sources) })
}

export const mergeShopCheckoutEntriesIntoInventory = (
  input: ApplyShopCheckoutDeliveryInput,
): InventoryTransferSnapshot => input.purchasedEntries.reduce(
  (inventory, purchase) => mergePurchasedEntryIntoInventory(inventory, purchase, input.createTargetRowId),
  completeInventorySnapshot(input.inventory),
)

export const applyShopCheckoutDeliveryToGroupInventory = (
  input: ApplyShopCheckoutGroupDeliveryInput,
): GroupInventoryDocument => ({
  ...input.groupInventory,
  inventory: mergeShopCheckoutEntriesIntoInventory({
    inventory: input.groupInventory.inventory,
    purchasedEntries: input.purchasedEntries,
    createTargetRowId: input.createTargetRowId ?? createGroupInventoryRowId,
  }) as GroupInventory,
})

export const applyShopCheckoutDeliveryToTrainerSheet = (
  input: ApplyShopCheckoutTrainerDeliveryInput,
): TrainerSheet => ({
  ...input.trainerSheet,
  inventory: mergeShopCheckoutEntriesIntoInventory({
    inventory: input.trainerSheet.inventory as TrainerInventory | undefined,
    purchasedEntries: input.purchasedEntries,
    createTargetRowId: input.createTargetRowId,
  }) as NonNullable<TrainerSheet['inventory']>,
})
