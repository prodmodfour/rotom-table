import { MOVE_EFFECT_OPERATION_LIMITS } from '#shared/moveAutomation/effects'
import { MOVE_SPEC_LIMITS } from '#shared/moveAutomation/spec'
import { MOVE_RESOLUTION_TRACE_LIMITS } from '#shared/moveAutomation/trace'

/**
 * Aggregate limits apply to one root resolution, not independently to every
 * child. This prevents a bounded MoveSpec from multiplying work through a
 * chain of otherwise individually valid reviewed children.
 */
export const NESTED_MOVE_EXECUTION_LIMITS = Object.freeze({
  depth: 8,
  operations: MOVE_EFFECT_OPERATION_LIMITS.operations,
  targets: MOVE_SPEC_LIMITS.targetCount * 4,
  emittedEvents: MOVE_RESOLUTION_TRACE_LIMITS.auditEvents,
  randomRetries: 128,
  visitedSpecs: MOVE_EFFECT_OPERATION_LIMITS.operations,
  bannedSpecs: 1_024,
})

export type NestedMoveExecutionBudgetErrorCode =
  | 'depth-limit-exceeded'
  | 'operation-limit-exceeded'
  | 'target-limit-exceeded'
  | 'event-limit-exceeded'
  | 'random-retry-limit-exceeded'
  | 'visited-spec-limit-exceeded'
  | 'banned-spec-limit-exceeded'
  | 'spec-already-visited'
  | 'spec-banned'
  | 'invalid-budget-request'

export class NestedMoveExecutionBudgetError extends Error {
  readonly code: NestedMoveExecutionBudgetErrorCode

  constructor(code: NestedMoveExecutionBudgetErrorCode, message: string) {
    super(message)
    this.name = 'NestedMoveExecutionBudgetError'
    this.code = code
  }
}

/** Server-reviewed policy only; no live-play command may author this list. */
export interface NestedMoveExecutionPolicy {
  readonly bannedCanonicalIds?: readonly string[]
}

export interface NestedMoveExecutionBudgetSnapshot {
  readonly operations: number
  readonly targets: number
  readonly emittedEvents: number
  readonly randomRetries: number
  readonly visitedCanonicalIds: readonly string[]
  readonly bannedCanonicalIds: readonly string[]
}

export interface NestedMoveExecutionBudget {
  /** Register one spec before its handler, phases, targets, or random work run. */
  enterSpec(canonicalId: string, depth: number, allowBannedRoot?: boolean): void
  /** Reserve the complete reviewed program, including branch-controlled operations. */
  reserveOperations(count: number, source: string): void
  /** Reserve authoritative target/candidate evaluations performed by this resolution. */
  reserveTargets(count: number, source: string): void
  /** Reserve each retained audit event, including child events projected into a parent trace. */
  reserveEmittedEvents(count: number, source: string): void
  /** Reserve reroll-invalid attempts before another random candidate is evaluated. */
  reserveRandomRetries(count: number, source: string): void
  snapshot(): NestedMoveExecutionBudgetSnapshot
}

interface CreateNestedMoveExecutionBudgetInput {
  readonly visitedCanonicalIds?: readonly string[]
  readonly policy?: NestedMoveExecutionPolicy
}

const fail = (
  code: NestedMoveExecutionBudgetErrorCode,
  message: string,
): never => {
  throw new NestedMoveExecutionBudgetError(code, message)
}

const canonicalId = (value: unknown, source: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > MOVE_SPEC_LIMITS.identifierLength
  ) {
    return fail(
      'invalid-budget-request',
      `${source} must contain bounded canonical move IDs.`,
    )
  }
  return value
}

const canonicalIdSet = (
  value: readonly string[] | undefined,
  source: string,
  limit: number,
  limitCode: 'visited-spec-limit-exceeded' | 'banned-spec-limit-exceeded',
): Set<string> => {
  if (!Array.isArray(value ?? [])) {
    return fail('invalid-budget-request', `${source} must be a bounded array.`)
  }
  if ((value?.length ?? 0) > limit) {
    return fail(limitCode, `${source} may contain at most ${limit} entries.`)
  }
  const result = new Set<string>()
  for (const entry of value ?? []) result.add(canonicalId(entry, source))
  return result
}

const assertedCount = (count: number, source: string): number => {
  if (!Number.isSafeInteger(count) || count < 0) {
    return fail(
      'invalid-budget-request',
      `${source} must reserve a non-negative safe integer.`,
    )
  }
  return count
}

const reserve = (
  current: number,
  count: number,
  limit: number,
  source: string,
  code:
    | 'operation-limit-exceeded'
    | 'target-limit-exceeded'
    | 'event-limit-exceeded'
    | 'random-retry-limit-exceeded',
  noun: string,
): number => {
  const requested = assertedCount(count, source)
  if (current + requested > limit) {
    return fail(
      code,
      `${source} would raise aggregate nested ${noun} from ${current} to ${current + requested}; at most ${limit} are allowed.`,
    )
  }
  return current + requested
}

/**
 * Create one private mutable counter set for a single pure interpreter run.
 * Its snapshots are immutable; failed reservations never change a counter.
 */
export const createNestedMoveExecutionBudget = (
  input: CreateNestedMoveExecutionBudgetInput = {},
): NestedMoveExecutionBudget => {
  const visitedCanonicalIds = canonicalIdSet(
    input.visitedCanonicalIds,
    'Nested visited-spec policy',
    NESTED_MOVE_EXECUTION_LIMITS.visitedSpecs,
    'visited-spec-limit-exceeded',
  )
  const bannedCanonicalIds = canonicalIdSet(
    input.policy?.bannedCanonicalIds,
    'Nested banned-spec policy',
    NESTED_MOVE_EXECUTION_LIMITS.bannedSpecs,
    'banned-spec-limit-exceeded',
  )
  let operations = 0
  let targets = 0
  let emittedEvents = 0
  let randomRetries = 0

  return Object.freeze({
    enterSpec: (rawCanonicalId: string, depth: number, allowBannedRoot = false): void => {
      const id = canonicalId(rawCanonicalId, 'Nested spec')
      if (!Number.isSafeInteger(depth) || depth < 0) {
        fail('invalid-budget-request', 'Nested spec depth must be a non-negative safe integer.')
      }
      if (depth > NESTED_MOVE_EXECUTION_LIMITS.depth) {
        fail(
          'depth-limit-exceeded',
          `Nested spec ${id} reached depth ${depth}; at most ${NESTED_MOVE_EXECUTION_LIMITS.depth} is allowed.`,
        )
      }
      if (!allowBannedRoot && bannedCanonicalIds.has(id)) {
        fail('spec-banned', `Nested spec ${id} is forbidden by the reviewed execution policy.`)
      }
      if (visitedCanonicalIds.has(id)) {
        fail('spec-already-visited', `Nested spec ${id} was already visited by this resolution.`)
      }
      if (visitedCanonicalIds.size >= NESTED_MOVE_EXECUTION_LIMITS.visitedSpecs) {
        fail(
          'visited-spec-limit-exceeded',
          `A resolution may visit at most ${NESTED_MOVE_EXECUTION_LIMITS.visitedSpecs} nested specs.`,
        )
      }
      visitedCanonicalIds.add(id)
    },
    reserveOperations: (count: number, source: string): void => {
      operations = reserve(
        operations,
        count,
        NESTED_MOVE_EXECUTION_LIMITS.operations,
        source,
        'operation-limit-exceeded',
        'operations',
      )
    },
    reserveTargets: (count: number, source: string): void => {
      targets = reserve(
        targets,
        count,
        NESTED_MOVE_EXECUTION_LIMITS.targets,
        source,
        'target-limit-exceeded',
        'target evaluations',
      )
    },
    reserveEmittedEvents: (count: number, source: string): void => {
      emittedEvents = reserve(
        emittedEvents,
        count,
        NESTED_MOVE_EXECUTION_LIMITS.emittedEvents,
        source,
        'event-limit-exceeded',
        'emitted events',
      )
    },
    reserveRandomRetries: (count: number, source: string): void => {
      randomRetries = reserve(
        randomRetries,
        count,
        NESTED_MOVE_EXECUTION_LIMITS.randomRetries,
        source,
        'random-retry-limit-exceeded',
        'random retries',
      )
    },
    snapshot: (): NestedMoveExecutionBudgetSnapshot => Object.freeze({
      operations,
      targets,
      emittedEvents,
      randomRetries,
      visitedCanonicalIds: Object.freeze([...visitedCanonicalIds]),
      bannedCanonicalIds: Object.freeze([...bannedCanonicalIds].sort((left, right) => (
        left === right ? 0 : left < right ? -1 : 1
      ))),
    }),
  })
}
