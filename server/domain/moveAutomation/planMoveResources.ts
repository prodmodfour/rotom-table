import {
  MOVE_SPEC_PHASES,
  type MoveSpecCostDeclaration,
  type MoveSpecPhase,
} from '#shared/moveAutomation/spec'
import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterActionType,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { AuthoritativeMoveResolution } from '../resolveAuthoritativeMove'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import {
  spendEncounterMoveResourceCosts,
  type EncounterMoveResourceCostSpend,
} from './reduceEncounterResources'

export interface PlannedMoveResourceObservation {
  readonly previousEncounterState: EncounterState
  readonly currentEncounterState: EncounterState
  readonly nextMap: TabletopMap
  readonly changed: boolean
  readonly actionType: EncounterActionType
  readonly consumesReaction: boolean
  readonly movementBudget: number | null
  readonly movementSpent: number
  readonly oncePerTurnFlagId: string | null
  readonly costs: readonly MoveSpecCostDeclaration[]
  readonly spends: readonly EncounterMoveResourceCostSpend[]
}

export interface MoveResourceCostPhaseWindow {
  readonly minimumPhaseExclusive?: MoveSpecPhase | null
  readonly maximumPhaseInclusive?: MoveSpecPhase | null
}

export interface PlanEncounterMoveResourceCostsInput extends MoveResourceCostPhaseWindow {
  readonly map: TabletopMap
  readonly actor: SpawnedPokemon
  readonly actorPlacementId: string
  readonly canonicalMoveId: string
  readonly moveKey: string
  readonly range: string
  readonly sourceOperationId: string
  readonly resolutionId: string
  readonly movementDistance: number
  /** Prefer the movement oracle's effective/capability limit when available. */
  readonly movementBudget?: number | null
  /** Non-empty MoveSpec costs replace legacy range inference. */
  readonly reviewedCosts?: readonly MoveSpecCostDeclaration[]
  /** Pending declarations use reviewed costs only and disable compatibility inference. */
  readonly allowLegacyFallback?: boolean
}

const PHASE_INDEX = new Map<MoveSpecPhase, number>(
  MOVE_SPEC_PHASES.map((phase, index) => [phase, index]),
)

export const actionTypeFromMoveRange = (range: string): EncounterActionType => {
  if (/\bFull Action\b/i.test(range)) return 'full'
  if (/\bSwift Action\b/i.test(range)) return 'swift'
  if (/\bShift Action\b/i.test(range)) return 'shift'
  if (/\bFree Action\b/i.test(range)) return 'free'
  if (/\bReaction\b/i.test(range)) return 'reaction'
  if (/\bInterrupt\b/i.test(range)) return 'interrupt'
  return 'standard'
}

const priorityModeFromMoveRange = (
  range: string,
): Extract<MoveSpecCostDeclaration['cost'], { readonly kind: 'priority' }>['mode'] | null => {
  if (/\bPriority\s*\(Advanced\)/i.test(range)) return 'advanced'
  if (/\bPriority\s*\(Limited\)/i.test(range)) return 'limited'
  return /\bPriority\b/i.test(range) ? 'standard' : null
}

const usesReactionTiming = (range: string): boolean => (
  /\b(?:Interrupt|Reaction)\b/i.test(range)
)

const boundedMovementBudget = (token: SpawnedPokemon): number | null => {
  const speeds = Object.values(token.movementCapabilities ?? {})
    .filter((value): value is number => (
      typeof value === 'number'
      && Number.isSafeInteger(value)
      && value >= 0
    ))
  return speeds.length === 0 ? null : Math.max(...speeds)
}

const movementSpent = (resolution: AuthoritativeMoveResolution): number => {
  if (resolution.resourceMovementCost !== undefined) {
    return resolution.resourceMovementCost
  }
  const movement = resolution.movement
  if (!movement) return 0
  return ptuGridVectorDistance({
    x: movement.destination.x - movement.from.x,
    y: movement.destination.y - movement.from.y,
    z: movement.destination.z - movement.from.z,
  })
}

const resourceTurn = (
  state: EncounterState,
  actorPlacementId: string,
): number | null => state.history.currentTurn?.placementId === actorPlacementId
  ? state.history.currentTurn.turn
  : null

const inferredMoveResourceCosts = (input: {
  readonly range: string
  readonly moveKey: string
  readonly movementDistance: number
  readonly setupStep: 'set-up' | 'execute'
}): readonly MoveSpecCostDeclaration[] => {
  const actionType = actionTypeFromMoveRange(input.range)
  const costs: MoveSpecCostDeclaration[] = [{
    id: 'legacy.cost.action',
    phase: 'pay',
    cost: { kind: 'action-resource', resource: actionType, amount: 1 },
  }]

  if (
    input.movementDistance > 0
    && actionType !== 'shift'
    && actionType !== 'full'
  ) {
    costs.push({
      id: 'legacy.cost.pass-shift',
      phase: 'movement',
      cost: { kind: 'action-resource', resource: 'shift', amount: 1 },
    })
  }
  if (input.movementDistance > 0) {
    costs.push({
      id: 'legacy.cost.movement',
      phase: 'movement',
      cost: { kind: 'movement-distance', amount: 'resolved-distance' },
    })
  }

  const priorityMode = priorityModeFromMoveRange(input.range)
  if (priorityMode !== null) {
    costs.unshift({
      id: 'legacy.cost.priority',
      phase: 'declare',
      cost: { kind: 'priority', mode: priorityMode },
    })
  }
  if (/\bExhaust\b/i.test(input.range)) {
    costs.push({
      id: 'legacy.cost.exhaust',
      phase: 'cleanup',
      cost: { kind: 'exhaust', timing: 'next-turn', forfeitCommand: true },
    })
  }
  if (/\bSet-Up\b/i.test(input.range)) {
    costs.push({
      id: 'legacy.cost.setup-execute',
      phase: input.setupStep === 'set-up' ? 'schedule' : 'declare',
      cost: { kind: 'setup-execute', step: input.setupStep },
    })
  }
  return costs
}

export const moveResourceCostsInPhaseWindow = (
  costs: readonly MoveSpecCostDeclaration[],
  window: MoveResourceCostPhaseWindow = {},
): readonly MoveSpecCostDeclaration[] => {
  const minimum = window.minimumPhaseExclusive === undefined
    || window.minimumPhaseExclusive === null
    ? -1
    : PHASE_INDEX.get(window.minimumPhaseExclusive) ?? -1
  const maximum = window.maximumPhaseInclusive === undefined
    || window.maximumPhaseInclusive === null
    ? MOVE_SPEC_PHASES.length - 1
    : PHASE_INDEX.get(window.maximumPhaseInclusive) ?? -1
  return costs.filter(({ phase }) => {
    const index = PHASE_INDEX.get(phase) ?? -1
    return index > minimum && index <= maximum
  })
}

const setupStep = (
  state: EncounterState,
  actorPlacementId: string,
  canonicalMoveId: string,
): 'set-up' | 'execute' => {
  const setup = state.turnResources[actorPlacementId]?.setupExecute
  return setup?.canonicalMoveId === canonicalMoveId && setup.status === 'ready-to-execute'
    ? 'execute'
    : 'set-up'
}

/**
 * Plan one exact authoritative resource spend without mutating map state.
 * Explicit MoveSpec declarations are authoritative; legacy range inference is
 * retained only for v1 and pre-cost native definitions.
 */
export const planEncounterMoveResourceCosts = (
  input: PlanEncounterMoveResourceCostsInput,
): PlannedMoveResourceObservation => {
  const previousEncounterState = parseEncounterState(
    input.map.encounterState ?? createEmptyEncounterState(),
  )
  const reviewed = input.reviewedCosts ?? []
  const useReviewed = reviewed.length > 0
  const allowLegacyFallback = input.allowLegacyFallback ?? true
  const allCosts = useReviewed
    ? reviewed
    : allowLegacyFallback
      ? inferredMoveResourceCosts({
          range: input.range,
          moveKey: input.moveKey,
          movementDistance: input.movementDistance,
          setupStep: setupStep(
            previousEncounterState,
            input.actorPlacementId,
            input.canonicalMoveId,
          ),
        })
      : []
  const costs = moveResourceCostsInPhaseWindow(allCosts, input)
  const budget = input.movementBudget === undefined
    ? boundedMovementBudget(input.actor)
    : input.movementBudget
  const compatibilityFlagId = !useReviewed && allowLegacyFallback && costs.length > 0
    ? `move.${input.moveKey}`
    : null

  if (costs.length === 0 && compatibilityFlagId === null) {
    return Object.freeze({
      previousEncounterState: deepCloneJson(previousEncounterState),
      currentEncounterState: deepCloneJson(previousEncounterState),
      nextMap: deepCloneJson(input.map),
      changed: false,
      actionType: 'free',
      consumesReaction: false,
      movementBudget: budget,
      movementSpent: 0,
      oncePerTurnFlagId: null,
      costs: [],
      spends: [],
    })
  }

  const spent = spendEncounterMoveResourceCosts(
    previousEncounterState.turnResources,
    {
      placementId: input.actorPlacementId,
      canonicalMoveId: input.canonicalMoveId,
      resolutionId: input.resolutionId,
      sourceOperationId: input.sourceOperationId,
      costs,
      movementBudget: budget,
      movementDistance: input.movementDistance,
      round: input.map.initiative?.round ?? null,
      turn: resourceTurn(previousEncounterState, input.actorPlacementId),
      actedThisRound: previousEncounterState.history.actedThisRoundPlacementIds.includes(
        input.actorPlacementId,
      ),
      compatibilityOncePerTurnFlagId: compatibilityFlagId,
    },
  )
  const currentEncounterState = parseEncounterState({
    ...previousEncounterState,
    turnResources: spent.resources,
  })
  const changed = !sameJsonValue(previousEncounterState, currentEncounterState)
  const actionCost = costs.find(({ cost }) => cost.kind === 'action-resource')
  const actionType = actionCost?.cost.kind === 'action-resource'
    ? actionCost.cost.resource
    : 'free'

  return Object.freeze({
    previousEncounterState: deepCloneJson(previousEncounterState),
    currentEncounterState: deepCloneJson(currentEncounterState),
    nextMap: changed
      ? {
          ...deepCloneJson(input.map),
          encounterState: deepCloneJson(currentEncounterState),
        }
      : deepCloneJson(input.map),
    changed,
    actionType,
    consumesReaction: costs.some(({ cost }) => (
      cost.kind === 'action-resource'
      && (cost.resource === 'interrupt' || cost.resource === 'reaction')
    )),
    movementBudget: budget,
    movementSpent: spent.spends
      .filter(entry => entry.kind === 'movement-distance')
      .reduce((total, entry) => total + entry.amount, 0),
    oncePerTurnFlagId: compatibilityFlagId,
    costs: deepCloneJson(costs),
    spends: deepCloneJson(spent.spends),
  })
}

/** Enforce and spend the costs for one completed authoritative move. */
export const planMoveResourceObservation = (input: {
  readonly map: TabletopMap
  readonly actor: SpawnedPokemon
  readonly resolution: AuthoritativeMoveResolution
  readonly sourceOperationId: string
  readonly reviewedCosts?: readonly MoveSpecCostDeclaration[]
  readonly minimumPhaseExclusive?: MoveSpecPhase | null
  readonly maximumPhaseInclusive?: MoveSpecPhase | null
  readonly allowLegacyFallback?: boolean
}): PlannedMoveResourceObservation => planEncounterMoveResourceCosts({
  map: input.map,
  actor: input.actor,
  actorPlacementId: input.resolution.actorPlacementId,
  canonicalMoveId: input.resolution.canonicalMoveName,
  moveKey: input.resolution.moveKey,
  range: input.resolution.script.range,
  sourceOperationId: input.sourceOperationId,
  resolutionId: input.sourceOperationId,
  movementDistance: movementSpent(input.resolution),
  reviewedCosts: input.reviewedCosts,
  minimumPhaseExclusive: input.minimumPhaseExclusive,
  maximumPhaseInclusive: input.maximumPhaseInclusive,
  allowLegacyFallback: input.allowLegacyFallback,
})
