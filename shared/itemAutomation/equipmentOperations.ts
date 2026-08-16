import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject, type StrictJsonObject } from '../automation/strictJson'
import { SLUG_RE } from '../paths'
import { isRevision } from '../sessionRevisions'
import {
  EQUIPMENT_CONFIGURATION_SCHEMA_VERSION,
  EQUIPMENT_SLOT_IDS,
  type EquipmentOwnerKind,
  type EquipmentSlotId,
} from './equipment'
import {
  ITEM_INVENTORY_SECTIONS,
  itemInventoryInstanceId,
  type ItemInventorySection,
  type ItemSourceContainerKind,
} from './inventory'

export const EQUIPMENT_OPERATION_SCHEMA_VERSION = 1 as const
export const EQUIPMENT_CUSTODY_OPERATION_KINDS = ['equip', 'unequip', 'swap', 'give', 'take'] as const
export const EQUIPMENT_ACTIVITY_OPERATION_KINDS = [
  'suppress', 'deactivate', 'break', 'restore', 'repair',
] as const
export const EQUIPMENT_DURABILITY_OPERATION_KINDS = ['damage', 'restore-durability'] as const
export const EQUIPMENT_OPERATION_KINDS = [
  ...EQUIPMENT_CUSTODY_OPERATION_KINDS,
  ...EQUIPMENT_ACTIVITY_OPERATION_KINDS,
  ...EQUIPMENT_DURABILITY_OPERATION_KINDS,
] as const
export type EquipmentCustodyOperationKind = (typeof EQUIPMENT_CUSTODY_OPERATION_KINDS)[number]
export type EquipmentActivityOperationKind = (typeof EQUIPMENT_ACTIVITY_OPERATION_KINDS)[number]
export type EquipmentDurabilityOperationKind = (typeof EQUIPMENT_DURABILITY_OPERATION_KINDS)[number]
export type EquipmentOperationKind = (typeof EQUIPMENT_OPERATION_KINDS)[number]

export interface EquipmentOperationInventorySourceV1 {
  readonly kind: 'inventory'
  readonly containerKind: ItemSourceContainerKind
  readonly containerSlug: string
  readonly section: ItemInventorySection
  readonly rowId: string
  readonly sourceInstanceId: string
  readonly expectedRevision: number
}

export interface EquipmentOperationEquippedSourceV1 {
  readonly kind: 'equipment'
  readonly ownerKind: EquipmentOwnerKind
  readonly ownerSlug: string
  readonly instanceId: string
  readonly expectedSheetRevision: number
  readonly expectedEquipmentRevision: number
  readonly expectedInstanceRevision: number
}

export interface EquipmentOperationInventoryDestinationV1 {
  readonly kind: 'inventory'
  readonly containerKind: ItemSourceContainerKind
  readonly containerSlug: string
  readonly section: ItemInventorySection
  readonly expectedRevision: number
}

export interface EquipmentOperationEquippedDestinationV1 {
  readonly kind: 'equipment'
  readonly ownerKind: EquipmentOwnerKind
  readonly ownerSlug: string
  readonly slotIds: readonly EquipmentSlotId[]
  readonly expectedSheetRevision: number
  readonly expectedEquipmentRevision: number
}

export interface EquipmentOperationConfigurationChoiceV1 {
  readonly schemaVersion: typeof EQUIPMENT_CONFIGURATION_SCHEMA_VERSION
  readonly configurationId: string
  readonly values: StrictJsonObject
}

export type EquipmentOperationSourceV1 = EquipmentOperationInventorySourceV1 | EquipmentOperationEquippedSourceV1
export type EquipmentOperationDestinationV1 = EquipmentOperationInventoryDestinationV1 | EquipmentOperationEquippedDestinationV1

export interface EquipmentCustodyOperationCommandV1 {
  readonly schemaVersion: typeof EQUIPMENT_OPERATION_SCHEMA_VERSION
  readonly operationId: string
  readonly commandKind: EquipmentCustodyOperationKind
  readonly actorProfileId: string | null
  readonly source: EquipmentOperationSourceV1
  readonly destination: EquipmentOperationDestinationV1
  /** Required only by swap and bound to the exact displaced whole instance. */
  readonly replacedInstanceId: string | null
  /** Required only by swap; receives the displaced whole instance atomically. */
  readonly swapReturnDestination: EquipmentOperationInventoryDestinationV1 | null
  /** Server validates and binds this choice to the current configuration-definition hash. */
  readonly configuration: EquipmentOperationConfigurationChoiceV1 | null
}

export interface EquipmentActivityReasonCommandV1 {
  readonly code: string
  readonly sourceId: string | null
}
export interface EquipmentGuidedAdjudicationV1 {
  readonly kind: 'guided-adjudication'
  /** Evidence only; runtime status never derives semantics from this prose. */
  readonly note: string
}
export interface EquipmentActivityOperationCommandV1 {
  readonly schemaVersion: typeof EQUIPMENT_OPERATION_SCHEMA_VERSION
  readonly operationId: string
  readonly commandKind: EquipmentActivityOperationKind
  readonly actorProfileId: string | null
  readonly source: EquipmentOperationEquippedSourceV1
  readonly reason: EquipmentActivityReasonCommandV1
  readonly guidance: EquipmentGuidedAdjudicationV1
}
export interface EquipmentDurabilityOperationCommandV1 {
  readonly schemaVersion: typeof EQUIPMENT_OPERATION_SCHEMA_VERSION
  readonly operationId: string
  readonly commandKind: EquipmentDurabilityOperationKind
  readonly actorProfileId: string | null
  readonly source: EquipmentOperationEquippedSourceV1
  readonly amount: number
  readonly guidance: EquipmentGuidedAdjudicationV1
}
export type EquipmentOperationCommandV1 =
  | EquipmentCustodyOperationCommandV1
  | EquipmentActivityOperationCommandV1
  | EquipmentDurabilityOperationCommandV1

export interface EquipmentOperationResourceRevisionV1 {
  readonly kind: 'sheet' | 'group-inventory'
  readonly sheetKind: EquipmentOwnerKind | null
  readonly slug: string
  readonly beforeRevision: number
  readonly afterRevision: number
}

export interface EquipmentOperationAcceptedResultV1 {
  readonly schemaVersion: typeof EQUIPMENT_OPERATION_SCHEMA_VERSION
  readonly operationId: string
  readonly commandKind: EquipmentOperationKind
  readonly status: 'accepted'
  readonly exactReplay: boolean
  readonly canonicalItemId: string
  readonly equippedInstanceId: string | null
  readonly displacedCanonicalItemId: string | null
  readonly resources: readonly EquipmentOperationResourceRevisionV1[]
}

export type EquipmentOperationResultV1 = EquipmentOperationAcceptedResultV1

export const parseEquipmentOperationResult = (value: unknown): EquipmentOperationResultV1 => {
  const input = record(clone(value), 'equipmentOperationResult')
  exact(input, [
    'schemaVersion', 'operationId', 'commandKind', 'status', 'exactReplay',
    'canonicalItemId', 'equippedInstanceId', 'displacedCanonicalItemId', 'resources',
  ], 'equipmentOperationResult')
  if (input.schemaVersion !== EQUIPMENT_OPERATION_SCHEMA_VERSION || input.status !== 'accepted') {
    fail('equipmentOperationResult', 'must be an accepted schema-v1 result.')
  }
  const operationIdValue = text(input.operationId, 'equipmentOperationResult.operationId')
  if (!OPERATION_ID.test(operationIdValue)) fail('equipmentOperationResult.operationId', 'must be a versioned equipment operation identity.')
  if (typeof input.commandKind !== 'string' || !KINDS.has(input.commandKind)) fail('equipmentOperationResult.commandKind', 'is unsupported.')
  if (typeof input.exactReplay !== 'boolean') fail('equipmentOperationResult.exactReplay', 'must be boolean.')
  if (!Array.isArray(input.resources) || !input.resources.length || input.resources.length > 4) {
    fail('equipmentOperationResult.resources', 'must contain one to four resource revisions.')
  }
  const resourceValues = input.resources as unknown[]
  const exactReplay = input.exactReplay as boolean
  const resources = resourceValues.map((entry, index): EquipmentOperationResourceRevisionV1 => {
    const path = `equipmentOperationResult.resources[${index}]`
    const row = record(entry, path)
    exact(row, ['kind', 'sheetKind', 'slug', 'beforeRevision', 'afterRevision'], path)
    if (row.kind !== 'sheet' && row.kind !== 'group-inventory') fail(`${path}.kind`, 'is unsupported.')
    const sheetKind = row.sheetKind === null
      ? null
      : typeof row.sheetKind === 'string' && OWNER_KINDS.has(row.sheetKind)
        ? row.sheetKind as EquipmentOwnerKind
        : fail(`${path}.sheetKind`, 'is unsupported.')
    if ((row.kind === 'sheet') !== (sheetKind !== null)) fail(`${path}.sheetKind`, 'must identify only sheet resources.')
    const beforeRevision = revision(row.beforeRevision, `${path}.beforeRevision`)
    const afterRevision = revision(row.afterRevision, `${path}.afterRevision`)
    if (afterRevision !== beforeRevision + 1) fail(path, 'must record exactly one resource revision increment.')
    return {
      kind: row.kind as 'sheet' | 'group-inventory',
      sheetKind,
      slug: slug(row.slug, `${path}.slug`),
      beforeRevision,
      afterRevision,
    }
  })
  const resourceIds = resources.map(row => `${row.kind}:${row.sheetKind ?? ''}:${row.slug}`)
  if (new Set(resourceIds).size !== resourceIds.length) fail('equipmentOperationResult.resources', 'must contain unique resources.')
  return deepFreezeStrictJson({
    schemaVersion: EQUIPMENT_OPERATION_SCHEMA_VERSION,
    operationId: operationIdValue,
    commandKind: input.commandKind as EquipmentOperationKind,
    status: 'accepted',
    exactReplay,
    canonicalItemId: text(input.canonicalItemId, 'equipmentOperationResult.canonicalItemId'),
    equippedInstanceId: input.equippedInstanceId === null
      ? null
      : instanceId(input.equippedInstanceId, 'equipmentOperationResult.equippedInstanceId'),
    displacedCanonicalItemId: input.displacedCanonicalItemId === null
      ? null
      : text(input.displacedCanonicalItemId, 'equipmentOperationResult.displacedCanonicalItemId'),
    resources,
  })
}

export class EquipmentOperationValidationError extends Error {
  readonly path: string

  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'EquipmentOperationValidationError'
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const OPERATION_ID = /^equipment-operation:v1:[a-f0-9]{32}$/
const EQUIPPED_INSTANCE_ID = /^equipped-item:v1:[a-f0-9]{32}$/
const PROJECTED_INSTANCE_REFERENCE = /^equipment-projection:v1:(?:0|[1-9]\d{0,3})$/
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/
const CONFIGURATION_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const OWNER_KINDS = new Set(['trainer', 'pokemon'])
const CONTAINER_KINDS = new Set(['trainer', 'group'])
const SECTIONS = new Set<string>(ITEM_INVENTORY_SECTIONS)
const SLOTS = new Set<string>(EQUIPMENT_SLOT_IDS)
const KINDS = new Set<string>(EQUIPMENT_OPERATION_KINDS)
const CUSTODY_KINDS = new Set<string>(EQUIPMENT_CUSTODY_OPERATION_KINDS)
const ACTIVITY_KINDS = new Set<string>(EQUIPMENT_ACTIVITY_OPERATION_KINDS)
const DURABILITY_KINDS = new Set<string>(EQUIPMENT_DURABILITY_OPERATION_KINDS)
const ACTIVITY_REASON_CODE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/

const fail = (path: string, detail: string): never => { throw new EquipmentOperationValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const allowed = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !allowed.has(field))
  if (missing.length || unknown.length) fail(path, `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`)
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(path, 'must be bounded non-empty trimmed text.')
  }
  return value as string
}
const slug = (value: unknown, path: string): string => {
  const result = text(value, path)
  if (!SLUG_RE.test(result)) fail(path, 'must be a valid slug.')
  return result
}
const revision = (value: unknown, path: string): number => {
  if (!isRevision(value)) fail(path, 'must be a safe non-negative revision.')
  return value as number
}
const instanceId = (value: unknown, path: string): string => {
  const result = text(value, path)
  if (!EQUIPPED_INSTANCE_ID.test(result) && !PROJECTED_INSTANCE_REFERENCE.test(result)) {
    fail(path, 'must be a versioned equipped-item identity or projection-local equipment reference.')
  }
  return result
}
const clone = (value: unknown): unknown => cloneStrictJson(value, 'equipmentOperation', {
  limits: { depth: 12, nodes: 4_096, objectFields: 32, arrayEntries: 32, stringLength: 500, objectKeyLength: 100 },
  rootLabel: 'equipment operation data', valueLabel: 'equipment operation commands',
  failNotJson: (path, detail) => fail(path, detail),
  failLimit: (path, detail) => fail(path, detail),
})

const parseInventorySource = (input: UnknownRecord, path: string): EquipmentOperationInventorySourceV1 => {
  exact(input, ['kind', 'containerKind', 'containerSlug', 'section', 'rowId', 'sourceInstanceId', 'expectedRevision'], path)
  if (input.kind !== 'inventory') fail(`${path}.kind`, 'must be inventory.')
  if (typeof input.containerKind !== 'string' || !CONTAINER_KINDS.has(input.containerKind)) fail(`${path}.containerKind`, 'is unsupported.')
  if (typeof input.section !== 'string' || !SECTIONS.has(input.section)) fail(`${path}.section`, 'is unsupported.')
  const containerKind = input.containerKind as ItemSourceContainerKind
  const containerSlug = slug(input.containerSlug, `${path}.containerSlug`)
  const section = input.section as ItemInventorySection
  const rowId = text(input.rowId, `${path}.rowId`)
  if (!IDENTIFIER.test(rowId)) fail(`${path}.rowId`, 'must be a stable row identity.')
  const sourceInstanceId = text(input.sourceInstanceId, `${path}.sourceInstanceId`)
  let expected: string | null = null
  try { expected = itemInventoryInstanceId({ containerKind, containerSlug, section, rowId }) }
  catch { expected = null }
  if (sourceInstanceId !== expected) fail(`${path}.sourceInstanceId`, 'must match the exact inventory row identity.')
  return { kind: 'inventory', containerKind, containerSlug, section, rowId, sourceInstanceId, expectedRevision: revision(input.expectedRevision, `${path}.expectedRevision`) }
}

const parseEquippedSource = (input: UnknownRecord, path: string): EquipmentOperationEquippedSourceV1 => {
  exact(input, ['kind', 'ownerKind', 'ownerSlug', 'instanceId', 'expectedSheetRevision', 'expectedEquipmentRevision', 'expectedInstanceRevision'], path)
  if (input.kind !== 'equipment') fail(`${path}.kind`, 'must be equipment.')
  if (typeof input.ownerKind !== 'string' || !OWNER_KINDS.has(input.ownerKind)) fail(`${path}.ownerKind`, 'is unsupported.')
  return {
    kind: 'equipment', ownerKind: input.ownerKind as EquipmentOwnerKind,
    ownerSlug: slug(input.ownerSlug, `${path}.ownerSlug`),
    instanceId: instanceId(input.instanceId, `${path}.instanceId`),
    expectedSheetRevision: revision(input.expectedSheetRevision, `${path}.expectedSheetRevision`),
    expectedEquipmentRevision: revision(input.expectedEquipmentRevision, `${path}.expectedEquipmentRevision`),
    expectedInstanceRevision: revision(input.expectedInstanceRevision, `${path}.expectedInstanceRevision`),
  }
}

const parseInventoryDestination = (input: UnknownRecord, path: string): EquipmentOperationInventoryDestinationV1 => {
  exact(input, ['kind', 'containerKind', 'containerSlug', 'section', 'expectedRevision'], path)
  if (input.kind !== 'inventory') fail(`${path}.kind`, 'must be inventory.')
  if (typeof input.containerKind !== 'string' || !CONTAINER_KINDS.has(input.containerKind)) fail(`${path}.containerKind`, 'is unsupported.')
  if (typeof input.section !== 'string' || !SECTIONS.has(input.section)) fail(`${path}.section`, 'is unsupported.')
  return {
    kind: 'inventory', containerKind: input.containerKind as ItemSourceContainerKind,
    containerSlug: slug(input.containerSlug, `${path}.containerSlug`),
    section: input.section as ItemInventorySection,
    expectedRevision: revision(input.expectedRevision, `${path}.expectedRevision`),
  }
}

const parseEquippedDestination = (input: UnknownRecord, path: string): EquipmentOperationEquippedDestinationV1 => {
  exact(input, ['kind', 'ownerKind', 'ownerSlug', 'slotIds', 'expectedSheetRevision', 'expectedEquipmentRevision'], path)
  if (input.kind !== 'equipment') fail(`${path}.kind`, 'must be equipment.')
  if (typeof input.ownerKind !== 'string' || !OWNER_KINDS.has(input.ownerKind)) fail(`${path}.ownerKind`, 'is unsupported.')
  if (!Array.isArray(input.slotIds) || !input.slotIds.length || input.slotIds.length > 6) fail(`${path}.slotIds`, 'must contain one complete bounded slot option.')
  const slotIds = (input.slotIds as unknown[]).map((slot, index) => {
    if (typeof slot !== 'string' || !SLOTS.has(slot)) fail(`${path}.slotIds[${index}]`, 'is unsupported.')
    return slot as EquipmentSlotId
  })
  if (new Set(slotIds).size !== slotIds.length) fail(`${path}.slotIds`, 'must contain unique slots.')
  return {
    kind: 'equipment', ownerKind: input.ownerKind as EquipmentOwnerKind,
    ownerSlug: slug(input.ownerSlug, `${path}.ownerSlug`), slotIds,
    expectedSheetRevision: revision(input.expectedSheetRevision, `${path}.expectedSheetRevision`),
    expectedEquipmentRevision: revision(input.expectedEquipmentRevision, `${path}.expectedEquipmentRevision`),
  }
}

const parseConfiguration = (value: unknown, path: string): EquipmentOperationConfigurationChoiceV1 | null => {
  if (value === null) return null
  const input = record(value, path)
  exact(input, ['schemaVersion', 'configurationId', 'values'], path)
  if (input.schemaVersion !== EQUIPMENT_CONFIGURATION_SCHEMA_VERSION) fail(`${path}.schemaVersion`, 'is unsupported.')
  const configurationId = text(input.configurationId, `${path}.configurationId`)
  if (!CONFIGURATION_ID.test(configurationId)) fail(`${path}.configurationId`, 'must be a lowercase stable identity.')
  return { schemaVersion: EQUIPMENT_CONFIGURATION_SCHEMA_VERSION, configurationId, values: record(input.values, `${path}.values`) as StrictJsonObject }
}
const parseGuidance = (value: unknown, path: string): EquipmentGuidedAdjudicationV1 => {
  const input = record(value, path)
  exact(input, ['kind', 'note'], path)
  if (input.kind !== 'guided-adjudication') fail(`${path}.kind`, 'must be guided-adjudication.')
  return { kind: 'guided-adjudication', note: text(input.note, `${path}.note`) }
}

export const parseEquipmentOperationCommand = (value: unknown): EquipmentOperationCommandV1 => {
  const input = record(clone(value), 'equipmentOperation')
  if (input.schemaVersion !== EQUIPMENT_OPERATION_SCHEMA_VERSION) fail('equipmentOperation.schemaVersion', 'is unsupported.')
  const operationId = text(input.operationId, 'equipmentOperation.operationId')
  if (!OPERATION_ID.test(operationId)) fail('equipmentOperation.operationId', 'must be a versioned equipment operation identity.')
  const rawCommandKind = input.commandKind
  if (typeof rawCommandKind !== 'string' || !KINDS.has(rawCommandKind)) fail('equipmentOperation.commandKind', 'is unsupported.')
  const commandKindValue = rawCommandKind as string
  const actorProfileId = input.actorProfileId === null
    ? null
    : text(input.actorProfileId, 'equipmentOperation.actorProfileId')

  if (ACTIVITY_KINDS.has(commandKindValue)) {
    exact(input, [
      'schemaVersion', 'operationId', 'commandKind', 'actorProfileId',
      'source', 'reason', 'guidance',
    ], 'equipmentOperation')
    const commandKind = commandKindValue as EquipmentActivityOperationKind
    const source = parseEquippedSource(record(input.source, 'equipmentOperation.source'), 'equipmentOperation.source')
    const reasonInput = record(input.reason, 'equipmentOperation.reason')
    exact(reasonInput, ['code', 'sourceId'], 'equipmentOperation.reason')
    const code = text(reasonInput.code, 'equipmentOperation.reason.code')
    if (!ACTIVITY_REASON_CODE.test(code)) fail('equipmentOperation.reason.code', 'must be a stable lowercase reason identity.')
    const sourceId = reasonInput.sourceId === null
      ? null
      : text(reasonInput.sourceId, 'equipmentOperation.reason.sourceId')
    if (sourceId !== null && !IDENTIFIER.test(sourceId)) {
      fail('equipmentOperation.reason.sourceId', 'must be a stable bounded identity.')
    }
    const guidance = parseGuidance(input.guidance, 'equipmentOperation.guidance')
    const allowedPrefix = commandKind === 'break' || commandKind === 'repair'
      ? 'equipment.breakage.'
      : commandKind === 'deactivate'
        ? 'equipment.inactive.'
        : commandKind === 'suppress'
          ? 'equipment.suppression.'
          : null
    if (allowedPrefix ? !code.startsWith(allowedPrefix)
      : !(code.startsWith('equipment.suppression.') || code.startsWith('equipment.inactive.'))) {
      fail('equipmentOperation.reason.code', `does not match ${commandKind} activity semantics.`)
    }
    if (code === 'equipment.breakage.durability') {
      fail('equipmentOperation.reason.code', 'is reserved for authoritative durability operations.')
    }
    return deepFreezeStrictJson({
      schemaVersion: EQUIPMENT_OPERATION_SCHEMA_VERSION,
      operationId,
      commandKind,
      actorProfileId,
      source,
      reason: { code, sourceId },
      guidance,
    })
  }

  if (DURABILITY_KINDS.has(commandKindValue)) {
    exact(input, [
      'schemaVersion', 'operationId', 'commandKind', 'actorProfileId',
      'source', 'amount', 'guidance',
    ], 'equipmentOperation')
    if (typeof input.amount !== 'number' || !Number.isSafeInteger(input.amount) || input.amount <= 0) {
      fail('equipmentOperation.amount', 'must be a positive safe integer.')
    }
    const amount = input.amount as number
    return deepFreezeStrictJson({
      schemaVersion: EQUIPMENT_OPERATION_SCHEMA_VERSION,
      operationId,
      commandKind: commandKindValue as EquipmentDurabilityOperationKind,
      actorProfileId,
      source: parseEquippedSource(record(input.source, 'equipmentOperation.source'), 'equipmentOperation.source'),
      amount,
      guidance: parseGuidance(input.guidance, 'equipmentOperation.guidance'),
    })
  }

  if (!CUSTODY_KINDS.has(commandKindValue)) fail('equipmentOperation.commandKind', 'is unsupported.')
  exact(input, [
    'schemaVersion', 'operationId', 'commandKind', 'actorProfileId', 'source',
    'destination', 'replacedInstanceId', 'swapReturnDestination', 'configuration',
  ], 'equipmentOperation')
  const commandKind = commandKindValue as EquipmentCustodyOperationKind
  const sourceInput = record(input.source, 'equipmentOperation.source')
  const source = sourceInput.kind === 'inventory'
    ? parseInventorySource(sourceInput, 'equipmentOperation.source')
    : parseEquippedSource(sourceInput, 'equipmentOperation.source')
  const destinationInput = record(input.destination, 'equipmentOperation.destination')
  const destination = destinationInput.kind === 'inventory'
    ? parseInventoryDestination(destinationInput, 'equipmentOperation.destination')
    : parseEquippedDestination(destinationInput, 'equipmentOperation.destination')
  const replacedInstanceId = input.replacedInstanceId === null ? null : instanceId(input.replacedInstanceId, 'equipmentOperation.replacedInstanceId')
  const swapReturnDestination = input.swapReturnDestination === null
    ? null
    : parseInventoryDestination(record(input.swapReturnDestination, 'equipmentOperation.swapReturnDestination'), 'equipmentOperation.swapReturnDestination')
  const configuration = parseConfiguration(input.configuration, 'equipmentOperation.configuration')

  const inventoryToEquipment = source.kind === 'inventory' && destination.kind === 'equipment'
  const equipmentToInventory = source.kind === 'equipment' && destination.kind === 'inventory'
  if ((commandKind === 'equip' || commandKind === 'give') && (!inventoryToEquipment || replacedInstanceId || swapReturnDestination)) {
    fail('equipmentOperation', `${commandKind} must move inventory into empty equipment without a swap destination.`)
  }
  if ((commandKind === 'unequip' || commandKind === 'take') && (!equipmentToInventory || replacedInstanceId || swapReturnDestination || configuration)) {
    fail('equipmentOperation', `${commandKind} must move one equipped instance into inventory without configuration.`)
  }
  if (commandKind === 'swap' && (!inventoryToEquipment || !replacedInstanceId || !swapReturnDestination)) {
    fail('equipmentOperation', 'swap must bind incoming inventory, one displaced instance, and its return inventory.')
  }
  if (commandKind === 'equip' && (destination.kind !== 'equipment' || destination.ownerKind !== 'trainer')) {
    fail('equipmentOperation.destination.ownerKind', 'equip must target Trainer equipment slots.')
  }
  if (commandKind === 'unequip' && (source.kind !== 'equipment' || source.ownerKind !== 'trainer')) {
    fail('equipmentOperation.source.ownerKind', 'unequip must source Trainer equipment slots.')
  }
  if (commandKind === 'give' && (destination.kind !== 'equipment' || destination.ownerKind !== 'pokemon')) {
    fail('equipmentOperation.destination.ownerKind', 'give must target a Pokémon held-item document.')
  }
  if (commandKind === 'take' && (source.kind !== 'equipment' || source.ownerKind !== 'pokemon')) {
    fail('equipmentOperation.source.ownerKind', 'take must source a Pokémon held-item document.')
  }
  return deepFreezeStrictJson({
    schemaVersion: EQUIPMENT_OPERATION_SCHEMA_VERSION,
    operationId, commandKind, actorProfileId, source, destination,
    replacedInstanceId, swapReturnDestination, configuration,
  })
}
