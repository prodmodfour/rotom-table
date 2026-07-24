import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import type { SpawnedPokemon } from '~/types/pokemon'
import { normalizeConditionNames } from '~/utils/statusConditions'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveDamageTypeResolution } from '../../moveAutomation/damageTypes'
import { aa071ResistDamageType } from './aa071StaticIntegration'
import { AA073_GUTS_CONDITIONS } from '#shared/abilityAutomation/aa073'

const GUTS_CONDITION_SET = new Set<string>(AA073_GUTS_CONDITIONS)

export const aa073GutsConditionActive = (
  conditions: readonly string[] | null | undefined,
): boolean => normalizeConditionNames(conditions).some(condition => GUTS_CONDITION_SET.has(condition))

export const aa073HeatproofDamageTypeOverlay = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientId: string
  readonly resolved: MoveDamageTypeResolution
}): MoveDamageTypeResolution => {
  if (input.resolved.moveType.trim().toLowerCase() !== 'fire'
    || !input.context.queries.abilities.has(input.recipientId, 'Heatproof')) return input.resolved
  return aa071ResistDamageType({ resolved: input.resolved, steps: 1, sources: ['Heatproof'] })
}

export const aa073MoveDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly moveType: string
}): readonly MoveDamageModifier[] => {
  if (input.moveType.trim().toLowerCase() !== 'ghost') return Object.freeze([])
  const maximumHp = Math.max(1, input.actor.fullMaxHp ?? input.actor.maxHp)
  if (Math.max(0, input.actor.currentHp) * 3 > maximumHp) return Object.freeze([])
  const ability = input.context.queries.abilities.activeForPlacement(input.actor.id)
    .find(candidate => candidate.canonicalId === 'Haunt')
  if (!ability) return Object.freeze([])
  return Object.freeze([{
    id: `ability.haunt.last-chance.${input.operation.id}.${input.recipient.id}`,
    stage: 'pre-type-modifiers', priority: 38,
    source: { kind: 'ability', id: ability.instanceId },
    stackingGroup: `aa073-last-chance:${ability.instanceId}`,
    reasonCode: 'ability.haunt.last-chance',
    operation: 'add', value: 5,
  }])
}

export const aa073HeatproofPreventsBurnHpLoss = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly placementId: string
}): boolean => input.context.queries.abilities.has(input.placementId, 'Heatproof')
