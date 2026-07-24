import type { EncounterEffect } from '../moveAutomation/encounterEffects'

export const AA074_HELIOVOLT_SUNNY_CAPABILITY = 'aa074.heliovolt.considered-sunny' as const
export const AA074_HELPER_SKILL_CHECK_ATTRIBUTE = 'skill-check' as const
export const AA074_HONEY_PAWS_PREPARED_CAPABILITY_PREFIX = 'aa074.honey-paws.prepared:' as const
export const AA074_HUNGER_FULL_BELLY_MODE = 'full-belly' as const
export const AA074_HUNGER_HANGRY_MODE = 'hangry' as const
export const AA074_HUNGER_MODES = [
  AA074_HUNGER_FULL_BELLY_MODE,
  AA074_HUNGER_HANGRY_MODE,
] as const
export type Aa074HungerMode = (typeof AA074_HUNGER_MODES)[number]

export const AA074_HUNGER_MODE_CAPABILITY_PREFIX = 'aa074.hunger-switch.mode.' as const

export const aa074ActiveEncounterEffect = (effect: Pick<EncounterEffect, 'duration'>): boolean => (
  effect.duration.remaining === null || effect.duration.remaining > 0
)

export const aa074HeliovoltSunnyForPlacement = (
  effects: readonly EncounterEffect[] | null | undefined,
  placementId: string,
): boolean => (effects ?? []).some(effect => (
  effect.kind === 'capability'
  && aa074ActiveEncounterEffect(effect)
  && effect.suppression.sources.length === 0
  && effect.payload.action === 'grant'
  && effect.payload.capabilityId === AA074_HELIOVOLT_SUNNY_CAPABILITY
  && effect.affected.placementIds.includes(placementId)
))

export const aa074HoneyPawsPreparationForPlacement = (
  effects: readonly EncounterEffect[] | null | undefined,
  placementId: string,
): Extract<EncounterEffect, { readonly kind: 'capability' }> | null => {
  const matches = (effects ?? []).filter((effect): effect is Extract<EncounterEffect, { readonly kind: 'capability' }> => (
    effect.kind === 'capability'
    && aa074ActiveEncounterEffect(effect)
    && effect.suppression.sources.length === 0
    && effect.payload.action === 'grant'
    && effect.affected.placementIds.includes(placementId)
    && effect.payload.capabilityId.startsWith(AA074_HONEY_PAWS_PREPARED_CAPABILITY_PREFIX)
  ))
  return matches.length === 1 ? matches[0]! : null
}

export const aa074HungerModeForPlacement = (
  effects: readonly EncounterEffect[] | null | undefined,
  placementId: string,
): Aa074HungerMode | null => {
  const matches = (effects ?? []).filter(effect => (
    effect.kind === 'capability'
    && aa074ActiveEncounterEffect(effect)
    && effect.suppression.sources.length === 0
    && effect.payload.action === 'grant'
    && effect.affected.placementIds.includes(placementId)
    && effect.payload.capabilityId.startsWith(AA074_HUNGER_MODE_CAPABILITY_PREFIX)
  ))
  if (matches.length !== 1) return null
  const selected = matches[0]!
  if (selected.kind !== 'capability') return null
  const mode = selected.payload.capabilityId.slice(AA074_HUNGER_MODE_CAPABILITY_PREFIX.length)
  return (AA074_HUNGER_MODES as readonly string[]).includes(mode)
    ? mode as Aa074HungerMode
    : null
}
