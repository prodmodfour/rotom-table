import {
  type MoveChoiceRequestEffectOperation,
  type MoveEffectOperation,
  type MoveEffectRecipientSelectorKind,
  type MoveReactionRequestEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveRuleScalar } from '#shared/moveAutomation/ast'
import type { MoveExpression } from '#shared/moveAutomation/expressions'
import type { MovePredicate } from '#shared/moveAutomation/predicates'
import type { MoveAutomationRollLedgerEntry } from '#shared/moveAutomation/random'
import type {
  MoveSelector,
  MoveSelectorLeafKind,
} from '#shared/moveAutomation/selectors'
import {
  MOVE_SPEC_LIMITS,
  MOVE_SPEC_PHASES,
  type MoveSpecPhase,
} from '#shared/moveAutomation/spec'
import {
  MOVE_RESOLUTION_TRACE_LIMITS,
  type MoveResolutionAuditTrace,
  type MoveResolutionTraceAncestryEntry,
  type MoveResolutionTraceJsonValue,
} from '#shared/moveAutomation/trace'
import type {
  AuthoritativeMoveRulesContext,
  AuthoritativeMoveSheetRead,
} from './context'
import {
  createMoveResolutionTrace,
  reduceMoveResolutionTrace,
} from './trace'
import {
  validateMoveSpec,
  type ValidatedMoveSpec,
  type ValidatedMoveSpecDefinition,
} from './validateSpec'

export type MoveSpecExecutionErrorCode =
  | 'definition-integrity-mismatch'
  | 'ruleset-mismatch'
  | 'registered-handler-unsupported'
  | 'cost-unsupported'
  | 'expression-unsupported'
  | 'comparison-type-mismatch'
  | 'random-table-unsupported'
  | 'recipient-limit-exceeded'

export class MoveSpecExecutionError extends Error {
  readonly code: MoveSpecExecutionErrorCode

  constructor(code: MoveSpecExecutionErrorCode, message: string) {
    super(message)
    this.name = 'MoveSpecExecutionError'
    this.code = code
  }
}

export interface MoveSpecEmittedOperation {
  /** The exact reviewed, validated operation. Reducers decide its state semantics later. */
  readonly operation: MoveEffectOperation
  /** Authoritative placement IDs resolved from the operation's recipient selector. */
  readonly recipientIds: readonly string[]
}

interface MoveSpecPendingRequestBase {
  readonly operationId: string
  readonly phase: MoveSpecPhase
  readonly reasonCode: string
  readonly recipientIds: readonly string[]
  readonly requestId: string
  readonly promptKey: string
  readonly options: readonly {
    readonly id: string
    readonly labelKey: string
  }[]
  readonly allowPass: boolean
}

export interface MoveSpecPendingChoiceRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'choice'
}

export interface MoveSpecPendingReactionRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'reaction'
  readonly priority: number
}

export type MoveSpecPendingRequest =
  | MoveSpecPendingChoiceRequest
  | MoveSpecPendingReactionRequest

export interface MoveSpecExecutionRejection {
  readonly code: 'precondition-failed' | 'target-count-out-of-range'
  readonly reasonCode: string
  readonly preconditionId: string | null
  readonly actualTargetCount: number | null
  readonly minimumTargetCount: number | null
  readonly maximumTargetCount: number | null
}

interface MoveSpecExecutionResultBase {
  readonly operations: readonly MoveSpecEmittedOperation[]
  readonly targetIds: readonly string[]
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly rollLedger: readonly MoveAutomationRollLedgerEntry[]
  readonly trace: MoveResolutionAuditTrace
}

export interface MoveSpecExecutionCompleteResult extends MoveSpecExecutionResultBase {
  readonly kind: 'complete'
}

export interface MoveSpecExecutionPendingResult extends MoveSpecExecutionResultBase {
  readonly kind: 'pending-request'
  readonly request: MoveSpecPendingRequest
}

export interface MoveSpecExecutionRejectedResult extends MoveSpecExecutionResultBase {
  readonly kind: 'rejected'
  readonly rejection: MoveSpecExecutionRejection
}

export type MoveSpecExecutionResult =
  | MoveSpecExecutionCompleteResult
  | MoveSpecExecutionPendingResult
  | MoveSpecExecutionRejectedResult

export interface ExecuteMoveSpecInput {
  /** A server-registered definition. It is revalidated before any phase executes. */
  readonly definition: ValidatedMoveSpecDefinition
  readonly context: AuthoritativeMoveRulesContext
  readonly ancestry?: readonly MoveResolutionTraceAncestryEntry[]
}

interface MoveSpecSelectorState {
  readonly targetIds: readonly string[]
}

interface MovePredicateEvaluation {
  readonly outcome: boolean
  readonly input: MoveResolutionTraceJsonValue
}

const fail = (
  code: MoveSpecExecutionErrorCode,
  message: string,
): never => {
  throw new MoveSpecExecutionError(code, message)
}

const frozenIds = (ids: readonly string[]): readonly string[] => Object.freeze([...ids])

const freezeEmittedOperations = (
  operations: readonly MoveSpecEmittedOperation[],
): readonly MoveSpecEmittedOperation[] => Object.freeze(operations.map(operation => Object.freeze({
  operation: operation.operation,
  recipientIds: frozenIds(operation.recipientIds),
})))

const rulesetMatchesContext = (
  definition: ValidatedMoveSpecDefinition,
  context: AuthoritativeMoveRulesContext,
): boolean => (
  definition.rulesetVersion.rulesetId === context.ruleset.rulesetId
  && definition.rulesetVersion.canonicalizationVersion === context.ruleset.canonicalization.version
  && definition.rulesetVersion.sourceDataSha256 === context.ruleset.sourceData.sha256
)

/**
 * Re-run strict parsing before execution. A forged or accidentally mutated
 * definition therefore fails before random draws, trace emission, or planning.
 */
const executableDefinition = (
  input: ExecuteMoveSpecInput,
): ValidatedMoveSpecDefinition => {
  const validated = validateMoveSpec(input.definition.spec, {
    capabilityIds: input.definition.capabilityIds,
    rulesetVersion: input.definition.rulesetVersion,
  })
  if (
    validated.definitionHash !== input.definition.definitionHash
    || validated.canonicalJson !== input.definition.canonicalJson
  ) {
    fail(
      'definition-integrity-mismatch',
      `MoveSpec ${validated.spec.canonicalId} does not match its reviewed definition hash.`,
    )
  }
  if (!rulesetMatchesContext(validated, input.context)) {
    fail(
      'ruleset-mismatch',
      `MoveSpec ${validated.spec.canonicalId} was not reviewed for the authoritative rules context.`,
    )
  }
  return validated
}

const assertExpressionSupported = (expression: MoveExpression): void => {
  if (expression.kind === 'constant') return
  fail(
    'expression-unsupported',
    `Expression kind ${expression.kind} is not executable by the phased interpreter skeleton.`,
  )
}

const assertPredicateSupported = (predicate: MovePredicate): void => {
  if (predicate.kind === 'constant') return
  if (predicate.kind === 'comparison') {
    assertExpressionSupported(predicate.left)
    assertExpressionSupported(predicate.right)
    return
  }
  if (predicate.kind === 'not') {
    assertPredicateSupported(predicate.predicate)
    return
  }
  for (const child of predicate.predicates) assertPredicateSupported(child)
}

/** Fail closed for capability families whose semantics arrive in later tickets. */
const assertSkeletonExecutable = (spec: ValidatedMoveSpec): void => {
  if (spec.registeredHandlerId !== null) {
    fail(
      'registered-handler-unsupported',
      `Registered handler ${spec.registeredHandlerId} cannot execute before the bounded handler registry is available.`,
    )
  }
  if (spec.costs.length > 0) {
    fail(
      'cost-unsupported',
      `MoveSpec ${spec.canonicalId} declares costs that do not yet have typed reducer semantics.`,
    )
  }
  for (const precondition of spec.preconditions) {
    assertPredicateSupported(precondition.predicate)
  }
  for (const block of spec.phases) {
    for (const operation of block.operations) {
      if (operation.kind === 'roll' && operation.payload.formula.kind === 'table') {
        fail(
          'random-table-unsupported',
          `Roll ${operation.payload.rollId} refers to a reviewed table that is not available to the skeleton interpreter.`,
        )
      }
    }
  }
}

const canonicalPlacementIds = (
  context: AuthoritativeMoveRulesContext,
  ids: Iterable<string>,
): readonly string[] => {
  const requested = new Set(ids)
  const ordered: string[] = []
  for (const placement of context.queries.placements.all()) {
    if (!requested.delete(placement.id)) continue
    ordered.push(placement.id)
  }
  ordered.push(...[...requested].sort((left, right) => (
    left === right ? 0 : left < right ? -1 : 1
  )))
  return ordered
}

const selectorLeafIds = (
  context: AuthoritativeMoveRulesContext,
  state: MoveSpecSelectorState,
  kind: MoveSelectorLeafKind,
): readonly string[] => {
  switch (kind) {
    case 'actor':
    case 'source-placement':
      return [context.actor.placement.id]
    case 'current-target': {
      const currentTargets = state.targetIds.length > 0
        ? state.targetIds
        : context.selectedPlacements.map(({ id }) => id)
      return currentTargets.length === 1 ? currentTargets : []
    }
    case 'selected-targets':
      return context.selectedPlacements.map(({ id }) => id)
    case 'candidate-targets':
    case 'area-targets':
      return context.candidatePlacements.map(({ id }) => id)
    case 'attacked-targets':
      return state.targetIds
    case 'hit-targets':
    case 'missed-targets':
    case 'damaged-targets':
    case 'fainted-targets':
      return []
  }
}

const evaluateSelector = (
  context: AuthoritativeMoveRulesContext,
  state: MoveSpecSelectorState,
  selector: MoveSelector,
): readonly string[] => {
  if (selector.kind !== 'union' && selector.kind !== 'intersection' && selector.kind !== 'difference') {
    return canonicalPlacementIds(context, selectorLeafIds(context, state, selector.kind))
  }

  if (selector.kind === 'union') {
    return canonicalPlacementIds(
      context,
      selector.selectors.flatMap(child => [...evaluateSelector(context, state, child)]),
    )
  }

  if (selector.kind === 'intersection') {
    const [first, ...rest] = selector.selectors.map(child => (
      new Set(evaluateSelector(context, state, child))
    ))
    return canonicalPlacementIds(
      context,
      [...(first ?? new Set<string>())].filter(id => rest.every(ids => ids.has(id))),
    )
  }

  const excluded = new Set(evaluateSelector(context, state, selector.exclude))
  return canonicalPlacementIds(
    context,
    evaluateSelector(context, state, selector.source).filter(id => !excluded.has(id)),
  )
}

const evaluateExpression = (expression: MoveExpression): MoveRuleScalar => {
  if (expression.kind === 'constant') return expression.value
  return fail(
    'expression-unsupported',
    `Expression kind ${expression.kind} is not executable by the phased interpreter skeleton.`,
  )
}

const compareOrderedScalars = (
  left: MoveRuleScalar,
  right: MoveRuleScalar,
  compare: (difference: number) => boolean,
): boolean => {
  if (typeof left === 'number' && typeof right === 'number') return compare(left - right)
  if (typeof left === 'string' && typeof right === 'string') {
    return compare(left === right ? 0 : left < right ? -1 : 1)
  }
  return fail(
    'comparison-type-mismatch',
    'Ordered MoveSpec comparisons require two numbers or two strings.',
  )
}

const evaluatePredicate = (predicate: MovePredicate): MovePredicateEvaluation => {
  if (predicate.kind === 'constant') {
    return {
      outcome: predicate.value,
      input: { predicateKind: predicate.kind, value: predicate.value },
    }
  }

  if (predicate.kind === 'comparison') {
    const left = evaluateExpression(predicate.left)
    const right = evaluateExpression(predicate.right)
    let outcome: boolean
    switch (predicate.operator) {
      case 'equal':
        outcome = left === right
        break
      case 'not-equal':
        outcome = left !== right
        break
      case 'less-than':
        outcome = compareOrderedScalars(left, right, difference => difference < 0)
        break
      case 'less-than-or-equal':
        outcome = compareOrderedScalars(left, right, difference => difference <= 0)
        break
      case 'greater-than':
        outcome = compareOrderedScalars(left, right, difference => difference > 0)
        break
      case 'greater-than-or-equal':
        outcome = compareOrderedScalars(left, right, difference => difference >= 0)
        break
    }
    return {
      outcome,
      input: {
        predicateKind: predicate.kind,
        operator: predicate.operator,
        left,
        right,
      },
    }
  }

  if (predicate.kind === 'not') {
    const child = evaluatePredicate(predicate.predicate)
    return {
      outcome: !child.outcome,
      input: { predicateKind: predicate.kind, childOutcome: child.outcome },
    }
  }

  const children = predicate.predicates.map(evaluatePredicate)
  return {
    outcome: predicate.kind === 'all'
      ? children.every(child => child.outcome)
      : children.some(child => child.outcome),
    input: {
      predicateKind: predicate.kind,
      childOutcomes: children.map(child => child.outcome),
    },
  }
}

const targetIdsForSpec = (
  context: AuthoritativeMoveRulesContext,
  spec: ValidatedMoveSpec,
): readonly string[] => {
  if (spec.targeting.kind === 'none') return []
  if (spec.targeting.kind === 'self') return [context.actor.placement.id]
  if (spec.targeting.selector) {
    return evaluateSelector(context, { targetIds: [] }, spec.targeting.selector)
  }
  return canonicalPlacementIds(
    context,
    context.selectedPlacements.map(({ id }) => id),
  )
}

const consideredTargetIds = (
  context: AuthoritativeMoveRulesContext,
  spec: ValidatedMoveSpec,
  targetIds: readonly string[],
): readonly string[] => {
  if (spec.targeting.kind === 'none') return []
  if (spec.targeting.kind === 'self') return [context.actor.placement.id]
  return canonicalPlacementIds(context, [
    ...context.selectedPlacements.map(({ id }) => id),
    ...targetIds,
  ]).slice(0, MOVE_SPEC_LIMITS.targetCount)
}

const effectRecipientIds = (
  context: AuthoritativeMoveRulesContext,
  state: MoveSpecSelectorState,
  kind: MoveEffectRecipientSelectorKind,
): readonly string[] => {
  let ids: readonly string[]
  switch (kind) {
    case 'none':
      ids = []
      break
    case 'actor':
    case 'source-placement':
      ids = [context.actor.placement.id]
      break
    case 'selected-targets':
      ids = context.selectedPlacements.map(({ id }) => id)
      break
    case 'attacked-targets':
      ids = state.targetIds
      break
    case 'area-targets':
      ids = context.candidatePlacements.map(({ id }) => id)
      break
    case 'hit-targets':
    case 'missed-targets':
    case 'damaged-targets':
    case 'fainted-targets':
      ids = []
      break
  }

  const resolved = canonicalPlacementIds(context, ids)
  if (resolved.length > MOVE_RESOLUTION_TRACE_LIMITS.recipients) {
    fail(
      'recipient-limit-exceeded',
      `Operation recipient selector ${kind} resolved ${resolved.length} placements; at most ${MOVE_RESOLUTION_TRACE_LIMITS.recipients} are allowed.`,
    )
  }
  return resolved
}

const traceJson = (value: unknown): MoveResolutionTraceJsonValue => (
  value as MoveResolutionTraceJsonValue
)

const pendingRequest = (
  operation: MoveChoiceRequestEffectOperation | MoveReactionRequestEffectOperation,
  recipientIds: readonly string[],
): MoveSpecPendingRequest => {
  const common = {
    operationId: operation.id,
    phase: operation.phase,
    reasonCode: operation.reasonCode,
    recipientIds: frozenIds(recipientIds),
    requestId: operation.payload.requestId,
    promptKey: operation.payload.promptKey,
    options: Object.freeze(operation.payload.options.map(option => Object.freeze({ ...option }))),
    allowPass: operation.payload.allowPass,
  }
  return operation.kind === 'choice-request'
    ? Object.freeze({ kind: 'choice', ...common })
    : Object.freeze({ kind: 'reaction', ...common, priority: operation.payload.priority })
}

const terminalBase = (
  context: AuthoritativeMoveRulesContext,
  operations: readonly MoveSpecEmittedOperation[],
  targetIds: readonly string[],
  trace: MoveResolutionAuditTrace,
  rollLedger: readonly MoveAutomationRollLedgerEntry[],
): MoveSpecExecutionResultBase => ({
  operations: freezeEmittedOperations(operations),
  targetIds: frozenIds(targetIds),
  sheetReads: context.reads.snapshot(),
  rollLedger,
  trace,
})

/**
 * Execute one reviewed MoveSpec against an immutable authoritative snapshot.
 * This layer emits typed operations only; repositories and state reducers are
 * intentionally outside the interpreter boundary.
 */
export const executeMoveSpec = (
  input: ExecuteMoveSpecInput,
): MoveSpecExecutionResult => {
  const definition = executableDefinition(input)
  const { spec } = definition
  assertSkeletonExecutable(spec)

  const phaseBlocks = new Map(spec.phases.map(block => [block.phase, block]))
  const activePhases = new Set<MoveSpecPhase>(phaseBlocks.keys())
  if (spec.preconditions.length > 0) activePhases.add('precondition')
  if (
    spec.targeting.kind !== 'none'
    || spec.targeting.selector !== null
    || spec.targeting.minTargets > 0
    || spec.targeting.maxTargets > 0
  ) {
    activePhases.add('target')
  }

  let trace = createMoveResolutionTrace({
    program: {
      canonicalId: spec.canonicalId,
      runtimeKind: 'movespec-v2',
      runtimeVersion: spec.version,
      definitionHash: definition.definitionHash,
    },
    ruleset: {
      rulesetId: definition.rulesetVersion.rulesetId,
      sourceDataSha256: definition.rulesetVersion.sourceDataSha256,
    },
    ancestry: input.ancestry,
  })
  let activePhase: MoveSpecPhase | null = null
  let targetIds: readonly string[] = []
  const operations: MoveSpecEmittedOperation[] = []

  for (const phase of MOVE_SPEC_PHASES) {
    if (!activePhases.has(phase)) continue
    trace = reduceMoveResolutionTrace(trace, {
      kind: 'phase-transition',
      from: activePhase,
      to: phase,
      reasonCode: `${phase}-phase`,
    })
    activePhase = phase

    if (phase === 'precondition') {
      for (const precondition of spec.preconditions) {
        const evaluation = evaluatePredicate(precondition.predicate)
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'predicate',
          phase,
          predicateId: precondition.id,
          outcome: evaluation.outcome,
          reasonCode: evaluation.outcome
            ? 'precondition-passed'
            : precondition.failureReasonCode,
          input: evaluation.input,
        })
        if (!evaluation.outcome) {
          return Object.freeze({
            kind: 'rejected',
            ...terminalBase(
              input.context,
              operations,
              targetIds,
              trace,
              input.context.random.complete(),
            ),
            rejection: Object.freeze({
              code: 'precondition-failed',
              reasonCode: precondition.failureReasonCode,
              preconditionId: precondition.id,
              actualTargetCount: null,
              minimumTargetCount: null,
              maximumTargetCount: null,
            }),
          })
        }
      }
    }

    if (phase === 'target') {
      const resolvedTargetIds = targetIdsForSpec(input.context, spec)
      targetIds = resolvedTargetIds.length <= MOVE_SPEC_LIMITS.targetCount
        ? resolvedTargetIds
        : []
      const targetIdSet = new Set(targetIds)
      for (const targetId of consideredTargetIds(input.context, spec, targetIds)) {
        const included = targetIdSet.has(targetId)
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'target',
          phase,
          targetId,
          outcome: included ? 'included' : 'excluded',
          reasonCode: included ? 'target-selector-included' : 'target-selector-excluded',
        })
      }

      if (
        resolvedTargetIds.length < spec.targeting.minTargets
        || resolvedTargetIds.length > spec.targeting.maxTargets
      ) {
        return Object.freeze({
          kind: 'rejected',
          ...terminalBase(
            input.context,
            operations,
            targetIds,
            trace,
            input.context.random.complete(),
          ),
          rejection: Object.freeze({
            code: 'target-count-out-of-range',
            reasonCode: 'target-count-out-of-range',
            preconditionId: null,
            actualTargetCount: resolvedTargetIds.length,
            minimumTargetCount: spec.targeting.minTargets,
            maximumTargetCount: spec.targeting.maxTargets,
          }),
        })
      }
    }

    for (const operation of phaseBlocks.get(phase)?.operations ?? []) {
      const recipientIds = effectRecipientIds(
        input.context,
        { targetIds },
        operation.recipients.kind,
      )
      operations.push(Object.freeze({
        operation,
        recipientIds: frozenIds(recipientIds),
      }))

      if (operation.kind === 'roll') {
        if (operation.payload.formula.kind === 'table') {
          return fail(
            'random-table-unsupported',
            `Roll ${operation.payload.rollId} cannot resolve without a reviewed server table.`,
          )
        }
        const result = input.context.random.roll({
          rollId: operation.payload.rollId,
          parentEffectId: operation.id,
          formula: operation.payload.formula,
          reason: operation.reasonCode,
        })
        const ledgerEntry = input.context.random.snapshot().at(-1)
          ?? fail('definition-integrity-mismatch', `Roll ${operation.payload.rollId} did not produce a ledger entry.`)
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: 'applied',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: {
            rollId: operation.payload.rollId,
            naturalResult: result.naturalResult,
            finalValue: result.finalValue,
          },
        })
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'roll',
          phase,
          reasonCode: operation.reasonCode,
          roll: ledgerEntry,
        })
        continue
      }

      if (operation.kind === 'choice-request' || operation.kind === 'reaction-request') {
        const request = pendingRequest(operation, recipientIds)
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: 'pending',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: {
            requestId: request.requestId,
            requestKind: request.kind,
          },
        })
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'choice',
          phase,
          requestId: request.requestId,
          requestKind: request.kind,
          outcome: 'requested',
          optionId: null,
          reasonCode: operation.reasonCode,
        })
        return Object.freeze({
          kind: 'pending-request',
          ...terminalBase(
            input.context,
            operations,
            targetIds,
            trace,
            input.context.random.snapshot(),
          ),
          request,
        })
      }

      trace = reduceMoveResolutionTrace(trace, {
        kind: 'operation',
        phase,
        operationId: operation.id,
        operationKind: operation.kind,
        recipientIds,
        outcome: 'applied',
        reasonCode: operation.reasonCode,
        input: traceJson(operation.payload),
        result: { status: 'emitted' },
      })
    }
  }

  return Object.freeze({
    kind: 'complete',
    ...terminalBase(
      input.context,
      operations,
      targetIds,
      trace,
      input.context.random.complete(),
    ),
  })
}
