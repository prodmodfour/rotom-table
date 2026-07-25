import { createHash } from 'node:crypto'
import type {
  MoveCombatStageEffectOperation,
  MoveDirectHpEffectOperation,
  MoveEffectOperation,
  MoveReactionRequestEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA076_IRON_BARBS_REASON = 'ability.iron-barbs.optional-hp-loss' as const
export const AA076_IRON_BARBS_HP_REASON = 'ability.iron-barbs.attacker-hp-loss' as const
export const AA076_JUSTIFIED_REASON = 'ability.justified.optional-attack-stage' as const
export const AA076_KAMPFGEIST_REASON = 'ability.kampfgeist.optional-resistance' as const

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

const request = (input: {
  readonly id: string
  readonly sourceEventId: string
  readonly reasonCode: string
  readonly promptKey: string
  readonly optionId: string
  readonly optionLabelKey: string
  readonly ownerId: string
  readonly timing: 'post-hit' | 'post-damage'
  readonly priority: number
}): MoveReactionRequestEffectOperation => ({
  id: input.id,
  kind: 'reaction-request',
  source: { kind: 'lifecycle-event', id: input.sourceEventId },
  recipients: { kind: 'none' },
  phase: input.timing === 'post-hit' ? 'hit' : 'after-damage',
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

const ironBarbsHp = (requestId: string, suffix: string): MoveDirectHpEffectOperation => ({
  id: `ability.iron-barbs.hp.${suffix}`,
  kind: 'direct-hp',
  source: { kind: 'operation', id: requestId },
  recipients: { kind: 'all-placements' },
  phase: 'cleanup',
  reasonCode: AA076_IRON_BARBS_HP_REASON,
  payload: {
    mode: 'lose',
    pool: 'hit-points',
    calculation: { kind: 'percent-max', percent: 10 },
    copySource: null,
    bounds: { minimum: 0, maximum: null },
    rounding: 'floor',
    applyTypeImmunity: true,
    cost: null,
    injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
  },
})

const justifiedStage = (requestId: string, suffix: string): MoveCombatStageEffectOperation => ({
  id: `ability.justified.attack.${suffix}`,
  kind: 'combat-stage',
  source: { kind: 'operation', id: requestId },
  recipients: { kind: 'response-owner' },
  phase: 'cleanup',
  reasonCode: 'ability.justified.raise-attack',
  payload: {
    action: 'modify', stage: 'atk', selectedStage: null, value: 1,
    stageSource: null, rounding: null,
  },
})

/** Rebuilt from exact effective runtimes for immediate, nested, pending, and resumed execution. */
export const aa076MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  if (!input.script.damaging) return Object.freeze([])

  const operations: MoveEffectOperation[] = []
  const actorId = input.context.actor.placement.id
  const moveIdentity = input.context.resolutionId ?? `${input.moveSourceId}:${input.script.moveName}`
  const melee = input.script.keywords.some(keyword => keyword.trim().toLowerCase() === 'melee')
  for (const targetId of [...new Set(input.authoritativeTargetIds)].sort()) {
    const ironBarbs = melee
      ? input.context.queries.abilities.activeForPlacement(targetId)
          .find(candidate => candidate.canonicalId === 'Iron Barbs')
      : null
    if (ironBarbs && input.context.queries.resources.actionAvailable(targetId, 'free')) {
      const suffix = shortHash(moveIdentity, actorId, targetId, ironBarbs.instanceId, 'Iron Barbs')
      const requestId = `ability.iron-barbs.request.${suffix}`
      operations.push(request({
        id: requestId,
        sourceEventId: `ability.iron-barbs.target:${targetId}`,
        reasonCode: AA076_IRON_BARBS_REASON,
        promptKey: 'ability.iron-barbs.use',
        optionId: 'ability.iron-barbs.use',
        optionLabelKey: 'ability.iron-barbs.damage-attacker',
        ownerId: targetId,
        timing: 'post-damage',
        priority: 109,
      }), ironBarbsHp(requestId, suffix))
    }

    const justified = input.context.queries.abilities.activeForPlacement(targetId)
      .find(candidate => candidate.canonicalId === 'Justified')
    if (justified && input.context.queries.resources.actionAvailable(targetId, 'free')) {
      const suffix = shortHash(moveIdentity, actorId, targetId, justified.instanceId, 'Justified')
      const requestId = `ability.justified.request.${suffix}`
      operations.push(request({
        id: requestId,
        sourceEventId: `ability.justified.target:${targetId}`,
        reasonCode: AA076_JUSTIFIED_REASON,
        promptKey: 'ability.justified.use',
        optionId: 'ability.justified.use',
        optionLabelKey: 'ability.justified.raise-attack',
        ownerId: targetId,
        timing: 'post-damage',
        priority: 110,
      }), justifiedStage(requestId, suffix))
    }

    const kampfgeist = input.context.queries.abilities.activeForPlacement(targetId)
      .find(candidate => candidate.canonicalId === 'Kampfgeist')
    if (kampfgeist
      && input.context.queries.resources.actionAvailable(targetId, 'free')
      && sceneUseAvailable({
        context: input.context,
        ownerId: targetId,
        abilityInstanceId: kampfgeist.instanceId,
        canonicalId: 'Kampfgeist',
      })) {
      const suffix = shortHash(moveIdentity, actorId, targetId, kampfgeist.instanceId, 'Kampfgeist')
      operations.push(request({
        id: `ability.kampfgeist.request.${suffix}`,
        sourceEventId: `ability.kampfgeist.target:${targetId}`,
        reasonCode: AA076_KAMPFGEIST_REASON,
        promptKey: 'ability.kampfgeist.use',
        optionId: 'ability.kampfgeist.use',
        optionLabelKey: 'ability.kampfgeist.resist-damage',
        ownerId: targetId,
        timing: 'post-damage',
        priority: 111,
      }))
    }
  }
  return Object.freeze(operations)
}
