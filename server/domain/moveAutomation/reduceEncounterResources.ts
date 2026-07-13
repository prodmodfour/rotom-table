import {
  ENCOUNTER_ACTION_TYPES,
  ENCOUNTER_RESOURCE_LIMITS,
  createEncounterTurnResourceLedger,
  parseEncounterTurnResources,
  type EncounterActionResource,
  type EncounterActionType,
  type EncounterOncePerTurnFlag,
  type EncounterResourceResetTiming,
  type EncounterSetupExecuteState,
  type EncounterSetupExecuteStatus,
  type EncounterTurnResourceDirectory,
  type EncounterTurnResourceLedger,
} from '#shared/moveAutomation/encounterResources'
import type {
  EncounterEvent,
  EncounterTurnEvent,
} from '#shared/moveAutomation/events'
import {
  MoveResourceCostValidationError,
  validateMoveResourceCostCombination,
} from '#shared/moveAutomation/resourceCosts'
import {
  MoveSpecValidationError,
  parseMoveSpecCostDeclarations,
  type MoveSpecCostDeclaration,
} from '#shared/moveAutomation/spec'

export const ENCOUNTER_REACTION_AVAILABLE_RESOURCE_ID = 'reaction.available' as const
export const ENCOUNTER_MOVEMENT_RESOURCE_ID = 'movement' as const
export const ENCOUNTER_ONCE_PER_TURN_RESOURCE_PREFIX = 'once-per-turn.' as const
export const ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID = 'cost.exhaust.next-turn' as const
export const ENCOUNTER_EXHAUST_COMMAND_FLAG_ID = 'cost.exhaust.command' as const
export const ENCOUNTER_PRIORITY_ADVANCED_NEXT_TURN_FLAG_ID = 'cost.priority.advanced.next-turn' as const

export type EncounterResourceReductionErrorCode =
  | 'unknown-resource'
  | 'resource-amount-overflow'
  | 'flag-limit-exceeded'
  | 'invalid-move-observation'
  | 'action-unavailable'
  | 'reaction-unavailable'
  | 'movement-unavailable'
  | 'once-per-turn-unavailable'
  | 'exhaust-prerequisite-failed'
  | 'setup-state-conflict'
  | 'priority-unavailable'
  | 'invalid-resource-cost'

export class EncounterResourceReductionError extends Error {
  readonly code: EncounterResourceReductionErrorCode

  constructor(code: EncounterResourceReductionErrorCode, message: string) {
    super(message)
    this.name = 'EncounterResourceReductionError'
    this.code = code
  }
}

export interface EncounterMoveResourceObservation {
  readonly placementId: string
  readonly actionType: EncounterActionType
  /** Interrupt/reaction timing consumes the separately queryable response availability. */
  readonly consumesReaction: boolean
  readonly movementBudget: number | null
  readonly movementSpent: number
  readonly oncePerTurnFlagId: string
  readonly sourceOperationId: string
  readonly round: number | null
  readonly turn: number | null
}

export interface SetEncounterSetupExecuteStateInput {
  readonly placementId: string
  readonly canonicalMoveId: string
  readonly resolutionId: string
  readonly sourceOperationId: string
  readonly status: EncounterSetupExecuteStatus
  readonly round: number | null
  readonly turn: number | null
  readonly resetOn?: readonly EncounterResourceResetTiming[]
}

export interface SpendEncounterMoveResourceCostsInput {
  readonly placementId: string
  readonly canonicalMoveId: string
  readonly resolutionId: string
  readonly sourceOperationId: string
  readonly costs: readonly MoveSpecCostDeclaration[]
  /** Effective server-owned movement ceiling for the relevant movement modes. */
  readonly movementBudget: number | null
  /** Distance derived by the authoritative movement oracle. */
  readonly movementDistance: number
  readonly round: number | null
  readonly turn: number | null
  readonly actedThisRound: boolean
  /** Compatibility observation only; explicit once-per-turn costs enforce themselves. */
  readonly compatibilityOncePerTurnFlagId?: string | null
}

export interface EncounterMoveResourceCostSpend {
  readonly costId: string
  readonly phase: MoveSpecCostDeclaration['phase']
  readonly kind: MoveSpecCostDeclaration['cost']['kind']
  readonly resourceId: string | null
  readonly amount: number
}

export interface SpentEncounterMoveResourceCosts {
  readonly resources: EncounterTurnResourceDirectory
  readonly spends: readonly EncounterMoveResourceCostSpend[]
}

const ACTION_RESOURCE_PREFIX = 'action.'
const ACTION_TYPE_SET = new Set<string>(ENCOUNTER_ACTION_TYPES)
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/

const fail = (
  code: EncounterResourceReductionErrorCode,
  message: string,
): never => {
  throw new EncounterResourceReductionError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const safeAdd = (left: number, right: number, label: string): number => {
  const total = left + right
  if (
    !Number.isSafeInteger(total)
    || total < 0
    || total > ENCOUNTER_RESOURCE_LIMITS.amount
  ) {
    return fail(
      'resource-amount-overflow',
      `${label} exceeds the bounded encounter-resource amount.`,
    )
  }
  return total
}

const normalizedAmount = (value: number, label: string): number => {
  if (
    !Number.isSafeInteger(value)
    || value < 0
    || value > ENCOUNTER_RESOURCE_LIMITS.amount
  ) {
    return fail(
      'invalid-move-observation',
      `${label} must be a bounded non-negative safe integer.`,
    )
  }
  return value
}

const withLedger = (
  resources: EncounterTurnResourceDirectory,
  ledger: EncounterTurnResourceLedger,
): EncounterTurnResourceDirectory => ({ ...resources, [ledger.placementId]: ledger })

const ensureLedger = (
  resources: EncounterTurnResourceDirectory,
  input: {
    readonly placementId: string
    readonly round?: number | null
    readonly turn?: number | null
    readonly movementBudget?: number | null
  },
): EncounterTurnResourceLedger => resources[input.placementId]
  ?? createEncounterTurnResourceLedger(input)

const replaceAction = (
  ledger: EncounterTurnResourceLedger,
  action: EncounterActionResource,
): EncounterTurnResourceLedger => ({
  ...ledger,
  actions: { ...ledger.actions, [action.type]: action },
})

const spendAction = (
  ledger: EncounterTurnResourceLedger,
  actionType: EncounterActionType,
  amount: number,
): EncounterTurnResourceLedger => {
  const action = ledger.actions[actionType]
  return replaceAction(ledger, {
    ...action,
    spent: safeAdd(action.spent, amount, `${actionType} action spend`),
  })
}

const restoreAction = (
  ledger: EncounterTurnResourceLedger,
  actionType: EncounterActionType,
  amount: number,
): EncounterTurnResourceLedger => {
  const action = ledger.actions[actionType]
  return replaceAction(ledger, {
    ...action,
    spent: Math.max(0, action.spent - amount),
  })
}

const resetMatches = (
  resetOn: readonly EncounterResourceResetTiming[],
  timing: EncounterResourceResetTiming,
): boolean => resetOn.includes(timing)

const resetLedger = (
  ledger: EncounterTurnResourceLedger,
  timing: EncounterResourceResetTiming,
): EncounterTurnResourceLedger => ({
  ...ledger,
  actions: Object.fromEntries(ENCOUNTER_ACTION_TYPES.map((actionType) => {
    const action = ledger.actions[actionType]
    return [
      actionType,
      resetMatches(action.resetOn, timing) ? { ...action, spent: 0 } : action,
    ]
  })) as unknown as EncounterTurnResourceLedger['actions'],
  reaction: resetMatches(ledger.reaction.resetOn, timing)
    ? { ...ledger.reaction, available: true }
    : ledger.reaction,
  movement: resetMatches(ledger.movement.resetOn, timing)
    ? { ...ledger.movement, spent: 0 }
    : ledger.movement,
  oncePerTurnFlags: ledger.oncePerTurnFlags.filter(flag => (
    !resetMatches(flag.resetOn, timing)
  )),
  setupExecute: ledger.setupExecute
    && resetMatches(ledger.setupExecute.resetOn, timing)
    ? null
    : ledger.setupExecute,
})

const resetAll = (
  resources: EncounterTurnResourceDirectory,
  timing: EncounterResourceResetTiming,
): EncounterTurnResourceDirectory => Object.fromEntries(
  Object.entries(resources).map(([placementId, ledger]) => [
    placementId,
    resetLedger(ledger, timing),
  ]),
)

const resetPlacement = (
  resources: EncounterTurnResourceDirectory,
  placementId: string,
  timing: EncounterResourceResetTiming,
): EncounterTurnResourceDirectory => {
  const ledger = resources[placementId]
  return ledger
    ? withLedger(resources, resetLedger(ledger, timing))
    : resources
}

const setRoundWindow = (
  resources: EncounterTurnResourceDirectory,
  round: number,
): EncounterTurnResourceDirectory => Object.fromEntries(
  Object.entries(resetAll(resources, 'round-start')).map(([placementId, ledger]) => [
    placementId,
    { ...ledger, round, turn: null },
  ]),
)

const setTurnWindow = (
  resources: EncounterTurnResourceDirectory,
  event: EncounterTurnEvent,
): EncounterTurnResourceDirectory => {
  const previous = ensureLedger(resources, {
    placementId: event.placementId,
    round: event.round,
    turn: event.turn,
  })
  const forfeitsNextTurn = previous.oncePerTurnFlags.some(flag => (
    flag.id === ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID
    || flag.id === ENCOUNTER_PRIORITY_ADVANCED_NEXT_TURN_FLAG_ID
  ))
  let ledger = resetLedger(previous, 'turn-start')
  if (forfeitsNextTurn) {
    ledger = spendAction(spendAction(ledger, 'standard', 1), 'shift', 1)
  }
  return withLedger(resources, {
    ...ledger,
    round: event.round,
    turn: event.turn,
  })
}

const actionTypeFromResourceId = (resourceId: string): EncounterActionType | null => {
  if (!resourceId.startsWith(ACTION_RESOURCE_PREFIX)) return null
  const actionType = resourceId.slice(ACTION_RESOURCE_PREFIX.length)
  return ACTION_TYPE_SET.has(actionType) ? actionType as EncounterActionType : null
}

const flagIdFromResourceId = (resourceId: string): string | null => {
  if (!resourceId.startsWith(ENCOUNTER_ONCE_PER_TURN_RESOURCE_PREFIX)) return null
  const flagId = resourceId.slice(ENCOUNTER_ONCE_PER_TURN_RESOURCE_PREFIX.length)
  return STABLE_ID_PATTERN.test(flagId) ? flagId : null
}

const addFlag = (
  ledger: EncounterTurnResourceLedger,
  flag: EncounterOncePerTurnFlag,
): EncounterTurnResourceLedger => {
  if (ledger.oncePerTurnFlags.some(candidate => candidate.id === flag.id)) return ledger
  if (ledger.oncePerTurnFlags.length >= ENCOUNTER_RESOURCE_LIMITS.flagsPerPlacement) {
    return fail(
      'flag-limit-exceeded',
      `Placement ${ledger.placementId} cannot exceed ${ENCOUNTER_RESOURCE_LIMITS.flagsPerPlacement} once-per-turn flags.`,
    )
  }
  return {
    ...ledger,
    oncePerTurnFlags: [...ledger.oncePerTurnFlags, flag]
      .sort((left, right) => left.id.localeCompare(right.id)),
  }
}

const effectiveActionSpend = (
  ledger: EncounterTurnResourceLedger,
  actionType: EncounterActionType,
): number => {
  const direct = ledger.actions[actionType].spent
  return actionType === 'standard' || actionType === 'shift'
    ? safeAdd(direct, ledger.actions.full.spent, `${actionType} effective spend`)
    : direct
}

const actionRemaining = (
  ledger: EncounterTurnResourceLedger,
  actionType: EncounterActionType,
): number | null => {
  const action = ledger.actions[actionType]
  if (action.budget === null) return null
  if (actionType !== 'full') {
    return Math.max(0, action.budget - effectiveActionSpend(ledger, actionType))
  }
  const standardRemaining = actionRemaining(ledger, 'standard')
  const shiftRemaining = actionRemaining(ledger, 'shift')
  return Math.min(
    Math.max(0, action.budget - action.spent),
    standardRemaining ?? ENCOUNTER_RESOURCE_LIMITS.amount,
    shiftRemaining ?? ENCOUNTER_RESOURCE_LIMITS.amount,
  )
}

const assertActionAvailable = (
  ledger: EncounterTurnResourceLedger,
  actionType: EncounterActionType,
  amount: number,
): void => {
  const remaining = actionRemaining(ledger, actionType)
  if (remaining !== null && remaining < amount) {
    fail(
      'action-unavailable',
      `Placement ${ledger.placementId} has no remaining ${actionType} action resource.`,
    )
  }
  if (
    (actionType === 'interrupt' || actionType === 'reaction')
    && !ledger.reaction.available
  ) {
    fail(
      'reaction-unavailable',
      `Placement ${ledger.placementId} has no remaining Interrupt/Reaction availability.`,
    )
  }
}

const boundedOptionalAmount = (
  value: number | null,
  label: string,
): number | null => {
  if (value === null) return null
  return normalizedAmount(value, label)
}

const prepareLedgerWindow = (
  resources: EncounterTurnResourceDirectory,
  input: Pick<SpendEncounterMoveResourceCostsInput,
    'placementId' | 'round' | 'turn' | 'movementBudget'>,
): EncounterTurnResourceLedger => {
  let ledger = ensureLedger(resources, {
    placementId: input.placementId,
    round: input.round,
    turn: input.turn,
    movementBudget: input.movementBudget,
  })
  if (input.round !== null && ledger.round !== input.round) {
    ledger = {
      ...resetLedger(ledger, 'round-start'),
      round: input.round,
      turn: null,
    }
  }
  if (input.turn !== null && ledger.turn !== input.turn) {
    const forfeitsNextTurn = ledger.oncePerTurnFlags.some(flag => (
      flag.id === ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID
      || flag.id === ENCOUNTER_PRIORITY_ADVANCED_NEXT_TURN_FLAG_ID
    ))
    ledger = {
      ...resetLedger(ledger, 'turn-start'),
      round: input.round ?? ledger.round,
      turn: input.turn,
    }
    if (forfeitsNextTurn) {
      ledger = spendAction(spendAction(ledger, 'standard', 1), 'shift', 1)
    }
  }
  return {
    ...ledger,
    round: input.round ?? ledger.round,
    turn: input.turn ?? ledger.turn,
    movement: {
      ...ledger.movement,
      // Null is an authoritative fail-closed result, not permission to reuse a
      // stale capability observed in an earlier movement window.
      budget: input.movementBudget,
    },
  }
}

const appendCostFlag = (
  ledger: EncounterTurnResourceLedger,
  input: {
    readonly id: string
    readonly sourceOperationId: string
    readonly resetOn: readonly EncounterResourceResetTiming[]
  },
): EncounterTurnResourceLedger => addFlag(ledger, {
  id: input.id,
  sourceOperationId: input.sourceOperationId,
  resetOn: input.resetOn,
})

const hasActedForPriority = (
  ledger: EncounterTurnResourceLedger,
  actedThisRound: boolean,
): boolean => actedThisRound || (
  effectiveActionSpend(ledger, 'standard') > 0
  || effectiveActionSpend(ledger, 'shift') > 0
  || ledger.actions.swift.spent > 0
  || ledger.actions.full.spent > 0
)

/**
 * Validate and atomically reduce reviewed move costs into one placement ledger.
 *
 * The function mutates no input. Any failed action, movement, once-per-turn,
 * Exhaust, Set-Up/Execute, or Priority precondition throws before a result is
 * returned, so a caller can compose the resulting directory into one map CAS.
 */
export const spendEncounterMoveResourceCosts = (
  resourcesValue: EncounterTurnResourceDirectory,
  input: SpendEncounterMoveResourceCostsInput,
): SpentEncounterMoveResourceCosts => {
  const resources = parseEncounterTurnResources(resourcesValue)
  const movementBudget = boundedOptionalAmount(
    input.movementBudget,
    'Authoritative movement budget',
  )
  const movementDistance = normalizedAmount(
    input.movementDistance,
    'Authoritative movement distance',
  )
  let costs: readonly MoveSpecCostDeclaration[]
  try {
    costs = parseMoveSpecCostDeclarations(input.costs, 'moveResourceCosts')
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
      return fail('invalid-resource-cost', error.message)
    }
    throw error
  }

  const compatibilityFlagId = input.compatibilityOncePerTurnFlagId ?? null
  if (compatibilityFlagId !== null && !STABLE_ID_PATTERN.test(compatibilityFlagId)) {
    fail(
      'invalid-resource-cost',
      'Compatibility once-per-turn flag must be a lowercase stable identifier.',
    )
  }

  const noCostSpends = costs
    .filter(declaration => declaration.cost.kind === 'no-cost')
    .map((declaration): EncounterMoveResourceCostSpend => ({
      costId: declaration.id,
      phase: declaration.phase,
      kind: declaration.cost.kind,
      resourceId: null,
      amount: 0,
    }))
  if (
    costs.every(declaration => declaration.cost.kind === 'no-cost')
    && compatibilityFlagId === null
  ) {
    return deepFreeze({ resources, spends: noCostSpends })
  }

  const plannedMovementBudget = costs.some(declaration => (
    declaration.cost.kind === 'movement-distance'
  ))
    ? movementBudget
    : resources[input.placementId]?.movement.budget ?? movementBudget
  let ledger = prepareLedgerWindow(resources, {
    placementId: input.placementId,
    round: input.round,
    turn: input.turn,
    movementBudget: plannedMovementBudget,
  })
  const initialLedger = ledger
  const spends: EncounterMoveResourceCostSpend[] = []

  for (const declaration of costs) {
    const cost = declaration.cost
    if (cost.kind === 'action-resource') {
      assertActionAvailable(ledger, cost.resource, cost.amount)
      ledger = spendAction(ledger, cost.resource, cost.amount)
      if (cost.resource === 'interrupt' || cost.resource === 'reaction') {
        ledger = { ...ledger, reaction: { ...ledger.reaction, available: false } }
      }
      spends.push({
        costId: declaration.id,
        phase: declaration.phase,
        kind: cost.kind,
        resourceId: `action.${cost.resource}`,
        amount: cost.amount,
      })
      continue
    }

    if (cost.kind === 'movement-distance') {
      const amount = cost.amount === 'resolved-distance'
        ? movementDistance
        : cost.amount
      const budget = ledger.movement.budget
      if (
        budget === null
        || amount > budget - ledger.movement.spent
      ) {
        fail(
          'movement-unavailable',
          `Placement ${ledger.placementId} cannot spend ${amount} movement; ${Math.max(0, (budget ?? 0) - ledger.movement.spent)} remains.`,
        )
      }
      ledger = {
        ...ledger,
        movement: {
          ...ledger.movement,
          spent: safeAdd(ledger.movement.spent, amount, 'Movement distance spend'),
        },
      }
      spends.push({
        costId: declaration.id,
        phase: declaration.phase,
        kind: cost.kind,
        resourceId: ENCOUNTER_MOVEMENT_RESOURCE_ID,
        amount,
      })
      continue
    }

    if (cost.kind === 'once-per-turn') {
      if (ledger.oncePerTurnFlags.some(flag => flag.id === cost.flagId)) {
        fail(
          'once-per-turn-unavailable',
          `Placement ${ledger.placementId} already spent once-per-turn resource ${cost.flagId}.`,
        )
      }
      ledger = appendCostFlag(ledger, {
        id: cost.flagId,
        sourceOperationId: input.sourceOperationId,
        resetOn: ['turn-start'],
      })
      spends.push({
        costId: declaration.id,
        phase: declaration.phase,
        kind: cost.kind,
        resourceId: `${ENCOUNTER_ONCE_PER_TURN_RESOURCE_PREFIX}${cost.flagId}`,
        amount: 1,
      })
      continue
    }

    if (cost.kind === 'exhaust') {
      if (
        effectiveActionSpend(initialLedger, 'standard') > 0
        || effectiveActionSpend(initialLedger, 'shift') > 0
      ) {
        fail(
          'exhaust-prerequisite-failed',
          `Placement ${ledger.placementId} already spent Standard or Shift and cannot declare an Exhaust move.`,
        )
      }
      if (ledger.oncePerTurnFlags.some(flag => flag.id === ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID)) {
        fail(
          'exhaust-prerequisite-failed',
          `Placement ${ledger.placementId} already has a pending Exhaust forfeiture.`,
        )
      }
      ledger = appendCostFlag(ledger, {
        id: ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID,
        sourceOperationId: input.sourceOperationId,
        resetOn: ['turn-start'],
      })
      if (cost.forfeitCommand) {
        ledger = appendCostFlag(ledger, {
          id: ENCOUNTER_EXHAUST_COMMAND_FLAG_ID,
          sourceOperationId: input.sourceOperationId,
          resetOn: ['round-start'],
        })
      }
      spends.push({
        costId: declaration.id,
        phase: declaration.phase,
        kind: cost.kind,
        resourceId: ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID,
        amount: 1,
      })
      continue
    }

    if (cost.kind === 'setup-execute') {
      const setup = ledger.setupExecute
      if (cost.step === 'set-up') {
        if (setup !== null) {
          fail(
            'setup-state-conflict',
            `Placement ${ledger.placementId} already has Set-Up/Execute state for ${setup.canonicalMoveId}.`,
          )
        }
        ledger = {
          ...ledger,
          setupExecute: {
            canonicalMoveId: input.canonicalMoveId,
            resolutionId: input.resolutionId,
            sourceOperationId: input.sourceOperationId,
            status: 'setting-up',
            createdRound: input.round,
            createdTurn: input.turn,
            resetOn: ['scene-end', 'recall', 'knockout'],
          },
        }
      }
      else {
        if (
          setup?.canonicalMoveId !== input.canonicalMoveId
          || setup.status !== 'ready-to-execute'
        ) {
          fail(
            'setup-state-conflict',
            `Placement ${ledger.placementId} has no ready ${input.canonicalMoveId} Set-Up state to execute.`,
          )
        }
        ledger = { ...ledger, setupExecute: null }
      }
      spends.push({
        costId: declaration.id,
        phase: declaration.phase,
        kind: cost.kind,
        resourceId: 'setup-execute',
        amount: 1,
      })
      continue
    }

    if (cost.kind === 'priority') {
      const acted = hasActedForPriority(initialLedger, input.actedThisRound)
      if (cost.mode !== 'advanced' && acted) {
        fail(
          'priority-unavailable',
          `Placement ${ledger.placementId} already acted this round and cannot declare ${cost.mode} Priority.`,
        )
      }
      if (cost.mode === 'advanced' && acted) {
        if (ledger.oncePerTurnFlags.some(flag => (
          flag.id === ENCOUNTER_PRIORITY_ADVANCED_NEXT_TURN_FLAG_ID
        ))) {
          fail(
            'priority-unavailable',
            `Placement ${ledger.placementId} already owes a Priority (Advanced) next-turn forfeiture.`,
          )
        }
        ledger = appendCostFlag(ledger, {
          id: ENCOUNTER_PRIORITY_ADVANCED_NEXT_TURN_FLAG_ID,
          sourceOperationId: input.sourceOperationId,
          resetOn: ['turn-start'],
        })
      }
      spends.push({
        costId: declaration.id,
        phase: declaration.phase,
        kind: cost.kind,
        resourceId: `priority.${cost.mode}`,
        amount: 1,
      })
      continue
    }

    spends.push({
      costId: declaration.id,
      phase: declaration.phase,
      kind: cost.kind,
      resourceId: null,
      amount: 0,
    })
  }

  if (compatibilityFlagId !== null) {
    ledger = appendCostFlag(ledger, {
      id: compatibilityFlagId,
      sourceOperationId: input.sourceOperationId,
      resetOn: ['turn-start'],
    })
  }

  return deepFreeze({
    resources: parseEncounterTurnResources(withLedger(resources, ledger)),
    spends,
  })
}

const reduceResourceFact = (
  resources: EncounterTurnResourceDirectory,
  event: Extract<EncounterEvent, {
    readonly kind: 'resource-spent' | 'resource-restored'
  }>,
): EncounterTurnResourceDirectory => {
  const spent = event.kind === 'resource-spent'
  let ledger = ensureLedger(resources, { placementId: event.placementId })
  const actionType = actionTypeFromResourceId(event.resourceId)
  if (actionType) {
    ledger = spent
      ? spendAction(ledger, actionType, event.amount)
      : restoreAction(ledger, actionType, event.amount)
    if (spent && (actionType === 'interrupt' || actionType === 'reaction')) {
      ledger = { ...ledger, reaction: { ...ledger.reaction, available: false } }
    }
    return withLedger(resources, ledger)
  }

  if (event.resourceId === ENCOUNTER_REACTION_AVAILABLE_RESOURCE_ID) {
    return withLedger(resources, {
      ...ledger,
      reaction: { ...ledger.reaction, available: !spent },
    })
  }

  if (event.resourceId === ENCOUNTER_MOVEMENT_RESOURCE_ID) {
    return withLedger(resources, {
      ...ledger,
      movement: {
        ...ledger.movement,
        spent: spent
          ? safeAdd(ledger.movement.spent, event.amount, 'Movement spend')
          : Math.max(0, ledger.movement.spent - event.amount),
      },
    })
  }

  const flagId = flagIdFromResourceId(event.resourceId)
  if (flagId) {
    return withLedger(resources, spent
      ? addFlag(ledger, {
          id: flagId,
          sourceOperationId: event.sourceOperationId,
          resetOn: ['turn-start'],
        })
      : {
          ...ledger,
          oncePerTurnFlags: ledger.oncePerTurnFlags.filter(flag => flag.id !== flagId),
        })
  }

  return fail(
    'unknown-resource',
    `Encounter event ${event.eventId} references unsupported resource ${event.resourceId}.`,
  )
}

/**
 * Reduce one authoritative lifecycle fact into action-economy state.
 *
 * Scene events clear the directory. Boundary events apply only resources whose
 * explicit reset policy names that boundary. Resource facts never enforce a
 * budget in this phase; they record accepted server-owned observations.
 */
export const reduceEncounterResourceEvent = (
  resourcesValue: EncounterTurnResourceDirectory,
  event: EncounterEvent,
): EncounterTurnResourceDirectory => {
  let resources = parseEncounterTurnResources(resourcesValue)

  if (event.kind === 'scene-start' || event.kind === 'scene-end') {
    return deepFreeze({})
  }
  if (event.kind === 'round-start') {
    resources = setRoundWindow(resources, event.round)
  }
  else if (event.kind === 'round-end') resources = resetAll(resources, 'round-end')
  else if (event.kind === 'turn-start') resources = setTurnWindow(resources, event)
  else if (event.kind === 'turn-end') {
    resources = resetPlacement(resources, event.placementId, 'turn-end')
  }
  else if (event.kind === 'recall') {
    resources = resetPlacement(resources, event.placementId, 'recall')
  }
  else if (event.kind === 'send-out') {
    resources = resetPlacement(resources, event.placementId, 'send-out')
  }
  else if (event.kind === 'switch') {
    resources = resetPlacement(resources, event.recalledPlacementId, 'recall')
    resources = resetPlacement(resources, event.sentOutPlacementId, 'send-out')
  }
  else if (event.kind === 'move-ko') {
    resources = resetPlacement(resources, event.targetPlacementId, 'knockout')
  }
  else if (event.kind === 'resource-spent' || event.kind === 'resource-restored') {
    resources = reduceResourceFact(resources, event)
  }

  return deepFreeze(parseEncounterTurnResources(resources))
}

/** Record one accepted current-runtime move without enforcing its costs yet. */
export const observeEncounterMoveResources = (
  resourcesValue: EncounterTurnResourceDirectory,
  observation: EncounterMoveResourceObservation,
): EncounterTurnResourceDirectory => {
  const resources = parseEncounterTurnResources(resourcesValue)
  const movementSpent = normalizedAmount(
    observation.movementSpent,
    'Observed movement spend',
  )
  if (
    observation.movementBudget !== null
    && (!Number.isSafeInteger(observation.movementBudget)
      || observation.movementBudget < 0
      || observation.movementBudget > ENCOUNTER_RESOURCE_LIMITS.amount)
  ) {
    return fail(
      'invalid-move-observation',
      'Observed movement budget must be null or a bounded non-negative safe integer.',
    )
  }
  if (!STABLE_ID_PATTERN.test(observation.oncePerTurnFlagId)) {
    return fail(
      'invalid-move-observation',
      'Observed once-per-turn flag must be a lowercase stable identifier.',
    )
  }

  let ledger = ensureLedger(resources, {
    placementId: observation.placementId,
    round: observation.round,
    turn: observation.turn,
    movementBudget: observation.movementBudget,
  })
  if (observation.round !== null && ledger.round !== observation.round) {
    ledger = {
      ...resetLedger(ledger, 'round-start'),
      round: observation.round,
      turn: null,
    }
  }
  if (observation.turn !== null && ledger.turn !== observation.turn) {
    ledger = {
      ...resetLedger(ledger, 'turn-start'),
      round: observation.round ?? ledger.round,
      turn: observation.turn,
    }
  }
  ledger = {
    ...ledger,
    round: observation.round ?? ledger.round,
    turn: observation.turn ?? ledger.turn,
    movement: {
      ...ledger.movement,
      budget: observation.movementBudget ?? ledger.movement.budget,
      spent: safeAdd(ledger.movement.spent, movementSpent, 'Observed movement spend'),
    },
  }
  ledger = spendAction(ledger, observation.actionType, 1)
  if (observation.consumesReaction) {
    ledger = { ...ledger, reaction: { ...ledger.reaction, available: false } }
  }
  ledger = addFlag(ledger, {
    id: observation.oncePerTurnFlagId,
    sourceOperationId: observation.sourceOperationId,
    resetOn: ['turn-start'],
  })
  return deepFreeze(parseEncounterTurnResources(withLedger(resources, ledger)))
}

/** Set or replace the one typed setup/execute saga marker for a placement. */
export const setEncounterSetupExecuteState = (
  resourcesValue: EncounterTurnResourceDirectory,
  input: SetEncounterSetupExecuteStateInput,
): EncounterTurnResourceDirectory => {
  const resources = parseEncounterTurnResources(resourcesValue)
  const ledger = ensureLedger(resources, {
    placementId: input.placementId,
    round: input.round,
    turn: input.turn,
  })
  const setupExecute: EncounterSetupExecuteState = {
    canonicalMoveId: input.canonicalMoveId,
    resolutionId: input.resolutionId,
    sourceOperationId: input.sourceOperationId,
    status: input.status,
    createdRound: input.round,
    createdTurn: input.turn,
    resetOn: [...(input.resetOn ?? ['scene-end', 'recall', 'knockout'])],
  }
  return deepFreeze(parseEncounterTurnResources(withLedger(resources, {
    ...ledger,
    setupExecute,
  })))
}

export const clearEncounterSetupExecuteState = (
  resourcesValue: EncounterTurnResourceDirectory,
  placementId: string,
): EncounterTurnResourceDirectory => {
  const resources = parseEncounterTurnResources(resourcesValue)
  const ledger = resources[placementId]
  if (!ledger?.setupExecute) return deepFreeze(resources)
  return deepFreeze(parseEncounterTurnResources(withLedger(resources, {
    ...ledger,
    setupExecute: null,
  })))
}
