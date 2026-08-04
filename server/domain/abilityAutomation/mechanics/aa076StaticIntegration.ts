import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import { clampCombatStage } from '~/utils/combatStages'
import { resolveCanonicalSheetAbilityName } from '~/utils/sheetAbilities'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { AA076_IRON_FIST_MOVE_IDS } from '#shared/abilityAutomation/aa076'
import type { MoveDamageTypeResolution } from '../../moveAutomation/damageTypes'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import { projectAuthoritativeEffectiveAbilities } from '../effectiveAbilities'
import { resolveSheetAndEdgeAbilityInstances } from '../../edgeAutomation/permanentGrants'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../registry'

const initiativeProtected = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet | TrainerSheet
}): boolean => {
  const runtime = ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve('Inner Focus')
  if (!runtime) return false
  return projectAuthoritativeEffectiveAbilities({
    baseAbilities: resolveSheetAndEdgeAbilityInstances(input.sheet),
    target: {
      placementId: input.placement.id,
      ...(input.placement.sideId ? { sideId: input.placement.sideId } : {}),
      position: input.placement.position,
    },
    effects: input.map.encounterState?.effects ?? [],
    transformationSnapshots: input.map.encounterState?.abilityTransformations,
  }).some(ability => ability.effective
    && ability.canonicalId === 'Inner Focus'
    && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash))
}

/** Inner Focus is evaluated from effective abilities before calculated initiative effects. */
export const aa076InnerFocusProtectsInitiative = initiativeProtected

/** Intrepid Sword shifts only the effective default Attack stage. */
export const aa076EffectiveCombatStages = (input: {
  readonly stages: CombatStageMap
  readonly intrepidSwordActive: boolean
}): CombatStageMap => input.intrepidSwordActive
  ? { ...input.stages, atk: clampCombatStage(input.stages.atk + 1) }
  : input.stages

export const aa076InstinctEvasionBonus = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientId: string
}): 0 | 2 => input.context.queries.abilities.has(input.recipientId, 'Instinct') ? 2 : 0

export const aa076KeenEyeActive = (
  context: AuthoritativeMoveRulesContext,
  placementId = context.actor.placement.id,
): boolean => context.queries.abilities.has(placementId, 'Keen Eye')

/** Replace only Keen Eye's raw sheet projection with its exact effective runtime state. */
export const aa076TokenWithEffectiveKeenEye = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly token: SpawnedPokemon
}): SpawnedPokemon => {
  const abilityNames = (input.token.abilityNames ?? []).filter(name => (
    resolveCanonicalSheetAbilityName(name) !== 'Keen Eye'
  ))
  if (aa076KeenEyeActive(input.context, input.token.id)) abilityNames.push('Keen Eye')
  return { ...input.token, abilityNames }
}

/** Illuminate is resolved by AA-075's exact provider and must not also run through legacy token names. */
export const aa076TargetWithoutLegacyIlluminate = (token: SpawnedPokemon): SpawnedPokemon => ({
  ...token,
  abilityNames: token.abilityNames?.filter(name => (
    resolveCanonicalSheetAbilityName(name) !== 'Illuminate'
  )),
})

export const aa076IronFistDamageBaseBonus = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'moveName'>
}): 0 | 2 => input.context.queries.abilities.has(input.context.actor.placement.id, 'Iron Fist')
  && (AA076_IRON_FIST_MOVE_IDS as readonly string[]).includes(input.script.moveName)
  ? 2
  : 0

export const aa076KampfgeistDamageTypeOverlay = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly resolved: MoveDamageTypeResolution
}): MoveDamageTypeResolution => {
  if (input.resolved.moveType !== 'Fighting'
    || !input.context.queries.abilities.has(input.context.actor.placement.id, 'Kampfgeist')) {
    return input.resolved
  }
  return Object.freeze({
    ...input.resolved,
    hasStab: true,
    passiveSources: input.resolved.passiveSources.includes('Kampfgeist')
      ? input.resolved.passiveSources
      : Object.freeze([...input.resolved.passiveSources, 'Kampfgeist']),
  })
}

export const aa076JustifiedInterceptCheckBonus = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly placementId: string
  readonly canonicalMoveId: string
  readonly participantRole: 'actor' | 'target'
}): 0 | 4 => input.participantRole === 'actor'
  && /^intercept(?:\s|$)/i.test(input.canonicalMoveId.trim())
  && input.context.queries.abilities.has(input.placementId, 'Justified')
  ? 4
  : 0
