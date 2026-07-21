import { createHash } from 'node:crypto'
import type {
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveDirectHpEffectOperation,
  MoveEffectOperation,
  MoveMovementRequestEffectOperation,
  MoveReactionRequestEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA063_CLAY_CANNONS_CAPABILITY_ID = 'aa063.clay-cannons.virtual-origin' as const
const CHEMICAL_ROMANCE_MOVES = new Set([
  'Poison Gas', 'Smog', 'Sweet Scent', 'Toxic', 'Venom Drench',
])
const shortHash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24)
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

const conditionOperation = (input: {
  readonly id: string
  readonly sourceId: string
  readonly reasonCode: string
  readonly conditionId: string
  readonly conditionDetail?: string
}): MoveConditionEffectOperation => ({
  id: input.id,
  kind: 'condition',
  source: { kind: 'move', id: input.sourceId },
  recipients: { kind: 'hit-targets' },
  phase: 'after-damage',
  reasonCode: input.reasonCode,
  payload: {
    action: 'apply', conditionId: input.conditionId,
    ...(input.conditionDetail ? { conditionDetail: input.conditionDetail } : {}),
    conditionSource: null, filter: null, randomChoice: null, duration: null,
    saveTiming: 'canonical', stackPolicy: { kind: 'refresh', maxStacks: null },
  },
})

export const aa063RangedMove = (script: MoveAutomationScript): boolean => {
  const range = script.range.trim().toLowerCase()
  return script.targetMode !== 'self'
    && !range.includes('melee')
    && !['self', 'field'].includes(range)
}

export const aa063DirectRangedAttack = (script: MoveAutomationScript): boolean => {
  return script.damaging
    && aa063RangedMove(script)
    && (script.areaTemplates?.length ?? 0) === 0
}

/** Number of exact reviewed resistance steps contributed by AA-063 statics. */
export const aa063MoveResistance = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'moveName'>
  readonly recipientId: string
  readonly moveType: string
}): { readonly steps: number; readonly sources: readonly string[] } => {
  let steps = 0
  const sources: string[] = []
  const entry = input.context.queries.resolveActorMoveEntry(input.script.moveName)
  const directRanged = entry.ok && aa063DirectRangedAttack(entry.entry.script)
  if (input.context.queries.abilities.has(input.recipientId, 'Bulletproof')
    && directRanged) {
    steps += 1
    sources.push('Bulletproof')
  }
  if (input.context.queries.abilities.has(input.recipientId, 'Cave Crasher')
    && ['ground', 'rock'].includes(input.moveType.trim().toLowerCase())) {
    steps += 1
    sources.push('Cave Crasher')
  }
  return Object.freeze({ steps, sources: Object.freeze(sources) })
}

/** Exact manifest-selected AA-063 operations that attach to a resolved move. */
export const aa063MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const actorAbilities = input.context.queries.abilities.activeForPlacement(actorId)
  const bully = actorAbilities.find(ability => ability.canonicalId === 'Bully')
  if (bully && input.script.damaging && input.script.range.toLowerCase().includes('melee')
    && input.context.queries.resources.actionAvailable(actorId, 'free')
    && sceneUseAvailable({ context: input.context, ownerId: actorId, abilityInstanceId: bully.instanceId, canonicalId: 'Bully' })) {
    for (const target of input.context.selectedPlacements) {
      const suffix = shortHash(`${input.context.resolutionId ?? input.script.moveName}:bully:${target.id}`)
      const requestId = `ability.bully.request.${suffix}`
      const request: MoveReactionRequestEffectOperation = {
        id: requestId, kind: 'reaction-request',
        source: { kind: 'lifecycle-event', id: `ability.bully.target:${target.id}` },
        recipients: { kind: 'none' }, phase: 'after-damage', reasonCode: 'ability.bully.optional-effects',
        payload: {
          requestId: `ability.bully.response.${suffix}`, promptKey: 'ability.bully.use',
          options: [{ id: 'ability.bully.use', labelKey: 'ability.bully.push-trip-injure' }],
          allowPass: true, timing: 'post-damage', priority: 70, ownerPlacementIds: [actorId],
        },
      }
      const condition: MoveConditionEffectOperation = {
        id: `ability.bully.tripped.${suffix}`, kind: 'condition',
        source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
        phase: 'after-damage', reasonCode: 'ability.bully.tripped-target',
        payload: {
          action: 'apply', conditionId: 'tripped', conditionSource: null,
          filter: null, randomChoice: null, duration: null,
          saveTiming: 'canonical', stackPolicy: { kind: 'refresh', maxStacks: null },
        },
      }
      const injury: MoveDirectHpEffectOperation = {
        id: `ability.bully.injury.${suffix}`, kind: 'direct-hp',
        source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
        phase: 'after-damage', reasonCode: 'ability.bully.add-injury',
        payload: {
          mode: 'lose', pool: 'hit-points', calculation: { kind: 'fixed', value: 0 },
          copySource: null, bounds: { minimum: 0, maximum: null }, rounding: 'floor',
          applyTypeImmunity: false, cost: null,
          injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
        },
      }
      const push: MoveMovementRequestEffectOperation = {
        id: `ability.bully.push.${suffix}`, kind: 'movement-request',
        source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
        phase: 'movement', reasonCode: 'ability.bully.push-target',
        payload: {
          requestId: `ability.bully.push.${suffix}`, mode: 'forced', distance: 2, destinationSetId: null,
          displacement: {
            vector: { kind: 'away', source: { kind: 'actor' } },
            distancePolicy: 'up-to-distance', opportunityAttacks: 'ignore',
          },
        },
      }
      operations.push(request, condition, injury, push)
    }
  }
  const celebrate = actorAbilities.find(ability => ability.canonicalId === 'Celebrate')
  if (celebrate && input.script.damaging
    && input.context.queries.resources.actionAvailable(actorId, 'swift')
    && input.context.queries.resources.actionAvailable(actorId, 'free')) {
    const suffix = shortHash(`${input.context.resolutionId ?? input.script.moveName}:celebrate`)
    const requestId = `ability.celebrate.request.${suffix}`
    operations.push({
      id: requestId, kind: 'reaction-request', source: { kind: 'move', id: input.moveSourceId },
      recipients: { kind: 'none' }, phase: 'hit', reasonCode: 'ability.celebrate.optional-disengage',
      payload: {
        requestId: `ability.celebrate.response.${suffix}`, promptKey: 'ability.celebrate.use',
        options: [{ id: 'ability.celebrate.use', labelKey: 'ability.celebrate.disengage' }],
        allowPass: true, timing: 'post-hit', priority: 50, ownerPlacementIds: [actorId],
      },
    } satisfies MoveReactionRequestEffectOperation, {
      id: `ability.celebrate.disengage.${suffix}`, kind: 'movement-request',
      source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
      phase: 'movement', reasonCode: 'ability.celebrate.disengage',
      payload: {
        requestId: `ability.celebrate.disengage.${suffix}`, mode: 'voluntary', distance: 1,
        destinationSetId: `ability.celebrate.destinations.${suffix}`,
        choice: { kind: 'destination', promptKey: 'ability.celebrate.choose-destination', allowPass: true },
      },
    } satisfies MoveMovementRequestEffectOperation)
  }
  const chillingNeigh = actorAbilities.find(ability => ability.canonicalId === 'Chilling Neigh')
  if (chillingNeigh && input.script.damaging
    && input.context.queries.resources.actionAvailable(actorId, 'free')) {
    const suffix = shortHash(`${input.context.resolutionId ?? input.script.moveName}:chilling-neigh`)
    const requestId = `ability.chilling-neigh.request.${suffix}`
    const request: MoveReactionRequestEffectOperation = {
      id: requestId, kind: 'reaction-request', source: { kind: 'move', id: input.moveSourceId },
      recipients: { kind: 'none' }, phase: 'ko', reasonCode: 'ability.chilling-neigh.optional-boost',
      payload: {
        requestId: `ability.chilling-neigh.response.${suffix}`, promptKey: 'ability.chilling-neigh.use',
        options: [{ id: 'ability.chilling-neigh.use', labelKey: 'ability.chilling-neigh.boost-and-aura' }],
        allowPass: true, timing: 'ko', priority: 60, ownerPlacementIds: [actorId],
      },
    }
    const stage: MoveCombatStageEffectOperation = {
      id: `ability.chilling-neigh.attack.${suffix}`, kind: 'combat-stage',
      source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
      phase: 'ko', reasonCode: 'ability.chilling-neigh.raise-attack',
      payload: {
        action: 'modify', stage: 'atk', selectedStage: null, value: 1,
        stageSource: null, rounding: null, applyTypeImmunity: false,
      },
    }
    const evasion: MoveTemporaryEffectOperation = {
      id: `ability.chilling-neigh.evasion.${suffix}`, kind: 'temporary-effect',
      source: { kind: 'operation', id: requestId }, recipients: { kind: 'response-owner' },
      phase: 'schedule', reasonCode: 'ability.chilling-neigh.foe-evasion',
      payload: {
        action: 'add', effectId: `ability.chilling-neigh.evasion.${suffix}`, recipientScope: 'placements',
        definition: {
          kind: 'numeric-modifier', duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
          stacks: 1, charges: null, stackPolicy: { kind: 'refresh', maxStacks: null },
          chargePolicy: { kind: 'none', amount: null }, tags: ['ability', 'aa063', 'chilling-neigh', 'evasion'],
          payload: { attribute: 'evasion', operation: 'add', value: -2, rounding: 'none' },
          dispel: { policy: 'matching-tags', tags: ['chilling-neigh', 'evasion'] }, transferPolicy: 'expire',
        },
      },
    }
    operations.push(request, stage, evasion)
  }
  if (input.context.queries.abilities.has(actorId, 'Brimstone')
    && input.script.damaging
    && ['fire', 'poison'].includes(input.script.type.trim().toLowerCase())) {
    const suffix = shortHash(`${input.context.resolutionId ?? input.script.moveName}:brimstone`)
    operations.push(
      conditionOperation({
        id: `ability.brimstone.burned.${suffix}`, sourceId: input.moveSourceId,
        reasonCode: 'ability.brimstone.complete-statuses', conditionId: 'burned',
      }),
      conditionOperation({
        id: `ability.brimstone.poisoned.${suffix}`, sourceId: input.moveSourceId,
        reasonCode: 'ability.brimstone.complete-statuses', conditionId: 'poisoned',
      }),
    )
  }
  if (input.context.queries.abilities.has(actorId, 'Chemical Romance')
    && CHEMICAL_ROMANCE_MOVES.has(input.script.moveName)) {
    const suffix = shortHash(`${input.context.resolutionId ?? input.script.moveName}:chemical-romance`)
    operations.push(conditionOperation({
      id: `ability.chemical-romance.infatuated.${suffix}`, sourceId: input.moveSourceId,
      reasonCode: 'ability.chemical-romance.infatuated-male-target',
      conditionId: 'infatuation', conditionDetail: actorId,
    }))
  }
  return Object.freeze(operations)
}
