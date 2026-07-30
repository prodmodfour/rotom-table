import {
  isAbilitySharedEffectNode,
  sharedKernelMovePhaseForAbilityPhase,
  type AbilitySharedEffectNode,
  type AbilitySharedKernelOperation,
} from '#shared/abilityAutomation/effects'
import type {
  AbilitySpecJsonObject,
  AbilitySpecPhase,
} from '#shared/abilityAutomation/spec'
import type {
  MoveCombatStageEffectOperation,
  MoveEffectRecipientSelectorKind,
} from '#shared/moveAutomation/effects'
import type { MoveSelector } from '#shared/moveAutomation/selectors'
import type { MoveStateChangePlan } from '../moveAutomation/plan'
import {
  buildCoreTokenStateChanges,
  recordMoveCoreTokenEffectTouches,
  type MoveCoreTokenEffectTouches,
} from '../moveAutomation/reducers/coreTokenPlan'
import {
  reduceCombatStageEffect,
} from '../moveAutomation/reducers/combatStage'
import type {
  MoveCombatStageAccuracyRollQueries,
  MoveCoreTokenEffectImmunityQueries,
  MoveCoreTokenEffectOperationResult,
  MoveCoreTokenEffectRecipient,
  MoveCoreTokenEffectRecipientResult,
} from '../moveAutomation/reducers/coreTokenEffectTypes'
import { createMoveAutomationCombatStageUpdateAccumulator } from '~/utils/moveAutomationStatusUpdates'
import type { AuthoritativeAbilityContext } from './context'

export const ABILITY_SHARED_KERNEL_LIMITS = Object.freeze({
  operations: 512,
  recipients: 128,
})

export interface AbilityEffectRecipientState {
  readonly targetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly missedTargetIds: readonly string[]
  readonly damagedTargetIds: readonly string[]
  readonly faintedTargetIds: readonly string[]
  readonly areaTargetIds: readonly string[]
  readonly responseOwnerId: string | null
}

export interface PlannedAbilitySharedEffect {
  readonly phase: AbilitySpecPhase
  readonly operation: AbilitySharedKernelOperation
  readonly recipientIds: readonly string[]
}

export interface AbilitySharedEffectPlan {
  readonly operations: readonly PlannedAbilitySharedEffect[]
}

export interface AbilityCombatStageOperationResult {
  readonly operationId: string
  readonly operationKind: 'combat-stage'
  readonly phase: AbilitySpecPhase
  readonly reasonCode: string
  readonly recipientIds: readonly string[]
  readonly outcome: MoveCoreTokenEffectOperationResult['outcome']
  readonly recipients: readonly MoveCoreTokenEffectRecipientResult[]
}

export interface AbilityCombatStageReduction {
  readonly plan: MoveStateChangePlan
  readonly operationResults: readonly AbilityCombatStageOperationResult[]
}

export type AbilitySharedKernelErrorCode =
  | 'limit-exceeded'
  | 'unsupported-recipient-selector'
  | 'unsupported-selector'
  | 'ambiguous-selector'
  | 'recipient-unavailable'
  | 'unsupported-core-operation'

export class AbilitySharedKernelError extends Error {
  readonly code: AbilitySharedKernelErrorCode

  constructor(code: AbilitySharedKernelErrorCode, detail: string) {
    super(detail)
    this.name = 'AbilitySharedKernelError'
    this.code = code
  }
}

const fail = (code: AbilitySharedKernelErrorCode, detail: string): never => {
  throw new AbilitySharedKernelError(code, detail)
}

const uniqueMapOrder = (
  context: AuthoritativeAbilityContext,
  ids: readonly string[],
): readonly string[] => {
  const selected = new Set(ids)
  const output = context.placements
    .map(placement => placement.id)
    .filter(id => selected.has(id))
  if (output.length > ABILITY_SHARED_KERNEL_LIMITS.recipients) {
    fail('limit-exceeded', 'Ability effect recipient count exceeds its bounded limit.')
  }
  return Object.freeze(output)
}

const defaultRecipientState = (
  context: AuthoritativeAbilityContext,
): AbilityEffectRecipientState => Object.freeze({
  targetIds: Object.freeze(context.targets.map(target => target.placement.id)),
  hitTargetIds: Object.freeze([]),
  missedTargetIds: Object.freeze([]),
  damagedTargetIds: Object.freeze([]),
  faintedTargetIds: Object.freeze([]),
  areaTargetIds: Object.freeze([]),
  responseOwnerId: null,
})

const recipientIds = (
  context: AuthoritativeAbilityContext,
  kind: MoveEffectRecipientSelectorKind,
  state: AbilityEffectRecipientState,
): readonly string[] => {
  switch (kind) {
    case 'none': return Object.freeze([])
    case 'actor': return Object.freeze([context.actor.placement.id])
    case 'selected-targets':
    case 'attacked-targets': return uniqueMapOrder(context, state.targetIds)
    case 'hit-targets': return uniqueMapOrder(context, state.hitTargetIds)
    case 'missed-targets': return uniqueMapOrder(context, state.missedTargetIds)
    case 'damaged-targets': return uniqueMapOrder(context, state.damagedTargetIds)
    case 'fainted-targets': return uniqueMapOrder(context, state.faintedTargetIds)
    case 'area-targets': return uniqueMapOrder(context, state.areaTargetIds)
    case 'all-placements': return uniqueMapOrder(context, context.placements.map(({ id }) => id))
    case 'source-placement': return Object.freeze([context.source.placement.id])
    case 'response-owner': return state.responseOwnerId
      ? uniqueMapOrder(context, [state.responseOwnerId])
      : Object.freeze([])
    case 'actor-and-attacked-targets': return uniqueMapOrder(context, [
      context.actor.placement.id,
      ...state.targetIds,
    ])
    case 'cardinally-adjacent-to-hit-targets':
      return fail(
        'unsupported-recipient-selector',
        'Cardinal footprint expansion requires the authoritative geometry adapter.',
      )
  }
}

/** Resolve the selector AST subset whose placement-set semantics are domain-neutral. */
export const resolveAbilitySharedSelector = (
  context: AuthoritativeAbilityContext,
  selector: MoveSelector,
  state: AbilityEffectRecipientState = defaultRecipientState(context),
): readonly string[] => {
  switch (selector.kind) {
    case 'actor': return Object.freeze([context.actor.placement.id])
    case 'current-target': {
      if (state.targetIds.length !== 1) {
        return fail('ambiguous-selector', 'current-target requires exactly one selected target.')
      }
      return uniqueMapOrder(context, state.targetIds)
    }
    case 'selected-targets':
    case 'attacked-targets': return uniqueMapOrder(context, state.targetIds)
    case 'candidate-targets': return uniqueMapOrder(
      context,
      context.placements
        .map(placement => placement.id)
        .filter(id => id !== context.actor.placement.id),
    )
    case 'hit-targets': return uniqueMapOrder(context, state.hitTargetIds)
    case 'missed-targets': return uniqueMapOrder(context, state.missedTargetIds)
    case 'damaged-targets': return uniqueMapOrder(context, state.damagedTargetIds)
    case 'fainted-targets': return uniqueMapOrder(context, state.faintedTargetIds)
    case 'area-targets': return uniqueMapOrder(context, state.areaTargetIds)
    case 'source-placement': return Object.freeze([context.source.placement.id])
    case 'union': return uniqueMapOrder(
      context,
      selector.selectors.flatMap(child => resolveAbilitySharedSelector(context, child, state)),
    )
    case 'intersection': {
      const sets = selector.selectors.map(child => new Set(resolveAbilitySharedSelector(context, child, state)))
      return uniqueMapOrder(
        context,
        context.placements.map(({ id }) => id).filter(id => sets.every(set => set.has(id))),
      )
    }
    case 'difference': {
      const source = resolveAbilitySharedSelector(context, selector.source, state)
      const excluded = new Set(resolveAbilitySharedSelector(context, selector.exclude, state))
      return uniqueMapOrder(context, source.filter(id => !excluded.has(id)))
    }
  }
}

/** Enumerate canonical operations without evaluating or mutating state. */
export const planAbilitySharedEffects = (
  context: AuthoritativeAbilityContext,
  state: AbilityEffectRecipientState = defaultRecipientState(context),
): AbilitySharedEffectPlan => {
  const operations: PlannedAbilitySharedEffect[] = []
  for (const block of context.runtime.definition.spec.phases) {
    for (const node of block.operations) {
      if (!isAbilitySharedEffectNode(node as AbilitySpecJsonObject)) continue
      const sharedNode = node as unknown as AbilitySharedEffectNode
      const resolvedRecipientIds = recipientIds(
        context,
        sharedNode.operation.recipients.kind,
        state,
      )
      context.budget.consumeOperation(resolvedRecipientIds.length)
      operations.push(Object.freeze({
        phase: block.phase,
        operation: sharedNode.operation,
        recipientIds: resolvedRecipientIds,
      }))
      if (operations.length > ABILITY_SHARED_KERNEL_LIMITS.operations) {
        fail('limit-exceeded', 'Ability shared effect count exceeds its bounded limit.')
      }
    }
  }
  return Object.freeze({ operations: Object.freeze(operations) })
}

const recipientFor = (
  context: AuthoritativeAbilityContext,
  placementId: string,
): MoveCoreTokenEffectRecipient => {
  const placement = context.queries.placements.get(placementId)
  const token = context.queries.tokens.get(placementId)
  if (!placement || !token) {
    return fail('recipient-unavailable', `Recipient ${placementId} is not an authoritative token.`)
  }
  const sheet = context.queries.sheets.forPlacement(placement)
  if (!sheet) return fail('recipient-unavailable', `Recipient ${placementId} has no loaded sheet.`)
  return { placement, token, sheet }
}

const ALLOW_ALL_IMMUNITIES: MoveCoreTokenEffectImmunityQueries = Object.freeze({
  directHp: () => ({ blockedBy: null, consultedPlacementIds: [] }),
  condition: () => ({ blockedBy: null, consultedPlacementIds: [] }),
  combatStage: () => ({ blockedBy: null, consultedPlacementIds: [] }),
})

/**
 * Reuse the cap-aware combat-stage reducer and revisioned state-plan builder.
 * No synthetic move intent, move source, or move trace is constructed.
 */
export const reduceAbilitySharedCombatStageEffects = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly effects?: AbilitySharedEffectPlan
  readonly recipientState?: AbilityEffectRecipientState
  readonly immunities?: MoveCoreTokenEffectImmunityQueries
  readonly accuracyRolls?: MoveCombatStageAccuracyRollQueries
}): AbilityCombatStageReduction => {
  const effects = input.effects ?? planAbilitySharedEffects(
    input.context,
    input.recipientState ?? defaultRecipientState(input.context),
  )
  const stageEffects = effects.operations.filter(effect => effect.operation.kind === 'combat-stage')
  if (stageEffects.length !== effects.operations.length) {
    fail('unsupported-core-operation', 'This reducer accepts only shared combat-stage operations.')
  }
  const accumulator = createMoveAutomationCombatStageUpdateAccumulator()
  const recipientsById = new Map<string, MoveCoreTokenEffectRecipient>()
  const touches: MoveCoreTokenEffectTouches = new Map()
  const moveResults: MoveCoreTokenEffectOperationResult[] = []
  const operationResults: AbilityCombatStageOperationResult[] = []

  stageEffects.forEach((effect, operationOrder) => {
    const operation = {
      ...effect.operation,
      phase: sharedKernelMovePhaseForAbilityPhase(effect.phase),
    } as unknown as MoveCombatStageEffectOperation
    const recipients = effect.recipientIds.map((placementId) => {
      const existing = recipientsById.get(placementId)
      if (existing) return existing
      const recipient = recipientFor(input.context, placementId)
      recipientsById.set(placementId, recipient)
      return recipient
    })
    const sourceIds = operation.payload.stageSource
      ? resolveAbilitySharedSelector(
          input.context,
          operation.payload.stageSource,
          input.recipientState ?? defaultRecipientState(input.context),
        )
      : []
    if (sourceIds.length > 1) {
      fail('ambiguous-selector', `Stage source for ${operation.id} must resolve at most one recipient.`)
    }
    const sourceRecipient = sourceIds[0]
      ? recipientsById.get(sourceIds[0]) ?? recipientFor(input.context, sourceIds[0])
      : undefined
    if (sourceRecipient) recipientsById.set(sourceRecipient.placement.id, sourceRecipient)
    const recipientResults = reduceCombatStageEffect({
      operation,
      recipients,
      ...(sourceRecipient ? { sourceRecipient } : {}),
      accumulator,
      immunities: input.immunities ?? ALLOW_ALL_IMMUNITIES,
      ...(input.accuracyRolls ? { accuracyRolls: input.accuracyRolls } : {}),
      priorOperationResults: moveResults,
      sourceOwnerId: input.context.actor.placement.id,
      abilityRules: {
        has: (placementId, canonicalId) => input.context.queries.effectiveAbilities.has(placementId, canonicalId),
      },
    })
    recipientResults.forEach(result => recordMoveCoreTokenEffectTouches(
      touches,
      result,
      operation,
      operationOrder,
    ))
    const outcome = recipientResults.some(result => result.outcome === 'applied')
      ? 'applied'
      : recipientResults.some(result => result.outcome === 'prevented')
        ? 'prevented'
        : 'no-op'
    const moveResult: MoveCoreTokenEffectOperationResult = {
      operationId: operation.id,
      operationKind: 'combat-stage',
      phase: operation.phase,
      reasonCode: operation.reasonCode,
      recipientIds: effect.recipientIds,
      outcome,
      recipients: recipientResults,
    }
    moveResults.push(moveResult)
    operationResults.push(Object.freeze({
      operationId: moveResult.operationId,
      operationKind: 'combat-stage',
      phase: effect.phase,
      reasonCode: moveResult.reasonCode,
      recipientIds: moveResult.recipientIds,
      outcome: moveResult.outcome,
      recipients: moveResult.recipients,
    }))
  })

  const plan = buildCoreTokenStateChanges({
    map: input.context.map,
    placements: input.context.placements,
    time: input.context.time,
    recipientsById,
    touches,
    hpUpdates: [],
    conditionUpdates: [],
    stageUpdates: accumulator.toUpdates(),
    encounterStateUpdate: null,
    effectiveSoullessPlacementIds: new Set(),
  })
  return Object.freeze({
    plan,
    operationResults: Object.freeze(operationResults),
  })
}
