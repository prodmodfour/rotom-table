import type { MoveSpecCostDeclaration } from '#shared/moveAutomation/spec'
import { AA069_FADE_AWAY_SHIFT_MARK } from '#shared/abilityAutomation/aa069'
import { parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'
import {
  planEncounterMoveResourceCosts,
  type PlannedMoveResourceObservation,
} from '../moveAutomation/planMoveResources'
import type { AuthoritativeMovementSuccess } from './resolveMovement'
import { reduceAbilityOwnedStateCommand } from '../abilityAutomation/ownedState'

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
  const fadeAwayOwnedShift = spendAction && input.movement.policy.kind === 'standard'
    ? input.map.encounterState?.abilityOwnedState?.entries.find(entry => (
        entry.ownerPlacementId === input.movement.placementId
        && entry.canonicalId === 'Fade Away'
        && entry.payload.kind === 'mark'
        && entry.payload.markId === AA069_FADE_AWAY_SHIFT_MARK
      )) ?? null
    : null
  const fadeAwayEffectShift = spendAction && input.movement.policy.kind === 'standard'
    ? input.map.encounterState?.effects.find(effect => (
        effect.kind === 'capability'
        && effect.payload.capabilityId === AA069_FADE_AWAY_SHIFT_MARK
        && effect.affected.placementIds.includes(input.movement.placementId)
      )) ?? null
    : null
  const fadeAwayShift = fadeAwayOwnedShift ?? fadeAwayEffectShift
  const planned = planEncounterMoveResourceCosts({
    map: input.map,
    placementId: input.movement.placementId,
    canonicalMoveId: 'Shift Movement',
    moveKey: 'shift-movement',
    range: fadeAwayShift ? 'Fade Away Free Shift' : 'Shift Action',
    resolutionId: input.sourceOperationId,
    sourceOperationId: input.sourceOperationId,
    movement: {
      distance,
      budget: input.movement.capabilityLimit,
    },
    reviewedCosts: costsForMovement(input.movement, {
      spendAction: spendAction && !fadeAwayShift,
      spendDistance: distance > 0,
    }),
    allowLegacyFallback: false,
    markActedSinceEntry: spendAction && !fadeAwayShift && input.movement.policy.kind === 'standard',
  })
  if (!fadeAwayShift) return planned
  const abilityOwnedState = fadeAwayOwnedShift
    ? reduceAbilityOwnedStateCommand(planned.currentEncounterState.abilityOwnedState, {
        operationId: `${input.sourceOperationId}:fade-away-shift`,
        kind: 'remove',
        stateId: fadeAwayOwnedShift.stateId,
        expectedVersion: fadeAwayOwnedShift.version,
      }).state
    : planned.currentEncounterState.abilityOwnedState
  const effects = fadeAwayEffectShift
    ? planned.currentEncounterState.effects.filter(effect => effect.id !== fadeAwayEffectShift.id)
    : planned.currentEncounterState.effects
  const currentEncounterState = parseEncounterState({
    ...planned.currentEncounterState,
    abilityOwnedState,
    effects,
  })
  return Object.freeze({
    ...planned,
    currentEncounterState,
    nextMap: { ...planned.nextMap, encounterState: currentEncounterState },
    changed: true,
  })
}
