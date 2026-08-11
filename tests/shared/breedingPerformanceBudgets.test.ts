import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { BREEDING_CAMPAIGN_CLOCK_EGG_BATCH_MAXIMUM } from '../../shared/breeding/campaignClockBatch'
import {
  BREEDING_PERFORMANCE_BUDGET_POLICY_DEFINITION_SHA256,
  BREEDING_PERFORMANCE_BUDGET_POLICY_V1,
  breedingPerformanceJsonUtf8Bytes,
  breedingPerformanceOutputFitsBudget,
} from '../../shared/breeding/performanceBudgets'
import { BREEDING_WORKSHOP_CONTEXT_PAGE_LIMIT } from '../../shared/breeding/workshop'
import { buildBreedingPublicProjectionV1 } from '../../server/domain/breeding/projections'
import {
  COMPILED_BREEDING_FAMILIES,
  COMPILED_BREEDING_FAMILY_COUNT,
  COMPILED_BREEDING_SPECIES,
  COMPILED_BREEDING_SPECIES_COUNT,
  compiledBreedingFamilySpec,
  compiledBreedingSpeciesSpec,
} from '../../server/domain/breeding/registry'

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const source = (path: string): string => readFileSync(path, 'utf8')

describe('BR-086 Breeding release performance budgets', () => {
  it('freezes one hash-bound policy without granting campaign or mechanics authority', () => {
    expect(BREEDING_PERFORMANCE_BUDGET_POLICY_V1).toMatchObject({
      schemaVersion: 1,
      policyId: 'ptu-1.05-breeding-performance-budgets-v1',
      measurement: {
        clock: 'node-performance-now-monotonic',
        setupPolicy: 'fixture-construction-and-module-loading-excluded',
        runnerPolicy: 'single-worker-no-file-parallelism',
        statistic: 'maximum-elapsed-release-run',
      },
    })
    expect(sha256(BREEDING_PERFORMANCE_BUDGET_POLICY_V1))
      .toBe(BREEDING_PERFORMANCE_BUDGET_POLICY_DEFINITION_SHA256)
    expect(Object.isFrozen(BREEDING_PERFORMANCE_BUDGET_POLICY_V1)).toBe(true)
    for (const value of Object.values(BREEDING_PERFORMANCE_BUDGET_POLICY_V1)) {
      if (value && typeof value === 'object') expect(Object.isFrozen(value)).toBe(true)
    }
  })

  it('keeps deterministic cardinality and UTF-8 envelopes wired into every owning runtime', () => {
    const budget = BREEDING_PERFORMANCE_BUDGET_POLICY_V1
    expect(COMPILED_BREEDING_FAMILY_COUNT).toBe(budget.registry.maximumFamilies)
    expect(COMPILED_BREEDING_SPECIES_COUNT).toBe(budget.registry.maximumSpecies)
    expect(BREEDING_CAMPAIGN_CLOCK_EGG_BATCH_MAXIMUM).toBe(budget.batchClock.maximumEggsPerBatch)
    expect(BREEDING_WORKSHOP_CONTEXT_PAGE_LIMIT).toBe(budget.workshop.maximumContextsPerPage)
    expect(budget.preview.maximumProjectedCandidates).toBeLessThanOrEqual(2048)
    expect(budget.projection.maximumProjectionUtf8Bytes).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(budget.workshop.maximumProjectionUtf8Bytes).toBeLessThanOrEqual(128 * 1024)
    expect(breedingPerformanceJsonUtf8Bytes({ value: 'é' })).toBe(Buffer.byteLength('{"value":"é"}', 'utf8'))

    expect(breedingPerformanceOutputFitsBudget('workshop', { value: 'x' })).toBe(true)
    expect(breedingPerformanceOutputFitsBudget('workshop', {
      value: 'x'.repeat(budget.workshop.maximumProjectionUtf8Bytes),
    })).toBe(false)
    const oversizedTwoMebibytes = {
      value: Array.from({ length: 3 }, () => 'x'.repeat(750_000)),
    }
    expect(breedingPerformanceOutputFitsBudget('preview', oversizedTwoMebibytes)).toBe(false)
    expect(breedingPerformanceOutputFitsBudget('projection', oversizedTwoMebibytes)).toBe(false)

    expect(source('server/useCases/discoverBreedingParents.ts'))
      .toContain("breedingPerformanceOutputFitsBudget('preview', projection)")
    expect(source('server/domain/breeding/projections.ts'))
      .toContain("breedingPerformanceOutputFitsBudget('projection', parsed)")
    expect(source('server/domain/breeding/workshop.ts'))
      .toContain("breedingPerformanceOutputFitsBudget('workshop', projection)")
  })

  it('resolves a complete compiled-registry lookup sweep inside its release ceiling', () => {
    let resolved = 0
    const startedAt = performance.now()
    for (const family of COMPILED_BREEDING_FAMILIES) {
      if (compiledBreedingFamilySpec(family.familyId) === family) resolved += 1
    }
    for (const species of COMPILED_BREEDING_SPECIES) {
      if (compiledBreedingSpeciesSpec(species.speciesId) === species) resolved += 1
    }
    const elapsed = performance.now() - startedAt

    expect(resolved).toBe(
      BREEDING_PERFORMANCE_BUDGET_POLICY_V1.registry.maximumFamilies
      + BREEDING_PERFORMANCE_BUDGET_POLICY_V1.registry.maximumSpecies,
    )
    expect(elapsed).toBeLessThanOrEqual(
      BREEDING_PERFORMANCE_BUDGET_POLICY_V1.registry.lookupSweepMaximumElapsedMilliseconds,
    )
  })

  it('builds the bounded public projection sweep inside its release ceiling', () => {
    const budget = BREEDING_PERFORMANCE_BUDGET_POLICY_V1.projection
    let largestProjectionBytes = 0
    const startedAt = performance.now()
    for (let index = 0; index < budget.benchmarkProjectionCount; index += 1) {
      const projection = buildBreedingPublicProjectionV1({
        aggregateKind: 'breeding-project',
        aggregateId: `breeding-project:v1:${index.toString(16).padStart(32, '0')}`,
        status: 'initial-time-in-progress',
        accumulatedCampaignMinutes: index % 241,
        targetCampaignMinutes: 240,
        campaignProjectionKey: 'performance-release-key-at-least-32-bytes',
        securityPolicyDefinitionSha256: 'a'.repeat(64),
      })
      largestProjectionBytes = Math.max(largestProjectionBytes, breedingPerformanceJsonUtf8Bytes(projection))
    }
    const elapsed = performance.now() - startedAt

    expect(largestProjectionBytes).toBeLessThanOrEqual(budget.maximumProjectionUtf8Bytes)
    expect(elapsed).toBeLessThanOrEqual(budget.maximumElapsedMilliseconds)
  })
})
