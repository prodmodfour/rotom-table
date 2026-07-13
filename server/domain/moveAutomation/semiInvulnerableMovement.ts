import {
  MOVE_EFFECT_OPERATION_LIMITS,
  parseMoveEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, TabletopMap } from '~/types/map'
import type { MovementMode } from '~/types/movement'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  footprintsOverlap,
  getClearanceValue,
  isAnchorWithinBounds,
} from '~/utils/gridGeometry'
import {
  buildMapMovementTerrainIndex,
  movementTerrainForAnchor,
} from '~/utils/mapMovementTerrain'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'
import {
  GM_OVERRIDE_AUTHORITATIVE_MOVEMENT_POLICY,
  resolveAuthoritativeMovement,
  type AuthoritativeMovementSheets,
  type AuthoritativeMovementSuccess,
  type AuthoritativeMovementTriggeringStep,
} from '../movement/resolveMovement'
import type {
  AuthoritativeMoveRulesContext,
  AuthoritativeMoveSheetRead,
} from './context'
import {
  MoveSpatialEffectReductionError,
  reduceMoveSpatialEffects,
  type MoveResolvedSpatialEffectOperation,
  type MoveSpatialRelocationEffectOperation,
} from './reducers/spatial'
import {
  MoveSemiInvulnerableSetupError,
  moveSemiInvulnerableSetupGroup,
  type MoveSemiInvulnerableSetupGroup,
} from './semiInvulnerableEffects'
import { createMoveSemiInvulnerableCleanupEvents } from './semiInvulnerableLifecycle'
import { deriveMoveSemiInvulnerableId } from './semiInvulnerableSupport'

export const MOVE_SEMI_INVULNERABLE_RESOLUTION_LIMITS = Object.freeze({
  destinationSetIdChars: 160,
})

export interface MoveSemiInvulnerableResolutionChoice {
  readonly destination: GridAnchor
  /** Required only when the reviewed resolution lands/appears by a legal target. */
  readonly targetPlacementId: string | null
}

export interface ResolveMoveSemiInvulnerableChoiceInput {
  readonly setupOperationId: string
  readonly resolutionOperationId: string
  readonly destinationSetId: string
  readonly familyId: MoveSemiInvulnerableSetupGroup['definition']['familyId']
  readonly actorPlacementId: string
}

/** Durable/server-owned option lookup. No command carries a mechanics coordinate. */
export interface MoveSemiInvulnerableResolutionChoiceResolver {
  resolve(input: ResolveMoveSemiInvulnerableChoiceInput): MoveSemiInvulnerableResolutionChoice | null
}

export type MoveSemiInvulnerableResolvedMovementMode =
  | 'traverse'
  | 'appear'
  | 'carried'

export interface MoveSemiInvulnerableResolvedMovement {
  readonly resolutionOperationId: string
  readonly placementId: string
  readonly role: 'user' | 'carried-target'
  readonly mode: MoveSemiInvulnerableResolvedMovementMode
  readonly origin: GridAnchor
  readonly destination: GridAnchor
  readonly path: readonly GridAnchor[]
  readonly cost: number
  readonly reviewedLimit: number | null
  readonly capabilityModes: readonly MovementMode[]
  readonly traversesIntermediateCells: boolean
  readonly ignoresMovementCapabilities: boolean
  readonly triggeringSteps: readonly AuthoritativeMovementTriggeringStep[]
}

export interface MoveSemiInvulnerableResolutionPlan {
  readonly setupOperationId: string
  readonly resolutionOperationId: string
  readonly canonicalMoveId: MoveSemiInvulnerableSetupGroup['definition']['canonicalId']
  readonly actorPlacementId: string
  readonly targetPlacementId: string | null
  readonly movements: readonly MoveSemiInvulnerableResolvedMovement[]
  readonly cleanupEvents: ReturnType<typeof createMoveSemiInvulnerableCleanupEvents>
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
}

export type MoveSemiInvulnerableMovementErrorCode =
  | 'invalid-resolution'
  | 'setup-group-not-found'
  | 'actor-mismatch'
  | 'choice-unavailable'
  | 'choice-invalid'
  | 'target-required'
  | 'target-unexpected'
  | 'target-not-found'
  | 'target-not-targetable'
  | 'target-not-adjacent'
  | 'movement-mode-unavailable'
  | 'movement-limit-exceeded'
  | 'movement-unavailable'
  | 'carried-destination-invalid'

export class MoveSemiInvulnerableMovementError extends Error {
  readonly code: MoveSemiInvulnerableMovementErrorCode

  constructor(code: MoveSemiInvulnerableMovementErrorCode, message: string) {
    super(message)
    this.name = 'MoveSemiInvulnerableMovementError'
    this.code = code
  }
}

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/

const fail = (
  code: MoveSemiInvulnerableMovementErrorCode,
  message: string,
): never => {
  throw new MoveSemiInvulnerableMovementError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const stableId = (value: unknown, label: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MOVE_SEMI_INVULNERABLE_RESOLUTION_LIMITS.destinationSetIdChars
    || !STABLE_ID_PATTERN.test(value)
  ) {
    return fail('invalid-resolution', `${label} must be a bounded lowercase stable ID.`)
  }
  return value
}

const cloneAnchor = (anchor: GridAnchor): GridAnchor => ({
  x: anchor.x,
  y: anchor.y,
  z: anchor.z,
})

const validAnchor = (value: unknown): value is GridAnchor => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const anchor = value as Partial<Record<keyof GridAnchor, unknown>>
  return Number.isSafeInteger(anchor.x)
    && Number.isSafeInteger(anchor.y)
    && Number.isSafeInteger(anchor.z)
}

const anchorsEqual = (left: GridAnchor, right: GridAnchor): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)

const movementSheets = (
  context: AuthoritativeMoveRulesContext,
): AuthoritativeMovementSheets => {
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  for (const resolved of context.resolvedSheets) {
    if (resolved.kind === 'pokemon') pokemon.set(resolved.slug, resolved.sheet as CharacterSheet)
    else trainer.set(resolved.slug, resolved.sheet as TrainerSheet)
  }
  return { pokemon, trainer }
}

const mapWithoutSetupEffects = (
  context: AuthoritativeMoveRulesContext,
  group: MoveSemiInvulnerableSetupGroup,
  omitPlacementIds: ReadonlySet<string> = new Set(),
): TabletopMap => {
  const state = parseEncounterState(
    context.map.encounterState ?? createEmptyEncounterState(),
  )
  const effectIds = new Set(group.effects.map(effect => effect.id))
  return {
    ...context.map,
    placements: context.map.placements.filter(placement => !omitPlacementIds.has(placement.id)),
    encounterState: parseEncounterState({
      ...state,
      effects: state.effects.filter(effect => !effectIds.has(effect.id)),
    }),
  }
}

const availableModeSpeed = (
  context: AuthoritativeMoveRulesContext,
  mode: MovementMode,
): number => {
  const profile = context.actor.token.movementProfile
  if (!profile) return 0
  if (mode === 'jump') {
    return Math.max(profile.traits.jump.long, profile.traits.jump.high)
  }
  if (mode === 'phasing') return profile.traits.phasing ? 1 : 0
  return profile.speeds[mode] ?? 0
}

const reviewedMovementLimit = (
  context: AuthoritativeMoveRulesContext,
  group: MoveSemiInvulnerableSetupGroup,
): number => {
  const movement = group.definition.resolutionMovement
  const base = Math.max(0, ...movement.allowedModes.map(mode => availableModeSpeed(context, mode)))
  if (base <= 0) {
    return fail(
      'movement-mode-unavailable',
      `${group.definition.canonicalId} has none of its reviewed resolve-phase movement modes.`,
    )
  }
  const limit = (base + movement.speedBonus) * movement.speedMultiplier
  if (!Number.isSafeInteger(limit) || limit < 0) {
    return fail('movement-mode-unavailable', 'Resolve-phase movement limit is invalid.')
  }
  return limit
}

const usedModesAllowed = (
  movement: AuthoritativeMovementSuccess,
  allowedModes: readonly MovementMode[],
): boolean => movement.capabilities.used.every(capability => (
  allowedModes.includes(capability.key as MovementMode)
))

const movementFromOracle = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly group: MoveSemiInvulnerableSetupGroup
  readonly destination: GridAnchor
  readonly omitPlacementIds?: ReadonlySet<string>
}): MoveSemiInvulnerableResolvedMovement => {
  const reviewedLimit = reviewedMovementLimit(input.context, input.group)
  const map = mapWithoutSetupEffects(
    input.context,
    input.group,
    input.omitPlacementIds,
  )
  const origin = input.context.actor.placement.position
  const movement = resolveAuthoritativeMovement({
    map,
    sheets: movementSheets(input.context),
    placementId: input.group.actorPlacementId,
    mode: 'shift',
    destination: input.destination,
    policy: anchorsEqual(origin, input.destination)
      ? { kind: 'standard', allowSamePosition: true, maximumCost: reviewedLimit }
      : GM_OVERRIDE_AUTHORITATIVE_MOVEMENT_POLICY,
  })
  for (const read of movement.sheetReads) input.context.reads.recordSheet(read)
  if (!movement.ok) {
    return fail(
      'movement-unavailable',
      `${input.group.definition.canonicalId} resolve movement is unavailable (${movement.reasonCode}).`,
    )
  }
  if (!usedModesAllowed(movement, input.group.definition.resolutionMovement.allowedModes)) {
    return fail(
      'movement-mode-unavailable',
      `${input.group.definition.canonicalId} route used a movement mode outside its reviewed resolution policy.`,
    )
  }
  if (movement.cost > reviewedLimit) {
    return fail(
      'movement-limit-exceeded',
      `${input.group.definition.canonicalId} route cost ${movement.cost} exceeds reviewed limit ${reviewedLimit}.`,
    )
  }
  return deepFreeze({
    resolutionOperationId: '',
    placementId: input.group.actorPlacementId,
    role: 'user' as const,
    mode: 'traverse' as const,
    origin: cloneAnchor(movement.origin),
    destination: cloneAnchor(movement.destination),
    path: movement.path.map(cloneAnchor),
    cost: movement.cost,
    reviewedLimit,
    capabilityModes: movement.capabilities.used.map(capability => capability.key as MovementMode),
    traversesIntermediateCells: true,
    ignoresMovementCapabilities: false,
    triggeringSteps: movement.triggeringSteps,
  })
}

interface PlacementFootprint {
  readonly id: string
  readonly position: GridAnchor
  readonly base: number
  readonly clearance: number
}

const footprint = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
): PlacementFootprint => {
  const placement = context.queries.placements.get(placementId)
  const token = context.queries.tokens.get(placementId)
  if (!placement || !token) {
    return fail('target-not-found', `Resolve-phase placement ${placementId} is unavailable.`)
  }
  context.reads.recordPlacement(placement)
  return {
    id: placement.id,
    position: cloneAnchor(placement.position),
    base: token.base,
    clearance: getClearanceValue(token),
  }
}

const axisFootprintDistance = (
  leftStart: number,
  leftExtent: number,
  rightStart: number,
  rightExtent: number,
): number => {
  if (rightStart >= leftStart + leftExtent) return rightStart - (leftStart + leftExtent - 1)
  if (leftStart >= rightStart + rightExtent) return leftStart - (rightStart + rightExtent - 1)
  return 0
}

const footprintsAdjacent = (input: {
  readonly left: PlacementFootprint
  readonly leftPosition: GridAnchor
  readonly right: PlacementFootprint
  readonly rightPosition: GridAnchor
}): boolean => {
  if (footprintsOverlap(
    input.leftPosition,
    input.left.base,
    input.left.clearance,
    input.rightPosition,
    input.right.base,
    input.right.clearance,
  )) return false
  return ptuGridVectorDistance({
    x: axisFootprintDistance(
      input.leftPosition.x,
      input.left.base,
      input.rightPosition.x,
      input.right.base,
    ),
    y: axisFootprintDistance(
      input.leftPosition.y,
      input.left.clearance,
      input.rightPosition.y,
      input.right.clearance,
    ),
    z: axisFootprintDistance(
      input.leftPosition.z,
      input.left.base,
      input.rightPosition.z,
      input.right.base,
    ),
  }) <= 1
}

const validateResolutionTarget = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly group: MoveSemiInvulnerableSetupGroup
  readonly targetPlacementId: string | null
  readonly destination: GridAnchor
}): string | null => {
  const requiresTarget = input.group.definition.resolutionMovement.requiresTargetAdjacency
  if (requiresTarget && input.targetPlacementId === null) {
    return fail('target-required', `${input.group.definition.canonicalId} requires a legal landing target.`)
  }
  if (!requiresTarget && input.targetPlacementId !== null) {
    return fail('target-unexpected', `${input.group.definition.canonicalId} does not accept a landing target.`)
  }
  if (input.targetPlacementId === null) return null
  if (input.targetPlacementId === input.group.actorPlacementId) {
    return fail('target-not-found', 'A setup move cannot land beside its own actor as target.')
  }
  const target = footprint(input.context, input.targetPlacementId)
  const actor = footprint(input.context, input.group.actorPlacementId)
  const targetability = input.context.queries.targetability.resolve({
    actorPlacementId: input.group.actorPlacementId,
    targetPlacementId: target.id,
    attackingMoveId: input.group.definition.canonicalId,
    originatingSetupOperationId: input.group.setupOperationId,
  })
  if (!targetability.targetable) {
    return fail(
      'target-not-targetable',
      `Resolve-phase target ${target.id} is not targetable (${targetability.reasonCode}).`,
    )
  }
  if (!footprintsAdjacent({
    left: actor,
    leftPosition: input.destination,
    right: target,
    rightPosition: target.position,
  })) {
    return fail(
      'target-not-adjacent',
      `${input.group.definition.canonicalId} destination is not adjacent to target ${target.id}.`,
    )
  }
  return target.id
}

const EMPTY_DYNAMIC_RECIPIENTS = Object.freeze({
  attackedTargetIds: Object.freeze([]),
  hitTargetIds: Object.freeze([]),
  missedTargetIds: Object.freeze([]),
  damagedTargetIds: Object.freeze([]),
  faintedTargetIds: Object.freeze([]),
})

const appearMovement = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly group: MoveSemiInvulnerableSetupGroup
  readonly resolutionOperationId: string
  readonly destinationSetId: string
  readonly destination: GridAnchor
}): MoveSemiInvulnerableResolvedMovement => {
  const movementOperationId = deriveMoveSemiInvulnerableId(
    'operation.semi-appear',
    input.resolutionOperationId,
  )
  const operation = parseMoveEffectOperation({
    id: movementOperationId,
    kind: 'movement-request',
    source: { kind: 'encounter-effect', id: input.group.actorEffect.id },
    recipients: { kind: 'actor' },
    phase: 'movement',
    reasonCode: `${input.group.definition.familyId}.appear`,
    payload: {
      requestId: deriveMoveSemiInvulnerableId(
        'request.semi-appear',
        input.resolutionOperationId,
      ),
      mode: 'teleport',
      distance: MOVE_EFFECT_OPERATION_LIMITS.movementDisplacementDistance,
      destinationSetId: input.destinationSetId,
    },
  }, 'semiInvulnerable.appearOperation') as MoveSpatialRelocationEffectOperation
  const emission: MoveResolvedSpatialEffectOperation = {
    operation,
    recipientIds: [input.group.actorPlacementId],
  }
  let reduction: ReturnType<typeof reduceMoveSpatialEffects>
  try {
    reduction = reduceMoveSpatialEffects({
      context: input.context,
      operations: [emission],
      dynamicRecipients: EMPTY_DYNAMIC_RECIPIENTS,
      destinations: { resolve: () => cloneAnchor(input.destination) },
    })
  }
  catch (error) {
    if (error instanceof MoveSpatialEffectReductionError) {
      return fail(
        'movement-unavailable',
        `${input.group.definition.canonicalId} appearance endpoint is unavailable (${error.code}).`,
      )
    }
    throw error
  }
  const movement = reduction.movements[0]
  if (!movement || movement.mode !== 'teleport') {
    return fail('movement-unavailable', 'Vanished setup did not produce one teleport endpoint.')
  }
  return deepFreeze({
    resolutionOperationId: input.resolutionOperationId,
    placementId: movement.recipientPlacementId,
    role: 'user' as const,
    mode: 'appear' as const,
    origin: cloneAnchor(movement.origin),
    destination: cloneAnchor(movement.destination),
    path: movement.path.map(cloneAnchor),
    cost: movement.resolvedDistance,
    reviewedLimit: null,
    capabilityModes: [],
    traversesIntermediateCells: false,
    ignoresMovementCapabilities: true,
    triggeringSteps: [],
  })
}

const translatedAnchor = (
  anchor: GridAnchor,
  from: GridAnchor,
  to: GridAnchor,
): GridAnchor => ({
  x: anchor.x + (to.x - from.x),
  y: anchor.y + (to.y - from.y),
  z: anchor.z + (to.z - from.z),
})

const validatePairDestination = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly actor: PlacementFootprint
  readonly target: PlacementFootprint
  readonly actorDestination: GridAnchor
  readonly targetDestination: GridAnchor
}): void => {
  const placements = input.context.queries.placements.all()
  const tokens = input.context.queries.tokens
  const stationary = placements.flatMap((placement): PlacementFootprint[] => {
    if (placement.id === input.actor.id || placement.id === input.target.id) return []
    const token = tokens.get(placement.id)
    if (!token) return fail('carried-destination-invalid', `Placement ${placement.id} is unresolved.`)
    input.context.reads.recordPlacement(placement)
    return [{
      id: placement.id,
      position: cloneAnchor(placement.position),
      base: token.base,
      clearance: getClearanceValue(token),
    }]
  })
  const dimensions = input.context.map.dimensions
  for (const [participant, destination] of [
    [input.actor, input.actorDestination],
    [input.target, input.targetDestination],
  ] as const) {
    if (!isAnchorWithinBounds(destination, participant, dimensions)) {
      return fail(
        'carried-destination-invalid',
        `Sky Drop destination for ${participant.id} is outside map bounds.`,
      )
    }
    const collision = stationary.find(other => footprintsOverlap(
      destination,
      participant.base,
      participant.clearance,
      other.position,
      other.base,
      other.clearance,
    ))
    if (collision) {
      return fail(
        'carried-destination-invalid',
        `Sky Drop destination for ${participant.id} overlaps ${collision.id}.`,
      )
    }
  }
  if (footprintsOverlap(
    input.actorDestination,
    input.actor.base,
    input.actor.clearance,
    input.targetDestination,
    input.target.base,
    input.target.clearance,
  )) {
    return fail('carried-destination-invalid', 'Sky Drop final participant footprints overlap.')
  }

  const terrainIndex = buildMapMovementTerrainIndex(input.context.map.voxels)
  const targetTerrain = movementTerrainForAnchor({
    anchor: input.targetDestination,
    footprint: input.target,
    terrain: terrainIndex,
    groundLevelY: input.context.map.groundLevelY ?? 0,
  })
  if (targetTerrain.blocked || targetTerrain.air) {
    return fail(
      'carried-destination-invalid',
      'Sky Drop must lower its carried target onto a non-blocking supported endpoint.',
    )
  }
}

const carriedPairMovements = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly group: MoveSemiInvulnerableSetupGroup
  readonly resolutionOperationId: string
  readonly destination: GridAnchor
}): readonly MoveSemiInvulnerableResolvedMovement[] => {
  const targetPlacementId = input.group.carriedTargetPlacementId
    ?? fail('invalid-resolution', 'Sky Drop has no carried target.')
  const actor = footprint(input.context, input.group.actorPlacementId)
  const target = footprint(input.context, targetPlacementId)
  const primary = movementFromOracle({
    context: input.context,
    group: input.group,
    destination: input.destination,
    omitPlacementIds: new Set([targetPlacementId]),
  })
  const targetDestination = translatedAnchor(target.position, actor.position, primary.destination)
  validatePairDestination({
    context: input.context,
    actor,
    target,
    actorDestination: primary.destination,
    targetDestination,
  })
  const targetPath = primary.path.map(anchor => translatedAnchor(
    target.position,
    actor.position,
    anchor,
  ))
  const actorMovement = deepFreeze({
    ...primary,
    resolutionOperationId: input.resolutionOperationId,
  })
  const carriedMovement = deepFreeze({
    resolutionOperationId: input.resolutionOperationId,
    placementId: target.id,
    role: 'carried-target' as const,
    mode: 'carried' as const,
    origin: cloneAnchor(target.position),
    destination: targetDestination,
    path: targetPath,
    cost: primary.cost,
    reviewedLimit: primary.reviewedLimit,
    capabilityModes: [],
    traversesIntermediateCells: true,
    ignoresMovementCapabilities: true,
    triggeringSteps: [],
  })
  return deepFreeze([actorMovement, carriedMovement])
}

/**
 * Resolve one active setup through a server-owned destination option. The
 * function plans movement and all linked cleanup but mutates no map or sheet.
 */
export const resolveMoveSemiInvulnerableMovement = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly setupOperationId: string
  readonly resolutionOperationId: string
  readonly destinationSetId: string
  readonly choices: MoveSemiInvulnerableResolutionChoiceResolver
}): MoveSemiInvulnerableResolutionPlan => {
  const setupOperationId = stableId(input.setupOperationId, 'Setup operation ID')
  const resolutionOperationId = stableId(input.resolutionOperationId, 'Resolution operation ID')
  const destinationSetId = stableId(input.destinationSetId, 'Destination set ID')
  let group: MoveSemiInvulnerableSetupGroup
  try {
    group = moveSemiInvulnerableSetupGroup(
      input.context.map.encounterState?.effects ?? [],
      setupOperationId,
    )
  }
  catch (error) {
    if (error instanceof MoveSemiInvulnerableSetupError) {
      return fail('setup-group-not-found', `Setup ${setupOperationId} is not active.`)
    }
    throw error
  }
  if (input.context.actor.placement.id !== group.actorPlacementId) {
    return fail(
      'actor-mismatch',
      `Setup ${setupOperationId} belongs to ${group.actorPlacementId}, not ${input.context.actor.placement.id}.`,
    )
  }
  const rawChoice = input.choices.resolve({
    setupOperationId,
    resolutionOperationId,
    destinationSetId,
    familyId: group.definition.familyId,
    actorPlacementId: group.actorPlacementId,
  })
  if (!rawChoice) return fail('choice-unavailable', 'Resolve-phase destination option is unavailable.')
  if (!validAnchor(rawChoice.destination)) {
    return fail('choice-invalid', 'Resolve-phase destination is not a safe grid anchor.')
  }
  if (
    rawChoice.targetPlacementId !== null
    && (typeof rawChoice.targetPlacementId !== 'string' || !rawChoice.targetPlacementId.trim())
  ) {
    return fail('choice-invalid', 'Resolve-phase target placement ID is invalid.')
  }
  const destination = cloneAnchor(rawChoice.destination)
  const targetPlacementId = validateResolutionTarget({
    context: input.context,
    group,
    targetPlacementId: rawChoice.targetPlacementId,
    destination,
  })

  let movements: readonly MoveSemiInvulnerableResolvedMovement[]
  if (group.definition.resolutionMovement.kind === 'appear-adjacent') {
    movements = [appearMovement({
      context: input.context,
      group,
      resolutionOperationId,
      destinationSetId,
      destination,
    })]
  }
  else if (group.definition.resolutionMovement.kind === 'lower-carried-pair') {
    movements = carriedPairMovements({
      context: input.context,
      group,
      resolutionOperationId,
      destination,
    })
  }
  else {
    movements = [deepFreeze({
      ...movementFromOracle({ context: input.context, group, destination }),
      resolutionOperationId,
    })]
  }

  const cleanupEvents = createMoveSemiInvulnerableCleanupEvents({
    effects: input.context.map.encounterState?.effects ?? [],
    setupOperationId,
    sourceOperationId: resolutionOperationId,
    reasonCode: 'semi-invulnerable.resolved',
  })
  return deepFreeze({
    setupOperationId,
    resolutionOperationId,
    canonicalMoveId: group.definition.canonicalId,
    actorPlacementId: group.actorPlacementId,
    targetPlacementId,
    movements,
    cleanupEvents,
    sheetReads: input.context.reads.snapshot(),
  })
}
