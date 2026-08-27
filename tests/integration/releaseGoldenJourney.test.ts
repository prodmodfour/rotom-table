import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import journey from '../../data/release-readiness/release-golden-journey.v1.json'
import { createEmptySheetEquipmentState } from '../../shared/itemAutomation/equipment'
import { createReleaseIdentity, ROTOM_TABLE_VERSION } from '../../shared/release/identity'
import { openRotomDatabase } from '../../server/storage/database'
import { createReleaseBackup, restoreReleaseBackup } from '../../server/storage/releaseBackup'
import { auditReleaseCampaignDatabase } from '../../server/storage/releaseIntegrityAudit'
import { LATEST_STORAGE_SCHEMA_VERSION } from '../../server/storage/migrations'

const roots: string[] = []
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }) })
const hash = 'a'.repeat(64)
const json = (value: unknown): string => JSON.stringify(value)
const digestRows = (path: string): string => {
  const database = openRotomDatabase({ path, enableWal: false })
  try {
    const tables = journey.checkpoints.filter(row => row.table !== 'release-backup-manifest').map(row => row.table)
    const rows = tables.map(table => ({ table, rows: database.connection.prepare(`SELECT * FROM ${table} ORDER BY 1`).all() }))
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  } finally { database.close() }
}

describe('Plan 13 deterministic 1.0 server golden journey', () => {
  it('spans the trusted-table loop and crosses restart plus fresh-host restore without authority drift', async () => {
    expect(journey.checkpoints.map(row => row.order)).toEqual(Array.from({ length: 10 }, (_, index) => index + 1))
    const root = mkdtempSync(join(tmpdir(), 'rotom-release-golden-'))
    roots.push(root)
    const campaignRoot = join(root, 'campaign')
    mkdirSync(campaignRoot, { recursive: true })
    const databasePath = join(campaignRoot, 'rotom-table.sqlite')
    const database = openRotomDatabase({ path: databasePath, enableWal: false })
    const timestamp = journey.deterministicTimestamp
    const journeyId = journey.journeyId
    const trainerEquipment = createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: 'release-journey-trainer' })
    const pokemonEquipment = createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: 'release-journey-pokemon' })

    database.withTransaction(() => {
      database.connection.prepare('INSERT INTO onboarding_policies VALUES (?, 1, ?, ?, ?, ?, 1)')
        .run('policy-release-journey', json({ journeyId }), json({ name: 'Release policy' }), hash, timestamp)
      database.connection.prepare('INSERT INTO onboarding_slots VALUES (?, ?, ?, 1, ?, ?, ?, ?)')
        .run('slot-release-journey', 'profile-release-journey', 'policy-release-journey', 'completed', 'draft-release-journey', timestamp, timestamp)
      database.connection.prepare('INSERT INTO onboarding_drafts VALUES (?, ?, ?, 1, ?, ?, ?)')
        .run('draft-release-journey', 'slot-release-journey', 'completed', json({ journeyId }), timestamp, timestamp)
      database.connection.prepare('INSERT INTO onboarding_submissions VALUES (?, 1, ?, ?, ?, ?, ?)')
        .run('draft-release-journey', json({ journeyId }), json({ valid: true }), hash, hash, timestamp)
      database.connection.prepare('INSERT INTO onboarding_completions VALUES (?, ?, ?, 1, ?, 1, ?, ?)')
        .run('completion-release-journey', 'slot-release-journey', 'draft-release-journey', 'policy-release-journey', json({ trainer: 'release-journey-trainer', pokemon: 'release-journey-pokemon', journeyId }), timestamp)

      database.connection.prepare("INSERT INTO sheets (kind, slug, document_json, revision, updated_at) VALUES ('trainer', ?, ?, 1, ?)")
        .run('release-journey-trainer', json({ slug: 'release-journey-trainer', name: 'Release Trainer', revision: 1, journeyId, equipmentState: trainerEquipment }), timestamp)
      database.connection.prepare("INSERT INTO sheets (kind, slug, document_json, revision, updated_at) VALUES ('pokemon', ?, ?, 1, ?)")
        .run('release-journey-pokemon', json({ slug: 'release-journey-pokemon', species: 'Pikachu', level: 10, revision: 1, journeyId, equipmentState: pokemonEquipment }), timestamp)
      database.connection.prepare('INSERT INTO maps VALUES (?, ?, 1, ?)')
        .run('release-journey-map', json({ schemaVersion: 2, slug: 'release-journey-map', name: 'Release map', revision: 1, journeyId, placements: [] }), timestamp)
      database.connection.prepare('INSERT INTO encounter_documents VALUES (?, ?, ?, 1, ?)')
        .run('encounter-release-journey', 'release-journey-map', json({ schemaVersion: 1, encounterId: 'encounter-release-journey', mapSlug: 'release-journey-map', journeyId }), timestamp)
      database.connection.prepare('INSERT INTO encounter_settlements VALUES (?, ?, ?, 1, ?, ?, 10, 20, ?)')
        .run('settlement-release-journey', 'encounter-release-journey', 'completed', json({ schemaVersion: 1, journeyId, outcome: 'accepted' }), hash, 'settle-op-release-journey')

      database.connection.prepare('INSERT INTO breeding_operations VALUES (?, ?, ?, ?, ?, ?, ?, 10, 20)')
        .run('breeding-operation-release-journey', hash, 'create-breeding-project', json({ journeyId }), 'accepted', json({ projectId: 'breeding-project-release-journey', journeyId }), hash)
      database.connection.prepare('INSERT INTO breeding_projects VALUES (?, ?, 1, ?, ?, ?, ?, ?, NULL, ?, 10, 20)')
        .run('breeding-project-release-journey', json({ schemaVersion: 1, projectId: 'breeding-project-release-journey', journeyId }), 'draft', 'release-journey-trainer', 'release-journey-trainer', 'parent-release-a', 'parent-release-b', 'breeding-operation-release-journey')
      database.connection.prepare('INSERT INTO contests VALUES (?, ?, 1, ?, ?, ?)')
        .run('contest-release-journey', json({ schemaVersion: 1, contestId: 'contest-release-journey', journeyId }), 'completed', timestamp, timestamp)

      const launchId = 'launch-release-journey'
      const preparationId = 'preparation-release-journey'
      const preparation = {
        schemaVersion: 1, preparationId, title: 'Release session', lifecycle: 'launched', journeyId,
        scenes: [{ map: { slug: 'release-journey-map' }, encounterCandidates: [] }],
        launches: [{ launchId, encounterId: 'encounter-release-journey', mapSlug: 'release-journey-map' }],
      }
      database.connection.prepare('INSERT INTO gm_session_preparations VALUES (?, ?, 1, ?, ?, ?)')
        .run(preparationId, json(preparation), 'launched', 'release session', new Date(timestamp).toISOString())
      database.connection.prepare('INSERT INTO encounter_launch_ops VALUES (?, ?, ?, ?, ?, ?)')
        .run(launchId, 'encounter-release-journey', hash, json({ journeyId }), json({ journeyId }), timestamp)
      database.connection.prepare('INSERT INTO gm_session_preparation_ops VALUES (?, ?, ?, ?, 0, ?, ?, 1, ?)')
        .run('preparation-op-release-journey', hash, 'record-launch', preparationId, json({ launchId, journeyId }), json({ accepted: true, journeyId }), new Date(timestamp).toISOString())
      database.connection.prepare('INSERT INTO realtime_events (dedupe_key, material_hash, channel, event_type, access_json, event_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('release-journey:accepted', hash, 'campaign', 'release-journey.accepted', json({ kind: 'gm' }), json({ journeyId, status: 'accepted' }), timestamp)
    })
    database.close()

    const identity = createReleaseIdentity({
      storageSchemaVersion: LATEST_STORAGE_SCHEMA_VERSION,
      build: { kind: 'development', commit: null, tag: null, command: 'nuxt dev', nodeVersion: process.version, npmVersion: null, provenanceComplete: false },
    })
    expect(identity.version).toBe(ROTOM_TABLE_VERSION)
    expect(identity.storageSchemaVersion).toBe(journey.releaseBoundary.storageSchemaVersion)
    expect(auditReleaseCampaignDatabase(databasePath).status).toBe('passed')
    const before = digestRows(databasePath)

    const archivePath = join(root, 'release-journey.tar.gz')
    writeFileSync(join(campaignRoot, 'journey-note.txt'), `${journeyId}\n`)
    const archive = await createReleaseBackup({ campaignRoot, databasePath, archivePath, method: 'stopped-service-copy', createdAt: new Date(timestamp).toISOString() })
    const restored = restoreReleaseBackup({ archivePath, targetRoot: join(root, 'fresh-host'), expectedArchiveSha256: archive.archiveSha256 })
    expect(digestRows(restored.databasePath)).toBe(before)
    expect(auditReleaseCampaignDatabase(restored.databasePath).status).toBe('passed')

    const toolkit = spawnSync('python3', ['scripts/audit_gm_campaign_toolkit_storage.py', '--database', restored.databasePath, '--json'], { cwd: resolve('.'), encoding: 'utf8' })
    expect(toolkit.status, toolkit.stderr).toBe(0)
    expect(JSON.parse(toolkit.stdout).status).toBe('accepted')
    const firstRestart = digestRows(restored.databasePath)
    const secondRestart = digestRows(restored.databasePath)
    expect(secondRestart).toBe(firstRestart)
    for (const checkpoint of journey.checkpoints.filter(row => row.table !== 'release-backup-manifest')) {
      expect(checkpoint.rowId.length, checkpoint.id).toBeGreaterThan(7)
    }
  }, 30_000)
})
