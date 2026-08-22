import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/finish-encounter-experience.v1.json'
import settlementFixtures from '../../data/complete-play-loop/fixtures/settlements.v1.json'
import { FINISH_ENCOUNTER_VIEW_SCHEMA_VERSION } from '../../shared/encounterSettlement/finish'
import { ENCOUNTER_SETTLEMENT_PENDING_SCHEMA_VERSION } from '../../src/utils/encounterSettlementOperationStorage'
import { readOptionalLocalUiArtifact } from '../helpers/localUiArtifacts'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

const verifyLocalArtifactSha256 = (path: string, expected: string): void => {
  expect(expected).toMatch(/^[a-f0-9]{64}$/)
  const bytes = readOptionalLocalUiArtifact(process.cwd(), path)
  if (bytes) expect(createHash('sha256').update(bytes).digest('hex'), path).toBe(expected)
}

describe('P8-082 Finish Encounter experience contract', () => {
  it('is certified and hash-bound to server, recovery, workspace, and production-liveplay authority', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-082',
      status: 'certified',
      contract: 'finish-encounter-experience-v1',
      storageSchemaVersion: 44,
    })
    expect(FINISH_ENCOUNTER_VIEW_SCHEMA_VERSION).toBe(1)
    expect(contract.sourceEvidence).toEqual({
      finishViewContractSha256: sha256('shared/encounterSettlement/finish.ts'),
      preparationUseCaseSha256: sha256('server/useCases/prepareFinishEncounter.ts'),
      finishUseCaseSha256: sha256('server/useCases/finishEncounter.ts'),
      settlementRepositorySha256: sha256('server/storage/encounterSettlementRepository.ts'),
      livePlayOperationRepositorySha256: sha256('server/storage/opRepository.ts'),
      temporaryCleanupModelSha256: sha256('server/domain/encounterSettlement/temporaryCleanup.ts'),
      prepareRouteSha256: sha256('server/api/encounter-settlements/finish/prepare.post.ts'),
      commitRouteSha256: sha256('server/api/encounter-settlements/finish/commit.post.ts'),
      operationStatusRouteSha256: sha256('server/api/encounter-settlements/operations/status.post.ts'),
      pendingStorageSha256: sha256('src/utils/encounterSettlementOperationStorage.ts'),
      finishComposableSha256: sha256('src/composables/encounter/useFinishEncounter.ts'),
      finishComponentSha256: sha256('src/components/encounter/workspace/EncounterFinishExperience.vue'),
      directorComponentSha256: sha256('src/components/encounter/workspace/EncounterDirectorPanel.vue'),
      workspacePageSha256: sha256('src/pages/play/[encounterId].vue'),
      browserSpecSha256: sha256('tests/e2e/finish-encounter.spec.ts'),
      browserConfigSha256: sha256('playwright.p8082-reuse.config.ts'),
      targetMockupSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    verifyLocalArtifactSha256(
      '.pi/artifacts/ui-mockups/finish-encounter-experience/v001.png',
      contract.sourceEvidence.targetMockupSha256,
    )
  })

  it('requires one current server-owned read and fails closed for ambiguous allocation or outcome authority', () => {
    expect(contract.authority.entry).toContain('Only a current GM')
    expect(contract.authority.currentRead).toContain('every participant sheet')
    expect(contract.authority.affiliation).toContain('explicit SheetPlacement.sideId')
    expect(contract.authority.rewards).toContain('never invents a reward')
    expect(contract.authority.experience).toContain('never default across opponents')
    expect(contract.authority.captureBounds).toContain('10000')
    expect(contract.authority.outcomes).toContain('required decisions')
    expect(contract.authority.cleanup).toContain('battlefield-zone adapter')
  })

  it('binds the one confirmation to the exact all-or-nothing server plan', () => {
    expect(contract.commit.commandFields).toEqual([
      'schemaVersion', 'operationId', 'settlementId', 'expectedSettlementRevision',
      'planDefinitionSha256', 'confirmed',
    ])
    expect(contract.commit.serverOwned).toContain('never authors patches')
    expect(contract.commit.atomic).toContain('one synchronous SQLite transaction')
    expect(contract.commit.atomic).toContain('all roll back')
    expect(contract.commit.replay).toContain('across retry and restart')
    expect(contract.commit.publication).toContain('only after commit')
  })

  it('keeps recovery durable, cross-tab exclusive, and explicit-only', () => {
    expect(contract.recovery.storageSchemaVersion).toBe(ENCOUNTER_SETTLEMENT_PENDING_SCHEMA_VERSION)
    expect(contract.recovery.retention).toContain('scope lock')
    expect(contract.recovery.crossTab).toContain("cannot remove another tab's command")
    expect(contract.recovery.uncertain).toContain('never resubmits automatically')
    expect(contract.recovery.discard).toContain('status check returns unknown')
    expect(contract.recovery.conflict).toContain('fresh')
  })

  it('certifies exact copy, privacy, accessibility, 320px reflow, zoom, and fixture outcomes', () => {
    expect(contract.experience.requiredCopy).toEqual([
      'Finish Encounter',
      'Ready to settle',
      'No unresolved decisions',
      'Persistent consequences',
      'Rewards & allocations',
      'Encounter outcome',
      'Temporary cleanup',
      'Outstanding work',
      'I reviewed this settlement and understand it cannot be partly applied.',
      'Finish encounter',
      'Back to encounter',
    ])
    expect(contract.privacy.player).toContain('no Director entry')
    expect(contract.privacy.forbiddenRenderedFields).toEqual(expect.arrayContaining([
      'operation identities',
      'Profile identities and principal keys',
      'authority revisions and definition hashes',
    ]))
    expect(contract.experience.focus).toContain('Tab is trapped')
    expect(contract.experience.responsive).toContain('320 px')
    expect(contract.experience.responsive).toContain('200-percent')
    expect(contract.experience.targets).toContain('44 px')
    expect(Object.keys(contract.certification.fixtureCoverage)).toEqual(
      settlementFixtures.fixtures.map(fixture => fixture.id),
    )
    expect(contract.certification.fixtureCoverage['loot-heavy']).toContain('12 Potions')
    expect(contract.certification.fixtureCoverage['injury-heavy']).toContain('five Injuries')
    expect(contract.certification.fixtureCoverage['reconnect-during-settlement']).toContain('cross-tab lock')
    expect(contract.certification.maximumReviewMilliseconds).toBe(120_000)
    expect(contract.certification.sheetOrInventoryVisits).toBe(0)
    expect(contract.certification.assertions).toEqual(expect.arrayContaining([
      'no serious or critical scoped Axe violations',
      'XP and shared money applied exactly once',
      'HP, injury, and condition persisted',
      'round weather expired and initiative reset',
    ]))
    for (const [path, expected] of [
      ['.pi/artifacts/ui-validation/finish-encounter/chromium-ready.png', contract.certification.desktop.readySha256],
      ['.pi/artifacts/ui-validation/finish-encounter/chromium-accepted.png', contract.certification.desktop.acceptedSha256],
      ['.pi/artifacts/ui-validation/finish-encounter/mobile-chromium-ready.png', contract.certification.mobile320.readySha256],
      ['.pi/artifacts/ui-validation/finish-encounter/mobile-chromium-accepted.png', contract.certification.mobile320.acceptedSha256],
    ] as const) verifyLocalArtifactSha256(path, expected)
  })
})
