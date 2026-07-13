import {
  MOVE_EFFECT_OPERATION_LIMITS,
  moveEffectBranchPaths,
  type MoveBranchEffectOperation,
  type MoveCheckEffectOperation,
  type MoveChoiceRequestEffectOperation,
  type MoveDamageEffectOperation,
  type MoveEffectOperation,
  type MoveEffectRecipientSelectorKind,
  type MoveReactionRequestEffectOperation,
  type MoveRollEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationRollLedgerEntry } from '#shared/moveAutomation/random'
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
  executeResolvedMoveChoiceBranch,
  executeServerMoveBranch,
  type ExecutedMoveBranch,
  type MoveBranchSelection,
} from './branches'
import {
  executeMoveCheckOperation,
  type MoveCheckExecution,
  type MoveCheckPendingRequest,
  type MoveCheckResolution,
} from './checks'
import type { MoveContextualDamageBaseResolution } from './damageBase'
import { resolveMoveSpecDamageRollFormula } from './damageRollFormula'
import { resolveMoveEffectCompoundRecipientIds } from './effectRecipientQueries'
import {
  resolveMoveDamageType,
  type MoveDamageTypeResolution,
} from './damageTypes'
import {
  evaluateMovePredicate,
  evaluateMoveSelector,
} from './evaluateExpression'
import {
  executeMoveMultiHitOperation,
  type MoveMultiHitExecution,
} from './multiHit'
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
  createMoveSpecResponseResolver,
  type MoveSpecResolvedResponse,
} from './responses'
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
  | 'random-table-unsupported'
  | 'recipient-limit-exceeded'
  | 'authoritative-target-invalid'
  | 'move-mechanics-unavailable'
  | 'damage-formula-unsupported'
  | 'resolved-roll-id-too-long'
  | 'pre-window-operation-forbidden'

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
  readonly purpose:
    | 'generic'
    | 'hit-count'
    | 'accuracy'
    | 'critical'
    | 'damage'
    | 'check'
  readonly recipientId: string | null
  /** One-based strike position for sequence-owned rolls. */
  readonly hitIndex?: number | null
  readonly checkRole?: 'actor' | 'target' | null
  readonly attemptIndex?: number | null
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

export interface MoveSpecPendingBranchChoiceRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'branch-choice'
  readonly selectionId: string
  readonly scope: 'resolution' | 'recipient'
}

export interface MoveSpecPendingReactionRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'reaction'
  readonly priority: number
}

export interface MoveSpecPendingCheckSelectionRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'check-selection'
  readonly checkId: string
  readonly role: 'actor' | 'target'
}

export interface MoveSpecPendingResourceSpendRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'resource-spend'
  readonly checkId: string
  readonly role: 'actor' | 'target'
  readonly resourceId: string
  readonly amount: number
  readonly checkRecipientId: string
}

export type MoveSpecPendingRequest =
  | MoveSpecPendingChoiceRequest
  | MoveSpecPendingBranchChoiceRequest
  | MoveSpecPendingReactionRequest
  | MoveSpecPendingCheckSelectionRequest
  | MoveSpecPendingResourceSpendRequest

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
  /** Per-recipient authoritative move-type/effectiveness calculations in operation order. */
  readonly resolvedDamageTypes: readonly MoveDamageTypeResolution[]
  /** Per-recipient native-v2 contextual DB calculations in operation order. */
  readonly resolvedDamageBases: readonly MoveContextualDamageBaseResolution[]
  /** Pre-reduced bounded strike sequences, retained for immediate typed planning. */
  readonly multiHitExecutions: readonly MoveMultiHitExecution[]
  /** Authoritative opposed-check/save outcomes, including selected branch IDs. */
  readonly resolvedChecks: readonly MoveCheckResolution[]
  /** Server-determined branch paths in reviewed execution order. */
  readonly branchSelections: readonly MoveBranchSelection[]
  readonly hitTargetIds: readonly string[]
  readonly missedTargetIds: readonly string[]
  readonly damagedTargetIds: readonly string[]
  readonly faintedTargetIds: readonly string[]
  readonly trace: MoveResolutionAuditTrace
}

export interface MoveSpecExecutionCompleteResult extends MoveSpecExecutionResultBase {
  readonly kind: 'complete'
}

export interface MoveSpecDeferredContinuation {
  /** Exact phase and operation where authoritative execution suspended. */
  readonly phase: MoveSpecPhase
  readonly requestOperationId: string
  /** Already evaluated operations whose state effects must wait for continuation. */
  readonly operations: readonly MoveSpecEmittedOperation[]
}

export interface MoveSpecExecutionPendingResult extends MoveSpecExecutionResultBase {
  readonly kind: 'pending-request'
  readonly request: MoveSpecPendingRequest
  /** The only accumulated operations eligible for an atomic pre-window commit. */
  readonly preWindowOperations: readonly MoveSpecEmittedOperation[]
  /** Non-committing accumulated work retained for the eventual resume boundary. */
  readonly deferredContinuation: MoveSpecDeferredContinuation
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
  /** Authorized durable responses, resolved only against reviewed request IDs/options. */
  readonly responses?: readonly MoveSpecResolvedResponse[]
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

const freezeResolvedDamageTypes = (
  resolutions: readonly MoveDamageTypeResolution[],
): readonly MoveDamageTypeResolution[] => Object.freeze([...resolutions])

const freezeResolvedDamageBases = (
  resolutions: readonly MoveContextualDamageBaseResolution[],
): readonly MoveContextualDamageBaseResolution[] => Object.freeze([...resolutions])

const freezeMultiHitExecutions = (
  executions: readonly MoveMultiHitExecution[],
): readonly MoveMultiHitExecution[] => Object.freeze([...executions])

const freezeResolvedChecks = (
  resolutions: readonly MoveCheckResolution[],
): readonly MoveCheckResolution[] => Object.freeze([...resolutions])

const freezeBranchSelections = (
  selections: readonly MoveBranchSelection[],
): readonly MoveBranchSelection[] => Object.freeze([...selections])

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
    return evaluateMoveSelector({
      context,
      selectorState: emptySelectorState(),
      selector: spec.targeting.selector,
    })
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
  const compoundIds = resolveMoveEffectCompoundRecipientIds(context, {
    attackedTargetIds: state.targetIds,
    hitTargetIds: state.hitTargetIds,
  }, kind)
  let ids: readonly string[]
  if (compoundIds !== null) ids = compoundIds
  else switch (kind) {
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
    case 'actor-and-attacked-targets':
    case 'cardinally-adjacent-to-hit-targets':
      return fail(
        'move-mechanics-unavailable',
        `Compound recipient selector ${kind} did not resolve.`,
      )
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
): MoveSpecPendingChoiceRequest | MoveSpecPendingReactionRequest => {
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

const pendingBranchRequest = (
  operation: MoveBranchEffectOperation,
  recipientIds: readonly string[],
): MoveSpecPendingBranchChoiceRequest => {
  if (operation.payload.kind !== 'choice') {
    return fail(
      'definition-integrity-mismatch',
      `Branch ${operation.payload.selectionId} is not a human choice.`,
    )
  }
  return Object.freeze({
    kind: 'branch-choice',
    operationId: operation.id,
    phase: operation.phase,
    reasonCode: operation.reasonCode,
    recipientIds: frozenIds(recipientIds),
    requestId: operation.payload.requestId,
    promptKey: operation.payload.promptKey,
    options: Object.freeze(operation.payload.options.map(option => Object.freeze({
      id: option.id,
      labelKey: option.labelKey,
    }))),
    allowPass: operation.payload.pass !== null,
    selectionId: operation.payload.selectionId,
    scope: operation.payload.scope,
  })
}

const pendingCheckRequest = (
  operation: MoveCheckEffectOperation,
  request: MoveCheckPendingRequest,
): MoveSpecPendingRequest => {
  const common = {
    operationId: operation.id,
    phase: operation.phase,
    reasonCode: operation.reasonCode,
    recipientIds: frozenIds(request.ownerPlacementIds),
    requestId: request.requestId,
    promptKey: request.promptKey,
    options: Object.freeze(request.options.map(option => Object.freeze({ ...option }))),
    allowPass: false,
    checkId: request.checkId,
    role: request.role,
  }
  return request.kind === 'selection'
    ? Object.freeze({ kind: 'check-selection', ...common })
    : Object.freeze({
        kind: 'resource-spend',
        ...common,
        resourceId: request.resourceId,
        amount: request.amount,
        checkRecipientId: request.checkRecipientId,
      })
}

interface MoveSpecAuthoritativeMoveMechanics {
  readonly script: MoveAutomationScript
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
  context.reads.recordPlacement(context.actor.placement)
  return { script: result.entry.script }
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

const resolvedCheckRolls = (
  operation: MoveCheckEffectOperation,
  execution: MoveCheckExecution,
): readonly MoveSpecResolvedRoll[] => execution.rollReferences.map(reference => ({
  operationId: operation.id,
  referenceId: reference.referenceId,
  purpose: 'check',
  recipientId: reference.recipientId,
  checkRole: reference.role,
  attemptIndex: reference.attemptIndex,
  rollId: reference.rollId,
}))

const accuracyReferenceIds = (
  operations: readonly MoveEffectOperation[],
): ReadonlySet<string> => new Set(
  operations.flatMap((operation) => {
    if (operation.kind === 'damage' && operation.payload.accuracyRollId !== null) {
      return [operation.payload.accuracyRollId]
    }
    if (operation.kind === 'direct-hp' && operation.payload.accuracyRollId) {
      return [operation.payload.accuracyRollId]
    }
    return []
  }),
)

const terminalBase = (
  context: AuthoritativeMoveRulesContext,
  operations: readonly MoveSpecEmittedOperation[],
  targetIds: readonly string[],
  trace: MoveResolutionAuditTrace,
  rollLedger: readonly MoveAutomationRollLedgerEntry[],
  resolvedRolls: readonly MoveSpecResolvedRoll[],
  resolvedDamageTypes: readonly MoveDamageTypeResolution[],
  resolvedDamageBases: readonly MoveContextualDamageBaseResolution[],
  multiHitExecutions: readonly MoveMultiHitExecution[],
  resolvedChecks: readonly MoveCheckResolution[],
  branchSelections: readonly MoveBranchSelection[],
  selectorState: MoveSpecSelectorState,
): MoveSpecExecutionResultBase => ({
  operations: freezeEmittedOperations(operations),
  targetIds: frozenIds(targetIds),
  sheetReads: context.reads.snapshot(),
  rollLedger,
  resolvedRolls: freezeResolvedRolls(resolvedRolls),
  resolvedDamageTypes: freezeResolvedDamageTypes(resolvedDamageTypes),
  resolvedDamageBases: freezeResolvedDamageBases(resolvedDamageBases),
  multiHitExecutions: freezeMultiHitExecutions(multiHitExecutions),
  resolvedChecks: freezeResolvedChecks(resolvedChecks),
  branchSelections: freezeBranchSelections(branchSelections),
  hitTargetIds: frozenIds(selectorState.hitTargetIds),
  missedTargetIds: frozenIds(selectorState.missedTargetIds),
  damagedTargetIds: frozenIds(selectorState.damagedTargetIds),
  faintedTargetIds: frozenIds(selectorState.faintedTargetIds),
  trace,
})

interface MoveSpecSuspendedOperationPartition {
  readonly preWindowOperations: readonly MoveSpecEmittedOperation[]
  readonly deferredContinuation: MoveSpecDeferredContinuation
}

const suspendedOperationPartition = (
  operations: readonly MoveSpecEmittedOperation[],
  request: MoveSpecPendingRequest,
): MoveSpecSuspendedOperationPartition => {
  const preWindowOperations: MoveSpecEmittedOperation[] = []
  const deferredOperations: MoveSpecEmittedOperation[] = []
  let foundRequestOperation = false

  for (const emission of operations) {
    const operation = emission.operation
    if (operation.id === request.operationId) {
      foundRequestOperation = true
      continue
    }

    if (operation.kind === 'direct-hp' && operation.payload.cost?.timing === 'declaration') {
      if (operation.phase !== 'pay') {
        fail(
          'pre-window-operation-forbidden',
          `Declaration HP cost ${operation.id} must use the reviewed pay phase before a response window.`,
        )
      }
      preWindowOperations.push(emission)
      continue
    }

    // Execution evidence (including ordinary damage/effects) is durable, but
    // no implicit phase convention makes it safe to commit before the answer.
    deferredOperations.push(emission)
  }

  if (!foundRequestOperation) {
    fail(
      'definition-integrity-mismatch',
      `Pending request ${request.requestId} has no matching operation ${request.operationId}.`,
    )
  }

  return Object.freeze({
    preWindowOperations: freezeEmittedOperations(preWindowOperations),
    deferredContinuation: Object.freeze({
      phase: request.phase,
      requestOperationId: request.operationId,
      operations: freezeEmittedOperations(deferredOperations),
    }),
  })
}

const materializePendingExecutionResult = (
  base: MoveSpecExecutionResultBase,
  request: MoveSpecPendingRequest,
): MoveSpecExecutionPendingResult => {
  const partition = suspendedOperationPartition(base.operations, request)
  return Object.freeze({
    kind: 'pending-request',
    ...base,
    request,
    ...partition,
  })
}

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

const branchControllerIndex = (
  operations: readonly MoveEffectOperation[],
): ReadonlyMap<string, MoveBranchEffectOperation> => {
  const controllers = new Map<string, MoveBranchEffectOperation>()
  for (const operation of operations) {
    if (operation.kind !== 'branch') continue
    for (const branch of moveEffectBranchPaths(operation.payload)) {
      for (const operationId of branch.operationIds) {
        const existing = controllers.get(operationId)
        if (existing && existing.payload.selectionId !== operation.payload.selectionId) {
          fail(
            'definition-integrity-mismatch',
            `Operation ${operationId} has multiple branch controllers.`,
          )
        }
        controllers.set(operationId, operation)
      }
    }
  }
  return controllers
}

interface MoveBranchOperationGate {
  readonly execute: boolean
  readonly recipientIds: readonly string[]
  readonly selectionId: string | null
}

const gateBranchControlledOperation = (options: {
  readonly operationId: string
  readonly resolveRecipientIds: () => readonly string[]
  readonly controller: MoveBranchEffectOperation | undefined
  readonly executions: ReadonlyMap<string, ExecutedMoveBranch>
}): MoveBranchOperationGate => {
  if (!options.controller) {
    return {
      execute: true,
      recipientIds: options.resolveRecipientIds(),
      selectionId: null,
    }
  }
  const selectionId = options.controller.payload.selectionId
  const execution = options.executions.get(selectionId)
    ?? fail(
      'definition-integrity-mismatch',
      `Branch ${selectionId} did not resolve before controlled operation ${options.operationId}.`,
    )
  const selectedDecisions = execution.decisions.filter(decision => (
    decision.operationIds.includes(options.operationId)
  ))
  if (selectedDecisions.length === 0) {
    return { execute: false, recipientIds: [], selectionId }
  }
  const recipientIds = options.resolveRecipientIds()
  if (execution.selection.scope === 'resolution') {
    return {
      execute: true,
      recipientIds,
      selectionId,
    }
  }
  const selectedRecipientIds = new Set(
    selectedDecisions.flatMap(decision => decision.recipientId ? [decision.recipientId] : []),
  )
  return {
    execute: true,
    recipientIds: recipientIds.filter(recipientId => selectedRecipientIds.has(recipientId)),
    selectionId,
  }
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
  const branchControllers = branchControllerIndex(program.operations)
  const responseResolver = createMoveSpecResponseResolver(input.responses)

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
  let damagedTargetIds: readonly string[] = []
  let faintedTargetIds: readonly string[] = []
  const operations: MoveSpecEmittedOperation[] = []
  const resolvedRolls: MoveSpecResolvedRoll[] = []
  const resolvedDamageTypes: MoveDamageTypeResolution[] = []
  const resolvedDamageBases: MoveContextualDamageBaseResolution[] = []
  const multiHitExecutions: MoveMultiHitExecution[] = []
  const resolvedChecks: MoveCheckResolution[] = []
  const branchSelections: MoveBranchSelection[] = []
  const branchExecutions = new Map<string, ExecutedMoveBranch>()
  const currentSelectorState = (): MoveSpecSelectorState => ({
    targetIds,
    hitTargetIds,
    missedTargetIds,
    damagedTargetIds,
    faintedTargetIds,
  })
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
        const evaluation = evaluateMovePredicate({
          predicate: precondition.predicate,
          context: input.context,
          canonicalMoveId: spec.canonicalId,
          rootNodeId: precondition.id,
          selectorState: {
            targetIds,
            hitTargetIds,
            missedTargetIds,
            damagedTargetIds,
            faintedTargetIds,
          },
        })
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'predicate',
          phase,
          predicateId: precondition.id,
          outcome: evaluation.value,
          reasonCode: evaluation.value
            ? 'precondition-passed'
            : precondition.failureReasonCode,
          input: traceJson({
            predicateKind: precondition.predicate.kind,
            evaluationTrace: evaluation.trace,
          }),
        })
        if (!evaluation.value) {
          return Object.freeze({
            kind: 'rejected',
            ...terminalBase(
              input.context,
              operations,
              targetIds,
              trace,
              input.context.random.complete(),
              resolvedRolls,
              resolvedDamageTypes,
              resolvedDamageBases,
              multiHitExecutions,
              resolvedChecks,
              branchSelections,
              currentSelectorState(),
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
            resolvedDamageTypes,
            resolvedDamageBases,
            multiHitExecutions,
            resolvedChecks,
            branchSelections,
            currentSelectorState(),
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
      const branchGate = gateBranchControlledOperation({
        operationId: operation.id,
        resolveRecipientIds: () => effectRecipientIds(
          input.context,
          selectorState,
          operation.recipients.kind,
        ),
        controller: branchControllers.get(operation.id),
        executions: branchExecutions,
      })
      if (!branchGate.execute) {
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds: [],
          outcome: 'prevented',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: traceJson({
            status: 'branch-not-selected',
            selectionId: branchGate.selectionId,
          }),
        })
        continue
      }
      const recipientIds = branchGate.recipientIds
      operations.push(Object.freeze({
        operation,
        recipientIds: frozenIds(recipientIds),
      }))

      if (operation.kind === 'branch') {
        if (operation.payload.kind === 'choice') {
          if (recipientIds.length === 0) {
            const selection = Object.freeze<MoveBranchSelection>({
              operationId: operation.id,
              selectionId: operation.payload.selectionId,
              scope: operation.payload.scope,
              decisions: Object.freeze([]),
            })
            const execution = Object.freeze<ExecutedMoveBranch>({
              selection,
              decisions: Object.freeze([]),
            })
            branchSelections.push(selection)
            branchExecutions.set(operation.payload.selectionId, execution)
            trace = reduceMoveResolutionTrace(trace, {
              kind: 'operation',
              phase,
              operationId: operation.id,
              operationKind: operation.kind,
              recipientIds,
              outcome: 'no-op',
              reasonCode: operation.reasonCode,
              input: traceJson(operation.payload),
              result: traceJson({ selection }),
            })
            continue
          }
          const request = pendingBranchRequest(operation, recipientIds)
          const response = responseResolver.resolve({
            requestId: request.requestId,
            options: request.options,
            allowPass: request.allowPass,
          })
          if (response) {
            const execution = executeResolvedMoveChoiceBranch({
              operation,
              recipientIds,
              optionId: response.optionId,
            })
            branchSelections.push(execution.selection)
            branchExecutions.set(operation.payload.selectionId, execution)
            trace = reduceMoveResolutionTrace(trace, {
              kind: 'operation',
              phase,
              operationId: operation.id,
              operationKind: operation.kind,
              recipientIds,
              outcome: response.optionId === null ? 'no-op' : 'applied',
              reasonCode: operation.reasonCode,
              input: traceJson(operation.payload),
              result: traceJson({ selection: execution.selection }),
            })
            trace = reduceMoveResolutionTrace(trace, {
              kind: 'choice',
              phase,
              requestId: request.requestId,
              requestKind: 'choice',
              outcome: response.optionId === null ? 'passed' : 'selected',
              optionId: response.optionId,
              reasonCode: operation.reasonCode,
            })
            continue
          }
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: operation.id,
            operationKind: operation.kind,
            recipientIds,
            outcome: 'pending',
            reasonCode: operation.reasonCode,
            input: traceJson(operation.payload),
            result: traceJson({
              requestId: request.requestId,
              requestKind: request.kind,
              selectionId: request.selectionId,
              scope: request.scope,
            }),
          })
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'choice',
            phase,
            requestId: request.requestId,
            requestKind: 'choice',
            outcome: 'requested',
            optionId: null,
            reasonCode: operation.reasonCode,
          })
          responseResolver.assertAllConsumed()
          return materializePendingExecutionResult(
            terminalBase(
              input.context,
              operations,
              targetIds,
              trace,
              input.context.random.snapshot(),
              resolvedRolls,
              resolvedDamageTypes,
              resolvedDamageBases,
              multiHitExecutions,
              resolvedChecks,
              branchSelections,
              currentSelectorState(),
            ),
            request,
          )
        }

        const execution = executeServerMoveBranch({
          operation,
          context: input.context,
          recipientIds,
          selectorState,
          canonicalMoveId: spec.canonicalId,
          resolvedChecks,
        })
        branchSelections.push(execution.selection)
        branchExecutions.set(operation.payload.selectionId, execution)
        for (const decision of execution.decisions) {
          if (!decision.predicateEvaluation) continue
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'predicate',
            phase,
            predicateId: operation.payload.selectionId,
            outcome: decision.predicateEvaluation.value,
            reasonCode: decision.reasonCode,
            input: traceJson({
              recipientId: decision.recipientId,
              branchId: decision.branchId,
              evaluationTrace: decision.predicateEvaluation.trace,
            }),
          })
        }
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: execution.selection.decisions.length > 0 ? 'applied' : 'no-op',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: traceJson({ selection: execution.selection }),
        })
        continue
      }

      if (operation.kind === 'check') {
        const execution = executeMoveCheckOperation({
          context: input.context,
          operation,
          recipientIds,
          selectorState,
          canonicalMoveId: spec.canonicalId,
          responseResolver,
        })
        resolvedChecks.push(...execution.resolutions)
        resolvedRolls.push(...resolvedCheckRolls(operation, execution))
        const request = execution.kind === 'pending'
          ? pendingCheckRequest(operation, execution.request)
          : null
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: request ? 'pending' : 'applied',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: traceJson({
            checks: execution.resolutions,
            request: request
              ? {
                  requestId: request.requestId,
                  requestKind: request.kind,
                }
              : null,
          }),
        })
        for (const roll of execution.rollLedgerEntries) {
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'roll',
            phase,
            reasonCode: operation.reasonCode,
            roll,
          })
        }
        for (const response of execution.resolvedResponses) {
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'choice',
            phase,
            requestId: response.requestId,
            requestKind: 'choice',
            outcome: 'selected',
            optionId: response.optionId,
            reasonCode: operation.reasonCode,
          })
        }
        if (!request) continue
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'choice',
          phase,
          requestId: request.requestId,
          requestKind: 'choice',
          outcome: 'requested',
          optionId: null,
          reasonCode: operation.reasonCode,
        })
        responseResolver.assertAllConsumed()
        return materializePendingExecutionResult(
          terminalBase(
            input.context,
            operations,
            targetIds,
            trace,
            input.context.random.snapshot(),
            resolvedRolls,
            resolvedDamageTypes,
            resolvedDamageBases,
            multiHitExecutions,
            resolvedChecks,
            branchSelections,
            currentSelectorState(),
          ),
          request,
        )
      }

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
        const operationDamageTypes: MoveDamageTypeResolution[] = []
        const operationDamageBases: MoveContextualDamageBaseResolution[] = []
        const rollSummaries: Array<{
          readonly rollId: string
          readonly recipientId: string
          readonly naturalResult: number
          readonly finalValue: number
        }> = []
        for (const [index, recipientId] of recipientIds.entries()) {
          targetTokenForRoll(input.context, recipientId)
          const resolvedType = resolveMoveDamageType({
            context: input.context,
            operation,
            script: getMechanics().script,
            recipientId,
            canonicalMoveId: spec.canonicalId,
          })
          operationDamageTypes.push(resolvedType)
          resolvedDamageTypes.push(resolvedType)
          const formula = resolveMoveSpecDamageRollFormula({
            context: input.context,
            operation,
            recipientId,
            canonicalMoveId: spec.canonicalId,
            resolvedType,
            failUnsupported: message => fail('damage-formula-unsupported', message),
          })
          if (formula.contextualDamageBase) {
            operationDamageBases.push(formula.contextualDamageBase)
            resolvedDamageBases.push(formula.contextualDamageBase)
          }
          const rollId = resolvedRollId(operation.id, index + 1, '.roll')
          const result = input.context.random.roll({
            rollId,
            parentEffectId: operation.id,
            formula: {
              kind: 'dice',
              count: formula.count,
              sides: formula.sides,
              modifier: formula.modifier,
            },
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
          result: traceJson({
            status: 'emitted',
            damageTypes: operationDamageTypes,
            contextualDamageBases: operationDamageBases,
            damageRolls: rollSummaries,
          }),
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

      if (operation.kind === 'multi-hit') {
        const execution = executeMoveMultiHitOperation({
          context: input.context,
          operation,
          script: getMechanics().script,
          canonicalMoveId: spec.canonicalId,
          recipientIds,
        })
        multiHitExecutions.push(execution)
        resolvedRolls.push(...execution.resolvedRolls.map(roll => ({ ...roll })))
        hitTargetIds = canonicalPlacementIds(input.context, [
          ...hitTargetIds,
          ...execution.hitTargetIds,
        ])
        missedTargetIds = canonicalPlacementIds(input.context, [
          ...missedTargetIds.filter(id => !execution.hitTargetIds.includes(id)),
          ...execution.missedTargetIds,
        ])
        damagedTargetIds = canonicalPlacementIds(input.context, [
          ...damagedTargetIds,
          ...execution.damagedTargetIds,
        ])
        faintedTargetIds = canonicalPlacementIds(input.context, [
          ...faintedTargetIds,
          ...execution.faintedTargetIds,
        ])
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: execution.outcome,
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: execution.traceResult,
        })
        for (const roll of execution.rollLedgerEntries) {
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
        const response = responseResolver.resolve({
          requestId: request.requestId,
          options: request.options,
          allowPass: request.allowPass,
        })
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: response ? (response.optionId === null ? 'no-op' : 'applied') : 'pending',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: response
            ? { status: response.optionId === null ? 'passed' : 'selected' }
            : {
                requestId: request.requestId,
                requestKind: request.kind,
              },
        })
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'choice',
          phase,
          requestId: request.requestId,
          requestKind: request.kind,
          outcome: response
            ? (response.optionId === null ? 'passed' : 'selected')
            : 'requested',
          optionId: response?.optionId ?? null,
          reasonCode: operation.reasonCode,
        })
        if (response) continue
        responseResolver.assertAllConsumed()
        return materializePendingExecutionResult(
          terminalBase(
            input.context,
            operations,
            targetIds,
            trace,
            input.context.random.snapshot(),
            resolvedRolls,
            resolvedDamageTypes,
            resolvedDamageBases,
            multiHitExecutions,
            resolvedChecks,
            branchSelections,
            currentSelectorState(),
          ),
          request,
        )
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

  responseResolver.assertAllConsumed()
  return Object.freeze({
    kind: 'complete',
    ...terminalBase(
      input.context,
      operations,
      targetIds,
      trace,
      input.context.random.complete(),
      resolvedRolls,
      resolvedDamageTypes,
      resolvedDamageBases,
      multiHitExecutions,
      resolvedChecks,
      branchSelections,
      currentSelectorState(),
    ),
  })
}
