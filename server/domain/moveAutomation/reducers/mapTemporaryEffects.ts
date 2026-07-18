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
import {
  VORTEX_REASON_CODES,
  createVortexEffect,
  resolveVortexApplication,
} from '../vortex'
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

interface MaterializedTemporaryEffect {
  readonly effect: EncounterEffect | null
  readonly reasonCode: string
  readonly blockedBy: string | null
}

const materializeEffect = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveTemporaryEffectOperation
  readonly recipientIds: readonly string[]
  readonly faintedRecipientIds: readonly string[]
}): MaterializedTemporaryEffect => {
  if (input.operation.payload.action !== 'add') {
    return failMoveMapOperationReduction(
      'temporary-effect-invalid',
      `Temporary-effect operation ${input.operation.id} is not an add operation.`,
    )
  }
  if (input.recipientIds.length === 0) {
    return {
      effect: null,
      reasonCode: 'temporary-effect.no-recipients',
      blockedBy: null,
    }
  }
  const definition = input.operation.payload.definition
  if (definition.kind === 'vortex') {
    if (input.recipientIds.length !== 1) {
      return failMoveMapOperationReduction(
        'temporary-effect-invalid',
        `Vortex operation ${input.operation.id} must address exactly one authoritative placement.`,
      )
    }
    const targetPlacementId = input.recipientIds[0]!
    if (input.faintedRecipientIds.includes(targetPlacementId)) {
      return {
        effect: null,
        reasonCode: VORTEX_REASON_CODES.targetKnockedOut,
        blockedBy: 'target knocked out',
      }
    }
    const target = input.context.queries.tokens.get(targetPlacementId)
    if (!target) {
      return failMoveMapOperationReduction(
        'temporary-effect-invalid',
        `Vortex operation ${input.operation.id} cannot resolve target ${targetPlacementId}.`,
      )
    }
    const decision = resolveVortexApplication({ target, definition })
    return {
      effect: decision.applies
        ? createVortexEffect({
            definition,
            operationId: input.operation.id,
            moveId: input.operation.source.id,
            sourcePlacementId: input.context.actor.placement.id,
            targetPlacementId,
            createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
            createdTurn: input.context.map.encounterState?.history.currentTurn?.turn ?? 0,
          })
        : null,
      reasonCode: decision.reasonCode,
      blockedBy: decision.blockedBy,
    }
  }

  const actorSide = input.operation.payload.recipientScope === 'actor-side'
    ? actorSideAffected(input)
    : null
  try {
    return {
      effect: parseEncounterEffect({
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
    }, `temporaryEffectOperation.${input.operation.id}.effect`),
      reasonCode: input.operation.reasonCode,
      blockedBy: null,
    }
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
  readonly faintedRecipientIds?: readonly string[]
}): MoveTemporaryEffectReduction => {
  const previous = parseEncounterState(input.previous ?? createEmptyEncounterState())
  try {
    const materialized = input.operation.payload.action === 'add'
      ? materializeEffect({
          ...input,
          faintedRecipientIds: input.faintedRecipientIds ?? [],
        })
      : null
    const incoming = materialized?.effect ?? null
    const transition = input.operation.payload.action === 'add'
      ? incoming
        ? applyEncounterEffectLifecycleEvent(
            { effects: previous.effects },
            {
              kind: 'effect-applied',
              effect: incoming,
            },
          )
        : { effects: previous.effects, changed: false, transitions: [] }
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
        ...(materialized !== null
          && input.operation.payload.action === 'add'
          && input.operation.payload.definition.kind === 'vortex'
          ? {
              reasonCode: materialized.reasonCode,
              blockedBy: materialized.blockedBy,
            }
          : {}),
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
