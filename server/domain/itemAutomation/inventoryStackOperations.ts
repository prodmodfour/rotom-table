import { stableJsonStringify } from '#shared/automation/stableJson'
import { cloneStrictJson, deepFreezeStrictJson } from '#shared/automation/strictJson'
import { parseSerializedEquipmentInventoryState } from '#shared/itemAutomation/equipment'
import { parseItemShardInventoryVariant } from '#shared/itemAutomation/exploration'
import {
  ITEM_INVENTORY_SECTIONS,
  type ItemInventorySection,
  type ItemSourceContainerKind,
} from '#shared/itemAutomation/inventory'
import { validateSlug } from '#shared/paths'
import type { InventoryEntry } from '~/types/trainerSheet'
import {
  inventoryTransferEntriesCanMerge,
  type InventoryTransferInventory,
} from '~/utils/groupInventoryTransfers'

export const INVENTORY_STACK_ACTIONS = ['split', 'merge', 'discard'] as const
export type InventoryStackAction = (typeof INVENTORY_STACK_ACTIONS)[number]
export const INVENTORY_STACK_MAX_ROWS_PER_SECTION = 256

export interface InventoryActionStackOperationCommandV1 {
  readonly schemaVersion: 1
  readonly kind: 'inventory-stack-operation'
  readonly action: InventoryStackAction
  readonly containerKind: ItemSourceContainerKind
  readonly containerSlug: string
  readonly expectedRevision: number
  readonly section: ItemInventorySection
  readonly sourceRowId: string
  readonly sourceRowBefore: InventoryEntry
  readonly destinationRowId: string | null
  readonly destinationRowBefore: InventoryEntry | null
  readonly splitRowId: string | null
  readonly quantity: number
}

export interface AppliedInventoryStackOperation {
  readonly inventory: InventoryTransferInventory
  readonly sourceQuantityBefore: number
  readonly sourceQuantityAfter: number
  readonly destinationQuantityBefore: number | null
  readonly destinationQuantityAfter: number | null
  readonly splitRowId: string | null
}

const SECTION_SET = new Set<string>(ITEM_INVENTORY_SECTIONS)
const ACTION_SET = new Set<string>(INVENTORY_STACK_ACTIONS)
const CONTAINER_SET = new Set<string>(['trainer', 'group'])
const ROW_FIELDS = new Set([
  'id', 'name', 'qty', 'cost', 'description', 'mod', 'slot', 'serializedEquipment', 'itemVariant',
])

const fail = (message: string): never => { throw new Error(message) }
const strictClone = (value: unknown, label: string) => cloneStrictJson(value, label, {
  limits: {
    depth: 24,
    nodes: 100_000,
    objectFields: 512,
    arrayEntries: 4_096,
    stringLength: 65_536,
    objectKeyLength: 200,
  },
  rootLabel: label,
  valueLabel: `${label} values`,
  failNotJson: (path, detail) => fail(`${path}: ${detail}`),
  failLimit: (path, detail) => fail(`${path}: ${detail}`),
})
const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`)
  return value as Record<string, unknown>
}
const boundedText = (value: unknown, label: string, options: { readonly allowEmpty?: boolean, readonly maximum?: number } = {}): string => {
  const maximum = options.maximum ?? 65_536
  if (typeof value !== 'string') throw new Error(`${label} must be bounded text.`)
  if (value.length > maximum || (!options.allowEmpty && !value.trim())) throw new Error(`${label} must be bounded text.`)
  return value
}
const rowId = (value: unknown, label: string): string => boundedText(value, label, { maximum: 200 }).trim()
const positiveInteger = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail(`${label} must be a positive safe integer.`)
  return Number(value)
}
const nonNegativeInteger = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(`${label} must be a non-negative safe integer.`)
  return Number(value)
}
const optionalText = (value: unknown, label: string): string => boundedText(value, label, { allowEmpty: true })

export const inventoryStackRowUsesQuantity = (
  section: ItemInventorySection,
  row: Pick<InventoryEntry, 'serializedEquipment'>,
): boolean => section !== 'equipment' && row.serializedEquipment === undefined

export const inventoryStackRowQuantity = (
  section: ItemInventorySection,
  row: Pick<InventoryEntry, 'qty' | 'serializedEquipment'>,
): number => {
  if (!inventoryStackRowUsesQuantity(section, row)) return 1
  const quantity = row.qty ?? 1
  if (!Number.isSafeInteger(quantity) || Number(quantity) < 1) fail('Inventory stack row has invalid quantity authority.')
  return Number(quantity)
}

export const parseInventoryStackEvidenceRow = (
  value: unknown,
  section: ItemInventorySection,
  label = 'inventoryStackRow',
): InventoryEntry => {
  const input = record(strictClone(value, label), label)
  if (Object.keys(input).some(key => !ROW_FIELDS.has(key))) fail(`${label} contains unsupported fields.`)
  const parsed: InventoryEntry = {
    id: rowId(input.id, `${label}.id`),
    name: boundedText(input.name, `${label}.name`, { allowEmpty: true, maximum: 500 }),
  }
  if (input.qty !== undefined) parsed.qty = positiveInteger(input.qty, `${label}.qty`)
  if (input.cost !== undefined) {
    if (typeof input.cost === 'number' && Number.isFinite(input.cost)) parsed.cost = input.cost
    else parsed.cost = optionalText(input.cost, `${label}.cost`)
  }
  for (const field of ['description', 'mod', 'slot'] as const) {
    if (input[field] !== undefined) parsed[field] = optionalText(input[field], `${label}.${field}`)
  }
  if (input.serializedEquipment !== undefined) {
    parsed.serializedEquipment = parseSerializedEquipmentInventoryState(input.serializedEquipment)
  }
  if (input.itemVariant !== undefined) parsed.itemVariant = parseItemShardInventoryVariant(input.itemVariant)
  if (parsed.serializedEquipment && parsed.itemVariant) fail(`${label} cannot combine whole-item and stack variant authority.`)
  if (!inventoryStackRowUsesQuantity(section, parsed) && parsed.qty !== undefined) {
    fail(`${label}.qty is unavailable for whole-item rows.`)
  }
  inventoryStackRowQuantity(section, parsed)
  return deepFreezeStrictJson(parsed) as unknown as InventoryEntry
}

export const parseInventoryActionStackOperationCommand = (
  value: unknown,
): InventoryActionStackOperationCommandV1 => {
  const input = record(strictClone(value, 'inventoryActionStackOperationCommand'), 'Inventory stack downstream command')
  const fields = [
    'schemaVersion', 'kind', 'action', 'containerKind', 'containerSlug', 'expectedRevision',
    'section', 'sourceRowId', 'sourceRowBefore', 'destinationRowId', 'destinationRowBefore',
    'splitRowId', 'quantity',
  ]
  if (Object.keys(input).length !== fields.length || fields.some(field => !Object.hasOwn(input, field))
    || input.schemaVersion !== 1 || input.kind !== 'inventory-stack-operation'
    || typeof input.action !== 'string' || !ACTION_SET.has(input.action)
    || typeof input.containerKind !== 'string' || !CONTAINER_SET.has(input.containerKind)
    || typeof input.section !== 'string' || !SECTION_SET.has(input.section)) {
    fail('Inventory stack downstream command is invalid.')
  }
  const action = input.action as InventoryStackAction
  const containerKind = input.containerKind as ItemSourceContainerKind
  const section = input.section as ItemInventorySection
  const containerSlug = validateSlug(input.containerSlug, 'inventory stack container slug')
  const expectedRevision = nonNegativeInteger(input.expectedRevision, 'Inventory stack expected revision')
  const sourceRowId = rowId(input.sourceRowId, 'Inventory stack source row ID')
  const sourceRowBefore = parseInventoryStackEvidenceRow(input.sourceRowBefore, section, 'inventoryStackSourceBefore')
  const destinationRowId = input.destinationRowId === null ? null : rowId(input.destinationRowId, 'Inventory stack destination row ID')
  const destinationRowBefore = input.destinationRowBefore === null
    ? null
    : parseInventoryStackEvidenceRow(input.destinationRowBefore, section, 'inventoryStackDestinationBefore')
  const splitRowId = input.splitRowId === null ? null : rowId(input.splitRowId, 'Inventory stack split row ID')
  const quantity = positiveInteger(input.quantity, 'Inventory stack quantity')
  const sourceQuantity = inventoryStackRowQuantity(section, sourceRowBefore)

  if (sourceRowBefore.id !== sourceRowId) fail('Inventory stack source evidence changed identity.')
  if ((destinationRowId === null) !== (destinationRowBefore === null)
    || (destinationRowBefore && destinationRowBefore.id !== destinationRowId)) {
    fail('Inventory stack destination evidence changed identity.')
  }
  if ((destinationRowId !== null && destinationRowId === sourceRowId)
    || (splitRowId !== null && splitRowId === sourceRowId)
    || (splitRowId !== null && destinationRowId !== null && splitRowId === destinationRowId)) {
    fail('Inventory stack row identities must be distinct.')
  }
  if (action === 'split') {
    if (!inventoryStackRowUsesQuantity(section, sourceRowBefore)
      || quantity >= sourceQuantity || destinationRowId !== null || splitRowId === null) {
      fail('Inventory split command does not preserve one source unit and one new stack identity.')
    }
  }
  else if (action === 'merge') {
    if (!destinationRowBefore || splitRowId !== null || quantity !== sourceQuantity
      || !inventoryTransferEntriesCanMerge(section, sourceRowBefore, destinationRowBefore)) {
      fail('Inventory merge command does not bind one exact compatible destination stack.')
    }
  }
  else if (destinationRowId !== null || splitRowId !== null || quantity > sourceQuantity) {
    fail('Inventory discard command exceeds its exact source or advertises a destination.')
  }

  return Object.freeze({
    schemaVersion: 1,
    kind: 'inventory-stack-operation',
    action,
    containerKind,
    containerSlug,
    expectedRevision,
    section,
    sourceRowId,
    sourceRowBefore,
    destinationRowId,
    destinationRowBefore,
    splitRowId,
    quantity,
  })
}

const sameEvidence = (current: InventoryEntry, expected: InventoryEntry, section: ItemInventorySection): boolean => (
  stableJsonStringify(parseInventoryStackEvidenceRow(current, section, 'currentInventoryStackRow'))
  === stableJsonStringify(expected)
)

export const applyInventoryStackOperation = (input: {
  readonly inventory: InventoryTransferInventory | null | undefined
  readonly command: InventoryActionStackOperationCommandV1
  readonly reservedSourceQuantity: number
}): AppliedInventoryStackOperation => {
  const command = parseInventoryActionStackOperationCommand(input.command)
  if (!Number.isSafeInteger(input.reservedSourceQuantity) || input.reservedSourceQuantity < 0) {
    fail('Inventory stack reservation authority is invalid.')
  }
  const inventory = strictClone(input.inventory ?? {}, 'inventoryStackOperationInventory') as unknown as InventoryTransferInventory
  const rows = [...(inventory[command.section] ?? [])] as InventoryEntry[]
  const sourceIndex = rows.findIndex(row => row.id?.trim() === command.sourceRowId)
  const source = rows[sourceIndex] ?? fail('Inventory stack source changed after declaration. Refresh before retrying.')
  if (!sameEvidence(source, command.sourceRowBefore, command.section)) {
    fail('Inventory stack source changed after declaration. Refresh before retrying.')
  }
  const sourceQuantityBefore = inventoryStackRowQuantity(command.section, source)
  if (sourceQuantityBefore - command.quantity < input.reservedSourceQuantity) {
    fail('The inventory stack source does not have enough unreserved quantity.')
  }

  let sourceQuantityAfter = sourceQuantityBefore
  let destinationQuantityBefore: number | null = null
  let destinationQuantityAfter: number | null = null
  let nextRows: InventoryEntry[]

  if (command.action === 'split') {
    if (rows.length >= INVENTORY_STACK_MAX_ROWS_PER_SECTION) {
      fail(`Inventory sections support at most ${INVENTORY_STACK_MAX_ROWS_PER_SECTION} rows for stack operations.`)
    }
    const usedIds = new Set(Object.values(inventory).flatMap(sectionRows => (
      sectionRows ?? []
    )).flatMap(row => row.id?.trim() ? [row.id.trim()] : []))
    if (!command.splitRowId || usedIds.has(command.splitRowId)) fail('Inventory split row identity is unavailable or duplicated.')
    const splitRowId = command.splitRowId
      ?? fail('Inventory split row identity is unavailable or duplicated.')
    sourceQuantityAfter = sourceQuantityBefore - command.quantity
    const sourceAfter: InventoryEntry = { ...source, qty: sourceQuantityAfter }
    const splitRow: InventoryEntry = { ...command.sourceRowBefore, id: splitRowId, qty: command.quantity }
    nextRows = [...rows.slice(0, sourceIndex), sourceAfter, splitRow, ...rows.slice(sourceIndex + 1)]
  }
  else if (command.action === 'merge') {
    const destinationIndex = rows.findIndex(row => row.id?.trim() === command.destinationRowId)
    const destination = rows[destinationIndex]
      ?? fail('Inventory merge destination changed after declaration. Refresh before retrying.')
    if (!command.destinationRowBefore
      || !sameEvidence(destination, command.destinationRowBefore, command.section)
      || !inventoryTransferEntriesCanMerge(command.section, source, destination)) {
      fail('Inventory merge destination changed after declaration. Refresh before retrying.')
    }
    destinationQuantityBefore = inventoryStackRowQuantity(command.section, destination)
    const merged = destinationQuantityBefore + sourceQuantityBefore
    if (!Number.isSafeInteger(merged)) fail('Merged inventory quantity exceeds the maximum safe integer.')
    destinationQuantityAfter = merged
    sourceQuantityAfter = 0
    nextRows = rows.flatMap((row, index) => {
      if (index === sourceIndex) return []
      if (index === destinationIndex) return [{ ...row, qty: merged }]
      return [row]
    })
  }
  else {
    sourceQuantityAfter = sourceQuantityBefore - command.quantity
    nextRows = sourceQuantityAfter === 0
      ? rows.filter((_, index) => index !== sourceIndex)
      : rows.map((row, index) => index === sourceIndex ? { ...row, qty: sourceQuantityAfter } : row)
  }

  return Object.freeze({
    inventory: deepFreezeStrictJson({ ...inventory, [command.section]: nextRows }) as unknown as InventoryTransferInventory,
    sourceQuantityBefore,
    sourceQuantityAfter,
    destinationQuantityBefore,
    destinationQuantityAfter,
    splitRowId: command.splitRowId,
  })
}
