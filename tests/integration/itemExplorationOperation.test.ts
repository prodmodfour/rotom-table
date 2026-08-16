import { afterEach, describe, expect, it, vi } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteCampaignClockRepository } from '../../server/storage/campaignClockRepository'
import { createSqliteItemExplorationOperationRepository } from '../../server/storage/itemExplorationOperationRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { executeItemExplorationOperationUseCase } from '../../server/useCases/executeItemExplorationOperation'
import { loadItemExplorationUseCase } from '../../server/useCases/loadItemExploration'
import { startItemRouteLure } from '../../server/domain/itemAutomation/exploration'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import {
  ITEM_REPEL_NEXT_TURN_SHIFT_FLAG_ID,
  parseItemExplorationEncounterState,
  parseItemExplorationState,
  type ItemExplorationOperationCommandV1,
} from '#shared/itemAutomation/exploration'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => { while (databases.length) databases.pop()!.close() })

const operationId = (value: number): string => `item-exploration:v1:${value.toString(16).padStart(32, '0')}`
const sourceOperationId = (value: number): string => `item-source-operation:${String(value).padStart(8, '0')}`
const profile = (): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_explorer01',
  displayName: 'Explorer',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'explorer' }],
})
const trainer = (canonicalId: 'Bait' | 'Fishing Lure' = 'Bait'): TrainerSheet => {
  const sourceInstanceId = `item-instance:trainer:explorer:foodStuff:${canonicalId === 'Bait' ? 'bait-row' : 'lure-row'}`
  const route = startItemRouteLure({
    current: null,
    definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require(canonicalId),
    sourceOperationId: sourceOperationId(canonicalId === 'Bait' ? 1 : 2),
    sourceInstanceId,
    campaignMinute: 100,
  })
  return {
    slug: 'explorer', name: 'Explorer', level: 10, revision: 3,
    capabilities: { overland: 5 },
    inventory: {
      foodStuff: [{ id: canonicalId === 'Bait' ? 'bait-row' : 'lure-row', name: canonicalId, qty: 1 }],
    },
    serverPrivate: { itemExploration: route.state },
  }
}
const wild = (): CharacterSheet => ({
  slug: 'wild-rattata', nickname: 'Wild Rattata', species: 'Rattata', level: 5, revision: 2,
  capabilities: { overland: 4, swim: 0, sky: 0, levitate: 0 },
})
const map = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'route-map', name: 'Route Map', revision: 7,
  dimensions: { x: 10, y: 3, z: 5 }, groundLevelY: 0,
  voxels: [], createdAt: 1, updatedAt: 10,
  placements: [
    { id: 'explorer-placement', sheetKind: 'trainer', sheetSlug: 'explorer', position: { x: 1, y: 0, z: 1 } },
    { id: 'wild-placement', sheetKind: 'pokemon', sheetSlug: 'wild-rattata', position: { x: 2, y: 0, z: 1 } },
  ],
  encounterState: createEmptyEncounterState(),
  initiative: { activeId: 'explorer-placement', round: 1 },
})

const seedTrainer = (database: RotomDatabase, sheet = trainer()): void => {
  createSqliteSheetRepository<Record<string, unknown>>(database).save({
    kind: 'trainer', slug: sheet.slug,
    document: sheet as unknown as Record<string, unknown>, revision: 3, updatedAt: 10,
  })
  database.connection.prepare(`UPDATE campaign_clock SET campaign_minute = 115 WHERE singleton = 1`).run()
}
const seedMap = (database: RotomDatabase): void => {
  createSqliteMapRepository<TabletopMap>(database).save({ slug: 'route-map', document: map(), revision: 7, updatedAt: 10 })
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const actor = { ...trainer(), serverPrivate: undefined }
  sheets.save({ kind: 'trainer', slug: actor.slug, document: actor as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
  sheets.save({ kind: 'pokemon', slug: 'wild-rattata', document: wild() as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
}

const activeActivityId = (database: RotomDatabase): string => {
  const stored = createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', 'explorer')!
  return parseItemExplorationState((stored.sheet as unknown as TrainerSheet).serverPrivate?.itemExploration).routeLures[0]!.activityId
}

const resolveCommand = (database: RotomDatabase, value = 1): ItemExplorationOperationCommandV1 => ({
  schemaVersion: 1,
  operationId: operationId(value),
  kind: 'resolve-route-lure-check',
  trainerSlug: 'explorer',
  trainerRevision: createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', 'explorer')!.revision,
  campaignClockRevision: createSqliteCampaignClockRepository(database).get().revision,
  activityId: activeActivityId(database),
})

describe('P8-057 exploration operation integration', () => {
  it('commits one server-owned route check with exact replay and private durable evidence', () => {
    const database = open()
    seedTrainer(database)
    const command = resolveCommand(database)
    const rollDie = vi.fn(() => 15)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 500 })
    const first = executeItemExplorationOperationUseCase({
      role: 'player', playerProfile: profile(), command, clientId: 'client-explorer',
    }, { database, rollDie, now: () => 500, realtimeEventRepository: realtime })

    expect(first).toMatchObject({
      operationId: command.operationId, kind: 'resolve-route-lure-check', exactReplay: false,
      trainerSlug: 'explorer', trainerRevision: 4,
      activity: { status: 'awaiting-encounter', attemptsResolved: 1, needsGmEncounter: true },
    })
    expect(rollDie).toHaveBeenCalledOnce()
    const state = parseItemExplorationState(
      (createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', 'explorer')!.sheet as unknown as TrainerSheet)
        .serverPrivate?.itemExploration,
    )
    expect(state.routeLures[0]!.attempts[0]).toMatchObject({ roll: 15, success: true, resolvedAtCampaignMinute: 115 })
    const stored = createSqliteItemExplorationOperationRepository(database).find(command.operationId)
    expect(stored).toMatchObject({
      principalKey: `player:${profile().id}`,
      evidence: { kind: 'route-lure-check', roll: 15, success: true, campaignClockRevision: 0 },
    })
    expect(realtime.readAfter({ afterSequence: 0, limit: 20 }).events.map(event => event.event.channel))
      .toEqual(['sheet:trainer:explorer', 'sheets'])

    const replay = executeItemExplorationOperationUseCase({
      role: 'player', playerProfile: profile(), command,
    }, { database, rollDie: () => { throw new Error('replay rerolled') } })
    expect(replay).toMatchObject({ exactReplay: true, trainerRevision: 4 })
    expect(() => executeItemExplorationOperationUseCase({
      role: 'gm', command,
    }, { database })).toThrow('different principal')
    expect(() => executeItemExplorationOperationUseCase({
      role: 'player', playerProfile: profile(), command: { ...command, campaignClockRevision: 1 },
    }, { database })).toThrow('reused with changed input')
  })

  it('allows owner cancellation but reserves encounter settlement and reusable lure loss to the GM', () => {
    const database = open()
    seedTrainer(database)
    const first = executeItemExplorationOperationUseCase({
      role: 'player', playerProfile: profile(), command: resolveCommand(database, 2),
    }, { database, rollDie: () => 20, now: () => 500 })
    const playerEncounterCommand: ItemExplorationOperationCommandV1 = {
      schemaVersion: 1, operationId: operationId(3), kind: 'settle-route-lure',
      trainerSlug: 'explorer', trainerRevision: first.trainerRevision!, campaignClockRevision: 0,
      activityId: first.activity!.activityId, outcome: 'encounter-introduced',
      encounterSelection: { referenceId: 'route-encounter:00000001', comparablePartyLevelConfirmed: true },
    }
    expect(() => executeItemExplorationOperationUseCase({
      role: 'player', playerProfile: profile(), command: playerEncounterCommand,
    }, { database })).toThrow('Only a GM')

    const accepted = executeItemExplorationOperationUseCase({ role: 'gm', command: playerEncounterCommand }, { database, now: () => 501 })
    expect(accepted.activity).toMatchObject({ status: 'completed', outcome: 'encounter-introduced' })
    expect((createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', 'explorer')!.sheet as unknown as TrainerSheet)
      .inventory?.foodStuff).toEqual([{ id: 'bait-row', name: 'Bait', qty: 1 }])
  })

  it('removes exactly one Fishing Lure only under explicit GM loss adjudication and releases custody', () => {
    const database = open()
    seedTrainer(database, trainer('Fishing Lure'))
    const command: ItemExplorationOperationCommandV1 = {
      schemaVersion: 1, operationId: operationId(4), kind: 'settle-route-lure',
      trainerSlug: 'explorer', trainerRevision: 3, campaignClockRevision: 0,
      activityId: activeActivityId(database), outcome: 'lure-lost', encounterSelection: null,
    }
    expect(() => executeItemExplorationOperationUseCase({
      role: 'player', playerProfile: profile(), command,
    }, { database })).toThrow('Only a GM')
    const result = executeItemExplorationOperationUseCase({ role: 'gm', command }, { database, now: () => 502 })
    expect(result.activity).toMatchObject({ status: 'cancelled', outcome: 'lure-lost', reusable: true })
    const sheet = createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', 'explorer')!.sheet as unknown as TrainerSheet
    expect(sheet.inventory?.foodStuff).toEqual([])
    expect(parseItemExplorationState(sheet.serverPrivate?.itemExploration).routeLures[0]!.outcome).toBe('lure-lost')
  })

  it('projects GM-only direct positioning, validates standard Shift movement, and schedules one next-turn forfeiture', () => {
    const database = open()
    seedMap(database)
    const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Repel')
    const sourceMap = createSqliteMapRepository<TabletopMap>(database).getBySlug('route-map')!
    sourceMap.encounterState = parseEncounterState({
      ...sourceMap.encounterState,
      itemExploration: {
        schemaVersion: 1,
        repelPositioning: [{
          decisionId: 'item-repel-position:v1:00000000000000000000000000000001',
          sourceOperationId: sourceOperationId(10),
          canonicalItemId: 'Repel',
          canonicalDefinitionSha256: definition.definitionSha256,
          sourceInstanceId: 'item-instance:trainer:explorer:medicalKit:repel-row',
          sourcePlacementId: 'explorer-placement',
          targetPlacementId: 'wild-placement',
          maximumAffectedWildLevel: 15,
          accuracy: { naturalRoll: 20, userAccuracy: 0, targetSpeedEvasion: 0, accuracyCheck: 6, hit: true },
          status: 'pending-position',
        }],
      },
    })
    createSqliteMapRepository<TabletopMap>(database).save({
      slug: sourceMap.slug, document: sourceMap, revision: 7, updatedAt: 10,
    })

    expect(() => loadItemExplorationUseCase({ kind: 'map', role: 'player', mapSlug: 'route-map' }, { database }))
      .toThrow('Only a GM')
    const projection = loadItemExplorationUseCase({ kind: 'map', role: 'gm', mapSlug: 'route-map' }, { database })
    expect(projection).toMatchObject({
      kind: 'map', mapSlug: 'route-map', mapRevision: 7,
      repelPositioning: [{
        itemLabel: 'Repel', sourceLabel: 'Explorer', targetLabel: 'Wild Rattata',
        sourcePosition: { x: 1, y: 0, z: 1 }, targetPosition: { x: 2, y: 0, z: 1 },
        destinationBounds: { x: [0, 9], y: [0, 2], z: [0, 4] },
      }],
    })
    const decision = projection.kind === 'map' ? projection.repelPositioning[0]! : null
    const command: ItemExplorationOperationCommandV1 = {
      schemaVersion: 1, operationId: operationId(5), kind: 'settle-direct-repel',
      mapSlug: 'route-map', mapRevision: 7, decisionId: decision!.decisionId,
      destination: { x: 6, y: 0, z: 1 },
    }
    const result = executeItemExplorationOperationUseCase({ role: 'gm', command }, { database, now: () => 600 })
    expect(result).toMatchObject({ kind: 'settle-direct-repel', exactReplay: false, mapSlug: 'route-map', mapRevision: 8 })
    const mapAfter = createSqliteMapRepository<TabletopMap>(database).getBySlug('route-map')!
    expect(mapAfter.placements.find(row => row.id === 'wild-placement')?.position).toEqual({ x: 6, y: 0, z: 1 })
    const encounter = parseEncounterState(mapAfter.encounterState)
    expect(parseItemExplorationEncounterState(encounter.itemExploration).repelPositioning).toEqual([])
    expect(encounter.turnResources['wild-placement']?.oncePerTurnFlags).toContainEqual(expect.objectContaining({
      id: ITEM_REPEL_NEXT_TURN_SHIFT_FLAG_ID,
      sourceOperationId: command.operationId,
    }))
    const replay = executeItemExplorationOperationUseCase({ role: 'gm', command }, { database, now: () => 900 })
    expect(replay).toMatchObject({ exactReplay: true, mapRevision: 8 })
    expect(parseEncounterState(createSqliteMapRepository<TabletopMap>(database).getBySlug('route-map')!.encounterState)
      .turnResources['wild-placement']?.oncePerTurnFlags.filter(flag => flag.id === ITEM_REPEL_NEXT_TURN_SHIFT_FLAG_ID)).toHaveLength(1)
  })

  it('rejects stale, occupied, and over-speed direct Repel endpoints without consuming the decision', () => {
    const database = open()
    seedMap(database)
    const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Repel')
    const repository = createSqliteMapRepository<TabletopMap>(database)
    const sourceMap = repository.getBySlug('route-map')!
    sourceMap.placements.push({ id: 'blocker', sheetKind: 'trainer', sheetSlug: 'explorer', position: { x: 3, y: 0, z: 1 } })
    sourceMap.encounterState = parseEncounterState({
      ...sourceMap.encounterState,
      itemExploration: { schemaVersion: 1, repelPositioning: [{
        decisionId: 'item-repel-position:v1:00000000000000000000000000000002',
        sourceOperationId: sourceOperationId(11), canonicalItemId: 'Repel',
        canonicalDefinitionSha256: definition.definitionSha256,
        sourceInstanceId: 'item-instance:trainer:explorer:medicalKit:repel-row',
        sourcePlacementId: 'explorer-placement', targetPlacementId: 'wild-placement', maximumAffectedWildLevel: 15,
        accuracy: { naturalRoll: 20, userAccuracy: 0, targetSpeedEvasion: 0, accuracyCheck: 6, hit: true },
        status: 'pending-position',
      }] },
    })
    repository.save({ slug: sourceMap.slug, document: sourceMap, revision: 7, updatedAt: 10 })
    const base = {
      schemaVersion: 1 as const, kind: 'settle-direct-repel' as const,
      mapSlug: 'route-map', mapRevision: 7,
      decisionId: parseItemExplorationEncounterState(sourceMap.encounterState?.itemExploration).repelPositioning[0]!.decisionId,
    }
    expect(() => executeItemExplorationOperationUseCase({
      role: 'gm', command: { ...base, operationId: operationId(6), destination: { x: 3, y: 0, z: 1 } },
    }, { database })).toThrow(/unavailable|collision|occupied/i)
    expect(() => executeItemExplorationOperationUseCase({
      role: 'gm', command: { ...base, operationId: operationId(7), destination: { x: 9, y: 0, z: 1 } },
    }, { database })).toThrow(/cost|limit|unavailable/i)

    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const trainerBefore = sheets.getByRef('trainer', 'explorer')!
    sheets.save({
      kind: 'trainer', slug: 'explorer', revision: trainerBefore.revision + 1, updatedAt: 20,
      document: {
        ...(trainerBefore.sheet as unknown as TrainerSheet),
        revision: trainerBefore.revision + 1,
        currentTeam: ['wild-rattata'],
      } as unknown as Record<string, unknown>,
    })
    expect(() => executeItemExplorationOperationUseCase({
      role: 'gm', command: { ...base, operationId: operationId(8), destination: { x: 6, y: 0, z: 1 } },
    }, { database })).toThrow('no longer an unowned wild Pokémon')
    expect(parseItemExplorationEncounterState(repository.getBySlug('route-map')!.encounterState?.itemExploration).repelPositioning)
      .toHaveLength(1)
  })
})
