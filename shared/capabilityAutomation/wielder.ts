/**
 * Legacy compatibility surface. Descriptive held-item text is not equipment
 * authority and therefore can never establish a Wielder weapon profile.
 * Authoritative callers use reviewed P8-047 equipment grants instead.
 */
export interface WielderWeaponProfile {
  readonly canonicalItemName: string
  readonly weaponClass: 'small-melee' | 'large-melee'
  readonly damageBaseBonus: number
  readonly accuracyCheckPenalty: number
  readonly grantsReach: boolean
  readonly adeptMoveName: string | null
}

export const resolveWielderWeaponProfile = (_input: {
  readonly heldItemName: string | null | undefined
  readonly size: string | null | undefined
}): WielderWeaponProfile | null => null
