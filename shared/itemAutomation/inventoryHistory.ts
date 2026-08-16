import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const INVENTORY_HISTORY_SCHEMA_VERSION = 1 as const
export const INVENTORY_HISTORY_FACT_KINDS = [
  'purchase',
  'transfer',
  'item-use',
  'equipment-change',
  'guided-outcome',
  'settlement-award',
  'discard',
  'gm-correction',
] as const
export type InventoryHistoryFactKind = (typeof INVENTORY_HISTORY_FACT_KINDS)[number]
export type InventoryHistoryScopeKind = 'trainer' | 'group'

export const INVENTORY_HISTORY_KIND_LABELS: Readonly<Record<InventoryHistoryFactKind, string>> = Object.freeze({
  purchase: 'Purchase',
  transfer: 'Transfer',
  'item-use': 'Item used',
  'equipment-change': 'Equipment',
  'guided-outcome': 'Guided outcome',
  'settlement-award': 'Settlement award',
  discard: 'Discarded',
  'gm-correction': 'Corrected',
})

export const INVENTORY_HISTORY_LIMITS = Object.freeze({
  facts: 50,
  detailsPerFact: 8,
  textLength: 500,
  jsonDepth: 8,
  jsonNodes: 2_048,
})

export interface InventoryHistoryItemV1 {
  readonly label: string
  readonly quantity: number | null
}

export interface InventoryHistoryCustodyV1 {
  readonly sourceLabel: string
  readonly destinationLabel: string
}

/**
 * One default-safe, user-readable receipt. Source operation identities,
 * inventory row identities, Profile identities, hashes, revisions, and raw
 * evidence are deliberately absent from this contract.
 */
export interface InventoryHistoryFactV1 {
  readonly kind: InventoryHistoryFactKind
  readonly occurredAt: number
  readonly headline: string
  readonly item: InventoryHistoryItemV1 | null
  readonly custody: InventoryHistoryCustodyV1 | null
  readonly details: readonly string[]
}

export interface InventoryHistoryProjectionV1 {
  readonly schemaVersion: typeof INVENTORY_HISTORY_SCHEMA_VERSION
  readonly generatedAt: number
  readonly scope: {
    readonly kind: InventoryHistoryScopeKind
    readonly label: string
  }
  readonly facts: readonly InventoryHistoryFactV1[]
  readonly truncated: boolean
}

export class InventoryHistoryValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'InventoryHistoryValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const FACT_KIND_SET = new Set<string>(INVENTORY_HISTORY_FACT_KINDS)
const SCOPE_KIND_SET = new Set<string>(['trainer', 'group'])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u

const fail = (path: string, detail: string): never => {
  throw new InventoryHistoryValidationError(path, detail)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(value, field))
    || Object.keys(value).some(field => !allowed.has(field))) {
    fail(path, 'has an invalid shape.')
  }
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !value || value !== value.trim()
    || value.length > INVENTORY_HISTORY_LIMITS.textLength
    || CONTROL_CHARACTERS.test(value)) {
    fail(path, 'must be bounded, trimmed, player-readable text.')
  }
  return value as string
}
const integer = (value: unknown, path: string, positive = false): number => {
  if (!Number.isSafeInteger(value) || Number(value) < (positive ? 1 : 0)) {
    fail(path, `must be a safe ${positive ? 'positive' : 'non-negative'} integer.`)
  }
  return Number(value)
}
const timestamp = (value: unknown, path: string): number => {
  const parsed = integer(value, path)
  if (parsed > 8_640_000_000_000_000) fail(path, 'must be a valid epoch-millisecond timestamp.')
  return parsed
}
const bool = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') fail(path, 'must be boolean.')
  return value as boolean
}
const array = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) fail(path, 'must be a bounded list.')
  return value as unknown[]
}
const detached = (value: unknown): unknown => cloneStrictJson(value, 'inventoryHistoryProjection', {
  limits: {
    depth: INVENTORY_HISTORY_LIMITS.jsonDepth,
    nodes: INVENTORY_HISTORY_LIMITS.jsonNodes,
    objectFields: 8,
    arrayEntries: INVENTORY_HISTORY_LIMITS.facts,
    stringLength: INVENTORY_HISTORY_LIMITS.textLength,
    objectKeyLength: 100,
  },
  rootLabel: 'inventory history projection',
  valueLabel: 'inventory history values',
  failNotJson: (path, detail) => fail(path, detail),
  failLimit: (path, detail) => fail(path, detail),
})

const parseItem = (value: unknown, path: string): InventoryHistoryItemV1 | null => {
  if (value === null) return null
  const input = record(value, path)
  exact(input, ['label', 'quantity'], path)
  return Object.freeze({
    label: text(input.label, `${path}.label`),
    quantity: input.quantity === null ? null : integer(input.quantity, `${path}.quantity`, true),
  })
}

const parseCustody = (value: unknown, path: string): InventoryHistoryCustodyV1 | null => {
  if (value === null) return null
  const input = record(value, path)
  exact(input, ['sourceLabel', 'destinationLabel'], path)
  const sourceLabel = text(input.sourceLabel, `${path}.sourceLabel`)
  const destinationLabel = text(input.destinationLabel, `${path}.destinationLabel`)
  if (sourceLabel === destinationLabel) fail(path, 'must describe two distinct custody locations.')
  return Object.freeze({ sourceLabel, destinationLabel })
}

const parseFact = (value: unknown, path: string): InventoryHistoryFactV1 => {
  const input = record(value, path)
  exact(input, ['kind', 'occurredAt', 'headline', 'item', 'custody', 'details'], path)
  if (typeof input.kind !== 'string' || !FACT_KIND_SET.has(input.kind)) {
    fail(`${path}.kind`, 'contains an unsupported receipt kind.')
  }
  const rawDetails = array(input.details, `${path}.details`, INVENTORY_HISTORY_LIMITS.detailsPerFact)
  const details = rawDetails.map((value, index) => text(value, `${path}.details[${index}]`))
  if (new Set(details).size !== details.length) fail(`${path}.details`, 'must not contain duplicate facts.')
  return Object.freeze({
    kind: input.kind as InventoryHistoryFactKind,
    occurredAt: timestamp(input.occurredAt, `${path}.occurredAt`),
    headline: text(input.headline, `${path}.headline`),
    item: parseItem(input.item, `${path}.item`),
    custody: parseCustody(input.custody, `${path}.custody`),
    details: Object.freeze(details),
  })
}

export const parseInventoryHistoryProjection = (value: unknown): InventoryHistoryProjectionV1 => {
  const input = record(detached(value), 'inventoryHistoryProjection')
  exact(input, ['schemaVersion', 'generatedAt', 'scope', 'facts', 'truncated'], 'inventoryHistoryProjection')
  if (input.schemaVersion !== INVENTORY_HISTORY_SCHEMA_VERSION) {
    fail('inventoryHistoryProjection.schemaVersion', 'must be 1.')
  }
  const scope = record(input.scope, 'inventoryHistoryProjection.scope')
  exact(scope, ['kind', 'label'], 'inventoryHistoryProjection.scope')
  if (typeof scope.kind !== 'string' || !SCOPE_KIND_SET.has(scope.kind)) {
    fail('inventoryHistoryProjection.scope.kind', 'must be trainer or group.')
  }
  const rawFacts = array(input.facts, 'inventoryHistoryProjection.facts', INVENTORY_HISTORY_LIMITS.facts)
  const facts = rawFacts.map((fact, index) => parseFact(fact, `inventoryHistoryProjection.facts[${index}]`))
  if (facts.some((fact, index) => index > 0 && fact.occurredAt > facts[index - 1]!.occurredAt)) {
    fail('inventoryHistoryProjection.facts', 'must be ordered newest first.')
  }
  const generatedAt = timestamp(input.generatedAt, 'inventoryHistoryProjection.generatedAt')
  if (facts.some(fact => fact.occurredAt > generatedAt)) {
    fail('inventoryHistoryProjection.facts', 'must not occur after projection generation.')
  }
  return deepFreezeStrictJson({
    schemaVersion: INVENTORY_HISTORY_SCHEMA_VERSION,
    generatedAt,
    scope: {
      kind: scope.kind as InventoryHistoryScopeKind,
      label: text(scope.label, 'inventoryHistoryProjection.scope.label'),
    },
    facts,
    truncated: bool(input.truncated, 'inventoryHistoryProjection.truncated'),
  })
}
