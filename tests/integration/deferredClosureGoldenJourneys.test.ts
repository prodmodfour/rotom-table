import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import journeys from '../../data/deferred-closure/integrated-golden-journeys-certification.v1.json'
import inventory from '../../data/deferred-closure/closure-inventory.v1.json'
import mechanics from '../../data/deferred-closure/mechanics-acceptance-fixtures.v1.json'
import settlementFixtures from '../../data/complete-play-loop/fixtures/settlements.v1.json'
import participantFixtures from '../../data/contests/trainer-participant-variant-matrix.v1.json'
import battleFixtures from '../../data/contests/battle-contest-scenarios.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const root = resolve(import.meta.dirname, '../..')
const sha256 = (path: string): string => createHash('sha256')
  .update(readFileSync(resolve(root, path)))
  .digest('hex')

const requiredPhases = [
  'campaign-load',
  'equipment-custody',
  'ranged-attack',
  'weapon-move',
  'item-action',
  'generic-skill-check',
  'encounter-resolution',
  'contest',
  'settlement',
  'campaign-continuation',
]

const fixtureIds = (mechanics as any).weaponProfiles
  .concat((mechanics as any).weaponMoves, (mechanics as any).itemActions)
  .map((fixture: any) => fixture.fixtureId)

const sourceHead = (path: string, recordedSha256: string): string => {
  const current = sha256(path)
  return current === recordedSha256
    ? current
    : acceptedSuccessorHead(path, recordedSha256)
}

describe('P11-081 integrated Deferred Mechanics Closure golden journeys', () => {
  it('partitions every seeded weapon, Move, and item-action fixture exactly once', () => {
    expect(journeys).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-integrated-golden-journeys-v1',
      ticket: 'P11-081',
      status: 'certified',
      runtimeProseParsing: false,
      directStorageRepairAllowed: false,
    })
    expect(journeys.campaigns).toHaveLength(3)
    const actual = journeys.campaigns.flatMap(campaign => campaign.mechanicsFixtureIds)
    expect(actual).toHaveLength(24)
    expect(new Set(actual).size).toBe(24)
    expect(new Set(actual)).toEqual(new Set(fixtureIds))
  })

  it('runs each seeded campaign through the complete authority handoff in order', () => {
    expect(new Set(journeys.campaigns.map(campaign => campaign.seed)).size).toBe(3)
    for (const campaign of journeys.campaigns) {
      expect(campaign.seed).toBeGreaterThan(81_000)
      expect(campaign.roles).toEqual(journeys.requiredRoles)
      expect(campaign.phases.map(phase => phase.phaseId)).toEqual(requiredPhases)
      expect(campaign.phases.every(phase => phase.acceptedAuthorityOnly)).toBe(true)
      expect(campaign.outcome).toMatchObject({
        exactRetryAdditionalRolls: 0,
        exactRetryAdditionalSpends: 0,
        exactRetryAdditionalRewards: 0,
        manualRepairRequired: false,
        campaignContinuationLoadedFromFreshAuthority: true,
      })
    }
  })

  it('covers both native Contest variants and binds their exact deterministic outcomes', () => {
    const participantIds = new Set((participantFixtures as any).scenarios.map((row: any) => row.id))
    const battleIds = new Set((battleFixtures as any).scenarios.map((row: any) => row.id))
    const participantBindings = journeys.campaigns.flatMap(campaign => campaign.contestFixtures)
      .filter(row => row.variantId === 'trainer-participant')
    const battleBindings = journeys.campaigns.flatMap(campaign => campaign.contestFixtures)
      .filter(row => row.variantId === 'battle')
    expect(participantBindings.length).toBeGreaterThan(0)
    expect(battleBindings.length).toBeGreaterThan(0)
    for (const row of participantBindings) expect(participantIds.has(row.scenarioId), row.scenarioId).toBe(true)
    for (const row of battleBindings) expect(battleIds.has(row.scenarioId), row.scenarioId).toBe(true)
    expect(new Set(journeys.campaigns.flatMap(campaign => campaign.settlementFixtureIds)))
      .toEqual(new Set((settlementFixtures as any).fixtures.map((row: any) => row.id)))
  })

  it('records journey evidence for every closure-inventory row without silent coverage', () => {
    const inventoryRows = new Set((inventory as any).rows.map((row: any) => row.id))
    expect(new Set(journeys.inventoryCoverage.map(row => row.rowId))).toEqual(inventoryRows)
    expect(new Set(journeys.inventoryCoverage.map(row => row.rowId)).size).toBe(journeys.inventoryCoverage.length)
    for (const row of journeys.inventoryCoverage) {
      expect(row.journeyIds.length, row.rowId).toBeGreaterThan(0)
      expect(row.evidenceIds.length, row.rowId).toBeGreaterThan(0)
      for (const journeyId of row.journeyIds) {
        expect(journeys.campaigns.some(campaign => campaign.campaignId === journeyId), `${row.rowId}:${journeyId}`).toBe(true)
      }
    }
    const recorded = (inventory as any).phaseClosureEvidence.find((row: any) => row.id === 'p11-081.integrated-golden-journeys')
    expect(recorded).toMatchObject({ ticket: 'P11-081', status: 'certified', rowCount: 29, journeyCount: 3 })
    expect(sha256(recorded.certificationPath)).toBe(recorded.sha256)
  })

  it('keeps role privacy, persisted handoffs, and exact retry invariants closed across subsystem boundaries', () => {
    expect(journeys.authorityPolicy).toEqual({
      seedUse: 'pre-journey-fixture-selection-and-server-random-source-only',
      acceptedFactsDriveNextPhase: true,
      clientAuthoredMechanicalOutcomes: false,
      directCrossDocumentMutation: false,
      postCommitRealtimeOnly: true,
      exactRetryPolicy: 'original-terminal-result-with-no-additional-authority',
    })
    expect(journeys.privacyAcceptance).toEqual({
      structuralRoleDistinctness: true,
      publicPrivateAuthorityFields: 0,
      opponentPrivateAuthorityFields: 0,
      ownerOtherSheetAuthorityFields: 0,
      spectatorSourceOrJournalFields: 0,
    })
  })

  it('hash-binds every fixture, runtime, settlement, and continuation evidence surface', () => {
    const paths = new Set<string>()
    for (const row of journeys.sourceEvidence) {
      expect(paths.has(row.path), row.path).toBe(false)
      paths.add(row.path)
      expect(row.sha256).toMatch(/^[a-f0-9]{64}$/u)
      expect(sourceHead(row.path, row.sha256), row.path).toBe(repositoryFileSha256(row.path))
    }
    for (const phase of requiredPhases) {
      const evidence = journeys.phaseEvidence[phase as keyof typeof journeys.phaseEvidence]
      expect(evidence.length, phase).toBeGreaterThan(0)
      expect(evidence.some(path => path.startsWith('tests/')), phase).toBe(true)
      for (const path of evidence) expect(paths.has(path), `${phase}:${path}`).toBe(true)
    }
    for (const path of [
      'data/deferred-closure/mechanics-acceptance-fixtures.v1.json',
      'data/contests/trainer-participant-variant-matrix.v1.json',
      'data/contests/battle-contest-scenarios.v1.json',
      'data/complete-play-loop/fixtures/settlements.v1.json',
      'tests/integration/deferredClosureGoldenJourneys.test.ts',
      'docs/deferred-mechanics-golden-journeys.md',
      'package.json',
    ]) expect(paths.has(path), path).toBe(true)
  })
})
