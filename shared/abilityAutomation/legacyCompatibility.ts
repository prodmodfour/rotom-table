export const ABILITY_AUTOMATION_LEGACY_COMPATIBILITY_SCHEMA_VERSION = 2 as const

export const ABILITY_AUTOMATION_LEGACY_READER_BOUNDARIES = [
  'shared-command-schema',
  'historical-data-reader',
  'test-migration-fixture',
] as const

export type AbilityAutomationLegacyReaderBoundary =
  (typeof ABILITY_AUTOMATION_LEGACY_READER_BOUNDARIES)[number]

/**
 * Post-retirement policy for data and protocol shapes that predate AbilitySpec.
 * These readers may inspect historical bytes but cannot select mechanics,
 * create an authoritative plan, or persist a legacy ability result.
 */
export const ABILITY_AUTOMATION_LEGACY_COMPATIBILITY_POLICY = Object.freeze({
  schemaVersion: ABILITY_AUTOMATION_LEGACY_COMPATIBILITY_SCHEMA_VERSION,
  readerBoundaries: ABILITY_AUTOMATION_LEGACY_READER_BOUNDARIES,
  productionExecution: 'retired' as const,
  productionWrites: 'native-only' as const,
  legacyHttpRoute: 'authenticated-gone-tombstone' as const,
  legacySessionCommand: 'non-retryable-rejection' as const,
  nativeRuntimeFallback: 'forbidden' as const,
})
