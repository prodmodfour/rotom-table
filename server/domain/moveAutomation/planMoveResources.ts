import {
  MoveResourceCostValidationError,
  validateMoveResourceCostCombination,
} from '#shared/moveAutomation/resourceCosts'
import {
  MOVE_SPEC_PHASES,
  MoveSpecValidationError,
  parseMoveSpecCostDeclarations,
  type MoveSpecCostDeclaration,
  type MoveSpecPhase,
} from '#shared/moveAutomation/spec'
import {
  createEmptyEncounterState,
  parseEncounterState,
  parseEncounterTurnResources,
  type EncounterActionType,
  type EncounterState,
  type EncounterTurnResourceDirectory,
} from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { AuthoritativeMoveResolution } from '../resolveAuthoritativeMove'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import {
  EncounterResourceReductionError,
  observeEncounterMoveResources,
  spendEncounterMoveResourceCosts,
  type EncounterMoveResourceCostSpend,
} from './reduceEncounterResources'

export interface PlannedMoveResourceObservation {
  readonly previousEncounterState: EncounterState
  readonly currentEncounterState: EncounterState
  readonly nextMap: TabletopMap
  readonly actionType: EncounterActionType
  readonly consumesReaction: boolean
  readonly movementBudget: number | null
  readonly movementSpent: number
  readonly oncePerTurnFlagId: string
}

export interface MoveResourceCostPhaseWindow {
  readonly minimumPhaseExclusive?: MoveSpecPhase | null
  readonly maximumPhaseInclusive?: MoveSpecPhase | null
}

export interface PlanMoveResourceCostWindowInput extends MoveResourceCostPhaseWindow {
  readonly resources: EncounterTurnResourceDirectory
  readonly placementId: string
  readonly canonicalMoveId: string
  readonly resolutionId: string
  readonly sourceOperationId: string
  readonly declarations: readonly MoveSpecCostDeclaration[]
  /** Effective distance and budget supplied by the authoritative movement oracle. */
  readonly movementDistance: number
  readonly movementBudget: number | null
  readonly round: number | null
  readonly turn: number | null
  readonly actedThisRound: boolean
}

export interface PlannedMoveResourceCostWindow {
  readonly previousResources: EncounterTurnResourceDirectory
  readonly currentResources: EncounterTurnResourceDirectory
  readonly changed: boolean
  readonly costs: readonly MoveSpecCostDeclaration[]
  readonly spends: readonly EncounterMoveResourceCostSpend[]
}

const PHASE_INDEX = new Map<MoveSpecPhase, number>(
  MOVE_SPEC_PHASES.map((phase, index) => [phase, index]),
)

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const invalidCostPlan = (message: string): never => {
  throw new EncounterResourceReductionError('invalid-resource-cost', message)
}

export const actionTypeFromMoveRange = (range: string): EncounterActionType => {
  if (/\bFull Action\b/i.test(range)) return 'full'
  if (/\bSwift Action\b/i.test(range)) return 'swift'
  if (/\bShift Action\b/i.test(range)) return 'shift'
  if (/\bFree Action\b/i.test(range)) return 'free'
  if (/\bReaction\b/i.test(range)) return 'reaction'
  if (/\bInterrupt\b/i.test(range)) return 'interrupt'
  return 'standard'
}

const usesReactionTiming = (range: string): boolean => (
  /\b(?:Interrupt|Reaction)\b/i.test(range)
)

const boundedMovementBudget = (token: SpawnedPokemon): number | null => {
  const budget = token.movementCapabilities?.overland
  if (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 0) return null
  return Math.floor(budget)
}

const movementSpent = (resolution: AuthoritativeMoveResolution): number => {
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

/**
 * Select reviewed declarations in canonical interpreter phase order. The
 * exclusive/inclusive bounds let a resumed resolution skip phases whose costs
 * were already planned without accepting a client-authored phase or payload.
 */
export const moveResourceCostsInPhaseWindow = (
  costsValue: readonly MoveSpecCostDeclaration[],
  phaseWindow: MoveResourceCostPhaseWindow = {},
): readonly MoveSpecCostDeclaration[] => {
  let costs: readonly MoveSpecCostDeclaration[]
  try {
    costs = parseMoveSpecCostDeclarations(costsValue, 'moveResourceCosts')
    validateMoveResourceCostCombination(
      costs.map(declaration => declaration.cost),
      'moveResourceCosts',
    )
  }
  catch (error) {
    if (
      error instanceof MoveSpecValidationError
      || error instanceof MoveResourceCostValidationError
    ) {
      return invalidCostPlan(error.message)
    }
    throw error
  }

  const phaseIndex = (phase: MoveSpecPhase, label: string): number => (
    PHASE_INDEX.get(phase)
    ?? invalidCostPlan(`${label} must be a supported MoveSpec phase.`)
  )
  const minimum = phaseWindow.minimumPhaseExclusive === undefined
    || phaseWindow.minimumPhaseExclusive === null
    ? -1
    : phaseIndex(phaseWindow.minimumPhaseExclusive, 'minimumPhaseExclusive')
  const maximum = phaseWindow.maximumPhaseInclusive === undefined
    || phaseWindow.maximumPhaseInclusive === null
    ? MOVE_SPEC_PHASES.length - 1
    : phaseIndex(phaseWindow.maximumPhaseInclusive, 'maximumPhaseInclusive')
  if (minimum > maximum) {
    invalidCostPlan('The resource-cost phase window ends before it begins.')
  }

  return Object.freeze(costs
    .map((declaration, sourceIndex) => ({ declaration, sourceIndex }))
    .filter(({ declaration }) => {
      const index = phaseIndex(declaration.phase, `Cost ${declaration.id} phase`)
      return index > minimum && index <= maximum
    })
    .sort((left, right) => (
      phaseIndex(left.declaration.phase, `Cost ${left.declaration.id} phase`)
      - phaseIndex(right.declaration.phase, `Cost ${right.declaration.id} phase`)
      || left.sourceIndex - right.sourceIndex
    ))
    .map(({ declaration }) => declaration))
}

/**
 * Plan one bounded phase window against an immutable authoritative ledger.
 * The movement values are facts produced by the server movement oracle; this
 * seam never accepts paths, costs, or mechanics from a client command.
 */
export const planMoveResourceCostWindow = (
  input: PlanMoveResourceCostWindowInput,
): PlannedMoveResourceCostWindow => {
  const previousResources = parseEncounterTurnResources(input.resources)
  const costs = moveResourceCostsInPhaseWindow(input.declarations, input)
  const spent = spendEncounterMoveResourceCosts(previousResources, {
    placementId: input.placementId,
    canonicalMoveId: input.canonicalMoveId,
    resolutionId: input.resolutionId,
    sourceOperationId: input.sourceOperationId,
    costs,
    movementBudget: input.movementBudget,
    movementDistance: input.movementDistance,
    round: input.round,
    turn: input.turn,
    actedThisRound: input.actedThisRound,
  })
  const currentResources = parseEncounterTurnResources(spent.resources)
  return deepFreeze({
    previousResources,
    currentResources,
    changed: !sameJsonValue(previousResources, currentResources),
    costs,
    spends: spent.spends,
  })
}

/**
 * Observe an accepted current-runtime move without enforcing reviewed costs.
 * MA-124B replaces this compatibility observation at live-command boundaries
 * with planMoveResourceCostWindow and atomic persistence.
 */
export const planMoveResourceObservation = (input: {
  readonly map: TabletopMap
  readonly actor: SpawnedPokemon
  readonly resolution: AuthoritativeMoveResolution
  readonly sourceOperationId: string
}): PlannedMoveResourceObservation => {
  const previousEncounterState = parseEncounterState(
    input.map.encounterState ?? createEmptyEncounterState(),
  )
  const actionType = actionTypeFromMoveRange(input.resolution.script.range)
  const consumesReaction = usesReactionTiming(input.resolution.script.range)
  const movementBudget = boundedMovementBudget(input.actor)
  const spent = movementSpent(input.resolution)
  const oncePerTurnFlagId = `move.${input.resolution.moveKey}`
  const turnResources = observeEncounterMoveResources(
    previousEncounterState.turnResources,
    {
      placementId: input.resolution.actorPlacementId,
      actionType,
      consumesReaction,
      movementBudget,
      movementSpent: spent,
      oncePerTurnFlagId,
      sourceOperationId: input.sourceOperationId,
      round: input.map.initiative?.round ?? null,
      turn: resourceTurn(previousEncounterState, input.resolution.actorPlacementId),
    },
  )
  const currentEncounterState = parseEncounterState({
    ...previousEncounterState,
    turnResources,
  })

  return Object.freeze({
    previousEncounterState: deepCloneJson(previousEncounterState),
    currentEncounterState: deepCloneJson(currentEncounterState),
    nextMap: {
      ...deepCloneJson(input.map),
      encounterState: deepCloneJson(currentEncounterState),
    },
    actionType,
    consumesReaction,
    movementBudget,
    movementSpent: spent,
    oncePerTurnFlagId,
  })
}
