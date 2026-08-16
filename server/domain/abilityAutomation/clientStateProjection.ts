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
import { createEmptyEquipmentProviderReceiptState } from '#shared/itemAutomation/equipmentProviderReceipts'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { EncounterState } from '#shared/moveAutomation/encounterState'

const isMechanicsPrivateEffect = (effect: EncounterEffect): boolean => (
  effect.id.startsWith('ability.')
  || effect.source.moveId.startsWith('ability.')
  || effect.tags.includes('ability')
  || effect.tags.some(tag => /^aa\d{3}$/.test(tag))
  || effect.id.startsWith('equipment-provider-frequency:v1:')
  || effect.tags.includes('equipment-provider-frequency')
  || effect.tags.some(tag => tag.startsWith('equipment-provider-frequency:'))
)

const projectPublicEquipmentEffect = (effect: EncounterEffect): EncounterEffect => {
  if (!effect.id.startsWith('equipment-provider-choice:v1:')) return effect
  const placementId = effect.affected.placementIds[0] ?? 'unknown'
  return {
    ...effect,
    id: `equipment-choice-suppression:${placementId}`,
    source: {
      operationId: `equipment-choice-suppression:${placementId}`,
      moveId: 'equipment-choice-suppression',
      placementId,
    },
    tags: ['equipment-choice-item-suppression'],
    dispel: { policy: 'matching-tags', tags: ['equipment-choice-item-suppression'] },
  }
}

/** Project mechanics-only Ability and equipment-provider lanes out of a public encounter value. */
export const projectAbilityAutomationEncounterStateForPlayer = (
  encounter: EncounterState,
): EncounterState => ({
  ...encounter,
  effects: encounter.effects
    .filter(effect => !isMechanicsPrivateEffect(effect))
    .map(projectPublicEquipmentEffect),
  abilityUsage: createEmptyAbilitySceneUsageLedger(),
  abilityTiming: createEmptyAbilityTimingLedger(),
  abilityEffectLifecycle: createEmptyAbilityEffectLifecycleState(),
  abilityOwnedState: createEmptyAbilityOwnedState(),
  abilityEventReceipts: createEmptyAbilityEventReceiptState(),
  equipmentProviderReceipts: createEmptyEquipmentProviderReceiptState(),
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
