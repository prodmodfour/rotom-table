import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_PATCH_TYPE_VALUES,
  isLivePlayPatchType,
  parseLivePlayMapSlug,
  parseLivePlayOpId,
} from './livePlayCommands'
import { isSlug, SLUG_PATTERN_DESCRIPTION } from './paths'
import type { RealtimeEvent } from './realtime'
import { isSheetKind, type SheetKind } from './sheets'

export type RealtimeEventAccess =
  | {
      readonly kind: 'gm-only'
    }
  | {
      readonly kind: 'map-access'
      readonly mapSlug: string
    }
  | {
      readonly kind: 'sheet-access'
      readonly sheetKind: SheetKind
      readonly sheetSlug: string
    }
  | {
      readonly kind: 'group-inventory-access'
      readonly groupSlug: string
    }
  | {
      readonly kind: 'shop-access'
      readonly shopSlug: string
    }

export interface SequencedRealtimeEvent<TData = unknown> extends RealtimeEvent<TData> {
  readonly sequence: number
  readonly timestamp: number
}

export type RealtimeEventDraft<TData = unknown> = Omit<RealtimeEvent<TData>, 'sequence' | 'timestamp'>

export interface PersistedRealtimeEvent {
  readonly sequence: number
  readonly dedupeKey?: string
  readonly access: RealtimeEventAccess
  readonly event: SequencedRealtimeEvent
}

export interface RealtimeEventCursorState {
  readonly latestSequence: number
  readonly earliestAvailableSequence: number
}

export type RealtimeEventCursorStatus = 'ok' | 'gap' | 'ahead'

export type RealtimeJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly RealtimeJsonValue[]
  | { readonly [key: string]: RealtimeJsonValue }

export interface RealtimeEventMaterial {
  readonly event: RealtimeEventDraft
  readonly access: RealtimeEventAccess
  readonly dedupeKey?: string
}

export const MAX_REALTIME_EVENT_CHANNEL_LENGTH = 200
export const MAX_REALTIME_EVENT_TYPE_LENGTH = 120
export const MAX_REALTIME_EVENT_CLIENT_ID_LENGTH = 200
export const MAX_REALTIME_EVENT_DEDUPE_KEY_LENGTH = 300
export const MAX_REALTIME_EVENT_JSON_BYTES = 1024 * 1024
export const DEFAULT_REALTIME_EVENT_READ_LIMIT = 100
export const MAX_REALTIME_EVENT_READ_LIMIT = 500

const textEncoder = new TextEncoder()

type UnknownRecord = Record<string, unknown>

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const isPlainObject = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const ownPropertyNames = (value: object): readonly string[] => Object.getOwnPropertyNames(value)

const defineJsonCloneProperty = (
  target: Record<string, RealtimeJsonValue>,
  key: string,
  value: RealtimeJsonValue,
): void => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

const isArrayIndexName = (name: string, length: number): boolean => {
  if (!/^(0|[1-9][0-9]*)$/.test(name)) return false
  const index = Number(name)
  return Number.isSafeInteger(index) && index >= 0 && index < length
}

const pathForProperty = (path: string, key: string): string => `${path}.${key}`

const cloneRealtimeJsonValueInternal = (
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): RealtimeJsonValue => {
  if (value === null) return null

  if (typeof value === 'string' || typeof value === 'boolean') return value

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} must be JSON-serializable; non-finite numbers are not allowed`)
    }
    return value
  }

  if (value === undefined) {
    throw new Error(`${path} must be JSON-serializable; undefined values are not allowed`)
  }

  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new Error(`${path} must be JSON-serializable; ${typeof value} values are not allowed`)
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error(`${path} must be JSON-serializable; circular references are not allowed`)
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(`${path} must be JSON-serializable; symbol keys are not allowed`)
    }

    for (const name of ownPropertyNames(value)) {
      if (name === 'length') continue
      if (!isArrayIndexName(name, value.length)) {
        throw new Error(`${path} must be JSON-serializable; arrays must not have non-index properties`)
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      if (!descriptor || !('value' in descriptor)) {
        throw new Error(`${path}[${name}] must be JSON-serializable; accessor properties are not allowed`)
      }
    }

    seen.add(value)
    const cloned: RealtimeJsonValue[] = []
    for (let index = 0; index < value.length; index += 1) {
      if (!hasOwn(value, index)) {
        throw new Error(`${path} must be JSON-serializable; sparse arrays are not allowed`)
      }
      cloned.push(cloneRealtimeJsonValueInternal(value[index], `${path}[${index}]`, seen))
    }
    seen.delete(value)
    return cloned
  }

  if (!isPlainObject(value)) {
    throw new Error(`${path} must be JSON-serializable; only plain objects are allowed`)
  }

  if (seen.has(value)) {
    throw new Error(`${path} must be JSON-serializable; circular references are not allowed`)
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`${path} must be JSON-serializable; symbol keys are not allowed`)
  }

  seen.add(value)
  const cloned: Record<string, RealtimeJsonValue> = {}
  for (const key of ownPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) continue
    if (!descriptor.enumerable) {
      throw new Error(`${pathForProperty(path, key)} must be JSON-serializable; non-enumerable properties are not allowed`)
    }
    if (!('value' in descriptor)) {
      throw new Error(`${pathForProperty(path, key)} must be JSON-serializable; accessor properties are not allowed`)
    }
    defineJsonCloneProperty(
      cloned,
      key,
      cloneRealtimeJsonValueInternal(descriptor.value, pathForProperty(path, key), seen),
    )
  }
  seen.delete(value)
  return cloned
}

export const cloneRealtimeJsonValue = <TValue>(value: TValue, path = 'value'): TValue =>
  cloneRealtimeJsonValueInternal(value, path, new WeakSet()) as TValue

const stringifyCanonicalClonedJson = (value: RealtimeJsonValue): string => {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyCanonicalClonedJson(item)).join(',')}]`
  }
  const record = value as { readonly [key: string]: RealtimeJsonValue }
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stringifyCanonicalClonedJson(record[key])}`)
    .join(',')}}`
}

export const stringifyCanonicalRealtimeJson = (value: unknown, path = 'value'): string =>
  stringifyCanonicalClonedJson(cloneRealtimeJsonValueInternal(value, path, new WeakSet()))

const jsonByteLength = (json: string): number => textEncoder.encode(json).byteLength

const assertEventJsonWithinLimit = (value: RealtimeJsonValue, label: string): void => {
  const json = stringifyCanonicalClonedJson(value)
  if (jsonByteLength(json) > MAX_REALTIME_EVENT_JSON_BYTES) {
    throw new Error(`${label} JSON must be at most ${MAX_REALTIME_EVENT_JSON_BYTES} bytes`)
  }
}

const parseSafeNonNegativeInteger = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a safe non-negative integer`)
  }
  return value
}

const parseBoundedNonEmptyString = (value: unknown, label: string, maxLength: number): string => {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  if (value.trim().length === 0) throw new Error(`${label} must not be empty`)
  if (value.length > maxLength) throw new Error(`${label} must be at most ${maxLength} characters`)
  return value
}

const parseStrictSlug = (value: unknown, label: string): string => {
  if (!isSlug(value)) throw new Error(`${label} must match ${SLUG_PATTERN_DESCRIPTION}`)
  return value
}

const assertOnlyKeys = (record: UnknownRecord, allowedKeys: readonly string[], label: string): void => {
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`${label}.${key} is not allowed`)
  }
}

export const parseRealtimeEventSequence = (value: unknown, label = 'sequence'): number =>
  parseSafeNonNegativeInteger(value, label)

export const parseRealtimeEventTimestamp = (value: unknown, label = 'timestamp'): number =>
  parseSafeNonNegativeInteger(value, label)

export const parseRealtimeEventCursorValue = (value: unknown, label = 'afterSequence'): number =>
  parseSafeNonNegativeInteger(value, label)

export const parseRealtimeEventReadLimit = (
  value: unknown = DEFAULT_REALTIME_EVENT_READ_LIMIT,
  label = 'limit',
): number => {
  const limit = parseSafeNonNegativeInteger(value, label)
  if (limit < 1) throw new Error(`${label} must be at least 1`)
  if (limit > MAX_REALTIME_EVENT_READ_LIMIT) {
    throw new Error(`${label} must be at most ${MAX_REALTIME_EVENT_READ_LIMIT}`)
  }
  return limit
}

export const parseRealtimeEventDedupeKey = (value: unknown, label = 'dedupeKey'): string | undefined => {
  if (value === undefined || value === null) return undefined
  return parseBoundedNonEmptyString(value, label, MAX_REALTIME_EVENT_DEDUPE_KEY_LENGTH)
}

const parseRealtimeEventChannel = (value: unknown): string =>
  parseBoundedNonEmptyString(value, 'event.channel', MAX_REALTIME_EVENT_CHANNEL_LENGTH)

const parseRealtimeEventType = (value: unknown): string =>
  parseBoundedNonEmptyString(value, 'event.type', MAX_REALTIME_EVENT_TYPE_LENGTH)

const parseRealtimeEventClientId = (value: unknown): string =>
  parseBoundedNonEmptyString(value, 'event.clientId', MAX_REALTIME_EVENT_CLIENT_ID_LENGTH)

const validateRealtimeEventPatch = (
  patch: unknown,
  path: string,
  eventMapSlug: string | null,
  eventRevision: number | null,
): void => {
  if (!isPlainObject(patch)) throw new Error(`${path} must be a plain object`)

  if (patch.schemaVersion !== LIVE_PLAY_COMMAND_SCHEMA_VERSION) {
    throw new Error(`${path}.schemaVersion must be ${LIVE_PLAY_COMMAND_SCHEMA_VERSION}`)
  }
  if (!isLivePlayPatchType(patch.type)) {
    throw new Error(`${path}.type must be one of ${LIVE_PLAY_PATCH_TYPE_VALUES.join(', ')}`)
  }

  const patchMapSlug = parseLivePlayMapSlug(patch.mapSlug, `${path}.mapSlug`)
  if (eventMapSlug !== null && patchMapSlug !== eventMapSlug) {
    throw new Error(`${path}.mapSlug must match event.mapSlug`)
  }

  const patchRevision = parseSafeNonNegativeInteger(patch.revision, `${path}.revision`)
  if (eventRevision !== null && patchRevision !== eventRevision) {
    throw new Error(`${path}.revision must match event.revision`)
  }

  if (!Array.isArray(patch.scopes)) throw new Error(`${path}.scopes must be an array`)
  if (!hasOwn(patch, 'payload') || patch.payload === undefined) {
    throw new Error(`${path}.payload must be present`)
  }
}

const validateRealtimeEventPatches = (
  patches: unknown,
  eventMapSlug: string | null,
  eventRevision: number | null,
): void => {
  if (!Array.isArray(patches)) throw new Error('event.patches must be an array')
  patches.forEach((patch, index) => validateRealtimeEventPatch(
    patch,
    `event.patches[${index}]`,
    eventMapSlug,
    eventRevision,
  ))
}

const validateRealtimeEventKnownFields = (
  event: UnknownRecord,
  options: { readonly requireSequenceAndTimestamp: boolean },
): void => {
  parseRealtimeEventChannel(event.channel)
  parseRealtimeEventType(event.type)

  if (options.requireSequenceAndTimestamp) {
    if (!hasOwn(event, 'sequence')) throw new Error('event.sequence is required')
    if (!hasOwn(event, 'timestamp')) throw new Error('event.timestamp is required')
    parseRealtimeEventSequence(event.sequence, 'event.sequence')
    parseRealtimeEventTimestamp(event.timestamp, 'event.timestamp')
  }

  const eventMapSlug = hasOwn(event, 'mapSlug')
    ? parseLivePlayMapSlug(event.mapSlug, 'event.mapSlug')
    : null
  const eventRevision = hasOwn(event, 'revision')
    ? parseSafeNonNegativeInteger(event.revision, 'event.revision')
    : null

  if (hasOwn(event, 'previousRevision')) {
    parseSafeNonNegativeInteger(event.previousRevision, 'event.previousRevision')
  }
  if (hasOwn(event, 'opId')) parseLivePlayOpId(event.opId, 'event.opId')
  if (hasOwn(event, 'clientId')) parseRealtimeEventClientId(event.clientId)
  if (hasOwn(event, 'sheetKind') && !isSheetKind(event.sheetKind)) {
    throw new Error('event.sheetKind must be a valid sheet kind')
  }
  if (hasOwn(event, 'sheetSlug')) parseStrictSlug(event.sheetSlug, 'event.sheetSlug')
  if (hasOwn(event, 'patches')) validateRealtimeEventPatches(event.patches, eventMapSlug, eventRevision)
}

export const parseRealtimeEventAccess = (value: unknown, label = 'access'): RealtimeEventAccess => {
  if (!isPlainObject(value)) throw new Error(`${label} must be a plain object`)
  const access = cloneRealtimeJsonValue(value, label) as UnknownRecord

  if (access.kind === 'gm-only') {
    assertOnlyKeys(access, ['kind'], label)
    return { kind: 'gm-only' }
  }

  if (access.kind === 'map-access') {
    assertOnlyKeys(access, ['kind', 'mapSlug'], label)
    return {
      kind: 'map-access',
      mapSlug: parseLivePlayMapSlug(access.mapSlug, `${label}.mapSlug`),
    }
  }

  if (access.kind === 'sheet-access') {
    assertOnlyKeys(access, ['kind', 'sheetKind', 'sheetSlug'], label)
    if (!isSheetKind(access.sheetKind)) throw new Error(`${label}.sheetKind must be a valid sheet kind`)
    return {
      kind: 'sheet-access',
      sheetKind: access.sheetKind,
      sheetSlug: parseStrictSlug(access.sheetSlug, `${label}.sheetSlug`),
    }
  }

  if (access.kind === 'group-inventory-access') {
    assertOnlyKeys(access, ['kind', 'groupSlug'], label)
    return {
      kind: 'group-inventory-access',
      groupSlug: parseStrictSlug(access.groupSlug, `${label}.groupSlug`),
    }
  }

  if (access.kind === 'shop-access') {
    assertOnlyKeys(access, ['kind', 'shopSlug'], label)
    return {
      kind: 'shop-access',
      shopSlug: parseStrictSlug(access.shopSlug, `${label}.shopSlug`),
    }
  }

  throw new Error(`${label}.kind must be gm-only, map-access, sheet-access, group-inventory-access, or shop-access`)
}

export const parseRealtimeEventDraft = <TData = unknown>(value: unknown): RealtimeEventDraft<TData> => {
  if (!isPlainObject(value)) throw new Error('event draft must be a plain object')
  if (hasOwn(value, 'sequence')) throw new Error('event draft must not include sequence')
  if (hasOwn(value, 'timestamp')) throw new Error('event draft must not include timestamp')

  const event = cloneRealtimeJsonValue(value, 'event draft') as UnknownRecord
  validateRealtimeEventKnownFields(event, { requireSequenceAndTimestamp: false })
  assertEventJsonWithinLimit(event as RealtimeJsonValue, 'event draft')
  return event as RealtimeEventDraft<TData>
}

export const parseSequencedRealtimeEvent = <TData = unknown>(value: unknown): SequencedRealtimeEvent<TData> => {
  if (!isPlainObject(value)) throw new Error('sequenced event must be a plain object')

  const event = cloneRealtimeJsonValue(value, 'sequenced event') as UnknownRecord
  validateRealtimeEventKnownFields(event, { requireSequenceAndTimestamp: true })
  assertEventJsonWithinLimit(event as RealtimeJsonValue, 'sequenced event')
  return event as unknown as SequencedRealtimeEvent<TData>
}

export const parsePersistedRealtimeEvent = (value: unknown): PersistedRealtimeEvent => {
  if (!isPlainObject(value)) throw new Error('persisted event must be a plain object')
  const record = cloneRealtimeJsonValue(value, 'persisted event') as UnknownRecord
  assertOnlyKeys(record, ['sequence', 'dedupeKey', 'access', 'event'], 'persisted event')
  if (!hasOwn(record, 'sequence')) throw new Error('persisted event.sequence is required')
  if (!hasOwn(record, 'access')) throw new Error('persisted event.access is required')
  if (!hasOwn(record, 'event')) throw new Error('persisted event.event is required')

  const sequence = parseRealtimeEventSequence(record.sequence, 'persisted event.sequence')
  const dedupeKey = hasOwn(record, 'dedupeKey')
    ? parseRealtimeEventDedupeKey(record.dedupeKey, 'persisted event.dedupeKey')
    : undefined
  const access = parseRealtimeEventAccess(record.access, 'persisted event.access')
  const event = parseSequencedRealtimeEvent(record.event)
  if (event.sequence !== sequence) {
    throw new Error('persisted event.sequence must match persisted event.event.sequence')
  }

  return {
    sequence,
    ...(dedupeKey === undefined ? {} : { dedupeKey }),
    access,
    event,
  }
}

export const parseRealtimeEventCursorState = (value: unknown): RealtimeEventCursorState => {
  if (!isPlainObject(value)) throw new Error('cursor state must be a plain object')
  const latestSequence = parseRealtimeEventSequence(value.latestSequence, 'cursor latestSequence')
  const earliestAvailableSequence = parseRealtimeEventSequence(
    value.earliestAvailableSequence,
    'cursor earliestAvailableSequence',
  )
  if (earliestAvailableSequence < 1) {
    throw new Error('cursor earliestAvailableSequence must be at least 1')
  }
  if (earliestAvailableSequence > latestSequence + 1) {
    throw new Error('cursor earliestAvailableSequence must not exceed latestSequence + 1')
  }
  return { latestSequence, earliestAvailableSequence }
}

export const createRealtimeEventMaterial = (input: {
  readonly event: RealtimeEventDraft
  readonly access: RealtimeEventAccess
  readonly dedupeKey?: string
}): RealtimeEventMaterial => {
  const dedupeKey = parseRealtimeEventDedupeKey(input.dedupeKey)
  return {
    event: parseRealtimeEventDraft(input.event),
    access: parseRealtimeEventAccess(input.access),
    ...(dedupeKey === undefined ? {} : { dedupeKey }),
  }
}
