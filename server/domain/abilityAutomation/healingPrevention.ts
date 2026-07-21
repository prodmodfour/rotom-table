import type { TabletopMap } from '~/types/map'

export const CRUELTY_HEALING_BLOCK_CAPABILITY_ID = 'aa065.cruelty.healing-blocked' as const

/** Central healing/Temporary-HP policy consumed by every authoritative source. */
export const authoritativeAbilityHealingBlocked = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placementId: string
}): boolean => (input.map.encounterState?.effects ?? []).some(effect => (
  effect.kind === 'capability'
  && effect.affected.placementIds.includes(input.placementId)
  && effect.payload.action === 'grant'
  && effect.payload.capabilityId === CRUELTY_HEALING_BLOCK_CAPABILITY_ID
))
