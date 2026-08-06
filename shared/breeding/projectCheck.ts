export const BREEDING_PROJECT_CHECK_PROJECTION_SCHEMA_VERSION = 1 as const
export const BREEDING_PROJECT_CHECK_DIFFICULTY_CLASS = 12 as const

export interface BreedingProjectCheckProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm' | 'owner'
  readonly status: 'additional-time-in-progress' | 'check-failed'
  readonly skillId: 'pokemon-education' | 'general-education' | 'perception'
  readonly difficultyClass: 12
  readonly finalTotal: number
  readonly outcome: 'success' | 'failure'
  readonly resolvedAtCampaignMinute: number
}

export type BreedingProjectCheckValidationCode =
  | 'breeding.project-check.invalid-document'
  | 'breeding.project-check.unknown-field'
  | 'breeding.project-check.invalid-invariant'
export class BreedingProjectCheckValidationError extends Error {
  readonly code: BreedingProjectCheckValidationCode
  readonly path: string
  constructor(code: BreedingProjectCheckValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingProjectCheckValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
const fail = (code: BreedingProjectCheckValidationCode, path: string, message: string): never => {
  throw new BreedingProjectCheckValidationError(code, path, message)
}
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('breeding.project-check.invalid-document', path, 'must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return fail('breeding.project-check.invalid-document', path, 'must be plain data without symbols.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('breeding.project-check.invalid-document', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field))
    || Object.keys(row).some(field => !allowed.has(field))) {
    fail('breeding.project-check.unknown-field', path, 'must contain exactly the declared fields.')
  }
  return row
}
const integer = (value: unknown, path: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    return fail('breeding.project-check.invalid-document', path, `must be a safe integer from ${minimum} through ${maximum}.`)
  }
  return Number(value)
}

export const parseBreedingProjectCheckProjectionV1 = (
  value: unknown,
  path = 'breedingProjectCheckProjection',
): BreedingProjectCheckProjectionV1 => {
  const row = exact(value, [
    'schemaVersion', 'audience', 'status', 'skillId', 'difficultyClass',
    'finalTotal', 'outcome', 'resolvedAtCampaignMinute',
  ], path)
  if (row.schemaVersion !== 1 || (row.audience !== 'gm' && row.audience !== 'owner')
    || (row.status !== 'additional-time-in-progress' && row.status !== 'check-failed')
    || (row.skillId !== 'pokemon-education' && row.skillId !== 'general-education' && row.skillId !== 'perception') || row.difficultyClass !== 12
    || (row.outcome !== 'success' && row.outcome !== 'failure')) {
    return fail('breeding.project-check.invalid-document', path, 'must be a bounded v1 owner or GM check projection.')
  }
  const finalTotal = integer(row.finalTotal, `${path}.finalTotal`, -99, 120)
  const success = finalTotal >= 12
  if (success !== (row.outcome === 'success')
    || success !== (row.status === 'additional-time-in-progress')) {
    return fail('breeding.project-check.invalid-invariant', path, 'status and outcome must follow the DC 12 final total exactly.')
  }
  return Object.freeze({
    schemaVersion: 1,
    audience: row.audience,
    status: row.status,
    skillId: row.skillId,
    difficultyClass: 12,
    finalTotal,
    outcome: row.outcome,
    resolvedAtCampaignMinute: integer(
      row.resolvedAtCampaignMinute,
      `${path}.resolvedAtCampaignMinute`,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
  }) as BreedingProjectCheckProjectionV1
}
