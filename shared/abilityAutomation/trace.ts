import {
  ABILITY_SPEC_PHASES,
  type AbilitySpecJsonValue,
  type AbilitySpecPhase,
} from './spec'
import {
  parseAbilityAutomationRollLedger,
  type AbilityAutomationRollLedgerEntry,
} from './random'
import {
  cloneStrictJson,
  deepFreezeStrictJson,
  isPlainJsonObject,
  type StrictJsonValue,
} from '../automation/strictJson'

export const ABILITY_RESOLUTION_TRACE_SCHEMA_VERSION = 1 as const

export const ABILITY_RESOLUTION_TRACE_EVENT_KINDS = [
  'phase-transition',
  'eligibility',
  'suppression',
  'subscription',
  'choice',
  'roll',
  'operation',
  'prevention',
  'lifecycle',
  'child-ability',
] as const

export const ABILITY_RESOLUTION_TRACE_LIMITS = Object.freeze({
  events: 2_048,
  ancestryDepth: 16,
  recipients: 128,
  identifierLength: 200,
  textLength: 500,
  jsonDepth: 16,
  jsonNodes: 16_384,
  jsonObjectFields: 128,
  jsonArrayEntries: 256,
  numericMagnitude: 1_000_000_000,
})

export type AbilityResolutionTraceEventKind =
  (typeof ABILITY_RESOLUTION_TRACE_EVENT_KINDS)[number]
export type AbilityResolutionOperationOutcome = 'applied' | 'prevented' | 'no-op' | 'pending'
export type AbilityResolutionChoiceOutcome = 'requested' | 'selected' | 'passed' | 'cancelled'
export type AbilityResolutionChildOutcome = 'started' | 'completed' | 'cancelled'

export interface AbilityResolutionProgramIdentity {
  readonly canonicalId: string
  readonly modeId: string
  readonly runtimeKind: 'abilityspec-v1'
  readonly runtimeVersion: number
  readonly definitionHash: string
  readonly sourceModule: string
}

export interface AbilityResolutionRulesetIdentity {
  readonly rulesetId: string
  readonly sourceDataSha256: string
}

export interface AbilityResolutionTraceAncestryEntry {
  readonly depth: number
  readonly resolutionId: string
  readonly canonicalId: string
  readonly modeId: string
  readonly definitionHash: string
  readonly parentEventId: string | null
  readonly parentOperationId: string | null
}

interface AbilityResolutionTraceEventBase<Kind extends AbilityResolutionTraceEventKind> {
  readonly sequence: number
  readonly kind: Kind
  readonly reasonCode: string
}

export interface AbilityResolutionPhaseTransitionTraceEvent
  extends AbilityResolutionTraceEventBase<'phase-transition'> {
  readonly from: AbilitySpecPhase | null
  readonly to: AbilitySpecPhase
}

export interface AbilityResolutionEligibilityTraceEvent
  extends AbilityResolutionTraceEventBase<'eligibility'> {
  readonly phase: AbilitySpecPhase
  readonly abilityInstanceId: string
  readonly outcome: 'eligible' | 'ineligible'
  readonly input: AbilitySpecJsonValue
}

export interface AbilityResolutionSuppressionTraceEvent
  extends AbilityResolutionTraceEventBase<'suppression'> {
  readonly phase: AbilitySpecPhase
  readonly abilityInstanceId: string
  readonly outcome: 'effective' | 'suppressed'
  readonly sourceInstanceId: string | null
}

export interface AbilityResolutionSubscriptionTraceEvent
  extends AbilityResolutionTraceEventBase<'subscription'> {
  readonly phase: AbilitySpecPhase
  readonly subscriptionId: string
  readonly eventId: string
  readonly outcome: 'matched' | 'skipped'
}

export interface AbilityResolutionChoiceTraceEvent
  extends AbilityResolutionTraceEventBase<'choice'> {
  readonly phase: AbilitySpecPhase
  readonly requestId: string
  readonly requestKind: 'choice' | 'reaction'
  readonly outcome: AbilityResolutionChoiceOutcome
  readonly optionId: string | null
}

export interface AbilityResolutionRollTraceEvent
  extends AbilityResolutionTraceEventBase<'roll'> {
  readonly phase: AbilitySpecPhase
  readonly roll: AbilityAutomationRollLedgerEntry
}

export interface AbilityResolutionOperationTraceEvent
  extends AbilityResolutionTraceEventBase<'operation'> {
  readonly phase: AbilitySpecPhase
  readonly operationId: string
  readonly operationKind: string
  readonly recipientIds: readonly string[]
  readonly outcome: AbilityResolutionOperationOutcome
  readonly input: AbilitySpecJsonValue
  readonly result: AbilitySpecJsonValue
}

export interface AbilityResolutionPreventionTraceEvent
  extends AbilityResolutionTraceEventBase<'prevention'> {
  readonly phase: AbilitySpecPhase
  readonly operationId: string
  readonly recipientId: string
  readonly preventedBy: string
}

export interface AbilityResolutionLifecycleTraceEvent
  extends AbilityResolutionTraceEventBase<'lifecycle'> {
  readonly phase: AbilitySpecPhase
  readonly eventId: string
  readonly action: 'created' | 'refreshed' | 'expired' | 'removed' | 'reset'
  readonly subjectId: string
}

export interface AbilityResolutionChildAbilityTraceEvent
  extends AbilityResolutionTraceEventBase<'child-ability'> {
  readonly phase: AbilitySpecPhase
  readonly childResolutionId: string
  readonly canonicalId: string
  readonly modeId: string
  readonly definitionHash: string
  readonly parentEventId: string | null
  readonly parentOperationId: string
  readonly depth: number
  readonly outcome: AbilityResolutionChildOutcome
}

export type AbilityResolutionAuditTraceEvent =
  | AbilityResolutionPhaseTransitionTraceEvent
  | AbilityResolutionEligibilityTraceEvent
  | AbilityResolutionSuppressionTraceEvent
  | AbilityResolutionSubscriptionTraceEvent
  | AbilityResolutionChoiceTraceEvent
  | AbilityResolutionRollTraceEvent
  | AbilityResolutionOperationTraceEvent
  | AbilityResolutionPreventionTraceEvent
  | AbilityResolutionLifecycleTraceEvent
  | AbilityResolutionChildAbilityTraceEvent

export type AbilityResolutionAuditTraceEventInput =
  AbilityResolutionAuditTraceEvent extends infer Event
    ? Event extends AbilityResolutionAuditTraceEvent
      ? Omit<Event, 'sequence'>
      : never
    : never

export interface AbilityResolutionAuditTrace {
  readonly schemaVersion: typeof ABILITY_RESOLUTION_TRACE_SCHEMA_VERSION
  readonly resolutionId: string
  readonly program: AbilityResolutionProgramIdentity
  readonly ruleset: AbilityResolutionRulesetIdentity
  readonly ancestry: readonly AbilityResolutionTraceAncestryEntry[]
  readonly events: readonly AbilityResolutionAuditTraceEvent[]
}

export type AbilityResolutionTraceValidationCode =
  | 'invalid-trace'
  | 'unsupported-schema-version'
  | 'unknown-event-kind'
  | 'limit-exceeded'
  | 'not-json'
  | 'invalid-sequence'
  | 'invalid-phase-order'
  | 'duplicate-roll-id'
  | 'invalid-ancestry'

export class AbilityResolutionTraceValidationError extends Error {
  readonly code: AbilityResolutionTraceValidationCode
  readonly path: string

  constructor(code: AbilityResolutionTraceValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'AbilityResolutionTraceValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const TRACE_FIELDS = ['schemaVersion', 'resolutionId', 'program', 'ruleset', 'ancestry', 'events'] as const
const PROGRAM_FIELDS = [
  'canonicalId',
  'modeId',
  'runtimeKind',
  'runtimeVersion',
  'definitionHash',
  'sourceModule',
] as const
const RULESET_FIELDS = ['rulesetId', 'sourceDataSha256'] as const
const ANCESTRY_FIELDS = [
  'depth',
  'resolutionId',
  'canonicalId',
  'modeId',
  'definitionHash',
  'parentEventId',
  'parentOperationId',
] as const
const EVENT_FIELDS: Readonly<Record<AbilityResolutionTraceEventKind, readonly string[]>> = {
  'phase-transition': ['kind', 'reasonCode', 'from', 'to'],
  eligibility: ['kind', 'reasonCode', 'phase', 'abilityInstanceId', 'outcome', 'input'],
  suppression: ['kind', 'reasonCode', 'phase', 'abilityInstanceId', 'outcome', 'sourceInstanceId'],
  subscription: ['kind', 'reasonCode', 'phase', 'subscriptionId', 'eventId', 'outcome'],
  choice: ['kind', 'reasonCode', 'phase', 'requestId', 'requestKind', 'outcome', 'optionId'],
  roll: ['kind', 'reasonCode', 'phase', 'roll'],
  operation: [
    'kind',
    'reasonCode',
    'phase',
    'operationId',
    'operationKind',
    'recipientIds',
    'outcome',
    'input',
    'result',
  ],
  prevention: ['kind', 'reasonCode', 'phase', 'operationId', 'recipientId', 'preventedBy'],
  lifecycle: ['kind', 'reasonCode', 'phase', 'eventId', 'action', 'subjectId'],
  'child-ability': [
    'kind',
    'reasonCode',
    'phase',
    'childResolutionId',
    'canonicalId',
    'modeId',
    'definitionHash',
    'parentEventId',
    'parentOperationId',
    'depth',
    'outcome',
  ],
}
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const PHASE_SET = new Set<string>(ABILITY_SPEC_PHASES)
const PHASE_INDEX = new Map<string, number>(ABILITY_SPEC_PHASES.map((phase, index) => [phase, index]))
const EVENT_KIND_SET = new Set<string>(ABILITY_RESOLUTION_TRACE_EVENT_KINDS)

const fail = (
  code: AbilityResolutionTraceValidationCode,
  path: string,
  detail: string,
): never => {
  throw new AbilityResolutionTraceValidationError(code, path, detail)
}

const clone = (value: unknown, path: string): StrictJsonValue => cloneStrictJson(value, path, {
  limits: {
    depth: ABILITY_RESOLUTION_TRACE_LIMITS.jsonDepth,
    nodes: ABILITY_RESOLUTION_TRACE_LIMITS.jsonNodes,
    objectFields: ABILITY_RESOLUTION_TRACE_LIMITS.jsonObjectFields,
    arrayEntries: ABILITY_RESOLUTION_TRACE_LIMITS.jsonArrayEntries,
    stringLength: ABILITY_RESOLUTION_TRACE_LIMITS.textLength,
    objectKeyLength: ABILITY_RESOLUTION_TRACE_LIMITS.identifierLength,
  },
  rootLabel: 'ability trace data',
  valueLabel: 'ability traces',
  failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
  failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
})

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) return fail('invalid-trace', path, 'must be an object.')
  return value
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) {
    fail('invalid-trace', path, 'must contain exactly the supported fields.')
  }
}

const text = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ABILITY_RESOLUTION_TRACE_LIMITS.textLength
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fail('invalid-trace', path, 'must be bounded non-empty trimmed text.')
  }
  return value
}

const stableId = (value: unknown, path: string): string => {
  const parsed = text(value, path)
  if (parsed.length > ABILITY_RESOLUTION_TRACE_LIMITS.identifierLength || !STABLE_ID_PATTERN.test(parsed)) {
    fail('invalid-trace', path, 'must be a bounded stable identifier.')
  }
  return parsed
}

const hash = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return fail('invalid-trace', path, 'must be a lowercase SHA-256 digest.')
  }
  return value
}

const integer = (value: unknown, path: string, maximum: number): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    return fail('invalid-trace', path, `must be an integer from 0 through ${maximum}.`)
  }
  return Number(value)
}

const phase = (value: unknown, path: string): AbilitySpecPhase => {
  if (typeof value !== 'string' || !PHASE_SET.has(value)) {
    return fail('invalid-trace', path, 'must be a supported AbilitySpec phase.')
  }
  return value as AbilitySpecPhase
}

const optionalStableId = (value: unknown, path: string): string | null => (
  value === null ? null : stableId(value, path)
)

const stringArray = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value) || value.length > ABILITY_RESOLUTION_TRACE_LIMITS.recipients) {
    return fail('invalid-trace', path, 'must be a bounded array.')
  }
  const values = value.map((entry, index) => text(entry, `${path}[${index}]`))
  if (new Set(values).size !== values.length) fail('invalid-trace', path, 'must not contain duplicates.')
  return Object.freeze(values)
}

const parseProgram = (value: unknown, path: string): AbilityResolutionProgramIdentity => {
  const input = record(value, path)
  exact(input, PROGRAM_FIELDS, path)
  if (input.runtimeKind !== 'abilityspec-v1') {
    fail('invalid-trace', `${path}.runtimeKind`, 'must be abilityspec-v1.')
  }
  const runtimeVersion = integer(input.runtimeVersion, `${path}.runtimeVersion`, Number.MAX_SAFE_INTEGER)
  if (runtimeVersion < 1) fail('invalid-trace', `${path}.runtimeVersion`, 'must be positive.')
  return Object.freeze({
    canonicalId: text(input.canonicalId, `${path}.canonicalId`),
    modeId: stableId(input.modeId, `${path}.modeId`),
    runtimeKind: 'abilityspec-v1',
    runtimeVersion,
    definitionHash: hash(input.definitionHash, `${path}.definitionHash`),
    sourceModule: text(input.sourceModule, `${path}.sourceModule`),
  })
}

const parseRuleset = (value: unknown, path: string): AbilityResolutionRulesetIdentity => {
  const input = record(value, path)
  exact(input, RULESET_FIELDS, path)
  return Object.freeze({
    rulesetId: text(input.rulesetId, `${path}.rulesetId`),
    sourceDataSha256: hash(input.sourceDataSha256, `${path}.sourceDataSha256`),
  })
}

const parseAncestry = (
  value: unknown,
  path: string,
): readonly AbilityResolutionTraceAncestryEntry[] => {
  if (!Array.isArray(value) || value.length > ABILITY_RESOLUTION_TRACE_LIMITS.ancestryDepth) {
    return fail('invalid-ancestry', path, 'must be a bounded ancestry array.')
  }
  const entries = value.map((value, index): AbilityResolutionTraceAncestryEntry => {
    const entryPath = `${path}[${index}]`
    const input = record(value, entryPath)
    exact(input, ANCESTRY_FIELDS, entryPath)
    const depth = integer(input.depth, `${entryPath}.depth`, ABILITY_RESOLUTION_TRACE_LIMITS.ancestryDepth)
    if (depth !== index) fail('invalid-ancestry', `${entryPath}.depth`, 'must be contiguous from zero.')
    return Object.freeze({
      depth,
      resolutionId: stableId(input.resolutionId, `${entryPath}.resolutionId`),
      canonicalId: text(input.canonicalId, `${entryPath}.canonicalId`),
      modeId: stableId(input.modeId, `${entryPath}.modeId`),
      definitionHash: hash(input.definitionHash, `${entryPath}.definitionHash`),
      parentEventId: optionalStableId(input.parentEventId, `${entryPath}.parentEventId`),
      parentOperationId: optionalStableId(input.parentOperationId, `${entryPath}.parentOperationId`),
    })
  })
  if (new Set(entries.map(entry => entry.resolutionId)).size !== entries.length) {
    fail('invalid-ancestry', path, 'must not repeat resolution IDs.')
  }
  return Object.freeze(entries)
}

const enumValue = <Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string,
): Value => {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    return fail('invalid-trace', path, 'contains an unsupported value.')
  }
  return value as Value
}

const parseEventInput = (
  value: unknown,
  path: string,
  ancestryDepth: number,
): AbilityResolutionAuditTraceEventInput => {
  const input = record(value, path)
  if (typeof input.kind !== 'string' || !EVENT_KIND_SET.has(input.kind)) {
    return fail('unknown-event-kind', `${path}.kind`, 'is unsupported.')
  }
  const kind = input.kind as AbilityResolutionTraceEventKind
  exact(input, EVENT_FIELDS[kind], path)
  const reasonCode = stableId(input.reasonCode, `${path}.reasonCode`)
  if (kind === 'phase-transition') {
    return {
      kind,
      reasonCode,
      from: input.from === null ? null : phase(input.from, `${path}.from`),
      to: phase(input.to, `${path}.to`),
    }
  }
  const eventPhase = phase(input.phase, `${path}.phase`)
  if (kind === 'eligibility') return {
    kind,
    reasonCode,
    phase: eventPhase,
    abilityInstanceId: stableId(input.abilityInstanceId, `${path}.abilityInstanceId`),
    outcome: enumValue(input.outcome, ['eligible', 'ineligible'], `${path}.outcome`),
    input: input.input as AbilitySpecJsonValue,
  }
  if (kind === 'suppression') return {
    kind,
    reasonCode,
    phase: eventPhase,
    abilityInstanceId: stableId(input.abilityInstanceId, `${path}.abilityInstanceId`),
    outcome: enumValue(input.outcome, ['effective', 'suppressed'], `${path}.outcome`),
    sourceInstanceId: optionalStableId(input.sourceInstanceId, `${path}.sourceInstanceId`),
  }
  if (kind === 'subscription') return {
    kind,
    reasonCode,
    phase: eventPhase,
    subscriptionId: stableId(input.subscriptionId, `${path}.subscriptionId`),
    eventId: stableId(input.eventId, `${path}.eventId`),
    outcome: enumValue(input.outcome, ['matched', 'skipped'], `${path}.outcome`),
  }
  if (kind === 'choice') return {
    kind,
    reasonCode,
    phase: eventPhase,
    requestId: stableId(input.requestId, `${path}.requestId`),
    requestKind: enumValue(input.requestKind, ['choice', 'reaction'], `${path}.requestKind`),
    outcome: enumValue(
      input.outcome,
      ['requested', 'selected', 'passed', 'cancelled'],
      `${path}.outcome`,
    ),
    optionId: optionalStableId(input.optionId, `${path}.optionId`),
  }
  if (kind === 'roll') {
    return {
      kind,
      reasonCode,
      phase: eventPhase,
      roll: parseAbilityAutomationRollLedger([input.roll], `${path}.roll`)[0]!,
    }
  }
  if (kind === 'operation') return {
    kind,
    reasonCode,
    phase: eventPhase,
    operationId: stableId(input.operationId, `${path}.operationId`),
    operationKind: stableId(input.operationKind, `${path}.operationKind`),
    recipientIds: stringArray(input.recipientIds, `${path}.recipientIds`),
    outcome: enumValue(
      input.outcome,
      ['applied', 'prevented', 'no-op', 'pending'],
      `${path}.outcome`,
    ),
    input: input.input as AbilitySpecJsonValue,
    result: input.result as AbilitySpecJsonValue,
  }
  if (kind === 'prevention') return {
    kind,
    reasonCode,
    phase: eventPhase,
    operationId: stableId(input.operationId, `${path}.operationId`),
    recipientId: text(input.recipientId, `${path}.recipientId`),
    preventedBy: text(input.preventedBy, `${path}.preventedBy`),
  }
  if (kind === 'lifecycle') return {
    kind,
    reasonCode,
    phase: eventPhase,
    eventId: stableId(input.eventId, `${path}.eventId`),
    action: enumValue(
      input.action,
      ['created', 'refreshed', 'expired', 'removed', 'reset'],
      `${path}.action`,
    ),
    subjectId: stableId(input.subjectId, `${path}.subjectId`),
  }
  const depth = integer(input.depth, `${path}.depth`, ABILITY_RESOLUTION_TRACE_LIMITS.ancestryDepth)
  if (depth !== ancestryDepth + 1) {
    fail('invalid-ancestry', `${path}.depth`, 'must identify the direct child causal depth.')
  }
  return {
    kind,
    reasonCode,
    phase: eventPhase,
    childResolutionId: stableId(input.childResolutionId, `${path}.childResolutionId`),
    canonicalId: text(input.canonicalId, `${path}.canonicalId`),
    modeId: stableId(input.modeId, `${path}.modeId`),
    definitionHash: hash(input.definitionHash, `${path}.definitionHash`),
    parentEventId: optionalStableId(input.parentEventId, `${path}.parentEventId`),
    parentOperationId: stableId(input.parentOperationId, `${path}.parentOperationId`),
    depth,
    outcome: enumValue(input.outcome, ['started', 'completed', 'cancelled'], `${path}.outcome`),
  }
}

export const createAbilityResolutionTrace = (input: {
  readonly resolutionId: string
  readonly program: AbilityResolutionProgramIdentity
  readonly ruleset: AbilityResolutionRulesetIdentity
  readonly ancestry?: readonly AbilityResolutionTraceAncestryEntry[]
}): AbilityResolutionAuditTrace => {
  const detached = clone({
    schemaVersion: ABILITY_RESOLUTION_TRACE_SCHEMA_VERSION,
    resolutionId: input.resolutionId,
    program: input.program,
    ruleset: input.ruleset,
    ancestry: input.ancestry ?? [],
    events: [],
  }, 'abilityTrace')
  const root = record(detached, 'abilityTrace')
  exact(root, TRACE_FIELDS, 'abilityTrace')
  const resolutionId = stableId(root.resolutionId, 'abilityTrace.resolutionId')
  const ancestry = parseAncestry(root.ancestry, 'abilityTrace.ancestry')
  if (ancestry.some(entry => entry.resolutionId === resolutionId)) {
    fail('invalid-ancestry', 'abilityTrace.resolutionId', 'cannot repeat an ancestor resolution ID.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_RESOLUTION_TRACE_SCHEMA_VERSION,
    resolutionId,
    program: parseProgram(root.program, 'abilityTrace.program'),
    ruleset: parseRuleset(root.ruleset, 'abilityTrace.ruleset'),
    ancestry,
    events: Object.freeze([]),
  })
}

const activePhase = (trace: AbilityResolutionAuditTrace): AbilitySpecPhase | null => {
  for (let index = trace.events.length - 1; index >= 0; index -= 1) {
    const event = trace.events[index]!
    if (event.kind === 'phase-transition') return event.to
  }
  return null
}

export const appendAbilityResolutionTraceEvent = (
  trace: AbilityResolutionAuditTrace,
  eventInput: AbilityResolutionAuditTraceEventInput,
): AbilityResolutionAuditTrace => {
  if (trace.events.length >= ABILITY_RESOLUTION_TRACE_LIMITS.events) {
    fail('limit-exceeded', 'abilityTrace.events', 'contains too many events.')
  }
  const detached = clone(eventInput, `abilityTrace.events[${trace.events.length}]`)
  const parsed = parseEventInput(
    detached,
    `abilityTrace.events[${trace.events.length}]`,
    trace.ancestry.length,
  )
  const currentPhase = activePhase(trace)
  if (parsed.kind === 'phase-transition') {
    if (parsed.from !== currentPhase) {
      fail('invalid-phase-order', 'abilityTrace.events', 'phase transition does not match active phase.')
    }
    const previousIndex = currentPhase === null ? -1 : PHASE_INDEX.get(currentPhase)!
    if (PHASE_INDEX.get(parsed.to)! <= previousIndex) {
      fail('invalid-phase-order', 'abilityTrace.events', 'phases cannot repeat or move backward.')
    }
  }
  else if (parsed.phase !== currentPhase) {
    fail('invalid-phase-order', 'abilityTrace.events', 'event must use the active phase.')
  }
  if (
    parsed.kind === 'roll'
    && trace.events.some(event => event.kind === 'roll' && event.roll.rollId === parsed.roll.rollId)
  ) {
    fail('duplicate-roll-id', 'abilityTrace.events', `roll ${parsed.roll.rollId} is duplicated.`)
  }
  const event = Object.freeze({
    ...parsed,
    sequence: trace.events.length,
  }) as AbilityResolutionAuditTraceEvent
  return deepFreezeStrictJson({
    ...trace,
    events: [...trace.events, event],
  })
}

/** Parse a persisted trace by replaying every strict sequence and phase invariant. */
export const parseAbilityResolutionTrace = (value: unknown): AbilityResolutionAuditTrace => {
  const detached = clone(value, 'abilityTrace')
  const input = record(detached, 'abilityTrace')
  exact(input, TRACE_FIELDS, 'abilityTrace')
  if (input.schemaVersion !== ABILITY_RESOLUTION_TRACE_SCHEMA_VERSION) {
    fail('unsupported-schema-version', 'abilityTrace.schemaVersion', 'is unsupported.')
  }
  const eventInputs = input.events
  if (!Array.isArray(eventInputs) || eventInputs.length > ABILITY_RESOLUTION_TRACE_LIMITS.events) {
    fail('limit-exceeded', 'abilityTrace.events', 'must be a bounded array.')
  }
  const eventArray = eventInputs as readonly StrictJsonValue[]
  let trace = createAbilityResolutionTrace({
    resolutionId: text(input.resolutionId, 'abilityTrace.resolutionId'),
    program: parseProgram(input.program, 'abilityTrace.program'),
    ruleset: parseRuleset(input.ruleset, 'abilityTrace.ruleset'),
    ancestry: parseAncestry(input.ancestry, 'abilityTrace.ancestry'),
  })
  eventArray.forEach((value, index) => {
    const path = `abilityTrace.events[${index}]`
    const event = record(value, path)
    if (event.sequence !== index) fail('invalid-sequence', `${path}.sequence`, `must be ${index}.`)
    const { sequence: _sequence, ...eventInput } = event
    trace = appendAbilityResolutionTraceEvent(
      trace,
      eventInput as AbilityResolutionAuditTraceEventInput,
    )
  })
  return trace
}

export const abilityResolutionTraceRollLedger = (
  trace: AbilityResolutionAuditTrace,
): readonly AbilityAutomationRollLedgerEntry[] => parseAbilityAutomationRollLedger(
  trace.events.flatMap(event => event.kind === 'roll' ? [event.roll] : []),
  'abilityTrace.rollLedger',
)

/** Build the immutable ancestry supplied to one direct child ability. */
export const childAbilityResolutionAncestry = (input: {
  readonly trace: AbilityResolutionAuditTrace
  readonly parentEventId: string | null
  readonly parentOperationId: string
}): readonly AbilityResolutionTraceAncestryEntry[] => {
  if (input.trace.ancestry.length >= ABILITY_RESOLUTION_TRACE_LIMITS.ancestryDepth) {
    return fail('limit-exceeded', 'abilityTrace.ancestry', 'cannot create a deeper child.')
  }
  return parseAncestry([
    ...input.trace.ancestry,
    {
      depth: input.trace.ancestry.length,
      resolutionId: input.trace.resolutionId,
      canonicalId: input.trace.program.canonicalId,
      modeId: input.trace.program.modeId,
      definitionHash: input.trace.program.definitionHash,
      parentEventId: input.parentEventId,
      parentOperationId: input.parentOperationId,
    },
  ], 'abilityTrace.ancestry')
}
