import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { JUICER_BERRY_ELAPSED_MS } from '#shared/capabilityAutomation/campaignState'
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

  it('converts the exact held Berry at 24 elapsed hours, detaches shell juice, and matures it after 14 further days', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'shuckle', {
      slug: 'shuckle', nickname: 'Shuckle', species: 'Shuckle', level: 20, revision: 1,
      items: { held: 'Oran Berry' },
    })
    const dependencies = {
      database, sheetRepository: sheets, realtimeEventRepository: realtime,
      publishPersistedRealtimeEvent: () => {},
    }
    const day = 24 * 60 * 60_000
    advanceCampaignDayUseCase({}, { ...dependencies, now: () => 1_000 })
    let current = sheets.getByRef('pokemon', 'shuckle')?.sheet as Record<string, unknown>
    expect(current.items).toEqual({ held: 'Oran Berry' })
    expect(current.capabilityCampaignState).toMatchObject({
      storedItems: [{
        canonicalItemId: 'oran-berry', stage: 'berry', remainingDayAdvances: 1,
        custodyStartedAt: 1_000, custodyFingerprint: expect.stringMatching(/^juicer-custody:/),
      }],
    })
    advanceCampaignDayUseCase({}, { ...dependencies, now: () => 1_000 + day - 1 })
    current = sheets.getByRef('pokemon', 'shuckle')?.sheet as Record<string, unknown>
    expect(current.items).toEqual({ held: 'Oran Berry' })
    expect(current.capabilityCampaignState).toMatchObject({
      storedItems: [{ canonicalItemId: 'oran-berry', stage: 'berry' }],
    })
    advanceCampaignDayUseCase({}, { ...dependencies, now: () => 1_000 + day })
    current = sheets.getByRef('pokemon', 'shuckle')?.sheet as Record<string, unknown>
    expect(current.items).toEqual({ held: '' })
    expect(current.capabilityCampaignState).toMatchObject({
      storedItems: [{ canonicalItemId: 'shuckles-berry-juice', stage: 'berry-juice', remainingDayAdvances: 14 }],
    })
    const shellId = ((current.capabilityCampaignState as CharacterSheet['capabilityCampaignState'])?.storedItems[0])?.id
    const currentRevision = current.revision as number
    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'shuckle', expectedRevision: currentRevision,
      nextSheet: { ...current, items: { held: 'Potion' }, updatedAt: 1_000 + day + 1 },
      sourceOperationId: 'equip-potion-after-juice',
    })).toBe('applied')
    current = sheets.getByRef('pokemon', 'shuckle')?.sheet as Record<string, unknown>
    expect(current.items).toEqual({ held: 'Potion' })
    expect((current.capabilityCampaignState as CharacterSheet['capabilityCampaignState'])?.storedItems[0]?.id).toBe(shellId)

    advanceCampaignDayUseCase({}, { ...dependencies, now: () => 1_000 + 15 * day })
    current = sheets.getByRef('pokemon', 'shuckle')?.sheet as Record<string, unknown>
    expect(current.items).toEqual({ held: 'Potion' })
    expect(current.capabilityCampaignState).toMatchObject({
      storedItems: [{ canonicalItemId: 'rare-candy', stage: 'rare-candy', remainingDayAdvances: 0, id: shellId }],
    })
  })

  it('enrolls and resets Juicer custody at authoritative held-item persistence mutations', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('pokemon', 'shuckle', {
      slug: 'shuckle', nickname: 'Shuckle', species: 'Shuckle', level: 20, revision: 1,
      items: { held: 'Oran Berry' },
    })
    const first = sheets.getByRef('pokemon', 'shuckle')!
    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'shuckle', expectedRevision: first.revision,
      nextSheet: { ...first.sheet, combat: { currentHp: 10 }, updatedAt: 100 },
      sourceOperationId: 'authoritative-first-observation',
    })).toBe('applied')
    const enrolled = sheets.getByRef('pokemon', 'shuckle')!
    const firstCustody = (enrolled.sheet as unknown as CharacterSheet).capabilityCampaignState?.storedItems[0]
    expect(firstCustody).toMatchObject({ canonicalItemId: 'oran-berry', custodyStartedAt: 100 })

    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'shuckle', expectedRevision: enrolled.revision,
      nextSheet: { ...enrolled.sheet, items: { held: '' }, updatedAt: 200 },
      sourceOperationId: 'authoritative-remove-oran',
    })).toBe('applied')
    const removed = sheets.getByRef('pokemon', 'shuckle')!
    expect((removed.sheet as unknown as CharacterSheet).capabilityCampaignState?.storedItems ?? []).toEqual([])

    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'shuckle', expectedRevision: removed.revision,
      nextSheet: { ...removed.sheet, items: { held: 'Oran Berry' }, updatedAt: 300 },
      sourceOperationId: 'authoritative-same-name-replacement',
    })).toBe('applied')
    const replacement = (sheets.getByRef('pokemon', 'shuckle')!.sheet as unknown as CharacterSheet)
      .capabilityCampaignState?.storedItems[0]
    expect(replacement).toMatchObject({ canonicalItemId: 'oran-berry', custodyStartedAt: 300 })
    expect(replacement?.custodyFingerprint).not.toBe(firstCustody?.custodyFingerprint)
  })

  it('materializes Juicer at the exact elapsed boundary on an unrelated authoritative persistence', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('pokemon', 'shuckle', {
      slug: 'shuckle', nickname: 'Shuckle', species: 'Shuckle', level: 20, revision: 1,
      items: { held: 'Oran Berry' },
    })
    const initial = sheets.getByRef('pokemon', 'shuckle')!
    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'shuckle', expectedRevision: initial.revision,
      nextSheet: { ...initial.sheet, updatedAt: 100 }, sourceOperationId: 'observe-held-berry',
    })).toBe('applied')
    const enrolled = sheets.getByRef('pokemon', 'shuckle')!
    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'shuckle', expectedRevision: enrolled.revision,
      nextSheet: { ...enrolled.sheet, combat: { currentHp: 9 }, updatedAt: 100 + JUICER_BERRY_ELAPSED_MS - 1 },
      sourceOperationId: 'before-boundary',
    })).toBe('applied')
    const before = sheets.getByRef('pokemon', 'shuckle')!
    expect((before.sheet as unknown as CharacterSheet).items?.held).toBe('Oran Berry')
    expect((before.sheet as unknown as CharacterSheet).capabilityCampaignState?.storedItems[0])
      .toMatchObject({ stage: 'berry', canonicalItemId: 'oran-berry' })

    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'shuckle', expectedRevision: before.revision,
      nextSheet: { ...before.sheet, combat: { currentHp: 10 }, updatedAt: 100 + JUICER_BERRY_ELAPSED_MS },
      sourceOperationId: 'exact-boundary',
    })).toBe('applied')
    const after = sheets.getByRef('pokemon', 'shuckle')!
    expect((after.sheet as unknown as CharacterSheet).items?.held).toBe('')
    expect((after.sheet as unknown as CharacterSheet).capabilityCampaignState?.storedItems[0])
      .toMatchObject({ stage: 'berry-juice', canonicalItemId: 'shuckles-berry-juice' })
  })

  it('cancels Juicer conversion authority when the exact held item leaves custody', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'shuckle', {
      slug: 'shuckle', nickname: 'Shuckle', species: 'Shuckle', level: 20, revision: 1,
      items: { held: 'Potion' },
      capabilityCampaignState: {
        schemaVersion: 1,
        storedItems: [{
          id: 'stored-berry', kind: 'juicer', canonicalItemId: 'Oran Berry', stage: 'berry',
          storedAt: 100, remainingDayAdvances: 1, sourceOperationId: 'store-berry',
        }],
        planter: null,
        letterPress: null,
      },
    })
    advanceCampaignDayUseCase({}, {
      database, sheetRepository: sheets, realtimeEventRepository: realtime, now: () => 1_000,
      publishPersistedRealtimeEvent: () => {},
    })
    const current = sheets.getByRef('pokemon', 'shuckle')?.sheet as Record<string, unknown>
    expect(current.items).toEqual({ held: 'Potion' })
    expect(current).not.toHaveProperty('capabilityCampaignState')
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
