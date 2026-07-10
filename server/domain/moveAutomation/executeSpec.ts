import {
  MOVE_EFFECT_OPERATION_LIMITS,
  type MoveChoiceRequestEffectOperation,
  type MoveDamageEffectOperation,
  type MoveEffectOperation,
  type MoveEffectRecipientSelectorKind,
  type MoveReactionRequestEffectOperation,
  type MoveRollEffectOperation,
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
import { parseMoveDamageFormula } from '~/utils/moveDamageBase'
import {
  moveAutomationUserAccuracy,
  resolveMoveAutomationTargetEvasion,
} from '~/utils/moveAutomationAccuracy'
import { resolveMoveAutomationAccuracyRoll } from '~/utils/moveAutomationResolution'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type {
  AuthoritativeMoveRulesContext,
  AuthoritativeMoveSheetRead,
} from './context'
import {
  REGISTERED_MOVE_HANDLER_REGISTRY,
  executeRegisteredMoveHandler,
  type RegisteredMoveHandlerOutput,
  type RegisteredMoveHandlerRegistry,
  type RegisteredMoveHandlerTraceEntry,
} from './handlers/registry'
import {
  createMoveResolutionTrace,
  reduceMoveResolutionTrace,
} from './trace'
import {
  validateMoveSpec,
  validateMoveSpecOperationSequence,
  type ValidatedMoveSpec,
  type ValidatedMoveSpecDefinition,
} from './validateSpec'

export type MoveSpecExecutionErrorCode =
  | 'definition-integrity-mismatch'
  | 'ruleset-mismatch'
  | 'cost-unsupported'
  | 'expression-unsupported'
  | 'comparison-type-mismatch'
  | 'random-table-unsupported'
  | 'recipient-limit-exceeded'
  | 'authoritative-target-invalid'
  | 'move-mechanics-unavailable'
  | 'damage-formula-unsupported'
  | 'resolved-roll-id-too-long'

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

export interface MoveSpecResolvedRoll {
  readonly operationId: string
  /** Stable ID authored by a roll operation, or the owning damage operation ID. */
  readonly referenceId: string
  readonly purpose: 'generic' | 'accuracy' | 'damage'
  readonly recipientId: string | null
  readonly rollId: string
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
  readonly resolvedRolls: readonly MoveSpecResolvedRoll[]
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

export interface MoveSpecAuthoritativeTargetEvaluation {
  readonly targetPlacementId: string
  readonly outcome: 'included' | 'excluded'
  readonly reasonCode: string
}

export interface ExecuteMoveSpecInput {
  /** A server-registered definition. It is revalidated before any phase executes. */
  readonly definition: ValidatedMoveSpecDefinition
  readonly context: AuthoritativeMoveRulesContext
  /** Server-derived geometry recipients; this field never comes from move intent. */
  readonly authoritativeTargetIds?: readonly string[]
  /** Complete server-only area-filter evidence in geometric candidate order. */
  readonly authoritativeTargetEvaluations?: readonly MoveSpecAuthoritativeTargetEvaluation[]
  readonly ancestry?: readonly MoveResolutionTraceAncestryEntry[]
  /** Test/migration seam; production resolves only the audited global registry. */
  readonly handlerRegistry?: RegisteredMoveHandlerRegistry
}

interface MoveSpecSelectorState {
  readonly targetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly missedTargetIds: readonly string[]
  readonly damagedTargetIds: readonly string[]
  readonly faintedTargetIds: readonly string[]
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

const freezeResolvedRolls = (
  rolls: readonly MoveSpecResolvedRoll[],
): readonly MoveSpecResolvedRoll[] => Object.freeze(rolls.map(roll => Object.freeze({ ...roll })))

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
  handlerRegistry: RegisteredMoveHandlerRegistry,
): ValidatedMoveSpecDefinition => {
  const validated = validateMoveSpec(input.definition.spec, {
    capabilityIds: input.definition.capabilityIds,
    rulesetVersion: input.definition.rulesetVersion,
    handlerRegistry,
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
const assertSkeletonExecutable = (
  spec: ValidatedMoveSpec,
  operations: readonly MoveEffectOperation[],
): void => {
  if (spec.costs.length > 0) {
    fail(
      'cost-unsupported',
      `MoveSpec ${spec.canonicalId} declares costs that do not yet have typed reducer semantics.`,
    )
  }
  for (const precondition of spec.preconditions) {
    assertPredicateSupported(precondition.predicate)
  }
  for (const operation of operations) {
    if (operation.kind === 'roll' && operation.payload.formula.kind === 'table') {
      fail(
        'random-table-unsupported',
        `Roll ${operation.payload.rollId} refers to a reviewed table that is not available to the skeleton interpreter.`,
      )
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
      return state.hitTargetIds
    case 'missed-targets':
      return state.missedTargetIds
    case 'damaged-targets':
      return state.damagedTargetIds
    case 'fainted-targets':
      return state.faintedTargetIds
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

const emptySelectorState = (): MoveSpecSelectorState => ({
  targetIds: [],
  hitTargetIds: [],
  missedTargetIds: [],
  damagedTargetIds: [],
  faintedTargetIds: [],
})

const validatedAuthoritativeTargetIds = (
  context: AuthoritativeMoveRulesContext,
  ids: readonly string[],
): readonly string[] => {
  if (!Array.isArray(ids) || ids.length > MOVE_SPEC_LIMITS.targetCount) {
    return fail(
      'authoritative-target-invalid',
      `Server-derived targets must contain at most ${MOVE_SPEC_LIMITS.targetCount} placement IDs.`,
    )
  }
  const seen = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim() || seen.has(id) || !context.queries.placements.get(id)) {
      return fail(
        'authoritative-target-invalid',
        `Server-derived target ${String(id)} is missing, duplicated, or invalid.`,
      )
    }
    seen.add(id)
  }
  return canonicalPlacementIds(context, ids)
}

const targetIdsForSpec = (
  context: AuthoritativeMoveRulesContext,
  spec: ValidatedMoveSpec,
  authoritativeTargetIds?: readonly string[],
): readonly string[] => {
  if (spec.targeting.kind === 'none') return []
  if (spec.targeting.kind === 'self') return [context.actor.placement.id]
  if (spec.targeting.kind === 'area' && authoritativeTargetIds === undefined) {
    return fail(
      'authoritative-target-invalid',
      'Geometric area targeting requires server-derived eligible target IDs.',
    )
  }
  if (authoritativeTargetIds !== undefined) {
    return validatedAuthoritativeTargetIds(context, authoritativeTargetIds)
  }
  if (spec.targeting.selector) {
    return evaluateSelector(context, emptySelectorState(), spec.targeting.selector)
  }
  return canonicalPlacementIds(
    context,
    context.selectedPlacements.map(({ id }) => id),
  )
}

const authoritativeTargetEvaluations = (
  context: AuthoritativeMoveRulesContext,
  targetIds: readonly string[],
  value: readonly MoveSpecAuthoritativeTargetEvaluation[] | undefined,
): readonly MoveSpecAuthoritativeTargetEvaluation[] | null => {
  if (value === undefined) return null
  if (!Array.isArray(value) || value.length > MOVE_SPEC_LIMITS.targetCount) {
    return fail(
      'authoritative-target-invalid',
      `Server-derived target evaluations must contain at most ${MOVE_SPEC_LIMITS.targetCount} entries.`,
    )
  }

  const seen = new Set<string>()
  const evaluations = value.map((evaluation) => {
    if (
      typeof evaluation !== 'object'
      || evaluation === null
      || typeof evaluation.targetPlacementId !== 'string'
      || evaluation.targetPlacementId.length === 0
      || evaluation.targetPlacementId.trim() !== evaluation.targetPlacementId
      || !context.queries.placements.get(evaluation.targetPlacementId)
      || seen.has(evaluation.targetPlacementId)
      || (evaluation.outcome !== 'included' && evaluation.outcome !== 'excluded')
      || typeof evaluation.reasonCode !== 'string'
      || !/^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/.test(evaluation.reasonCode)
    ) {
      return fail(
        'authoritative-target-invalid',
        'Server-derived target evaluations contain a missing, duplicated, or malformed decision.',
      )
    }
    seen.add(evaluation.targetPlacementId)
    return Object.freeze({
      targetPlacementId: evaluation.targetPlacementId,
      outcome: evaluation.outcome,
      reasonCode: evaluation.reasonCode,
    })
  })
  const includedIds = evaluations
    .filter(evaluation => evaluation.outcome === 'included')
    .map(evaluation => evaluation.targetPlacementId)
  if (
    includedIds.length !== targetIds.length
    || includedIds.some((targetId, index) => targetId !== targetIds[index])
  ) {
    return fail(
      'authoritative-target-invalid',
      'Included target evaluations must exactly match authoritative targets in server order.',
    )
  }
  return Object.freeze(evaluations)
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
      // Geometric candidates have already passed the reviewed area predicate.
      // Re-reading the broader context candidate set here would re-include
      // rule-excluded or explicitly excluded placements.
      ids = state.targetIds
      break
    case 'hit-targets':
      ids = state.hitTargetIds
      break
    case 'missed-targets':
      ids = state.missedTargetIds
      break
    case 'damaged-targets':
      ids = state.damagedTargetIds
      break
    case 'fainted-targets':
      ids = state.faintedTargetIds
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

interface MoveSpecAuthoritativeMoveMechanics {
  readonly script: MoveAutomationScript
  readonly damageFormula: string | null
}

const authoritativeMoveMechanics = (
  context: AuthoritativeMoveRulesContext,
  canonicalId: string,
): MoveSpecAuthoritativeMoveMechanics => {
  const result = context.queries.resolveActorMoveEntry(canonicalId)
  if (!result.ok || result.entry.canonicalMoveName !== canonicalId) {
    return fail(
      'move-mechanics-unavailable',
      `Authoritative move mechanics for ${canonicalId} are not available to the actor.`,
    )
  }
  return {
    script: result.entry.script,
    damageFormula: result.entry.damageFormula,
  }
}

const targetTokenForRoll = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
): SpawnedPokemon => {
  const placement = context.queries.placements.get(placementId)
  const token = context.queries.tokens.get(placementId)
  if (!placement || !token) {
    return fail(
      'authoritative-target-invalid',
      `Roll recipient ${placementId} could not resolve to an authoritative token.`,
    )
  }
  context.reads.recordPlacement(placement)
  return token
}

const resolvedRollId = (
  baseId: string,
  ordinal: number,
  suffix = '',
): string => {
  const rollId = `${baseId}${suffix}.${ordinal}`
  if (rollId.length > MOVE_SPEC_LIMITS.identifierLength) {
    return fail(
      'resolved-roll-id-too-long',
      `Resolved roll ID ${rollId} exceeds ${MOVE_SPEC_LIMITS.identifierLength} characters.`,
    )
  }
  return rollId
}

const latestLedgerEntry = (
  context: AuthoritativeMoveRulesContext,
  rollId: string,
): MoveAutomationRollLedgerEntry => context.random.snapshot().at(-1)
  ?? fail('definition-integrity-mismatch', `Roll ${rollId} did not produce a ledger entry.`)

const accuracyReferenceIds = (
  operations: readonly MoveEffectOperation[],
): ReadonlySet<string> => new Set(
  operations.flatMap(operation => (
    operation.kind === 'damage' && operation.payload.accuracyRollId !== null
      ? [operation.payload.accuracyRollId]
      : []
  )),
)

const damageRollFormula = (
  mechanics: MoveSpecAuthoritativeMoveMechanics,
  operation: MoveDamageEffectOperation,
): { readonly count: number; readonly sides: number; readonly modifier: number } => {
  const parsed = mechanics.damageFormula
    ? parseMoveDamageFormula(mechanics.damageFormula)
    : null
  if (!parsed) {
    return fail(
      'damage-formula-unsupported',
      `Damage operation ${operation.id} has no authoritative bounded dice formula.`,
    )
  }
  return { count: parsed.count, sides: parsed.sides, modifier: parsed.mod }
}

const terminalBase = (
  context: AuthoritativeMoveRulesContext,
  operations: readonly MoveSpecEmittedOperation[],
  targetIds: readonly string[],
  trace: MoveResolutionAuditTrace,
  rollLedger: readonly MoveAutomationRollLedgerEntry[],
  resolvedRolls: readonly MoveSpecResolvedRoll[],
): MoveSpecExecutionResultBase => ({
  operations: freezeEmittedOperations(operations),
  targetIds: frozenIds(targetIds),
  sheetReads: context.reads.snapshot(),
  rollLedger,
  resolvedRolls: freezeResolvedRolls(resolvedRolls),
  trace,
})

interface ExecutableMoveSpecOperationEntry {
  readonly operation: MoveEffectOperation
  readonly path: string
}

interface ExecutableMoveSpecProgram {
  readonly operations: readonly MoveEffectOperation[]
  readonly operationsByPhase: ReadonlyMap<MoveSpecPhase, readonly MoveEffectOperation[]>
  readonly handlerTraceEntriesByPhase: ReadonlyMap<
    MoveSpecPhase,
    readonly RegisteredMoveHandlerTraceEntry[]
  >
}

const staticOperationEntries = (
  spec: ValidatedMoveSpec,
): readonly ExecutableMoveSpecOperationEntry[] => spec.phases.flatMap((block, phaseIndex) => (
  block.operations.map((operation, operationIndex) => ({
    operation,
    path: `spec.phases[${phaseIndex}].operations[${operationIndex}]`,
  }))
))

const handlerOutputFor = (
  definition: ValidatedMoveSpecDefinition,
  context: AuthoritativeMoveRulesContext,
  handlerRegistry: RegisteredMoveHandlerRegistry,
  staticOperationCount: number,
): RegisteredMoveHandlerOutput => {
  const reference = definition.registeredHandler
  if (reference === null) {
    return Object.freeze({
      operations: Object.freeze([]),
      traceEntries: Object.freeze([]),
    })
  }
  const registration = handlerRegistry.resolve(reference.id)
  if (!registration) {
    return fail(
      'definition-integrity-mismatch',
      `Registered handler ${reference.id} disappeared after MoveSpec validation.`,
    )
  }
  return executeRegisteredMoveHandler({
    registration,
    expectedVersion: reference.version,
    context,
    maximumOperations: MOVE_EFFECT_OPERATION_LIMITS.operations - staticOperationCount,
  })
}

const executableProgram = (
  definition: ValidatedMoveSpecDefinition,
  context: AuthoritativeMoveRulesContext,
  handlerRegistry: RegisteredMoveHandlerRegistry,
): ExecutableMoveSpecProgram => {
  const staticEntries = staticOperationEntries(definition.spec)
  assertSkeletonExecutable(
    definition.spec,
    staticEntries.map(({ operation }) => operation),
  )
  const handlerOutput = handlerOutputFor(
    definition,
    context,
    handlerRegistry,
    staticEntries.length,
  )
  const handlerEntries = handlerOutput.operations.map((operation, index) => ({
    operation,
    path: `handlerOutput.operations[${index}]`,
  }))
  const entriesByPhase = new Map<MoveSpecPhase, ExecutableMoveSpecOperationEntry[]>()
  for (const phase of MOVE_SPEC_PHASES) {
    const entries = [
      ...staticEntries.filter(entry => entry.operation.phase === phase),
      ...handlerEntries.filter(entry => entry.operation.phase === phase),
    ]
    if (entries.length > 0) entriesByPhase.set(phase, entries)
  }
  const orderedEntries = MOVE_SPEC_PHASES.flatMap(phase => entriesByPhase.get(phase) ?? [])
  validateMoveSpecOperationSequence(orderedEntries, 'moveSpecExecution.operations')
  const operations = Object.freeze(orderedEntries.map(({ operation }) => operation))
  assertSkeletonExecutable(definition.spec, operations)

  const handlerTraceEntriesByPhase = new Map<
    MoveSpecPhase,
    readonly RegisteredMoveHandlerTraceEntry[]
  >()
  for (const phase of MOVE_SPEC_PHASES) {
    const entries = handlerOutput.traceEntries.filter(entry => entry.phase === phase)
    if (entries.length > 0) handlerTraceEntriesByPhase.set(phase, Object.freeze(entries))
  }

  return Object.freeze({
    operations,
    operationsByPhase: new Map(
      [...entriesByPhase].map(([phase, entries]) => [
        phase,
        Object.freeze(entries.map(({ operation }) => operation)),
      ]),
    ),
    handlerTraceEntriesByPhase,
  })
}

/**
 * Execute one reviewed MoveSpec against an immutable authoritative snapshot.
 * This layer emits typed operations only; repositories and state reducers are
 * intentionally outside the interpreter boundary.
 */
export const executeMoveSpec = (
  input: ExecuteMoveSpecInput,
): MoveSpecExecutionResult => {
  const handlerRegistry = input.handlerRegistry ?? REGISTERED_MOVE_HANDLER_REGISTRY
  const definition = executableDefinition(input, handlerRegistry)
  const { spec } = definition
  const program = executableProgram(definition, input.context, handlerRegistry)

  const activePhases = new Set<MoveSpecPhase>(program.operationsByPhase.keys())
  for (const phase of program.handlerTraceEntriesByPhase.keys()) activePhases.add(phase)
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
  let hitTargetIds: readonly string[] = []
  let missedTargetIds: readonly string[] = []
  const damagedTargetIds: readonly string[] = []
  const faintedTargetIds: readonly string[] = []
  const operations: MoveSpecEmittedOperation[] = []
  const resolvedRolls: MoveSpecResolvedRoll[] = []
  const referencedAccuracyRollIds = accuracyReferenceIds(program.operations)
  let mechanics: MoveSpecAuthoritativeMoveMechanics | null = null
  const getMechanics = (): MoveSpecAuthoritativeMoveMechanics => (
    mechanics ??= authoritativeMoveMechanics(input.context, spec.canonicalId)
  )

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
              resolvedRolls,
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
      if (
        input.authoritativeTargetEvaluations !== undefined
        && spec.targeting.kind !== 'area'
      ) {
        fail(
          'authoritative-target-invalid',
          'Server-derived target evaluations are supported only for geometric area targeting.',
        )
      }
      if (
        spec.targeting.kind === 'area'
        && input.authoritativeTargetEvaluations === undefined
      ) {
        fail(
          'authoritative-target-invalid',
          'Geometric area targeting requires complete server-derived target evaluations.',
        )
      }
      const resolvedTargetIds = targetIdsForSpec(
        input.context,
        spec,
        input.authoritativeTargetIds,
      )
      targetIds = resolvedTargetIds.length <= MOVE_SPEC_LIMITS.targetCount
        ? resolvedTargetIds
        : []
      hitTargetIds = []
      missedTargetIds = []
      const suppliedEvaluations = authoritativeTargetEvaluations(
        input.context,
        targetIds,
        input.authoritativeTargetEvaluations,
      )
      const targetIdSet = new Set(targetIds)
      const evaluations = suppliedEvaluations ?? consideredTargetIds(
        input.context,
        spec,
        targetIds,
      ).map((targetPlacementId): MoveSpecAuthoritativeTargetEvaluation => {
        const included = targetIdSet.has(targetPlacementId)
        return {
          targetPlacementId,
          outcome: included ? 'included' : 'excluded',
          reasonCode: included ? 'target-selector-included' : 'target-selector-excluded',
        }
      })
      for (const evaluation of evaluations) {
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'target',
          phase,
          targetId: evaluation.targetPlacementId,
          outcome: evaluation.outcome,
          reasonCode: evaluation.reasonCode,
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
            resolvedRolls,
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

    for (const handlerTraceEntry of program.handlerTraceEntriesByPhase.get(phase) ?? []) {
      trace = reduceMoveResolutionTrace(trace, handlerTraceEntry)
    }

    for (const operation of program.operationsByPhase.get(phase) ?? []) {
      const selectorState: MoveSpecSelectorState = {
        targetIds,
        hitTargetIds,
        missedTargetIds,
        damagedTargetIds,
        faintedTargetIds,
      }
      const recipientIds = effectRecipientIds(
        input.context,
        selectorState,
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
        const purpose = referencedAccuracyRollIds.has(operation.payload.rollId)
          ? 'accuracy' as const
          : 'generic' as const
        const subjects: readonly (string | null)[] = operation.recipients.kind === 'none'
          ? [null]
          : recipientIds
        const rollSummaries: Array<{
          readonly rollId: string
          readonly recipientId: string | null
          readonly naturalResult: number
          readonly finalValue: number
        }> = []
        const hitSet = new Set(hitTargetIds)
        const missedSet = new Set(missedTargetIds)

        for (const [index, recipientId] of subjects.entries()) {
          const rollId = recipientId === null
            ? operation.payload.rollId
            : resolvedRollId(operation.payload.rollId, index + 1)
          let modifiers: readonly {
            readonly sourceId: string
            readonly reason: string
            readonly value: number
          }[] = []
          let target: SpawnedPokemon | null = null
          let targetEvasion = 0
          if (purpose === 'accuracy') {
            if (recipientId === null) {
              return fail(
                'move-mechanics-unavailable',
                `Accuracy roll ${operation.id} must resolve once per attacked target.`,
              )
            }
            const move = getMechanics()
            target = targetTokenForRoll(input.context, recipientId)
            const userAccuracy = moveAutomationUserAccuracy(input.context.actor.token)
            targetEvasion = resolveMoveAutomationTargetEvasion(
              move.script,
              target,
              { attacker: input.context.actor.token },
            ).value
            modifiers = [{
              sourceId: 'actor-accuracy',
              reason: 'Actor Accuracy',
              value: userAccuracy,
            }]
          }

          const result = input.context.random.roll({
            rollId,
            parentEffectId: operation.id,
            formula: operation.payload.formula,
            reason: recipientId === null
              ? operation.reasonCode
              : `${operation.reasonCode} for ${recipientId}`,
            modifiers,
          })
          const ledgerEntry = latestLedgerEntry(input.context, rollId)
          resolvedRolls.push({
            operationId: operation.id,
            referenceId: operation.payload.rollId,
            purpose,
            recipientId,
            rollId,
          })
          rollSummaries.push({
            rollId,
            recipientId,
            naturalResult: result.naturalResult,
            finalValue: result.finalValue,
          })

          if (purpose === 'accuracy' && recipientId !== null && target) {
            const accuracy = resolveMoveAutomationAccuracyRoll(
              getMechanics().script,
              result.naturalResult,
              {
                userAccuracy: modifiers[0]?.value ?? 0,
                targetEvasion,
              },
            )
            if (accuracy.hit) {
              hitSet.add(recipientId)
              missedSet.delete(recipientId)
            }
            else {
              missedSet.add(recipientId)
              hitSet.delete(recipientId)
            }
          }
        }

        hitTargetIds = canonicalPlacementIds(input.context, hitSet)
        missedTargetIds = canonicalPlacementIds(input.context, missedSet)
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: 'applied',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: { rolls: rollSummaries },
        })
        for (const summary of rollSummaries) {
          const roll = input.context.random.snapshot().find(entry => entry.rollId === summary.rollId)
            ?? fail('definition-integrity-mismatch', `Roll ${summary.rollId} is missing from the ledger.`)
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'roll',
            phase,
            reasonCode: operation.reasonCode,
            roll,
          })
        }
        continue
      }

      if (operation.kind === 'damage') {
        const formula = damageRollFormula(getMechanics(), operation)
        const rollSummaries: Array<{
          readonly rollId: string
          readonly recipientId: string
          readonly naturalResult: number
          readonly finalValue: number
        }> = []
        for (const [index, recipientId] of recipientIds.entries()) {
          targetTokenForRoll(input.context, recipientId)
          const rollId = resolvedRollId(operation.id, index + 1, '.roll')
          const result = input.context.random.roll({
            rollId,
            parentEffectId: operation.id,
            formula: { kind: 'dice', ...formula },
            reason: `${operation.reasonCode} for ${recipientId}`,
          })
          resolvedRolls.push({
            operationId: operation.id,
            referenceId: operation.id,
            purpose: 'damage',
            recipientId,
            rollId,
          })
          rollSummaries.push({
            rollId,
            recipientId,
            naturalResult: result.naturalResult,
            finalValue: result.finalValue,
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
          result: { status: 'emitted', damageRolls: rollSummaries },
        })
        for (const summary of rollSummaries) {
          const roll = input.context.random.snapshot().find(entry => entry.rollId === summary.rollId)
            ?? fail('definition-integrity-mismatch', `Roll ${summary.rollId} is missing from the ledger.`)
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'roll',
            phase,
            reasonCode: operation.reasonCode,
            roll,
          })
        }
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
            resolvedRolls,
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
      resolvedRolls,
    ),
  })
}
