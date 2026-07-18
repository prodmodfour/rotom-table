import {
  parseEncounterEffect,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterSideId,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import type { MoveTemporaryEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveResolutionTraceJsonValue } from '#shared/moveAutomation/trace'
import type { AuthoritativeMoveRulesContext } from '../context'
import {
  applyEncounterEffectLifecycleEvent,
  EncounterEffectLifecycleError,
} from '../effectLifecycle'
import { failMoveMapOperationReduction } from './mapOperationError'

export interface MoveTemporaryEffectReduction {
  readonly current: EncounterState
  readonly changed: boolean
  readonly details: MoveResolutionTraceJsonValue
}

const actorSideAffected = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveTemporaryEffectOperation
  readonly recipientIds: readonly string[]
}): { readonly effectId: string; readonly sideIds: readonly [EncounterSideId] } => {
  const actorId = input.context.actor.placement.id
  if (input.recipientIds.length !== 1 || input.recipientIds[0] !== actorId) {
    return failMoveMapOperationReduction(
      'temporary-effect-invalid',
      `Actor-side temporary-effect operation ${input.operation.id} must address only its authoritative actor.`,
    )
  }
  const sideId = input.context.queries.relationships.resolve(actorId, actorId).sourceSideId
  if (!sideId) {
    return failMoveMapOperationReduction(
      'temporary-effect-invalid',
      `Actor-side temporary-effect operation ${input.operation.id} requires an explicit encounter side.`,
    )
  }
  return {
    effectId: `${input.operation.payload.effectId}.${sideId}`,
    sideIds: [sideId],
  }
}

const materializeEffect = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveTemporaryEffectOperation
  readonly recipientIds: readonly string[]
}): EncounterEffect => {
  if (input.operation.payload.action !== 'add') {
    return failMoveMapOperationReduction(
      'temporary-effect-invalid',
      `Temporary-effect operation ${input.operation.id} is not an add operation.`,
    )
  }
  if (input.recipientIds.length === 0) {
    return failMoveMapOperationReduction(
      'temporary-effect-invalid',
      `Temporary-effect operation ${input.operation.id} must resolve at least one affected placement.`,
    )
  }
  const definition = input.operation.payload.definition
  const actorSide = input.operation.payload.recipientScope === 'actor-side'
    ? actorSideAffected(input)
    : null
  try {
    return parseEncounterEffect({
      id: actorSide?.effectId ?? input.operation.payload.effectId,
      kind: definition.kind,
      source: {
        operationId: input.operation.id,
        moveId: input.operation.source.id,
        placementId: input.context.actor.placement.id,
      },
      affected: {
        placementIds: actorSide ? [] : [...input.recipientIds],
        sideIds: actorSide?.sideIds ?? [],
        cells: [],
      },
      createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
      createdTurn: input.context.map.encounterState?.history.currentTurn?.turn ?? 0,
      duration: definition.duration,
      stacks: definition.stacks,
      charges: definition.charges,
      stackPolicy: definition.stackPolicy,
      chargePolicy: definition.chargePolicy,
      tags: definition.tags,
      payload: definition.payload,
      dispel: definition.dispel,
      ...(definition.transferPolicy === undefined
        ? {}
        : { transferPolicy: definition.transferPolicy }),
      suppression: { sources: [] },
    }, `temporaryEffectOperation.${input.operation.id}.effect`)
  }
  catch (error) {
    return failMoveMapOperationReduction(
      'temporary-effect-invalid',
      `Temporary-effect operation ${input.operation.id} could not materialize a typed encounter effect.`,
      error,
    )
  }
}

/** Materialize or remove one reviewed typed effect without mutating the map snapshot. */
export const reduceMoveTemporaryEffect = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly previous: EncounterState | null | undefined
  readonly operation: MoveTemporaryEffectOperation
  readonly recipientIds: readonly string[]
}): MoveTemporaryEffectReduction => {
  const previous = parseEncounterState(input.previous ?? createEmptyEncounterState())
  try {
    const incoming = input.operation.payload.action === 'add'
      ? materializeEffect(input)
      : null
    const transition = incoming
      ? applyEncounterEffectLifecycleEvent(
          { effects: previous.effects },
          {
            kind: 'effect-applied',
            effect: incoming,
          },
        )
      : applyEncounterEffectLifecycleEvent(
          { effects: previous.effects },
          {
            kind: 'effect-removed',
            effectId: input.operation.payload.effectId,
          },
        )
    const current = parseEncounterState({
      ...previous,
      effects: transition.effects,
    })
    return {
      current,
      changed: transition.changed,
      details: {
        action: input.operation.payload.action,
        effectId: incoming?.id ?? input.operation.payload.effectId,
        ...(input.operation.payload.action === 'add'
          && input.operation.payload.recipientScope !== undefined
          ? { recipientScope: input.operation.payload.recipientScope }
          : {}),
        transitionKinds: transition.transitions.map(item => item.kind),
      },
    }
  }
  catch (error) {
    if (error instanceof EncounterEffectLifecycleError) {
      return failMoveMapOperationReduction(
        'temporary-effect-conflict',
        `Temporary-effect operation ${input.operation.id} conflicts with encounter state: ${error.message}`,
        error,
      )
    }
    throw error
  }
}
