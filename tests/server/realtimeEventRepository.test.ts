import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RealtimeEventDraft } from '#shared/realtimeEventLog'
import type { RealtimeEventRetentionPolicy } from '~~/server/realtime/realtimeEventRetentionConfig'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import {
  RealtimeEventDedupeConflictError,
  createSqliteRealtimeEventRepository,
  type AppendRealtimeEventInput,
} from '~~/server/storage/realtimeEventRepository'

const openDatabases: RotomDatabase[] = []
const tempRoots: string[] = []

const openMemoryDatabase = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  openDatabases.push(database)
  return database
}

const makeTempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-realtime-events-'))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

const gmAccess = { kind: 'gm-only' } as const
const mapAccess = (mapSlug = 'training-yard') => ({ kind: 'map-access', mapSlug }) as const
const sheetAccess = (sheetSlug = 'pikachu') => ({ kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug }) as const

const eventDraft = (overrides: Partial<RealtimeEventDraft> = {}): RealtimeEventDraft => ({
  channel: 'maps',
  type: 'updated',
  data: { message: 'updated' },
  ...overrides,
})

const appendInput = (overrides: Partial<AppendRealtimeEventInput> = {}): AppendRealtimeEventInput => ({
  event: eventDraft(),
  access: gmAccess,
  ...overrides,
})

const DAY_MS = 24 * 60 * 60 * 1000
const retentionPolicy = (overrides: Partial<RealtimeEventRetentionPolicy> = {}): RealtimeEventRetentionPolicy => ({
  enabled: true,
  retentionDays: 30,
  maxRows: 250_000,
  pruneIntervalMs: 10_000,
  ...overrides,
})

describe('SQLite realtime event repository', () => {
  it('appends sequenced events with global ordering and deterministic timestamps', () => {
    const database = openMemoryDatabase()
    let now = 1_700_000_000_000
    const repository = createSqliteRealtimeEventRepository({
      database,
      clock: () => now++,
    })

    const first = repository.append(appendInput({
      event: eventDraft({ channel: 'maps', type: 'created', data: { slug: 'one' } }),
      access: gmAccess,
    }))
    const batch = repository.appendMany([
      appendInput({
        event: eventDraft({ channel: 'map:training-yard', type: 'updated', data: { slug: 'training-yard' } }),
        access: mapAccess(),
      }),
      appendInput({
        event: eventDraft({ channel: 'sheet:pokemon:pikachu', type: 'updated', data: { slug: 'pikachu' } }),
        access: sheetAccess(),
        timestamp: 42,
      }),
      appendInput({
        event: eventDraft({ channel: 'map:forest', type: 'updated', data: { slug: 'forest' } }),
        access: mapAccess('forest'),
      }),
    ])

    expect(first.sequence).toBe(1)
    expect(first.event).toMatchObject({ sequence: 1, timestamp: 1_700_000_000_000 })
    expect(batch.map((event) => event.sequence)).toEqual([2, 3, 4])
    expect(batch.map((event) => event.event.timestamp)).toEqual([1_700_000_000_001, 42, 1_700_000_000_001])
    expect(repository.cursorState()).toEqual({ latestSequence: 4, earliestAvailableSequence: 1 })
    expect(repository.readAfter({ afterSequence: 0, limit: 10 }).events.map((event) => event.event.channel)).toEqual([
      'maps',
      'map:training-yard',
      'sheet:pokemon:pikachu',
      'map:forest',
    ])
  })

  it('returns detached rows and preserves rows across repository restarts', () => {
    const root = makeTempRoot()
    const databasePath = join(root, 'events.sqlite')
    const inputData = { nested: { value: 1 } }
    const database = openRotomDatabase({ path: databasePath })
    openDatabases.push(database)
    const repository = createSqliteRealtimeEventRepository({ database, clock: () => 10 })

    const stored = repository.append(appendInput({
      event: eventDraft({ data: inputData }),
      access: gmAccess,
    }))
    inputData.nested.value = 2
    ;(stored.event.data as { nested: { value: number } }).nested.value = 3

    expect(repository.getBySequence(stored.sequence)?.event.data).toEqual({ nested: { value: 1 } })
    database.close()

    const reopened = openRotomDatabase({ path: databasePath })
    openDatabases.push(reopened)
    const reopenedRepository = createSqliteRealtimeEventRepository({ database: reopened })

    expect(reopenedRepository.getBySequence(1)?.event.data).toEqual({ nested: { value: 1 } })
    expect(reopenedRepository.cursorState()).toEqual({ latestSequence: 1, earliestAvailableSequence: 1 })
  })

  it('deduplicates identical material and rejects dedupe conflicts', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteRealtimeEventRepository({ database })
    const event = eventDraft({ channel: 'map:training-yard', data: { value: 1 } })

    const first = repository.append(appendInput({ event, access: mapAccess(), dedupeKey: 'dedupe-one', timestamp: 100 }))
    const duplicate = repository.append(appendInput({ event, access: mapAccess(), dedupeKey: 'dedupe-one', timestamp: 999 }))
    const withoutKeyA = repository.append(appendInput({ event, access: mapAccess(), timestamp: 101 }))
    const withoutKeyB = repository.append(appendInput({ event, access: mapAccess(), timestamp: 102 }))

    expect(duplicate).toEqual(first)
    expect(duplicate.event.timestamp).toBe(100)
    expect(repository.cursorState()).toEqual({ latestSequence: 3, earliestAvailableSequence: 1 })
    expect(withoutKeyA.sequence).toBe(2)
    expect(withoutKeyB.sequence).toBe(3)
    expect(() => repository.append(appendInput({
      event: eventDraft({ channel: 'map:training-yard', data: { value: 2 } }),
      access: mapAccess(),
      dedupeKey: 'dedupe-one',
      timestamp: 103,
    }))).toThrow(RealtimeEventDedupeConflictError)
    expect(() => repository.append(appendInput({
      event,
      access: gmAccess,
      dedupeKey: 'dedupe-one',
      timestamp: 104,
    }))).toThrow(RealtimeEventDedupeConflictError)
    expect(repository.cursorState()).toEqual({ latestSequence: 3, earliestAvailableSequence: 1 })
  })

  it('reads cursor windows with pagination, gaps, ahead detection, and global channel order', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteRealtimeEventRepository({ database, clock: () => 10 })

    expect(repository.cursorState()).toEqual({ latestSequence: 0, earliestAvailableSequence: 1 })
    expect(repository.readAfter({ afterSequence: 0 })).toEqual({
      status: 'ok',
      requestedAfterSequence: 0,
      earliestAvailableSequence: 1,
      latestSequence: 0,
      events: [],
      hasMore: false,
    })

    repository.appendMany([
      appendInput({ event: eventDraft({ channel: 'maps', data: { n: 1 } }), access: gmAccess }),
      appendInput({ event: eventDraft({ channel: 'map:training-yard', data: { n: 2 } }), access: mapAccess() }),
      appendInput({ event: eventDraft({ channel: 'sheets', data: { n: 3 } }), access: gmAccess }),
      appendInput({ event: eventDraft({ channel: 'sheet:pokemon:pikachu', data: { n: 4 } }), access: sheetAccess() }),
    ])

    const firstPage = repository.readAfter({ afterSequence: 0, limit: 2 })
    const secondPage = repository.readAfter({ afterSequence: 2, limit: 2 })

    expect(firstPage.status).toBe('ok')
    expect(firstPage.events.map((event) => event.sequence)).toEqual([1, 2])
    expect(firstPage.hasMore).toBe(true)
    expect(secondPage.events.map((event) => event.sequence)).toEqual([3, 4])
    expect(secondPage.hasMore).toBe(false)
    expect(repository.readAfter({ afterSequence: 0, limit: 10 }).events.map((event) => event.event.channel)).toEqual([
      'maps',
      'map:training-yard',
      'sheets',
      'sheet:pokemon:pikachu',
    ])

    repository.pruneThrough(2)
    expect(repository.readAfter({ afterSequence: 0 })).toMatchObject({ status: 'gap', events: [], hasMore: false })
    expect(repository.readAfter({ afterSequence: 2 }).events.map((event) => event.sequence)).toEqual([3, 4])
    expect(repository.readAfter({ afterSequence: 99 })).toMatchObject({ status: 'ahead', events: [], hasMore: false })
  })

  it('prunes retained events, updates cursor state, and intentionally allows pruned dedupe-key reuse', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteRealtimeEventRepository({ database, clock: () => 10 })

    repository.appendMany([
      appendInput({ event: eventDraft({ data: { n: 1 } }), access: gmAccess, dedupeKey: 'reusable-key' }),
      appendInput({ event: eventDraft({ data: { n: 2 } }), access: gmAccess }),
      appendInput({ event: eventDraft({ data: { n: 3 } }), access: gmAccess }),
    ])

    expect(repository.pruneThrough(2)).toEqual({
      deletedCount: 2,
      previousCursorState: { latestSequence: 3, earliestAvailableSequence: 1 },
      currentCursorState: { latestSequence: 3, earliestAvailableSequence: 3 },
    })
    expect(repository.getBySequence(1)).toBeNull()
    expect(repository.getBySequence(2)).toBeNull()
    expect(repository.getBySequence(3)?.sequence).toBe(3)
    expect(repository.pruneThrough(2)).toMatchObject({
      deletedCount: 0,
      currentCursorState: { latestSequence: 3, earliestAvailableSequence: 3 },
    })
    expect(repository.pruneThrough(999)).toMatchObject({
      deletedCount: 1,
      currentCursorState: { latestSequence: 3, earliestAvailableSequence: 4 },
    })

    const afterFullPrune = repository.append(appendInput({
      event: eventDraft({ data: { n: 'reused-after-retention' } }),
      access: gmAccess,
      dedupeKey: 'reusable-key',
    }))
    expect(afterFullPrune.sequence).toBe(4)
    expect(repository.cursorState()).toEqual({ latestSequence: 4, earliestAvailableSequence: 4 })
  })

  it('participates in outer synchronous transactions and rolls back event rows, cursor state, and sequences', () => {
    const database = openMemoryDatabase()
    const maps = createSqliteMapRepository(database)
    const repository = createSqliteRealtimeEventRepository({ database })

    database.withTransaction(() => {
      maps.save({
        slug: 'commit-map',
        document: { slug: 'commit-map', revision: 1 },
        revision: 1,
        updatedAt: 10,
      })
      repository.append(appendInput({ event: eventDraft({ data: { slug: 'commit-map' } }), access: gmAccess, timestamp: 10 }))
    })

    expect(maps.get('commit-map')).toMatchObject({ slug: 'commit-map', revision: 1 })
    expect(repository.cursorState()).toEqual({ latestSequence: 1, earliestAvailableSequence: 1 })

    expect(() => database.withTransaction(() => {
      maps.save({
        slug: 'rollback-map',
        document: { slug: 'rollback-map', revision: 1 },
        revision: 1,
        updatedAt: 11,
      })
      repository.append(appendInput({ event: eventDraft({ data: { slug: 'rollback-map' } }), access: gmAccess, timestamp: 11 }))
      throw new Error('rollback')
    })).toThrow('rollback')

    expect(maps.get('rollback-map')).toBeNull()
    expect(repository.getBySequence(2)).toBeNull()
    expect(repository.cursorState()).toEqual({ latestSequence: 1, earliestAvailableSequence: 1 })

    const next = repository.append(appendInput({ event: eventDraft({ data: { slug: 'after-rollback' } }), access: gmAccess, timestamp: 12 }))
    expect(next.sequence).toBe(2)

    expect(() => repository.appendMany([
      appendInput({ event: eventDraft({ data: { batch: 1 } }), access: gmAccess, dedupeKey: 'batch-conflict', timestamp: 20 }),
      appendInput({ event: eventDraft({ data: { batch: 2 } }), access: gmAccess, dedupeKey: 'batch-conflict', timestamp: 21 }),
    ])).toThrow(RealtimeEventDedupeConflictError)
    expect(repository.getByDedupeKey('batch-conflict')).toBeNull()
    expect(repository.cursorState()).toEqual({ latestSequence: 2, earliestAvailableSequence: 1 })
    expect(repository.append(appendInput({ event: eventDraft({ data: { batch: 'after-conflict' } }), access: gmAccess, timestamp: 22 })).sequence).toBe(3)
  })

  it('plans age retention without mutating rows', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteRealtimeEventRepository({ database })
    const now = 10 * DAY_MS

    repository.appendMany([
      appendInput({ event: eventDraft({ data: { n: 1 } }), timestamp: now - (3 * DAY_MS) }),
      appendInput({ event: eventDraft({ data: { n: 2 } }), timestamp: now - (2 * DAY_MS) }),
      appendInput({ event: eventDraft({ data: { n: 3 } }), timestamp: now - DAY_MS }),
    ])

    const plan = repository.planRetention({
      policy: retentionPolicy({ retentionDays: 2, maxRows: 10 }),
      now,
    })

    expect(plan).toMatchObject({
      rowCount: 3,
      oldestTimestamp: now - (3 * DAY_MS),
      newestTimestamp: now - DAY_MS,
      ageCutoffTimestamp: now - (2 * DAY_MS),
      ageCutoffSequence: 1,
      rowCountCutoffSequence: 0,
      cutoffSequence: 1,
      eligibleByAge: 1,
      eligibleByCount: 0,
      estimatedDeleteCount: 1,
      cutoffReason: 'age',
    })
    expect(repository.readAfter({ afterSequence: 0 }).events.map((event) => event.sequence)).toEqual([1, 2, 3])
  })

  it('plans row-count retention and combined policies through the more aggressive cutoff', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteRealtimeEventRepository({ database })
    const now = 10 * DAY_MS

    repository.appendMany([
      appendInput({ event: eventDraft({ data: { n: 1 } }), timestamp: now - (2 * DAY_MS) }),
      appendInput({ event: eventDraft({ data: { n: 2 } }), timestamp: now }),
      appendInput({ event: eventDraft({ data: { n: 3 } }), timestamp: now }),
      appendInput({ event: eventDraft({ data: { n: 4 } }), timestamp: now }),
      appendInput({ event: eventDraft({ data: { n: 5 } }), timestamp: now }),
    ])

    const rowPlan = repository.planRetention({
      policy: retentionPolicy({ retentionDays: 30, maxRows: 2 }),
      now,
    })
    expect(rowPlan).toMatchObject({
      ageCutoffSequence: 0,
      rowCountCutoffSequence: 3,
      cutoffSequence: 3,
      eligibleByAge: 0,
      eligibleByCount: 3,
      estimatedDeleteCount: 3,
      cutoffReason: 'row-count',
    })

    const combinedPlan = repository.planRetention({
      policy: retentionPolicy({ retentionDays: 1, maxRows: 2 }),
      now,
    })
    expect(combinedPlan).toMatchObject({
      ageCutoffSequence: 1,
      rowCountCutoffSequence: 3,
      cutoffSequence: 3,
      eligibleByAge: 1,
      eligibleByCount: 3,
      estimatedDeleteCount: 3,
      cutoffReason: 'row-count',
    })
  })

  it('applies retention atomically, keeps cursor state valid, and continues increasing sequences', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteRealtimeEventRepository({ database, clock: () => 10 })

    repository.appendMany([
      appendInput({ event: eventDraft({ data: { n: 1 } }), access: gmAccess }),
      appendInput({ event: eventDraft({ data: { n: 2 } }), access: gmAccess }),
      appendInput({ event: eventDraft({ data: { n: 3 } }), access: gmAccess }),
      appendInput({ event: eventDraft({ data: { n: 4 } }), access: gmAccess }),
    ])

    const dryRun = repository.inspectRetention({ policy: retentionPolicy({ maxRows: 2 }), now: 10 })
    expect(dryRun.estimatedDeleteCount).toBe(2)
    expect(repository.readAfter({ afterSequence: 0 }).events.map((event) => event.sequence)).toEqual([1, 2, 3, 4])

    const applied = repository.pruneRetention({ policy: retentionPolicy({ maxRows: 2 }), now: 10 })
    expect(applied).toMatchObject({
      deletedCount: 2,
      deletedThroughSequence: 2,
      previousCursorState: { latestSequence: 4, earliestAvailableSequence: 1 },
      currentCursorState: { latestSequence: 4, earliestAvailableSequence: 3 },
    })
    expect(repository.readAfter({ afterSequence: 0 })).toMatchObject({ status: 'gap', events: [], hasMore: false })
    expect(repository.readAfter({ afterSequence: 2 }).events.map((event) => event.sequence)).toEqual([3, 4])

    const next = repository.append(appendInput({ event: eventDraft({ data: { n: 5 } }), access: gmAccess }))
    expect(next.sequence).toBe(5)
    expect(repository.cursorState()).toEqual({ latestSequence: 5, earliestAvailableSequence: 3 })
  })

  it('retention can prune all rows while preserving an empty-log cursor and sequence allocation', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteRealtimeEventRepository({ database })
    const now = 5 * DAY_MS

    repository.appendMany([
      appendInput({ event: eventDraft({ data: { n: 1 } }), timestamp: now - (3 * DAY_MS) }),
      appendInput({ event: eventDraft({ data: { n: 2 } }), timestamp: now - (2 * DAY_MS) }),
    ])

    const applied = repository.pruneRetention({
      policy: retentionPolicy({ retentionDays: 1, maxRows: 10 }),
      now,
    })
    expect(applied).toMatchObject({
      deletedCount: 2,
      currentCursorState: { latestSequence: 2, earliestAvailableSequence: 3 },
    })
    expect(repository.readAfter({ afterSequence: 2 })).toMatchObject({ status: 'ok', events: [], hasMore: false })
    expect(repository.readAfter({ afterSequence: 1 })).toMatchObject({ status: 'gap', events: [], hasMore: false })
    expect(repository.append(appendInput({ event: eventDraft({ data: { n: 3 } }), timestamp: now }))).toMatchObject({ sequence: 3 })
    expect(repository.cursorState()).toEqual({ latestSequence: 3, earliestAvailableSequence: 3 })
  })

  it('runs retention safely from two file-backed connections', () => {
    const root = makeTempRoot()
    const databasePath = join(root, 'events.sqlite')
    const databaseA = openRotomDatabase({ path: databasePath })
    const databaseB = openRotomDatabase({ path: databasePath })
    openDatabases.push(databaseA, databaseB)
    const repositoryA = createSqliteRealtimeEventRepository({ database: databaseA, clock: () => 10 })
    const repositoryB = createSqliteRealtimeEventRepository({ database: databaseB, clock: () => 11 })

    repositoryA.appendMany([
      appendInput({ event: eventDraft({ data: { n: 1 } }) }),
      appendInput({ event: eventDraft({ data: { n: 2 } }) }),
      appendInput({ event: eventDraft({ data: { n: 3 } }) }),
      appendInput({ event: eventDraft({ data: { n: 4 } }) }),
    ])

    const first = repositoryA.pruneRetention({ policy: retentionPolicy({ maxRows: 2 }), now: 10 })
    const second = repositoryB.pruneRetention({ policy: retentionPolicy({ maxRows: 2 }), now: 10 })
    expect(first.deletedCount).toBe(2)
    expect(second.deletedCount).toBe(0)
    expect(repositoryA.cursorState()).toEqual({ latestSequence: 4, earliestAvailableSequence: 3 })
    expect(repositoryB.readAfter({ afterSequence: 2 }).events.map((event) => event.sequence)).toEqual([3, 4])

    const appended = repositoryB.append(appendInput({ event: eventDraft({ data: { n: 5 } }) }))
    expect(appended.sequence).toBe(5)
    expect(repositoryA.cursorState()).toEqual({ latestSequence: 5, earliestAvailableSequence: 3 })
  })

  it('exposes synchronous repository methods', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteRealtimeEventRepository({ database, clock: () => 10 })

    const appended = repository.append(appendInput())
    expect(typeof (appended as { then?: unknown }).then).not.toBe('function')
    expect(typeof (repository.appendMany([]) as { then?: unknown }).then).not.toBe('function')
    expect(typeof (repository.cursorState() as { then?: unknown }).then).not.toBe('function')
    expect(typeof (repository.getBySequence(1) as { then?: unknown }).then).not.toBe('function')
    expect(typeof (repository.readAfter({ afterSequence: 0 }) as { then?: unknown }).then).not.toBe('function')
    expect(typeof (repository.inspectRetention({ policy: retentionPolicy(), now: 10 }) as { then?: unknown }).then).not.toBe('function')
    expect(typeof (repository.planRetention({ policy: retentionPolicy(), now: 10 }) as { then?: unknown }).then).not.toBe('function')
    expect(typeof (repository.pruneThrough(0) as { then?: unknown }).then).not.toBe('function')
    expect(typeof (repository.pruneRetention({ policy: retentionPolicy(), now: 10 }) as { then?: unknown }).then).not.toBe('function')
  })
})
