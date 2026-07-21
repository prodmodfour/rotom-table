import { createHash } from 'node:crypto'
import type {
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveDirectHpEffectOperation,
  MoveEffectOperation,
  MoveReactionRequestEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import { AA065_CRUELTY_HEALING_BLOCK_CAPABILITY_ID } from './aa065StaticIntegration'

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

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

const optionalRequest = (input: {
  readonly id: string
  readonly sourceId: string
  readonly sourceKind?: 'move' | 'lifecycle-event'
  readonly reasonCode: string
  readonly promptKey: string
  readonly optionId: string
  readonly optionLabelKey: string
  readonly timing: 'post-hit' | 'post-damage'
  readonly priority: number
  readonly ownerId: string
  readonly phase?: 'hit' | 'after-damage'
  readonly options?: readonly { readonly id: string; readonly labelKey: string }[]
}): MoveReactionRequestEffectOperation => ({
  id: input.id, kind: 'reaction-request',
  source: { kind: input.sourceKind ?? 'lifecycle-event', id: input.sourceId },
  recipients: { kind: 'none' }, phase: input.phase ?? (input.timing === 'post-hit' ? 'hit' : 'after-damage'),
  reasonCode: input.reasonCode,
  payload: {
    requestId: `${input.id}.response`, promptKey: input.promptKey,
    options: input.options ?? [{ id: input.optionId, labelKey: input.optionLabelKey }],
    allowPass: true, timing: input.timing, priority: input.priority,
    ownerPlacementIds: [input.ownerId],
  },
})

const condition = (input: {
  readonly id: string
  readonly requestId: string
  readonly reasonCode: string
  readonly conditionId: string
  readonly detail?: string
  readonly duration?: { readonly effectId: string; readonly duration: { readonly kind: 'rounds'; readonly boundary: 'end'; readonly remaining: number }; readonly transferPolicy: 'expire' }
}): MoveConditionEffectOperation => ({
  id: input.id, kind: 'condition', source: { kind: 'operation', id: input.requestId },
  recipients: { kind: 'response-owner' }, phase: 'after-damage', reasonCode: input.reasonCode,
  payload: {
    action: 'apply', conditionId: input.conditionId,
    ...(input.detail ? { conditionDetail: input.detail } : {}),
    conditionSource: null, filter: null, randomChoice: null,
    duration: input.duration ?? null, saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
  },
})

const crueltyOptions = (): readonly { readonly id: string; readonly labelKey: string }[] => {
  const options: { id: string; labelKey: string }[] = []
  for (const healingBlock of [0, 1] as const) {
    for (const slowed of [0, 1] as const) {
      for (let hpPurchases = 0; hpPurchases <= 10; hpPurchases += 1) {
        const cost = hpPurchases + slowed + healingBlock * 2
        if (cost > 10) continue
        const id = `ability.cruelty.hp-${hpPurchases}.slow-${slowed}.block-${healingBlock}`
        options.push({ id, labelKey: id })
      }
    }
  }
  return Object.freeze(options)
}

const oppositeGender = (left: string | undefined, right: string | undefined): boolean => {
  const normalizedLeft = left?.trim().toLowerCase()
  const normalizedRight = right?.trim().toLowerCase()
  return (normalizedLeft === 'male' && normalizedRight === 'female')
    || (normalizedLeft === 'female' && normalizedRight === 'male')
}

/** Exact manifest-selected AA-065 operations attached to root and nested native moves. */
export const aa065MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const actorAbilities = input.context.queries.abilities.activeForPlacement(actorId)
  const damaging = input.script.damageClass === 'Physical' || input.script.damageClass === 'Special'
  const moveIdentity = input.context.resolutionId ?? input.script.moveName

  const corrosive = actorAbilities.find(ability => ability.canonicalId === 'Corrosive Toxins')
  if (corrosive && input.script.moveName === 'Toxic'
    && input.context.queries.resources.actionAvailable(actorId, 'free')
    && sceneUseAvailable({ context: input.context, ownerId: actorId, abilityInstanceId: corrosive.instanceId, canonicalId: 'Corrosive Toxins' })) {
    for (const targetId of [...new Set(input.authoritativeTargetIds)].sort()) {
      const suffix = shortHash(moveIdentity, actorId, targetId, corrosive.instanceId)
      const requestId = `ability.corrosive-toxins.request.${suffix}`
      operations.push(optionalRequest({
        id: requestId, sourceKind: 'lifecycle-event', sourceId: `ability.corrosive-toxins.target:${targetId}`,
        reasonCode: 'ability.corrosive-toxins.optional-bypass', promptKey: 'ability.corrosive-toxins.use',
        optionId: 'ability.corrosive-toxins.use', optionLabelKey: 'ability.corrosive-toxins.apply-toxic',
        timing: 'post-hit', priority: 95, ownerId: actorId,
      }), condition({
        id: `ability.corrosive-toxins.condition.${suffix}`, requestId,
        reasonCode: 'ability.corrosive-toxins.apply-badly-poisoned', conditionId: 'badly-poisoned',
      }), {
        id: `ability.corrosive-toxins.mark.${suffix}`, kind: 'temporary-effect',
        source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
        phase: 'schedule', reasonCode: 'ability.corrosive-toxins.hp-loss-bypass',
        payload: {
          action: 'add', effectId: `ability.corrosive-toxins.${targetId}.${suffix}`, recipientScope: 'placements',
          definition: {
            kind: 'capability', duration: { kind: 'scene', remaining: null }, stacks: 1, charges: null,
            stackPolicy: { kind: 'refresh', maxStacks: null }, chargePolicy: { kind: 'none', amount: null },
            tags: ['ability', 'aa065', 'corrosive-toxins', 'badly-poisoned-hp-loss-bypass'],
            payload: { capabilityId: 'aa065.corrosive-toxins.bad-poison-hp-loss-bypass', action: 'grant' },
            dispel: { policy: 'matching-tags', tags: ['corrosive-toxins', 'badly-poisoned-hp-loss-bypass'] },
            transferPolicy: 'expire',
          },
        },
      } satisfies MoveTemporaryEffectOperation)
    }
  }

  const cruelty = actorAbilities.find(ability => ability.canonicalId === 'Cruelty')
  if (cruelty && damaging
    && input.context.queries.resources.actionAvailable(actorId, 'swift')
    && sceneUseAvailable({ context: input.context, ownerId: actorId, abilityInstanceId: cruelty.instanceId, canonicalId: 'Cruelty' })) {
    for (const targetId of [...new Set(input.authoritativeTargetIds)].sort()) {
      if (input.context.queries.relationships.resolve(actorId, targetId).relationship !== 'enemy') continue
      const suffix = shortHash(moveIdentity, actorId, targetId, cruelty.instanceId)
      const requestId = `ability.cruelty.request.${suffix}`
      operations.push(optionalRequest({
        id: requestId, sourceKind: 'lifecycle-event', sourceId: `ability.cruelty.target:${targetId}`,
        reasonCode: 'ability.cruelty.optional-purchases', promptKey: 'ability.cruelty.choose-effects',
        optionId: 'ability.cruelty.use', optionLabelKey: 'ability.cruelty.use', options: crueltyOptions(),
        timing: 'post-damage', priority: 75, ownerId: actorId,
      }), {
        id: `ability.cruelty.injury.${suffix}`, kind: 'direct-hp',
        source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
        phase: 'after-damage', reasonCode: 'ability.cruelty.add-injury',
        payload: {
          mode: 'lose', pool: 'hit-points', calculation: { kind: 'fixed', value: 0 },
          copySource: null, bounds: { minimum: 0, maximum: null }, rounding: 'floor',
          applyTypeImmunity: false, cost: null, injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
        },
      } satisfies MoveDirectHpEffectOperation)
      for (let purchases = 1; purchases <= 10; purchases += 1) {
        operations.push({
          id: `ability.cruelty.hp-${purchases}.${suffix}`, kind: 'direct-hp',
          source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
          phase: 'after-damage', reasonCode: `ability.cruelty.lose-hp-${purchases}`,
          payload: {
            mode: 'lose', pool: 'hit-points', calculation: { kind: 'fixed', value: purchases * 2 },
            copySource: null, bounds: { minimum: 0, maximum: null }, rounding: 'floor',
            applyTypeImmunity: false, cost: null,
            injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
          },
        } satisfies MoveDirectHpEffectOperation)
      }
      operations.push(condition({
        id: `ability.cruelty.slowed.${suffix}`, requestId,
        reasonCode: 'ability.cruelty.slowed', conditionId: 'slowed',
      }), {
        id: `ability.cruelty.healing-block.${suffix}`, kind: 'temporary-effect',
        source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
        phase: 'schedule', reasonCode: 'ability.cruelty.healing-blocked',
        payload: {
          action: 'add', effectId: `ability.cruelty.healing-block.${targetId}.${suffix}`, recipientScope: 'placements',
          definition: {
            kind: 'capability', duration: { kind: 'scene', remaining: null }, stacks: 1, charges: null,
            stackPolicy: { kind: 'refresh', maxStacks: null }, chargePolicy: { kind: 'none', amount: null },
            tags: ['ability', 'aa065', 'cruelty', 'healing-blocked'],
            payload: { capabilityId: AA065_CRUELTY_HEALING_BLOCK_CAPABILITY_ID, action: 'grant' },
            dispel: { policy: 'matching-tags', tags: ['cruelty', 'healing-blocked'] }, transferPolicy: 'expire',
          },
        },
      } satisfies MoveTemporaryEffectOperation)
    }
  }

  for (const targetId of [...new Set(input.authoritativeTargetIds)].sort()) {
    const target = input.context.queries.tokens.get(targetId)
    if (!target) continue
    const targetAbilities = input.context.queries.abilities.activeForPlacement(targetId)
    const available = (canonicalId: string) => {
      const ability = targetAbilities.find(candidate => candidate.canonicalId === canonicalId)
      return ability && input.context.queries.resources.actionAvailable(targetId, 'free')
        && sceneUseAvailable({ context: input.context, ownerId: targetId, abilityInstanceId: ability.instanceId, canonicalId })
        ? ability : null
    }

    const cottonDown = available('Cotton Down')
    if (cottonDown) {
      const suffix = shortHash(moveIdentity, targetId, cottonDown.instanceId)
      const requestId = `ability.cotton-down.request.${suffix}`
      operations.push(optionalRequest({
        id: requestId, sourceKind: 'lifecycle-event', sourceId: `ability.cotton-down.center:${targetId}`,
        reasonCode: 'ability.cotton-down.optional-burst', promptKey: 'ability.cotton-down.use',
        optionId: 'ability.cotton-down.use', optionLabelKey: 'ability.cotton-down.slow-burst',
        timing: 'post-hit', priority: 85, ownerId: targetId,
      }), {
        id: `ability.cotton-down.speed.${suffix}`, kind: 'combat-stage',
        source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
        phase: 'after-damage', reasonCode: 'ability.cotton-down.lower-speed',
        payload: { action: 'modify', stage: 'spd', selectedStage: null, value: -1, stageSource: null, rounding: null },
      } satisfies MoveCombatStageEffectOperation, condition({
        id: `ability.cotton-down.slowed.${suffix}`, requestId,
        reasonCode: 'ability.cotton-down.slowed-one-round', conditionId: 'slowed',
        duration: {
          effectId: `ability.cotton-down.slowed.${suffix}`,
          duration: { kind: 'rounds', boundary: 'end', remaining: 1 }, transferPolicy: 'expire',
        },
      }))
    }

    const cursedBody = damaging ? available('Cursed Body') : null
    if (cursedBody) {
      const suffix = shortHash(moveIdentity, targetId, cursedBody.instanceId)
      const requestId = `ability.cursed-body.request.${suffix}`
      operations.push(optionalRequest({
        id: requestId, sourceKind: 'lifecycle-event', sourceId: `ability.cursed-body.target:${targetId}`,
        reasonCode: 'ability.cursed-body.optional-disable', promptKey: 'ability.cursed-body.use',
        optionId: 'ability.cursed-body.use', optionLabelKey: 'ability.cursed-body.disable-move',
        timing: 'post-hit', priority: 80, ownerId: targetId,
      }), condition({
        id: `ability.cursed-body.disabled.${suffix}`, requestId,
        reasonCode: 'ability.cursed-body.disable-attacker-move', conditionId: 'disabled', detail: input.script.moveName,
      }))
    }

    const cuteCharm = available('Cute Charm')
    if (cuteCharm
      && input.context.queries.relationships.resolve(targetId, actorId).relationship === 'enemy'
      && input.script.range.toLowerCase().includes('melee')
      && oppositeGender(target.gender, input.context.actor.token.gender)) {
      const suffix = shortHash(moveIdentity, targetId, cuteCharm.instanceId)
      const requestId = `ability.cute-charm.request.${suffix}`
      operations.push(optionalRequest({
        id: requestId, sourceKind: 'lifecycle-event', sourceId: `ability.cute-charm.target:${targetId}`,
        reasonCode: 'ability.cute-charm.optional-infatuation', promptKey: 'ability.cute-charm.use',
        optionId: 'ability.cute-charm.use', optionLabelKey: 'ability.cute-charm.infatuate-attacker',
        timing: 'post-hit', priority: 75, ownerId: targetId,
      }), condition({
        id: `ability.cute-charm.infatuated.${suffix}`, requestId,
        reasonCode: 'ability.cute-charm.infatuate-attacker', conditionId: 'infatuation', detail: targetId,
      }))
    }

    const cuteTears = damaging
      && input.context.queries.relationships.resolve(targetId, actorId).relationship === 'enemy'
      ? available('Cute Tears') : null
    if (cuteTears) {
      const suffix = shortHash(moveIdentity, targetId, cuteTears.instanceId)
      const requestId = `ability.cute-tears.request.${suffix}`
      operations.push(optionalRequest({
        id: requestId, sourceKind: 'lifecycle-event', sourceId: `ability.cute-tears.target:${targetId}`,
        reasonCode: 'ability.cute-tears.optional-stage-loss', promptKey: 'ability.cute-tears.use',
        optionId: 'ability.cute-tears.use', optionLabelKey: 'ability.cute-tears.lower-attack-stat',
        timing: 'post-hit', priority: 70, ownerId: targetId,
      }), {
        id: `ability.cute-tears.stage.${suffix}`, kind: 'combat-stage',
        source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
        phase: 'after-damage', reasonCode: 'ability.cute-tears.lower-attacker-stage',
        payload: {
          action: 'modify', stage: input.script.damageClass === 'Physical' ? 'atk' : 'satk',
          selectedStage: null, value: -2, stageSource: null, rounding: null,
        },
      } satisfies MoveCombatStageEffectOperation)
    }
  }

  return Object.freeze(operations)
}
