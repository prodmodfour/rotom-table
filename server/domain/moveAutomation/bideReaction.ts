import type { MoveDirectHpEffectOperation } from '#shared/moveAutomation/effects'
import { moveCounterReactionDefinition } from './counterReactionDefinitions'
import {
  MOVE_COUNTER_REACTION_LIMITS,
  assertCounterPlacement,
  assertCounterStableId,
  canonicalCounterPlacementIds,
  createCounterDirectHpOperation,
  createReactionAncestryLink,
  createReactionUsageSpend,
  deepFreezeCounterReaction,
  failCounterReaction,
  safeAddCounterHp,
  sameRecordedDamage,
  uniqueRecordedDamage,
  type MoveCounterReactionAuthority,
  type MoveReactionResolutionLink,
  type MoveReactionUsageSpend,
  type MoveRecordedEffectiveDamage,
} from './counterReactionCore'

export interface MoveBideStorageState {
  readonly status: 'storing' | 'released'
  readonly reactionOperationId: string
  readonly resolutionId: string
  readonly userPlacementId: string
  readonly triggeringResolutionId: string
  readonly ancestry: MoveReactionResolutionLink
  readonly declaredTurn: number
  readonly executeTurn: number
  readonly damageRecords: readonly MoveRecordedEffectiveDamage[]
  readonly storedEffectiveHpLoss: number
  readonly usageSpend: MoveReactionUsageSpend
  readonly release: {
    readonly operation: MoveDirectHpEffectOperation
    readonly recipientIds: readonly string[]
    readonly releasedTurn: number
  } | null
}

const bideDamageTotal = (
  records: readonly MoveRecordedEffectiveDamage[],
  userPlacementId: string,
): number => {
  let total = 0
  for (const record of records) {
    if (record.targetPlacementId !== userPlacementId) {
      return failCounterReaction(
        'invalid-damage-record',
        'Bide may store only damage received by its user.',
      )
    }
    total = safeAddCounterHp(total, record.effectiveHpLoss, 'Bide stored effective HP loss')
  }
  return total
}

/** Open a durable, typed Bide accumulator linked as a child of its trigger. */
export const createMoveBideStorage = (input: {
  readonly authority: MoveCounterReactionAuthority
  readonly userPlacementId: string
  readonly reactionOperationId: string
  readonly resolutionId: string
  readonly declaredTurn: number
  readonly executeTurn: number
  readonly triggeringDamageRecords: readonly MoveRecordedEffectiveDamage[]
}): MoveBideStorageState => {
  assertCounterPlacement(input.authority, input.userPlacementId, 'Bide user')
  const reactionOperationId = assertCounterStableId(
    input.reactionOperationId,
    'reaction operation ID',
  )
  const resolutionId = assertCounterStableId(input.resolutionId, 'reaction resolution ID')
  if (
    !Number.isSafeInteger(input.declaredTurn)
    || input.declaredTurn < 0
    || !Number.isSafeInteger(input.executeTurn)
    || input.executeTurn <= input.declaredTurn
  ) {
    return failCounterReaction(
      'invalid-plan',
      'Bide executeTurn must be a later authoritative turn.',
    )
  }
  const records = uniqueRecordedDamage(input.triggeringDamageRecords)
  const triggeringResolutionId = records[0]!.resolutionId
  if (records.some(record => record.resolutionId !== triggeringResolutionId)) {
    return failCounterReaction(
      'invalid-damage-record',
      'Bide trigger records must belong to one move resolution.',
    )
  }
  const storedEffectiveHpLoss = bideDamageTotal(records, input.userPlacementId)
  return deepFreezeCounterReaction({
    status: 'storing',
    reactionOperationId,
    resolutionId,
    userPlacementId: input.userPlacementId,
    triggeringResolutionId,
    ancestry: createReactionAncestryLink(triggeringResolutionId, resolutionId),
    declaredTurn: input.declaredTurn,
    executeTurn: input.executeTurn,
    damageRecords: [...records],
    storedEffectiveHpLoss,
    usageSpend: createReactionUsageSpend({
      reactionOperationId,
      ownerPlacementId: input.userPlacementId,
      canonicalMoveId: 'Bide',
    }),
    release: null,
  })
}

/** Accumulate later authoritative move damage; exact event replay adds nothing. */
export const recordMoveBideDamage = (
  state: MoveBideStorageState,
  damageRecords: readonly MoveRecordedEffectiveDamage[],
): MoveBideStorageState => {
  if (state.status !== 'storing') {
    return failCounterReaction('invalid-plan', 'Released Bide storage cannot accept more damage.')
  }
  const incoming = uniqueRecordedDamage(damageRecords)
  const merged = new Map(state.damageRecords.map(record => [record.eventId, record]))
  for (const record of incoming) {
    if (record.targetPlacementId !== state.userPlacementId) {
      return failCounterReaction(
        'invalid-damage-record',
        'Bide may store only damage received by its user.',
      )
    }
    const existing = merged.get(record.eventId)
    if (existing && !sameRecordedDamage(existing, record)) {
      return failCounterReaction(
        'damage-record-conflict',
        `Bide damage event ${record.eventId} changed.`,
      )
    }
    if (!existing) merged.set(record.eventId, record)
  }
  const records = [...merged.values()]
  if (records.length > MOVE_COUNTER_REACTION_LIMITS.damageRecords) {
    return failCounterReaction('limit-exceeded', 'Bide damage storage exceeds the hit bound.')
  }
  if (records.length === state.damageRecords.length) return state
  return deepFreezeCounterReaction({
    ...state,
    damageRecords: records,
    storedEffectiveHpLoss: bideDamageTotal(records, state.userPlacementId),
  })
}

export type ReleaseMoveBideResult =
  | {
      readonly status: 'released'
      readonly reasonCode: 'bide.stored-damage-released'
      readonly state: MoveBideStorageState
    }
  | {
      readonly status: 'duplicate'
      readonly reasonCode: 'bide.release-duplicate'
      readonly state: MoveBideStorageState
    }

/** Release stored damage only on the scheduled turn and only to adjacent enemies. */
export const releaseMoveBide = (input: {
  readonly authority: MoveCounterReactionAuthority
  readonly state: MoveBideStorageState
  readonly currentTurn: number
  readonly authoritativeAdjacentPlacementIds: readonly string[]
}): ReleaseMoveBideResult => {
  if (input.state.status === 'released') {
    return Object.freeze({
      status: 'duplicate',
      reasonCode: 'bide.release-duplicate',
      state: input.state,
    })
  }
  if (input.currentTurn !== input.state.executeTurn) {
    return failCounterReaction(
      'not-ready',
      `Bide is scheduled for turn ${input.state.executeTurn}, not ${input.currentTurn}.`,
    )
  }
  const adjacent = canonicalCounterPlacementIds(
    input.authority,
    input.authoritativeAdjacentPlacementIds,
    'authoritativeAdjacentPlacementIds',
  )
  const recipientIds = adjacent.filter(placementId => (
    input.authority.relationships.resolve(input.state.userPlacementId, placementId).relationship
      === 'enemy'
  ))
  const definition = moveCounterReactionDefinition('Bide')
  const operation = createCounterDirectHpOperation({
    operationId: input.state.reactionOperationId,
    definitionId: definition.definitionId,
    amount: input.state.storedEffectiveHpLoss,
    recipients: 'area-targets',
    applyTypeImmunity: false,
  })
  const state: MoveBideStorageState = deepFreezeCounterReaction({
    ...input.state,
    status: 'released',
    release: {
      operation,
      recipientIds,
      releasedTurn: input.currentTurn,
    },
  })
  return Object.freeze({
    status: 'released',
    reasonCode: 'bide.stored-damage-released',
    state,
  })
}
