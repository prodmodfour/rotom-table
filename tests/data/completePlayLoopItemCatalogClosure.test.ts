import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import closure from '../../data/complete-play-loop/item-catalog-closure.v1.json'
import cohorts from '../../data/complete-play-loop/item-catalog-cohorts.v1.json'
import guided from '../../data/complete-play-loop/guided-catalog-items.v1.json'
import capture from '../../data/complete-play-loop/capture-pokeballs.v1.json'
import remediation from '../../data/complete-play-loop/canonical-data-remediation.v1.json'
import successors from '../../data/deferred-closure/successor-chain.v1.json'
import { LATEST_STORAGE_SCHEMA_VERSION } from '../../server/storage/migrations'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

describe('P8-093 canonical item catalog closure certification', () => {
  it('closes every former blocked row without prose parsing or a reference-only fallback', () => {
    expect(closure).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-093',
      status: 'implemented',
      contract: 'canonical-item-catalog-closure-v1',
      runtimeProseParsing: false,
      storageSchemaVersion: 46,
      catalog: {
        canonicalItemCount: 349,
        cohortCount: 19,
        implementationStateCounts: { native: 205, guided: 40, passive: 104, blocked: 0 },
        remainingBlockedRows: 0,
      },
      formerBlockedSet: {
        captureRows: 25,
        interpretiveCampaignToolRows: 34,
        blackSludgeCanonicalDefectRows: 1,
        closedRows: 60,
      },
    })
    expect(LATEST_STORAGE_SCHEMA_VERSION).toBeGreaterThanOrEqual(closure.storageSchemaVersion)
    expect(cohorts.implementationStateCounts).toEqual({ native: 205, guided: 40, passive: 104 })
    expect(cohorts.cohorts.some(cohort => cohort.implementationState === 'blocked')).toBe(false)
    expect(cohorts.cohorts.some(cohort => cohort.implementationState === 'reference-only')).toBe(false)
    expect(cohorts.itemCount).toBe(349)
  })

  it('certifies exact guided disposition, structured capture, and reviewed Black Sludge repair', () => {
    expect(closure.guidedCampaignTools).toEqual({
      itemCount: 34,
      reusableCount: 17,
      consumableCount: 17,
      choiceId: 'gm-campaign-tool-outcome',
      acceptedOptionId: 'accept-reviewed-use',
      freeformMechanics: false,
      consumablesReserveExactUnit: true,
      reusableSourcesRetained: true,
      privateDurableReceipts: true,
      cancellationRefundsWithoutMutation: true,
    })
    expect(guided.itemCount).toBe(34)
    expect(guided.runtimeProseParsing).toBe(false)
    expect(closure.capture).toMatchObject({
      itemCount: 25,
      exactStableSourceRowRequired: true,
      trainerRevisionRequired: true,
      sameNameFallbackForbidden: true,
      structuredModifierAuthority: true,
      atomicConsumptionAndOutcomeReceipt: true,
      exactReplayDoesNotReroll: true,
      unsupportedConditionsFailClosedWithReason: true,
    })
    expect(capture.itemCount).toBe(25)
    expect(capture.runtimeProseParsing).toBe(false)
    expect(closure.blackSludge).toEqual({
      canonicalAcquisitionCost: '$500',
      implementationState: 'native',
      requiredTargetType: 'Poison',
      digestionBuff: { kind: 'turn-start-heal', numerator: 1, denominator: 8, duration: 'encounter' },
      sourceHashBoundMigration: true,
    })
    expect(remediation.openDefects).toEqual([])
    expect(remediation.reviewedMigrations).toContainEqual(expect.objectContaining({
      migrationId: 'item-black-sludge-acquisition-cost-v1',
      canonicalId: 'Black Sludge',
      reviewStatus: 'accepted',
    }))
  })

  it('pins every reviewed source and records strict private projection boundaries', () => {
    expect(closure.sourceEvidence.length).toBeGreaterThanOrEqual(40)
    expect(new Set(closure.sourceEvidence.map(source => source.path)).size).toBe(closure.sourceEvidence.length)
    for (const source of closure.sourceEvidence) {
      expect(source.path).not.toMatch(/^\//)
      expect(source.path.split('/')).not.toContain('..')
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/)
      const currentSha256 = sha256(readFileSync(source.path))
      if (currentSha256 !== source.sha256) {
        const edges = successors.edges.filter(edge => (
          edge.surface === source.path && edge.reviewStatus === 'accepted'
        ))
        const visited = new Set<string>()
        let cursor = source.sha256
        while (cursor !== currentSha256) {
          expect(visited.has(cursor), `${source.path} successor chain must not cycle`).toBe(false)
          visited.add(cursor)
          const candidates = edges.filter(edge => edge.beforeSha256 === cursor)
          expect(candidates, `${source.path} must have one contiguous accepted successor from ${cursor}`).toHaveLength(1)
          cursor = candidates[0]!.afterSha256
        }
      }
      else expect(currentSha256, source.path).toBe(source.sha256)
    }
    expect(closure.privacy.forbidden).toEqual(expect.arrayContaining([
      'operation IDs', 'request IDs', 'source instance IDs', 'inventory row IDs',
      'definition hashes', 'Profile IDs', 'private receipts', 'ownership evidence', 'private notes',
    ]))
    expect(closure.failClosed).toEqual(expect.arrayContaining([
      'stale source revision or unavailable exact row',
      'same-name source substitution or duplicate exact source identity',
      'unsupported Poké Ball condition authority',
    ]))
  })
})
