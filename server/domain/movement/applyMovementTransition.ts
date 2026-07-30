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
import { assertAa060AnchoredDestination } from '../abilityAutomation/mechanics/aa060'
import { recordAa085to100MovementEvidence } from '../abilityAutomation/mechanics/aa085to100MovementIntegration'
import { relocateCapabilityGlowLights } from '../capabilityAutomation/glow'

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
  /** Exact source-effective companions returned by the movement oracle. */
  readonly linkedCompanionPlacementIds?: readonly string[]
  readonly maxLogEntries?: number
  readonly movementEvidence?: {
    readonly operationId: string
    readonly path: readonly GridAnchor[]
    readonly mode: 'voluntary' | 'jump' | 'forced' | 'teleport'
  }
}): AuthoritativeMovementMapTransition => {
  if (!Number.isSafeInteger(input.distance) || input.distance < 0) {
    throw new Error('Authoritative movement transition distance must be a non-negative safe integer.')
  }
  const placement = input.map.placements.find(candidate => candidate.id === input.placementId)
  if (!placement) throw new Error(`Movement placement ${input.placementId} is missing.`)
  assertAa060AnchoredDestination({
    map: input.map,
    placementId: input.placementId,
    destination: input.destination,
  })

  const previousEncounterState = parseEncounterState(
    input.map.encounterState ?? createEmptyEncounterState(),
  )
  const parsedEncounterState = parseEncounterState(input.encounterState)
  let encounterState = input.movementEvidence
    ? recordAa085to100MovementEvidence({
        encounterState: parsedEncounterState,
        placementId: input.placementId,
        ...input.movementEvidence,
      })
    : parsedEncounterState
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
  // Companion identities are evidence returned by the authoritative movement
  // oracle. Never rediscover them from raw persisted links at transition time.
  const linkedCompanionIds = new Set(input.linkedCompanionPlacementIds ?? [])
  const movingPlacementIds = new Set([placement.id, ...linkedCompanionIds])
  let metadata = moved
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
  if (moved && Array.isArray(input.map.metadata?.capabilityIllusions)) {
    const contactedOwnerIds = new Set(input.map.metadata.capabilityIllusions.flatMap((raw): readonly string[] => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
      const illusion = raw as Record<string, unknown>
      const position = illusion.position as Record<string, unknown> | undefined
      return illusion.ownerPlacementId !== placement.id
        && position?.x === to.x && position.y === to.y && position.z === to.z
        && typeof illusion.ownerPlacementId === 'string'
        ? [illusion.ownerPlacementId] : []
    }))
    if (contactedOwnerIds.size > 0) {
      metadata = {
        ...(metadata ?? {}),
        capabilityIllusions: input.map.metadata.capabilityIllusions.filter(raw => (
          !contactedOwnerIds.has(String((raw as Record<string, unknown>)?.ownerPlacementId))
        )),
      }
      encounterState = parseEncounterState({
        ...encounterState,
        capabilityRuntime: encounterState.capabilityRuntime ? {
          ...encounterState.capabilityRuntime,
          modes: encounterState.capabilityRuntime.modes.filter(mode => (
            mode.mode !== 'illusion' || !contactedOwnerIds.has(mode.actorPlacementId)
          )),
        } : encounterState.capabilityRuntime,
        effects: encounterState.effects.filter(effect => (
          ![...contactedOwnerIds].some(ownerId => effect.id === `capability.mode.${ownerId}.illusion`)
        )),
      })
    }
  }
  if (moved && Array.isArray(metadata?.capabilityObjects)) {
    metadata = {
      ...(metadata ?? {}),
      capabilityObjects: metadata.capabilityObjects.map((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)
          || !movingPlacementIds.has(String((raw as Record<string, unknown>).attachedToPlacementId))) return raw
        return { ...(raw as Record<string, unknown>), position: { ...to } }
      }),
    }
  }

  return {
    nextMap: {
      ...deepCloneJson(input.map),
      placements: input.map.placements.map(candidate => {
        if (candidate.id === placement.id) return nextPlacement
        if (linkedCompanionIds.has(candidate.id)) return { ...deepCloneJson(candidate), position: { ...to } }
        return deepCloneJson(candidate)
      }),
      metadata,
      encounterState,
      ...(moved && input.map.lights ? {
        lights: relocateCapabilityGlowLights({
          lights: input.map.lights,
          placementIds: movingPlacementIds,
          destination: to,
        }),
      } : {}),
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
