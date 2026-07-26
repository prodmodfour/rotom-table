import { createHash } from 'node:crypto'
import type { EncounterEffectDuration } from '#shared/moveAutomation/encounterEffects'
import type {
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveDamageEffectOperation,
  MoveEffectOperation,
  MoveMultiHitEffectOperation,
  MoveReactionRequestEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { CharacterSheet } from '~/types/characterSheet'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { normalizeConditionName } from '~/utils/statusConditions'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveSpecResponseResolver } from '../../moveAutomation/responses'
import { moveUsageKey } from '~/utils/moveUsage'

export const AA083_PERISH_BODY_REASON = 'ability.perish-body.optional-count' as const
export const AA083_PICKPOCKET_REASON = 'ability.pickpocket.optional-held-item-theft' as const
export const AA083_PIXILATE_REASON = 'ability.pixilate.optional-fairy-type' as const
export const AA083_PLUS_REQUEST_REASON = 'ability.plus.optional-additional-stage' as const
export const AA083_PLUS_STAGE_REASON = 'ability.plus.apply-additional-stage' as const
export const AA083_POISON_HEAL_REASON = 'ability.poison-heal.optional-activate' as const
export const AA083_POISON_POINT_REASON = 'ability.poison-point.optional-poison' as const
export const AA083_POLYCEPHALY_REASON = 'ability.polycephaly.optional-swift-struggle' as const
export const AA083_POLYCEPHALY_DAMAGE_REASON = 'ability.polycephaly.swift-struggle-resisted' as const
export const AA083_PERISH_COUNT_TAG = 'aa083-perish-count' as const
export const AA083_POISON_HEAL_TAG = 'aa083-poison-heal-active' as const

const hash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const dailyAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly canonicalId: string
}): boolean => {
  const placement = input.context.queries.placements.get(input.ownerId)
  const resolved = placement ? input.context.queries.sheets.forPlacement(placement) : null
  if (!resolved) return false
  return !resolved.sheet.abilityUsage?.entries.some(entry => (
    entry.ownerId === `sheet:${resolved.kind}:${resolved.slug}`
    && entry.canonicalId === input.canonicalId
    && entry.clauseId === 'base'
    && entry.spent >= entry.limit
  ))
}

const sceneAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly limit?: number
}): boolean => {
  const sceneId = input.context.map.encounterState?.history.sceneId
  if (!sceneId) return false
  const ledger = input.context.map.encounterState?.abilityUsage
  if (ledger?.sceneId && ledger.sceneId !== sceneId) return true
  return (ledger?.entries.find(entry => entry.ownerId === input.ownerId
    && entry.abilityInstanceId === input.abilityInstanceId
    && entry.canonicalId === input.canonicalId
    && entry.clauseId === 'base')?.spent ?? 0) < (input.limit ?? 1)
}

const reaction = (input: {
  readonly id: string
  readonly sourceId: string
  readonly ownerId: string
  readonly reasonCode: string
  readonly optionId: string
  readonly promptKey: string
  readonly phase: MoveReactionRequestEffectOperation['phase']
  readonly timing: MoveReactionRequestEffectOperation['payload']['timing']
  readonly priority: number
}): MoveReactionRequestEffectOperation => ({
  id: input.id,
  kind: 'reaction-request',
  source: { kind: 'lifecycle-event', id: input.sourceId },
  recipients: { kind: 'none' },
  phase: input.phase,
  reasonCode: input.reasonCode,
  payload: {
    requestId: `${input.id}.response`, promptKey: input.promptKey,
    options: [{ id: input.optionId, labelKey: input.optionId }],
    allowPass: true, timing: input.timing, priority: input.priority,
    ownerPlacementIds: [input.ownerId],
  },
})

const condition = (input: {
  readonly id: string
  readonly requestId: string
  readonly reasonCode: string
  readonly conditionId: string
  readonly recipients: MoveConditionEffectOperation['recipients']['kind']
}): MoveConditionEffectOperation => ({
  id: input.id, kind: 'condition', source: { kind: 'operation', id: input.requestId },
  recipients: { kind: input.recipients }, phase: 'after-damage', reasonCode: input.reasonCode,
  payload: {
    action: 'apply', conditionId: input.conditionId, conditionSource: null,
    filter: null, randomChoice: null, duration: null, saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
  },
})

const marker = (input: {
  readonly id: string
  readonly requestId: string
  readonly recipients: 'actor' | 'response-owner'
  readonly tag: string
  readonly capabilityId: string
  readonly duration: EncounterEffectDuration
}): MoveTemporaryEffectOperation => ({
  id: input.id, kind: 'temporary-effect', source: { kind: 'operation', id: input.requestId },
  recipients: { kind: input.recipients }, phase: 'schedule', reasonCode: input.tag,
  payload: {
    action: 'add', effectId: input.id, recipientScope: 'placements',
    definition: {
      kind: 'capability', duration: input.duration, stacks: 1, charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['ability', 'aa083', input.tag],
      payload: { capabilityId: input.capabilityId, action: 'grant' },
      dispel: { policy: 'matching-tags', tags: [input.tag] },
      transferPolicy: 'expire',
    },
  },
})

const perishBodyOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly identity: string
  readonly targetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  if (!/\bmelee\b/i.test(input.script.range)) return []
  return [...new Set(input.targetIds)].sort().flatMap(ownerId => {
    const ability = input.context.queries.abilities.activeForPlacement(ownerId)
      .find(candidate => candidate.canonicalId === 'Perish Body')
    if (!ability || !input.context.queries.resources.actionAvailable(ownerId, 'standard')
      || !dailyAvailable({ context: input.context, ownerId, canonicalId: 'Perish Body' })) return []
    const suffix = hash(input.identity, ownerId, ability.instanceId)
    const requestId = `ability.perish-body.request.${suffix}`
    const request = reaction({
      id: requestId, sourceId: `ability.perish-body.target:${ownerId}`,
      ownerId, reasonCode: AA083_PERISH_BODY_REASON,
      optionId: 'ability.perish-body.use', promptKey: 'ability.perish-body.use',
      phase: 'hit', timing: 'post-hit', priority: 140,
    })
    const duration = { kind: 'turns' as const, subject: 'target' as const, boundary: 'start' as const, remaining: 3 }
    return [
      request,
      marker({ id: `ability.perish-body.owner.${suffix}`, requestId, recipients: 'response-owner', tag: AA083_PERISH_COUNT_TAG, capabilityId: 'aa083.perish-count', duration }),
      marker({ id: `ability.perish-body.attacker.${suffix}`, requestId, recipients: 'actor', tag: AA083_PERISH_COUNT_TAG, capabilityId: 'aa083.perish-count', duration }),
    ]
  })
}

const pickpocketOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly identity: string
  readonly targetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  if (!/\bmelee\b/i.test(input.script.range)) return []
  const actorId = input.context.actor.placement.id
  const actorResolved = input.context.queries.sheets.forPlacement(input.context.actor.placement)
  const actorHeld = actorResolved?.kind === 'pokemon'
    ? (actorResolved.sheet as CharacterSheet).items?.held?.trim() ?? ''
    : ''
  if (!actorHeld) return []
  return [...new Set(input.targetIds)].sort().flatMap(ownerId => {
    if (input.context.queries.relationships.resolve(actorId, ownerId).relationship !== 'enemy') return []
    const placement = input.context.queries.placements.get(ownerId)
    const resolved = placement ? input.context.queries.sheets.forPlacement(placement) : null
    const ownerHeld = resolved?.kind === 'pokemon'
      ? (resolved.sheet as CharacterSheet).items?.held?.trim() ?? ''
      : null
    const ability = input.context.queries.abilities.activeForPlacement(ownerId)
      .find(candidate => candidate.canonicalId === 'Pickpocket')
    if (!ability || ownerHeld === null || ownerHeld.length > 0
      || !input.context.queries.resources.actionAvailable(ownerId, 'free')
      || !sceneAvailable({ context: input.context, ownerId, abilityInstanceId: ability.instanceId, canonicalId: 'Pickpocket' })) return []
    const suffix = hash(input.identity, actorId, ownerId, ability.instanceId)
    return [reaction({
      id: `ability.pickpocket.request.${suffix}`, sourceId: `ability.pickpocket.target:${ownerId}`,
      ownerId, reasonCode: AA083_PICKPOCKET_REASON,
      optionId: 'ability.pickpocket.use', promptKey: 'ability.pickpocket.use',
      phase: 'hit', timing: 'post-hit', priority: 126,
    })]
  })
}

const poisonPointOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly identity: string
  readonly targetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  if (!/\bmelee\b/i.test(input.script.range)) return []
  return [...new Set(input.targetIds)].sort().flatMap(ownerId => {
    if (input.context.queries.relationships.resolve(
      input.context.actor.placement.id,
      ownerId,
    ).relationship !== 'enemy') return []
    const ability = input.context.queries.abilities.activeForPlacement(ownerId)
      .find(candidate => candidate.canonicalId === 'Poison Point')
    if (!ability || !input.context.queries.resources.actionAvailable(ownerId, 'free')
      || !sceneAvailable({ context: input.context, ownerId, abilityInstanceId: ability.instanceId, canonicalId: 'Poison Point' })) return []
    const suffix = hash(input.identity, ownerId, ability.instanceId)
    const requestId = `ability.poison-point.request.${suffix}`
    return [reaction({
      id: requestId, sourceId: `ability.poison-point.target:${ownerId}`,
      ownerId, reasonCode: AA083_POISON_POINT_REASON,
      optionId: 'ability.poison-point.use', promptKey: 'ability.poison-point.use',
      phase: 'hit', timing: 'post-hit', priority: 124,
    }), condition({
      id: `ability.poison-point.condition.${suffix}`, requestId,
      reasonCode: 'ability.poison-point.apply-poisoned', conditionId: 'poisoned', recipients: 'response-owner',
    })]
  })
}

const pixilateOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly identity: string
}): readonly MoveEffectOperation[] => {
  const actorId = input.context.actor.placement.id
  const ability = input.context.queries.abilities.activeForPlacement(actorId)
    .find(candidate => candidate.canonicalId === 'Pixilate')
  if (!ability || input.script.type.trim().toLowerCase() !== 'normal'
    || !input.script.damaging || !input.context.queries.resources.actionAvailable(actorId, 'free')) return []
  const suffix = hash(input.identity, actorId, ability.instanceId)
  return [reaction({
    id: `ability.pixilate.request.${suffix}`, sourceId: `ability.pixilate.actor:${actorId}`,
    ownerId: actorId, reasonCode: AA083_PIXILATE_REASON,
    optionId: 'ability.pixilate.fairy', promptKey: 'ability.pixilate.use',
    phase: 'declare', timing: 'declare', priority: 117,
  })]
}

const polycephalyOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly identity: string
}): readonly MoveEffectOperation[] => {
  const actorId = input.context.actor.placement.id
  const ability = input.context.queries.abilities.activeForPlacement(actorId)
    .find(candidate => candidate.canonicalId === 'Polycephaly')
  if (!ability || input.script.moveName !== 'Struggle'
    || !input.context.queries.resources.actionAvailable(actorId, 'swift')) return []
  const suffix = hash(input.identity, actorId, ability.instanceId)
  return [reaction({
    id: `ability.polycephaly.request.${suffix}`, sourceId: `ability.polycephaly.actor:${actorId}`,
    ownerId: actorId, reasonCode: AA083_POLYCEPHALY_REASON,
    optionId: 'ability.polycephaly.swift', promptKey: 'ability.polycephaly.use-swift',
    phase: 'declare', timing: 'declare', priority: 116,
  })]
}

const poisonHealOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly identity: string
  readonly targetIds: readonly string[]
  readonly reviewedOperations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  const poisonOperations = input.reviewedOperations.filter(operation => operation.kind === 'condition'
    && operation.payload.action === 'apply'
    && ['Poisoned', 'Badly Poisoned'].includes(normalizeConditionName(operation.payload.conditionId) ?? ''))
  const actorId = input.context.actor.placement.id
  const poisonTouchPotential = input.script.damaging
    && input.context.queries.abilities.has(actorId, 'Poison Touch')
  if (poisonOperations.length === 0 && !poisonTouchPotential) return []
  const actorPotential = poisonOperations.some(operation => [
    'actor', 'actor-and-targets', 'actor-and-attacked-targets', 'actor-and-hit-targets',
  ].includes(operation.recipients.kind))
  const potentialIds = actorPotential ? [actorId, ...input.targetIds] : input.targetIds
  return [...new Set(potentialIds)].sort().flatMap(ownerId => {
    const token = input.context.queries.tokens.get(ownerId)
    const ability = input.context.queries.abilities.activeForPlacement(ownerId)
      .find(candidate => candidate.canonicalId === 'Poison Heal')
    const alreadyActive = input.context.map.encounterState?.effects.some(effect => (
      effect.tags.includes(AA083_POISON_HEAL_TAG) && effect.affected.placementIds.includes(ownerId)
      && effect.suppression.sources.length === 0
    ))
    if (!token || ability === undefined || alreadyActive
      || !dailyAvailable({ context: input.context, ownerId, canonicalId: 'Poison Heal' })
      || token.conditions.some(value => ['Poisoned', 'Badly Poisoned'].includes(normalizeConditionName(value) ?? ''))
      || !input.context.queries.resources.actionAvailable(ownerId, 'free')) return []
    const suffix = hash(input.identity, ownerId, ability.instanceId)
    const requestId = `ability.poison-heal.request.${suffix}`
    return [reaction({
      id: requestId, sourceId: `ability.poison-heal.target:${ownerId}`,
      ownerId, reasonCode: AA083_POISON_HEAL_REASON,
      optionId: 'ability.poison-heal.use', promptKey: 'ability.poison-heal.use',
      phase: 'after-damage', timing: 'post-damage', priority: 122,
    }), marker({
      id: `ability.poison-heal.marker.${suffix}`, requestId, recipients: 'response-owner',
      tag: AA083_POISON_HEAL_TAG, capabilityId: 'aa083.poison-heal-active',
      duration: { kind: 'scene', remaining: null },
    })]
  })
}

const plusOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly identity: string
  readonly targetIds: readonly string[]
  readonly reviewedOperations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  const raises = input.reviewedOperations.filter((operation): operation is MoveCombatStageEffectOperation => (
    operation.kind === 'combat-stage' && operation.payload.action === 'modify'
    && typeof operation.payload.value === 'number' && operation.payload.value > 0
    && ['atk', 'def', 'satk', 'sdef', 'spd', 'acc'].includes(operation.payload.stage ?? '')
  ))
  if (raises.length === 0) return []
  const actorId = input.context.actor.placement.id
  const possibleTargets = [...new Set([actorId, ...input.targetIds])].sort()
  return possibleTargets.flatMap(targetId => {
    const target = input.context.queries.tokens.get(targetId)
    if (!target) return []
    const relevantByStage = new Map<string, MoveCombatStageEffectOperation>()
    for (const operation of raises.filter(operation => operation.recipients.kind === 'actor'
      ? targetId === actorId
      : targetId !== actorId)) {
      const stage = operation.payload.stage
      if (stage && !relevantByStage.has(stage)) relevantByStage.set(stage, operation)
    }
    const relevant = [...relevantByStage.values()]
    if (relevant.length === 0) return []
    return input.context.queries.placements.all().flatMap(placement => {
      const ownerId = placement.id
      const owner = input.context.queries.tokens.get(ownerId)
      const ability = input.context.queries.abilities.activeForPlacement(ownerId)
        .find(candidate => candidate.canonicalId === 'Plus')
      if (!owner || !ability || ownerId === targetId
        || input.context.queries.relationships.resolve(ownerId, targetId).relationship !== 'ally'
        || ptuGridDistanceBetweenFootprints(owner, target) > 10
        || !input.context.queries.resources.actionAvailable(ownerId, 'free')
        || !sceneAvailable({ context: input.context, ownerId, abilityInstanceId: ability.instanceId, canonicalId: 'Plus', limit: 2 })) return []
      const suffix = hash(input.identity, ownerId, targetId, ability.instanceId, ...relevant.map(operation => operation.id))
      const requestId = `ability.plus.request.${suffix}`
      const optionId = (operation: MoveCombatStageEffectOperation) => `ability.plus.${operation.payload.stage}`
      const request: MoveReactionRequestEffectOperation = {
        id: requestId, kind: 'reaction-request', source: { kind: 'lifecycle-event', id: `ability.plus.target:${targetId}` },
        recipients: { kind: 'none' }, phase: 'after-damage', reasonCode: AA083_PLUS_REQUEST_REASON,
        payload: {
          requestId: `${requestId}.response`, promptKey: 'ability.plus.choose-raised-stat',
          options: relevant.map(operation => ({ id: optionId(operation), labelKey: optionId(operation) })),
          allowPass: true, timing: 'post-damage', priority: 46, ownerPlacementIds: [ownerId],
        },
      }
      return [request, ...relevant.map((operation, index): MoveCombatStageEffectOperation => ({
        ...operation,
        id: `ability.plus.stage.${suffix}.${index + 1}`,
        source: { kind: 'lifecycle-event', id: `ability.plus.response:${requestId}:option:${optionId(operation)}:target:${targetId}` },
        recipients: { kind: operation.recipients.kind === 'actor' ? 'actor' : 'hit-targets' },
        phase: 'after-damage', reasonCode: AA083_PLUS_STAGE_REASON,
        payload: { ...operation.payload, value: 1 },
      }))]
    })
  })
}

export const aa083MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
  readonly reviewedOperations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => {
  const identity = input.context.resolutionId ?? `${input.moveSourceId}:${input.script.moveName}`
  return Object.freeze([
    ...pixilateOperations({ ...input, identity }),
    ...polycephalyOperations({ ...input, identity }),
    ...perishBodyOperations({ ...input, identity, targetIds: input.authoritativeTargetIds }),
    ...pickpocketOperations({ ...input, identity, targetIds: input.authoritativeTargetIds }),
    ...poisonPointOperations({ ...input, identity, targetIds: input.authoritativeTargetIds }),
    ...poisonHealOperations({ ...input, identity, targetIds: input.authoritativeTargetIds }),
    ...plusOperations({ ...input, identity, targetIds: input.authoritativeTargetIds }),
  ])
}

const selectedReaction = (input: {
  readonly operations: readonly MoveEffectOperation[]
  readonly responses: MoveSpecResponseResolver
  readonly reasonCode: string
  readonly optionId: string
}): boolean => {
  const request = input.operations.find((operation): operation is MoveReactionRequestEffectOperation => (
    operation.kind === 'reaction-request' && operation.reasonCode === input.reasonCode
  ))
  return Boolean(request && input.responses.resolve({
    requestId: request.payload.requestId,
    options: request.payload.options,
    allowPass: request.payload.allowPass,
  })?.optionId === input.optionId)
}

export const aa083SelectedMoveType = (input: {
  readonly operations: readonly MoveEffectOperation[]
  readonly responses: MoveSpecResponseResolver
}): 'fairy' | null => selectedReaction({
  ...input,
  reasonCode: AA083_PIXILATE_REASON,
  optionId: 'ability.pixilate.fairy',
}) ? 'fairy' : null

const poisonCondition = (operation: MoveEffectOperation): operation is MoveConditionEffectOperation => (
  operation.kind === 'condition'
  && operation.payload.action === 'apply'
  && ['Poisoned', 'Badly Poisoned'].includes(normalizeConditionName(operation.payload.conditionId) ?? '')
)

const transformedPoisonRange = (
  operation: MoveConditionEffectOperation,
): MoveConditionEffectOperation => {
  const trigger = operation.payload.accuracyRollTrigger?.trigger
  if (!trigger || trigger.kind !== 'range') return operation
  return {
    ...operation,
    payload: {
      ...operation.payload,
      accuracyRollTrigger: {
        ...operation.payload.accuracyRollTrigger!,
        trigger: { ...trigger, minimum: Math.max(1, trigger.minimum - 2) },
      },
    },
  }
}

/** Apply response-selected Pixilate/Polycephaly branches and static Poison Touch. */
export const applyAa083ReviewedOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly operations: readonly MoveEffectOperation[]
  readonly moveOwnedOperationIds: ReadonlySet<string>
  readonly responses: MoveSpecResponseResolver
}): readonly MoveEffectOperation[] => {
  const pixilate = aa083SelectedMoveType(input)
  const polycephaly = input.script.moveName === 'Struggle' && selectedReaction({
    operations: input.operations,
    responses: input.responses,
    reasonCode: AA083_POLYCEPHALY_REASON,
    optionId: 'ability.polycephaly.swift',
  })
  const poisonTouch = input.script.damaging
    && input.context.queries.abilities.has(input.context.actor.placement.id, 'Poison Touch')
  const existingPoison = input.operations.some(operation => (
    input.moveOwnedOperationIds.has(operation.id) && poisonCondition(operation)
  ))
  const transformed = input.operations.map((operation): MoveEffectOperation => {
    if (!input.moveOwnedOperationIds.has(operation.id)) return operation
    let next = poisonTouch && poisonCondition(operation)
      ? transformedPoisonRange(operation)
      : operation
    if (pixilate && next.kind === 'damage') {
      next = { ...next, payload: { ...next.payload, moveType: pixilate } }
    }
    else if (pixilate && next.kind === 'multi-hit') {
      next = { ...next, payload: { ...next.payload, damage: { ...next.payload.damage, moveType: pixilate } } }
    }
    if (polycephaly && (next.kind === 'damage' || next.kind === 'multi-hit')) {
      next = { ...next, reasonCode: AA083_POLYCEPHALY_DAMAGE_REASON } as MoveDamageEffectOperation | MoveMultiHitEffectOperation
    }
    return next
  })
  const accuracyOperation = input.operations.find(operation => (
    input.moveOwnedOperationIds.has(operation.id)
    && operation.kind === 'roll'
    && operation.phase === 'accuracy'
    && operation.payload.formula.kind === 'dice'
    && operation.payload.formula.sides === 20
  ))
  if (!poisonTouch || existingPoison || accuracyOperation?.kind !== 'roll') return Object.freeze(transformed)
  const rollKey = moveUsageKey(input.script.moveName)
    ?? input.script.moveName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const suffix = hash(input.context.resolutionId ?? input.script.moveName, input.context.actor.placement.id, 'Poison Touch')
  const moveSourceId = input.operations.find(operation => operation.source.kind === 'move')?.source.id
    ?? `move.${rollKey}`
  return Object.freeze([...transformed, {
    id: `ability.poison-touch.condition.${suffix}`,
    kind: 'condition',
    source: { kind: 'move', id: moveSourceId },
    recipients: { kind: 'hit-targets' },
    phase: 'after-damage',
    reasonCode: 'ability.poison-touch.apply-poisoned',
    payload: {
      action: 'apply', conditionId: 'poisoned', conditionSource: null,
      filter: null, randomChoice: null,
      accuracyRollTrigger: {
        rollId: accuracyOperation.payload.rollId,
        trigger: { kind: 'range', minimum: 19 },
      },
      duration: null, saveTiming: 'canonical',
      stackPolicy: { kind: 'refresh', maxStacks: null },
      applyMoveImmunity: true, applyTypeImmunity: true,
    },
  } satisfies MoveConditionEffectOperation])
}
