import { stableJsonStringify } from '../automation/stableJson'

const kibibytes = (value: number): number => value * 1024
const mebibytes = (value: number): number => value * 1024 * 1024

/**
 * Release budgets are availability guardrails, not campaign or mechanics
 * authority. Timed gates exclude fixture construction and module loading so
 * they measure the bounded operation named by each surface.
 */
export const BREEDING_PERFORMANCE_BUDGET_POLICY_V1 = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'ptu-1.05-breeding-performance-budgets-v1' as const,
  measurement: Object.freeze({
    clock: 'node-performance-now-monotonic' as const,
    setupPolicy: 'fixture-construction-and-module-loading-excluded' as const,
    runnerPolicy: 'single-worker-no-file-parallelism' as const,
    statistic: 'maximum-elapsed-release-run' as const,
    timingFailurePolicy: 'fail-release-gate' as const,
  }),
  registry: Object.freeze({
    maximumFamilies: 407 as const,
    maximumSpecies: 862 as const,
    lookupSweepMaximumElapsedMilliseconds: 750 as const,
  }),
  preview: Object.freeze({
    maximumStoredTrainers: 4096 as const,
    maximumProjectedTrainers: 64 as const,
    maximumRosterEntriesPerTrainer: 512 as const,
    maximumProjectedCandidates: 2048 as const,
    maximumProjectionUtf8Bytes: mebibytes(2),
    maximumElapsedMilliseconds: 4000 as const,
  }),
  batchClock: Object.freeze({
    maximumEggsPerBatch: 100 as const,
    maximumElapsedMilliseconds: 5000 as const,
  }),
  projection: Object.freeze({
    maximumProjectionUtf8Bytes: mebibytes(2),
    benchmarkProjectionCount: 1000 as const,
    maximumElapsedMilliseconds: 2000 as const,
  }),
  workshop: Object.freeze({
    maximumAuthorizedTrainers: 4096 as const,
    maximumContextsPerPage: 100 as const,
    maximumProjectionUtf8Bytes: kibibytes(128),
    maximumElapsedMilliseconds: 3000 as const,
  }),
})

export const BREEDING_PERFORMANCE_BUDGET_POLICY_DEFINITION_SHA256 =
  '46406165df3222083bff40d85dfcdc1cbc4088c28d1c758db3fc037831a1961d' as const

const UTF8_ENCODER = new TextEncoder()

/** Measures canonical plain JSON output in UTF-8 bytes. */
export const breedingPerformanceJsonUtf8Bytes = (value: unknown): number => (
  UTF8_ENCODER.encode(stableJsonStringify(value)).byteLength
)

export type BreedingPerformanceOutputSurface = 'preview' | 'projection' | 'workshop'

/** Deterministic output admission; elapsed-time ceilings remain release tests only. */
export const breedingPerformanceOutputFitsBudget = (
  surface: BreedingPerformanceOutputSurface,
  value: unknown,
): boolean => {
  const maximum = surface === 'preview'
    ? BREEDING_PERFORMANCE_BUDGET_POLICY_V1.preview.maximumProjectionUtf8Bytes
    : surface === 'projection'
      ? BREEDING_PERFORMANCE_BUDGET_POLICY_V1.projection.maximumProjectionUtf8Bytes
      : BREEDING_PERFORMANCE_BUDGET_POLICY_V1.workshop.maximumProjectionUtf8Bytes
  return breedingPerformanceJsonUtf8Bytes(value) <= maximum
}
