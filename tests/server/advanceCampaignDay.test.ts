import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
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

describe('advanceCampaignDayUseCase', () => {
  it('advances pokemon and trainer sheets in SQLite and emits sheet update events', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('pokemon', 'pika', {
      slug: 'pika',
      nickname: 'Pika',
      species: '',
      level: 5,
      combat: { currentHp: 1, injuries: 2, injuriesHealedToday: 2, conditions: ['Burned'] },
      moveUsage: { daily: { thunderbolt: { moveName: 'Thunderbolt', uses: 1 } } },
      revision: 1,
    })
    sheets.saveSetupSheet('trainer', 'brock', {
      slug: 'brock',
      name: 'Brock',
      level: 3,
      currentHp: 1,
      currentInjuries: 1,
      injuriesHealedToday: 1,
      conditions: ['Poisoned'],
      ap: { spent: 2 },
      revision: 3,
    })

    const result = advanceCampaignDayUseCase({ clientId: 'client-1' }, { sheetRepository: sheets, now: () => 500 })

    expect(result).toMatchObject({ ok: true, totalSheets: 2, updatedSheets: 2, pokemonUpdated: 1, trainerUpdated: 1 })
    expect(sheets.getByRef('pokemon', 'pika')?.revision).toBe(2)
    expect(sheets.getByRef('trainer', 'brock')?.revision).toBe(4)
    expect(result.events.map((event) => event.channel)).toEqual([
      'sheet:pokemon:pika',
      'sheets',
      'sheet:trainer:brock',
      'sheets',
    ])
    expect(result.paths).toEqual(['data/sheets/pika.json', 'data/trainers/brock.json'])
  })
})
