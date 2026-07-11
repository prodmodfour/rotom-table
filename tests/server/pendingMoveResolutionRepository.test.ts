import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createLivePlayAcceptedResult,
  type LivePlayOpId,
} from '#shared/livePlayCommands'
import type { LivePlayCommandHash } from '~~/server/livePlay/opResult'
import { stableJsonStringify } from '~~/server/domain/moveAutomation/stableJson'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import {
  PendingMoveResolutionIdentityConflictError,
  PendingMoveResolutionRevisionConflictError,
  PendingMoveResolutionTerminalOperationConflictError,
  createSqlitePendingMoveResolutionRepository,
} from '~~/server/storage/pendingMoveResolutionRepository'
import {
  createPendingMoveResolutionFixture,
  createTerminalMoveResolutionFixture,
} from '../fixtures/moveAutomation/pendingResolution'

const openDatabases: RotomDatabase[] = []
const tempRoots: string[] = []

const openMemoryDatabase = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  openDatabases.push(database)
  return database
}

const makeTempDatabasePath = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-pending-resolution-'))
  tempRoots.push(root)
  return join(root, 'campaign.sqlite')
}

const closeTrackedDatabase = (database: RotomDatabase): void => {
  database.close()
  const index = openDatabases.indexOf(database)
  if (index >= 0) openDatabases.splice(index, 1)
}

const saveTerminalOperation = (input: {
  readonly database: RotomDatabase
  readonly mapSlug: string
  readonly opId: string
}): void => {
  const result = createLivePlayAcceptedResult({
    opId: input.opId as LivePlayOpId,
    mapSlug: input.mapSlug,
    previousRevision: 12,
    revision: 13,
    patches: [],
  })
  createSqliteLivePlayOpRepository({ database: input.database }).saveCommandResult({
    mapSlug: input.mapSlug,
    opId: input.opId,
    commandHash: 'pending-resolution-test-hash' as LivePlayCommandHash,
    command: { kind: 'pending-resolution-test' },
    result,
  })
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('SQLite pending move resolution repository', () => {
  it('stores canonical pending authority separately from terminal ops and survives restart', () => {
    const path = makeTempDatabasePath()
    const database = openRotomDatabase({ path })
    openDatabases.push(database)
    const repository = createSqlitePendingMoveResolutionRepository(database)
    const resolution = createPendingMoveResolutionFixture()

    const stored = repository.create({ resolution })

    expect(stored).toEqual({
      schemaVersion: 1,
      resolutionId: resolution.resolutionId,
      originMapSlug: resolution.originMapSlug,
      originOpId: resolution.originOpId,
      status: 'pending',
      resolution,
      revision: 0,
      createdAt: resolution.createdAt,
      updatedAt: resolution.updatedAt,
      terminalOpId: null,
    })
    expect(repository.getById(resolution.resolutionId)).toEqual(stored)
    expect(repository.getByOrigin(resolution.originMapSlug, resolution.originOpId)).toEqual(stored)
    expect(repository.listByMap(resolution.originMapSlug)).toEqual([stored])
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM live_play_ops').get())
      .toEqual({ count: 0 })

    const row = database.connection.prepare(`
      SELECT resolution_json, status, revision, created_at, updated_at, terminal_op_id
      FROM pending_move_resolutions
      WHERE resolution_id = ?
    `).get(resolution.resolutionId)
    expect(row).toEqual({
      resolution_json: stableJsonStringify(resolution),
      status: 'pending',
      revision: 0,
      created_at: resolution.createdAt,
      updated_at: resolution.updatedAt,
      terminal_op_id: null,
    })

    closeTrackedDatabase(database)
    const reopened = openRotomDatabase({ path })
    openDatabases.push(reopened)
    const restartedRepository = createSqlitePendingMoveResolutionRepository(reopened)

    expect(restartedRepository.getById(resolution.resolutionId)).toEqual(stored)
    expect(restartedRepository.getByOrigin(resolution.originMapSlug, resolution.originOpId))
      .toEqual(stored)
  })

  it('returns an exact duplicate and rejects resolution or origin identity collisions', () => {
    const database = openMemoryDatabase()
    const repository = createSqlitePendingMoveResolutionRepository(database)
    const resolution = createPendingMoveResolutionFixture()
    const stored = repository.create({ resolution })

    expect(repository.create({ resolution })).toEqual(stored)

    expect(() => repository.create({
      resolution: createPendingMoveResolutionFixture({
        resolutionId: 'resolution-other-id',
        originMapSlug: resolution.originMapSlug,
        originOpId: resolution.originOpId,
      }),
    })).toThrow(PendingMoveResolutionIdentityConflictError)

    expect(() => repository.create({
      resolution: createPendingMoveResolutionFixture({
        resolutionId: resolution.resolutionId,
        originMapSlug: 'other-arena',
        originOpId: 'op_othermap001',
      }),
    })).toThrow(PendingMoveResolutionIdentityConflictError)

    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM pending_move_resolutions').get())
      .toEqual({ count: 1 })
  })

  it('does not let a new pending origin collide with a terminal live-play operation', () => {
    const database = openMemoryDatabase()
    const repository = createSqlitePendingMoveResolutionRepository(database)
    saveTerminalOperation({
      database,
      mapSlug: 'pending-arena',
      opId: 'op_terminalorigin1',
    })
    const resolution = createPendingMoveResolutionFixture({
      resolutionId: 'resolution-terminal-collision',
      originOpId: 'op_terminalorigin1',
    })

    expect(() => repository.create({ resolution }))
      .toThrow(PendingMoveResolutionTerminalOperationConflictError)
    expect(repository.getById(resolution.resolutionId)).toBeNull()
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM live_play_ops').get())
      .toEqual({ count: 1 })
  })

  it('CAS-updates durable state and links a terminal operation exactly once', () => {
    const database = openMemoryDatabase()
    const repository = createSqlitePendingMoveResolutionRepository(database)
    const pending = createPendingMoveResolutionFixture()
    repository.create({ resolution: pending })
    saveTerminalOperation({
      database,
      mapSlug: pending.originMapSlug,
      opId: 'op_responsefinal1',
    })
    const terminal = createTerminalMoveResolutionFixture({
      source: pending,
      status: 'cancelled',
      updatedAt: 1_100,
    })

    const updated = repository.update({
      resolution: terminal,
      expectedRevision: 0,
      terminalOpId: 'op_responsefinal1',
    })

    expect(updated).toMatchObject({
      revision: 1,
      status: 'cancelled',
      updatedAt: 1_100,
      terminalOpId: 'op_responsefinal1',
      resolution: terminal,
    })
    expect(repository.getByTerminalOpId('op_responsefinal1')).toEqual(updated)

    expect(() => repository.update({
      resolution: terminal,
      expectedRevision: 0,
      terminalOpId: 'op_responsefinal1',
    })).toThrow(PendingMoveResolutionRevisionConflictError)
    expect(() => repository.update({
      resolution: terminal,
      expectedRevision: 1,
      terminalOpId: null,
    })).toThrow(PendingMoveResolutionTerminalOperationConflictError)
    expect(repository.getById(pending.resolutionId)?.revision).toBe(1)

    database.connection.prepare('DELETE FROM live_play_ops WHERE op_id = ?')
      .run('op_responsefinal1')
    expect(repository.getById(pending.resolutionId)?.terminalOpId).toBeNull()
    expect(repository.getByTerminalOpId('op_responsefinal1')).toBeNull()
  })

  it('requires terminal links to exist, belong to the origin map, and accompany terminal state', () => {
    const database = openMemoryDatabase()
    const repository = createSqlitePendingMoveResolutionRepository(database)
    const pending = createPendingMoveResolutionFixture()
    repository.create({ resolution: pending })
    saveTerminalOperation({
      database,
      mapSlug: pending.originMapSlug,
      opId: 'op_existinglink1',
    })
    saveTerminalOperation({
      database,
      mapSlug: 'other-arena',
      opId: 'op_wrongmaplink1',
    })
    const terminal = createTerminalMoveResolutionFixture({ source: pending })

    expect(() => repository.update({
      resolution: pending,
      expectedRevision: 0,
      terminalOpId: 'op_existinglink1',
    })).toThrow(/status pending is not terminal/)
    expect(() => repository.update({
      resolution: terminal,
      expectedRevision: 0,
      terminalOpId: 'op_missinglink01',
    })).toThrow(/does not exist/)
    expect(() => repository.update({
      resolution: terminal,
      expectedRevision: 0,
      terminalOpId: 'op_wrongmaplink1',
    })).toThrow(/belongs to map other-arena/)
    expect(repository.getById(pending.resolutionId)?.revision).toBe(0)
  })

  it('rejects non-canonical or denormalized persisted rows', () => {
    const database = openMemoryDatabase()
    const repository = createSqlitePendingMoveResolutionRepository(database)
    const pending = createPendingMoveResolutionFixture()
    repository.create({ resolution: pending })

    database.connection.prepare(`
      UPDATE pending_move_resolutions
      SET resolution_json = ?
      WHERE resolution_id = ?
    `).run(JSON.stringify(pending, null, 2), pending.resolutionId)
    expect(() => repository.getById(pending.resolutionId)).toThrow(/canonical JSON/)

    database.connection.prepare(`
      UPDATE pending_move_resolutions
      SET resolution_json = ?, status = 'resuming'
      WHERE resolution_id = ?
    `).run(stableJsonStringify(pending), pending.resolutionId)
    expect(() => repository.getById(pending.resolutionId))
      .toThrow(/identity, status, and timestamps/)
  })

  it('participates in an outer SQLite transaction', () => {
    const database = openMemoryDatabase()
    const repository = createSqlitePendingMoveResolutionRepository(database)
    const pending = createPendingMoveResolutionFixture()

    expect(() => database.withTransaction(() => {
      repository.create({ resolution: pending })
      throw new Error('force rollback')
    })).toThrow('force rollback')

    expect(repository.getById(pending.resolutionId)).toBeNull()
  })
})
