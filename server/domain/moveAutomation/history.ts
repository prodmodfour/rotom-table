import type { MoveRuleScalar } from '#shared/moveAutomation/ast'
import {
  ENCOUNTER_HISTORY_LIMITS,
  parseEncounterHistory,
  type EncounterCompletedMoveHistory,
  type EncounterDamageBySourceHistory,
  type EncounterDamagingMoveHistory,
  type EncounterDeclaredMoveHistory,
  type EncounterHistory,
} from '#shared/moveAutomation/encounterHistory'
import type { MoveHistoryQuery } from '#shared/moveAutomation/expressions'

export interface EncounterHistoryDamageTotals {
  readonly hitPointLoss: number
  readonly temporaryHitPointLoss: number
  readonly totalLoss: number
}

export interface MoveAutomationHistoryResolver {
  lastDeclaredMove(placementId: string): EncounterDeclaredMoveHistory | null
  lastCompletedMove(placementId: string): EncounterCompletedMoveHistory | null
  lastDamagingMoveReceived(placementId: string): EncounterDamagingMoveHistory | null
  damageBySourceThisTurn(
    sourcePlacementId: string,
    targetPlacementId?: string,
  ): readonly EncounterDamageBySourceHistory[]
  damageBySourceThisRound(
    sourcePlacementId: string,
    targetPlacementId?: string,
  ): readonly EncounterDamageBySourceHistory[]
  damageDealtThisTurn(placementId: string): EncounterHistoryDamageTotals
  damageReceivedThisTurn(placementId: string): EncounterHistoryDamageTotals
  damageDealtThisRound(placementId: string): EncounterHistoryDamageTotals
  damageReceivedThisRound(placementId: string): EncounterHistoryDamageTotals
  actedThisTurn(placementId: string): boolean
  actedThisRound(placementId: string): boolean
  consecutiveUseCount(placementId: string, canonicalId?: string): number
  switchedThisScene(placementId: string): boolean
  faintedThisScene(placementId: string): boolean
  parentResolutionId(resolutionId: string): string | null
  childResolutionIds(resolutionId: string): readonly string[]
  /** Evaluate the closed MoveExpression history query set from structured state. */
  query(placementId: string, query: MoveHistoryQuery): MoveRuleScalar
}

export type EncounterHistoryQueryErrorCode = 'history-total-overflow'

export class EncounterHistoryQueryError extends Error {
  readonly code: EncounterHistoryQueryErrorCode

  constructor(code: EncounterHistoryQueryErrorCode, message: string) {
    super(message)
    this.name = 'EncounterHistoryQueryError'
    this.code = code
  }
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const safeTotal = (values: readonly number[], label: string): number => {
  let total = 0
  for (const value of values) {
    total += value
    if (!Number.isSafeInteger(total) || total > ENCOUNTER_HISTORY_LIMITS.amount) {
      throw new EncounterHistoryQueryError(
        'history-total-overflow',
        `${label} exceeds the bounded safe-integer history total.`,
      )
    }
  }
  return total
}

const damageTotals = (
  values: readonly EncounterDamageBySourceHistory[],
  label: string,
): EncounterHistoryDamageTotals => {
  const hitPointLoss = safeTotal(values.map(value => value.hitPointLoss), `${label} hit-point loss`)
  const temporaryHitPointLoss = safeTotal(
    values.map(value => value.temporaryHitPointLoss),
    `${label} temporary-hit-point loss`,
  )
  return deepFreeze({
    hitPointLoss,
    temporaryHitPointLoss,
    totalLoss: safeTotal([hitPointLoss, temporaryHitPointLoss], `${label} total loss`),
  })
}

const filteredDamage = (
  values: readonly EncounterDamageBySourceHistory[],
  predicate: (entry: EncounterDamageBySourceHistory) => boolean,
): readonly EncounterDamageBySourceHistory[] => deepFreeze(values.filter(predicate))

/**
 * Snapshot bounded structured history and expose mechanics queries over it.
 * No query consults combat-log text, browser state, or mutable global state.
 */
export const createMoveAutomationHistoryResolver = (
  historyValue: EncounterHistory,
): MoveAutomationHistoryResolver => {
  const history = deepFreeze(parseEncounterHistory(historyValue))
  const lastDeclaredByPlacement = new Map(
    history.lastDeclaredMoves.map(entry => [entry.actorPlacementId, entry]),
  )
  const lastCompletedByPlacement = new Map(
    history.lastCompletedMoves.map(entry => [entry.actorPlacementId, entry]),
  )
  const lastDamageByPlacement = new Map(
    history.lastDamagingMovesReceived.map(entry => [entry.targetPlacementId, entry]),
  )
  const consecutiveByPlacement = new Map(
    history.consecutiveMoves.map(entry => [entry.placementId, entry]),
  )
  const ancestryByResolution = new Map(
    history.moveAncestry.map(entry => [entry.resolutionId, entry]),
  )
  const actedThisTurnIds = new Set(history.actedThisTurnPlacementIds)
  const actedThisRoundIds = new Set(history.actedThisRoundPlacementIds)
  const switchedIds = new Set(history.switchedPlacementIds)
  const faintedIds = new Set(history.faintedPlacementIds)

  const bySource = (
    values: readonly EncounterDamageBySourceHistory[],
    sourcePlacementId: string,
    targetPlacementId?: string,
  ): readonly EncounterDamageBySourceHistory[] => filteredDamage(
    values,
    entry => entry.sourcePlacementId === sourcePlacementId
      && (targetPlacementId === undefined || entry.targetPlacementId === targetPlacementId),
  )
  const dealt = (
    values: readonly EncounterDamageBySourceHistory[],
    placementId: string,
    window: string,
  ): EncounterHistoryDamageTotals => damageTotals(
    values.filter(entry => entry.sourcePlacementId === placementId),
    `${window} damage dealt by ${placementId}`,
  )
  const received = (
    values: readonly EncounterDamageBySourceHistory[],
    placementId: string,
    window: string,
  ): EncounterHistoryDamageTotals => damageTotals(
    values.filter(entry => entry.targetPlacementId === placementId),
    `${window} damage received by ${placementId}`,
  )

  const resolver: MoveAutomationHistoryResolver = {
    lastDeclaredMove: placementId => lastDeclaredByPlacement.get(placementId) ?? null,
    lastCompletedMove: placementId => lastCompletedByPlacement.get(placementId) ?? null,
    lastDamagingMoveReceived: placementId => lastDamageByPlacement.get(placementId) ?? null,
    damageBySourceThisTurn: (sourcePlacementId, targetPlacementId) => bySource(
      history.damageBySourceThisTurn,
      sourcePlacementId,
      targetPlacementId,
    ),
    damageBySourceThisRound: (sourcePlacementId, targetPlacementId) => bySource(
      history.damageBySourceThisRound,
      sourcePlacementId,
      targetPlacementId,
    ),
    damageDealtThisTurn: placementId => dealt(
      history.damageBySourceThisTurn,
      placementId,
      'Turn',
    ),
    damageReceivedThisTurn: placementId => received(
      history.damageBySourceThisTurn,
      placementId,
      'Turn',
    ),
    damageDealtThisRound: placementId => dealt(
      history.damageBySourceThisRound,
      placementId,
      'Round',
    ),
    damageReceivedThisRound: placementId => received(
      history.damageBySourceThisRound,
      placementId,
      'Round',
    ),
    actedThisTurn: placementId => actedThisTurnIds.has(placementId),
    actedThisRound: placementId => actedThisRoundIds.has(placementId),
    consecutiveUseCount: (placementId, canonicalId) => {
      const entry = consecutiveByPlacement.get(placementId)
      if (!entry || (canonicalId !== undefined && entry.canonicalId !== canonicalId)) return 0
      return entry.count
    },
    switchedThisScene: placementId => switchedIds.has(placementId),
    faintedThisScene: placementId => faintedIds.has(placementId),
    parentResolutionId: resolutionId => (
      ancestryByResolution.get(resolutionId)?.parentResolutionId ?? null
    ),
    childResolutionIds: resolutionId => (
      ancestryByResolution.get(resolutionId)?.childResolutionIds ?? Object.freeze([])
    ),
    query: (placementId, query) => {
      if (query === 'last-declared-move-id') {
        return lastDeclaredByPlacement.get(placementId)?.canonicalId ?? null
      }
      if (query === 'last-completed-move-id') {
        return lastCompletedByPlacement.get(placementId)?.canonicalId ?? null
      }
      if (query === 'last-damaging-move-id') {
        return lastDamageByPlacement.get(placementId)?.canonicalId ?? null
      }
      if (query === 'consecutive-use-count') {
        return consecutiveByPlacement.get(placementId)?.count ?? 0
      }
      if (query === 'damage-dealt-this-turn') {
        return dealt(history.damageBySourceThisTurn, placementId, 'Turn').totalLoss
      }
      if (query === 'damage-received-this-turn') {
        return received(history.damageBySourceThisTurn, placementId, 'Turn').totalLoss
      }
      if (query === 'acted-this-turn') return actedThisTurnIds.has(placementId)
      if (query === 'switched-this-scene') return switchedIds.has(placementId)
      return faintedIds.has(placementId)
    },
  }
  return Object.freeze(resolver)
}
