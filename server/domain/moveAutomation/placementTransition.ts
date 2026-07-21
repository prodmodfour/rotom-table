import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import {
  setTokenFacingOnPlacement,
  tokenFacingForPlacement,
  tokenFacingStoresLegacyTurned,
} from '~/utils/tokenFacing'
import { deepCloneJson } from '~/utils/serialization'
import { Aa060AnchoredMovementError, assertAa060AnchoredDestination } from '../abilityAutomation/mechanics/aa060'

export interface ImmediatePassPlacementTransition {
  readonly kind: 'pass'
  readonly from: GridAnchor
  readonly destination: GridAnchor
}

export interface DurableShiftPlacementTransition {
  readonly kind: 'shift'
  readonly from: GridAnchor
  readonly destination: GridAnchor
}

export type AuthoritativeMovePlacementMovement =
  | ImmediatePassPlacementTransition
  | DurableShiftPlacementTransition

export type FailMovePlacementTransition = (
  code: string,
  message: string,
) => never

const isSafeGridAnchor = (value: unknown): value is GridAnchor => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<Record<keyof GridAnchor, unknown>>
  return Number.isSafeInteger(record.x)
    && Number.isSafeInteger(record.y)
    && Number.isSafeInteger(record.z)
}

const gridAnchorsEqual = (left: GridAnchor, right: GridAnchor): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)

const gridAnchorInBounds = (anchor: GridAnchor, map: TabletopMap): boolean => (
  anchor.x >= 0
  && anchor.x < map.dimensions.x
  && anchor.y >= 0
  && anchor.y < map.dimensions.y
  && anchor.z >= 0
  && anchor.z < map.dimensions.z
)

const setActorPlacement = (
  map: TabletopMap,
  actorPlacementId: string,
  update: (placement: SheetPlacement) => SheetPlacement,
): TabletopMap => ({
  ...map,
  placements: map.placements.map(placement => (
    placement.id === actorPlacementId
      ? update(deepCloneJson(placement))
      : deepCloneJson(placement)
  )),
})

const applyFacing = (
  map: TabletopMap,
  actorPlacementId: string,
  facing: TokenFacingDirection | undefined,
): TabletopMap => {
  if (!facing) return map
  return setActorPlacement(map, actorPlacementId, (placement) => {
    const legacyTurned = tokenFacingStoresLegacyTurned(facing)
    if (tokenFacingForPlacement(placement) === facing && placement.turned === legacyTurned) {
      return placement
    }
    setTokenFacingOnPlacement(placement, facing)
    return placement
  })
}

/** Apply already-resolved immediate movement/facing without deriving a path. */
export const applyAuthoritativeMovePlacementTransition = (options: {
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly movement?: AuthoritativeMovePlacementMovement
  readonly desiredFacing?: TokenFacingDirection
  readonly fail: FailMovePlacementTransition
}): TabletopMap => {
  if (options.movement) {
    const movementLabel = options.movement.kind === 'pass' ? 'Pass' : 'Shift'
    if (!gridAnchorsEqual(options.movement.from, options.actorPlacement.position)) {
      return options.fail(
        options.movement.kind === 'pass'
          ? 'pass-source-position-mismatch'
          : 'shift-source-position-mismatch',
        `${movementLabel} source ${options.movement.from.x},${options.movement.from.y},${options.movement.from.z} does not match actor position ${options.actorPlacement.position.x},${options.actorPlacement.position.y},${options.actorPlacement.position.z}.`,
      )
    }
    if (
      !isSafeGridAnchor(options.movement.destination)
      || !gridAnchorInBounds(options.movement.destination, options.map)
    ) {
      return options.fail(
        options.movement.kind === 'pass'
          ? 'invalid-pass-destination'
          : 'invalid-shift-destination',
        `Resolved ${movementLabel} destination is not a valid map cell.`,
      )
    }
    const destination = options.movement.destination
    try {
      assertAa060AnchoredDestination({
        map: options.map,
        placementId: options.actorPlacement.id,
        destination,
      })
    }
    catch (error) {
      if (error instanceof Aa060AnchoredMovementError) {
        return options.fail('ability-anchored-destination', error.message)
      }
      throw error
    }
    const moved = setActorPlacement(
      options.map,
      options.actorPlacement.id,
      placement => ({ ...placement, position: deepCloneJson(destination) }),
    )
    return applyFacing(moved, options.actorPlacement.id, options.desiredFacing)
  }

  return applyFacing(options.map, options.actorPlacement.id, options.desiredFacing)
}
