import { createHash } from 'node:crypto'
import type {
  MoveConditionEffectOperation,
  MoveDirectHpEffectOperation,
  MoveEffectOperation,
  MoveHealEffectOperation,
  MoveReactionRequestEffectOperation,
  MoveRollEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import {
  AA068_DRAGONS_MAW_REASON,
  AA068_DREAM_SMOKE_REASON,
  AA068_DROWN_OUT_REASON,
  AA068_DRY_SKIN_FIRE_REASON,
  AA068_DRY_SKIN_WATER_REASON,
  AA068_EFFECT_SPORE_REASON,
  aa068IsDamagingMove,
  aa068IsMeleeAttack,
  aa068IsSonicMove,
} from './aa068StaticIntegration'

const hash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const sceneUseAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly limit: number
}): boolean => {
  const sceneId = input.context.map.encounterState?.history.sceneId
  const usage = input.context.map.encounterState?.abilityUsage
  const entry = usage && usage.sceneId === sceneId ? usage.entries.find(candidate => (
    candidate.ownerId === input.ownerId
    && candidate.abilityInstanceId === input.abilityInstanceId
    && candidate.canonicalId === input.canonicalId
    && candidate.clauseId === 'base'
  )) : undefined
  return Boolean(sceneId) && (entry?.spent ?? 0) < input.limit
}

const availableAbility = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly canonicalId: string
  readonly limit?: number
}) => {
  const ability = input.context.queries.abilities.activeForPlacement(input.ownerId)
    .find(candidate => candidate.canonicalId === input.canonicalId)
  return ability
    && input.context.queries.resources.actionAvailable(input.ownerId, 'free')
    && sceneUseAvailable({
      ...input,
      abilityInstanceId: ability.instanceId,
      limit: input.limit ?? 1,
    })
    ? ability
    : null
}

const request = (input: {
  readonly id: string
  readonly sourceId: string
  readonly reasonCode: string
  readonly promptKey: string
  readonly optionId: string
  readonly optionLabelKey: string
  readonly timing: 'declare' | 'post-hit'
  readonly priority: number
  readonly ownerId: string
  readonly cancellation?: { readonly kind: 'cancel-move'; readonly retainTriggeringUsage: true }
}): MoveReactionRequestEffectOperation => ({
  id: input.id,
  kind: 'reaction-request',
  source: { kind: 'lifecycle-event', id: input.sourceId },
  recipients: { kind: 'none' },
  phase: input.timing === 'declare' ? 'declare' : 'hit',
  reasonCode: input.reasonCode,
  payload: {
    requestId: `${input.id}.response`,
    promptKey: input.promptKey,
    options: [{ id: input.optionId, labelKey: input.optionLabelKey }],
    allowPass: true,
    timing: input.timing,
    priority: input.priority,
    ownerPlacementIds: [input.ownerId],
    ...(input.cancellation ? { cancellation: input.cancellation } : {}),
  },
})

const condition = (input: {
  readonly id: string
  readonly requestId: string
  readonly reasonCode: string
  readonly conditionId: string | null
  readonly randomChoice?: { readonly rollId: string; readonly conditionIds: readonly string[] }
  readonly applyMoveImmunity?: boolean
  readonly applyTypeImmunity?: boolean
}): MoveConditionEffectOperation => ({
  id: input.id,
  kind: 'condition',
  source: { kind: 'operation', id: input.requestId },
  recipients: { kind: 'response-owner' },
  phase: 'after-damage',
  reasonCode: input.reasonCode,
  payload: {
    action: input.randomChoice ? 'random-choice' : 'apply',
    conditionId: input.conditionId,
    conditionSource: null,
    filter: null,
    randomChoice: input.randomChoice ?? null,
    applyMoveImmunity: input.applyMoveImmunity ?? true,
    applyTypeImmunity: input.applyTypeImmunity ?? true,
    duration: null,
    saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
  },
})

const drySkinOperation = (input: {
  readonly targetId: string
  readonly suffix: string
  readonly moveType: 'fire' | 'water'
}): MoveDirectHpEffectOperation | MoveHealEffectOperation => input.moveType === 'fire'
  ? {
      id: `ability.dry-skin.fire.${input.suffix}`,
      kind: 'direct-hp',
      source: { kind: 'lifecycle-event', id: `ability.dry-skin.target:${input.targetId}` },
      recipients: { kind: 'hit-targets' },
      phase: 'after-damage',
      reasonCode: AA068_DRY_SKIN_FIRE_REASON,
      payload: {
        mode: 'lose', pool: 'hit-points',
        calculation: { kind: 'percent-max', percent: 10 },
        copySource: null,
        bounds: { minimum: 0, maximum: null },
        rounding: 'floor',
        applyTypeImmunity: false,
        cost: null,
        injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
      },
    }
  : {
      id: `ability.dry-skin.water.${input.suffix}`,
      kind: 'heal',
      source: { kind: 'lifecycle-event', id: `ability.dry-skin.target:${input.targetId}` },
      recipients: { kind: 'hit-targets' },
      phase: 'after-damage',
      reasonCode: AA068_DRY_SKIN_WATER_REASON,
      payload: {
        mode: 'gain', pool: 'hit-points',
        calculation: { kind: 'percent-max', percent: 10 },
        bounds: { minimum: 0, maximum: null },
        rounding: 'floor',
        injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
      },
    }

/** Exact manifest-selected AA-068 operations attached to root and nested native moves. */
export const aa068MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const moveIdentity = input.context.resolutionId ?? input.script.moveName
  const targets = [...new Set(input.authoritativeTargetIds)].sort()
  const damaging = aa068IsDamagingMove(input.script)

  const dragonsMaw = damaging && input.script.type.trim().toLowerCase() === 'dragon'
    ? availableAbility({
        context: input.context, ownerId: actorId,
        canonicalId: 'Dragon’s Maw', limit: 2,
      })
    : null
  if (dragonsMaw) {
    for (const targetId of targets) {
      const suffix = hash(moveIdentity, actorId, targetId, dragonsMaw.instanceId)
      operations.push(request({
        id: `ability.dragons-maw.request.${suffix}`,
        sourceId: `ability.dragons-maw.target:${targetId}`,
        reasonCode: AA068_DRAGONS_MAW_REASON,
        promptKey: 'ability.dragons-maw.use',
        optionId: 'ability.dragons-maw.use',
        optionLabelKey: 'ability.dragons-maw.make-target-vulnerable',
        timing: 'post-hit', priority: 99, ownerId: actorId,
      }))
    }
  }

  if (aa068IsSonicMove(input.script)) {
    for (const placement of input.context.queries.placements.all()) {
      if (placement.id === actorId
        || input.context.queries.relationships.resolve(placement.id, actorId).relationship !== 'enemy') continue
      const ability = availableAbility({
        context: input.context, ownerId: placement.id,
        canonicalId: 'Drown Out', limit: 2,
      })
      if (!ability) continue
      const suffix = hash(moveIdentity, placement.id, ability.instanceId)
      operations.push(request({
        id: `ability.drown-out.request.${suffix}`,
        sourceId: `ability.drown-out.owner:${placement.id}`,
        reasonCode: AA068_DROWN_OUT_REASON,
        promptKey: 'ability.drown-out.reaction-response',
        optionId: 'ability.drown-out.use',
        optionLabelKey: 'ability.drown-out.cancel-sonic-move',
        timing: 'declare', priority: 900, ownerId: placement.id,
        cancellation: { kind: 'cancel-move', retainTriggeringUsage: true },
      }))
    }
  }

  const melee = aa068IsMeleeAttack(input.script)
  for (const targetId of targets) {
    if (melee) {
      const dreamSmoke = availableAbility({
        context: input.context, ownerId: targetId, canonicalId: 'Dream Smoke',
      })
      if (dreamSmoke) {
        const suffix = hash(moveIdentity, actorId, targetId, dreamSmoke.instanceId)
        const requestId = `ability.dream-smoke.request.${suffix}`
        operations.push(request({
          id: requestId,
          sourceId: `ability.dream-smoke.target:${targetId}`,
          reasonCode: AA068_DREAM_SMOKE_REASON,
          promptKey: 'ability.dream-smoke.use',
          optionId: 'ability.dream-smoke.use',
          optionLabelKey: 'ability.dream-smoke.put-attacker-to-sleep',
          timing: 'post-hit', priority: 90, ownerId: targetId,
        }), condition({
          id: `ability.dream-smoke.asleep.${suffix}`,
          requestId,
          reasonCode: 'ability.dream-smoke.sleep-attacker',
          conditionId: 'sleep',
          applyMoveImmunity: false,
          applyTypeImmunity: false,
        }))
      }

      const effectSpore = availableAbility({
        context: input.context, ownerId: targetId, canonicalId: 'Effect Spore',
      })
      if (effectSpore) {
        const suffix = hash(moveIdentity, actorId, targetId, effectSpore.instanceId)
        const requestId = `ability.effect-spore.request.${suffix}`
        const rollId = `ability.effect-spore.roll.${suffix}`
        const roll: MoveRollEffectOperation = {
          id: rollId,
          kind: 'roll',
          source: { kind: 'operation', id: requestId },
          recipients: { kind: 'response-owner' },
          phase: 'after-damage',
          reasonCode: 'ability.effect-spore.roll-condition',
          payload: {
            rollId: `${rollId}.d6`,
            formula: { kind: 'dice', count: 1, sides: 6, modifier: 0 },
          },
        }
        operations.push(request({
          id: requestId,
          sourceId: `ability.effect-spore.target:${targetId}`,
          reasonCode: AA068_EFFECT_SPORE_REASON,
          promptKey: 'ability.effect-spore.use',
          optionId: 'ability.effect-spore.use',
          optionLabelKey: 'ability.effect-spore.roll-condition',
          timing: 'post-hit', priority: 80, ownerId: targetId,
        }), roll, condition({
          id: `ability.effect-spore.condition.${suffix}`,
          requestId,
          reasonCode: 'ability.effect-spore.apply-condition',
          conditionId: null,
          randomChoice: {
            rollId: `${rollId}.d6`,
            conditionIds: ['poisoned', 'poisoned', 'paralyzed', 'paralyzed', 'sleep', 'sleep'],
          },
          applyMoveImmunity: false,
          applyTypeImmunity: false,
        }))
      }
    }

    if (damaging && input.context.queries.abilities.has(targetId, 'Dry Skin')) {
      const type = input.script.type.trim().toLowerCase()
      if (type === 'fire' || type === 'water') {
        operations.push(drySkinOperation({
          targetId,
          suffix: hash(moveIdentity, actorId, targetId, type),
          moveType: type,
        }))
      }
    }
  }

  return Object.freeze(operations)
}

export const aa068TargetBoundOperationTargetId = (
  operation: Pick<MoveEffectOperation, 'source'>,
): string | null => {
  if (operation.source.kind !== 'lifecycle-event') return null
  for (const prefix of [
    'ability.dragons-maw.target:',
    'ability.dream-smoke.target:',
    'ability.effect-spore.target:',
    'ability.dry-skin.target:',
  ]) {
    if (operation.source.id.startsWith(prefix)) return operation.source.id.slice(prefix.length)
  }
  return null
}
