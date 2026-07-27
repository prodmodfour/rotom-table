import {
  ENCOUNTER_EFFECT_LIMITS,
  parseEncounterEffect,
  parseEncounterEffects,
  type EncounterEffect,
  type EncounterEffectTransferPolicy,
} from '#shared/moveAutomation/encounterEffects'
import type { MoveEffectSwitchStateTransferPolicy } from '#shared/moveAutomation/effects'
import {
  applyEncounterEffectLifecycleEvent,
  type EncounterEffectLifecycleTransition,
} from './effectLifecycle'

export type EncounterEffectTransferErrorCode =
  | 'invalid-switch-identity'
  | 'effect-transfer-conflict'

export class EncounterEffectTransferError extends Error {
  readonly code: EncounterEffectTransferErrorCode

  constructor(code: EncounterEffectTransferErrorCode, message: string) {
    super(message)
    this.name = 'EncounterEffectTransferError'
    this.code = code
  }
}

export interface EncounterEffectSwitchTransferResult {
  readonly effects: readonly EncounterEffect[]
  readonly changed: boolean
  /** Existing effect identities rebound in place; no second instance is created. */
  readonly transferredEffectIds: readonly string[]
  /** Non-passable/source-leave identities removed before ordinary switch cleanup. */
  readonly expiredEffectIds: readonly string[]
  readonly transitions: readonly EncounterEffectLifecycleTransition[]
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

const fail = (
  code: EncounterEffectTransferErrorCode,
  message: string,
): never => {
  throw new EncounterEffectTransferError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const assertSwitchIdentity = (value: string, label: string): void => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ENCOUNTER_EFFECT_LIMITS.identifierChars
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    fail('invalid-switch-identity', `${label} must be a bounded placement ID.`)
  }
}

const effectReferencesPlacement = (
  effect: EncounterEffect,
  placementId: string,
): boolean => effect.source.placementId === placementId
  || effect.affected.placementIds.includes(placementId)

const transferPolicy = (effect: EncounterEffect): EncounterEffectTransferPolicy => (
  effect.transferPolicy ?? 'retain'
)

const transferredEffect = (
  effect: EncounterEffect,
  recalledPlacementId: string,
  sentOutPlacementId: string,
): EncounterEffect => {
  const placementIds = effect.affected.placementIds.map(placementId => (
    placementId === recalledPlacementId ? sentOutPlacementId : placementId
  ))
  if (new Set(placementIds).size !== placementIds.length) {
    return fail(
      'effect-transfer-conflict',
      `Effect ${effect.id} would address replacement ${sentOutPlacementId} more than once.`,
    )
  }
  try {
    return parseEncounterEffect({
      ...effect,
      source: effect.source.placementId === recalledPlacementId
        ? { ...effect.source, placementId: sentOutPlacementId }
        : effect.source,
      affected: {
        ...effect.affected,
        placementIds,
      },
    }, `effectTransfer.${effect.id}`)
  }
  catch (error) {
    return fail(
      'effect-transfer-conflict',
      `Effect ${effect.id} could not be rebound to ${sentOutPlacementId}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const removeEffectsById = (
  effectsValue: readonly EncounterEffect[],
  effectIds: readonly string[],
): {
  readonly effects: readonly EncounterEffect[]
  readonly transitions: readonly EncounterEffectLifecycleTransition[]
} => {
  let effects = parseEncounterEffects(effectsValue, 'effectTransfer.effectsToRemove')
  const transitions: EncounterEffectLifecycleTransition[] = []
  for (const effectId of effectIds) {
    const result = applyEncounterEffectLifecycleEvent(
      { effects },
      { kind: 'effect-removed', effectId },
    )
    effects = result.effects
    transitions.push(...result.transitions)
  }
  return { effects, transitions }
}

/**
 * Apply the reviewed switch policy to durable effects before source-leave
 * lifecycle handlers run. Baton Pass keeps one effect ID and replaces every
 * source/recipient reference to the recalled placement. Effects marked expire,
 * and Baton Pass-only effects on an ordinary switch, are removed exactly once.
 */
export const resolveEncounterEffectSwitchTransfer = (input: {
  readonly effects: readonly EncounterEffect[]
  readonly recalledPlacementId: string
  readonly sentOutPlacementId: string
  readonly stateTransferPolicy: MoveEffectSwitchStateTransferPolicy
}): EncounterEffectSwitchTransferResult => {
  assertSwitchIdentity(input.recalledPlacementId, 'Recalled placement ID')
  assertSwitchIdentity(input.sentOutPlacementId, 'Sent-out placement ID')
  if (input.recalledPlacementId === input.sentOutPlacementId) {
    return fail('invalid-switch-identity', 'A switch must use distinct recalled and sent-out IDs.')
  }
  if (input.stateTransferPolicy !== 'none' && input.stateTransferPolicy !== 'baton-pass') {
    return fail('invalid-switch-identity', 'Switch state transfer policy is unsupported.')
  }

  const original = parseEncounterEffects(input.effects, 'effectTransfer.effects')
  const transferredEffectIds: string[] = []
  const expiredEffectIds: string[] = []
  const rebound = original.map((effect) => {
    if (!effectReferencesPlacement(effect, input.recalledPlacementId)) return effect
    const policy = transferPolicy(effect)
    const transfersWishReplacement = effect.tags.includes('wish')
      && effect.tags.includes('delayed-heal')
      && effect.source.placementId === input.recalledPlacementId
      && effect.affected.placementIds.includes(input.recalledPlacementId)
    if (transfersWishReplacement
      || (policy === 'baton-pass' && input.stateTransferPolicy === 'baton-pass')) {
      transferredEffectIds.push(effect.id)
      return transferredEffect(
        effect,
        input.recalledPlacementId,
        input.sentOutPlacementId,
      )
    }
    if (policy === 'expire' || policy === 'baton-pass') expiredEffectIds.push(effect.id)
    return effect
  })

  const removed = removeEffectsById(
    parseEncounterEffects(rebound, 'effectTransfer.reboundEffects'),
    expiredEffectIds,
  )
  const effects = removed.effects
  const transitions = removed.transitions

  const transferred = new Set(transferredEffectIds)
  if (expiredEffectIds.some(effectId => transferred.has(effectId))) {
    return fail(
      'effect-transfer-conflict',
      'One effect cannot be transferred and expired by the same switch.',
    )
  }
  for (const effectId of transferredEffectIds) {
    if (effects.filter(effect => effect.id === effectId).length !== 1) {
      return fail(
        'effect-transfer-conflict',
        `Transferred effect ${effectId} must remain present exactly once.`,
      )
    }
  }

  return deepFreeze({
    effects,
    changed: transferredEffectIds.length > 0 || expiredEffectIds.length > 0,
    transferredEffectIds,
    expiredEffectIds,
    transitions,
  })
}

/**
 * Apply source-leave transfer policy when a move recalls without sending out a
 * replacement. Baton Pass-only and explicitly expiring state leaves exactly
 * once; retained state is still available to typed recall lifecycle handlers.
 */
export const resolveEncounterEffectRecall = (input: {
  readonly effects: readonly EncounterEffect[]
  readonly recalledPlacementId: string
}): EncounterEffectSwitchTransferResult => {
  assertSwitchIdentity(input.recalledPlacementId, 'Recalled placement ID')
  const original = parseEncounterEffects(input.effects, 'effectRecall.effects')
  const expiredEffectIds = original.flatMap(effect => (
    effectReferencesPlacement(effect, input.recalledPlacementId)
    && (transferPolicy(effect) === 'expire' || transferPolicy(effect) === 'baton-pass')
      ? [effect.id]
      : []
  ))
  const removed = removeEffectsById(original, expiredEffectIds)
  return deepFreeze({
    effects: removed.effects,
    changed: expiredEffectIds.length > 0,
    transferredEffectIds: [],
    expiredEffectIds,
    transitions: removed.transitions,
  })
}
