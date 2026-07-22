import { createHash } from 'node:crypto'
import { AA069_EMPOWER_MOVE_MARK_PREFIX } from '#shared/abilityAutomation/aa069'
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
import { mapHasAa061AquaBulletPrepaidMove } from '../abilityAutomation/mechanics/aa061MoveIntegration'
import { reduceAbilityOwnedStateCommand } from '../abilityAutomation/ownedState'
import type { AuthoritativeMoveResolution } from '../resolveAuthoritativeMove'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import {
  EncounterResourceReductionError,
  spendEncounterMoveResourceCosts,
  type EncounterMoveResourceCostSpend,
} from './reduceEncounterResources'

export interface PlannedMoveResourceObservation {
  readonly previousEncounterState: EncounterState
  readonly currentEncounterState: EncounterState
  readonly nextMap: TabletopMap
  readonly changed: boolean
  readonly costs: readonly MoveSpecCostDeclaration[]
  readonly spends: readonly EncounterMoveResourceCostSpend[]
  readonly movementBudget: number | null
  readonly movementSpent: number
  readonly compatibilityOncePerTurnFlagId: string | null
}

export interface AuthoritativeMoveResourceMovementFacts {
  /** Exact effective distance returned by the MA-120 movement oracle. */
  readonly distance: number
  /** Current capability ceiling returned by the same oracle. */
  readonly budget: number
}

export interface PlanEncounterMoveResourceCostsInput extends MoveResourceCostPhaseWindow {
  readonly map: TabletopMap
  readonly placementId: string
  readonly canonicalMoveId: string
  readonly moveKey: string
  readonly range: string
  readonly resolutionId: string
  readonly sourceOperationId: string
  readonly movement: AuthoritativeMoveResourceMovementFacts | null
  /** Non-empty reviewed declarations take precedence over v1 compatibility. */
  readonly reviewedCosts?: readonly MoveSpecCostDeclaration[]
  /** Pending v2 execution disables range inference unless the spec reviewed costs. */
  readonly allowLegacyFallback?: boolean
  /** Server-recovered ledger before earlier phases of this same resolution. */
  readonly prerequisiteResources?: EncounterTurnResourceDirectory
  /** Record opening-action legality in the same atomic encounter-state plan. */
  readonly markActedSinceEntry?: boolean
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
  /** Server-recovered ledger before earlier phases of this same resolution. */
  readonly prerequisiteResources?: EncounterTurnResourceDirectory
  /** Temporary v1/pre-cost-v2 observation retained without making it a reviewed cost. */
  readonly compatibilityOncePerTurnFlagId?: string | null
  /** Record opening-action legality in the same immutable reduction. */
  readonly markActedSinceEntry?: boolean
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

const priorityModeFromMoveRange = (
  range: string,
): Extract<MoveSpecCostDeclaration['cost'], { readonly kind: 'priority' }>['mode'] | null => {
  if (/\bPriority\s*\(Advanced\)/i.test(range)) return 'advanced'
  if (/\bPriority\s*\(Limited\)/i.test(range)) return 'limited'
  return /\bPriority\b/i.test(range) ? 'standard' : null
}

const resourceTurn = (
  state: EncounterState,
  actorPlacementId: string,
): number | null => state.history.currentTurn?.placementId === actorPlacementId
  ? state.history.currentTurn.turn
  : null

const setupExecuteStep = (
  state: EncounterState,
  placementId: string,
  canonicalMoveId: string,
): 'set-up' | 'execute' => {
  const setup = state.turnResources[placementId]?.setupExecute
  return setup?.canonicalMoveId === canonicalMoveId && setup.status === 'ready-to-execute'
    ? 'execute'
    : 'set-up'
}

/**
 * Adapt retained v1 range metadata into bounded server-owned declarations.
 * This compatibility path is deliberately closed and never consumes prose,
 * automation notes, client payloads, or arbitrary action labels.
 */
export const adaptLegacyMoveResourceCosts = (input: {
  readonly range: string
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

  return parseMoveSpecCostDeclarations(costs, 'legacyMoveResourceCosts')
}

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
    prerequisiteResources: input.prerequisiteResources,
    compatibilityOncePerTurnFlagId: input.compatibilityOncePerTurnFlagId,
    markActedSinceEntry: input.markActedSinceEntry,
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
 * Plan one move-cost phase window against the map-owned encounter ledger.
 * Reviewed v2 declarations win; retained v1 and pre-cost-v2 definitions use
 * only the closed range adapter. Exact movement facts must come from MA-120.
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
  const movementDistance = input.movement?.distance ?? 0
  const movementBudget = input.movement?.budget ?? null
  const baseDeclarations = useReviewed
    ? reviewed
    : allowLegacyFallback
      ? adaptLegacyMoveResourceCosts({
          range: input.range,
          movementDistance,
          setupStep: setupExecuteStep(
            previousEncounterState,
            input.placementId,
            input.canonicalMoveId,
          ),
        })
      : []
  const empowerMarkId = `${AA069_EMPOWER_MOVE_MARK_PREFIX}${createHash('sha256').update(input.canonicalMoveId).digest('hex').slice(0, 24)}`
  const empowerMark = (previousEncounterState.abilityOwnedState?.entries ?? []).find(entry => (
    entry.ownerPlacementId === input.placementId
    && entry.canonicalId === 'Empower'
    && entry.payload.kind === 'mark'
    && entry.payload.markId === empowerMarkId
  )) ?? null
  const declarations = empowerMark
    ? baseDeclarations.map(declaration => declaration.cost.kind === 'action-resource'
      ? {
          ...declaration,
          id: 'ability.empower.free-action',
          cost: { kind: 'action-resource' as const, resource: 'free' as const, amount: 1 as const },
        }
      : declaration)
    : baseDeclarations
  const selectedCosts = moveResourceCostsInPhaseWindow(declarations, input)
  const compatibilityOncePerTurnFlagId = !useReviewed
    && allowLegacyFallback
    && selectedCosts.length > 0
    ? `move.${input.moveKey}`
    : null
  const planned = planMoveResourceCostWindow({
    resources: previousEncounterState.turnResources,
    placementId: input.placementId,
    canonicalMoveId: input.canonicalMoveId,
    resolutionId: input.resolutionId,
    sourceOperationId: input.sourceOperationId,
    declarations,
    movementDistance,
    movementBudget,
    round: input.map.initiative?.round ?? null,
    turn: resourceTurn(previousEncounterState, input.placementId),
    actedThisRound: previousEncounterState.history.actedThisRoundPlacementIds.includes(
      input.placementId,
    ),
    prerequisiteResources: input.prerequisiteResources,
    minimumPhaseExclusive: input.minimumPhaseExclusive,
    maximumPhaseInclusive: input.maximumPhaseInclusive,
    compatibilityOncePerTurnFlagId,
    markActedSinceEntry: input.markActedSinceEntry,
  })
  let abilityOwnedState = previousEncounterState.abilityOwnedState
  if (empowerMark && planned.costs.some(cost => cost.id === 'ability.empower.free-action')) {
    abilityOwnedState = reduceAbilityOwnedStateCommand(abilityOwnedState, {
      operationId: `${input.sourceOperationId}:empower-free-action`,
      kind: 'remove',
      stateId: empowerMark.stateId,
      expectedVersion: empowerMark.version,
    }).state
  }
  const currentEncounterState = parseEncounterState({
    ...previousEncounterState,
    turnResources: planned.currentResources,
    abilityOwnedState,
  })
  const changed = !sameJsonValue(previousEncounterState, currentEncounterState)

  return deepFreeze({
    previousEncounterState: deepCloneJson(previousEncounterState),
    currentEncounterState: deepCloneJson(currentEncounterState),
    nextMap: changed
      ? {
          ...deepCloneJson(input.map),
          encounterState: deepCloneJson(currentEncounterState),
        }
      : deepCloneJson(input.map),
    changed,
    costs: deepCloneJson(planned.costs),
    spends: deepCloneJson(planned.spends),
    movementBudget,
    movementSpent: planned.spends
      .filter(spend => spend.kind === 'movement-distance')
      .reduce((total, spend) => total + spend.amount, 0),
    compatibilityOncePerTurnFlagId,
  })
}

/** Enforce and plan resource costs for one completed authoritative move. */
export const planMoveResourceObservation = (input: {
  readonly map: TabletopMap
  readonly resolution: AuthoritativeMoveResolution
  readonly sourceOperationId: string
  readonly resolutionId?: string
  readonly reviewedCosts?: readonly MoveSpecCostDeclaration[]
  readonly minimumPhaseExclusive?: MoveSpecPhase | null
  readonly maximumPhaseInclusive?: MoveSpecPhase | null
  readonly allowLegacyFallback?: boolean
  readonly prerequisiteResources?: EncounterTurnResourceDirectory
  readonly actionPrepaid?: boolean
}): PlannedMoveResourceObservation => {
  const prepaid = input.actionPrepaid ?? mapHasAa061AquaBulletPrepaidMove({
    map: input.map,
    actorPlacementId: input.resolution.actorPlacementId,
    moveName: input.resolution.canonicalMoveName,
  })
  return planEncounterMoveResourceCosts({
  map: input.map,
  placementId: input.resolution.actorPlacementId,
  canonicalMoveId: input.resolution.canonicalMoveName,
  moveKey: input.resolution.moveKey,
  range: input.resolution.script.range,
  resolutionId: input.resolutionId ?? input.sourceOperationId,
  sourceOperationId: input.sourceOperationId,
  movement: input.resolution.resourceMovement ?? null,
  reviewedCosts: prepaid ? [] : input.reviewedCosts,
  minimumPhaseExclusive: input.minimumPhaseExclusive,
  maximumPhaseInclusive: input.maximumPhaseInclusive,
  allowLegacyFallback: prepaid ? false : input.allowLegacyFallback,
  prerequisiteResources: input.prerequisiteResources,
  markActedSinceEntry: !prepaid,
  })
}
