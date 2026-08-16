import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const EQUIPMENT_PROVIDER_RECEIPT_SCHEMA_VERSION = 1 as const
export const EQUIPMENT_PROVIDER_RECEIPT_LIMIT = 4_096 as const

export interface EquipmentProviderReceiptRollV1 {
  readonly rollId: string
  readonly sides: number
  readonly result: number
}
export interface EquipmentProviderReceiptV1 {
  readonly receiptId: string
  readonly eventId: string
  readonly eventSequence: number
  readonly eventSha256: string
  readonly routeSha256: string
  readonly frequencyKeySha256: string | null
  readonly sceneId: string | null
  readonly outcome: 'applied' | 'no-effect' | 'passed'
  readonly choiceId: string | null
  readonly rolls: readonly EquipmentProviderReceiptRollV1[]
  readonly effectSha256: string
}
export interface EquipmentProviderReceiptStateV1 {
  readonly schemaVersion: typeof EQUIPMENT_PROVIDER_RECEIPT_SCHEMA_VERSION
  readonly entries: readonly EquipmentProviderReceiptV1[]
}

export class EquipmentProviderReceiptValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'EquipmentProviderReceiptValidationError'
  }
}
type UnknownRecord = Record<string, unknown>
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA = /^[a-f0-9]{64}$/
const fail = (path: string, detail: string): never => { throw new EquipmentProviderReceiptValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail(path, 'must be an object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.hasOwn(value, field)) || Object.keys(value).some(field => !expected.has(field))) fail(path, 'has an invalid shape.')
}
const id = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length > 200 || !ID.test(value)) fail(path, 'must be a bounded stable ID.')
  return value as string
}
const hash = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !SHA.test(value)) fail(path, 'must be a lowercase SHA-256 digest.')
  return value as string
}
const nullableId = (value: unknown, path: string): string | null => value === null ? null : id(value, path)

export const createEmptyEquipmentProviderReceiptState = (): EquipmentProviderReceiptStateV1 => ({
  schemaVersion: EQUIPMENT_PROVIDER_RECEIPT_SCHEMA_VERSION,
  entries: [],
})
export const parseEquipmentProviderReceiptState = (
  value: unknown,
  path = 'equipmentProviderReceipts',
): EquipmentProviderReceiptStateV1 => {
  const cloned = cloneStrictJson(value, path, {
    limits: { depth: 5, nodes: 40_000, objectFields: 16, arrayEntries: EQUIPMENT_PROVIDER_RECEIPT_LIMIT, stringLength: 200, objectKeyLength: 160 },
    rootLabel: 'equipment provider receipts', valueLabel: 'equipment provider receipts',
    failNotJson: (failurePath, detail) => fail(failurePath, detail),
    failLimit: (failurePath, detail) => fail(failurePath, detail),
  })
  const input = record(cloned, path)
  exact(input, ['schemaVersion', 'entries'], path)
  if (input.schemaVersion !== 1) fail(`${path}.schemaVersion`, 'is unsupported.')
  if (!Array.isArray(input.entries) || input.entries.length > EQUIPMENT_PROVIDER_RECEIPT_LIMIT) fail(`${path}.entries`, 'must be bounded.')
  const entries = (input.entries as readonly unknown[]).map((value, index): EquipmentProviderReceiptV1 => {
    const entryPath = `${path}.entries[${index}]`
    const entry = record(value, entryPath)
    exact(entry, ['receiptId', 'eventId', 'eventSequence', 'eventSha256', 'routeSha256', 'frequencyKeySha256', 'sceneId', 'outcome', 'choiceId', 'rolls', 'effectSha256'], entryPath)
    if (!Number.isSafeInteger(entry.eventSequence) || Number(entry.eventSequence) < 0) fail(`${entryPath}.eventSequence`, 'must be a non-negative sequence.')
    if (!['applied', 'no-effect', 'passed'].includes(String(entry.outcome))) fail(`${entryPath}.outcome`, 'is unsupported.')
    if (!Array.isArray(entry.rolls) || entry.rolls.length > 8) fail(`${entryPath}.rolls`, 'must be bounded.')
    const rolls = (entry.rolls as readonly unknown[]).map((value, rollIndex): EquipmentProviderReceiptRollV1 => {
      const rollPath = `${entryPath}.rolls[${rollIndex}]`
      const roll = record(value, rollPath)
      exact(roll, ['rollId', 'sides', 'result'], rollPath)
      if (!Number.isSafeInteger(roll.sides) || Number(roll.sides) < 2 || Number(roll.sides) > 1_000) fail(`${rollPath}.sides`, 'is invalid.')
      if (!Number.isSafeInteger(roll.result) || Number(roll.result) < 1 || Number(roll.result) > Number(roll.sides)) fail(`${rollPath}.result`, 'is invalid.')
      return { rollId: id(roll.rollId, `${rollPath}.rollId`), sides: Number(roll.sides), result: Number(roll.result) }
    })
    if (new Set(rolls.map(roll => roll.rollId)).size !== rolls.length) fail(`${entryPath}.rolls`, 'must not repeat roll IDs.')
    return {
      receiptId: id(entry.receiptId, `${entryPath}.receiptId`),
      eventId: id(entry.eventId, `${entryPath}.eventId`),
      eventSequence: Number(entry.eventSequence),
      eventSha256: hash(entry.eventSha256, `${entryPath}.eventSha256`),
      routeSha256: hash(entry.routeSha256, `${entryPath}.routeSha256`),
      frequencyKeySha256: entry.frequencyKeySha256 === null ? null : hash(entry.frequencyKeySha256, `${entryPath}.frequencyKeySha256`),
      sceneId: nullableId(entry.sceneId, `${entryPath}.sceneId`),
      outcome: entry.outcome as EquipmentProviderReceiptV1['outcome'],
      choiceId: nullableId(entry.choiceId, `${entryPath}.choiceId`),
      rolls,
      effectSha256: hash(entry.effectSha256, `${entryPath}.effectSha256`),
    }
  })
  if (new Set(entries.map(entry => entry.receiptId)).size !== entries.length) fail(`${path}.entries`, 'must not repeat receipt IDs.')
  if (new Set(entries.map(entry => `${entry.eventId}:${entry.routeSha256}`)).size !== entries.length) fail(`${path}.entries`, 'must not repeat event-route identities.')
  return deepFreezeStrictJson({ schemaVersion: EQUIPMENT_PROVIDER_RECEIPT_SCHEMA_VERSION, entries })
}
