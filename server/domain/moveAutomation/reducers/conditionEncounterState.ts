import { createHash } from 'node:crypto'
import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  parseEncounterEffect,
  type EncounterConditionEffect,
} from '#shared/moveAutomation/encounterEffects'
import type { MoveConditionEffectOperation } from '#shared/moveAutomation/effects'
import type { MistyTerrainConditionProtection } from '#shared/moveAutomation/terrain'
import { projectEffectiveConditions } from '~/utils/encounterConditions'
import { conditionLookupKey } from '~/utils/statusConditions'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import type { AuthoritativeMoveRulesContext } from '../context'
import {
  applyEncounterEffectLifecycleEvent,
  type EncounterEffectLifecycleTransition,
} from '../effectLifecycle'
import { failMoveCoreConditionReduction } from './conditionError'
import {
  createMistyTerrainConditionProtectionEffects,
} from '../terrainConditionProtection'
import { canonicalMoveCondition, resolvedMoveConditionSaveTiming } from './conditionRules'
import type { MoveCoreTokenEffectRecipient } from './coreTokenEffectTypes'

export interface MoveConditionEncounterStateUpdate {
  readonly previous: EncounterState
  readonly current: EncounterState
}

export interface MoveConditionEncounterStateAccumulator {
  readonly previous: EncounterState
  current(): EncounterState
  apply(effect: EncounterConditionEffect): {
    readonly changed: boolean
    readonly transitions: readonly EncounterEffectLifecycleTransition[]
  }
  remove(effectIds: readonly string[]): readonly string[]
  update(): MoveConditionEncounterStateUpdate | null
}

export const createMoveConditionEncounterStateAccumulator = (
  context: AuthoritativeMoveRulesContext,
): MoveConditionEncounterStateAccumulator => {
  const previous = parseEncounterState(context.map.encounterState ?? createEmptyEncounterState())
  let current = deepCloneJson(previous)

  return {
    previous,
    current: () => parseEncounterState(current),
    apply: (effect) => {
      const result = applyEncounterEffectLifecycleEvent(
        { effects: current.effects },
        { kind: 'effect-applied', effect },
      )
      current = parseEncounterState({ ...current, effects: result.effects })
      return {
        changed: result.changed,
        transitions: result.transitions,
      }
    },
    remove: (effectIds) => {
      const removed: string[] = []
      for (const effectId of effectIds) {
        if (!current.effects.some(effect => effect.id === effectId)) continue
        const result = applyEncounterEffectLifecycleEvent(
          { effects: current.effects },
          { kind: 'effect-removed', effectId },
        )
        current = parseEncounterState({ ...current, effects: result.effects })
        if (result.changed) removed.push(effectId)
      }
      return removed
    },
    update: () => sameJsonValue(previous, current)
      ? null
      : { previous: deepCloneJson(previous), current: parseEncounterState(current) },
  }
}

const conditionTarget = (recipient: MoveCoreTokenEffectRecipient) => ({
  placementId: recipient.placement.id,
  ...(recipient.placement.sideId ? { sideId: recipient.placement.sideId } : {}),
  position: recipient.token.position,
  base: recipient.token.base,
  clearance: recipient.token.clearance,
})

export const effectiveMoveConditions = (options: {
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly persistent: readonly string[]
  readonly encounter: MoveConditionEncounterStateAccumulator | undefined
}): readonly string[] => projectEffectiveConditions({
  sheetConditions: options.persistent,
  encounterEffects: options.encounter?.current().effects,
  target: conditionTarget(options.recipient),
}).conditions

export const directMoveConditionEffects = (options: {
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly encounter: MoveConditionEncounterStateAccumulator | undefined
  readonly matches: (condition: string) => boolean
}): readonly EncounterConditionEffect[] => (options.encounter?.current().effects ?? [])
  .flatMap((effect): EncounterConditionEffect[] => {
    if (
      effect.kind !== 'condition'
      || effect.payload.action !== 'apply'
      || effect.affected.placementIds.length !== 1
      || effect.affected.placementIds[0] !== options.recipient.placement.id
      || effect.affected.sideIds.length > 0
      || effect.affected.cells.length > 0
    ) {
      return []
    }
    const condition = canonicalMoveCondition(effect.payload.conditionId)
    return options.matches(condition) ? [effect] : []
  })

const boundedRound = (context: AuthoritativeMoveRulesContext): number => (
  Math.max(1, context.map.initiative?.round ?? 1)
)

const boundedTurn = (context: AuthoritativeMoveRulesContext): number => (
  context.map.encounterState?.history.currentTurn?.turn ?? 0
)

const effectInstanceId = (options: {
  readonly baseId: string
  readonly recipientId: string
  readonly independentKey?: string
}): string => {
  const digest = createHash('sha256')
    .update(`${options.baseId}:${options.recipientId}:${options.independentKey ?? ''}`)
    .digest('hex')
    .slice(0, 32)
  return `condition.${digest}`
}

export const createSourceLinkedMoveConditionEffect = (options: {
  readonly operation: MoveConditionEffectOperation
  readonly condition: string
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly context: AuthoritativeMoveRulesContext
}): EncounterConditionEffect => {
  const duration = options.operation.payload.duration
    ?? failMoveCoreConditionReduction(
      'invalid-condition-effect-scope',
      `Condition operation ${options.operation.id} has no source-linked duration.`,
    )
  const independentKey = options.operation.payload.stackPolicy.kind === 'independent-instance'
    ? options.context.idFactory()
    : undefined
  return parseEncounterEffect({
    id: effectInstanceId({
      baseId: duration.effectId,
      recipientId: options.recipient.placement.id,
      ...(independentKey ? { independentKey } : {}),
    }),
    kind: 'condition',
    source: {
      operationId: options.operation.id,
      moveId: options.operation.source.id,
      placementId: options.context.actor.placement.id,
    },
    affected: {
      placementIds: [options.recipient.placement.id],
      sideIds: [],
      cells: [],
    },
    createdRound: boundedRound(options.context),
    createdTurn: boundedTurn(options.context),
    duration: duration.duration,
    stacks: 1,
    charges: null,
    stackPolicy: options.operation.payload.stackPolicy,
    chargePolicy: { kind: 'none', amount: null },
    tags: ['condition'],
    payload: {
      conditionId: conditionLookupKey(options.condition),
      action: 'apply',
      saveTiming: resolvedMoveConditionSaveTiming(options.condition, options.operation),
    },
    dispel: { policy: 'matching-tags', tags: ['condition'] },
    ...(duration.transferPolicy === undefined
      ? {}
      : { transferPolicy: duration.transferPolicy }),
    suppression: { sources: [] },
  }, `conditionOperation.${options.operation.id}.effect`) as EncounterConditionEffect
}

export const createMistyProtectedMoveConditionEffects = (options: {
  readonly operation: MoveConditionEffectOperation
  readonly condition: string
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly context: AuthoritativeMoveRulesContext
  readonly protection: MistyTerrainConditionProtection
}): readonly EncounterConditionEffect[] => createMistyTerrainConditionProtectionEffects({
  protection: options.protection,
  conditionId: options.condition,
  operationId: options.operation.id,
  moveId: options.operation.source.id,
  sourcePlacementId: options.context.actor.placement.id,
  recipientPlacementId: options.recipient.placement.id,
  createdRound: boundedRound(options.context),
  createdTurn: boundedTurn(options.context),
})

export const createTransferredMoveConditionEffect = (options: {
  readonly operation: MoveConditionEffectOperation
  readonly sourceEffect: EncounterConditionEffect
  readonly destination: MoveCoreTokenEffectRecipient
  readonly context: AuthoritativeMoveRulesContext
}): EncounterConditionEffect => parseEncounterEffect({
  ...options.sourceEffect,
  id: effectInstanceId({
    baseId: `${options.operation.id}.${options.sourceEffect.id}`,
    recipientId: options.destination.placement.id,
  }),
  source: {
    operationId: options.operation.id,
    moveId: options.operation.source.id,
    placementId: options.context.actor.placement.id,
  },
  affected: {
    placementIds: [options.destination.placement.id],
    sideIds: [],
    cells: [],
  },
  createdRound: boundedRound(options.context),
  createdTurn: boundedTurn(options.context),
  stackPolicy: options.operation.payload.stackPolicy,
  suppression: { sources: [] },
}, `conditionOperation.${options.operation.id}.transferredEffect`) as EncounterConditionEffect
