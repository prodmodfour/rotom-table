import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject, type StrictJsonObject } from '../automation/strictJson'
import { SLUG_RE } from '../paths'
import { itemInventoryInstanceId, parseItemInventoryInstanceId, type ItemInventorySection } from './inventory'

export const EQUIPMENT_STATE_SCHEMA_VERSION = 1 as const
export const EQUIPMENT_CONFIGURATION_SCHEMA_VERSION = 1 as const

export const TRAINER_EQUIPMENT_SLOT_IDS = [
  'mainHand', 'offHand', 'head', 'body', 'feet', 'accessory',
] as const
export const POKEMON_EQUIPMENT_SLOT_IDS = ['held', 'held-secondary'] as const
export const EQUIPMENT_SLOT_IDS = [
  ...TRAINER_EQUIPMENT_SLOT_IDS,
  ...POKEMON_EQUIPMENT_SLOT_IDS,
] as const

export type EquipmentOwnerKind = 'trainer' | 'pokemon'
export type TrainerEquipmentSlotId = (typeof TRAINER_EQUIPMENT_SLOT_IDS)[number]
export type PokemonEquipmentSlotId = (typeof POKEMON_EQUIPMENT_SLOT_IDS)[number]
export type EquipmentSlotId = (typeof EQUIPMENT_SLOT_IDS)[number]
export type EquipmentActivityStatus = 'active' | 'inactive' | 'suppressed' | 'broken'
export type EquipmentLegacyIssueReason =
  | 'missing-source'
  | 'ambiguous-source'
  | 'unknown-item'
  | 'unsupported-item'
  | 'invalid-assignment'

export interface EquipmentInventoryProvenanceV1 {
  readonly kind: 'inventory'
  readonly containerKind: 'trainer' | 'group'
  readonly containerSlug: string
  readonly section: ItemInventorySection
  readonly rowId: string
  readonly sourceInstanceId: string
  /** Exact inventory revision read before the whole item left its source row. */
  readonly sourceRevision: number
  readonly quantity: 1
}

export interface EquipmentItemConfigurationV1 {
  readonly schemaVersion: typeof EQUIPMENT_CONFIGURATION_SCHEMA_VERSION
  readonly configurationId: string
  readonly definitionSha256: string
  readonly values: StrictJsonObject
}

export interface EquipmentActivityReasonV1 {
  readonly code: string
  readonly sourceId: string | null
}

export interface EquipmentActivityV1 {
  readonly status: EquipmentActivityStatus
  /** Empty exactly while active; otherwise names every durable inactive source. */
  readonly reasons: readonly EquipmentActivityReasonV1[]
}

export interface SerializedEquipmentInventoryStateV1 {
  readonly schemaVersion: typeof EQUIPMENT_STATE_SCHEMA_VERSION
  /** Stable whole-item identity retained while the item moves between inventory and equipment. */
  readonly instanceId: string
  /** Monotonic whole-item revision incremented on every custody transition or item-state change. */
  readonly revision: number
  readonly canonicalItemId: string
  readonly canonicalRecordSha256: string
  readonly equipmentDefinitionSha256: string | null
  readonly configuration: EquipmentItemConfigurationV1 | null
  /** Durable activity survives every custody transition; suppression/breakage never vanishes on unequip. */
  readonly activity: EquipmentActivityV1
  /** Bounded item-specific state such as future charges or durability; never inferred from display text. */
  readonly state: StrictJsonObject
}

export interface EquippedItemInstanceV1 {
  /** Stable serialized whole-item identity, including while this item is in inventory. */
  readonly instanceId: string
  /** Revision of serialized state for this whole equipped item. */
  readonly revision: number
  readonly canonicalItemId: string
  readonly canonicalRecordSha256: string
  /** Null only while an inactive migration instance awaits reviewed compatibility semantics. */
  readonly equipmentDefinitionSha256: string | null
  readonly source: EquipmentInventoryProvenanceV1
  readonly configuration: EquipmentItemConfigurationV1 | null
  readonly serializedState: StrictJsonObject
  readonly activity: EquipmentActivityV1
  readonly equippedByOperationId: string
  readonly equippedAt: number
}

export interface EquipmentSlotAssignmentV1 {
  readonly slotId: EquipmentSlotId
  /** One whole item may occupy multiple slots; empty slots are explicit nulls. */
  readonly instanceId: string | null
}

/**
 * Legacy descriptive values are preserved as unresolved evidence only. They
 * are never an equipped instance and therefore cannot contribute mechanics.
 */
export interface EquipmentUnresolvedLegacyEntryV1 {
  readonly issueId: string
  readonly slotId: EquipmentSlotId
  readonly legacyDisplayName: string
  readonly reason: EquipmentLegacyIssueReason
  readonly candidateCanonicalItemIds: readonly string[]
  readonly candidateSourceInstanceIds: readonly string[]
}

/** Embedded in the owning sheet; the sheet revision remains the CAS authority. */
export interface SheetEquipmentStateV1 {
  readonly schemaVersion: typeof EQUIPMENT_STATE_SCHEMA_VERSION
  /** Monotonic semantic revision incremented only by equipment-state operations. */
  readonly revision: number
  readonly owner: {
    readonly kind: EquipmentOwnerKind
    readonly slug: string
  }
  readonly slots: readonly EquipmentSlotAssignmentV1[]
  readonly instances: readonly EquippedItemInstanceV1[]
  readonly unresolved: readonly EquipmentUnresolvedLegacyEntryV1[]
}

/**
 * Safe sheet projection: inventory provenance, serialized identities, hashes,
 * operation IDs, and configuration values stay server-side. `instanceId` is a
 * projection-local ordinal reference used only to join projected slots to rows.
 */
export interface SheetEquipmentProjectionV1 {
  readonly schemaVersion: typeof EQUIPMENT_STATE_SCHEMA_VERSION
  readonly revision: number
  readonly owner: {
    readonly kind: EquipmentOwnerKind
    readonly slug: string
  }
  readonly slots: readonly EquipmentSlotAssignmentV1[]
  readonly instances: readonly {
    readonly instanceId: string
    readonly revision: number
    readonly canonicalItemId: string
    readonly activity: {
      readonly status: EquipmentActivityStatus
      readonly reasonCodes: readonly string[]
    }
    readonly configurationId: string | null
  }[]
  readonly unresolvedCount: number
}

export type EquipmentStateValidationCode =
  | 'invalid-document'
  | 'unsupported-schema-version'
  | 'not-json'
  | 'limit-exceeded'
  | 'duplicate-id'
  | 'identity-conflict'

export class EquipmentStateValidationError extends Error {
  readonly code: EquipmentStateValidationCode
  readonly path: string

  constructor(code: EquipmentStateValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'EquipmentStateValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const LIMITS = Object.freeze({
  depth: 12,
  nodes: 4_096,
  objectFields: 32,
  arrayEntries: 64,
  stringLength: 500,
  identifierLength: 200,
  instances: TRAINER_EQUIPMENT_SLOT_IDS.length,
  unresolved: 32,
  activityReasons: 16,
  candidates: 32,
})
const DOCUMENT_FIELDS = ['schemaVersion', 'revision', 'owner', 'slots', 'instances', 'unresolved'] as const
const OWNER_FIELDS = ['kind', 'slug'] as const
const SLOT_FIELDS = ['slotId', 'instanceId'] as const
const INSTANCE_FIELDS = [
  'instanceId', 'revision', 'canonicalItemId', 'canonicalRecordSha256',
  'equipmentDefinitionSha256', 'source', 'configuration', 'serializedState', 'activity',
  'equippedByOperationId', 'equippedAt',
] as const
const LEGACY_INSTANCE_FIELDS = INSTANCE_FIELDS.filter(field => field !== 'serializedState')
const SERIALIZED_INVENTORY_FIELDS = [
  'schemaVersion', 'instanceId', 'revision', 'canonicalItemId', 'canonicalRecordSha256',
  'equipmentDefinitionSha256', 'configuration', 'activity', 'state',
] as const
const LEGACY_SERIALIZED_INVENTORY_FIELDS = SERIALIZED_INVENTORY_FIELDS
  .filter(field => field !== 'activity')
const SOURCE_FIELDS = [
  'kind', 'containerKind', 'containerSlug', 'section', 'rowId',
  'sourceInstanceId', 'sourceRevision', 'quantity',
] as const
const CONFIGURATION_FIELDS = ['schemaVersion', 'configurationId', 'definitionSha256', 'values'] as const
const ACTIVITY_FIELDS = ['status', 'reasons'] as const
const ACTIVITY_REASON_FIELDS = ['code', 'sourceId'] as const
const UNRESOLVED_FIELDS = [
  'issueId', 'slotId', 'legacyDisplayName', 'reason',
  'candidateCanonicalItemIds', 'candidateSourceInstanceIds',
] as const
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const EQUIPPED_INSTANCE_ID_PATTERN = /^equipped-item:v1:[a-f0-9]{32}$/
const ISSUE_ID_PATTERN = /^equipment-issue:v1:[a-f0-9]{32}$/
const STABLE_CODE_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{7,199}$/
const OWNER_KINDS = new Set<string>(['trainer', 'pokemon'])
const CONTAINER_KINDS = new Set<string>(['trainer', 'group'])
const ACTIVITY_STATUSES = new Set<string>(['active', 'inactive', 'suppressed', 'broken'])
const LEGACY_REASONS = new Set<string>([
  'missing-source', 'ambiguous-source', 'unknown-item', 'unsupported-item', 'invalid-assignment',
])
const INVENTORY_SECTIONS = new Set<string>([
  'keyItems', 'pokemonItems', 'medicalKit', 'pokeBalls', 'foodStuff', 'equipment',
])

const fail = (code: EquipmentStateValidationCode, path: string, detail: string): never => {
  throw new EquipmentStateValidationError(code, path, detail)
}

const clone = (value: unknown): unknown => cloneStrictJson(value, 'equipmentState', {
  limits: {
    depth: LIMITS.depth,
    nodes: LIMITS.nodes,
    objectFields: LIMITS.objectFields,
    arrayEntries: LIMITS.arrayEntries,
    stringLength: LIMITS.stringLength,
    objectKeyLength: LIMITS.identifierLength,
  },
  rootLabel: 'equipment state data',
  valueLabel: 'equipment state documents',
  failNotJson: (path, detail) => fail('not-json', path, detail),
  failLimit: (path, detail) => fail('limit-exceeded', path, detail),
})

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-document', path, 'must be a plain object.')
  return value as UnknownRecord
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const allowed = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !allowed.has(field))
  if (missing.length || unknown.length) {
    fail('invalid-document', path, `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`)
  }
}

const array = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value)) fail('invalid-document', path, 'must be an array.')
  if ((value as readonly unknown[]).length > maximum) fail('limit-exceeded', path, `must contain at most ${maximum} entries.`)
  return value as readonly unknown[]
}

const text = (value: unknown, path: string, maximum: number = LIMITS.stringLength): string => {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || CONTROL_CHARACTER_PATTERN.test(value)) {
    fail('invalid-document', path, 'must be non-empty trimmed text without control characters.')
  }
  if ((value as string).length > maximum) fail('limit-exceeded', path, `must contain at most ${maximum} characters.`)
  return value as string
}

const nullableText = (value: unknown, path: string): string | null => value === null ? null : text(value, path, LIMITS.identifierLength)

const integer = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail('invalid-document', path, 'must be a safe non-negative integer.')
  return Number(value)
}

const sha256 = (value: unknown, path: string): string => {
  const digest = text(value, path, 64)
  if (!SHA256_PATTERN.test(digest)) fail('invalid-document', path, 'must be a lowercase SHA-256 digest.')
  return digest
}

const enumValue = <Value extends string>(value: unknown, allowed: ReadonlySet<string>, path: string): Value => {
  if (typeof value !== 'string' || !allowed.has(value)) fail('invalid-document', path, 'contains an unsupported value.')
  return value as Value
}

const unique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) fail('duplicate-id', path, 'must contain unique identities.')
}

const expectedSlots = (ownerKind: EquipmentOwnerKind): readonly EquipmentSlotId[] => ownerKind === 'trainer'
  ? TRAINER_EQUIPMENT_SLOT_IDS
  : POKEMON_EQUIPMENT_SLOT_IDS

const parseSource = (value: unknown, path: string): EquipmentInventoryProvenanceV1 => {
  const input = record(value, path)
  exact(input, SOURCE_FIELDS, path)
  if (input.kind !== 'inventory') fail('invalid-document', `${path}.kind`, 'must be inventory.')
  const containerKind = enumValue<'trainer' | 'group'>(input.containerKind, CONTAINER_KINDS, `${path}.containerKind`)
  const containerSlug = text(input.containerSlug, `${path}.containerSlug`, LIMITS.identifierLength)
  if (!SLUG_RE.test(containerSlug)) fail('invalid-document', `${path}.containerSlug`, 'must be a valid inventory slug.')
  const section = enumValue<ItemInventorySection>(input.section, INVENTORY_SECTIONS, `${path}.section`)
  const rowId = text(input.rowId, `${path}.rowId`, LIMITS.identifierLength)
  const sourceInstanceId = text(input.sourceInstanceId, `${path}.sourceInstanceId`, LIMITS.identifierLength)
  const parsedSource = parseItemInventoryInstanceId(sourceInstanceId)
  let expectedSourceInstanceId: string | null = null
  try {
    expectedSourceInstanceId = itemInventoryInstanceId({
      containerKind, containerSlug, section, rowId,
    })
  }
  catch { expectedSourceInstanceId = null }
  if (!parsedSource || sourceInstanceId !== expectedSourceInstanceId) {
    fail('identity-conflict', `${path}.sourceInstanceId`, 'must match the exact inventory container and row identity.')
  }
  if (input.quantity !== 1) fail('invalid-document', `${path}.quantity`, 'equipped items must move as one whole item.')
  return {
    kind: 'inventory', containerKind, containerSlug, section, rowId, sourceInstanceId,
    sourceRevision: integer(input.sourceRevision, `${path}.sourceRevision`), quantity: 1,
  }
}

export const parseEquipmentInventoryProvenance = (
  value: unknown,
  path = 'equipmentSource',
): EquipmentInventoryProvenanceV1 => deepFreezeStrictJson(parseSource(value, path))

const parseConfiguration = (value: unknown, path: string): EquipmentItemConfigurationV1 | null => {
  if (value === null) return null
  const input = record(value, path)
  exact(input, CONFIGURATION_FIELDS, path)
  if (input.schemaVersion !== EQUIPMENT_CONFIGURATION_SCHEMA_VERSION) {
    fail('unsupported-schema-version', `${path}.schemaVersion`, `must be ${EQUIPMENT_CONFIGURATION_SCHEMA_VERSION}.`)
  }
  const configurationId = text(input.configurationId, `${path}.configurationId`, LIMITS.identifierLength)
  if (!STABLE_CODE_PATTERN.test(configurationId)) fail('invalid-document', `${path}.configurationId`, 'must be a lowercase stable identity.')
  return {
    schemaVersion: EQUIPMENT_CONFIGURATION_SCHEMA_VERSION,
    configurationId,
    definitionSha256: sha256(input.definitionSha256, `${path}.definitionSha256`),
    values: record(input.values, `${path}.values`) as StrictJsonObject,
  }
}

export const parseSerializedEquipmentInventoryState = (
  value: unknown,
): SerializedEquipmentInventoryStateV1 => {
  const input = record(clone(value), 'serializedEquipment')
  exact(input, Object.hasOwn(input, 'activity')
    ? SERIALIZED_INVENTORY_FIELDS
    : LEGACY_SERIALIZED_INVENTORY_FIELDS, 'serializedEquipment')
  if (input.schemaVersion !== EQUIPMENT_STATE_SCHEMA_VERSION) {
    fail('unsupported-schema-version', 'serializedEquipment.schemaVersion', `must be ${EQUIPMENT_STATE_SCHEMA_VERSION}.`)
  }
  const instanceId = text(input.instanceId, 'serializedEquipment.instanceId', LIMITS.identifierLength)
  if (!EQUIPPED_INSTANCE_ID_PATTERN.test(instanceId)) {
    fail('invalid-document', 'serializedEquipment.instanceId', 'must be a versioned whole-item identity.')
  }
  const equipmentDefinitionSha256 = input.equipmentDefinitionSha256 === null
    ? null
    : sha256(input.equipmentDefinitionSha256, 'serializedEquipment.equipmentDefinitionSha256')
  const configuration = parseConfiguration(input.configuration, 'serializedEquipment.configuration')
  if (equipmentDefinitionSha256 === null && configuration !== null) {
    fail('invalid-document', 'serializedEquipment', 'configuration requires a reviewed equipment definition.')
  }
  return deepFreezeStrictJson({
    schemaVersion: EQUIPMENT_STATE_SCHEMA_VERSION,
    instanceId,
    revision: integer(input.revision, 'serializedEquipment.revision'),
    canonicalItemId: text(input.canonicalItemId, 'serializedEquipment.canonicalItemId', LIMITS.identifierLength),
    canonicalRecordSha256: sha256(input.canonicalRecordSha256, 'serializedEquipment.canonicalRecordSha256'),
    equipmentDefinitionSha256,
    configuration,
    activity: Object.hasOwn(input, 'activity')
      ? parseActivity(input.activity, 'serializedEquipment.activity')
      : { status: 'active', reasons: [] },
    state: record(input.state, 'serializedEquipment.state') as StrictJsonObject,
  })
}

export const serializedEquipmentInventoryStateFromInstance = (
  instance: EquippedItemInstanceV1,
  revision: number = instance.revision,
): SerializedEquipmentInventoryStateV1 => parseSerializedEquipmentInventoryState({
  schemaVersion: EQUIPMENT_STATE_SCHEMA_VERSION,
  instanceId: instance.instanceId,
  revision,
  canonicalItemId: instance.canonicalItemId,
  canonicalRecordSha256: instance.canonicalRecordSha256,
  equipmentDefinitionSha256: instance.equipmentDefinitionSha256,
  configuration: instance.configuration,
  activity: instance.activity,
  state: instance.serializedState,
})

const parseActivity = (value: unknown, path: string): EquipmentActivityV1 => {
  const input = record(value, path)
  exact(input, ACTIVITY_FIELDS, path)
  const status = enumValue<EquipmentActivityStatus>(input.status, ACTIVITY_STATUSES, `${path}.status`)
  const reasons = array(input.reasons, `${path}.reasons`, LIMITS.activityReasons).map((value, index): EquipmentActivityReasonV1 => {
    const reasonPath = `${path}.reasons[${index}]`
    const reason = record(value, reasonPath)
    exact(reason, ACTIVITY_REASON_FIELDS, reasonPath)
    const code = text(reason.code, `${reasonPath}.code`, LIMITS.identifierLength)
    if (!STABLE_CODE_PATTERN.test(code)) fail('invalid-document', `${reasonPath}.code`, 'must be a lowercase stable reason code.')
    return { code, sourceId: nullableText(reason.sourceId, `${reasonPath}.sourceId`) }
  })
  unique(reasons.map(reason => `${reason.code}:${reason.sourceId ?? ''}`), `${path}.reasons`)
  if ((status === 'active') !== (reasons.length === 0)) {
    fail('invalid-document', path, 'active state requires no reasons and every inactive state requires at least one reason.')
  }
  return { status, reasons }
}

const parseInstance = (value: unknown, path: string): EquippedItemInstanceV1 => {
  const input = record(value, path)
  exact(input, Object.hasOwn(input, 'serializedState') ? INSTANCE_FIELDS : LEGACY_INSTANCE_FIELDS, path)
  const instanceId = text(input.instanceId, `${path}.instanceId`, LIMITS.identifierLength)
  if (!EQUIPPED_INSTANCE_ID_PATTERN.test(instanceId)) fail('invalid-document', `${path}.instanceId`, 'must be a versioned equipped-item identity.')
  const equippedByOperationId = text(input.equippedByOperationId, `${path}.equippedByOperationId`, LIMITS.identifierLength)
  if (!OPERATION_ID_PATTERN.test(equippedByOperationId)) fail('invalid-document', `${path}.equippedByOperationId`, 'must be a bounded operation identity.')
  const equipmentDefinitionSha256 = input.equipmentDefinitionSha256 === null
    ? null
    : sha256(input.equipmentDefinitionSha256, `${path}.equipmentDefinitionSha256`)
  const activity = parseActivity(input.activity, `${path}.activity`)
  if (equipmentDefinitionSha256 === null
    && (activity.status !== 'inactive' || !activity.reasons.some(reason => reason.code === 'equipment.definition-pending'))) {
    fail('invalid-document', path, 'missing equipment definitions require inactive migration state and the equipment.definition-pending reason.')
  }
  return {
    instanceId,
    revision: integer(input.revision, `${path}.revision`),
    canonicalItemId: text(input.canonicalItemId, `${path}.canonicalItemId`, LIMITS.identifierLength),
    canonicalRecordSha256: sha256(input.canonicalRecordSha256, `${path}.canonicalRecordSha256`),
    equipmentDefinitionSha256,
    source: parseSource(input.source, `${path}.source`),
    configuration: parseConfiguration(input.configuration, `${path}.configuration`),
    serializedState: Object.hasOwn(input, 'serializedState')
      ? record(input.serializedState, `${path}.serializedState`) as StrictJsonObject
      : {},
    activity,
    equippedByOperationId,
    equippedAt: integer(input.equippedAt, `${path}.equippedAt`),
  }
}

const parseUnresolved = (value: unknown, path: string): EquipmentUnresolvedLegacyEntryV1 => {
  const input = record(value, path)
  exact(input, UNRESOLVED_FIELDS, path)
  const issueId = text(input.issueId, `${path}.issueId`, LIMITS.identifierLength)
  if (!ISSUE_ID_PATTERN.test(issueId)) fail('invalid-document', `${path}.issueId`, 'must be a versioned equipment issue identity.')
  const candidateCanonicalItemIds = array(
    input.candidateCanonicalItemIds, `${path}.candidateCanonicalItemIds`, LIMITS.candidates,
  ).map((value, index) => text(value, `${path}.candidateCanonicalItemIds[${index}]`, LIMITS.identifierLength))
  const candidateSourceInstanceIds = array(
    input.candidateSourceInstanceIds, `${path}.candidateSourceInstanceIds`, LIMITS.candidates,
  ).map((value, index) => {
    const sourceId = text(value, `${path}.candidateSourceInstanceIds[${index}]`, LIMITS.identifierLength)
    if (!parseItemInventoryInstanceId(sourceId)) fail('invalid-document', `${path}.candidateSourceInstanceIds[${index}]`, 'must be an inventory source identity.')
    return sourceId
  })
  unique(candidateCanonicalItemIds, `${path}.candidateCanonicalItemIds`)
  unique(candidateSourceInstanceIds, `${path}.candidateSourceInstanceIds`)
  return {
    issueId,
    slotId: enumValue<EquipmentSlotId>(input.slotId, new Set(EQUIPMENT_SLOT_IDS), `${path}.slotId`),
    legacyDisplayName: text(input.legacyDisplayName, `${path}.legacyDisplayName`),
    reason: enumValue<EquipmentLegacyIssueReason>(input.reason, LEGACY_REASONS, `${path}.reason`),
    candidateCanonicalItemIds,
    candidateSourceInstanceIds,
  }
}

export const parseSheetEquipmentState = (value: unknown): SheetEquipmentStateV1 => {
  const root = record(clone(value), 'equipmentState')
  exact(root, DOCUMENT_FIELDS, 'equipmentState')
  if (root.schemaVersion !== EQUIPMENT_STATE_SCHEMA_VERSION) {
    fail('unsupported-schema-version', 'equipmentState.schemaVersion', `must be ${EQUIPMENT_STATE_SCHEMA_VERSION}.`)
  }
  const owner = record(root.owner, 'equipmentState.owner')
  exact(owner, OWNER_FIELDS, 'equipmentState.owner')
  const ownerKind = enumValue<EquipmentOwnerKind>(owner.kind, OWNER_KINDS, 'equipmentState.owner.kind')
  const ownerSlug = text(owner.slug, 'equipmentState.owner.slug', LIMITS.identifierLength)
  if (!SLUG_RE.test(ownerSlug)) fail('invalid-document', 'equipmentState.owner.slug', 'must be a valid sheet slug.')
  const requiredSlots = expectedSlots(ownerKind)
  const slotSet = new Set<string>(requiredSlots)
  const parsedSlots = array(root.slots, 'equipmentState.slots', EQUIPMENT_SLOT_IDS.length)
    .map((value, index): EquipmentSlotAssignmentV1 => {
      const path = `equipmentState.slots[${index}]`
      const input = record(value, path)
      exact(input, SLOT_FIELDS, path)
      const slotId = enumValue<EquipmentSlotId>(input.slotId, slotSet, `${path}.slotId`)
      const instanceId = input.instanceId === null ? null : text(input.instanceId, `${path}.instanceId`, LIMITS.identifierLength)
      if (instanceId !== null && !EQUIPPED_INSTANCE_ID_PATTERN.test(instanceId)) {
        fail('invalid-document', `${path}.instanceId`, 'must be a versioned equipped-item identity.')
      }
      return { slotId, instanceId }
    })
  const slots: EquipmentSlotAssignmentV1[] = ownerKind === 'pokemon'
    && parsedSlots.length === 1
    && parsedSlots[0]?.slotId === 'held'
    ? [...parsedSlots, { slotId: 'held-secondary', instanceId: null }]
    : parsedSlots
  unique(slots.map(slot => slot.slotId), 'equipmentState.slots.slotId')
  if (slots.length !== requiredSlots.length
    || slots.some((slot, index) => slot.slotId !== requiredSlots[index])) {
    fail('invalid-document', 'equipmentState.slots', `must contain every ${ownerKind} slot exactly once in canonical order.`)
  }
  const instances = array(root.instances, 'equipmentState.instances', LIMITS.instances)
    .map((value, index) => parseInstance(value, `equipmentState.instances[${index}]`))
  unique(instances.map(instance => instance.instanceId), 'equipmentState.instances.instanceId')
  const instanceIds = new Set(instances.map(instance => instance.instanceId))
  const assignedIds = new Set(slots.flatMap(slot => slot.instanceId ? [slot.instanceId] : []))
  if ([...assignedIds].some(instanceId => !instanceIds.has(instanceId))) {
    fail('identity-conflict', 'equipmentState.slots', 'references an equipped item instance absent from this document.')
  }
  if (instances.some(instance => !assignedIds.has(instance.instanceId))) {
    fail('identity-conflict', 'equipmentState.instances', 'contains an unassigned equipped item instance.')
  }
  const unresolved = array(root.unresolved, 'equipmentState.unresolved', LIMITS.unresolved)
    .map((value, index) => parseUnresolved(value, `equipmentState.unresolved[${index}]`))
  unique(unresolved.map(issue => issue.issueId), 'equipmentState.unresolved.issueId')
  unique(unresolved.map(issue => issue.slotId), 'equipmentState.unresolved.slotId')
  if (unresolved.some(issue => !slotSet.has(issue.slotId))) {
    fail('invalid-document', 'equipmentState.unresolved.slotId', `must belong to the ${ownerKind} owner.`)
  }
  if (unresolved.some(issue => slots.find(slot => slot.slotId === issue.slotId)?.instanceId !== null)) {
    fail('identity-conflict', 'equipmentState.unresolved', 'cannot claim a slot with an effective equipped instance.')
  }
  return deepFreezeStrictJson({
    schemaVersion: EQUIPMENT_STATE_SCHEMA_VERSION,
    revision: integer(root.revision, 'equipmentState.revision'),
    owner: { kind: ownerKind, slug: ownerSlug },
    slots,
    instances,
    unresolved,
  })
}

export const parseSheetEquipmentStateForOwner = (
  value: unknown,
  expectedOwner: { readonly kind: EquipmentOwnerKind; readonly slug: string },
): SheetEquipmentStateV1 => {
  const state = parseSheetEquipmentState(value)
  if (state.owner.kind !== expectedOwner.kind || state.owner.slug !== expectedOwner.slug) {
    fail(
      'identity-conflict',
      'equipmentState.owner',
      `must match owning sheet ${expectedOwner.kind}/${expectedOwner.slug}.`,
    )
  }
  return state
}

export const projectSheetEquipmentStateForPlayer = (
  value: unknown,
  expectedOwner?: { readonly kind: EquipmentOwnerKind; readonly slug: string },
): SheetEquipmentProjectionV1 => {
  const state = expectedOwner
    ? parseSheetEquipmentStateForOwner(value, expectedOwner)
    : parseSheetEquipmentState(value)
  const projectedIds = new Map(state.instances.map((instance, index) => [
    instance.instanceId,
    `equipment-projection:v1:${index}`,
  ]))
  return deepFreezeStrictJson({
    schemaVersion: EQUIPMENT_STATE_SCHEMA_VERSION,
    revision: state.revision,
    owner: state.owner,
    slots: state.slots.map(slot => ({
      slotId: slot.slotId,
      instanceId: slot.instanceId === null ? null : projectedIds.get(slot.instanceId) ?? null,
    })),
    instances: state.instances.map(instance => ({
      instanceId: projectedIds.get(instance.instanceId)!,
      revision: instance.revision,
      canonicalItemId: instance.canonicalItemId,
      activity: {
        status: instance.activity.status,
        reasonCodes: instance.activity.reasons.map(reason => reason.code),
      },
      configurationId: instance.configuration?.configurationId ?? null,
    })),
    unresolvedCount: state.unresolved.length,
  })
}

export const createEmptySheetEquipmentState = (input: {
  readonly ownerKind: EquipmentOwnerKind
  readonly ownerSlug: string
  readonly revision?: number
}): SheetEquipmentStateV1 => parseSheetEquipmentState({
  schemaVersion: EQUIPMENT_STATE_SCHEMA_VERSION,
  revision: input.revision ?? 0,
  owner: { kind: input.ownerKind, slug: input.ownerSlug },
  slots: expectedSlots(input.ownerKind).map(slotId => ({ slotId, instanceId: null })),
  instances: [],
  unresolved: [],
})
