import {
  emptyAttackOfOpportunityState,
  writeAttackOfOpportunityState,
} from '#shared/attackOfOpportunityState'
import {
  emptyStartTurnModalState,
  writeStartTurnModalState,
} from '#shared/startTurnModalState'
import type { TabletopMap } from '~/types/map'
import { writeActiveOrderEffects } from '~/utils/activeOrderEffects'
import { clearCombatLogMetadata } from '~/utils/combatLog'

/**
 * Remove map metadata whose meaning is bounded to the scene being left.
 *
 * The encounter-state lifecycle owns typed effects and durable summaries. These
 * compatibility keys still back current live-play prompts/logs, so the scene
 * boundary must clear them through their typed writers rather than leave stale
 * UI state behind.
 */
export const clearSceneScopedMapMetadata = (
  metadata: TabletopMap['metadata'],
): TabletopMap['metadata'] => {
  let next = clearCombatLogMetadata(metadata)
  next = writeAttackOfOpportunityState(next, emptyAttackOfOpportunityState())
  next = writeStartTurnModalState(next, emptyStartTurnModalState())
  next = writeActiveOrderEffects(next, [])
  return Object.keys(next).length > 0 ? next : undefined
}

/**
 * Reconcile the legacy map-owned resources that are explicitly scene-local.
 * Daily sheet usage is intentionally untouched; only its map scene allowance
 * lives in `moveUsage` and therefore resets with the other map frequencies.
 */
export const clearMapSceneResources = <MapType extends TabletopMap>(
  map: MapType,
): MapType => {
  const next = {
    ...map,
    metadata: clearSceneScopedMapMetadata(map.metadata),
  }
  delete next.temporaryHitPoints
  delete next.moveUsage
  if (next.metadata === undefined) delete next.metadata
  return next
}
