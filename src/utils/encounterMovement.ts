import type {
  EncounterCapabilityEffect,
  EncounterEffect,
  EncounterEffectCell,
  EncounterNumericModifierEffect,
} from '#shared/moveAutomation/encounterEffects'
import type { EncounterSideId } from '#shared/moveAutomation/encounterState'
import {
  MOVEMENT_MODES,
  MOVEMENT_SEMI_INVULNERABLE_STATES,
  type EffectiveMovementMode,
  type EffectiveMovementProfile,
  type MovementCapabilityKey,
  type MovementCapabilitySpeeds,
  type MovementCapabilityTraits,
  type MovementGroundingState,
  type MovementMode,
  type MovementSemiInvulnerableState,
} from '~/types/movement'
import type { GridAnchor } from '~/types/pokemon'
import { moveAutomationTargetSuppressesGroundsourceImmunity } from '~/utils/moveAutomationKeywordImmunity'
import { SHIFT_MOVEMENT_CAPABILITY_KEYS } from '~/utils/movementCapabilities'

export const MOVEMENT_CAPABILITY_EFFECT_IDS = Object.freeze({
  overland: 'movement.overland',
  sky: 'movement.sky',
  swim: 'movement.swim',
  burrow: 'movement.burrow',
  levitate: 'movement.levitate',
  phasing: 'movement.phasing',
  jump: 'movement.jump',
  jumpLong: 'movement.jump.long',
  jumpHigh: 'movement.jump.high',
  climb: 'movement.climb',
  grounded: 'movement.grounding.grounded',
  airborne: 'movement.grounding.airborne',
} as const)

const SEMI_INVULNERABLE_EFFECT_PREFIX = 'movement.semi-invulnerable.'
const MOVEMENT_MODE_EFFECT_PREFIX = 'movement.mode.'
const MAX_EFFECTIVE_MOVEMENT_VALUE = 1_000_000

export interface EffectiveMovementTarget {
  readonly placementId: string
  readonly sideId?: EncounterSideId
  readonly position?: GridAnchor
  readonly base?: number
  readonly clearance?: number
  readonly cells?: readonly EncounterEffectCell[]
}

export interface ProjectEffectiveMovementInput {
  readonly sheetCapabilities?: MovementCapabilitySpeeds | null
  readonly sheetTraits?: MovementCapabilityTraits | null
  readonly sheetConditions?: readonly string[] | null
  readonly encounterEffects?: readonly EncounterEffect[] | null
  readonly target: EffectiveMovementTarget
}

export type EffectiveMovementProjectionErrorCode =
  | 'non-finite-movement'
  | 'movement-value-out-of-range'

export class EffectiveMovementProjectionError extends Error {
  readonly code: EffectiveMovementProjectionErrorCode
  readonly effectId: string

  constructor(
    code: EffectiveMovementProjectionErrorCode,
    effectId: string,
    message: string,
  ) {
    super(message)
    this.name = 'EffectiveMovementProjectionError'
    this.code = code
    this.effectId = effectId
  }
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const finitePositiveExtent = (value: number | undefined): number => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
)

const sameCell = (left: EncounterEffectCell, right: EncounterEffectCell): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)

const targetOccupiesEffectCell = (
  target: EffectiveMovementTarget,
  effectCell: EncounterEffectCell,
): boolean => {
  if (target.cells !== undefined) return target.cells.some(cell => sameCell(cell, effectCell))
  if (target.position === undefined) return false

  const base = finitePositiveExtent(target.base)
  const clearance = finitePositiveExtent(target.clearance)
  return effectCell.x >= target.position.x
    && effectCell.x < target.position.x + base
    && effectCell.y >= target.position.y
    && effectCell.y < target.position.y + clearance
    && effectCell.z >= target.position.z
    && effectCell.z < target.position.z + base
}

const effectAppliesToTarget = (
  effect: EncounterCapabilityEffect | EncounterNumericModifierEffect,
  target: EffectiveMovementTarget,
): boolean => (
  effect.affected.placementIds.includes(target.placementId)
  || (
    target.sideId !== undefined
    && effect.affected.sideIds.includes(target.sideId)
  )
  || effect.affected.cells.some(cell => targetOccupiesEffectCell(target, cell))
)

const effectIsActive = (
  effect: EncounterCapabilityEffect | EncounterNumericModifierEffect,
): boolean => effect.suppression.sources.length === 0 && effect.charges !== 0

const activeApplicableEffects = (
  effects: readonly EncounterEffect[] | null | undefined,
  target: EffectiveMovementTarget,
): readonly (EncounterCapabilityEffect | EncounterNumericModifierEffect)[] => (
  (effects ?? []).filter((effect): effect is EncounterCapabilityEffect | EncounterNumericModifierEffect => (
    (effect.kind === 'capability'
      || (effect.kind === 'numeric-modifier' && effect.payload.attribute === 'movement'))
    && effectIsActive(effect)
    && effectAppliesToTarget(effect, target)
  ))
)

const normalizedBaseSpeeds = (
  capabilities: MovementCapabilitySpeeds | null | undefined,
): MovementCapabilitySpeeds => {
  const speeds: MovementCapabilitySpeeds = {}
  for (const key of [...SHIFT_MOVEMENT_CAPABILITY_KEYS, 'teleporter'] as const) {
    const value = capabilities?.[key]
    if (
      typeof value === 'number'
      && Number.isSafeInteger(value)
      && value >= 0
      && value <= MAX_EFFECTIVE_MOVEMENT_VALUE
    ) {
      speeds[key] = value
    }
  }
  return speeds
}

const normalizedBaseTraits = (
  traits: MovementCapabilityTraits | null | undefined,
): MovementCapabilityTraits => ({
  phasing: traits?.phasing === true,
  jump: {
    long: Number.isSafeInteger(traits?.jump.long) && (traits?.jump.long ?? -1) >= 0
      ? Math.min(traits!.jump.long, MAX_EFFECTIVE_MOVEMENT_VALUE)
      : 0,
    high: Number.isSafeInteger(traits?.jump.high) && (traits?.jump.high ?? -1) >= 0
      ? Math.min(traits!.jump.high, MAX_EFFECTIVE_MOVEMENT_VALUE)
      : 0,
  },
})

const movementModeFromCapabilityId = (capabilityId: string): MovementMode | null => {
  const normalized = capabilityId.startsWith(MOVEMENT_MODE_EFFECT_PREFIX)
    ? capabilityId.slice(MOVEMENT_MODE_EFFECT_PREFIX.length)
    : capabilityId.startsWith('movement.')
      ? capabilityId.slice('movement.'.length)
      : ''
  return (MOVEMENT_MODES as readonly string[]).includes(normalized)
    ? normalized as MovementMode
    : null
}

const semiInvulnerableStateFromCapabilityId = (
  capabilityId: string,
): MovementSemiInvulnerableState | null => {
  if (!capabilityId.startsWith(SEMI_INVULNERABLE_EFFECT_PREFIX)) return null
  const state = capabilityId.slice(SEMI_INVULNERABLE_EFFECT_PREFIX.length)
  return (MOVEMENT_SEMI_INVULNERABLE_STATES as readonly string[])
    .includes(state)
    ? state as MovementSemiInvulnerableState
    : null
}

const groundingFromCapabilityId = (capabilityId: string): MovementGroundingState | null => {
  if (capabilityId === MOVEMENT_CAPABILITY_EFFECT_IDS.grounded) return 'grounded'
  if (capabilityId === MOVEMENT_CAPABILITY_EFFECT_IDS.airborne) return 'airborne'
  return null
}

const speedKeyForMode = (mode: MovementMode): MovementCapabilityKey | null => {
  if (mode === 'phasing' || mode === 'jump') return null
  return mode
}

const applyRoundedModifier = (
  current: number,
  effect: EncounterNumericModifierEffect,
): number => {
  const { operation, value, rounding } = effect.payload
  let next = operation === 'add'
    ? current + (value * effect.stacks)
    : operation === 'multiply'
      ? current * (value ** effect.stacks)
      : value
  if (rounding === 'floor') next = Math.floor(next)
  else if (rounding === 'round') next = Math.round(next)
  else if (rounding === 'ceil') next = Math.ceil(next)

  if (!Number.isFinite(next)) {
    throw new EffectiveMovementProjectionError(
      'non-finite-movement',
      effect.id,
      `Encounter movement effect ${effect.id} produced a non-finite capability value.`,
    )
  }
  if (next < 0 || next > MAX_EFFECTIVE_MOVEMENT_VALUE) {
    throw new EffectiveMovementProjectionError(
      'movement-value-out-of-range',
      effect.id,
      `Encounter movement effect ${effect.id} produced an out-of-range capability value ${next}.`,
    )
  }
  return next
}

const taggedSpeedKeys = (
  effect: EncounterNumericModifierEffect,
): readonly MovementCapabilityKey[] => {
  const tagged = effect.tags.flatMap((tag) => {
    const mode = movementModeFromCapabilityId(tag)
    const key = mode ? speedKeyForMode(mode) : null
    return key ? [key] : []
  })
  return [...new Set(tagged)]
}

const applyNumericMovementEffect = (
  speeds: MovementCapabilitySpeeds,
  effect: EncounterNumericModifierEffect,
): boolean => {
  const tagged = taggedSpeedKeys(effect)
  const keys = tagged.length > 0
    ? tagged
    : SHIFT_MOVEMENT_CAPABILITY_KEYS.filter(key => speeds[key] !== undefined)
  let changed = false
  for (const key of keys) {
    const current = speeds[key]
    if (current === undefined && effect.payload.operation !== 'set') continue
    const next = applyRoundedModifier(current ?? 0, effect)
    if (!Object.is(next, current)) {
      speeds[key] = next
      changed = true
    }
  }
  return changed
}

interface MutableMovementEffectState {
  readonly speeds: MovementCapabilitySpeeds
  readonly baseSpeeds: MovementCapabilitySpeeds
  readonly traits: { phasing: boolean; jump: { long: number; high: number } }
  readonly baseTraits: MovementCapabilityTraits
  readonly effect: EncounterCapabilityEffect
  groundingOverlay: MovementGroundingState | null
  semiInvulnerable: MovementSemiInvulnerableState
}

const applyCapabilityEffect = (input: MutableMovementEffectState): boolean => {
  const { effect } = input
  const grounding = groundingFromCapabilityId(effect.payload.capabilityId)
  if (grounding) {
    const next = effect.payload.action === 'grant' ? grounding : null
    const changed = input.groundingOverlay !== next
    input.groundingOverlay = next
    return changed
  }

  const semiInvulnerable = semiInvulnerableStateFromCapabilityId(effect.payload.capabilityId)
  if (semiInvulnerable) {
    const next = effect.payload.action === 'grant' ? semiInvulnerable : 'none'
    const changed = input.semiInvulnerable !== next
    input.semiInvulnerable = next
    return changed
  }

  const mode = movementModeFromCapabilityId(effect.payload.capabilityId)
  if (!mode) return false

  if (mode === 'phasing') {
    const next = effect.payload.action === 'grant'
    const changed = input.traits.phasing !== next
    input.traits.phasing = next
    return changed
  }

  if (mode === 'jump') {
    if (effect.payload.action === 'suppress') {
      const changed = input.traits.jump.long !== 0 || input.traits.jump.high !== 0
      input.traits.jump.long = 0
      input.traits.jump.high = 0
      return changed
    }
    const long = effect.payload.value ?? input.baseTraits.jump.long
    const high = effect.payload.value ?? input.baseTraits.jump.high
    const changed = input.traits.jump.long !== long || input.traits.jump.high !== high
    input.traits.jump.long = long
    input.traits.jump.high = high
    return changed
  }

  const speedKey = speedKeyForMode(mode)!
  if (effect.payload.action === 'suppress') {
    if (input.speeds[speedKey] === undefined) return false
    delete input.speeds[speedKey]
    return true
  }
  const grantedSpeed = effect.payload.value ?? input.baseSpeeds[speedKey]
  if (grantedSpeed === undefined) return false
  const changed = input.speeds[speedKey] !== grantedSpeed
  input.speeds[speedKey] = grantedSpeed
  return changed
}

const applyJumpAxisEffect = (
  traits: { jump: { long: number; high: number } },
  baseTraits: MovementCapabilityTraits,
  effect: EncounterCapabilityEffect,
): boolean => {
  const axis = effect.payload.capabilityId === MOVEMENT_CAPABILITY_EFFECT_IDS.jumpLong
    ? 'long'
    : effect.payload.capabilityId === MOVEMENT_CAPABILITY_EFFECT_IDS.jumpHigh
      ? 'high'
      : null
  if (!axis) return false
  const next = effect.payload.action === 'suppress'
    ? 0
    : effect.payload.value ?? baseTraits.jump[axis]
  if (next === undefined || traits.jump[axis] === next) return false
  traits.jump[axis] = next
  return true
}

const effectiveModes = (
  speeds: MovementCapabilitySpeeds,
  traits: MovementCapabilityTraits,
): readonly EffectiveMovementMode[] => MOVEMENT_MODES.map((mode): EffectiveMovementMode => {
  if (mode === 'phasing') {
    return {
      mode,
      available: traits.phasing,
      speed: null,
      longJump: null,
      highJump: null,
    }
  }
  if (mode === 'jump') {
    return {
      mode,
      available: traits.jump.long > 0 || traits.jump.high > 0,
      speed: null,
      longJump: traits.jump.long,
      highJump: traits.jump.high,
    }
  }
  const speed = speeds[mode]
  return {
    mode,
    available: speed !== undefined && speed > 0,
    speed: speed ?? null,
    longJump: null,
    highJump: null,
  }
})

/**
 * Project effective movement from authoritative sheet facts and active typed
 * encounter effects. Effects never rewrite the sheet; removing/expiring an
 * effect naturally restores the next projection to its sheet-owned values.
 */
export const projectEffectiveMovement = (
  input: ProjectEffectiveMovementInput,
): EffectiveMovementProfile => {
  const baseSpeeds = normalizedBaseSpeeds(input.sheetCapabilities)
  const speeds = { ...baseSpeeds }
  const baseTraits = normalizedBaseTraits(input.sheetTraits)
  const traits = {
    phasing: baseTraits.phasing,
    jump: { ...baseTraits.jump },
  }
  let groundingOverlay: MovementGroundingState | null = null
  let semiInvulnerable: MovementSemiInvulnerableState = 'none'
  const sourceEffectIds: string[] = []

  for (const effect of activeApplicableEffects(input.encounterEffects, input.target)) {
    let changed = false
    if (effect.kind === 'numeric-modifier') {
      changed = applyNumericMovementEffect(speeds, effect)
    }
    else {
      changed = applyJumpAxisEffect(traits, baseTraits, effect)
      const mutableState: MutableMovementEffectState = {
        speeds,
        baseSpeeds,
        traits,
        baseTraits,
        effect,
        groundingOverlay,
        semiInvulnerable,
      }
      changed = applyCapabilityEffect(mutableState) || changed
      groundingOverlay = mutableState.groundingOverlay
      semiInvulnerable = mutableState.semiInvulnerable
    }
    if (changed) sourceEffectIds.push(effect.id)
  }

  const capabilityAirborne = (speeds.sky ?? 0) > 0 || (speeds.levitate ?? 0) > 0
  const conditionGrounded = moveAutomationTargetSuppressesGroundsourceImmunity({
    conditions: [...(input.sheetConditions ?? [])],
  })
  const grounding = groundingOverlay
    ?? (capabilityAirborne && !conditionGrounded ? 'airborne' : 'grounded')
  const frozenTraits: MovementCapabilityTraits = {
    phasing: traits.phasing,
    jump: { ...traits.jump },
  }

  return deepFreeze({
    speeds: { ...speeds },
    traits: frozenTraits,
    state: { grounding, semiInvulnerable },
    modes: effectiveModes(speeds, frozenTraits),
    sourceEffectIds,
  })
}

export const effectiveMovementMode = (
  profile: Pick<EffectiveMovementProfile, 'modes'>,
  mode: MovementMode,
): EffectiveMovementMode => profile.modes.find(entry => entry.mode === mode) ?? {
  mode,
  available: false,
  speed: null,
  longJump: mode === 'jump' ? 0 : null,
  highJump: mode === 'jump' ? 0 : null,
}
