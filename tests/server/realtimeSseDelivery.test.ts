import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_PATCH_TYPES,
} from '#shared/livePlayCommands'
import {
  LIVE_PLAY_REALTIME_EVENT_TYPES,
  type LivePlayRealtimeEvent,
} from '#shared/realtime'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import type { RealtimeEventAccess } from '#shared/realtimeEventLog'
import { parsePendingMoveResolution } from '#shared/moveAutomation/pendingResolution'
import type { RealtimeEventRetentionPolicy } from '../../server/realtime/realtimeEventRetentionConfig'
import { openRealtimeSseStream } from '../../server/realtime/realtimeSseDelivery'
import { createSqliteRealtimeEventAccessDependencies } from '../../server/realtime/sqliteRealtimeEventAccessAdapter'
import type { RealtimeDeliveryPrincipal, RealtimePlayerSheetAccessKey } from '../../server/realtime/realtimeEventAccessPolicy'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteShopTableRepository } from '../../server/storage/shopTableRepository'
import { createSqlitePendingMoveResolutionRepository } from '../../server/storage/pendingMoveResolutionRepository'
import { createRealtimeHub } from '../../server/utils/realtime'
import type { SseRequest, SseResponse } from '../../server/utils/sseStream'
import { mapDoc, pokemonSheet, trainerSheet } from './helpers/durableLibraryHarness'
import { createPendingMoveResolutionFixture } from '../fixtures/moveAutomation/pendingResolution'

interface ParsedSseFrame {
  readonly id: string | null
  readonly data: unknown
}

const databases: RotomDatabase[] = []
const tempDirs: string[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const database of databases.splice(0)) database.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const createTransport = () => {
  const headers = new Map<string, string>()
  const writes: string[] = []
  const req = new EventEmitter() as EventEmitter & SseRequest
  const res: SseResponse = {
    setHeader: vi.fn((name: string, value: string) => headers.set(name, value)),
    write: vi.fn((chunk: string) => {
      writes.push(chunk)
      return true
    }),
    flushHeaders: vi.fn(),
    end: vi.fn(),
  }
  return { headers, writes, req, res }
}

const parseFrame = (chunk: string): ParsedSseFrame => {
  const lines = chunk.trimEnd().split('\n')
  const idLine = lines.find((line) => line.startsWith('id: '))
  const dataLine = lines.find((line) => line.startsWith('data: '))
  if (!dataLine) throw new Error(`SSE frame has no data line: ${chunk}`)
  return {
    id: idLine ? idLine.slice('id: '.length) : null,
    data: JSON.parse(dataLine.slice('data: '.length)),
  }
}

const dataFrames = (writes: readonly string[]): ParsedSseFrame[] =>
  writes.filter((chunk) => chunk.includes('data: ')).map(parseFrame)

const waitForFrameCount = async (writes: readonly string[], count: number): Promise<ParsedSseFrame[]> => {
  await vi.waitFor(() => expect(dataFrames(writes).length).toBeGreaterThanOrEqual(count))
  return dataFrames(writes)
}

const createHarness = (options: { readonly path?: string; readonly clock?: () => number } = {}) => {
  const database = openRotomDatabase({ path: options.path ?? ':memory:' })
  databases.push(database)
  const maps = createSqliteMapRepository(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database, maps)
  const realtime = createSqliteRealtimeEventRepository({ database, clock: options.clock ?? (() => 1_000) })
  const accessDependencies = createSqliteRealtimeEventAccessDependencies({ database, mapRepository: maps, sheetRepository: sheets })
  const hub = createRealtimeHub()
  return { database, maps, sheets, realtime, accessDependencies, hub }
}

const startStream = (input: {
  readonly harness: ReturnType<typeof createHarness>
  readonly principal?: RealtimeDeliveryPrincipal
  readonly afterSequence?: number | null
  readonly readLimit?: number
  readonly pollIntervalMs?: number
}) => {
  const { req, res, writes } = createTransport()
  const stream = openRealtimeSseStream({
    req,
    res,
    cursor: input.afterSequence === undefined || input.afterSequence === null
      ? { afterSequence: null, source: 'none' }
      : { afterSequence: input.afterSequence, source: 'query' },
    principal: input.principal ?? { role: 'gm' },
    realtimeEventRepository: input.harness.realtime,
    accessDependencies: input.harness.accessDependencies,
    realtimeHub: input.harness.hub,
    readLimit: input.readLimit,
    pollIntervalMs: input.pollIntervalMs ?? 10_000,
    keepaliveMs: 60_000,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    connectionId: 'test-sse',
  })
  return { req, res, writes, stream }
}

const closeStream = async (connection: ReturnType<typeof startStream>): Promise<void> => {
  connection.req.emit('close')
  await connection.stream
}

const append = (
  harness: ReturnType<typeof createHarness>,
  sequenceLabel: string,
  access: RealtimeEventAccess,
) => harness.realtime.append({
  event: {
    channel: `events:${sequenceLabel}`,
    type: 'updated',
    data: { label: sequenceLabel },
  },
  access,
  timestamp: 1_000,
})

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_abcdefgh' as PlayerProfileId,
  displayName: 'Ash' as PlayerProfileDisplayName,
  linkedCharacters,
})

const retentionPolicy = (overrides: Partial<RealtimeEventRetentionPolicy> = {}): RealtimeEventRetentionPolicy => ({
  enabled: true,
  retentionDays: 30,
  maxRows: 250_000,
  pruneIntervalMs: 10_000,
  ...overrides,
})

describe('repository-backed realtime SSE replay', () => {
  it('starts a cursorless connection after the current latest sequence without replaying retained history', async () => {
    const harness = createHarness()
    harness.maps.saveSetupMap(mapDoc({ slug: 'visible', playerVisible: true }))
    append(harness, 'history', { kind: 'map-access', mapSlug: 'visible' })

    const connection = startStream({ harness, afterSequence: null })
    const frames = await waitForFrameCount(connection.writes, 1)

    expect(frames).toEqual([
      {
        id: '1',
        data: expect.objectContaining({
          kind: 'realtime-control',
          type: 'replay-caught-up',
          requestedAfterSequence: null,
          latestSequence: 1,
          replayedThroughSequence: 1,
        }),
      },
    ])
    expect(connection.writes.join('')).not.toContain('history')

    await closeStream(connection)
  })

  it('replays a valid cursor in global sequence order across bounded pages', async () => {
    const harness = createHarness()
    harness.maps.saveSetupMap(mapDoc({ slug: 'visible', playerVisible: true }))
    append(harness, 'one', { kind: 'map-access', mapSlug: 'visible' })
    append(harness, 'two', { kind: 'map-access', mapSlug: 'visible' })
    append(harness, 'three', { kind: 'map-access', mapSlug: 'visible' })

    const connection = startStream({ harness, afterSequence: 0, readLimit: 1 })
    const frames = await waitForFrameCount(connection.writes, 4)

    expect(frames.map((frame) => frame.id)).toEqual(['1', '2', '3', '3'])
    expect(frames.slice(0, 3).map((frame) => (frame.data as { data?: { label?: string } }).data?.label)).toEqual([
      'one',
      'two',
      'three',
    ])
    expect(frames[3]?.data).toMatchObject({ type: 'replay-caught-up', replayedThroughSequence: 3 })

    await closeStream(connection)
  })

  it('sends reconcile-required for gap and ahead cursors without partial history', async () => {
    const harness = createHarness()
    harness.maps.saveSetupMap(mapDoc({ slug: 'visible', playerVisible: true }))
    append(harness, 'one', { kind: 'map-access', mapSlug: 'visible' })
    append(harness, 'two', { kind: 'map-access', mapSlug: 'visible' })
    harness.realtime.pruneThrough(1)

    const gapConnection = startStream({ harness, afterSequence: 0 })
    const gapFrames = await waitForFrameCount(gapConnection.writes, 1)
    expect(gapFrames).toEqual([
      { id: '2', data: expect.objectContaining({ type: 'reconcile-required', reason: 'gap' }) },
    ])
    expect(gapConnection.writes.join('')).not.toContain('one')
    await closeStream(gapConnection)

    const aheadConnection = startStream({ harness, afterSequence: 999 })
    const aheadFrames = await waitForFrameCount(aheadConnection.writes, 1)
    expect(aheadFrames).toEqual([
      { id: '2', data: expect.objectContaining({ type: 'reconcile-required', reason: 'ahead' }) },
    ])
    expect(aheadConnection.writes.join('')).not.toContain('two')
    await closeStream(aheadConnection)
  })

  it('sends gap reconciliation when retention prunes the requested cursor out of range', async () => {
    const harness = createHarness()
    harness.maps.saveSetupMap(mapDoc({ slug: 'visible', playerVisible: true }))
    append(harness, 'one', { kind: 'map-access', mapSlug: 'visible' })
    append(harness, 'two', { kind: 'map-access', mapSlug: 'visible' })
    harness.realtime.pruneRetention({ policy: retentionPolicy({ maxRows: 1 }), now: 1_000 })

    const connection = startStream({ harness, afterSequence: 0 })
    const frames = await waitForFrameCount(connection.writes, 1)

    expect(frames).toEqual([
      { id: '2', data: expect.objectContaining({ type: 'reconcile-required', reason: 'gap' }) },
    ])
    expect(connection.writes.join('')).not.toContain('one')
    await closeStream(connection)
  })

  it('lets a caught-up open client receive later events after retention pruning', async () => {
    const harness = createHarness()
    harness.maps.saveSetupMap(mapDoc({ slug: 'visible', playerVisible: true }))
    append(harness, 'one', { kind: 'map-access', mapSlug: 'visible' })
    append(harness, 'two', { kind: 'map-access', mapSlug: 'visible' })
    const connection = startStream({ harness, afterSequence: null, pollIntervalMs: 60_000 })
    await waitForFrameCount(connection.writes, 1)

    harness.realtime.pruneRetention({
      policy: retentionPolicy({ retentionDays: 1, maxRows: 10 }),
      now: 4 * 24 * 60 * 60 * 1000,
    })
    const later = append(harness, 'three', { kind: 'map-access', mapSlug: 'visible' })
    harness.hub.publishSequencedRealtime(later.event)

    await vi.waitFor(() => expect(connection.writes.join('')).toContain('three'))
    const matching = dataFrames(connection.writes).filter((frame) => (
      (frame.data as { data?: { label?: string } }).data?.label === 'three'
    ))
    expect(matching).toHaveLength(1)
    expect(connection.writes.join('')).not.toContain('one')
    await closeStream(connection)
  })

  it('does not duplicate replayed rows when pruning while a connection is open', async () => {
    const harness = createHarness()
    harness.maps.saveSetupMap(mapDoc({ slug: 'visible', playerVisible: true }))
    append(harness, 'one', { kind: 'map-access', mapSlug: 'visible' })
    append(harness, 'two', { kind: 'map-access', mapSlug: 'visible' })
    const connection = startStream({ harness, afterSequence: 0, pollIntervalMs: 60_000 })
    await waitForFrameCount(connection.writes, 3)

    harness.realtime.pruneRetention({ policy: retentionPolicy({ maxRows: 1 }), now: 1_000 })
    const later = append(harness, 'three', { kind: 'map-access', mapSlug: 'visible' })
    harness.hub.publishSequencedRealtime(later.event)

    await vi.waitFor(() => expect(connection.writes.join('')).toContain('three'))
    const labels = dataFrames(connection.writes)
      .map((frame) => (frame.data as { data?: { label?: string } }).data?.label)
      .filter(Boolean)
    expect(labels).toEqual(['one', 'two', 'three'])
    await closeStream(connection)
  })

  it('does not repeatedly emit gap controls while polling a pruned log', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    harness.maps.saveSetupMap(mapDoc({ slug: 'visible', playerVisible: true }))
    append(harness, 'one', { kind: 'map-access', mapSlug: 'visible' })
    append(harness, 'two', { kind: 'map-access', mapSlug: 'visible' })
    harness.realtime.pruneRetention({ policy: retentionPolicy({ maxRows: 1 }), now: 1_000 })

    const connection = startStream({ harness, afterSequence: 0, pollIntervalMs: 10 })
    await waitForFrameCount(connection.writes, 1)
    await vi.advanceTimersByTimeAsync(50)

    const gapFrames = dataFrames(connection.writes).filter((frame) => (
      (frame.data as { type?: string; reason?: string }).type === 'reconcile-required'
    ))
    expect(gapFrames).toHaveLength(1)
    await closeStream(connection)
  })

  it('keeps denied-event checkpoints safe across pruning', async () => {
    const harness = createHarness()
    harness.maps.saveSetupMap(mapDoc({ slug: 'visible', playerVisible: true }))
    append(harness, 'denied', { kind: 'gm-only' })
    append(harness, 'visible', { kind: 'map-access', mapSlug: 'visible' })

    const firstConnection = startStream({
      harness,
      afterSequence: 0,
      readLimit: 1,
      principal: { role: 'player', playerProfile: null, sessionAccess: null },
    })
    const firstFrames = await waitForFrameCount(firstConnection.writes, 3)
    expect(firstFrames.map((frame) => frame.id)).toEqual(['1', '2', '2'])
    expect(firstConnection.writes.join('')).not.toContain('denied')
    await closeStream(firstConnection)

    harness.realtime.pruneRetention({ policy: retentionPolicy({ maxRows: 1 }), now: 1_000 })
    const reconnect = startStream({
      harness,
      afterSequence: 1,
      principal: { role: 'player', playerProfile: null, sessionAccess: null },
    })
    const reconnectFrames = await waitForFrameCount(reconnect.writes, 2)
    expect(reconnectFrames.map((frame) => frame.id)).toEqual(['2', '2'])
    expect(reconnectFrames[0]?.data).toMatchObject({ sequence: 2, data: { label: 'visible' } })
    await closeStream(reconnect)
  })

  it('advances replay cursors across response-window events denied to an ineligible attacker', async () => {
    const harness = createHarness()
    harness.maps.saveSetupMap(mapDoc({
      slug: 'pending-arena',
      playerVisible: true,
      placements: [
        {
          id: 'actor-token',
          sheetKind: 'pokemon',
          sheetSlug: 'actor',
          position: { x: 0, y: 0, z: 0 },
        },
        {
          id: 'target-token',
          sheetKind: 'pokemon',
          sheetSlug: 'target',
          position: { x: 1, y: 0, z: 0 },
        },
      ],
    }))
    const source = createPendingMoveResolutionFixture()
    const resolution = parsePendingMoveResolution({
      ...source,
      outstandingWindows: source.outstandingWindows.map(window => ({
        ...window,
        ownership: [{ kind: 'target', id: 'target-token' }],
      })),
    })
    createSqlitePendingMoveResolutionRepository(harness.database).create({ resolution })
    append(harness, 'private-target-options', {
      kind: 'pending-move-response-access',
      mapSlug: 'pending-arena',
      resolutionId: resolution.resolutionId,
      windowId: 'window.branch',
    })
    append(harness, 'public-map-update', {
      kind: 'map-access',
      mapSlug: 'pending-arena',
    })

    const connection = startStream({
      harness,
      afterSequence: 0,
      readLimit: 1,
      principal: {
        role: 'player',
        playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'actor' }]),
        sessionAccess: null,
      },
    })
    const frames = await waitForFrameCount(connection.writes, 3)

    expect(frames.map(frame => frame.id)).toEqual(['1', '2', '2'])
    expect(frames[0]?.data).toMatchObject({
      type: 'replay-caught-up',
      replayedThroughSequence: 1,
    })
    expect(frames[1]?.data).toMatchObject({ data: { label: 'public-map-update' } })
    expect(connection.writes.join('')).not.toContain('private-target-options')
    await closeStream(connection)
  })

  it('emits an interim checkpoint when a replay page contains only denied events', async () => {
    const harness = createHarness()
    harness.maps.saveSetupMap(mapDoc({ slug: 'visible', playerVisible: true }))
    append(harness, 'denied-first-page', { kind: 'gm-only' })
    append(harness, 'visible-second-page', { kind: 'map-access', mapSlug: 'visible' })

    const connection = startStream({
      harness,
      afterSequence: 0,
      readLimit: 1,
      principal: { role: 'player', playerProfile: null, sessionAccess: null },
    })
    const frames = await waitForFrameCount(connection.writes, 3)

    expect(frames.map((frame) => frame.id)).toEqual(['1', '2', '2'])
    expect(frames[0]?.data).toMatchObject({ type: 'replay-caught-up', replayedThroughSequence: 1 })
    expect(frames[1]?.data).toMatchObject({ sequence: 2, data: { label: 'visible-second-page' } })
    expect(connection.writes.join('')).not.toContain('denied-first-page')
    await closeStream(connection)
  })

  it('filters denied durable events, advances through them, and never serializes access metadata or denied payloads', async () => {
    const harness = createHarness()
    harness.maps.saveSetupMap(mapDoc({ slug: 'visible', playerVisible: true }))
    harness.maps.saveSetupMap(mapDoc({ slug: 'hidden', playerVisible: false }))
    append(harness, 'gm-secret', { kind: 'gm-only' })
    append(harness, 'hidden-map-secret', { kind: 'map-access', mapSlug: 'hidden' })
    append(harness, 'visible-map', { kind: 'map-access', mapSlug: 'visible' })
    append(harness, 'missing-sheet-secret', { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'missing' })

    const connection = startStream({ harness, afterSequence: 0, principal: { role: 'player', playerProfile: null, sessionAccess: null } })
    const frames = await waitForFrameCount(connection.writes, 2)

    expect(frames.map((frame) => frame.id)).toEqual(['3', '4'])
    expect(frames[0]?.data).toMatchObject({ sequence: 3, data: { label: 'visible-map' } })
    expect(frames[1]?.data).toMatchObject({ type: 'replay-caught-up', replayedThroughSequence: 4 })
    expect(connection.writes.join('')).not.toContain('gm-secret')
    expect(connection.writes.join('')).not.toContain('hidden-map-secret')
    expect(connection.writes.join('')).not.toContain('missing-sheet-secret')
    expect(connection.writes.join('')).not.toContain('gm-only')
    expect(connection.writes.join('')).not.toContain('map-access')
    await closeStream(connection)

    const reconnect = startStream({ harness, afterSequence: 4, principal: { role: 'player', playerProfile: null, sessionAccess: null } })
    const reconnectFrames = await waitForFrameCount(reconnect.writes, 1)
    expect(reconnectFrames).toEqual([
      { id: '4', data: expect.objectContaining({ type: 'replay-caught-up', replayedThroughSequence: 4 }) },
    ])
    expect(reconnect.writes.join('')).not.toContain('visible-map')
    await closeStream(reconnect)
  })

  it('redacts requester-only Friendly area exclusions from player realtime observers', async () => {
    const harness = createHarness()
    harness.maps.saveSetupMap(mapDoc({ slug: 'visible', playerVisible: true }))
    harness.realtime.append({
      event: {
        channel: 'map:visible',
        type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED,
        mapSlug: 'visible',
        previousRevision: 1,
        revision: 2,
        opId: 'op_areaobserver01',
        patches: [{
          schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
          type: LIVE_PLAY_PATCH_TYPES.MOVE_STATE,
          mapSlug: 'visible',
          revision: 2,
          scopes: [],
          payload: {
            command: 'resolveMove',
            move: {
              selectedTargetIds: ['eligible-target'],
              area: {
                candidateTargetIds: ['eligible-target', 'requester-excluded-target'],
                excludedTargetIds: ['requester-excluded-target'],
              },
            },
          },
        }],
      } as Omit<LivePlayRealtimeEvent, 'timestamp'>,
      access: { kind: 'map-access', mapSlug: 'visible' },
      timestamp: 1_000,
    })

    const playerConnection = startStream({
      harness,
      afterSequence: 0,
      principal: { role: 'player', playerProfile: null, sessionAccess: null },
    })
    const playerFrames = await waitForFrameCount(playerConnection.writes, 2)
    const playerEvent = playerFrames[0]?.data as {
      readonly patches?: readonly {
        readonly payload?: {
          readonly move?: {
            readonly area?: {
              readonly candidateTargetIds?: readonly string[]
              readonly excludedTargetIds?: readonly string[]
            }
          }
        }
      }[]
    }
    expect(playerEvent.patches?.[0]?.payload?.move?.area).toEqual({
      candidateTargetIds: ['eligible-target'],
      excludedTargetIds: [],
    })
    expect(playerConnection.writes.join('')).not.toContain('requester-excluded-target')
    await closeStream(playerConnection)

    const gmConnection = startStream({ harness, afterSequence: 0, principal: { role: 'gm' } })
    const gmFrames = await waitForFrameCount(gmConnection.writes, 2)
    expect(JSON.stringify(gmFrames[0]?.data)).toContain('requester-excluded-target')
    await closeStream(gmConnection)
  })

  it('redacts Pokémon GM fields while delivering allowed sheet events to players', async () => {
    const harness = createHarness()
    const sheet = pokemonSheet({ slug: 'pika', player: true, gm: { notes: 'secret GM hook' } })
    harness.sheets.saveSetupSheet('pokemon', 'pika', sheet)
    harness.realtime.append({
      event: {
        channel: 'sheet:pokemon:pika',
        type: 'updated',
        data: { kind: 'pokemon', slug: 'pika', sheet },
      },
      access: { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pika' },
      timestamp: 1_000,
    })

    const connection = startStream({
      harness,
      afterSequence: 0,
      principal: { role: 'player', playerProfile: null, sessionAccess: null },
    })
    const frames = await waitForFrameCount(connection.writes, 2)

    expect(frames[0]?.data).toMatchObject({
      type: 'updated',
      data: {
        kind: 'pokemon',
        slug: 'pika',
        sheet: expect.not.objectContaining({ gm: expect.anything() }),
      },
    })
    expect(connection.writes.join('')).not.toContain('secret GM hook')
    await closeStream(connection)
  })

  it('redacts shop GM notes and purchase audit logs while delivering allowed shop events to players', async () => {
    const harness = createHarness()
    const shop = createSqliteShopTableRepository(harness.database).create({
      slug: 'open-shop',
      now: 1_000,
      document: {
        slug: 'open-shop',
        name: 'Open Shop',
        playerVisible: true,
        open: true,
        gmNotes: 'private setup note',
        entries: [{ id: 'potion', itemName: 'Potion', price: 300, stock: 5, gmNotes: 'private margin' }],
        purchaseLog: [
          {
            opId: 'op_shopcheckout_secret',
            purchasedAt: 1_700_000_000_000,
            actor: { role: 'player', profileId: 'profile_secret', profileName: 'Secret Buyer' },
            paymentSource: { kind: 'trainer', slug: 'ash' },
            deliveryTarget: { kind: 'trainer', slug: 'ash' },
            lines: [{ entryId: 'potion', itemName: 'Potion', section: 'medicalKit', quantity: 1, unitPrice: 300, lineTotal: 300 }],
            total: 300,
          },
        ],
      },
    }).document
    harness.realtime.append({
      event: {
        channel: 'shop:open-shop',
        type: 'updated',
        data: { slug: 'open-shop', document: shop },
      },
      access: { kind: 'shop-access', shopSlug: 'open-shop' },
      timestamp: 1_000,
    })

    const connection = startStream({
      harness,
      afterSequence: 0,
      principal: { role: 'player', playerProfile: null, sessionAccess: null },
    })
    const frames = await waitForFrameCount(connection.writes, 2)

    expect(frames[0]?.data).toMatchObject({
      type: 'updated',
      data: {
        slug: 'open-shop',
        document: expect.not.objectContaining({
          gmNotes: expect.anything(),
          purchaseLog: expect.anything(),
        }),
      },
    })
    expect(connection.writes.join('')).not.toContain('private setup note')
    expect(connection.writes.join('')).not.toContain('private margin')
    expect(connection.writes.join('')).not.toContain('Secret Buyer')
    expect(connection.writes.join('')).not.toContain('op_shopcheckout_secret')
    await closeStream(connection)
  })

  it('uses current SQLite sheet/profile/session/map-placement policy while delivering retained rows', async () => {
    const harness = createHarness()
    harness.sheets.saveSetupSheet('trainer', 'ash', trainerSheet({ slug: 'ash', currentTeam: ['team-pika'] }))
    harness.sheets.saveSetupSheet('pokemon', 'team-pika', pokemonSheet({ slug: 'team-pika', player: false }))
    harness.sheets.saveSetupSheet('pokemon', 'session-pika', pokemonSheet({ slug: 'session-pika', player: false }))
    harness.sheets.saveSetupSheet('trainer', 'map-trainer', trainerSheet({ slug: 'map-trainer', player: false }))
    harness.maps.saveSetupMap(mapDoc({
      slug: 'visible',
      playerVisible: true,
      placements: [{
        id: 'trainer-token',
        sheetKind: 'trainer',
        sheetSlug: 'map-trainer',
        position: { x: 0, y: 0, z: 0 },
        facing: 'south-east',
        turned: false,
      }],
    }))
    append(harness, 'profile-roster', { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'team-pika' })
    append(harness, 'session-grant', { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'session-pika' })
    append(harness, 'visible-map-placement', { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: 'map-trainer' })

    const principal: RealtimeDeliveryPrincipal = {
      role: 'player',
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'ash' }]),
      sessionAccess: { sheetKeys: new Set<RealtimePlayerSheetAccessKey>(['pokemon:session-pika']) },
    }
    const connection = startStream({ harness, afterSequence: 0, principal })
    const frames = await waitForFrameCount(connection.writes, 4)

    expect(frames.slice(0, 3).map((frame) => (frame.data as { data?: { label?: string } }).data?.label)).toEqual([
      'profile-roster',
      'session-grant',
      'visible-map-placement',
    ])
    await closeStream(connection)
  })
})

describe('live durable tailing and transient SSE delivery', () => {
  it('filters scoped transient events, sends them without SSE ids, and does not replay them', async () => {
    const harness = createHarness()
    harness.maps.saveSetupMap(mapDoc({ slug: 'visible', playerVisible: true }))
    harness.maps.saveSetupMap(mapDoc({ slug: 'hidden', playerVisible: false }))
    const principal: RealtimeDeliveryPrincipal = { role: 'player', playerProfile: null, sessionAccess: null }
    const connection = startStream({ harness, afterSequence: null, principal })
    await waitForFrameCount(connection.writes, 1)

    harness.hub.publishTransientRealtime({
      event: { channel: 'map:visible', type: 'updated', data: { label: 'transient-visible' } },
      access: { kind: 'map-access', mapSlug: 'visible' },
    })
    harness.hub.publishTransientRealtime({
      event: { channel: 'map:hidden', type: 'updated', data: { label: 'transient-hidden' } },
      access: { kind: 'map-access', mapSlug: 'hidden' },
    })

    const frames = await waitForFrameCount(connection.writes, 2)
    expect(frames[1]).toEqual({
      id: null,
      data: expect.objectContaining({ type: 'updated', data: { label: 'transient-visible' } }),
    })
    expect(connection.writes.join('')).not.toContain('transient-hidden')
    await closeStream(connection)

    const reconnect = startStream({ harness, afterSequence: 0, principal })
    const reconnectFrames = await waitForFrameCount(reconnect.writes, 1)
    expect(reconnectFrames).toEqual([
      { id: '0', data: expect.objectContaining({ type: 'replay-caught-up', replayedThroughSequence: 0 }) },
    ])
    expect(reconnect.writes.join('')).not.toContain('transient-visible')
    await closeStream(reconnect)
  })

  it('receives another process-like repository commit through SQLite polling without a shared wake-up', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rotom-sse-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'rotom.sqlite')
    const processA = createHarness({ path: dbPath })
    const processB = createHarness({ path: dbPath })
    processA.maps.saveSetupMap(mapDoc({ slug: 'visible', playerVisible: true }))

    const connection = startStream({ harness: processB, afterSequence: null, pollIntervalMs: 10 })
    await waitForFrameCount(connection.writes, 1)

    processA.realtime.append({
      event: { channel: 'map:visible', type: 'updated', data: { label: 'from-process-a' } },
      access: { kind: 'map-access', mapSlug: 'visible' },
      timestamp: 2_000,
    })
    processA.database.close()
    databases.splice(databases.indexOf(processA.database), 1)

    await vi.waitFor(() => {
      expect(connection.writes.join('')).toContain('from-process-a')
    })
    const frames = dataFrames(connection.writes)
    expect(frames.filter((frame) => (frame.data as { data?: { label?: string } }).data?.label === 'from-process-a')).toHaveLength(1)

    await closeStream(connection)
  })

  it('uses local durable wake-ups as latency hints without duplicating delivery', async () => {
    const harness = createHarness()
    harness.maps.saveSetupMap(mapDoc({ slug: 'visible', playerVisible: true }))
    const connection = startStream({ harness, afterSequence: null, pollIntervalMs: 60_000 })
    await waitForFrameCount(connection.writes, 1)

    const record = harness.realtime.append({
      event: { channel: 'map:visible', type: 'updated', data: { label: 'wake-up-row' } },
      access: { kind: 'map-access', mapSlug: 'visible' },
      timestamp: 3_000,
    })
    harness.hub.publishSequencedRealtime(record.event)
    harness.hub.publishSequencedRealtime(record.event)

    await vi.waitFor(() => {
      const matching = dataFrames(connection.writes).filter((frame) => (
        (frame.data as { data?: { label?: string } }).data?.label === 'wake-up-row'
      ))
      expect(matching).toHaveLength(1)
    })

    await closeStream(connection)
  })

  it('removes subscriptions on close so later publications are isolated', async () => {
    const harness = createHarness()
    harness.maps.saveSetupMap(mapDoc({ slug: 'visible', playerVisible: true }))
    const connection = startStream({ harness, afterSequence: null })
    await waitForFrameCount(connection.writes, 1)
    await closeStream(connection)
    const writeCount = connection.writes.length

    harness.hub.publishTransientRealtime({
      event: { channel: 'map:visible', type: 'updated', data: { label: 'after-close' } },
      access: { kind: 'map-access', mapSlug: 'visible' },
    })

    expect(connection.writes).toHaveLength(writeCount)
  })

  it('closes cleanly when durable polling fails after the stream is open', async () => {
    const { req, res, writes } = createTransport()
    const failure = new Error('database unavailable')
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const stream = openRealtimeSseStream({
      req,
      res,
      cursor: { afterSequence: null, source: 'none' },
      principal: { role: 'gm' },
      realtimeEventRepository: {
        cursorState: () => ({ earliestAvailableSequence: 1, latestSequence: 0 }),
        readAfter: () => {
          throw failure
        },
      },
      accessDependencies: {
        getMap: () => null,
        getSheet: () => null,
        listTrainerSheets: () => [],
        playerVisibleMapSheetAccessKeys: () => new Set(),
      },
      realtimeHub: createRealtimeHub(),
      pollIntervalMs: 10_000,
      keepaliveMs: 60_000,
      logger,
      connectionId: 'poll-failure',
    })

    await waitForFrameCount(writes, 1)
    await vi.waitFor(() => expect(res.end).toHaveBeenCalledOnce())
    await stream
    expect(logger.error).toHaveBeenCalledWith('[events] durable SSE tail failed', expect.objectContaining({ error: failure }))
  })
})
