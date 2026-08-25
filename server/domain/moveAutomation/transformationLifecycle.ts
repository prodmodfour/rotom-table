import {
  parseEncounterEffects,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import { parseEncounterEvent, type EncounterEvent } from '#shared/moveAutomation/events'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'
import { deepCloneJson } from '~/utils/serialization'
import { applyEncounterEffectLifecycleEvent } from './effectLifecycle'

const endingPlacementId = (event: EncounterEvent): string | null => {
  if (event.kind === 'move-ko' || event.kind === 'lifecycle-ko') return event.targetPlacementId
  if (event.kind === 'recall') return event.placementId
  if (event.kind === 'switch') return event.recalledPlacementId
  return null
}

/** Exact active Transform identities ended by a KO, recall, or switch fact. */
export const transformationEffectIdsEndedByEvent = (input: {
  readonly effects: readonly EncounterEffect[]
  readonly event: EncounterEvent
}): readonly string[] => {
  const effects = parseEncounterEffects(input.effects, 'transformationLifecycle.effects')
  const event = parseEncounterEvent(input.event, 'transformationLifecycle.event')
  const placementId = endingPlacementId(event)
  if (placementId === null) return Object.freeze([])
  return Object.freeze(effects.flatMap(effect => (
    effect.kind === 'transformation'
    && effect.affected.placementIds[0] === placementId
      ? [effect.id]
      : []
  )))
}

export interface EncounterTransformationKnockoutCleanupResult {
  readonly map: TabletopMap
  readonly changed: boolean
  readonly removedEffectIds: readonly string[]
}

/**
 * End transformations for server-resolved zero-HP recipients while planning an
 * immediate move. This is a map-only projection cleanup: sheets are never
 * restored because Transform never changed them.
 */
export const cleanupEncounterTransformationsForKnockouts = (input: {
  readonly map: TabletopMap
  readonly placementIds: readonly string[]
}): EncounterTransformationKnockoutCleanupResult => {
  const map = deepCloneJson(input.map)
  let state = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
  const placementIds = new Set(input.placementIds)
  const removedEffectIds = state.effects.flatMap(effect => (
    effect.kind === 'transformation'
    && placementIds.has(effect.affected.placementIds[0]!)
      ? [effect.id]
      : []
  ))

  for (const effectId of removedEffectIds) {
    const result = applyEncounterEffectLifecycleEvent(
      { effects: state.effects },
      { kind: 'effect-removed', effectId },
    )
    state = parseEncounterState({ ...state, effects: result.effects })
  }
  if (removedEffectIds.length > 0) map.encounterState = state
  return Object.freeze({
    map,
    changed: removedEffectIds.length > 0,
    removedEffectIds: Object.freeze(removedEffectIds),
  })
}
