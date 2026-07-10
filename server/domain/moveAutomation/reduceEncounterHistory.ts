import {
  ENCOUNTER_HISTORY_LIMITS,
  createEmptyEncounterHistory,
  parseEncounterHistory,
  type EncounterCompletedMoveHistory,
  type EncounterConsecutiveMoveHistory,
  type EncounterDamageBySourceHistory,
  type EncounterDamagingMoveHistory,
  type EncounterDeclaredMoveHistory,
  type EncounterEventMoveLink,
  type EncounterHistory,
  type EncounterKnockoutHistory,
  type EncounterMoveAncestryHistory,
  type EncounterSwitchHistory,
} from '#shared/moveAutomation/encounterHistory'
import type {
  EncounterEvent,
  EncounterMoveIdentity,
  EncounterTurnEvent,
} from '#shared/moveAutomation/events'

export type EncounterHistoryReductionErrorCode =
  | 'history-limit-exceeded'
  | 'history-amount-overflow'
  | 'conflicting-event-link'
  | 'conflicting-move-ancestry'

export class EncounterHistoryReductionError extends Error {
  readonly code: EncounterHistoryReductionErrorCode

  constructor(code: EncounterHistoryReductionErrorCode, message: string) {
    super(message)
    this.name = 'EncounterHistoryReductionError'
    this.code = code
  }
}

const fail = (
  code: EncounterHistoryReductionErrorCode,
  message: string,
): never => {
  throw new EncounterHistoryReductionError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const appendBounded = <Value>(
  values: readonly Value[],
  value: Value,
  maximum: number,
  label: string,
): readonly Value[] => {
  if (values.length >= maximum) {
    return fail(
      'history-limit-exceeded',
      `${label} cannot exceed ${maximum} entries in its authoritative window.`,
    )
  }
  return [...values, value]
}

const appendRecent = <Value>(
  values: readonly Value[],
  value: Value,
  maximum: number,
): readonly Value[] => {
  if (maximum <= 0) return []
  const next = [...values, value]
  return next.length <= maximum ? next : next.slice(next.length - maximum)
}

const appendUniquePlacement = (
  values: readonly string[],
  placementId: string,
  label: string,
): readonly string[] => {
  if (values.includes(placementId)) return values
  return appendBounded(
    values,
    placementId,
    ENCOUNTER_HISTORY_LIMITS.placementIndexes,
    label,
  )
}

const upsertBy = <Value>(
  values: readonly Value[],
  value: Value,
  matches: (candidate: Value) => boolean,
  maximum: number,
  label: string,
): readonly Value[] => {
  const existingIndex = values.findIndex(matches)
  if (existingIndex < 0) return appendBounded(values, value, maximum, label)
  return [
    ...values.slice(0, existingIndex),
    ...values.slice(existingIndex + 1),
    value,
  ]
}

const safeAddDamage = (left: number, right: number, label: string): number => {
  const total = left + right
  if (!Number.isSafeInteger(total) || total > ENCOUNTER_HISTORY_LIMITS.amount) {
    return fail(
      'history-amount-overflow',
      `${label} exceeds the bounded safe-integer damage total.`,
    )
  }
  return total
}

const moveRecord = (
  event: Extract<EncounterEvent, {
    readonly kind:
      | 'move-declared'
      | 'move-hit'
      | 'move-damaged'
      | 'move-ko'
      | 'move-completed'
  }>,
): {
  readonly eventId: string
  readonly sourceOperationId: string
  readonly resolutionId: string
  readonly canonicalId: string
  readonly actorPlacementId: string
} => ({
  eventId: event.eventId,
  sourceOperationId: event.sourceOperationId,
  resolutionId: event.move.resolutionId,
  canonicalId: event.move.canonicalId,
  actorPlacementId: event.move.actorPlacementId,
})

const findResolutionForEvent = (
  history: EncounterHistory,
  eventId: string | null,
): string | null => {
  if (eventId === null) return null
  return history.eventMoveLinks.find(link => link.eventId === eventId)?.resolutionId ?? null
}

const replaceAncestry = (
  ancestry: readonly EncounterMoveAncestryHistory[],
  relation: EncounterMoveAncestryHistory,
): readonly EncounterMoveAncestryHistory[] => upsertBy(
  ancestry,
  relation,
  candidate => candidate.resolutionId === relation.resolutionId,
  ENCOUNTER_HISTORY_LIMITS.moveAncestryPerScene,
  'Encounter move ancestry',
)

const relationForMove = (
  history: EncounterHistory,
  move: EncounterMoveIdentity,
): EncounterMoveAncestryHistory => history.moveAncestry.find(
  relation => relation.resolutionId === move.resolutionId,
) ?? {
  resolutionId: move.resolutionId,
  parentResolutionId: null,
  childResolutionIds: [],
}

interface RecordedMoveEvent {
  readonly history: EncounterHistory
  readonly duplicate: boolean
}

/** Persist enough event identity to recover parent/child move resolution IDs. */
const recordMoveEvent = (
  history: EncounterHistory,
  event: Extract<EncounterEvent, {
    readonly kind:
      | 'move-declared'
      | 'move-hit'
      | 'move-damaged'
      | 'move-ko'
      | 'move-completed'
  }>,
): RecordedMoveEvent => {
  const existingLink = history.eventMoveLinks.find(link => link.eventId === event.eventId)
  if (existingLink) {
    if (existingLink.resolutionId !== event.move.resolutionId) {
      fail(
        'conflicting-event-link',
        `Encounter event ${event.eventId} is already linked to resolution ${existingLink.resolutionId}.`,
      )
    }
    return { history, duplicate: true }
  }

  const existingRelation = history.moveAncestry.find(
    relation => relation.resolutionId === event.move.resolutionId,
  )
  const causalResolutionId = findResolutionForEvent(history, event.causalParentEventId)
  const parentResolutionId = causalResolutionId === event.move.resolutionId
    ? null
    : causalResolutionId
  let ancestry = history.moveAncestry
  let relation = existingRelation ?? relationForMove(history, event.move)

  // Only the first retained event establishes move ancestry. A parent move may
  // resume after its child's completion, so a later causal edge back from that
  // child must not invert the already-established parent/child relationship.
  if (existingRelation === undefined && parentResolutionId !== null) {
    relation = { ...relation, parentResolutionId }

    const parent = ancestry.find(candidate => candidate.resolutionId === parentResolutionId)
      ?? fail(
        'conflicting-move-ancestry',
        `Causal parent resolution ${parentResolutionId} has no retained ancestry record.`,
      )
    if (!parent.childResolutionIds.includes(relation.resolutionId)) {
      const childResolutionIds = appendBounded(
        parent.childResolutionIds,
        relation.resolutionId,
        ENCOUNTER_HISTORY_LIMITS.childMoves,
        `Move resolution ${parentResolutionId} child list`,
      )
      ancestry = replaceAncestry(ancestry, { ...parent, childResolutionIds })
    }
  }

  ancestry = replaceAncestry(ancestry, relation)
  const link: EncounterEventMoveLink = {
    eventId: event.eventId,
    resolutionId: event.move.resolutionId,
  }
  return {
    duplicate: false,
    history: {
      ...history,
      moveAncestry: ancestry,
      // Event links are a lookup cache. Ancestry itself remains scene-bounded;
      // old event anchors may be pruned without deleting parent/child IDs.
      eventMoveLinks: appendRecent(
        history.eventMoveLinks,
        link,
        ENCOUNTER_HISTORY_LIMITS.eventMoveLinksPerScene,
      ),
    },
  }
}

const markActed = (
  history: EncounterHistory,
  placementId: string,
): EncounterHistory => ({
  ...history,
  actedThisTurnPlacementIds: appendUniquePlacement(
    history.actedThisTurnPlacementIds,
    placementId,
    'Turn acted-placement index',
  ),
  actedThisRoundPlacementIds: appendUniquePlacement(
    history.actedThisRoundPlacementIds,
    placementId,
    'Round acted-placement index',
  ),
})

const recordConsecutiveMove = (
  history: EncounterHistory,
  move: EncounterMoveIdentity,
): EncounterHistory => {
  const existing = history.consecutiveMoves.find(
    entry => entry.placementId === move.actorPlacementId,
  )
  if (existing?.lastResolutionId === move.resolutionId) return history

  const entry: EncounterConsecutiveMoveHistory = {
    placementId: move.actorPlacementId,
    canonicalId: move.canonicalId,
    count: existing?.canonicalId === move.canonicalId
      ? safeAddDamage(existing.count, 1, `Consecutive move count for ${move.actorPlacementId}`)
      : 1,
    lastResolutionId: move.resolutionId,
  }
  return {
    ...history,
    consecutiveMoves: upsertBy(
      history.consecutiveMoves,
      entry,
      candidate => candidate.placementId === entry.placementId,
      ENCOUNTER_HISTORY_LIMITS.placementIndexes,
      'Consecutive move index',
    ),
  }
}

const resetConsecutiveMoves = (
  history: EncounterHistory,
  placementIds: readonly string[],
): EncounterHistory => {
  const resetIds = new Set(placementIds)
  const consecutiveMoves = history.consecutiveMoves.filter(
    entry => !resetIds.has(entry.placementId),
  )
  return consecutiveMoves.length === history.consecutiveMoves.length
    ? history
    : { ...history, consecutiveMoves }
}

const upsertDamageAggregate = (
  values: readonly EncounterDamageBySourceHistory[],
  event: Extract<EncounterEvent, { readonly kind: 'move-damaged' }>,
  label: string,
): readonly EncounterDamageBySourceHistory[] => {
  const existing = values.find(entry => (
    entry.resolutionId === event.move.resolutionId
    && entry.targetPlacementId === event.targetPlacementId
  ))
  const next: EncounterDamageBySourceHistory = existing
    ? {
        ...existing,
        hitPointLoss: safeAddDamage(
          existing.hitPointLoss,
          event.damage.hitPointLoss,
          `${label} hit-point loss`,
        ),
        temporaryHitPointLoss: safeAddDamage(
          existing.temporaryHitPointLoss,
          event.damage.temporaryHitPointLoss,
          `${label} temporary-hit-point loss`,
        ),
      }
    : {
        resolutionId: event.move.resolutionId,
        canonicalId: event.move.canonicalId,
        sourcePlacementId: event.move.actorPlacementId,
        targetPlacementId: event.targetPlacementId,
        hitPointLoss: event.damage.hitPointLoss,
        temporaryHitPointLoss: event.damage.temporaryHitPointLoss,
      }

  if (existing && (
    existing.canonicalId !== event.move.canonicalId
    || existing.sourcePlacementId !== event.move.actorPlacementId
  )) {
    fail(
      'conflicting-event-link',
      `Damage resolution ${event.move.resolutionId} changed authoritative move identity.`,
    )
  }

  return upsertBy(
    values,
    next,
    entry => (
      entry.resolutionId === next.resolutionId
      && entry.targetPlacementId === next.targetPlacementId
    ),
    ENCOUNTER_HISTORY_LIMITS.damageSourcesPerWindow,
    label,
  )
}

const recordDeclaredMove = (
  history: EncounterHistory,
  event: Extract<EncounterEvent, { readonly kind: 'move-declared' }>,
): EncounterHistory => {
  const entry: EncounterDeclaredMoveHistory = {
    ...moveRecord(event),
    targetPlacementIds: [...event.targetPlacementIds],
  }
  const withDeclaration: EncounterHistory = {
    ...history,
    lastDeclaredMoves: upsertBy(
      history.lastDeclaredMoves,
      entry,
      candidate => candidate.actorPlacementId === event.move.actorPlacementId,
      ENCOUNTER_HISTORY_LIMITS.placementIndexes,
      'Last declared move index',
    ),
  }
  return recordConsecutiveMove(markActed(withDeclaration, event.move.actorPlacementId), event.move)
}

const recordCompletedMove = (
  history: EncounterHistory,
  event: Extract<EncounterEvent, { readonly kind: 'move-completed' }>,
): EncounterHistory => {
  const entry: EncounterCompletedMoveHistory = {
    ...moveRecord(event),
    attackedTargetIds: [...event.attackedTargetIds],
    hitTargetIds: [...event.hitTargetIds],
    outcome: event.outcome,
  }
  const withCompletion: EncounterHistory = {
    ...history,
    lastCompletedMoves: upsertBy(
      history.lastCompletedMoves,
      entry,
      candidate => candidate.actorPlacementId === event.move.actorPlacementId,
      ENCOUNTER_HISTORY_LIMITS.placementIndexes,
      'Last completed move index',
    ),
  }
  return recordConsecutiveMove(markActed(withCompletion, event.move.actorPlacementId), event.move)
}

const recordDamage = (
  history: EncounterHistory,
  event: Extract<EncounterEvent, { readonly kind: 'move-damaged' }>,
): EncounterHistory => {
  const entry: EncounterDamagingMoveHistory = {
    ...moveRecord(event),
    targetPlacementId: event.targetPlacementId,
    hitIndex: event.hitIndex,
    hitPointLoss: event.damage.hitPointLoss,
    temporaryHitPointLoss: event.damage.temporaryHitPointLoss,
    damageClass: event.damage.damageClass,
    moveType: event.damage.moveType,
  }
  return {
    ...history,
    lastDamagingMovesReceived: upsertBy(
      history.lastDamagingMovesReceived,
      entry,
      candidate => candidate.targetPlacementId === event.targetPlacementId,
      ENCOUNTER_HISTORY_LIMITS.placementIndexes,
      'Last damaging move received index',
    ),
    damageBySourceThisTurn: upsertDamageAggregate(
      history.damageBySourceThisTurn,
      event,
      'Turn damage-by-source index',
    ),
    damageBySourceThisRound: upsertDamageAggregate(
      history.damageBySourceThisRound,
      event,
      'Round damage-by-source index',
    ),
  }
}

const recordKnockout = (
  history: EncounterHistory,
  event: Extract<EncounterEvent, { readonly kind: 'move-ko' }>,
): EncounterHistory => {
  if (history.knockouts.some(entry => entry.eventId === event.eventId)) return history
  const entry: EncounterKnockoutHistory = {
    ...moveRecord(event),
    targetPlacementId: event.targetPlacementId,
    hitIndex: event.hitIndex,
  }
  const withKnockout: EncounterHistory = {
    ...history,
    faintedPlacementIds: appendUniquePlacement(
      history.faintedPlacementIds,
      event.targetPlacementId,
      'Scene fainted-placement index',
    ),
    knockouts: appendRecent(
      history.knockouts,
      entry,
      ENCOUNTER_HISTORY_LIMITS.knockoutsPerScene,
    ),
  }
  return resetConsecutiveMoves(withKnockout, [event.targetPlacementId])
}

const switchRecord = (
  event: Extract<EncounterEvent, {
    readonly kind: 'switch' | 'recall' | 'send-out'
  }>,
): EncounterSwitchHistory => {
  if (event.kind === 'switch') {
    return {
      eventId: event.eventId,
      sourceOperationId: event.sourceOperationId,
      kind: event.kind,
      recalledPlacementId: event.recalledPlacementId,
      sentOutPlacementId: event.sentOutPlacementId,
    }
  }
  return {
    eventId: event.eventId,
    sourceOperationId: event.sourceOperationId,
    kind: event.kind,
    recalledPlacementId: event.kind === 'recall' ? event.placementId : null,
    sentOutPlacementId: event.kind === 'send-out' ? event.placementId : null,
  }
}

const recordSwitch = (
  history: EncounterHistory,
  event: Extract<EncounterEvent, {
    readonly kind: 'switch' | 'recall' | 'send-out'
  }>,
): EncounterHistory => {
  if (history.switches.some(entry => entry.eventId === event.eventId)) return history
  const entry = switchRecord(event)
  const placementIds = [entry.recalledPlacementId, entry.sentOutPlacementId]
    .filter((placementId): placementId is string => placementId !== null)
  let switchedPlacementIds = history.switchedPlacementIds
  for (const placementId of placementIds) {
    switchedPlacementIds = appendUniquePlacement(
      switchedPlacementIds,
      placementId,
      'Scene switched-placement index',
    )
  }
  return resetConsecutiveMoves({
    ...history,
    switchedPlacementIds,
    switches: appendRecent(
      history.switches,
      entry,
      ENCOUNTER_HISTORY_LIMITS.switchesPerScene,
    ),
  }, placementIds)
}

const openRoundWindow = (
  history: EncounterHistory,
  round: number,
): EncounterHistory => ({
  ...history,
  currentRound: round,
  currentTurn: null,
  damageBySourceThisTurn: [],
  damageBySourceThisRound: [],
  actedThisTurnPlacementIds: [],
  actedThisRoundPlacementIds: [],
})

const openTurnWindow = (
  history: EncounterHistory,
  event: EncounterTurnEvent,
): EncounterHistory => {
  const inRound = history.currentRound === event.round
    ? history
    : openRoundWindow(history, event.round)
  return {
    ...inRound,
    currentTurn: {
      round: event.round,
      turn: event.turn,
      placementId: event.placementId,
    },
    damageBySourceThisTurn: [],
    actedThisTurnPlacementIds: [],
  }
}

/**
 * Reduce one authoritative fact into structured bounded history indexes.
 *
 * Callers should apply scene-end after scene-end trigger handlers so those
 * handlers can inspect the outgoing scene. Other facts are intended to update
 * history before handlers observe the event.
 */
export const reduceEncounterHistoryEvent = (
  historyValue: EncounterHistory,
  event: EncounterEvent,
): EncounterHistory => {
  let history = parseEncounterHistory(historyValue)

  if (event.kind === 'scene-start') {
    return deepFreeze({ ...createEmptyEncounterHistory(), sceneId: event.sceneId })
  }
  if (event.kind === 'scene-end') return deepFreeze(createEmptyEncounterHistory())
  if (event.kind === 'round-start') return deepFreeze(openRoundWindow(history, event.round))
  if (event.kind === 'turn-start') return deepFreeze(openTurnWindow(history, event))

  if (
    event.kind === 'move-declared'
    || event.kind === 'move-hit'
    || event.kind === 'move-damaged'
    || event.kind === 'move-ko'
    || event.kind === 'move-completed'
  ) {
    const recorded = recordMoveEvent(history, event)
    history = recorded.history
    if (recorded.duplicate) return deepFreeze(history)

    if (event.kind === 'move-declared') history = recordDeclaredMove(history, event)
    else if (event.kind === 'move-damaged') history = recordDamage(history, event)
    else if (event.kind === 'move-ko') history = recordKnockout(history, event)
    else if (event.kind === 'move-completed') history = recordCompletedMove(history, event)
    return deepFreeze(parseEncounterHistory(history))
  }

  if (event.kind === 'switch' || event.kind === 'recall' || event.kind === 'send-out') {
    return deepFreeze(parseEncounterHistory(recordSwitch(history, event)))
  }

  return deepFreeze(history)
}
