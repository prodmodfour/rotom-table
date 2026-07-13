import {
  MOVE_EFFECT_MOVEMENT_CARDINAL_DIRECTIONS,
  MOVE_EFFECT_MOVEMENT_OPPORTUNITY_ATTACK_POLICIES,
  MOVE_EFFECT_OPERATION_LIMITS,
  type MoveContextualMovementDistance,
  type MoveEffectMovementMode,
  type MoveEffectMovementOpportunityAttackPolicy,
  type MoveMovementDisplacement,
  type MoveMovementDistance,
  type MoveMovementRequestEffectOperation,
  type MoveMovementVector,
} from '#shared/moveAutomation/effects'
import type { MoveResolutionTraceJsonValue } from '#shared/moveAutomation/trace'
import {
  MOVE_AUTOMATION_AREA_DIRECTIONS,
  type MoveAutomationAreaDirection,
} from '~/types/moveAutomation'
import type { GridAnchor } from '~/types/map'
import { getClearanceValue } from '~/utils/gridGeometry'
import { moveAutomationAreaDirectionVector } from '~/utils/moveAutomationDirections'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'
import type {
  AuthoritativeMoveRulesContext,
  AuthoritativeMoveSheetRead,
} from '../context'
import {
  evaluateMoveExpression,
  evaluateMoveSelector,
  type MoveRuleEvaluationTraceEntry,
  type MoveRuleSelectorState,
} from '../evaluateExpression'
import type { MoveSpecEmittedOperation } from '../executeSpec'
import {
  canonicalMoveEffectPlacementIds,
  expectedMoveEffectRecipientIds,
  moveEffectRecipientIdsEqual,
  resolveMoveEffectDynamicRecipients,
  type MoveEffectDynamicRecipientSets,
  type ResolvedMoveEffectDynamicRecipients,
} from './effectRecipients'

export const MOVE_SPATIAL_SHORTENING_REASONS = [
  'none',
  'grid-distance-quantized',
] as const

export type MoveSpatialShorteningReason =
  (typeof MOVE_SPATIAL_SHORTENING_REASONS)[number]

export type MoveSpatialEffectReductionErrorCode =
  | 'unsupported-operation'
  | 'duplicate-operation-id'
  | 'invalid-displacement'
  | 'recipient-set-mismatch'
  | 'recipient-not-found'
  | 'source-not-found'
  | 'source-ambiguous'
  | 'vector-unavailable'
  | 'chosen-direction-unavailable'
  | 'distance-invalid'
  | 'distance-evaluation-failed'

export class MoveSpatialEffectReductionError extends Error {
  readonly code: MoveSpatialEffectReductionErrorCode

  constructor(code: MoveSpatialEffectReductionErrorCode, message: string) {
    super(message)
    this.name = 'MoveSpatialEffectReductionError'
    this.code = code
  }
}

export type MoveSpatialEffectOperation = MoveMovementRequestEffectOperation & {
  readonly payload: MoveMovementRequestEffectOperation['payload'] & {
    readonly mode: Extract<MoveEffectMovementMode, 'forced' | 'voluntary'>
    readonly distance: MoveMovementDistance
    readonly displacement: MoveMovementDisplacement
  }
}

export interface MoveResolvedSpatialEffectOperation
  extends Omit<MoveSpecEmittedOperation, 'operation'> {
  readonly operation: MoveSpatialEffectOperation
}

export interface ResolveMoveSpatialChosenDirectionInput {
  readonly operationId: string
  readonly directionSetId: string
  readonly recipientPlacementId: string
}

/** Server-owned durable choice lookup; no direction is read from move intent. */
export interface MoveSpatialChosenDirectionResolver {
  resolve(input: ResolveMoveSpatialChosenDirectionInput): MoveAutomationAreaDirection | null
}

export interface MoveSpatialVectorResolution {
  readonly kind: MoveMovementVector['kind']
  readonly x: -1 | 0 | 1
  readonly y: -1 | 0 | 1
  readonly z: -1 | 0 | 1
  readonly sourcePlacementId: string | null
  readonly direction: MoveAutomationAreaDirection | null
}

export interface MoveSpatialDistanceResolution {
  readonly rawValue: number
  /** Rounded and clamped server-owned requested distance. */
  readonly value: number
  readonly minimum: number
  readonly maximum: number
  readonly rounding: MoveContextualMovementDistance['rounding'] | null
  readonly trace: readonly MoveRuleEvaluationTraceEntry[]
}

export interface MoveSpatialMovement {
  readonly operationId: string
  readonly recipientPlacementId: string
  readonly mode: Extract<MoveEffectMovementMode, 'forced' | 'voluntary'>
  readonly opportunityAttackPolicy: MoveEffectMovementOpportunityAttackPolicy
  readonly provokesOpportunityAttacks: boolean
  readonly vector: MoveSpatialVectorResolution
  readonly distance: MoveSpatialDistanceResolution
  readonly origin: GridAnchor
  readonly destination: GridAnchor
  /** Collision-independent straight ray, including origin and destination. */
  readonly path: readonly GridAnchor[]
  readonly resolvedDistance: number
  readonly shortened: boolean
  readonly shorteningReason: MoveSpatialShorteningReason
}

export interface MoveSpatialEffectOperationResult {
  readonly operationId: string
  readonly recipientIds: readonly string[]
  readonly outcome: 'applied' | 'no-op'
  readonly movements: readonly MoveSpatialMovement[]
  readonly details: MoveResolutionTraceJsonValue
}

export interface MoveSpatialEffectReduction {
  readonly movements: readonly MoveSpatialMovement[]
  readonly operationResults: readonly MoveSpatialEffectOperationResult[]
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
}

export interface ReduceMoveSpatialEffectsInput {
  readonly context: AuthoritativeMoveRulesContext
  readonly operations: readonly MoveResolvedSpatialEffectOperation[]
  readonly dynamicRecipients: MoveEffectDynamicRecipientSets
  readonly chosenDirections?: MoveSpatialChosenDirectionResolver
}

interface SpatialFootprint {
  readonly placementId: string
  readonly position: GridAnchor
  readonly base: number
  readonly clearance: number
}

const MOVEMENT_DIRECTION_SET = new Set<string>(MOVE_AUTOMATION_AREA_DIRECTIONS)
const CARDINAL_DIRECTION_SET = new Set<string>(MOVE_EFFECT_MOVEMENT_CARDINAL_DIRECTIONS)
const OPPORTUNITY_ATTACK_POLICY_SET = new Set<string>(
  MOVE_EFFECT_MOVEMENT_OPPORTUNITY_ATTACK_POLICIES,
)

const fail = (
  code: MoveSpatialEffectReductionErrorCode,
  message: string,
): never => {
  throw new MoveSpatialEffectReductionError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const cloneAnchor = (anchor: GridAnchor): GridAnchor => ({
  x: anchor.x,
  y: anchor.y,
  z: anchor.z,
})

const recipientFailure = (
  code: 'invalid-recipient-set' | 'recipient-not-found',
  message: string,
): never => fail(
  code === 'recipient-not-found' ? 'recipient-not-found' : 'recipient-set-mismatch',
  message,
)

const assertSpatialOperation = (
  operation: MoveSpatialEffectOperation,
): void => {
  const { payload } = operation
  if (
    operation.kind !== 'movement-request'
    || operation.phase !== 'movement'
    || (payload.mode !== 'forced' && payload.mode !== 'voluntary')
    || payload.distance === null
    || payload.destinationSetId !== null
    || !payload.displacement
    || payload.choice !== undefined
  ) {
    fail(
      'invalid-displacement',
      `Operation ${operation.id} is not a reviewed movement-phase displacement.`,
    )
  }
  if (!OPPORTUNITY_ATTACK_POLICY_SET.has(payload.displacement.opportunityAttacks)) {
    fail(
      'invalid-displacement',
      `Operation ${operation.id} has an unsupported opportunity-attack policy.`,
    )
  }
}

const selectorStateFor = (
  recipientId: string,
  dynamic: ResolvedMoveEffectDynamicRecipients,
): MoveRuleSelectorState => ({
  targetIds: [recipientId],
  hitTargetIds: dynamic['hit-targets'].includes(recipientId) ? [recipientId] : [],
  missedTargetIds: dynamic['missed-targets'].includes(recipientId) ? [recipientId] : [],
  damagedTargetIds: dynamic['damaged-targets'].includes(recipientId) ? [recipientId] : [],
  faintedTargetIds: dynamic['fainted-targets'].includes(recipientId) ? [recipientId] : [],
})

const spatialFootprint = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
  role: 'recipient' | 'source',
): SpatialFootprint => {
  const placement = context.queries.placements.get(placementId)
  const token = context.queries.tokens.get(placementId)
  if (!placement || !token) {
    return fail(
      role === 'source' ? 'source-not-found' : 'recipient-not-found',
      `Spatial ${role} placement ${placementId} has no authoritative footprint.`,
    )
  }
  if (
    !Number.isSafeInteger(token.base)
    || token.base < 1
    || !Number.isSafeInteger(getClearanceValue(token))
    || getClearanceValue(token) < 1
  ) {
    return fail(
      'vector-unavailable',
      `Spatial ${role} placement ${placementId} has malformed footprint geometry.`,
    )
  }
  context.reads.recordPlacement(placement)
  return {
    placementId,
    position: cloneAnchor(token.position),
    base: token.base,
    clearance: getClearanceValue(token),
  }
}

const separatedAxisDirection = (
  sourceStart: number,
  sourceExtent: number,
  recipientStart: number,
  recipientExtent: number,
): -1 | 0 | 1 => {
  if (recipientStart >= sourceStart + sourceExtent) return 1
  if (recipientStart + recipientExtent <= sourceStart) return -1
  return 0
}

/**
 * Resolve the shortest outward unit ray from complete half-open footprints.
 * Overlap on an axis contributes zero, avoiding center-based diagonal drift
 * when differently sized combatants share rows or columns.
 */
export const deriveMoveSpatialAwayVector = (input: {
  readonly source: SpatialFootprint
  readonly recipient: SpatialFootprint
}): Pick<MoveSpatialVectorResolution, 'x' | 'y' | 'z'> | null => {
  const vector = {
    x: separatedAxisDirection(
      input.source.position.x,
      input.source.base,
      input.recipient.position.x,
      input.recipient.base,
    ),
    y: separatedAxisDirection(
      input.source.position.y,
      input.source.clearance,
      input.recipient.position.y,
      input.recipient.clearance,
    ),
    z: separatedAxisDirection(
      input.source.position.z,
      input.source.base,
      input.recipient.position.z,
      input.recipient.base,
    ),
  }
  return vector.x === 0 && vector.y === 0 && vector.z === 0 ? null : vector
}

const sourcePlacementId = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveSpatialEffectOperation
  readonly recipientId: string
  readonly vector: Extract<MoveMovementVector, { readonly kind: 'away' | 'toward' }>
  readonly selectorState: MoveRuleSelectorState
}): string => {
  const sourceIds = evaluateMoveSelector({
    selector: input.vector.source,
    context: input.context,
    selectorState: input.selectorState,
  })
  if (sourceIds.length === 0) {
    return fail(
      'source-not-found',
      `Spatial operation ${input.operation.id} resolved no source for ${input.recipientId}.`,
    )
  }
  if (sourceIds.length !== 1) {
    return fail(
      'source-ambiguous',
      `Spatial operation ${input.operation.id} resolved ${sourceIds.length} sources for ${input.recipientId}.`,
    )
  }
  return sourceIds[0]!
}

const directionVector = (
  direction: MoveAutomationAreaDirection,
  operationId: string,
): Pick<MoveSpatialVectorResolution, 'x' | 'y' | 'z'> => {
  const vector = moveAutomationAreaDirectionVector(direction)
  if (!vector) {
    return fail(
      'vector-unavailable',
      `Spatial operation ${operationId} resolved unsupported direction ${direction}.`,
    )
  }
  return vector
}

const resolveSpatialVector = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveSpatialEffectOperation
  readonly recipient: SpatialFootprint
  readonly selectorState: MoveRuleSelectorState
  readonly chosenDirections?: MoveSpatialChosenDirectionResolver
}): MoveSpatialVectorResolution => {
  const declaration = input.operation.payload.displacement.vector
  if (declaration.kind === 'away' || declaration.kind === 'toward') {
    const sourceId = sourcePlacementId({
      context: input.context,
      operation: input.operation,
      recipientId: input.recipient.placementId,
      vector: declaration,
      selectorState: input.selectorState,
    })
    const source = spatialFootprint(input.context, sourceId, 'source')
    const away = deriveMoveSpatialAwayVector({ source, recipient: input.recipient })
      ?? fail(
        'vector-unavailable',
        `Spatial operation ${input.operation.id} cannot derive a relative vector from overlapping footprints ${sourceId} and ${input.recipient.placementId}.`,
      )
    const multiplier = declaration.kind === 'toward' ? -1 : 1
    const scaled = (value: -1 | 0 | 1): -1 | 0 | 1 => (
      value === 0 ? 0 : (value * multiplier) as -1 | 1
    )
    return {
      kind: declaration.kind,
      x: scaled(away.x),
      y: scaled(away.y),
      z: scaled(away.z),
      sourcePlacementId: sourceId,
      direction: null,
    }
  }

  if (declaration.kind === 'chosen') {
    const direction = input.chosenDirections?.resolve({
      operationId: input.operation.id,
      directionSetId: declaration.directionSetId,
      recipientPlacementId: input.recipient.placementId,
    }) ?? null
    if (!direction || !MOVEMENT_DIRECTION_SET.has(direction)) {
      return fail(
        'chosen-direction-unavailable',
        `Spatial operation ${input.operation.id} has no server-owned chosen direction for ${input.recipient.placementId}.`,
      )
    }
    return {
      kind: declaration.kind,
      ...directionVector(direction, input.operation.id),
      sourcePlacementId: null,
      direction,
    }
  }

  if (declaration.kind !== 'cardinal') {
    return fail(
      'vector-unavailable',
      `Spatial operation ${input.operation.id} has an unsupported vector declaration.`,
    )
  }
  if (!CARDINAL_DIRECTION_SET.has(declaration.direction)) {
    return fail(
      'vector-unavailable',
      `Spatial operation ${input.operation.id} has non-cardinal direction ${declaration.direction}.`,
    )
  }
  return {
    kind: declaration.kind,
    ...directionVector(declaration.direction, input.operation.id),
    sourcePlacementId: null,
    direction: declaration.direction,
  }
}

const roundedDistance = (
  value: number,
  rounding: MoveContextualMovementDistance['rounding'],
): number => {
  if (rounding === 'floor') return Math.floor(value)
  if (rounding === 'ceil') return Math.ceil(value)
  return Math.round(value)
}

const assertStaticDistance = (value: number, operationId: string): number => {
  if (
    !Number.isSafeInteger(value)
    || value < 0
    || value > MOVE_EFFECT_OPERATION_LIMITS.movementDisplacementDistance
  ) {
    return fail(
      'distance-invalid',
      `Spatial operation ${operationId} distance must be a safe integer from 0 through ${MOVE_EFFECT_OPERATION_LIMITS.movementDisplacementDistance}.`,
    )
  }
  return value
}

const resolveSpatialDistance = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveSpatialEffectOperation
  readonly selectorState: MoveRuleSelectorState
}): MoveSpatialDistanceResolution => {
  const declaration = input.operation.payload.distance
  if (typeof declaration === 'number') {
    const value = assertStaticDistance(declaration, input.operation.id)
    return {
      rawValue: value,
      value,
      minimum: value,
      maximum: value,
      rounding: null,
      trace: [],
    }
  }

  let evaluated: ReturnType<typeof evaluateMoveExpression>
  try {
    evaluated = evaluateMoveExpression({
      expression: declaration.expression,
      context: input.context,
      selectorState: input.selectorState,
      numericPolicy: 'preserve',
      rootNodeId: `${input.operation.id}.distance`,
    })
  }
  catch (error) {
    return fail(
      'distance-evaluation-failed',
      `Spatial operation ${input.operation.id} distance evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (typeof evaluated.value !== 'number' || !Number.isFinite(evaluated.value)) {
    return fail(
      'distance-invalid',
      `Spatial operation ${input.operation.id} distance expression did not resolve to a finite number.`,
    )
  }
  if (
    !Number.isSafeInteger(declaration.minimum)
    || !Number.isSafeInteger(declaration.maximum)
    || declaration.minimum < 0
    || declaration.minimum > declaration.maximum
    || declaration.maximum > MOVE_EFFECT_OPERATION_LIMITS.movementDisplacementDistance
  ) {
    return fail(
      'distance-invalid',
      `Spatial operation ${input.operation.id} has invalid distance bounds.`,
    )
  }
  const rounded = roundedDistance(evaluated.value, declaration.rounding)
  const value = Math.min(declaration.maximum, Math.max(declaration.minimum, rounded))
  return {
    rawValue: evaluated.value,
    value: assertStaticDistance(value, input.operation.id),
    minimum: declaration.minimum,
    maximum: declaration.maximum,
    rounding: declaration.rounding,
    trace: evaluated.trace,
  }
}

const buildSpatialPath = (input: {
  readonly origin: GridAnchor
  readonly vector: Pick<MoveSpatialVectorResolution, 'x' | 'y' | 'z'>
  readonly requestedDistance: number
}): {
  readonly path: readonly GridAnchor[]
  readonly resolvedDistance: number
  readonly shorteningReason: MoveSpatialShorteningReason
} => {
  const path: GridAnchor[] = [cloneAnchor(input.origin)]
  let resolvedDistance = 0
  for (
    let step = 1;
    step <= MOVE_EFFECT_OPERATION_LIMITS.movementDisplacementDistance;
    step += 1
  ) {
    const distance = ptuGridVectorDistance({
      x: input.vector.x * step,
      y: input.vector.y * step,
      z: input.vector.z * step,
    })
    if (distance > input.requestedDistance) break
    path.push({
      x: input.origin.x + input.vector.x * step,
      y: input.origin.y + input.vector.y * step,
      z: input.origin.z + input.vector.z * step,
    })
    resolvedDistance = distance
  }
  return {
    path,
    resolvedDistance,
    shorteningReason: resolvedDistance < input.requestedDistance
      ? 'grid-distance-quantized'
      : 'none',
  }
}

const resolveMovement = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveSpatialEffectOperation
  readonly recipientId: string
  readonly dynamic: ResolvedMoveEffectDynamicRecipients
  readonly chosenDirections?: MoveSpatialChosenDirectionResolver
}): MoveSpatialMovement => {
  const recipient = spatialFootprint(input.context, input.recipientId, 'recipient')
  const selectorState = selectorStateFor(input.recipientId, input.dynamic)
  const vector = resolveSpatialVector({
    context: input.context,
    operation: input.operation,
    recipient,
    selectorState,
    chosenDirections: input.chosenDirections,
  })
  const distance = resolveSpatialDistance({
    context: input.context,
    operation: input.operation,
    selectorState,
  })
  const path = buildSpatialPath({
    origin: recipient.position,
    vector,
    requestedDistance: distance.value,
  })
  const destination = path.path.at(-1) ?? recipient.position
  const opportunityAttackPolicy = input.operation.payload.displacement.opportunityAttacks
  return {
    operationId: input.operation.id,
    recipientPlacementId: input.recipientId,
    mode: input.operation.payload.mode,
    opportunityAttackPolicy,
    provokesOpportunityAttacks: opportunityAttackPolicy === 'provoke',
    vector,
    distance,
    origin: cloneAnchor(recipient.position),
    destination: cloneAnchor(destination),
    path: path.path.map(cloneAnchor),
    resolvedDistance: path.resolvedDistance,
    shortened: path.resolvedDistance < distance.value,
    shorteningReason: path.shorteningReason,
  }
}

/**
 * Reduce reviewed spatial operations into immutable collision-independent rays.
 * This boundary does not mutate placements. Bounds, obstruction, occupancy,
 * height transitions, and persistence remain the movement oracle's concern.
 */
export const reduceMoveSpatialEffects = (
  input: ReduceMoveSpatialEffectsInput,
): MoveSpatialEffectReduction => {
  const dynamic = resolveMoveEffectDynamicRecipients(
    input.context,
    input.dynamicRecipients,
    recipientFailure,
  )
  const operationIds = new Set<string>()
  const movements: MoveSpatialMovement[] = []
  const operationResults: MoveSpatialEffectOperationResult[] = []

  for (const emission of input.operations) {
    const { operation } = emission
    assertSpatialOperation(operation)
    if (operationIds.has(operation.id)) {
      fail('duplicate-operation-id', `Spatial operation ${operation.id} is duplicated.`)
    }
    operationIds.add(operation.id)

    const expectedIds = expectedMoveEffectRecipientIds(
      input.context,
      operation,
      dynamic,
      recipientFailure,
    )
    const emittedIds = canonicalMoveEffectPlacementIds(
      input.context,
      emission.recipientIds,
      `spatial operation ${operation.id} recipients`,
      recipientFailure,
    )
    if (
      !moveEffectRecipientIdsEqual(emission.recipientIds, emittedIds)
      || !moveEffectRecipientIdsEqual(emittedIds, expectedIds)
    ) {
      fail(
        'recipient-set-mismatch',
        `Spatial operation ${operation.id} recipients do not match selector ${operation.recipients.kind}.`,
      )
    }

    const resolved = expectedIds.map(recipientId => resolveMovement({
      context: input.context,
      operation,
      recipientId,
      dynamic,
      chosenDirections: input.chosenDirections,
    }))
    movements.push(...resolved)
    operationResults.push({
      operationId: operation.id,
      recipientIds: [...expectedIds],
      outcome: resolved.some(movement => movement.resolvedDistance > 0)
        ? 'applied'
        : 'no-op',
      movements: resolved,
      details: {
        mode: operation.payload.mode,
        opportunityAttackPolicy: operation.payload.displacement.opportunityAttacks,
        movementCount: resolved.length,
        movedCount: resolved.filter(movement => movement.resolvedDistance > 0).length,
      },
    })
  }

  return deepFreeze({
    movements,
    operationResults,
    sheetReads: input.context.reads.snapshot(),
  })
}

export const isMoveSpatialEffectEmission = (
  value: MoveSpecEmittedOperation,
): value is MoveResolvedSpatialEffectOperation => (
  value.operation.kind === 'movement-request'
  && value.operation.payload.displacement !== undefined
)
