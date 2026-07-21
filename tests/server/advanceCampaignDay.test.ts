import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { advanceCampaignDayUseCase } from '../../server/useCases/advanceCampaignDay'

let databases: RotomDatabase[] = []
const db = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

const changedPokemon = (revision = 1) => ({
  slug: 'pika',
  nickname: 'Pika',
  species: '',
  level: 5,
  combat: { currentHp: 1, injuries: 2, injuriesHealedToday: 2, conditions: ['Burned'] },
  moveUsage: { daily: { thunderbolt: { moveName: 'Thunderbolt', uses: 1 } } },
  abilityUsage: {
    schemaVersion: 1, dayKey: 'campaign-day:previous',
    entries: [{
      ownerId: 'pika', abilityInstanceId: 'base:pika:blessed-touch', canonicalId: 'Blessed Touch',
      clauseId: 'base', limit: 2, spent: 1, operationIds: ['op:blessed-touch'],
    }],
  },
  berryStorage: {
    schemaVersion: 1,
    entries: [{ id: 'berry:oran', canonicalItemId: 'oran-berry', canonicalItemName: 'Oran Berry', quantity: 1, lastTradedSceneId: null }],
  },
  revision,
})

const changedTrainer = (revision = 3) => ({
  slug: 'brock',
  name: 'Brock',
  level: 3,
  currentHp: 1,
  currentInjuries: 1,
  injuriesHealedToday: 1,
  conditions: ['Poisoned'],
  ap: { spent: 2 },
  revision,
})

const unchangedPokemon = () => ({
  slug: 'calm',
  nickname: 'Calm',
  species: '',
  level: 5,
  combat: { currentHp: 15, injuries: 0, conditions: [] },
  revision: 7,
})

describe('advanceCampaignDayUseCase', () => {
  it('commits multiple changed sheets atomically with complete durable specific and global events', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 999 })
    const published: PersistedRealtimeEvent[] = []
    sheets.saveSetupSheet('pokemon', 'pika', changedPokemon())
    sheets.saveSetupSheet('pokemon', 'calm', unchangedPokemon())
    sheets.saveSetupSheet('trainer', 'brock', changedTrainer())

    const result = advanceCampaignDayUseCase({ clientId: 'client-1' }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 500,
      publishPersistedRealtimeEvent: (event) => published.push(event),
    })

    expect(result).toMatchObject({ ok: true, totalSheets: 3, updatedSheets: 2, pokemonUpdated: 1, trainerUpdated: 1 })
    expect(sheets.getByRef('pokemon', 'pika')?.revision).toBe(2)
    expect(sheets.getByRef('pokemon', 'pika')?.sheet).toMatchObject({
      abilityUsage: { schemaVersion: 1, dayKey: 'campaign-day:500', entries: [] },
    })
    expect(sheets.getByRef('pokemon', 'pika')?.sheet).not.toHaveProperty('berryStorage')
    expect(sheets.getByRef('trainer', 'brock')?.revision).toBe(4)
    expect(sheets.getByRef('pokemon', 'calm')?.revision).toBe(7)
    expect(result.paths).toEqual(['data/sheets/pika.json', 'data/trainers/brock.json'])
    expect(result.realtimeEvents.map((event) => event.sequence)).toEqual([1, 2, 3, 4])
    expect(result.realtimeEvents.map((event) => event.event.channel)).toEqual([
      'sheet:pokemon:pika',
      'sheets',
      'sheet:trainer:brock',
      'sheets',
    ])
    expect(result.realtimeEvents.every((event) => event.access.kind === 'sheet-access')).toBe(true)
    expect(result.realtimeEvents[0]?.event).toMatchObject({
      channel: 'sheet:pokemon:pika',
      type: 'updated',
      clientId: 'client-1',
      data: { kind: 'pokemon', slug: 'pika', sheet: { slug: 'pika', revision: 2, updatedAt: 500 } },
    })
    expect(realtime.readAfter({ afterSequence: 0 }).events).toEqual(result.realtimeEvents)
    expect(published).toEqual(result.realtimeEvents)
  })

  it('rolls back every sheet when one planned sheet is stale', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'pika', changedPokemon())
    sheets.saveSetupSheet('trainer', 'brock', changedTrainer())
    let madeStale = false
    const staleRepository = {
      database,
      list: (kind?: 'pokemon' | 'trainer') => {
        const rows = sheets.list(kind)
        if (kind === 'pokemon' && !madeStale) {
          madeStale = true
          sheets.saveSetupSheet('pokemon', 'pika', changedPokemon(20))
        }
        return rows
      },
      getByRef: sheets.getByRef,
      applyLivePlayUpdate: sheets.applyLivePlayUpdate,
    }

    expect(() => advanceCampaignDayUseCase({}, {
      database,
      sheetRepository: staleRepository,
      realtimeEventRepository: realtime,
      now: () => 501,
    })).toThrow(/changed during campaign-day advancement/)

    expect(sheets.getByRef('pokemon', 'pika')?.revision).toBe(20)
    expect(sheets.getByRef('trainer', 'brock')?.revision).toBe(3)
    expect(realtime.readAfter({ afterSequence: 0 }).events).toEqual([])
  })

  it('rolls back all sheet updates when durable event append fails', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('pokemon', 'pika', changedPokemon())
    sheets.saveSetupSheet('trainer', 'brock', changedTrainer())

    expect(() => advanceCampaignDayUseCase({}, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: { database, appendMany: vi.fn(() => { throw new Error('event append failed') }) },
      now: () => 600,
    })).toThrow('event append failed')

    expect(sheets.getByRef('pokemon', 'pika')?.revision).toBe(1)
    expect(sheets.getByRef('trainer', 'brock')?.revision).toBe(3)
  })

  it('publishes after commit, keeps success when publication fails, and continues later publications', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const published: PersistedRealtimeEvent[] = []
    const report = vi.fn()
    sheets.saveSetupSheet('pokemon', 'pika', changedPokemon())

    const result = advanceCampaignDayUseCase({}, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 700,
      publishPersistedRealtimeEvent: (event) => {
        expect(sheets.getByRef('pokemon', 'pika')?.revision).toBe(2)
        if (event.sequence === 1) throw new Error('subscriber down')
        published.push(event)
      },
      reportAfterCommitPublicationFailure: report,
    })

    expect(result.ok).toBe(true)
    expect(sheets.getByRef('pokemon', 'pika')?.revision).toBe(2)
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ sequence: 1, operation: 'campaign-next-day' }))
    expect(published.map((event) => event.sequence)).toEqual([2])
  })

  it('does nothing durable for a no-op campaign day', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const publish = vi.fn()

    const result = advanceCampaignDayUseCase({}, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      publishPersistedRealtimeEvent: publish,
    })

    expect(result).toMatchObject({ ok: true, totalSheets: 0, updatedSheets: 0 })
    expect(result.realtimeEvents).toEqual([])
    expect(result.paths).toEqual([])
    expect(publish).not.toHaveBeenCalled()
    expect(realtime.readAfter({ afterSequence: 0 }).events).toEqual([])
  })
})
