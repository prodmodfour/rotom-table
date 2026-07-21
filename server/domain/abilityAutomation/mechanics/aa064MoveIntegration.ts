import { createHash } from 'node:crypto'
import type {
  MoveCombatStageEffectOperation,
  MoveChoiceRequestEffectOperation,
  MoveEffectOperation,
  MoveNestedMoveEffectOperation,
  MoveReactionRequestEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import { POKEMON_TYPE_IDS, type PokemonTypeId } from '#shared/pokemonTypes'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { effectivenessStepsFromMultiplier, multiplierFromEffectivenessSteps } from '~/utils/typeChart'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import { hasAa060MoveMark } from './aa060MoveIntegration'

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)
const COMBAT_STATS = Object.freeze([
  { optionId: 'attack', stage: 'atk' as const },
  { optionId: 'defense', stage: 'def' as const },
  { optionId: 'special-attack', stage: 'satk' as const },
  { optionId: 'special-defense', stage: 'sdef' as const },
  { optionId: 'speed', stage: 'spd' as const },
])
const sceneUseAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
}): boolean => {
  const sceneId = input.context.map.encounterState?.history.sceneId
  const usage = input.context.map.encounterState?.abilityUsage
  const entry = usage && usage.sceneId === sceneId ? usage.entries.find(candidate => (
    candidate.ownerId === input.ownerId
    && candidate.abilityInstanceId === input.abilityInstanceId
    && candidate.canonicalId === input.canonicalId
    && candidate.clauseId === 'base'
  )) : undefined
  return Boolean(sceneId) && (entry?.spent ?? 0) < 1
}
const canonicalMoveType = (
  context: AuthoritativeMoveRulesContext,
  script: MoveAutomationScript,
): PokemonTypeId | null => {
  const declared = script.type.trim().toLowerCase()
  const typeId = declared === 'normal' && hasAa060MoveMark(context, 'Aerilate', script.moveName)
    ? 'flying'
    : declared
  return POKEMON_TYPE_IDS.includes(typeId as PokemonTypeId) ? typeId as PokemonTypeId : null
}

/** Corrosion's exact Poison attack effectiveness replacement. */
export const aa064CorrosionMultiplier = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly moveType: string
  readonly multiplier: number
}): { readonly multiplier: number; readonly applied: boolean } => {
  if (input.moveType.trim().toLowerCase() !== 'poison'
    || !input.context.queries.abilities.has(input.context.actor.placement.id, 'Corrosion')) {
    return { multiplier: input.multiplier, applied: false }
  }
  if (input.multiplier === 0) return { multiplier: 0.25, applied: true }
  if (input.multiplier >= 1) return { multiplier: input.multiplier, applied: false }
  const steps = effectivenessStepsFromMultiplier(input.multiplier)
  return steps === null
    ? { multiplier: input.multiplier, applied: false }
    : { multiplier: multiplierFromEffectivenessSteps(Math.min(0, steps + 1)), applied: true }
}

/** Whether this active source may bypass only Poison/Steel poison-condition immunity. */
export const aa064CorrosionCanPoison = (input: {
  readonly context: AuthoritativeMoveRulesContext | undefined
  readonly condition: string
  readonly recipientTypes: readonly string[]
}): boolean => Boolean(
  input.context
  && ['poisoned', 'badly poisoned'].includes(input.condition.trim().toLowerCase())
  && input.context.queries.abilities.has(input.context.actor.placement.id, 'Corrosion')
  && input.recipientTypes.some(type => ['poison', 'steel'].includes(type.trim().toLowerCase())),
)

/** Exact AA-064 operations attached to root and nested native move programs. */
export const aa064MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const moveSourceId = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/.test(input.moveSourceId)
    ? input.moveSourceId
    : `move.${input.script.moveName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
  const actorAbilities = input.context.queries.abilities.activeForPlacement(actorId)
  const moveType = canonicalMoveType(input.context, input.script)

  if (moveType) {
    for (const targetId of input.authoritativeTargetIds) {
      const ability = input.context.queries.abilities.activeForPlacement(targetId)
        .find(candidate => candidate.canonicalId === 'Color Change')
      if (!ability || !input.context.queries.resources.actionAvailable(targetId, 'free')) continue
      const suffix = shortHash(input.context.resolutionId ?? input.script.moveName, targetId, ability.instanceId, 'color-change')
      const requestId = `ability.color-change.request.${suffix}`
      operations.push({
        id: requestId, kind: 'reaction-request', source: { kind: 'move', id: moveSourceId },
        recipients: { kind: 'none' }, phase: 'after-damage', reasonCode: 'ability.color-change.optional-type',
        payload: {
          requestId: `ability.color-change.response.${suffix}`, promptKey: 'ability.color-change.use',
          options: [{ id: 'ability.color-change.use', labelKey: `ability.color-change.type.${moveType}` }],
          allowPass: true, timing: 'post-damage', priority: 80, ownerPlacementIds: [targetId],
        },
      } satisfies MoveReactionRequestEffectOperation, {
        id: `ability.color-change.type.${suffix}`, kind: 'temporary-effect',
        source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
        phase: 'schedule', reasonCode: 'ability.color-change.replace-type',
        payload: {
          action: 'add', effectId: `ability.color-change.type.${targetId}`, recipientScope: 'placements',
          definition: {
            kind: 'creature-rule-overlay', duration: { kind: 'scene', remaining: null },
            stacks: 1, charges: null, stackPolicy: { kind: 'replace', maxStacks: null },
            chargePolicy: { kind: 'none', amount: null }, tags: ['ability', 'aa064', 'color-change', 'type'],
            payload: {
              domain: 'type', action: 'replace', values: [moveType],
              referencePlacementId: null, suppressionScope: null,
            },
            dispel: { policy: 'matching-tags', tags: ['color-change', 'type'] }, transferPolicy: 'expire',
          },
        },
      } satisfies MoveTemporaryEffectOperation)
    }
  }

  const comboStriker = actorAbilities.find(ability => ability.canonicalId === 'Combo Striker')
  if (comboStriker && input.script.damaging
    && input.context.queries.resources.actionAvailable(actorId, 'free')) {
    const suffix = shortHash(input.context.resolutionId ?? input.script.moveName, actorId, comboStriker.instanceId, 'combo-striker')
    const requestId = `ability.combo-striker.request.${suffix}`
    operations.push({
      id: requestId, kind: 'reaction-request', source: { kind: 'move', id: moveSourceId },
      recipients: { kind: 'none' }, phase: 'cleanup', reasonCode: 'ability.combo-striker.optional-struggle',
      payload: {
        requestId: `ability.combo-striker.response.${suffix}`, promptKey: 'ability.combo-striker.use',
        options: [{ id: 'ability.combo-striker.use', labelKey: 'ability.combo-striker.use-struggle' }],
        allowPass: true, timing: 'cleanup', priority: 60, ownerPlacementIds: [actorId],
      },
    } satisfies MoveReactionRequestEffectOperation, {
      id: `ability.combo-striker.struggle.${suffix}`, kind: 'nested-move',
      source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
      phase: 'cleanup', reasonCode: 'ability.combo-striker.use-struggle',
      payload: {
        canonicalId: 'Struggle', actor: { kind: 'parent-actor' }, source: { kind: 'registered-spec' },
        targeting: {
          kind: 'fresh-choice', requestId: `ability.combo-striker.target.${suffix}`,
          promptKey: 'ability.combo-striker.choose-target', selector: { kind: 'candidate-targets' },
        },
      },
    } satisfies MoveNestedMoveEffectOperation)
  }

  const conqueror = actorAbilities.find(ability => ability.canonicalId === 'Conqueror')
  if (conqueror && input.script.damaging
    && (input.script.damageClass === 'Physical' || input.script.damageClass === 'Special')
    && input.context.queries.resources.actionAvailable(actorId, 'free')
    && sceneUseAvailable({ context: input.context, ownerId: actorId, abilityInstanceId: conqueror.instanceId, canonicalId: 'Conqueror' })) {
    const suffix = shortHash(input.context.resolutionId ?? input.script.moveName, actorId, conqueror.instanceId, 'conqueror')
    const requestId = `ability.conqueror.request.${suffix}`
    operations.push({
      id: requestId, kind: 'reaction-request', source: { kind: 'move', id: moveSourceId },
      recipients: { kind: 'none' }, phase: 'ko', reasonCode: 'ability.conqueror.optional-stages',
      payload: {
        requestId: `ability.conqueror.response.${suffix}`, promptKey: 'ability.conqueror.use',
        options: [{ id: 'ability.conqueror.use', labelKey: 'ability.conqueror.raise-stages' }],
        allowPass: true, timing: 'ko', priority: 65, ownerPlacementIds: [actorId],
      },
    } satisfies MoveReactionRequestEffectOperation)
    for (const { optionId, stage } of COMBAT_STATS.filter(entry => ['attack', 'special-attack', 'speed'].includes(entry.optionId))) {
      operations.push({
        id: `ability.conqueror.stage.${stage}.${suffix}`, kind: 'combat-stage',
        source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
        phase: 'ko', reasonCode: `ability.conqueror.raise-${optionId}`,
        payload: { action: 'modify', stage, selectedStage: null, value: 1, stageSource: null, rounding: null },
      } satisfies MoveCombatStageEffectOperation)
    }
  }

  if (actorAbilities.some(ability => ability.canonicalId === 'Copy Master')
    && ['Copycat', 'Mimic'].includes(input.script.moveName)) {
    const suffix = shortHash(input.context.resolutionId ?? input.script.moveName, actorId, 'copy-master')
    const requestId = `ability.copy-master.request.${suffix}`
    operations.push({
      id: requestId, kind: 'choice-request', source: { kind: 'move', id: moveSourceId },
      recipients: { kind: 'actor' }, phase: 'cleanup', reasonCode: 'ability.copy-master.choose-stage',
      payload: {
        requestId: `ability.copy-master.response.${suffix}`, promptKey: 'ability.copy-master.choose-stat',
        options: COMBAT_STATS.map(entry => ({
          id: `ability.copy-master.${entry.optionId}`, labelKey: `ability.stat.${entry.optionId}`,
        })),
        allowPass: false,
      },
    } satisfies MoveChoiceRequestEffectOperation)
    for (const { optionId, stage } of COMBAT_STATS) {
      operations.push({
        id: `ability.copy-master.stage.${stage}.${suffix}`, kind: 'combat-stage',
        source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
        phase: 'cleanup', reasonCode: `ability.copy-master.raise-${optionId}`,
        payload: { action: 'modify', stage, selectedStage: null, value: 1, stageSource: null, rounding: null },
      } satisfies MoveCombatStageEffectOperation)
    }
  }
  return Object.freeze(operations)
}
