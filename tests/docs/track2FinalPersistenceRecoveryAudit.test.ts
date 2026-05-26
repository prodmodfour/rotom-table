import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')
const exists = (relativePath: string): boolean => existsSync(resolve(repoRoot, relativePath))

describe('Track 2 final persistence and recovery audit', () => {
  const audit = readText('docs/track-2-final-persistence-recovery-audit.md')

  it('records the ticket 095 persistence and recovery audit outcome and scope', () => {
    expect(audit).toContain('Ticket 095')
    expect(audit).toContain('Audit date: 2026-05-26')
    expect(audit).toContain('Outcome: pass for the locked Track 2 local-first persistence model')
    expect(audit).toContain('snapshot.json')
    expect(audit).toContain('events.jsonl')
    expect(audit).toContain('backup/restore documentation')
    expect(audit).toContain('Local data hygiene')
    expect(audit).toContain('did not create a live public tunnel')
    expect(audit).toContain('did not create a live public tunnel, commit private campaign data')
    expect(audit).toContain('did not change the architecture into SaaS')
  })

  it('audits atomic snapshot writes and fail-closed recovery helpers', () => {
    expect(audit).toContain('same-directory `snapshot.json.tmp-*` file')
    expect(audit).toContain('renames it over the latest `snapshot.json`')
    expect(audit).toContain('previous valid snapshot remains the recovery candidate')
    expect(audit).toContain('typed failures for `not-found`, `invalid-json`, `invalid-shape`, and `read-error`')
    expect(audit).toContain('latest-snapshot recovery model')

    const snapshots = readText('server/utils/sessionSnapshots.ts')
    expect(snapshots).toContain("SESSION_SNAPSHOT_ROOT = resolve(PROJECT_ROOT, 'data/sessions')")
    expect(snapshots).toContain("SESSION_SNAPSHOT_FILE_NAME = 'snapshot.json'")
    expect(snapshots).toContain('serializeSessionSnapshot(snapshot)')
    expect(snapshots).toContain("openSync(tempFilePath, 'wx', 0o600)")
    expect(snapshots).toContain('renameSync(tempFilePath, filePath)')
    expect(snapshots).toContain('flushDirectoryBestEffort(directoryPath)')
    expect(snapshots).toContain('unlinkFileBestEffort(tempFilePath)')
    expect(snapshots).toContain('validatePersistedSessionSnapshot')
    expect(snapshots).toContain('recoverSessionStateFromSnapshot')
    expect(snapshots).toContain("'invalid-json'")
    expect(snapshots).toContain("'invalid-shape'")
  })

  it('audits the optional event log without promoting it to recovery authority', () => {
    expect(audit).toContain('The accepted limitation is that `events.jsonl` is audit/replay-oriented data today')
    expect(audit).toContain('not sufficient when `snapshot.json` is missing or invalid')
    expect(audit).toContain('not a command stream clients can edit')
    expect(audit).toContain('one compact JSON object per line')

    const eventLog = readText('server/utils/sessionEventLog.ts')
    expect(eventLog).toContain("SESSION_EVENT_LOG_ROOT = resolve(PROJECT_ROOT, 'data/sessions')")
    expect(eventLog).toContain("SESSION_EVENT_LOG_FILE_NAME = 'events.jsonl'")
    expect(eventLog).toContain('createSessionCommandEventLogEntry')
    expect(eventLog).toContain('validateSessionEventLogEntry(entry)')
    expect(eventLog).toContain('serializeSessionEventLogEntry(entry)')
    expect(eventLog).toContain("openSync(filePath, 'a', 0o600)")
    expect(eventLog).toContain('flushDirectoryBestEffort(directoryPath)')

    const revisionApplication = readText('server/utils/sessionRevisionApplication.ts')
    expect(revisionApplication).toContain('createSessionCommandEventLogEntry(input.command, result')
    expect(revisionApplication).not.toContain('appendSessionEventLogEntry')
  })

  it('records persistence and rollback coverage for accepted commands', () => {
    const persistenceUseCases = [
      'server/useCases/startGmSession.ts',
      'server/useCases/joinPlayerSession.ts',
      'server/useCases/updatePlayerAssignment.ts',
      'server/useCases/applyMoveTokenCommand.ts',
      'server/useCases/applyTurnTokenCommand.ts',
      'server/useCases/applySpawnTokenCommand.ts',
      'server/useCases/applyDeleteTokenCommand.ts',
      'server/useCases/applySendOutPokemonCommand.ts',
      'server/useCases/applyModifyHpCommand.ts',
      'server/useCases/applyModifyCombatStagesCommand.ts',
      'server/useCases/applyModifyConditionsCommand.ts',
      'server/useCases/applyUseMoveCommand.ts',
      'server/useCases/applyUseTableActionCommand.ts',
      'server/useCases/applyInitiativeCommand.ts',
      'server/useCases/applyHazardCommand.ts',
      'server/useCases/applyFieldEffectCommand.ts',
      'server/useCases/applyTerrainCommand.ts',
    ]

    for (const useCasePath of persistenceUseCases) {
      expect(audit).toContain(useCasePath)
      const source = readText(useCasePath)
      expect(source).toContain('writeSessionSnapshot')
    }

    for (const sheetUseCasePath of [
      'server/useCases/applyModifyHpCommand.ts',
      'server/useCases/applyModifyCombatStagesCommand.ts',
      'server/useCases/applyModifyConditionsCommand.ts',
      'server/useCases/applyUseMoveCommand.ts',
      'server/useCases/applyUseTableActionCommand.ts',
    ]) {
      const source = readText(sheetUseCasePath)
      expect(source).toContain('rollbackWrittenSheet')
    }

    expect(audit).toContain('Rejected stale/unauthorized/invalid/conflict commands do not advance revisions')
    expect(audit).toContain('Duplicate `opId` retries')
    expect(audit).toContain('do not apply or persist the same command twice')
    expect(audit).toContain('they do not repair persistence by autosaving whole map documents')
  })

  it('links focused source and test evidence for persistence, reconnect, cleanup, and backup docs', () => {
    const expectedCoverage = [
      'tests/server/sessionSnapshots.test.ts',
      'tests/server/sessionEventLog.test.ts',
      'tests/server/sessionRevisionApplication.test.ts',
      'tests/server/sessionStateQuality.test.ts',
      'tests/server/sessionCleanup.test.ts',
      'tests/server/sessionWebSocketTransport.test.ts',
      'tests/composables/map-editor/sessionClientIntegration.test.ts',
      'tests/docs/track2SessionBackupRecovery.test.ts',
    ]

    for (const coveragePath of expectedCoverage) {
      expect(audit).toContain(coveragePath)
      expect(exists(coveragePath)).toBe(true)
    }

    const cleanup = readText('server/utils/sessionCleanup.ts')
    expect(cleanup).toContain('Snapshot and event-log files are never')
    expect(cleanup).toContain('deleted by the cleanup helper')
    expect(cleanup).toContain('clearOperationTracker')

    const backupRunbook = readText('docs/track-2-session-backup-recovery.md')
    expect(backupRunbook).toContain('latest valid `data/sessions/<sessionId>/snapshot.json` is the recovery baseline')
    expect(backupRunbook).toContain('data/maps/')
    expect(backupRunbook).toContain('data/sheets/')
    expect(backupRunbook).toContain('data/trainers/')
    expect(backupRunbook).toContain('encounter_tables/')
    expect(backupRunbook).toContain('Treat the event log as audit/troubleshooting data only')
  })

  it('keeps local data hygiene and architecture limitations explicit', () => {
    expect(audit).toContain('`.gitignore` ignores `data/sessions/`')
    expect(audit).toContain('backup archives')
    expect(audit).toContain('This ticket added only documentation and a documentation/source-boundary regression test')
    expect(audit).toContain('No database, SaaS storage, Quick Tunnel campaign path, or cloud-first persistence layer was added')
    expect(audit).toContain('Rotom Table keeps one latest `snapshot.json` per session directory')
    expect(audit).toContain('`events.jsonl` is optional and not a replacement for a valid snapshot')
    expect(audit).toContain('Backup archives are not encrypted by Rotom Table')
    expect(audit).toContain('Cleanup helpers do not delete old session directories automatically')
    expect(audit).not.toContain('Quick Tunnel remains the supported campaign-session path')
    expect(audit).not.toContain('Postgres is required')
    expect(audit).not.toContain('gmKey=')
    expect(audit).not.toContain('joinCode=')

    const gitignore = readText('.gitignore')
    expect(gitignore).toContain('data/sessions/')
    expect(gitignore).toContain('data/maps/')
    expect(gitignore).toContain('data/sheets/*')
    expect(gitignore).toContain('data/trainers/')
    expect(gitignore).toContain('.env')
    expect(gitignore).toContain('.env.*')
  })

  it('is linked from primary Track 2, storage, backup, and security docs', () => {
    expect(readText('README.md')).toContain('docs/track-2-final-persistence-recovery-audit.md')
    expect(readText('docs/README.md')).toContain('track-2-final-persistence-recovery-audit.md')
    expect(readText('docs/local-development.md')).toContain('track-2-final-persistence-recovery-audit.md')
    expect(readText('SECURITY.md')).toContain('docs/track-2-final-persistence-recovery-audit.md')
    expect(readText('docs/track-2-roadmap.md')).toContain('track-2-final-persistence-recovery-audit.md')
    expect(readText('docs/track-2-validation-matrix.md')).toContain('track-2-final-persistence-recovery-audit.md')
    expect(readText('docs/track-2-session-protocol.md')).toContain('track-2-final-persistence-recovery-audit.md')
    expect(readText('docs/track-2-session-storage.md')).toContain('track-2-final-persistence-recovery-audit.md')
    expect(readText('docs/track-2-session-backup-recovery.md')).toContain('track-2-final-persistence-recovery-audit.md')
  })
})
