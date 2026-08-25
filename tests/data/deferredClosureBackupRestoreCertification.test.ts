import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/backup-restore-certification.v1.json'
import migration from '../../data/deferred-closure/migration-upgrade-certification.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const verify = (row: { path: string, sha256: string }): void => {
  expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(repositoryFileSha256(row.path))
}

describe('P11-083 backup, restore, restart, and reconnect certification', () => {
  it('continues from the exact accepted migration certificate and existing operator workflow', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-backup-restore-reconnect-v1',
      ticket: 'P11-083',
      status: 'certified',
      toolingAdded: 0,
      manualRepairRequired: false,
    })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    expect(migration.status).toBe('certified')
    expect(certification.workflow).toEqual({
      runbook: 'docs/private-vps-backups.md',
      method: 'preferred-stopped-service-closed-sqlite-copy',
      integrityCheck: 'ok',
      foreignKeyViolations: 0,
      archiveOrDatabaseCommittedToRepository: false,
    })
  })

  it('certifies every required durable Plan 11 state and exact replay after restore', () => {
    expect(certification.durableStates).toEqual([
      { stateId: 'generic-skill-check', documentCopies: 1, operationCopies: 3, duplicateRollsAfterRestore: 0 },
      { stateId: 'readied-shield', effectCopies: 3, operationCopies: 1, duplicateEffectsAfterRestore: 0 },
      { stateId: 'netted-target', effectCopies: 4, operationCopies: 1, duplicateEffectsAfterRestore: 0 },
      { stateId: 'linked-battle-contest', contestCopies: 1, encounterCopies: 1, mapCopies: 1, duplicateLinksAfterRestore: 0 },
    ])
    expect(certification.acceptance).toEqual({
      byteExactTrackedTables: 9,
      lostAuthorityRows: 0,
      duplicateAuthorityRows: 0,
      restartReloads: 1,
      reconnectReloads: 3,
      exactRetryAdditionalRealtimeRows: 0,
      manualRepairs: 0,
      nextTicket: 'P11-084',
    })
  })

  it('hash-binds storage, runtime replay, operator, and executable evidence', () => {
    for (const row of certification.authorities) verify(row)
    for (const row of certification.evidence) verify(row)
    const paths = new Set([...certification.authorities, ...certification.evidence].map(row => row.path))
    for (const path of [
      'server/storage/database.ts',
      'server/storage/equipmentActionOperationRepository.ts',
      'server/storage/skillCheckRepository.ts',
      'server/storage/contestRepository.ts',
      'server/storage/encounterDocumentRepository.ts',
      'tests/server/deferredClosureBackupRestore.test.ts',
      'tests/server/equipmentActionUseCase.test.ts',
      'tests/server/skillChecksRuntime.test.ts',
      'tests/server/contestBattleEncounterRuntime.test.ts',
      'tests/docs/privateVpsBackupRunbook.test.ts',
      'tests/data/deferredClosureBackupRestoreCertification.test.ts',
      'docs/private-vps-backups.md',
      'package.json',
    ]) expect(paths.has(path), path).toBe(true)
  })
})
