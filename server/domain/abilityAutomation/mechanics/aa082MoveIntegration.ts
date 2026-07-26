import { createHash } from 'node:crypto'
import type {
  MoveConditionEffectOperation,
  MoveDirectHpEffectOperation,
  MoveEffectOperation,
  MoveMovementRequestEffectOperation,
  MoveReactionRequestEffectOperation,
  MoveRollEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA082_PACK_HUNT_REQUEST_REASON = 'ability.pack-hunt.optional-attack' as const
export const AA082_PACK_HUNT_ROLL_REASON = 'ability.pack-hunt.attack-roll' as const
export const AA082_PACK_HUNT_HP_REASON = 'ability.pack-hunt.tick-loss' as const
export const AA082_PARRY_REASON = 'ability.parry.optional-miss' as const
export const AA082_PERCEPTION_REASON = 'ability.perception.optional-disengage' as const
export const AA082_ODIOUS_SPRAY_REASON = 'ability.odious-spray.flinched' as const

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const sceneAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
}): boolean => {
  const sceneId = input.context.map.encounterState?.history.sceneId
  if (!sceneId) return false
  const ledger = input.context.map.encounterState?.abilityUsage
  if (ledger?.sceneId && ledger.sceneId !== sceneId) return true
  return (ledger?.entries.find(entry => entry.ownerId === input.ownerId
    && entry.abilityInstanceId === input.abilityInstanceId
    && entry.canonicalId === input.canonicalId
    && entry.clauseId === 'base')?.spent ?? 0) < 1
}

const request = (input: {
  readonly id: string
  readonly sourceId: string
  readonly reasonCode: string
  readonly promptKey: string
  readonly optionId: string
  readonly ownerId: string
  readonly priority: number
  readonly timing: 'post-hit' | 'post-damage'
}): MoveReactionRequestEffectOperation => ({
  id: input.id, kind: 'reaction-request',
  source: { kind: 'lifecycle-event', id: input.sourceId },
  recipients: { kind: 'none' },
  phase: input.timing === 'post-damage' ? 'after-damage' : 'hit',
  reasonCode: input.reasonCode,
  payload: {
    requestId: `${input.id}.response`, promptKey: input.promptKey,
    options: [{ id: input.optionId, labelKey: input.optionId }],
    allowPass: true, timing: input.timing, priority: input.priority,
    ownerPlacementIds: [input.ownerId],
  },
})

const packHuntOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveIdentity: string
  readonly targetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const actorId = input.context.actor.placement.id
  const actor = input.context.actor.token
  const melee = input.script.range.trim().toLowerCase().includes('melee')
  const damaging = input.script.damageClass === 'Physical' || input.script.damageClass === 'Special'
  if (!melee || !damaging) return []
  const operations: MoveEffectOperation[] = []
  for (const targetId of [...new Set(input.targetIds)].sort()) {
    const target = input.context.queries.tokens.get(targetId)
    if (!target) continue
    for (const placement of input.context.queries.placements.all()) {
      const ownerId = placement.id
      if (ownerId === actorId
        || input.context.queries.relationships.resolve(actorId, ownerId).relationship !== 'ally'
        || input.context.queries.relationships.resolve(ownerId, targetId).relationship !== 'enemy'
        || !input.context.queries.resources.actionAvailable(ownerId, 'free')) continue
      const owner = input.context.queries.tokens.get(ownerId)
      const ability = input.context.queries.abilities.activeForPlacement(ownerId)
        .find(candidate => candidate.canonicalId === 'Pack Hunt')
      if (!owner || !ability || ptuGridDistanceBetweenFootprints(owner, target) > 1) continue
      const suffix = shortHash(input.moveIdentity, actorId, ownerId, targetId, ability.instanceId)
      const requestId = `ability.pack-hunt.request.${suffix}`
      const rollOperationId = `ability.pack-hunt.roll.${suffix}:owner:${ownerId}:target:${targetId}`
      const rollId = `ability.pack-hunt.d20.${suffix}`
      operations.push(
        request({
          id: requestId, sourceId: `ability.pack-hunt.target:${targetId}`,
          reasonCode: AA082_PACK_HUNT_REQUEST_REASON, promptKey: 'ability.pack-hunt.use',
          optionId: 'ability.pack-hunt.use', ownerId, priority: 52, timing: 'post-damage',
        }),
        {
          id: rollOperationId, kind: 'roll', source: { kind: 'operation', id: requestId },
          recipients: { kind: 'response-owner' }, phase: 'after-damage',
          reasonCode: AA082_PACK_HUNT_ROLL_REASON,
          payload: { rollId, formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 } },
        } satisfies MoveRollEffectOperation,
        {
          id: `ability.pack-hunt.hp.${suffix}`, kind: 'direct-hp',
          source: { kind: 'operation', id: rollOperationId },
          recipients: { kind: 'selected-targets' }, phase: 'after-damage',
          reasonCode: AA082_PACK_HUNT_HP_REASON,
          payload: {
            mode: 'lose', pool: 'hit-points', calculation: { kind: 'percent-max', percent: 10 },
            copySource: null, bounds: { minimum: 0, maximum: null }, rounding: 'floor',
            applyTypeImmunity: false, cost: null,
            injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
          },
        } satisfies MoveDirectHpEffectOperation,
      )
    }
  }
  return operations
}

const parryOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveIdentity: string
  readonly targetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  if (!input.script.range.trim().toLowerCase().includes('melee')) return []
  return [...new Set(input.targetIds)].sort().flatMap(targetId => {
    const ability = input.context.queries.abilities.activeForPlacement(targetId)
      .find(candidate => candidate.canonicalId === 'Parry')
    if (!ability || !input.context.queries.resources.actionAvailable(targetId, 'free')
      || !sceneAvailable({ context: input.context, ownerId: targetId,
        abilityInstanceId: ability.instanceId, canonicalId: 'Parry' })) return []
    const suffix = shortHash(input.moveIdentity, targetId, ability.instanceId)
    return [request({
      id: `ability.parry.request.${suffix}`, sourceId: `ability.parry.target:${targetId}`,
      reasonCode: AA082_PARRY_REASON, promptKey: 'ability.parry.use',
      optionId: 'ability.parry.use', ownerId: targetId, priority: 132, timing: 'post-hit',
    })]
  })
}

const perceptionOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveIdentity: string
  readonly targetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const actorId = input.context.actor.placement.id
  const area = (input.script.areaTemplates?.length ?? 0) > 0
  const damaging = input.script.damageClass === 'Physical' || input.script.damageClass === 'Special'
  if (!area || !damaging) return []
  return [...new Set(input.targetIds)].sort().flatMap(ownerId => {
    if (ownerId === actorId
      || input.context.queries.relationships.resolve(actorId, ownerId).relationship !== 'ally') return []
    const ability = input.context.queries.abilities.activeForPlacement(ownerId)
      .find(candidate => candidate.canonicalId === 'Perception')
    if (!ability || !input.context.queries.resources.actionAvailable(ownerId, 'free')) return []
    const suffix = shortHash(input.moveIdentity, actorId, ownerId, ability.instanceId)
    const requestId = `ability.perception.request.${suffix}`
    const reaction = request({
      id: requestId, sourceId: `ability.perception.target:${ownerId}`,
      reasonCode: AA082_PERCEPTION_REASON, promptKey: 'ability.perception.disengage',
      optionId: 'ability.perception.use', ownerId, priority: 128, timing: 'post-hit',
    })
    const movement: MoveMovementRequestEffectOperation = {
      id: `ability.perception.move.${suffix}`, kind: 'movement-request',
      source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
      phase: 'movement', reasonCode: 'ability.perception.disengage-movement',
      payload: {
        requestId: `ability.perception.destination.${suffix}`,
        mode: 'voluntary', distance: 1,
        destinationSetId: `ability.perception.destinations.${suffix}`,
        choice: { kind: 'destination', promptKey: 'ability.perception.choose-destination', allowPass: false },
      },
    }
    return [reaction, movement]
  })
}

const odiousSprayOperation = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly moveIdentity: string
}): MoveConditionEffectOperation | null => input.script.moveName === 'Poison Gas'
  && input.context.queries.abilities.has(input.context.actor.placement.id, 'Odious Spray')
  ? {
      id: `ability.odious-spray.flinch.${shortHash(input.moveIdentity)}`,
      kind: 'condition', source: { kind: 'move', id: input.moveSourceId },
      recipients: { kind: 'hit-targets' }, phase: 'after-damage', reasonCode: AA082_ODIOUS_SPRAY_REASON,
      payload: {
        action: 'apply', conditionId: 'flinched', conditionSource: null,
        filter: null, randomChoice: null, duration: null, saveTiming: 'canonical',
        stackPolicy: { kind: 'refresh', maxStacks: null },
      },
    }
  : null

/** Exact AA-082 operations rebuilt for root, nested, pending, and resumed execution. */
export const aa082MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const moveIdentity = input.context.resolutionId ?? `${input.moveSourceId}:${input.script.moveName}`
  const odious = odiousSprayOperation({ ...input, moveIdentity })
  return Object.freeze([
    ...packHuntOperations({ ...input, moveIdentity, targetIds: input.authoritativeTargetIds }),
    ...parryOperations({ ...input, moveIdentity, targetIds: input.authoritativeTargetIds }),
    ...perceptionOperations({ ...input, moveIdentity, targetIds: input.authoritativeTargetIds }),
    ...(odious ? [odious] : []),
  ])
}

export const aa082PackHuntIdentity = (
  operation: Pick<MoveEffectOperation, 'reasonCode' | 'source'>,
): { readonly ownerId: string; readonly targetId: string } | null => {
  if (operation.reasonCode !== AA082_PACK_HUNT_HP_REASON || operation.source.kind !== 'operation') return null
  const match = /:owner:([^:]+):target:([^:]+)$/.exec(operation.source.id)
  return match?.[1] && match[2] ? { ownerId: match[1], targetId: match[2] } : null
}
