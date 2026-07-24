import { createHash } from 'node:crypto'
import type {
  MoveEffectOperation,
  MoveNestedMoveEffectOperation,
  MoveReactionRequestEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import { AA071_FOX_FIRE_WISP_CAPABILITY } from '#shared/abilityAutomation/aa071'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA071_FOX_FIRE_REASON = 'ability.fox-fire.optional-ember' as const
export const AA071_FRIEND_GUARD_REASON = 'ability.friend-guard.optional-resistance' as const
export const AA071_FULL_GUARD_REASON = 'ability.full-guard.optional-resistance' as const

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const sceneUseAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
}): boolean => {
  const sceneId = input.context.map.encounterState?.history.sceneId
  if (!sceneId) return false
  const ledger = input.context.map.encounterState?.abilityUsage
  if (ledger?.sceneId && ledger.sceneId !== sceneId) return true
  const spent = ledger?.entries.find(entry => (
    entry.ownerId === input.ownerId
    && entry.abilityInstanceId === input.abilityInstanceId
    && entry.canonicalId === input.canonicalId
    && entry.clauseId === 'base'
  ))?.spent ?? 0
  return spent < 1
}

const optionalRequest = (input: {
  readonly id: string
  readonly moveSourceId: string
  readonly sourceEventId?: string
  readonly reasonCode: string
  readonly promptKey: string
  readonly optionId: string
  readonly optionLabelKey: string
  readonly ownerId: string
  readonly phase: MoveReactionRequestEffectOperation['phase']
  readonly timing: MoveReactionRequestEffectOperation['payload']['timing']
  readonly priority: number
}): MoveReactionRequestEffectOperation => ({
  id: input.id,
  kind: 'reaction-request',
  source: input.sourceEventId
    ? { kind: 'lifecycle-event', id: input.sourceEventId }
    : { kind: 'move', id: input.moveSourceId },
  recipients: { kind: 'none' },
  phase: input.phase,
  reasonCode: input.reasonCode,
  payload: {
    requestId: `${input.id}.response`,
    promptKey: input.promptKey,
    options: [{ id: input.optionId, labelKey: input.optionLabelKey }],
    allowPass: true,
    timing: input.timing,
    priority: input.priority,
    ownerPlacementIds: [input.ownerId],
  },
})

const foxFireNestedMove = (input: {
  readonly requestId: string
  readonly suffix: string
}): MoveNestedMoveEffectOperation => ({
  id: `ability.fox-fire.ember.${input.suffix}`,
  kind: 'nested-move',
  source: { kind: 'operation', id: input.requestId },
  recipients: { kind: 'source-placement' },
  phase: 'cleanup',
  reasonCode: 'fox-fire',
  payload: {
    canonicalId: 'Ember',
    actor: { kind: 'response-owner' },
    source: { kind: 'registered-spec' },
    targeting: { kind: 'operation-recipients' },
  },
})

const removeWisp = (input: {
  readonly requestId: string
  readonly suffix: string
  readonly effectId: string
}): MoveTemporaryEffectOperation => ({
  id: `ability.fox-fire.consume-wisp.${input.suffix}`,
  kind: 'temporary-effect',
  source: { kind: 'operation', id: input.requestId },
  recipients: { kind: 'response-owner' },
  phase: 'cleanup',
  reasonCode: 'ability.fox-fire.consume-wisp',
  payload: { action: 'remove', effectId: input.effectId },
})

/** Durable AA-071 reactions reconstructed identically for root, child, and resumed Moves. */
export const aa071MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const moveIdentity = `${input.context.resolutionId}:${input.script.moveName}`
  const targetIds = [...new Set(input.authoritativeTargetIds)].sort()
  const foxFireChild = input.context.ancestry.some(entry => (
    entry.parentOperationId?.startsWith('ability.fox-fire.ember.') === true
  ))

  for (const targetId of targetIds) {
    const target = input.context.queries.tokens.get(targetId)
    if (!target) continue

    if (!foxFireChild
      && input.context.queries.relationships.resolve(targetId, actorId).relationship === 'enemy'
      && ptuGridDistanceBetweenFootprints(target, input.context.actor.token) <= 6
      && input.context.queries.resources.actionAvailable(targetId, 'free')) {
      const foxFire = input.context.queries.abilities.activeForPlacement(targetId)
        .find(ability => ability.canonicalId === 'Fox Fire')
      const wisp = foxFire
        ? (input.context.map.encounterState?.effects ?? [])
            .filter(effect => (
              effect.kind === 'capability'
              && effect.payload.action === 'grant'
              && effect.payload.capabilityId === AA071_FOX_FIRE_WISP_CAPABILITY
              && effect.affected.placementIds.includes(targetId)
              && effect.suppression.sources.length === 0
              && (effect.duration.remaining === null || effect.duration.remaining > 0)
            ))
            .sort((left, right) => left.id.localeCompare(right.id))[0]
        : null
      if (foxFire && wisp) {
        const suffix = shortHash(moveIdentity, actorId, targetId, foxFire.instanceId, wisp.id)
        const requestId = `ability.fox-fire.request.${suffix}`
        operations.push(optionalRequest({
          id: requestId,
          moveSourceId: input.moveSourceId,
          reasonCode: AA071_FOX_FIRE_REASON,
          promptKey: 'ability.fox-fire.use',
          optionId: 'ability.fox-fire.use',
          optionLabelKey: 'ability.fox-fire.use-ember',
          ownerId: targetId,
          phase: 'cleanup',
          timing: 'cleanup',
          priority: 88,
        }), removeWisp({ requestId, suffix, effectId: wisp.id }),
        foxFireNestedMove({ requestId, suffix }))
      }
    }

    const fullGuard = input.context.queries.abilities.activeForPlacement(targetId)
      .find(ability => ability.canonicalId === 'Full Guard')
    if (fullGuard
      && (target.temporaryHp ?? 0) > 0
      && input.context.queries.resources.actionAvailable(targetId, 'swift')
      && sceneUseAvailable({
        context: input.context,
        ownerId: targetId,
        abilityInstanceId: fullGuard.instanceId,
        canonicalId: 'Full Guard',
      })) {
      const suffix = shortHash(moveIdentity, actorId, targetId, fullGuard.instanceId)
      operations.push(optionalRequest({
        id: `ability.full-guard.request.${suffix}`,
        moveSourceId: input.moveSourceId,
        sourceEventId: `ability.full-guard.target:${targetId}`,
        reasonCode: AA071_FULL_GUARD_REASON,
        promptKey: 'ability.full-guard.use',
        optionId: 'ability.full-guard.use',
        optionLabelKey: 'ability.full-guard.resist-damage',
        ownerId: targetId,
        phase: 'after-damage',
        timing: 'post-damage',
        priority: 105,
      }))
    }

    for (const provider of [...input.context.queries.placements.all()].sort((left, right) => left.id.localeCompare(right.id))) {
      if (provider.id === targetId
        || input.context.queries.relationships.resolve(provider.id, targetId).relationship !== 'ally') continue
      const providerToken = input.context.queries.tokens.get(provider.id)
      const friendGuard = input.context.queries.abilities.activeForPlacement(provider.id)
        .find(ability => ability.canonicalId === 'Friend Guard')
      if (!providerToken || !friendGuard
        || ptuGridDistanceBetweenFootprints(providerToken, target) > 1
        || !input.context.queries.resources.actionAvailable(provider.id, 'free')
        || !sceneUseAvailable({
          context: input.context,
          ownerId: provider.id,
          abilityInstanceId: friendGuard.instanceId,
          canonicalId: 'Friend Guard',
        })) continue
      const suffix = shortHash(moveIdentity, actorId, targetId, provider.id, friendGuard.instanceId)
      operations.push(optionalRequest({
        id: `ability.friend-guard.request.${suffix}`,
        moveSourceId: input.moveSourceId,
        sourceEventId: `ability.friend-guard.target:${targetId}`,
        reasonCode: AA071_FRIEND_GUARD_REASON,
        promptKey: 'ability.friend-guard.use',
        optionId: 'ability.friend-guard.use',
        optionLabelKey: 'ability.friend-guard.resist-damage',
        ownerId: provider.id,
        phase: 'after-damage',
        timing: 'post-damage',
        priority: 106,
      }))
    }
  }

  return Object.freeze(operations)
}
