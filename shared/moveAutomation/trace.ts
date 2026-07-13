import {
  MOVE_EFFECT_OPERATION_KINDS,
  MOVE_EFFECT_OPERATION_LIMITS,
  type MoveEffectOperationKind,
} from './effects'
import {
  MoveAutomationRollLedgerValidationError,
  parseMoveAutomationRollLedger,
  type MoveAutomationRollLedgerEntry,
} from './random'
import {
  MOVE_SPEC_PHASES,
  type MoveSpecPhase,
} from './spec'

export const MOVE_RESOLUTION_TRACE_SCHEMA_VERSION = 1 as const

export const MOVE_RESOLUTION_TRACE_RUNTIME_KINDS = [
  'legacy-v1',
  'movespec-v2',
  'ability-follow-ups',
] as const

export const MOVE_RESOLUTION_TRACE_EVENT_KINDS = [
  'phase-transition',
  'predicate',
  'target',
  'roll',
  'operation',
  'choice',
  'child-move',
] as const

export const MOVE_RESOLUTION_TRACE_LIMITS = Object.freeze({
  auditEvents: 2_048,
  wireEvents: 256,
  ancestryDepth: 16,
  recipients: 32,
  identifierLength: MOVE_EFFECT_OPERATION_LIMITS.identifierLength,
  textLength: MOVE_EFFECT_OPERATION_LIMITS.textLength,
  jsonDepth: 12,
  jsonNodes: 8_192,
  jsonObjectFields: 128,
  jsonArrayEntries: 256,
  numericMagnitude: 1_000_000_000,
})

export type MoveResolutionTraceRuntimeKind =
  (typeof MOVE_RESOLUTION_TRACE_RUNTIME_KINDS)[number]
export type MoveResolutionTraceEventKind =
  (typeof MOVE_RESOLUTION_TRACE_EVENT_KINDS)[number]
export type MoveResolutionTraceTargetOutcome = 'included' | 'excluded'
export type MoveResolutionTraceOperationOutcome =
  | 'applied'
  | 'prevented'
  | 'no-op'
  | 'pending'
export type MoveResolutionTraceRequestKind = 'choice' | 'reaction'
export type MoveResolutionTraceChoiceOutcome =
  | 'requested'
  | 'selected'
  | 'passed'
  | 'cancelled'
export type MoveResolutionTraceChildOutcome = 'started' | 'completed' | 'cancelled'

export type MoveResolutionTraceJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly MoveResolutionTraceJsonValue[]
  | MoveResolutionTraceJsonObject

export type MoveResolutionTraceJsonObject = {
  readonly [key: string]: MoveResolutionTraceJsonValue
}

export interface MoveResolutionTraceProgramIdentity {
  readonly canonicalId: string
  readonly runtimeKind: MoveResolutionTraceRuntimeKind
  readonly runtimeVersion: number
  /** Reviewed MoveSpec hash, or the equivalent reviewed legacy definition fingerprint. */
  readonly definitionHash: string
}

export interface MoveResolutionTraceRulesetIdentity {
  readonly rulesetId: string
  /** Hash of the frozen source data named by the ruleset provenance record. */
  readonly sourceDataSha256: string
}

export interface MoveResolutionTraceAncestryEntry {
  readonly depth: number
  readonly resolutionId: string
  readonly canonicalId: string
  readonly definitionHash: string
  readonly parentOperationId: string | null
}

interface MoveResolutionTraceEventBase<Kind extends MoveResolutionTraceEventKind> {
  readonly sequence: number
  readonly kind: Kind
  readonly reasonCode: string
}

export interface MoveResolutionPhaseTransitionTraceEvent
  extends MoveResolutionTraceEventBase<'phase-transition'> {
  readonly from: MoveSpecPhase | null
  readonly to: MoveSpecPhase
}

export interface MoveResolutionPredicateTraceEvent
  extends MoveResolutionTraceEventBase<'predicate'> {
  readonly phase: MoveSpecPhase
  readonly predicateId: string
  readonly outcome: boolean
  /** Complete bounded server-only predicate inputs used for this decision. */
  readonly input: MoveResolutionTraceJsonValue
}

export interface MoveResolutionTargetTraceEvent
  extends MoveResolutionTraceEventBase<'target'> {
  readonly phase: MoveSpecPhase
  readonly targetId: string
  readonly outcome: MoveResolutionTraceTargetOutcome
}

export interface MoveResolutionRollTraceEvent
  extends MoveResolutionTraceEventBase<'roll'> {
  readonly phase: MoveSpecPhase
  readonly roll: MoveAutomationRollLedgerEntry
}

export interface MoveResolutionOperationTraceEvent
  extends MoveResolutionTraceEventBase<'operation'> {
  readonly phase: MoveSpecPhase
  readonly operationId: string
  readonly operationKind: MoveEffectOperationKind
  readonly recipientIds: readonly string[]
  readonly outcome: MoveResolutionTraceOperationOutcome
  /** Complete bounded server-only operation request. */
  readonly input: MoveResolutionTraceJsonValue
  /** Complete bounded server-only reducer/interpreter result. */
  readonly result: MoveResolutionTraceJsonValue
}

export interface MoveResolutionChoiceTraceEvent
  extends MoveResolutionTraceEventBase<'choice'> {
  readonly phase: MoveSpecPhase
  readonly requestId: string
  readonly requestKind: MoveResolutionTraceRequestKind
  readonly outcome: MoveResolutionTraceChoiceOutcome
  /** Retained for the server audit trace; omitted from the public summary. */
  readonly optionId: string | null
}

export interface MoveResolutionChildMoveTraceEvent
  extends MoveResolutionTraceEventBase<'child-move'> {
  readonly phase: MoveSpecPhase
  readonly childResolutionId: string
  readonly canonicalId: string
  readonly definitionHash: string
  readonly parentOperationId: string
  readonly depth: number
  readonly outcome: MoveResolutionTraceChildOutcome
}

export type MoveResolutionAuditTraceEvent =
  | MoveResolutionPhaseTransitionTraceEvent
  | MoveResolutionPredicateTraceEvent
  | MoveResolutionTargetTraceEvent
  | MoveResolutionRollTraceEvent
  | MoveResolutionOperationTraceEvent
  | MoveResolutionChoiceTraceEvent
  | MoveResolutionChildMoveTraceEvent

export type MoveResolutionAuditTraceEventInput =
  MoveResolutionAuditTraceEvent extends infer Event
    ? Event extends MoveResolutionAuditTraceEvent
      ? Omit<Event, 'sequence'>
      : never
    : never

export interface MoveResolutionAuditTrace {
  readonly schemaVersion: typeof MOVE_RESOLUTION_TRACE_SCHEMA_VERSION
  readonly program: MoveResolutionTraceProgramIdentity
  readonly ruleset: MoveResolutionTraceRulesetIdentity
  readonly ancestry: readonly MoveResolutionTraceAncestryEntry[]
  readonly events: readonly MoveResolutionAuditTraceEvent[]
}

export type MoveResolutionWirePhaseTransitionTraceEvent =
  MoveResolutionPhaseTransitionTraceEvent
export type MoveResolutionWirePredicateTraceEvent = Omit<
  MoveResolutionPredicateTraceEvent,
  'input'
>
export type MoveResolutionWireTargetTraceEvent = MoveResolutionTargetTraceEvent

export interface MoveResolutionWireRollTraceEvent
  extends MoveResolutionTraceEventBase<'roll'> {
  readonly phase: MoveSpecPhase
  readonly rollId: string
  readonly parentEffectId: string
  readonly naturalResult: number
  readonly modifierTotal: number
  readonly finalValue: number
}

export type MoveResolutionWireOperationTraceEvent = Omit<
  MoveResolutionOperationTraceEvent,
  'input' | 'result'
>
export type MoveResolutionWireChoiceTraceEvent = Omit<
  MoveResolutionChoiceTraceEvent,
  'optionId'
>
export type MoveResolutionWireChildMoveTraceEvent = MoveResolutionChildMoveTraceEvent

export type MoveResolutionWireTraceEvent =
  | MoveResolutionWirePhaseTransitionTraceEvent
  | MoveResolutionWirePredicateTraceEvent
  | MoveResolutionWireTargetTraceEvent
  | MoveResolutionWireRollTraceEvent
  | MoveResolutionWireOperationTraceEvent
  | MoveResolutionWireChoiceTraceEvent
  | MoveResolutionWireChildMoveTraceEvent

export interface MoveResolutionTraceSummary {
  readonly schemaVersion: typeof MOVE_RESOLUTION_TRACE_SCHEMA_VERSION
  readonly program: MoveResolutionTraceProgramIdentity
  readonly ruleset: MoveResolutionTraceRulesetIdentity
  readonly ancestry: readonly MoveResolutionTraceAncestryEntry[]
  readonly totalEventCount: number
  readonly truncated: boolean
  /** Sanitized event projection: operation payloads and selected option IDs never enter it. */
  readonly events: readonly MoveResolutionWireTraceEvent[]
}

export type MoveResolutionTraceValidationCode =
  | 'invalid-trace'
  | 'unsupported-schema-version'
  | 'unknown-event-kind'
  | 'limit-exceeded'
  | 'not-json'
  | 'invalid-sequence'

export class MoveResolutionTraceValidationError extends Error {
  readonly code: MoveResolutionTraceValidationCode
  readonly path: string

  constructor(code: MoveResolutionTraceValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'MoveResolutionTraceValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>
type JsonParseState = { nodes: number; readonly ancestors: WeakSet<object> }

const TRACE_FIELDS = ['schemaVersion', 'program', 'ruleset', 'ancestry', 'events'] as const
const SUMMARY_FIELDS = [
  'schemaVersion',
  'program',
  'ruleset',
  'ancestry',
  'totalEventCount',
  'truncated',
  'events',
] as const
const PROGRAM_FIELDS = ['canonicalId', 'runtimeKind', 'runtimeVersion', 'definitionHash'] as const
const RULESET_FIELDS = ['rulesetId', 'sourceDataSha256'] as const
const ANCESTRY_FIELDS = [
  'depth',
  'resolutionId',
  'canonicalId',
  'definitionHash',
  'parentOperationId',
] as const
const PHASE_EVENT_FIELDS = ['sequence', 'kind', 'reasonCode', 'from', 'to'] as const
const PREDICATE_EVENT_FIELDS = [
  'sequence',
  'kind',
  'reasonCode',
  'phase',
  'predicateId',
  'outcome',
  'input',
] as const
const WIRE_PREDICATE_EVENT_FIELDS = PREDICATE_EVENT_FIELDS.filter(field => field !== 'input')
const TARGET_EVENT_FIELDS = [
  'sequence',
  'kind',
  'reasonCode',
  'phase',
  'targetId',
  'outcome',
] as const
const ROLL_EVENT_FIELDS = ['sequence', 'kind', 'reasonCode', 'phase', 'roll'] as const
const WIRE_ROLL_EVENT_FIELDS = [
  'sequence',
  'kind',
  'reasonCode',
  'phase',
  'rollId',
  'parentEffectId',
  'naturalResult',
  'modifierTotal',
  'finalValue',
] as const
const OPERATION_EVENT_FIELDS = [
  'sequence',
  'kind',
  'reasonCode',
  'phase',
  'operationId',
  'operationKind',
  'recipientIds',
  'outcome',
  'input',
  'result',
] as const
const WIRE_OPERATION_EVENT_FIELDS = OPERATION_EVENT_FIELDS.filter(
  field => field !== 'input' && field !== 'result',
)
const CHOICE_EVENT_FIELDS = [
  'sequence',
  'kind',
  'reasonCode',
  'phase',
  'requestId',
  'requestKind',
  'outcome',
  'optionId',
] as const
const WIRE_CHOICE_EVENT_FIELDS = CHOICE_EVENT_FIELDS.filter(field => field !== 'optionId')
const CHILD_EVENT_FIELDS = [
  'sequence',
  'kind',
  'reasonCode',
  'phase',
  'childResolutionId',
  'canonicalId',
  'definitionHash',
  'parentOperationId',
  'depth',
  'outcome',
] as const

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ARRAY_INDEX_PATTERN = /^(0|[1-9][0-9]*)$/
const RUNTIME_KIND_SET = new Set<string>(MOVE_RESOLUTION_TRACE_RUNTIME_KINDS)
const EVENT_KIND_SET = new Set<string>(MOVE_RESOLUTION_TRACE_EVENT_KINDS)
const PHASE_SET = new Set<string>(MOVE_SPEC_PHASES)
const PHASE_INDEX = new Map<string, number>(MOVE_SPEC_PHASES.map((phase, index) => [phase, index]))
const OPERATION_KIND_SET = new Set<string>(MOVE_EFFECT_OPERATION_KINDS)
const TARGET_OUTCOME_SET = new Set<string>(['included', 'excluded'])
const OPERATION_OUTCOME_SET = new Set<string>(['applied', 'prevented', 'no-op', 'pending'])
const REQUEST_KIND_SET = new Set<string>(['choice', 'reaction'])
const CHOICE_OUTCOME_SET = new Set<string>(['requested', 'selected', 'passed', 'cancelled'])
const CHILD_OUTCOME_SET = new Set<string>(['started', 'completed', 'cancelled'])

const fail = (
  code: MoveResolutionTraceValidationCode,
  path: string,
  message: string,
): never => {
  throw new MoveResolutionTraceValidationError(code, path, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) return fail('not-json', path, 'must be a plain JSON object.')
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('not-json', path, 'symbol properties are not allowed.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
      ?? fail('not-json', `${path}.${key}`, 'must have a property descriptor.')
    if (!descriptor.enumerable || !('value' in descriptor)) {
      fail('not-json', `${path}.${key}`, 'fields must be enumerable data properties.')
    }
  }
  return value
}

const assertExactFields = (
  value: UnknownRecord,
  fields: readonly string[],
  path: string,
): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(value, field))
  const unknown = Object.getOwnPropertyNames(value).filter(field => !expected.has(field))
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'invalid-trace',
      path,
      `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
    )
  }
}

const parseBoundedArray = (
  value: unknown,
  path: string,
  maximumLength: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) return fail('invalid-trace', path, 'must be an array.')
  if (value.length > maximumLength) {
    fail('limit-exceeded', path, `must contain at most ${maximumLength} entries.`)
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('not-json', path, 'symbol properties are not allowed.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === 'length') continue
    const index = Number(key)
    if (!ARRAY_INDEX_PATTERN.test(key) || !Number.isSafeInteger(index) || index >= value.length) {
      fail('not-json', `${path}.${key}`, 'arrays cannot contain named properties.')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
      ?? fail('not-json', `${path}[${key}]`, 'must have a property descriptor.')
    if (!descriptor.enumerable || !('value' in descriptor)) {
      fail('not-json', `${path}[${key}]`, 'entries must be enumerable data properties.')
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      fail('not-json', `${path}[${index}]`, 'sparse arrays are not allowed.')
    }
  }
  return value
}

const parseBoundedText = (value: unknown, path: string, maximumLength: number): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail('invalid-trace', path, 'must be a non-empty, trimmed, single-line string.')
  }
  if (value.length > maximumLength) {
    fail('limit-exceeded', path, `must contain at most ${maximumLength} characters.`)
  }
  return value
}

const parseStableId = (value: unknown, path: string): string => {
  const id = parseBoundedText(value, path, MOVE_RESOLUTION_TRACE_LIMITS.identifierLength)
  if (!STABLE_ID_PATTERN.test(id)) {
    fail('invalid-trace', path, 'must be a lowercase stable identifier.')
  }
  return id
}

const parseSha256 = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return fail('invalid-trace', path, 'must be a lowercase SHA-256 digest.')
  }
  return value
}

const parseInteger = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    return fail('invalid-trace', path, `must be a safe integer from ${minimum} through ${maximum}.`)
  }
  return Number(value)
}

const parseFiniteNumber = (value: unknown, path: string): number => {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || Math.abs(value) > MOVE_RESOLUTION_TRACE_LIMITS.numericMagnitude
  ) {
    return fail(
      'invalid-trace',
      path,
      `must be finite and within ±${MOVE_RESOLUTION_TRACE_LIMITS.numericMagnitude}.`,
    )
  }
  return value
}

const parseBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') return fail('invalid-trace', path, 'must be a boolean.')
  return value
}

const parseEnum = <Value extends string>(
  value: unknown,
  values: ReadonlySet<string>,
  path: string,
  description: string,
): Value => {
  if (typeof value !== 'string' || !values.has(value)) {
    return fail('invalid-trace', path, `must be ${description}.`)
  }
  return value as Value
}

const parseEventKind = (value: unknown, path: string): MoveResolutionTraceEventKind => {
  if (typeof value !== 'string' || !EVENT_KIND_SET.has(value)) {
    return fail('unknown-event-kind', path, 'must be a supported trace event kind.')
  }
  return value as MoveResolutionTraceEventKind
}

const parsePhase = (value: unknown, path: string): MoveSpecPhase => parseEnum<MoveSpecPhase>(
  value,
  PHASE_SET,
  path,
  'a supported MoveSpec phase',
)

const parseNullablePhase = (value: unknown, path: string): MoveSpecPhase | null => (
  value === null ? null : parsePhase(value, path)
)

const parseJsonValue = (
  value: unknown,
  path: string,
  depth: number,
  state: JsonParseState,
): MoveResolutionTraceJsonValue => {
  state.nodes += 1
  if (state.nodes > MOVE_RESOLUTION_TRACE_LIMITS.jsonNodes) {
    fail(
      'limit-exceeded',
      path,
      `audit operation data must contain at most ${MOVE_RESOLUTION_TRACE_LIMITS.jsonNodes} JSON nodes.`,
    )
  }
  if (depth > MOVE_RESOLUTION_TRACE_LIMITS.jsonDepth) {
    fail('limit-exceeded', path, `must be at most ${MOVE_RESOLUTION_TRACE_LIMITS.jsonDepth} levels deep.`)
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return parseFiniteNumber(value, path)
  if (typeof value === 'string') {
    return parseBoundedText(value, path, MOVE_RESOLUTION_TRACE_LIMITS.textLength)
  }

  if (Array.isArray(value)) {
    if (state.ancestors.has(value)) return fail('not-json', path, 'circular references are not allowed.')
    const entries = parseBoundedArray(
      value,
      path,
      MOVE_RESOLUTION_TRACE_LIMITS.jsonArrayEntries,
    )
    state.ancestors.add(value)
    const parsed = entries.map((entry, index) => parseJsonValue(entry, `${path}[${index}]`, depth + 1, state))
    state.ancestors.delete(value)
    return parsed
  }

  const record = parseRecord(value, path)
  if (state.ancestors.has(record)) return fail('not-json', path, 'circular references are not allowed.')
  const fields = Object.getOwnPropertyNames(record)
  if (fields.length > MOVE_RESOLUTION_TRACE_LIMITS.jsonObjectFields) {
    fail(
      'limit-exceeded',
      path,
      `must contain at most ${MOVE_RESOLUTION_TRACE_LIMITS.jsonObjectFields} fields.`,
    )
  }
  state.ancestors.add(record)
  const parsed: Record<string, MoveResolutionTraceJsonValue> = {}
  for (const field of fields) {
    parseBoundedText(field, `${path}.${field}`, MOVE_RESOLUTION_TRACE_LIMITS.identifierLength)
    Object.defineProperty(parsed, field, {
      value: parseJsonValue(record[field], `${path}.${field}`, depth + 1, state),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  state.ancestors.delete(record)
  return parsed
}

const parseProgram = (value: unknown, path: string): MoveResolutionTraceProgramIdentity => {
  const record = parseRecord(value, path)
  assertExactFields(record, PROGRAM_FIELDS, path)
  return {
    canonicalId: parseBoundedText(
      record.canonicalId,
      `${path}.canonicalId`,
      MOVE_RESOLUTION_TRACE_LIMITS.identifierLength,
    ),
    runtimeKind: parseEnum<MoveResolutionTraceRuntimeKind>(
      record.runtimeKind,
      RUNTIME_KIND_SET,
      `${path}.runtimeKind`,
      'legacy-v1 or movespec-v2',
    ),
    runtimeVersion: parseInteger(
      record.runtimeVersion,
      `${path}.runtimeVersion`,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    definitionHash: parseSha256(record.definitionHash, `${path}.definitionHash`),
  }
}

const parseRuleset = (value: unknown, path: string): MoveResolutionTraceRulesetIdentity => {
  const record = parseRecord(value, path)
  assertExactFields(record, RULESET_FIELDS, path)
  return {
    rulesetId: parseBoundedText(
      record.rulesetId,
      `${path}.rulesetId`,
      MOVE_RESOLUTION_TRACE_LIMITS.identifierLength,
    ),
    sourceDataSha256: parseSha256(record.sourceDataSha256, `${path}.sourceDataSha256`),
  }
}

const parseAncestry = (
  value: unknown,
  path: string,
): readonly MoveResolutionTraceAncestryEntry[] => {
  const resolutionIds = new Set<string>()
  return parseBoundedArray(value, path, MOVE_RESOLUTION_TRACE_LIMITS.ancestryDepth)
    .map((entry, index): MoveResolutionTraceAncestryEntry => {
      const entryPath = `${path}[${index}]`
      const record = parseRecord(entry, entryPath)
      assertExactFields(record, ANCESTRY_FIELDS, entryPath)
      const depth = parseInteger(
        record.depth,
        `${entryPath}.depth`,
        0,
        MOVE_RESOLUTION_TRACE_LIMITS.ancestryDepth - 1,
      )
      if (depth !== index) {
        fail('invalid-sequence', `${entryPath}.depth`, `must equal ancestry index ${index}.`)
      }
      const resolutionId = parseBoundedText(
        record.resolutionId,
        `${entryPath}.resolutionId`,
        MOVE_RESOLUTION_TRACE_LIMITS.identifierLength,
      )
      if (resolutionIds.has(resolutionId)) {
        fail('invalid-trace', `${entryPath}.resolutionId`, `duplicates ${resolutionId}.`)
      }
      resolutionIds.add(resolutionId)
      return {
        depth,
        resolutionId,
        canonicalId: parseBoundedText(
          record.canonicalId,
          `${entryPath}.canonicalId`,
          MOVE_RESOLUTION_TRACE_LIMITS.identifierLength,
        ),
        definitionHash: parseSha256(record.definitionHash, `${entryPath}.definitionHash`),
        parentOperationId: record.parentOperationId === null
          ? null
          : parseStableId(record.parentOperationId, `${entryPath}.parentOperationId`),
      }
    })
}

const parseSequence = (record: UnknownRecord, path: string): number => parseInteger(
  record.sequence,
  `${path}.sequence`,
  1,
  MOVE_RESOLUTION_TRACE_LIMITS.auditEvents,
)

const parseReasonCode = (record: UnknownRecord, path: string): string => parseStableId(
  record.reasonCode,
  `${path}.reasonCode`,
)

const parseRecipientIds = (value: unknown, path: string): readonly string[] => {
  const seen = new Set<string>()
  return parseBoundedArray(value, path, MOVE_RESOLUTION_TRACE_LIMITS.recipients)
    .map((recipientId, index) => {
      const parsed = parseBoundedText(
        recipientId,
        `${path}[${index}]`,
        MOVE_RESOLUTION_TRACE_LIMITS.identifierLength,
      )
      if (seen.has(parsed)) fail('invalid-trace', `${path}[${index}]`, `duplicates ${parsed}.`)
      seen.add(parsed)
      return parsed
    })
}

const parseAuditEvent = (
  value: unknown,
  path: string,
  jsonState: JsonParseState,
): MoveResolutionAuditTraceEvent => {
  const record = parseRecord(value, path)
  const kind = parseEventKind(record.kind, `${path}.kind`)
  const sequence = parseSequence(record, path)
  const reasonCode = parseReasonCode(record, path)

  if (kind === 'phase-transition') {
    assertExactFields(record, PHASE_EVENT_FIELDS, path)
    return {
      sequence,
      kind,
      reasonCode,
      from: parseNullablePhase(record.from, `${path}.from`),
      to: parsePhase(record.to, `${path}.to`),
    }
  }
  if (kind === 'predicate') {
    assertExactFields(record, PREDICATE_EVENT_FIELDS, path)
    return {
      sequence,
      kind,
      reasonCode,
      phase: parsePhase(record.phase, `${path}.phase`),
      predicateId: parseStableId(record.predicateId, `${path}.predicateId`),
      outcome: parseBoolean(record.outcome, `${path}.outcome`),
      input: parseJsonValue(record.input, `${path}.input`, 0, jsonState),
    }
  }
  if (kind === 'target') {
    assertExactFields(record, TARGET_EVENT_FIELDS, path)
    return {
      sequence,
      kind,
      reasonCode,
      phase: parsePhase(record.phase, `${path}.phase`),
      targetId: parseBoundedText(
        record.targetId,
        `${path}.targetId`,
        MOVE_RESOLUTION_TRACE_LIMITS.identifierLength,
      ),
      outcome: parseEnum<MoveResolutionTraceTargetOutcome>(
        record.outcome,
        TARGET_OUTCOME_SET,
        `${path}.outcome`,
        'included or excluded',
      ),
    }
  }
  if (kind === 'roll') {
    assertExactFields(record, ROLL_EVENT_FIELDS, path)
    let roll: MoveAutomationRollLedgerEntry
    try {
      roll = parseMoveAutomationRollLedger([record.roll], `${path}.roll`)[0]!
    }
    catch (error) {
      if (error instanceof MoveAutomationRollLedgerValidationError) {
        return fail('invalid-trace', error.path, error.message)
      }
      throw error
    }
    return {
      sequence,
      kind,
      reasonCode,
      phase: parsePhase(record.phase, `${path}.phase`),
      roll,
    }
  }
  if (kind === 'operation') {
    assertExactFields(record, OPERATION_EVENT_FIELDS, path)
    return {
      sequence,
      kind,
      reasonCode,
      phase: parsePhase(record.phase, `${path}.phase`),
      operationId: parseStableId(record.operationId, `${path}.operationId`),
      operationKind: parseEnum<MoveEffectOperationKind>(
        record.operationKind,
        OPERATION_KIND_SET,
        `${path}.operationKind`,
        'a supported effect-operation kind',
      ),
      recipientIds: parseRecipientIds(record.recipientIds, `${path}.recipientIds`),
      outcome: parseEnum<MoveResolutionTraceOperationOutcome>(
        record.outcome,
        OPERATION_OUTCOME_SET,
        `${path}.outcome`,
        'applied, prevented, no-op, or pending',
      ),
      input: parseJsonValue(record.input, `${path}.input`, 0, jsonState),
      result: parseJsonValue(record.result, `${path}.result`, 0, jsonState),
    }
  }
  if (kind === 'choice') {
    assertExactFields(record, CHOICE_EVENT_FIELDS, path)
    return {
      sequence,
      kind,
      reasonCode,
      phase: parsePhase(record.phase, `${path}.phase`),
      requestId: parseStableId(record.requestId, `${path}.requestId`),
      requestKind: parseEnum<MoveResolutionTraceRequestKind>(
        record.requestKind,
        REQUEST_KIND_SET,
        `${path}.requestKind`,
        'choice or reaction',
      ),
      outcome: parseEnum<MoveResolutionTraceChoiceOutcome>(
        record.outcome,
        CHOICE_OUTCOME_SET,
        `${path}.outcome`,
        'requested, selected, passed, or cancelled',
      ),
      optionId: record.optionId === null
        ? null
        : parseStableId(record.optionId, `${path}.optionId`),
    }
  }

  assertExactFields(record, CHILD_EVENT_FIELDS, path)
  return {
    sequence,
    kind,
    reasonCode,
    phase: parsePhase(record.phase, `${path}.phase`),
    childResolutionId: parseBoundedText(
      record.childResolutionId,
      `${path}.childResolutionId`,
      MOVE_RESOLUTION_TRACE_LIMITS.identifierLength,
    ),
    canonicalId: parseBoundedText(
      record.canonicalId,
      `${path}.canonicalId`,
      MOVE_RESOLUTION_TRACE_LIMITS.identifierLength,
    ),
    definitionHash: parseSha256(record.definitionHash, `${path}.definitionHash`),
    parentOperationId: parseStableId(record.parentOperationId, `${path}.parentOperationId`),
    depth: parseInteger(
      record.depth,
      `${path}.depth`,
      1,
      MOVE_RESOLUTION_TRACE_LIMITS.ancestryDepth,
    ),
    outcome: parseEnum<MoveResolutionTraceChildOutcome>(
      record.outcome,
      CHILD_OUTCOME_SET,
      `${path}.outcome`,
      'started, completed, or cancelled',
    ),
  }
}

const parseWireEvent = (value: unknown, path: string): MoveResolutionWireTraceEvent => {
  const record = parseRecord(value, path)
  const kind = parseEventKind(record.kind, `${path}.kind`)
  const sequence = parseSequence(record, path)
  const reasonCode = parseReasonCode(record, path)

  if (kind === 'phase-transition') {
    assertExactFields(record, PHASE_EVENT_FIELDS, path)
    return {
      sequence,
      kind,
      reasonCode,
      from: parseNullablePhase(record.from, `${path}.from`),
      to: parsePhase(record.to, `${path}.to`),
    }
  }
  if (kind === 'predicate') {
    assertExactFields(record, WIRE_PREDICATE_EVENT_FIELDS, path)
    return {
      sequence,
      kind,
      reasonCode,
      phase: parsePhase(record.phase, `${path}.phase`),
      predicateId: parseStableId(record.predicateId, `${path}.predicateId`),
      outcome: parseBoolean(record.outcome, `${path}.outcome`),
    }
  }
  if (kind === 'target') {
    assertExactFields(record, TARGET_EVENT_FIELDS, path)
    return {
      sequence,
      kind,
      reasonCode,
      phase: parsePhase(record.phase, `${path}.phase`),
      targetId: parseBoundedText(
        record.targetId,
        `${path}.targetId`,
        MOVE_RESOLUTION_TRACE_LIMITS.identifierLength,
      ),
      outcome: parseEnum<MoveResolutionTraceTargetOutcome>(
        record.outcome,
        TARGET_OUTCOME_SET,
        `${path}.outcome`,
        'included or excluded',
      ),
    }
  }
  if (kind === 'roll') {
    assertExactFields(record, WIRE_ROLL_EVENT_FIELDS, path)
    return {
      sequence,
      kind,
      reasonCode,
      phase: parsePhase(record.phase, `${path}.phase`),
      rollId: parseStableId(record.rollId, `${path}.rollId`),
      parentEffectId: parseStableId(record.parentEffectId, `${path}.parentEffectId`),
      naturalResult: parseFiniteNumber(record.naturalResult, `${path}.naturalResult`),
      modifierTotal: parseFiniteNumber(record.modifierTotal, `${path}.modifierTotal`),
      finalValue: parseFiniteNumber(record.finalValue, `${path}.finalValue`),
    }
  }
  if (kind === 'operation') {
    assertExactFields(record, WIRE_OPERATION_EVENT_FIELDS, path)
    return {
      sequence,
      kind,
      reasonCode,
      phase: parsePhase(record.phase, `${path}.phase`),
      operationId: parseStableId(record.operationId, `${path}.operationId`),
      operationKind: parseEnum<MoveEffectOperationKind>(
        record.operationKind,
        OPERATION_KIND_SET,
        `${path}.operationKind`,
        'a supported effect-operation kind',
      ),
      recipientIds: parseRecipientIds(record.recipientIds, `${path}.recipientIds`),
      outcome: parseEnum<MoveResolutionTraceOperationOutcome>(
        record.outcome,
        OPERATION_OUTCOME_SET,
        `${path}.outcome`,
        'applied, prevented, no-op, or pending',
      ),
    }
  }
  if (kind === 'choice') {
    assertExactFields(record, WIRE_CHOICE_EVENT_FIELDS, path)
    return {
      sequence,
      kind,
      reasonCode,
      phase: parsePhase(record.phase, `${path}.phase`),
      requestId: parseStableId(record.requestId, `${path}.requestId`),
      requestKind: parseEnum<MoveResolutionTraceRequestKind>(
        record.requestKind,
        REQUEST_KIND_SET,
        `${path}.requestKind`,
        'choice or reaction',
      ),
      outcome: parseEnum<MoveResolutionTraceChoiceOutcome>(
        record.outcome,
        CHOICE_OUTCOME_SET,
        `${path}.outcome`,
        'requested, selected, passed, or cancelled',
      ),
    }
  }

  assertExactFields(record, CHILD_EVENT_FIELDS, path)
  return {
    sequence,
    kind,
    reasonCode,
    phase: parsePhase(record.phase, `${path}.phase`),
    childResolutionId: parseBoundedText(
      record.childResolutionId,
      `${path}.childResolutionId`,
      MOVE_RESOLUTION_TRACE_LIMITS.identifierLength,
    ),
    canonicalId: parseBoundedText(
      record.canonicalId,
      `${path}.canonicalId`,
      MOVE_RESOLUTION_TRACE_LIMITS.identifierLength,
    ),
    definitionHash: parseSha256(record.definitionHash, `${path}.definitionHash`),
    parentOperationId: parseStableId(record.parentOperationId, `${path}.parentOperationId`),
    depth: parseInteger(
      record.depth,
      `${path}.depth`,
      1,
      MOVE_RESOLUTION_TRACE_LIMITS.ancestryDepth,
    ),
    outcome: parseEnum<MoveResolutionTraceChildOutcome>(
      record.outcome,
      CHILD_OUTCOME_SET,
      `${path}.outcome`,
      'started, completed, or cancelled',
    ),
  }
}

const assertAuditSequenceAndPhases = (
  events: readonly MoveResolutionAuditTraceEvent[],
  path: string,
): void => {
  let activePhase: MoveSpecPhase | null = null
  const rollIds = new Set<string>()
  const operationIds = new Set<string>()

  events.forEach((event, index) => {
    const eventPath = `${path}[${index}]`
    if (event.sequence !== index + 1) {
      fail('invalid-sequence', `${eventPath}.sequence`, `must equal ${index + 1}.`)
    }
    if (event.kind === 'phase-transition') {
      if (event.from !== activePhase) {
        fail(
          'invalid-sequence',
          `${eventPath}.from`,
          `must match active phase ${activePhase ?? 'null'}.`,
        )
      }
      const previousIndex = activePhase === null ? -1 : PHASE_INDEX.get(activePhase) ?? -1
      const nextIndex = PHASE_INDEX.get(event.to) ?? -1
      if (nextIndex <= previousIndex) {
        fail('invalid-sequence', `${eventPath}.to`, 'must advance in canonical phase order.')
      }
      activePhase = event.to
      return
    }
    if (event.phase !== activePhase) {
      fail(
        'invalid-sequence',
        `${eventPath}.phase`,
        `must match active phase ${activePhase ?? 'null'}.`,
      )
    }
    if (event.kind === 'roll') {
      if (rollIds.has(event.roll.rollId)) {
        fail('invalid-trace', `${eventPath}.roll.rollId`, `duplicates ${event.roll.rollId}.`)
      }
      rollIds.add(event.roll.rollId)
    }
    if (event.kind === 'operation') {
      if (operationIds.has(event.operationId)) {
        fail('invalid-trace', `${eventPath}.operationId`, `duplicates ${event.operationId}.`)
      }
      operationIds.add(event.operationId)
    }
  })
}

const assertWireSequence = (
  events: readonly MoveResolutionWireTraceEvent[],
  totalEventCount: number,
  truncated: boolean,
  path: string,
): void => {
  let previousSequence = 0
  events.forEach((event, index) => {
    if (event.sequence <= previousSequence || event.sequence > totalEventCount) {
      fail(
        'invalid-sequence',
        `${path}[${index}].sequence`,
        `must increase and not exceed totalEventCount ${totalEventCount}.`,
      )
    }
    previousSequence = event.sequence
  })
  if (!truncated) {
    if (events.length !== totalEventCount) {
      fail('invalid-sequence', path, 'must contain every event when truncated is false.')
    }
    events.forEach((event, index) => {
      if (event.sequence !== index + 1) {
        fail('invalid-sequence', `${path}[${index}].sequence`, `must equal ${index + 1}.`)
      }
    })
  }
  else if (totalEventCount <= events.length) {
    fail('invalid-sequence', path, 'truncated summaries must omit at least one event.')
  }
}

/** Strictly parse, detach, and freeze the complete server audit trace. */
export const parseMoveResolutionAuditTrace = (
  value: unknown,
  path = 'trace',
): MoveResolutionAuditTrace => {
  const record = parseRecord(value, path)
  assertExactFields(record, TRACE_FIELDS, path)
  if (record.schemaVersion !== MOVE_RESOLUTION_TRACE_SCHEMA_VERSION) {
    fail(
      'unsupported-schema-version',
      `${path}.schemaVersion`,
      `must be ${MOVE_RESOLUTION_TRACE_SCHEMA_VERSION}.`,
    )
  }
  const jsonState: JsonParseState = { nodes: 0, ancestors: new WeakSet<object>() }
  const events = parseBoundedArray(
    record.events,
    `${path}.events`,
    MOVE_RESOLUTION_TRACE_LIMITS.auditEvents,
  ).map((event, index) => parseAuditEvent(event, `${path}.events[${index}]`, jsonState))
  assertAuditSequenceAndPhases(events, `${path}.events`)
  return deepFreeze({
    schemaVersion: MOVE_RESOLUTION_TRACE_SCHEMA_VERSION,
    program: parseProgram(record.program, `${path}.program`),
    ruleset: parseRuleset(record.ruleset, `${path}.ruleset`),
    ancestry: parseAncestry(record.ancestry, `${path}.ancestry`),
    events,
  })
}

/** Strictly parse, detach, and freeze a bounded public trace projection. */
export const parseMoveResolutionTraceSummary = (
  value: unknown,
  path = 'trace',
): MoveResolutionTraceSummary => {
  const record = parseRecord(value, path)
  assertExactFields(record, SUMMARY_FIELDS, path)
  if (record.schemaVersion !== MOVE_RESOLUTION_TRACE_SCHEMA_VERSION) {
    fail(
      'unsupported-schema-version',
      `${path}.schemaVersion`,
      `must be ${MOVE_RESOLUTION_TRACE_SCHEMA_VERSION}.`,
    )
  }
  const totalEventCount = parseInteger(
    record.totalEventCount,
    `${path}.totalEventCount`,
    0,
    MOVE_RESOLUTION_TRACE_LIMITS.auditEvents,
  )
  const truncated = parseBoolean(record.truncated, `${path}.truncated`)
  const events = parseBoundedArray(
    record.events,
    `${path}.events`,
    MOVE_RESOLUTION_TRACE_LIMITS.wireEvents,
  ).map((event, index) => parseWireEvent(event, `${path}.events[${index}]`))
  assertWireSequence(events, totalEventCount, truncated, `${path}.events`)
  return deepFreeze({
    schemaVersion: MOVE_RESOLUTION_TRACE_SCHEMA_VERSION,
    program: parseProgram(record.program, `${path}.program`),
    ruleset: parseRuleset(record.ruleset, `${path}.ruleset`),
    ancestry: parseAncestry(record.ancestry, `${path}.ancestry`),
    totalEventCount,
    truncated,
    events,
  })
}
