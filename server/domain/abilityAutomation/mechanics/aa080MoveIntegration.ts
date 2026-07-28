import { createHash } from 'node:crypto'
import type {
  MoveCombatStageEffectOperation,
  MoveEffectOperation,
  MoveReactionRequestEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA080_MOTOR_DRIVE_STAGE_REASON = 'ability.motor-drive.raise-speed-on-electric-hit' as const
export const AA080_MOXIE_REQUEST_REASON = 'ability.moxie.optional-attack-stage' as const
export const AA080_MIRROR_ARMOR_REQUEST_REASON = 'ability.mirror-armor.optional-reflection' as const
export const AA080_MIRROR_ARMOR_REFLECT_REASON = 'ability.mirror-armor.reflect-stage-loss' as const
export const AA080_MINUS_REQUEST_REASON = 'ability.minus.optional-additional-stage-loss' as const
export const AA080_MINUS_STAGE_REASON = 'ability.minus.apply-additional-stage-loss' as const

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const motorDriveStage = (input: {
  readonly moveIdentity: string
  readonly ownerId: string
  readonly abilityInstanceId: string
}): MoveCombatStageEffectOperation => ({
  id: `ability.motor-drive.speed.${shortHash(input.moveIdentity, input.ownerId, input.abilityInstanceId)}`,
  kind: 'combat-stage',
  source: { kind: 'lifecycle-event', id: `ability.motor-drive.target:${input.ownerId}` },
  recipients: { kind: 'hit-targets' },
  phase: 'after-damage',
  reasonCode: AA080_MOTOR_DRIVE_STAGE_REASON,
  payload: {
    action: 'modify', stage: 'spd', selectedStage: null, value: 1,
    stageSource: null, rounding: null, applyTypeImmunity: false,
  },
})

export const aa080MotorDriveOwnerForOperation = (
  operation: Pick<MoveEffectOperation, 'reasonCode' | 'source'>,
): string | null => operation.reasonCode === AA080_MOTOR_DRIVE_STAGE_REASON
  && operation.source.kind === 'lifecycle-event'
  && operation.source.id.startsWith('ability.motor-drive.target:')
  ? operation.source.id.slice('ability.motor-drive.target:'.length)
  : null

const requestTiming = Object.freeze({ phase: 'hit' as const, timing: 'post-hit' as const })

const moxieOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly moveIdentity: string
}): readonly MoveEffectOperation[] => {
  const actorId = input.context.actor.placement.id
  const ability = input.context.queries.abilities.activeForPlacement(actorId)
    .find(candidate => candidate.canonicalId === 'Moxie')
  if (!ability) return Object.freeze([])
  const suffix = shortHash(input.moveIdentity, actorId, ability.instanceId)
  const requestId = `ability.moxie.request.${suffix}`
  return Object.freeze([{
    id: requestId,
    kind: 'reaction-request',
    source: { kind: 'lifecycle-event', id: `ability.moxie.owner:${actorId}` },
    recipients: { kind: 'none' },
    phase: 'ko',
    reasonCode: AA080_MOXIE_REQUEST_REASON,
    payload: {
      requestId: `${requestId}.response`,
      promptKey: 'ability.moxie.use',
      options: [{ id: 'ability.moxie.use', labelKey: 'ability.moxie.raise-attack' }],
      allowPass: true,
      timing: 'ko',
      priority: 59,
      ownerPlacementIds: [actorId],
    },
  } satisfies MoveReactionRequestEffectOperation, {
    id: `ability.moxie.attack.${suffix}`,
    kind: 'combat-stage',
    source: { kind: 'operation', id: requestId },
    recipients: { kind: 'response-owner' },
    phase: 'ko',
    reasonCode: 'ability.moxie.raise-attack',
    payload: {
      action: 'modify', stage: 'atk', selectedStage: null, value: 1,
      stageSource: null, rounding: null, applyTypeImmunity: false,
    },
  } satisfies MoveCombatStageEffectOperation])
}

const mirrorArmorOperations = (input: {
  readonly sourceOperations: readonly MoveCombatStageEffectOperation[]
  readonly moveIdentity: string
  readonly ownerId: string
}): readonly MoveEffectOperation[] => {
  const suffix = shortHash(input.moveIdentity, input.ownerId, ...input.sourceOperations.map(operation => operation.id))
  const timing = requestTiming
  const request: MoveReactionRequestEffectOperation = {
    id: `ability.mirror-armor.request.${suffix}`,
    kind: 'reaction-request',
    source: { kind: 'lifecycle-event', id: `ability.mirror-armor.owner:${input.ownerId}` },
    recipients: { kind: 'none' },
    phase: timing.phase,
    reasonCode: AA080_MIRROR_ARMOR_REQUEST_REASON,
    payload: {
      requestId: `ability.mirror-armor.request.${suffix}.response`,
      promptKey: 'ability.mirror-armor.use',
      options: [{ id: 'ability.mirror-armor.use', labelKey: 'ability.mirror-armor.reflect' }],
      allowPass: true,
      timing: timing.timing,
      priority: 44,
      ownerPlacementIds: [input.ownerId],
    },
  }
  return Object.freeze([request, ...input.sourceOperations.map((sourceOperation, index) => ({
    ...sourceOperation,
    id: `ability.mirror-armor.stage.${suffix}.${index + 1}`,
    source: {
      kind: 'lifecycle-event' as const,
      id: `ability.mirror-armor.response:${request.id}:source:${sourceOperation.id}`,
    },
    recipients: { kind: 'actor' as const },
    phase: 'after-damage' as const,
    reasonCode: AA080_MIRROR_ARMOR_REFLECT_REASON,
  } satisfies MoveCombatStageEffectOperation))])
}

const minusOperations = (input: {
  readonly sourceOperations: readonly MoveCombatStageEffectOperation[]
  readonly moveIdentity: string
  readonly ownerId: string
  readonly targetId: string
}): readonly MoveEffectOperation[] => {
  const suffix = shortHash(input.moveIdentity, input.ownerId, input.targetId, ...input.sourceOperations.map(operation => operation.id))
  const timing = requestTiming
  const optionId = (sourceOperation: MoveCombatStageEffectOperation): string => input.sourceOperations.length === 1
    ? 'ability.minus.use'
    : `ability.minus.use-${shortHash(sourceOperation.id)}`
  const request: MoveReactionRequestEffectOperation = {
    id: `ability.minus.request.${suffix}`,
    kind: 'reaction-request',
    source: { kind: 'lifecycle-event', id: `ability.minus.target:${input.targetId}` },
    recipients: { kind: 'none' },
    phase: timing.phase,
    reasonCode: AA080_MINUS_REQUEST_REASON,
    payload: {
      requestId: `ability.minus.request.${suffix}.response`,
      promptKey: 'ability.minus.use',
      options: input.sourceOperations.map(sourceOperation => ({
        id: optionId(sourceOperation),
        labelKey: `ability.minus.lower-${sourceOperation.payload.stage ?? 'selected'}-stage`,
      })),
      allowPass: true,
      timing: timing.timing,
      priority: 43,
      ownerPlacementIds: [input.ownerId],
    },
  }
  return Object.freeze([request, ...input.sourceOperations.map((sourceOperation, index) => {
    const selectedOptionId = optionId(sourceOperation)
    return {
      ...sourceOperation,
      id: `ability.minus.stage.${suffix}.${index + 1}`,
      source: {
        kind: 'lifecycle-event' as const,
        id: `ability.minus.response:${request.id}:option:${selectedOptionId}:target:${input.targetId}`,
      },
      recipients: { kind: 'hit-targets' as const },
      phase: 'after-damage' as const,
      reasonCode: AA080_MINUS_STAGE_REASON,
      payload: { ...sourceOperation.payload, value: -1 },
    } satisfies MoveCombatStageEffectOperation
  })])
}

const stageReactions = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly reviewedOperations: readonly MoveEffectOperation[]
  readonly authoritativeTargetIds: readonly string[]
  readonly moveIdentity: string
}): readonly MoveEffectOperation[] => {
  const actorId = input.context.actor.placement.id
  const minusOwners = input.context.map.placements.flatMap(placement => (
    input.context.queries.abilities.has(placement.id, 'Minus') ? [placement.id] : []
  )).sort()
  const lowering = input.reviewedOperations.filter((effect): effect is MoveCombatStageEffectOperation => (
    effect.kind === 'combat-stage'
    && effect.payload.action === 'modify'
    && typeof effect.payload.value === 'number'
    && effect.payload.value < 0
    && ['atk', 'def', 'satk', 'sdef', 'spd', 'acc'].includes(effect.payload.stage ?? '')
  ))
  if (lowering.length === 0) return Object.freeze([])
  return Object.freeze([...new Set(input.authoritativeTargetIds)].sort().flatMap(targetId => {
    if (targetId === actorId) return []
    const mirror = input.context.queries.relationships.resolve(actorId, targetId).relationship === 'enemy'
      ? input.context.queries.abilities.activeForPlacement(targetId)
          .find(candidate => candidate.canonicalId === 'Mirror Armor')
      : null
    const target = input.context.queries.tokens.get(targetId)
    const nearbyMinusOwners = target ? minusOwners.filter(ownerId => {
      const owner = input.context.queries.tokens.get(ownerId)
      return ownerId !== targetId && owner !== null
        && input.context.queries.relationships.resolve(ownerId, targetId).relationship === 'enemy'
        && ptuGridDistanceBetweenFootprints(owner, target) <= 10
    }) : []
    return [
      ...(mirror ? mirrorArmorOperations({ sourceOperations: lowering, moveIdentity: input.moveIdentity, ownerId: targetId }) : []),
      ...nearbyMinusOwners.flatMap(ownerId => minusOperations({
        sourceOperations: lowering, moveIdentity: input.moveIdentity, ownerId, targetId,
      })),
    ]
  }))
}

/**
 * A reflected loss must remain unresolved until its durable post-hit response.
 * Move-authored losses that can reach Mirror Armor therefore execute at the
 * reviewed after-damage checkpoint, after the response has been accepted or
 * passed, without changing their relative order within that checkpoint.
 */
export const applyAa080ReviewedOperations = (
  operations: readonly MoveEffectOperation[],
): readonly MoveEffectOperation[] => {
  const deferredIds = new Set(operations.flatMap(operation => (
    operation.reasonCode === AA080_MIRROR_ARMOR_REFLECT_REASON
    && operation.source.kind === 'lifecycle-event'
    && operation.source.id.includes(':source:')
      ? [operation.source.id.slice(operation.source.id.indexOf(':source:') + ':source:'.length)]
      : []
  )))
  return Object.freeze(operations.map(operation => deferredIds.has(operation.id)
    && operation.kind === 'combat-stage'
    ? { ...operation, phase: 'after-damage' as const }
    : operation))
}

/** Rebuilt for immediate, nested, pending, multi-hit, and resumed execution. */
export const aa080MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
  readonly reviewedOperations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  const moveIdentity = input.context.resolutionId ?? `${input.moveSourceId}:${input.script.moveName}`
  const reactions = stageReactions({
    context: input.context,
    reviewedOperations: input.reviewedOperations,
    authoritativeTargetIds: input.authoritativeTargetIds,
    moveIdentity,
  })
  const moxie = moxieOperations({ context: input.context, moveIdentity })
  if (!input.script.damaging && input.script.type.trim().toLowerCase() !== 'electric') {
    return Object.freeze([...reactions, ...moxie])
  }
  return Object.freeze([...reactions, ...moxie, ...[...new Set(input.authoritativeTargetIds)].sort().flatMap(ownerId => {
    const ability = input.context.queries.abilities.activeForPlacement(ownerId)
      .find(candidate => candidate.canonicalId === 'Motor Drive')
    return ability ? [motorDriveStage({
      moveIdentity, ownerId, abilityInstanceId: ability.instanceId,
    })] : []
  })])
}
