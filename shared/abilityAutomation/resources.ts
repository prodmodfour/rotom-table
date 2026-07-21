import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_USAGE_LEDGER_SCHEMA_VERSION = 1 as const
export const ABILITY_USAGE_LEDGER_LIMITS = Object.freeze({
  entries: 512,
  usesPerEntry: 10,
  identifierLength: 200,
  canonicalIdLength: 160,
})

export interface AbilityUsageEntry {
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly clauseId: string
  readonly limit: number
  readonly spent: number
  readonly operationIds: readonly string[]
}

export interface AbilitySceneUsageLedger {
  readonly schemaVersion: typeof ABILITY_USAGE_LEDGER_SCHEMA_VERSION
  readonly sceneId: string | null
  readonly entries: readonly AbilityUsageEntry[]
}

export interface AbilityDailyUsageLedger {
  readonly schemaVersion: typeof ABILITY_USAGE_LEDGER_SCHEMA_VERSION
  readonly dayKey: string | null
  readonly entries: readonly AbilityUsageEntry[]
}

export type AbilityUsageLedgerValidationCode =
  | 'invalid-ledger'
  | 'limit-exceeded'
  | 'duplicate-resource'
  | 'duplicate-operation-id'
  | 'not-json'

export class AbilityUsageLedgerValidationError extends Error {
  readonly code: AbilityUsageLedgerValidationCode
  readonly path: string

  constructor(code: AbilityUsageLedgerValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityUsageLedgerValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const LEDGER_FIELDS = ['schemaVersion', 'sceneId', 'entries'] as const
const DAILY_LEDGER_FIELDS = ['schemaVersion', 'dayKey', 'entries'] as const
const ENTRY_FIELDS = [
  'ownerId',
  'abilityInstanceId',
  'canonicalId',
  'clauseId',
  'limit',
  'spent',
  'operationIds',
] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/

const fail = (
  code: AbilityUsageLedgerValidationCode,
  path: string,
  detail: string,
): never => {
  throw new AbilityUsageLedgerValidationError(code, path, detail)
}

const clone = (value: unknown, path: string) => cloneStrictJson(value, path, {
  limits: {
    depth: 6,
    nodes: 8_192,
    objectFields: 16,
    arrayEntries: ABILITY_USAGE_LEDGER_LIMITS.entries,
    stringLength: ABILITY_USAGE_LEDGER_LIMITS.identifierLength,
    objectKeyLength: ABILITY_USAGE_LEDGER_LIMITS.identifierLength,
  },
  rootLabel: 'ability usage ledger',
  valueLabel: 'ability usage ledgers',
  failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
  failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
})

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail('invalid-ledger', path, 'must be an object.')
  return value
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (
    fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))
  ) {
    fail('invalid-ledger', path, 'has an invalid shape.')
  }
}

const text = (value: unknown, path: string, maximum: number): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fail('invalid-ledger', path, 'must be bounded non-empty text.')
  }
  return value
}

const stableId = (value: unknown, path: string): string => {
  const id = text(value, path, ABILITY_USAGE_LEDGER_LIMITS.identifierLength)
  if (!STABLE_ID_PATTERN.test(id)) fail('invalid-ledger', path, 'must be a stable identifier.')
  return id
}

const parseEntry = (value: unknown, index: number, path: string): AbilityUsageEntry => {
  const entryPath = `${path}.entries[${index}]`
  const input = record(value, entryPath)
  exact(input, ENTRY_FIELDS, entryPath)
  const limit = Number.isSafeInteger(input.limit) && Number(input.limit) >= 1
    && Number(input.limit) <= ABILITY_USAGE_LEDGER_LIMITS.usesPerEntry
    ? Number(input.limit)
    : fail('invalid-ledger', `${entryPath}.limit`, 'must be 1 through 10.')
  const spent = Number.isSafeInteger(input.spent) && Number(input.spent) >= 0
    && Number(input.spent) <= limit
    ? Number(input.spent)
    : fail('invalid-ledger', `${entryPath}.spent`, 'must be from zero through limit.')
  if (!Array.isArray(input.operationIds) || input.operationIds.length > limit) {
    fail('invalid-ledger', `${entryPath}.operationIds`, 'must be bounded by the use limit.')
  }
  const operationIds = (input.operationIds as readonly unknown[]).map((id, operationIndex) => (
    stableId(id, `${entryPath}.operationIds[${operationIndex}]`)
  ))
  if (new Set(operationIds).size !== operationIds.length) {
    fail('duplicate-operation-id', `${entryPath}.operationIds`, 'must not repeat operation IDs.')
  }
  if (operationIds.length !== spent) {
    fail('invalid-ledger', entryPath, 'spent must equal retained idempotency operation IDs.')
  }
  return Object.freeze({
    ownerId: text(
      input.ownerId,
      `${entryPath}.ownerId`,
      ABILITY_USAGE_LEDGER_LIMITS.identifierLength,
    ),
    abilityInstanceId: text(
      input.abilityInstanceId,
      `${entryPath}.abilityInstanceId`,
      ABILITY_USAGE_LEDGER_LIMITS.identifierLength,
    ),
    canonicalId: text(
      input.canonicalId,
      `${entryPath}.canonicalId`,
      ABILITY_USAGE_LEDGER_LIMITS.canonicalIdLength,
    ),
    clauseId: stableId(input.clauseId, `${entryPath}.clauseId`),
    limit,
    spent,
    operationIds: Object.freeze(operationIds),
  })
}

const resourceKey = (entry: AbilityUsageEntry): string => (
  `${entry.ownerId}\u0000${entry.abilityInstanceId}\u0000${entry.canonicalId}\u0000${entry.clauseId}`
)

const parseLedger = <Key extends 'sceneId' | 'dayKey'>(
  value: unknown,
  path: string,
  key: Key,
): Key extends 'sceneId' ? AbilitySceneUsageLedger : AbilityDailyUsageLedger => {
  const input = record(clone(value, path), path)
  exact(input, key === 'sceneId' ? LEDGER_FIELDS : DAILY_LEDGER_FIELDS, path)
  if (input.schemaVersion !== ABILITY_USAGE_LEDGER_SCHEMA_VERSION) {
    fail('invalid-ledger', `${path}.schemaVersion`, 'is unsupported.')
  }
  if (!Array.isArray(input.entries) || input.entries.length > ABILITY_USAGE_LEDGER_LIMITS.entries) {
    fail('limit-exceeded', `${path}.entries`, 'must be a bounded array.')
  }
  const entries = (input.entries as readonly unknown[]).map((entry, index) => (
    parseEntry(entry, index, path)
  ))
  const resourceKeys = entries.map(resourceKey)
  if (new Set(resourceKeys).size !== entries.length) {
    fail('duplicate-resource', `${path}.entries`, 'must not repeat an ability usage resource.')
  }
  const operationIds = entries.flatMap(entry => entry.operationIds)
  if (new Set(operationIds).size !== operationIds.length) {
    fail('duplicate-operation-id', `${path}.entries`, 'operation IDs must be unique across resources.')
  }
  const scope = input[key] === null ? null : stableId(input[key], `${path}.${key}`)
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_USAGE_LEDGER_SCHEMA_VERSION,
    [key]: scope,
    entries,
  }) as unknown as Key extends 'sceneId' ? AbilitySceneUsageLedger : AbilityDailyUsageLedger
}

export const createEmptyAbilitySceneUsageLedger = (): AbilitySceneUsageLedger => ({
  schemaVersion: ABILITY_USAGE_LEDGER_SCHEMA_VERSION,
  sceneId: null,
  entries: [],
})

export const createEmptyAbilityDailyUsageLedger = (): AbilityDailyUsageLedger => ({
  schemaVersion: ABILITY_USAGE_LEDGER_SCHEMA_VERSION,
  dayKey: null,
  entries: [],
})

export const parseAbilitySceneUsageLedger = (
  value: unknown,
  path = 'abilitySceneUsage',
): AbilitySceneUsageLedger => parseLedger(value, path, 'sceneId')

export const parseAbilityDailyUsageLedger = (
  value: unknown,
  path = 'abilityDailyUsage',
): AbilityDailyUsageLedger => parseLedger(value, path, 'dayKey')

export const abilityUsageResourceKey = resourceKey

/** Reset Scene usage only at an authoritative scene lifecycle transition. */
export const beginAbilitySceneUsagePeriod = (
  ledger: AbilitySceneUsageLedger,
  sceneId: string,
): AbilitySceneUsageLedger => {
  const current = parseAbilitySceneUsageLedger(ledger)
  if (current.sceneId === sceneId) return current
  return parseAbilitySceneUsageLedger({
    schemaVersion: ABILITY_USAGE_LEDGER_SCHEMA_VERSION,
    sceneId,
    entries: [],
  })
}

/** Reset Daily usage only at an authoritative campaign-day transition. */
export const beginAbilityDailyUsagePeriod = (
  ledger: AbilityDailyUsageLedger,
  dayKey: string,
): AbilityDailyUsageLedger => {
  const current = parseAbilityDailyUsageLedger(ledger)
  if (current.dayKey === dayKey) return current
  return parseAbilityDailyUsageLedger({
    schemaVersion: ABILITY_USAGE_LEDGER_SCHEMA_VERSION,
    dayKey,
    entries: [],
  })
}
