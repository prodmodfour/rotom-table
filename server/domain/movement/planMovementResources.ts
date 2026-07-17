import type { MoveSpecCostDeclaration } from '#shared/moveAutomation/spec'
import type { TabletopMap } from '~/types/map'
import {
  planEncounterMoveResourceCosts,
  type PlannedMoveResourceObservation,
} from '../moveAutomation/planMoveResources'
import type { AuthoritativeMovementSuccess } from './resolveMovement'

/** Reviewed normal-movement policy; browser payloads cannot replace these costs. */
const STANDARD_MOVEMENT_RESOURCE_COSTS: readonly MoveSpecCostDeclaration[] = Object.freeze([
  Object.freeze({
    id: 'movement.cost.shift-action',
    phase: 'pay' as const,
    cost: Object.freeze({
      kind: 'action-resource' as const,
      resource: 'shift' as const,
      amount: 1,
    }),
  }),
  Object.freeze({
    id: 'movement.cost.distance',
    phase: 'movement' as const,
    cost: Object.freeze({
      kind: 'movement-distance' as const,
      amount: 'resolved-distance' as const,
    }),
  }),
])

/** Explicit server-reviewed exception for authorized GM repositioning. */
const GM_OVERRIDE_MOVEMENT_RESOURCE_COSTS: readonly MoveSpecCostDeclaration[] = Object.freeze([
  Object.freeze({
    id: 'movement.cost.gm-override',
    phase: 'declare' as const,
    cost: Object.freeze({
      kind: 'no-cost' as const,
      reasonCode: 'movement.gm-override',
    }),
  }),
])

const costsForMovement = (
  movement: AuthoritativeMovementSuccess,
  options: {
    readonly spendAction: boolean
    readonly spendDistance: boolean
  },
): readonly MoveSpecCostDeclaration[] => {
  if (movement.policy.kind === 'gm-override') {
    return options.spendAction ? GM_OVERRIDE_MOVEMENT_RESOURCE_COSTS : []
  }
  return STANDARD_MOVEMENT_RESOURCE_COSTS.filter(declaration => (
    declaration.cost.kind === 'movement-distance'
      ? options.spendDistance
      : options.spendAction
  ))
}

/**
 * Plan the action and exact distance consumed by one successful MA-120 oracle
 * result. The source operation identifies the durable command; no client path,
 * distance, budget, action type, or exception reaches this boundary.
 */
export const planAuthoritativeMovementResources = (input: {
  readonly map: TabletopMap
  readonly movement: AuthoritativeMovementSuccess
  readonly sourceOperationId: string
  /** Server-derived segment distance; omitted means the complete oracle path. */
  readonly distance?: number
  /** Initial movement pays its action once; resumed segments explicitly skip it. */
  readonly spendAction?: boolean
}): PlannedMoveResourceObservation => {
  const distance = input.distance ?? input.movement.cost
  if (!Number.isSafeInteger(distance) || distance < 0 || distance > input.movement.cost) {
    throw new Error('Authoritative movement segment distance must be within the resolved path cost.')
  }
  const spendAction = input.spendAction ?? true
  return planEncounterMoveResourceCosts({
    map: input.map,
    placementId: input.movement.placementId,
    canonicalMoveId: 'Shift Movement',
    moveKey: 'shift-movement',
    range: 'Shift Action',
    resolutionId: input.sourceOperationId,
    sourceOperationId: input.sourceOperationId,
    movement: {
      distance,
      budget: input.movement.capabilityLimit,
    },
    reviewedCosts: costsForMovement(input.movement, {
      spendAction,
      spendDistance: distance > 0,
    }),
    allowLegacyFallback: false,
  })
}
