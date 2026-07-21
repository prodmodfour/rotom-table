import { createHash } from 'node:crypto'
import type { MoveCombatStageEffectOperation, MoveDirectHpEffectOperation, MoveEffectOperation, MoveReactionRequestEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import { aa065DampPrevents } from './aa065StaticIntegration'

const operationSuffix = (...parts: readonly string[]): string => createHash('sha256')
  .update(parts.join('\u0000')).digest('hex').slice(0, 24)

const sceneUseAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly instanceId: string
  readonly canonicalId: string
  readonly limit: number
}): boolean => {
  if (!input.context.map.encounterState?.history.sceneId) return false
  const entry = input.context.map.encounterState.abilityUsage?.entries.find(candidate => (
    candidate.ownerId === input.ownerId
    && candidate.abilityInstanceId === input.instanceId
    && candidate.canonicalId === input.canonicalId
    && candidate.clauseId === 'base'
  ))
  return (entry?.spent ?? 0) < input.limit
}

/**
 * Materialize optional AA-060 move checkpoints only from effective,
 * manifest-selected runtimes and current server-owned action/frequency state.
 */
export const aa060TriggeredMoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const damaging = input.script.damageClass === 'Physical' || input.script.damageClass === 'Special'
  if (!damaging) return Object.freeze([])
  const physical = input.script.damageClass === 'Physical'
  const operations: MoveEffectOperation[] = []
  for (const targetId of [...new Set(input.authoritativeTargetIds)].sort((a, b) => a.localeCompare(b))) {
    const abilities = input.context.queries.abilities.activeForPlacement(targetId)
    const addRequest = (
      ability: (typeof abilities)[number],
      operation: MoveReactionRequestEffectOperation,
      frequency: 'scene' | 'at-will' = 'scene',
    ): boolean => {
      if (!input.context.queries.resources.actionAvailable(targetId, 'free')
        || (frequency === 'scene' && !sceneUseAvailable({
          context: input.context,
          ownerId: targetId,
          instanceId: ability.instanceId,
          canonicalId: ability.canonicalId,
          limit: 1,
        }))) return false
      operations.push(operation)
      return true
    }
    const absorbForce = abilities.find(candidate => candidate.canonicalId === 'Absorb Force')
    if (physical && absorbForce) {
      const suffix = operationSuffix(
        input.context.resolutionId ?? input.script.moveName,
        targetId,
        absorbForce.instanceId,
        'Absorb Force',
      )
      addRequest(absorbForce, {
        id: `ability.absorb-force.request.${suffix}`,
        kind: 'reaction-request',
        source: { kind: 'move', id: input.moveSourceId },
        recipients: { kind: 'none' },
        phase: 'damage',
        reasonCode: 'ability.absorb-force.optional-resistance',
        payload: {
          requestId: `ability.absorb-force.response.${suffix}`,
          promptKey: 'ability.absorb-force.use',
          options: [{ id: 'ability.absorb-force.use', labelKey: 'ability.absorb-force.resist-physical' }],
          allowPass: true,
          timing: 'pre-damage',
          priority: 100,
          ownerPlacementIds: [targetId],
        },
      })
    }
    const aftermath = abilities.find(candidate => candidate.canonicalId === 'Aftermath')
    if (aftermath && targetId !== input.context.actor.placement.id
      && !aa065DampPrevents({ context: input.context, subjectPlacementId: targetId })) {
      const suffix = operationSuffix(
        input.context.resolutionId ?? input.script.moveName,
        targetId,
        aftermath.instanceId,
        'Aftermath',
      )
      const requestId = `ability.aftermath.request.${suffix}`
      const added = addRequest(aftermath, {
        id: requestId,
        kind: 'reaction-request',
        source: { kind: 'move', id: input.moveSourceId },
        recipients: { kind: 'none' },
        phase: 'ko',
        reasonCode: 'ability.aftermath.optional-hp-loss',
        payload: {
          requestId: `ability.aftermath.response.${suffix}`,
          promptKey: 'ability.aftermath.use',
          options: [{ id: 'ability.aftermath.use', labelKey: 'ability.aftermath.lose-three-ticks-burst' }],
          allowPass: true,
          timing: 'ko',
          priority: 90,
          ownerPlacementIds: [targetId],
        },
      })
      if (added) {
        const hpOperation: MoveDirectHpEffectOperation = {
          id: `ability.aftermath.hp-loss.${suffix}`,
          kind: 'direct-hp',
          source: { kind: 'operation', id: requestId },
          recipients: { kind: 'response-owner' },
          phase: 'ko',
          reasonCode: 'ability.aftermath.three-tick-burst',
          payload: {
            mode: 'lose', pool: 'hit-points',
            calculation: { kind: 'percent-max', percent: 30 },
            copySource: null,
            bounds: { minimum: 0, maximum: null },
            rounding: 'floor',
            applyTypeImmunity: false,
            cost: null,
            injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
          },
        }
        operations.push(hpOperation)
      }
    }
    const angerPoint = abilities.find(candidate => candidate.canonicalId === 'Anger Point')
    if (angerPoint) {
      const suffix = operationSuffix(
        input.context.resolutionId ?? input.script.moveName,
        targetId,
        angerPoint.instanceId,
        'Anger Point',
      )
      const requestId = `ability.anger-point.request.${suffix}`
      const added = addRequest(angerPoint, {
        id: requestId,
        kind: 'reaction-request',
        source: { kind: 'move', id: input.moveSourceId },
        recipients: { kind: 'none' },
        phase: 'after-damage',
        reasonCode: 'ability.anger-point.optional-attack-stage',
        payload: {
          requestId: `ability.anger-point.response.${suffix}`,
          promptKey: 'ability.anger-point.use',
          options: [{ id: 'ability.anger-point.use', labelKey: 'ability.anger-point.raise-attack' }],
          allowPass: true,
          timing: 'post-damage',
          priority: 80,
          ownerPlacementIds: [targetId],
        },
      }, 'at-will')
      if (added) {
        const stageOperation: MoveCombatStageEffectOperation = {
          id: `ability.anger-point.attack-stage.${suffix}`,
          kind: 'combat-stage',
          source: { kind: 'operation', id: requestId },
          recipients: { kind: 'response-owner' },
          phase: 'after-damage',
          reasonCode: 'ability.anger-point.raise-attack',
          payload: {
            action: 'modify', stage: 'atk', selectedStage: null,
            value: 6, stageSource: null, rounding: null,
          },
        }
        operations.push(stageOperation)
        operations.push({
          id: `ability.anger-point.enraged.${suffix}`,
          kind: 'condition',
          source: { kind: 'operation', id: requestId },
          recipients: { kind: 'response-owner' },
          phase: 'after-damage',
          reasonCode: 'ability.anger-point.enraged',
          payload: {
            action: 'apply', conditionId: 'enraged', conditionSource: null,
            filter: null, randomChoice: null, duration: null,
            saveTiming: 'canonical', stackPolicy: { kind: 'refresh', maxStacks: null },
          },
        })
      }
    }
  }
  return Object.freeze(operations)
}
