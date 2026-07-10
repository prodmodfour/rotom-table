import {
  MOVE_EFFECT_OPERATION_LIMITS,
  type MoveDamageEffectOperation,
  type MoveDirectHpEffectOperation,
  type MoveHealEffectOperation,
  type MoveEffectRoundingPolicy,
} from '#shared/moveAutomation/effects'
import {
  normalizeTemporaryHpAmount,
} from '~/utils/mapTemporaryHitPoints'
import type { MoveAutomationHpUpdateAccumulator } from '~/utils/moveAutomationHpUpdates'
import { failMoveCoreTokenEffectReduction } from './coreTokenEffectError'
import type {
  MoveCoreHpStateSnapshot,
  MoveCoreTokenDamageQuery,
  MoveCoreTokenEffectImmunityQueries,
  MoveCoreTokenEffectRecipient,
  MoveCoreTokenEffectRecipientResult,
} from './coreTokenEffectTypes'

const wholeNonNegative = (value: number): number => (
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
)

const hpSnapshot = (
  accumulator: MoveAutomationHpUpdateAccumulator,
  recipient: MoveCoreTokenEffectRecipient,
): MoveCoreHpStateSnapshot => ({
  kind: 'hp',
  currentHp: accumulator.get(recipient.token),
  temporaryHp: accumulator.getTemporaryHp(recipient.token),
  injuries: accumulator.getInjuries(recipient.token),
  maxHp: accumulator.getMaxHp(recipient.token),
})

const snapshotsEqual = (
  previous: MoveCoreHpStateSnapshot,
  current: MoveCoreHpStateSnapshot,
): boolean => (
  previous.currentHp === current.currentHp
  && previous.temporaryHp === current.temporaryHp
  && previous.injuries === current.injuries
  && previous.maxHp === current.maxHp
)

const changedHpFields = (
  previous: MoveCoreHpStateSnapshot,
  current: MoveCoreHpStateSnapshot,
): MoveCoreTokenEffectRecipientResult['changedFields'] => {
  const fields: Array<'hp' | 'temporaryHitPoints'> = []
  if (
    previous.currentHp !== current.currentHp
    || previous.injuries !== current.injuries
    || previous.maxHp !== current.maxHp
  ) fields.push('hp')
  if (previous.temporaryHp !== current.temporaryHp) fields.push('temporaryHitPoints')
  return fields
}

const noOpHpResult = (
  recipient: MoveCoreTokenEffectRecipient,
  snapshot: MoveCoreHpStateSnapshot,
  reasonCode: string,
  consultedPlacementIds: readonly string[] = [],
  details?: MoveCoreTokenEffectRecipientResult['details'],
): MoveCoreTokenEffectRecipientResult => ({
  recipientId: recipient.placement.id,
  outcome: 'no-op',
  reasonCode,
  blockers: [],
  ...(details === undefined ? {} : { details }),
  consultedPlacementIds,
  previous: snapshot,
  current: snapshot,
  changedFields: [],
})

const rounded = (value: number, policy: MoveEffectRoundingPolicy): number => {
  if (policy === 'ceil') return Math.ceil(value)
  if (policy === 'round') return Math.round(value)
  return Math.floor(value)
}

const healAmount = (
  operation: MoveHealEffectOperation,
  snapshot: MoveCoreHpStateSnapshot,
): number => {
  const poolValue = operation.payload.pool === 'hit-points'
    ? snapshot.currentHp
    : snapshot.temporaryHp
  let raw: number
  switch (operation.payload.mode) {
    case 'fixed':
      raw = operation.payload.amount
      break
    case 'percent-max':
      raw = snapshot.maxHp * operation.payload.amount / 100
      break
    case 'percent-current':
      raw = Math.max(0, poolValue) * operation.payload.amount / 100
      break
    case 'percent-missing':
      raw = Math.max(0, snapshot.maxHp - poolValue) * operation.payload.amount / 100
      break
  }
  return Math.max(0, rounded(raw, operation.payload.rounding))
}

const minimumBoundedLoss = (
  current: number,
  amount: number,
  minimumRemaining: number | null,
): number => {
  const reduced = current - amount
  if (minimumRemaining === null) return reduced
  // A minimum prevents further loss but never heals a pool already below it.
  return Math.max(reduced, Math.min(current, minimumRemaining))
}

export const reduceDamageEffectForRecipient = (options: {
  readonly operation: MoveDamageEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly accumulator: MoveAutomationHpUpdateAccumulator
  readonly damage: MoveCoreTokenDamageQuery
}): MoveCoreTokenEffectRecipientResult => {
  const { operation, recipient, accumulator } = options
  const previous = hpSnapshot(accumulator, recipient)
  const resolution = options.damage.resolve({ operation, recipient })
  if (
    typeof resolution.hpLoss !== 'number'
    || !Number.isFinite(resolution.hpLoss)
    || resolution.hpLoss < 0
    || resolution.hpLoss > MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude
  ) {
    return failMoveCoreTokenEffectReduction(
      'invalid-damage-resolution',
      `Damage operation ${operation.id} returned an invalid HP loss.`,
    )
  }
  if (resolution.preventedBy) {
    return {
      recipientId: recipient.placement.id,
      outcome: 'prevented',
      reasonCode: 'damage-immunity',
      blockers: [{
        subject: resolution.moveType
          ?? (typeof operation.payload.moveType === 'string' ? operation.payload.moveType : null),
        source: resolution.preventedBy,
      }],
      ...(resolution.details === undefined ? {} : { details: resolution.details }),
      consultedPlacementIds: resolution.consultedPlacementIds,
      previous,
      current: previous,
      changedFields: [],
    }
  }

  const requestedHpLoss = wholeNonNegative(resolution.hpLoss)
  if (requestedHpLoss === 0) {
    return noOpHpResult(
      recipient,
      previous,
      'damage-zero',
      resolution.consultedPlacementIds,
      resolution.details,
    )
  }
  const applied = accumulator.applyLossWithInjuryAutomation(
    recipient.token,
    requestedHpLoss,
    'damage',
  )
  const current = hpSnapshot(accumulator, recipient)
  if (snapshotsEqual(previous, current)) {
    return noOpHpResult(
      recipient,
      previous,
      'damage-zero',
      resolution.consultedPlacementIds,
      resolution.details,
    )
  }
  return {
    recipientId: recipient.placement.id,
    outcome: 'applied',
    reasonCode: operation.reasonCode,
    blockers: [],
    details: {
      requestedHpLoss,
      effectiveHpLost: applied.effectiveHpLost,
      realHpLost: applied.realHpLost,
      absorbedByTemporaryHp: applied.absorbedByTemporaryHp,
      injuryDelta: applied.injuryResult.injuryDelta,
      massiveDamageInjuries: applied.injuryResult.massiveDamageInjuries,
      markerInjuries: applied.injuryResult.markerInjuries,
      crossedMarkers: applied.injuryResult.crossedMarkers,
      ...(resolution.details === undefined ? {} : { calculation: resolution.details }),
    },
    consultedPlacementIds: resolution.consultedPlacementIds,
    previous,
    current,
    changedFields: changedHpFields(previous, current),
  }
}

export const reduceDirectHpEffectForRecipient = (options: {
  readonly operation: MoveDirectHpEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly accumulator: MoveAutomationHpUpdateAccumulator
  readonly temporaryHpAvailable: boolean
  readonly immunities: MoveCoreTokenEffectImmunityQueries
}): MoveCoreTokenEffectRecipientResult => {
  const { operation, recipient, accumulator } = options
  const previous = hpSnapshot(accumulator, recipient)

  const immunity = operation.payload.applyTypeImmunity
    ? options.immunities.directHp({ operation, recipient })
    : { blockedBy: null, consultedPlacementIds: [] }
  if (immunity.blockedBy) {
    return {
      recipientId: recipient.placement.id,
      outcome: 'prevented',
      reasonCode: 'type-immunity',
      blockers: [{ subject: null, source: immunity.blockedBy }],
      consultedPlacementIds: immunity.consultedPlacementIds,
      previous,
      current: previous,
      changedFields: [],
    }
  }

  const amount = wholeNonNegative(operation.payload.amount)
  const minimumRemaining = operation.payload.minimumRemaining
  let injuryResult: ReturnType<MoveAutomationHpUpdateAccumulator['setWithInjuryAutomation']> | null = null
  if (operation.payload.pool === 'temporary-hit-points') {
    if (!options.temporaryHpAvailable && (
      operation.payload.mode === 'set'
      || previous.temporaryHp > 0
    )) {
      return noOpHpResult(
        recipient,
        previous,
        'temporary-hp-scene-unavailable',
        immunity.consultedPlacementIds,
      )
    }
    const requested = operation.payload.mode === 'lose'
      ? minimumBoundedLoss(previous.temporaryHp, amount, minimumRemaining)
      : Math.max(amount, minimumRemaining ?? amount)
    accumulator.setTemporaryHp(recipient.token, normalizeTemporaryHpAmount(requested))
  }
  else {
    const requested = operation.payload.mode === 'lose'
      ? minimumBoundedLoss(previous.currentHp, amount, minimumRemaining)
      : Math.max(amount, minimumRemaining ?? amount)
    injuryResult = accumulator.setWithInjuryAutomation(recipient.token, requested, 'hp-loss')
  }

  const current = hpSnapshot(accumulator, recipient)
  if (snapshotsEqual(previous, current)) {
    return noOpHpResult(recipient, previous, 'hp-unchanged', immunity.consultedPlacementIds)
  }
  return {
    recipientId: recipient.placement.id,
    outcome: 'applied',
    reasonCode: operation.reasonCode,
    blockers: [],
    ...(injuryResult ? {
      details: {
        injuryDelta: injuryResult.injuryDelta,
        massiveDamageInjuries: injuryResult.massiveDamageInjuries,
        markerInjuries: injuryResult.markerInjuries,
        crossedMarkers: injuryResult.crossedMarkers,
      },
    } : {}),
    consultedPlacementIds: immunity.consultedPlacementIds,
    previous,
    current,
    changedFields: changedHpFields(previous, current),
  }
}

export const reduceHealEffectForRecipient = (options: {
  readonly operation: MoveHealEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly accumulator: MoveAutomationHpUpdateAccumulator
  readonly temporaryHpAvailable: boolean
}): MoveCoreTokenEffectRecipientResult => {
  const { operation, recipient, accumulator } = options
  const previous = hpSnapshot(accumulator, recipient)
  if (operation.payload.pool === 'temporary-hit-points' && !options.temporaryHpAvailable) {
    return noOpHpResult(recipient, previous, 'temporary-hp-scene-unavailable')
  }

  const amount = healAmount(operation, previous)
  if (operation.payload.pool === 'temporary-hit-points') {
    accumulator.setTemporaryHp(recipient.token, previous.temporaryHp + amount)
  }
  else {
    accumulator.set(recipient.token, previous.currentHp + amount)
  }

  const current = hpSnapshot(accumulator, recipient)
  if (snapshotsEqual(previous, current)) return noOpHpResult(recipient, previous, 'hp-at-cap')
  return {
    recipientId: recipient.placement.id,
    outcome: 'applied',
    reasonCode: operation.reasonCode,
    blockers: [],
    consultedPlacementIds: [],
    previous,
    current,
    changedFields: changedHpFields(previous, current),
  }
}
