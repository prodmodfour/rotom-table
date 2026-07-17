import {
  ENCOUNTER_EFFECT_LIMITS,
  EncounterEffectValidationError,
  parseEncounterEffects,
  type EncounterEffect,
} from './encounterEffects'
import {
  ENCOUNTER_HISTORY_LIMITS,
  EncounterHistoryValidationError,
  createEmptyEncounterHistory,
  parseEncounterHistory,
  type EncounterHistory,
} from './encounterHistory'
import {
  ENCOUNTER_RESOURCE_LIMITS,
  EncounterResourceValidationError,
  createEmptyEncounterTurnResources,
  parseEncounterTurnResources,
  type EncounterTurnResourceDirectory,
} from './encounterResources'
import {
  ENCOUNTER_ZONE_LIMITS,
  EncounterZoneValidationError,
  parseEncounterZones,
  type EncounterZone,
} from './encounterZones'
import {
  PENDING_MOVE_RESOLUTION_SUMMARY_LIMITS,
  PendingMoveResolutionValidationError,
  parsePendingMoveResolutionPublicSummary,
  type PendingMoveResolutionPublicSummary,
} from './pendingResolutionSummary'

export * from './encounterEffects'
export * from './encounterHistory'
export * from './encounterResources'
export * from './encounterZones'

/**
 * Versioned map-owned state for authoritative encounter mechanics.
 *
 * MA-050 introduced the envelope, MA-052 added side identity, MA-056 added
 * strict typed effect instances, MA-057 added their lifecycle policies,
 * MA-063 added structured bounded history indexes, MA-064 added action and
 * movement resource ledgers, MA-103 enabled privacy-safe pending-resolution
 * summaries, MA-133 added generalized battlefield zones, MA-135 made native
 * move hazards write owned layered zones, and MA-136 registered bounded zone
 * entry mechanics, MA-137 made global fields zone-owned with authoritative
 * round/scene lifecycle, and MA-143A added immutable Magic Room, Gravity, and
 * side-owned Tailwind query projections. Legacy editor hazards and the
 * field-effect renderer
 * arrays remain compatibility lanes until their migration tickets; server zone
 * queries and accepted field boundaries adapt/mirror them without applying a
 * matching native zone twice.
 */
export const ENCOUNTER_STATE_SCHEMA_VERSION = 1 as const

export const ENCOUNTER_SIDE_STATUSES = ['active', 'inactive'] as const
export type EncounterSideStatus = typeof ENCOUNTER_SIDE_STATUSES[number]

/** Sides are map-local identities with bounded, presentation-only labels and colours. */
export const ENCOUNTER_SIDE_LIMITS = Object.freeze({
  count: 32,
  idChars: 64,
  labelChars: 80,
})

export type EncounterSideId = string

export interface EncounterSide {
  /** Stable map-local identity; also used as the side-directory key. */
  readonly id: EncounterSideId
  /** Human-readable setup and encounter label. */
  readonly label: string
  /** Optional presentation hint. Mechanics must never infer allegiance from it. */
  readonly color?: string
  /** Inactive sides remain addressable so existing placement identity is preserved. */
  readonly status: EncounterSideStatus
}

export type EncounterSideDirectory = Readonly<Record<EncounterSideId, EncounterSide>>

/** Current envelope bounds. Later mechanics tickets raise only their own bound. */
export const ENCOUNTER_STATE_LIMITS = Object.freeze({
  sides: ENCOUNTER_SIDE_LIMITS.count,
  effects: ENCOUNTER_EFFECT_LIMITS.count,
  counters: 0,
  history: ENCOUNTER_HISTORY_LIMITS.moveAncestryPerScene,
  turnResources: ENCOUNTER_RESOURCE_LIMITS.placementLedgers,
  zones: ENCOUNTER_ZONE_LIMITS.count,
  pendingResolutionSummaries: PENDING_MOVE_RESOLUTION_SUMMARY_LIMITS.responseWindows,
})

export type EmptyEncounterStateDirectory = Readonly<Record<string, never>>

export interface EncounterState {
  readonly schemaVersion: typeof ENCOUNTER_STATE_SCHEMA_VERSION
  readonly sides: EncounterSideDirectory
  readonly effects: readonly EncounterEffect[]
  readonly counters: EmptyEncounterStateDirectory
  readonly history: EncounterHistory
  readonly turnResources: EncounterTurnResourceDirectory
  readonly zones: readonly EncounterZone[]
  readonly pendingResolutionSummaries: readonly PendingMoveResolutionPublicSummary[]
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
  'counters',
] as const satisfies readonly EncounterStateContainerKey[]

const ENCOUNTER_SIDE_FIELDS = ['id', 'label', 'color', 'status'] as const
const REQUIRED_ENCOUNTER_SIDE_FIELDS = ['id', 'label', 'status'] as const
const ENCOUNTER_SIDE_STATUS_SET = new Set<unknown>(ENCOUNTER_SIDE_STATUSES)
const ENCOUNTER_SIDE_ID_PATTERN = /^[a-z0-9-]+$/
const ENCOUNTER_SIDE_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

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

const assertBoundedList = (value: unknown, key: typeof LIST_CONTAINER_KEYS[number]): void => {
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

export const isEncounterSideId = (value: unknown): value is EncounterSideId => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= ENCOUNTER_SIDE_LIMITS.idChars
  && ENCOUNTER_SIDE_ID_PATTERN.test(value)
)

export const encounterStateHasSide = (
  state: Pick<EncounterState, 'sides'> | null | undefined,
  sideId: unknown,
): sideId is EncounterSideId => (
  isEncounterSideId(sideId)
  && state !== null
  && state !== undefined
  && Object.prototype.hasOwnProperty.call(state.sides, sideId)
)

const assertExactEncounterSideFields = (value: UnknownRecord, path: string): void => {
  const expected = new Set<string>(ENCOUNTER_SIDE_FIELDS)
  const missing = REQUIRED_ENCOUNTER_SIDE_FIELDS.filter(key => !Object.prototype.hasOwnProperty.call(value, key))
  const unknown = Object.keys(value).filter(key => !expected.has(key))
  if (missing.length === 0 && unknown.length === 0) return

  const details = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  fail('invalid-encounter-state', path, `must contain exactly the supported side fields (${details}).`)
}

const parseEncounterSide = (
  value: unknown,
  directoryId: EncounterSideId,
): EncounterSide => {
  const path = `encounterState.sides.${directoryId}`
  if (!isPlainRecord(value)) {
    return fail('invalid-encounter-state', path, 'must be a plain object side record.')
  }
  assertExactEncounterSideFields(value, path)

  if (!isEncounterSideId(value.id)) {
    fail(
      'invalid-encounter-state',
      `${path}.id`,
      `must match /^[a-z0-9-]+$/ and contain at most ${ENCOUNTER_SIDE_LIMITS.idChars} characters.`,
    )
  }
  if (value.id !== directoryId) {
    fail('invalid-encounter-state', `${path}.id`, `must match directory key ${directoryId}.`)
  }

  const label = typeof value.label === 'string' ? value.label.trim() : ''
  if (
    !label
    || label.length > ENCOUNTER_SIDE_LIMITS.labelChars
    || CONTROL_CHARACTER_PATTERN.test(label)
  ) {
    fail(
      'invalid-encounter-state',
      `${path}.label`,
      `must be non-empty display text of at most ${ENCOUNTER_SIDE_LIMITS.labelChars} characters without control characters.`,
    )
  }
  if (!ENCOUNTER_SIDE_STATUS_SET.has(value.status)) {
    fail('invalid-encounter-state', `${path}.status`, 'must be active or inactive.')
  }
  if (value.color !== undefined && (
    typeof value.color !== 'string'
    || !ENCOUNTER_SIDE_COLOR_PATTERN.test(value.color)
  )) {
    fail('invalid-encounter-state', `${path}.color`, 'must be a six-digit #rrggbb color when present.')
  }

  return {
    id: directoryId,
    label,
    ...(typeof value.color === 'string' ? { color: value.color.toLowerCase() } : {}),
    status: value.status as EncounterSideStatus,
  }
}

const parseEncounterSideDirectory = (value: unknown): EncounterSideDirectory => {
  const path = 'encounterState.sides'
  if (!isPlainRecord(value)) {
    return fail('invalid-encounter-state', path, 'must be a plain object directory.')
  }
  const ids = Object.keys(value)
  if (ids.length > ENCOUNTER_STATE_LIMITS.sides) {
    fail('limit-exceeded', path, `must contain at most ${ENCOUNTER_STATE_LIMITS.sides} entries.`)
  }

  const sides: Record<EncounterSideId, EncounterSide> = {}
  for (const id of ids.sort((left, right) => left.localeCompare(right))) {
    if (!isEncounterSideId(id)) {
      fail(
        'invalid-encounter-state',
        `${path}.${id}`,
        `directory keys must match /^[a-z0-9-]+$/ and contain at most ${ENCOUNTER_SIDE_LIMITS.idChars} characters.`,
      )
    }
    sides[id] = parseEncounterSide(value[id], id)
  }
  return sides
}

const parseEncounterHistoryState = (value: unknown): EncounterHistory => {
  try {
    return parseEncounterHistory(value, 'encounterState.history')
  }
  catch (error) {
    if (error instanceof EncounterHistoryValidationError) {
      fail(
        error.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-encounter-state',
        error.path,
        error.detail,
      )
    }
    throw error
  }
}

const parseEncounterTurnResourceState = (
  value: unknown,
): EncounterTurnResourceDirectory => {
  try {
    return parseEncounterTurnResources(value, 'encounterState.turnResources')
  }
  catch (error) {
    if (error instanceof EncounterResourceValidationError) {
      fail(
        error.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-encounter-state',
        error.path,
        error.detail,
      )
    }
    throw error
  }
}

const parsePendingResolutionSummaries = (
  value: unknown,
): readonly PendingMoveResolutionPublicSummary[] => {
  const path = 'encounterState.pendingResolutionSummaries'
  if (!Array.isArray(value)) {
    return fail('invalid-encounter-state', path, 'must be an array.')
  }
  if (value.length > ENCOUNTER_STATE_LIMITS.pendingResolutionSummaries) {
    fail(
      'limit-exceeded',
      path,
      `must contain at most ${ENCOUNTER_STATE_LIMITS.pendingResolutionSummaries} entries.`,
    )
  }

  const summaries: PendingMoveResolutionPublicSummary[] = []
  const resolutionIds = new Set<string>()
  for (const [index, entry] of value.entries()) {
    const entryPath = `${path}[${index}]`
    let summary: PendingMoveResolutionPublicSummary
    try {
      summary = parsePendingMoveResolutionPublicSummary(entry, entryPath)
    }
    catch (error) {
      if (error instanceof PendingMoveResolutionValidationError) {
        fail(
          error.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-encounter-state',
          error.path,
          error.detail,
        )
      }
      throw error
    }
    if (resolutionIds.has(summary.resolutionId)) {
      fail(
        'invalid-encounter-state',
        `${entryPath}.resolutionId`,
        `duplicates pending resolution ${summary.resolutionId}.`,
      )
    }
    resolutionIds.add(summary.resolutionId)
    summaries.push(summary)
  }
  return summaries
}

const parseEncounterZoneList = (
  value: unknown,
  sides: EncounterSideDirectory,
): readonly EncounterZone[] => {
  let zones: readonly EncounterZone[]
  try {
    zones = parseEncounterZones(value, 'encounterState.zones')
  }
  catch (error) {
    if (error instanceof EncounterZoneValidationError) {
      fail(
        error.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-encounter-state',
        error.path,
        error.detail,
      )
    }
    throw error
  }

  zones.forEach((zone, zoneIndex) => {
    const sideReferences = [
      ...(zone.sideId === null
        ? []
        : [{ sideId: zone.sideId, path: `encounterState.zones[${zoneIndex}].sideId` }]),
      ...(zone.geometry.kind === 'side'
        ? [{
            sideId: zone.geometry.sideId,
            path: `encounterState.zones[${zoneIndex}].geometry.sideId`,
          }]
        : []),
    ]
    for (const reference of sideReferences) {
      if (!Object.prototype.hasOwnProperty.call(sides, reference.sideId)) {
        fail(
          'invalid-encounter-state',
          reference.path,
          `references unknown encounter side ${reference.sideId}.`,
        )
      }
    }
  })

  return zones
}

const parseEncounterEffectList = (
  value: unknown,
  sides: EncounterSideDirectory,
): readonly EncounterEffect[] => {
  let effects: readonly EncounterEffect[]
  try {
    effects = parseEncounterEffects(value, 'encounterState.effects')
  } catch (error) {
    if (error instanceof EncounterEffectValidationError) {
      fail(
        error.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-encounter-state',
        error.path,
        error.detail,
      )
    }
    throw error
  }

  effects.forEach((effect, effectIndex) => {
    effect.affected.sideIds.forEach((sideId, sideIndex) => {
      const path = `encounterState.effects[${effectIndex}].affected.sideIds[${sideIndex}]`
      if (!isEncounterSideId(sideId)) {
        fail(
          'invalid-encounter-state',
          path,
          'must be a lowercase alphanumeric/hyphen encounter side ID.',
        )
      }
      if (!Object.prototype.hasOwnProperty.call(sides, sideId)) {
        fail('invalid-encounter-state', path, `references unknown encounter side ${sideId}.`)
      }
    })
  })

  return effects
}

/** Return a fresh canonical envelope so maps never share mutable containers. */
export const createEmptyEncounterState = (): EncounterState => ({
  schemaVersion: ENCOUNTER_STATE_SCHEMA_VERSION,
  sides: {},
  effects: [],
  counters: {},
  history: createEmptyEncounterHistory(),
  turnResources: createEmptyEncounterTurnResources(),
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

  for (const key of LIST_CONTAINER_KEYS) assertBoundedList(value[key], key)
  for (const key of DIRECTORY_CONTAINER_KEYS) assertEmptyDirectory(value[key], key)

  const sides = parseEncounterSideDirectory(value.sides)
  return {
    ...createEmptyEncounterState(),
    sides,
    effects: parseEncounterEffectList(value.effects, sides),
    history: parseEncounterHistoryState(value.history),
    turnResources: parseEncounterTurnResourceState(value.turnResources),
    zones: parseEncounterZoneList(value.zones, sides),
    pendingResolutionSummaries: parsePendingResolutionSummaries(
      value.pendingResolutionSummaries,
    ),
  }
}
