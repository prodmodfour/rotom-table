import {
  createEmptyAbilityTransformationState,
  parseAbilityTransformationState,
} from '#shared/abilityAutomation/transformations'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'

/** Faint-bound copied Abilities end immediately when their exact owner is Fainted. */
export const clearAa084PowerOfAlchemyForKnockouts = (input: {
  readonly map: TabletopMap
  readonly placementIds: readonly string[]
}): TabletopMap => {
  if (input.placementIds.length === 0) return input.map
  const knockedOut = new Set(input.placementIds)
  const encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  const transformations = parseAbilityTransformationState(
    encounter.abilityTransformations ?? createEmptyAbilityTransformationState(),
  )
  const entries = transformations.entries.filter(snapshot => !(
    (snapshot.canonicalId === 'Power of Alchemy' || snapshot.canonicalId === 'Trace')
    && knockedOut.has(snapshot.ownerPlacementId)
  ))
  if (entries.length === transformations.entries.length) return input.map
  return {
    ...input.map,
    encounterState: parseEncounterState({
      ...encounter,
      abilityTransformations: parseAbilityTransformationState({
        ...transformations,
        entries,
      }),
    }),
  }
}
