import {
  MOVE_EFFECT_OPERATION_LIMITS,
  parseMoveEffectOperation,
  type MoveDirectHpEffectOperation,
  type MoveEffectRecipientSelectorKind,
} from '#shared/moveAutomation/effects'
import {
  parseEncounterEvent,
  type EncounterMoveDamagedEvent,
} from '#shared/moveAutomation/events'
import type { MoveAutomationRelationshipResolver } from './relationships'
import {
  moveCounterReactionDefinition,
  type MoveCounterReactionCanonicalId,
} from './counterReactionDefinitions'
import { stableJsonStringify } from './stableJson'

export const MOVE_COUNTER_REACTION_LIMITS = Object.freeze({
  placements: 64,
  effects: MOVE_EFFECT_OPERATION_LIMITS.operations,
  damageRecords: 100,
  applications: 32,
  operationIdLength: 128,
})

export interface MoveCounterReactionAuthority {
  /** Complete server placement order used to canonicalize all recipients. */
  readonly placementIds: readonly string[]
  readonly relationships: MoveAutomationRelationshipResolver
  readonly isTypeImmune: (placementId: string, moveType: string) => boolean
}

export interface MoveReactionResolutionLink {
  readonly parentResolutionId: string
  readonly childResolutionId: string
}

export interface MoveReactionUsageSpend {
  readonly kind: 'move-usage-spend'
  readonly reactionOperationId: string
  readonly ownerPlacementId: string
  readonly canonicalMoveId: MoveCounterReactionCanonicalId
  readonly resourceId: string
  readonly amount: 1
}

/** Actual post-prevention loss from one authoritative move-damaged fact. */
export interface MoveRecordedEffectiveDamage {
  readonly eventId: string
  readonly sourceOperationId: string
  readonly resolutionId: string
  readonly canonicalMoveId: string
  readonly sourcePlacementId: string
  readonly targetPlacementId: string
  readonly hitIndex: number
  readonly hitPointLoss: number
  readonly temporaryHitPointLoss: number
  readonly effectiveHpLoss: number
  readonly damageClass: 'physical' | 'special' | 'direct'
  readonly moveType: string | null
}

export type MoveCounterReactionErrorCode =
  | 'invalid-authority'
  | 'invalid-operation-id'
  | 'invalid-resolution-id'
  | 'placement-not-found'
  | 'invalid-damage-record'
  | 'damage-record-conflict'
  | 'reaction-identity-conflict'
  | 'invalid-plan'
  | 'not-ready'
  | 'limit-exceeded'

export class MoveCounterReactionError extends Error {
  readonly code: MoveCounterReactionErrorCode

  constructor(code: MoveCounterReactionErrorCode, message: string) {
    super(message)
    this.name = 'MoveCounterReactionError'
    this.code = code
  }
}

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/

export const failCounterReaction = (
  code: MoveCounterReactionErrorCode,
  message: string,
): never => {
  throw new MoveCounterReactionError(code, message)
}

export const deepFreezeCounterReaction = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreezeCounterReaction((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

export const assertCounterStableId = (
  value: unknown,
  label: string,
  maximum = MOVE_COUNTER_REACTION_LIMITS.operationIdLength,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || !STABLE_ID_PATTERN.test(value)
  ) {
    return failCounterReaction(
      label.includes('resolution') ? 'invalid-resolution-id' : 'invalid-operation-id',
      `${label} must be a bounded lowercase stable ID.`,
    )
  }
  return value
}

export const counterReactionAuthorityOrder = (
  authority: MoveCounterReactionAuthority,
): readonly string[] => {
  if (!Array.isArray(authority.placementIds)) {
    return failCounterReaction(
      'invalid-authority',
      'Counter reaction authority placementIds must be an array.',
    )
  }
  if (authority.placementIds.length > MOVE_COUNTER_REACTION_LIMITS.placements) {
    return failCounterReaction(
      'limit-exceeded',
      'Counter reaction authority exceeds the placement bound.',
    )
  }
  const seen = new Set<string>()
  for (const id of authority.placementIds) {
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) {
      return failCounterReaction(
        'invalid-authority',
        'Counter reaction authority has an invalid placement ID.',
      )
    }
    seen.add(id)
  }
  if (!authority.relationships || typeof authority.relationships.resolve !== 'function') {
    return failCounterReaction(
      'invalid-authority',
      'Counter reaction authority requires relationship queries.',
    )
  }
  if (typeof authority.isTypeImmune !== 'function') {
    return failCounterReaction(
      'invalid-authority',
      'Counter reaction authority requires a type-immunity query.',
    )
  }
  return authority.placementIds
}

export const assertCounterPlacement = (
  authority: MoveCounterReactionAuthority,
  placementId: string,
  label: string,
): string => counterReactionAuthorityOrder(authority).includes(placementId)
  ? placementId
  : failCounterReaction('placement-not-found', `${label} ${placementId} is not authoritative.`)

export const canonicalCounterPlacementIds = (
  authority: MoveCounterReactionAuthority,
  placementIds: readonly string[],
  label: string,
): readonly string[] => {
  if (!Array.isArray(placementIds)) {
    return failCounterReaction('invalid-plan', `${label} must be an array.`)
  }
  if (placementIds.length > MOVE_COUNTER_REACTION_LIMITS.placements) {
    return failCounterReaction('limit-exceeded', `${label} exceeds the placement bound.`)
  }
  const requested = new Set<string>()
  for (const id of placementIds) {
    if (typeof id !== 'string' || !id.trim()) {
      return failCounterReaction('invalid-plan', `${label} has an invalid placement ID.`)
    }
    requested.add(id)
  }
  const ordered = counterReactionAuthorityOrder(authority).filter(id => requested.delete(id))
  if (requested.size > 0) {
    return failCounterReaction(
      'placement-not-found',
      `${label} references missing placement ${[...requested][0]}.`,
    )
  }
  return ordered
}

export const safeAddCounterHp = (left: number, right: number, label: string): number => {
  const value = left + right
  if (
    !Number.isSafeInteger(value)
    || value < 0
    || value > MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude
  ) {
    return failCounterReaction('limit-exceeded', `${label} exceeds the bounded HP magnitude.`)
  }
  return value
}

export const safeMultiplyCounterHp = (
  value: number,
  multiplier: number,
  label: string,
): number => {
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(multiplier)) {
    return failCounterReaction('invalid-damage-record', `${label} requires safe integers.`)
  }
  const result = value * multiplier
  if (
    !Number.isSafeInteger(result)
    || result > MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude
  ) {
    return failCounterReaction('limit-exceeded', `${label} exceeds the bounded HP magnitude.`)
  }
  return result
}

/** Convert one strictly parsed server lifecycle fact into counter-safe evidence. */
export const recordMoveReactionDamage = (
  value: EncounterMoveDamagedEvent,
): MoveRecordedEffectiveDamage => {
  const event = parseEncounterEvent(value, 'counterReaction.damageEvent')
  if (event.kind !== 'move-damaged') {
    return failCounterReaction(
      'invalid-damage-record',
      'Counter reaction damage evidence must be move-damaged.',
    )
  }
  const effectiveHpLoss = safeAddCounterHp(
    event.damage.hitPointLoss,
    event.damage.temporaryHitPointLoss,
    `Damage event ${event.eventId}`,
  )
  return deepFreezeCounterReaction({
    eventId: event.eventId,
    sourceOperationId: event.sourceOperationId,
    resolutionId: event.move.resolutionId,
    canonicalMoveId: event.move.canonicalId,
    sourcePlacementId: event.move.actorPlacementId,
    targetPlacementId: event.targetPlacementId,
    hitIndex: event.hitIndex,
    hitPointLoss: event.damage.hitPointLoss,
    temporaryHitPointLoss: event.damage.temporaryHitPointLoss,
    effectiveHpLoss,
    damageClass: event.damage.damageClass,
    moveType: event.damage.moveType,
  })
}

export const sameRecordedDamage = (
  left: MoveRecordedEffectiveDamage,
  right: MoveRecordedEffectiveDamage,
): boolean => stableJsonStringify(left) === stableJsonStringify(right)

const assertDamageRecord = (record: MoveRecordedEffectiveDamage): void => {
  if (!record || typeof record !== 'object') {
    return failCounterReaction('invalid-damage-record', 'Counter reaction damage evidence is invalid.')
  }
  assertCounterStableId(record.eventId, 'damage event ID')
  assertCounterStableId(record.sourceOperationId, 'damage source operation ID')
  assertCounterStableId(record.resolutionId, 'damage resolution ID')
  if (
    typeof record.canonicalMoveId !== 'string'
    || !record.canonicalMoveId.trim()
    || record.canonicalMoveId.length > MOVE_EFFECT_OPERATION_LIMITS.textLength
    || typeof record.sourcePlacementId !== 'string'
    || !record.sourcePlacementId.trim()
    || typeof record.targetPlacementId !== 'string'
    || !record.targetPlacementId.trim()
    || !Number.isSafeInteger(record.hitIndex)
    || record.hitIndex < 1
    || record.hitIndex > MOVE_COUNTER_REACTION_LIMITS.damageRecords
    || !Number.isSafeInteger(record.hitPointLoss)
    || record.hitPointLoss < 0
    || !Number.isSafeInteger(record.temporaryHitPointLoss)
    || record.temporaryHitPointLoss < 0
    || !['physical', 'special', 'direct'].includes(record.damageClass)
    || (record.moveType !== null && (
      typeof record.moveType !== 'string'
      || !STABLE_ID_PATTERN.test(record.moveType)
    ))
  ) {
    return failCounterReaction(
      'invalid-damage-record',
      `Damage event ${record.eventId} is malformed.`,
    )
  }
  const expectedEffectiveHpLoss = safeAddCounterHp(
    record.hitPointLoss,
    record.temporaryHitPointLoss,
    `Damage event ${record.eventId}`,
  )
  if (record.effectiveHpLoss !== expectedEffectiveHpLoss || expectedEffectiveHpLoss === 0) {
    return failCounterReaction(
      'invalid-damage-record',
      `Damage event ${record.eventId} must retain its exact positive effective HP loss.`,
    )
  }
}

export const uniqueRecordedDamage = (
  records: readonly MoveRecordedEffectiveDamage[],
): readonly MoveRecordedEffectiveDamage[] => {
  if (!Array.isArray(records) || records.length === 0) {
    return failCounterReaction(
      'invalid-damage-record',
      'A counter reaction requires recorded effective damage.',
    )
  }
  if (records.length > MOVE_COUNTER_REACTION_LIMITS.damageRecords) {
    return failCounterReaction(
      'limit-exceeded',
      'Counter reaction damage evidence exceeds the hit bound.',
    )
  }
  const byEventId = new Map<string, MoveRecordedEffectiveDamage>()
  for (const record of records) {
    assertDamageRecord(record)
    const existing = byEventId.get(record.eventId)
    if (existing && !sameRecordedDamage(existing, record)) {
      return failCounterReaction(
        'damage-record-conflict',
        `Damage event ${record.eventId} has conflicting recorded outcomes.`,
      )
    }
    if (!existing) byEventId.set(record.eventId, record)
  }
  return [...byEventId.values()]
}

export const createReactionUsageSpend = (input: {
  readonly reactionOperationId: string
  readonly ownerPlacementId: string
  readonly canonicalMoveId: MoveCounterReactionCanonicalId
}): MoveReactionUsageSpend => {
  const definition = moveCounterReactionDefinition(input.canonicalMoveId)
  return Object.freeze({
    kind: 'move-usage-spend',
    reactionOperationId: input.reactionOperationId,
    ownerPlacementId: input.ownerPlacementId,
    canonicalMoveId: input.canonicalMoveId,
    resourceId: definition.usageResourceId,
    amount: 1,
  })
}

export const createReactionAncestryLink = (
  parentResolutionId: string,
  childResolutionId: string,
): MoveReactionResolutionLink => {
  assertCounterStableId(parentResolutionId, 'parent resolution ID')
  assertCounterStableId(childResolutionId, 'child resolution ID')
  if (parentResolutionId === childResolutionId) {
    return failCounterReaction(
      'reaction-identity-conflict',
      'A reaction cannot be its own triggering parent.',
    )
  }
  return Object.freeze({ parentResolutionId, childResolutionId })
}

export const createCounterDirectHpOperation = (input: {
  readonly operationId: string
  readonly definitionId: string
  readonly amount: number
  readonly recipients: MoveEffectRecipientSelectorKind
  readonly applyTypeImmunity: boolean
}): MoveDirectHpEffectOperation => parseMoveEffectOperation({
  id: `${input.operationId}.direct-hp`,
  kind: 'direct-hp',
  source: { kind: 'operation', id: input.operationId },
  recipients: { kind: input.recipients },
  phase: 'after-damage',
  reasonCode: `${input.definitionId}.recorded-effective-hp-loss`,
  payload: {
    mode: 'lose',
    pool: 'hit-points',
    calculation: { kind: 'fixed', value: input.amount },
    copySource: null,
    bounds: { minimum: null, maximum: null },
    rounding: 'floor',
    applyTypeImmunity: input.applyTypeImmunity,
    cost: null,
    injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
  },
}, 'counterReaction.directHp') as MoveDirectHpEffectOperation
