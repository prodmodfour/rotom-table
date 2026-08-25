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
  type EncounterKnockoutReplacementHistory,
  type EncounterLifecycleKnockoutHistory,
  type EncounterMoveAncestryHistory,
  type EncounterMoveUseHistory,
  type EncounterRoundBoundaryHistory,
  type EncounterSwitchHistory,
} from '#shared/moveAutomation/encounterHistory'
import { moveHistoryIdentitiesEqual } from '#shared/moveAutomation/moveHistoryMetadata'
import type {
  EncounterEvent,
  EncounterMoveIdentity,
  EncounterRoundEvent,
  EncounterTurnEvent,
} from '#shared/moveAutomation/events'
import {
  FURY_CUTTER_CANONICAL_ID,
  reduceFuryCutterChainCompletion,
} from './furyCutter'

export type EncounterHistoryReductionErrorCode =
  | 'history-limit-exceeded'
  | 'history-amount-overflow'
  | 'conflicting-event-link'
  | 'conflicting-move-ancestry'
  | 'conflicting-move-identity'
  | 'conflicting-move-lifecycle'

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
): Omit<EncounterDeclaredMoveHistory, 'targetPlacementIds'> => ({
  eventId: event.eventId,
  sourceOperationId: event.sourceOperationId,
  resolutionId: event.move.resolutionId,
  canonicalId: event.move.canonicalId,
  specVersion: event.move.specVersion,
  actorPlacementId: event.move.actorPlacementId,
  actionType: event.move.actionType,
  origin: event.move.origin,
  moveListSource: event.move.moveListSource,
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

const moveUseFor = (
  history: EncounterHistory,
  resolutionId: string,
): EncounterMoveUseHistory | null => history.moveUses.find(
  use => use.resolutionId === resolutionId,
) ?? null

const assertMoveIdentity = (
  use: EncounterMoveUseHistory,
  move: EncounterMoveIdentity,
): void => {
  if (moveHistoryIdentitiesEqual(use, move)) return
  fail(
    'conflicting-move-identity',
    `Move resolution ${move.resolutionId} changed canonical identity, version, actor, action, origin, or move-list source.`,
  )
}

const recordMoveUseIdentity = (
  history: EncounterHistory,
  move: EncounterMoveIdentity,
): EncounterHistory => {
  const existing = moveUseFor(history, move.resolutionId)
  if (existing) {
    assertMoveIdentity(existing, move)
    return history
  }
  const use: EncounterMoveUseHistory = {
    ...move,
    declaration: null,
    completion: null,
  }
  return {
    ...history,
    moveUses: appendBounded(
      history.moveUses,
      use,
      ENCOUNTER_HISTORY_LIMITS.moveUsesPerScene,
      'Scene move-use index',
    ),
  }
}

const replaceMoveUse = (
  history: EncounterHistory,
  use: EncounterMoveUseHistory,
): EncounterHistory => ({
  ...history,
  moveUses: upsertBy(
    history.moveUses,
    use,
    candidate => candidate.resolutionId === use.resolutionId,
    ENCOUNTER_HISTORY_LIMITS.moveUsesPerScene,
    'Scene move-use index',
  ),
})

const nextMoveUseOrder = (
  history: EncounterHistory,
  phase: 'declaration' | 'completion',
): number => safeAddDamage(
  history.moveUses.reduce((maximum, use) => (
    Math.max(maximum, use[phase]?.order ?? 0)
  ), 0),
  1,
  `Scene move ${phase} order`,
)

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
    const existingUse = moveUseFor(history, event.move.resolutionId)
    if (existingUse) assertMoveIdentity(existingUse, event.move)
    return { history, duplicate: true }
  }

  const withIdentity = recordMoveUseIdentity(history, event.move)
  const existingRelation = withIdentity.moveAncestry.find(
    relation => relation.resolutionId === event.move.resolutionId,
  )
  const causalResolutionId = findResolutionForEvent(withIdentity, event.causalParentEventId)
  const parentResolutionId = causalResolutionId === event.move.resolutionId
    ? null
    : causalResolutionId
  let ancestry = withIdentity.moveAncestry
  let relation = existingRelation ?? relationForMove(withIdentity, event.move)

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
      ...withIdentity,
      moveAncestry: ancestry,
      // Event links are a lookup cache. Ancestry itself remains scene-bounded;
      // old event anchors may be pruned without deleting parent/child IDs.
      eventMoveLinks: appendRecent(
        withIdentity.eventMoveLinks,
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

const soleTargetPlacementId = (targetPlacementIds: readonly string[]): string | null => (
  targetPlacementIds.length === 1 ? targetPlacementIds[0] ?? null : null
)

const prepareConsecutiveMoveDeclaration = (
  history: EncounterHistory,
  move: EncounterMoveIdentity,
  targetPlacementIds: readonly string[],
): EncounterHistory => {
  const existing = history.consecutiveMoves.find(
    entry => entry.placementId === move.actorPlacementId,
  )
  if (!existing || existing.lastResolutionId === move.resolutionId) return history
  const targetPlacementId = soleTargetPlacementId(targetPlacementIds)
  if (
    existing.canonicalId === move.canonicalId
    && existing.targetPlacementId === targetPlacementId
  ) return history
  return resetConsecutiveMoves(history, [move.actorPlacementId])
}

const recordConsecutiveMove = (
  history: EncounterHistory,
  move: EncounterMoveIdentity,
  targetPlacementId: string | null,
): EncounterHistory => {
  const existing = history.consecutiveMoves.find(
    entry => entry.placementId === move.actorPlacementId,
  )
  if (existing?.lastResolutionId === move.resolutionId) return history

  const entry: EncounterConsecutiveMoveHistory = {
    placementId: move.actorPlacementId,
    canonicalId: move.canonicalId,
    targetPlacementId,
    count: existing?.canonicalId === move.canonicalId
      && existing.targetPlacementId === targetPlacementId
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
  const consecutiveMoves = history.consecutiveMoves.filter(entry => (
    !resetIds.has(entry.placementId)
    && (entry.targetPlacementId === null || !resetIds.has(entry.targetPlacementId))
  ))
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
  const use = moveUseFor(history, event.move.resolutionId)
    ?? fail(
      'conflicting-move-lifecycle',
      `Move resolution ${event.move.resolutionId} has no retained move-use identity.`,
    )
  if (use.declaration !== null) {
    fail(
      'conflicting-move-lifecycle',
      `Move resolution ${event.move.resolutionId} was declared more than once.`,
    )
  }
  const withUse = replaceMoveUse(history, {
    ...use,
    declaration: {
      eventId: event.eventId,
      sourceOperationId: event.sourceOperationId,
      round: history.currentRound,
      order: nextMoveUseOrder(history, 'declaration'),
      targetPlacementIds: [...event.targetPlacementIds],
    },
  })
  const entry: EncounterDeclaredMoveHistory = {
    ...moveRecord(event),
    targetPlacementIds: [...event.targetPlacementIds],
  }
  const withDeclaration: EncounterHistory = {
    ...withUse,
    lastDeclaredMoves: upsertBy(
      withUse.lastDeclaredMoves,
      entry,
      candidate => candidate.actorPlacementId === event.move.actorPlacementId,
      ENCOUNTER_HISTORY_LIMITS.placementIndexes,
      'Last declared move index',
    ),
  }
  const marked = markActed(withDeclaration, event.move.actorPlacementId)
  if (event.move.canonicalId === FURY_CUTTER_CANONICAL_ID) {
    return prepareConsecutiveMoveDeclaration(
      marked,
      event.move,
      event.targetPlacementIds,
    )
  }
  return recordConsecutiveMove(
    marked,
    event.move,
    soleTargetPlacementId(event.targetPlacementIds),
  )
}

const recordCompletedMove = (
  history: EncounterHistory,
  event: Extract<EncounterEvent, { readonly kind: 'move-completed' }>,
): EncounterHistory => {
  const use = moveUseFor(history, event.move.resolutionId)
    ?? fail(
      'conflicting-move-lifecycle',
      `Move resolution ${event.move.resolutionId} has no retained move-use identity.`,
    )
  if (use.completion !== null) {
    fail(
      'conflicting-move-lifecycle',
      `Move resolution ${event.move.resolutionId} completed more than once.`,
    )
  }
  if (use.declaration === null) {
    fail(
      'conflicting-move-lifecycle',
      `Move resolution ${event.move.resolutionId} completed before it was declared.`,
    )
  }
  const withUse = replaceMoveUse(history, {
    ...use,
    completion: {
      eventId: event.eventId,
      sourceOperationId: event.sourceOperationId,
      round: history.currentRound,
      order: nextMoveUseOrder(history, 'completion'),
      attackedTargetIds: [...event.attackedTargetIds],
      hitTargetIds: [...event.hitTargetIds],
      outcome: event.outcome,
      succeeded: event.succeeded,
      branches: event.branches.map(branch => ({ ...branch })),
    },
  })
  const entry: EncounterCompletedMoveHistory = {
    ...moveRecord(event),
    attackedTargetIds: [...event.attackedTargetIds],
    hitTargetIds: [...event.hitTargetIds],
    outcome: event.outcome,
    succeeded: event.succeeded,
    branches: event.branches.map(branch => ({ ...branch })),
  }
  const withCompletion: EncounterHistory = markActed({
    ...withUse,
    lastCompletedMoves: upsertBy(
      withUse.lastCompletedMoves,
      entry,
      candidate => candidate.actorPlacementId === event.move.actorPlacementId,
      ENCOUNTER_HISTORY_LIMITS.placementIndexes,
      'Last completed move index',
    ),
  }, event.move.actorPlacementId)
  if (event.move.canonicalId === FURY_CUTTER_CANONICAL_ID) {
    const damagedTargetIds = withCompletion.damageBySourceThisTurn
      .filter(damage => (
        damage.resolutionId === event.move.resolutionId
        && damage.hitPointLoss + damage.temporaryHitPointLoss > 0
      ))
      .map(damage => damage.targetPlacementId)
    return reduceFuryCutterChainCompletion({
      history: withCompletion,
      actorPlacementId: event.move.actorPlacementId,
      attackedTargetIds: event.attackedTargetIds,
      hitTargetIds: event.hitTargetIds,
      damagedTargetIds,
      resolutionId: event.move.resolutionId,
    }).history
  }
  return withCompletion
}

const recordDamage = (
  history: EncounterHistory,
  event: Extract<EncounterEvent, { readonly kind: 'move-damaged' }>,
): EncounterHistory => {
  const entry: EncounterDamagingMoveHistory = {
    ...moveRecord(event),
    round: history.currentRound,
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
    round: history.currentRound,
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

const recordLifecycleKnockout = (
  history: EncounterHistory,
  event: Extract<EncounterEvent, { readonly kind: 'lifecycle-ko' }>,
): EncounterHistory => {
  if (history.lifecycleKnockouts.some(entry => entry.eventId === event.eventId)) return history
  const entry: EncounterLifecycleKnockoutHistory = {
    eventId: event.eventId,
    sourceOperationId: event.sourceOperationId,
    sourceEffectOperationId: event.sourceEffectOperationId,
    round: event.round,
    targetPlacementId: event.targetPlacementId,
    cause: event.cause,
  }
  const withKnockout: EncounterHistory = {
    ...history,
    faintedPlacementIds: appendUniquePlacement(
      history.faintedPlacementIds,
      event.targetPlacementId,
      'Scene fainted-placement index',
    ),
    lifecycleKnockouts: appendRecent(
      history.lifecycleKnockouts,
      entry,
      ENCOUNTER_HISTORY_LIMITS.lifecycleKnockoutsPerScene,
    ),
  }
  return resetConsecutiveMoves(withKnockout, [event.targetPlacementId])
}

const switchRecord = (
  history: EncounterHistory,
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
      sideId: event.sideId,
      round: history.currentRound,
      causalProviderId: event.causalProviderId,
    }
  }
  return {
    eventId: event.eventId,
    sourceOperationId: event.sourceOperationId,
    kind: event.kind,
    recalledPlacementId: event.kind === 'recall' ? event.placementId : null,
    sentOutPlacementId: event.kind === 'send-out' ? event.placementId : null,
    sideId: event.sideId,
    round: history.currentRound,
    causalProviderId: event.causalProviderId,
  }
}

const knockoutReplacementFor = (
  history: EncounterHistory,
  entry: EncounterSwitchHistory,
): EncounterKnockoutReplacementHistory | null => {
  if (entry.sentOutPlacementId === null || entry.sideId === null) return null
  const usedKnockouts = new Set(history.knockoutReplacements.map(replacement => replacement.knockoutEventId))
  const knockedOutPlacementId = entry.kind === 'switch'
    ? entry.recalledPlacementId
    : [...history.switches].reverse().find(candidate => candidate.kind === 'recall'
        && candidate.sideId === entry.sideId
        && candidate.recalledPlacementId !== null
        && !history.knockoutReplacements.some(replacement => replacement.knockedOutPlacementId === candidate.recalledPlacementId))?.recalledPlacementId ?? null
  if (knockedOutPlacementId === null || !history.faintedPlacementIds.includes(knockedOutPlacementId)) return null
  const knockoutMatches = [...history.knockouts, ...history.lifecycleKnockouts].filter(candidate => (
    candidate.targetPlacementId === knockedOutPlacementId && !usedKnockouts.has(candidate.eventId)
  ))
  if (knockoutMatches.length !== 1) return null
  const knockout = knockoutMatches[0]!
  return {
    replacementEventId: entry.eventId,
    sourceOperationId: entry.sourceOperationId,
    knockoutEventId: knockout.eventId,
    knockedOutPlacementId,
    replacementPlacementId: entry.sentOutPlacementId,
    sideId: entry.sideId,
    sentOutRound: entry.round,
    firstTurnEventId: null,
    firstActingRound: null,
    firstActingTurn: null,
  }
}

const recordSwitch = (
  history: EncounterHistory,
  event: Extract<EncounterEvent, {
    readonly kind: 'switch' | 'recall' | 'send-out'
  }>,
): EncounterHistory => {
  if (history.switches.some(entry => entry.eventId === event.eventId)) return history
  const entry = switchRecord(history, event)
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
  const replacement = knockoutReplacementFor(history, entry)
  return resetConsecutiveMoves({
    ...history,
    switchedPlacementIds,
    switches: appendRecent(
      history.switches,
      entry,
      ENCOUNTER_HISTORY_LIMITS.switchesPerScene,
    ),
    knockoutReplacements: replacement
      ? appendRecent(history.knockoutReplacements, replacement, ENCOUNTER_HISTORY_LIMITS.replacementsPerScene)
      : history.knockoutReplacements,
  }, placementIds)
}

const recordRoundEnd = (
  history: EncounterHistory,
  event: EncounterRoundEvent,
): EncounterHistory => {
  if (history.roundBoundaries.some(entry => entry.eventId === event.eventId)) return history
  const entry: EncounterRoundBoundaryHistory = {
    eventId: event.eventId,
    sourceOperationId: event.sourceOperationId,
    completedRound: event.round,
    nextRound: null,
    nextRoundEventId: null,
  }
  return {
    ...history,
    roundBoundaries: appendRecent(history.roundBoundaries, entry, ENCOUNTER_HISTORY_LIMITS.roundBoundariesPerScene),
  }
}

const openRoundWindow = (
  history: EncounterHistory,
  round: number,
  event?: EncounterRoundEvent,
): EncounterHistory => ({
  ...history,
  currentRound: round,
  currentTurn: null,
  roundBoundaries: event
    ? history.roundBoundaries.map(entry => entry.sourceOperationId === event.sourceOperationId
        && entry.completedRound + 1 === round && entry.nextRound === null
      ? { ...entry, nextRound: round, nextRoundEventId: event.eventId }
      : entry)
    : history.roundBoundaries,
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
  const knockoutReplacements = inRound.knockoutReplacements.map(replacement => (
    replacement.replacementPlacementId === event.placementId && replacement.firstTurnEventId === null
      ? {
          ...replacement,
          firstTurnEventId: event.eventId,
          firstActingRound: event.round,
          firstActingTurn: event.turn,
        }
      : replacement
  ))
  return {
    ...inRound,
    currentTurn: {
      round: event.round,
      turn: event.turn,
      placementId: event.placementId,
    },
    knockoutReplacements,
    damageBySourceThisTurn: [],
    actedThisTurnPlacementIds: [],
  }
}

/**
 * Reduce one authoritative fact into structured bounded history indexes.
 *
 * Callers should apply scene-end and encounter-end after their trigger handlers
 * so those handlers can inspect the outgoing history. Other facts update
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
  if (event.kind === 'scene-end' || event.kind === 'encounter-end') {
    return deepFreeze(createEmptyEncounterHistory())
  }
  if (event.kind === 'round-end') return deepFreeze(parseEncounterHistory(recordRoundEnd(history, event)))
  if (event.kind === 'round-start') return deepFreeze(parseEncounterHistory(openRoundWindow(history, event.round, event)))
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

  if (event.kind === 'lifecycle-ko') {
    return deepFreeze(parseEncounterHistory(recordLifecycleKnockout(history, event)))
  }

  if (event.kind === 'switch' || event.kind === 'recall' || event.kind === 'send-out') {
    return deepFreeze(parseEncounterHistory(recordSwitch(history, event)))
  }

  return deepFreeze(history)
}
