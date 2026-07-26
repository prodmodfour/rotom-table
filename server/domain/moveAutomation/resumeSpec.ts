import type { PendingMoveResolution } from '#shared/moveAutomation/pendingResolution'
import type { MoveHazardCellSelectionWindow } from '#shared/moveAutomation/hazardCellSelection'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { moveUsageKey } from '~/utils/moveUsage'
import {
  tokenFacingForPlacement,
  tokenFacingTowardPoint,
} from '~/utils/tokenFacing'
import { sameJsonValue } from '~/utils/serialization'
import type {
  AuthoritativeMoveExecution,
  AuthoritativeMoveResolution,
  AuthoritativeMoveResourceMovement,
  AuthoritativeMoveShiftMovement,
} from '../resolveAuthoritativeMove'
import {
  buildAuthoritativeMoveRulesContext,
  deduplicateAuthoritativeMoveSheetReads,
} from './context'
import {
  executeMoveSpec,
  MoveSpecExecutionError,
  type MoveSpecAuthoritativeTargetEvaluation,
  type MoveSpecExecutionCompleteResult,
} from './executeSpec'
import { createMoveStateChangePlan } from './plan'
import {
  AuthoritativeHazardCellSelectionError,
  validateAuthoritativeHazardCellSelection,
} from './hazardCellSelection'
import type { AuthoritativeMoveRandomSource } from './random'
import type { AuthoritativeMoveItemResources } from './itemResources'
import {
  createMoveAutomationReplayRandom,
  MoveAutomationReplayRandomError,
} from './replayRandom'
import {
  MOVE_AUTOMATION_RUNTIME_REGISTRY,
  type MoveAutomationRuntimeRegistry,
  type MoveSpecV2Runtime,
} from './registry'
import {
  MoveSpecResolvedResponseError,
  type MoveSpecResolvedResponse,
} from './responses'
import { reduceCompletedMoveSpec } from './resolveImmediateSpec'
import { attachHelpingHandBonusResolution } from './helpingHand'
import {
  projectResolvedMoveSwitchTransition,
  ResolvedMoveSwitchProjectionError,
} from './projectResolvedSwitch'
import { aa060TriggeredMoveOverlayOperations } from '../abilityAutomation/mechanics/aa060TriggeredMoveIntegration'
import { aa061TriggeredMoveOverlayOperations } from '../abilityAutomation/mechanics/aa061TriggeredMoveIntegration'
import { aa062BoneLordEmpowersMove, aa062MoveOverlayOperations } from '../abilityAutomation/mechanics/aa062MoveIntegration'
import { aa063MoveOverlayOperations } from '../abilityAutomation/mechanics/aa063MoveIntegration'
import { aa064MoveOverlayOperations } from '../abilityAutomation/mechanics/aa064MoveIntegration'
import { aa065MoveOverlayOperations } from '../abilityAutomation/mechanics/aa065MoveIntegration'
import { aa066MoveOverlayOperations } from '../abilityAutomation/mechanics/aa066MoveIntegration'
import { aa067MoveOverlayOperations } from '../abilityAutomation/mechanics/aa067MoveIntegration'
import { aa068MoveOverlayOperations } from '../abilityAutomation/mechanics/aa068MoveIntegration'
import { aa069MoveOverlayOperations } from '../abilityAutomation/mechanics/aa069MoveIntegration'
import { aa070MoveOverlayOperations } from '../abilityAutomation/mechanics/aa070MoveIntegration'
import { aa071MoveOverlayOperations } from '../abilityAutomation/mechanics/aa071MoveIntegration'
import { aa072MoveOverlayOperations } from '../abilityAutomation/mechanics/aa072MoveIntegration'
import { aa073MoveOverlayOperations } from '../abilityAutomation/mechanics/aa073MoveIntegration'
import { aa074MoveOverlayOperations } from '../abilityAutomation/mechanics/aa074MoveIntegration'
import { aa075MoveOverlayOperations } from '../abilityAutomation/mechanics/aa075MoveIntegration'
import { aa076MoveOverlayOperations } from '../abilityAutomation/mechanics/aa076MoveIntegration'
import { aa077MoveOverlayOperations } from '../abilityAutomation/mechanics/aa077MoveIntegration'
import {
  AA068_DUST_CLOUD_TARGETING_OVERRIDE,
  aa068DustCloudBurstEnabled,
} from '../abilityAutomation/mechanics/aa068StaticIntegration'
import { AA068_DUST_CLOUD_BURST_BRANCH_ID } from '#shared/abilityAutomation/mechanics'
import { resolveMoveSpecTargetingRule } from './targetingBranches'

export type ResumeMoveSpecErrorCode =
  | 'runtime-unavailable'
  | 'runtime-identity-mismatch'
  | 'move-entry-unavailable'
  | 'execution-rejected'
  | 'roll-ledger-mismatch'
  | 'trace-prefix-mismatch'
  | 'move-key-invalid'

export class ResumeMoveSpecError extends Error {
  readonly code: ResumeMoveSpecErrorCode

  constructor(code: ResumeMoveSpecErrorCode, message: string) {
    super(message)
    this.name = 'ResumeMoveSpecError'
    this.code = code
  }
}

export interface ResumeMoveSpecInput {
  readonly pendingResolution: PendingMoveResolution
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  /** Fresh server-loaded item snapshot used to revalidate durable item options. */
  readonly itemResources?: AuthoritativeMoveItemResources
  readonly response?: MoveSpecResolvedResponse
  readonly hazardCellResponse?: {
    readonly window: MoveHazardCellSelectionWindow
    readonly selectedOptionIds: readonly string[]
  }
  readonly now: number
  readonly random?: AuthoritativeMoveRandomSource
  readonly runtimeRegistry?: MoveAutomationRuntimeRegistry
  readonly legacyScripts?: ReadonlyMap<string, MoveAutomationScript>
}

const fail = (code: ResumeMoveSpecErrorCode, message: string): never => {
  throw new ResumeMoveSpecError(code, message)
}

const runtimeForPending = (
  pending: PendingMoveResolution,
  registry: MoveAutomationRuntimeRegistry,
): MoveSpecV2Runtime => {
  const runtime = registry.resolve(pending.canonicalMoveId)
  if (!runtime || runtime.kind !== 'movespec-v2') {
    return fail(
      'runtime-unavailable',
      `MoveSpec ${pending.canonicalMoveId} is no longer registered.`,
    )
  }
  if (
    runtime.version !== pending.specVersion
    || runtime.definitionHash !== pending.specHash
    || runtime.definition.rulesetVersion.rulesetId !== pending.rulesetId
    || runtime.definition.rulesetVersion.sourceDataSha256 !== pending.rulesetHash
  ) {
    return fail(
      'runtime-identity-mismatch',
      `MoveSpec ${pending.canonicalMoveId} no longer matches the suspended version, hash, or ruleset.`,
    )
  }
  return runtime
}

const targetEvidence = (
  pending: PendingMoveResolution,
): {
  readonly includedIds: readonly string[]
  readonly evaluations: readonly MoveSpecAuthoritativeTargetEvaluation[]
} => {
  const evaluations = pending.trace.events.flatMap(event => (
    event.kind === 'target' && event.reasonCode !== 'nested-child-target'
  )
    ? [{
        targetPlacementId: event.targetId,
        outcome: event.outcome,
        reasonCode: event.reasonCode,
      } satisfies MoveSpecAuthoritativeTargetEvaluation]
    : [])
  return {
    includedIds: evaluations
      .filter(evaluation => evaluation.outcome === 'included')
      .map(evaluation => evaluation.targetPlacementId),
    evaluations,
  }
}

const chosenResponses = (
  pending: PendingMoveResolution,
  response: MoveSpecResolvedResponse | undefined,
): readonly MoveSpecResolvedResponse[] => [
  ...pending.chosenOptions
    .filter(choice => choice.optionIds === undefined)
    .map(choice => ({
      requestId: choice.windowId,
      optionId: choice.optionId,
    })),
  ...(response ? [response] : []),
]

const traceBeforeCurrentOperation = (pending: PendingMoveResolution) => {
  const outstandingOperationIds = new Set(
    pending.outstandingWindows.map(window => window.operationId),
  )
  const operationIndex = pending.trace.events.findIndex(event => (
    event.kind === 'operation' && outstandingOperationIds.has(event.operationId)
  ))
  return operationIndex < 0
    ? pending.trace.events
    : pending.trace.events.slice(0, operationIndex)
}

const comparableTraceEvent = (
  event: PendingMoveResolution['trace']['events'][number],
): Record<string, unknown> => {
  if (event.kind === 'operation') {
    const { input: _input, result: _result, ...identity } = event
    return identity
  }
  if (event.kind === 'predicate') {
    const { input: _input, ...identity } = event
    return identity
  }
  return event as unknown as Record<string, unknown>
}

const assertDurableExecutionPrefix = (
  pending: PendingMoveResolution,
  execution: MoveSpecExecutionCompleteResult | Extract<
    ReturnType<typeof executeMoveSpec>,
    { readonly kind: 'pending-request' }
  >,
): void => {
  const ledgerPrefix = execution.rollLedger.slice(0, pending.rollLedger.length)
  if (!sameJsonValue(ledgerPrefix, pending.rollLedger)) {
    fail(
      'roll-ledger-mismatch',
      'Resumed execution did not reproduce the durable server-owned roll ledger.',
    )
  }
  // One check operation may suspend for actor selection, target selection, and
  // a later resource response. Its operation-local trace is rebuilt as a unit,
  // so event ordering within that unit can legitimately change when it finally
  // resolves (for example, rolls precede the selected-choice projections).
  // Everything before the operation remains a strict prefix; the durable roll
  // ledger above and chosen-option assertions below protect the rebuilt unit.
  const expectedTrace = traceBeforeCurrentOperation(pending).map(comparableTraceEvent)
  const actualTrace = execution.trace.events
    .slice(0, expectedTrace.length)
    .map(comparableTraceEvent)
  if (!sameJsonValue(actualTrace, expectedTrace)) {
    fail(
      'trace-prefix-mismatch',
      'Resumed execution did not reproduce the durable decision trace before the response window.',
    )
  }

  for (const choice of pending.chosenOptions) {
    if (choice.optionIds !== undefined) continue
    const expectedOutcome = choice.optionId === null ? 'passed' : 'selected'
    const reproduced = execution.trace.events.some(event => (
      event.kind === 'choice'
      && event.requestId === choice.windowId
      && event.outcome === expectedOutcome
      && event.optionId === choice.optionId
    ))
    if (!reproduced) {
      fail(
        'trace-prefix-mismatch',
        `Resumed execution did not reproduce durable response ${choice.windowId}.`,
      )
    }
  }
}

const alreadyCommittedOperationIds = (
  pending: PendingMoveResolution,
  runtime: MoveSpecV2Runtime,
): ReadonlySet<string> => {
  const tracedOperationIds = new Set(pending.trace.events.flatMap(event => (
    event.kind === 'operation' ? [event.operationId] : []
  )))
  return new Set(runtime.definition.spec.phases.flatMap(block => (
    block.operations.flatMap(operation => (
      operation.kind === 'direct-hp'
      && operation.phase === 'pay'
      && operation.payload.cost?.timing === 'declaration'
      && tracedOperationIds.has(operation.id)
        ? [operation.id]
        : []
    ))
  )))
}

const resolvedMovementProjection = (
  context: ReturnType<typeof buildAuthoritativeMoveRulesContext>,
  execution: MoveSpecExecutionCompleteResult | Extract<
    ReturnType<typeof executeMoveSpec>,
    { readonly kind: 'pending-request' }
  >,
): {
  readonly movement?: AuthoritativeMoveShiftMovement
  readonly resourceMovement?: AuthoritativeMoveResourceMovement
  readonly desiredFacing?: AuthoritativeMoveResolution['desiredFacing']
} => {
  if (execution.resolvedMovements.length === 0) return {}
  if (execution.resolvedMovements.length > 1) {
    return fail(
      'execution-rejected',
      'A resumed MoveSpec resolved more than one durable movement choice.',
    )
  }
  const resolved = execution.resolvedMovements[0]!
  const authoritative = resolved.choice.movement
  const selection = resolved.choice.option.selection
  if (!selection) {
    return fail('execution-rejected', 'A resolved movement option lost its server selection.')
  }
  const movement: AuthoritativeMoveShiftMovement = {
    kind: 'shift',
    from: { ...authoritative.origin },
    destination: { ...authoritative.destination },
    pathCells: authoritative.path.map(cell => ({ ...cell })),
    ...(selection.kind === 'movement-direction'
      ? { direction: selection.direction }
      : {}),
  }
  const currentFacing = tokenFacingForPlacement(context.actor.placement)
  const desiredFacing = tokenFacingTowardPoint(
    authoritative.origin,
    authoritative.destination,
    currentFacing,
  ) ?? undefined
  return {
    movement,
    resourceMovement: {
      distance: authoritative.cost,
      budget: authoritative.effectiveLimit,
    },
    ...(desiredFacing ? { desiredFacing } : {}),
  }
}

/**
 * Rebuild one immutable authoritative context, deterministically replay its
 * durable prefix, apply one authorized response, and continue to the next
 * window or a complete typed move projection.
 */
export const resumeMoveSpec = (
  input: ResumeMoveSpecInput,
): AuthoritativeMoveExecution => {
  const pending = input.pendingResolution
  const registry = input.runtimeRegistry ?? MOVE_AUTOMATION_RUNTIME_REGISTRY
  const runtime = runtimeForPending(pending, registry)
  const evidence = targetEvidence(pending)
  const dustCloudBranch = pending.targetBranchId === AA068_DUST_CLOUD_BURST_BRANCH_ID
  const reviewedTargeting = pending.targetBranchId && !dustCloudBranch
    ? resolveMoveSpecTargetingRule(runtime.definition.spec, pending.targetBranchId)
    : runtime.definition.spec.targeting
  if (!reviewedTargeting) {
    return fail('execution-rejected', 'The suspended targeting branch is no longer reviewed.')
  }
  const targetingKind = dustCloudBranch ? 'area' : reviewedTargeting.kind
  const authoritativeTargetIds = targetingKind === 'self'
    ? []
    : evidence.includedIds
  const context = buildAuthoritativeMoveRulesContext({
    map: input.map,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
    intent: {
      schemaVersion: 1,
      placementId: pending.actorPlacementId,
      moveName: pending.canonicalMoveId,
      ...(pending.virtualOriginCell ? { originCell: { ...pending.virtualOriginCell } } : {}),
      ...(pending.targetBranchId ? { targetBranchId: pending.targetBranchId } : {}),
      selection: { kind: 'self' },
    },
    candidatePlacementIds: evidence.evaluations.map(evaluation => evaluation.targetPlacementId),
    selectedPlacementIds: authoritativeTargetIds,
    random: input.random ?? Math.random,
    randomRoller: createMoveAutomationReplayRandom(pending.rollLedger, input.random),
    time: input.now,
    resolutionId: pending.resolutionId,
    itemResources: input.itemResources,
    runtimeRegistry: registry,
    legacyScripts: input.legacyScripts,
  })
  context.reads.recordPlacement(context.actor.placement)
  const entryResult = context.queries.resolveActorMoveEntry(pending.canonicalMoveId)
  if (!entryResult.ok) {
    return fail('move-entry-unavailable', entryResult.message)
  }
  const entry = entryResult.entry
  const serverAbilityTargetingOverride = aa068DustCloudBurstEnabled({
    context,
    script: entry.script,
    targetBranchId: pending.targetBranchId,
  })
    ? AA068_DUST_CLOUD_TARGETING_OVERRIDE
    : null
  if (dustCloudBranch && !serverAbilityTargetingOverride) {
    return fail('execution-rejected', 'Dust Cloud targeting is no longer effective or Powder-eligible.')
  }
  let execution: ReturnType<typeof executeMoveSpec>
  try {
    if ((input.response === undefined) === (input.hazardCellResponse === undefined)) {
      return fail(
        'execution-rejected',
        'A resumed MoveSpec must receive exactly one ordinary or hazard-cell response.',
      )
    }
    const hazardCellSelection = input.hazardCellResponse
      ? validateAuthoritativeHazardCellSelection({
          map: input.map,
          window: input.hazardCellResponse.window,
          selectedOptionIds: input.hazardCellResponse.selectedOptionIds,
        })
      : undefined
    if (
      hazardCellSelection
      && hazardCellSelection.resolutionId !== pending.resolutionId
    ) {
      return fail(
        'execution-rejected',
        'The hazard-cell response belongs to another durable move resolution.',
      )
    }
    const moveSourceId = runtime.definition.spec.phases
      .flatMap(phase => phase.operations)
      .find(operation => operation.source.kind === 'move')?.source.id
      ?? `move.${runtime.canonicalId}`
    execution = executeMoveSpec({
      definition: runtime.definition,
      ...(serverAbilityTargetingOverride
        ? { serverAbilityTargetingOverride }
        : entry.script.moveName === 'Bonemerang' && aa062BoneLordEmpowersMove(context, 'Bonemerang')
          ? {
              serverAbilityTargetingOverride: {
                kind: 'area' as const, minTargets: 0, maxTargets: 32,
                selector: { kind: 'area-targets' as const },
                predicate: {
                  relationship: 'any' as const,
                  willingness: 'any' as const,
                  excludeActor: true,
                },
              },
            }
          : {}),
      serverAbilityOverlayOperations: [
        ...aa060TriggeredMoveOverlayOperations({
          context, script: entry.script, moveSourceId, authoritativeTargetIds,
        }),
        ...aa061TriggeredMoveOverlayOperations({
          context, script: entry.script, moveSourceId, authoritativeTargetIds,
        }),
        ...aa062MoveOverlayOperations({ context, script: entry.script, moveSourceId }),
        ...aa063MoveOverlayOperations({ context, script: entry.script, moveSourceId }),
        ...aa064MoveOverlayOperations({
          context, script: entry.script, moveSourceId,
          authoritativeTargetIds,
        }),
        ...aa065MoveOverlayOperations({
          context, script: entry.script, moveSourceId,
          authoritativeTargetIds,
        }),
        ...aa066MoveOverlayOperations({
          context, script: entry.script, moveSourceId,
          authoritativeTargetIds,
        }),
        ...aa067MoveOverlayOperations({
          context, script: entry.script, moveSourceId,
          authoritativeTargetIds,
        }),
        ...aa068MoveOverlayOperations({
          context, script: entry.script, moveSourceId,
          authoritativeTargetIds,
        }),
        ...aa069MoveOverlayOperations({
          context, script: entry.script, moveSourceId,
          authoritativeTargetIds,
        }),
        ...aa070MoveOverlayOperations({
          context, script: entry.script, moveSourceId,
          authoritativeTargetIds,
        }),
        ...aa071MoveOverlayOperations({
          context, script: entry.script, moveSourceId,
          authoritativeTargetIds,
        }),
        ...aa072MoveOverlayOperations({
          context, script: entry.script, moveSourceId,
          authoritativeTargetIds,
        }),
        ...aa073MoveOverlayOperations({
          context, script: entry.script, moveSourceId,
          authoritativeTargetIds,
        }),
        ...aa074MoveOverlayOperations({
          context, script: entry.script, moveSourceId,
          authoritativeTargetIds,
        }),
        ...aa075MoveOverlayOperations({
          context, script: entry.script, moveSourceId,
          authoritativeTargetIds,
        }),
        ...aa076MoveOverlayOperations({
          context, script: entry.script, moveSourceId,
          authoritativeTargetIds,
        }),
        ...aa077MoveOverlayOperations({
          context, script: entry.script, moveSourceId,
          authoritativeTargetIds,
        }),
      ],
      context,
      authoritativeTargetIds,
      ...(targetingKind === 'area'
        ? { authoritativeTargetEvaluations: evidence.evaluations }
        : {}),
      ancestry: pending.causalAncestry,
      resolutionId: pending.resolutionId,
      responses: chosenResponses(pending, input.response),
      ...(hazardCellSelection
        ? { authoritativeHazardCellSelections: [hazardCellSelection] }
        : {}),
      handlerRegistry: context.handlerRegistry,
    })
  }
  catch (error) {
    if (error instanceof MoveAutomationReplayRandomError) {
      return fail('roll-ledger-mismatch', error.message)
    }
    if (
      error instanceof MoveSpecResolvedResponseError
      || error instanceof MoveSpecExecutionError
      || error instanceof AuthoritativeHazardCellSelectionError
    ) {
      return fail(
        'execution-rejected',
        `MoveSpec ${pending.canonicalMoveId} could not revalidate its response: ${error.message}`,
      )
    }
    throw error
  }
  if (execution.kind === 'rejected') {
    return fail(
      'execution-rejected',
      `MoveSpec ${pending.canonicalMoveId} rejected while resuming: ${execution.rejection.reasonCode}.`,
    )
  }
  assertDurableExecutionPrefix(pending, execution)
  const movementProjection = resolvedMovementProjection(context, execution)
  let switchTransition
  try {
    switchTransition = projectResolvedMoveSwitchTransition(execution)
  }
  catch (error) {
    if (error instanceof ResolvedMoveSwitchProjectionError) {
      return fail('execution-rejected', error.message)
    }
    throw error
  }

  const resolvedMoveKey = moveUsageKey(entry.canonicalMoveName)
  if (!resolvedMoveKey) {
    return fail('move-key-invalid', `${entry.canonicalMoveName} did not produce a valid move usage key.`)
  }
  if (execution.kind === 'pending-request') {
    return Object.freeze({
      kind: 'pending' as const,
      actorPlacementId: pending.actorPlacementId,
      moveName: runtime.definition.spec.presentation.displayName,
      canonicalMoveName: entry.canonicalMoveName,
      moveKey: resolvedMoveKey,
      frequency: entry.frequency,
      damageFormula: entry.damageFormula,
      resourceRange: entry.script.range,
      ...(movementProjection.resourceMovement
        ? { resourceMovement: movementProjection.resourceMovement }
        : {}),
      selectedTargetIds: [...authoritativeTargetIds],
      sheetReads: deduplicateAuthoritativeMoveSheetReads([
        ...context.reads.snapshot(),
        ...execution.sheetReads,
      ]),
      runtime,
      execution,
      // Declaration costs were committed with the original suspension. A
      // continuation may never re-apply them while opening another window.
      preWindowPlan: createMoveStateChangePlan([]),
    })
  }

  const immediate = reduceCompletedMoveSpec(
    {
      context,
      runtime,
      entry,
      ...(pending.targetBranchId ? { targetBranchId: pending.targetBranchId } : {}),
      authoritativeTargetIds,
      ...(targetingKind === 'area'
        ? { authoritativeTargetEvaluations: evidence.evaluations }
        : {}),
    },
    execution,
    alreadyCommittedOperationIds(pending, runtime),
  )
  const result: AuthoritativeMoveResolution = attachHelpingHandBonusResolution(input.map, {
    actorPlacementId: pending.actorPlacementId,
    moveName: runtime.definition.spec.presentation.displayName,
    canonicalMoveName: entry.canonicalMoveName,
    moveKey: resolvedMoveKey,
    frequency: entry.frequency,
    damageFormula: entry.damageFormula,
    selectedTargetIds: [...authoritativeTargetIds],
    sheetReads: immediate.sheetReads,
    rollLedger: immediate.rollLedger,
    auditTrace: immediate.trace,
    script: immediate.script,
    transaction: immediate.transaction,
    ...movementProjection,
    ...(switchTransition ? { switchTransition } : {}),
    nativeV2: immediate.native,
  })
  return Object.freeze(result)
}
