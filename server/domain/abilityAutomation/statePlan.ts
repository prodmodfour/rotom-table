import { normalizeRevision } from '#shared/sessionRevisions'
import {
  abilityResolutionTraceRollLedger,
  parseAbilityResolutionTrace,
  type AbilityResolutionAuditTrace,
} from '#shared/abilityAutomation/trace'
import {
  parseAbilityAutomationRollLedger,
  type AbilityAutomationRollLedgerEntry,
} from '#shared/abilityAutomation/random'
import type {
  MoveStateChangePlan,
  MoveStateExpectedRevision,
} from '../moveAutomation/plan'
import {
  deduplicateAuthoritativeAbilityReads,
  type AuthoritativeAbilityContext,
  type AuthoritativeAbilityRead,
} from './context'
import { sameJsonValue } from '~/utils/serialization'

export const ABILITY_STATE_PLAN_SCHEMA_VERSION = 1 as const

export interface AbilityStatePlan {
  readonly schemaVersion: typeof ABILITY_STATE_PLAN_SCHEMA_VERSION
  readonly resolutionId: string
  readonly runtime: {
    readonly canonicalId: string
    readonly modeId: string
    readonly version: number
    readonly definitionHash: string
    readonly sourceModule: string
  }
  /** Shared typed state changes; no patches or repository callbacks. */
  readonly stateChanges: MoveStateChangePlan
  /** Complete consulted resource set, including resources that are not written. */
  readonly reads: readonly AuthoritativeAbilityRead[]
  readonly trace: AbilityResolutionAuditTrace
  readonly rollLedger: readonly AbilityAutomationRollLedgerEntry[]
}

export type AbilityStatePlanValidationCode =
  | 'runtime-mismatch'
  | 'trace-roll-mismatch'
  | 'write-without-read'
  | 'write-revision-mismatch'
  | 'invalid-state-plan'

export class AbilityStatePlanValidationError extends Error {
  readonly code: AbilityStatePlanValidationCode

  constructor(code: AbilityStatePlanValidationCode, detail: string) {
    super(detail)
    this.name = 'AbilityStatePlanValidationError'
    this.code = code
  }
}

export class AbilityStatePlanConflictError extends Error {
  readonly read: AuthoritativeAbilityRead
  readonly currentRevision: number | null

  constructor(read: AuthoritativeAbilityRead, currentRevision: number | null) {
    super(`Consulted ${read.kind}:${read.slug} changed before ability commit.`)
    this.name = 'AbilityStatePlanConflictError'
    this.read = read
    this.currentRevision = currentRevision
  }
}

export interface AbilityStatePlanAuditRecord {
  readonly resolutionId: string
  readonly trace: AbilityResolutionAuditTrace
  readonly rollLedger: readonly AbilityAutomationRollLedgerEntry[]
}

export interface AbilityStatePlanTransaction {
  /** Called inside the same physical transaction that applies state. */
  readonly revisionFor: (read: AuthoritativeAbilityRead) => number | null
  readonly applyStateChanges: (plan: MoveStateChangePlan) => void
  readonly persistAudit: (record: AbilityStatePlanAuditRecord) => void
}

export interface AbilityStatePlanAtomicStore {
  readonly transaction: <Result>(callback: (transaction: AbilityStatePlanTransaction) => Result) => Result
}

const fail = (code: AbilityStatePlanValidationCode, detail: string): never => {
  throw new AbilityStatePlanValidationError(code, detail)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.isFrozen(value) ? value : Object.freeze(value)
}

const readKey = (read: AuthoritativeAbilityRead): string => read.kind === 'sheet'
  ? `sheet:${read.sheetKind}:${read.slug}`
  : `${read.kind}:${read.slug}`

const expectationKey = (expectation: MoveStateExpectedRevision): string => {
  if (expectation.kind === 'map') return `map:${expectation.mapSlug}`
  if (expectation.kind === 'sheet') {
    return `sheet:${expectation.sheetKind}:${expectation.sheetSlug}`
  }
  return `group-inventory:${expectation.resourceId}`
}

const assertWritesAreRead = (
  stateChanges: MoveStateChangePlan,
  reads: readonly AuthoritativeAbilityRead[],
): void => {
  const readByKey = new Map(reads.map(read => [readKey(read), read]))
  for (const expectation of stateChanges.expectedRevisions) {
    const key = expectationKey(expectation)
    const read = readByKey.get(key)
      ?? fail('write-without-read', `State write ${key} has no authoritative read.`)
    if (normalizeRevision(read.revision) !== normalizeRevision(expectation.expectedRevision)) {
      fail(
        'write-revision-mismatch',
        `State write ${key} expects ${expectation.expectedRevision}, but the read observed ${read.revision}.`,
      )
    }
  }
}

/** Join typed changes, complete reads, rolls, and private trace before persistence. */
export const createAbilityStatePlan = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly stateChanges: MoveStateChangePlan
  readonly trace: AbilityResolutionAuditTrace
}): AbilityStatePlan => {
  const trace = parseAbilityResolutionTrace(input.trace)
  const runtime = input.context.runtime
  if (
    trace.resolutionId !== input.context.resolutionId
    || trace.program.canonicalId !== runtime.canonicalId
    || trace.program.modeId !== input.context.request.modeId
    || trace.program.runtimeVersion !== runtime.version
    || trace.program.definitionHash !== runtime.definitionHash
    || trace.program.sourceModule !== runtime.sourceModule
  ) {
    fail('runtime-mismatch', 'Ability state plan trace does not match its authoritative context.')
  }
  const rollLedger = parseAbilityAutomationRollLedger(
    input.context.random.complete(),
    'abilityStatePlan.rollLedger',
  )
  const traceLedger = abilityResolutionTraceRollLedger(trace)
  if (!sameJsonValue(rollLedger, traceLedger)) {
    fail('trace-roll-mismatch', 'Every authoritative roll must appear exactly once in the private trace.')
  }
  const reads = deduplicateAuthoritativeAbilityReads(input.context.reads.snapshot())
  assertWritesAreRead(input.stateChanges, reads)

  return deepFreeze({
    schemaVersion: ABILITY_STATE_PLAN_SCHEMA_VERSION,
    resolutionId: input.context.resolutionId,
    runtime: {
      canonicalId: runtime.canonicalId,
      modeId: input.context.request.modeId,
      version: runtime.version,
      definitionHash: runtime.definitionHash,
      sourceModule: runtime.sourceModule,
    },
    stateChanges: input.stateChanges,
    reads,
    trace,
    rollLedger,
  })
}

/** Pure preflight useful before entering persistence; commit repeats it inside transaction. */
export const assertAbilityStatePlanRevisions = (
  plan: AbilityStatePlan,
  revisionFor: (read: AuthoritativeAbilityRead) => number | null,
): void => {
  for (const read of plan.reads) {
    const currentRevision = revisionFor(read)
    if (currentRevision === null || normalizeRevision(currentRevision) !== read.revision) {
      throw new AbilityStatePlanConflictError(read, currentRevision)
    }
  }
}

/**
 * Validate every consulted revision, apply all typed changes, and persist audit
 * evidence inside one store-supplied physical transaction.
 */
export const commitAbilityStatePlan = (
  plan: AbilityStatePlan,
  store: AbilityStatePlanAtomicStore,
): void => {
  store.transaction((transaction) => {
    assertAbilityStatePlanRevisions(plan, transaction.revisionFor)
    transaction.applyStateChanges(plan.stateChanges)
    transaction.persistAudit({
      resolutionId: plan.resolutionId,
      trace: plan.trace,
      rollLedger: plan.rollLedger,
    })
  })
}
