import {
  GROUP_INVENTORY_SECTION_KEYS,
  type GroupInventory,
  type GroupInventoryDocument,
  type GroupInventoryEntry,
  type GroupInventoryEntryId,
  type GroupInventorySectionKey,
} from '~/types/groupInventory'
import type { InventoryEntry } from '~/types/trainerSheet'

export type InventoryTransferErrorCode =
  | 'invalid-section'
  | 'invalid-quantity'
  | 'missing-row'
  | 'insufficient-quantity'
  | 'equipment-partial-transfer'
  | 'invalid-row-id'
  | 'insufficient-money'

export class InventoryTransferError extends Error {
  readonly code: InventoryTransferErrorCode

  constructor(code: InventoryTransferErrorCode, message: string) {
    super(message)
    this.name = 'InventoryTransferError'
    this.code = code
  }
}

export interface InventoryTransferEntry extends InventoryEntry {
  readonly id?: GroupInventoryEntryId
}

type MutableInventoryTransferEntry = InventoryEntry & { id?: GroupInventoryEntryId }

export type InventoryTransferInventory = Partial<Record<GroupInventorySectionKey, readonly InventoryTransferEntry[]>>
export type InventoryTransferSnapshot = Record<GroupInventorySectionKey, InventoryTransferEntry[]>

export interface InventoryTransferTargetRowIdContext {
  readonly section: GroupInventorySectionKey
  readonly index: number
  readonly sourceEntry: InventoryTransferEntry
}

export type InventoryTransferTargetRowIdGenerator = (context: InventoryTransferTargetRowIdContext) => string

export interface FoundGroupInventoryRow {
  readonly section: GroupInventorySectionKey
  readonly rowId: GroupInventoryEntryId
  readonly index: number
  readonly entry: GroupInventoryEntry
}

export interface DecrementInventorySourceRowInput {
  readonly section: GroupInventorySectionKey
  readonly rows: readonly InventoryTransferEntry[] | null | undefined
  readonly rowIndex: number
  readonly quantity: unknown
}

export interface DecrementInventorySourceRowResult {
  readonly rows: InventoryTransferEntry[]
  readonly transferredEntry: InventoryTransferEntry
  readonly removedSourceRow: boolean
}

export interface MergeInventoryEntryIntoSectionInput {
  readonly section: GroupInventorySectionKey
  readonly rows: readonly InventoryTransferEntry[] | null | undefined
  readonly entry: InventoryTransferEntry
  readonly quantity?: unknown
  readonly createTargetRowId?: InventoryTransferTargetRowIdGenerator
}

export interface TransferInventoryItemInput {
  readonly sourceInventory: InventoryTransferInventory | null | undefined
  readonly targetInventory: InventoryTransferInventory | null | undefined
  readonly section: GroupInventorySectionKey
  readonly sourceRowId?: GroupInventoryEntryId
  readonly sourceRowIndex?: number
  readonly quantity: unknown
  readonly createTargetRowId?: InventoryTransferTargetRowIdGenerator
}

export interface TransferInventoryItemResult {
  readonly sourceInventory: InventoryTransferSnapshot
  readonly targetInventory: InventoryTransferSnapshot
  readonly transferredEntry: InventoryTransferEntry
  readonly removedSourceRow: boolean
}

export interface InventoryMoneyTransferDocument {
  readonly money?: number
}

export interface TransferMoneyBetweenDocumentsInput<
  SourceDocument extends InventoryMoneyTransferDocument,
  TargetDocument extends InventoryMoneyTransferDocument,
> {
  readonly sourceDocument: SourceDocument
  readonly targetDocument: TargetDocument
  readonly amount: unknown
}

export interface TransferMoneyBetweenDocumentsResult<
  SourceDocument extends InventoryMoneyTransferDocument,
  TargetDocument extends InventoryMoneyTransferDocument,
> {
  readonly sourceDocument: SourceDocument & { readonly money: number }
  readonly targetDocument: TargetDocument & { readonly money: number }
  readonly amount: number
}

const GROUP_INVENTORY_SECTION_KEY_SET = new Set<GroupInventorySectionKey>(GROUP_INVENTORY_SECTION_KEYS)
const MAX_SAFE_TRANSFER_INTEGER = Number.MAX_SAFE_INTEGER

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

export const isGroupInventorySectionKey = (value: unknown): value is GroupInventorySectionKey => (
  typeof value === 'string' && GROUP_INVENTORY_SECTION_KEY_SET.has(value as GroupInventorySectionKey)
)

const assertGroupInventorySectionKey = (section: GroupInventorySectionKey): void => {
  if (!isGroupInventorySectionKey(section)) {
    throw new InventoryTransferError('invalid-section', 'Inventory transfer section is not recognized.')
  }
}

export const inventoryTransferSectionUsesQuantity = (section: GroupInventorySectionKey): boolean => section !== 'equipment'

const normalizeDisplayText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export const normalizeInventoryItemNameIdentity = (value: unknown): string => (
  normalizeDisplayText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
)

const normalizeRowId = (value: unknown): string => normalizeDisplayText(value)

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
  return Math.min(Math.floor(numericValue), MAX_SAFE_TRANSFER_INTEGER)
}

const requirePositiveSafeInteger = (value: unknown, label: string): number => {
  const numericValue = finiteNumberFromUnknown(value)
  if (numericValue == null || !Number.isSafeInteger(numericValue) || numericValue <= 0) {
    throw new InventoryTransferError('invalid-quantity', `${label} must be a positive integer.`)
  }
  return numericValue
}

const safeAddQuantities = (left: number, right: number, label: string): number => {
  const total = left + right
  if (!Number.isSafeInteger(total)) {
    throw new InventoryTransferError('invalid-quantity', `${label} exceeds the maximum safe integer.`)
  }
  return total
}

const copyEntryCost = (target: MutableInventoryTransferEntry, value: unknown): void => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    target.cost = value
    return
  }

  const normalized = normalizeDisplayText(value)
  if (normalized) target.cost = normalized
}

const copyEntryOptionalStringField = (
  target: MutableInventoryTransferEntry,
  field: 'description' | 'mod' | 'slot',
  value: unknown,
): void => {
  const normalized = normalizeDisplayText(value)
  if (normalized) target[field] = normalized
}

const cloneInventoryTransferEntry = (
  entry: InventoryTransferEntry,
  section: GroupInventorySectionKey,
  options: { readonly keepRowId?: boolean } = {},
): InventoryTransferEntry => {
  const clone: MutableInventoryTransferEntry = { name: normalizeDisplayText(entry.name) }

  if (options.keepRowId) {
    const rowId = normalizeRowId(entry.id)
    if (rowId) clone.id = rowId
  }

  if (inventoryTransferSectionUsesQuantity(section) && entry.qty !== undefined) {
    clone.qty = coerceStoredNonNegativeInteger(entry.qty)
  }

  copyEntryCost(clone, entry.cost)
  copyEntryOptionalStringField(clone, 'description', entry.description)
  copyEntryOptionalStringField(clone, 'mod', entry.mod)
  copyEntryOptionalStringField(clone, 'slot', entry.slot)

  return clone
}

const completeTransferInventory = (inventory: InventoryTransferInventory | null | undefined): InventoryTransferSnapshot => (
  Object.fromEntries(
    GROUP_INVENTORY_SECTION_KEYS.map((section) => [
      section,
      (inventory?.[section] ?? []).map((entry) => cloneInventoryTransferEntry(entry, section, { keepRowId: true })),
    ]),
  ) as InventoryTransferSnapshot
)

const isGroupInventoryDocumentSource = (
  source: GroupInventory | Pick<GroupInventoryDocument, 'inventory'>,
): source is Pick<GroupInventoryDocument, 'inventory'> => (
  'inventory' in source && isRecord(source.inventory)
)

const rowsFromGroupInventorySource = (
  source: GroupInventory | Pick<GroupInventoryDocument, 'inventory'> | null | undefined,
  section: GroupInventorySectionKey,
): readonly GroupInventoryEntry[] => {
  if (!source) return []
  const inventory = isGroupInventoryDocumentSource(source) ? source.inventory : source
  return inventory[section] ?? []
}

export const findGroupInventoryRowById = (
  source: GroupInventory | Pick<GroupInventoryDocument, 'inventory'> | null | undefined,
  section: GroupInventorySectionKey,
  rowId: GroupInventoryEntryId,
): FoundGroupInventoryRow | null => {
  assertGroupInventorySectionKey(section)
  const normalizedRowId = normalizeRowId(rowId)
  if (!normalizedRowId) return null

  const rows = rowsFromGroupInventorySource(source, section)
  const index = rows.findIndex((entry) => normalizeRowId(entry.id) === normalizedRowId)
  if (index < 0) return null

  const entry = rows[index]
  if (!entry) return null

  return {
    section,
    rowId: normalizedRowId,
    index,
    entry: cloneInventoryTransferEntry(entry, section, { keepRowId: true }) as GroupInventoryEntry,
  }
}

const sourceRowIndexBySelector = (input: TransferInventoryItemInput, rows: readonly InventoryTransferEntry[]): number => {
  if (input.sourceRowId !== undefined) {
    const rowId = normalizeRowId(input.sourceRowId)
    const rowIndex = rows.findIndex((entry) => normalizeRowId(entry.id) === rowId)
    if (rowId && rowIndex >= 0) return rowIndex
    throw new InventoryTransferError('missing-row', 'The requested source inventory row was not found.')
  }

  if (input.sourceRowIndex !== undefined) {
    if (Number.isInteger(input.sourceRowIndex) && input.sourceRowIndex >= 0 && input.sourceRowIndex < rows.length) {
      return input.sourceRowIndex
    }
    throw new InventoryTransferError('missing-row', 'The requested source inventory row was not found.')
  }

  throw new InventoryTransferError('missing-row', 'A source inventory row selector is required.')
}

export const decrementOrRemoveInventorySourceRow = (
  input: DecrementInventorySourceRowInput,
): DecrementInventorySourceRowResult => {
  assertGroupInventorySectionKey(input.section)
  const quantity = requirePositiveSafeInteger(input.quantity, 'Inventory transfer quantity')
  const rows = (input.rows ?? []).map((entry) => cloneInventoryTransferEntry(entry, input.section, { keepRowId: true }))

  if (!Number.isInteger(input.rowIndex) || input.rowIndex < 0 || input.rowIndex >= rows.length) {
    throw new InventoryTransferError('missing-row', 'The requested source inventory row was not found.')
  }

  const sourceEntry = rows[input.rowIndex]
  if (!sourceEntry) {
    throw new InventoryTransferError('missing-row', 'The requested source inventory row was not found.')
  }

  if (!inventoryTransferSectionUsesQuantity(input.section)) {
    if (quantity !== 1) {
      throw new InventoryTransferError('equipment-partial-transfer', 'Equipment transfers must move the whole row.')
    }

    return {
      rows: rows.filter((_, index) => index !== input.rowIndex),
      transferredEntry: cloneInventoryTransferEntry(sourceEntry, input.section),
      removedSourceRow: true,
    }
  }

  const availableQuantity = coerceStoredNonNegativeInteger(sourceEntry.qty)
  if (quantity > availableQuantity) {
    throw new InventoryTransferError('insufficient-quantity', 'The source inventory row does not have enough quantity to transfer.')
  }

  const transferredEntry: InventoryTransferEntry = {
    ...cloneInventoryTransferEntry(sourceEntry, input.section),
    qty: quantity,
  }

  if (quantity === availableQuantity) {
    return {
      rows: rows.filter((_, index) => index !== input.rowIndex),
      transferredEntry,
      removedSourceRow: true,
    }
  }

  return {
    rows: rows.map((entry, index) => (
      index === input.rowIndex ? { ...entry, qty: availableQuantity - quantity } : entry
    )),
    transferredEntry,
    removedSourceRow: false,
  }
}

const appendEntryWithOptionalRowId = (
  rows: readonly InventoryTransferEntry[],
  section: GroupInventorySectionKey,
  entry: InventoryTransferEntry,
  createTargetRowId?: InventoryTransferTargetRowIdGenerator,
): InventoryTransferEntry => {
  if (!createTargetRowId) return entry

  const rowId = normalizeRowId(createTargetRowId({ section, index: rows.length, sourceEntry: entry }))
  if (!rowId) throw new InventoryTransferError('invalid-row-id', 'Generated target inventory row id must not be blank.')
  if (rows.some((row) => normalizeRowId(row.id) === rowId)) {
    throw new InventoryTransferError('invalid-row-id', 'Generated target inventory row id must be unique.')
  }

  return { ...entry, id: rowId }
}

export const mergeInventoryEntryIntoSection = (
  input: MergeInventoryEntryIntoSectionInput,
): InventoryTransferEntry[] => {
  assertGroupInventorySectionKey(input.section)
  const rows = (input.rows ?? []).map((entry) => cloneInventoryTransferEntry(entry, input.section, { keepRowId: true }))

  if (!inventoryTransferSectionUsesQuantity(input.section)) {
    const quantity = input.quantity === undefined ? 1 : requirePositiveSafeInteger(input.quantity, 'Equipment transfer quantity')
    if (quantity !== 1) {
      throw new InventoryTransferError('equipment-partial-transfer', 'Equipment transfers must move the whole row.')
    }

    const transferredEntry = cloneInventoryTransferEntry(input.entry, input.section)
    return [
      ...rows,
      appendEntryWithOptionalRowId(rows, input.section, transferredEntry, input.createTargetRowId),
    ]
  }

  const quantity = input.quantity === undefined
    ? coerceStoredNonNegativeInteger(input.entry.qty)
    : requirePositiveSafeInteger(input.quantity, 'Inventory transfer quantity')
  if (quantity <= 0) {
    throw new InventoryTransferError('invalid-quantity', 'Inventory transfer quantity must be a positive integer.')
  }

  const transferredEntry: InventoryTransferEntry = {
    ...cloneInventoryTransferEntry(input.entry, input.section),
    qty: quantity,
  }
  const transferredIdentity = normalizeInventoryItemNameIdentity(transferredEntry.name)
  const targetIndex = transferredIdentity
    ? rows.findIndex((row) => normalizeInventoryItemNameIdentity(row.name) === transferredIdentity)
    : -1

  if (targetIndex >= 0) {
    return rows.map((entry, index) => (
      index === targetIndex
        ? { ...entry, qty: safeAddQuantities(coerceStoredNonNegativeInteger(entry.qty), quantity, 'Merged inventory quantity') }
        : entry
    ))
  }

  return [
    ...rows,
    appendEntryWithOptionalRowId(rows, input.section, transferredEntry, input.createTargetRowId),
  ]
}

export const transferInventoryItem = (input: TransferInventoryItemInput): TransferInventoryItemResult => {
  assertGroupInventorySectionKey(input.section)
  const sourceInventory = completeTransferInventory(input.sourceInventory)
  const targetInventory = completeTransferInventory(input.targetInventory)
  const sourceRows = sourceInventory[input.section]
  const rowIndex = sourceRowIndexBySelector(input, sourceRows)
  const sourceUpdate = decrementOrRemoveInventorySourceRow({
    section: input.section,
    rows: sourceRows,
    rowIndex,
    quantity: input.quantity,
  })
  const targetRows = mergeInventoryEntryIntoSection({
    section: input.section,
    rows: targetInventory[input.section],
    entry: sourceUpdate.transferredEntry,
    createTargetRowId: input.createTargetRowId,
  })

  return {
    sourceInventory: {
      ...sourceInventory,
      [input.section]: sourceUpdate.rows,
    },
    targetInventory: {
      ...targetInventory,
      [input.section]: targetRows,
    },
    transferredEntry: sourceUpdate.transferredEntry,
    removedSourceRow: sourceUpdate.removedSourceRow,
  }
}

const normalizeMoneyBalance = (value: unknown): number => coerceStoredNonNegativeInteger(value)

export const transferMoneyBetweenDocuments = <
  SourceDocument extends InventoryMoneyTransferDocument,
  TargetDocument extends InventoryMoneyTransferDocument,
>(
  input: TransferMoneyBetweenDocumentsInput<SourceDocument, TargetDocument>,
): TransferMoneyBetweenDocumentsResult<SourceDocument, TargetDocument> => {
  const amount = requirePositiveSafeInteger(input.amount, 'Money transfer amount')
  const sourceMoney = normalizeMoneyBalance(input.sourceDocument.money)
  const targetMoney = normalizeMoneyBalance(input.targetDocument.money)
  if (amount > sourceMoney) {
    throw new InventoryTransferError('insufficient-money', 'The source document does not have enough money to transfer.')
  }

  return {
    amount,
    sourceDocument: {
      ...input.sourceDocument,
      money: sourceMoney - amount,
    } as SourceDocument & { readonly money: number },
    targetDocument: {
      ...input.targetDocument,
      money: safeAddQuantities(targetMoney, amount, 'Target money balance'),
    } as TargetDocument & { readonly money: number },
  }
}
