import type { EncounterEvent, EncounterTurnEvent } from '#shared/moveAutomation/events'
import {
  createEncounterTurnResourceLedger,
  parseEncounterTurnResources,
} from '#shared/moveAutomation/encounterResources'
import { parseEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'

/**
 * Living Weapon movement is shared across the whole round, not reset between
 * the wielder's and weapon's individual turns. Generic movement ledgers reset
 * at turn start, so restore the exact linked group's shared spend after that
 * reset and clear it only at the authoritative round boundary.
 *
 * The caller must pass a source-loss-reconciled map; raw stale links are not
 * authority for coupling resource ledgers.
 */
export const reconcileLivingWeaponRoundMovementResources = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly previous: EncounterState
  readonly current: EncounterState
  readonly events: readonly EncounterEvent[]
}): EncounterState => {
  const links = (input.map.encounterState?.capabilityRuntime?.links ?? [])
    .filter(link => link.kind === 'living-weapon' && link.participantPlacementIds.length === 1)
  if (links.length === 0) return input.current
  const roundStarted = input.events.some(event => event.kind === 'round-start')
  const turnStarts = input.events.flatMap(event => (
    event.kind === 'turn-start' ? [event as EncounterTurnEvent] : []
  ))
  if (!roundStarted && turnStarts.length === 0) return input.current

  const turnResources = { ...input.current.turnResources }
  let changed = false
  for (const link of links) {
    const placementIds = [link.ownerPlacementId, link.participantPlacementIds[0]!]
    const relevantTurn = turnStarts.find(event => placementIds.includes(event.placementId))
    if (!roundStarted && !relevantTurn) continue
    const sharedSpent = roundStarted ? 0 : Math.max(
      ...placementIds.map(id => input.previous.turnResources[id]?.movement.spent ?? 0),
      ...placementIds.map(id => input.current.turnResources[id]?.movement.spent ?? 0),
    )
    for (const placementId of placementIds) {
      const existing = turnResources[placementId] ?? createEncounterTurnResourceLedger({
        placementId,
        round: relevantTurn?.round ?? null,
        turn: relevantTurn?.turn ?? null,
      })
      if (existing.movement.spent === sharedSpent) continue
      turnResources[placementId] = {
        ...existing,
        movement: { ...existing.movement, spent: sharedSpent },
      }
      changed = true
    }
  }
  return changed
    ? parseEncounterState({
        ...input.current,
        turnResources: parseEncounterTurnResources(turnResources),
      })
    : input.current
}
