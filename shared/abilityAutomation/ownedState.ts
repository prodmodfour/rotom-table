import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const ABILITY_OWNED_STATE_SCHEMA_VERSION = 1 as const
export const ABILITY_OWNED_STATE_KINDS = ['mark', 'counter', 'token', 'mode', 'form'] as const
export const ABILITY_OWNED_STATE_LIFECYCLES = [
  'turn', 'scene', 'source-presence', 'source-ability', 'target-presence',
] as const
export type AbilityOwnedStateKind = (typeof ABILITY_OWNED_STATE_KINDS)[number]
export type AbilityOwnedStateLifecycleKind = (typeof ABILITY_OWNED_STATE_LIFECYCLES)[number]

export type AbilityOwnedStatePayload =
  | { readonly kind: 'mark'; readonly markId: string }
  | { readonly kind: 'counter'; readonly value: number; readonly minimum: number; readonly maximum: number }
  | { readonly kind: 'token'; readonly tokenId: string; readonly quantity: number; readonly maximum: number }
  | { readonly kind: 'mode'; readonly modeId: string }
  | { readonly kind: 'form'; readonly formId: string }

export interface AbilityOwnedStateLifecycle {
  readonly kind: AbilityOwnedStateLifecycleKind
  readonly targetPolicy: 'any-target-leaves' | 'all-targets-leave' | null
}

export interface AbilityOwnedStateEntry {
  readonly stateId: string
  readonly version: number
  readonly ownerPlacementId: string
  readonly sourceAbilityInstanceId: string
  readonly canonicalId: string
  readonly targetPlacementIds: readonly string[]
  readonly lifecycle: AbilityOwnedStateLifecycle
  readonly payload: AbilityOwnedStatePayload
  readonly createdOperationId: string
  readonly lastOperationId: string
}

export interface AbilityOwnedStateReceipt {
  readonly operationId: string
  readonly stateId: string
  readonly requestSha256: string
  readonly outcome: 'created' | 'updated' | 'removed'
  readonly resultVersion: number | null
}

export interface AbilityOwnedState {
  readonly schemaVersion: typeof ABILITY_OWNED_STATE_SCHEMA_VERSION
  readonly entries: readonly AbilityOwnedStateEntry[]
  readonly receipts: readonly AbilityOwnedStateReceipt[]
}

export const ABILITY_OWNED_STATE_LIMITS = Object.freeze({
  entries: 512,
  receipts: 2_048,
  targetsPerEntry: 64,
  identifierLength: 200,
  numericMagnitude: 1_000_000,
  version: 1_000_000,
})

export type AbilityOwnedStateValidationCode =
  | 'invalid-owned-state'
  | 'duplicate-state-id'
  | 'duplicate-operation-id'
  | 'limit-exceeded'
  | 'not-json'

export class AbilityOwnedStateValidationError extends Error {
  readonly code: AbilityOwnedStateValidationCode
  readonly path: string

  constructor(code: AbilityOwnedStateValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityOwnedStateValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const ROOT_FIELDS = ['schemaVersion', 'entries', 'receipts'] as const
const ENTRY_FIELDS = [
  'stateId', 'version', 'ownerPlacementId', 'sourceAbilityInstanceId', 'canonicalId',
  'targetPlacementIds', 'lifecycle', 'payload', 'createdOperationId', 'lastOperationId',
] as const
const LIFECYCLE_FIELDS = ['kind', 'targetPolicy'] as const
const RECEIPT_FIELDS = [
  'operationId', 'stateId', 'requestSha256', 'outcome', 'resultVersion',
] as const
const PAYLOAD_FIELDS: Record<AbilityOwnedStateKind, readonly string[]> = {
  mark: ['kind', 'markId'],
  counter: ['kind', 'value', 'minimum', 'maximum'],
  token: ['kind', 'tokenId', 'quantity', 'maximum'],
  mode: ['kind', 'modeId'],
  form: ['kind', 'formId'],
}
const KIND_SET = new Set<string>(ABILITY_OWNED_STATE_KINDS)
const LIFECYCLE_SET = new Set<string>(ABILITY_OWNED_STATE_LIFECYCLES)
const OUTCOME_SET = new Set<string>(['created', 'updated', 'removed'])
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

const fail = (code: AbilityOwnedStateValidationCode, path: string, detail: string): never => {
  throw new AbilityOwnedStateValidationError(code, path, detail)
}

const clone = (value: unknown, path: string) => cloneStrictJson(value, path, {
  limits: {
    depth: 7,
    nodes: 32_768,
    objectFields: 16,
    arrayEntries: ABILITY_OWNED_STATE_LIMITS.receipts,
    stringLength: ABILITY_OWNED_STATE_LIMITS.identifierLength,
    objectKeyLength: ABILITY_OWNED_STATE_LIMITS.identifierLength,
  },
  rootLabel: 'ability-owned state',
  valueLabel: 'ability-owned state',
  failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
  failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
})

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail('invalid-owned-state', path, 'must be an object.')
  return value
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (
    fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))
  ) fail('invalid-owned-state', path, 'has an invalid shape.')
}

const stableId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ABILITY_OWNED_STATE_LIMITS.identifierLength
    || !STABLE_ID_PATTERN.test(value)
  ) return fail('invalid-owned-state', path, 'must be a bounded stable identifier.')
  return value
}

const boundedInteger = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    return fail('invalid-owned-state', path, `must be an integer from ${minimum} through ${maximum}.`)
  }
  return Number(value)
}

const parsePayload = (value: unknown, path: string): AbilityOwnedStatePayload => {
  const input = record(value, path)
  if (typeof input.kind !== 'string' || !KIND_SET.has(input.kind)) {
    fail('invalid-owned-state', `${path}.kind`, 'is unsupported.')
  }
  const kind = input.kind as AbilityOwnedStateKind
  exact(input, PAYLOAD_FIELDS[kind], path)
  if (kind === 'mark') return Object.freeze({ kind, markId: stableId(input.markId, `${path}.markId`) })
  if (kind === 'mode') return Object.freeze({ kind, modeId: stableId(input.modeId, `${path}.modeId`) })
  if (kind === 'form') return Object.freeze({ kind, formId: stableId(input.formId, `${path}.formId`) })
  if (kind === 'counter') {
    const minimum = boundedInteger(
      input.minimum,
      `${path}.minimum`,
      -ABILITY_OWNED_STATE_LIMITS.numericMagnitude,
      ABILITY_OWNED_STATE_LIMITS.numericMagnitude,
    )
    const maximum = boundedInteger(
      input.maximum,
      `${path}.maximum`,
      -ABILITY_OWNED_STATE_LIMITS.numericMagnitude,
      ABILITY_OWNED_STATE_LIMITS.numericMagnitude,
    )
    if (minimum > maximum) fail('invalid-owned-state', path, 'counter bounds are inverted.')
    const value = boundedInteger(input.value, `${path}.value`, minimum, maximum)
    return Object.freeze({ kind, value, minimum, maximum })
  }
  const maximum = boundedInteger(
    input.maximum,
    `${path}.maximum`,
    1,
    ABILITY_OWNED_STATE_LIMITS.numericMagnitude,
  )
  return Object.freeze({
    kind,
    tokenId: stableId(input.tokenId, `${path}.tokenId`),
    quantity: boundedInteger(input.quantity, `${path}.quantity`, 0, maximum),
    maximum,
  })
}

const parseLifecycle = (value: unknown, path: string): AbilityOwnedStateLifecycle => {
  const input = record(value, path)
  exact(input, LIFECYCLE_FIELDS, path)
  if (typeof input.kind !== 'string' || !LIFECYCLE_SET.has(input.kind)) {
    fail('invalid-owned-state', `${path}.kind`, 'is unsupported.')
  }
  const kind = input.kind as AbilityOwnedStateLifecycleKind
  const targetPolicy = input.targetPolicy === null
    ? null
    : input.targetPolicy === 'any-target-leaves' || input.targetPolicy === 'all-targets-leave'
      ? input.targetPolicy
      : fail('invalid-owned-state', `${path}.targetPolicy`, 'is unsupported.')
  if ((kind === 'target-presence') !== (targetPolicy !== null)) {
    fail('invalid-owned-state', path, 'target policy is required only for target-presence.')
  }
  return Object.freeze({ kind, targetPolicy })
}

const parseEntry = (value: unknown, index: number, path: string): AbilityOwnedStateEntry => {
  const entryPath = `${path}.entries[${index}]`
  const input = record(value, entryPath)
  exact(input, ENTRY_FIELDS, entryPath)
  if (!Array.isArray(input.targetPlacementIds)
    || input.targetPlacementIds.length > ABILITY_OWNED_STATE_LIMITS.targetsPerEntry) {
    fail('limit-exceeded', `${entryPath}.targetPlacementIds`, 'must be a bounded array.')
  }
  const targetPlacementIds = (input.targetPlacementIds as readonly unknown[]).map((id, targetIndex) => (
    stableId(id, `${entryPath}.targetPlacementIds[${targetIndex}]`)
  ))
  if (new Set(targetPlacementIds).size !== targetPlacementIds.length) {
    fail('invalid-owned-state', `${entryPath}.targetPlacementIds`, 'must not repeat targets.')
  }
  const lifecycle = parseLifecycle(input.lifecycle, `${entryPath}.lifecycle`)
  if (lifecycle.kind === 'target-presence' && targetPlacementIds.length === 0) {
    fail('invalid-owned-state', entryPath, 'target-presence requires linked targets.')
  }
  return Object.freeze({
    stateId: stableId(input.stateId, `${entryPath}.stateId`),
    version: boundedInteger(input.version, `${entryPath}.version`, 1, ABILITY_OWNED_STATE_LIMITS.version),
    ownerPlacementId: stableId(input.ownerPlacementId, `${entryPath}.ownerPlacementId`),
    sourceAbilityInstanceId: stableId(
      input.sourceAbilityInstanceId,
      `${entryPath}.sourceAbilityInstanceId`,
    ),
    canonicalId: typeof input.canonicalId === 'string' && input.canonicalId.length > 0
      && input.canonicalId.length <= 160 && input.canonicalId.trim() === input.canonicalId
      ? input.canonicalId
      : fail('invalid-owned-state', `${entryPath}.canonicalId`, 'must be bounded canonical text.'),
    targetPlacementIds: Object.freeze(targetPlacementIds),
    lifecycle,
    payload: parsePayload(input.payload, `${entryPath}.payload`),
    createdOperationId: stableId(input.createdOperationId, `${entryPath}.createdOperationId`),
    lastOperationId: stableId(input.lastOperationId, `${entryPath}.lastOperationId`),
  })
}

export const createEmptyAbilityOwnedState = (): AbilityOwnedState => ({
  schemaVersion: ABILITY_OWNED_STATE_SCHEMA_VERSION,
  entries: [],
  receipts: [],
})

export const parseAbilityOwnedState = (
  value: unknown,
  path = 'abilityOwnedState',
): AbilityOwnedState => {
  const input = record(clone(value, path), path)
  exact(input, ROOT_FIELDS, path)
  if (input.schemaVersion !== ABILITY_OWNED_STATE_SCHEMA_VERSION) {
    fail('invalid-owned-state', `${path}.schemaVersion`, 'is unsupported.')
  }
  if (!Array.isArray(input.entries) || input.entries.length > ABILITY_OWNED_STATE_LIMITS.entries) {
    fail('limit-exceeded', `${path}.entries`, 'must be a bounded array.')
  }
  const entries = (input.entries as readonly unknown[]).map((entry, index) => (
    parseEntry(entry, index, path)
  ))
  if (new Set(entries.map(entry => entry.stateId)).size !== entries.length) {
    fail('duplicate-state-id', `${path}.entries`, 'must not repeat state IDs.')
  }
  if (!Array.isArray(input.receipts) || input.receipts.length > ABILITY_OWNED_STATE_LIMITS.receipts) {
    fail('limit-exceeded', `${path}.receipts`, 'must be a bounded array.')
  }
  const receipts = (input.receipts as readonly unknown[]).map((value, index): AbilityOwnedStateReceipt => {
    const receiptPath = `${path}.receipts[${index}]`
    const receipt = record(value, receiptPath)
    exact(receipt, RECEIPT_FIELDS, receiptPath)
    if (typeof receipt.requestSha256 !== 'string' || !SHA256_PATTERN.test(receipt.requestSha256)) {
      fail('invalid-owned-state', `${receiptPath}.requestSha256`, 'must be SHA-256.')
    }
    if (typeof receipt.outcome !== 'string' || !OUTCOME_SET.has(receipt.outcome)) {
      fail('invalid-owned-state', `${receiptPath}.outcome`, 'is unsupported.')
    }
    const resultVersion = receipt.resultVersion === null
      ? null
      : boundedInteger(receipt.resultVersion, `${receiptPath}.resultVersion`, 1, ABILITY_OWNED_STATE_LIMITS.version)
    if ((receipt.outcome === 'removed') !== (resultVersion === null)) {
      fail('invalid-owned-state', receiptPath, 'removed outcome alone has no result version.')
    }
    return Object.freeze({
      operationId: stableId(receipt.operationId, `${receiptPath}.operationId`),
      stateId: stableId(receipt.stateId, `${receiptPath}.stateId`),
      requestSha256: receipt.requestSha256 as string,
      outcome: receipt.outcome as AbilityOwnedStateReceipt['outcome'],
      resultVersion,
    })
  })
  if (new Set(receipts.map(receipt => receipt.operationId)).size !== receipts.length) {
    fail('duplicate-operation-id', `${path}.receipts`, 'must not repeat operation IDs.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_OWNED_STATE_SCHEMA_VERSION,
    entries,
    receipts,
  })
}
