import type { AbilityOwnedStateEntry } from './ownedState'
import type { EncounterEffect } from '../moveAutomation/encounterEffects'

export const AA075_ICE_FACE_FORM_MARKER_CAPABILITY = 'aa075.ice-face.temporary-hp' as const
export const AA075_ILLUSION_ACTIVE_CAPABILITY_PREFIX = 'aa075.illusion.active:' as const
export const AA075_ILLUSION_ROUND_USE_CAPABILITY = 'aa075.illusion.round-use' as const
export const AA075_ILLUSION_MARK_PREFIX = 'aa075.illusion.mark.' as const

const activeEffect = (effect: Pick<EncounterEffect, 'duration' | 'suppression'>): boolean => (
  (effect.duration.remaining === null || effect.duration.remaining > 0)
  && effect.suppression.sources.length === 0
)

export const aa075IllusionMarks = (input: {
  readonly entries: readonly AbilityOwnedStateEntry[] | null | undefined
  readonly ownerPlacementId: string
  readonly sourceAbilityInstanceId: string
}): readonly AbilityOwnedStateEntry[] => Object.freeze((input.entries ?? [])
  .filter(entry => (
    entry.ownerPlacementId === input.ownerPlacementId
    && entry.sourceAbilityInstanceId === input.sourceAbilityInstanceId
    && entry.canonicalId === 'Illusion'
    && entry.payload.kind === 'mark'
    && entry.payload.markId.startsWith(AA075_ILLUSION_MARK_PREFIX)
  ))
  .sort((left, right) => left.stateId.localeCompare(right.stateId)))

export const aa075ActiveIllusionEffect = (
  effects: readonly EncounterEffect[] | null | undefined,
  placementId: string,
): Extract<EncounterEffect, { readonly kind: 'capability' }> | null => {
  const matches = (effects ?? []).filter((effect): effect is Extract<EncounterEffect, { readonly kind: 'capability' }> => (
    effect.kind === 'capability'
    && activeEffect(effect)
    && effect.payload.action === 'grant'
    && effect.payload.capabilityId.startsWith(AA075_ILLUSION_ACTIVE_CAPABILITY_PREFIX)
    && effect.affected.placementIds.includes(placementId)
  ))
  return matches.length === 1 ? matches[0]! : null
}

export const aa075ActiveIllusionStateId = (
  effects: readonly EncounterEffect[] | null | undefined,
  placementId: string,
): string | null => {
  const effect = aa075ActiveIllusionEffect(effects, placementId)
  return effect
    ? effect.payload.capabilityId.slice(AA075_ILLUSION_ACTIVE_CAPABILITY_PREFIX.length)
    : null
}

export const aa075IllusionUsedThisRound = (
  effects: readonly EncounterEffect[] | null | undefined,
  placementId: string,
): boolean => (effects ?? []).some(effect => (
  effect.kind === 'capability'
  && activeEffect(effect)
  && effect.payload.action === 'grant'
  && effect.payload.capabilityId === AA075_ILLUSION_ROUND_USE_CAPABILITY
  && effect.affected.placementIds.includes(placementId)
))

export const aa075IceFaceFeatureMarkerActive = (
  effects: readonly EncounterEffect[] | null | undefined,
  placementId: string,
): boolean => (effects ?? []).some(effect => (
  effect.kind === 'capability'
  && activeEffect(effect)
  && effect.payload.action === 'grant'
  && effect.payload.capabilityId === AA075_ICE_FACE_FORM_MARKER_CAPABILITY
  && effect.affected.placementIds.includes(placementId)
))
