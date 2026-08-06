import { isSlug } from '../paths'

export const BREEDING_REALTIME_AUDIENCE_SCOPES = Object.freeze([
  'diagnostic',
  'gm',
  'owner',
  'participating-owner',
  'public',
] as const)

export type BreedingRealtimeAudienceScope = typeof BREEDING_REALTIME_AUDIENCE_SCOPES[number]

export type BreedingRealtimeEventAccess =
  | {
      readonly kind: 'breeding-access'
      readonly audience: 'diagnostic' | 'gm' | 'public'
      readonly trainerSheetSlug: null
    }
  | {
      readonly kind: 'breeding-access'
      readonly audience: 'owner' | 'participating-owner'
      readonly trainerSheetSlug: string
    }

type UnknownRecord = Record<string, unknown>

const AUDIENCE_SET = new Set<string>(BREEDING_REALTIME_AUDIENCE_SCOPES)

const isStrictPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  if (Object.getOwnPropertySymbols(value).length > 0) return false
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) return false
  }
  return true
}

const assertExactFields = (record: UnknownRecord, label: string): void => {
  const expected = ['audience', 'kind', 'trainerSheetSlug']
  const actual = Object.keys(record).sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new Error(`${label} must contain exactly kind, audience, and trainerSheetSlug`)
  }
}

/**
 * Parses the durable server-only delivery descriptor for a breeding refresh.
 * The descriptor is never serialized to clients. Owner scopes require direct
 * selected-Profile control of this Trainer at delivery time; map/session sheet
 * visibility is deliberately insufficient.
 */
export const parseBreedingRealtimeEventAccess = (
  value: unknown,
  label = 'breeding realtime access',
): BreedingRealtimeEventAccess => {
  if (!isStrictPlainRecord(value)) throw new Error(`${label} must be a strict plain object`)
  assertExactFields(value, label)
  if (value.kind !== 'breeding-access') throw new Error(`${label}.kind must be breeding-access`)
  if (typeof value.audience !== 'string' || !AUDIENCE_SET.has(value.audience)) {
    throw new Error(`${label}.audience must be a closed breeding audience scope`)
  }

  if (value.audience === 'owner' || value.audience === 'participating-owner') {
    if (!isSlug(value.trainerSheetSlug) || value.trainerSheetSlug.length > 160) {
      throw new Error(`${label}.trainerSheetSlug must be a canonical bounded Trainer sheet slug`)
    }
    return Object.freeze({
      kind: 'breeding-access',
      audience: value.audience,
      trainerSheetSlug: value.trainerSheetSlug,
    })
  }

  if (value.trainerSheetSlug !== null) {
    throw new Error(`${label}.trainerSheetSlug must be null for public, GM, or diagnostic delivery`)
  }
  return Object.freeze({
    kind: 'breeding-access',
    audience: value.audience as 'diagnostic' | 'gm' | 'public',
    trainerSheetSlug: null,
  })
}
