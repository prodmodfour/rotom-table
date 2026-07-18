import {
  parseEncounterHistory,
  type EncounterConsecutiveMoveHistory,
  type EncounterHistory,
} from '#shared/moveAutomation/encounterHistory'

export const FURY_CUTTER_CANONICAL_ID = 'Fury Cutter' as const
export const FURY_CUTTER_CHAIN_DETAIL_CODE = 'fury-cutter-chain' as const
/** The fourth qualifying hit reaches canonical DB 16; later hits remain capped. */
export const FURY_CUTTER_MAX_CHAIN_COUNT = 4 as const

export type FuryCutterChainOutcome =
  | 'advanced'
  | 'capped'
  | 'restarted-target-change'
  | 'reset-miss'
  | 'reset-no-damage'
  | 'duplicate'

export interface FuryCutterChainReduction {
  readonly history: EncounterHistory
  readonly changed: boolean
  readonly outcome: FuryCutterChainOutcome
  readonly actorPlacementId: string
  readonly targetPlacementId: string | null
  readonly previousTargetPlacementId: string | null
  readonly previousCount: number
  readonly currentCount: number
  readonly resolutionId: string
}

const existingFuryCutterChain = (
  history: EncounterHistory,
  actorPlacementId: string,
): EncounterConsecutiveMoveHistory | null => history.consecutiveMoves.find(entry => (
  entry.placementId === actorPlacementId
  && entry.canonicalId === FURY_CUTTER_CANONICAL_ID
)) ?? null

const historyWithoutActorChain = (
  history: EncounterHistory,
  actorPlacementId: string,
): EncounterHistory => ({
  ...history,
  consecutiveMoves: history.consecutiveMoves.filter(
    entry => entry.placementId !== actorPlacementId,
  ),
})

const historyWithActorChain = (
  history: EncounterHistory,
  chain: EncounterConsecutiveMoveHistory,
): EncounterHistory => ({
  ...history,
  consecutiveMoves: [
    ...history.consecutiveMoves.filter(entry => entry.placementId !== chain.placementId),
    chain,
  ],
})

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const immutableReduction = (
  reduction: Omit<FuryCutterChainReduction, 'history'> & { readonly history: EncounterHistory },
): FuryCutterChainReduction => deepFreeze({
  ...reduction,
  history: parseEncounterHistory(reduction.history),
})


/**
 * Reconcile one server-resolved Fury Cutter completion. A chain advances only
 * after an accuracy hit causes actual HP or temporary-HP loss to the same
 * target. Misses and prevented/no-op damage remove it; target changes restart
 * from the first successful hit. The resolution identity makes replay a no-op.
 */
export const reduceFuryCutterChainCompletion = (input: {
  readonly history: EncounterHistory
  readonly actorPlacementId: string
  readonly attackedTargetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly damagedTargetIds: readonly string[]
  readonly resolutionId: string
}): FuryCutterChainReduction => {
  const history = parseEncounterHistory(input.history)
  const existing = existingFuryCutterChain(history, input.actorPlacementId)
  const targetPlacementId = input.attackedTargetIds.length === 1
    ? input.attackedTargetIds[0] ?? null
    : null
  const previousCount = existing?.count ?? 0
  const previousTargetPlacementId = existing?.targetPlacementId ?? null

  if (existing?.lastResolutionId === input.resolutionId) {
    return immutableReduction({
      history,
      changed: false,
      outcome: 'duplicate',
      actorPlacementId: input.actorPlacementId,
      targetPlacementId,
      previousTargetPlacementId,
      previousCount,
      currentCount: previousCount,
      resolutionId: input.resolutionId,
    })
  }

  const hit = targetPlacementId !== null && input.hitTargetIds.includes(targetPlacementId)
  const damaged = targetPlacementId !== null
    && input.damagedTargetIds.includes(targetPlacementId)
  if (!hit || !damaged) {
    const resetHistory = existing
      ? historyWithoutActorChain(history, input.actorPlacementId)
      : history
    return immutableReduction({
      history: resetHistory,
      changed: existing !== null,
      outcome: hit ? 'reset-no-damage' : 'reset-miss',
      actorPlacementId: input.actorPlacementId,
      targetPlacementId,
      previousTargetPlacementId,
      previousCount,
      currentCount: 0,
      resolutionId: input.resolutionId,
    })
  }

  const continued = existing?.targetPlacementId === targetPlacementId
  const currentCount = continued
    ? Math.min(FURY_CUTTER_MAX_CHAIN_COUNT, existing.count + 1)
    : 1
  const next: EncounterConsecutiveMoveHistory = {
    placementId: input.actorPlacementId,
    canonicalId: FURY_CUTTER_CANONICAL_ID,
    targetPlacementId,
    count: currentCount,
    lastResolutionId: input.resolutionId,
  }
  return immutableReduction({
    history: historyWithActorChain(history, next),
    changed: existing === null
      || existing.targetPlacementId !== next.targetPlacementId
      || existing.count !== next.count
      || existing.lastResolutionId !== next.lastResolutionId,
    outcome: existing && !continued
      ? 'restarted-target-change'
      : continued && existing.count >= FURY_CUTTER_MAX_CHAIN_COUNT
        ? 'capped'
        : 'advanced',
    actorPlacementId: input.actorPlacementId,
    targetPlacementId,
    previousTargetPlacementId,
    previousCount,
    currentCount,
    resolutionId: input.resolutionId,
  })
}

/** Any intervening authoritative move by the actor breaks Fury Cutter's chain. */
export const resetFuryCutterChainForDifferentMove = (input: {
  readonly history: EncounterHistory
  readonly actorPlacementId: string
  readonly canonicalMoveId: string
}): { readonly history: EncounterHistory; readonly changed: boolean } => {
  const history = parseEncounterHistory(input.history)
  if (input.canonicalMoveId === FURY_CUTTER_CANONICAL_ID) {
    return deepFreeze({ history, changed: false })
  }
  const existing = existingFuryCutterChain(history, input.actorPlacementId)
  if (!existing) return deepFreeze({ history, changed: false })
  return deepFreeze({
    history: parseEncounterHistory(
      historyWithoutActorChain(history, input.actorPlacementId),
    ),
    changed: true,
  })
}
