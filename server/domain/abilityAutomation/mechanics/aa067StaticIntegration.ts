import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import {
  POKEMON_TYPES,
  computeMultiplier,
  resistMultiplierOneStepFurther,
  type PokemonType,
} from '~/utils/typeChart'
import type {
  AuthoritativeMoveAbilityQueries,
  AuthoritativeMoveRulesContext,
} from '../../moveAutomation/context'

export const AA067_DELAYED_REACTION_TYPE_SOURCE = 'Delayed Reaction' as const
export const AA067_DESIGNER_CAPABILITY_PREFIX = 'aa067.designer.resistance.' as const

const relationForMultiplier = (multiplier: number): 'immune' | 'resistant' | 'neutral' | 'weak' => (
  multiplier === 0 ? 'immune' : multiplier < 1 ? 'resistant' : multiplier > 1 ? 'weak' : 'neutral'
)

export interface Aa067ResistanceResolution {
  readonly multiplier: number
  readonly relation: 'immune' | 'resistant' | 'neutral' | 'weak'
  readonly sources: readonly string[]
}

/** Resolve only effective AA-067 weather/suit resistance providers. */
export const aa067MoveResistance = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientId: string
  readonly moveType: PokemonType
  readonly multiplier: number
}): Aa067ResistanceResolution => {
  if (input.multiplier === 0) {
    return Object.freeze({ multiplier: 0, relation: 'immune', sources: Object.freeze([]) })
  }
  let multiplier = input.multiplier
  const sources: string[] = []
  if (input.moveType === 'Fire'
    && input.context.queries.abilities.has(input.recipientId, 'Desert Weather')
    && input.context.queries.weather.active().some(weather => weather.kind === 'sunny')) {
    multiplier = resistMultiplierOneStepFurther(multiplier)
    sources.push('Desert Weather')
  }
  if (input.context.queries.abilities.has(input.recipientId, 'Designer')) {
    const typeId = input.moveType.toLowerCase()
    const suited = (input.context.map.encounterState?.effects ?? []).some(effect => (
      effect.kind === 'capability'
      && effect.suppression.sources.length === 0
      && effect.affected.placementIds.includes(input.recipientId)
      && effect.payload.action === 'grant'
      && effect.payload.capabilityId === `${AA067_DESIGNER_CAPABILITY_PREFIX}${typeId}`
      && effect.tags.includes('aa067')
      && effect.tags.includes('designer')
    ))
    if (suited) {
      multiplier = resistMultiplierOneStepFurther(multiplier)
      sources.push('Designer')
    }
  }
  return Object.freeze({
    multiplier,
    relation: relationForMultiplier(multiplier),
    sources: Object.freeze(sources),
  })
}

export const aa067DelayedReactionSplit = (damage: number): {
  readonly immediate: number
  readonly deferred: number
} => {
  const bounded = Number.isSafeInteger(damage) && damage >= 0 ? damage : 0
  const immediate = Math.floor(bounded / 2)
  return Object.freeze({ immediate, deferred: bounded - immediate })
}

/** Damage is floored to one half now; the remainder is scheduled as direct HP loss. */
export const aa067MoveDamageModifiers = (input: {
  readonly operation: MoveDamageEffectOperation
  readonly recipient: SpawnedPokemon
  readonly moveTypeSources: readonly string[]
}): readonly MoveDamageModifier[] => input.moveTypeSources.includes(AA067_DELAYED_REACTION_TYPE_SOURCE)
  ? Object.freeze([{
      id: `ability.delayed-reaction.damage.${input.operation.id}.${input.recipient.id}`,
      stage: 'final-hp-loss', priority: 90,
      source: { kind: 'ability', id: input.recipient.id },
      stackingGroup: 'aa067-delayed-reaction',
      reasonCode: 'ability.delayed-reaction.immediate-half',
      operation: 'multiply-floor', value: 0.5,
    }])
  : Object.freeze([])

export const aa067DiamondDefenseMoveFrequency = (input: {
  readonly context: {
    readonly actor: { readonly placement: { readonly id: string } }
    readonly queries: { readonly abilities: AuthoritativeMoveAbilityQueries }
  }
  readonly script: Pick<MoveAutomationScript, 'moveName'>
  readonly frequency: string | null
}): string | null => input.script.moveName === 'Stealth Rock'
  && input.context.queries.abilities.has(input.context.actor.placement.id, 'Diamond Defense')
  ? 'Scene x2'
  : input.frequency

const AVOIDANCE_BYPASS_MOVES = new Set([
  'Moongeist Beam', 'Photon Geyser', 'Sunsteel Strike', 'Phantom Force', 'Shadow Force',
])

export const aa067MoveIgnoresAvoidanceAbilities = (
  script: Pick<MoveAutomationScript, 'moveName'>,
): boolean => AVOIDANCE_BYPASS_MOVES.has(script.moveName)

export const aa067StealthRockDamageProfile = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly sourcePlacementId: string | null
  readonly defenderTypeIds: readonly string[]
}): { readonly type: 'Rock' | 'Fairy'; readonly multiplier: number } => {
  const defenderTypes = input.defenderTypeIds.map(typeId => (
    POKEMON_TYPES.find(type => type.toLowerCase() === typeId.toLowerCase()) ?? typeId
  ))
  const rock = computeMultiplier('Rock', defenderTypes)
  const fairy = input.sourcePlacementId
    && input.context.queries.abilities.has(input.sourcePlacementId, 'Diamond Defense')
    ? computeMultiplier('Fairy', defenderTypes)
    : Number.NEGATIVE_INFINITY
  return fairy > rock
    ? Object.freeze({ type: 'Fairy', multiplier: fairy })
    : Object.freeze({ type: 'Rock', multiplier: rock })
}
