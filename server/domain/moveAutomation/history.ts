import type { MoveRuleScalar } from '#shared/moveAutomation/ast'
import {
  ENCOUNTER_HISTORY_LIMITS,
  parseEncounterHistory,
  type EncounterCompletedMoveHistory,
  type EncounterDamageBySourceHistory,
  type EncounterDamagingMoveHistory,
  type EncounterDeclaredMoveHistory,
  type EncounterHistory,
  type EncounterMoveUseHistory,
} from '#shared/moveAutomation/encounterHistory'
import type { MoveHistoryQuery } from '#shared/moveAutomation/expressions'

export interface EncounterHistoryDamageTotals {
  readonly hitPointLoss: number
  readonly temporaryHitPointLoss: number
  readonly totalLoss: number
}

export interface MoveAutomationHistoryResolver {
  /** Omit placementId to query encounter-wide authoritative event order. */
  lastDeclaredMove(placementId?: string): EncounterDeclaredMoveHistory | null
  previousDeclaredMove(placementId?: string): EncounterDeclaredMoveHistory | null
  lastCompletedMove(placementId?: string): EncounterCompletedMoveHistory | null
  previousCompletedMove(placementId?: string): EncounterCompletedMoveHistory | null
  /** Oldest-to-newest, bounded by the scene-owned move-use ceiling. */
  declaredMovesThisScene(placementId?: string): readonly EncounterDeclaredMoveHistory[]
  /** Oldest-to-newest authoritative completion order. */
  completedMovesThisScene(placementId?: string): readonly EncounterCompletedMoveHistory[]
  usedMoveThisScene(placementId: string, canonicalId: string): boolean
  moveUse(resolutionId: string): EncounterMoveUseHistory | null
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
  consecutiveUseCount(
    placementId: string,
    canonicalId?: string,
    targetPlacementId?: string,
  ): number
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

const declarationFromUse = (
  use: EncounterMoveUseHistory,
): EncounterDeclaredMoveHistory | null => use.declaration === null
  ? null
  : {
      eventId: use.declaration.eventId,
      sourceOperationId: use.declaration.sourceOperationId,
      resolutionId: use.resolutionId,
      canonicalId: use.canonicalId,
      specVersion: use.specVersion,
      actorPlacementId: use.actorPlacementId,
      actionType: use.actionType,
      origin: use.origin,
      moveListSource: use.moveListSource,
      targetPlacementIds: [...use.declaration.targetPlacementIds],
    }

const completionFromUse = (
  use: EncounterMoveUseHistory,
): EncounterCompletedMoveHistory | null => use.completion === null
  ? null
  : {
      eventId: use.completion.eventId,
      sourceOperationId: use.completion.sourceOperationId,
      resolutionId: use.resolutionId,
      canonicalId: use.canonicalId,
      specVersion: use.specVersion,
      actorPlacementId: use.actorPlacementId,
      actionType: use.actionType,
      origin: use.origin,
      moveListSource: use.moveListSource,
      attackedTargetIds: [...use.completion.attackedTargetIds],
      hitTargetIds: [...use.completion.hitTargetIds],
      outcome: use.completion.outcome,
      succeeded: use.completion.succeeded,
      branches: use.completion.branches.map(branch => ({ ...branch })),
    }

const latest = <Value>(values: readonly Value[]): Value | null => (
  values.length === 0 ? null : values[values.length - 1] ?? null
)

const previous = <Value>(values: readonly Value[]): Value | null => (
  values.length < 2 ? null : values[values.length - 2] ?? null
)

/**
 * Snapshot bounded structured history and expose mechanics queries over it.
 * No query consults combat-log text, browser state, or mutable global state.
 */
export const createMoveAutomationHistoryResolver = (
  historyValue: EncounterHistory,
): MoveAutomationHistoryResolver => {
  const history = deepFreeze(parseEncounterHistory(historyValue))
  const moveUseByResolution = new Map(
    history.moveUses.map(use => [use.resolutionId, use]),
  )
  const retainedUseIds = new Set(moveUseByResolution.keys())
  const declaredMoves = deepFreeze([
    // A legacy MA-063 map retains only its final per-placement indexes. Keep
    // those truthful records before newly ordered MA-158 scene entries.
    ...history.lastDeclaredMoves.filter(entry => !retainedUseIds.has(entry.resolutionId)),
    ...history.moveUses.flatMap((use) => {
      const declaration = declarationFromUse(use)
      return declaration && use.declaration
        ? [{ order: use.declaration.order, declaration }]
        : []
    }).sort((left, right) => left.order - right.order).map(entry => entry.declaration),
  ])
  const completedMoves = deepFreeze([
    ...history.lastCompletedMoves.filter(entry => !retainedUseIds.has(entry.resolutionId)),
    ...history.moveUses.flatMap((use) => {
      const completion = completionFromUse(use)
      return completion && use.completion
        ? [{ order: use.completion.order, completion }]
        : []
    }).sort((left, right) => left.order - right.order).map(entry => entry.completion),
  ])
  const lastDeclaredByPlacement = new Map(
    declaredMoves.map(entry => [entry.actorPlacementId, entry]),
  )
  const lastCompletedByPlacement = new Map(
    completedMoves.map(entry => [entry.actorPlacementId, entry]),
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

  const forPlacement = <Value extends { readonly actorPlacementId: string }>(
    values: readonly Value[],
    placementId?: string,
  ): readonly Value[] => placementId === undefined
    ? values
    : values.filter(entry => entry.actorPlacementId === placementId)

  const resolver: MoveAutomationHistoryResolver = {
    lastDeclaredMove: placementId => latest(forPlacement(declaredMoves, placementId)),
    previousDeclaredMove: placementId => previous(forPlacement(declaredMoves, placementId)),
    lastCompletedMove: placementId => latest(forPlacement(completedMoves, placementId)),
    previousCompletedMove: placementId => previous(forPlacement(completedMoves, placementId)),
    declaredMovesThisScene: placementId => deepFreeze([
      ...forPlacement(declaredMoves, placementId),
    ]),
    completedMovesThisScene: placementId => deepFreeze([
      ...forPlacement(completedMoves, placementId),
    ]),
    usedMoveThisScene: (placementId, canonicalId) => completedMoves.some(entry => (
      entry.actorPlacementId === placementId && entry.canonicalId === canonicalId
    )),
    moveUse: resolutionId => moveUseByResolution.get(resolutionId) ?? null,
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
    consecutiveUseCount: (placementId, canonicalId, targetPlacementId) => {
      const entry = consecutiveByPlacement.get(placementId)
      if (!entry || (canonicalId !== undefined && entry.canonicalId !== canonicalId)) return 0
      if (
        targetPlacementId !== undefined
        && entry.targetPlacementId !== targetPlacementId
      ) return 0
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
