import {
  parseBreedingOperationIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingOperationId,
  type PokemonEggId,
} from './ids'
import type { PokemonEggStatus } from './egg'

export const BREEDING_EGG_READY_CORRECTION_REASON_IDS = Object.freeze([
  'breeding.egg-ready.gm-adjudication',
  'breeding.egg-ready.incubation-correction',
] as const)
export type BreedingEggReadyCorrectionReasonId = typeof BREEDING_EGG_READY_CORRECTION_REASON_IDS[number]

export interface BreedingEggReadyCorrectionProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm'
  readonly operationId: BreedingOperationId
  readonly eggId: PokemonEggId
  readonly acceptedEggRevision: number
  readonly currentEggRevision: number
  readonly currentStatus: PokemonEggStatus
  readonly reasonId: BreedingEggReadyCorrectionReasonId
  readonly readinessKind: 'gm-mark-ready'
  readonly readyAtCampaignMinute: number
  readonly targetCampaignMinutes: number
  readonly accumulatedCampaignMinutes: number
  readonly committedAtCampaignMinute: number
}

export type BreedingEggReadyCorrectionValidationCode =
  | 'breeding.readiness-correction.invalid-document'
  | 'breeding.readiness-correction.unknown-field'
  | 'breeding.readiness-correction.invalid-id'
  | 'breeding.readiness-correction.invalid-invariant'

export class BreedingEggReadyCorrectionValidationError extends Error {
  readonly code: BreedingEggReadyCorrectionValidationCode
  readonly path: string

  constructor(code: BreedingEggReadyCorrectionValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingEggReadyCorrectionValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const STATUSES = new Set<string>([
  'ready', 'awaiting-special-adjudication', 'hatching', 'hatched', 'cancelled', 'invalidated-by-gm',
])
const REASONS = new Set<string>(BREEDING_EGG_READY_CORRECTION_REASON_IDS)
const fail = (
  code: BreedingEggReadyCorrectionValidationCode,
  path: string,
  message: string,
): never => { throw new BreedingEggReadyCorrectionValidationError(code, path, message) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('breeding.readiness-correction.invalid-document', path, 'must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.readiness-correction.invalid-document', path, 'must be plain data without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.readiness-correction.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.keys(row).some(field => !allowed.has(field))) {
    fail('breeding.readiness-correction.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const integer = (
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number => Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
  ? value as number
  : fail('breeding.readiness-correction.invalid-document', path, `must be a safe integer from ${minimum} through ${maximum}.`)

export const parseBreedingEggReadyCorrectionProjectionV1 = (
  value: unknown,
  path = 'readinessCorrectionProjection',
): BreedingEggReadyCorrectionProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'audience', 'operationId', 'eggId', 'acceptedEggRevision', 'currentEggRevision',
    'currentStatus', 'reasonId', 'readinessKind', 'readyAtCampaignMinute', 'targetCampaignMinutes',
    'accumulatedCampaignMinutes', 'committedAtCampaignMinute',
  ], path)
  if (row.schemaVersion !== 1 || row.audience !== 'gm' || row.readinessKind !== 'gm-mark-ready'
    || typeof row.currentStatus !== 'string' || !STATUSES.has(row.currentStatus)
    || typeof row.reasonId !== 'string' || !REASONS.has(row.reasonId)) {
    fail('breeding.readiness-correction.invalid-document', path, 'must be one GM-only v1 readiness correction projection.')
  }
  const acceptedEggRevision = integer(row.acceptedEggRevision, `${path}.acceptedEggRevision`, 1, 2_147_483_647)
  const currentEggRevision = integer(row.currentEggRevision, `${path}.currentEggRevision`, 1, 2_147_483_647)
  const targetCampaignMinutes = integer(row.targetCampaignMinutes, `${path}.targetCampaignMinutes`, 1, 31_536_000)
  const accumulatedCampaignMinutes = integer(
    row.accumulatedCampaignMinutes,
    `${path}.accumulatedCampaignMinutes`,
    0,
    targetCampaignMinutes,
  )
  const readyAtCampaignMinute = integer(row.readyAtCampaignMinute, `${path}.readyAtCampaignMinute`)
  const committedAtCampaignMinute = integer(row.committedAtCampaignMinute, `${path}.committedAtCampaignMinute`)
  if (acceptedEggRevision > currentEggRevision || accumulatedCampaignMinutes >= targetCampaignMinutes
    || readyAtCampaignMinute !== committedAtCampaignMinute) {
    fail(
      'breeding.readiness-correction.invalid-invariant',
      path,
      'revision, incomplete progress, and exact correction campaign minute must agree.',
    )
  }
  return Object.freeze({
    schemaVersion: 1,
    audience: 'gm',
    operationId: parseBreedingOperationIdSyntax(row.operationId)
      ?? fail('breeding.readiness-correction.invalid-id', `${path}.operationId`, 'must be an operation ID.'),
    eggId: parsePokemonEggIdSyntax(row.eggId)
      ?? fail('breeding.readiness-correction.invalid-id', `${path}.eggId`, 'must be an Egg ID.'),
    acceptedEggRevision,
    currentEggRevision,
    currentStatus: row.currentStatus as PokemonEggStatus,
    reasonId: row.reasonId as BreedingEggReadyCorrectionReasonId,
    readinessKind: 'gm-mark-ready',
    readyAtCampaignMinute,
    targetCampaignMinutes,
    accumulatedCampaignMinutes,
    committedAtCampaignMinute,
  })
}
