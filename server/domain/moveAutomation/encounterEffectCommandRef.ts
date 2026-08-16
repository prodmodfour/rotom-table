import { createHash } from 'node:crypto'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'

export const ENCOUNTER_EFFECT_COMMAND_REF_PREFIX = 'effect-ref:v1:' as const

/**
 * Build the opaque reference exposed by GM-only encounter projections.
 * Durable effect identities and operation evidence never cross that boundary.
 */
export const encounterEffectCommandRef = (effectId: string): string => {
  if (typeof effectId !== 'string' || effectId.length < 1 || effectId.length > 160
    || effectId.trim() !== effectId) {
    throw new Error('Encounter effect identity must be bounded trimmed text.')
  }
  return `${ENCOUNTER_EFFECT_COMMAND_REF_PREFIX}${createHash('sha256').update(effectId).digest('hex')}`
}

/**
 * Resolve a projected command reference back to exactly one current effect.
 * Raw identities remain accepted as a compatibility seam for trusted callers.
 */
export const resolveEncounterEffectCommandRef = (
  effects: readonly EncounterEffect[],
  commandRef: string,
): EncounterEffect | null => {
  if (!commandRef.startsWith(ENCOUNTER_EFFECT_COMMAND_REF_PREFIX)) {
    return effects.find(effect => effect.id === commandRef) ?? null
  }
  const matches = effects.filter(effect => encounterEffectCommandRef(effect.id) === commandRef)
  if (matches.length > 1) {
    throw new Error('Encounter effect command reference is ambiguous.')
  }
  return matches[0] ?? null
}
