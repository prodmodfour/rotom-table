import { createHash } from 'node:crypto'
import protectionJson from '../../../../data/ability-automation/protections.json'
import type {
  MoveDirectHpEffectOperation,
  MoveEffectOperation,
  MoveReactionRequestEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA081_MUMMY_REQUEST_REASON = 'ability.mummy.optional-disable' as const
export const AA081_MUMMY_SUPPRESS_REASON = 'ability.mummy.suppress-ability' as const
export const AA081_NEEDLES_HP_REASON = 'ability.needles.tick-loss' as const
export const AA081_NEUTRALIZING_GAS_REASON = 'ability.neutralizing-gas.round-suppression' as const
const EXTENDED_GAS_MOVE_IDS = new Set(['Clear Smog', 'Poison Gas', 'Smog', 'Strange Steam'])
const DISABLEABLE_BY_ID = new Map(protectionJson.entries.map(entry => [entry.canonicalId, entry.disableable]))
const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

export const aa081MummyOptionAbilityInstanceId = (optionId: string): string | null => {
  const prefix = 'ability.mummy.disable.'
  return optionId.startsWith(prefix) ? optionId.slice(prefix.length) : null
}

export const aa081MummySuppressionSelection = (input: {
  readonly operation: Pick<MoveEffectOperation, 'id' | 'reasonCode' | 'source'>
  readonly selectedOptionByRequestId: ReadonlyMap<string, string | null>
}): boolean => {
  if (input.operation.reasonCode !== AA081_MUMMY_SUPPRESS_REASON
    || input.operation.source.kind !== 'operation') return true
  const marker = ':option:'
  const operationId = input.operation.id
  const index = operationId.indexOf(marker)
  if (index < 1) return false
  const requestId = input.operation.source.id
  const optionId = operationId.slice(index + marker.length)
  return input.selectedOptionByRequestId.get(requestId) === optionId
}

const mummyOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly moveIdentity: string
  readonly targetIds: readonly string[]
}): readonly MoveEffectOperation[] => Object.freeze(input.targetIds.flatMap(targetId => {
  const mummy = input.context.queries.abilities.activeForPlacement(targetId)
    .find(ability => ability.canonicalId === 'Mummy')
  if (!mummy || !input.context.queries.resources.actionAvailable(targetId, 'free')) return []
  const actorId = input.context.actor.placement.id
  const candidates = input.context.queries.abilities.activeForPlacement(actorId)
    .filter(ability => DISABLEABLE_BY_ID.get(ability.canonicalId) !== false)
    .sort((left, right) => left.instanceId.localeCompare(right.instanceId))
  if (candidates.length === 0) return []
  const suffix = shortHash(input.moveIdentity, targetId, mummy.instanceId)
  const requestId = `ability.mummy.request.${suffix}`
  const options = candidates.map(ability => ({
    id: `ability.mummy.disable.${ability.instanceId}`,
    labelKey: `ability.mummy.disable.${ability.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  }))
  const request: MoveReactionRequestEffectOperation = {
    id: requestId,
    kind: 'reaction-request',
    source: { kind: 'lifecycle-event', id: `ability.mummy.target:${targetId}` },
    recipients: { kind: 'none' },
    phase: 'after-damage',
    reasonCode: AA081_MUMMY_REQUEST_REASON,
    payload: {
      requestId: `ability.mummy.response.${suffix}`,
      promptKey: 'ability.mummy.choose-ability',
      options,
      allowPass: true,
      timing: 'post-damage',
      priority: 48,
      ownerPlacementIds: [targetId],
    },
  }
  const suppressions = candidates.map((ability): MoveTemporaryEffectOperation => {
    const optionId = `ability.mummy.disable.${ability.instanceId}`
    return {
      id: `${requestId}:option:${optionId}`,
      kind: 'temporary-effect',
      source: { kind: 'operation', id: requestId },
      recipients: { kind: 'actor' },
      phase: 'schedule',
      reasonCode: AA081_MUMMY_SUPPRESS_REASON,
      payload: {
        action: 'add',
        effectId: `ability.mummy.suppression.${shortHash(input.moveIdentity, actorId, ability.instanceId)}`,
        recipientScope: 'placements',
        definition: {
          kind: 'creature-rule-overlay',
          duration: { kind: 'scene', remaining: null },
          stacks: 1, charges: null,
          stackPolicy: { kind: 'replace', maxStacks: null },
          chargePolicy: { kind: 'none', amount: null },
          tags: ['ability', 'aa081', 'mummy', 'ability-suppression', `mummy-target-${actorId}`],
          payload: {
            domain: 'ability', action: 'suppress', values: [ability.canonicalId],
            referencePlacementId: null, suppressionScope: 'listed',
          },
          dispel: { policy: 'matching-tags', tags: ['mummy', 'ability-suppression'] },
          transferPolicy: 'expire',
        },
      },
    }
  })
  return [request, ...suppressions]
}))

const needlesOperation = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
}): MoveDirectHpEffectOperation | null => {
  const actorId = input.context.actor.placement.id
  const melee = input.script.range.trim().toLowerCase().includes('melee')
  if (!input.context.queries.abilities.has(actorId, 'Needles')
    || input.script.damageClass !== 'Physical' || !melee) return null
  return {
    id: `ability.needles.hp.${shortHash(input.context.resolutionId ?? input.script.moveName, actorId)}`,
    kind: 'direct-hp',
    source: { kind: 'move', id: input.moveSourceId },
    recipients: { kind: 'hit-targets' },
    phase: 'after-damage',
    reasonCode: AA081_NEEDLES_HP_REASON,
    payload: {
      mode: 'lose', pool: 'hit-points',
      calculation: { kind: 'percent-max', percent: 10 },
      copySource: null, bounds: { minimum: 0, maximum: null }, rounding: 'floor',
      applyTypeImmunity: false, cost: null,
      injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
    },
  }
}

const neutralizingGasOperation = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
}): MoveTemporaryEffectOperation | null => {
  const actorId = input.context.actor.placement.id
  if (!input.context.queries.abilities.has(actorId, 'Neutralizing Gas')
    || !EXTENDED_GAS_MOVE_IDS.has(input.script.moveName)) return null
  return {
    id: `ability.neutralizing-gas.suppress.${shortHash(input.context.resolutionId ?? input.script.moveName, actorId)}`,
    kind: 'temporary-effect',
    source: { kind: 'move', id: `move.${input.script.moveName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` },
    recipients: { kind: 'hit-targets' },
    phase: 'schedule',
    reasonCode: AA081_NEUTRALIZING_GAS_REASON,
    payload: {
      action: 'add',
      effectId: `ability.neutralizing-gas.round.${shortHash(input.context.resolutionId ?? input.script.moveName)}`,
      recipientScope: 'placements',
      definition: {
        kind: 'capability',
        duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
        stacks: 1, charges: null,
        stackPolicy: { kind: 'refresh', maxStacks: null },
        chargePolicy: { kind: 'none', amount: null },
        tags: ['ability', 'aa081', 'neutralizing-gas', 'trigger-suppression', 'defensive-suppression'],
        payload: { capabilityId: 'ability.neutralizing-gas.suppressed', action: 'grant' },
        dispel: { policy: 'matching-tags', tags: ['neutralizing-gas'] },
        transferPolicy: 'expire',
      },
    },
  }
}

/** Exact AA-081 overlays rebuilt for root, nested, pending, and resumed move execution. */
export const aa081MoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const moveIdentity = input.context.resolutionId ?? `${input.moveSourceId}:${input.script.moveName}`
  const melee = input.script.range.trim().toLowerCase().includes('melee')
  const mummy = melee ? mummyOperations({
    context: input.context,
    moveIdentity,
    targetIds: [...new Set(input.authoritativeTargetIds)].sort(),
  }) : []
  const needles = needlesOperation(input)
  const gas = neutralizingGasOperation(input)
  return Object.freeze([
    ...mummy,
    ...(needles ? [needles] : []),
    ...(gas ? [gas] : []),
  ])
}
