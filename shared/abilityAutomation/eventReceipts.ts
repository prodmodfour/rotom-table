import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_EVENT_RECEIPT_SCHEMA_VERSION = 1 as const
export const ABILITY_EVENT_RECEIPT_LIMIT = 4_096 as const

export interface AbilityEventEmissionReceipt {
  readonly applicationId: string
  readonly eventId: string
  readonly eventSha256: string
  readonly eventSequence: number
}

export interface AbilityEventReceiptState {
  readonly schemaVersion: typeof ABILITY_EVENT_RECEIPT_SCHEMA_VERSION
  readonly entries: readonly AbilityEventEmissionReceipt[]
}

export type AbilityEventReceiptValidationCode =
  | 'invalid-receipts'
  | 'duplicate-application-id'
  | 'duplicate-event-id'
  | 'limit-exceeded'
  | 'not-json'

export class AbilityEventReceiptValidationError extends Error {
  readonly code: AbilityEventReceiptValidationCode
  readonly path: string

  constructor(code: AbilityEventReceiptValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityEventReceiptValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = ['schemaVersion', 'entries'] as const
const ENTRY_FIELDS = ['applicationId', 'eventId', 'eventSha256', 'eventSequence'] as const
const ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA_PATTERN = /^[a-f0-9]{64}$/

const fail = (
  code: AbilityEventReceiptValidationCode,
  path: string,
  detail: string,
): never => {
  throw new AbilityEventReceiptValidationError(code, path, detail)
}

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail('invalid-receipts', path, 'must be an object.')
  return value
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))) {
    fail('invalid-receipts', path, 'has an invalid shape.')
  }
}

const stableId = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length > 200 || !ID_PATTERN.test(value)) {
    return fail('invalid-receipts', path, 'must be a bounded stable identifier.')
  }
  return value
}

export const createEmptyAbilityEventReceiptState = (): AbilityEventReceiptState => ({
  schemaVersion: ABILITY_EVENT_RECEIPT_SCHEMA_VERSION,
  entries: [],
})

export const parseAbilityEventReceiptState = (
  value: unknown,
  path = 'abilityEventReceipts',
): AbilityEventReceiptState => {
  const cloned = cloneStrictJson(value, path, {
    limits: {
      depth: 4,
      nodes: 20_000,
      objectFields: 8,
      arrayEntries: ABILITY_EVENT_RECEIPT_LIMIT,
      stringLength: 200,
      objectKeyLength: 160,
    },
    rootLabel: 'ability event receipts',
    valueLabel: 'ability event receipts',
    failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
    failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
  })
  const input = record(cloned, path)
  exact(input, ROOT_FIELDS, path)
  if (input.schemaVersion !== ABILITY_EVENT_RECEIPT_SCHEMA_VERSION) {
    fail('invalid-receipts', `${path}.schemaVersion`, 'is unsupported.')
  }
  if (!Array.isArray(input.entries) || input.entries.length > ABILITY_EVENT_RECEIPT_LIMIT) {
    fail('limit-exceeded', `${path}.entries`, 'must be a bounded array.')
  }
  const entries = (input.entries as readonly unknown[]).map((value, index): AbilityEventEmissionReceipt => {
    const entryPath = `${path}.entries[${index}]`
    const entry = record(value, entryPath)
    exact(entry, ENTRY_FIELDS, entryPath)
    if (typeof entry.eventSha256 !== 'string' || !SHA_PATTERN.test(entry.eventSha256)) {
      fail('invalid-receipts', `${entryPath}.eventSha256`, 'must be SHA-256.')
    }
    if (!Number.isSafeInteger(entry.eventSequence) || Number(entry.eventSequence) < 0) {
      fail('invalid-receipts', `${entryPath}.eventSequence`, 'must be a non-negative sequence.')
    }
    return Object.freeze({
      applicationId: stableId(entry.applicationId, `${entryPath}.applicationId`),
      eventId: stableId(entry.eventId, `${entryPath}.eventId`),
      eventSha256: entry.eventSha256 as string,
      eventSequence: Number(entry.eventSequence),
    })
  })
  if (new Set(entries.map(entry => entry.applicationId)).size !== entries.length) {
    fail('duplicate-application-id', `${path}.entries`, 'must not repeat application IDs.')
  }
  if (new Set(entries.map(entry => entry.eventId)).size !== entries.length) {
    fail('duplicate-event-id', `${path}.entries`, 'must not repeat event IDs.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_EVENT_RECEIPT_SCHEMA_VERSION,
    entries,
  })
}
