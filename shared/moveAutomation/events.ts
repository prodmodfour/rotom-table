import {
  EncounterEffectValidationError,
  parseEncounterEffect,
  type EncounterEffect,
} from './encounterEffects'
import {
  isEncounterSideId,
  type EncounterSideId,
} from './encounterState'

/**
 * Versioned, server-internal facts consumed by encounter lifecycle reducers.
 *
 * These records are reducer input, never client-authored commands. Each event
 * names the accepted operation that established the fact and its optional
 * causal parent event. Exact per-kind schemas deliberately provide no generic
 * payload or state-patch escape hatch.
 */
export const ENCOUNTER_EVENT_SCHEMA_VERSION = 1 as const

export const ENCOUNTER_EVENT_KINDS = [
  'scene-start',
  'scene-end',
  'round-start',
  'round-end',
  'turn-start',
  'turn-end',
  'move-declared',
  'move-hit',
  'move-damaged',
  'move-ko',
  'move-completed',
  'placement-entering',
  'placement-leaving',
  'placement-moving',
  'switch',
  'recall',
  'send-out',
  'effect-added',
  'effect-removed',
  'resource-spent',
  'resource-restored',
] as const

export const ENCOUNTER_EVENT_DAMAGE_CLASSES = [
  'physical',
  'special',
  'direct',
] as const

export const ENCOUNTER_EVENT_MOVE_OUTCOMES = [
  'no-target',
  'miss',
  'hit',
  'mixed',
] as const

export const ENCOUNTER_EVENT_MOVEMENT_MODES = [
  'voluntary',
  'forced',
  'teleport',
  'swap',
] as const

export const ENCOUNTER_EVENT_LIMITS = Object.freeze({
  events: 512,
  identifierChars: 160,
  canonicalMoveChars: 160,
  targetPlacements: 64,
  round: 1_000_000,
  turn: 1_000_000,
  hitIndex: 100,
  movementStep: 10_000,
  coordinate: 1_000_000,
  amount: 1_000_000_000,
  jsonDepth: 16,
  jsonNodes: 65_536,
  jsonObjectFields: 32,
  jsonArrayEntries: 512,
  jsonStringChars: 500,
})

export type EncounterEventKind = (typeof ENCOUNTER_EVENT_KINDS)[number]
export type EncounterEventDamageClass =
  (typeof ENCOUNTER_EVENT_DAMAGE_CLASSES)[number]
export type EncounterEventMoveOutcome =
  (typeof ENCOUNTER_EVENT_MOVE_OUTCOMES)[number]
export type EncounterEventMovementMode =
  (typeof ENCOUNTER_EVENT_MOVEMENT_MODES)[number]

interface EncounterEventEnvelope<Kind extends EncounterEventKind> {
  readonly schemaVersion: typeof ENCOUNTER_EVENT_SCHEMA_VERSION
  /** Stable identity used by child events to preserve causal ancestry. */
  readonly eventId: string
  readonly kind: Kind
  /** Accepted command/effect operation that established this authoritative fact. */
  readonly sourceOperationId: string
  /** Null for a root fact; otherwise the event that directly caused this fact. */
  readonly causalParentEventId: string | null
  readonly reasonCode: string
}

export interface EncounterSceneEvent
  extends EncounterEventEnvelope<'scene-start' | 'scene-end'> {
  /** Stable server-owned identity for one scene instance, not its display name. */
  readonly sceneId: string
}

export interface EncounterRoundEvent
  extends EncounterEventEnvelope<'round-start' | 'round-end'> {
  /** One-based authoritative encounter round. */
  readonly round: number
}

export interface EncounterTurnEvent
  extends EncounterEventEnvelope<'turn-start' | 'turn-end'> {
  readonly round: number
  /** Zero-based monotonic turn sequence within the encounter. */
  readonly turn: number
  readonly placementId: string
  /** Snapshotted side at the boundary; null means unknown/unaffiliated. */
  readonly sideId: EncounterSideId | null
}

export interface EncounterMoveIdentity {
  readonly resolutionId: string
  readonly canonicalId: string
  readonly actorPlacementId: string
}

export interface EncounterMoveDeclaredEvent
  extends EncounterEventEnvelope<'move-declared'> {
  readonly move: EncounterMoveIdentity
  /** Server-resolved declared candidates; an untargeted move uses an empty list. */
  readonly targetPlacementIds: readonly string[]
}

export interface EncounterMoveHitEvent
  extends EncounterEventEnvelope<'move-hit'> {
  readonly move: EncounterMoveIdentity
  readonly targetPlacementId: string
  /** One-based strike index; ordinary and area attacks use one. */
  readonly hitIndex: number
}

export interface EncounterMoveDamage {
  /** Actual loss after prevention and temporary-HP absorption. */
  readonly hitPointLoss: number
  readonly temporaryHitPointLoss: number
  readonly damageClass: EncounterEventDamageClass
  /** Null only when the authoritative damage rule has no type. */
  readonly moveType: string | null
}

export interface EncounterMoveDamagedEvent
  extends EncounterEventEnvelope<'move-damaged'> {
  readonly move: EncounterMoveIdentity
  readonly targetPlacementId: string
  readonly hitIndex: number
  readonly damage: EncounterMoveDamage
}

export interface EncounterMoveKoEvent
  extends EncounterEventEnvelope<'move-ko'> {
  readonly move: EncounterMoveIdentity
  readonly targetPlacementId: string
  /** Null when KO occurred outside an individual strike, such as an after-damage effect. */
  readonly hitIndex: number | null
}

export interface EncounterMoveCompletedEvent
  extends EncounterEventEnvelope<'move-completed'> {
  readonly move: EncounterMoveIdentity
  readonly attackedTargetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly outcome: EncounterEventMoveOutcome
}

export interface EncounterEventCell {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface EncounterMovementIdentity {
  readonly movementId: string
  readonly mode: EncounterEventMovementMode
  /** One-based position in the authoritative movement path. */
  readonly step: number
}

export interface EncounterPlacementEnteringEvent
  extends EncounterEventEnvelope<'placement-entering'> {
  readonly placementId: string
  readonly movement: EncounterMovementIdentity
  readonly cell: EncounterEventCell
}

export interface EncounterPlacementLeavingEvent
  extends EncounterEventEnvelope<'placement-leaving'> {
  readonly placementId: string
  readonly movement: EncounterMovementIdentity
  readonly cell: EncounterEventCell
}

export interface EncounterPlacementMovingEvent
  extends EncounterEventEnvelope<'placement-moving'> {
  readonly placementId: string
  readonly movement: EncounterMovementIdentity
  readonly from: EncounterEventCell
  readonly to: EncounterEventCell
}

export interface EncounterSwitchEvent
  extends EncounterEventEnvelope<'switch'> {
  readonly recalledPlacementId: string
  readonly sentOutPlacementId: string
}

export interface EncounterRecallEvent
  extends EncounterEventEnvelope<'recall'> {
  readonly placementId: string
  readonly sideId: EncounterSideId | null
}

export interface EncounterSendOutEvent
  extends EncounterEventEnvelope<'send-out'> {
  readonly placementId: string
  readonly sideId: EncounterSideId | null
}

export interface EncounterEffectAddedEvent
  extends EncounterEventEnvelope<'effect-added'> {
  readonly effect: EncounterEffect
}

export interface EncounterEffectRemovedEvent
  extends EncounterEventEnvelope<'effect-removed'> {
  readonly effectId: string
}

export interface EncounterResourceEvent
  extends EncounterEventEnvelope<'resource-spent' | 'resource-restored'> {
  readonly placementId: string
  readonly resourceId: string
  /** Positive integral resource delta; the event kind supplies its direction. */
  readonly amount: number
}

export type EncounterEvent =
  | EncounterSceneEvent
  | EncounterRoundEvent
  | EncounterTurnEvent
  | EncounterMoveDeclaredEvent
  | EncounterMoveHitEvent
  | EncounterMoveDamagedEvent
  | EncounterMoveKoEvent
  | EncounterMoveCompletedEvent
  | EncounterPlacementEnteringEvent
  | EncounterPlacementLeavingEvent
  | EncounterPlacementMovingEvent
  | EncounterSwitchEvent
  | EncounterRecallEvent
  | EncounterSendOutEvent
  | EncounterEffectAddedEvent
  | EncounterEffectRemovedEvent
  | EncounterResourceEvent

export type EncounterEventValidationCode =
  | 'invalid-encounter-event'
  | 'unsupported-schema-version'
  | 'unknown-event-kind'
  | 'limit-exceeded'
  | 'not-json'
  | 'duplicate-id'
  | 'invalid-causality'

export class EncounterEventValidationError extends Error {
  readonly code: EncounterEventValidationCode
  readonly path: string
  readonly detail: string

  constructor(
    code: EncounterEventValidationCode,
    path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`)
    this.name = 'EncounterEventValidationError'
    this.code = code
    this.path = path
    this.detail = detail
  }
}

type UnknownRecord = Record<string, unknown>
type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject
type JsonObject = { readonly [key: string]: JsonValue }
type JsonCloneState = {
  readonly ancestors: WeakSet<object>
  nodes: number
}

const COMMON_FIELDS = [
  'schemaVersion',
  'eventId',
  'kind',
  'sourceOperationId',
  'causalParentEventId',
  'reasonCode',
] as const
const SCENE_FIELDS = [...COMMON_FIELDS, 'sceneId'] as const
const ROUND_FIELDS = [...COMMON_FIELDS, 'round'] as const
const TURN_FIELDS = [
  ...COMMON_FIELDS,
  'round',
  'turn',
  'placementId',
  'sideId',
] as const
const MOVE_DECLARED_FIELDS = [...COMMON_FIELDS, 'move', 'targetPlacementIds'] as const
const MOVE_HIT_FIELDS = [
  ...COMMON_FIELDS,
  'move',
  'targetPlacementId',
  'hitIndex',
] as const
const MOVE_DAMAGED_FIELDS = [
  ...COMMON_FIELDS,
  'move',
  'targetPlacementId',
  'hitIndex',
  'damage',
] as const
const MOVE_KO_FIELDS = [
  ...COMMON_FIELDS,
  'move',
  'targetPlacementId',
  'hitIndex',
] as const
const MOVE_COMPLETED_FIELDS = [
  ...COMMON_FIELDS,
  'move',
  'attackedTargetIds',
  'hitTargetIds',
  'outcome',
] as const
const PLACEMENT_CELL_FIELDS = [
  ...COMMON_FIELDS,
  'placementId',
  'movement',
  'cell',
] as const
const PLACEMENT_MOVING_FIELDS = [
  ...COMMON_FIELDS,
  'placementId',
  'movement',
  'from',
  'to',
] as const
const SWITCH_FIELDS = [
  ...COMMON_FIELDS,
  'recalledPlacementId',
  'sentOutPlacementId',
] as const
const PLACEMENT_LIFECYCLE_FIELDS = [
  ...COMMON_FIELDS,
  'placementId',
  'sideId',
] as const
const EFFECT_ADDED_FIELDS = [...COMMON_FIELDS, 'effect'] as const
const EFFECT_REMOVED_FIELDS = [...COMMON_FIELDS, 'effectId'] as const
const RESOURCE_FIELDS = [
  ...COMMON_FIELDS,
  'placementId',
  'resourceId',
  'amount',
] as const

const MOVE_IDENTITY_FIELDS = ['resolutionId', 'canonicalId', 'actorPlacementId'] as const
const DAMAGE_FIELDS = [
  'hitPointLoss',
  'temporaryHitPointLoss',
  'damageClass',
  'moveType',
] as const
const CELL_FIELDS = ['x', 'y', 'z'] as const
const MOVEMENT_IDENTITY_FIELDS = ['movementId', 'mode', 'step'] as const

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ARRAY_INDEX_PATTERN = /^(0|[1-9][0-9]*)$/
const EVENT_KIND_SET = new Set<string>(ENCOUNTER_EVENT_KINDS)
const DAMAGE_CLASS_SET = new Set<string>(ENCOUNTER_EVENT_DAMAGE_CLASSES)
const MOVE_OUTCOME_SET = new Set<string>(ENCOUNTER_EVENT_MOVE_OUTCOMES)
const MOVEMENT_MODE_SET = new Set<string>(ENCOUNTER_EVENT_MOVEMENT_MODES)

const fail = (
  code: EncounterEventValidationCode,
  path: string,
  detail: string,
): never => {
  throw new EncounterEventValidationError(code, path, detail)
}

const propertyPath = (path: string, key: string): string => `${path}.${key}`

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const countJsonNode = (state: JsonCloneState, path: string): void => {
  state.nodes += 1
  if (state.nodes > ENCOUNTER_EVENT_LIMITS.jsonNodes) {
    fail(
      'limit-exceeded',
      path,
      `event data must contain at most ${ENCOUNTER_EVENT_LIMITS.jsonNodes} JSON nodes.`,
    )
  }
}

/** Detach untrusted values without invoking accessors or toJSON hooks. */
const clonePlainJson = (
  value: unknown,
  path: string,
  depth: number,
  state: JsonCloneState,
): JsonValue => {
  countJsonNode(state, path)
  if (depth > ENCOUNTER_EVENT_LIMITS.jsonDepth) {
    fail(
      'limit-exceeded',
      path,
      `event data must be at most ${ENCOUNTER_EVENT_LIMITS.jsonDepth} levels deep.`,
    )
  }

  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('not-json', path, 'must be a finite JSON number.')
    return value
  }
  if (typeof value === 'string') {
    if (value.length > ENCOUNTER_EVENT_LIMITS.jsonStringChars) {
      fail(
        'limit-exceeded',
        path,
        `must contain at most ${ENCOUNTER_EVENT_LIMITS.jsonStringChars} characters.`,
      )
    }
    return value
  }
  if (
    value === undefined
    || typeof value === 'bigint'
    || typeof value === 'function'
    || typeof value === 'symbol'
  ) {
    return fail('not-json', path, `${typeof value} values are not allowed in encounter events.`)
  }

  if (Array.isArray(value)) {
    if (state.ancestors.has(value)) fail('not-json', path, 'circular references are not allowed.')
    if (value.length > ENCOUNTER_EVENT_LIMITS.jsonArrayEntries) {
      fail(
        'limit-exceeded',
        path,
        `must contain at most ${ENCOUNTER_EVENT_LIMITS.jsonArrayEntries} entries.`,
      )
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      fail('not-json', path, 'symbol properties are not allowed on arrays.')
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === 'length') continue
      const index = Number(key)
      if (!ARRAY_INDEX_PATTERN.test(key) || !Number.isSafeInteger(index) || index >= value.length) {
        fail('not-json', propertyPath(path, key), 'arrays cannot contain named properties.')
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
        ?? fail('not-json', `${path}[${key}]`, 'must have a property descriptor.')
      if (!descriptor.enumerable || !('value' in descriptor)) {
        fail('not-json', `${path}[${key}]`, 'entries must be enumerable data properties.')
      }
    }

    state.ancestors.add(value)
    const clone: JsonValue[] = []
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        ?? fail('not-json', `${path}[${index}]`, 'sparse arrays are not allowed.')
      if (!descriptor.enumerable || !('value' in descriptor)) {
        fail('not-json', `${path}[${index}]`, 'entries must be enumerable data properties.')
      }
      clone.push(clonePlainJson(
        (descriptor as PropertyDescriptor & { value: unknown }).value,
        `${path}[${index}]`,
        depth + 1,
        state,
      ))
    }
    state.ancestors.delete(value)
    return clone
  }

  if (!isPlainRecord(value)) {
    return fail('not-json', path, 'must contain only plain JSON objects.')
  }
  if (state.ancestors.has(value)) fail('not-json', path, 'circular references are not allowed.')
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('not-json', path, 'symbol properties are not allowed.')
  }

  const keys = Object.getOwnPropertyNames(value)
  if (keys.length > ENCOUNTER_EVENT_LIMITS.jsonObjectFields) {
    fail(
      'limit-exceeded',
      path,
      `objects must contain at most ${ENCOUNTER_EVENT_LIMITS.jsonObjectFields} fields.`,
    )
  }

  state.ancestors.add(value)
  const clone: Record<string, JsonValue> = {}
  for (const key of keys) {
    const keyPath = propertyPath(path, key)
    if (
      key.length === 0
      || key.length > ENCOUNTER_EVENT_LIMITS.identifierChars
      || CONTROL_CHARACTER_PATTERN.test(key)
    ) {
      fail('not-json', keyPath, 'object keys must be non-empty, bounded, and free of control characters.')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
      ?? fail('not-json', keyPath, 'must have a property descriptor.')
    if (!descriptor.enumerable || !('value' in descriptor)) {
      fail('not-json', keyPath, 'fields must be enumerable data properties.')
    }
    Object.defineProperty(clone, key, {
      value: clonePlainJson(
        (descriptor as PropertyDescriptor & { value: unknown }).value,
        keyPath,
        depth + 1,
        state,
      ),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  state.ancestors.delete(value)
  return clone
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) {
    return fail('invalid-encounter-event', path, 'must be a plain object.')
  }
  return value
}

const assertExactFields = (
  record: UnknownRecord,
  fields: readonly string[],
  path: string,
): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(record, field))
  const unknown = Object.keys(record).filter(field => !expected.has(field))
  if (missing.length === 0 && unknown.length === 0) return

  const details = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  fail(
    'invalid-encounter-event',
    path,
    `must contain exactly the supported fields (${details}).`,
  )
}

const parseExactRecord = (
  value: unknown,
  fields: readonly string[],
  path: string,
): UnknownRecord => {
  const record = parseRecord(value, path)
  assertExactFields(record, fields, path)
  return record
}

const parseBoundedText = (
  value: unknown,
  path: string,
  maximumLength = ENCOUNTER_EVENT_LIMITS.identifierChars,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail(
      'invalid-encounter-event',
      path,
      'must be a non-empty, trimmed string without control characters.',
    )
  }
  if (value.length > maximumLength) {
    fail('limit-exceeded', path, `must contain at most ${maximumLength} characters.`)
  }
  return value
}

const parseStableId = (value: unknown, path: string): string => {
  const id = parseBoundedText(value, path)
  if (!STABLE_ID_PATTERN.test(id)) {
    fail('invalid-encounter-event', path, 'must be a lowercase stable identifier.')
  }
  return id
}

const parsePlacementId = (value: unknown, path: string): string =>
  parseBoundedText(value, path)

const parseNullableStableId = (value: unknown, path: string): string | null =>
  value === null ? null : parseStableId(value, path)

const parseSideId = (value: unknown, path: string): EncounterSideId | null => {
  if (value === null) return null
  if (!isEncounterSideId(value)) {
    return fail(
      'invalid-encounter-event',
      path,
      'must be null or a lowercase alphanumeric/hyphen encounter side ID.',
    )
  }
  return value
}

const parseEnum = <Value extends string>(
  value: unknown,
  values: ReadonlySet<string>,
  path: string,
  description: string,
): Value => {
  if (typeof value !== 'string' || !values.has(value)) {
    return fail('invalid-encounter-event', path, `must be ${description}.`)
  }
  return value as Value
}

const parseInteger = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number => {
  if (!Number.isSafeInteger(value)) {
    return fail('invalid-encounter-event', path, 'must be a safe integer.')
  }
  const parsed = Number(value)
  if (parsed < minimum || parsed > maximum) {
    fail('limit-exceeded', path, `must be from ${minimum} through ${maximum}.`)
  }
  return parsed
}

const parseNullableHitIndex = (value: unknown, path: string): number | null =>
  value === null
    ? null
    : parseInteger(value, path, 1, ENCOUNTER_EVENT_LIMITS.hitIndex)

const parseArray = (
  value: unknown,
  path: string,
  maximum: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) {
    return fail('invalid-encounter-event', path, 'must be an array.')
  }
  if (value.length > maximum) {
    fail('limit-exceeded', path, `must contain at most ${maximum} entries.`)
  }
  return value
}

const parsePlacementIds = (value: unknown, path: string): readonly string[] => {
  const ids = parseArray(value, path, ENCOUNTER_EVENT_LIMITS.targetPlacements)
    .map((entry, index) => parsePlacementId(entry, `${path}[${index}]`))
  if (new Set(ids).size !== ids.length) {
    fail('duplicate-id', path, 'must not contain duplicate placement IDs.')
  }
  return ids
}

const parseCommon = <Kind extends EncounterEventKind>(
  record: UnknownRecord,
  kind: Kind,
  path: string,
): EncounterEventEnvelope<Kind> => {
  if (record.schemaVersion !== ENCOUNTER_EVENT_SCHEMA_VERSION) {
    fail(
      'unsupported-schema-version',
      `${path}.schemaVersion`,
      `must be ${ENCOUNTER_EVENT_SCHEMA_VERSION}.`,
    )
  }
  const eventId = parseStableId(record.eventId, `${path}.eventId`)
  const causalParentEventId = parseNullableStableId(
    record.causalParentEventId,
    `${path}.causalParentEventId`,
  )
  if (causalParentEventId === eventId) {
    fail(
      'invalid-causality',
      `${path}.causalParentEventId`,
      'an event cannot be its own causal parent.',
    )
  }
  return {
    schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
    eventId,
    kind,
    sourceOperationId: parseStableId(
      record.sourceOperationId,
      `${path}.sourceOperationId`,
    ),
    causalParentEventId,
    reasonCode: parseStableId(record.reasonCode, `${path}.reasonCode`),
  }
}

const parseMoveIdentity = (
  value: unknown,
  path: string,
): EncounterMoveIdentity => {
  const move = parseExactRecord(value, MOVE_IDENTITY_FIELDS, path)
  return {
    resolutionId: parseStableId(move.resolutionId, `${path}.resolutionId`),
    canonicalId: parseBoundedText(
      move.canonicalId,
      `${path}.canonicalId`,
      ENCOUNTER_EVENT_LIMITS.canonicalMoveChars,
    ),
    actorPlacementId: parsePlacementId(
      move.actorPlacementId,
      `${path}.actorPlacementId`,
    ),
  }
}

const parseDamage = (value: unknown, path: string): EncounterMoveDamage => {
  const damage = parseExactRecord(value, DAMAGE_FIELDS, path)
  const hitPointLoss = parseInteger(
    damage.hitPointLoss,
    `${path}.hitPointLoss`,
    0,
    ENCOUNTER_EVENT_LIMITS.amount,
  )
  const temporaryHitPointLoss = parseInteger(
    damage.temporaryHitPointLoss,
    `${path}.temporaryHitPointLoss`,
    0,
    ENCOUNTER_EVENT_LIMITS.amount,
  )
  if (hitPointLoss === 0 && temporaryHitPointLoss === 0) {
    fail(
      'invalid-encounter-event',
      path,
      'must record positive hit-point or temporary-hit-point loss.',
    )
  }
  return {
    hitPointLoss,
    temporaryHitPointLoss,
    damageClass: parseEnum<EncounterEventDamageClass>(
      damage.damageClass,
      DAMAGE_CLASS_SET,
      `${path}.damageClass`,
      'physical, special, or direct',
    ),
    moveType: damage.moveType === null
      ? null
      : parseStableId(damage.moveType, `${path}.moveType`),
  }
}

const parseCell = (value: unknown, path: string): EncounterEventCell => {
  const cell = parseExactRecord(value, CELL_FIELDS, path)
  return {
    x: parseInteger(cell.x, `${path}.x`, 0, ENCOUNTER_EVENT_LIMITS.coordinate),
    y: parseInteger(cell.y, `${path}.y`, 0, ENCOUNTER_EVENT_LIMITS.coordinate),
    z: parseInteger(cell.z, `${path}.z`, 0, ENCOUNTER_EVENT_LIMITS.coordinate),
  }
}

const parseMovementIdentity = (
  value: unknown,
  path: string,
): EncounterMovementIdentity => {
  const movement = parseExactRecord(value, MOVEMENT_IDENTITY_FIELDS, path)
  return {
    movementId: parseStableId(movement.movementId, `${path}.movementId`),
    mode: parseEnum<EncounterEventMovementMode>(
      movement.mode,
      MOVEMENT_MODE_SET,
      `${path}.mode`,
      'voluntary, forced, teleport, or swap',
    ),
    step: parseInteger(
      movement.step,
      `${path}.step`,
      1,
      ENCOUNTER_EVENT_LIMITS.movementStep,
    ),
  }
}

const cellsEqual = (left: EncounterEventCell, right: EncounterEventCell): boolean =>
  left.x === right.x && left.y === right.y && left.z === right.z

const expectedMoveOutcome = (
  attackedTargetIds: readonly string[],
  hitTargetIds: readonly string[],
): EncounterEventMoveOutcome => {
  if (attackedTargetIds.length === 0) return 'no-target'
  if (hitTargetIds.length === 0) return 'miss'
  if (hitTargetIds.length === attackedTargetIds.length) return 'hit'
  return 'mixed'
}

const parseEncounterEffectForEvent = (
  value: unknown,
  path: string,
): EncounterEffect => {
  try {
    return parseEncounterEffect(value, path)
  }
  catch (error) {
    if (error instanceof EncounterEffectValidationError) {
      fail(
        error.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-encounter-event',
        error.path,
        error.detail,
      )
    }
    throw error
  }
}

const parseDetachedEvent = (value: unknown, path: string): EncounterEvent => {
  const record = parseRecord(value, path)
  const rawKind = record.kind
  if (typeof rawKind !== 'string' || !EVENT_KIND_SET.has(rawKind)) {
    fail('unknown-event-kind', `${path}.kind`, 'must be a supported encounter event kind.')
  }
  const kind = rawKind as EncounterEventKind

  if (kind === 'scene-start' || kind === 'scene-end') {
    assertExactFields(record, SCENE_FIELDS, path)
    return {
      ...parseCommon(record, kind, path),
      sceneId: parseStableId(record.sceneId, `${path}.sceneId`),
    }
  }

  if (kind === 'round-start' || kind === 'round-end') {
    assertExactFields(record, ROUND_FIELDS, path)
    return {
      ...parseCommon(record, kind, path),
      round: parseInteger(record.round, `${path}.round`, 1, ENCOUNTER_EVENT_LIMITS.round),
    }
  }

  if (kind === 'turn-start' || kind === 'turn-end') {
    assertExactFields(record, TURN_FIELDS, path)
    return {
      ...parseCommon(record, kind, path),
      round: parseInteger(record.round, `${path}.round`, 1, ENCOUNTER_EVENT_LIMITS.round),
      turn: parseInteger(record.turn, `${path}.turn`, 0, ENCOUNTER_EVENT_LIMITS.turn),
      placementId: parsePlacementId(record.placementId, `${path}.placementId`),
      sideId: parseSideId(record.sideId, `${path}.sideId`),
    }
  }

  if (kind === 'move-declared') {
    assertExactFields(record, MOVE_DECLARED_FIELDS, path)
    return {
      ...parseCommon(record, kind, path),
      move: parseMoveIdentity(record.move, `${path}.move`),
      targetPlacementIds: parsePlacementIds(
        record.targetPlacementIds,
        `${path}.targetPlacementIds`,
      ),
    }
  }

  if (kind === 'move-hit') {
    assertExactFields(record, MOVE_HIT_FIELDS, path)
    return {
      ...parseCommon(record, kind, path),
      move: parseMoveIdentity(record.move, `${path}.move`),
      targetPlacementId: parsePlacementId(
        record.targetPlacementId,
        `${path}.targetPlacementId`,
      ),
      hitIndex: parseInteger(
        record.hitIndex,
        `${path}.hitIndex`,
        1,
        ENCOUNTER_EVENT_LIMITS.hitIndex,
      ),
    }
  }

  if (kind === 'move-damaged') {
    assertExactFields(record, MOVE_DAMAGED_FIELDS, path)
    return {
      ...parseCommon(record, kind, path),
      move: parseMoveIdentity(record.move, `${path}.move`),
      targetPlacementId: parsePlacementId(
        record.targetPlacementId,
        `${path}.targetPlacementId`,
      ),
      hitIndex: parseInteger(
        record.hitIndex,
        `${path}.hitIndex`,
        1,
        ENCOUNTER_EVENT_LIMITS.hitIndex,
      ),
      damage: parseDamage(record.damage, `${path}.damage`),
    }
  }

  if (kind === 'move-ko') {
    assertExactFields(record, MOVE_KO_FIELDS, path)
    return {
      ...parseCommon(record, kind, path),
      move: parseMoveIdentity(record.move, `${path}.move`),
      targetPlacementId: parsePlacementId(
        record.targetPlacementId,
        `${path}.targetPlacementId`,
      ),
      hitIndex: parseNullableHitIndex(record.hitIndex, `${path}.hitIndex`),
    }
  }

  if (kind === 'move-completed') {
    assertExactFields(record, MOVE_COMPLETED_FIELDS, path)
    const attackedTargetIds = parsePlacementIds(
      record.attackedTargetIds,
      `${path}.attackedTargetIds`,
    )
    const hitTargetIds = parsePlacementIds(record.hitTargetIds, `${path}.hitTargetIds`)
    const attacked = new Set(attackedTargetIds)
    const unknownHitId = hitTargetIds.find(targetId => !attacked.has(targetId))
    if (unknownHitId !== undefined) {
      fail(
        'invalid-encounter-event',
        `${path}.hitTargetIds`,
        `contains ${unknownHitId}, which is not an attacked target.`,
      )
    }
    const outcome = parseEnum<EncounterEventMoveOutcome>(
      record.outcome,
      MOVE_OUTCOME_SET,
      `${path}.outcome`,
      'no-target, miss, hit, or mixed',
    )
    const expectedOutcome = expectedMoveOutcome(attackedTargetIds, hitTargetIds)
    if (outcome !== expectedOutcome) {
      fail(
        'invalid-encounter-event',
        `${path}.outcome`,
        `must be ${expectedOutcome} for the attacked and hit target sets.`,
      )
    }
    return {
      ...parseCommon(record, kind, path),
      move: parseMoveIdentity(record.move, `${path}.move`),
      attackedTargetIds,
      hitTargetIds,
      outcome,
    }
  }

  if (kind === 'placement-entering' || kind === 'placement-leaving') {
    assertExactFields(record, PLACEMENT_CELL_FIELDS, path)
    return {
      ...parseCommon(record, kind, path),
      placementId: parsePlacementId(record.placementId, `${path}.placementId`),
      movement: parseMovementIdentity(record.movement, `${path}.movement`),
      cell: parseCell(record.cell, `${path}.cell`),
    }
  }

  if (kind === 'placement-moving') {
    assertExactFields(record, PLACEMENT_MOVING_FIELDS, path)
    const from = parseCell(record.from, `${path}.from`)
    const to = parseCell(record.to, `${path}.to`)
    if (cellsEqual(from, to)) {
      fail('invalid-encounter-event', path, 'movement must change the placement cell.')
    }
    return {
      ...parseCommon(record, kind, path),
      placementId: parsePlacementId(record.placementId, `${path}.placementId`),
      movement: parseMovementIdentity(record.movement, `${path}.movement`),
      from,
      to,
    }
  }

  if (kind === 'switch') {
    assertExactFields(record, SWITCH_FIELDS, path)
    const recalledPlacementId = parsePlacementId(
      record.recalledPlacementId,
      `${path}.recalledPlacementId`,
    )
    const sentOutPlacementId = parsePlacementId(
      record.sentOutPlacementId,
      `${path}.sentOutPlacementId`,
    )
    if (recalledPlacementId === sentOutPlacementId) {
      fail(
        'invalid-encounter-event',
        path,
        'a switch must recall and send out distinct placements.',
      )
    }
    return {
      ...parseCommon(record, kind, path),
      recalledPlacementId,
      sentOutPlacementId,
    }
  }

  if (kind === 'recall' || kind === 'send-out') {
    assertExactFields(record, PLACEMENT_LIFECYCLE_FIELDS, path)
    return {
      ...parseCommon(record, kind, path),
      placementId: parsePlacementId(record.placementId, `${path}.placementId`),
      sideId: parseSideId(record.sideId, `${path}.sideId`),
    }
  }

  if (kind === 'effect-added') {
    assertExactFields(record, EFFECT_ADDED_FIELDS, path)
    const common = parseCommon(record, kind, path)
    const effect = parseEncounterEffectForEvent(record.effect, `${path}.effect`)
    if (effect.source.operationId !== common.sourceOperationId) {
      fail(
        'invalid-encounter-event',
        `${path}.effect.source.operationId`,
        'must match the event sourceOperationId.',
      )
    }
    return { ...common, effect }
  }

  if (kind === 'effect-removed') {
    assertExactFields(record, EFFECT_REMOVED_FIELDS, path)
    return {
      ...parseCommon(record, kind, path),
      effectId: parseStableId(record.effectId, `${path}.effectId`),
    }
  }

  assertExactFields(record, RESOURCE_FIELDS, path)
  return {
    ...parseCommon(record, kind, path),
    placementId: parsePlacementId(record.placementId, `${path}.placementId`),
    resourceId: parseStableId(record.resourceId, `${path}.resourceId`),
    amount: parseInteger(
      record.amount,
      `${path}.amount`,
      1,
      ENCOUNTER_EVENT_LIMITS.amount,
    ),
  }
}

const detachedJson = (value: unknown, path: string): JsonValue => clonePlainJson(
  value,
  path,
  0,
  { ancestors: new WeakSet<object>(), nodes: 0 },
)

/** Strictly parse, detach, and deeply freeze one server-internal encounter fact. */
export const parseEncounterEvent = (
  value: unknown,
  path = 'encounterEvent',
): EncounterEvent => deepFreeze(parseDetachedEvent(detachedJson(value, path), path))

/**
 * Parse one bounded ordered event batch.
 *
 * A parent from the same batch must precede its child. Parents absent from the
 * batch are allowed because a resumed reducer batch may reference a durable
 * event emitted by an earlier accepted operation.
 */
export const parseEncounterEvents = (
  value: unknown,
  path = 'encounterEvents',
): readonly EncounterEvent[] => {
  const detached = detachedJson(value, path)
  const entries = parseArray(detached, path, ENCOUNTER_EVENT_LIMITS.events)
  const events = entries.map((entry, index) =>
    parseDetachedEvent(entry, `${path}[${index}]`),
  )

  const eventIndexes = new Map<string, number>()
  events.forEach((event, index) => {
    if (eventIndexes.has(event.eventId)) {
      fail('duplicate-id', `${path}[${index}].eventId`, `duplicates ${event.eventId}.`)
    }
    eventIndexes.set(event.eventId, index)
  })

  events.forEach((event, index) => {
    if (event.causalParentEventId === null) return
    const parentIndex = eventIndexes.get(event.causalParentEventId)
    if (parentIndex !== undefined && parentIndex >= index) {
      fail(
        'invalid-causality',
        `${path}[${index}].causalParentEventId`,
        'a causal parent from the same batch must precede its child.',
      )
    }
  })

  return deepFreeze(events)
}
