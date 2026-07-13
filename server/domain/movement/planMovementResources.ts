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
): readonly MoveSpecCostDeclaration[] => movement.policy.kind === 'gm-override'
  ? GM_OVERRIDE_MOVEMENT_RESOURCE_COSTS
  : STANDARD_MOVEMENT_RESOURCE_COSTS

/**
 * Plan the action and exact distance consumed by one successful MA-120 oracle
 * result. The source operation identifies the durable command; no client path,
 * distance, budget, action type, or exception reaches this boundary.
 */
export const planAuthoritativeMovementResources = (input: {
  readonly map: TabletopMap
  readonly movement: AuthoritativeMovementSuccess
  readonly sourceOperationId: string
}): PlannedMoveResourceObservation => planEncounterMoveResourceCosts({
  map: input.map,
  placementId: input.movement.placementId,
  canonicalMoveId: 'Shift Movement',
  moveKey: 'shift-movement',
  range: 'Shift Action',
  resolutionId: input.sourceOperationId,
  sourceOperationId: input.sourceOperationId,
  movement: {
    distance: input.movement.cost,
    budget: input.movement.capabilityLimit,
  },
  reviewedCosts: costsForMovement(input.movement),
  allowLegacyFallback: false,
})
