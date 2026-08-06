import { isSlug } from '../paths'
import {
  parseBreedingOperationIdSyntax,
  parseBreedingProjectIdSyntax,
  type BreedingOperationId,
  type BreedingProjectId,
} from './ids'

export const BREEDING_ADDITIONAL_PROGRESS_SEGMENT_SCHEMA_VERSION = 1 as const
export const BREEDING_ADDITIONAL_PROGRESS_PROJECTION_SCHEMA_VERSION = 1 as const

export interface BreedingAdditionalProgressParentRefV1 {
  readonly pokemonSheetSlug: string
  readonly ownerTrainerSlug: string
  readonly expectedSheetRevision: number
}
export interface BreedingAdditionalProgressSegmentAuthorityV1 {
  readonly schemaVersion: 1
  readonly operationId: BreedingOperationId
  readonly commandSha256: string
  readonly projectId: BreedingProjectId
  readonly projectRevision: number
  readonly projectDefinitionSha256: string
  readonly throughClockRevision: number
  readonly creditedFromCampaignMinute: number
  readonly throughCampaignMinute: number
  readonly parentRefs: readonly [BreedingAdditionalProgressParentRefV1, BreedingAdditionalProgressParentRefV1]
  readonly definitionSha256: string
}
export interface BreedingAdditionalProgressProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm' | 'owner'
  readonly status: 'additional-time-in-progress' | 'ready-to-produce'
  readonly additionalRequiredCampaignMinutes: 240
  readonly additionalAccumulatedCampaignMinutes: number
  readonly additionalRemainingCampaignMinutes: number
  readonly readyToProduceAtCampaignMinute: number | null
}

export type BreedingAdditionalProgressValidationCode =
  | 'breeding.additional-progress.invalid-document'
  | 'breeding.additional-progress.unknown-field'
  | 'breeding.additional-progress.invalid-id'
  | 'breeding.additional-progress.invalid-invariant'
export class BreedingAdditionalProgressValidationError extends Error {
  readonly code: BreedingAdditionalProgressValidationCode
  readonly path: string
  constructor(code: BreedingAdditionalProgressValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingAdditionalProgressValidationError'
    this.code = code
    this.path = path
  }
}
type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const fail = (code: BreedingAdditionalProgressValidationCode, path: string, message: string): never => {
  throw new BreedingAdditionalProgressValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('breeding.additional-progress.invalid-document', path, 'must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.additional-progress.invalid-document', path, 'must be plain data without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.additional-progress.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) {
    fail('breeding.additional-progress.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    return fail('breeding.additional-progress.invalid-document', path, `must be a nonnegative safe integer no greater than ${maximum}.`)
  }
  return Number(value)
}
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.additional-progress.invalid-document', path, 'must be a lowercase SHA-256 digest.')
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160
  ? value
  : fail('breeding.additional-progress.invalid-id', path, 'must be a bounded canonical sheet slug.')
const parentRef = (value: unknown, path: string): BreedingAdditionalProgressParentRefV1 => {
  const row = exact(value, ['pokemonSheetSlug', 'ownerTrainerSlug', 'expectedSheetRevision'], path)
  return Object.freeze({
    pokemonSheetSlug: slug(row.pokemonSheetSlug, `${path}.pokemonSheetSlug`),
    ownerTrainerSlug: slug(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`),
    expectedSheetRevision: integer(row.expectedSheetRevision, `${path}.expectedSheetRevision`, 2_147_483_647),
  })
}
const parentRefs = (value: unknown, path: string): readonly [BreedingAdditionalProgressParentRefV1, BreedingAdditionalProgressParentRefV1] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== 2
    || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== 3) {
    return fail('breeding.additional-progress.invalid-document', path, 'must be a plain two-parent tuple.')
  }
  for (let index = 0; index < 2; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.additional-progress.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.')
    }
  }
  const parsed = [parentRef(value[0], `${path}[0]`), parentRef(value[1], `${path}[1]`)] as const
  if (parsed[0].pokemonSheetSlug === parsed[1].pokemonSheetSlug) {
    fail('breeding.additional-progress.invalid-invariant', path, 'must identify two distinct parent sheets.')
  }
  return Object.freeze(parsed)
}
const freeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
    Object.freeze(value)
  }
  return value
}

export const parseBreedingAdditionalProgressSegmentAuthorityV1 = (
  value: unknown,
  path = 'additionalProgressSegmentAuthority',
): BreedingAdditionalProgressSegmentAuthorityV1 => {
  const row = exact(value, [
    'schemaVersion', 'operationId', 'commandSha256', 'projectId', 'projectRevision',
    'projectDefinitionSha256', 'throughClockRevision', 'creditedFromCampaignMinute',
    'throughCampaignMinute', 'parentRefs', 'definitionSha256',
  ], path)
  if (row.schemaVersion !== 1) {
    fail('breeding.additional-progress.invalid-document', `${path}.schemaVersion`, 'must equal 1.')
  }
  const operationId = parseBreedingOperationIdSyntax(row.operationId)
    ?? fail('breeding.additional-progress.invalid-id', `${path}.operationId`, 'must be a Breeding operation ID.')
  const projectId = parseBreedingProjectIdSyntax(row.projectId)
    ?? fail('breeding.additional-progress.invalid-id', `${path}.projectId`, 'must be a Breeding Project ID.')
  const creditedFrom = integer(row.creditedFromCampaignMinute, `${path}.creditedFromCampaignMinute`)
  const through = integer(row.throughCampaignMinute, `${path}.throughCampaignMinute`)
  if (creditedFrom > through) {
    fail('breeding.additional-progress.invalid-invariant', path, 'credited interval cannot begin after its through minute.')
  }
  return freeze({
    schemaVersion: 1,
    operationId,
    commandSha256: hash(row.commandSha256, `${path}.commandSha256`),
    projectId,
    projectRevision: integer(row.projectRevision, `${path}.projectRevision`, 2_147_483_647),
    projectDefinitionSha256: hash(row.projectDefinitionSha256, `${path}.projectDefinitionSha256`),
    throughClockRevision: integer(row.throughClockRevision, `${path}.throughClockRevision`, 2_147_483_647),
    creditedFromCampaignMinute: creditedFrom,
    throughCampaignMinute: through,
    parentRefs: parentRefs(row.parentRefs, `${path}.parentRefs`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  }) as BreedingAdditionalProgressSegmentAuthorityV1
}

export const parseBreedingAdditionalProgressProjectionV1 = (
  value: unknown,
  path = 'additionalProgressProjection',
): BreedingAdditionalProgressProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'audience', 'status', 'additionalRequiredCampaignMinutes',
    'additionalAccumulatedCampaignMinutes', 'additionalRemainingCampaignMinutes',
    'readyToProduceAtCampaignMinute',
  ], path)
  if (row.schemaVersion !== 1 || (row.audience !== 'gm' && row.audience !== 'owner')
    || (row.status !== 'additional-time-in-progress' && row.status !== 'ready-to-produce')
    || row.additionalRequiredCampaignMinutes !== 240) {
    fail('breeding.additional-progress.invalid-document', path, 'must be a bounded owner or GM additional-progress projection.')
  }
  const accumulated = integer(row.additionalAccumulatedCampaignMinutes, `${path}.additionalAccumulatedCampaignMinutes`, 240)
  const remaining = integer(row.additionalRemainingCampaignMinutes, `${path}.additionalRemainingCampaignMinutes`, 240)
  const readyAt = row.readyToProduceAtCampaignMinute === null ? null
    : integer(row.readyToProduceAtCampaignMinute, `${path}.readyToProduceAtCampaignMinute`)
  if (remaining !== 240 - accumulated
    || (row.status === 'ready-to-produce') !== (accumulated === 240)
    || (readyAt !== null) !== (accumulated === 240)) {
    fail('breeding.additional-progress.invalid-invariant', path, 'status, progress, and readiness facts must agree.')
  }
  return freeze({
    schemaVersion: 1,
    audience: row.audience,
    status: row.status,
    additionalRequiredCampaignMinutes: 240,
    additionalAccumulatedCampaignMinutes: accumulated,
    additionalRemainingCampaignMinutes: remaining,
    readyToProduceAtCampaignMinute: readyAt,
  }) as BreedingAdditionalProgressProjectionV1
}
