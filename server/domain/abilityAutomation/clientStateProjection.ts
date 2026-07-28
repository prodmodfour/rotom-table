import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { createEmptyAbilityEffectLifecycleState } from '#shared/abilityAutomation/durations'
import { createEmptyAbilityEntityState } from '#shared/abilityAutomation/entities'
import { createEmptyAbilityEventReceiptState } from '#shared/abilityAutomation/eventReceipts'
import { createEmptyAbilityOwnedState } from '#shared/abilityAutomation/ownedState'
import { createEmptyAbilityReactionAvailabilityLedger } from '#shared/abilityAutomation/reactionResources'
import { createEmptyAbilitySceneUsageLedger } from '#shared/abilityAutomation/resources'
import { createEmptyAbilityTimingLedger } from '#shared/abilityAutomation/timingResources'
import { createEmptyAbilityTransformationState } from '#shared/abilityAutomation/transformations'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { EncounterState } from '#shared/moveAutomation/encounterState'

const isAbilityPrivateEffect = (effect: EncounterEffect): boolean => (
  effect.id.startsWith('ability.')
  || effect.source.moveId.startsWith('ability.')
  || effect.tags.includes('ability')
  || effect.tags.some(tag => /^aa\d{3}$/.test(tag))
)

/** Project the mechanics-only Ability lanes out of a public encounter value. */
export const projectAbilityAutomationEncounterStateForPlayer = (
  encounter: EncounterState,
): EncounterState => ({
  ...encounter,
  effects: encounter.effects.filter(effect => !isAbilityPrivateEffect(effect)),
  abilityUsage: createEmptyAbilitySceneUsageLedger(),
  abilityTiming: createEmptyAbilityTimingLedger(),
  abilityEffectLifecycle: createEmptyAbilityEffectLifecycleState(),
  abilityOwnedState: createEmptyAbilityOwnedState(),
  abilityEventReceipts: createEmptyAbilityEventReceiptState(),
  abilityReactionAvailability: createEmptyAbilityReactionAvailabilityLedger(),
  abilityEntities: createEmptyAbilityEntityState(),
  abilityTransformations: createEmptyAbilityTransformationState(),
})

/**
 * Public/player map documents never carry Ability authority. Controlled menus
 * come from the separate capability bundle and all mechanics remain server-side.
 */
export const projectAbilityAutomationMapForPlayer = (map: TabletopMap): TabletopMap => {
  const encounter = map.encounterState
  if (!encounter) return map
  return {
    ...map,
    encounterState: projectAbilityAutomationEncounterStateForPlayer(encounter),
  }
}

const sourceControllerCanInspectSheet = (sheet: CharacterSheet | TrainerSheet): boolean => (
  (sheet as CharacterSheet & { readonly playerProfileAccessible?: boolean })
    .playerProfileAccessible === true
)

/** Remove Ability identities and lasting resource ledgers from map-only sheets. */
export const projectAbilityAutomationSheetForPlayer = <Sheet extends CharacterSheet | TrainerSheet>(
  sheet: Sheet,
  sourceControllerCanInspect = sourceControllerCanInspectSheet(sheet),
): Sheet => {
  if (sourceControllerCanInspect) return sheet
  const projected = { ...sheet } as Sheet & {
    abilities?: unknown
    abilityUsage?: unknown
  }
  delete projected.abilities
  delete projected.abilityUsage
  return projected
}
