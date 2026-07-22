import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { TabletopMap, SheetPlacement } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { normalizeConditionNames } from '~/utils/statusConditions'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import { AA069_FIERY_CRASH_REASON } from './aa069MoveIntegration'
import { resolveSheetAbilityInstances } from '../instanceParameters'
import { projectAuthoritativeEffectiveAbilities } from '../effectiveAbilities'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../registry'

const effective = (input: {
  readonly canonicalId: string
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet | TrainerSheet
}): boolean => {
  const runtime = ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(input.canonicalId)
  if (!runtime) return false
  return projectAuthoritativeEffectiveAbilities({
    baseAbilities: resolveSheetAbilityInstances(input.sheet.abilities),
    target: {
      placementId: input.placement.id,
      ...(input.placement.sideId ? { sideId: input.placement.sideId } : {}),
      position: input.placement.position,
    },
    effects: input.map.encounterState?.effects ?? [],
    transformationSnapshots: input.map.encounterState?.abilityTransformations,
  }).some(ability => ability.effective
    && ability.canonicalId === input.canonicalId
    && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash))
}

export const aa069EnduringRagePreventsSave = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet | TrainerSheet
  readonly condition: string
}): boolean => normalizeConditionNames([input.condition]).includes('Rage')
  && effective({ ...input, canonicalId: 'Enduring Rage' })

export const aa069FieryCrashMoveType = (input: {
  readonly operation: MoveDamageEffectOperation
  readonly responseOptionForReason?: (reasonCode: string) => string | null | undefined
}): MoveDamageEffectOperation => input.responseOptionForReason?.(AA069_FIERY_CRASH_REASON)
  === 'ability.fiery-crash.fire-type'
  ? {
      ...input.operation,
      payload: { ...input.operation.payload, moveType: 'fire' },
    }
  : input.operation

const fairyAuraProvider = (
  context: AuthoritativeMoveRulesContext,
  actorId: string,
) => context.queries.placements.all().find(placement => (
  context.queries.abilities.has(placement.id, 'Fairy Aura')
  && ['self', 'ally'].includes(context.queries.relationships.resolve(placement.id, actorId).relationship)
)) ?? null

interface Aa069DamageBaseInput {
  readonly context: AuthoritativeMoveRulesContext
  readonly actor: SpawnedPokemon
  readonly moveType: string
  readonly responseOptionForReason?: (reasonCode: string) => string | null | undefined
}

export const aa069DamageBaseSources = (input: Aa069DamageBaseInput): readonly string[] => {
  const sources: string[] = []
  if (input.moveType.trim().toLowerCase() === 'fairy'
    && fairyAuraProvider(input.context, input.actor.id)) sources.push('Fairy Aura')
  if (input.responseOptionForReason?.(AA069_FIERY_CRASH_REASON)
    === 'ability.fiery-crash.damage-base-plus-2') sources.push('Fiery Crash')
  return Object.freeze(sources)
}

export const aa069DamageBaseBonus = (input: Aa069DamageBaseInput): number => (
  aa069DamageBaseSources(input).reduce((total, source) => (
    total + (source === 'Fairy Aura' ? 1 : 2)
  ), 0)
)

export const aa069DamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly effectivenessMultiplier: number
}): readonly MoveDamageModifier[] => {
  const modifiers: MoveDamageModifier[] = []
  if (input.effectivenessMultiplier > 1) {
    const exploit = input.context.queries.abilities.activeForPlacement(input.actor.id)
      .find(ability => ability.canonicalId === 'Exploit')
    if (exploit) modifiers.push({
      id: `ability.exploit.damage.${input.operation.id}.${input.recipient.id}`,
      stage: 'pre-type-modifiers', priority: 38,
      source: { kind: 'ability', id: exploit.instanceId },
      stackingGroup: 'aa069-exploit', reasonCode: 'ability.exploit.super-effective-damage',
      operation: 'add', value: 5,
    })
    const filter = input.context.queries.abilities.activeForPlacement(input.recipient.id)
      .find(ability => ability.canonicalId === 'Filter')
    if (filter) modifiers.push({
      id: `ability.filter.reduction.${input.operation.id}.${input.recipient.id}`,
      stage: 'post-damage-modifiers', priority: 38,
      source: { kind: 'ability', id: filter.instanceId },
      stackingGroup: 'aa069-filter', reasonCode: 'ability.filter.super-effective-reduction',
      operation: 'subtract', value: 5,
    })
  }
  const enduringRage = input.context.queries.abilities.activeForPlacement(input.recipient.id)
    .find(ability => ability.canonicalId === 'Enduring Rage')
  if (enduringRage && normalizeConditionNames(input.recipient.conditions).includes('Rage')) {
    modifiers.push({
      id: `ability.enduring-rage.reduction.${input.operation.id}.${input.recipient.id}`,
      stage: 'post-damage-modifiers', priority: 39,
      source: { kind: 'ability', id: enduringRage.instanceId },
      stackingGroup: 'aa069-enduring-rage', reasonCode: 'ability.enduring-rage.damage-reduction',
      operation: 'subtract', value: 5,
    })
  }
  return Object.freeze(modifiers)
}
