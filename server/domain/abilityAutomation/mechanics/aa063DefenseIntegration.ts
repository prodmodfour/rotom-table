import type {
  MoveCombatStageImmunityQueryInput,
  MoveCoreTokenEffectImmunityQueries,
} from '../../moveAutomation/reducers/coreTokenEffectTypes'
import type { AuthoritativeAbilityContext } from '../context'

/** Static defensive providers reused by ability/feature-owned shared reducers. */
export const createAa063AbilityCombatStageImmunities = (
  context: AuthoritativeAbilityContext,
): MoveCoreTokenEffectImmunityQueries => Object.freeze({
  directHp: () => ({ blockedBy: null, consultedPlacementIds: [] }),
  condition: () => ({ blockedBy: null, consultedPlacementIds: [] }),
  combatStage: ({ stage, delta, recipient }: MoveCombatStageImmunityQueryInput) => {
    const active = context.queries.effectiveAbilities.allForPlacement(recipient.placement.id)
      .some(ability => ability.effective && ability.canonicalId === 'Clear Body')
    const enemySource = context.queries.relationships.relation(
      context.actor.placement.id,
      recipient.placement.id,
    ) === 'enemy'
    if (delta < 0 && active && enemySource) {
      return { blockedBy: 'Clear Body', consultedPlacementIds: [] }
    }
    const bigPecks = stage === 'def' && delta < 0
      && context.queries.effectiveAbilities.allForPlacement(recipient.placement.id)
        .some(ability => ability.effective && ability.canonicalId === 'Big Pecks')
    return { blockedBy: bigPecks ? 'Big Pecks' : null, consultedPlacementIds: [] }
  },
})
