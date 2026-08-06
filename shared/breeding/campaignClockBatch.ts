import {
  parseBreedingOperationIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingOperationId,
  type PokemonEggId,
} from './ids'
import { BREEDING_OPERATION_REJECTION_REASON_IDS, type BreedingOperationRejectionReasonId } from './operations'

export const BREEDING_CAMPAIGN_CLOCK_EGG_BATCH_MAXIMUM = 100 as const

export interface BreedingCampaignClockEggBatchEntryV1 {
  readonly eggId: PokemonEggId
  readonly operationId: BreedingOperationId
  readonly executionKind: 'executed' | 'exact-retry' | 'pending'
  readonly status: 'accepted' | 'rejected' | 'pending'
  readonly reasonId: BreedingOperationRejectionReasonId | null
  readonly eggRevisionBefore: number
  readonly eggRevisionAfter: number | null
  readonly creditedCampaignMinutes: number | null
  readonly skippedCampaignMinutes: number | null
  readonly overflowCampaignMinutes: number | null
  readonly reachedReady: boolean | null
}

export interface BreedingCampaignClockEggBatchProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm'
  readonly parentOperationId: BreedingOperationId
  readonly parentExecutionKind: 'executed' | 'exact-retry' | 'pending'
  readonly parentStatus: 'accepted' | 'rejected' | 'pending'
  readonly clockRevision: number
  readonly campaignMinute: number
  readonly entries: readonly BreedingCampaignClockEggBatchEntryV1[]
  readonly hasMoreDueEggs: boolean
}

export type BreedingCampaignClockBatchValidationCode =
  | 'breeding.clock-batch.invalid-document'
  | 'breeding.clock-batch.unknown-field'
  | 'breeding.clock-batch.invalid-id'
  | 'breeding.clock-batch.invalid-invariant'

export class BreedingCampaignClockBatchValidationError extends Error {
  readonly code: BreedingCampaignClockBatchValidationCode
  readonly path: string

  constructor(code: BreedingCampaignClockBatchValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingCampaignClockBatchValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const REJECTIONS = new Set<string>(BREEDING_OPERATION_REJECTION_REASON_IDS)
const fail = (code: BreedingCampaignClockBatchValidationCode, path: string, message: string): never => {
  throw new BreedingCampaignClockBatchValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('breeding.clock-batch.invalid-document', path, 'must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.clock-batch.invalid-document', path, 'must be plain data without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.clock-batch.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.keys(row).some(field => !allowed.has(field))) {
    fail('breeding.clock-batch.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const strictArray = (value: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > BREEDING_CAMPAIGN_CLOCK_EGG_BATCH_MAXIMUM
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.clock-batch.invalid-document', path, 'must be a strict bounded array.')
  }
  if (Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return fail('breeding.clock-batch.invalid-document', path, 'must not be sparse or enriched.')
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.clock-batch.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.')
    }
  }
  return value
}
const integer = (value: unknown, path: string, minimum = 0): number => (
  Number.isSafeInteger(value) && (value as number) >= minimum
    ? value as number
    : fail('breeding.clock-batch.invalid-document', path, `must be a safe integer no less than ${minimum}.`)
)
const nullableInteger = (value: unknown, path: string): number | null => (
  value === null ? null : integer(value, path)
)

const parseEntry = (value: unknown, path: string): BreedingCampaignClockEggBatchEntryV1 => {
  const row = exact(value, [
    'eggId', 'operationId', 'executionKind', 'status', 'reasonId', 'eggRevisionBefore',
    'eggRevisionAfter', 'creditedCampaignMinutes', 'skippedCampaignMinutes',
    'overflowCampaignMinutes', 'reachedReady',
  ], path)
  if ((row.executionKind !== 'executed' && row.executionKind !== 'exact-retry' && row.executionKind !== 'pending')
    || (row.status !== 'accepted' && row.status !== 'rejected' && row.status !== 'pending')
    || (row.reasonId !== null && (typeof row.reasonId !== 'string' || !REJECTIONS.has(row.reasonId)))
    || (row.reachedReady !== null && typeof row.reachedReady !== 'boolean')) {
    return fail('breeding.clock-batch.invalid-document', path, 'must be one v1 Egg batch result entry.')
  }
  const eggRevisionBefore = integer(row.eggRevisionBefore, `${path}.eggRevisionBefore`)
  const eggRevisionAfter = nullableInteger(row.eggRevisionAfter, `${path}.eggRevisionAfter`)
  const credited = nullableInteger(row.creditedCampaignMinutes, `${path}.creditedCampaignMinutes`)
  const skipped = nullableInteger(row.skippedCampaignMinutes, `${path}.skippedCampaignMinutes`)
  const overflow = nullableInteger(row.overflowCampaignMinutes, `${path}.overflowCampaignMinutes`)
  const resultValuesAreNull = eggRevisionAfter === null && credited === null && skipped === null
    && overflow === null && row.reachedReady === null
  if ((row.executionKind === 'pending') !== (row.status === 'pending')
    || (row.status === 'rejected') !== (row.reasonId !== null)
    || (row.status === 'accepted' && (row.reasonId !== null || eggRevisionAfter !== eggRevisionBefore + 1
      || credited === null || skipped === null || overflow === null || row.reachedReady === null))
    || (row.status !== 'accepted' && !resultValuesAreNull)) {
    return fail('breeding.clock-batch.invalid-invariant', path, 'execution, terminal status, revision, segment totals, and reason must agree.')
  }
  return Object.freeze({
    eggId: parsePokemonEggIdSyntax(row.eggId)
      ?? fail('breeding.clock-batch.invalid-id', `${path}.eggId`, 'must be an Egg ID.'),
    operationId: parseBreedingOperationIdSyntax(row.operationId)
      ?? fail('breeding.clock-batch.invalid-id', `${path}.operationId`, 'must be an operation ID.'),
    executionKind: row.executionKind,
    status: row.status,
    reasonId: row.reasonId as BreedingOperationRejectionReasonId | null,
    eggRevisionBefore,
    eggRevisionAfter,
    creditedCampaignMinutes: credited,
    skippedCampaignMinutes: skipped,
    overflowCampaignMinutes: overflow,
    reachedReady: row.reachedReady,
  }) as BreedingCampaignClockEggBatchEntryV1
}

export const parseBreedingCampaignClockEggBatchProjectionV1 = (
  value: unknown,
  path = 'clockBatchProjection',
): BreedingCampaignClockEggBatchProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'audience', 'parentOperationId', 'parentExecutionKind', 'parentStatus',
    'clockRevision', 'campaignMinute', 'entries', 'hasMoreDueEggs',
  ], path)
  if (row.schemaVersion !== 1 || row.audience !== 'gm'
    || (row.parentExecutionKind !== 'executed' && row.parentExecutionKind !== 'exact-retry' && row.parentExecutionKind !== 'pending')
    || (row.parentStatus !== 'accepted' && row.parentStatus !== 'rejected' && row.parentStatus !== 'pending')
    || typeof row.hasMoreDueEggs !== 'boolean') {
    return fail('breeding.clock-batch.invalid-document', path, 'must be a GM-only v1 campaign-clock Egg batch projection.')
  }
  const entries = strictArray(row.entries, `${path}.entries`).map((entry, index) => (
    parseEntry(entry, `${path}.entries[${index}]`)
  ))
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]!.eggId >= entries[index]!.eggId) {
      fail('breeding.clock-batch.invalid-invariant', `${path}.entries`, 'must be unique in Egg-ID order.')
    }
  }
  if ((row.parentExecutionKind === 'pending') !== (row.parentStatus === 'pending')
    || (row.parentStatus !== 'accepted' && entries.length !== 0)) {
    fail('breeding.clock-batch.invalid-invariant', path, 'parent execution and child entry cardinality must agree.')
  }
  return Object.freeze({
    schemaVersion: 1,
    audience: 'gm',
    parentOperationId: parseBreedingOperationIdSyntax(row.parentOperationId)
      ?? fail('breeding.clock-batch.invalid-id', `${path}.parentOperationId`, 'must be an operation ID.'),
    parentExecutionKind: row.parentExecutionKind,
    parentStatus: row.parentStatus,
    clockRevision: integer(row.clockRevision, `${path}.clockRevision`),
    campaignMinute: integer(row.campaignMinute, `${path}.campaignMinute`),
    entries: Object.freeze(entries),
    hasMoreDueEggs: row.hasMoreDueEggs,
  })
}
