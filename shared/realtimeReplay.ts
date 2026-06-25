import { parsePlayerProfileId, type PlayerProfileId } from './playerProfiles'
import {
  cloneRealtimeJsonValue,
  parseRealtimeEventCursorValue,
  parseRealtimeEventSequence,
  parseSequencedRealtimeEvent,
  type SequencedRealtimeEvent,
} from './realtimeEventLog'

export const REALTIME_REPLAY_QUERY_PARAMETER = 'after' as const

export type RealtimeReplayCursorSource = 'last-event-id' | 'query' | 'none'

export interface RealtimeReplayCursorRequest {
  readonly afterSequence: number | null
  readonly source: RealtimeReplayCursorSource
}

export interface RealtimeReplayCaughtUpControl {
  readonly kind: 'realtime-control'
  readonly type: 'replay-caught-up'
  readonly requestedAfterSequence: number | null
  readonly earliestAvailableSequence: number
  readonly latestSequence: number
  readonly replayedThroughSequence: number
}

export interface RealtimeReplayReconcileRequiredControl {
  readonly kind: 'realtime-control'
  readonly type: 'reconcile-required'
  readonly reason: 'gap' | 'ahead'
  readonly requestedAfterSequence: number
  readonly earliestAvailableSequence: number
  readonly latestSequence: number
}

export type RealtimeReplayControlMessage =
  | RealtimeReplayCaughtUpControl
  | RealtimeReplayReconcileRequiredControl

/**
 * Transport payloads for future durable replay. Control messages are connection
 * metadata only: they are not durable event-log rows and intentionally carry no
 * campaign resource payload or RealtimeEventAccess descriptor.
 */
export type RealtimeStreamPayload = SequencedRealtimeEvent | RealtimeReplayControlMessage

export interface RealtimeConnectionRequest {
  readonly cursor: RealtimeReplayCursorRequest
  readonly profileId: PlayerProfileId | null
}

export type RealtimeReplayQueryCursorValue = string | readonly string[] | null | undefined

export interface ResolveRealtimeReplayCursorRequestInput {
  readonly lastEventId?: string | null
  readonly after?: RealtimeReplayQueryCursorValue
}

export interface ParseRealtimeConnectionRequestInput extends ResolveRealtimeReplayCursorRequestInput {
  readonly profileId?: unknown
}

type UnknownRecord = Record<string, unknown>

const CURSOR_TEXT_RE = /^(0|[1-9][0-9]*)$/
const CONTROL_CHARACTER_RE = /[\u0000-\u001F\u007F]/

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const isPlainObject = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const assertOnlyKeys = (record: UnknownRecord, allowedKeys: readonly string[], label: string): void => {
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`${label}.${key} is not allowed`)
  }
}

const assertNoControlCharacters = (value: string, label: string): void => {
  if (CONTROL_CHARACTER_RE.test(value)) throw new Error(`${label} must not contain control characters`)
}

const parseCursorText = (value: string, label: string): number => {
  assertNoControlCharacters(value, label)
  if (!CURSOR_TEXT_RE.test(value)) {
    throw new Error(`${label} must be an unsigned base-10 integer cursor`)
  }

  return parseRealtimeEventCursorValue(Number(value), label)
}

const parseOptionalLastEventIdCursor = (value: string | null | undefined): number | null => {
  if (value === undefined || value === null || value === '') return null
  return parseCursorText(value, 'Last-Event-ID')
}

const parseExplicitQueryCursor = (value: string): number => {
  if (value.length === 0) throw new Error(`${REALTIME_REPLAY_QUERY_PARAMETER} query cursor must not be empty`)
  return parseCursorText(value, `${REALTIME_REPLAY_QUERY_PARAMETER} query cursor`)
}

const isQueryCursorValueArray = (
  value: RealtimeReplayQueryCursorValue,
): value is readonly string[] => Array.isArray(value)

const parseOptionalQueryCursor = (value: RealtimeReplayQueryCursorValue): number | null => {
  if (value === undefined || value === null) return null
  if (isQueryCursorValueArray(value)) {
    if (value.length !== 1) {
      throw new Error(`${REALTIME_REPLAY_QUERY_PARAMETER} query cursor must be provided at most once`)
    }
    return parseExplicitQueryCursor(value[0] ?? '')
  }
  return parseExplicitQueryCursor(value)
}

export const resolveRealtimeReplayCursorRequest = (
  input: ResolveRealtimeReplayCursorRequestInput,
): RealtimeReplayCursorRequest => {
  const lastEventIdCursor = parseOptionalLastEventIdCursor(input.lastEventId)
  if (lastEventIdCursor !== null) {
    return { afterSequence: lastEventIdCursor, source: 'last-event-id' }
  }

  const queryCursor = parseOptionalQueryCursor(input.after)
  if (queryCursor !== null) return { afterSequence: queryCursor, source: 'query' }

  return { afterSequence: null, source: 'none' }
}

const parseOptionalProfileId = (value: unknown): PlayerProfileId | null => {
  if (value === undefined || value === null || value === '') return null
  if (Array.isArray(value)) throw new Error('profileId must be provided at most once')
  return parsePlayerProfileId(value, 'profileId')
}

export const parseRealtimeConnectionRequest = (
  input: ParseRealtimeConnectionRequestInput,
): RealtimeConnectionRequest => ({
  cursor: resolveRealtimeReplayCursorRequest({
    lastEventId: input.lastEventId,
    after: input.after,
  }),
  profileId: parseOptionalProfileId(input.profileId),
})

const parseControlSequence = (record: UnknownRecord, key: string, label: string): number => {
  if (!hasOwn(record, key)) throw new Error(`${label}.${key} is required`)
  return parseRealtimeEventSequence(record[key], `${label}.${key}`)
}

const parseRequestedAfterSequence = (record: UnknownRecord, label: string): number => {
  if (!hasOwn(record, 'requestedAfterSequence')) {
    throw new Error(`${label}.requestedAfterSequence is required`)
  }
  return parseRealtimeEventCursorValue(record.requestedAfterSequence, `${label}.requestedAfterSequence`)
}

const parseNullableRequestedAfterSequence = (record: UnknownRecord, label: string): number | null => {
  if (!hasOwn(record, 'requestedAfterSequence')) {
    throw new Error(`${label}.requestedAfterSequence is required`)
  }
  if (record.requestedAfterSequence === null) return null
  return parseRealtimeEventCursorValue(record.requestedAfterSequence, `${label}.requestedAfterSequence`)
}

const assertCursorState = (
  earliestAvailableSequence: number,
  latestSequence: number,
  label: string,
): void => {
  if (earliestAvailableSequence < 1) {
    throw new Error(`${label}.earliestAvailableSequence must be at least 1`)
  }
  if (earliestAvailableSequence > latestSequence + 1) {
    throw new Error(`${label}.earliestAvailableSequence must not exceed latestSequence + 1`)
  }
}

const isGapCursor = (
  requestedAfterSequence: number,
  earliestAvailableSequence: number,
): boolean => requestedAfterSequence < earliestAvailableSequence - 1

const isAheadCursor = (
  requestedAfterSequence: number,
  latestSequence: number,
): boolean => requestedAfterSequence > latestSequence

const parseReplayCaughtUpControl = (
  record: UnknownRecord,
  label: string,
): RealtimeReplayCaughtUpControl => {
  assertOnlyKeys(record, [
    'kind',
    'type',
    'requestedAfterSequence',
    'earliestAvailableSequence',
    'latestSequence',
    'replayedThroughSequence',
  ], label)

  const requestedAfterSequence = parseNullableRequestedAfterSequence(record, label)
  const earliestAvailableSequence = parseControlSequence(record, 'earliestAvailableSequence', label)
  const latestSequence = parseControlSequence(record, 'latestSequence', label)
  const replayedThroughSequence = parseControlSequence(record, 'replayedThroughSequence', label)

  assertCursorState(earliestAvailableSequence, latestSequence, label)
  if (replayedThroughSequence > latestSequence) {
    throw new Error(`${label}.replayedThroughSequence must not exceed latestSequence`)
  }
  if (requestedAfterSequence !== null) {
    if (isGapCursor(requestedAfterSequence, earliestAvailableSequence)) {
      throw new Error(`${label}.requestedAfterSequence is before the earliest replayable cursor`)
    }
    if (isAheadCursor(requestedAfterSequence, latestSequence)) {
      throw new Error(`${label}.requestedAfterSequence must not be ahead of latestSequence`)
    }
    if (replayedThroughSequence < requestedAfterSequence) {
      throw new Error(`${label}.replayedThroughSequence must not be before requestedAfterSequence`)
    }
  }

  return {
    kind: 'realtime-control',
    type: 'replay-caught-up',
    requestedAfterSequence,
    earliestAvailableSequence,
    latestSequence,
    replayedThroughSequence,
  }
}

const parseReplayReconcileRequiredControl = (
  record: UnknownRecord,
  label: string,
): RealtimeReplayReconcileRequiredControl => {
  assertOnlyKeys(record, [
    'kind',
    'type',
    'reason',
    'requestedAfterSequence',
    'earliestAvailableSequence',
    'latestSequence',
  ], label)

  const reason = record.reason
  if (reason !== 'gap' && reason !== 'ahead') {
    throw new Error(`${label}.reason must be gap or ahead`)
  }

  const requestedAfterSequence = parseRequestedAfterSequence(record, label)
  const earliestAvailableSequence = parseControlSequence(record, 'earliestAvailableSequence', label)
  const latestSequence = parseControlSequence(record, 'latestSequence', label)

  assertCursorState(earliestAvailableSequence, latestSequence, label)
  if (reason === 'gap' && !isGapCursor(requestedAfterSequence, earliestAvailableSequence)) {
    throw new Error(`${label}.reason gap requires requestedAfterSequence before earliestAvailableSequence - 1`)
  }
  if (reason === 'ahead' && !isAheadCursor(requestedAfterSequence, latestSequence)) {
    throw new Error(`${label}.reason ahead requires requestedAfterSequence greater than latestSequence`)
  }

  return {
    kind: 'realtime-control',
    type: 'reconcile-required',
    reason,
    requestedAfterSequence,
    earliestAvailableSequence,
    latestSequence,
  }
}

export const parseRealtimeReplayControlMessage = (
  value: unknown,
): RealtimeReplayControlMessage => {
  if (!isPlainObject(value)) throw new Error('realtime replay control must be a plain object')
  const control = cloneRealtimeJsonValue(value, 'realtime replay control') as UnknownRecord

  if (control.kind !== 'realtime-control') {
    throw new Error('realtime replay control.kind must be realtime-control')
  }
  if (control.type === 'replay-caught-up') return parseReplayCaughtUpControl(control, 'realtime replay control')
  if (control.type === 'reconcile-required') return parseReplayReconcileRequiredControl(control, 'realtime replay control')
  throw new Error('realtime replay control.type must be replay-caught-up or reconcile-required')
}

export const isRealtimeReplayControlMessage = (
  value: unknown,
): value is RealtimeReplayControlMessage => {
  try {
    parseRealtimeReplayControlMessage(value)
    return true
  } catch {
    return false
  }
}

const ownDataPropertyValue = (record: UnknownRecord, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

export const parseRealtimeStreamPayload = (value: unknown): RealtimeStreamPayload => {
  if (isPlainObject(value) && ownDataPropertyValue(value, 'kind') === 'realtime-control') {
    return parseRealtimeReplayControlMessage(value)
  }
  return parseSequencedRealtimeEvent(value)
}

export const isRealtimeStreamPayload = (value: unknown): value is RealtimeStreamPayload => {
  try {
    parseRealtimeStreamPayload(value)
    return true
  } catch {
    return false
  }
}
