import { createHash } from 'node:crypto'
import type {
  MoveChoiceRequestEffectOperation,
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveDirectHpEffectOperation,
  MoveEffectOperation,
  MoveReactionRequestEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA070_FLAME_BODY_REASON = 'ability.flame-body.optional-burn' as const
export const AA070_FLAME_TONGUE_REASON = 'ability.flame-tongue.optional-injury-burn' as const
export const AA070_FLASH_FIRE_REASON = 'ability.flash-fire.choose-stat' as const
export const AA070_FLAVORFUL_AROMA_REASON = 'ability.flavorful-aroma.optional-buff' as const
export const AA070_FLOWER_POWER_REASON = 'ability.flower-power.choose-damage-class' as const

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const sceneUseAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
}): boolean => {
  const sceneId = input.context.map.encounterState?.history.sceneId
  const ledger = input.context.map.encounterState?.abilityUsage
  const existing = ledger && ledger.sceneId === sceneId ? ledger.entries.find(entry => (
    entry.ownerId === input.ownerId
    && entry.abilityInstanceId === input.abilityInstanceId
    && entry.canonicalId === input.canonicalId
    && entry.clauseId === 'base'
  )) : null
  return Boolean(sceneId) && (existing?.spent ?? 0) < 1
}

const optionalRequest = (input: {
  readonly id: string
  readonly moveSourceId: string
  readonly reasonCode: string
  readonly promptKey: string
  readonly ownerId: string
  readonly timing: 'post-hit'
  readonly options: readonly { readonly id: string; readonly labelKey: string }[]
  readonly priority?: number
}): MoveReactionRequestEffectOperation => ({
  id: input.id,
  kind: 'reaction-request',
  source: { kind: 'move', id: input.moveSourceId },
  recipients: { kind: 'none' },
  phase: 'hit',
  reasonCode: input.reasonCode,
  payload: {
    requestId: `${input.id}.response`, promptKey: input.promptKey,
    options: input.options, allowPass: true, timing: input.timing,
    priority: input.priority ?? 80, ownerPlacementIds: [input.ownerId],
  },
})

const condition = (input: {
  readonly id: string
  readonly sourceRequestId: string
  readonly recipients: 'all-placements' | 'hit-targets'
  readonly reasonCode: string
}): MoveConditionEffectOperation => ({
  id: input.id,
  kind: 'condition',
  source: { kind: 'operation', id: input.sourceRequestId },
  recipients: { kind: input.recipients },
  phase: 'after-damage',
  reasonCode: input.reasonCode,
  payload: {
    action: 'apply', conditionId: 'burned', conditionSource: null,
    filter: null, randomChoice: null,
    duration: null, saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
    applyMoveImmunity: false, applyTypeImmunity: false,
  },
})

const flameTongueInjury = (requestId: string, suffix: string): MoveDirectHpEffectOperation => ({
  id: `ability.flame-tongue.injury.${suffix}`,
  kind: 'direct-hp', source: { kind: 'operation', id: requestId },
  recipients: { kind: 'hit-targets' }, phase: 'after-damage',
  reasonCode: 'ability.flame-tongue.add-injury',
  payload: {
    mode: 'lose', pool: 'hit-points', calculation: { kind: 'fixed', value: 0 },
    copySource: null, bounds: { minimum: 0, maximum: null }, rounding: 'floor',
    applyTypeImmunity: false, cost: null,
    injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
  },
})

const flashFireStages = (
  requestId: string,
  suffix: string,
): readonly MoveCombatStageEffectOperation[] => ([
  ['attack', 'atk'], ['special-attack', 'satk'],
] as const).map(([choiceId, stage]) => ({
  id: `ability.flash-fire.stage-${stage}.${suffix}`,
  kind: 'combat-stage', source: { kind: 'operation', id: requestId },
  recipients: { kind: 'response-owner' }, phase: 'after-damage',
  reasonCode: `ability.flash-fire.raise-${choiceId}`,
  payload: {
    action: 'modify', stage, selectedStage: null, value: 1,
    stageSource: null, rounding: null,
  },
}))

const flavorfulEffect = (input: {
  readonly requestId: string
  readonly suffix: string
  readonly attribute: 'accuracy' | 'damage'
  readonly value: number
}): MoveTemporaryEffectOperation => ({
  id: `ability.flavorful-aroma.${input.attribute}.${input.suffix}`,
  kind: 'temporary-effect', source: { kind: 'operation', id: input.requestId },
  recipients: { kind: 'hit-targets' }, phase: 'schedule',
  reasonCode: `ability.flavorful-aroma.${input.attribute}`,
  payload: {
    action: 'add', effectId: `ability.flavorful-aroma.${input.attribute}.${input.suffix}`,
    recipientScope: 'placements',
    definition: {
      kind: 'numeric-modifier',
      duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
      stacks: 1, charges: null,
      stackPolicy: { kind: 'refresh', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['ability', 'aa070', 'flavorful-aroma', input.attribute],
      payload: { attribute: input.attribute, operation: 'add', value: input.value, rounding: 'none' },
      dispel: { policy: 'matching-tags', tags: ['flavorful-aroma'] },
      transferPolicy: 'expire',
    },
  },
})

const flowerPowerChoice = (input: {
  readonly id: string
  readonly moveSourceId: string
}): MoveChoiceRequestEffectOperation => ({
  id: input.id,
  kind: 'choice-request', source: { kind: 'move', id: input.moveSourceId },
  recipients: { kind: 'actor' }, phase: 'declare',
  reasonCode: AA070_FLOWER_POWER_REASON,
  payload: {
    requestId: `${input.id}.response`, promptKey: 'ability.flower-power.choose-damage-class',
    options: [
      { id: 'ability.flower-power.physical', labelKey: 'ability.flower-power.physical' },
      { id: 'ability.flower-power.special', labelKey: 'ability.flower-power.special' },
    ],
    allowPass: false,
  },
})

export const aa070MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const moveIdentity = `${input.context.resolutionId}:${input.script.moveName}`
  const melee = input.script.keywords.some(keyword => keyword.trim().toLowerCase() === 'melee')
  const damaging = input.script.damageClass !== 'Status'
    && typeof input.script.damageBase === 'number'
    && input.script.damageBase > 0

  if (melee) {
    for (const targetId of [...new Set(input.authoritativeTargetIds)].sort()) {
      if (input.context.queries.relationships.resolve(actorId, targetId).relationship !== 'enemy') continue
      const ability = input.context.queries.abilities.activeForPlacement(targetId)
        .find(candidate => candidate.canonicalId === 'Flame Body')
      if (!ability
        || !input.context.queries.resources.actionAvailable(targetId, 'free')
        || !sceneUseAvailable({
          context: input.context, ownerId: targetId,
          abilityInstanceId: ability.instanceId, canonicalId: 'Flame Body',
        })) continue
      const suffix = shortHash(moveIdentity, actorId, targetId, ability.instanceId, 'Flame Body')
      const requestId = `ability.flame-body.request.${suffix}`
      operations.push(optionalRequest({
        id: requestId, moveSourceId: input.moveSourceId,
        reasonCode: AA070_FLAME_BODY_REASON,
        promptKey: 'ability.flame-body.use', ownerId: targetId, timing: 'post-hit',
        options: [{ id: 'ability.flame-body.use', labelKey: 'ability.flame-body.burn-attacker' }],
      }), condition({
        id: `ability.flame-body.burn.${suffix}`, sourceRequestId: requestId,
        recipients: 'all-placements', reasonCode: 'ability.flame-body.burn-attacker',
      }))
    }
  }

  if (input.script.moveName === 'Lick') {
    const ability = input.context.queries.abilities.activeForPlacement(actorId)
      .find(candidate => candidate.canonicalId === 'Flame Tongue')
    if (ability
      && input.context.queries.resources.actionAvailable(actorId, 'free')
      && sceneUseAvailable({
        context: input.context, ownerId: actorId,
        abilityInstanceId: ability.instanceId, canonicalId: 'Flame Tongue',
      })) {
      const eligibleTargets = input.authoritativeTargetIds.filter(targetId => (
        input.context.queries.relationships.resolve(actorId, targetId).relationship === 'enemy'
      ))
      if (eligibleTargets.length > 0) {
        const suffix = shortHash(moveIdentity, actorId, ability.instanceId, 'Flame Tongue')
        const requestId = `ability.flame-tongue.request.${suffix}`
        operations.push(optionalRequest({
          id: requestId, moveSourceId: input.moveSourceId,
          reasonCode: AA070_FLAME_TONGUE_REASON,
          promptKey: 'ability.flame-tongue.use', ownerId: actorId, timing: 'post-hit',
          options: [{ id: 'ability.flame-tongue.use', labelKey: 'ability.flame-tongue.injure-and-burn' }],
        }), flameTongueInjury(requestId, suffix), condition({
          id: `ability.flame-tongue.burn.${suffix}`, sourceRequestId: requestId,
          recipients: 'hit-targets', reasonCode: 'ability.flame-tongue.burn-target',
        }))
      }
    }
  }

  if (input.script.type.trim().toLowerCase() === 'fire') {
    for (const targetId of [...new Set(input.authoritativeTargetIds)].sort()) {
      const ability = input.context.queries.abilities.activeForPlacement(targetId)
        .find(candidate => candidate.canonicalId === 'Flash Fire')
      if (!ability) continue
      const target = input.context.queries.tokens.get(targetId)
      if (!target) continue
      const options = [
        ...(target.combatStages.atk < 6
          ? [{ id: 'ability.flash-fire.attack', labelKey: 'ability.flash-fire.raise-attack' }]
          : []),
        ...(target.combatStages.satk < 6
          ? [{ id: 'ability.flash-fire.special-attack', labelKey: 'ability.flash-fire.raise-special-attack' }]
          : []),
      ]
      if (options.length === 0) continue
      const suffix = shortHash(moveIdentity, actorId, targetId, ability.instanceId, 'Flash Fire')
      const requestId = `ability.flash-fire.request.${suffix}`
      operations.push(optionalRequest({
        id: requestId, moveSourceId: input.moveSourceId,
        reasonCode: AA070_FLASH_FIRE_REASON,
        promptKey: 'ability.flash-fire.choose-stat', ownerId: targetId, timing: 'post-hit',
        options,
        priority: 60,
      }), ...flashFireStages(requestId, suffix))
    }
  }

  if (input.script.moveName === 'Aromatic Mist') {
    const ability = input.context.queries.abilities.activeForPlacement(actorId)
      .find(candidate => candidate.canonicalId === 'Flavorful Aroma')
    if (ability && input.context.queries.resources.actionAvailable(actorId, 'free')) {
      const suffix = shortHash(moveIdentity, actorId, ability.instanceId, 'Flavorful Aroma')
      const requestId = `ability.flavorful-aroma.request.${suffix}`
      operations.push(optionalRequest({
        id: requestId, moveSourceId: input.moveSourceId,
        reasonCode: AA070_FLAVORFUL_AROMA_REASON,
        promptKey: 'ability.flavorful-aroma.use', ownerId: actorId, timing: 'post-hit',
        options: [{ id: 'ability.flavorful-aroma.use', labelKey: 'ability.flavorful-aroma.buff-allies' }],
      }), flavorfulEffect({ requestId, suffix, attribute: 'accuracy', value: 1 }),
      flavorfulEffect({ requestId, suffix, attribute: 'damage', value: 5 }))
    }
  }

  if (input.script.type.trim().toLowerCase() === 'grass' && damaging
    && input.context.queries.abilities.has(actorId, 'Flower Power')) {
    const suffix = shortHash(moveIdentity, actorId, 'Flower Power')
    operations.push(flowerPowerChoice({
      id: `ability.flower-power.request.${suffix}`,
      moveSourceId: input.moveSourceId,
    }))
  }

  if (input.script.moveName === 'Charge'
    && input.context.queries.abilities.has(actorId, 'Fluffy Charge')) {
    operations.push({
      id: `ability.fluffy-charge.defense.${shortHash(moveIdentity, actorId, 'Fluffy Charge')}`,
      kind: 'combat-stage', source: { kind: 'move', id: input.moveSourceId },
      recipients: { kind: 'actor' }, phase: 'after-damage',
      reasonCode: 'ability.fluffy-charge.raise-defense',
      payload: {
        action: 'modify', stage: 'def', selectedStage: null, value: 1,
        stageSource: null, rounding: null,
      },
    })
  }

  return Object.freeze(operations)
}
