import { afterEach, describe, expect, it } from 'vitest'
import { parseCampaignDayOperationAcceptedV1, parseCampaignDayOperationCommandV1 } from '#shared/campaignDay'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import {
  CampaignDayOperationCollisionError,
  campaignDayOperationCommandSha256,
  createSqliteCampaignDayOperationRepository,
} from '../../server/storage/campaignDayOperationRepository'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
})

const command = () => parseCampaignDayOperationCommandV1({
  schemaVersion: 1,
  operationId: 'campaign-day:v1:11111111111111111111111111111111',
  kind: 'advance-one-day',
  days: 1,
})
const result = () => {
  const value = command()
  return parseCampaignDayOperationAcceptedV1({
    schemaVersion: 1,
    operationId: value.operationId,
    commandSha256: campaignDayOperationCommandSha256(value),
    ok: true,
    totalSheets: 0,
    updatedSheets: 0,
    pokemonSheets: 0,
    trainerSheets: 0,
    pokemonUpdated: 0,
    trainerUpdated: 0,
    hitPointsRestored: 0,
    injuriesHealed: 0,
    dailyMoveUsesCleared: 0,
    dailyMoveEntriesCleared: 0,
    conditionsCleared: 0,
    trainerApRestored: 0,
    campaignClock: {
      previousRevision: 0,
      revision: 1,
      previousCampaignMinute: 0,
      campaignMinute: 1_440,
      minutesAdvanced: 1_440,
      clockOperationId: 'breeding-operation:v1:22222222222222222222222222222222',
      reconciledEggs: 0,
      creditedEggCampaignMinutes: 0,
      skippedPausedEggCampaignMinutes: 0,
      eggBatchComplete: true,
    },
    expiredEffects: [],
  })
}

describe('campaign-day operation repository', () => {
  it('stores one immutable accepted command/result binding inside its caller transaction', () => {
    const database = open()
    const repository = createSqliteCampaignDayOperationRepository(database)
    expect(() => repository.insertAccepted({ command: command(), result: result(), createdAt: 100 }))
      .toThrow('requires a caller-owned SQLite transaction')

    const inserted = database.withTransaction(() => repository.insertAccepted({
      command: command(), result: result(), createdAt: 100,
    }))
    expect(inserted).toEqual(repository.get(command().operationId))
    expect(inserted).toMatchObject({
      operationId: command().operationId,
      commandSha256: campaignDayOperationCommandSha256(command()),
      createdAt: 100,
    })
    expect(Object.isFrozen(inserted)).toBe(true)

    const replay = database.withTransaction(() => repository.insertAccepted({
      command: command(), result: result(), createdAt: 100,
    }))
    expect(replay).toEqual(inserted)
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM campaign_day_operations').get())
      .toEqual({ count: 1 })
  })

  it('rejects mismatched insertion and detects corrupted immutable rows', () => {
    const database = open()
    const repository = createSqliteCampaignDayOperationRepository(database)
    const accepted = result()
    expect(() => database.withTransaction(() => repository.insertAccepted({
      command: command(),
      result: { ...accepted, commandSha256: 'f'.repeat(64) },
      createdAt: 100,
    }))).toThrow('result must bind its exact immutable command')

    database.withTransaction(() => repository.insertAccepted({
      command: command(), result: accepted, createdAt: 100,
    }))
    database.connection.prepare(`
      UPDATE campaign_day_operations SET command_sha256 = ? WHERE operation_id = ?
    `).run('f'.repeat(64), command().operationId)
    expect(() => repository.get(command().operationId)).toThrow('failed immutable command/result binding')
  })

  it('raises a collision when an existing row is not the exact accepted evidence', () => {
    const database = open()
    const repository = createSqliteCampaignDayOperationRepository(database)
    database.withTransaction(() => repository.insertAccepted({
      command: command(), result: result(), createdAt: 100,
    }))
    const altered = parseCampaignDayOperationAcceptedV1({
      ...result(),
      trainerApRestored: 1,
    })
    expect(() => database.withTransaction(() => repository.insertAccepted({
      command: command(), result: altered, createdAt: 100,
    }))).toThrow(CampaignDayOperationCollisionError)
  })
})
