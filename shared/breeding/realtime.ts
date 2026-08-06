import {
  cloneRealtimeJsonValue,
  parseRealtimeEventSequence,
  parseSequencedRealtimeEvent,
  stringifyCanonicalRealtimeJson,
  type SequencedRealtimeEvent,
} from '../realtimeEventLog'
import {
  parseRealtimeReplayControlMessage,
  type RealtimeReplayControlMessage,
} from '../realtimeReplay'
import {
  BREEDING_OPERATION_COMMAND_KINDS,
  type BreedingOperationCommandKind,
} from './operations'
import {
  BREEDING_PROJECTION_AUDIENCES,
  parseBreedingPresentationProjectionV1,
  type BreedingPresentationProjectionV1,
  type BreedingProjectionAggregateKind,
  type BreedingProjectionAudience,
} from './projections'
import {
  BREEDING_REALTIME_AUDIENCE_SCOPES,
  type BreedingRealtimeAudienceScope,
} from './realtimeAccess'

export const BREEDING_REALTIME_SCHEMA_VERSION = 1 as const
export const BREEDING_REALTIME_EVENT_TYPE = 'breeding-aggregate-refresh' as const
export const BREEDING_REALTIME_EVENT_JSON_BYTES_MAXIMUM = 4096 as const
export const BREEDING_REALTIME_SNAPSHOT_ENTRY_MAXIMUM = 100 as const
export const BREEDING_REALTIME_SNAPSHOT_JSON_BYTES_MAXIMUM = 4 * 1024 * 1024
export const BREEDING_REALTIME_INVALIDATION_MAXIMUM = 256 as const

export const breedingRealtimeChannel = (
  audience: BreedingRealtimeAudienceScope,
): `breeding:${BreedingRealtimeAudienceScope}` => `breeding:${audience}`

export interface BreedingRealtimeRefreshDataV1 {
  readonly schemaVersion: 1
  readonly aggregateKind: BreedingProjectionAggregateKind
  readonly aggregateIdentitySha256: string
  readonly revision: number
  readonly operationKind: BreedingOperationCommandKind
  readonly audienceRefreshScope: BreedingRealtimeAudienceScope
}

export type BreedingRealtimeRefreshEventV1 = SequencedRealtimeEvent<BreedingRealtimeRefreshDataV1> & {
  readonly channel: `breeding:${BreedingRealtimeAudienceScope}`
  readonly type: typeof BREEDING_REALTIME_EVENT_TYPE
  readonly data: BreedingRealtimeRefreshDataV1
}

export interface BreedingRealtimeSnapshotEntryV1 {
  readonly aggregateKind: BreedingProjectionAggregateKind
  readonly aggregateIdentitySha256: string
  readonly revision: number
  readonly projection: BreedingPresentationProjectionV1
}

export interface BreedingRealtimeSnapshotV1 {
  readonly schemaVersion: 1
  readonly audience: BreedingProjectionAudience
  readonly throughSequence: number
  readonly entries: readonly BreedingRealtimeSnapshotEntryV1[]
}

export interface BreedingRealtimeAdoptionStateV1 {
  readonly audience: BreedingProjectionAudience
  readonly lastSequence: number
  readonly snapshot: BreedingRealtimeSnapshotV1 | null
  readonly invalidatedAggregateIdentitySha256: readonly string[]
  readonly requiresSnapshotThroughSequence: number | null
}

export type BreedingRealtimeAdoptionDecision =
  | 'adopted-event'
  | 'adopted-snapshot'
  | 'exact-replay'
  | 'ignored-stale'
  | 'ignored-covered-revision'
  | 'snapshot-required'

export interface BreedingRealtimeAdoptionResult {
  readonly decision: BreedingRealtimeAdoptionDecision
  readonly state: BreedingRealtimeAdoptionStateV1
}

type UnknownRecord = Record<string, unknown>

const SHA256_RE = /^[0-9a-f]{64}$/
const OPERATION_KIND_SET = new Set<string>(BREEDING_OPERATION_COMMAND_KINDS)
const AUDIENCE_SET = new Set<string>(BREEDING_REALTIME_AUDIENCE_SCOPES)
const PROJECTION_AUDIENCE_SET = new Set<string>(BREEDING_PROJECTION_AUDIENCES)
const textEncoder = new TextEncoder()

export class BreedingRealtimeContractError extends Error {
  readonly code:
    | 'breeding.realtime.invalid-document'
    | 'breeding.realtime.invalid-invariant'
    | 'breeding.realtime.snapshot-conflict'
  readonly path: string

  constructor(code: BreedingRealtimeContractError['code'], path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingRealtimeContractError'
    this.code = code
    this.path = path
  }
}

const fail = (
  code: BreedingRealtimeContractError['code'],
  path: string,
  message: string,
): never => {
  throw new BreedingRealtimeContractError(code, path, message)
}

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isRecord(value)) return fail('breeding.realtime.invalid-document', path, 'must be a plain object.')
  return value
}

const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path)
  const expected = [...fields].sort()
  const actual = Object.keys(row).sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    return fail(
      'breeding.realtime.invalid-document',
      path,
      `must contain exactly: ${fields.join(', ')}.`,
    )
  }
  return row
}

const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    return fail('breeding.realtime.invalid-document', path, 'must be a bounded nonnegative safe integer.')
  }
  return Number(value)
}

const sha256 = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    return fail('breeding.realtime.invalid-document', path, 'must be a lowercase SHA-256 digest.')
  }
  return value
}

const audience = (value: unknown, path: string): BreedingRealtimeAudienceScope => {
  if (typeof value !== 'string' || !AUDIENCE_SET.has(value)) {
    return fail('breeding.realtime.invalid-document', path, 'must be a closed audience refresh scope.')
  }
  return value as BreedingRealtimeAudienceScope
}

const projectionAudience = (value: unknown, path: string): BreedingProjectionAudience => {
  if (typeof value !== 'string' || !PROJECTION_AUDIENCE_SET.has(value)) {
    return fail('breeding.realtime.invalid-document', path, 'must be a closed projection audience.')
  }
  return value as BreedingProjectionAudience
}

const aggregateKind = (value: unknown, path: string): BreedingProjectionAggregateKind => {
  if (value !== 'breeding-project' && value !== 'pokemon-egg') {
    return fail('breeding.realtime.invalid-document', path, 'must be breeding-project or pokemon-egg.')
  }
  return value
}

const operationKind = (value: unknown, path: string): BreedingOperationCommandKind => {
  if (typeof value !== 'string' || !OPERATION_KIND_SET.has(value)) {
    return fail('breeding.realtime.invalid-document', path, 'must be a closed breeding operation kind.')
  }
  return value as BreedingOperationCommandKind
}

const clone = (value: unknown, path: string): unknown => {
  try {
    return cloneRealtimeJsonValue(value, path)
  } catch (error) {
    return fail(
      'breeding.realtime.invalid-document',
      path,
      error instanceof Error ? error.message : String(error),
    )
  }
}

const jsonBytes = (value: unknown, path: string): number => {
  try {
    return textEncoder.encode(stringifyCanonicalRealtimeJson(value, path)).byteLength
  } catch (error) {
    return fail(
      'breeding.realtime.invalid-document',
      path,
      error instanceof Error ? error.message : String(error),
    )
  }
}

const deepFreeze = <Value>(value: Value): Value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

const canonicalEqual = (left: unknown, right: unknown): boolean => (
  stringifyCanonicalRealtimeJson(left, 'left') === stringifyCanonicalRealtimeJson(right, 'right')
)

export const parseBreedingRealtimeRefreshDataV1 = (
  value: unknown,
  path = 'breedingRealtimeRefresh',
): BreedingRealtimeRefreshDataV1 => {
  const cloned = clone(value, path)
  const row = exact(cloned, [
    'schemaVersion',
    'aggregateKind',
    'aggregateIdentitySha256',
    'revision',
    'operationKind',
    'audienceRefreshScope',
  ], path)
  if (row.schemaVersion !== BREEDING_REALTIME_SCHEMA_VERSION) {
    return fail('breeding.realtime.invalid-document', `${path}.schemaVersion`, 'must equal 1.')
  }
  return deepFreeze({
    schemaVersion: 1,
    aggregateKind: aggregateKind(row.aggregateKind, `${path}.aggregateKind`),
    aggregateIdentitySha256: sha256(
      row.aggregateIdentitySha256,
      `${path}.aggregateIdentitySha256`,
    ),
    revision: integer(row.revision, `${path}.revision`, 2_147_483_647),
    operationKind: operationKind(row.operationKind, `${path}.operationKind`),
    audienceRefreshScope: audience(row.audienceRefreshScope, `${path}.audienceRefreshScope`),
  })
}

/** Strict parser for durable refresh events. Transient/unsequenced breeding events fail closed. */
export const parseBreedingRealtimeRefreshEventV1 = (
  value: unknown,
  path = 'breedingRealtimeEvent',
): BreedingRealtimeRefreshEventV1 => {
  let parsed: SequencedRealtimeEvent
  try {
    parsed = parseSequencedRealtimeEvent(value)
  } catch (error) {
    return fail(
      'breeding.realtime.invalid-document',
      path,
      error instanceof Error ? error.message : String(error),
    )
  }
  const row = exact(parsed, ['channel', 'type', 'sequence', 'timestamp', 'data'], path)
  const data = parseBreedingRealtimeRefreshDataV1(row.data, `${path}.data`)
  if (row.type !== BREEDING_REALTIME_EVENT_TYPE) {
    return fail('breeding.realtime.invalid-document', `${path}.type`, `must equal ${BREEDING_REALTIME_EVENT_TYPE}.`)
  }
  if (row.channel !== breedingRealtimeChannel(data.audienceRefreshScope)) {
    return fail(
      'breeding.realtime.invalid-invariant',
      `${path}.channel`,
      'must match data.audienceRefreshScope.',
    )
  }
  const event = deepFreeze({
    channel: row.channel,
    type: BREEDING_REALTIME_EVENT_TYPE,
    sequence: parseRealtimeEventSequence(row.sequence, `${path}.sequence`),
    timestamp: integer(row.timestamp, `${path}.timestamp`),
    data,
  }) as BreedingRealtimeRefreshEventV1
  if (jsonBytes(event, path) > BREEDING_REALTIME_EVENT_JSON_BYTES_MAXIMUM) {
    return fail(
      'breeding.realtime.invalid-document',
      path,
      `must be at most ${BREEDING_REALTIME_EVENT_JSON_BYTES_MAXIMUM} JSON bytes.`,
    )
  }
  return event
}

const projectionMetadata = (projection: BreedingPresentationProjectionV1): {
  readonly audience: BreedingProjectionAudience
  readonly aggregateKind: BreedingProjectionAggregateKind
  readonly revision: number | null
  readonly exposedAggregateIdentitySha256: string | null
} => {
  if (projection.audience === 'public') {
    return {
      audience: projection.audience,
      aggregateKind: projection.aggregateKind,
      revision: null,
      exposedAggregateIdentitySha256: projection.aggregateIdentitySha256,
    }
  }
  if (projection.audience === 'diagnostic') {
    return {
      audience: projection.audience,
      aggregateKind: projection.aggregateKind,
      revision: projection.revision,
      exposedAggregateIdentitySha256: projection.aggregateIdentitySha256,
    }
  }
  if (projection.audience === 'gm') {
    return {
      audience: projection.audience,
      aggregateKind: projection.aggregateKind,
      revision: projection.document.revision,
      exposedAggregateIdentitySha256: null,
    }
  }
  return {
    audience: projection.audience,
    aggregateKind: projection.aggregateKind,
    revision: projection.revision,
    exposedAggregateIdentitySha256: null,
  }
}

const parseSnapshotEntry = (
  value: unknown,
  expectedAudience: BreedingProjectionAudience,
  path: string,
): BreedingRealtimeSnapshotEntryV1 => {
  const row = exact(value, [
    'aggregateKind',
    'aggregateIdentitySha256',
    'revision',
    'projection',
  ], path)
  let projection: BreedingPresentationProjectionV1
  try {
    projection = parseBreedingPresentationProjectionV1(row.projection, `${path}.projection`)
  } catch (error) {
    return fail(
      'breeding.realtime.invalid-document',
      `${path}.projection`,
      error instanceof Error ? error.message : String(error),
    )
  }
  const kind = aggregateKind(row.aggregateKind, `${path}.aggregateKind`)
  const identity = sha256(row.aggregateIdentitySha256, `${path}.aggregateIdentitySha256`)
  const revision = integer(row.revision, `${path}.revision`, 2_147_483_647)
  const metadata = projectionMetadata(projection)
  if (metadata.audience !== expectedAudience
    || metadata.aggregateKind !== kind
    || (metadata.revision !== null && metadata.revision !== revision)
    || (metadata.exposedAggregateIdentitySha256 !== null
      && metadata.exposedAggregateIdentitySha256 !== identity)) {
    return fail(
      'breeding.realtime.invalid-invariant',
      path,
      'wrapper identity, kind, revision, and audience must match its projection.',
    )
  }
  return deepFreeze({
    aggregateKind: kind,
    aggregateIdentitySha256: identity,
    revision,
    projection,
  })
}

export const parseBreedingRealtimeSnapshotV1 = (
  value: unknown,
  path = 'breedingRealtimeSnapshot',
): BreedingRealtimeSnapshotV1 => {
  const cloned = clone(value, path)
  if (jsonBytes(cloned, path) > BREEDING_REALTIME_SNAPSHOT_JSON_BYTES_MAXIMUM) {
    return fail(
      'breeding.realtime.invalid-document',
      path,
      `must be at most ${BREEDING_REALTIME_SNAPSHOT_JSON_BYTES_MAXIMUM} JSON bytes.`,
    )
  }
  const row = exact(cloned, ['schemaVersion', 'audience', 'throughSequence', 'entries'], path)
  if (row.schemaVersion !== BREEDING_REALTIME_SCHEMA_VERSION) {
    return fail('breeding.realtime.invalid-document', `${path}.schemaVersion`, 'must equal 1.')
  }
  const snapshotAudience = projectionAudience(row.audience, `${path}.audience`)
  if (!Array.isArray(row.entries) || row.entries.length > BREEDING_REALTIME_SNAPSHOT_ENTRY_MAXIMUM) {
    return fail(
      'breeding.realtime.invalid-document',
      `${path}.entries`,
      `must be an array of at most ${BREEDING_REALTIME_SNAPSHOT_ENTRY_MAXIMUM} entries.`,
    )
  }
  const entries = row.entries.map((entry, index) => parseSnapshotEntry(
    entry,
    snapshotAudience,
    `${path}.entries[${index}]`,
  ))
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]!.aggregateIdentitySha256 >= entries[index]!.aggregateIdentitySha256) {
      return fail(
        'breeding.realtime.invalid-invariant',
        `${path}.entries`,
        'must be unique in aggregate-identity SHA-256 code-point order.',
      )
    }
  }
  return deepFreeze({
    schemaVersion: 1,
    audience: snapshotAudience,
    throughSequence: parseRealtimeEventSequence(row.throughSequence, `${path}.throughSequence`),
    entries: Object.freeze(entries),
  })
}

const assertState = (stateInput: BreedingRealtimeAdoptionStateV1): BreedingRealtimeAdoptionStateV1 => {
  const row = exact(clone(stateInput, 'state'), [
    'audience',
    'lastSequence',
    'snapshot',
    'invalidatedAggregateIdentitySha256',
    'requiresSnapshotThroughSequence',
  ], 'state')
  const stateAudience = projectionAudience(row.audience, 'state.audience')
  const lastSequence = parseRealtimeEventSequence(row.lastSequence, 'state.lastSequence')
  const snapshot = row.snapshot === null
    ? null
    : parseBreedingRealtimeSnapshotV1(row.snapshot, 'state.snapshot')
  if (snapshot && snapshot.audience !== stateAudience) {
    return fail('breeding.realtime.invalid-invariant', 'state.snapshot.audience', 'must match state.audience.')
  }
  if (!Array.isArray(row.invalidatedAggregateIdentitySha256)
    || row.invalidatedAggregateIdentitySha256.length > BREEDING_REALTIME_INVALIDATION_MAXIMUM) {
    return fail('breeding.realtime.invalid-document', 'state.invalidatedAggregateIdentitySha256', 'must be a bounded array.')
  }
  const invalidated = row.invalidatedAggregateIdentitySha256.map((value, index) => sha256(
    value,
    `state.invalidatedAggregateIdentitySha256[${index}]`,
  ))
  for (let index = 1; index < invalidated.length; index += 1) {
    if (invalidated[index - 1]! >= invalidated[index]!) {
      return fail('breeding.realtime.invalid-invariant', 'state.invalidatedAggregateIdentitySha256', 'must be unique in code-point order.')
    }
  }
  const required = row.requiresSnapshotThroughSequence === null
    ? null
    : parseRealtimeEventSequence(
        row.requiresSnapshotThroughSequence,
        'state.requiresSnapshotThroughSequence',
      )
  if (required !== null && (snapshot !== null || invalidated.length > 0 || required > lastSequence)) {
    return fail(
      'breeding.realtime.invalid-invariant',
      'state',
      'snapshot-required state must discard stale projections and be required through no later than lastSequence.',
    )
  }
  if (snapshot && snapshot.throughSequence > lastSequence) {
    return fail('breeding.realtime.invalid-invariant', 'state.lastSequence', 'cannot precede the adopted snapshot cursor.')
  }
  return deepFreeze({
    audience: stateAudience,
    lastSequence,
    snapshot,
    invalidatedAggregateIdentitySha256: Object.freeze(invalidated),
    requiresSnapshotThroughSequence: required,
  })
}

const stateValue = (input: BreedingRealtimeAdoptionStateV1): BreedingRealtimeAdoptionStateV1 => (
  deepFreeze({
    audience: input.audience,
    lastSequence: input.lastSequence,
    snapshot: input.snapshot,
    invalidatedAggregateIdentitySha256: Object.freeze([
      ...input.invalidatedAggregateIdentitySha256,
    ]),
    requiresSnapshotThroughSequence: input.requiresSnapshotThroughSequence,
  })
)

const result = (
  decision: BreedingRealtimeAdoptionDecision,
  state: BreedingRealtimeAdoptionStateV1,
): BreedingRealtimeAdoptionResult => deepFreeze({ decision, state: stateValue(state) })

export const createBreedingRealtimeAdoptionStateV1 = (
  inputAudience: BreedingProjectionAudience,
): BreedingRealtimeAdoptionStateV1 => stateValue({
  audience: projectionAudience(inputAudience, 'audience'),
  lastSequence: 0,
  snapshot: null,
  invalidatedAggregateIdentitySha256: [],
  requiresSnapshotThroughSequence: null,
})

export const adoptBreedingRealtimeRefreshEventV1 = (
  stateInput: BreedingRealtimeAdoptionStateV1,
  eventInput: unknown,
): BreedingRealtimeAdoptionResult => {
  const state = assertState(stateInput)
  const event = parseBreedingRealtimeRefreshEventV1(eventInput)
  if (event.data.audienceRefreshScope !== state.audience) {
    return fail(
      'breeding.realtime.invalid-invariant',
      'event.data.audienceRefreshScope',
      'must match the current authorized projection audience.',
    )
  }
  if (event.sequence <= state.lastSequence) return result('ignored-stale', state)

  if (state.requiresSnapshotThroughSequence !== null) {
    return result('snapshot-required', {
      ...state,
      lastSequence: event.sequence,
      requiresSnapshotThroughSequence: event.sequence,
    })
  }

  const existing = state.snapshot?.entries.find(entry => (
    entry.aggregateIdentitySha256 === event.data.aggregateIdentitySha256
  ))
  if (existing && existing.aggregateKind !== event.data.aggregateKind) {
    return fail(
      'breeding.realtime.invalid-invariant',
      'event.data.aggregateKind',
      'cannot contradict the aggregate kind already bound to this hashed identity.',
    )
  }
  if (existing && existing.revision >= event.data.revision) {
    return result('ignored-covered-revision', { ...state, lastSequence: event.sequence })
  }

  const invalidated = [...new Set([
    ...state.invalidatedAggregateIdentitySha256,
    event.data.aggregateIdentitySha256,
  ])].sort()
  if (invalidated.length > BREEDING_REALTIME_INVALIDATION_MAXIMUM) {
    return result('snapshot-required', {
      audience: state.audience,
      lastSequence: event.sequence,
      snapshot: null,
      invalidatedAggregateIdentitySha256: [],
      requiresSnapshotThroughSequence: event.sequence,
    })
  }
  return result('adopted-event', {
    ...state,
    lastSequence: event.sequence,
    invalidatedAggregateIdentitySha256: invalidated,
  })
}

export const adoptBreedingRealtimeSnapshotV1 = (
  stateInput: BreedingRealtimeAdoptionStateV1,
  snapshotInput: unknown,
): BreedingRealtimeAdoptionResult => {
  const state = assertState(stateInput)
  const snapshot = parseBreedingRealtimeSnapshotV1(snapshotInput)
  if (snapshot.audience !== state.audience) {
    return fail(
      'breeding.realtime.invalid-invariant',
      'snapshot.audience',
      'must match the current authorized projection audience.',
    )
  }
  const minimumSequence = state.requiresSnapshotThroughSequence ?? state.lastSequence
  if (snapshot.throughSequence < minimumSequence) return result('ignored-stale', state)

  if (state.snapshot?.throughSequence === snapshot.throughSequence) {
    if (!canonicalEqual(state.snapshot, snapshot)) {
      return fail(
        'breeding.realtime.snapshot-conflict',
        'snapshot',
        'the same replay cursor cannot bind different authoritative projection facts.',
      )
    }
    if (state.invalidatedAggregateIdentitySha256.length === 0
      && state.requiresSnapshotThroughSequence === null) {
      return result('exact-replay', state)
    }
  }

  return result('adopted-snapshot', {
    audience: state.audience,
    lastSequence: snapshot.throughSequence,
    snapshot,
    invalidatedAggregateIdentitySha256: [],
    requiresSnapshotThroughSequence: null,
  })
}

/**
 * Replay gaps and ahead cursors discard all local aggregate projections. A
 * caught-up cursor can advance transport position, but it never clears a fresh
 * snapshot requirement. Only a complete current audience snapshot may do so.
 */
export const adoptBreedingRealtimeReplayControlV1 = (
  stateInput: BreedingRealtimeAdoptionStateV1,
  controlInput: unknown,
): BreedingRealtimeAdoptionResult => {
  const state = assertState(stateInput)
  let control: RealtimeReplayControlMessage
  try {
    control = parseRealtimeReplayControlMessage(controlInput)
  } catch (error) {
    return fail(
      'breeding.realtime.invalid-document',
      'control',
      error instanceof Error ? error.message : String(error),
    )
  }
  if (control.type === 'reconcile-required') {
    return result('snapshot-required', {
      audience: state.audience,
      lastSequence: control.latestSequence,
      snapshot: null,
      invalidatedAggregateIdentitySha256: [],
      requiresSnapshotThroughSequence: control.latestSequence,
    })
  }

  if (control.replayedThroughSequence <= state.lastSequence) return result('ignored-stale', state)
  if (state.requiresSnapshotThroughSequence !== null) {
    return result('snapshot-required', {
      ...state,
      lastSequence: control.replayedThroughSequence,
      requiresSnapshotThroughSequence: control.replayedThroughSequence,
    })
  }
  return result('exact-replay', {
    ...state,
    lastSequence: control.replayedThroughSequence,
  })
}
