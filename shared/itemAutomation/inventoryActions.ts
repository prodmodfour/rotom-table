import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'
import { ITEM_INVENTORY_SECTIONS, type ItemInventorySection } from './inventory'

export const INVENTORY_ACTION_SCHEMA_VERSION = 1 as const
export const INVENTORY_ACTION_KINDS = [
  'use', 'equip', 'unequip', 'give', 'take', 'transfer',
  'split', 'merge', 'discard', 'inspect', 'guided-adjudication',
] as const
export type InventoryActionKind = (typeof INVENTORY_ACTION_KINDS)[number]
export type InventoryActionCommandKind = Exclude<InventoryActionKind, 'inspect'>

export const INVENTORY_ACTION_SOURCE_LOCATION_KINDS = [
  'trainer-inventory', 'group-inventory', 'trainer-equipment', 'pokemon-equipment',
] as const
export type InventoryActionSourceLocationKind = (typeof INVENTORY_ACTION_SOURCE_LOCATION_KINDS)[number]

export const INVENTORY_ACTION_DESTINATION_KINDS = [
  'trainer-inventory', 'group-inventory', 'trainer-equipment', 'pokemon-equipment',
  'item-target', 'same-container', 'guided-queue',
] as const
export type InventoryActionDestinationKind = (typeof INVENTORY_ACTION_DESTINATION_KINDS)[number]

export const INVENTORY_ACTION_HANDOFFS = [
  'item-operation', 'equipment-operation', 'inventory-transfer',
  'inventory-stack-operation', 'inspect-navigation', 'guided-adjudication',
] as const
export type InventoryActionHandoff = (typeof INVENTORY_ACTION_HANDOFFS)[number]

export const INVENTORY_ACTION_REVISION_RESOURCE_KINDS = [
  'source-container', 'source-sheet', 'source-equipment',
  'destination-container', 'destination-sheet', 'destination-equipment',
  'target-sheet', 'campaign-clock', 'guided-request',
] as const
export type InventoryActionRevisionResourceKind = (typeof INVENTORY_ACTION_REVISION_RESOURCE_KINDS)[number]

export const INVENTORY_ACTION_AUTHORITY_KINDS = [
  'authenticated-session', 'source-control', 'destination-control',
  'target-control', 'gm-role', 'current-custody', 'mechanics-eligibility',
] as const
export type InventoryActionAuthorityKind = (typeof INVENTORY_ACTION_AUTHORITY_KINDS)[number]

export const INVENTORY_ACTION_CONSEQUENCE_KINDS = [
  'none', 'inventory-consumption', 'inventory-reservation', 'inventory-move',
  'equipment-custody', 'stack-shape', 'discard', 'mechanical-effect', 'guided-decision',
] as const
export type InventoryActionConsequenceKind = (typeof INVENTORY_ACTION_CONSEQUENCE_KINDS)[number]
export type InventoryActionReversibility = 'reversible' | 'correctable' | 'irreversible'
export type InventoryActionQuantityMode = 'none' | 'fixed' | 'bounded' | 'whole-stack'
export type InventoryActionDestinationMode = 'none' | 'optional' | 'required' | 'server-determined'
export type InventoryActionConfirmationMode = 'none' | 'action-submit' | 'explicit-choice' | 'guided-settlement'

export const INVENTORY_ACTION_LIMITS = Object.freeze({
  offers: 512,
  authorityChecks: 8,
  revisions: 16,
  destinationKinds: 7,
  destinations: 128,
  destinationRules: 12,
  consequences: 12,
  textLength: 500,
  identifierLength: 200,
})

interface InventoryActionContractRow {
  readonly executionMode: 'command' | 'navigation'
  readonly handoff: InventoryActionHandoff
  readonly sourceKinds: readonly InventoryActionSourceLocationKind[]
  readonly quantityMode: InventoryActionQuantityMode
  readonly destinationMode: InventoryActionDestinationMode
  readonly destinationKinds: readonly InventoryActionDestinationKind[]
  readonly confirmationMode: InventoryActionConfirmationMode
  readonly allowedConsequences: readonly InventoryActionConsequenceKind[]
}

const frozenList = <const Values extends readonly string[]>(values: Values): Values => Object.freeze(values) as Values

/**
 * Interface routing only. This matrix never grants item mechanics, ownership,
 * custody, compatibility, or a mutation; the owning server use case must
 * reauthorize the current source, destination, definitions, and revisions.
 */
export const INVENTORY_ACTION_CONTRACT: Readonly<Record<InventoryActionKind, InventoryActionContractRow>> = Object.freeze({
  use: Object.freeze({
    executionMode: 'command', handoff: 'item-operation',
    sourceKinds: frozenList(['trainer-inventory', 'group-inventory']),
    quantityMode: 'fixed', destinationMode: 'required', destinationKinds: frozenList(['item-target']),
    confirmationMode: 'action-submit',
    allowedConsequences: frozenList(['inventory-consumption', 'inventory-reservation', 'mechanical-effect']),
  }),
  equip: Object.freeze({
    executionMode: 'command', handoff: 'equipment-operation',
    sourceKinds: frozenList(['trainer-inventory', 'group-inventory']),
    quantityMode: 'fixed', destinationMode: 'required',
    destinationKinds: frozenList(['trainer-equipment']), confirmationMode: 'action-submit',
    allowedConsequences: frozenList(['inventory-move', 'equipment-custody']),
  }),
  unequip: Object.freeze({
    executionMode: 'command', handoff: 'equipment-operation',
    sourceKinds: frozenList(['trainer-equipment']), quantityMode: 'fixed', destinationMode: 'required',
    destinationKinds: frozenList(['trainer-inventory', 'group-inventory']), confirmationMode: 'action-submit',
    allowedConsequences: frozenList(['inventory-move', 'equipment-custody']),
  }),
  give: Object.freeze({
    executionMode: 'command', handoff: 'equipment-operation',
    sourceKinds: frozenList(['trainer-inventory', 'group-inventory']), quantityMode: 'fixed', destinationMode: 'required',
    destinationKinds: frozenList(['pokemon-equipment']), confirmationMode: 'action-submit',
    allowedConsequences: frozenList(['inventory-move', 'equipment-custody']),
  }),
  take: Object.freeze({
    executionMode: 'command', handoff: 'equipment-operation',
    sourceKinds: frozenList(['pokemon-equipment']), quantityMode: 'fixed', destinationMode: 'required',
    destinationKinds: frozenList(['trainer-inventory', 'group-inventory']), confirmationMode: 'action-submit',
    allowedConsequences: frozenList(['inventory-move', 'equipment-custody']),
  }),
  transfer: Object.freeze({
    executionMode: 'command', handoff: 'inventory-transfer',
    sourceKinds: frozenList(['trainer-inventory', 'group-inventory']), quantityMode: 'bounded', destinationMode: 'required',
    destinationKinds: frozenList(['trainer-inventory', 'group-inventory']), confirmationMode: 'action-submit',
    allowedConsequences: frozenList(['inventory-move']),
  }),
  split: Object.freeze({
    executionMode: 'command', handoff: 'inventory-stack-operation',
    sourceKinds: frozenList(['trainer-inventory', 'group-inventory']), quantityMode: 'bounded', destinationMode: 'server-determined',
    destinationKinds: frozenList(['same-container']), confirmationMode: 'action-submit',
    allowedConsequences: frozenList(['stack-shape']),
  }),
  merge: Object.freeze({
    executionMode: 'command', handoff: 'inventory-stack-operation',
    sourceKinds: frozenList(['trainer-inventory', 'group-inventory']), quantityMode: 'whole-stack', destinationMode: 'required',
    destinationKinds: frozenList(['same-container']), confirmationMode: 'action-submit',
    allowedConsequences: frozenList(['stack-shape']),
  }),
  discard: Object.freeze({
    executionMode: 'command', handoff: 'inventory-stack-operation',
    sourceKinds: frozenList(['trainer-inventory', 'group-inventory']), quantityMode: 'bounded', destinationMode: 'none',
    destinationKinds: frozenList([]), confirmationMode: 'explicit-choice',
    allowedConsequences: frozenList(['discard']),
  }),
  inspect: Object.freeze({
    executionMode: 'navigation', handoff: 'inspect-navigation',
    sourceKinds: frozenList([...INVENTORY_ACTION_SOURCE_LOCATION_KINDS]), quantityMode: 'none', destinationMode: 'none',
    destinationKinds: frozenList([]), confirmationMode: 'none',
    allowedConsequences: frozenList(['none']),
  }),
  'guided-adjudication': Object.freeze({
    executionMode: 'command', handoff: 'guided-adjudication',
    sourceKinds: frozenList([...INVENTORY_ACTION_SOURCE_LOCATION_KINDS]), quantityMode: 'fixed', destinationMode: 'server-determined',
    destinationKinds: frozenList(['guided-queue']), confirmationMode: 'guided-settlement',
    allowedConsequences: frozenList(['inventory-reservation', 'guided-decision', 'mechanical-effect']),
  }),
})

export interface InventoryActionReasonV1 {
  readonly code: string
  readonly label: string
}

export interface InventoryActionRevisionRequirementV1 {
  readonly requirementId: string
  readonly resourceKind: InventoryActionRevisionResourceKind
  readonly label: string
  readonly expectedRevision: number
}

export interface InventoryActionAuthorityCheckV1 {
  readonly kind: InventoryActionAuthorityKind
  readonly label: string
  readonly satisfied: boolean
}

export interface InventoryActionSourceV1 {
  /** Opaque offer-local reference. It is not a row or serialized-item identity. */
  readonly sourceSelectionId: string
  readonly locationKind: InventoryActionSourceLocationKind
  readonly containerLabel: string
  readonly section: ItemInventorySection | null
  readonly sectionLabel: string | null
  /** Safe presentation locator such as Row 1 or Head slot; never an authority identity. */
  readonly rowLabel: string
  readonly itemLabel: string
  readonly canonicalItemId: string | null
  readonly availableQuantity: number
  readonly itemForm: 'stack' | 'whole-item'
}

export interface InventoryActionDestinationOptionV1 {
  /** Opaque offer-local reference. It is not a sheet, row, slot, or profile identity. */
  readonly destinationId: string
  readonly kind: InventoryActionDestinationKind
  readonly label: string
  readonly description: string | null
  readonly enabled: boolean
  readonly unavailableReason: InventoryActionReasonV1 | null
  readonly revisionRequirements: readonly InventoryActionRevisionRequirementV1[]
}

export interface InventoryActionDestinationPolicyV1 {
  readonly mode: InventoryActionDestinationMode
  readonly allowedKinds: readonly InventoryActionDestinationKind[]
  readonly rules: readonly string[]
  readonly options: readonly InventoryActionDestinationOptionV1[]
}

export interface InventoryActionQuantityPolicyV1 {
  readonly mode: InventoryActionQuantityMode
  readonly minimum: number | null
  readonly maximum: number | null
  readonly defaultValue: number | null
  readonly unitLabel: string | null
}

export interface InventoryActionConsequenceV1 {
  readonly kind: InventoryActionConsequenceKind
  readonly label: string
  readonly reversibility: InventoryActionReversibility
}

export interface InventoryActionConfirmationV1 {
  readonly mode: InventoryActionConfirmationMode
  readonly label: string | null
  /** Present only for an explicit declaration confirmation. */
  readonly optionId: string | null
}

export interface InventoryActionExecutionV1 {
  readonly mode: 'command' | 'navigation'
  readonly handoff: InventoryActionHandoff
  readonly href: string | null
}

export interface InventoryActionOfferV1 {
  readonly schemaVersion: typeof INVENTORY_ACTION_SCHEMA_VERSION
  readonly offerId: string
  readonly action: InventoryActionKind
  readonly label: string
  readonly source: InventoryActionSourceV1
  readonly authority: {
    readonly requiredRole: 'player-or-gm' | 'gm'
    readonly checks: readonly InventoryActionAuthorityCheckV1[]
  }
  readonly revisionRequirements: readonly InventoryActionRevisionRequirementV1[]
  readonly quantity: InventoryActionQuantityPolicyV1
  readonly destination: InventoryActionDestinationPolicyV1
  readonly consequences: readonly InventoryActionConsequenceV1[]
  readonly confirmation: InventoryActionConfirmationV1
  readonly execution: InventoryActionExecutionV1
  readonly enabled: boolean
  readonly unavailableReason: InventoryActionReasonV1 | null
}

export interface InventoryActionProjectionV1 {
  readonly schemaVersion: typeof INVENTORY_ACTION_SCHEMA_VERSION
  readonly generatedAt: number
  readonly offers: readonly InventoryActionOfferV1[]
}

export interface InventoryActionExpectedRevisionV1 {
  readonly requirementId: string
  readonly expectedRevision: number
}

export interface InventoryActionExecutionResultV1 {
  readonly schemaVersion: typeof INVENTORY_ACTION_SCHEMA_VERSION
  readonly operationId: string
  readonly action: InventoryActionCommandKind
  readonly exactReplay: boolean
  readonly message: string
}

export interface InventoryActionDeclarationV1 {
  readonly schemaVersion: typeof INVENTORY_ACTION_SCHEMA_VERSION
  readonly operationId: string
  readonly offerId: string
  readonly action: InventoryActionCommandKind
  readonly sourceSelectionId: string
  readonly quantity: number
  readonly destinationId: string | null
  readonly confirmationOptionId: string | null
  readonly expectedRevisions: readonly InventoryActionExpectedRevisionV1[]
}

export class InventoryActionValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'InventoryActionValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const ACTION_SET = new Set<string>(INVENTORY_ACTION_KINDS)
const SOURCE_KIND_SET = new Set<string>(INVENTORY_ACTION_SOURCE_LOCATION_KINDS)
const DESTINATION_KIND_SET = new Set<string>(INVENTORY_ACTION_DESTINATION_KINDS)
const REVISION_KIND_SET = new Set<string>(INVENTORY_ACTION_REVISION_RESOURCE_KINDS)
const AUTHORITY_KIND_SET = new Set<string>(INVENTORY_ACTION_AUTHORITY_KINDS)
const CONSEQUENCE_KIND_SET = new Set<string>(INVENTORY_ACTION_CONSEQUENCE_KINDS)
const SECTION_SET = new Set<string>(ITEM_INVENTORY_SECTIONS)
const REVERSIBILITY_SET = new Set<string>(['reversible', 'correctable', 'irreversible'])
const QUANTITY_MODE_SET = new Set<string>(['none', 'fixed', 'bounded', 'whole-stack'])
const DESTINATION_MODE_SET = new Set<string>(['none', 'optional', 'required', 'server-determined'])
const CONFIRMATION_MODE_SET = new Set<string>(['none', 'action-submit', 'explicit-choice', 'guided-settlement'])
const ROLE_SET = new Set<string>(['player-or-gm', 'gm'])
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u
const SAFE_CODE_PATTERN = /^[a-z][a-z0-9.-]{0,99}$/u
const OFFER_ID_PATTERN = /^inventory-action-offer:v1:[a-f0-9]{32}$/u
const SOURCE_ID_PATTERN = /^inventory-source:v1:[a-f0-9]{32}$/u
const DESTINATION_ID_PATTERN = /^inventory-destination:v1:[a-f0-9]{32}$/u
const REVISION_ID_PATTERN = /^inventory-revision:v1:[a-f0-9]{32}$/u
const CONFIRMATION_ID_PATTERN = /^inventory-confirmation:v1:[a-f0-9]{32}$/u
const OPERATION_ID_PATTERN = /^inventory-action:v1:[a-f0-9]{32}$/u

const fail = (path: string, detail: string): never => { throw new InventoryActionValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(value, field)) || Object.keys(value).some(field => !allowed.has(field))) {
    fail(path, 'has an invalid shape.')
  }
}
const text = (value: unknown, path: string, maximum: number = INVENTORY_ACTION_LIMITS.textLength): string => {
  if (typeof value !== 'string' || !value || value !== value.trim()
    || value.length > maximum || CONTROL_CHARACTER_PATTERN.test(value)) fail(path, 'must be bounded safe text.')
  return value as string
}
const nullableText = (value: unknown, path: string): string | null => value === null ? null : text(value, path)
const identifier = (value: unknown, path: string, pattern: RegExp): string => {
  const parsed = text(value, path, INVENTORY_ACTION_LIMITS.identifierLength)
  if (!pattern.test(parsed)) fail(path, 'must be a versioned opaque identifier.')
  return parsed
}
const integer = (value: unknown, path: string, { positive = false } = {}): number => {
  if (!Number.isSafeInteger(value) || Number(value) < (positive ? 1 : 0)) fail(path, `must be a safe ${positive ? 'positive' : 'non-negative'} integer.`)
  return Number(value)
}
const bool = (value: unknown, path: string): boolean => typeof value === 'boolean' ? value : fail(path, 'must be boolean.')
const array = (value: unknown, path: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) fail(path, 'must be a bounded array.')
  return value as readonly unknown[]
}
const enumText = <T extends string>(value: unknown, path: string, values: ReadonlySet<string>): T => {
  if (typeof value !== 'string' || !values.has(value)) fail(path, 'contains an unsupported value.')
  return value as T
}
const reason = (value: unknown, path: string): InventoryActionReasonV1 | null => {
  if (value === null) return null
  const input = record(value, path)
  exact(input, ['code', 'label'], path)
  const code = text(input.code, `${path}.code`, 100)
  if (!SAFE_CODE_PATTERN.test(code)) fail(`${path}.code`, 'must be a stable reason code.')
  return Object.freeze({ code, label: text(input.label, `${path}.label`) })
}
const assertAvailability = (enabled: boolean, unavailableReason: InventoryActionReasonV1 | null, path: string): void => {
  if (enabled === (unavailableReason !== null)) fail(path, 'must pair enabled state with exactly one unavailable reason.')
}
const enumArray = <T extends string>(
  value: unknown, path: string, maximum: number, values: ReadonlySet<string>, allowEmpty = false,
): readonly T[] => {
  const parsed = array(value, path, maximum).map((entry, index) => enumText<T>(entry, `${path}[${index}]`, values))
  if ((!allowEmpty && parsed.length === 0) || new Set(parsed).size !== parsed.length) fail(path, 'must contain unique supported values.')
  return Object.freeze(parsed)
}

const parseRevision = (value: unknown, path: string): InventoryActionRevisionRequirementV1 => {
  const input = record(value, path)
  exact(input, ['requirementId', 'resourceKind', 'label', 'expectedRevision'], path)
  return Object.freeze({
    requirementId: identifier(input.requirementId, `${path}.requirementId`, REVISION_ID_PATTERN),
    resourceKind: enumText<InventoryActionRevisionResourceKind>(input.resourceKind, `${path}.resourceKind`, REVISION_KIND_SET),
    label: text(input.label, `${path}.label`, 200),
    expectedRevision: integer(input.expectedRevision, `${path}.expectedRevision`),
  })
}

const parseRevisions = (value: unknown, path: string, allowEmpty = false): readonly InventoryActionRevisionRequirementV1[] => {
  const revisions = array(value, path, INVENTORY_ACTION_LIMITS.revisions)
    .map((entry, index) => parseRevision(entry, `${path}[${index}]`))
  if ((!allowEmpty && revisions.length === 0)
    || new Set(revisions.map(row => row.requirementId)).size !== revisions.length) {
    fail(path, 'must contain unique revision requirements.')
  }
  return Object.freeze(revisions)
}

const parseSource = (value: unknown, path: string): InventoryActionSourceV1 => {
  const input = record(value, path)
  exact(input, [
    'sourceSelectionId', 'locationKind', 'containerLabel', 'section', 'sectionLabel',
    'rowLabel', 'itemLabel', 'canonicalItemId', 'availableQuantity', 'itemForm',
  ], path)
  const locationKind = enumText<InventoryActionSourceLocationKind>(input.locationKind, `${path}.locationKind`, SOURCE_KIND_SET)
  const inventoryLocation = locationKind === 'trainer-inventory' || locationKind === 'group-inventory'
  const section = input.section === null
    ? null
    : enumText<ItemInventorySection>(input.section, `${path}.section`, SECTION_SET)
  const sectionLabel = nullableText(input.sectionLabel, `${path}.sectionLabel`)
  if (inventoryLocation !== (section !== null && sectionLabel !== null)) {
    fail(path, 'inventory sources require a section and equipped sources forbid one.')
  }
  const itemForm = enumText<'stack' | 'whole-item'>(input.itemForm, `${path}.itemForm`, new Set(['stack', 'whole-item']))
  const availableQuantity = integer(input.availableQuantity, `${path}.availableQuantity`, { positive: true })
  if (itemForm === 'whole-item' && availableQuantity !== 1) fail(`${path}.availableQuantity`, 'whole items must have quantity one.')
  return Object.freeze({
    sourceSelectionId: identifier(input.sourceSelectionId, `${path}.sourceSelectionId`, SOURCE_ID_PATTERN),
    locationKind,
    containerLabel: text(input.containerLabel, `${path}.containerLabel`, 200),
    section,
    sectionLabel,
    rowLabel: text(input.rowLabel, `${path}.rowLabel`, 100),
    itemLabel: text(input.itemLabel, `${path}.itemLabel`, 200),
    canonicalItemId: nullableText(input.canonicalItemId, `${path}.canonicalItemId`),
    availableQuantity,
    itemForm,
  })
}

const parseDestinationOption = (value: unknown, path: string): InventoryActionDestinationOptionV1 => {
  const input = record(value, path)
  exact(input, [
    'destinationId', 'kind', 'label', 'description', 'enabled',
    'unavailableReason', 'revisionRequirements',
  ], path)
  const enabled = bool(input.enabled, `${path}.enabled`)
  const unavailableReason = reason(input.unavailableReason, `${path}.unavailableReason`)
  assertAvailability(enabled, unavailableReason, path)
  return Object.freeze({
    destinationId: identifier(input.destinationId, `${path}.destinationId`, DESTINATION_ID_PATTERN),
    kind: enumText<InventoryActionDestinationKind>(input.kind, `${path}.kind`, DESTINATION_KIND_SET),
    label: text(input.label, `${path}.label`, 200),
    description: nullableText(input.description, `${path}.description`),
    enabled,
    unavailableReason,
    revisionRequirements: parseRevisions(input.revisionRequirements, `${path}.revisionRequirements`, true),
  })
}

const parseDestination = (value: unknown, path: string): InventoryActionDestinationPolicyV1 => {
  const input = record(value, path)
  exact(input, ['mode', 'allowedKinds', 'rules', 'options'], path)
  const mode = enumText<InventoryActionDestinationMode>(input.mode, `${path}.mode`, DESTINATION_MODE_SET)
  const allowedKinds = enumArray<InventoryActionDestinationKind>(
    input.allowedKinds, `${path}.allowedKinds`, INVENTORY_ACTION_LIMITS.destinationKinds, DESTINATION_KIND_SET, mode === 'none',
  )
  const rules = array(input.rules, `${path}.rules`, INVENTORY_ACTION_LIMITS.destinationRules)
    .map((entry, index) => text(entry, `${path}.rules[${index}]`))
  if (new Set(rules).size !== rules.length) fail(`${path}.rules`, 'must contain unique rules.')
  const options = array(input.options, `${path}.options`, INVENTORY_ACTION_LIMITS.destinations)
    .map((entry, index) => parseDestinationOption(entry, `${path}.options[${index}]`))
  if (new Set(options.map(option => option.destinationId)).size !== options.length) fail(`${path}.options`, 'must have unique identities.')
  if (options.some(option => !allowedKinds.includes(option.kind))) fail(`${path}.options`, 'contains a destination outside the allowed kinds.')
  if (mode === 'none' && (allowedKinds.length || options.length)) fail(path, 'destination-free actions may not advertise destination kinds or options.')
  if (mode === 'server-determined' && options.length) fail(path, 'server-determined destinations may not expose selectable options.')
  return Object.freeze({ mode, allowedKinds, rules: Object.freeze(rules), options: Object.freeze(options) })
}

const parseQuantity = (value: unknown, path: string, availableQuantity: number): InventoryActionQuantityPolicyV1 => {
  const input = record(value, path)
  exact(input, ['mode', 'minimum', 'maximum', 'defaultValue', 'unitLabel'], path)
  const mode = enumText<InventoryActionQuantityMode>(input.mode, `${path}.mode`, QUANTITY_MODE_SET)
  if (mode === 'none') {
    if (input.minimum !== null || input.maximum !== null || input.defaultValue !== null || input.unitLabel !== null) {
      fail(path, 'quantity-free actions must use null quantity fields.')
    }
    return Object.freeze({ mode, minimum: null, maximum: null, defaultValue: null, unitLabel: null })
  }
  const minimum = integer(input.minimum, `${path}.minimum`, { positive: true })
  const maximum = integer(input.maximum, `${path}.maximum`, { positive: true })
  const defaultValue = integer(input.defaultValue, `${path}.defaultValue`, { positive: true })
  if (minimum > maximum || maximum > availableQuantity || defaultValue < minimum || defaultValue > maximum) {
    fail(path, 'has quantity bounds outside the current source.')
  }
  if (mode === 'fixed' && (minimum !== maximum || defaultValue !== minimum)) fail(path, 'fixed quantity must contain one exact value.')
  if (mode === 'whole-stack' && (minimum !== availableQuantity || maximum !== availableQuantity || defaultValue !== availableQuantity)) {
    fail(path, 'whole-stack quantity must equal the current available quantity.')
  }
  return Object.freeze({
    mode, minimum, maximum, defaultValue,
    unitLabel: text(input.unitLabel, `${path}.unitLabel`, 100),
  })
}

const parseConsequence = (value: unknown, path: string): InventoryActionConsequenceV1 => {
  const input = record(value, path)
  exact(input, ['kind', 'label', 'reversibility'], path)
  return Object.freeze({
    kind: enumText<InventoryActionConsequenceKind>(input.kind, `${path}.kind`, CONSEQUENCE_KIND_SET),
    label: text(input.label, `${path}.label`),
    reversibility: enumText<InventoryActionReversibility>(input.reversibility, `${path}.reversibility`, REVERSIBILITY_SET),
  })
}

const parseOfferFromDetached = (value: unknown, path: string): InventoryActionOfferV1 => {
  const input = record(value, path)
  exact(input, [
    'schemaVersion', 'offerId', 'action', 'label', 'source', 'authority',
    'revisionRequirements', 'quantity', 'destination', 'consequences',
    'confirmation', 'execution', 'enabled', 'unavailableReason',
  ], path)
  if (input.schemaVersion !== INVENTORY_ACTION_SCHEMA_VERSION) fail(`${path}.schemaVersion`, 'must be 1.')
  const action = enumText<InventoryActionKind>(input.action, `${path}.action`, ACTION_SET)
  const contract = INVENTORY_ACTION_CONTRACT[action]
  const source = parseSource(input.source, `${path}.source`)
  if (!contract.sourceKinds.includes(source.locationKind)) fail(`${path}.source.locationKind`, `is unsupported for ${action}.`)

  const authorityInput = record(input.authority, `${path}.authority`)
  exact(authorityInput, ['requiredRole', 'checks'], `${path}.authority`)
  const requiredRole = enumText<'player-or-gm' | 'gm'>(authorityInput.requiredRole, `${path}.authority.requiredRole`, ROLE_SET)
  const checks = array(authorityInput.checks, `${path}.authority.checks`, INVENTORY_ACTION_LIMITS.authorityChecks)
    .map((entry, index): InventoryActionAuthorityCheckV1 => {
      const checkPath = `${path}.authority.checks[${index}]`
      const row = record(entry, checkPath)
      exact(row, ['kind', 'label', 'satisfied'], checkPath)
      return Object.freeze({
        kind: enumText<InventoryActionAuthorityKind>(row.kind, `${checkPath}.kind`, AUTHORITY_KIND_SET),
        label: text(row.label, `${checkPath}.label`, 200),
        satisfied: bool(row.satisfied, `${checkPath}.satisfied`),
      })
    })
  if (!checks.length || new Set(checks.map(check => check.kind)).size !== checks.length
    || !checks.some(check => check.kind === 'authenticated-session')) {
    fail(`${path}.authority.checks`, 'must contain unique checks including authenticated-session.')
  }

  const revisionRequirements = parseRevisions(input.revisionRequirements, `${path}.revisionRequirements`)
  const requiredSourceKinds: readonly InventoryActionRevisionResourceKind[] = source.locationKind.endsWith('-inventory')
    ? ['source-container']
    : ['source-sheet', 'source-equipment']
  if (requiredSourceKinds.some(kind => !revisionRequirements.some(row => row.resourceKind === kind))) {
    fail(`${path}.revisionRequirements`, 'does not cover the exact source authority.')
  }

  const quantity = parseQuantity(input.quantity, `${path}.quantity`, source.availableQuantity)
  if (quantity.mode !== contract.quantityMode) fail(`${path}.quantity.mode`, `must be ${contract.quantityMode} for ${action}.`)
  if (source.itemForm === 'whole-item' && quantity.mode !== 'none'
    && (quantity.minimum !== 1 || quantity.maximum !== 1)) fail(`${path}.quantity`, 'whole items require exact quantity one.')

  const destination = parseDestination(input.destination, `${path}.destination`)
  if (destination.mode !== contract.destinationMode
    || destination.allowedKinds.length !== contract.destinationKinds.length
    || destination.allowedKinds.some(kind => !contract.destinationKinds.includes(kind))) {
    fail(`${path}.destination`, `does not match the ${action} destination contract.`)
  }

  const consequences = array(input.consequences, `${path}.consequences`, INVENTORY_ACTION_LIMITS.consequences)
    .map((entry, index) => parseConsequence(entry, `${path}.consequences[${index}]`))
  if (!consequences.length || consequences.some(row => !contract.allowedConsequences.includes(row.kind))) {
    fail(`${path}.consequences`, `contains unsupported ${action} consequences.`)
  }
  if (action === 'inspect' && (consequences.length !== 1 || consequences[0]?.kind !== 'none')) {
    fail(`${path}.consequences`, 'inspect must advertise one mechanically inert consequence.')
  }
  if (action === 'discard' && consequences.some(row => row.reversibility !== 'irreversible')) {
    fail(`${path}.consequences`, 'discard must advertise irreversible loss.')
  }

  const confirmationInput = record(input.confirmation, `${path}.confirmation`)
  exact(confirmationInput, ['mode', 'label', 'optionId'], `${path}.confirmation`)
  const confirmationMode = enumText<InventoryActionConfirmationMode>(
    confirmationInput.mode, `${path}.confirmation.mode`, CONFIRMATION_MODE_SET,
  )
  if (confirmationMode !== contract.confirmationMode) fail(`${path}.confirmation.mode`, `must be ${contract.confirmationMode} for ${action}.`)
  const confirmationLabel = nullableText(confirmationInput.label, `${path}.confirmation.label`)
  const confirmationOptionId = confirmationInput.optionId === null
    ? null
    : identifier(confirmationInput.optionId, `${path}.confirmation.optionId`, CONFIRMATION_ID_PATTERN)
  if ((confirmationMode === 'none') !== (confirmationLabel === null)
    || (confirmationMode === 'explicit-choice') !== (confirmationOptionId !== null)) {
    fail(`${path}.confirmation`, 'does not match its confirmation mode.')
  }

  const executionInput = record(input.execution, `${path}.execution`)
  exact(executionInput, ['mode', 'handoff', 'href'], `${path}.execution`)
  if (executionInput.mode !== contract.executionMode || executionInput.handoff !== contract.handoff) {
    fail(`${path}.execution`, `does not match the ${action} handoff contract.`)
  }
  const href = nullableText(executionInput.href, `${path}.execution.href`)
  if (contract.executionMode === 'navigation') {
    if (!href?.startsWith('/') || href.startsWith('//')) fail(`${path}.execution.href`, 'must be an app-relative path.')
  }
  else if (href !== null) fail(`${path}.execution.href`, 'command actions may not carry navigation authority.')

  const enabled = bool(input.enabled, `${path}.enabled`)
  const unavailableReason = reason(input.unavailableReason, `${path}.unavailableReason`)
  assertAvailability(enabled, unavailableReason, path)
  if (enabled && checks.some(check => !check.satisfied)) fail(`${path}.authority.checks`, 'enabled actions require every authority check to pass.')
  if (enabled && destination.mode === 'required' && !destination.options.some(option => option.enabled)) {
    fail(`${path}.destination.options`, 'enabled required-destination actions need an enabled option.')
  }

  return Object.freeze({
    schemaVersion: INVENTORY_ACTION_SCHEMA_VERSION,
    offerId: identifier(input.offerId, `${path}.offerId`, OFFER_ID_PATTERN),
    action,
    label: text(input.label, `${path}.label`, 100),
    source,
    authority: Object.freeze({ requiredRole, checks: Object.freeze(checks) }),
    revisionRequirements,
    quantity,
    destination,
    consequences: Object.freeze(consequences),
    confirmation: Object.freeze({ mode: confirmationMode, label: confirmationLabel, optionId: confirmationOptionId }),
    execution: Object.freeze({ mode: contract.executionMode, handoff: contract.handoff, href }),
    enabled,
    unavailableReason,
  })
}

const detach = (value: unknown, label: string): unknown => cloneStrictJson(value, label, {
  limits: {
    depth: 10,
    nodes: 65_536,
    objectFields: 20,
    arrayEntries: INVENTORY_ACTION_LIMITS.offers,
    stringLength: INVENTORY_ACTION_LIMITS.textLength,
    objectKeyLength: 100,
  },
  rootLabel: label,
  valueLabel: `${label}s`,
  failNotJson: (path, detail) => fail(path, detail),
  failLimit: (path, detail) => fail(path, detail),
})

export const parseInventoryActionOffer = (value: unknown): InventoryActionOfferV1 => (
  deepFreezeStrictJson(parseOfferFromDetached(detach(value, 'inventoryActionOffer'), 'inventoryActionOffer'))
)

export const parseInventoryActionProjection = (value: unknown): InventoryActionProjectionV1 => {
  const root = record(detach(value, 'inventoryActionProjection'), 'inventoryActionProjection')
  exact(root, ['schemaVersion', 'generatedAt', 'offers'], 'inventoryActionProjection')
  if (root.schemaVersion !== INVENTORY_ACTION_SCHEMA_VERSION) fail('inventoryActionProjection.schemaVersion', 'must be 1.')
  const offers = array(root.offers, 'inventoryActionProjection.offers', INVENTORY_ACTION_LIMITS.offers)
    .map((entry, index) => parseOfferFromDetached(entry, `inventoryActionProjection.offers[${index}]`))
  if (new Set(offers.map(offer => offer.offerId)).size !== offers.length) fail('inventoryActionProjection.offers', 'must have unique offer identities.')
  return deepFreezeStrictJson({
    schemaVersion: INVENTORY_ACTION_SCHEMA_VERSION,
    generatedAt: integer(root.generatedAt, 'inventoryActionProjection.generatedAt'),
    offers,
  })
}

export const parseInventoryActionExecutionResult = (value: unknown): InventoryActionExecutionResultV1 => {
  const input = record(detach(value, 'inventoryActionExecutionResult'), 'inventoryActionExecutionResult')
  exact(input, ['schemaVersion', 'operationId', 'action', 'exactReplay', 'message'], 'inventoryActionExecutionResult')
  if (input.schemaVersion !== INVENTORY_ACTION_SCHEMA_VERSION) fail('inventoryActionExecutionResult.schemaVersion', 'must be 1.')
  const action = enumText<InventoryActionKind>(input.action, 'inventoryActionExecutionResult.action', ACTION_SET)
  if (action === 'inspect') fail('inventoryActionExecutionResult.action', 'inspect cannot produce a mutation result.')
  return deepFreezeStrictJson({
    schemaVersion: INVENTORY_ACTION_SCHEMA_VERSION,
    operationId: identifier(input.operationId, 'inventoryActionExecutionResult.operationId', OPERATION_ID_PATTERN),
    action: action as InventoryActionCommandKind,
    exactReplay: bool(input.exactReplay, 'inventoryActionExecutionResult.exactReplay'),
    message: text(input.message, 'inventoryActionExecutionResult.message'),
  })
}

export const parseInventoryActionDeclaration = (value: unknown): InventoryActionDeclarationV1 => {
  const input = record(detach(value, 'inventoryActionDeclaration'), 'inventoryActionDeclaration')
  exact(input, [
    'schemaVersion', 'operationId', 'offerId', 'action', 'sourceSelectionId',
    'quantity', 'destinationId', 'confirmationOptionId', 'expectedRevisions',
  ], 'inventoryActionDeclaration')
  if (input.schemaVersion !== INVENTORY_ACTION_SCHEMA_VERSION) fail('inventoryActionDeclaration.schemaVersion', 'must be 1.')
  const action = enumText<InventoryActionKind>(input.action, 'inventoryActionDeclaration.action', ACTION_SET)
  if (action === 'inspect') fail('inventoryActionDeclaration.action', 'inspect is navigation-only and cannot be submitted as a mutation.')
  const destinationMode = INVENTORY_ACTION_CONTRACT[action].destinationMode
  const destinationId = input.destinationId === null
    ? null
    : identifier(input.destinationId, 'inventoryActionDeclaration.destinationId', DESTINATION_ID_PATTERN)
  if ((destinationMode === 'required') !== (destinationId !== null)
    || (destinationMode === 'none' || destinationMode === 'server-determined') && destinationId !== null) {
    fail('inventoryActionDeclaration.destinationId', `does not match the ${action} destination contract.`)
  }
  const confirmationMode = INVENTORY_ACTION_CONTRACT[action].confirmationMode
  const confirmationOptionId = input.confirmationOptionId === null
    ? null
    : identifier(input.confirmationOptionId, 'inventoryActionDeclaration.confirmationOptionId', CONFIRMATION_ID_PATTERN)
  if ((confirmationMode === 'explicit-choice') !== (confirmationOptionId !== null)) {
    fail('inventoryActionDeclaration.confirmationOptionId', `does not match the ${action} confirmation contract.`)
  }
  const expectedRevisions = array(
    input.expectedRevisions, 'inventoryActionDeclaration.expectedRevisions', INVENTORY_ACTION_LIMITS.revisions,
  ).map((entry, index): InventoryActionExpectedRevisionV1 => {
    const path = `inventoryActionDeclaration.expectedRevisions[${index}]`
    const row = record(entry, path)
    exact(row, ['requirementId', 'expectedRevision'], path)
    return Object.freeze({
      requirementId: identifier(row.requirementId, `${path}.requirementId`, REVISION_ID_PATTERN),
      expectedRevision: integer(row.expectedRevision, `${path}.expectedRevision`),
    })
  })
  if (!expectedRevisions.length || new Set(expectedRevisions.map(row => row.requirementId)).size !== expectedRevisions.length) {
    fail('inventoryActionDeclaration.expectedRevisions', 'must contain unique revision requirements.')
  }
  return deepFreezeStrictJson({
    schemaVersion: INVENTORY_ACTION_SCHEMA_VERSION,
    operationId: identifier(input.operationId, 'inventoryActionDeclaration.operationId', OPERATION_ID_PATTERN),
    offerId: identifier(input.offerId, 'inventoryActionDeclaration.offerId', OFFER_ID_PATTERN),
    action: action as InventoryActionCommandKind,
    sourceSelectionId: identifier(input.sourceSelectionId, 'inventoryActionDeclaration.sourceSelectionId', SOURCE_ID_PATTERN),
    quantity: integer(input.quantity, 'inventoryActionDeclaration.quantity', { positive: true }),
    destinationId,
    confirmationOptionId,
    expectedRevisions,
  })
}

/**
 * Matches browser intent to one safe server-issued offer. This is not commit
 * authorization: the handoff use case must still reload and revalidate every
 * mapped resource and all item/equipment mechanics before mutation.
 */
export const validateInventoryActionDeclarationAgainstOffer = (
  offerValue: unknown,
  declarationValue: unknown,
): InventoryActionDeclarationV1 => {
  const offer = parseInventoryActionOffer(offerValue)
  const command = parseInventoryActionDeclaration(declarationValue)
  if (!offer.enabled || offer.unavailableReason) fail('inventoryActionDeclaration.offerId', 'references an unavailable offer.')
  if (offer.execution.mode !== 'command') fail('inventoryActionDeclaration.action', 'references a navigation-only offer.')
  if (command.offerId !== offer.offerId || command.action !== offer.action
    || command.sourceSelectionId !== offer.source.sourceSelectionId) {
    fail('inventoryActionDeclaration', 'does not match its exact source action offer.')
  }
  const quantity = offer.quantity
  const minimum = quantity.minimum
  const maximum = quantity.maximum
  const defaultValue = quantity.defaultValue
  if (quantity.mode === 'none' || minimum === null || maximum === null || defaultValue === null) {
    fail('inventoryActionDeclaration.quantity', 'is unavailable for this offer.')
  }
  const exactMinimum = minimum as number
  const exactMaximum = maximum as number
  const exactDefaultValue = defaultValue as number
  if (command.quantity < exactMinimum || command.quantity > exactMaximum
    || (quantity.mode === 'fixed' && command.quantity !== exactDefaultValue)
    || (quantity.mode === 'whole-stack' && command.quantity !== offer.source.availableQuantity)) {
    fail('inventoryActionDeclaration.quantity', 'does not match the current quantity offer.')
  }
  const destination = command.destinationId === null
    ? null
    : offer.destination.options.find(option => option.destinationId === command.destinationId) ?? null
  if (offer.destination.mode === 'required' && (!destination || !destination.enabled)) {
    fail('inventoryActionDeclaration.destinationId', 'does not select one current enabled destination.')
  }
  if (offer.destination.mode === 'optional' && command.destinationId !== null && (!destination || !destination.enabled)) {
    fail('inventoryActionDeclaration.destinationId', 'does not select a current enabled destination.')
  }
  if (offer.confirmation.mode === 'explicit-choice' && command.confirmationOptionId !== offer.confirmation.optionId) {
    fail('inventoryActionDeclaration.confirmationOptionId', 'does not match the exact irreversible-action confirmation.')
  }
  const requiredRevisions = [...offer.revisionRequirements, ...(destination?.revisionRequirements ?? [])]
  const expected = new Map(command.expectedRevisions.map(row => [row.requirementId, row.expectedRevision]))
  if (expected.size !== requiredRevisions.length
    || requiredRevisions.some(row => expected.get(row.requirementId) !== row.expectedRevision)) {
    fail('inventoryActionDeclaration.expectedRevisions', 'does not match every exact source and destination revision.')
  }
  return command
}
