import { createHash } from 'node:crypto'
import type {
  MoveDirectHpEffectOperation,
  MoveEffectOperation,
  MoveReactionRequestEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import { aa075ActiveIllusionEffect } from '#shared/abilityAutomation/aa075'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA075_IGNITION_BOOST_REASON = 'ability.ignition-boost.optional-damage' as const
export const AA075_ILLUSION_BREAK_REASON = 'ability.illusion.break-on-damaging-hit' as const
export const AA075_INNARDS_OUT_REASON = 'ability.innards-out.optional-retaliation' as const
export const AA075_INNARDS_OUT_HP_REASON = 'ability.innards-out.hp-loss' as const
export const AA075_INNARDS_OUT_OPTION_PREFIX = 'ability.innards-out.target:' as const

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const sceneUseAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly limit: number
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
  return spent < input.limit
}

const request = (input: {
  readonly id: string
  readonly sourceEventId: string
  readonly reasonCode: string
  readonly promptKey: string
  readonly options: readonly { readonly id: string; readonly labelKey: string }[]
  readonly ownerId: string
  readonly priority: number
}): MoveReactionRequestEffectOperation => ({
  id: input.id,
  kind: 'reaction-request',
  source: { kind: 'lifecycle-event', id: input.sourceEventId },
  recipients: { kind: 'none' },
  phase: 'after-damage',
  reasonCode: input.reasonCode,
  payload: {
    requestId: `${input.id}.response`,
    promptKey: input.promptKey,
    options: [...input.options],
    allowPass: true,
    timing: 'post-damage',
    priority: input.priority,
    ownerPlacementIds: [input.ownerId],
  },
})

const ignitionBoostOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly moveIdentity: string
}): readonly MoveReactionRequestEffectOperation[] => {
  const actorId = input.context.actor.placement.id
  const operations: MoveReactionRequestEffectOperation[] = []
  for (const placement of [...input.context.queries.placements.all()].sort((left, right) => left.id.localeCompare(right.id))) {
    if (placement.id === actorId
      || input.context.queries.relationships.resolve(placement.id, actorId).relationship !== 'ally') continue
    const token = input.context.queries.tokens.get(placement.id)
    const ability = input.context.queries.abilities.activeForPlacement(placement.id)
      .find(candidate => candidate.canonicalId === 'Ignition Boost')
    if (!token || !ability
      || ptuGridDistanceBetweenFootprints(token, input.context.actor.token) > 1
      || !input.context.queries.resources.actionAvailable(placement.id, 'free')) continue
    const suffix = shortHash(input.moveIdentity, actorId, placement.id, ability.instanceId)
    operations.push(request({
      id: `ability.ignition-boost.request.${suffix}`,
      sourceEventId: `ability.ignition-boost.owner:${placement.id}`,
      reasonCode: AA075_IGNITION_BOOST_REASON,
      promptKey: 'ability.ignition-boost.use',
      options: [{ id: 'ability.ignition-boost.use', labelKey: 'ability.ignition-boost.damage-plus-five' }],
      ownerId: placement.id,
      priority: 42,
    }))
  }
  return Object.freeze(operations)
}

const illusionBreakOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly moveIdentity: string
  readonly targetIds: readonly string[]
}): readonly MoveTemporaryEffectOperation[] => Object.freeze(input.targetIds.flatMap((targetId) => {
  if (!input.context.queries.abilities.has(targetId, 'Illusion')) return []
  const effect = aa075ActiveIllusionEffect(input.context.map.encounterState?.effects, targetId)
  if (!effect) return []
  const suffix = shortHash(input.moveIdentity, targetId, effect.id)
  return [{
    id: `ability.illusion.break.${suffix}`,
    kind: 'temporary-effect',
    source: { kind: 'lifecycle-event', id: `ability.illusion.target:${targetId}` },
    recipients: { kind: 'attacked-targets' },
    phase: 'cleanup',
    reasonCode: AA075_ILLUSION_BREAK_REASON,
    payload: { action: 'remove', effectId: effect.id },
  } satisfies MoveTemporaryEffectOperation]
}))

const innardsOutOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly moveIdentity: string
  readonly targetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const operations: MoveEffectOperation[] = []
  for (const ownerId of [...new Set(input.targetIds)].sort()) {
    const owner = input.context.queries.tokens.get(ownerId)
    const ability = input.context.queries.abilities.activeForPlacement(ownerId)
      .find(candidate => candidate.canonicalId === 'Innards Out')
    if (!owner || !ability
      || !input.context.queries.resources.actionAvailable(ownerId, 'free')
      || !sceneUseAvailable({
        context: input.context,
        ownerId,
        abilityInstanceId: ability.instanceId,
        canonicalId: 'Innards Out',
        limit: 2,
      })) continue
    const foes = input.context.queries.tokens.all()
      .filter(candidate => candidate.id !== ownerId
        // Keep the post-multi-hit reaction state lane disjoint from every
        // target already reduced by the triggering attack.
        && !input.targetIds.includes(candidate.id)
        && input.context.queries.relationships.resolve(ownerId, candidate.id).relationship === 'enemy'
        && ptuGridDistanceBetweenFootprints(owner, candidate) <= 2)
      .sort((left, right) => left.id.localeCompare(right.id))
    if (foes.length === 0) continue
    const suffix = shortHash(input.moveIdentity, ownerId, ability.instanceId)
    const requestId = `ability.innards-out.request.${suffix}`
    operations.push(request({
      id: requestId,
      sourceEventId: `ability.innards-out.target:${ownerId}`,
      reasonCode: AA075_INNARDS_OUT_REASON,
      promptKey: 'ability.innards-out.use',
      options: foes.map(foe => ({
        id: `${AA075_INNARDS_OUT_OPTION_PREFIX}${foe.id}`,
        labelKey: 'ability.innards-out.foe',
      })),
      ownerId,
      priority: 108,
    }))
    for (const foe of foes) {
      operations.push({
        id: `ability.innards-out.hp.${shortHash(suffix, foe.id)}`,
        kind: 'direct-hp',
        source: { kind: 'operation', id: requestId },
        // The selected foe is sealed by the durable response option and then
        // narrowed from this server-owned superset by the core reducer.
        recipients: { kind: 'all-placements' },
        phase: 'cleanup',
        reasonCode: AA075_INNARDS_OUT_HP_REASON,
        payload: {
          mode: 'lose',
          pool: 'hit-points',
          calculation: { kind: 'fixed', value: 0 },
          copySource: null,
          bounds: { minimum: 0, maximum: null },
          rounding: 'floor',
          applyTypeImmunity: false,
          cost: null,
          injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
        },
      } satisfies MoveDirectHpEffectOperation)
    }
  }
  return Object.freeze(operations)
}

/** Rebuilt from exact effective runtimes for immediate, nested, pending, and resumed execution. */
export const aa075MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  if (!input.script.damaging) return Object.freeze([])
  const moveIdentity = input.context.resolutionId ?? `${input.moveSourceId}:${input.script.moveName}`
  const operations: MoveEffectOperation[] = []
  if (input.script.type.trim().toLowerCase() === 'fire') {
    operations.push(...ignitionBoostOperations({ context: input.context, moveIdentity }))
  }
  operations.push(...illusionBreakOperations({
    context: input.context,
    moveIdentity,
    targetIds: input.authoritativeTargetIds,
  }))
  operations.push(...innardsOutOperations({
    context: input.context,
    moveIdentity,
    targetIds: input.authoritativeTargetIds,
  }))
  return Object.freeze(operations)
}
