import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject, type StrictJsonObject } from '../automation/strictJson'
import { isSheetKind, type SheetKind } from '../sheets'
import { ITEM_OPERATION_KINDS, ITEM_TARGET_KINDS, type ItemOperationKind, type ItemTargetKind } from './spec'
import { itemInventoryInstanceId, type ItemInventorySection } from './inventory'
import {
  ITEM_NON_ENCOUNTER_CONTEXTS,
  ItemNonEncounterContextValidationError,
  parseItemNonEncounterExecutionSnapshot,
  type ItemExecutableContextKind,
  type ItemNonEncounterExecutionSnapshotV1,
} from './nonEncounter'

export const ITEM_OPERATION_SCHEMA_VERSION = 1 as const
export const ITEM_OPERATION_LIMITS = Object.freeze({
  identifierLength: 200,
  aggregateRefs: 64,
  targets: 64,
  choices: 32,
  optionsPerChoice: 64,
  operations: 512,
  receiptFacts: 128,
  jsonDepth: 16,
  jsonNodes: 16_384,
  objectFields: 64,
  arrayEntries: 512,
  stringLength: 1_000,
})

export type ItemAggregateRef =
  | { readonly kind: 'map', readonly id: string, readonly revision: number }
  | { readonly kind: 'encounter', readonly id: string, readonly revision: number }
  | { readonly kind: 'sheet', readonly sheetKind: SheetKind, readonly id: string, readonly revision: number }
  | { readonly kind: 'group-inventory', readonly id: string, readonly revision: number }
  | { readonly kind: 'equipment', readonly id: string, readonly revision: number }
  | { readonly kind: 'campaign-clock', readonly id: 'campaign', readonly revision: number }

export interface ItemInventorySourceRef {
  readonly kind: 'trainer' | 'group'
  readonly slug: string
  readonly section: ItemInventorySection
  readonly rowId: string
  readonly expectedRevision: number
}

export interface ItemEquipmentDeliveryV1 {
  readonly kind: 'wonder-launcher'
  /** Opaque declaration binding; never the serialized whole-item identity. */
  readonly equipmentBindingId: string
}

export interface UseItemCommandV1 {
  readonly schemaVersion: typeof ITEM_OPERATION_SCHEMA_VERSION
  readonly operationId: string
  readonly context: ItemExecutableContextKind
  readonly offerId: string
  /** Server-projected source identity; canonical item identity is resolved from the authoritative row. */
  readonly sourceInstanceId: string
  readonly actorParticipantId: string | null
  readonly actorSheet: { readonly kind: SheetKind, readonly slug: string, readonly expectedRevision: number }
  readonly source: ItemInventorySourceRef
  readonly targetIds: readonly string[]
  readonly choices: readonly { readonly choiceId: string, readonly optionIds: readonly string[] }[]
  readonly readSet: readonly ItemAggregateRef[]
  /** Omitted for ordinary item use and present only for a server-authorized equipment delivery path. */
  readonly delivery?: ItemEquipmentDeliveryV1
}

export interface PlannedItemOperation {
  readonly operationId: string
  readonly ordinal: number
  readonly kind: ItemOperationKind
  readonly aggregate: ItemAggregateRef
  readonly subjectId: string
  readonly payload: StrictJsonObject
  readonly label: string
}

export interface ItemOperationPlanV1 {
  readonly schemaVersion: typeof ITEM_OPERATION_SCHEMA_VERSION
  readonly operationId: string
  readonly canonicalItemId: string
  readonly canonicalDefinitionSha256: string
  readonly readSet: readonly ItemAggregateRef[]
  readonly operations: readonly PlannedItemOperation[]
  readonly receiptFacts: readonly { readonly factId: string, readonly audience: 'public' | 'owner' | 'gm', readonly label: string }[]
  /** Present on newly planned non-encounter operations; omitted only by legacy persisted plans. */
  readonly nonEncounterContext?: ItemNonEncounterExecutionSnapshotV1
}

export interface ItemPendingChoiceOptionV1 {
  readonly optionId: string
  readonly label: string
}

export interface ItemPendingChoiceV1 {
  readonly choiceId: string
  readonly kind: ItemTargetKind | 'mode' | 'condition'
  readonly minimum: number
  readonly maximum: number
  readonly options: readonly ItemPendingChoiceOptionV1[]
  readonly privateTo: 'public' | 'actor-owner' | 'responder-owner' | 'gm'
}

export interface ItemPendingDecisionV1 {
  readonly schemaVersion: typeof ITEM_OPERATION_SCHEMA_VERSION
  readonly operationId: string
  readonly decisionId: string
  readonly canonicalItemId: string
  readonly sourceInstanceId: string
  readonly reservation: {
    readonly reservationId: string
    readonly quantity: number
  } | null
  readonly choices: readonly ItemPendingChoiceV1[]
}

export type ItemOperationResultV1 =
  | {
      readonly schemaVersion: typeof ITEM_OPERATION_SCHEMA_VERSION
      readonly operationId: string
      readonly status: 'accepted'
      readonly canonicalItemId: string
      readonly aggregateRefs: readonly ItemAggregateRef[]
      readonly receiptId: string
      readonly exactReplay: boolean
    }
  | {
      readonly schemaVersion: typeof ITEM_OPERATION_SCHEMA_VERSION
      readonly operationId: string
      readonly status: 'rejected'
      readonly canonicalItemId: string | null
      readonly reasonId: string
      readonly message: string
      readonly exactReplay: boolean
    }
  | {
      readonly schemaVersion: typeof ITEM_OPERATION_SCHEMA_VERSION
      readonly operationId: string
      readonly status: 'pending'
      readonly canonicalItemId: string
      readonly decisionId: string
      readonly reservationId: string | null
      readonly exactReplay: boolean
    }

export type ItemOperationValidationCode =
  | 'invalid-command'
  | 'invalid-plan'
  | 'invalid-result'
  | 'unsupported-schema-version'
  | 'not-json'
  | 'limit-exceeded'
  | 'duplicate-id'
  | 'incomplete-read-set'

export class ItemOperationValidationError extends Error {
  readonly code: ItemOperationValidationCode
  readonly path: string

  constructor(code: ItemOperationValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'ItemOperationValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const COMMAND_FIELDS = [
  'schemaVersion', 'operationId', 'context', 'offerId', 'sourceInstanceId',
  'actorParticipantId', 'actorSheet', 'source', 'targetIds', 'choices', 'readSet',
] as const
const COMMAND_FIELDS_WITH_DELIVERY = [...COMMAND_FIELDS, 'delivery'] as const
const ACTOR_SHEET_FIELDS = ['kind', 'slug', 'expectedRevision'] as const
const SOURCE_FIELDS = ['kind', 'slug', 'section', 'rowId', 'expectedRevision'] as const
const DELIVERY_FIELDS = ['kind', 'equipmentBindingId'] as const
const CHOICE_FIELDS = ['choiceId', 'optionIds'] as const
const PLAN_FIELDS = ['schemaVersion', 'operationId', 'canonicalItemId', 'canonicalDefinitionSha256', 'readSet', 'operations', 'receiptFacts'] as const
const PLAN_FIELDS_WITH_NON_ENCOUNTER_CONTEXT = [...PLAN_FIELDS, 'nonEncounterContext'] as const
const OPERATION_FIELDS = ['operationId', 'ordinal', 'kind', 'aggregate', 'subjectId', 'payload', 'label'] as const
const RECEIPT_FACT_FIELDS = ['factId', 'audience', 'label'] as const
const PENDING_DECISION_FIELDS = ['schemaVersion', 'operationId', 'decisionId', 'canonicalItemId', 'sourceInstanceId', 'reservation', 'choices'] as const
const PENDING_CHOICE_FIELDS = ['choiceId', 'kind', 'minimum', 'maximum', 'options', 'privateTo'] as const
const PENDING_OPTION_FIELDS = ['optionId', 'label'] as const
const RESERVATION_FIELDS = ['reservationId', 'quantity'] as const
const ACCEPTED_RESULT_FIELDS = ['schemaVersion', 'operationId', 'status', 'canonicalItemId', 'aggregateRefs', 'receiptId', 'exactReplay'] as const
const REJECTED_RESULT_FIELDS = ['schemaVersion', 'operationId', 'status', 'canonicalItemId', 'reasonId', 'message', 'exactReplay'] as const
const PENDING_RESULT_FIELDS = ['schemaVersion', 'operationId', 'status', 'canonicalItemId', 'decisionId', 'reservationId', 'exactReplay'] as const
const AGGREGATE_BASE_FIELDS = ['kind', 'id', 'revision'] as const
const AGGREGATE_SHEET_FIELDS = ['kind', 'sheetKind', 'id', 'revision'] as const
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{7,199}$/
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const CONTEXT_SET = new Set<string>(['encounter', ...ITEM_NON_ENCOUNTER_CONTEXTS])
const SOURCE_KIND_SET = new Set<string>(['trainer', 'group'])
const SECTION_SET = new Set<string>(['keyItems', 'pokemonItems', 'medicalKit', 'pokeBalls', 'foodStuff', 'equipment'])
const AGGREGATE_KIND_SET = new Set<string>(['map', 'encounter', 'sheet', 'group-inventory', 'equipment', 'campaign-clock'])
const OPERATION_KIND_SET = new Set<string>(ITEM_OPERATION_KINDS)
const AUDIENCE_SET = new Set<string>(['public', 'owner', 'gm'])
const PENDING_CHOICE_KIND_SET = new Set<string>([...ITEM_TARGET_KINDS, 'mode', 'condition'])
const PENDING_PRIVACY_SET = new Set<string>(['public', 'actor-owner', 'responder-owner', 'gm'])
const RESULT_STATUS_SET = new Set<string>(['accepted', 'rejected', 'pending'])

const fail = (code: ItemOperationValidationCode, path: string, detail: string): never => {
  throw new ItemOperationValidationError(code, path, detail)
}

const clone = (value: unknown, root: 'itemCommand' | 'itemPlan' | 'itemResult'): unknown => cloneStrictJson(value, root, {
  limits: {
    depth: ITEM_OPERATION_LIMITS.jsonDepth,
    nodes: ITEM_OPERATION_LIMITS.jsonNodes,
    objectFields: ITEM_OPERATION_LIMITS.objectFields,
    arrayEntries: ITEM_OPERATION_LIMITS.arrayEntries,
    stringLength: ITEM_OPERATION_LIMITS.stringLength,
    objectKeyLength: ITEM_OPERATION_LIMITS.identifierLength,
  },
  rootLabel: root === 'itemCommand' ? 'item command data' : root === 'itemPlan' ? 'item operation plan data' : 'item operation result data',
  valueLabel: root === 'itemCommand' ? 'item commands' : root === 'itemPlan' ? 'item operation plans' : 'item operation results',
  failNotJson: (path, detail) => fail('not-json', path, detail),
  failLimit: (path, detail) => fail('limit-exceeded', path, detail),
})

const record = (value: unknown, path: string, code: ItemOperationValidationCode): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail(code, path, 'must be a plain object.')
  return value as UnknownRecord
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string, code: ItemOperationValidationCode): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) fail(code, path, `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`)
}

const boundedText = (value: unknown, path: string, code: ItemOperationValidationCode): string => {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || CONTROL_CHARACTER_PATTERN.test(value)) {
    fail(code, path, 'must be a non-empty trimmed string without control characters.')
  }
  if ((value as string).length > ITEM_OPERATION_LIMITS.stringLength) fail('limit-exceeded', path, `must contain at most ${ITEM_OPERATION_LIMITS.stringLength} characters.`)
  return value as string
}

const stableId = (value: unknown, path: string, code: ItemOperationValidationCode): string => {
  const id = boundedText(value, path, code)
  if (id.length > ITEM_OPERATION_LIMITS.identifierLength || !STABLE_ID_PATTERN.test(id)) fail(code, path, 'must be a bounded lowercase stable identifier.')
  return id
}

const operationId = (value: unknown, path: string, code: ItemOperationValidationCode): string => {
  const id = boundedText(value, path, code)
  if (!OPERATION_ID_PATTERN.test(id)) fail(code, path, 'must be a bounded operation identifier with at least 8 characters.')
  return id
}

const revision = (value: unknown, path: string, code: ItemOperationValidationCode): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(code, path, 'must be a safe non-negative revision.')
  return Number(value)
}

const boundedInteger = (value: unknown, path: string, minimum: number, maximum: number, code: ItemOperationValidationCode): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(code, path, `must be a safe integer from ${minimum} through ${maximum}.`)
  return Number(value)
}

const enumValue = <Value extends string>(value: unknown, allowed: ReadonlySet<string>, path: string, code: ItemOperationValidationCode): Value => {
  if (typeof value !== 'string' || !allowed.has(value)) fail(code, path, 'contains an unsupported value.')
  return value as Value
}

const boundedArray = (value: unknown, path: string, maximum: number, code: ItemOperationValidationCode): readonly unknown[] => {
  if (!Array.isArray(value)) fail(code, path, 'must be an array.')
  if ((value as unknown[]).length > maximum) fail('limit-exceeded', path, `must contain at most ${maximum} entries.`)
  return value as readonly unknown[]
}

const unique = (values: readonly string[], path: string): void => {
  if (new Set(values).size !== values.length) fail('duplicate-id', path, 'must contain unique values.')
}

const parseAggregateRef = (value: unknown, path: string, code: ItemOperationValidationCode): ItemAggregateRef => {
  const input = record(value, path, code)
  const kind = enumValue<ItemAggregateRef['kind']>(input.kind, AGGREGATE_KIND_SET, `${path}.kind`, code)
  exact(input, kind === 'sheet' ? AGGREGATE_SHEET_FIELDS : AGGREGATE_BASE_FIELDS, path, code)
  const id = boundedText(input.id, `${path}.id`, code)
  const parsedRevision = revision(input.revision, `${path}.revision`, code)
  if (kind === 'campaign-clock') {
    if (id !== 'campaign') fail(code, `${path}.id`, 'campaign-clock identity must be campaign.')
    return { kind, id: 'campaign', revision: parsedRevision }
  }
  if (kind === 'sheet') {
    if (!isSheetKind(input.sheetKind)) fail(code, `${path}.sheetKind`, 'must be pokemon or trainer.')
    return { kind, sheetKind: input.sheetKind as SheetKind, id, revision: parsedRevision }
  }
  return { kind, id, revision: parsedRevision } as ItemAggregateRef
}

const aggregateKey = (value: ItemAggregateRef): string => value.kind === 'sheet'
  ? `${value.kind}:${value.sheetKind}:${value.id}`
  : `${value.kind}:${value.id}`

const parseReadSet = (value: unknown, path: string, code: ItemOperationValidationCode): readonly ItemAggregateRef[] => {
  const refs = boundedArray(value, path, ITEM_OPERATION_LIMITS.aggregateRefs, code)
    .map((entry, index) => parseAggregateRef(entry, `${path}[${index}]`, code))
  unique(refs.map(aggregateKey), path)
  return refs
}

const stringList = (value: unknown, path: string, maximum: number, code: ItemOperationValidationCode): readonly string[] => {
  const values = boundedArray(value, path, maximum, code).map((entry, index) => boundedText(entry, `${path}[${index}]`, code))
  unique(values, path)
  return values
}

export const parseUseItemCommand = (value: unknown): UseItemCommandV1 => {
  const code = 'invalid-command' as const
  const root = record(clone(value, 'itemCommand'), 'itemCommand', code)
  exact(root, Object.hasOwn(root, 'delivery') ? COMMAND_FIELDS_WITH_DELIVERY : COMMAND_FIELDS, 'itemCommand', code)
  if (root.schemaVersion !== ITEM_OPERATION_SCHEMA_VERSION) fail('unsupported-schema-version', 'itemCommand.schemaVersion', `must be ${ITEM_OPERATION_SCHEMA_VERSION}.`)
  const actorSheetInput = record(root.actorSheet, 'itemCommand.actorSheet', code)
  exact(actorSheetInput, ACTOR_SHEET_FIELDS, 'itemCommand.actorSheet', code)
  if (!isSheetKind(actorSheetInput.kind)) fail(code, 'itemCommand.actorSheet.kind', 'must be pokemon or trainer.')
  const sourceInput = record(root.source, 'itemCommand.source', code)
  exact(sourceInput, SOURCE_FIELDS, 'itemCommand.source', code)
  const choices = boundedArray(root.choices, 'itemCommand.choices', ITEM_OPERATION_LIMITS.choices, code).map((entry, index) => {
    const path = `itemCommand.choices[${index}]`
    const choice = record(entry, path, code)
    exact(choice, CHOICE_FIELDS, path, code)
    return {
      choiceId: stableId(choice.choiceId, `${path}.choiceId`, code),
      optionIds: stringList(choice.optionIds, `${path}.optionIds`, ITEM_OPERATION_LIMITS.optionsPerChoice, code),
    }
  })
  unique(choices.map(choice => choice.choiceId), 'itemCommand.choices.choiceId')
  const parsedSource: ItemInventorySourceRef = {
    kind: enumValue(sourceInput.kind, SOURCE_KIND_SET, 'itemCommand.source.kind', code),
    slug: boundedText(sourceInput.slug, 'itemCommand.source.slug', code),
    section: enumValue(sourceInput.section, SECTION_SET, 'itemCommand.source.section', code),
    rowId: boundedText(sourceInput.rowId, 'itemCommand.source.rowId', code),
    expectedRevision: revision(sourceInput.expectedRevision, 'itemCommand.source.expectedRevision', code),
  }
  const actorSheet: UseItemCommandV1['actorSheet'] = {
    kind: actorSheetInput.kind as SheetKind,
    slug: boundedText(actorSheetInput.slug, 'itemCommand.actorSheet.slug', code),
    expectedRevision: revision(actorSheetInput.expectedRevision, 'itemCommand.actorSheet.expectedRevision', code),
  }
  const readSet = parseReadSet(root.readSet, 'itemCommand.readSet', code)
  const sourceReadKey = parsedSource.kind === 'trainer'
    ? `sheet:trainer:${parsedSource.slug}`
    : `group-inventory:${parsedSource.slug}`
  const readKeys = new Set(readSet.map(aggregateKey))
  if (!readKeys.has(sourceReadKey) || !readKeys.has(`sheet:${actorSheet.kind}:${actorSheet.slug}`)) {
    fail('incomplete-read-set', 'itemCommand.readSet', 'must include the actor sheet and source inventory revisions.')
  }
  const expectedSourceInstanceId = itemInventoryInstanceId({
    containerKind: parsedSource.kind,
    containerSlug: parsedSource.slug,
    section: parsedSource.section,
    rowId: parsedSource.rowId,
  })
  let delivery: ItemEquipmentDeliveryV1 | undefined
  if (Object.hasOwn(root, 'delivery')) {
    const deliveryInput = record(root.delivery, 'itemCommand.delivery', code)
    exact(deliveryInput, DELIVERY_FIELDS, 'itemCommand.delivery', code)
    if (deliveryInput.kind !== 'wonder-launcher') fail(code, 'itemCommand.delivery.kind', 'is unsupported.')
    const equipmentBindingId = boundedText(deliveryInput.equipmentBindingId, 'itemCommand.delivery.equipmentBindingId', code)
    if (!/^equipment-delivery:v1:[a-f0-9]{32}$/.test(equipmentBindingId)) {
      fail(code, 'itemCommand.delivery.equipmentBindingId', 'must be an opaque equipment-delivery binding.')
    }
    delivery = { kind: 'wonder-launcher', equipmentBindingId }
  }
  const command: UseItemCommandV1 = {
    schemaVersion: ITEM_OPERATION_SCHEMA_VERSION,
    operationId: operationId(root.operationId, 'itemCommand.operationId', code),
    context: enumValue(root.context, CONTEXT_SET, 'itemCommand.context', code),
    offerId: boundedText(root.offerId, 'itemCommand.offerId', code),
    sourceInstanceId: boundedText(root.sourceInstanceId, 'itemCommand.sourceInstanceId', code),
    actorParticipantId: root.actorParticipantId === null ? null : boundedText(root.actorParticipantId, 'itemCommand.actorParticipantId', code),
    actorSheet,
    source: parsedSource,
    targetIds: stringList(root.targetIds, 'itemCommand.targetIds', ITEM_OPERATION_LIMITS.targets, code),
    choices,
    readSet,
    ...(delivery ? { delivery } : {}),
  }
  if (command.sourceInstanceId !== expectedSourceInstanceId) fail(code, 'itemCommand.sourceInstanceId', 'must match the authoritative source container and row identity.')
  if (command.context === 'encounter' && command.actorParticipantId === null) fail(code, 'itemCommand.actorParticipantId', 'encounter item commands require an actor participant.')
  if (command.delivery && (command.context !== 'encounter' || command.actorSheet.kind !== 'trainer')) {
    fail(code, 'itemCommand.delivery', 'Wonder Launcher delivery requires a Trainer encounter actor.')
  }
  if (command.source.expectedRevision !== (readSet.find(ref => aggregateKey(ref) === sourceReadKey)?.revision ?? -1)) fail(code, 'itemCommand.source.expectedRevision', 'must match the source read-set revision.')
  if (command.actorSheet.expectedRevision !== (readSet.find(ref => aggregateKey(ref) === `sheet:${actorSheet.kind}:${actorSheet.slug}`)?.revision ?? -1)) fail(code, 'itemCommand.actorSheet.expectedRevision', 'must match the actor-sheet read-set revision.')
  return deepFreezeStrictJson(command)
}

export const parseItemOperationResult = (value: unknown): ItemOperationResultV1 => {
  const code = 'invalid-result' as const
  const root = record(clone(value, 'itemResult'), 'itemResult', code)
  const status = enumValue<ItemOperationResultV1['status']>(root.status, RESULT_STATUS_SET, 'itemResult.status', code)
  exact(root, status === 'accepted' ? ACCEPTED_RESULT_FIELDS
    : status === 'rejected' ? REJECTED_RESULT_FIELDS : PENDING_RESULT_FIELDS, 'itemResult', code)
  if (root.schemaVersion !== ITEM_OPERATION_SCHEMA_VERSION) {
    fail('unsupported-schema-version', 'itemResult.schemaVersion', `must be ${ITEM_OPERATION_SCHEMA_VERSION}.`)
  }
  const id = operationId(root.operationId, 'itemResult.operationId', code)
  const exactReplay = typeof root.exactReplay === 'boolean'
    ? root.exactReplay
    : fail(code, 'itemResult.exactReplay', 'must be boolean.')
  if (status === 'accepted') {
    return deepFreezeStrictJson({
      schemaVersion: ITEM_OPERATION_SCHEMA_VERSION,
      operationId: id,
      status,
      canonicalItemId: boundedText(root.canonicalItemId, 'itemResult.canonicalItemId', code),
      aggregateRefs: parseReadSet(root.aggregateRefs, 'itemResult.aggregateRefs', code),
      receiptId: boundedText(root.receiptId, 'itemResult.receiptId', code),
      exactReplay,
    })
  }
  if (status === 'rejected') {
    return deepFreezeStrictJson({
      schemaVersion: ITEM_OPERATION_SCHEMA_VERSION,
      operationId: id,
      status,
      canonicalItemId: root.canonicalItemId === null
        ? null
        : boundedText(root.canonicalItemId, 'itemResult.canonicalItemId', code),
      reasonId: boundedText(root.reasonId, 'itemResult.reasonId', code),
      message: boundedText(root.message, 'itemResult.message', code),
      exactReplay,
    })
  }
  return deepFreezeStrictJson({
    schemaVersion: ITEM_OPERATION_SCHEMA_VERSION,
    operationId: id,
    status,
    canonicalItemId: boundedText(root.canonicalItemId, 'itemResult.canonicalItemId', code),
    decisionId: stableId(root.decisionId, 'itemResult.decisionId', code),
    reservationId: root.reservationId === null
      ? null
      : stableId(root.reservationId, 'itemResult.reservationId', code),
    exactReplay,
  })
}

export const parseItemPendingDecision = (value: unknown): ItemPendingDecisionV1 => {
  const code = 'invalid-command' as const
  const root = record(clone(value, 'itemCommand'), 'itemPendingDecision', code)
  exact(root, PENDING_DECISION_FIELDS, 'itemPendingDecision', code)
  if (root.schemaVersion !== ITEM_OPERATION_SCHEMA_VERSION) fail('unsupported-schema-version', 'itemPendingDecision.schemaVersion', `must be ${ITEM_OPERATION_SCHEMA_VERSION}.`)
  const id = operationId(root.operationId, 'itemPendingDecision.operationId', code)
  const reservationInput = root.reservation === null ? null : record(root.reservation, 'itemPendingDecision.reservation', code)
  if (reservationInput) exact(reservationInput, RESERVATION_FIELDS, 'itemPendingDecision.reservation', code)
  const choices = boundedArray(root.choices, 'itemPendingDecision.choices', ITEM_OPERATION_LIMITS.choices, code).map((entry, index): ItemPendingChoiceV1 => {
    const path = `itemPendingDecision.choices[${index}]`
    const input = record(entry, path, code)
    exact(input, PENDING_CHOICE_FIELDS, path, code)
    const minimum = boundedInteger(input.minimum, `${path}.minimum`, 0, ITEM_OPERATION_LIMITS.optionsPerChoice, code)
    const maximum = boundedInteger(input.maximum, `${path}.maximum`, 0, ITEM_OPERATION_LIMITS.optionsPerChoice, code)
    if (minimum > maximum) fail(code, path, 'minimum cannot exceed maximum.')
    const options = boundedArray(input.options, `${path}.options`, ITEM_OPERATION_LIMITS.optionsPerChoice, code).map((entry, optionIndex) => {
      const optionPath = `${path}.options[${optionIndex}]`
      const option = record(entry, optionPath, code)
      exact(option, PENDING_OPTION_FIELDS, optionPath, code)
      return {
        optionId: boundedText(option.optionId, `${optionPath}.optionId`, code),
        label: boundedText(option.label, `${optionPath}.label`, code),
      }
    })
    unique(options.map(option => option.optionId), `${path}.options`)
    return {
      choiceId: stableId(input.choiceId, `${path}.choiceId`, code),
      kind: enumValue(input.kind, PENDING_CHOICE_KIND_SET, `${path}.kind`, code),
      minimum,
      maximum,
      options,
      privateTo: enumValue(input.privateTo, PENDING_PRIVACY_SET, `${path}.privateTo`, code),
    }
  })
  unique(choices.map(choice => choice.choiceId), 'itemPendingDecision.choices')
  return deepFreezeStrictJson({
    schemaVersion: ITEM_OPERATION_SCHEMA_VERSION,
    operationId: id,
    decisionId: stableId(root.decisionId, 'itemPendingDecision.decisionId', code),
    canonicalItemId: boundedText(root.canonicalItemId, 'itemPendingDecision.canonicalItemId', code),
    sourceInstanceId: boundedText(root.sourceInstanceId, 'itemPendingDecision.sourceInstanceId', code),
    reservation: reservationInput ? {
      reservationId: stableId(reservationInput.reservationId, 'itemPendingDecision.reservation.reservationId', code),
      quantity: boundedInteger(reservationInput.quantity, 'itemPendingDecision.reservation.quantity', 1, Number.MAX_SAFE_INTEGER, code),
    } : null,
    choices,
  })
}

export const parseItemOperationPlan = (value: unknown): ItemOperationPlanV1 => {
  const code = 'invalid-plan' as const
  const root = record(clone(value, 'itemPlan'), 'itemPlan', code)
  const hasNonEncounterContext = Object.hasOwn(root, 'nonEncounterContext')
  exact(root, hasNonEncounterContext ? PLAN_FIELDS_WITH_NON_ENCOUNTER_CONTEXT : PLAN_FIELDS, 'itemPlan', code)
  if (root.schemaVersion !== ITEM_OPERATION_SCHEMA_VERSION) fail('unsupported-schema-version', 'itemPlan.schemaVersion', `must be ${ITEM_OPERATION_SCHEMA_VERSION}.`)
  const id = operationId(root.operationId, 'itemPlan.operationId', code)
  const readSet = parseReadSet(root.readSet, 'itemPlan.readSet', code)
  const readKeys = new Set(readSet.map(aggregateKey))
  const operations = boundedArray(root.operations, 'itemPlan.operations', ITEM_OPERATION_LIMITS.operations, code).map((entry, index): PlannedItemOperation => {
    const path = `itemPlan.operations[${index}]`
    const input = record(entry, path, code)
    exact(input, OPERATION_FIELDS, path, code)
    const aggregate = parseAggregateRef(input.aggregate, `${path}.aggregate`, code)
    if (!readKeys.has(aggregateKey(aggregate))) fail('incomplete-read-set', `${path}.aggregate`, 'must appear in the operation plan read set.')
    const payload = record(input.payload, `${path}.payload`, code) as StrictJsonObject
    return {
      operationId: stableId(input.operationId, `${path}.operationId`, code),
      ordinal: boundedInteger(input.ordinal, `${path}.ordinal`, 0, ITEM_OPERATION_LIMITS.operations - 1, code),
      kind: enumValue(input.kind, OPERATION_KIND_SET, `${path}.kind`, code),
      aggregate,
      subjectId: boundedText(input.subjectId, `${path}.subjectId`, code),
      payload,
      label: boundedText(input.label, `${path}.label`, code),
    }
  })
  unique(operations.map(operation => operation.operationId), 'itemPlan.operations.operationId')
  unique(operations.map(operation => String(operation.ordinal)), 'itemPlan.operations.ordinal')
  if (operations.some((operation, index) => operation.ordinal !== index)) fail(code, 'itemPlan.operations.ordinal', 'must be contiguous and ordered from zero.')
  const receiptFacts = boundedArray(root.receiptFacts, 'itemPlan.receiptFacts', ITEM_OPERATION_LIMITS.receiptFacts, code).map((entry, index) => {
    const path = `itemPlan.receiptFacts[${index}]`
    const input = record(entry, path, code)
    exact(input, RECEIPT_FACT_FIELDS, path, code)
    return {
      factId: stableId(input.factId, `${path}.factId`, code),
      audience: enumValue<'public' | 'owner' | 'gm'>(input.audience, AUDIENCE_SET, `${path}.audience`, code),
      label: boundedText(input.label, `${path}.label`, code),
    }
  })
  unique(receiptFacts.map(fact => fact.factId), 'itemPlan.receiptFacts.factId')
  const definitionHash = boundedText(root.canonicalDefinitionSha256, 'itemPlan.canonicalDefinitionSha256', code)
  if (!SHA256_PATTERN.test(definitionHash)) fail(code, 'itemPlan.canonicalDefinitionSha256', 'must be a lowercase SHA-256 digest.')
  let nonEncounterContext: ItemNonEncounterExecutionSnapshotV1 | undefined
  if (hasNonEncounterContext) {
    try { nonEncounterContext = parseItemNonEncounterExecutionSnapshot(root.nonEncounterContext) }
    catch (error) {
      if (error instanceof ItemNonEncounterContextValidationError) {
        fail(code, 'itemPlan.nonEncounterContext', error.message)
      }
      throw error
    }
  }
  return deepFreezeStrictJson({
    schemaVersion: ITEM_OPERATION_SCHEMA_VERSION,
    operationId: id,
    canonicalItemId: boundedText(root.canonicalItemId, 'itemPlan.canonicalItemId', code),
    canonicalDefinitionSha256: definitionHash,
    readSet,
    operations,
    receiptFacts,
    ...(nonEncounterContext ? { nonEncounterContext } : {}),
  })
}
