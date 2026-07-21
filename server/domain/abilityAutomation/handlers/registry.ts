import {
  ABILITY_SPEC_LIMITS,
  ABILITY_SPEC_PHASES,
  type AbilitySpecJsonObject,
  type AbilitySpecPhase,
} from '#shared/abilityAutomation/spec'
import {
  cloneStrictJson,
  deepFreezeStrictJson,
  isPlainJsonObject,
  type StrictJsonValue,
} from '#shared/automation/strictJson'
import type { AbilitySpecExtensionRegistry } from '../extensionRegistry'
import { ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY } from '../sharedKernelExtensions'

export const REGISTERED_ABILITY_HANDLER_LIMITS = Object.freeze({
  operations: ABILITY_SPEC_LIMITS.totalOperations,
  traceEntries: 256,
  selectedPlacements: 64,
  effectiveAbilities: 64,
  ownedStateEntries: 512,
  jsonDepth: ABILITY_SPEC_LIMITS.jsonDepth,
  jsonNodes: 32_768,
})

export interface AbilityHandlerRulesetView {
  readonly rulesetId: string
  readonly sourceDataSha256: string
}

export interface AbilityHandlerSnapshot {
  readonly canonicalId: string
  readonly modeId: string
  readonly actorPlacementId: string
  readonly sourcePlacementId: string
  readonly selectedPlacementIds: readonly string[]
  readonly triggeringEvent: AbilitySpecJsonObject | null
  readonly ruleset: AbilityHandlerRulesetView
}

export type AbilityHandlerRelation = 'self' | 'ally' | 'enemy' | 'neutral' | 'unknown'

/** Closed pure queries. Implementations record consulted revisions internally. */
export interface AbilityHandlerQueries {
  readonly placementById: (placementId: string) => AbilitySpecJsonObject | null
  readonly distanceMeters: (leftPlacementId: string, rightPlacementId: string) => number | null
  readonly relation: (leftPlacementId: string, rightPlacementId: string) => AbilityHandlerRelation
  readonly effectiveAbilityIds: (placementId: string) => readonly string[]
  readonly ownedStateById: (stateId: string) => AbilitySpecJsonObject | null
  readonly ownedStatesForAbility: (
    ownerPlacementId: string,
    sourceAbilityInstanceId: string,
  ) => readonly AbilitySpecJsonObject[]
  readonly historyCount: (placementId: string, eventKind: string) => number
}

export interface AuthoritativeAbilityHandlerContext {
  readonly snapshot: AbilityHandlerSnapshot
  readonly queries: AbilityHandlerQueries
}

export type RegisteredAbilityHandlerContext = Readonly<AuthoritativeAbilityHandlerContext>

export interface RegisteredAbilityHandlerOperation {
  readonly phase: AbilitySpecPhase
  readonly operation: AbilitySpecJsonObject
}

export type RegisteredAbilityHandlerTraceKind = 'predicate' | 'target' | 'calculation'

export interface RegisteredAbilityHandlerTraceEntry {
  readonly kind: RegisteredAbilityHandlerTraceKind
  readonly phase: AbilitySpecPhase
  readonly reasonCode: string
  readonly value: null | boolean | number | string
}

export interface RegisteredAbilityHandlerOutput {
  readonly operations: readonly RegisteredAbilityHandlerOperation[]
  readonly traceEntries: readonly RegisteredAbilityHandlerTraceEntry[]
}

export interface RegisteredAbilityHandlerRegistration {
  readonly id: string
  readonly version: number
  /** Synchronous pure calculation; no orchestration dependencies are supplied. */
  readonly run: (context: RegisteredAbilityHandlerContext) => unknown
}

export interface RegisteredAbilityHandlerReference {
  readonly id: string
  readonly version: number
}

export interface RegisteredAbilityHandlerRegistry {
  readonly size: number
  readonly resolve: (id: string) => RegisteredAbilityHandlerRegistration | null
  readonly entries: () => readonly RegisteredAbilityHandlerRegistration[]
}

export type RegisteredAbilityHandlerRegistryValidationCode =
  | 'invalid-registration'
  | 'duplicate-id'

export class RegisteredAbilityHandlerRegistryValidationError extends Error {
  readonly code: RegisteredAbilityHandlerRegistryValidationCode
  readonly path: string

  constructor(code: RegisteredAbilityHandlerRegistryValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'RegisteredAbilityHandlerRegistryValidationError'
    this.code = code
    this.path = path
  }
}

export type RegisteredAbilityHandlerOutputValidationCode =
  | 'invalid-output'
  | 'limit-exceeded'
  | 'invalid-phase-order'
  | 'unknown-operation-extension'
  | 'invalid-operation-extension'

export class RegisteredAbilityHandlerOutputValidationError extends Error {
  readonly code: RegisteredAbilityHandlerOutputValidationCode
  readonly path: string

  constructor(code: RegisteredAbilityHandlerOutputValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'RegisteredAbilityHandlerOutputValidationError'
    this.code = code
    this.path = path
  }
}

export type RegisteredAbilityHandlerExecutionCode =
  | 'handler-version-mismatch'
  | 'handler-threw'
  | 'invalid-query-result'

export class RegisteredAbilityHandlerExecutionError extends Error {
  readonly code: RegisteredAbilityHandlerExecutionCode
  readonly handlerId: string

  constructor(code: RegisteredAbilityHandlerExecutionCode, handlerId: string, detail: string) {
    super(detail)
    this.name = 'RegisteredAbilityHandlerExecutionError'
    this.code = code
    this.handlerId = handlerId
  }
}

type UnknownRecord = Record<string, unknown>

const REGISTRATION_FIELDS = ['id', 'version', 'run'] as const
const OUTPUT_FIELDS = ['operations', 'traceEntries'] as const
const OPERATION_FIELDS = ['phase', 'operation'] as const
const TRACE_FIELDS = ['kind', 'phase', 'reasonCode', 'value'] as const
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const PHASE_SET = new Set<string>(ABILITY_SPEC_PHASES)
const PHASE_INDEX = new Map<string, number>(ABILITY_SPEC_PHASES.map((phase, index) => [phase, index]))
const TRACE_KIND_SET = new Set<string>(['predicate', 'target', 'calculation'])
const RELATION_SET = new Set<string>(['self', 'ally', 'enemy', 'neutral', 'unknown'])

const failRegistry = (
  code: RegisteredAbilityHandlerRegistryValidationCode,
  path: string,
  detail: string,
): never => {
  throw new RegisteredAbilityHandlerRegistryValidationError(code, path, detail)
}

const failOutput = (
  code: RegisteredAbilityHandlerOutputValidationCode,
  path: string,
  detail: string,
): never => {
  throw new RegisteredAbilityHandlerOutputValidationError(code, path, detail)
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) {
    failOutput(
      'invalid-output',
      path,
      `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
    )
  }
}

const stableId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ABILITY_SPEC_LIMITS.identifierLength
    || !STABLE_ID_PATTERN.test(value)
  ) {
    return failOutput('invalid-output', path, 'must be a bounded lowercase stable identifier.')
  }
  return value
}

const cloneOutput = (value: unknown, path: string): StrictJsonValue => cloneStrictJson(value, path, {
  limits: {
    depth: REGISTERED_ABILITY_HANDLER_LIMITS.jsonDepth,
    nodes: REGISTERED_ABILITY_HANDLER_LIMITS.jsonNodes,
    objectFields: ABILITY_SPEC_LIMITS.jsonObjectFields,
    arrayEntries: ABILITY_SPEC_LIMITS.jsonArrayEntries,
    stringLength: ABILITY_SPEC_LIMITS.jsonStringLength,
    objectKeyLength: ABILITY_SPEC_LIMITS.identifierLength,
  },
  rootLabel: 'ability handler output',
  valueLabel: 'ability handler outputs',
  failNotJson: (failurePath, detail) => failOutput('invalid-output', failurePath, detail),
  failLimit: (failurePath, detail) => failOutput('limit-exceeded', failurePath, detail),
})

const validateRegistration = (
  value: RegisteredAbilityHandlerRegistration,
  index: number,
): RegisteredAbilityHandlerRegistration => {
  const path = `abilityHandlers[${index}]`
  if (!isPlainJsonObject(value)) {
    return failRegistry('invalid-registration', path, 'must be a plain registration object.')
  }
  const expected = new Set<string>(REGISTRATION_FIELDS)
  const missing = REGISTRATION_FIELDS.filter(field => !Object.prototype.hasOwnProperty.call(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) {
    failRegistry('invalid-registration', path, 'must contain exactly id, version, and run.')
  }
  if (
    typeof value.id !== 'string'
    || value.id.length > ABILITY_SPEC_LIMITS.identifierLength
    || !STABLE_ID_PATTERN.test(value.id)
  ) {
    failRegistry('invalid-registration', `${path}.id`, 'must be a bounded stable identifier.')
  }
  if (!Number.isSafeInteger(value.version) || value.version < 1) {
    failRegistry('invalid-registration', `${path}.version`, 'must be a positive safe integer.')
  }
  if (typeof value.run !== 'function') {
    failRegistry('invalid-registration', `${path}.run`, 'must be a synchronous function.')
  }
  return Object.freeze({ id: value.id, version: value.version, run: value.run })
}

export const createRegisteredAbilityHandlerRegistry = (
  registrations: readonly RegisteredAbilityHandlerRegistration[],
): RegisteredAbilityHandlerRegistry => {
  if (!Array.isArray(registrations)) {
    return failRegistry('invalid-registration', 'abilityHandlers', 'must be an array.')
  }
  const entries = registrations.map(validateRegistration)
  const byId = new Map<string, RegisteredAbilityHandlerRegistration>()
  entries.forEach((entry, index) => {
    if (byId.has(entry.id)) {
      failRegistry('duplicate-id', `abilityHandlers[${index}].id`, `handler ${entry.id} is duplicated.`)
    }
    byId.set(entry.id, entry)
  })
  const frozenEntries = Object.freeze(entries)
  return Object.freeze({
    size: frozenEntries.length,
    resolve: (id: string) => byId.get(id) ?? null,
    entries: () => frozenEntries,
  })
}

/** Add only reviewed pure handlers here. */
export const REGISTERED_ABILITY_HANDLER_REGISTRY = createRegisteredAbilityHandlerRegistry([])

const parsePhase = (value: unknown, path: string): AbilitySpecPhase => {
  if (typeof value !== 'string' || !PHASE_SET.has(value)) {
    return failOutput('invalid-output', path, 'must be a supported AbilitySpec phase.')
  }
  return value as AbilitySpecPhase
}

const parseOperation = (
  value: unknown,
  path: string,
  extensionRegistry: AbilitySpecExtensionRegistry,
  phase: AbilitySpecPhase,
): AbilitySpecJsonObject => {
  if (!isPlainJsonObject(value)) return failOutput('invalid-output', path, 'must be an object.')
  const kind = value.kind
  if (typeof kind !== 'string' || !STABLE_ID_PATTERN.test(kind)) {
    return failOutput('invalid-output', `${path}.kind`, 'must be a stable operation kind.')
  }
  const extension = extensionRegistry.resolve('operation', kind)
  if (!extension) {
    return failOutput(
      'unknown-operation-extension',
      `${path}.kind`,
      `operation extension ${kind} is not registered.`,
    )
  }
  let parsed: AbilitySpecJsonObject
  try {
    parsed = extension.parse(value as AbilitySpecJsonObject, path, {
      family: 'operation',
      phase,
    })
  }
  catch {
    return failOutput('invalid-operation-extension', path, `operation extension ${kind} rejected output.`)
  }
  const detached = cloneOutput(parsed, path)
  if (!isPlainJsonObject(detached) || detached.kind !== kind) {
    return failOutput('invalid-operation-extension', path, 'operation parser returned an invalid kind.')
  }
  return deepFreezeStrictJson(detached as AbilitySpecJsonObject)
}

export const validateRegisteredAbilityHandlerOutput = (
  value: unknown,
  options: {
    readonly extensionRegistry?: AbilitySpecExtensionRegistry
    readonly maximumOperations?: number
  } = {},
): RegisteredAbilityHandlerOutput => {
  const maximumOperations = options.maximumOperations ?? REGISTERED_ABILITY_HANDLER_LIMITS.operations
  if (
    !Number.isSafeInteger(maximumOperations)
    || maximumOperations < 0
    || maximumOperations > REGISTERED_ABILITY_HANDLER_LIMITS.operations
  ) {
    throw new Error(`maximumOperations must be from 0 through ${REGISTERED_ABILITY_HANDLER_LIMITS.operations}.`)
  }
  const detached = cloneOutput(value, 'abilityHandlerOutput')
  if (!isPlainJsonObject(detached)) {
    return failOutput('invalid-output', 'abilityHandlerOutput', 'must be a plain object.')
  }
  exact(detached, OUTPUT_FIELDS, 'abilityHandlerOutput')
  const operationInputs = detached.operations
  if (!Array.isArray(operationInputs)) {
    failOutput('invalid-output', 'abilityHandlerOutput.operations', 'must be an array.')
  }
  const operationArray = operationInputs as readonly StrictJsonValue[]
  if (operationArray.length > maximumOperations) {
    failOutput('limit-exceeded', 'abilityHandlerOutput.operations', `must contain at most ${maximumOperations} entries.`)
  }
  const extensionRegistry = options.extensionRegistry ?? ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY
  let previousOperationPhase = -1
  const operations = operationArray.map((value, index): RegisteredAbilityHandlerOperation => {
    const path = `abilityHandlerOutput.operations[${index}]`
    if (!isPlainJsonObject(value)) return failOutput('invalid-output', path, 'must be an object.')
    exact(value, OPERATION_FIELDS, path)
    const phase = parsePhase(value.phase, `${path}.phase`)
    const phaseIndex = PHASE_INDEX.get(phase)!
    if (phaseIndex < previousOperationPhase) {
      failOutput('invalid-phase-order', `${path}.phase`, 'operations must follow canonical phase order.')
    }
    previousOperationPhase = phaseIndex
    return Object.freeze({
      phase,
      operation: parseOperation(value.operation, `${path}.operation`, extensionRegistry, phase),
    })
  })

  const traceInputs = detached.traceEntries
  if (!Array.isArray(traceInputs)) {
    failOutput('invalid-output', 'abilityHandlerOutput.traceEntries', 'must be an array.')
  }
  const traceArray = traceInputs as readonly StrictJsonValue[]
  if (traceArray.length > REGISTERED_ABILITY_HANDLER_LIMITS.traceEntries) {
    failOutput(
      'limit-exceeded',
      'abilityHandlerOutput.traceEntries',
      `must contain at most ${REGISTERED_ABILITY_HANDLER_LIMITS.traceEntries} entries.`,
    )
  }
  let previousTracePhase = -1
  const traceEntries = traceArray.map((value, index): RegisteredAbilityHandlerTraceEntry => {
    const path = `abilityHandlerOutput.traceEntries[${index}]`
    if (!isPlainJsonObject(value)) return failOutput('invalid-output', path, 'must be an object.')
    exact(value, TRACE_FIELDS, path)
    if (typeof value.kind !== 'string' || !TRACE_KIND_SET.has(value.kind)) {
      failOutput('invalid-output', `${path}.kind`, 'must be predicate, target, or calculation.')
    }
    const phase = parsePhase(value.phase, `${path}.phase`)
    const phaseIndex = PHASE_INDEX.get(phase)!
    if (phaseIndex < previousTracePhase) {
      failOutput('invalid-phase-order', `${path}.phase`, 'trace entries must follow canonical phase order.')
    }
    previousTracePhase = phaseIndex
    if (
      value.value !== null
      && typeof value.value !== 'boolean'
      && typeof value.value !== 'number'
      && typeof value.value !== 'string'
    ) {
      failOutput('invalid-output', `${path}.value`, 'must be a bounded scalar.')
    }
    return Object.freeze({
      kind: value.kind as RegisteredAbilityHandlerTraceKind,
      phase,
      reasonCode: stableId(value.reasonCode, `${path}.reasonCode`),
      value: value.value as null | boolean | number | string,
    })
  })

  return Object.freeze({
    operations: Object.freeze(operations),
    traceEntries: Object.freeze(traceEntries),
  })
}

const queryFailure = (handlerId: string, detail: string): never => {
  throw new RegisteredAbilityHandlerExecutionError('invalid-query-result', handlerId, detail)
}

const freezePlacement = (
  value: AbilitySpecJsonObject | null,
  handlerId: string,
): AbilitySpecJsonObject | null => {
  if (value === null) return null
  let detached: StrictJsonValue
  try {
    detached = cloneOutput(value, 'abilityHandlerQuery.placement')
  }
  catch {
    return queryFailure(handlerId, `Registered handler ${handlerId} received an invalid placement query result.`)
  }
  if (!isPlainJsonObject(detached)) {
    return queryFailure(handlerId, `Registered handler ${handlerId} received a non-object placement query result.`)
  }
  return deepFreezeStrictJson(detached as AbilitySpecJsonObject)
}

const restrictedContext = (
  context: AuthoritativeAbilityHandlerContext,
  handlerId: string,
): RegisteredAbilityHandlerContext => {
  const snapshot = cloneOutput(context.snapshot, 'abilityHandlerContext.snapshot')
  if (!isPlainJsonObject(snapshot)) {
    return queryFailure(handlerId, `Registered handler ${handlerId} received an invalid snapshot.`)
  }
  const selected = snapshot.selectedPlacementIds
  const ruleset = snapshot.ruleset
  if (
    typeof snapshot.canonicalId !== 'string'
    || typeof snapshot.modeId !== 'string'
    || typeof snapshot.actorPlacementId !== 'string'
    || typeof snapshot.sourcePlacementId !== 'string'
    || !Array.isArray(selected)
    || selected.length > REGISTERED_ABILITY_HANDLER_LIMITS.selectedPlacements
    || selected.some(id => typeof id !== 'string')
    || !isPlainJsonObject(ruleset)
    || typeof ruleset.rulesetId !== 'string'
    || typeof ruleset.sourceDataSha256 !== 'string'
    || !SHA256_PATTERN.test(ruleset.sourceDataSha256)
  ) {
    return queryFailure(handlerId, `Registered handler ${handlerId} received an invalid snapshot shape.`)
  }

  const queries: AbilityHandlerQueries = Object.freeze({
    placementById: (id: string) => freezePlacement(context.queries.placementById(id), handlerId),
    distanceMeters: (left: string, right: string) => {
      const result = context.queries.distanceMeters(left, right)
      return result === null || (Number.isFinite(result) && result >= 0)
        ? result
        : queryFailure(handlerId, `Registered handler ${handlerId} received an invalid distance.`)
    },
    relation: (left: string, right: string) => {
      const result = context.queries.relation(left, right)
      return RELATION_SET.has(result)
        ? result
        : queryFailure(handlerId, `Registered handler ${handlerId} received an invalid relation.`)
    },
    effectiveAbilityIds: (id: string) => {
      const result = context.queries.effectiveAbilityIds(id)
      if (
        !Array.isArray(result)
        || result.length > REGISTERED_ABILITY_HANDLER_LIMITS.effectiveAbilities
        || result.some(abilityId => typeof abilityId !== 'string')
      ) {
        return queryFailure(handlerId, `Registered handler ${handlerId} received invalid effective abilities.`)
      }
      return Object.freeze([...result])
    },
    ownedStateById: (stateId: string) => {
      const result = context.queries.ownedStateById(stateId)
      if (result === null) return null
      const cloned = cloneOutput(result, `abilityHandlerContext.ownedState.${stateId}`)
      return isPlainJsonObject(cloned)
        ? deepFreezeStrictJson(cloned as AbilitySpecJsonObject)
        : queryFailure(handlerId, `Registered handler ${handlerId} received invalid owned state.`)
    },
    ownedStatesForAbility: (ownerPlacementId: string, sourceAbilityInstanceId: string) => {
      const result = context.queries.ownedStatesForAbility(ownerPlacementId, sourceAbilityInstanceId)
      if (!Array.isArray(result)
        || result.length > REGISTERED_ABILITY_HANDLER_LIMITS.ownedStateEntries) {
        return queryFailure(handlerId, `Registered handler ${handlerId} received too much owned state.`)
      }
      return Object.freeze(result.map((entry, index) => {
        const cloned = cloneOutput(entry, `abilityHandlerContext.ownedStates[${index}]`)
        return isPlainJsonObject(cloned)
          ? deepFreezeStrictJson(cloned as AbilitySpecJsonObject)
          : queryFailure(handlerId, `Registered handler ${handlerId} received invalid owned state.`)
      }))
    },
    historyCount: (id: string, eventKind: string) => {
      const result = context.queries.historyCount(id, eventKind)
      return Number.isSafeInteger(result) && result >= 0
        ? result
        : queryFailure(handlerId, `Registered handler ${handlerId} received an invalid history count.`)
    },
  })

  return Object.freeze({
    snapshot: deepFreezeStrictJson(snapshot) as unknown as AbilityHandlerSnapshot,
    queries,
  })
}

export const executeRegisteredAbilityHandler = (input: {
  readonly registration: RegisteredAbilityHandlerRegistration
  readonly expectedVersion: number
  readonly context: AuthoritativeAbilityHandlerContext
  readonly extensionRegistry?: AbilitySpecExtensionRegistry
  readonly maximumOperations?: number
}): RegisteredAbilityHandlerOutput => {
  if (input.registration.version !== input.expectedVersion) {
    throw new RegisteredAbilityHandlerExecutionError(
      'handler-version-mismatch',
      input.registration.id,
      `Registered handler ${input.registration.id} does not match reviewed version ${input.expectedVersion}.`,
    )
  }
  let output: unknown
  try {
    output = input.registration.run(restrictedContext(input.context, input.registration.id))
  }
  catch (error) {
    if (error instanceof RegisteredAbilityHandlerExecutionError) throw error
    throw new RegisteredAbilityHandlerExecutionError(
      'handler-threw',
      input.registration.id,
      `Registered handler ${input.registration.id} failed during pure calculation.`,
    )
  }
  return validateRegisteredAbilityHandlerOutput(output, {
    extensionRegistry: input.extensionRegistry,
    maximumOperations: input.maximumOperations,
  })
}
