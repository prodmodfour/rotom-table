import {
  createEmptyAbilityTransformationState,
  parseAbilityTransformationState,
} from '#shared/abilityAutomation/transformations'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'

/** Power of Alchemy's copied Ability ends immediately when its user is Fainted. */
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
    snapshot.canonicalId === 'Power of Alchemy'
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
