import { createHash } from 'node:crypto'
import type {
  MoveCombatStageEffectOperation,
  MoveEffectOperation,
  MoveReactionRequestEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

const suffix = (...parts: readonly string[]): string => createHash('sha256')
  .update(parts.join('\u0000')).digest('hex').slice(0, 24)

const highestNonHpStats = (
  token: AuthoritativeMoveRulesContext['actor']['token'],
): readonly { readonly optionId: string; readonly stage: 'atk' | 'def' | 'satk' | 'sdef' | 'spd' }[] => {
  const stats = [
    { optionId: 'attack', stage: 'atk' as const, value: token.atk ?? 0 },
    { optionId: 'defense', stage: 'def' as const, value: token.def ?? 0 },
    { optionId: 'special-attack', stage: 'satk' as const, value: token.satk ?? 0 },
    { optionId: 'special-defense', stage: 'sdef' as const, value: token.sdef ?? 0 },
    { optionId: 'speed', stage: 'spd' as const, value: token.spd ?? 0 },
  ]
  const maximum = Math.max(...stats.map(stat => stat.value))
  return Object.freeze(stats.filter(stat => stat.value === maximum).map(({ optionId, stage }) => ({ optionId, stage })))
}

/** Server-derived optional AA-061 checkpoints for one native move resolution. */
export const aa061TriggeredMoveOverlayOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly moveSourceId: string
  readonly authoritativeTargetIds: readonly string[]
}): readonly MoveEffectOperation[] => {
  const damaging = input.script.damageClass === 'Physical' || input.script.damageClass === 'Special'
  if (!damaging) return Object.freeze([])
  const operations: MoveEffectOperation[] = []
  if (input.script.type.trim().toLowerCase() === 'water') {
    const providers = input.context.queries.placements.all().flatMap((placement) => {
      if (placement.id === input.context.actor.placement.id
        || input.context.queries.relationships.resolve(placement.id, input.context.actor.placement.id).relationship !== 'ally') return []
      const ability = input.context.queries.abilities.activeForPlacement(placement.id)
        .find(candidate => candidate.canonicalId === 'Aqua Boost')
      const token = input.context.queries.tokens.get(placement.id)
      if (!ability || !token
        || ptuGridDistanceBetweenFootprints(token, input.context.actor.token) > 1
        || !input.context.queries.resources.actionAvailable(placement.id, 'free')) return []
      return [{ placementId: placement.id, abilityInstanceId: ability.instanceId }]
    }).sort((left, right) => left.placementId.localeCompare(right.placementId))
    for (const provider of providers) {
      const id = suffix(
        input.context.resolutionId ?? input.script.moveName,
        provider.placementId,
        provider.abilityInstanceId,
        'Aqua Boost',
      )
      operations.push({
        id: `ability.aqua-boost.request.${id}`,
        kind: 'reaction-request', source: { kind: 'move', id: input.moveSourceId },
        recipients: { kind: 'none' }, phase: 'damage',
        reasonCode: 'ability.aqua-boost.optional-damage',
        payload: {
          requestId: `ability.aqua-boost.response.${id}`,
          promptKey: 'ability.aqua-boost.use',
          options: [{ id: 'ability.aqua-boost.use', labelKey: 'ability.aqua-boost.add-five-damage' }],
          allowPass: true, timing: 'pre-damage', priority: 120,
          ownerPlacementIds: [provider.placementId],
        },
      } satisfies MoveReactionRequestEffectOperation)
    }
  }

  const beastBoost = input.context.queries.abilities.activeForPlacement(input.context.actor.placement.id)
    .find(candidate => candidate.canonicalId === 'Beast Boost')
  if (beastBoost && input.context.queries.resources.actionAvailable(input.context.actor.placement.id, 'free')) {
    const choices = highestNonHpStats(input.context.actor.token)
    const id = suffix(
      input.context.resolutionId ?? input.script.moveName,
      input.context.actor.placement.id,
      beastBoost.instanceId,
      'Beast Boost',
    )
    const requestId = `ability.beast-boost.request.${id}`
    operations.push({
      id: requestId,
      kind: 'reaction-request', source: { kind: 'move', id: input.moveSourceId },
      recipients: { kind: 'none' }, phase: 'ko',
      reasonCode: 'ability.beast-boost.optional-stage',
      payload: {
        requestId: `ability.beast-boost.response.${id}`,
        promptKey: 'ability.beast-boost.use',
        options: choices.map(choice => ({
          id: `ability.beast-boost.${choice.optionId}`,
          labelKey: `ability.stat.${choice.optionId}`,
        })),
        allowPass: true, timing: 'ko', priority: 70,
        ownerPlacementIds: [input.context.actor.placement.id],
      },
    } satisfies MoveReactionRequestEffectOperation)
    for (const choice of choices) {
      operations.push({
        id: `ability.beast-boost.stage.${choice.stage}.${id}`,
        kind: 'combat-stage', source: { kind: 'operation', id: requestId },
        recipients: { kind: 'response-owner' }, phase: 'ko',
        reasonCode: `ability.beast-boost.raise-${choice.optionId}`,
        payload: {
          action: 'modify', stage: choice.stage, selectedStage: null,
          value: 1, stageSource: null, rounding: null,
        },
      } satisfies MoveCombatStageEffectOperation)
    }
  }
  return Object.freeze(operations)
}
