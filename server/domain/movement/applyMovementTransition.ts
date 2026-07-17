import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import { appendMovementLogEntry } from '~/utils/mapMovementLog'
import {
  tokenFacingForPlacement,
  tokenFacingStoresLegacyTurned,
  tokenFacingTowardPoint,
} from '~/utils/tokenFacing'
import { deepCloneJson } from '~/utils/serialization'

export interface AuthoritativeMovementMapTransition {
  readonly nextMap: TabletopMap
  readonly placement: SheetPlacement
  readonly from: GridAnchor
  readonly to: GridAnchor
  readonly distance: number
  readonly turnResources: {
    readonly previous: EncounterState['turnResources']
    readonly current: EncounterState['turnResources']
  }
}

const sameAnchor = (left: GridAnchor, right: GridAnchor): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)

/**
 * Apply one already-authoritative movement segment to map presentation state.
 * Pathfinding, costs, interruption policy, and persistence remain outside this
 * pure projection; a zero-distance declaration updates resources without
 * inventing a movement log entry or facing change.
 */
export const applyAuthoritativeMovementMapTransition = (input: {
  readonly map: TabletopMap
  readonly placementId: string
  readonly destination: GridAnchor
  readonly distance: number
  readonly encounterState: EncounterState
  readonly timestamp: number
  readonly userName: string
  readonly maxLogEntries?: number
}): AuthoritativeMovementMapTransition => {
  if (!Number.isSafeInteger(input.distance) || input.distance < 0) {
    throw new Error('Authoritative movement transition distance must be a non-negative safe integer.')
  }
  const placement = input.map.placements.find(candidate => candidate.id === input.placementId)
  if (!placement) throw new Error(`Movement placement ${input.placementId} is missing.`)

  const previousEncounterState = parseEncounterState(
    input.map.encounterState ?? createEmptyEncounterState(),
  )
  const encounterState = parseEncounterState(input.encounterState)
  const from = deepCloneJson(placement.position)
  const to = deepCloneJson(input.destination)
  const moved = !sameAnchor(from, to)
  const nextFacing = moved
    ? tokenFacingTowardPoint(from, to, tokenFacingForPlacement(placement))
    : null
  const nextPlacement: SheetPlacement = {
    ...deepCloneJson(placement),
    position: to,
    ...(nextFacing === null
      ? {}
      : {
          facing: nextFacing,
          turned: tokenFacingStoresLegacyTurned(nextFacing),
        }),
  }
  const metadata = moved
    ? appendMovementLogEntry(input.map.metadata, {
        userId: placement.id,
        userName: input.userName,
        from,
        to,
        pathLength: input.distance,
      }, {
        now: () => input.timestamp,
        maxLogEntries: input.maxLogEntries,
      })
    : deepCloneJson(input.map.metadata)

  return {
    nextMap: {
      ...deepCloneJson(input.map),
      placements: input.map.placements.map(candidate => (
        candidate.id === placement.id ? nextPlacement : deepCloneJson(candidate)
      )),
      metadata,
      encounterState,
      updatedAt: input.timestamp,
    },
    placement: nextPlacement,
    from,
    to,
    distance: input.distance,
    turnResources: {
      previous: previousEncounterState.turnResources,
      current: encounterState.turnResources,
    },
  }
}
