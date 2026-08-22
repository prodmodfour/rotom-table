import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteContestRepository } from '../../server/storage/contestRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createContestDocument } from '../../shared/contests/document'
import type { ContestCommandV1 } from '../../shared/contests/operations'

const directories: string[] = []
const databases: RotomDatabase[] = []
afterEach(() => {
  while (databases.length) databases.pop()!.close()
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true })
})
const open = (path: string): RotomDatabase => { const database = openRotomDatabase({ path, enableWal: false }); databases.push(database); return database }

describe('Contest fresh database, restart, backup, and restore', () => {
  it('migrates fresh storage and restores documents, journals, and operation receipts byte-equivalently', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rotom-contest-recovery-')); directories.push(directory)
    const livePath = join(directory, 'campaign.sqlite')
    let database = open(livePath)
    expect(Number((database.connection.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)).toBeGreaterThanOrEqual(46)
    for (const table of ['contests','contest_operations','contest_preparation_operations','contest_ux_metric_aggregates']) {
      expect(database.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)).toBeTruthy()
    }
    const repository = createSqliteContestRepository(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({ kind: 'trainer', slug: 'legacy-contest-trainer', revision: 0, updatedAt: 10, document: { slug: 'legacy-contest-trainer', name: 'Archived Trainer', contestResults: [{ schemaVersion: 1, resultId: 'contest:v1:old:result:contestant:old', contestId: 'contest:v1:old', hallName: 'Old Hall', contestName: 'Old Contest', contestTypeId: 'cute', variantId: 'standard', placement: 1, score: 12, pokemonSheetSlugs: ['old-partner'], completedAt: 9 }] } })
    const document = createContestDocument({ contestId: 'contest:v1:restore-test', name: 'Restore Test', hallName: 'Archive Hall', description: '', variantId: 'standard', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: 'private restore evidence', now: 10 })
    repository.insert(document)
    const command = { schemaVersion: 1, contestId: document.contestId, operationId: 'contest-op:v1:restore-create', commandKind: 'create-contest', expectedRevision: 0, clientId: 'recovery', settings: { name: 'Restore Test', hallName: 'Archive Hall', description: '', variantId: 'standard', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: 'private restore evidence' } } as ContestCommandV1
    repository.recordOperation(command, { schemaVersion: 1, ok: true, operationId: command.operationId, contestId: document.contestId, commandKind: command.commandKind, revision: document.revision, stage: document.stage, updatedAt: document.updatedAt, exactRetry: false }, 10)
    const originalJson = JSON.stringify(repository.get(document.contestId)!.document)
    const operationHash = repository.findOperation(command.operationId)!.commandHash
    database.close(); databases.splice(databases.indexOf(database), 1)

    const backupPath = join(directory, 'campaign-backup.sqlite')
    copyFileSync(livePath, backupPath)
    database = open(livePath)
    expect(JSON.stringify(createSqliteContestRepository(database).get(document.contestId)!.document)).toBe(originalJson)
    database.close(); databases.splice(databases.indexOf(database), 1)

    const restored = open(backupPath)
    const restoredRepository = createSqliteContestRepository(restored)
    expect(JSON.stringify(restoredRepository.get(document.contestId)!.document)).toBe(originalJson)
    expect(restoredRepository.findOperation(command.operationId)!.commandHash).toBe(operationHash)
    expect(restoredRepository.findOperation(command.operationId)!.result.stage).toBe('setup')
    const restoredLegacyResult = (createSqliteSheetRepository<Record<string, unknown>>(restored).getByRef('trainer', 'legacy-contest-trainer')!.sheet as any).contestResults[0]
    expect(restoredLegacyResult).toMatchObject({ placement: 1, score: 12 })
    expect(restoredLegacyResult.ribbonAwarded).toBeUndefined()
    expect(restoredLegacyResult.ribbonIds).toBeUndefined()
  })
})
