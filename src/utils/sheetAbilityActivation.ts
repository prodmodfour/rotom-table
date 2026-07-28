/**
 * Historical source anchor retained for the immutable Ability migration
 * baseline. Persistent browser activation toggles no longer influence sheet
 * projections or authoritative live-play mechanics.
 */
export const RETIRED_SHEET_ABILITY_ACTIVATION_SOURCE = Object.freeze({
  schemaVersion: 1 as const,
  status: 'retired' as const,
  replacement: 'effective-ability-static-projection' as const,
})
