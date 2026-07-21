import {
  MOVE_EFFECT_OPERATION_LIMITS,
  type MoveContextualMovementDistance,
  type MoveEffectMovementMode,
  type MoveMovementRequestEffectOperation,
} from '#shared/moveAutomation/effects'
import type { GridAnchor } from '~/types/map'
import type { AuthoritativeMovementTriggeringStep } from '../../movement/resolveMovement'
import {
  footprintsOverlap,
  gridFootprintTransition,
  isAnchorWithinBounds,
} from '~/utils/gridGeometry'
import {
  movementTerrainForAnchor,
  type MapMovementTerrainIndex,
  type MovementAnchorTerrain,
  type MovementTerrainRequirement,
} from '~/utils/mapMovementTerrain'
import {
  bestAerialMovementCapability,
  movementCapabilitySpeed,
} from '~/utils/movementCapabilities'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'
import type { AuthoritativeMoveRulesContext } from '../context'
import type { MoveRuleEvaluationTraceEntry } from '../evaluateExpression'

export type MoveSpatialTeleportEffectOperation = MoveMovementRequestEffectOperation & {
  readonly payload: MoveMovementRequestEffectOperation['payload'] & {
    readonly mode: 'teleport'
    readonly distance: number
    /** Stable server-owned destination option set produced before reduction. */
    readonly destinationSetId: string
    readonly choice?: undefined
    readonly displacement?: undefined
  }
}

export type MoveSpatialSwapEffectOperation = MoveMovementRequestEffectOperation & {
  readonly payload: MoveMovementRequestEffectOperation['payload'] & {
    readonly mode: 'swap'
    /** Maximum reviewed separation between the actor and willing ally. */
    readonly distance: number
    readonly destinationSetId: null
    readonly choice?: undefined
    readonly displacement?: undefined
  }
}

export type MoveSpatialRelocationEffectOperation =
  | MoveSpatialTeleportEffectOperation
  | MoveSpatialSwapEffectOperation

export interface ResolveMoveSpatialDestinationInput {
  readonly operationId: string
  readonly destinationSetId: string
  readonly recipientPlacementId: string
}

/** Server-owned durable destination lookup; no coordinate is read from move intent. */
export interface MoveSpatialDestinationResolver {
  resolve(input: ResolveMoveSpatialDestinationInput): GridAnchor | null
}

export const MOVE_SPATIAL_WILLINGNESS_VALUES = [
  'willing',
  'unwilling',
  'undeclared',
] as const

export type MoveSpatialWillingness =
  (typeof MOVE_SPATIAL_WILLINGNESS_VALUES)[number]

export interface ResolveMoveSpatialWillingnessInput {
  readonly operationId: string
  readonly actorPlacementId: string
  readonly targetPlacementId: string
}

/** Evidence must come from a reviewed rule or authorized durable response. */
export interface MoveSpatialWillingnessResolver {
  resolve(input: ResolveMoveSpatialWillingnessInput): MoveSpatialWillingness
}

export interface MoveSpatialRelocationDistanceResolution {
  readonly rawValue: number
  readonly value: number
  readonly minimum: number
  readonly maximum: number
  readonly rounding: MoveContextualMovementDistance['rounding'] | null
  readonly trace: readonly MoveRuleEvaluationTraceEntry[]
}

export interface MoveSpatialRelocationTerrain {
  readonly requirements: readonly MovementTerrainRequirement[]
  readonly air: boolean
  readonly airHeight: number
  readonly touchingSurface: boolean
}

/** Explicit lifecycle policy projected into the shared movement-step evidence. */
export interface MoveSpatialRelocationTriggers {
  readonly placementLeaving: boolean
  readonly placementEntering: boolean
  readonly placementMoving: boolean
  readonly opportunityAttacks: false
  readonly leftCells: readonly GridAnchor[]
  readonly enteredCells: readonly GridAnchor[]
}

export interface MoveSpatialRelocationMovement {
  readonly operationId: string
  readonly recipientPlacementId: string
  readonly mode: Extract<MoveEffectMovementMode, 'teleport' | 'swap'>
  readonly distance: MoveSpatialRelocationDistanceResolution
  readonly origin: GridAnchor
  readonly destination: GridAnchor
  /** Relocations have endpoints but never imply traversal of intermediate cells. */
  readonly path: readonly GridAnchor[]
  readonly traversesIntermediateCells: false
  readonly resolvedDistance: number
  readonly shortened: false
  readonly shorteningReason: 'none'
  readonly obstruction: null
  readonly relationship: 'self' | 'ally'
  readonly willingness: Extract<MoveSpatialWillingness, 'willing'>
  readonly terrain: MoveSpatialRelocationTerrain
  readonly triggers: MoveSpatialRelocationTriggers
  /** One endpoint transition for shared lifecycle event planning; never an intermediate route. */
  readonly triggeringSteps: readonly AuthoritativeMovementTriggeringStep[]
}

export interface MoveSpatialRelocationFootprint {
  readonly placementId: string
  readonly position: GridAnchor
  readonly base: number
  readonly clearance: number
}

export type MoveSpatialRelocationErrorCode =
  | 'invalid-relocation'
  | 'destination-unavailable'
  | 'relocation-range-exceeded'
  | 'relocation-relationship-invalid'
  | 'relocation-willingness-unavailable'
  | 'relocation-source-invalid'
  | 'relocation-destination-invalid'

export type FailMoveSpatialRelocation = (
  code: MoveSpatialRelocationErrorCode,
  message: string,
) => never

export interface ResolveMoveSpatialRelocationInput {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveSpatialRelocationEffectOperation
  readonly recipientIds: readonly string[]
  readonly positions: ReadonlyMap<string, GridAnchor>
  readonly terrainIndex: MapMovementTerrainIndex
  readonly destinations?: MoveSpatialDestinationResolver
  readonly willingness?: MoveSpatialWillingnessResolver
  readonly resolveFootprint: (
    placementId: string,
    role: 'recipient' | 'source',
    positions: ReadonlyMap<string, GridAnchor>,
  ) => MoveSpatialRelocationFootprint
  readonly resolveDistance: (
    recipientPlacementId: string,
  ) => MoveSpatialRelocationDistanceResolution
  readonly fail: FailMoveSpatialRelocation
}

const SPATIAL_WILLINGNESS_SET = new Set<string>(MOVE_SPATIAL_WILLINGNESS_VALUES)

const cloneAnchor = (anchor: GridAnchor): GridAnchor => ({
  x: anchor.x,
  y: anchor.y,
  z: anchor.z,
})

const isSafeAnchor = (value: unknown): value is GridAnchor => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const anchor = value as Partial<Record<keyof GridAnchor, unknown>>
  return Number.isSafeInteger(anchor.x)
    && Number.isSafeInteger(anchor.y)
    && Number.isSafeInteger(anchor.z)
}

const anchorsEqual = (left: GridAnchor, right: GridAnchor): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)

export const isMoveSpatialRelocationOperation = (
  operation: MoveMovementRequestEffectOperation,
): operation is MoveSpatialRelocationEffectOperation => (
  operation.payload.mode === 'teleport' || operation.payload.mode === 'swap'
)

const isTeleportOperation = (
  operation: MoveSpatialRelocationEffectOperation,
): operation is MoveSpatialTeleportEffectOperation => operation.payload.mode === 'teleport'

export const assertMoveSpatialRelocationOperation = (
  operation: MoveSpatialRelocationEffectOperation,
  fail: FailMoveSpatialRelocation,
): void => {
  const { payload } = operation
  if (
    operation.kind !== 'movement-request'
    || operation.phase !== 'movement'
    || (payload.mode !== 'teleport' && payload.mode !== 'swap')
    || !Number.isSafeInteger(payload.distance)
    || payload.distance <= 0
    || payload.distance > MOVE_EFFECT_OPERATION_LIMITS.movementDisplacementDistance
    || payload.choice !== undefined
    || payload.displacement !== undefined
    || (
      payload.mode === 'teleport'
      && (
        payload.destinationSetId === null
        || operation.recipients.kind !== 'actor'
      )
    )
    || (
      payload.mode === 'swap'
      && (
        payload.destinationSetId !== null
        || (operation.recipients.kind !== 'actor-and-attacked-targets'
          && !(operation.reasonCode === 'ability.bodyguard.swap'
            && operation.recipients.kind === 'response-owner'))
      )
    )
  ) {
    fail(
      'invalid-relocation',
      `Operation ${operation.id} is not a reviewed movement-phase teleport or swap.`,
    )
  }
}

const spatialFootprints = (
  input: ResolveMoveSpatialRelocationInput,
  positions: ReadonlyMap<string, GridAnchor>,
): readonly MoveSpatialRelocationFootprint[] => input.context.map.placements.map(placement => (
  input.resolveFootprint(placement.id, 'source', positions)
))

const terrainForSpatialFootprint = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly terrainIndex: MapMovementTerrainIndex
  readonly footprint: MoveSpatialRelocationFootprint
}): MovementAnchorTerrain => movementTerrainForAnchor({
  anchor: input.footprint.position,
  footprint: input.footprint,
  terrain: input.terrainIndex,
  groundLevelY: input.context.map.groundLevelY ?? 0,
})

const terrainRequirementAvailable = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly footprint: MoveSpatialRelocationFootprint
  readonly terrain: MovementAnchorTerrain
  readonly requirement: MovementTerrainRequirement
}): boolean => {
  const token = input.context.queries.tokens.get(input.footprint.placementId)
  if (!token) return false
  if (input.requirement === 'aerial') {
    return bestAerialMovementCapability(
      token.movementCapabilities,
      input.terrain.airHeight,
    ) !== null
  }
  return movementCapabilitySpeed(token.movementCapabilities, input.requirement) !== undefined
}

const relocationTerrainAllowed = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly footprint: MoveSpatialRelocationFootprint
  readonly terrain: MovementAnchorTerrain
  readonly mode: MoveSpatialRelocationEffectOperation['payload']['mode']
}): boolean => {
  if (input.terrain.blocked) return false
  if (input.mode === 'teleport') {
    // Teleporter endpoints must touch a surface unless Sky/Levitate supports
    // the authoritative height. Intermediate terrain is deliberately ignored.
    return !input.terrain.air || terrainRequirementAvailable({
      ...input,
      requirement: 'aerial',
    })
  }
  return input.terrain.requirements.every(requirement => terrainRequirementAvailable({
    ...input,
    requirement,
  }))
}

const relocationTerrainEvidence = (
  terrain: MovementAnchorTerrain,
): MoveSpatialRelocationTerrain => ({
  requirements: [...terrain.requirements],
  air: terrain.air,
  airHeight: terrain.airHeight,
  touchingSurface: !terrain.air,
})

const validateRelocationFootprints = (
  input: ResolveMoveSpatialRelocationInput,
  positions: ReadonlyMap<string, GridAnchor>,
  movedPlacementIds: readonly string[],
  stage: 'source' | 'destination',
): ReadonlyMap<string, MovementAnchorTerrain> => {
  const footprints = spatialFootprints(input, positions)
  const byId = new Map(footprints.map(footprint => [footprint.placementId, footprint]))
  const terrainById = new Map<string, MovementAnchorTerrain>()
  const errorCode = stage === 'source'
    ? 'relocation-source-invalid'
    : 'relocation-destination-invalid'

  for (const placementId of movedPlacementIds) {
    const footprint = byId.get(placementId)
      ?? input.fail(errorCode, `Relocation ${stage} placement ${placementId} is missing.`)
    if (!isAnchorWithinBounds(footprint.position, footprint, input.context.map.dimensions)) {
      input.fail(
        errorCode,
        `Relocation ${stage} footprint for ${placementId} is outside map bounds.`,
      )
    }
    const terrain = terrainForSpatialFootprint({
      context: input.context,
      terrainIndex: input.terrainIndex,
      footprint,
    })
    if (!relocationTerrainAllowed({
      context: input.context,
      footprint,
      terrain,
      mode: input.operation.payload.mode,
    })) {
      input.fail(
        errorCode,
        `Relocation ${stage} footprint for ${placementId} violates ${input.operation.payload.mode} terrain restrictions.`,
      )
    }
    const collision = footprints.find(other => (
      other.placementId !== placementId
      && footprintsOverlap(
        footprint.position,
        footprint.base,
        footprint.clearance,
        other.position,
        other.base,
        other.clearance,
      )
    ))
    if (collision) {
      input.fail(
        errorCode,
        `Relocation ${stage} footprint for ${placementId} overlaps ${collision.placementId}.`,
      )
    }
    terrainById.set(placementId, terrain)
  }
  return terrainById
}

const footprintRange = (
  left: MoveSpatialRelocationFootprint,
  right: MoveSpatialRelocationFootprint,
): number => {
  const axisDistance = (
    leftStart: number,
    leftExtent: number,
    rightStart: number,
    rightExtent: number,
  ): number => {
    if (rightStart >= leftStart + leftExtent) {
      return rightStart - (leftStart + leftExtent - 1)
    }
    if (leftStart >= rightStart + rightExtent) {
      return leftStart - (rightStart + rightExtent - 1)
    }
    return 0
  }
  return ptuGridVectorDistance({
    x: axisDistance(left.position.x, left.base, right.position.x, right.base),
    y: axisDistance(
      left.position.y,
      left.clearance,
      right.position.y,
      right.clearance,
    ),
    z: axisDistance(left.position.z, left.base, right.position.z, right.base),
  })
}

const anchorDistance = (origin: GridAnchor, destination: GridAnchor): number => (
  ptuGridVectorDistance({
    x: destination.x - origin.x,
    y: destination.y - origin.y,
    z: destination.z - origin.z,
  })
)

const relocationTriggeringSteps = (input: {
  readonly origin: GridAnchor
  readonly destination: GridAnchor
  readonly distance: number
  readonly terrain: MovementAnchorTerrain
  readonly triggers: MoveSpatialRelocationTriggers
}): readonly AuthoritativeMovementTriggeringStep[] => {
  if (!input.triggers.placementMoving) return []
  const changedAxisCount = [
    input.origin.x !== input.destination.x,
    input.origin.y !== input.destination.y,
    input.origin.z !== input.destination.z,
  ].filter(Boolean).length
  return [{
    index: 1,
    from: cloneAnchor(input.origin),
    to: cloneAnchor(input.destination),
    cost: input.distance,
    cumulativeCost: input.distance,
    diagonal: changedAxisCount > 1,
    slowCostApplied: false,
    capabilities: [],
    terrain: {
      requirements: [...input.terrain.requirements],
      slow: false,
      air: input.terrain.air,
      airHeight: input.terrain.airHeight,
      hoverable: input.terrain.hoverable,
    },
    leftAdjacentPlacementIds: [],
    leftCells: input.triggers.leftCells.map(cloneAnchor),
    enteredCells: input.triggers.enteredCells.map(cloneAnchor),
    finalDestination: true,
  }]
}

const relocationMovement = (input: {
  readonly operation: MoveSpatialRelocationEffectOperation
  readonly recipient: MoveSpatialRelocationFootprint
  readonly destination: GridAnchor
  readonly distance: MoveSpatialRelocationDistanceResolution
  readonly relationship: 'self' | 'ally'
  readonly terrain: MovementAnchorTerrain
}): MoveSpatialRelocationMovement => {
  const origin = cloneAnchor(input.recipient.position)
  const destination = cloneAnchor(input.destination)
  const moved = !anchorsEqual(origin, destination)
  const transition = gridFootprintTransition(origin, destination, input.recipient)
  const triggers: MoveSpatialRelocationTriggers = {
    placementLeaving: moved && transition.leftCells.length > 0,
    placementEntering: moved && transition.enteredCells.length > 0,
    placementMoving: moved,
    opportunityAttacks: false,
    leftCells: transition.leftCells.map(cloneAnchor),
    enteredCells: transition.enteredCells.map(cloneAnchor),
  }
  return {
    operationId: input.operation.id,
    recipientPlacementId: input.recipient.placementId,
    mode: input.operation.payload.mode,
    distance: input.distance,
    origin,
    destination,
    path: moved ? [origin, destination] : [origin],
    traversesIntermediateCells: false,
    resolvedDistance: anchorDistance(origin, destination),
    shortened: false,
    shorteningReason: 'none',
    obstruction: null,
    relationship: input.relationship,
    willingness: 'willing',
    terrain: relocationTerrainEvidence(input.terrain),
    triggers,
    triggeringSteps: relocationTriggeringSteps({
      origin,
      destination,
      distance: anchorDistance(origin, destination),
      terrain: input.terrain,
      triggers,
    }),
  }
}

const resolveTeleportMovements = (
  input: ResolveMoveSpatialRelocationInput & {
    readonly operation: MoveSpatialTeleportEffectOperation
  },
): readonly MoveSpatialRelocationMovement[] => {
  const actorId = input.context.actor.placement.id
  if (input.recipientIds.length !== 1 || input.recipientIds[0] !== actorId) {
    input.fail(
      'relocation-relationship-invalid',
      `Teleport operation ${input.operation.id} must address only its authoritative actor.`,
    )
  }
  validateRelocationFootprints(input, input.positions, input.recipientIds, 'source')
  const recipient = input.resolveFootprint(actorId, 'recipient', input.positions)
  const distance = input.resolveDistance(actorId)
  const selected = input.destinations?.resolve({
    operationId: input.operation.id,
    destinationSetId: input.operation.payload.destinationSetId,
    recipientPlacementId: actorId,
  }) ?? null
  const destination = isSafeAnchor(selected)
    ? cloneAnchor(selected)
    : input.fail(
        'destination-unavailable',
        `Teleport operation ${input.operation.id} has no server-owned destination for ${actorId}.`,
      )
  if (anchorDistance(recipient.position, destination) > distance.value) {
    input.fail(
      'relocation-range-exceeded',
      `Teleport operation ${input.operation.id} destination exceeds its reviewed range ${distance.value}.`,
    )
  }
  const finalPositions = new Map(input.positions)
  finalPositions.set(actorId, destination)
  const terrain = validateRelocationFootprints(
    input,
    finalPositions,
    input.recipientIds,
    'destination',
  ).get(actorId)!
  return [relocationMovement({
    operation: input.operation,
    recipient,
    destination,
    distance,
    relationship: 'self',
    terrain,
  })]
}

const resolveSwapWillingness = (
  input: ResolveMoveSpatialRelocationInput & {
    readonly operation: MoveSpatialSwapEffectOperation
    readonly actorPlacementId: string
    readonly targetPlacementId: string
  },
): void => {
  const value = input.willingness?.resolve({
    operationId: input.operation.id,
    actorPlacementId: input.actorPlacementId,
    targetPlacementId: input.targetPlacementId,
  }) ?? 'undeclared'
  if (!SPATIAL_WILLINGNESS_SET.has(value) || value !== 'willing') {
    input.fail(
      'relocation-willingness-unavailable',
      `Swap operation ${input.operation.id} requires server-owned willingness from ${input.targetPlacementId}.`,
    )
  }
}

const resolveSwapMovements = (
  input: ResolveMoveSpatialRelocationInput & {
    readonly operation: MoveSpatialSwapEffectOperation
  },
): readonly MoveSpatialRelocationMovement[] => {
  const bodyguardSwap = input.operation.reasonCode === 'ability.bodyguard.swap'
    && input.operation.recipients.kind === 'response-owner'
  const bodyguardTargetMarker = '.target.'
  const markerIndex = input.operation.payload.requestId.indexOf(bodyguardTargetMarker)
  let bodyguardTargetId: string | null = null
  if (bodyguardSwap && markerIndex >= 0) {
    try {
      bodyguardTargetId = decodeURIComponent(input.operation.payload.requestId.slice(
        markerIndex + bodyguardTargetMarker.length,
      ))
    }
    catch {
      input.fail('invalid-relocation', `Bodyguard swap ${input.operation.id} has an invalid protected target.`)
    }
  }
  const actorId = bodyguardSwap
    ? input.recipientIds.find(id => id !== bodyguardTargetId) ?? input.context.actor.placement.id
    : input.context.actor.placement.id
  const targetIds = input.recipientIds.filter(id => id !== actorId)
  if (
    input.recipientIds.length !== 2
    || !input.recipientIds.includes(actorId)
    || targetIds.length !== 1
    || (bodyguardSwap && targetIds[0] !== bodyguardTargetId)
  ) {
    input.fail(
      'relocation-relationship-invalid',
      `Swap operation ${input.operation.id} requires exactly the actor and one other placement.`,
    )
  }
  const targetId = targetIds[0]!
  const relationship = input.context.queries.relationships.resolve(actorId, targetId)
  if (relationship.relationship !== 'ally') {
    input.fail(
      'relocation-relationship-invalid',
      `Swap operation ${input.operation.id} requires an explicit allied target; ${targetId} is ${relationship.relationship}.`,
    )
  }
  if (!bodyguardSwap) {
    resolveSwapWillingness({
      ...input,
      actorPlacementId: actorId,
      targetPlacementId: targetId,
    })
  }
  validateRelocationFootprints(input, input.positions, input.recipientIds, 'source')
  const actor = input.resolveFootprint(actorId, 'recipient', input.positions)
  const target = input.resolveFootprint(targetId, 'recipient', input.positions)
  const distance = input.resolveDistance(targetId)
  if (footprintRange(actor, target) > distance.value) {
    input.fail(
      'relocation-range-exceeded',
      `Swap operation ${input.operation.id} target exceeds its reviewed range ${distance.value} (${actorId}@${actor.position.x},${actor.position.y},${actor.position.z}; ${targetId}@${target.position.x},${target.position.y},${target.position.z}; distance ${footprintRange(actor, target)}).`,
    )
  }

  // Install both proposed anchors before validating either destination. This
  // allows simultaneous occupancy of vacated origins while ensuring a failed
  // second footprint never leaks a partial first transition.
  const finalPositions = new Map(input.positions)
  finalPositions.set(actorId, cloneAnchor(target.position))
  finalPositions.set(targetId, cloneAnchor(actor.position))
  const terrainById = validateRelocationFootprints(
    input,
    finalPositions,
    input.recipientIds,
    'destination',
  )

  return input.recipientIds.map((recipientId) => {
    const recipient = recipientId === actorId ? actor : target
    return relocationMovement({
      operation: input.operation,
      recipient,
      destination: finalPositions.get(recipientId)!,
      distance,
      relationship: recipientId === actorId ? 'self' : 'ally',
      terrain: terrainById.get(recipientId)!,
    })
  })
}

export const resolveMoveSpatialRelocation = (
  input: ResolveMoveSpatialRelocationInput,
): readonly MoveSpatialRelocationMovement[] => {
  assertMoveSpatialRelocationOperation(input.operation, input.fail)
  return isTeleportOperation(input.operation)
    ? resolveTeleportMovements({ ...input, operation: input.operation })
    : resolveSwapMovements({ ...input, operation: input.operation })
}
