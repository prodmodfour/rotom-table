import { createHash } from 'node:crypto'
import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { clampCombatStage } from '~/utils/combatStages'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { normalizeConditionNames } from '~/utils/statusConditions'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const PRIDE_CONDITIONS = new Set([
  'Burned', 'Poisoned', 'Badly Poisoned', 'Paralysis', 'Frozen', 'Sleep', 'Bad Sleep',
])

/** Pride is a virtual conditional stage, so curing or suppressing it removes the bonus immediately. */
export const aa084PrideActor = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly actor: SpawnedPokemon
}): SpawnedPokemon => {
  if (!input.context.queries.abilities.has(input.actor.id, 'Pride')
    || !normalizeConditionNames(input.actor.conditions).some(condition => PRIDE_CONDITIONS.has(condition))) {
    return input.actor
  }
  return {
    ...input.actor,
    combatStages: {
      ...input.actor.combatStages,
      satk: clampCombatStage((input.actor.combatStages.satk ?? 0) + 2),
    },
  }
}

/** Prankster makes only the user's Status Moves Priority (Advanced). */
export const aa084PranksterPriorityActive = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'damageClass'>
}): boolean => input.script.damageClass?.trim().toLowerCase() === 'status'
  && input.context.queries.abilities.has(input.context.actor.placement.id, 'Prankster')

const powerSpotProvider = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly actor: SpawnedPokemon
}): { readonly placementId: string; readonly abilityInstanceId: string } | null => {
  const candidates = input.context.queries.placements.all().flatMap(placement => {
    if (placement.id === input.actor.id
      || input.context.queries.relationships.resolve(placement.id, input.actor.id).relationship !== 'ally') return []
    const token = input.context.queries.tokens.get(placement.id)
    const ability = input.context.queries.abilities.activeForPlacement(placement.id)
      .find(candidate => candidate.canonicalId === 'Power Spot')
    if (!token || !ability || ptuGridDistanceBetweenFootprints(token, input.actor) > 2) return []
    return [{ placementId: placement.id, abilityInstanceId: ability.instanceId }]
  }).sort((left, right) => left.placementId.localeCompare(right.placementId))
  return candidates[0] ?? null
}

/** Exact Power Spot outgoing aura and Prism Armor super-effective DR. */
export const aa084MoveDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly effectivenessMultiplier: number
}): readonly MoveDamageModifier[] => {
  const modifiers: MoveDamageModifier[] = []
  const spot = powerSpotProvider(input)
  if (spot) modifiers.push({
    id: `ability.power-spot.damage.${shortHash(input.operation.id, input.recipient.id, spot.abilityInstanceId)}`,
    stage: 'pre-type-modifiers', priority: 42,
    source: { kind: 'ability', id: spot.abilityInstanceId },
    stackingGroup: 'aa084-power-spot',
    reasonCode: 'ability.power-spot.ally-damage-bonus',
    operation: 'add', value: 5,
  })
  if (input.effectivenessMultiplier > 1) {
    const prismArmor = input.context.queries.abilities.activeForPlacement(input.recipient.id)
      .find(ability => ability.canonicalId === 'Prism Armor')
    if (prismArmor) modifiers.push({
      id: `ability.prism-armor.reduction.${shortHash(input.operation.id, input.recipient.id, prismArmor.instanceId)}`,
      stage: 'post-damage-modifiers', priority: 42,
      source: { kind: 'ability', id: prismArmor.instanceId },
      stackingGroup: 'aa084-prism-armor',
      reasonCode: 'ability.prism-armor.super-effective-reduction',
      operation: 'subtract', value: 5,
    })
  }
  return Object.freeze(modifiers)
}

/** Durable Complete Forme marker blocks every later Temporary HP grant source. */
export const aa084PowerConstructBlocksTemporaryHp = (input: {
  readonly context: Pick<AuthoritativeMoveRulesContext, 'map'>
  readonly placementId: string
}): boolean => input.context.map.encounterState?.effects.some(effect => (
  effect.kind === 'creature-rule-overlay'
  && effect.payload.domain === 'form'
  && effect.payload.value === 'zygarde-complete-forme'
  && effect.tags.includes('power-construct')
  && effect.suppression.sources.length === 0
  && effect.affected.placementIds.includes(input.placementId)
)) === true
