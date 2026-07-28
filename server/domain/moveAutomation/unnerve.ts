import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'

export const AA097_UNNERVE_CAPABILITY_ID = 'aa097.unnerve.block-stages-and-digestion' as const
export const AA097_UNNERVE_TAG = 'aa097-unnerve' as const

/**
 * Query the exact active server-owned Unnerve marker projected onto a target.
 * Expired, suppressed, malformed, or unrelated tagged effects grant no rules.
 */
export const authoritativeUnnerveBlocksTarget = (
  effects: readonly EncounterEffect[] | null | undefined,
  placementId: string,
): boolean => effects?.some(effect => (
  effect.kind === 'capability'
  && effect.payload.action === 'grant'
  && effect.payload.capabilityId === AA097_UNNERVE_CAPABILITY_ID
  && effect.tags.includes(AA097_UNNERVE_TAG)
  && effect.affected.placementIds.includes(placementId)
  && effect.suppression.sources.length === 0
  && effect.stacks > 0
  && (effect.duration.remaining === null || effect.duration.remaining > 0)
)) === true
