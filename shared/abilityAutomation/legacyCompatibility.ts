export const ABILITY_AUTOMATION_LEGACY_COMPATIBILITY_SCHEMA_VERSION = 1 as const

export const ABILITY_AUTOMATION_LEGACY_BOUNDARIES = [
  'client-live-play-panel',
  'server-live-play-table-action',
] as const

export type AbilityAutomationLegacyBoundary =
  (typeof ABILITY_AUTOMATION_LEGACY_BOUNDARIES)[number]

/**
 * Migration-only policy for behavior that predates AbilitySpec.
 * Native runtime selection must never consult these paths as a fallback.
 */
export const ABILITY_AUTOMATION_LEGACY_COMPATIBILITY_POLICY = Object.freeze({
  schemaVersion: ABILITY_AUTOMATION_LEGACY_COMPATIBILITY_SCHEMA_VERSION,
  boundaries: ABILITY_AUTOMATION_LEGACY_BOUNDARIES,
  nativeRuntimeFallback: 'forbidden' as const,
  directProductionImports: 'forbidden' as const,
  retirementCondition: 'certify-abilityspec-and-retire-compatibility-path' as const,
})
