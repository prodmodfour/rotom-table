import { createHash } from 'node:crypto'
import {
  aa080IsDefensiveAbility,
} from '#shared/abilityAutomation/aa080'
import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA080_MIRACLE_MILE_ABILITY = 'Miracle Mile' as const
export const AA080_MOUNTAIN_PEAK_ABILITY = 'Mountain Peak' as const
export const AA080_MOLD_BREAKER_ABILITY = 'Mold Breaker' as const
export const AA080_MOTOR_DRIVE_ABILITY = 'Motor Drive' as const

export const aa080MoldBreakerSuppressesAbility = (input: {
  readonly actorPlacementId: string
  readonly targetPlacementId: string
  readonly canonicalId: string
  readonly actorHasMoldBreaker: boolean
  readonly relationship: 'self' | 'ally' | 'enemy' | 'unknown'
}): boolean => input.actorHasMoldBreaker
  && input.actorPlacementId !== input.targetPlacementId
  && input.relationship === 'enemy'
  && aa080IsDefensiveAbility(input.canonicalId)

export const aa080MojoIgnoresNormalImmunity = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly moveType: string
  readonly defenderType: string
}): boolean => input.moveType.trim().toLowerCase() === 'ghost'
  && input.defenderType.trim().toLowerCase() === 'normal'
  && input.context.queries.abilities.has(input.context.actor.placement.id, 'Mojo')

export const aa080MotorDriveBlocksElectric = (input: {
  readonly context: Pick<AuthoritativeMoveRulesContext, 'queries'> | undefined
  readonly recipientId: string
  readonly moveType: string | null
}): boolean => input.moveType?.trim().toLowerCase() === 'electric'
  && input.context?.queries.abilities.has(input.recipientId, AA080_MOTOR_DRIVE_ABILITY) === true

const lastChanceAbilityForType = (type: string): typeof AA080_MIRACLE_MILE_ABILITY | typeof AA080_MOUNTAIN_PEAK_ABILITY | null => {
  if (type === 'fairy') return AA080_MIRACLE_MILE_ABILITY
  if (type === 'rock') return AA080_MOUNTAIN_PEAK_ABILITY
  return null
}

/** Exact Fairy/Rock Last Chance damage from effective AA-080 runtimes. */
export const aa080MoveDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly moveType: string
}): readonly MoveDamageModifier[] => {
  const canonicalId = lastChanceAbilityForType(input.moveType.trim().toLowerCase())
  if (!canonicalId) return Object.freeze([])
  const maximumHp = Math.max(1, input.actor.fullMaxHp ?? input.actor.maxHp)
  if (Math.max(0, input.actor.currentHp) * 3 > maximumHp) return Object.freeze([])
  const ability = input.context.queries.abilities.activeForPlacement(input.actor.id)
    .find(candidate => candidate.canonicalId === canonicalId)
  if (!ability) return Object.freeze([])
  return Object.freeze([{
    id: `ability.aa080.last-chance.${createHash('sha256')
      .update(`${input.operation.id}\u0000${input.recipient.id}\u0000${ability.instanceId}`)
      .digest('hex').slice(0, 24)}`,
    stage: 'pre-type-modifiers',
    priority: 39,
    source: { kind: 'ability', id: ability.instanceId },
    stackingGroup: `aa080-last-chance:${createHash('sha256').update(canonicalId).digest('hex').slice(0, 24)}`,
    reasonCode: canonicalId === AA080_MIRACLE_MILE_ABILITY
      ? 'ability.miracle-mile.last-chance'
      : 'ability.mountain-peak.last-chance',
    operation: 'add',
    value: 5,
  } satisfies MoveDamageModifier])
}
