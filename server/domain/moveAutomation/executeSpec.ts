import { createHash } from 'node:crypto'
import {
  MOVE_EFFECT_OPERATION_LIMITS,
  moveEffectBranchPaths,
  type MoveBranchEffectOperation,
  type MoveCheckEffectOperation,
  type MoveChoiceRequestEffectOperation,
  type MoveDamageEffectOperation,
  type MoveEffectOperation,
  type MoveEffectRecipientSelectorKind,
  type MoveHazardEffectOperation,
  type MoveMovementRequestEffectOperation,
  type MoveNestedMoveEffectOperation,
  type MoveNestedMoveRegisteredSpecPayload,
  type MoveReactionRequestEffectOperation,
  type MoveSwitchRequestEffectOperation,
  type MoveEffectSwitchStateTransferPolicy,
  type MoveRollEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationRollLedgerEntry } from '#shared/moveAutomation/random'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import type { PendingMoveResponseOption } from '#shared/moveAutomation/responseOptions'
import {
  MOVE_REACTION_LIMITS,
  moveReactionTimingDefinition,
  type MoveReactionInformationKind,
  type MoveReactionTiming,
} from '#shared/moveAutomation/reactions'
import {
  MOVE_SPEC_LIMITS,
  MOVE_SPEC_PHASES,
  type MoveSpecPhase,
} from '#shared/moveAutomation/spec'
import {
  MOVE_RESOLUTION_TRACE_LIMITS,
  type MoveResolutionAuditTrace,
  type MoveResolutionAuditTraceEventInput,
  type MoveResolutionTraceAncestryEntry,
  type MoveResolutionTraceJsonValue,
} from '#shared/moveAutomation/trace'
import {
  resolveMoveAutomationTargetEvasion,
} from '~/utils/moveAutomationAccuracy'
import {
  resolveMoveAutomationAccuracyRoll,
  type MoveAutomationAccuracyRule,
} from '~/utils/moveAutomationResolution'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { GridAnchor } from '~/types/map'
import type {
  AuthoritativeMoveRulesContext,
  AuthoritativeMoveSheetRead,
} from './context'
import { resolveAuthoritativeMoveUserAccuracy } from './accuracy'
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
  reduceMoveResolutionTrace as appendMoveResolutionTrace,
} from './trace'
import { orderMoveReactionOperationEntries } from './reactionOrder'
import {
  createMoveSpecResponseResolver,
  type MoveSpecResolvedResponse,
  type MoveSpecResponseResolver,
} from './responses'
import {
  enumerateAuthoritativeMovementChoices,
  revalidateAuthoritativeMovementChoice,
  type AuthoritativeMovementChoice,
  type AuthoritativeMovementChoiceSet,
} from '../movement/resolveMovementChoices'
import {
  enumerateAuthoritativeSwitchChoices,
  revalidateAuthoritativeSwitchChoice,
  type AuthoritativeSwitchChoice,
  type AuthoritativeSwitchChoiceSet,
} from './switchChoices'
import {
  enumerateAuthoritativeMoveItemChoices,
  revalidateAuthoritativeMoveItemChoice,
  type AuthoritativeMoveItemChoice,
  type AuthoritativeMoveItemChoiceSet,
} from './itemChoices'
import type { ValidatedAuthoritativeHazardCellSelection } from './hazardCellSelection'
import type { MoveSpecV2Runtime } from './registry'
import {
  MovePoolResolutionError,
  resolveAuthoritativeMovePool,
} from './movePools'
import {
  MoveRandomOperationError,
  resolveMoveRandomTable,
  type MoveRandomCandidateResolution,
} from './randomOperations'
import {
  createNestedMoveExecutionBudget,
  NestedMoveExecutionBudgetError,
  type NestedMoveExecutionBudget,
  type NestedMoveExecutionBudgetErrorCode,
  type NestedMoveExecutionPolicy,
} from './nestedExecution'
import {
  validateMoveSpec,
  validateMoveSpecOperationSequence,
  type ValidatedMoveSpec,
  type ValidatedMoveSpecDefinition,
} from './validateSpec'

export type MoveSpecExecutionErrorCode =
  | 'definition-integrity-mismatch'
  | 'ruleset-mismatch'
  | 'random-selection-rejected'
  | 'recipient-limit-exceeded'
  | 'authoritative-target-invalid'
  | 'move-mechanics-unavailable'
  | 'damage-formula-unsupported'
  | 'resolved-roll-id-too-long'
  | 'pre-window-operation-forbidden'
  | 'reaction-nesting-limit-exceeded'
  | 'nested-resolution-id-missing'
  | 'nested-runtime-unavailable'
  | 'nested-actor-invalid'
  | 'nested-targeting-invalid'
  | 'nested-operation-id-conflict'
  | 'nested-execution-rejected'
  | `nested-${NestedMoveExecutionBudgetErrorCode}`

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
  /** Present only when this operation was emitted by an ancestry-linked child spec. */
  readonly childResolutionId?: string
}

/** Server-only evidence retained for each reviewed child invocation. */
export interface MoveSpecChildExecution {
  readonly resolutionId: string
  readonly parentOperationId: string
  readonly actorPlacementId: string
  readonly canonicalId: string
  readonly definitionHash: string
  readonly operationIds: readonly string[]
  readonly targetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly missedTargetIds: readonly string[]
  readonly damagedTargetIds: readonly string[]
  readonly faintedTargetIds: readonly string[]
  readonly mechanics: MoveAutomationScript
  readonly trace: MoveResolutionAuditTrace
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
  readonly options: readonly PendingMoveResponseOption[]
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
  readonly timing: MoveReactionTiming
  readonly priority: number
  readonly depth: number
  readonly revealedInformation: readonly MoveReactionInformationKind[]
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

export interface MoveSpecPendingMovementRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'movement-choice'
  readonly movementChoiceKind: AuthoritativeMovementChoiceSet['kind']
  readonly destinationSetId: string
}

export interface MoveSpecPendingHazardCellRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'hazard-cell-choice'
  readonly cellSetId: string
  readonly selection: NonNullable<Extract<
    MoveHazardEffectOperation['payload'],
    { readonly action: 'add' }
  >['cellSelection']>
}

export interface MoveSpecPendingSwitchRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'switch-choice'
  readonly replacementSetId: string
}

export interface MoveSpecPendingItemRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'item-choice'
  readonly itemSetId: string
  readonly requirementId: string
}

export interface MoveSpecPendingNestedTargetRequest extends MoveSpecPendingRequestBase {
  readonly kind: 'nested-target-choice'
  readonly childCanonicalId: string
}

export type MoveSpecPendingRequest =
  | MoveSpecPendingChoiceRequest
  | MoveSpecPendingBranchChoiceRequest
  | MoveSpecPendingReactionRequest
  | MoveSpecPendingCheckSelectionRequest
  | MoveSpecPendingResourceSpendRequest
  | MoveSpecPendingMovementRequest
  | MoveSpecPendingHazardCellRequest
  | MoveSpecPendingSwitchRequest
  | MoveSpecPendingItemRequest
  | MoveSpecPendingNestedTargetRequest

export interface MoveSpecResolvedMovement {
  readonly operationId: string
  readonly requestId: string
  readonly optionId: string
  readonly choice: AuthoritativeMovementChoice
}

export interface MoveSpecResolvedSwitch {
  readonly operationId: string
  readonly requestId: string
  readonly optionId: string
  readonly choice: AuthoritativeSwitchChoice
  readonly stateTransferPolicy: MoveEffectSwitchStateTransferPolicy
}

export interface MoveSpecResolvedItemChoice {
  readonly operationId: string
  readonly requestId: string
  readonly optionId: string
  readonly choice: AuthoritativeMoveItemChoice
}

export interface MoveSpecResolvedHazardCells {
  readonly operationId: string
  readonly requestId: string
  readonly cellSetId: string
  readonly selectionId: string
  readonly optionIds: readonly string[]
  readonly cells: readonly GridAnchor[]
}

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
  /** Fresh oracle result for each answered server-issued movement option. */
  readonly resolvedMovements: readonly MoveSpecResolvedMovement[]
  /** Fresh roster/send-out result for each answered server-issued replacement. */
  readonly resolvedSwitches: readonly MoveSpecResolvedSwitch[]
  /** Fresh authoritative item/destination result for each answered item choice. */
  readonly resolvedItemChoices: readonly MoveSpecResolvedItemChoice[]
  /** Freshly revalidated server-issued hazard cells keyed by operation/cell set. */
  readonly resolvedHazardCells: readonly MoveSpecResolvedHazardCells[]
  /** Full server-only child traces and mechanics, flattened in execution order. */
  readonly childExecutions: readonly MoveSpecChildExecution[]
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
  /** Stable server-owned root identity; required when a nested operation is reached. */
  readonly resolutionId?: string
  /** Authorized durable responses, resolved only against reviewed request IDs/options. */
  readonly responses?: readonly MoveSpecResolvedResponse[]
  /** Freshly revalidated multi-cell answers; response commands never populate cells. */
  readonly authoritativeHazardCellSelections?: readonly ValidatedAuthoritativeHazardCellSelection[]
  /** Test/migration seam; production resolves only the audited global registry. */
  readonly handlerRegistry?: RegisteredMoveHandlerRegistry
  /** Server-reviewed child deny policy; never parsed from a command or response. */
  readonly nestedExecutionPolicy?: NestedMoveExecutionPolicy
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

const enforceNestedExecutionBudget = <Result>(operation: () => Result): Result => {
  try {
    return operation()
  }
  catch (error) {
    if (error instanceof NestedMoveExecutionBudgetError) {
      return fail(`nested-${error.code}`, error.message)
    }
    throw error
  }
}

const enforceRandomSelection = <Result>(operation: () => Result): Result => {
  try {
    return operation()
  }
  catch (error) {
    if (error instanceof MoveRandomOperationError || error instanceof MovePoolResolutionError) {
      return fail('random-selection-rejected', error.message)
    }
    if (error instanceof NestedMoveExecutionBudgetError) {
      return fail(`nested-${error.code}`, error.message)
    }
    throw error
  }
}

const frozenIds = (ids: readonly string[]): readonly string[] => Object.freeze([...ids])

const freezeEmittedOperations = (
  operations: readonly MoveSpecEmittedOperation[],
): readonly MoveSpecEmittedOperation[] => Object.freeze(operations.map(emission => Object.freeze({
  operation: emission.operation,
  recipientIds: frozenIds(emission.recipientIds),
  ...(emission.childResolutionId
    ? { childResolutionId: emission.childResolutionId }
    : {}),
})))

const freezeChildExecutions = (
  executions: readonly MoveSpecChildExecution[],
): readonly MoveSpecChildExecution[] => Object.freeze(executions.map(execution => Object.freeze({
  ...execution,
  operationIds: frozenIds(execution.operationIds),
  targetIds: frozenIds(execution.targetIds),
  hitTargetIds: frozenIds(execution.hitTargetIds),
  missedTargetIds: frozenIds(execution.missedTargetIds),
  damagedTargetIds: frozenIds(execution.damagedTargetIds),
  faintedTargetIds: frozenIds(execution.faintedTargetIds),
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

const freezeResolvedMovements = (
  movements: readonly MoveSpecResolvedMovement[],
): readonly MoveSpecResolvedMovement[] => Object.freeze(movements.map(movement => Object.freeze({
  ...movement,
  choice: movement.choice,
})))

const freezeResolvedSwitches = (
  switches: readonly MoveSpecResolvedSwitch[],
): readonly MoveSpecResolvedSwitch[] => Object.freeze(switches.map(switchResult => Object.freeze({
  ...switchResult,
  choice: switchResult.choice,
})))

const freezeResolvedItemChoices = (
  choices: readonly MoveSpecResolvedItemChoice[],
): readonly MoveSpecResolvedItemChoice[] => Object.freeze(choices.map(choice => Object.freeze({
  ...choice,
  choice: choice.choice,
})))

const freezeResolvedHazardCells = (
  selections: readonly MoveSpecResolvedHazardCells[],
): readonly MoveSpecResolvedHazardCells[] => Object.freeze(selections.map(selection => Object.freeze({
  ...selection,
  optionIds: frozenIds(selection.optionIds),
  cells: Object.freeze(selection.cells.map(cell => Object.freeze({ ...cell }))),
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
  ancestryDepth: number,
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
  if (operation.kind === 'choice-request') {
    return Object.freeze({ kind: 'choice', ...common })
  }
  if (ancestryDepth > MOVE_REACTION_LIMITS.nestedWindowDepth) {
    return fail(
      'reaction-nesting-limit-exceeded',
      `Reaction ${operation.payload.requestId} reached nested depth ${ancestryDepth}; at most ${MOVE_REACTION_LIMITS.nestedWindowDepth} is allowed.`,
    )
  }
  const timing = moveReactionTimingDefinition(operation.payload.timing)
  return Object.freeze({
    kind: 'reaction',
    ...common,
    timing: timing.timing,
    priority: operation.payload.priority,
    depth: ancestryDepth,
    revealedInformation: timing.revealedInformation,
  })
}

const movementSheetsForContext = (
  context: AuthoritativeMoveRulesContext,
): { readonly pokemon: ReadonlyMap<string, CharacterSheet>; readonly trainer: ReadonlyMap<string, TrainerSheet> } => {
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  for (const resolved of context.resolvedSheets) {
    if (resolved.kind === 'pokemon') pokemon.set(resolved.slug, resolved.sheet as CharacterSheet)
    else trainer.set(resolved.slug, resolved.sheet as TrainerSheet)
  }
  return { pokemon, trainer }
}

const movementChoiceSet = (
  operation: MoveMovementRequestEffectOperation,
  context: AuthoritativeMoveRulesContext,
): AuthoritativeMovementChoiceSet => {
  const choice = operation.payload.choice
  const destinationSetId = operation.payload.destinationSetId
  const maximumDistance = operation.payload.distance
  if (
    !choice
    || destinationSetId === null
    || typeof maximumDistance !== 'number'
  ) {
    return fail(
      'definition-integrity-mismatch',
      `Movement operation ${operation.id} has no complete durable choice declaration.`,
    )
  }
  let set: AuthoritativeMovementChoiceSet
  try {
    const common = {
      map: context.map,
      sheets: movementSheetsForContext(context),
      placementId: context.actor.placement.id,
      setId: destinationSetId,
      maximumDistance,
    }
    set = choice.kind === 'direction'
      ? enumerateAuthoritativeMovementChoices({
          ...common,
          kind: 'direction',
          directions: choice.directions,
        })
      : enumerateAuthoritativeMovementChoices({
          ...common,
          kind: 'destination',
        })
  }
  catch (error) {
    return fail(
      'move-mechanics-unavailable',
      `Movement choices for ${operation.id} could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  for (const read of set.sheetReads) context.reads.recordSheet(read)
  return set
}

const revalidateMovementChoice = (
  operation: MoveMovementRequestEffectOperation,
  context: AuthoritativeMoveRulesContext,
  set: AuthoritativeMovementChoiceSet,
  optionId: string,
): AuthoritativeMovementChoice => {
  const option = set.choices.find(entry => entry.option.id === optionId)?.option
    ?? fail(
      'definition-integrity-mismatch',
      `Movement option ${optionId} disappeared from ${operation.payload.requestId}.`,
    )
  const choice = operation.payload.choice
    ?? fail('definition-integrity-mismatch', `Movement operation ${operation.id} has no choice.`)
  try {
    return revalidateAuthoritativeMovementChoice({
      map: context.map,
      sheets: movementSheetsForContext(context),
      placementId: context.actor.placement.id,
      setId: set.setId,
      maximumDistance: set.maximumDistance,
      kind: set.kind,
      option,
      ...(choice.kind === 'direction' ? { directions: choice.directions } : {}),
    })
  }
  catch (error) {
    return fail(
      'move-mechanics-unavailable',
      `Movement option ${optionId} failed resume validation: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const pendingMovementRequest = (
  operation: MoveMovementRequestEffectOperation,
  recipientIds: readonly string[],
  set: AuthoritativeMovementChoiceSet,
): MoveSpecPendingMovementRequest => {
  const choice = operation.payload.choice
    ?? fail('definition-integrity-mismatch', `Movement operation ${operation.id} has no choice.`)
  return Object.freeze({
    kind: 'movement-choice',
    movementChoiceKind: set.kind,
    destinationSetId: set.setId,
    operationId: operation.id,
    phase: operation.phase,
    reasonCode: operation.reasonCode,
    recipientIds: frozenIds(recipientIds),
    requestId: operation.payload.requestId,
    promptKey: choice.promptKey,
    options: Object.freeze(set.choices.map(entry => entry.option)),
    allowPass: choice.allowPass,
  })
}

const pendingHazardCellRequest = (
  operation: MoveHazardEffectOperation,
  actorPlacementId: string,
): MoveSpecPendingHazardCellRequest => {
  if (operation.payload.action !== 'add' || !operation.payload.cellSelection) {
    return fail(
      'definition-integrity-mismatch',
      `Hazard operation ${operation.id} has no durable cell-selection declaration.`,
    )
  }
  const selection = operation.payload.cellSelection
  const geometry = operation.payload.geometry
  if (geometry.kind !== 'selection') {
    return fail(
      'definition-integrity-mismatch',
      `Hazard operation ${operation.id} has a durable selection without selection geometry.`,
    )
  }
  const minimum = selection.count.kind === 'exact'
    ? selection.count.count
    : selection.count.minimum
  return Object.freeze({
    kind: 'hazard-cell-choice',
    operationId: operation.id,
    phase: operation.phase,
    reasonCode: operation.reasonCode,
    // The hazard itself has no placement recipients. The actor owns the
    // mechanics-free durable choice used to select its server-issued cells.
    recipientIds: frozenIds([actorPlacementId]),
    requestId: selection.requestId,
    promptKey: selection.promptKey,
    // Stable options depend on the durable resolution ID and continuation map
    // revision, so suspension materialization creates them after execution.
    options: Object.freeze([]),
    allowPass: minimum === 0,
    cellSetId: geometry.cellSetId,
    selection,
  })
}

const switchChoiceSet = (
  operation: MoveSwitchRequestEffectOperation,
  context: AuthoritativeMoveRulesContext,
): AuthoritativeSwitchChoiceSet => {
  try {
    return enumerateAuthoritativeSwitchChoices({
      context,
      recalledPlacementId: context.actor.placement.id,
      setId: operation.payload.replacementSetId,
      positionPolicy: operation.payload.positionPolicy,
      initiativePolicy: operation.payload.initiativePolicy,
    })
  }
  catch (error) {
    return fail(
      'move-mechanics-unavailable',
      `Switch choices for ${operation.id} could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const revalidateSwitchChoice = (
  operation: MoveSwitchRequestEffectOperation,
  context: AuthoritativeMoveRulesContext,
  optionId: string,
): AuthoritativeSwitchChoice => {
  try {
    return revalidateAuthoritativeSwitchChoice({
      context,
      recalledPlacementId: context.actor.placement.id,
      setId: operation.payload.replacementSetId,
      positionPolicy: operation.payload.positionPolicy,
      initiativePolicy: operation.payload.initiativePolicy,
      optionId,
    })
  }
  catch (error) {
    return fail(
      'move-mechanics-unavailable',
      `Switch option ${optionId} failed resume validation: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const pendingSwitchRequest = (
  operation: MoveSwitchRequestEffectOperation,
  recipientIds: readonly string[],
  set: AuthoritativeSwitchChoiceSet,
): MoveSpecPendingSwitchRequest => Object.freeze({
  kind: 'switch-choice',
  replacementSetId: set.setId,
  operationId: operation.id,
  phase: operation.phase,
  reasonCode: operation.reasonCode,
  recipientIds: frozenIds(recipientIds),
  requestId: operation.payload.requestId,
  promptKey: operation.payload.promptKey,
  options: Object.freeze(set.choices.map(choice => choice.option)),
  allowPass: !operation.payload.required,
})

const itemChoiceSet = (
  operation: MoveChoiceRequestEffectOperation,
  context: AuthoritativeMoveRulesContext,
): AuthoritativeMoveItemChoiceSet => {
  const declaration = operation.payload.itemChoice
    ?? fail(
      'definition-integrity-mismatch',
      `Choice operation ${operation.id} has no dynamic item declaration.`,
    )
  try {
    return enumerateAuthoritativeMoveItemChoices({
      declaration,
      items: context.queries.items,
    })
  }
  catch (error) {
    return fail(
      'move-mechanics-unavailable',
      `Item choices for ${operation.id} could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const revalidateItemChoice = (
  operation: MoveChoiceRequestEffectOperation,
  context: AuthoritativeMoveRulesContext,
  optionId: string,
): AuthoritativeMoveItemChoice => {
  const declaration = operation.payload.itemChoice
    ?? fail('definition-integrity-mismatch', `Choice operation ${operation.id} has no item declaration.`)
  try {
    return revalidateAuthoritativeMoveItemChoice({
      declaration,
      items: context.queries.items,
      optionId,
    })
  }
  catch (error) {
    return fail(
      'move-mechanics-unavailable',
      `Item option ${optionId} failed resume validation: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const pendingItemRequest = (
  operation: MoveChoiceRequestEffectOperation,
  recipientIds: readonly string[],
  set: AuthoritativeMoveItemChoiceSet,
): MoveSpecPendingItemRequest => Object.freeze({
  kind: 'item-choice',
  itemSetId: set.setId,
  requirementId: set.requirementId,
  operationId: operation.id,
  phase: operation.phase,
  reasonCode: operation.reasonCode,
  recipientIds: frozenIds(recipientIds),
  requestId: operation.payload.requestId,
  promptKey: operation.payload.promptKey,
  options: Object.freeze(set.choices.map(choice => choice.option)),
  allowPass: operation.payload.allowPass,
})

const pendingBranchRequest = (
  operation: MoveBranchEffectOperation,
  recipientIds: readonly string[],
  actorPlacementId: string,
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
    recipientIds: frozenIds(
      operation.payload.owner === 'actor' ? [actorPlacementId] : recipientIds,
    ),
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

const optionalAuthoritativeMoveMechanics = (
  context: AuthoritativeMoveRulesContext,
  canonicalId: string,
  source: 'actor-move' | 'registered-spec',
): MoveSpecAuthoritativeMoveMechanics | null => {
  if (source === 'registered-spec') {
    const script = context.queries.rules.reviewedScriptFor(canonicalId)
    if (!script) return null
    context.reads.recordPlacement(context.actor.placement)
    return { script }
  }

  const result = context.queries.resolveActorMoveEntry(canonicalId)
  if (!result.ok || result.entry.canonicalMoveName !== canonicalId) return null
  context.reads.recordPlacement(context.actor.placement)
  return { script: result.entry.script }
}

const authoritativeMoveMechanics = (
  context: AuthoritativeMoveRulesContext,
  canonicalId: string,
  source: 'actor-move' | 'registered-spec',
): MoveSpecAuthoritativeMoveMechanics => optionalAuthoritativeMoveMechanics(
  context,
  canonicalId,
  source,
) ?? fail(
  'move-mechanics-unavailable',
  source === 'registered-spec'
    ? `Reviewed child mechanics for ${canonicalId} are not available from the server registry.`
    : `Authoritative move mechanics for ${canonicalId} are not available to the actor.`,
)

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
  resolvedMovements: readonly MoveSpecResolvedMovement[],
  resolvedSwitches: readonly MoveSpecResolvedSwitch[],
  resolvedItemChoices: readonly MoveSpecResolvedItemChoice[],
  resolvedHazardCells: readonly MoveSpecResolvedHazardCells[],
  childExecutions: readonly MoveSpecChildExecution[],
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
  resolvedMovements: freezeResolvedMovements(resolvedMovements),
  resolvedSwitches: freezeResolvedSwitches(resolvedSwitches),
  resolvedItemChoices: freezeResolvedItemChoices(resolvedItemChoices),
  resolvedHazardCells: freezeResolvedHazardCells(resolvedHazardCells),
  childExecutions: freezeChildExecutions(childExecutions),
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
    const entries = orderMoveReactionOperationEntries([
      ...staticEntries.filter(entry => entry.operation.phase === phase),
      ...handlerEntries.filter(entry => entry.operation.phase === phase),
    ])
    if (entries.length > 0) entriesByPhase.set(phase, [...entries])
  }
  const orderedEntries = MOVE_SPEC_PHASES.flatMap(phase => entriesByPhase.get(phase) ?? [])
  validateMoveSpecOperationSequence(orderedEntries, 'moveSpecExecution.operations')
  const operations = Object.freeze(orderedEntries.map(({ operation }) => operation))

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

type MoveRandomTableOperation = MoveRollEffectOperation & {
  readonly payload: Extract<MoveRollEffectOperation['payload'], {
    readonly formula: { readonly kind: 'table' }
  }>
}

type ExecutedMoveRandomTable = MoveRandomCandidateResolution<
  MoveRandomTableOperation['payload']['table']['entries'][number]
>

const randomTableControllerIndex = (
  operations: readonly MoveEffectOperation[],
): ReadonlyMap<string, MoveRandomTableOperation> => {
  const controllers = new Map<string, MoveRandomTableOperation>()
  for (const operation of operations) {
    if (operation.kind !== 'roll' || operation.payload.formula.kind !== 'table') continue
    const tableOperation = operation as MoveRandomTableOperation
    for (const entry of tableOperation.payload.table.entries) {
      for (const operationId of entry.operationIds) {
        const existing = controllers.get(operationId)
        if (existing && existing.id !== operation.id) {
          fail(
            'definition-integrity-mismatch',
            `Operation ${operationId} has multiple random-table controllers.`,
          )
        }
        controllers.set(operationId, tableOperation)
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

interface MoveRandomTableOperationGate {
  readonly execute: boolean
  readonly tableId: string | null
  readonly selectedId: string | null
}

const gateRandomTableControlledOperation = (options: {
  readonly operationId: string
  readonly controller: MoveRandomTableOperation | undefined
  readonly executions: ReadonlyMap<string, ExecutedMoveRandomTable>
}): MoveRandomTableOperationGate => {
  if (!options.controller) return { execute: true, tableId: null, selectedId: null }
  const execution = options.executions.get(options.controller.id)
    ?? fail(
      'definition-integrity-mismatch',
      `Random table ${options.controller.payload.table.tableId} did not resolve before controlled operation ${options.operationId}.`,
    )
  return {
    execute: execution.selected.operationIds.includes(options.operationId),
    tableId: options.controller.payload.table.tableId,
    selectedId: execution.selectedId,
  }
}

interface MoveSpecExecutionState {
  readonly responseResolver: MoveSpecResponseResolver
  readonly resolutionId: string | null
  readonly mechanicsSource: 'actor-move' | 'registered-spec'
  readonly sealRandomLedger: boolean
  readonly assertResponsesAtCompletion: boolean
  readonly nestedBudget: NestedMoveExecutionBudget
  readonly nestedDepth: number
  readonly root: boolean
}

interface NestedMoveTargetOption {
  readonly option: PendingMoveResponseOption
  readonly targetPlacementId: string
}

const nestedChildResolutionId = (input: {
  readonly parentResolutionId: string
  readonly operationId: string
  readonly canonicalId: string
  readonly actorPlacementId: string
}): string => `resolution-nested-${createHash('sha256')
  .update([
    input.parentResolutionId,
    input.operationId,
    input.canonicalId,
    input.actorPlacementId,
  ].join('\u0000'))
  .digest('hex')}`

const nestedTargetOptionId = (
  requestId: string,
  placementId: string,
): string => `nested-target.${createHash('sha256')
  .update(`${requestId}\u0000${placementId}`)
  .digest('hex')}`

const nestedTargetLabelKey = (index: number): string => (
  `move.nested-target-option-${index + 1}`
)

type ResolvedNestedMoveOperation = Omit<MoveNestedMoveEffectOperation, 'payload'> & {
  readonly payload: MoveNestedMoveRegisteredSpecPayload
}

interface ResolvedNestedMoveInvocation {
  readonly operation: ResolvedNestedMoveOperation
  readonly randomSelection: {
    readonly candidateCount: number
    readonly selectedId: string
    readonly attemptCount: number
    readonly rollIds: readonly string[]
  } | null
  readonly rollLedgerEntries: readonly MoveAutomationRollLedgerEntry[]
}

const nestedRuntimeFor = (
  context: AuthoritativeMoveRulesContext,
  operation: ResolvedNestedMoveOperation,
): MoveSpecV2Runtime => {
  const runtime = context.queries.rules.runtimeFor(operation.payload.canonicalId)
  if (
    !runtime
    || runtime.kind !== 'movespec-v2'
    || runtime.definition.spec.canonicalId !== operation.payload.canonicalId
  ) {
    return fail(
      'nested-runtime-unavailable',
      `Nested operation ${operation.id} can invoke only the server-selected reviewed spec ${operation.payload.canonicalId}.`,
    )
  }
  return runtime
}

const resolveNestedMoveInvocation = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveNestedMoveEffectOperation
  readonly recipientIds: readonly string[]
  readonly budget: NestedMoveExecutionBudget
}): ResolvedNestedMoveInvocation => {
  const payload = input.operation.payload
  const source = payload.source
  if (source.kind === 'registered-spec') {
    return Object.freeze({
      operation: input.operation as ResolvedNestedMoveOperation,
      randomSelection: null,
      rollLedgerEntries: Object.freeze([]),
    })
  }

  const ledgerStart = input.context.random.snapshot().length
  const selection = enforceRandomSelection(() => resolveAuthoritativeMovePool({
    definition: source.pool,
    context: input.context,
    recipientIds: input.recipientIds,
    parentEffectId: input.operation.id,
    reasonCode: input.operation.reasonCode,
    budget: input.budget,
    isCandidateValid: (canonicalId) => {
      const runtime = input.context.queries.rules.runtimeFor(canonicalId)
      if (!runtime || runtime.kind !== 'movespec-v2') return false
      const snapshot = input.budget.snapshot()
      return !snapshot.visitedCanonicalIds.includes(canonicalId)
        && !snapshot.bannedCanonicalIds.includes(canonicalId)
    },
  }))
  const operation: ResolvedNestedMoveOperation = Object.freeze({
    ...input.operation,
    payload: Object.freeze({
      canonicalId: selection.selectedId,
      actor: payload.actor,
      source: Object.freeze({ kind: 'registered-spec' as const }),
      targeting: payload.targeting,
    }),
  })
  return Object.freeze({
    operation,
    randomSelection: Object.freeze({
      candidateCount: selection.candidateCount,
      selectedId: selection.selectedId,
      attemptCount: selection.attemptCount,
      rollIds: frozenIds(selection.rollIds),
    }),
    rollLedgerEntries: Object.freeze(input.context.random.snapshot().slice(ledgerStart)),
  })
}

const nestedActorPlacementId = (
  context: AuthoritativeMoveRulesContext,
  operation: ResolvedNestedMoveOperation,
  recipientIds: readonly string[],
): string => {
  if (operation.payload.actor.kind === 'parent-actor') {
    return context.actor.placement.id
  }
  if (recipientIds.length !== 1) {
    return fail(
      'nested-actor-invalid',
      `Nested operation ${operation.id} requires exactly one recipient to own the child actor.`,
    )
  }
  return recipientIds[0]!
}

const nestedIntentSelection = (
  targetIds: readonly string[],
): ResolveMoveIntent['selection'] => targetIds.length === 0
  ? { kind: 'self' }
  : targetIds.length === 1
    ? { kind: 'single-target', targetPlacementId: targetIds[0]! }
    : { kind: 'target-count', targetPlacementIds: [...targetIds] }

export const deriveNestedMoveRulesContext = (input: {
  readonly parent: AuthoritativeMoveRulesContext
  readonly actorPlacementId: string
  readonly canonicalId: string
  readonly targetIds: readonly string[]
  readonly resolutionId: string
  readonly ancestry: readonly MoveResolutionTraceAncestryEntry[]
}): AuthoritativeMoveRulesContext => {
  const placement = input.parent.queries.placements.get(input.actorPlacementId)
  const token = input.parent.queries.tokens.get(input.actorPlacementId)
  const sheet = placement ? input.parent.queries.sheets.forPlacement(placement) : null
  if (!placement || !token || !sheet) {
    return fail(
      'nested-actor-invalid',
      `Nested child actor ${input.actorPlacementId} is not a fully resolved authoritative placement.`,
    )
  }
  const selectedPlacements = input.targetIds.map(targetId => (
    input.parent.queries.placements.get(targetId)
    ?? fail('nested-targeting-invalid', `Nested child target ${targetId} is not authoritative.`)
  ))
  const candidatePlacements = input.parent.queries.placements.all()
  input.parent.reads.recordPlacement(placement)
  const placements = Object.freeze({
    ...input.parent.queries.placements,
    candidates: () => candidatePlacements,
    selected: () => Object.freeze([...selectedPlacements]),
  })
  const queries = Object.freeze({
    ...input.parent.queries,
    placements,
  })
  return Object.freeze({
    ...input.parent,
    intent: Object.freeze({
      schemaVersion: 1 as const,
      placementId: placement.id,
      moveName: input.canonicalId,
      selection: nestedIntentSelection(input.targetIds),
    }),
    resolutionId: input.resolutionId,
    actor: Object.freeze({ placement, token, sheet }),
    candidatePlacements,
    selectedPlacements: Object.freeze([...selectedPlacements]),
    ancestry: Object.freeze(input.ancestry.map(entry => Object.freeze({ ...entry }))),
    queries,
  })
}

const nestedTargetOptions = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: ResolvedNestedMoveOperation
  readonly runtime: MoveSpecV2Runtime
  readonly selectorState: MoveSpecSelectorState
  readonly budget: NestedMoveExecutionBudget
}): readonly NestedMoveTargetOption[] => {
  const targeting = input.operation.payload.targeting
  if (targeting.kind !== 'fresh-choice') return Object.freeze([])
  const childTargeting = input.runtime.definition.spec.targeting
  if (
    childTargeting.kind === 'none'
    || childTargeting.kind === 'self'
    || childTargeting.kind === 'area'
    || childTargeting.kind === 'field'
    || childTargeting.kind === 'hazard'
    || childTargeting.minTargets !== 1
    || childTargeting.maxTargets !== 1
  ) {
    return fail(
      'nested-targeting-invalid',
      `Nested fresh target ${input.operation.id} requires a reviewed child with exactly one non-area target.`,
    )
  }
  const ids = evaluateMoveSelector({
    context: input.context,
    selectorState: input.selectorState,
    selector: targeting.selector,
  })
  enforceNestedExecutionBudget(() => input.budget.reserveTargets(
    ids.length,
    `Nested fresh-target request ${targeting.requestId}`,
  ))
  if (ids.length === 0) {
    return fail(
      'nested-targeting-invalid',
      `Nested fresh target ${input.operation.id} has no legal server-derived option.`,
    )
  }
  const options = ids.map((targetPlacementId, index): NestedMoveTargetOption => Object.freeze({
    targetPlacementId,
    option: Object.freeze({
      id: nestedTargetOptionId(targeting.requestId, targetPlacementId),
      // Dynamic target identity stays server-only until a dedicated authorized
      // targeting view projects it; generic option labels reveal no placement.
      labelKey: nestedTargetLabelKey(index),
    }),
  }))
  if (new Set(options.map(({ option }) => option.id)).size !== options.length) {
    return fail(
      'nested-targeting-invalid',
      `Nested target options for ${input.operation.id} produced an identity collision.`,
    )
  }
  return Object.freeze(options)
}

const nestedTargetRequest = (input: {
  readonly operation: ResolvedNestedMoveOperation
  readonly actorPlacementId: string
  readonly options: readonly NestedMoveTargetOption[]
}): MoveSpecPendingNestedTargetRequest => {
  const targeting = input.operation.payload.targeting
  if (targeting.kind !== 'fresh-choice') {
    return fail('nested-targeting-invalid', `Nested operation ${input.operation.id} has no fresh target request.`)
  }
  return Object.freeze({
    kind: 'nested-target-choice',
    childCanonicalId: input.operation.payload.canonicalId,
    operationId: input.operation.id,
    phase: input.operation.phase,
    reasonCode: input.operation.reasonCode,
    recipientIds: frozenIds([input.actorPlacementId]),
    requestId: targeting.requestId,
    promptKey: targeting.promptKey,
    options: Object.freeze(input.options.map(({ option }) => option)),
    allowPass: false,
  })
}

const projectNestedEmission = (input: {
  readonly emission: MoveSpecEmittedOperation
  readonly invocationPhase: MoveSpecPhase
  readonly childResolutionId: string
}): MoveSpecEmittedOperation => Object.freeze({
  operation: Object.freeze({
    ...input.emission.operation,
    phase: input.invocationPhase,
  }) as MoveEffectOperation,
  recipientIds: frozenIds(input.emission.recipientIds),
  childResolutionId: input.emission.childResolutionId ?? input.childResolutionId,
})

const projectNestedRequest = (
  request: MoveSpecPendingRequest,
  invocationPhase: MoveSpecPhase,
): MoveSpecPendingRequest => {
  if (
    request.kind === 'reaction'
    && moveReactionTimingDefinition(request.timing).phase !== invocationPhase
  ) {
    return fail(
      'nested-targeting-invalid',
      `Nested reaction ${request.requestId} must be invoked from its reviewed ${moveReactionTimingDefinition(request.timing).phase} phase.`,
    )
  }
  return Object.freeze({ ...request, phase: invocationPhase })
}

const appendNestedTrace = (
  parent: MoveResolutionAuditTrace,
  child: MoveResolutionAuditTrace,
  invocationPhase: MoveSpecPhase,
  budget: NestedMoveExecutionBudget,
): MoveResolutionAuditTrace => {
  let trace = parent
  for (const event of child.events) {
    if (event.kind === 'phase-transition') continue
    const { sequence: _sequence, ...withoutSequence } = event
    if (event.kind === 'target') {
      enforceNestedExecutionBudget(() => budget.reserveEmittedEvents(
        1,
        `Nested trace projection for ${child.program.canonicalId}`,
      ))
      trace = appendMoveResolutionTrace(trace, {
        ...withoutSequence,
        phase: invocationPhase,
        reasonCode: 'nested-child-target',
      })
      continue
    }
    enforceNestedExecutionBudget(() => budget.reserveEmittedEvents(
      1,
      `Nested trace projection for ${child.program.canonicalId}`,
    ))
    trace = appendMoveResolutionTrace(trace, {
      ...withoutSequence,
      phase: invocationPhase,
    })
  }
  return trace
}

const childAncestry = (input: {
  readonly parentAncestry: readonly MoveResolutionTraceAncestryEntry[]
  readonly parentResolutionId: string
  readonly parentCanonicalId: string
  readonly parentDefinitionHash: string
  readonly parentOperationId: string
}): readonly MoveResolutionTraceAncestryEntry[] => Object.freeze([
  ...input.parentAncestry,
  Object.freeze({
    depth: input.parentAncestry.length,
    resolutionId: input.parentResolutionId,
    canonicalId: input.parentCanonicalId,
    definitionHash: input.parentDefinitionHash,
    parentOperationId: input.parentOperationId,
  }),
])

const terminalRollLedger = (
  context: AuthoritativeMoveRulesContext,
  seal: boolean,
): readonly MoveAutomationRollLedgerEntry[] => seal
  ? context.random.complete()
  : context.random.snapshot()

/**
 * Execute one reviewed MoveSpec against an immutable authoritative snapshot.
 * This layer emits typed operations only; repositories and state reducers are
 * intentionally outside the interpreter boundary.
 */
const executeMoveSpecInternal = (
  input: ExecuteMoveSpecInput,
  executionState: MoveSpecExecutionState,
): MoveSpecExecutionResult => {
  const handlerRegistry = input.handlerRegistry ?? REGISTERED_MOVE_HANDLER_REGISTRY
  const definition = executableDefinition(input, handlerRegistry)
  const { spec } = definition
  enforceNestedExecutionBudget(() => executionState.nestedBudget.enterSpec(
    spec.canonicalId,
    executionState.nestedDepth,
    executionState.root,
  ))
  const program = executableProgram(definition, input.context, handlerRegistry)
  enforceNestedExecutionBudget(() => executionState.nestedBudget.reserveOperations(
    program.operations.length,
    `MoveSpec ${spec.canonicalId}`,
  ))
  const reduceMoveResolutionTrace = (
    current: MoveResolutionAuditTrace,
    event: MoveResolutionAuditTraceEventInput,
  ): MoveResolutionAuditTrace => {
    enforceNestedExecutionBudget(() => executionState.nestedBudget.reserveEmittedEvents(
      1,
      `MoveSpec ${spec.canonicalId}`,
    ))
    return appendMoveResolutionTrace(current, event)
  }
  const branchControllers = branchControllerIndex(program.operations)
  const randomTableControllers = randomTableControllerIndex(program.operations)
  const responseResolver = executionState.responseResolver
  const hazardSelections = new Map<string, ValidatedAuthoritativeHazardCellSelection>()
  for (const selection of input.authoritativeHazardCellSelections ?? []) {
    if (hazardSelections.has(selection.operationId)) {
      fail(
        'definition-integrity-mismatch',
        `Hazard operation ${selection.operationId} received more than one authoritative cell selection.`,
      )
    }
    hazardSelections.set(selection.operationId, selection)
  }
  const consumedHazardSelections = new Set<string>()

  const activePhases = new Set<MoveSpecPhase>(program.operationsByPhase.keys())
  for (const phase of program.handlerTraceEntriesByPhase.keys()) activePhases.add(phase)
  for (const declaration of spec.costs) activePhases.add(declaration.phase)
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
  const resolvedMovements: MoveSpecResolvedMovement[] = []
  const resolvedSwitches: MoveSpecResolvedSwitch[] = []
  const resolvedItemChoices: MoveSpecResolvedItemChoice[] = []
  const resolvedHazardCells: MoveSpecResolvedHazardCells[] = []
  const childExecutions: MoveSpecChildExecution[] = []
  const branchExecutions = new Map<string, ExecutedMoveBranch>()
  const randomTableExecutions = new Map<string, ExecutedMoveRandomTable>()
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
    mechanics ??= authoritativeMoveMechanics(
      input.context,
      spec.canonicalId,
      executionState.mechanicsSource,
    )
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
              terminalRollLedger(input.context, executionState.sealRandomLedger),
              resolvedRolls,
              resolvedDamageTypes,
              resolvedDamageBases,
              multiHitExecutions,
              resolvedChecks,
              branchSelections,
              resolvedMovements,
              resolvedSwitches,
              resolvedItemChoices,
              resolvedHazardCells,
              childExecutions,
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
      enforceNestedExecutionBudget(() => executionState.nestedBudget.reserveTargets(
        resolvedTargetIds.length,
        `MoveSpec ${spec.canonicalId}`,
      ))
      targetIds = resolvedTargetIds.length <= MOVE_SPEC_LIMITS.targetCount
        ? resolvedTargetIds
        : []
      for (const targetPlacementId of targetIds) {
        if (targetPlacementId === input.context.actor.placement.id) continue
        const sight = input.context.queries.lineOfSight.resolve(
          input.context.actor.placement.id,
          targetPlacementId,
        )
        if (!sight.targetable) {
          fail(
            'authoritative-target-invalid',
            `Target ${targetPlacementId} is blocked by authoritative line of sight (${sight.reasonCode}).`,
          )
        }
      }
      const targetMechanics = optionalAuthoritativeMoveMechanics(
        input.context,
        spec.canonicalId,
        executionState.mechanicsSource,
      )
      hitTargetIds = spec.targeting.kind !== 'self'
        && spec.targeting.kind !== 'none'
        && targetMechanics?.script.requiresAccuracy === false
        ? targetIds
        : []
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
            terminalRollLedger(input.context, executionState.sealRandomLedger),
            resolvedRolls,
            resolvedDamageTypes,
            resolvedDamageBases,
            multiHitExecutions,
            resolvedChecks,
            branchSelections,
            resolvedMovements,
            resolvedSwitches,
            resolvedItemChoices,
            resolvedHazardCells,
            childExecutions,
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
      const randomTableGate = gateRandomTableControlledOperation({
        operationId: operation.id,
        controller: randomTableControllers.get(operation.id),
        executions: randomTableExecutions,
      })
      if (!randomTableGate.execute) {
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
            status: 'random-entry-not-selected',
            tableId: randomTableGate.tableId,
            selectedId: randomTableGate.selectedId,
          }),
        })
        continue
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
        // A branch may itself be controlled by an earlier reviewed branch.
        // Materialize an empty execution when its parent path is not selected
        // so descendants remain deterministically gated instead of observing
        // a missing controller.
        if (operation.kind === 'branch') {
          branchExecutions.set(operation.payload.selectionId, Object.freeze({
            selection: Object.freeze({
              operationId: operation.id,
              selectionId: operation.payload.selectionId,
              scope: operation.payload.scope,
              decisions: Object.freeze([]),
            }),
            decisions: Object.freeze([]),
          }))
        }
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
          const request = pendingBranchRequest(
            operation,
            recipientIds,
            input.context.actor.placement.id,
          )
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
              resolvedMovements,
              resolvedSwitches,
              resolvedItemChoices,
              resolvedHazardCells,
              childExecutions,
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
            resolvedMovements,
            resolvedSwitches,
            resolvedItemChoices,
            resolvedHazardCells,
            childExecutions,
            currentSelectorState(),
          ),
          request,
        )
      }

      if (operation.kind === 'roll') {
        if (operation.payload.formula.kind === 'table') {
          const tableOperation = operation as MoveRandomTableOperation
          const selection = enforceRandomSelection(() => resolveMoveRandomTable({
            definition: tableOperation.payload.table,
            rollId: tableOperation.payload.rollId,
            parentEffectId: tableOperation.id,
            reasonCode: tableOperation.reasonCode,
            random: input.context.random,
            isEntryValid: entry => entry.predicate === null || evaluateMovePredicate({
              predicate: entry.predicate,
              context: input.context,
              canonicalMoveId: spec.canonicalId,
              rootNodeId: `${tableOperation.id}.${entry.id}`,
              selectorState,
            }).value,
            reserveRetry: () => executionState.nestedBudget.reserveRandomRetries(
              1,
              `Random operation table ${tableOperation.payload.table.tableId}`,
            ),
          }))
          randomTableExecutions.set(tableOperation.id, selection)
          for (const rollId of selection.rollIds) {
            resolvedRolls.push({
              operationId: tableOperation.id,
              referenceId: tableOperation.payload.rollId,
              purpose: 'generic',
              recipientId: null,
              rollId,
            })
          }
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: tableOperation.id,
            operationKind: tableOperation.kind,
            recipientIds,
            outcome: 'applied',
            reasonCode: tableOperation.reasonCode,
            input: traceJson(tableOperation.payload),
            result: traceJson({
              candidateCount: selection.candidateCount,
              selectedId: selection.selectedId,
              attemptCount: selection.attemptCount,
            }),
          })
          for (const rollId of selection.rollIds) {
            const roll = input.context.random.snapshot().find(entry => entry.rollId === rollId)
              ?? fail('definition-integrity-mismatch', `Random-table roll ${rollId} is missing from the ledger.`)
            trace = reduceMoveResolutionTrace(trace, {
              kind: 'roll',
              phase,
              reasonCode: tableOperation.reasonCode,
              roll,
            })
          }
          continue
        }
        const purpose = referencedAccuracyRollIds.has(operation.payload.rollId)
          ? 'accuracy' as const
          : 'generic' as const
        const weatherAccuracy = purpose === 'accuracy'
          ? input.context.queries.weather.accuracy({
              canonicalMoveId: getMechanics().script.moveName,
            })
          : null
        const subjects: readonly (string | null)[] = operation.recipients.kind === 'none'
          ? [null]
          : recipientIds
        const rollSummaries: Array<{
          readonly rollId: string
          readonly recipientId: string | null
          readonly naturalResult: number
          readonly finalValue: number
          readonly accuracyRule: MoveAutomationAccuracyRule | null
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
            const userAccuracy = resolveAuthoritativeMoveUserAccuracy(input.context, {
              targetPlacementId: recipientId,
            })
            targetEvasion = resolveMoveAutomationTargetEvasion(
              move.script,
              target,
              {
                attacker: input.context.actor.token,
                fieldEffects: input.context.queries.rooms.projectFieldEffects(),
              },
            ).value
            modifiers = userAccuracy.modifiers
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
          let resolvedAccuracyRule: MoveAutomationAccuracyRule | null = null
          if (purpose === 'accuracy' && recipientId !== null && target) {
            const accuracy = resolveMoveAutomationAccuracyRoll(
              getMechanics().script,
              result.naturalResult,
              {
                userAccuracy: modifiers.reduce((total, modifier) => total + modifier.value, 0),
                targetEvasion,
                accuracyRule: weatherAccuracy?.rule,
              },
            )
            resolvedAccuracyRule = accuracy.accuracyRule ?? null
            if (accuracy.hit) {
              hitSet.add(recipientId)
              missedSet.delete(recipientId)
            }
            else {
              missedSet.add(recipientId)
              hitSet.delete(recipientId)
            }
          }
          rollSummaries.push({
            rollId,
            recipientId,
            naturalResult: result.naturalResult,
            finalValue: result.finalValue,
            accuracyRule: resolvedAccuracyRule,
          })
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
        const projectedDamagedTargetIds = new Set(damagedTargetIds)
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
          // PTU damage that reaches a non-immune hit recipient has a minimum
          // effective loss. Project that server-owned fact so reviewed
          // after-damage branches can suspend before reducers commit state.
          if (resolvedType.finalMultiplier > 0) projectedDamagedTargetIds.add(recipientId)
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
        damagedTargetIds = canonicalPlacementIds(
          input.context,
          projectedDamagedTargetIds,
        )
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

      if (
        operation.kind === 'hazard'
        && operation.payload.action === 'add'
        && operation.payload.cellSelection
      ) {
        const request = pendingHazardCellRequest(
          operation,
          input.context.actor.placement.id,
        )
        const selected = hazardSelections.get(operation.id) ?? null
        if (selected) {
          if (
            selected.windowId !== request.requestId
            || selected.operationId !== operation.id
            || selected.cellSetId !== request.cellSetId
          ) {
            return fail(
              'definition-integrity-mismatch',
              `Hazard selection for ${operation.id} does not match its reviewed request and cell-set identity.`,
            )
          }
          consumedHazardSelections.add(operation.id)
          resolvedHazardCells.push(Object.freeze({
            operationId: operation.id,
            requestId: request.requestId,
            cellSetId: request.cellSetId,
            selectionId: selected.selectionId,
            optionIds: frozenIds(selected.optionIds),
            cells: Object.freeze(selected.cells.map(cell => Object.freeze({ ...cell }))),
          }))
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
              status: 'selected',
              cellSetId: request.cellSetId,
              selectionId: selected.selectionId,
              optionIds: selected.optionIds,
              cells: selected.cells,
            }),
          })
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'choice',
            phase,
            requestId: request.requestId,
            requestKind: 'choice',
            outcome: 'selected',
            optionId: selected.selectionId,
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
            cellSetId: request.cellSetId,
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
            resolvedMovements,
            resolvedSwitches,
            resolvedItemChoices,
            resolvedHazardCells,
            childExecutions,
            currentSelectorState(),
          ),
          request,
        )
      }

      if (operation.kind === 'movement-request' && operation.payload.choice) {
        const set = movementChoiceSet(operation, input.context)
        const request = pendingMovementRequest(operation, recipientIds, set)
        if (request.options.length === 0) {
          if (!request.allowPass) {
            return fail(
              'move-mechanics-unavailable',
              `Movement request ${request.requestId} has no legal authoritative option and cannot pass.`,
            )
          }
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: operation.id,
            operationKind: operation.kind,
            recipientIds,
            outcome: 'no-op',
            reasonCode: operation.reasonCode,
            input: traceJson(operation.payload),
            result: { status: 'no-legal-options' },
          })
          continue
        }
        const response = responseResolver.resolve({
          requestId: request.requestId,
          options: request.options,
          allowPass: request.allowPass,
        })
        const selectedChoice = response?.optionId === null || !response
          ? null
          : revalidateMovementChoice(operation, input.context, set, response.optionId)
        if (selectedChoice && response?.optionId) {
          resolvedMovements.push(Object.freeze({
            operationId: operation.id,
            requestId: request.requestId,
            optionId: response.optionId,
            choice: selectedChoice,
          }))
        }
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: response ? (selectedChoice ? 'applied' : 'no-op') : 'pending',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: traceJson(response
            ? {
                status: selectedChoice ? 'selected' : 'passed',
                ...(selectedChoice ? { selection: selectedChoice.option.selection } : {}),
              }
            : {
                requestId: request.requestId,
                requestKind: request.kind,
                optionCount: request.options.length,
              }),
        })
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'choice',
          phase,
          requestId: request.requestId,
          requestKind: 'choice',
          outcome: response
            ? (selectedChoice ? 'selected' : 'passed')
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
            resolvedMovements,
            resolvedSwitches,
            resolvedItemChoices,
            resolvedHazardCells,
            childExecutions,
            currentSelectorState(),
          ),
          request,
        )
      }

      if (operation.kind === 'switch-request') {
        const set = switchChoiceSet(operation, input.context)
        const request = pendingSwitchRequest(operation, recipientIds, set)
        if (request.options.length === 0) {
          if (operation.payload.required) {
            return fail(
              'move-mechanics-unavailable',
              `Switch request ${request.requestId} has no legal authoritative replacement.`,
            )
          }
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: operation.id,
            operationKind: operation.kind,
            recipientIds,
            outcome: 'no-op',
            reasonCode: operation.reasonCode,
            input: traceJson(operation.payload),
            result: { status: 'no-legal-replacements' },
          })
          continue
        }
        const response = responseResolver.resolve({
          requestId: request.requestId,
          options: request.options,
          allowPass: request.allowPass,
        })
        const selectedChoice = response?.optionId === null || !response
          ? null
          : revalidateSwitchChoice(operation, input.context, response.optionId)
        if (selectedChoice && response?.optionId) {
          resolvedSwitches.push(Object.freeze({
            operationId: operation.id,
            requestId: request.requestId,
            optionId: response.optionId,
            choice: selectedChoice,
            stateTransferPolicy: operation.payload.stateTransferPolicy,
          }))
        }
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: response ? (selectedChoice ? 'applied' : 'no-op') : 'pending',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: traceJson(response
            ? {
                status: selectedChoice ? 'selected' : 'passed',
                ...(selectedChoice
                  ? {
                      recalledPlacementId: selectedChoice.recalledPlacementId,
                      sentOutPlacementId: selectedChoice.sentOutPlacement.id,
                      replacementSheetSlug: selectedChoice.replacementSheetSlug,
                    }
                  : {}),
              }
            : {
                requestId: request.requestId,
                requestKind: request.kind,
                optionCount: request.options.length,
              }),
        })
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'choice',
          phase,
          requestId: request.requestId,
          requestKind: 'choice',
          outcome: response
            ? (selectedChoice ? 'selected' : 'passed')
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
            resolvedMovements,
            resolvedSwitches,
            resolvedItemChoices,
            resolvedHazardCells,
            childExecutions,
            currentSelectorState(),
          ),
          request,
        )
      }

      if (operation.kind === 'choice-request' && operation.payload.itemChoice) {
        const set = itemChoiceSet(operation, input.context)
        const request = pendingItemRequest(operation, recipientIds, set)
        if (request.options.length === 0) {
          if (!request.allowPass) {
            return fail(
              'move-mechanics-unavailable',
              `Item request ${request.requestId} has no legal authoritative option and cannot pass.`,
            )
          }
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: operation.id,
            operationKind: operation.kind,
            recipientIds,
            outcome: 'no-op',
            reasonCode: operation.reasonCode,
            input: traceJson(operation.payload),
            result: { status: 'no-legal-items' },
          })
          continue
        }
        const response = responseResolver.resolve({
          requestId: request.requestId,
          options: request.options,
          allowPass: request.allowPass,
        })
        const selectedChoice = response?.optionId === null || !response
          ? null
          : revalidateItemChoice(operation, input.context, response.optionId)
        if (selectedChoice && response?.optionId) {
          resolvedItemChoices.push(Object.freeze({
            operationId: operation.id,
            requestId: request.requestId,
            optionId: response.optionId,
            choice: selectedChoice,
          }))
        }
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'operation',
          phase,
          operationId: operation.id,
          operationKind: operation.kind,
          recipientIds,
          outcome: response ? (selectedChoice ? 'applied' : 'no-op') : 'pending',
          reasonCode: operation.reasonCode,
          input: traceJson(operation.payload),
          result: traceJson(response
            ? {
                status: selectedChoice
                  ? (selectedChoice.reference === null ? 'none-selected' : 'selected')
                  : 'passed',
                ...(selectedChoice
                  ? {
                      itemSetId: set.setId,
                      destinationId: selectedChoice.destination?.id ?? null,
                    }
                  : {}),
              }
            : {
                requestId: request.requestId,
                requestKind: request.kind,
                itemSetId: request.itemSetId,
                optionCount: request.options.length,
              }),
        })
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'choice',
          phase,
          requestId: request.requestId,
          requestKind: 'choice',
          outcome: response
            ? (selectedChoice ? 'selected' : 'passed')
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
            resolvedMovements,
            resolvedSwitches,
            resolvedItemChoices,
            resolvedHazardCells,
            childExecutions,
            currentSelectorState(),
          ),
          request,
        )
      }

      if (operation.kind === 'nested-move') {
        const invocation = resolveNestedMoveInvocation({
          context: input.context,
          operation,
          recipientIds,
          budget: executionState.nestedBudget,
        })
        const nestedOperation = invocation.operation
        for (const roll of invocation.rollLedgerEntries) {
          resolvedRolls.push({
            operationId: operation.id,
            referenceId: operation.payload.source.kind === 'random-move-pool'
              ? operation.payload.source.pool.rollId
              : roll.rollId,
            purpose: 'generic',
            recipientId: null,
            rollId: roll.rollId,
          })
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'roll',
            phase,
            reasonCode: operation.reasonCode,
            roll,
          })
        }
        const runtime = nestedRuntimeFor(input.context, nestedOperation)
        if (runtime.definition.spec.targeting.kind === 'area') {
          return fail(
            'nested-targeting-invalid',
            `Nested operation ${operation.id} cannot reuse parent geometry for an area child.`,
          )
        }
        const parentResolutionId = executionState.resolutionId
          ?? fail(
            'nested-resolution-id-missing',
            `Nested operation ${operation.id} requires a stable server-owned parent resolution ID.`,
          )
        const actorPlacementId = nestedActorPlacementId(
          input.context,
          nestedOperation,
          recipientIds,
        )
        const childResolutionId = nestedChildResolutionId({
          parentResolutionId,
          operationId: operation.id,
          canonicalId: runtime.canonicalId,
          actorPlacementId,
        })
        const ancestry = childAncestry({
          parentAncestry: trace.ancestry,
          parentResolutionId,
          parentCanonicalId: spec.canonicalId,
          parentDefinitionHash: definition.definitionHash,
          parentOperationId: operation.id,
        })
        const actorContext = deriveNestedMoveRulesContext({
          parent: input.context,
          actorPlacementId,
          canonicalId: runtime.canonicalId,
          targetIds: nestedOperation.payload.targeting.kind === 'operation-recipients'
            ? recipientIds
            : [],
          resolutionId: childResolutionId,
          ancestry,
        })
        let childTargetIds: readonly string[] = nestedOperation.payload.targeting.kind === 'operation-recipients'
          ? recipientIds
          : []
        let nestedOperationTraced = false
        if (
          invocation.randomSelection
          && nestedOperation.payload.targeting.kind === 'operation-recipients'
        ) {
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
              status: 'child-selected',
              randomSelection: invocation.randomSelection,
            }),
          })
          nestedOperationTraced = true
        }

        if (nestedOperation.payload.targeting.kind === 'fresh-choice') {
          const choices = nestedTargetOptions({
            context: actorContext,
            operation: nestedOperation,
            runtime,
            selectorState,
            budget: executionState.nestedBudget,
          })
          const request = nestedTargetRequest({
            operation: nestedOperation,
            actorPlacementId,
            options: choices,
          })
          const response = responseResolver.resolve({
            requestId: request.requestId,
            options: request.options,
            allowPass: false,
          })
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'operation',
            phase,
            operationId: operation.id,
            operationKind: operation.kind,
            recipientIds,
            outcome: response ? 'applied' : 'pending',
            reasonCode: operation.reasonCode,
            input: traceJson(operation.payload),
            result: traceJson(response
              ? {
                  status: 'target-selected',
                  randomSelection: invocation.randomSelection,
                }
              : {
                  requestId: request.requestId,
                  requestKind: request.kind,
                  optionCount: request.options.length,
                  randomSelection: invocation.randomSelection,
                }),
          })
          nestedOperationTraced = true
          trace = reduceMoveResolutionTrace(trace, {
            kind: 'choice',
            phase,
            requestId: request.requestId,
            requestKind: 'choice',
            outcome: response ? 'selected' : 'requested',
            optionId: response?.optionId ?? null,
            reasonCode: operation.reasonCode,
          })
          if (!response?.optionId) {
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
                resolvedMovements,
                resolvedSwitches,
                resolvedItemChoices,
                resolvedHazardCells,
                childExecutions,
                currentSelectorState(),
              ),
              request,
            )
          }
          childTargetIds = [
            choices.find(({ option }) => option.id === response.optionId)?.targetPlacementId
              ?? fail(
                'nested-targeting-invalid',
                `Nested target option ${response.optionId} disappeared before child execution.`,
              ),
          ]
        }

        const childContext = deriveNestedMoveRulesContext({
          parent: input.context,
          actorPlacementId,
          canonicalId: runtime.canonicalId,
          targetIds: childTargetIds,
          resolutionId: childResolutionId,
          ancestry,
        })
        const childMechanics = authoritativeMoveMechanics(
          childContext,
          runtime.canonicalId,
          'registered-spec',
        ).script
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'child-move',
          phase,
          childResolutionId,
          canonicalId: runtime.canonicalId,
          definitionHash: runtime.definitionHash,
          parentOperationId: operation.id,
          depth: ancestry.length,
          outcome: 'started',
          reasonCode: 'nested-child-started',
        })
        const child = executeMoveSpecInternal({
          definition: runtime.definition,
          context: childContext,
          authoritativeTargetIds: childTargetIds,
          ancestry,
          resolutionId: childResolutionId,
          handlerRegistry: childContext.handlerRegistry,
        }, {
          responseResolver,
          resolutionId: childResolutionId,
          mechanicsSource: 'registered-spec',
          sealRandomLedger: false,
          assertResponsesAtCompletion: false,
          nestedBudget: executionState.nestedBudget,
          nestedDepth: executionState.nestedDepth + 1,
          root: false,
        })
        if (child.kind === 'rejected') {
          return fail(
            'nested-execution-rejected',
            `Nested child ${runtime.canonicalId} rejected: ${child.rejection.reasonCode}.`,
          )
        }
        if (
          child.resolvedMovements.length > 0
          || child.resolvedSwitches.length > 0
          || (
            child.kind === 'pending-request'
            && (
              child.request.kind === 'movement-choice'
              || child.request.kind === 'hazard-cell-choice'
              || child.request.kind === 'switch-choice'
              || child.request.kind === 'item-choice'
            )
          )
        ) {
          return fail(
            'nested-execution-rejected',
            `Nested child ${runtime.canonicalId} requested an orchestration-specific movement, switch, hazard, or item window that is not a fresh target/branch window.`,
          )
        }

        const existingOperationIds = new Set([
          ...program.operations.map(emitted => emitted.id),
          ...operations.map(({ operation: emitted }) => emitted.id),
        ])
        const conflictingChildOperation = child.operations.find(({ operation: emitted }) => (
          existingOperationIds.has(emitted.id)
        ))
        if (conflictingChildOperation) {
          return fail(
            'nested-operation-id-conflict',
            `Nested child ${runtime.canonicalId} reused operation ID ${conflictingChildOperation.operation.id}.`,
          )
        }
        const directChildOperationIds = child.operations.flatMap(emission => (
          emission.childResolutionId === undefined ? [emission.operation.id] : []
        ))
        operations.push(...child.operations.map(emission => projectNestedEmission({
          emission,
          invocationPhase: phase,
          childResolutionId,
        })))
        childExecutions.push(Object.freeze({
          resolutionId: childResolutionId,
          parentOperationId: operation.id,
          actorPlacementId,
          canonicalId: runtime.canonicalId,
          definitionHash: runtime.definitionHash,
          operationIds: frozenIds(directChildOperationIds),
          targetIds: frozenIds(child.targetIds),
          hitTargetIds: frozenIds(child.hitTargetIds),
          missedTargetIds: frozenIds(child.missedTargetIds),
          damagedTargetIds: frozenIds(child.damagedTargetIds),
          faintedTargetIds: frozenIds(child.faintedTargetIds),
          mechanics: childMechanics,
          trace: child.trace,
        }), ...child.childExecutions)
        resolvedRolls.push(...child.resolvedRolls)
        resolvedDamageTypes.push(...child.resolvedDamageTypes)
        resolvedDamageBases.push(...child.resolvedDamageBases)
        multiHitExecutions.push(...child.multiHitExecutions)
        resolvedChecks.push(...child.resolvedChecks)
        branchSelections.push(...child.branchSelections)
        resolvedMovements.push(...child.resolvedMovements)
        resolvedSwitches.push(...child.resolvedSwitches)
        resolvedItemChoices.push(...child.resolvedItemChoices)
        resolvedHazardCells.push(...child.resolvedHazardCells)
        targetIds = canonicalPlacementIds(input.context, [...targetIds, ...child.targetIds])
        hitTargetIds = canonicalPlacementIds(input.context, [...hitTargetIds, ...child.hitTargetIds])
        missedTargetIds = canonicalPlacementIds(input.context, [
          ...missedTargetIds,
          ...child.missedTargetIds,
        ])
        damagedTargetIds = canonicalPlacementIds(input.context, [
          ...damagedTargetIds,
          ...child.damagedTargetIds,
        ])
        faintedTargetIds = canonicalPlacementIds(input.context, [
          ...faintedTargetIds,
          ...child.faintedTargetIds,
        ])
        trace = appendNestedTrace(
          trace,
          child.trace,
          phase,
          executionState.nestedBudget,
        )

        if (child.kind === 'pending-request') {
          const request = projectNestedRequest(child.request, phase)
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
              resolvedMovements,
              resolvedSwitches,
              resolvedItemChoices,
              resolvedHazardCells,
              childExecutions,
              currentSelectorState(),
            ),
            request,
          )
        }

        if (!nestedOperationTraced) {
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
              status: 'child-completed',
              childResolutionId,
              canonicalId: runtime.canonicalId,
              randomSelection: invocation.randomSelection,
            }),
          })
        }
        trace = reduceMoveResolutionTrace(trace, {
          kind: 'child-move',
          phase,
          childResolutionId,
          canonicalId: runtime.canonicalId,
          definitionHash: runtime.definitionHash,
          parentOperationId: operation.id,
          depth: ancestry.length,
          outcome: 'completed',
          reasonCode: 'nested-child-completed',
        })
        continue
      }

      if (operation.kind === 'choice-request' || operation.kind === 'reaction-request') {
        const request = pendingRequest(
          operation,
          recipientIds,
          input.ancestry?.length ?? 0,
        )
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
            resolvedMovements,
            resolvedSwitches,
            resolvedItemChoices,
            resolvedHazardCells,
            childExecutions,
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

  if (executionState.assertResponsesAtCompletion) responseResolver.assertAllConsumed()
  const unusedHazardSelection = [...hazardSelections.keys()].find(
    operationId => !consumedHazardSelections.has(operationId),
  )
  if (unusedHazardSelection) {
    fail(
      'definition-integrity-mismatch',
      `Authoritative hazard selection for ${unusedHazardSelection} was not reached by the reviewed MoveSpec.`,
    )
  }
  return Object.freeze({
    kind: 'complete',
    ...terminalBase(
      input.context,
      operations,
      targetIds,
      trace,
      terminalRollLedger(input.context, executionState.sealRandomLedger),
      resolvedRolls,
      resolvedDamageTypes,
      resolvedDamageBases,
      multiHitExecutions,
      resolvedChecks,
      branchSelections,
      resolvedMovements,
      resolvedSwitches,
      resolvedItemChoices,
      resolvedHazardCells,
      childExecutions,
      currentSelectorState(),
    ),
  })
}

export const executeMoveSpec = (
  input: ExecuteMoveSpecInput,
): MoveSpecExecutionResult => {
  const nestedBudget = enforceNestedExecutionBudget(() => createNestedMoveExecutionBudget({
    policy: input.nestedExecutionPolicy,
  }))
  return executeMoveSpecInternal(input, {
    responseResolver: createMoveSpecResponseResolver(input.responses),
    resolutionId: input.resolutionId ?? input.context.resolutionId,
    mechanicsSource: 'actor-move',
    sealRandomLedger: true,
    assertResponsesAtCompletion: true,
    nestedBudget,
    nestedDepth: 0,
    root: true,
  })
}
