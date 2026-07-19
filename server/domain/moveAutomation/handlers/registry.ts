import {
  MOVE_EFFECT_OPERATION_LIMITS,
  parseMoveEffectOperations,
  type MoveEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  MOVE_SPEC_LIMITS,
  MOVE_SPEC_PHASES,
  type MoveSpecPhase,
} from '#shared/moveAutomation/spec'
import {
  MOVE_RESOLUTION_TRACE_LIMITS,
  type MoveResolutionAuditTraceEvent,
  type MoveResolutionAuditTraceEventInput,
} from '#shared/moveAutomation/trace'
import type { AuthoritativeMoveRulesContext } from '../context'
import { stableJsonStringify } from '../stableJson'
import {
  createMoveResolutionTrace,
  reduceMoveResolutionTrace,
} from '../trace'
import { ASTONISH_MOVE_HANDLER_REGISTRATION } from './astonish'
import { AREA_STAGES_207_HANDLER_REGISTRATION } from './areaStages207'
import { DARK_VOID_MOVE_HANDLER_REGISTRATION } from './darkVoid'
import { SECONDARY_CONDITIONS_203_HANDLER_REGISTRATION } from './secondaryConditions203'
import { STOMP_MOVE_HANDLER_REGISTRATION } from './stomp'
import { TAKE_DOWN_MOVE_HANDLER_REGISTRATION } from './takeDown'

export const REGISTERED_MOVE_HANDLER_LIMITS = Object.freeze({
  operations: MOVE_EFFECT_OPERATION_LIMITS.operations,
  traceEntries: 256,
  jsonDepth: MOVE_SPEC_LIMITS.jsonDepth,
  jsonNodes: 32_768,
})

/**
 * Handler calculations receive only frozen authoritative snapshots, pure query
 * functions, and the read-set recorder. Randomness, time/ID generation,
 * repositories, and other orchestration dependencies are deliberately absent.
 */
export type RegisteredMoveHandlerContext = Pick<
  AuthoritativeMoveRulesContext,
  | 'map'
  | 'intent'
  | 'actor'
  | 'candidatePlacements'
  | 'selectedPlacements'
  | 'resolvedSheets'
  | 'ruleset'
  | 'queries'
  | 'reads'
>

/** Handler-authored calculation evidence. Operations receive their own trace entries. */
export type RegisteredMoveHandlerTraceEntry = Extract<
  MoveResolutionAuditTraceEventInput,
  { readonly kind: 'predicate' | 'target' }
>

export interface RegisteredMoveHandlerOutput {
  readonly operations: readonly MoveEffectOperation[]
  readonly traceEntries: readonly RegisteredMoveHandlerTraceEntry[]
}

export interface RegisteredMoveHandlerRegistration {
  readonly id: string
  readonly version: number
  /** Synchronous by design: handlers cannot await repositories or network services. */
  readonly run: (context: RegisteredMoveHandlerContext) => unknown
}

export interface RegisteredMoveHandlerReference {
  readonly id: string
  readonly version: number
}

export interface RegisteredMoveHandlerRegistry {
  readonly size: number
  resolve(id: string): RegisteredMoveHandlerRegistration | null
  entries(): readonly RegisteredMoveHandlerRegistration[]
}

export type RegisteredMoveHandlerRegistryValidationCode =
  | 'invalid-registration'
  | 'duplicate-id'

export class RegisteredMoveHandlerRegistryValidationError extends Error {
  readonly code: RegisteredMoveHandlerRegistryValidationCode
  readonly path: string

  constructor(
    code: RegisteredMoveHandlerRegistryValidationCode,
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'RegisteredMoveHandlerRegistryValidationError'
    this.code = code
    this.path = path
  }
}

export type RegisteredMoveHandlerOutputValidationCode =
  | 'invalid-output'
  | 'limit-exceeded'
  | 'invalid-phase-order'
  | 'unsupported-trace-entry'

export class RegisteredMoveHandlerOutputValidationError extends Error {
  readonly code: RegisteredMoveHandlerOutputValidationCode
  readonly path: string

  constructor(
    code: RegisteredMoveHandlerOutputValidationCode,
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'RegisteredMoveHandlerOutputValidationError'
    this.code = code
    this.path = path
  }
}

export type RegisteredMoveHandlerExecutionCode =
  | 'handler-version-mismatch'
  | 'handler-threw'

export class RegisteredMoveHandlerExecutionError extends Error {
  readonly code: RegisteredMoveHandlerExecutionCode
  readonly handlerId: string

  constructor(
    code: RegisteredMoveHandlerExecutionCode,
    handlerId: string,
    message: string,
  ) {
    super(message)
    this.name = 'RegisteredMoveHandlerExecutionError'
    this.code = code
    this.handlerId = handlerId
  }
}

type UnknownRecord = Record<string, unknown>

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const PHASE_INDEX = new Map<string, number>(
  MOVE_SPEC_PHASES.map((phase, index) => [phase, index]),
)
const OUTPUT_FIELDS = ['operations', 'traceEntries'] as const
const HANDLER_TRACE_ENTRY_KINDS = new Set<string>(['predicate', 'target'])

const failRegistry = (
  code: RegisteredMoveHandlerRegistryValidationCode,
  path: string,
  message: string,
): never => {
  throw new RegisteredMoveHandlerRegistryValidationError(code, path, message)
}

const failOutput = (
  code: RegisteredMoveHandlerOutputValidationCode,
  path: string,
  message: string,
): never => {
  throw new RegisteredMoveHandlerOutputValidationError(code, path, message)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const validHandlerId = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= MOVE_SPEC_LIMITS.identifierLength
  && value.trim() === value
  && !CONTROL_CHARACTER_PATTERN.test(value)
  && STABLE_ID_PATTERN.test(value)
)

const validateRegistration = (
  value: RegisteredMoveHandlerRegistration,
  index: number,
): RegisteredMoveHandlerRegistration => {
  const path = `handlers[${index}]`
  if (!isPlainRecord(value)) {
    return failRegistry('invalid-registration', path, 'must be a plain registration object.')
  }
  if (!validHandlerId(value.id)) {
    failRegistry(
      'invalid-registration',
      `${path}.id`,
      'must be a bounded lowercase stable identifier.',
    )
  }
  if (!Number.isSafeInteger(value.version) || value.version < 1) {
    failRegistry(
      'invalid-registration',
      `${path}.version`,
      'must be a positive safe integer.',
    )
  }
  if (typeof value.run !== 'function') {
    failRegistry('invalid-registration', `${path}.run`, 'must be a synchronous function.')
  }
  return Object.freeze({ id: value.id, version: value.version, run: value.run })
}

/** Build the audited, duplicate-checked server handler registry. */
export const createRegisteredMoveHandlerRegistry = (
  registrations: readonly RegisteredMoveHandlerRegistration[],
): RegisteredMoveHandlerRegistry => {
  if (!Array.isArray(registrations)) {
    return failRegistry('invalid-registration', 'handlers', 'must be an array.')
  }
  const entries = registrations.map(validateRegistration)
  const byId = new Map<string, RegisteredMoveHandlerRegistration>()
  for (const [index, registration] of entries.entries()) {
    if (byId.has(registration.id)) {
      failRegistry(
        'duplicate-id',
        `handlers[${index}].id`,
        `handler ${registration.id} is registered more than once.`,
      )
    }
    byId.set(registration.id, registration)
  }
  const frozenEntries = Object.freeze([...entries])
  return Object.freeze({
    size: frozenEntries.length,
    resolve: (id: string) => byId.get(id) ?? null,
    entries: () => frozenEntries,
  })
}

/** Add reviewed production handlers here; specs cannot register callbacks themselves. */
export const REGISTERED_MOVE_HANDLER_REGISTRY = createRegisteredMoveHandlerRegistry([
  ASTONISH_MOVE_HANDLER_REGISTRATION,
  AREA_STAGES_207_HANDLER_REGISTRATION,
  DARK_VOID_MOVE_HANDLER_REGISTRATION,
  SECONDARY_CONDITIONS_203_HANDLER_REGISTRATION,
  STOMP_MOVE_HANDLER_REGISTRATION,
  TAKE_DOWN_MOVE_HANDLER_REGISTRATION,
])

const strictOutputClone = (value: unknown): UnknownRecord => {
  const detached = JSON.parse(stableJsonStringify(value, {
    path: 'handlerOutput',
    limits: {
      maxDepth: REGISTERED_MOVE_HANDLER_LIMITS.jsonDepth,
      maxNodes: REGISTERED_MOVE_HANDLER_LIMITS.jsonNodes,
      maxObjectFields: MOVE_SPEC_LIMITS.jsonObjectFields,
      maxArrayEntries: MOVE_RESOLUTION_TRACE_LIMITS.auditEvents,
      maxStringLength: MOVE_SPEC_LIMITS.jsonStringLength,
    },
  })) as unknown
  if (!isPlainRecord(detached)) {
    return failOutput('invalid-output', 'handlerOutput', 'must be a plain JSON object.')
  }
  const expected = new Set<string>(OUTPUT_FIELDS)
  const missing = OUTPUT_FIELDS.filter(field => !Object.prototype.hasOwnProperty.call(detached, field))
  const unknown = Object.keys(detached).filter(field => !expected.has(field))
  if (missing.length > 0 || unknown.length > 0) {
    failOutput(
      'invalid-output',
      'handlerOutput',
      `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
    )
  }
  return detached
}

const parseCanonicalOperations = (
  value: unknown,
  maximumOperations: number,
): readonly MoveEffectOperation[] => {
  if (!Array.isArray(value)) {
    return failOutput('invalid-output', 'handlerOutput.operations', 'must be an array.')
  }
  if (value.length > maximumOperations) {
    failOutput(
      'limit-exceeded',
      'handlerOutput.operations',
      `must contain at most ${maximumOperations} operations after accounting for spec operations.`,
    )
  }
  const operations = parseMoveEffectOperations(value, 'handlerOutput.operations')
  let previousPhaseIndex = -1
  for (const [index, operation] of operations.entries()) {
    const phaseIndex = PHASE_INDEX.get(operation.phase) ?? -1
    if (phaseIndex < previousPhaseIndex) {
      failOutput(
        'invalid-phase-order',
        `handlerOutput.operations[${index}].phase`,
        'handler operations must follow canonical MoveSpec phase order.',
      )
    }
    previousPhaseIndex = phaseIndex
  }
  return operations
}

const traceEntryInput = (
  event: MoveResolutionAuditTraceEvent,
): RegisteredMoveHandlerTraceEntry => {
  if (event.kind !== 'predicate' && event.kind !== 'target') {
    return failOutput(
      'unsupported-trace-entry',
      'handlerOutput.traceEntries',
      `handler trace kind ${event.kind} is not calculation evidence.`,
    )
  }
  const { sequence: _sequence, ...entry } = event
  return Object.freeze(entry) as RegisteredMoveHandlerTraceEntry
}

const parseCanonicalTraceEntries = (
  value: unknown,
): readonly RegisteredMoveHandlerTraceEntry[] => {
  if (!Array.isArray(value)) {
    return failOutput('invalid-output', 'handlerOutput.traceEntries', 'must be an array.')
  }
  if (value.length > REGISTERED_MOVE_HANDLER_LIMITS.traceEntries) {
    failOutput(
      'limit-exceeded',
      'handlerOutput.traceEntries',
      `must contain at most ${REGISTERED_MOVE_HANDLER_LIMITS.traceEntries} entries.`,
    )
  }

  let trace = createMoveResolutionTrace({
    program: {
      canonicalId: 'Registered Handler Validation',
      runtimeKind: 'movespec-v2',
      runtimeVersion: 1,
      definitionHash: '0'.repeat(64),
    },
    ruleset: {
      rulesetId: 'registered-handler-validation',
      sourceDataSha256: '0'.repeat(64),
    },
  })
  let activePhase: MoveSpecPhase | null = null
  let previousPhaseIndex = -1

  for (const [index, entry] of value.entries()) {
    const path = `handlerOutput.traceEntries[${index}]`
    if (!isPlainRecord(entry)) {
      failOutput('invalid-output', path, 'must be a plain trace-entry object.')
    }
    if (typeof entry.kind !== 'string' || !HANDLER_TRACE_ENTRY_KINDS.has(entry.kind)) {
      failOutput(
        'unsupported-trace-entry',
        `${path}.kind`,
        'handlers may emit only predicate or target calculation evidence.',
      )
    }
    const phaseIndex = typeof entry.phase === 'string'
      ? PHASE_INDEX.get(entry.phase) ?? -1
      : -1
    if (phaseIndex < 0) {
      failOutput('invalid-output', `${path}.phase`, 'must be a supported MoveSpec phase.')
    }
    if (phaseIndex < previousPhaseIndex) {
      failOutput(
        'invalid-phase-order',
        `${path}.phase`,
        'handler trace entries must follow canonical MoveSpec phase order.',
      )
    }
    const phase = entry.phase as MoveSpecPhase
    if (phase !== activePhase) {
      trace = reduceMoveResolutionTrace(trace, {
        kind: 'phase-transition',
        from: activePhase,
        to: phase,
        reasonCode: `${phase}-phase`,
      })
      activePhase = phase
    }
    trace = reduceMoveResolutionTrace(
      trace,
      entry as unknown as RegisteredMoveHandlerTraceEntry,
    )
    previousPhaseIndex = phaseIndex
  }

  return Object.freeze(trace.events
    .filter(event => event.kind !== 'phase-transition')
    .map(traceEntryInput))
}

/** Strictly detach and validate the only values a handler may return. */
export const validateRegisteredMoveHandlerOutput = (
  value: unknown,
  options: { readonly maximumOperations?: number } = {},
): RegisteredMoveHandlerOutput => {
  const maximumOperations = options.maximumOperations
    ?? REGISTERED_MOVE_HANDLER_LIMITS.operations
  if (
    !Number.isSafeInteger(maximumOperations)
    || maximumOperations < 0
    || maximumOperations > REGISTERED_MOVE_HANDLER_LIMITS.operations
  ) {
    throw new Error(
      `maximumOperations must be from 0 through ${REGISTERED_MOVE_HANDLER_LIMITS.operations}.`,
    )
  }
  const detached = strictOutputClone(value)
  return Object.freeze({
    operations: parseCanonicalOperations(detached.operations, maximumOperations),
    traceEntries: parseCanonicalTraceEntries(detached.traceEntries),
  })
}

const restrictedHandlerContext = (
  context: AuthoritativeMoveRulesContext,
): RegisteredMoveHandlerContext => Object.freeze({
  map: context.map,
  intent: context.intent,
  actor: context.actor,
  candidatePlacements: context.candidatePlacements,
  selectedPlacements: context.selectedPlacements,
  resolvedSheets: context.resolvedSheets,
  ruleset: context.ruleset,
  queries: context.queries,
  reads: context.reads,
})

/** Invoke one version-pinned pure handler and validate its complete output. */
export const executeRegisteredMoveHandler = (input: {
  readonly registration: RegisteredMoveHandlerRegistration
  readonly expectedVersion: number
  readonly context: AuthoritativeMoveRulesContext
  readonly maximumOperations: number
}): RegisteredMoveHandlerOutput => {
  if (input.registration.version !== input.expectedVersion) {
    throw new RegisteredMoveHandlerExecutionError(
      'handler-version-mismatch',
      input.registration.id,
      `Registered handler ${input.registration.id} version ${input.registration.version} does not match reviewed version ${input.expectedVersion}.`,
    )
  }

  let output: unknown
  try {
    output = input.registration.run(restrictedHandlerContext(input.context))
  }
  catch {
    throw new RegisteredMoveHandlerExecutionError(
      'handler-threw',
      input.registration.id,
      `Registered handler ${input.registration.id} failed during pure calculation.`,
    )
  }
  return validateRegisteredMoveHandlerOutput(output, {
    maximumOperations: input.maximumOperations,
  })
}
