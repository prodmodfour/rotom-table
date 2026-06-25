import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openRealtimeSseStream } from '../../server/realtime/realtimeSseDelivery'
import type { RealtimeEventRetentionPolicy } from '../../server/realtime/realtimeEventRetentionConfig'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteRealtimeEventRepository, type AppendRealtimeEventInput } from '../../server/storage/realtimeEventRepository'
import { createRealtimeHub } from '../../server/utils/realtime'
import type { SseRequest, SseResponse } from '../../server/utils/sseStream'

const openDatabases: RotomDatabase[] = []
const tempRoots: string[] = []

afterEach(() => {
  vi.useRealTimers()
  while (openDatabases.length > 0) openDatabases.pop()?.close()
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

const tempDatabasePath = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-realtime-wal-'))
  tempRoots.push(root)
  return join(root, 'events.sqlite')
}

const openFileDatabase = (path: string): RotomDatabase => {
  const database = openRotomDatabase({ path })
  openDatabases.push(database)
  return database
}

const appendInput = (label: string): AppendRealtimeEventInput => ({
  event: { channel: 'maps', type: 'updated', data: { label } },
  access: { kind: 'gm-only' },
  timestamp: 1_000,
})

const retentionPolicy = (overrides: Partial<RealtimeEventRetentionPolicy> = {}): RealtimeEventRetentionPolicy => ({
  enabled: true,
  retentionDays: 30,
  maxRows: 250_000,
  pruneIntervalMs: 10_000,
  ...overrides,
})

const retainedSequences = (database: RotomDatabase): number[] => {
  const repository = createSqliteRealtimeEventRepository({ database })
  const state = repository.cursorState()
  return repository.readAfter({ afterSequence: state.earliestAvailableSequence - 1, limit: 500 })
    .events.map((event) => event.sequence)
}

const createTransport = () => {
  const req = new EventEmitter() as EventEmitter & SseRequest
  const writes: string[] = []
  const res: SseResponse = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => {
      writes.push(chunk)
      return true
    }),
    end: vi.fn(),
  }
  return { req, res, writes }
}

const dataFrames = (writes: readonly string[]): unknown[] => writes
  .filter((chunk) => chunk.includes('data: '))
  .map((chunk) => {
    const line = chunk.trimEnd().split('\n').find((entry) => entry.startsWith('data: '))
    if (!line) throw new Error(`missing data line: ${chunk}`)
    return JSON.parse(line.slice('data: '.length)) as unknown
  })

const startGmStream = (input: {
  readonly repository: ReturnType<typeof createSqliteRealtimeEventRepository>
  readonly afterSequence?: number | null
  readonly hub: ReturnType<typeof createRealtimeHub>
}) => {
  const { req, res, writes } = createTransport()
  const stream = openRealtimeSseStream({
    req,
    res,
    cursor: input.afterSequence === undefined || input.afterSequence === null
      ? { afterSequence: null, source: 'none' }
      : { afterSequence: input.afterSequence, source: 'query' },
    principal: { role: 'gm' },
    realtimeEventRepository: input.repository,
    accessDependencies: {
      getMap: () => null,
      getSheet: () => null,
      listTrainerSheets: () => [],
      playerVisibleMapSheetAccessKeys: () => new Set(),
    },
    realtimeHub: input.hub,
    pollIntervalMs: 60_000,
    keepaliveMs: 60_000,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    connectionId: 'wal-stress',
  })
  return { req, res, writes, stream }
}

const closeStream = async (connection: ReturnType<typeof startGmStream>): Promise<void> => {
  connection.req.emit('close')
  await connection.stream
}

describe('file-backed WAL realtime event stress coverage', () => {
  it('serializes concurrent appenders on separate connections with global sequences', () => {
    const path = tempDatabasePath()
    const databaseA = openFileDatabase(path)
    const databaseB = openFileDatabase(path)
    const repositoryA = createSqliteRealtimeEventRepository({ database: databaseA })
    const repositoryB = createSqliteRealtimeEventRepository({ database: databaseB })

    const sequences: number[] = []
    for (let index = 0; index < 10; index += 1) {
      sequences.push(repositoryA.append(appendInput(`a-${index}`)).sequence)
      sequences.push(repositoryB.append(appendInput(`b-${index}`)).sequence)
    }

    expect(sequences).toEqual(Array.from({ length: 20 }, (_value, index) => index + 1))
    expect(repositoryA.cursorState()).toEqual({ latestSequence: 20, earliestAvailableSequence: 1 })
    expect(retainedSequences(databaseB)).toEqual(sequences)
  })

  it('keeps concurrent appender and pruner accounting safe across connections', () => {
    const path = tempDatabasePath()
    const databaseA = openFileDatabase(path)
    const databaseB = openFileDatabase(path)
    const repositoryA = createSqliteRealtimeEventRepository({ database: databaseA })
    const repositoryB = createSqliteRealtimeEventRepository({ database: databaseB })

    for (let index = 0; index < 8; index += 1) repositoryA.append(appendInput(`seed-${index}`))
    const pruned = repositoryB.pruneRetention({ policy: retentionPolicy({ maxRows: 3 }), now: 1_000 })
    const appended = repositoryA.append(appendInput('after-prune'))

    expect(pruned).toMatchObject({ deletedCount: 5, currentCursorState: { latestSequence: 8, earliestAvailableSequence: 6 } })
    expect(appended.sequence).toBe(9)
    expect(repositoryB.cursorState()).toEqual({ latestSequence: 9, earliestAvailableSequence: 6 })
    expect(retainedSequences(databaseA)).toEqual([6, 7, 8, 9])
  })

  it('serves two SSE readers while another connection writes and prunes', async () => {
    const path = tempDatabasePath()
    const writerDatabase = openFileDatabase(path)
    const readerDatabaseA = openFileDatabase(path)
    const readerDatabaseB = openFileDatabase(path)
    const writer = createSqliteRealtimeEventRepository({ database: writerDatabase })
    const readerA = createSqliteRealtimeEventRepository({ database: readerDatabaseA })
    const readerB = createSqliteRealtimeEventRepository({ database: readerDatabaseB })
    const hub = createRealtimeHub()

    writer.append(appendInput('history-one'))
    writer.append(appendInput('history-two'))
    const streamA = startGmStream({ repository: readerA, hub })
    const streamB = startGmStream({ repository: readerB, hub })
    await vi.waitFor(() => {
      expect(dataFrames(streamA.writes).length).toBeGreaterThanOrEqual(1)
      expect(dataFrames(streamB.writes).length).toBeGreaterThanOrEqual(1)
    })

    expect(writer.pruneRetention({ policy: retentionPolicy({ maxRows: 1 }), now: 1_000 }).deletedCount).toBe(1)
    const later = writer.append(appendInput('after-prune'))
    hub.publishSequencedRealtime(later.event)

    await vi.waitFor(() => {
      const labelsA = dataFrames(streamA.writes).map((frame) => (frame as { data?: { label?: string } }).data?.label)
      const labelsB = dataFrames(streamB.writes).map((frame) => (frame as { data?: { label?: string } }).data?.label)
      expect(labelsA).toContain('after-prune')
      expect(labelsB).toContain('after-prune')
    })
    expect(dataFrames(streamA.writes).filter((frame) => (frame as { data?: { label?: string } }).data?.label === 'after-prune')).toHaveLength(1)
    expect(dataFrames(streamB.writes).filter((frame) => (frame as { data?: { label?: string } }).data?.label === 'after-prune')).toHaveLength(1)

    await closeStream(streamA)
    await closeStream(streamB)
  })

  it('lets a polling reader see committed state while another transaction rolls back', () => {
    const path = tempDatabasePath()
    const databaseA = openFileDatabase(path)
    const databaseB = openFileDatabase(path)
    const repositoryA = createSqliteRealtimeEventRepository({ database: databaseA })
    const repositoryB = createSqliteRealtimeEventRepository({ database: databaseB })

    repositoryA.append(appendInput('committed'))
    expect(() => databaseA.withTransaction(() => {
      repositoryA.append(appendInput('rolled-back'))
      expect(repositoryB.readAfter({ afterSequence: 0 }).events.map((event) => event.sequence)).toEqual([1])
      throw new Error('rollback marker')
    })).toThrow('rollback marker')

    expect(repositoryB.cursorState()).toEqual({ latestSequence: 1, earliestAvailableSequence: 1 })
    expect(repositoryB.readAfter({ afterSequence: 0 }).events.map((event) => event.sequence)).toEqual([1])
  })

  it('preserves cursor state across close and reopen after retention', () => {
    const path = tempDatabasePath()
    const database = openFileDatabase(path)
    const repository = createSqliteRealtimeEventRepository({ database })
    for (let index = 0; index < 4; index += 1) repository.append(appendInput(`event-${index}`))
    repository.pruneRetention({ policy: retentionPolicy({ maxRows: 2 }), now: 1_000 })
    database.close()
    openDatabases.splice(openDatabases.indexOf(database), 1)

    const reopened = openFileDatabase(path)
    const reopenedRepository = createSqliteRealtimeEventRepository({ database: reopened })
    expect(reopenedRepository.cursorState()).toEqual({ latestSequence: 4, earliestAvailableSequence: 3 })
    expect(retainedSequences(reopened)).toEqual([3, 4])
  })

  it('honors busy timeout under a held write transaction', () => {
    const path = tempDatabasePath()
    const databaseA = openFileDatabase(path)
    const databaseB = openFileDatabase(path)
    const repositoryB = createSqliteRealtimeEventRepository({ database: databaseB })
    databaseB.connection.exec('PRAGMA busy_timeout = 25')

    databaseA.connection.exec('BEGIN IMMEDIATE')
    try {
      expect(() => repositoryB.append(appendInput('blocked'))).toThrow(/busy|locked/i)
    } finally {
      databaseA.connection.exec('ROLLBACK')
    }

    expect(repositoryB.append(appendInput('after-lock')).sequence).toBe(1)
  })
})
