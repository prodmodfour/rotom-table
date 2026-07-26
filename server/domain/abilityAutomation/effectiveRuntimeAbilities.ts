import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { projectAuthoritativeEffectiveAbilities } from './effectiveAbilities'
import { resolveSheetAbilityInstances } from './instanceParameters'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from './registry'

/** Exact manifest-selected effective abilities for authoritative non-Move paths. */
export const effectiveRuntimeAbilityIds = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placement: Pick<SheetPlacement, 'id' | 'sideId' | 'position'>
  readonly sheet: CharacterSheet | TrainerSheet
}): readonly string[] => projectAuthoritativeEffectiveAbilities({
  baseAbilities: resolveSheetAbilityInstances(input.sheet.abilities),
  species: 'species' in input.sheet ? input.sheet.species : null,
  target: {
    placementId: input.placement.id,
    ...(input.placement.sideId ? { sideId: input.placement.sideId } : {}),
    position: input.placement.position,
  },
  effects: input.map.encounterState?.effects ?? [],
  transformationSnapshots: input.map.encounterState?.abilityTransformations,
}).flatMap(ability => {
  if (!ability.effective) return []
  const runtime = ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(ability.canonicalId)
  if (!runtime || (ability.definitionHash !== null && ability.definitionHash !== runtime.definitionHash)) return []
  return [ability.canonicalId]
})
