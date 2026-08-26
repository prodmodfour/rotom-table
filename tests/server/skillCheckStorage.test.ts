import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  RequestSkillCheckCommandV1,
  SkillCheckDocumentV1,
} from '#shared/skillChecks/contract'
import { parseSkillCheckDocument } from '#shared/skillChecks/persistence'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import {
  LATEST_STORAGE_SCHEMA_VERSION,
  STORAGE_MIGRATIONS,
  applyStorageMigrations,
  getStorageSchemaVersion,
} from '~~/server/storage/migrations'
import {
  createSqliteSkillCheckRepository,
  type SkillCheckOperationResultV1,
} from '~~/server/storage/skillCheckRepository'

let database: RotomDatabase | null = null
afterEach(() => {
  database?.close()
  database = null
})

const requestOperationId = 'skill-check-op:v1:request-watch-01' as const
const checkId = 'skill-check:v1:perception-watch' as const
const subjectId = 'skill-check-subject:v1:trainer-maya' as const

const pendingDocument = (): SkillCheckDocumentV1 => parseSkillCheckDocument({
  schemaVersion: 1,
  checkId,
  revision: 1,
  state: 'pending',
  mode: 'single',
  requester: { role: 'gm', principalId: 'gm:director' },
  publicLabel: 'Keep watch',
  prompt: 'Make a Perception check.',
  gmNotes: 'Private difficulty context.',
  visibility: 'public-results',
  comparison: { kind: 'dc', difficultyClass: 12, concealment: 'subjects-after-acceptance' },
  situationalModifier: 0,
  subjects: [{
    subjectId,
    kind: 'trainer',
    sheetSlug: 'maya',
    sheetRevision: 4,
    skillId: 'perception',
    controllerProfileIds: ['profile:maya'],
    response: 'pending',
    respondedAt: null,
  }],
  journals: [],
  acceptedResults: [],
  corrections: [],
  history: [{
    historyId: 'skill-check-history:v1:request-watch-01',
    kind: 'requested',
    operationId: requestOperationId,
    subjectId: null,
    headline: 'Check requested',
    createdAt: 10,
  }],
  createdAt: 10,
  updatedAt: 10,
  expiresAt: 70,
  terminalAt: null,
  lastOperationId: requestOperationId,
})

const requestCommand = (): RequestSkillCheckCommandV1 => ({
  schemaVersion: 1,
  operationId: requestOperationId,
  expectedRevision: 0,
  commandKind: 'request',
  checkId,
  publicLabel: 'Keep watch',
  prompt: 'Make a Perception check.',
  gmNotes: 'Private difficulty context.',
  visibility: 'public-results',
  comparison: { kind: 'dc', difficulty: { kind: 'explicit', difficultyClass: 12 }, concealment: 'subjects-after-acceptance' },
  situationalModifier: 0,
  expiresAt: 70,
  subjects: [{ subjectId, kind: 'trainer', sheetSlug: 'maya', skillId: 'perception' }],
})

const result = (revision = 1, state: SkillCheckOperationResultV1['state'] = 'pending'): SkillCheckOperationResultV1 => ({
  schemaVersion: 1,
  operationId: requestOperationId,
  checkId,
  commandKind: 'request',
  revision,
  state,
  updatedAt: revision === 1 ? 10 : 20,
})

describe('P11-045 Skill Check storage migration and repository', () => {
  it('retains the v50 tables and indexes on a fresh current-schema database', () => {
    database = openRotomDatabase({ path: ':memory:', enableWal: false })
    expect(LATEST_STORAGE_SCHEMA_VERSION).toBe(56)
    expect(getStorageSchemaVersion(database.connection)).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    const objects = database.connection.prepare(`
      SELECT name, type FROM sqlite_schema
      WHERE name LIKE 'skill_check%'
      ORDER BY name
    `).all()
    expect(objects).toEqual([
      { name: 'skill_check_operations', type: 'table' },
      { name: 'skill_check_operations_check_revision_idx', type: 'index' },
      { name: 'skill_checks', type: 'table' },
      { name: 'skill_checks_expiry_idx', type: 'index' },
      { name: 'skill_checks_requester_updated_idx', type: 'index' },
      { name: 'skill_checks_state_updated_idx', type: 'index' },
    ])
  })

  it('inserts, filters, replaces, and rejects stale document revisions', () => {
    database = openRotomDatabase({ path: ':memory:', enableWal: false })
    const repository = createSqliteSkillCheckRepository(database)
    const pending = pendingDocument()
    expect(repository.insert(pending)).toMatchObject({
      revision: 1,
      state: 'pending',
      mode: 'single',
      requesterPrincipalId: 'gm:director',
      expiresAt: 70,
    })
    expect(repository.get(checkId)?.document).toEqual(pending)
    expect(repository.list({ states: ['pending'], requesterPrincipalId: 'gm:director' }))
      .toEqual([expect.objectContaining({ revision: 1, state: 'pending' })])
    expect(repository.list({ states: ['accepted'] })).toEqual([])

    const ready = parseSkillCheckDocument({
      ...pending,
      revision: 2,
      state: 'ready',
      subjects: [{ ...pending.subjects[0]!, response: 'accepted', respondedAt: 20 }],
      history: [...pending.history, {
        historyId: 'skill-check-history:v1:response-watch-01',
        kind: 'responded',
        operationId: 'skill-check-op:v1:response-watch-01',
        subjectId,
        headline: 'Response accepted',
        createdAt: 20,
      }],
      updatedAt: 20,
      lastOperationId: 'skill-check-op:v1:response-watch-01',
    })
    expect(repository.replace(1, ready)).toMatchObject({ revision: 2, state: 'ready' })
    expect(() => repository.replace(1, ready)).toThrowError(expect.objectContaining({
      name: 'SkillCheckRepositoryError',
      code: 'revision-conflict',
      currentRevision: 2,
    }))
  })

  it('stores exact command/result operations and rejects identity reuse', () => {
    database = openRotomDatabase({ path: ':memory:', enableWal: false })
    const repository = createSqliteSkillCheckRepository(database)
    repository.insert(pendingDocument())
    const first = repository.recordOperation({
      principalKey: 'gm:director',
      command: requestCommand(),
      result: result(),
      createdAt: 10,
    })
    expect(first).toMatchObject({
      operationId: requestOperationId,
      checkId,
      principalKey: 'gm:director',
      resultRevision: 1,
      result: { state: 'pending' },
    })
    expect(repository.recordOperation({
      principalKey: 'gm:director',
      command: requestCommand(),
      result: result(),
      createdAt: 11,
    })).toEqual(first)
    expect(() => repository.recordOperation({
      principalKey: 'gm:other',
      command: requestCommand(),
      result: result(),
      createdAt: 12,
    })).toThrowError(expect.objectContaining({ code: 'operation-conflict' }))
    expect(() => repository.recordOperation({
      principalKey: 'gm:director',
      command: { ...requestCommand(), prompt: 'Changed prompt.' },
      result: result(),
      createdAt: 12,
    })).toThrowError(expect.objectContaining({ code: 'operation-conflict' }))
  })

  it('rejects unknown persisted document schemas and row/document drift', () => {
    database = openRotomDatabase({ path: ':memory:', enableWal: false })
    const repository = createSqliteSkillCheckRepository(database)
    repository.insert(pendingDocument())
    database.connection.prepare(`UPDATE skill_checks SET document_json = json_set(document_json, '$.schemaVersion', 2) WHERE check_id = ?`)
      .run(checkId)
    expect(() => repository.get(checkId)).toThrowError(expect.objectContaining({
      name: 'SkillCheckRepositoryError',
      code: 'corrupt-document',
      message: expect.stringContaining('skill-check.unsupported-schema'),
    }))

    database.connection.prepare(`UPDATE skill_checks SET document_json = json_set(document_json, '$.schemaVersion', 1), state = 'ready' WHERE check_id = ?`)
      .run(checkId)
    expect(() => repository.get(checkId)).toThrowError(expect.objectContaining({ code: 'corrupt-document' }))
  })

  it('upgrades an exact v49 database without changing existing rows', () => {
    database = openRotomDatabase({ path: ':memory:', enableWal: false })
    database.connection.exec(`
      DROP TABLE skill_check_operations;
      DROP TABLE skill_checks;
      PRAGMA user_version = 49;
    `)
    const mapBefore = database.connection.prepare('SELECT COUNT(*) AS count FROM maps').get()
    expect(applyStorageMigrations(database.connection)).toEqual({
      fromVersion: 49,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: STORAGE_MIGRATIONS.filter(row => row.version > 49).map(row => row.version),
    })
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM maps').get()).toEqual(mapBefore)
    expect(database.connection.prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'skill_checks'`).get())
      .toEqual({ name: 'skill_checks' })
  })

  it('survives close/reopen and refuses a future database schema', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rotom-skill-check-storage-'))
    const path = join(directory, 'campaign.sqlite')
    try {
      database = openRotomDatabase({ path, enableWal: false })
      const repository = createSqliteSkillCheckRepository(database)
      repository.insert(pendingDocument())
      repository.recordOperation({
        principalKey: 'gm:director',
        command: requestCommand(),
        result: result(),
        createdAt: 10,
      })
      database.close()
      database = openRotomDatabase({ path, enableWal: false })
      expect(createSqliteSkillCheckRepository(database).get(checkId)?.document).toEqual(pendingDocument())
      expect(createSqliteSkillCheckRepository(database).findOperation(requestOperationId))
        .toMatchObject({ resultRevision: 1 })
      database.close()
      database = null

      const future = new DatabaseSync(path)
      try {
        const futureVersion = LATEST_STORAGE_SCHEMA_VERSION + 1
        future.exec(`PRAGMA user_version = ${futureVersion}`)
        expect(() => applyStorageMigrations(future)).toThrow(`newer than this Rotom Table build supports (${LATEST_STORAGE_SCHEMA_VERSION})`)
      }
      finally { future.close() }
    }
    finally {
      database?.close()
      database = null
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
