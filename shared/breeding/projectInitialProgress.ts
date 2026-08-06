import { isSlug } from '../paths'
import {
  parseBreedingOperationIdSyntax,
  parseBreedingProjectIdSyntax,
  type BreedingOperationId,
  type BreedingProjectId,
} from './ids'
import type { BreedingProjectStatus } from './project'

export const BREEDING_INITIAL_PROGRESS_SEGMENT_AUTHORITY_SCHEMA_VERSION = 1 as const
export const BREEDING_INITIAL_PROGRESS_PROJECTION_SCHEMA_VERSION = 1 as const
export const BREEDING_INITIAL_PROGRESS_INTERRUPTION_REASON_IDS = Object.freeze([
  'breeding.project-interruption.awaiting-consent',
  'breeding.project-interruption.consent-expired',
  'breeding.project-interruption.consent-revoked',
  'breeding.project-interruption.consent-stale',
  'breeding.project-interruption.parent-revision-changed',
] as const)
export type BreedingInitialProgressInterruptionReasonId = typeof BREEDING_INITIAL_PROGRESS_INTERRUPTION_REASON_IDS[number]

export interface BreedingInitialProgressParentRefV1 {
  readonly pokemonSheetSlug: string
  readonly ownerTrainerSlug: string
  readonly expectedSheetRevision: number
}
export interface BreedingInitialProgressSegmentAuthorityV1 {
  readonly schemaVersion: 1
  readonly operationId: BreedingOperationId
  readonly commandSha256: string
  readonly projectId: BreedingProjectId
  readonly projectRevision: number
  readonly projectDefinitionSha256: string
  readonly throughClockRevision: number
  readonly throughCampaignMinute: number
  readonly mode: 'accrue' | 'interrupt'
  readonly interruptionReasonId: BreedingInitialProgressInterruptionReasonId | null
  readonly interruptedAtCampaignMinute: number | null
  readonly parentRefs: readonly [BreedingInitialProgressParentRefV1, BreedingInitialProgressParentRefV1]
  readonly definitionSha256: string
}
export interface BreedingInitialProgressProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm' | 'owner'
  readonly status: 'awaiting-parent-consent' | 'check-ready' | 'initial-time-in-progress'
  readonly initialRequiredCampaignMinutes: 240
  readonly initialAccumulatedCampaignMinutes: number
  readonly initialRemainingCampaignMinutes: number
  readonly interrupted: boolean
  readonly checkReadyAtCampaignMinute: number | null
}

export type BreedingInitialProgressValidationCode =
  | 'breeding.initial-progress.invalid-document'
  | 'breeding.initial-progress.unknown-field'
  | 'breeding.initial-progress.invalid-id'
  | 'breeding.initial-progress.invalid-invariant'
export class BreedingInitialProgressValidationError extends Error {
  readonly code: BreedingInitialProgressValidationCode
  readonly path: string
  constructor(code: BreedingInitialProgressValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingInitialProgressValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const SHA256 = /^[0-9a-f]{64}$/u
const REASONS = new Set<string>(BREEDING_INITIAL_PROGRESS_INTERRUPTION_REASON_IDS)
const fail = (code: BreedingInitialProgressValidationCode, path: string, message: string): never => {
  throw new BreedingInitialProgressValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('breeding.initial-progress.invalid-document', path, 'must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.initial-progress.invalid-document', path, 'must be plain data without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.initial-progress.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) {
    fail('breeding.initial-progress.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    return fail('breeding.initial-progress.invalid-document', path, `must be a nonnegative safe integer no greater than ${maximum}.`)
  }
  return Number(value)
}
const hash = (value: unknown, path: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : fail('breeding.initial-progress.invalid-document', path, 'must be a lowercase SHA-256 digest.')
const slug = (value: unknown, path: string): string => isSlug(value) && value.length <= 160
  ? value
  : fail('breeding.initial-progress.invalid-id', path, 'must be a bounded canonical sheet slug.')
const parentRef = (value: unknown, path: string): BreedingInitialProgressParentRefV1 => {
  const row = exact(value, ['pokemonSheetSlug', 'ownerTrainerSlug', 'expectedSheetRevision'], path)
  return Object.freeze({
    pokemonSheetSlug: slug(row.pokemonSheetSlug, `${path}.pokemonSheetSlug`),
    ownerTrainerSlug: slug(row.ownerTrainerSlug, `${path}.ownerTrainerSlug`),
    expectedSheetRevision: integer(row.expectedSheetRevision, `${path}.expectedSheetRevision`, 2_147_483_647),
  })
}
const parentRefs = (value: unknown, path: string): readonly [BreedingInitialProgressParentRefV1, BreedingInitialProgressParentRefV1] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== 2
    || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== 3) {
    return fail('breeding.initial-progress.invalid-document', path, 'must be a plain two-parent tuple.')
  }
  for (let index = 0; index < 2; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.initial-progress.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.')
    }
  }
  const parsed = [parentRef(value[0], `${path}[0]`), parentRef(value[1], `${path}[1]`)] as const
  if (parsed[0].pokemonSheetSlug === parsed[1].pokemonSheetSlug) {
    fail('breeding.initial-progress.invalid-invariant', path, 'must identify two distinct parent sheets.')
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

export const parseBreedingInitialProgressSegmentAuthorityV1 = (
  value: unknown,
  path = 'initialProgressSegmentAuthority',
): BreedingInitialProgressSegmentAuthorityV1 => {
  const row = exact(value, [
    'schemaVersion', 'operationId', 'commandSha256', 'projectId', 'projectRevision',
    'projectDefinitionSha256', 'throughClockRevision', 'throughCampaignMinute', 'mode',
    'interruptionReasonId', 'interruptedAtCampaignMinute', 'parentRefs', 'definitionSha256',
  ], path)
  const operationId = parseBreedingOperationIdSyntax(row.operationId)
    ?? fail('breeding.initial-progress.invalid-id', `${path}.operationId`, 'must be a Breeding operation ID.')
  const projectId = parseBreedingProjectIdSyntax(row.projectId)
    ?? fail('breeding.initial-progress.invalid-id', `${path}.projectId`, 'must be a Breeding Project ID.')
  if (row.schemaVersion !== 1 || (row.mode !== 'accrue' && row.mode !== 'interrupt')) {
    fail('breeding.initial-progress.invalid-document', path, 'must be a schema-v1 segment authority.')
  }
  const throughCampaignMinute = integer(row.throughCampaignMinute, `${path}.throughCampaignMinute`)
  const interruptionReasonId = row.interruptionReasonId === null ? null
    : typeof row.interruptionReasonId === 'string' && REASONS.has(row.interruptionReasonId)
      ? row.interruptionReasonId as BreedingInitialProgressInterruptionReasonId
      : fail('breeding.initial-progress.invalid-document', `${path}.interruptionReasonId`, 'must be a closed interruption reason or null.')
  const interruptedAtCampaignMinute = row.interruptedAtCampaignMinute === null ? null
    : integer(row.interruptedAtCampaignMinute, `${path}.interruptedAtCampaignMinute`)
  if ((row.mode === 'interrupt') !== (interruptionReasonId !== null)
    || (row.mode === 'interrupt') !== (interruptedAtCampaignMinute !== null)
    || (interruptedAtCampaignMinute !== null && interruptedAtCampaignMinute > throughCampaignMinute)) {
    fail('breeding.initial-progress.invalid-invariant', path, 'interruption evidence must exist exactly for an interrupt within the segment.')
  }
  return freeze({
    schemaVersion: 1,
    operationId,
    commandSha256: hash(row.commandSha256, `${path}.commandSha256`),
    projectId,
    projectRevision: integer(row.projectRevision, `${path}.projectRevision`, 2_147_483_647),
    projectDefinitionSha256: hash(row.projectDefinitionSha256, `${path}.projectDefinitionSha256`),
    throughClockRevision: integer(row.throughClockRevision, `${path}.throughClockRevision`, 2_147_483_647),
    throughCampaignMinute,
    mode: row.mode,
    interruptionReasonId,
    interruptedAtCampaignMinute,
    parentRefs: parentRefs(row.parentRefs, `${path}.parentRefs`),
    definitionSha256: hash(row.definitionSha256, `${path}.definitionSha256`),
  }) as BreedingInitialProgressSegmentAuthorityV1
}

export const parseBreedingInitialProgressProjectionV1 = (
  value: unknown,
  path = 'initialProgressProjection',
): BreedingInitialProgressProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'audience', 'status', 'initialRequiredCampaignMinutes',
    'initialAccumulatedCampaignMinutes', 'initialRemainingCampaignMinutes',
    'interrupted', 'checkReadyAtCampaignMinute',
  ], path)
  if (row.schemaVersion !== 1 || (row.audience !== 'gm' && row.audience !== 'owner')
    || (row.status !== 'awaiting-parent-consent' && row.status !== 'check-ready'
      && row.status !== 'initial-time-in-progress')
    || row.initialRequiredCampaignMinutes !== 240 || typeof row.interrupted !== 'boolean') {
    fail('breeding.initial-progress.invalid-document', path, 'must be a bounded owner or GM initial-progress projection.')
  }
  const accumulated = integer(row.initialAccumulatedCampaignMinutes, `${path}.initialAccumulatedCampaignMinutes`, 240)
  const remaining = integer(row.initialRemainingCampaignMinutes, `${path}.initialRemainingCampaignMinutes`, 240)
  const checkReady = row.checkReadyAtCampaignMinute === null ? null
    : integer(row.checkReadyAtCampaignMinute, `${path}.checkReadyAtCampaignMinute`)
  if (remaining !== 240 - accumulated || row.interrupted !== (row.status === 'awaiting-parent-consent')
    || (row.status === 'check-ready' && accumulated !== 240)
    || (row.status === 'initial-time-in-progress' && accumulated === 240)
    || (checkReady !== null) !== (accumulated === 240)) {
    fail('breeding.initial-progress.invalid-invariant', path, 'status, progress, interruption, and readiness facts must agree.')
  }
  return freeze({
    schemaVersion: 1,
    audience: row.audience,
    status: row.status,
    initialRequiredCampaignMinutes: 240,
    initialAccumulatedCampaignMinutes: accumulated,
    initialRemainingCampaignMinutes: remaining,
    interrupted: row.interrupted,
    checkReadyAtCampaignMinute: checkReady,
  }) as BreedingInitialProgressProjectionV1
}

export const isInitialProgressProjectStatus = (
  status: BreedingProjectStatus,
): status is BreedingInitialProgressProjectionV1['status'] => (
  status === 'awaiting-parent-consent' || status === 'check-ready' || status === 'initial-time-in-progress'
)
