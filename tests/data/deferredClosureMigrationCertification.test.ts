import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/migration-upgrade-certification.v1.json'
import predecessor from '../../data/deferred-closure/integrated-golden-journeys-certification.v1.json'
import { LATEST_STORAGE_SCHEMA_VERSION, STORAGE_MIGRATIONS } from '../../server/storage/migrations'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const verify = (row: { path: string, sha256: string }): void => {
  expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(repositoryFileSha256(row.path))
}

describe('P11-082 migration and upgrade certification', () => {
  it('continues from the exact integrated golden-journey certificate', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-migration-upgrade-v1',
      ticket: 'P11-082',
      status: 'certified',
      manualRepairRequired: false,
    })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    expect(certification.predecessor.sha256).toBe(sha256('data/deferred-closure/integrated-golden-journeys-certification.v1.json'))
    expect(predecessor.status).toBe('certified')
  })

  it('binds exactly the four contiguous Plan 11 storage versions', () => {
    expect(LATEST_STORAGE_SCHEMA_VERSION).toBe(50)
    expect(certification.storageAuthority).toEqual({
      baselineVersion: 46,
      latestVersion: 50,
      plan11Versions: [47, 48, 49, 50],
      migrationNames: STORAGE_MIGRATIONS.slice(46).map(row => row.name),
      transaction: 'begin-immediate-all-versions-or-rollback',
    })
  })

  it('certifies fresh creation, each historical head, rollback, and downgrade refusal', () => {
    expect(certification.upgradeMatrix).toEqual([
      { fromVersion: 0, appliedVersions: Array.from({ length: 50 }, (_, index) => index + 1), toVersion: 50, result: 'accepted' },
      { fromVersion: 46, appliedVersions: [47, 48, 49, 50], toVersion: 50, result: 'accepted-row-preserving' },
      { fromVersion: 47, appliedVersions: [48, 49, 50], toVersion: 50, result: 'accepted-row-preserving' },
      { fromVersion: 48, appliedVersions: [49, 50], toVersion: 50, result: 'accepted-row-preserving' },
      { fromVersion: 49, appliedVersions: [50], toVersion: 50, result: 'accepted-row-preserving' },
      { fromVersion: 51, appliedVersions: [], toVersion: 51, result: 'refused-newer-schema-no-write' },
    ])
    expect(certification.acceptance).toMatchObject({
      freshDatabaseCreation: true,
      historicalUpgradeHeads: [46, 47, 48, 49],
      rowRewritesOutsideMigrations: 0,
      manualRepairs: 0,
      partialWritesOnFailure: 0,
      foreignKeyViolations: 0,
      unknownFutureSchemaWrites: 0,
      contestParallelTablesAdded: 0,
      nextTicket: 'P11-083',
    })
  })

  it('hash-binds migration authority, executable evidence, and operator guidance', () => {
    for (const row of certification.authorities) verify(row)
    for (const row of certification.evidence) verify(row)
    const paths = new Set([...certification.authorities, ...certification.evidence].map(row => row.path))
    for (const path of [
      'server/storage/migrations.ts',
      'server/storage/database.ts',
      'tests/server/deferredClosureStorageMigrations.test.ts',
      'tests/server/realtimeEventMigrations.test.ts',
      'tests/server/skillCheckStorage.test.ts',
      'tests/server/contestStorageRecovery.test.ts',
      'tests/data/deferredClosureMigrationCertification.test.ts',
      'docs/deferred-mechanics-storage-upgrades.md',
      'docs/private-vps-backups.md',
      'package.json',
    ]) expect(paths.has(path), path).toBe(true)
  })
})
