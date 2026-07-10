import {
  parseEncounterTurnResources,
  type EncounterActionResource,
  type EncounterActionType,
  type EncounterSetupExecuteState,
  type EncounterTurnResourceDirectory,
  type EncounterTurnResourceLedger,
} from '#shared/moveAutomation/encounterResources'

export interface MoveAutomationResourceResolver {
  ledger(placementId: string): EncounterTurnResourceLedger | null
  action(placementId: string, actionType: EncounterActionType): EncounterActionResource | null
  actionSpent(placementId: string, actionType: EncounterActionType): number
  actionRemaining(placementId: string, actionType: EncounterActionType): number | null
  actionAvailable(placementId: string, actionType: EncounterActionType): boolean
  reactionAvailable(placementId: string): boolean
  movementBudget(placementId: string): number | null
  movementSpent(placementId: string): number
  movementRemaining(placementId: string): number | null
  hasOncePerTurnFlag(placementId: string, flagId: string): boolean
  setupExecuteState(placementId: string): EncounterSetupExecuteState | null
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

/** Full actions consume the ordinary Standard and Shift opportunities together. */
const effectiveActionSpend = (
  ledger: EncounterTurnResourceLedger,
  actionType: EncounterActionType,
): number => {
  const direct = ledger.actions[actionType].spent
  if (actionType === 'standard' || actionType === 'shift') {
    return direct + ledger.actions.full.spent
  }
  return direct
}

/**
 * Snapshot authoritative resource ledgers behind a fail-closed mechanics seam.
 * Missing ledgers are not treated as available actions or reactions.
 */
export const createMoveAutomationResourceResolver = (
  resourcesValue: EncounterTurnResourceDirectory,
): MoveAutomationResourceResolver => {
  const resources = deepFreeze(parseEncounterTurnResources(resourcesValue))
  const ledgers = new Map(Object.entries(resources))

  const ledger = (placementId: string): EncounterTurnResourceLedger | null => (
    ledgers.get(placementId) ?? null
  )
  const action = (
    placementId: string,
    actionType: EncounterActionType,
  ): EncounterActionResource | null => ledger(placementId)?.actions[actionType] ?? null
  const actionSpent = (
    placementId: string,
    actionType: EncounterActionType,
  ): number => {
    const current = ledger(placementId)
    return current ? effectiveActionSpend(current, actionType) : 0
  }
  const actionRemaining = (
    placementId: string,
    actionType: EncounterActionType,
  ): number | null => {
    const current = ledger(placementId)
    if (!current) return null
    const budget = current.actions[actionType].budget
    if (budget === null) return null
    return Math.max(0, budget - effectiveActionSpend(current, actionType))
  }
  const movementRemaining = (placementId: string): number | null => {
    const current = ledger(placementId)
    if (!current || current.movement.budget === null) return null
    return Math.max(0, current.movement.budget - current.movement.spent)
  }

  const resolver: MoveAutomationResourceResolver = {
    ledger,
    action,
    actionSpent,
    actionRemaining,
    actionAvailable: (placementId, actionType) => {
      const current = ledger(placementId)
      if (!current) return false
      const budget = current.actions[actionType].budget
      return budget === null || effectiveActionSpend(current, actionType) < budget
    },
    reactionAvailable: placementId => ledger(placementId)?.reaction.available ?? false,
    movementBudget: placementId => ledger(placementId)?.movement.budget ?? null,
    movementSpent: placementId => ledger(placementId)?.movement.spent ?? 0,
    movementRemaining,
    hasOncePerTurnFlag: (placementId, flagId) => (
      ledger(placementId)?.oncePerTurnFlags.some(flag => flag.id === flagId) ?? false
    ),
    setupExecuteState: placementId => ledger(placementId)?.setupExecute ?? null,
  }
  return Object.freeze(resolver)
}
