import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/encounter-settlement-convergence.v1.json'
import { ENCOUNTER_SETTLEMENT_CORRECTION_REASON_CODES } from '../../server/domain/encounterSettlement/correction'
import { ENCOUNTER_SETTLEMENT_REALTIME_EVENT_TYPES } from '../../shared/realtime'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-081 encounter-settlement convergence contract', () => {
  it('is versioned and hash-bound to projection, correction, recovery, realtime, policy, and storage authority', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-081',
      status: 'current-semantics',
      contract: 'encounter-settlement-convergence-v1',
      storageSchemaVersion: 44,
    })
    expect(contract.sourceEvidence).toEqual({
      settlementDocumentModelSha256: sha256('shared/encounterSettlement/document.ts'),
      projectionContractSha256: sha256('shared/encounterSettlement/projection.ts'),
      projectionRuntimeSha256: sha256('server/domain/encounterSettlement/projection.ts'),
      correctionCommandSha256: sha256('shared/encounterSettlement/correction.ts'),
      correctionRuntimeSha256: sha256('server/domain/encounterSettlement/correction.ts'),
      settlementRepositorySha256: sha256('server/storage/encounterSettlementRepository.ts'),
      correctionRepositorySha256: sha256('server/storage/encounterSettlementCorrectionRepository.ts'),
      commitUseCaseSha256: sha256('server/useCases/commitEncounterSettlement.ts'),
      correctionUseCaseSha256: sha256('server/useCases/correctEncounterSettlement.ts'),
      loadUseCaseSha256: sha256('server/useCases/loadEncounterSettlement.ts'),
      recoveryUseCaseSha256: sha256('server/useCases/getEncounterSettlementOperationStatus.ts'),
      settlementRealtimeSha256: sha256('server/realtime/encounterSettlementRealtime.ts'),
      realtimeAccessPolicySha256: sha256('server/realtime/realtimeEventAccessPolicy.ts'),
      groupAccessPolicySha256: sha256('server/policies/groupInventoryAccessPolicy.ts'),
      loadRouteSha256: sha256('server/api/encounter-settlements/[settlementId].get.ts'),
      recoveryRouteSha256: sha256('server/api/encounter-settlements/operations/status.post.ts'),
      storageMigrationsSha256: sha256('server/storage/migrations.ts'),
    })
  })

  it('defines current public, owner, and GM projections with explicit private-group custody', () => {
    expect(contract.projection.audiences).toEqual(['public', 'owner', 'gm'])
    expect(contract.projection.currentAuthority).toContain('current map access')
    expect(contract.projection.staleDraft).toContain('never rebases')
    expect(contract.projection.groupCustody).toContain('main group inventory')
    expect(contract.privacy.historyAllowlist).toContain('never returned directly')
    expect(contract.privacy.privateRewards).toContain('absent')
    expect(contract.privacy.forbiddenByDefault).toEqual(expect.arrayContaining([
      'operation identities',
      'Profile identities and principal keys',
      'authority revisions and definition hashes',
      'stored commands, plans, evidence, and provenance',
    ]))
  })

  it('journals role-specific realtime in-transaction and enforces audience again on delivery', () => {
    expect(contract.realtime.eventKinds).toEqual([
      ENCOUNTER_SETTLEMENT_REALTIME_EVENT_TYPES.UPDATED,
      ENCOUNTER_SETTLEMENT_REALTIME_EVENT_TYPES.CORRECTED,
    ])
    expect(contract.realtime.transactionalJournal).toContain('same SQLite transaction')
    expect(contract.realtime.postCommitPublication).toContain('after commit')
    expect(contract.realtime.deliveryRule).toContain('both checked')
    expect(contract.realtime.gmConvergence).toContain('cannot replace the GM projection')
    expect(contract.realtime.ownerConvergence).toContain('current role-safe load is canonical')
  })

  it('keeps correction authority linked, append-only, GM-only, and exactly replayable', () => {
    expect(contract.correction.closedReasonCodes).toEqual([
      ...ENCOUNTER_SETTLEMENT_CORRECTION_REASON_CODES,
    ])
    expect(contract.correction.authorization).toContain('Only a GM')
    expect(contract.correction.eligibleSource).toContain('superseded once')
    expect(contract.correction.appendOnly).toContain('original receipts and history remain unchanged')
    expect(contract.correction.offerBinding).toContain('definition hash')
    expect(contract.correction.lockedRevalidation).toContain('SQLite write lock')
    expect(contract.correction.exactReplay).toContain('across restart')
  })

  it('requires explicit recovery and verifies immutable evidence on reads', () => {
    expect(contract.recovery.operationStatus).toContain('exactly one retained strict command')
    expect(contract.recovery.noAutomaticReplay).toContain('never submits')
    expect(contract.recovery.identityConflict).toContain('fail closed')
    expect(contract.immutableAudit.readVerification).toContain('compare history and attention payloads')
    expect(contract.immutableAudit.crossJournalUniqueness).toContain('other journal')
    expect(contract.immutableAudit.storage).toContain('Schema 43')
  })
})
