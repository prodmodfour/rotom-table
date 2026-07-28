/**
 * Historical source anchor retained for the immutable Ability migration
 * baseline. The former browser-authored transaction registry was retired by
 * AA-110; this module intentionally exports no mechanic selector or planner.
 */
export const RETIRED_LEGACY_ABILITY_AUTOMATION_SOURCE = Object.freeze({
  schemaVersion: 1 as const,
  status: 'retired' as const,
  replacement: 'abilityspec-v1' as const,
})
