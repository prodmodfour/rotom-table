import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/gm-campaign-toolkit/recovery-performance-certification.v1.json'
import budgets from '../../data/gm-campaign-toolkit/performance-scale-budgets.v1.json'
import { LATEST_STORAGE_SCHEMA_VERSION, STORAGE_MIGRATIONS } from '../../server/storage/migrations'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P12-084 recovery and performance certification', () => {
  it('binds the fresh and exact v50→v56 migration matrix', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, ticket: 'P12-084', status: 'certified' })
    expect(LATEST_STORAGE_SCHEMA_VERSION).toBe(56)
    expect(certification.storage).toMatchObject({ baselineVersion: 50, latestVersion: 56, plan12Versions: [51, 52, 53, 54, 55, 56], ordinaryAuthorityRowsRewritten: 0, foreignKeyViolations: 0, manualRepairRequired: false })
    expect(STORAGE_MIGRATIONS.slice(50).map(row => row.version)).toEqual(certification.storage.plan12Versions)
    expect(certification.storage.upgradeMatrix.map(row => row.fromVersion)).toEqual([0, 50, 51, 52, 53, 54, 55, 57])
  })

  it('certifies retry, concurrency, restart, correction, cancellation, backup, inert preview, and integrity behavior', () => {
    expect(certification.recoveryMatrix).toMatchObject({ exactRetryAdditionalAuthority: 0, changedMaterialStatus: 409, staleRevisionStatus: 409, concurrentGmAcceptedPerRevision: 1, concurrentGmLostUpdates: 0, restartRedraws: 0, reconnectConverges: true, journalRewritesAfterCorrection: 0, cancelledHistoryPreserved: true })
    expect(certification.backupRestore).toMatchObject({ method: 'sqlite-online-backup', restartMigrationsApplied: 0, foreignKeyViolations: 0, integrityErrors: 0 })
    expect(certification.previewInertness).toMatchObject({ wildRequestedSlots: 30, npcTrainerCount: 1, npcRosterCount: 6, durableRowsAdded: 0, realtimeAdded: 0, previewTokenColumns: 0 })
    expect(certification.integrityAudit).toMatchObject({ readOnly: true, positiveFixtureErrors: 0, injectedOrphanDetected: true })
    expect(Object.values(certification.acceptance).filter(value => value === false)).toEqual([])
    expect(certification.acceptance.nextTicket).toBe('P12-085')
  })

  it('binds the exact reviewed scale and every latency/payload budget', () => {
    expect(certification.performance.budgetSha256).toBe(sha256(certification.performance.budgetPath))
    expect(certification.performance.scale).toEqual(budgets.scale)
    expect(new Set(certification.performance.passedBudgets)).toEqual(new Set(Object.keys(budgets.budgetsMs)))
    expect(new Set(certification.performance.projectionBudgetsPassed)).toEqual(new Set(Object.keys(budgets.projectionBytes)))
    expect(certification.realtime).toMatchObject({ clientCount: 6, gmTabCount: 2, convergedHeads: 1, duplicateSequenceDelivery: 0, privateContentInToolkitInvalidation: false, maximumBudgetPassed: true })
  })

  it('hash-binds every runtime authority and executable evidence file', () => {
    for (const row of [...certification.authorities, ...certification.evidence]) expect(sha256(row.path), row.path).toBe(row.sha256)
  })
})
