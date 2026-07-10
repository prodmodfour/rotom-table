/**
 * Versioned map-owned state for authoritative encounter mechanics.
 *
 * MA-050 introduces only the envelope. Each container is intentionally empty
 * until the ticket that defines its typed entries and lifecycle semantics.
 * Existing map hazards, field effects, temporary HP, and move usage remain in
 * their current map fields during this compatibility period.
 */
export const ENCOUNTER_STATE_SCHEMA_VERSION = 1 as const

/** Current envelope bounds. Later mechanics tickets raise only their own bound. */
export const ENCOUNTER_STATE_LIMITS = Object.freeze({
  sides: 0,
  effects: 0,
  counters: 0,
  history: 0,
  turnResources: 0,
  zones: 0,
  pendingResolutionSummaries: 0,
})

export type EmptyEncounterStateList = readonly []
export type EmptyEncounterStateDirectory = Readonly<Record<string, never>>

export interface EncounterState {
  readonly schemaVersion: typeof ENCOUNTER_STATE_SCHEMA_VERSION
  readonly sides: EmptyEncounterStateDirectory
  readonly effects: EmptyEncounterStateList
  readonly counters: EmptyEncounterStateDirectory
  readonly history: EmptyEncounterStateDirectory
  readonly turnResources: EmptyEncounterStateDirectory
  readonly zones: EmptyEncounterStateList
  readonly pendingResolutionSummaries: EmptyEncounterStateList
}

export type EncounterStateValidationCode =
  | 'invalid-encounter-state'
  | 'unsupported-schema-version'
  | 'limit-exceeded'

export class EncounterStateValidationError extends Error {
  readonly code: EncounterStateValidationCode
  readonly path: string

  constructor(code: EncounterStateValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'EncounterStateValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

type EncounterStateContainerKey = Exclude<keyof EncounterState, 'schemaVersion'>

const ENCOUNTER_STATE_FIELDS = [
  'schemaVersion',
  'sides',
  'effects',
  'counters',
  'history',
  'turnResources',
  'zones',
  'pendingResolutionSummaries',
] as const

const LIST_CONTAINER_KEYS = [
  'effects',
  'zones',
  'pendingResolutionSummaries',
] as const satisfies readonly EncounterStateContainerKey[]

const DIRECTORY_CONTAINER_KEYS = [
  'sides',
  'counters',
  'history',
  'turnResources',
] as const satisfies readonly EncounterStateContainerKey[]

const fail = (
  code: EncounterStateValidationCode,
  path: string,
  message: string,
): never => {
  throw new EncounterStateValidationError(code, path, message)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const assertExactFields = (record: UnknownRecord): void => {
  const expected = new Set<string>(ENCOUNTER_STATE_FIELDS)
  const missing = ENCOUNTER_STATE_FIELDS.filter(key => !Object.prototype.hasOwnProperty.call(record, key))
  const unknown = Object.keys(record).filter(key => !expected.has(key))
  if (missing.length === 0 && unknown.length === 0) return

  const details = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  fail('invalid-encounter-state', 'encounterState', `must contain exactly the supported fields (${details}).`)
}

const assertEmptyList = (value: unknown, key: typeof LIST_CONTAINER_KEYS[number]): void => {
  const path = `encounterState.${key}`
  if (!Array.isArray(value)) {
    return fail('invalid-encounter-state', path, 'must be an array.')
  }
  if (value.length > ENCOUNTER_STATE_LIMITS[key]) {
    fail('limit-exceeded', path, `must contain at most ${ENCOUNTER_STATE_LIMITS[key]} entries.`)
  }
}

const assertEmptyDirectory = (
  value: unknown,
  key: typeof DIRECTORY_CONTAINER_KEYS[number],
): void => {
  const path = `encounterState.${key}`
  if (!isPlainRecord(value)) {
    return fail('invalid-encounter-state', path, 'must be a plain object directory.')
  }
  if (Object.keys(value).length > ENCOUNTER_STATE_LIMITS[key]) {
    fail('limit-exceeded', path, `must contain at most ${ENCOUNTER_STATE_LIMITS[key]} entries.`)
  }
}

/** Return a fresh canonical envelope so maps never share mutable containers. */
export const createEmptyEncounterState = (): EncounterState => ({
  schemaVersion: ENCOUNTER_STATE_SCHEMA_VERSION,
  sides: {},
  effects: [],
  counters: {},
  history: {},
  turnResources: {},
  zones: [],
  pendingResolutionSummaries: [],
})

/**
 * Strictly parse the currently supported encounter-state envelope.
 *
 * The parser returns canonical fresh containers instead of retaining input
 * references. Server read boundaries decide when an omitted legacy value may
 * default; a present value always passes through this strict parser.
 */
export const parseEncounterState = (value: unknown): EncounterState => {
  if (!isPlainRecord(value)) {
    return fail('invalid-encounter-state', 'encounterState', 'must be a plain object.')
  }
  assertExactFields(value)
  if (value.schemaVersion !== ENCOUNTER_STATE_SCHEMA_VERSION) {
    fail(
      'unsupported-schema-version',
      'encounterState.schemaVersion',
      `must be ${ENCOUNTER_STATE_SCHEMA_VERSION}.`,
    )
  }

  for (const key of LIST_CONTAINER_KEYS) assertEmptyList(value[key], key)
  for (const key of DIRECTORY_CONTAINER_KEYS) assertEmptyDirectory(value[key], key)

  return createEmptyEncounterState()
}
