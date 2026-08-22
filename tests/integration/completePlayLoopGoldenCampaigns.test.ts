import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import acceptance from '../../data/complete-play-loop/golden-campaign-acceptance.v1.json'
import itemFixtures from '../../data/complete-play-loop/fixtures/items.v1.json'
import settlementFixtures from '../../data/complete-play-loop/fixtures/settlements.v1.json'
import items from '../../data/reference/items.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { isLocalUiArtifactPath, readOptionalLocalUiArtifact } from '../helpers/localUiArtifacts'

const root = resolve(import.meta.dirname, '../..')
const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

const canonicalItems = items as Record<string, unknown>

describe('P8-098 complete golden campaign acceptance', () => {
  it('partitions all 21 canonical fixtures exactly once across three complete lineages', () => {
    expect(acceptance).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-098',
      status: 'accepted',
      canonicalFixtureCount: 21,
      directStorageRepairAllowed: false,
      requiredRoles: ['gm', 'player-owner'],
    })
    expect(acceptance.campaigns).toHaveLength(3)

    const expectedItems = itemFixtures.fixtures.map(row => row.id)
    const expectedSettlements = settlementFixtures.fixtures.map(row => row.id)
    const actualItems = acceptance.campaigns.flatMap(row => row.itemFixtures)
    const actualSettlements = acceptance.campaigns.flatMap(row => row.settlementFixtures)
    expect(actualItems).toHaveLength(expectedItems.length)
    expect(actualSettlements).toHaveLength(expectedSettlements.length)
    expect(new Set(actualItems)).toEqual(new Set(expectedItems))
    expect(new Set(actualSettlements)).toEqual(new Set(expectedSettlements))
    expect(new Set(actualItems).size).toBe(actualItems.length)
    expect(new Set(actualSettlements).size).toBe(actualSettlements.length)

    for (const campaign of acceptance.campaigns) {
      expect(campaign.roles).toEqual(acceptance.requiredRoles)
      expect(campaign.phases).toEqual(acceptance.requiredPhases)
      expect(campaign.manualRepairRequired).toBe(false)
    }
  })

  it('revalidates every item fixture against the current app-owned canonical record', () => {
    expect(sha256(readFileSync(resolve(root, 'data/reference/items.json')))).toBe(itemFixtures.catalogSha256)
    for (const fixture of itemFixtures.fixtures) {
      const canonical = canonicalItems[fixture.canonicalItemId]
      expect(canonical, fixture.id).toBeDefined()
      expect(sha256(stableJsonStringify(canonical)), fixture.id).toBe(fixture.canonicalRecordSha256)
      expect(['encounter', 'campaign', 'sheet', 'shop']).toContain(fixture.context)
    }
    for (const fixture of settlementFixtures.fixtures) expect(fixture.retry).toBe('exact-terminal-result')
  })

  it('binds every required phase to executable evidence and both production roles', () => {
    expect(Object.keys(acceptance.phaseEvidence)).toEqual(acceptance.requiredPhases)
    for (const phase of acceptance.requiredPhases) {
      const paths = acceptance.phaseEvidence[phase as keyof typeof acceptance.phaseEvidence]
      expect(paths.length, phase).toBeGreaterThan(0)
      expect(paths.some(path => path.startsWith('tests/')), phase).toBe(true)
      for (const path of paths) expect(readFileSync(resolve(root, path), 'utf8').length).toBeGreaterThan(500)
    }
    expect(acceptance.productionLiveplayEvidence).toHaveLength(4)
    for (const journey of acceptance.productionLiveplayEvidence) {
      expect(journey.projects).toEqual(['chromium', 'mobile-chromium'])
      expect(journey.gmAndPlayer).toBe(true)
      expect(journey.manualRepair).toBe(false)
      const reportBytes = readOptionalLocalUiArtifact(root, journey.report)
      if (reportBytes) expect(reportBytes.toString('utf8').toLowerCase()).toMatch(/pass|accepted/)
    }
  })

  it('allows only one deterministic pre-journey seed and prohibits storage repair during acceptance', () => {
    expect(acceptance.fixtureSeedPolicy).toEqual({
      preJourneyDeterministicSeedAllowed: true,
      seedIsAcceptanceOutcomeRepair: false,
      onlyStorageSeedHarness: 'tests/e2e/finish-encounter.spec.ts#seedSettlementDraft',
      afterFirstRuntimeCommandDirectStorageWritesAllowed: false,
    })
    const browserSpecs = [...new Set(Object.values(acceptance.phaseEvidence).flat()
      .filter(path => path.startsWith('tests/e2e/')))]
    const directStorageSpecs: string[] = []
    for (const path of browserSpecs) {
      const source = readFileSync(resolve(root, path), 'utf8')
      if (/node:sqlite|better-sqlite3|server\/storage/u.test(source)) directStorageSpecs.push(path)
    }
    expect(directStorageSpecs).toEqual(['tests/e2e/finish-encounter.spec.ts'])
    const finishSource = readFileSync(resolve(root, directStorageSpecs[0]!), 'utf8')
    expect(finishSource).toContain('const seedSettlementDraft')
    expect(finishSource.match(/INSERT INTO encounter_settlements/gu)).toHaveLength(1)
    expect(finishSource).not.toMatch(/\b(?:UPDATE|DELETE FROM)\s+encounter_settlements\b/iu)
    expect(finishSource.indexOf('seedSettlementDraft({')).toBeLessThan(finishSource.indexOf('.goto('))
  })

  it('keeps all continuity, replay, privacy, and fresh-authority gates closed', () => {
    expect(acceptance.continuityAssertions).toEqual({
      acceptedReceiptsDriveNextAuthority: true,
      exactRowsNeverReidentifiedByName: true,
      settlementIsAtomic: true,
      attentionIsRoleScoped: true,
      nextDayRequiresReviewedPreflight: true,
      nextSceneLoadsFreshAuthority: true,
      replayNeverDuplicates: true,
      privateEvidenceNeverRendered: true,
    })
  })

  it('hash-binds fixtures, runtime evidence, browser journeys, reports, and operator guidance', () => {
    const paths = new Set<string>()
    for (const row of acceptance.sourceEvidence) {
      expect(paths.has(row.path), row.path).toBe(false)
      paths.add(row.path)
      expect(row.sha256).toMatch(/^[a-f0-9]{64}$/)
      const bytes = isLocalUiArtifactPath(row.path)
        ? readOptionalLocalUiArtifact(root, row.path)
        : readFileSync(resolve(root, row.path))
      if (bytes) expect(sha256(bytes), row.path).toBe(row.sha256)
    }
    for (const path of [
      'data/reference/items.json',
      'data/complete-play-loop/fixtures/items.v1.json',
      'data/complete-play-loop/fixtures/settlements.v1.json',
      ...Object.values(acceptance.phaseEvidence).flat(),
      ...acceptance.productionLiveplayEvidence.map(row => row.report),
      'tests/integration/completePlayLoopGoldenCampaigns.test.ts',
      'docs/complete-play-loop-golden-campaigns.md',
      'package.json',
      'scripts/quality-gate.sh',
    ]) expect(paths.has(path), path).toBe(true)
  })
})
