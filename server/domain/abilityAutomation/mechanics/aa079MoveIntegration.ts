import { createHash } from 'node:crypto'
import {
  AA079_MAGICIAN_ACTOR_REQUIREMENT_ID,
  AA079_MAGICIAN_DESTINATION_ID,
  AA079_MAGICIAN_ITEM_SET_ID,
  AA079_MAGICIAN_REQUEST_PREFIX,
  AA079_MAGICIAN_TARGET_REQUIREMENT_ID,
  AA079_MIMIC_MOVE_LIST_TAG,
  AA079_MIMITREE_REARM_TAG,
} from '#shared/abilityAutomation/aa079'
import { parseMoveItemChoiceDeclaration } from '#shared/moveAutomation/itemChoices'
import {
  parseMoveEffectOperation,
  type MoveChoiceRequestEffectOperation,
  type MoveConditionEffectOperation,
  type MoveDamageEffectOperation,
  type MoveDirectHpEffectOperation,
  type MoveEffectOperation,
  type MoveItemEffectOperation,
  type MoveReactionRequestEffectOperation,
  type MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import type { EncounterMoveListOverlayEffect } from '#shared/moveAutomation/encounterEffects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { computeTickValue } from '~/utils/ptuHp'
import { moveAutomationConditionImmunitySource } from '~/utils/moveAutomationConditionImmunity'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA079_MAGICIAN_REASON = 'ability.magician.optional-held-item-theft' as const
export const AA079_MAGICIAN_ITEM_REASON = 'ability.magician.steal-held-item' as const
export const AA079_MAGMA_ARMOR_REASON = 'ability.magma-armor.melee-hit-point-loss' as const
export const AA079_MIGRAINE_REASON = 'ability.migraine.optional-confusion-critical' as const
export const AA079_MIGRAINE_CONDITION_REASON = 'ability.migraine.confusion-affliction' as const
export const AA079_MIMITREE_REASON = 'ability.mimitree.optional-rearm' as const

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const directSingleTargetAttack = (script: MoveAutomationScript): boolean => script.damaging
  && /(?:^|,)\s*1 Target(?:,|$)/i.test(script.range)
  && !/(?:burst|blast|cone|line|field|self)/i.test(script.range)

const sceneUseAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly limit: number
}): boolean => {
  const sceneId = input.context.map.encounterState?.history.sceneId
  if (!sceneId) return false
  const ledger = input.context.map.encounterState?.abilityUsage
  if (ledger?.sceneId && ledger.sceneId !== sceneId) return true
  const spent = ledger?.entries.find(entry => entry.ownerId === input.context.actor.placement.id
    && entry.abilityInstanceId === input.abilityInstanceId
    && entry.canonicalId === input.canonicalId
    && entry.clauseId === 'base')?.spent ?? 0
  return spent < input.limit
}

const referenceOwnedByPlacement = (
  context: AuthoritativeMoveRulesContext,
  reference: ReturnType<typeof context.queries.items.all>[number],
  placementId: string,
): boolean => {
  if (reference.owner.kind !== 'sheet') return false
  const placement = context.queries.placements.get(placementId)
  return placement !== null
    && placement.sheetKind === reference.owner.sheetKind
    && placement.sheetSlug === reference.owner.slug
}

export const AA079_MAGICIAN_ITEM_CHOICE_DECLARATION = parseMoveItemChoiceDeclaration({
  setId: AA079_MAGICIAN_ITEM_SET_ID,
  requirementId: AA079_MAGICIAN_TARGET_REQUIREMENT_ID,
  owner: 'actor',
  emptyPolicy: 'no-op',
  filter: {
    referenceKinds: ['pokemon-held'],
    canonicalItemIds: null,
    trainerEquipmentSlots: null,
    minimumQuantity: 1,
  },
  destinations: [{
    id: AA079_MAGICIAN_DESTINATION_ID,
    kind: 'actor-held',
    labelKey: 'ability.magician.destination.actor-held',
  }],
  noneOption: null,
})

const magicianOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly moveIdentity: string
  readonly moveSourceId: string
  readonly targetId: string
  readonly abilityInstanceId: string
}): readonly MoveEffectOperation[] => {
  const suffix = shortHash(input.moveIdentity, input.context.actor.placement.id, input.targetId, input.abilityInstanceId)
  const choice = parseMoveEffectOperation({
    id: `ability.magician.choose.${suffix}`,
    kind: 'choice-request',
    source: { kind: 'move', id: input.moveSourceId },
    recipients: { kind: 'hit-targets' },
    phase: 'after-damage',
    reasonCode: AA079_MAGICIAN_REASON,
    payload: {
      requestId: `${AA079_MAGICIAN_REQUEST_PREFIX}.${suffix}`,
      promptKey: 'ability.magician.choose-target-held-item',
      options: [],
      allowPass: true,
      itemChoice: AA079_MAGICIAN_ITEM_CHOICE_DECLARATION,
    },
  }) as MoveChoiceRequestEffectOperation
  const item = parseMoveEffectOperation({
    id: `ability.magician.steal.${suffix}`,
    kind: 'item',
    source: { kind: 'operation', id: choice.id },
    recipients: { kind: 'hit-targets' },
    phase: 'after-damage',
    reasonCode: AA079_MAGICIAN_ITEM_REASON,
    payload: {
      action: 'steal',
      item: {
        kind: 'choice',
        requestId: choice.payload.requestId,
        destinationId: AA079_MAGICIAN_DESTINATION_ID,
      },
      quantity: 1,
      onUnavailable: 'no-op',
    },
  }) as MoveItemEffectOperation
  return Object.freeze([choice, item])
}

const magmaArmorOperation = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly moveIdentity: string
  readonly moveSourceId: string
  readonly ownerId: string
}): MoveDirectHpEffectOperation => parseMoveEffectOperation({
  id: `ability.magma-armor.melee.${shortHash(input.moveIdentity, input.ownerId)}`,
  kind: 'direct-hp',
  source: { kind: 'move', id: input.moveSourceId },
  recipients: { kind: 'actor' },
  phase: 'after-damage',
  reasonCode: AA079_MAGMA_ARMOR_REASON,
  payload: {
    mode: 'lose', pool: 'hit-points',
    calculation: {
      kind: 'fixed',
      value: computeTickValue(input.context.actor.token.fullMaxHp ?? input.context.actor.token.maxHp),
    },
    copySource: null,
    bounds: { minimum: null, maximum: null },
    rounding: 'floor',
    applyTypeImmunity: false,
    cost: null,
    injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
  },
}) as MoveDirectHpEffectOperation

/** Revalidate which Magma Armor owner gates one server-created post-hit operation. */
export const aa079MagmaArmorOwnerForOperation = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDirectHpEffectOperation
  readonly moveIdentity: string
  readonly candidateTargetIds: readonly string[]
}): string | null => {
  if (input.operation.reasonCode !== AA079_MAGMA_ARMOR_REASON) return null
  return [...new Set(input.candidateTargetIds)].sort().find(ownerId => (
    input.operation.id === `ability.magma-armor.melee.${shortHash(input.moveIdentity, ownerId)}`
    && input.context.queries.abilities.has(ownerId, 'Magma Armor')
  )) ?? null
}

const migraineOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly moveIdentity: string
  readonly abilityInstanceId: string
}): readonly MoveEffectOperation[] => {
  const ownerId = input.context.actor.placement.id
  const suffix = shortHash(input.moveIdentity, ownerId, input.abilityInstanceId)
  const request: MoveReactionRequestEffectOperation = {
    id: `ability.migraine.request.${suffix}`,
    kind: 'reaction-request',
    source: { kind: 'lifecycle-event', id: `ability.migraine.owner:${ownerId}` },
    recipients: { kind: 'none' },
    phase: 'hit',
    reasonCode: AA079_MIGRAINE_REASON,
    payload: {
      requestId: `ability.migraine.request.${suffix}.response`,
      promptKey: 'ability.migraine.use',
      options: [{ id: 'ability.migraine.use', labelKey: 'ability.migraine.confuse-and-critical' }],
      allowPass: true,
      timing: 'post-hit',
      priority: 44,
      ownerPlacementIds: [ownerId],
    },
  }
  const condition: MoveConditionEffectOperation = {
    id: `ability.migraine.confused.${suffix}`,
    kind: 'condition',
    source: { kind: 'operation', id: request.id },
    recipients: { kind: 'hit-targets' },
    phase: 'after-damage',
    reasonCode: AA079_MIGRAINE_CONDITION_REASON,
    payload: {
      action: 'apply', conditionId: 'confused', conditionSource: null,
      filter: null, randomChoice: null, duration: null,
      saveTiming: 'canonical', stackPolicy: { kind: 'refresh', maxStacks: null },
      applyTypeImmunity: true, applyMoveImmunity: true,
    },
  }
  return Object.freeze([request, condition])
}

export const aa079MigraineDamageOperation = (input: {
  readonly operation: MoveEffectOperation
  readonly responseOptionForReason: (reasonCode: string) => string | null | undefined
}): MoveEffectOperation => input.operation.kind === 'damage'
  && input.responseOptionForReason(AA079_MIGRAINE_REASON) === 'ability.migraine.use'
  ? {
      ...input.operation,
      payload: {
        ...input.operation.payload,
        criticalHit: { trigger: { kind: 'always' }, prevention: 'honor' },
      },
    } satisfies MoveDamageEffectOperation
  : input.operation

const activeMimicCopy = (
  context: AuthoritativeMoveRulesContext,
): EncounterMoveListOverlayEffect | null => (context.map.encounterState?.effects ?? []).find(
  (effect): effect is EncounterMoveListOverlayEffect => effect.kind === 'move-list-overlay'
    && effect.suppression.sources.length === 0
    && effect.affected.placementIds.includes(context.actor.placement.id)
    && effect.tags.includes(AA079_MIMIC_MOVE_LIST_TAG)
    && effect.payload.action === 'replace',
) ?? null

const mimicCopyOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly moveIdentity: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const targetId = [...new Set(input.authoritativeTargetIds)][0]
  if (!targetId) return []
  const copied = input.context.queries.history.lastCompletedMove(targetId)?.canonicalId
  if (!copied || copied === 'Mimic') return []
  const runtime = input.context.queries.rules.runtimeFor(copied)
  if (!runtime || runtime.kind !== 'movespec-v2') return []
  const copy: MoveTemporaryEffectOperation = {
    id: `ability.mimitree.mimic-copy.${shortHash(input.moveIdentity, targetId, copied, runtime.definitionHash)}`,
    kind: 'temporary-effect',
    source: { kind: 'move', id: 'move.mimic' },
    recipients: { kind: 'actor' },
    phase: 'schedule',
    reasonCode: 'ability.mimitree.mimic-copy',
    payload: {
      action: 'add',
      effectId: `ability.mimitree.mimic-copy.${shortHash(input.context.actor.placement.id, copied)}`,
      recipientScope: 'placements',
      definition: {
        kind: 'move-list-overlay', duration: { kind: 'scene', remaining: null },
        stacks: 1, charges: null,
        stackPolicy: { kind: 'replace', maxStacks: null },
        chargePolicy: { kind: 'none', amount: null },
        tags: ['ability', 'aa079', AA079_MIMIC_MOVE_LIST_TAG],
        payload: {
          action: 'replace', replacedCanonicalMoveId: 'Mimic',
          canonicalMoveId: copied, copiedSpecHash: runtime.definitionHash,
        },
        dispel: { policy: 'matching-tags', tags: [AA079_MIMIC_MOVE_LIST_TAG] },
        transferPolicy: 'expire',
      },
    },
  }
  const rearm = (input.context.map.encounterState?.effects ?? []).find(effect => (
    effect.kind === 'capability'
    && effect.suppression.sources.length === 0
    && effect.affected.placementIds.includes(input.context.actor.placement.id)
    && effect.tags.includes(AA079_MIMITREE_REARM_TAG)
    && effect.payload.action === 'grant'
    && effect.payload.capabilityId === 'aa079.mimitree.ignore-mimic-frequency'
  ))
  if (!rearm) return [copy]
  return [copy, {
    id: `ability.mimitree.consume-rearm.${shortHash(input.moveIdentity, rearm.id)}`,
    kind: 'temporary-effect',
    source: { kind: 'move', id: 'move.mimic' },
    recipients: { kind: 'actor' },
    phase: 'cleanup',
    reasonCode: 'ability.mimitree.consume-frequency-bypass',
    payload: { action: 'remove', effectId: rearm.id },
  }]
}

const mimitreeRearmOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly moveIdentity: string
  readonly copy: EncounterMoveListOverlayEffect
}): readonly MoveEffectOperation[] => {
  const ownerId = input.context.actor.placement.id
  const suffix = shortHash(input.moveIdentity, ownerId, input.copy.id)
  const request: MoveReactionRequestEffectOperation = {
    id: `ability.mimitree.request.${suffix}`,
    kind: 'reaction-request',
    source: { kind: 'lifecycle-event', id: `ability.mimitree.owner:${ownerId}` },
    recipients: { kind: 'actor' },
    phase: 'cleanup',
    reasonCode: AA079_MIMITREE_REASON,
    payload: {
      requestId: `ability.mimitree.request.${suffix}.response`,
      promptKey: 'ability.mimitree.rearm-mimic',
      options: [{ id: 'ability.mimitree.rearm', labelKey: 'ability.mimitree.replace-copied-move' }],
      allowPass: true,
      timing: 'cleanup',
      priority: 120,
      ownerPlacementIds: [ownerId],
    },
  }
  const remove: MoveTemporaryEffectOperation = {
    id: `ability.mimitree.remove-copy.${suffix}`,
    kind: 'temporary-effect',
    source: { kind: 'operation', id: request.id },
    recipients: { kind: 'response-owner' },
    phase: 'cleanup',
    reasonCode: 'ability.mimitree.restore-mimic',
    payload: { action: 'remove', effectId: input.copy.id },
  }
  const rearm: MoveTemporaryEffectOperation = {
    id: `ability.mimitree.rearm.${suffix}`,
    kind: 'temporary-effect',
    source: { kind: 'operation', id: request.id },
    recipients: { kind: 'response-owner' },
    phase: 'cleanup',
    reasonCode: 'ability.mimitree.ignore-mimic-frequency',
    payload: {
      action: 'add', effectId: `ability.mimitree.rearm.${shortHash(ownerId)}`,
      recipientScope: 'placements',
      definition: {
        kind: 'capability', duration: { kind: 'scene', remaining: null },
        stacks: 1, charges: null,
        stackPolicy: { kind: 'replace', maxStacks: null },
        chargePolicy: { kind: 'none', amount: null },
        tags: ['ability', 'aa079', AA079_MIMITREE_REARM_TAG],
        payload: { capabilityId: 'aa079.mimitree.ignore-mimic-frequency', action: 'grant' },
        dispel: { policy: 'matching-tags', tags: [AA079_MIMITREE_REARM_TAG] },
        transferPolicy: 'expire',
      },
    },
  }
  return Object.freeze([request, remove, rearm])
}

/** Rebuilt before immediate, nested, pending, and resumed execution. */
export const aa079MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const moveIdentity = input.context.resolutionId ?? `${input.moveSourceId}:${input.script.moveName}`
  const abilities = input.context.queries.abilities.activeForPlacement(actorId)
  const uniqueTargets = [...new Set(input.authoritativeTargetIds)]

  const magician = abilities.find(ability => ability.canonicalId === 'Magician')
  const targetId = uniqueTargets[0]
  const actorHasHeldItem = input.context.queries.items
    .forRequirement(AA079_MAGICIAN_ACTOR_REQUIREMENT_ID)
    .some(reference => referenceOwnedByPlacement(input.context, reference, actorId))
  const targetHasHeldItem = targetId !== undefined && input.context.queries.items
    .forRequirement(AA079_MAGICIAN_TARGET_REQUIREMENT_ID)
    .some(reference => reference.kind === 'pokemon-held'
      && referenceOwnedByPlacement(input.context, reference, targetId))
  if (magician && targetId && uniqueTargets.length === 1
    && directSingleTargetAttack(input.script)
    && input.context.queries.relationships.resolve(actorId, targetId).relationship === 'enemy'
    && !actorHasHeldItem && targetHasHeldItem
    && input.context.queries.resources.actionAvailable(actorId, 'free')
    && sceneUseAvailable({
      context: input.context, abilityInstanceId: magician.instanceId,
      canonicalId: 'Magician', limit: 1,
    })) operations.push(...magicianOperations({
      context: input.context, moveIdentity, moveSourceId: input.moveSourceId,
      targetId, abilityInstanceId: magician.instanceId,
    }))

  const effectiveActor = {
    ...input.context.actor.token,
    abilityNames: abilities.map(ability => ability.canonicalId),
  }
  const burnImmune = moveAutomationConditionImmunitySource('Burned', effectiveActor) !== null
  if (input.script.damaging && input.script.keywords.some(keyword => keyword.trim().toLowerCase() === 'melee')
    && !burnImmune) {
    for (const ownerId of uniqueTargets.sort()) {
      if (!input.context.queries.abilities.has(ownerId, 'Magma Armor')) continue
      operations.push(magmaArmorOperation({
        context: input.context, moveIdentity, moveSourceId: input.moveSourceId, ownerId,
      }))
    }
  }

  const migraine = abilities.find(ability => ability.canonicalId === 'Migraine')
  const maximumHp = Math.max(1, input.context.actor.token.fullMaxHp ?? input.context.actor.token.maxHp)
  if (migraine && input.script.moveName === 'Confusion'
    && input.context.actor.token.currentHp * 2 <= maximumHp
    && input.context.queries.resources.actionAvailable(actorId, 'free')
    && sceneUseAvailable({
      context: input.context, abilityInstanceId: migraine.instanceId,
      canonicalId: 'Migraine', limit: 2,
    })) operations.push(...migraineOperations({
      context: input.context, moveIdentity, abilityInstanceId: migraine.instanceId,
    }))

  if (abilities.some(ability => ability.canonicalId === 'Mimitree')) {
    if (input.script.moveName === 'Mimic') {
      operations.push(...mimicCopyOperations({
        context: input.context, moveIdentity,
        authoritativeTargetIds: input.authoritativeTargetIds,
      }))
    }
    else {
      const copy = activeMimicCopy(input.context)
      if (copy?.payload.action === 'replace'
        && copy.payload.canonicalMoveId === input.script.moveName) {
        operations.push(...mimitreeRearmOperations({ context: input.context, moveIdentity, copy }))
      }
    }
  }
  return Object.freeze(operations)
}

/** Remove the old Mimic condition marker only when the native Mimitree overlay owns the copy. */
export const applyAa079ReviewedOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly operations: readonly MoveEffectOperation[]
}): readonly MoveEffectOperation[] => input.script.moveName === 'Mimic'
  && input.context.queries.abilities.has(input.context.actor.placement.id, 'Mimitree')
  && input.operations.some(operation => operation.reasonCode === 'ability.mimitree.mimic-copy')
  ? Object.freeze(input.operations.filter(operation => !(
      operation.kind === 'temporary-effect'
      && operation.reasonCode.startsWith('mimic.copied-')
      && operation.payload.action === 'add'
      && operation.payload.definition.kind === 'condition'
    )))
  : input.operations
