import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlayerProfile } from '#shared/playerProfiles'
import { parseItemExplorationState } from '#shared/itemAutomation/exploration'
import type { TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteCampaignClockRepository } from '../../server/storage/campaignClockRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { startItemRouteLure } from '../../server/domain/itemAutomation/exploration'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import { redactRealtimeEventForPrincipal } from '../../server/realtime/realtimeEventRedaction'
import { executeItemExplorationOperationUseCase } from '../../server/useCases/executeItemExplorationOperation'
import { loadItemExplorationUseCase } from '../../server/useCases/loadItemExploration'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })
const profile = (): PlayerProfile => ({
  schemaVersion: 1, id: 'profile_explorer01', displayName: 'Explorer',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'explorer' }],
})

describe('P8-057 exploration multi-client certification', () => {
  it('converges exact replay, stale rejection, realtime redaction, and reconnect projection without rerolls', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    databases.push(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 500 })
    const route = startItemRouteLure({
      current: null,
      definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Bait'),
      sourceOperationId: 'item-source-operation:00000001',
      sourceInstanceId: 'item-instance:trainer:explorer:foodStuff:bait-row',
      campaignMinute: 100,
    })
    const trainer: TrainerSheet = {
      slug: 'explorer', name: 'Explorer', level: 10, revision: 3,
      inventory: { foodStuff: [] },
      serverPrivate: { itemExploration: route.state },
    }
    sheets.save({
      kind: 'trainer', slug: 'explorer', revision: 3, updatedAt: 10,
      document: trainer as unknown as Record<string, unknown>,
    })
    database.connection.prepare('UPDATE campaign_clock SET campaign_minute = 115 WHERE singleton = 1').run()
    const clock = createSqliteCampaignClockRepository(database).get()
    const command = {
      schemaVersion: 1 as const,
      operationId: 'item-exploration:v1:11111111111111111111111111111111',
      kind: 'resolve-route-lure-check' as const,
      trainerSlug: 'explorer', trainerRevision: 3, campaignClockRevision: clock.revision,
      activityId: route.activity.activityId,
    }
    const rollDie = vi.fn(() => 15)
    const first = executeItemExplorationOperationUseCase({
      role: 'player', playerProfile: profile(), command, clientId: 'client-a',
    }, { database, realtimeEventRepository: realtime, rollDie, now: () => 500 })
    expect(first).toMatchObject({ exactReplay: false, trainerRevision: 4, activity: { status: 'awaiting-encounter' } })
    expect(rollDie).toHaveBeenCalledOnce()
    const firstEvents = realtime.readAfter({ afterSequence: 0, limit: 20 }).events
    expect(firstEvents).toHaveLength(2)

    const replay = executeItemExplorationOperationUseCase({
      role: 'player', playerProfile: profile(), command, clientId: 'client-b',
    }, { database, realtimeEventRepository: realtime, rollDie: () => { throw new Error('exact replay rerolled') } })
    expect(replay).toMatchObject({ exactReplay: true, trainerRevision: 4 })
    expect(realtime.readAfter({ afterSequence: 0, limit: 20 }).events).toHaveLength(firstEvents.length)

    expect(() => executeItemExplorationOperationUseCase({
      role: 'player', playerProfile: profile(),
      command: { ...command, operationId: 'item-exploration:v1:22222222222222222222222222222222' },
      clientId: 'client-b',
    }, { database, realtimeEventRepository: realtime })).toThrow('Trainer sheet changed')

    const reconnect = loadItemExplorationUseCase({
      kind: 'trainer', role: 'player', playerProfile: profile(), trainerSlug: 'explorer',
    }, { database, now: () => 501 })
    expect(reconnect).toMatchObject({
      trainerRevision: 4,
      projection: { routeLures: [{ status: 'awaiting-encounter', attemptsResolved: 1, needsGmEncounter: true }] },
    })
    const safeReconnectJson = JSON.stringify(reconnect)
    expect(safeReconnectJson).not.toContain('sourceOperationId')
    expect(safeReconnectJson).not.toContain('sourceInstanceId')
    expect(safeReconnectJson).not.toContain('canonicalDefinitionSha256')
    expect(safeReconnectJson).not.toContain('"roll"')

    for (const event of firstEvents) {
      const delivered = redactRealtimeEventForPrincipal(event.event, { role: 'player', playerProfile: profile() })
      const json = JSON.stringify(delivered)
      expect(json).not.toContain('itemExploration')
      expect(json).not.toContain('sourceOperationId')
      expect(json).not.toContain('sourceInstanceId')
      expect(json).not.toContain('canonicalDefinitionSha256')
      expect(json).not.toContain('"roll"')
    }

    const acceptedSheet = sheets.getByRef('trainer', 'explorer')!.sheet as unknown as TrainerSheet
    expect(parseItemExplorationState(acceptedSheet.serverPrivate?.itemExploration).routeLures[0]!.attempts).toHaveLength(1)
  })
})
