import type {
  MoveDamageEffectOperation,
  MoveDirectHpEffectOperation,
  MoveMultiHitEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import {
  effectivenessStepsFromMultiplier,
  multiplierFromEffectivenessSteps,
} from '~/utils/typeChart'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveDamageTypeResolution } from '../../moveAutomation/damageTypes'
import { AA070_FLOWER_POWER_REASON } from './aa070MoveIntegration'

export const aa070FlowerPowerDamageOperation = <Operation extends
  MoveDamageEffectOperation | MoveMultiHitEffectOperation>(input: {
    readonly operation: Operation
    readonly responseOptionForReason?: (reasonCode: string) => string | null | undefined
  }): Operation => {
  const selected = input.responseOptionForReason?.(AA070_FLOWER_POWER_REASON)
  const damageClass = selected === 'ability.flower-power.physical'
    ? 'physical'
    : selected === 'ability.flower-power.special'
      ? 'special'
      : null
  if (!damageClass) return input.operation
  return (input.operation.kind === 'multi-hit'
    ? {
        ...input.operation,
        payload: {
          ...input.operation.payload,
          damage: { ...input.operation.payload.damage, damageClass },
        },
      }
    : { ...input.operation, payload: { ...input.operation.payload, damageClass } }) as Operation
}

const adjustedResistance = (multiplier: number, delta: number): number => {
  const steps = effectivenessStepsFromMultiplier(multiplier)
  return steps === null ? multiplier : multiplierFromEffectivenessSteps(steps + delta)
}

/** Fluffy changes only damaging Melee/Fire effectiveness and preserves true immunity. */
export const aa070FluffyDamageTypeOverlay = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly recipientId: string
  readonly resolved: MoveDamageTypeResolution
}): MoveDamageTypeResolution => {
  if (!input.context.queries.abilities.has(input.recipientId, 'Fluffy')
    || input.script.damageClass === 'Status'
    || input.resolved.finalMultiplier === 0) return input.resolved
  const melee = input.script.keywords.some(keyword => keyword.trim().toLowerCase() === 'melee')
  const fire = input.resolved.moveType.trim().toLowerCase() === 'fire'
  const delta = (fire ? 1 : 0) - (melee ? 1 : 0)
  if (delta === 0 && !melee && !fire) return input.resolved
  const passiveMultiplier = adjustedResistance(input.resolved.passiveMultiplier, delta)
  const finalMultiplier = adjustedResistance(input.resolved.finalMultiplier, delta)
  return Object.freeze({
    ...input.resolved,
    passiveMultiplier,
    passiveSources: [...input.resolved.passiveSources, 'Fluffy'],
    finalMultiplier,
    finalRelation: finalMultiplier < 1 ? 'resistant' : finalMultiplier > 1 ? 'weak' : 'neutral',
  })
}

export const aa070FlyingFlyTrapPreventsDirectHp = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDirectHpEffectOperation
  readonly recipientId: string
}): boolean => {
  if (input.operation.payload.cost !== null
    || !['lose', 'set'].includes(input.operation.payload.mode)
    || !input.context.queries.abilities.has(input.recipientId, 'Flying Fly Trap')) return false
  const moveType = input.context.queries.rules.reviewedScriptFor(
    input.context.intent.moveName,
  )?.type.trim().toLowerCase()
  return moveType === 'ground' || moveType === 'bug'
}

export const aa070DamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly recipient: SpawnedPokemon
  readonly moveType: string
}): readonly MoveDamageModifier[] => {
  const flyingFlyTrap = input.context.queries.abilities.activeForPlacement(input.recipient.id)
    .find(ability => ability.canonicalId === 'Flying Fly Trap')
  if (!flyingFlyTrap || !['ground', 'bug'].includes(input.moveType.trim().toLowerCase())) {
    return Object.freeze([])
  }
  return Object.freeze([{
    id: `ability.flying-fly-trap.immunity.${input.operation.id}.${input.recipient.id}`,
    stage: 'final-hp-loss', priority: 95,
    source: { kind: 'ability', id: flyingFlyTrap.instanceId },
    stackingGroup: 'aa070-flying-fly-trap',
    reasonCode: 'ability.flying-fly-trap.damage-immunity',
    operation: 'cap-at-most', value: 0,
  }])
}
