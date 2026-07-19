import { isOpId } from '#shared/sessionCommands'
import { normalizeRevision } from '#shared/sessionRevisions'
import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterItemSuppressionEffect,
} from '#shared/moveAutomation/encounterState'
import {
  MOVE_ITEM_TRAINER_EQUIPMENT_SLOTS,
  MOVE_ITEM_TRAINER_INVENTORY_SECTIONS,
  MoveItemReferenceValidationError,
  isMoveItemStableId,
  parseMoveItemOwnerReference,
  parseMoveItemReference,
  type MoveItemGroupInventoryOwnerReference,
  type MoveItemOwnerReference,
  type MoveItemReference,
  type MoveItemTrainerSheetOwnerReference,
} from '#shared/moveAutomation/items'
import {
  resolveMoveAutomationItemRuleIdentity,
} from '../itemRuleData'
import type { CharacterSheet } from '~/types/characterSheet'
import type {
  GroupInventoryDocument,
  GroupInventoryEntry,
} from '~/types/groupInventory'
import type { TabletopMap } from '~/types/map'
import type {
  InventoryEntry,
  TrainerInventory,
  TrainerSheet,
} from '~/types/trainerSheet'
import { splitSheetItemNames } from '~/utils/sheetItemNames'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import type {
  MoveConsumedItemRecord,
  MoveItemDestination,
  MoveItemEquippedDestination,
  MoveItemInventoryDestination,
  MoveItemMapGroundDestination,
  MoveItemMutation,
  MoveItemMutationOperationResult,
  MoveItemMutationResourceReduction,
  MoveItemMutationResourceScope,
  MoveItemNonGroundDestination,
  MoveItemQuantityEffect,
  MoveItemQuantityPolicy,
  ReducedMoveItemMutations,
} from '../itemMutationTypes'
import {
  MOVE_ITEM_MUTATION_KINDS,
  MOVE_ITEM_MUTATION_LIMITS,
  MoveItemMutationError,
} from '../itemMutationTypes'
import { recordDigestionBuffTrade } from '../digestionBuffTrade'

export interface ReduceMoveItemMutationsInput {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly groupInventories: ReadonlyMap<string, GroupInventoryDocument>
  readonly operations: readonly MoveItemMutation[]
  /** Private records loaded from authoritative consumed-item history. */
  readonly consumedItems?: readonly MoveConsumedItemRecord[]
  /** Accepted command ID written into new ground-item provenance. */
  readonly originOperationId: string
}

type ItemSheetField = 'items' | 'inventory' | 'equipmentSlots' | 'digestion'
type ItemDocument = CharacterSheet | TrainerSheet

type ResourceTouch = {
  readonly scope: MoveItemMutationResourceScope
  readonly operationIds: string[]
  readonly reasonCodes: string[]
  readonly changedFields: Set<ItemSheetField>
  firstOperationOrder: number
}

interface ItemStack {
  readonly canonicalItemId: string
  readonly canonicalItemName: string
  readonly quantity: number
  readonly source: MoveItemReference
  readonly entry: InventoryEntry | null
}

interface RemovedItemStack {
  readonly stack: ItemStack
  readonly resourceKey: string
}

interface WorkingState {
  readonly previousMap: TabletopMap
  map: TabletopMap
  readonly previousPokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly pokemonSheets: Map<string, CharacterSheet>
  readonly previousTrainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly trainerSheets: Map<string, TrainerSheet>
  readonly previousGroupInventories: ReadonlyMap<string, GroupInventoryDocument>
  readonly groupInventories: Map<string, GroupInventoryDocument>
  readonly touches: Map<string, ResourceTouch>
}

const MUTATION_KIND_SET = new Set<unknown>(MOVE_ITEM_MUTATION_KINDS)
const EQUIPMENT_SLOT_SET = new Set<unknown>(MOVE_ITEM_TRAINER_EQUIPMENT_SLOTS)
const INVENTORY_SECTION_SET = new Set<unknown>(MOVE_ITEM_TRAINER_INVENTORY_SECTIONS)

const fail = (
  code: MoveItemMutationError['code'],
  message: string,
): never => {
  throw new MoveItemMutationError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const boundedIdentifier = (value: unknown, label: string): string => {
  if (
    !isMoveItemStableId(value)
    || value.length > MOVE_ITEM_MUTATION_LIMITS.identifierChars
  ) {
    return fail('invalid-operation', `${label} must be a bounded stable identifier.`)
  }
  return value
}

const boundedReasonCode = (value: unknown, label: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MOVE_ITEM_MUTATION_LIMITS.reasonCodeChars
    || value.trim() !== value
    || !/^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/.test(value)
  ) {
    return fail('invalid-operation', `${label} must be a bounded lowercase reason code.`)
  }
  return value
}

const positiveQuantity = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    return fail('invalid-quantity', `${label} must be a positive safe integer.`)
  }
  return Number(value)
}

const mapResourceKey = (slug: string): string => `map:${slug}`
const sheetResourceKey = (kind: 'pokemon' | 'trainer', slug: string): string => (
  `sheet:${kind}:${slug}`
)
const groupInventoryResourceKey = (slug: string): string => `group-inventory:${slug}`

const resourceKeyForOwner = (owner: MoveItemOwnerReference): string => {
  if (owner.kind === 'map') return mapResourceKey(owner.slug)
  if (owner.kind === 'group-inventory') return groupInventoryResourceKey(owner.slug)
  return sheetResourceKey(owner.sheetKind, owner.slug)
}

const addUnique = (values: string[], value: string): void => {
  if (!values.includes(value)) values.push(value)
}

const touchResource = (input: {
  readonly state: WorkingState
  readonly owner: MoveItemOwnerReference
  readonly operation: Pick<MoveItemMutation, 'id' | 'reasonCode'>
  readonly operationOrder: number
  readonly changedField?: ItemSheetField
}): string => {
  const key = resourceKeyForOwner(input.owner)
  const existing = input.state.touches.get(key)
  if (existing) {
    addUnique(existing.operationIds, input.operation.id)
    addUnique(existing.reasonCodes, input.operation.reasonCode)
    if (input.changedField) existing.changedFields.add(input.changedField)
    existing.firstOperationOrder = Math.min(existing.firstOperationOrder, input.operationOrder)
    return key
  }
  const scope: MoveItemMutationResourceScope = input.owner.kind === 'sheet'
    ? {
        kind: 'sheet',
        sheetKind: input.owner.sheetKind,
        slug: input.owner.slug,
        expectedRevision: input.owner.revision,
      }
    : input.owner.kind === 'group-inventory'
      ? {
          kind: 'group-inventory',
          slug: input.owner.slug,
          expectedRevision: input.owner.revision,
        }
      : {
          kind: 'map',
          slug: input.owner.slug,
          expectedRevision: input.owner.revision,
        }
  input.state.touches.set(key, {
    scope,
    operationIds: [input.operation.id],
    reasonCodes: [input.operation.reasonCode],
    changedFields: new Set(input.changedField ? [input.changedField] : []),
    firstOperationOrder: input.operationOrder,
  })
  return key
}

const canonicalItem = (value: string, label: string): {
  readonly id: string
  readonly name: string
} => {
  const item = resolveMoveAutomationItemRuleIdentity(value)
  if (!item) return fail('item-mismatch', `${label} does not resolve to canonical item data.`)
  return { id: item.canonicalItemId, name: item.canonicalItemName }
}

const assertCanonicalName = (
  name: unknown,
  canonicalItemId: string,
  label: string,
): string => {
  if (typeof name !== 'string') {
    return fail('item-mismatch', `${label} has no stored item name.`)
  }
  const canonical = canonicalItem(name, label)
  if (canonical.id !== canonicalItemId) {
    fail(
      'item-mismatch',
      `${label} resolves to ${canonical.id}, not referenced item ${canonicalItemId}.`,
    )
  }
  return canonical.name
}

const assertOwnerRevision = (
  state: WorkingState,
  owner: MoveItemOwnerReference,
): void => {
  if (owner.kind === 'map') {
    if (state.map.slug !== owner.slug) {
      fail('resource-missing', `Map item resource ${owner.slug} is unavailable.`)
    }
    const revision = normalizeRevision(state.map.revision)
    if (revision !== owner.revision) {
      fail(
        'revision-conflict',
        `Map ${owner.slug} item reference expected revision ${owner.revision}, found ${revision}.`,
      )
    }
    return
  }
  if (owner.kind === 'group-inventory') {
    const document = state.groupInventories.get(owner.slug)
      ?? fail('resource-missing', `Group inventory item resource ${owner.slug} is unavailable.`)
    if (document.slug !== owner.slug) {
      fail('resource-missing', `Group inventory item resource ${owner.slug} is unavailable.`)
    }
    const revision = normalizeRevision(document.revision)
    if (revision !== owner.revision) {
      fail(
        'revision-conflict',
        `Group inventory ${owner.slug} item reference expected revision ${owner.revision}, found ${revision}.`,
      )
    }
    return
  }
  const document = (owner.sheetKind === 'pokemon'
    ? state.pokemonSheets.get(owner.slug)
    : state.trainerSheets.get(owner.slug))
    ?? fail(
      'resource-missing',
      `${owner.sheetKind} item sheet ${owner.slug} is unavailable.`,
    )
  if (document.slug !== owner.slug) {
    fail('resource-missing', `${owner.sheetKind} item sheet ${owner.slug} is unavailable.`)
  }
  const revision = normalizeRevision(document.revision)
  if (revision !== owner.revision) {
    fail(
      'revision-conflict',
      `${owner.sheetKind} sheet ${owner.slug} item reference expected revision ${owner.revision}, found ${revision}.`,
    )
  }
}

const parseReference = (value: unknown, label: string): MoveItemReference => {
  try {
    return parseMoveItemReference(value, label)
  }
  catch (error) {
    if (error instanceof MoveItemReferenceValidationError) {
      return fail('invalid-operation', error.message)
    }
    throw error
  }
}

const parseOwner = (value: unknown, label: string): MoveItemOwnerReference => {
  try {
    return parseMoveItemOwnerReference(value, label)
  }
  catch (error) {
    if (error instanceof MoveItemReferenceValidationError) {
      return fail('invalid-destination', error.message)
    }
    throw error
  }
}

const parseDestination = (
  value: MoveItemDestination,
  label: string,
): MoveItemDestination => {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return fail('invalid-destination', `${label} must be a typed item destination.`)
  }
  const owner = parseOwner(value.owner, `${label}.owner`)
  if (value.kind === 'pokemon-held') {
    if (owner.kind !== 'sheet' || owner.sheetKind !== 'pokemon') {
      return fail('invalid-destination', `${label} must be owned by a Pokémon sheet.`)
    }
    return { kind: value.kind, owner }
  }
  if (value.kind === 'trainer-equipment-slot') {
    if (owner.kind !== 'sheet' || owner.sheetKind !== 'trainer') {
      return fail('invalid-destination', `${label} must be owned by a trainer sheet.`)
    }
    if (!EQUIPMENT_SLOT_SET.has(value.slot)) {
      return fail('invalid-destination', `${label}.slot is unsupported.`)
    }
    return { kind: value.kind, owner, slot: value.slot }
  }
  if (value.kind === 'trainer-inventory-row' || value.kind === 'group-inventory-row') {
    const expectedOwner = value.kind === 'trainer-inventory-row'
      ? owner.kind === 'sheet' && owner.sheetKind === 'trainer'
      : owner.kind === 'group-inventory'
    if (!expectedOwner) {
      return fail('invalid-destination', `${label} has an incompatible inventory owner.`)
    }
    if (!INVENTORY_SECTION_SET.has(value.section)) {
      return fail('invalid-destination', `${label}.section is unsupported.`)
    }
    const itemId = boundedIdentifier(value.itemId, `${label}.itemId`)
    return value.kind === 'trainer-inventory-row'
      ? {
          kind: value.kind,
          owner: owner as MoveItemTrainerSheetOwnerReference,
          itemId,
          section: value.section,
        }
      : {
          kind: value.kind,
          owner: owner as MoveItemGroupInventoryOwnerReference,
          itemId,
          section: value.section,
        }
  }
  if (value.kind !== 'map-ground-item' || owner.kind !== 'map') {
    return fail('invalid-destination', `${label}.kind is unsupported or has an incompatible owner.`)
  }
  const position = value.position
  if (
    typeof position !== 'object'
    || position === null
    || !Number.isSafeInteger(position.x)
    || !Number.isSafeInteger(position.y)
    || !Number.isSafeInteger(position.z)
    || position.x < 0
    || position.y < 0
    || position.z < 0
  ) {
    return fail('map-position-invalid', `${label}.position must use non-negative integer coordinates.`)
  }
  return {
    kind: value.kind,
    owner,
    itemId: boundedIdentifier(value.itemId, `${label}.itemId`),
    position: { x: position.x, y: position.y, z: position.z },
    sideId: value.sideId,
    ownerPlacementId: value.ownerPlacementId,
  }
}

const trainerInventoryRows = (
  sheet: TrainerSheet,
  section: MoveItemInventoryDestination['section'],
): readonly InventoryEntry[] => sheet.inventory?.[section] ?? []

const trainerRowStableId = (
  entry: InventoryEntry,
  section: MoveItemInventoryDestination['section'],
  index: number,
): string => {
  if (entry.id !== undefined) {
    if (!isMoveItemStableId(entry.id)) {
      return fail(
        'destination-conflict',
        `Trainer inventory row ${section}[${index}] has an invalid stable item ID.`,
      )
    }
    return entry.id
  }
  return `trainer-row:${section}:${index + 1}`
}

const groupRowStableId = (
  entry: GroupInventoryEntry,
  section: MoveItemInventoryDestination['section'],
  index: number,
): string => {
  if (!isMoveItemStableId(entry.id)) {
    return fail(
      'destination-conflict',
      `Group inventory row ${section}[${index}] has an invalid stable item ID.`,
    )
  }
  return entry.id
}

const inventoryQuantity = (
  entry: InventoryEntry,
  section: MoveItemInventoryDestination['section'],
  label: string,
): number => {
  if (section === 'equipment') return 1
  return positiveQuantity(entry.qty, `${label}.qty`)
}

const sourceStack = (input: {
  readonly reference: MoveItemReference
  readonly canonicalName: string
  readonly quantity: number
  readonly entry?: InventoryEntry | null
}): ItemStack => ({
  canonicalItemId: input.reference.canonicalItemId,
  canonicalItemName: input.canonicalName,
  quantity: input.quantity,
  source: input.reference,
  entry: input.entry ? deepCloneJson(input.entry) : null,
})

const sourceMismatch = (
  reference: MoveItemReference,
  actualQuantity: number,
  label: string,
): void => {
  if (actualQuantity !== reference.quantity) {
    fail(
      'item-mismatch',
      `${label} quantity ${actualQuantity} does not match referenced quantity ${reference.quantity}.`,
    )
  }
}

const setPokemonSheet = (
  state: WorkingState,
  slug: string,
  sheet: CharacterSheet,
): void => {
  state.pokemonSheets.set(slug, sheet)
}

const setTrainerSheet = (
  state: WorkingState,
  slug: string,
  sheet: TrainerSheet,
): void => {
  state.trainerSheets.set(slug, sheet)
}

const removeItem = (input: {
  readonly state: WorkingState
  readonly source: MoveItemReference
  readonly quantity: number
  readonly operation: MoveItemMutation
  readonly operationOrder: number
}): RemovedItemStack => {
  const { state, source, operation, operationOrder } = input
  const quantity = positiveQuantity(input.quantity, `${operation.id}.quantity`)
  assertOwnerRevision(state, source.owner)
  const canonical = canonicalItem(source.canonicalItemId, `${operation.id}.source.canonicalItemId`)
  if (canonical.id !== source.canonicalItemId) {
    fail('item-mismatch', `Operation ${operation.id} source canonical item ID is not normalized.`)
  }
  if (source.stack === 'singleton' && quantity !== 1) {
    fail('invalid-quantity', `Operation ${operation.id} cannot partially remove a singleton item.`)
  }

  if (source.kind === 'pokemon-held') {
    const sheet = state.pokemonSheets.get(source.owner.slug)
      ?? fail('resource-missing', `Pokémon item sheet ${source.owner.slug} is unavailable.`)
    const names = splitSheetItemNames(sheet.items?.held)
    const index = names.findIndex((_name, candidateIndex) => source.itemId === `held:${candidateIndex + 1}`)
    if (index < 0) fail('item-missing', `Held item ${source.itemId} was not found.`)
    sourceMismatch(source, 1, `Held item ${source.itemId}`)
    const canonicalName = assertCanonicalName(names[index], source.canonicalItemId, `Held item ${source.itemId}`)
    const remaining = names.filter((_name, candidateIndex) => candidateIndex !== index)
    const items = { ...(sheet.items ?? {}) }
    if (remaining.length === 0) delete items.held
    else items.held = remaining.join(', ')
    setPokemonSheet(state, source.owner.slug, { ...sheet, items })
    return {
      stack: sourceStack({ reference: source, canonicalName, quantity: 1 }),
      resourceKey: touchResource({
        state,
        owner: source.owner,
        operation,
        operationOrder,
        changedField: 'items',
      }),
    }
  }

  if (source.kind === 'trainer-equipment-slot') {
    const sheet = state.trainerSheets.get(source.owner.slug)
      ?? fail('resource-missing', `Trainer item sheet ${source.owner.slug} is unavailable.`)
    const names = splitSheetItemNames(sheet.equipmentSlots?.[source.slot])
    const prefix = `slot:${source.slot}:`
    const index = names.findIndex((_name, candidateIndex) => (
      source.itemId === `${prefix}${candidateIndex + 1}`
    ))
    if (index < 0) fail('item-missing', `Trainer equipped item ${source.itemId} was not found.`)
    sourceMismatch(source, 1, `Trainer equipped item ${source.itemId}`)
    const canonicalName = assertCanonicalName(
      names[index],
      source.canonicalItemId,
      `Trainer equipped item ${source.itemId}`,
    )
    const remaining = names.filter((_name, candidateIndex) => candidateIndex !== index)
    const equipmentSlots = { ...(sheet.equipmentSlots ?? {}) }
    if (remaining.length === 0) delete equipmentSlots[source.slot]
    else equipmentSlots[source.slot] = remaining.join(', ')
    setTrainerSheet(state, source.owner.slug, { ...sheet, equipmentSlots })
    return {
      stack: sourceStack({ reference: source, canonicalName, quantity: 1 }),
      resourceKey: touchResource({
        state,
        owner: source.owner,
        operation,
        operationOrder,
        changedField: 'equipmentSlots',
      }),
    }
  }

  if (source.kind === 'trainer-inventory-row') {
    const sheet = state.trainerSheets.get(source.owner.slug)
      ?? fail('resource-missing', `Trainer item sheet ${source.owner.slug} is unavailable.`)
    const rows = trainerInventoryRows(sheet, source.section)
    const matches = rows.flatMap((entry, index) => (
      trainerRowStableId(entry, source.section, index) === source.itemId
        ? [{ entry, index }]
        : []
    ))
    if (matches.length !== 1) {
      fail(
        matches.length === 0 ? 'item-missing' : 'destination-conflict',
        `Trainer inventory item ${source.itemId} must resolve exactly once.`,
      )
    }
    const match = matches[0]!
    const available = inventoryQuantity(match.entry, source.section, `Trainer item ${source.itemId}`)
    sourceMismatch(source, available, `Trainer item ${source.itemId}`)
    if (quantity > available) {
      fail('insufficient-quantity', `Trainer item ${source.itemId} has insufficient quantity.`)
    }
    const canonicalName = assertCanonicalName(
      match.entry.name,
      source.canonicalItemId,
      `Trainer item ${source.itemId}`,
    )
    const nextRows = quantity === available
      ? rows.filter((_entry, index) => index !== match.index)
      : rows.map((entry, index) => index === match.index
          ? { ...entry, qty: available - quantity }
          : deepCloneJson(entry))
    const inventory: TrainerInventory = {
      ...(sheet.inventory ?? {}),
      [source.section]: nextRows,
    }
    setTrainerSheet(state, source.owner.slug, { ...sheet, inventory })
    return {
      stack: sourceStack({
        reference: source,
        canonicalName,
        quantity,
        entry: match.entry,
      }),
      resourceKey: touchResource({
        state,
        owner: source.owner,
        operation,
        operationOrder,
        changedField: 'inventory',
      }),
    }
  }

  if (source.kind === 'group-inventory-row') {
    const document = state.groupInventories.get(source.owner.slug)
      ?? fail('resource-missing', `Group inventory ${source.owner.slug} is unavailable.`)
    const rows = document.inventory[source.section]
    const matches = rows.flatMap((entry, index) => (
      groupRowStableId(entry, source.section, index) === source.itemId
        ? [{ entry, index }]
        : []
    ))
    if (matches.length !== 1) {
      fail(
        matches.length === 0 ? 'item-missing' : 'destination-conflict',
        `Group inventory item ${source.itemId} must resolve exactly once.`,
      )
    }
    const match = matches[0]!
    const available = inventoryQuantity(match.entry, source.section, `Group item ${source.itemId}`)
    sourceMismatch(source, available, `Group item ${source.itemId}`)
    if (quantity > available) {
      fail('insufficient-quantity', `Group item ${source.itemId} has insufficient quantity.`)
    }
    const canonicalName = assertCanonicalName(
      match.entry.name,
      source.canonicalItemId,
      `Group item ${source.itemId}`,
    )
    const nextRows = quantity === available
      ? rows.filter((_entry, index) => index !== match.index)
      : rows.map((entry, index) => index === match.index
          ? { ...entry, qty: available - quantity }
          : deepCloneJson(entry))
    state.groupInventories.set(source.owner.slug, {
      ...document,
      inventory: { ...document.inventory, [source.section]: nextRows },
    })
    return {
      stack: sourceStack({
        reference: source,
        canonicalName,
        quantity,
        entry: match.entry,
      }),
      resourceKey: touchResource({ state, owner: source.owner, operation, operationOrder }),
    }
  }

  const encounterState = parseEncounterState(
    state.map.encounterState ?? createEmptyEncounterState(),
  )
  const matches = encounterState.groundItems.flatMap((item, index) => (
    item.id === source.itemId ? [{ item, index }] : []
  ))
  if (matches.length !== 1) {
    fail(
      matches.length === 0 ? 'item-missing' : 'destination-conflict',
      `Ground item ${source.itemId} must resolve exactly once.`,
    )
  }
  const match = matches[0]!
  sourceMismatch(source, match.item.quantity, `Ground item ${source.itemId}`)
  if (match.item.canonicalItemId !== source.canonicalItemId) {
    fail('item-mismatch', `Ground item ${source.itemId} canonical identity changed.`)
  }
  if (quantity > match.item.quantity) {
    fail('insufficient-quantity', `Ground item ${source.itemId} has insufficient quantity.`)
  }
  const groundItems = quantity === match.item.quantity
    ? encounterState.groundItems.filter((_item, index) => index !== match.index)
    : encounterState.groundItems.map((item, index) => index === match.index
        ? { ...item, quantity: item.quantity - quantity }
        : item)
  state.map = {
    ...state.map,
    encounterState: parseEncounterState({ ...encounterState, groundItems }),
  }
  return {
    stack: sourceStack({
      reference: source,
      canonicalName: match.item.canonicalItemName,
      quantity,
    }),
    resourceKey: touchResource({ state, owner: source.owner, operation, operationOrder }),
  }
}

const entryForDestination = (
  stack: ItemStack,
  itemId: string,
  section: MoveItemInventoryDestination['section'],
): InventoryEntry => {
  const entry = deepCloneJson(stack.entry ?? { name: stack.canonicalItemName })
  delete entry.qty
  delete entry.id
  entry.name = stack.canonicalItemName
  entry.id = itemId
  if (section !== 'equipment') entry.qty = stack.quantity
  return entry
}

const allTrainerRowIds = (sheet: TrainerSheet): Map<string, {
  readonly section: MoveItemInventoryDestination['section']
  readonly index: number
}> => {
  const ids = new Map<string, { section: MoveItemInventoryDestination['section']; index: number }>()
  for (const section of MOVE_ITEM_TRAINER_INVENTORY_SECTIONS) {
    for (const [index, entry] of (sheet.inventory?.[section] ?? []).entries()) {
      const id = trainerRowStableId(entry, section, index)
      if (ids.has(id)) fail('destination-conflict', `Trainer inventory item ID ${id} is duplicated.`)
      ids.set(id, { section, index })
    }
  }
  return ids
}

const allGroupRowIds = (document: GroupInventoryDocument): Map<string, {
  readonly section: MoveItemInventoryDestination['section']
  readonly index: number
}> => {
  const ids = new Map<string, { section: MoveItemInventoryDestination['section']; index: number }>()
  for (const section of MOVE_ITEM_TRAINER_INVENTORY_SECTIONS) {
    for (const [index, entry] of document.inventory[section].entries()) {
      const id = groupRowStableId(entry, section, index)
      if (ids.has(id)) fail('destination-conflict', `Group inventory item ID ${id} is duplicated.`)
      ids.set(id, { section, index })
    }
  }
  return ids
}

const safeQuantitySum = (left: number, right: number, label: string): number => {
  const total = left + right
  if (!Number.isSafeInteger(total)) {
    return fail('invalid-quantity', `${label} exceeds the maximum safe integer.`)
  }
  return total
}

const addInventoryItem = (input: {
  readonly state: WorkingState
  readonly destination: MoveItemInventoryDestination
  readonly stack: ItemStack
  readonly operation: MoveItemMutation
  readonly operationOrder: number
}): string => {
  const { state, destination, stack, operation, operationOrder } = input
  assertOwnerRevision(state, destination.owner)
  if (destination.section === 'equipment' && stack.quantity !== 1) {
    fail('invalid-quantity', `Operation ${operation.id} cannot place a stack into equipment inventory.`)
  }

  if (destination.kind === 'trainer-inventory-row') {
    const sheet = state.trainerSheets.get(destination.owner.slug)
      ?? fail('resource-missing', `Trainer item sheet ${destination.owner.slug} is unavailable.`)
    const ids = allTrainerRowIds(sheet)
    const existing = ids.get(destination.itemId)
    if (existing && existing.section !== destination.section) {
      fail(
        'destination-conflict',
        `Trainer item ID ${destination.itemId} belongs to ${existing.section}, not ${destination.section}.`,
      )
    }
    const rows = trainerInventoryRows(sheet, destination.section)
    let nextRows: readonly InventoryEntry[]
    if (existing) {
      const entry = rows[existing.index]!
      const existingCanonical = canonicalItem(entry.name, `Trainer destination ${destination.itemId}`)
      if (existingCanonical.id !== stack.canonicalItemId || destination.section === 'equipment') {
        fail('destination-occupied', `Trainer item destination ${destination.itemId} is occupied.`)
      }
      const quantity = inventoryQuantity(
        entry,
        destination.section,
        `Trainer destination ${destination.itemId}`,
      )
      nextRows = rows.map((row, index) => index === existing.index
        ? { ...row, qty: safeQuantitySum(quantity, stack.quantity, 'Trainer item quantity') }
        : deepCloneJson(row))
    }
    else {
      nextRows = [...rows.map(row => deepCloneJson(row)), entryForDestination(
        stack,
        destination.itemId,
        destination.section,
      )]
    }
    setTrainerSheet(state, destination.owner.slug, {
      ...sheet,
      inventory: { ...(sheet.inventory ?? {}), [destination.section]: nextRows },
    })
    return touchResource({
      state,
      owner: destination.owner,
      operation,
      operationOrder,
      changedField: 'inventory',
    })
  }

  const document = state.groupInventories.get(destination.owner.slug)
    ?? fail('resource-missing', `Group inventory ${destination.owner.slug} is unavailable.`)
  const ids = allGroupRowIds(document)
  const existing = ids.get(destination.itemId)
  if (existing && existing.section !== destination.section) {
    fail(
      'destination-conflict',
      `Group item ID ${destination.itemId} belongs to ${existing.section}, not ${destination.section}.`,
    )
  }
  const rows = document.inventory[destination.section]
  let nextRows: readonly GroupInventoryEntry[]
  if (existing) {
    const entry = rows[existing.index]!
    const existingCanonical = canonicalItem(entry.name, `Group destination ${destination.itemId}`)
    if (existingCanonical.id !== stack.canonicalItemId || destination.section === 'equipment') {
      fail('destination-occupied', `Group item destination ${destination.itemId} is occupied.`)
    }
    const quantity = inventoryQuantity(
      entry,
      destination.section,
      `Group destination ${destination.itemId}`,
    )
    nextRows = rows.map((row, index) => index === existing.index
      ? { ...row, qty: safeQuantitySum(quantity, stack.quantity, 'Group item quantity') }
      : deepCloneJson(row))
  }
  else {
    nextRows = [
      ...rows.map(row => deepCloneJson(row)),
      entryForDestination(stack, destination.itemId, destination.section) as GroupInventoryEntry,
    ]
  }
  state.groupInventories.set(destination.owner.slug, {
    ...document,
    inventory: { ...document.inventory, [destination.section]: nextRows },
  })
  return touchResource({ state, owner: destination.owner, operation, operationOrder })
}

const addEquippedItem = (input: {
  readonly state: WorkingState
  readonly destination: MoveItemEquippedDestination
  readonly stack: ItemStack
  readonly operation: MoveItemMutation
  readonly operationOrder: number
}): string => {
  const { state, destination, stack, operation, operationOrder } = input
  assertOwnerRevision(state, destination.owner)
  if (stack.quantity !== 1) {
    fail('invalid-quantity', `Operation ${operation.id} cannot equip more than one item.`)
  }
  if (destination.kind === 'pokemon-held') {
    const sheet = state.pokemonSheets.get(destination.owner.slug)
      ?? fail('resource-missing', `Pokémon item sheet ${destination.owner.slug} is unavailable.`)
    if (splitSheetItemNames(sheet.items?.held).length > 0) {
      fail('destination-occupied', `Pokémon ${destination.owner.slug} already holds an item.`)
    }
    setPokemonSheet(state, destination.owner.slug, {
      ...sheet,
      items: { ...(sheet.items ?? {}), held: stack.canonicalItemName },
    })
    return touchResource({
      state,
      owner: destination.owner,
      operation,
      operationOrder,
      changedField: 'items',
    })
  }

  const sheet = state.trainerSheets.get(destination.owner.slug)
    ?? fail('resource-missing', `Trainer item sheet ${destination.owner.slug} is unavailable.`)
  if (splitSheetItemNames(sheet.equipmentSlots?.[destination.slot]).length > 0) {
    fail(
      'destination-occupied',
      `Trainer ${destination.owner.slug} equipment slot ${destination.slot} is occupied.`,
    )
  }
  setTrainerSheet(state, destination.owner.slug, {
    ...sheet,
    equipmentSlots: {
      ...(sheet.equipmentSlots ?? {}),
      [destination.slot]: stack.canonicalItemName,
    },
  })
  return touchResource({
    state,
    owner: destination.owner,
    operation,
    operationOrder,
    changedField: 'equipmentSlots',
  })
}

const addGroundItem = (input: {
  readonly state: WorkingState
  readonly destination: MoveItemMapGroundDestination
  readonly stack: ItemStack
  readonly operation: MoveItemMutation
  readonly operationOrder: number
  readonly originOperationId: string
}): string => {
  const { state, destination, stack, operation, operationOrder } = input
  assertOwnerRevision(state, destination.owner)
  const dimensions = state.map.dimensions
  if (
    destination.position.x >= dimensions.x
    || destination.position.y >= dimensions.y
    || destination.position.z >= dimensions.z
  ) {
    fail('map-position-invalid', `Ground-item destination ${destination.itemId} is outside map bounds.`)
  }
  const encounterState = parseEncounterState(
    state.map.encounterState ?? createEmptyEncounterState(),
  )
  if (encounterState.groundItems.some(item => item.id === destination.itemId)) {
    fail('destination-occupied', `Ground-item destination ${destination.itemId} is occupied.`)
  }
  state.map = {
    ...state.map,
    encounterState: parseEncounterState({
      ...encounterState,
      groundItems: [
        ...encounterState.groundItems,
        {
          id: destination.itemId,
          canonicalItemId: stack.canonicalItemId,
          canonicalItemName: stack.canonicalItemName,
          quantity: stack.quantity,
          position: destination.position,
          sourceResource: stack.source.owner,
          sourceOperationId: input.originOperationId,
          sideId: destination.sideId,
          ownerPlacementId: destination.ownerPlacementId,
        },
      ],
    }),
  }
  return touchResource({ state, owner: destination.owner, operation, operationOrder })
}

const addItem = (input: {
  readonly state: WorkingState
  readonly destination: MoveItemDestination
  readonly stack: ItemStack
  readonly operation: MoveItemMutation
  readonly operationOrder: number
  readonly originOperationId: string
}): string => {
  if (input.destination.kind === 'map-ground-item') return addGroundItem(input as Parameters<typeof addGroundItem>[0])
  if (
    input.destination.kind === 'pokemon-held'
    || input.destination.kind === 'trainer-equipment-slot'
  ) {
    return addEquippedItem(input as Parameters<typeof addEquippedItem>[0])
  }
  return addInventoryItem(input as Parameters<typeof addInventoryItem>[0])
}

const referenceLocationKey = (reference: MoveItemReference): string => {
  const owner = resourceKeyForOwner(reference.owner)
  if (reference.kind === 'pokemon-held') return `${owner}:held:${reference.itemId}`
  if (reference.kind === 'trainer-equipment-slot') {
    return `${owner}:slot:${reference.slot}:${reference.itemId}`
  }
  if (reference.kind === 'trainer-inventory-row' || reference.kind === 'group-inventory-row') {
    return `${owner}:row:${reference.section}:${reference.itemId}`
  }
  return `${owner}:ground:${reference.itemId}`
}

const destinationLocationKey = (destination: MoveItemDestination): string => {
  const owner = resourceKeyForOwner(destination.owner)
  if (destination.kind === 'pokemon-held') return `${owner}:held`
  if (destination.kind === 'trainer-equipment-slot') return `${owner}:slot:${destination.slot}`
  if (destination.kind === 'trainer-inventory-row' || destination.kind === 'group-inventory-row') {
    return `${owner}:row:${destination.section}:${destination.itemId}`
  }
  return `${owner}:ground:${destination.itemId}`
}

const equipmentDestinationFor = (
  reference: MoveItemReference,
): MoveItemEquippedDestination => {
  if (reference.kind === 'pokemon-held') {
    return { kind: reference.kind, owner: reference.owner }
  }
  if (reference.kind === 'trainer-equipment-slot') {
    return { kind: reference.kind, owner: reference.owner, slot: reference.slot }
  }
  return fail('unsupported-location', `Item ${reference.itemId} is not equipped and cannot be swapped.`)
}

const assertSoleEquippedItem = (state: WorkingState, reference: MoveItemReference): void => {
  if (reference.kind === 'pokemon-held') {
    const sheet = state.pokemonSheets.get(reference.owner.slug)
      ?? fail('resource-missing', `Pokémon item sheet ${reference.owner.slug} is unavailable.`)
    if (splitSheetItemNames(sheet.items?.held).length !== 1) {
      fail('unsupported-location', `Held item ${reference.itemId} is not the sole equipped item.`)
    }
    return
  }
  if (reference.kind === 'trainer-equipment-slot') {
    const sheet = state.trainerSheets.get(reference.owner.slug)
      ?? fail('resource-missing', `Trainer item sheet ${reference.owner.slug} is unavailable.`)
    if (splitSheetItemNames(sheet.equipmentSlots?.[reference.slot]).length !== 1) {
      fail('unsupported-location', `Trainer item ${reference.itemId} is not the sole item in its slot.`)
    }
    return
  }
  fail('unsupported-location', `Item ${reference.itemId} is not equipped.`)
}

const addQuantity = (
  quantities: Map<string, number>,
  canonicalItemId: string,
  quantity: number,
): void => {
  const next = (quantities.get(canonicalItemId) ?? 0) + quantity
  if (!Number.isSafeInteger(next)) {
    fail('invalid-quantity', `Total quantity for ${canonicalItemId} exceeds the maximum safe integer.`)
  }
  quantities.set(canonicalItemId, next)
}

const countNamedItems = (
  quantities: Map<string, number>,
  names: readonly string[],
): void => {
  for (const name of names) {
    const item = resolveMoveAutomationItemRuleIdentity(name)
    if (item) addQuantity(quantities, item.canonicalItemId, 1)
  }
}

const countInventory = (
  quantities: Map<string, number>,
  inventory: TrainerInventory | GroupInventoryDocument['inventory'] | undefined,
): void => {
  if (!inventory) return
  for (const section of MOVE_ITEM_TRAINER_INVENTORY_SECTIONS) {
    for (const entry of inventory[section] ?? []) {
      const item = resolveMoveAutomationItemRuleIdentity(entry.name)
      if (!item) continue
      const quantity = section === 'equipment'
        ? 1
        : Number.isSafeInteger(entry.qty) && Number(entry.qty) > 0
          ? Number(entry.qty)
          : 0
      if (quantity > 0) addQuantity(quantities, item.canonicalItemId, quantity)
    }
  }
}

const quantitySnapshot = (state: WorkingState): ReadonlyMap<string, number> => {
  const quantities = new Map<string, number>()
  for (const sheet of state.pokemonSheets.values()) {
    countNamedItems(quantities, splitSheetItemNames(sheet.items?.held))
  }
  for (const sheet of state.trainerSheets.values()) {
    for (const slot of MOVE_ITEM_TRAINER_EQUIPMENT_SLOTS) {
      countNamedItems(quantities, splitSheetItemNames(sheet.equipmentSlots?.[slot]))
    }
    countInventory(quantities, sheet.inventory)
  }
  for (const document of state.groupInventories.values()) {
    countInventory(quantities, document.inventory)
  }
  const encounter = parseEncounterState(
    state.map.encounterState ?? createEmptyEncounterState(),
  )
  for (const item of encounter.groundItems) {
    addQuantity(quantities, item.canonicalItemId, item.quantity)
  }
  return quantities
}

const quantityDelta = (
  previous: ReadonlyMap<string, number>,
  current: ReadonlyMap<string, number>,
): Map<string, number> => {
  const ids = new Set([...previous.keys(), ...current.keys()])
  const result = new Map<string, number>()
  for (const id of ids) {
    const delta = (current.get(id) ?? 0) - (previous.get(id) ?? 0)
    if (delta !== 0) result.set(id, delta)
  }
  return result
}

const assertQuantityEffects = (input: {
  readonly operationId: string
  readonly policy: MoveItemQuantityPolicy
  readonly previous: ReadonlyMap<string, number>
  readonly current: ReadonlyMap<string, number>
  readonly expected: ReadonlyMap<string, number>
  readonly auditedItemIds: readonly string[]
}): readonly MoveItemQuantityEffect[] => {
  const actual = quantityDelta(input.previous, input.current)
  const ids = new Set([...actual.keys(), ...input.expected.keys()])
  for (const id of ids) {
    if ((actual.get(id) ?? 0) !== (input.expected.get(id) ?? 0)) {
      fail(
        'quantity-conservation-violation',
        `Operation ${input.operationId} (${input.policy}) changed ${id} by ${actual.get(id) ?? 0}; expected ${input.expected.get(id) ?? 0}.`,
      )
    }
  }
  return [...new Set(input.auditedItemIds)].sort().map(canonicalItemId => ({
    canonicalItemId,
    delta: actual.get(canonicalItemId) ?? 0,
  }))
}

const validateConsumedRecord = (
  value: MoveConsumedItemRecord,
  label: string,
): MoveConsumedItemRecord => {
  const consumptionId = boundedIdentifier(value.consumptionId, `${label}.consumptionId`)
  const sourceOperationId = boundedIdentifier(
    value.sourceOperationId,
    `${label}.sourceOperationId`,
  )
  const source = parseReference(value.source, `${label}.source`)
  const quantity = positiveQuantity(value.quantity, `${label}.quantity`)
  const canonical = canonicalItem(value.canonicalItemId, `${label}.canonicalItemId`)
  if (canonical.id !== value.canonicalItemId || source.canonicalItemId !== canonical.id) {
    fail('item-mismatch', `${label} has inconsistent canonical item identity.`)
  }
  if (quantity > source.quantity) {
    fail('invalid-quantity', `${label} quantity exceeds its consumed source snapshot.`)
  }
  return deepFreeze({
    consumptionId,
    sourceOperationId,
    source,
    canonicalItemId: canonical.id,
    quantity,
  })
}

const itemEffectHash = (value: string, seed: number): string => {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const suppressionInstanceId = (input: {
  readonly familyId: string
  readonly sourcePlacementId: string
  readonly targetPlacementId: string
  readonly operationId: string
}): string => {
  const identity = [
    input.familyId,
    input.sourcePlacementId,
    input.targetPlacementId,
    input.operationId,
  ].join('\u0000')
  return `effect.item.${itemEffectHash(identity, 0x811c9dc5)}${itemEffectHash(identity, 0x9e3779b9)}`
}

const recordConsumption = (input: {
  readonly operation: MoveItemMutation
  readonly consumptionId: unknown
  readonly source: MoveItemReference
  readonly canonicalItemId: string
  readonly quantity: number
  readonly allConsumptions: Map<string, MoveConsumedItemRecord>
  readonly availableConsumptions: Map<string, MoveConsumedItemRecord>
  readonly createdConsumptions: MoveConsumedItemRecord[]
}): MoveConsumedItemRecord => {
  const consumptionId = boundedIdentifier(
    input.consumptionId,
    `${input.operation.id}.consumptionId`,
  )
  if (input.allConsumptions.has(consumptionId)) {
    fail('duplicate-consumption', `Consumed-item identity ${consumptionId} is duplicated.`)
  }
  const record = validateConsumedRecord({
    consumptionId,
    sourceOperationId: input.operation.id,
    source: input.source,
    canonicalItemId: input.canonicalItemId,
    quantity: input.quantity,
  }, `consumption ${consumptionId}`)
  input.allConsumptions.set(consumptionId, record)
  input.availableConsumptions.set(consumptionId, record)
  input.createdConsumptions.push(record)
  return record
}

const digestionBuffName = (
  state: WorkingState,
  owner: MoveItemOwnerReference,
  operation: MoveItemMutation,
): string | null => {
  assertOwnerRevision(state, owner)
  if (owner.kind !== 'sheet') {
    return fail('invalid-destination', `Operation ${operation.id} digestion owner must be a sheet.`)
  }
  if (owner.sheetKind === 'pokemon') {
    const sheet = state.pokemonSheets.get(owner.slug)
      ?? fail('resource-missing', `Pokémon item sheet ${owner.slug} is unavailable.`)
    const value = sheet.items?.digestionFood
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }
  const sheet = state.trainerSheets.get(owner.slug)
    ?? fail('resource-missing', `Trainer item sheet ${owner.slug} is unavailable.`)
  return typeof sheet.digestion === 'string' && sheet.digestion.trim()
    ? sheet.digestion.trim()
    : null
}

const storeDigestionBuff = (input: {
  readonly state: WorkingState
  readonly owner: MoveItemOwnerReference
  readonly canonicalItemName: string
  readonly operation: MoveItemMutation
  readonly operationOrder: number
}): string => {
  const { state, owner, operation, operationOrder } = input
  if (digestionBuffName(state, owner, operation) !== null) {
    return fail('destination-occupied', `Digestion buff destination ${owner.slug} is occupied.`)
  }
  if (owner.kind !== 'sheet') {
    return fail('invalid-destination', `Operation ${operation.id} digestion owner must be a sheet.`)
  }
  if (owner.sheetKind === 'pokemon') {
    const sheet = state.pokemonSheets.get(owner.slug)
      ?? fail('resource-missing', `Pokémon item sheet ${owner.slug} is unavailable.`)
    setPokemonSheet(state, owner.slug, {
      ...sheet,
      items: { ...(sheet.items ?? {}), digestionFood: input.canonicalItemName },
    })
    return touchResource({
      state,
      owner,
      operation,
      operationOrder,
      changedField: 'items',
    })
  }
  const sheet = state.trainerSheets.get(owner.slug)
    ?? fail('resource-missing', `Trainer item sheet ${owner.slug} is unavailable.`)
  setTrainerSheet(state, owner.slug, { ...sheet, digestion: input.canonicalItemName })
  return touchResource({
    state,
    owner,
    operation,
    operationOrder,
    changedField: 'digestion',
  })
}

const digestStoredBuff = (input: {
  readonly state: WorkingState
  readonly owner: MoveItemOwnerReference
  readonly canonicalItemIds: readonly string[] | null
  readonly operation: MoveItemMutation
  readonly operationOrder: number
}): { readonly canonicalItemId: string; readonly resourceKey: string } => {
  const name = digestionBuffName(input.state, input.owner, input.operation)
    ?? fail('item-missing', `Operation ${input.operation.id} found no stored digestion buff.`)
  const canonical = canonicalItem(name, `${input.operation.id}.digestionBuff`)
  if (
    input.canonicalItemIds !== null
    && !input.canonicalItemIds.includes(canonical.id)
  ) {
    fail('item-mismatch', `Stored digestion buff ${canonical.id} is not legal for ${input.operation.id}.`)
  }
  const owner = input.owner
  if (owner.kind !== 'sheet') {
    return fail('invalid-destination', `Operation ${input.operation.id} digestion owner must be a sheet.`)
  }
  if (owner.sheetKind === 'pokemon') {
    const sheet = input.state.pokemonSheets.get(owner.slug)
      ?? fail('resource-missing', `Pokémon item sheet ${owner.slug} is unavailable.`)
    const items = { ...(sheet.items ?? {}) }
    delete items.digestionFood
    setPokemonSheet(input.state, owner.slug, { ...sheet, items })
    return {
      canonicalItemId: canonical.id,
      resourceKey: touchResource({
        state: input.state,
        owner,
        operation: input.operation,
        operationOrder: input.operationOrder,
        changedField: 'items',
      }),
    }
  }
  const sheet = input.state.trainerSheets.get(owner.slug)
    ?? fail('resource-missing', `Trainer item sheet ${owner.slug} is unavailable.`)
  const next = { ...sheet }
  delete next.digestion
  setTrainerSheet(input.state, owner.slug, next)
  return {
    canonicalItemId: canonical.id,
    resourceKey: touchResource({
      state: input.state,
      owner,
      operation: input.operation,
      operationOrder: input.operationOrder,
      changedField: 'digestion',
    }),
  }
}

const applyItemSuppression = (input: {
  readonly state: WorkingState
  readonly operation: Extract<MoveItemMutation, { readonly kind: 'item-suppress' }>
  readonly operationOrder: number
}): string => {
  const operation = input.operation
  const encounter = parseEncounterState(
    input.state.map.encounterState ?? createEmptyEncounterState(),
  )
  const targetIds = new Set<string>()
  for (const target of operation.targets) {
    boundedIdentifier(target.placementId, `${operation.id}.targets.placementId`)
    if (targetIds.has(target.placementId)) {
      fail('invalid-operation', `Item suppression ${operation.id} duplicates target ${target.placementId}.`)
    }
    targetIds.add(target.placementId)
    if (!input.state.map.placements.some(placement => placement.id === target.placementId)) {
      fail('resource-missing', `Item suppression target ${target.placementId} is unavailable.`)
    }
    if (
      (operation.scope === 'item-bindings') !== (target.itemBindingIds.length > 0)
      || new Set(target.itemBindingIds).size !== target.itemBindingIds.length
    ) {
      fail('invalid-operation', `Item suppression ${operation.id} has inconsistent item bindings.`)
    }
    target.itemBindingIds.forEach((bindingId, index) => {
      boundedIdentifier(bindingId, `${operation.id}.targets.itemBindingIds[${index}]`)
    })
  }
  if (operation.targets.length === 0) {
    fail('invalid-operation', `Item suppression ${operation.id} requires at least one target.`)
  }
  if (!operation.blocksUse && !operation.blocksBenefit) {
    fail('invalid-operation', `Item suppression ${operation.id} must block use, benefit, or both.`)
  }
  const familyId = boundedIdentifier(operation.effectId, `${operation.id}.effectId`)
  const sourceMoveId = boundedIdentifier(operation.sourceMoveId, `${operation.id}.sourceMoveId`)
  const sourcePlacementId = boundedIdentifier(
    operation.sourcePlacementId,
    `${operation.id}.sourcePlacementId`,
  )
  let effects = encounter.effects
  if (operation.replacement === 'replace-by-source') {
    effects = effects.filter(effect => !(
      effect.kind === 'item-suppression'
      && effect.payload.familyId === familyId
      && effect.source.placementId === sourcePlacementId
    ))
  }
  const additions: EncounterItemSuppressionEffect[] = operation.targets.map((target) => ({
    id: suppressionInstanceId({
      familyId,
      sourcePlacementId,
      targetPlacementId: target.placementId,
      operationId: operation.id,
    }),
    kind: 'item-suppression',
    source: {
      operationId: operation.id,
      moveId: sourceMoveId,
      placementId: sourcePlacementId,
    },
    affected: {
      placementIds: [target.placementId],
      sideIds: [],
      cells: [],
    },
    createdRound: encounter.history.currentRound ?? 1,
    createdTurn: encounter.history.currentTurn?.turn ?? 0,
    duration: operation.duration,
    stacks: 1,
    charges: null,
    stackPolicy: { kind: 'independent-instance', maxStacks: null },
    chargePolicy: { kind: 'none', amount: null },
    tags: ['item', 'item-suppression'],
    payload: {
      familyId,
      scope: operation.scope,
      itemBindingIds: [...target.itemBindingIds],
      blocksUse: operation.blocksUse,
      blocksBenefit: operation.blocksBenefit,
    },
    dispel: { policy: 'matching-tags', tags: ['item-suppression'] },
    transferPolicy: 'expire',
    suppression: { sources: [] },
  }))
  input.state.map = {
    ...input.state.map,
    encounterState: parseEncounterState({ ...encounter, effects: [...effects, ...additions] }),
  }
  return touchResource({
    state: input.state,
    owner: { kind: 'map', slug: input.state.map.slug, revision: normalizeRevision(input.state.map.revision) },
    operation,
    operationOrder: input.operationOrder,
  })
}

const operationBase = (
  operation: MoveItemMutation,
  index: number,
): Pick<MoveItemMutation, 'id' | 'kind' | 'reasonCode'> => {
  if (typeof operation !== 'object' || operation === null || !MUTATION_KIND_SET.has(operation.kind)) {
    return fail('invalid-operation', `Item mutation operations[${index}] has an unsupported kind.`)
  }
  return {
    id: boundedIdentifier(operation.id, `operations[${index}].id`),
    kind: operation.kind,
    reasonCode: boundedReasonCode(operation.reasonCode, `operations[${index}].reasonCode`),
  }
}

const resourceScopesFor = (
  state: WorkingState,
  keys: ReadonlySet<string>,
): readonly MoveItemMutationResourceScope[] => [...keys].map(key => {
  const touch = state.touches.get(key)
  if (!touch) return fail('invalid-operation', `Missing item resource scope ${key}.`)
  return deepCloneJson(touch.scope)
})

const reduceOperation = (input: {
  readonly state: WorkingState
  readonly operation: MoveItemMutation
  readonly operationOrder: number
  readonly originOperationId: string
  readonly allConsumptions: Map<string, MoveConsumedItemRecord>
  readonly availableConsumptions: Map<string, MoveConsumedItemRecord>
  readonly createdConsumptions: MoveConsumedItemRecord[]
}): MoveItemMutationOperationResult => {
  const { state, operation, operationOrder } = input
  const previousQuantities = quantitySnapshot(state)
  const touchedKeys = new Set<string>()
  const expected = new Map<string, number>()
  const auditedItemIds: string[] = []
  let quantityPolicy: MoveItemQuantityPolicy = 'conserve'
  let consumptionId: string | null = null

  if (operation.kind === 'swap') {
    const left = parseReference(operation.left, `${operation.id}.left`)
    const right = parseReference(operation.right, `${operation.id}.right`)
    if (referenceLocationKey(left) === referenceLocationKey(right)) {
      fail('invalid-operation', `Swap operation ${operation.id} references one item location twice.`)
    }
    assertSoleEquippedItem(state, left)
    assertSoleEquippedItem(state, right)
    const leftDestination = equipmentDestinationFor(left)
    const rightDestination = equipmentDestinationFor(right)
    const removedLeft = removeItem({
      state,
      source: left,
      quantity: 1,
      operation,
      operationOrder,
    })
    const removedRight = removeItem({
      state,
      source: right,
      quantity: 1,
      operation,
      operationOrder,
    })
    touchedKeys.add(removedLeft.resourceKey)
    touchedKeys.add(removedRight.resourceKey)
    touchedKeys.add(addItem({
      state,
      destination: leftDestination,
      stack: removedRight.stack,
      operation,
      operationOrder,
      originOperationId: input.originOperationId,
    }))
    touchedKeys.add(addItem({
      state,
      destination: rightDestination,
      stack: removedLeft.stack,
      operation,
      operationOrder,
      originOperationId: input.originOperationId,
    }))
    auditedItemIds.push(removedLeft.stack.canonicalItemId, removedRight.stack.canonicalItemId)
  }
  else if (operation.kind === 'item-suppress') {
    touchedKeys.add(applyItemSuppression({ state, operation, operationOrder }))
  }
  else if (operation.kind === 'reuse-consumed') {
    consumptionId = boundedIdentifier(operation.consumptionId, `${operation.id}.consumptionId`)
    const consumed = input.availableConsumptions.get(consumptionId)
      ?? fail(
        'consumption-missing',
        `Reuse operation ${operation.id} cannot resolve available consumption ${consumptionId}.`,
      )
    auditedItemIds.push(consumed.canonicalItemId)
  }
  else if (operation.kind === 'restore-consumed') {
    consumptionId = boundedIdentifier(operation.consumptionId, `${operation.id}.consumptionId`)
    const consumed = input.availableConsumptions.get(consumptionId)
      ?? fail(
        'consumption-missing',
        `Restore operation ${operation.id} cannot resolve available consumption ${consumptionId}.`,
      )
    const destination = parseDestination(operation.destination, `${operation.id}.destination`)
    assertOwnerRevision(state, destination.owner)
    const canonical = canonicalItem(
      consumed.canonicalItemId,
      `${operation.id}.consumed.canonicalItemId`,
    )
    const stack: ItemStack = {
      canonicalItemId: canonical.id,
      canonicalItemName: canonical.name,
      quantity: consumed.quantity,
      source: consumed.source,
      entry: null,
    }
    touchedKeys.add(addItem({
      state,
      destination,
      stack,
      operation,
      operationOrder,
      originOperationId: input.originOperationId,
    }))
    input.availableConsumptions.delete(consumptionId)
    quantityPolicy = 'restore-consumed'
    expected.set(canonical.id, consumed.quantity)
    auditedItemIds.push(canonical.id)
  }
  else if (operation.kind === 'store-digestion-buff') {
    const source = parseReference(operation.source, `${operation.id}.source`)
    const quantity = positiveQuantity(operation.quantity, `${operation.id}.quantity`)
    if (quantity !== 1) {
      fail('invalid-quantity', `Store-buff operation ${operation.id} must consume one item.`)
    }
    const owner = parseOwner(operation.destination.owner, `${operation.id}.destination.owner`)
    if (owner.kind !== 'sheet') {
      fail('invalid-destination', `Store-buff operation ${operation.id} requires a sheet owner.`)
    }
    const removed = removeItem({ state, source, quantity, operation, operationOrder })
    touchedKeys.add(removed.resourceKey)
    touchedKeys.add(storeDigestionBuff({
      state,
      owner,
      canonicalItemName: removed.stack.canonicalItemName,
      operation,
      operationOrder,
    }))
    quantityPolicy = 'consume'
    expected.set(removed.stack.canonicalItemId, -removed.stack.quantity)
    auditedItemIds.push(removed.stack.canonicalItemId)
    consumptionId = recordConsumption({
      operation,
      consumptionId: operation.consumptionId,
      source,
      canonicalItemId: removed.stack.canonicalItemId,
      quantity: removed.stack.quantity,
      allConsumptions: input.allConsumptions,
      availableConsumptions: input.availableConsumptions,
      createdConsumptions: input.createdConsumptions,
    }).consumptionId
  }
  else if (operation.kind === 'digest-buff') {
    const owner = parseOwner(operation.owner, `${operation.id}.owner`)
    const canonicalItemIds = operation.canonicalItemIds === null
      ? null
      : operation.canonicalItemIds.map((itemId, index) => {
          const canonical = canonicalItem(itemId, `${operation.id}.canonicalItemIds[${index}]`)
          if (canonical.id !== itemId) {
            fail('item-mismatch', `Digest-buff item ID ${itemId} is not normalized.`)
          }
          return canonical.id
        })
    if (canonicalItemIds && new Set(canonicalItemIds).size !== canonicalItemIds.length) {
      fail('invalid-operation', `Digest-buff operation ${operation.id} duplicates an item ID.`)
    }
    const sourceMoveId = boundedIdentifier(
      operation.sourceMoveId,
      `${operation.id}.sourceMoveId`,
    )
    const sourcePlacementId = boundedIdentifier(
      operation.sourcePlacementId,
      `${operation.id}.sourcePlacementId`,
    )
    const sourcePlacement = state.map.placements.find(placement => (
      placement.id === sourcePlacementId
    )) ?? fail(
      'resource-missing',
      `Digest-buff source placement ${sourcePlacementId} is unavailable.`,
    )
    if (
      owner.kind !== 'sheet'
      || sourcePlacement.sheetKind !== owner.sheetKind
      || sourcePlacement.sheetSlug !== owner.slug
    ) {
      fail(
        'invalid-operation',
        `Digest-buff source placement ${sourcePlacementId} does not own ${owner.kind === 'sheet' ? `${owner.sheetKind}/${owner.slug}` : 'the selected sheet'}.`,
      )
    }
    const digested = digestStoredBuff({
      state,
      owner,
      canonicalItemIds,
      operation,
      operationOrder,
    })
    touchedKeys.add(digested.resourceKey)
    state.map = recordDigestionBuffTrade({
      map: state.map,
      placement: sourcePlacement,
      operationId: operation.id,
      moveId: sourceMoveId,
    })
    const mapOwner = {
      kind: 'map' as const,
      slug: state.map.slug,
      revision: normalizeRevision(state.previousMap.revision),
    }
    touchedKeys.add(touchResource({
      state,
      owner: mapOwner,
      operation,
      operationOrder,
    }))
    auditedItemIds.push(digested.canonicalItemId)
  }
  else {
    const source = parseReference(operation.source, `${operation.id}.source`)
    let destination: MoveItemDestination | null = null
    let quantity: number
    if (operation.kind === 'equip') {
      if (source.kind !== 'trainer-inventory-row' && source.kind !== 'group-inventory-row') {
        fail('unsupported-location', `Equip operation ${operation.id} requires an inventory-row source.`)
      }
      destination = parseDestination(operation.destination, `${operation.id}.destination`)
      if (destination.kind !== 'pokemon-held' && destination.kind !== 'trainer-equipment-slot') {
        fail('unsupported-location', `Equip operation ${operation.id} requires an equipped destination.`)
      }
      quantity = positiveQuantity(operation.quantity, `${operation.id}.quantity`)
    }
    else if (operation.kind === 'unequip') {
      if (source.kind !== 'pokemon-held' && source.kind !== 'trainer-equipment-slot') {
        fail('unsupported-location', `Unequip operation ${operation.id} requires an equipped source.`)
      }
      destination = parseDestination(operation.destination, `${operation.id}.destination`)
      if (destination.kind !== 'trainer-inventory-row' && destination.kind !== 'group-inventory-row') {
        fail('unsupported-location', `Unequip operation ${operation.id} requires an inventory destination.`)
      }
      quantity = positiveQuantity(operation.quantity, `${operation.id}.quantity`)
    }
    else if (operation.kind === 'transfer') {
      if (source.kind === 'map-ground-item') {
        fail('unsupported-location', `Transfer operation ${operation.id} requires a non-ground source.`)
      }
      destination = parseDestination(operation.destination, `${operation.id}.destination`)
      if (destination.kind === 'map-ground-item') {
        fail('unsupported-location', `Transfer operation ${operation.id} requires a non-ground destination.`)
      }
      quantity = positiveQuantity(operation.quantity, `${operation.id}.quantity`)
    }
    else if (operation.kind === 'ground-item-add') {
      if (source.kind === 'map-ground-item') {
        fail('unsupported-location', `Ground add operation ${operation.id} cannot use a ground-item source.`)
      }
      destination = parseDestination(operation.destination, `${operation.id}.destination`)
      if (destination.kind !== 'map-ground-item') {
        fail('unsupported-location', `Ground add operation ${operation.id} requires a ground destination.`)
      }
      quantity = positiveQuantity(operation.quantity, `${operation.id}.quantity`)
    }
    else if (operation.kind === 'ground-item-remove') {
      if (source.kind !== 'map-ground-item') {
        fail('unsupported-location', `Ground remove operation ${operation.id} requires a ground-item source.`)
      }
      destination = parseDestination(operation.destination, `${operation.id}.destination`)
      if (destination.kind === 'map-ground-item') {
        fail('unsupported-location', `Ground remove operation ${operation.id} requires a non-ground destination.`)
      }
      quantity = positiveQuantity(operation.quantity, `${operation.id}.quantity`)
    }
    else {
      quantity = positiveQuantity(operation.quantity, `${operation.id}.quantity`)
    }

    if (destination && referenceLocationKey(source) === destinationLocationKey(destination)) {
      fail('invalid-operation', `Operation ${operation.id} source and destination are identical.`)
    }
    const removed = removeItem({ state, source, quantity, operation, operationOrder })
    touchedKeys.add(removed.resourceKey)
    auditedItemIds.push(removed.stack.canonicalItemId)

    if (destination) {
      touchedKeys.add(addItem({
        state,
        destination,
        stack: removed.stack,
        operation,
        operationOrder,
        originOperationId: input.originOperationId,
      }))
    }
    else {
      if (
        operation.kind !== 'decrement'
        && operation.kind !== 'consume'
        && operation.kind !== 'destroy'
      ) {
        fail('invalid-operation', `Operation ${operation.id} has no item destination.`)
      }
      quantityPolicy = operation.kind === 'consume'
        ? 'consume'
        : operation.kind === 'destroy'
          ? 'destroy'
          : 'decrement'
      expected.set(removed.stack.canonicalItemId, -removed.stack.quantity)
      if (operation.kind === 'consume') {
        consumptionId = recordConsumption({
          operation,
          consumptionId: operation.consumptionId,
          source,
          canonicalItemId: removed.stack.canonicalItemId,
          quantity: removed.stack.quantity,
          allConsumptions: input.allConsumptions,
          availableConsumptions: input.availableConsumptions,
          createdConsumptions: input.createdConsumptions,
        }).consumptionId
      }
    }
  }

  const currentQuantities = quantitySnapshot(state)
  const quantityEffects = assertQuantityEffects({
    operationId: operation.id,
    policy: quantityPolicy,
    previous: previousQuantities,
    current: currentQuantities,
    expected,
    auditedItemIds,
  })
  return deepFreeze({
    operationId: operation.id,
    kind: operation.kind,
    quantityPolicy,
    quantityEffects,
    resourceScopes: resourceScopesFor(state, touchedKeys),
    consumptionId,
  })
}

const cloneMap = <Value>(source: ReadonlyMap<string, Value>): Map<string, Value> => new Map(
  [...source.entries()].map(([key, value]) => [key, deepCloneJson(value)]),
)

const buildWorkingState = (input: ReduceMoveItemMutationsInput): WorkingState => {
  const previousMap = deepCloneJson(input.map)
  const previousPokemonSheets = cloneMap(input.pokemonSheets)
  const previousTrainerSheets = cloneMap(input.trainerSheets)
  const previousGroupInventories = cloneMap(input.groupInventories)
  return {
    previousMap,
    map: deepCloneJson(previousMap),
    previousPokemonSheets,
    pokemonSheets: cloneMap(previousPokemonSheets),
    previousTrainerSheets,
    trainerSheets: cloneMap(previousTrainerSheets),
    previousGroupInventories,
    groupInventories: cloneMap(previousGroupInventories),
    touches: new Map(),
  }
}

const resourceReductions = (state: WorkingState): readonly MoveItemMutationResourceReduction[] => {
  const reductions: MoveItemMutationResourceReduction[] = []
  for (const [key, touch] of state.touches) {
    if (touch.scope.kind === 'map') {
      if (sameJsonValue(state.previousMap, state.map)) continue
      reductions.push({
        kind: 'map',
        slug: touch.scope.slug,
        expectedRevision: touch.scope.expectedRevision,
        previous: deepCloneJson(state.previousMap),
        current: deepCloneJson(state.map),
        operationIds: [...touch.operationIds],
        reasonCodes: [...touch.reasonCodes],
        firstOperationOrder: touch.firstOperationOrder,
      })
      continue
    }
    if (touch.scope.kind === 'group-inventory') {
      const previous = state.previousGroupInventories.get(touch.scope.slug)
        ?? fail('resource-missing', `Item reduction lost previous resource ${key}.`)
      const current = state.groupInventories.get(touch.scope.slug)
        ?? fail('resource-missing', `Item reduction lost current resource ${key}.`)
      if (sameJsonValue(previous, current)) continue
      reductions.push({
        kind: 'group-inventory',
        slug: touch.scope.slug,
        expectedRevision: touch.scope.expectedRevision,
        previous: deepCloneJson(previous),
        current: deepCloneJson(current),
        operationIds: [...touch.operationIds],
        reasonCodes: [...touch.reasonCodes],
        firstOperationOrder: touch.firstOperationOrder,
      })
      continue
    }
    const previous = (touch.scope.sheetKind === 'pokemon'
      ? state.previousPokemonSheets.get(touch.scope.slug)
      : state.previousTrainerSheets.get(touch.scope.slug))
      ?? fail('resource-missing', `Item reduction lost previous resource ${key}.`)
    const current = (touch.scope.sheetKind === 'pokemon'
      ? state.pokemonSheets.get(touch.scope.slug)
      : state.trainerSheets.get(touch.scope.slug))
      ?? fail('resource-missing', `Item reduction lost current resource ${key}.`)
    if (sameJsonValue(previous, current)) continue
    const changedFields = [...touch.changedFields].filter(field => (
      !sameJsonValue(previous[field as keyof ItemDocument], current[field as keyof ItemDocument])
    ))
    if (changedFields.length === 0) {
      fail('invalid-operation', `Item resource ${key} changed outside typed item fields.`)
    }
    reductions.push({
      kind: 'sheet',
      sheetKind: touch.scope.sheetKind,
      slug: touch.scope.slug,
      expectedRevision: touch.scope.expectedRevision,
      previous: deepCloneJson(previous),
      current: deepCloneJson(current),
      changedFields,
      operationIds: [...touch.operationIds],
      reasonCodes: [...touch.reasonCodes],
      firstOperationOrder: touch.firstOperationOrder,
    })
  }
  return reductions.sort((left, right) => (
    left.firstOperationOrder - right.firstOperationOrder
    || left.kind.localeCompare(right.kind)
    || left.slug.localeCompare(right.slug)
  ))
}

/**
 * Apply only typed server-reviewed item mutations to detached snapshots.
 * Every conservative operation is checked against a canonical quantity census;
 * only decrement/consume/destroy/restore-consumed may produce a non-zero delta.
 */
export const reduceMoveItemMutations = (
  input: ReduceMoveItemMutationsInput,
): ReducedMoveItemMutations => {
  if (!isOpId(input.originOperationId)) {
    fail('invalid-operation', 'Item mutation originOperationId must be a live-play operation ID.')
  }
  if (!Array.isArray(input.operations)) {
    fail('invalid-operation', 'Item mutations must be an array.')
  }
  if (input.operations.length > MOVE_ITEM_MUTATION_LIMITS.operations) {
    fail(
      'operation-limit-exceeded',
      `Item mutation plans may contain at most ${MOVE_ITEM_MUTATION_LIMITS.operations} operations.`,
    )
  }
  if ((input.consumedItems?.length ?? 0) > MOVE_ITEM_MUTATION_LIMITS.consumptions) {
    fail(
      'operation-limit-exceeded',
      `Item mutation plans may load at most ${MOVE_ITEM_MUTATION_LIMITS.consumptions} consumed items.`,
    )
  }

  const state = buildWorkingState(input)
  const operationIds = new Set<string>()
  const allConsumptions = new Map<string, MoveConsumedItemRecord>()
  const availableConsumptions = new Map<string, MoveConsumedItemRecord>()
  for (const [index, source] of (input.consumedItems ?? []).entries()) {
    const record = validateConsumedRecord(source, `consumedItems[${index}]`)
    if (allConsumptions.has(record.consumptionId)) {
      fail('duplicate-consumption', `Consumed-item identity ${record.consumptionId} is duplicated.`)
    }
    allConsumptions.set(record.consumptionId, record)
    availableConsumptions.set(record.consumptionId, record)
  }

  const createdConsumptions: MoveConsumedItemRecord[] = []
  const operationResults: MoveItemMutationOperationResult[] = []
  for (const [index, source] of input.operations.entries()) {
    const base = operationBase(source, index)
    if (operationIds.has(base.id)) {
      fail('duplicate-operation-id', `Item mutation operation ${base.id} is duplicated.`)
    }
    operationIds.add(base.id)
    const operation = { ...source, ...base } as MoveItemMutation
    operationResults.push(reduceOperation({
      state,
      operation,
      operationOrder: index,
      originOperationId: input.originOperationId,
      allConsumptions,
      availableConsumptions,
      createdConsumptions,
    }))
  }

  return deepFreeze({
    resources: resourceReductions(state),
    operationResults,
    consumedItems: createdConsumptions,
    availableConsumedItems: [...availableConsumptions.values()],
  })
}
