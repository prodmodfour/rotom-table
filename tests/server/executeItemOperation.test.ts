import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteCampaignClockRepository } from '../../server/storage/campaignClockRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteItemOperationRepository } from '../../server/storage/itemOperationRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { executeItemOperationUseCase } from '../../server/useCases/executeItemOperation'
import { buildEncounterPresentationProjection } from '../../server/domain/encounterPresentation/buildProjection'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import { createSqliteGroupInventoryRepository } from '../../server/storage/groupInventoryRepository'
import { applyCombatStagesToSheet } from '~/utils/sheetMutations'
import { ITEM_DIRE_HIT_CAPABILITY_ID } from '../../server/domain/itemAutomation/combatEffects'
import { activeEquipmentState } from '../fixtures/equipment'
import { attachEncounterItemCommandTemplate } from '../../server/domain/itemAutomation/commandTemplate'

const databases: RotomDatabase[] = []
const temporaryDirectories: string[] = []
const open = (path = ':memory:'): RotomDatabase => {
  const database = openRotomDatabase({ path })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length) databases.pop()!.close()
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })
})

const trainer = (): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 3,
  inventory: { medicalKit: [{ id: 'potion-row', name: 'Potion', qty: 2 }] },
})
const antidoteTrainer = (): TrainerSheet => ({
  ...trainer(),
  inventory: { medicalKit: [{ id: 'potion-row', name: 'Antidote', qty: 2 }] },
})
const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'pikachu', nickname: 'Pikachu', species: 'Pikachu', level: 5, revision: 2,
  stats: { hp: { added: 0 } }, combat: { currentHp: 7 },
  ...overrides,
})
const arena = (): TabletopMap => ({
  schemaVersion: 2, slug: 'arena', name: 'Arena', revision: 4,
  dimensions: { x: 5, y: 3, z: 5 }, voxels: [], createdAt: 1, updatedAt: 10,
  placements: [
    { id: 'ash-placement', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 1, y: 0, z: 1 } },
    { id: 'pikachu-placement', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 2, y: 0, z: 1 } },
  ],
  encounterState: {
    ...createEmptyEncounterState(),
    turnResources: { 'ash-placement': createEncounterTurnResourceLedger({ placementId: 'ash-placement', round: 1 }) },
  },
  initiative: { activeId: 'ash-placement', round: 1 },
})
const playerProfile = (): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_fixture01',
  displayName: 'Player',
  linkedCharacters: [
    { sheetKind: 'trainer', sheetSlug: 'ash' },
    { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
  ],
})
const projectedOfferId = (): string => buildEncounterPresentationProjection({
  role: 'gm', map: arena(), mapRevision: 4, pokemonSheets: [pokemon()], trainerSheets: [trainer()], generatedAt: 10,
}).offers.find(offer => offer.source.sourceKind === 'item' && offer.source.canonicalId === 'Potion')!.offerId

const command = (overrides: Partial<UseItemCommandV1> = {}): UseItemCommandV1 => ({
  schemaVersion: 1,
  operationId: 'op_item_execute_0001',
  context: 'encounter',
  offerId: projectedOfferId(),
  sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row',
  actorParticipantId: 'ash-placement',
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
  source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'potion-row', expectedRevision: 3 },
  targetIds: ['pikachu-placement'],
  choices: [{ choiceId: 'target', optionIds: ['pikachu-placement'] }],
  readSet: [
    { kind: 'map', id: 'arena', revision: 4 },
    { kind: 'encounter', id: 'arena', revision: 4 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
  ],
  ...overrides,
})

const seed = (database: RotomDatabase): void => {
  createSqliteMapRepository<TabletopMap>(database).save({ slug: 'arena', document: arena(), revision: 4, updatedAt: 10 })
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({ kind: 'trainer', slug: 'ash', document: trainer() as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
  sheets.save({ kind: 'pokemon', slug: 'pikachu', document: pokemon() as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
}
const readTrainer = (database: RotomDatabase): TrainerSheet => createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet
const readPokemon = (database: RotomDatabase): CharacterSheet => createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('pokemon', 'pikachu')!.sheet as unknown as CharacterSheet
const readMap = (database: RotomDatabase): TabletopMap => createSqliteMapRepository<TabletopMap>(database).get('arena')!.document

describe('authoritative item operation use case', () => {
  it('atomically consumes, heals, spends the Standard Action, journals, and publishes durable updates', () => {
    const database = open()
    seed(database)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 100 })
    const published: number[] = []
    const response = executeItemOperationUseCase({
      role: 'player', playerProfile: playerProfile(), command: command(), clientId: 'client-item',
    }, {
      database, realtimeEventRepository: realtime, now: () => 100,
      publishPersistedRealtimeEvent: event => published.push(event.sequence),
    })
    expect(response.result).toMatchObject({ status: 'accepted', canonicalItemId: 'Potion', exactReplay: false })
    expect(readTrainer(database).inventory?.medicalKit).toEqual([{ id: 'potion-row', name: 'Potion', qty: 1 }])
    expect(readPokemon(database).combat?.currentHp).toBe(27)
    expect(readMap(database).encounterState?.turnResources['ash-placement']?.actions.standard.spent).toBe(1)
    expect(createSqliteItemOperationRepository({ database }).get(command().operationId)).toMatchObject({ status: 'accepted' })
    const events = realtime.readAfter({ afterSequence: 0, limit: 20 }).events
    expect(events.map(event => event.event.channel)).toEqual([
      'map:arena', 'maps', 'sheet:pokemon:pikachu', 'sheets', 'sheet:trainer:ash', 'sheets',
    ])
    expect(published).toEqual(events.map(event => event.sequence))
  })

  it('atomically stores a Snack, consumes once, publishes sheet updates, and exact-replays', () => {
    const database = open()
    seed(database)
    const trainerSheet = trainer()
    trainerSheet.inventory = { foodStuff: [{ id: 'snack-row', name: 'Leftovers', qty: 1 }] }
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({ kind: 'trainer', slug: 'ash', document: trainerSheet as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
    const offerId = buildEncounterPresentationProjection({
      role: 'gm', map: arena(), mapRevision: 4, pokemonSheets: [pokemon()], trainerSheets: [trainerSheet], generatedAt: 10,
    }).offers.find(offer => offer.source.sourceKind === 'item' && offer.source.canonicalId === 'Leftovers')!.offerId
    const snackCommand = command({
      operationId: 'op_item_snack_execute_01', offerId,
      sourceInstanceId: 'item-instance:trainer:ash:foodStuff:snack-row',
      source: { kind: 'trainer', slug: 'ash', section: 'foodStuff', rowId: 'snack-row', expectedRevision: 3 },
    })
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 100 })
    const first = executeItemOperationUseCase({ role: 'gm', command: snackCommand }, {
      database, realtimeEventRepository: realtime, now: () => 100,
    })
    expect(first.result).toMatchObject({ status: 'accepted', canonicalItemId: 'Leftovers', exactReplay: false })
    expect(readTrainer(database).inventory?.foodStuff).toEqual([])
    expect(readPokemon(database).items?.digestionFood).toBe('Leftovers')
    expect(realtime.readAfter({ afterSequence: 0, limit: 20 }).events.map(event => event.event.channel)).toEqual([
      'map:arena', 'maps', 'sheet:pokemon:pikachu', 'sheets', 'sheet:trainer:ash', 'sheets',
    ])
    const replay = executeItemOperationUseCase({ role: 'gm', command: snackCommand }, { database, now: () => 200 })
    expect(replay.result).toMatchObject({ status: 'accepted', exactReplay: true })
    expect(readPokemon(database).items?.digestionFood).toBe('Leftovers')
  })

  it('stores reviewed Black Sludge only for a Poison target, consumes atomically, and exact-replays', () => {
    const database = open()
    const sourceTrainer = trainer()
    sourceTrainer.inventory = { foodStuff: [{ id: 'black-sludge-row', name: 'Black Sludge', qty: 1 }] }
    const poisonTarget = pokemon({ species: 'Grimer', types: ['Poison'] })
    const maps = createSqliteMapRepository<TabletopMap>(database)
    maps.save({ slug: 'arena', document: arena(), revision: 4, updatedAt: 10 })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({ kind: 'trainer', slug: 'ash', document: sourceTrainer as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
    sheets.save({ kind: 'pokemon', slug: 'pikachu', document: poisonTarget as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
    const offerId = buildEncounterPresentationProjection({
      role: 'gm', map: arena(), mapRevision: 4, pokemonSheets: [poisonTarget],
      trainerSheets: [sourceTrainer], generatedAt: 10,
    }).offers.find(offer => offer.source.canonicalId === 'Black Sludge')!.offerId
    const blackSludgeCommand = command({
      operationId: 'op_item_black_sludge_001', offerId,
      sourceInstanceId: 'item-instance:trainer:ash:foodStuff:black-sludge-row',
      source: {
        kind: 'trainer', slug: 'ash', section: 'foodStuff',
        rowId: 'black-sludge-row', expectedRevision: 3,
      },
    })
    const first = executeItemOperationUseCase({ role: 'gm', command: blackSludgeCommand }, {
      database, now: () => 100,
    })
    expect(first.result).toMatchObject({ status: 'accepted', canonicalItemId: 'Black Sludge', exactReplay: false })
    expect(readTrainer(database).inventory?.foodStuff).toEqual([])
    expect(readPokemon(database).items?.digestionFood).toBe('Black Sludge')
    expect(executeItemOperationUseCase({ role: 'gm', command: blackSludgeCommand }, {
      database, now: () => 200,
    }).result.exactReplay).toBe(true)
    expect(readPokemon(database).items?.digestionFood).toBe('Black Sludge')

    const blockedDatabase = open()
    seed(blockedDatabase)
    const blockedTrainer = trainer()
    blockedTrainer.inventory = { foodStuff: [{ id: 'black-sludge-row', name: 'Black Sludge', qty: 1 }] }
    createSqliteSheetRepository<Record<string, unknown>>(blockedDatabase).save({
      kind: 'trainer', slug: 'ash', document: blockedTrainer as unknown as Record<string, unknown>, revision: 3, updatedAt: 10,
    })
    const blockedProjection = buildEncounterPresentationProjection({
      role: 'gm', map: arena(), mapRevision: 4, pokemonSheets: [pokemon()],
      trainerSheets: [blockedTrainer], generatedAt: 10,
    })
    const blockedOffer = blockedProjection.offers.find(offer => offer.source.canonicalId === 'Black Sludge')!
    expect(blockedOffer.availability).toMatchObject({
      status: 'unavailable',
      reasons: [expect.objectContaining({ code: 'target.invalid' })],
    })
    const blockedCommand = command({
      operationId: 'op_item_black_sludge_002', offerId: blockedOffer.offerId,
      sourceInstanceId: 'item-instance:trainer:ash:foodStuff:black-sludge-row',
      source: {
        kind: 'trainer', slug: 'ash', section: 'foodStuff',
        rowId: 'black-sludge-row', expectedRevision: 3,
      },
    })
    expect(() => executeItemOperationUseCase({ role: 'gm', command: blockedCommand }, {
      database: blockedDatabase, now: () => 100,
    })).toThrow('The projected item offer is stale or no longer authorized.')
    expect((createSqliteSheetRepository<Record<string, unknown>>(blockedDatabase)
      .getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet).inventory?.foodStuff?.[0]?.qty).toBe(1)
    expect(createSqliteItemOperationRepository({ database: blockedDatabase }).get(blockedCommand.operationId)).toBeNull()
  })

  it('atomically revives a Fainted Pokémon, clears only Fainted, and replays without duplicate mechanics', () => {
    const database = open()
    const sourceTrainer = trainer()
    sourceTrainer.inventory = { medicalKit: [{ id: 'potion-row', name: 'Revive', qty: 2 }] }
    const target = pokemon()
    target.combat = { currentHp: 0, conditions: ['Fainted', 'Slowed'] }
    const sourceMap = arena()
    sourceMap.encounterState = {
      ...sourceMap.encounterState!,
      history: { ...sourceMap.encounterState!.history, faintedPlacementIds: ['pikachu-placement'] },
    }
    createSqliteMapRepository<TabletopMap>(database).save({ slug: 'arena', document: sourceMap, revision: 4, updatedAt: 10 })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({ kind: 'trainer', slug: 'ash', document: sourceTrainer as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
    sheets.save({ kind: 'pokemon', slug: 'pikachu', document: target as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
    const offer = buildEncounterPresentationProjection({
      role: 'gm', map: sourceMap, mapRevision: 4, pokemonSheets: [target],
      trainerSheets: [sourceTrainer], generatedAt: 10,
    }).offers.find(value => value.source.canonicalId === 'Revive')!
    const reviveCommand = command({ operationId: 'op_item_revive_execute1', offerId: offer.offerId })
    const first = executeItemOperationUseCase({ role: 'gm', command: reviveCommand }, { database, now: () => 100 })
    expect(first.result).toMatchObject({ status: 'accepted', canonicalItemId: 'Revive', exactReplay: false })
    expect(readTrainer(database).inventory?.medicalKit).toEqual([{ id: 'potion-row', name: 'Revive', qty: 1 }])
    expect(readPokemon(database).combat).toMatchObject({ currentHp: 20, conditions: ['Slowed'] })
    // Immutable scene KO history is retained while current projection derives consciousness from the sheet.
    expect(readMap(database).encounterState?.history.faintedPlacementIds).toEqual(['pikachu-placement'])
    const stored = createSqliteItemOperationRepository({ database }).get(reviveCommand.operationId)!
    expect(stored.plan?.operations.find(operation => operation.kind === 'hp')?.payload).toMatchObject({
      action: 'revive', currentHp: 0, requestedHp: 20, resultingHp: 20,
      faintedState: 'require-and-clear',
    })
    const replay = executeItemOperationUseCase({ role: 'gm', command: reviveCommand }, { database, now: () => 200 })
    expect(replay.result).toMatchObject({ status: 'accepted', exactReplay: true })
    expect(readTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(1)
    expect(readPokemon(database).combat).toMatchObject({ currentHp: 20, conditions: ['Slowed'] })
  })

  it('atomically commits capped X-Item stage evidence and rejects a cap no-op before consumption', () => {
    const database = open()
    const sourceTrainer = trainer()
    sourceTrainer.inventory = { medicalKit: [{ id: 'potion-row', name: 'X Attack', qty: 2 }] }
    const target = applyCombatStagesToSheet('pokemon', pokemon(), {
      atk: 5, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0,
    }) as CharacterSheet
    createSqliteMapRepository<TabletopMap>(database).save({ slug: 'arena', document: arena(), revision: 4, updatedAt: 10 })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({ kind: 'trainer', slug: 'ash', document: sourceTrainer as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
    sheets.save({ kind: 'pokemon', slug: 'pikachu', document: target as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
    const offer = buildEncounterPresentationProjection({
      role: 'gm', map: arena(), mapRevision: 4, pokemonSheets: [target],
      trainerSheets: [sourceTrainer], generatedAt: 10,
    }).offers.find(value => value.source.canonicalId === 'X Attack')!
    const xCommand = command({ operationId: 'op_item_x_attack_exec01', offerId: offer.offerId })
    const first = executeItemOperationUseCase({ role: 'gm', command: xCommand }, { database, now: () => 100 })
    expect(first.result).toMatchObject({ status: 'accepted', canonicalItemId: 'X Attack' })
    expect(readTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(1)
    expect(readPokemon(database).stats?.atk?.stage).toBe(6)
    expect(createSqliteItemOperationRepository({ database }).get(xCommand.operationId)?.plan?.operations
      .find(operation => operation.kind === 'stage')?.payload).toEqual({
        action: 'modify', stat: 'atk', previous: 5, requestedDelta: 2,
        appliedDelta: 1, current: 6, minimum: -6, maximum: 6, capped: true,
      })

    const currentTrainer = readTrainer(database)
    const currentPokemon = readPokemon(database)
    const currentMap = readMap(database)
    currentTrainer.inventory = { medicalKit: [{ id: 'potion-row', name: 'X Attack', qty: 1 }] }
    currentMap.encounterState!.turnResources['ash-placement']!.actions.standard.spent = 0
    const cappedProjection = buildEncounterPresentationProjection({
      role: 'gm', map: currentMap, mapRevision: currentMap.revision ?? 5,
      pokemonSheets: [currentPokemon], trainerSheets: [currentTrainer], generatedAt: 101,
    })
    expect(cappedProjection.offers.find(value => value.source.canonicalId === 'X Attack')?.availability)
      .toMatchObject({ status: 'unavailable', reasons: [expect.objectContaining({ code: 'target.invalid' })] })
    expect(readTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(1)
  })

  it('atomically delivers an X-Item through Wonder Launcher with one AP and no target forfeiture', () => {
    const database = open()
    const sourceTrainer = trainer()
    sourceTrainer.inventory = { medicalKit: [{ id: 'x-attack-row', name: 'X Attack', qty: 1 }] }
    sourceTrainer.skills = { medicineEd: { rankBonus: 3 } }
    sourceTrainer.ap = { max: 5 }
    sourceTrainer.equipmentState = activeEquipmentState({
      ownerKind: 'trainer', ownerSlug: 'ash', slotId: 'mainHand', additionalSlotIds: ['offHand'],
      canonicalItemId: 'Wonder Launcher',
    })
    createSqliteMapRepository<TabletopMap>(database).save({ slug: 'arena', document: arena(), revision: 4, updatedAt: 10 })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({ kind: 'trainer', slug: 'ash', document: sourceTrainer as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
    sheets.save({ kind: 'pokemon', slug: 'pikachu', document: pokemon() as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map: arena(), mapRevision: 4, pokemonSheets: [pokemon()], trainerSheets: [sourceTrainer], generatedAt: 10,
    })
    const offer = projection.offers.find(value => value.intent.actionId.startsWith('item.use.wonder-launcher:'))!
    const template = attachEncounterItemCommandTemplate({
      offer, map: arena(), mapRevision: 4, pokemonSheets: [pokemon()], trainerSheets: [sourceTrainer],
    }).itemCommand!
    const launcherCommand: UseItemCommandV1 = {
      ...template,
      operationId: 'op_item_wonder_launcher01',
      targetIds: ['pikachu-placement'],
      choices: [{ choiceId: 'target', optionIds: ['pikachu-placement'] }],
    }
    expect(JSON.stringify(launcherCommand)).not.toContain('equipped-item:v1:')
    const first = executeItemOperationUseCase({ role: 'gm', command: launcherCommand }, { database, now: () => 100 })
    expect(first.result).toMatchObject({ status: 'accepted', canonicalItemId: 'X Attack', exactReplay: false })
    expect(readPokemon(database).stats?.atk?.stage).toBe(2)
    expect(readTrainer(database).inventory?.medicalKit).toEqual([])
    expect(readTrainer(database).featureApState?.drains).toEqual([
      expect.objectContaining({
        sourceInstanceId: launcherCommand.delivery?.equipmentBindingId,
        canonicalId: 'X Attack', amount: 1, recovery: 'extended-rest',
      }),
    ])
    expect(readMap(database).encounterState?.turnResources['ash-placement']?.actions.standard.spent).toBe(1)
    expect(readMap(database).encounterState?.turnResources['pikachu-placement']?.oncePerTurnFlags ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'item.restorative.target-next-turn-forfeit' })]),
    )
    const stored = createSqliteItemOperationRepository({ database }).get(launcherCommand.operationId)!
    expect(stored.plan?.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'resource', payload: expect.objectContaining({ action: 'drain-ap', amount: 1 }) }),
    ]))
    expect(stored.plan?.operations.some(operation => operation.payload.action === 'schedule-next-turn-forfeit')).toBe(false)
    expect(stored.plan?.receiptFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ factId: 'wonder-launcher-delivery', label: expect.stringContaining('target keeps its actions') }),
    ]))
    const replay = executeItemOperationUseCase({ role: 'gm', command: launcherCommand }, { database, now: () => 200 })
    expect(replay.result).toMatchObject({ status: 'accepted', exactReplay: true })
    expect(readTrainer(database).featureApState?.drains).toHaveLength(1)
  })

  it('rejects a forged Wonder Launcher binding before applying an X-Item', () => {
    const database = open()
    const sourceTrainer = trainer()
    sourceTrainer.inventory = { medicalKit: [{ id: 'x-attack-row', name: 'X Attack', qty: 1 }] }
    sourceTrainer.skills = { medicineEd: { rankBonus: 3 } }
    sourceTrainer.ap = { max: 5 }
    sourceTrainer.equipmentState = activeEquipmentState({
      ownerKind: 'trainer', ownerSlug: 'ash', slotId: 'mainHand', additionalSlotIds: ['offHand'],
      canonicalItemId: 'Wonder Launcher',
    })
    createSqliteMapRepository<TabletopMap>(database).save({ slug: 'arena', document: arena(), revision: 4, updatedAt: 10 })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({ kind: 'trainer', slug: 'ash', document: sourceTrainer as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
    sheets.save({ kind: 'pokemon', slug: 'pikachu', document: pokemon() as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
    const offer = buildEncounterPresentationProjection({
      role: 'gm', map: arena(), mapRevision: 4, pokemonSheets: [pokemon()], trainerSheets: [sourceTrainer], generatedAt: 10,
    }).offers.find(value => value.intent.actionId.startsWith('item.use.wonder-launcher:'))!
    const template = attachEncounterItemCommandTemplate({
      offer, map: arena(), mapRevision: 4, pokemonSheets: [pokemon()], trainerSheets: [sourceTrainer],
    }).itemCommand!
    const forged: UseItemCommandV1 = {
      ...template,
      operationId: 'op_item_wonder_launcher02',
      delivery: { kind: 'wonder-launcher', equipmentBindingId: `equipment-delivery:v1:${'f'.repeat(32)}` },
      targetIds: ['pikachu-placement'],
      choices: [{ choiceId: 'target', optionIds: ['pikachu-placement'] }],
    }
    expect(() => executeItemOperationUseCase({ role: 'gm', command: forged }, { database, now: () => 100 }))
      .toThrow('Wonder Launcher authority changed')
    expect(readTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(1)
    expect(readTrainer(database).featureApState).toBeUndefined()
    expect(readPokemon(database).stats?.atk?.stage ?? 0).toBe(0)
  })

  it('atomically persists Dire Hit as a durable typed effect and exact-replays it once', () => {
    const database = open()
    const sourceTrainer = trainer()
    sourceTrainer.inventory = { medicalKit: [{ id: 'potion-row', name: 'Dire Hit', qty: 2 }] }
    createSqliteMapRepository<TabletopMap>(database).save({ slug: 'arena', document: arena(), revision: 4, updatedAt: 10 })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({ kind: 'trainer', slug: 'ash', document: sourceTrainer as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
    sheets.save({ kind: 'pokemon', slug: 'pikachu', document: pokemon() as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
    const offer = buildEncounterPresentationProjection({
      role: 'gm', map: arena(), mapRevision: 4, pokemonSheets: [pokemon()],
      trainerSheets: [sourceTrainer], generatedAt: 10,
    }).offers.find(value => value.source.canonicalId === 'Dire Hit')!
    const direHitCommand = command({ operationId: 'op_item_dire_hit_exec1', offerId: offer.offerId })
    const first = executeItemOperationUseCase({ role: 'gm', command: direHitCommand }, { database, now: () => 100 })
    expect(first.result).toMatchObject({ status: 'accepted', canonicalItemId: 'Dire Hit', exactReplay: false })
    expect(readTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(1)
    expect(readMap(database).encounterState?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'capability', transferPolicy: 'expire',
        affected: { placementIds: ['pikachu-placement'], sideIds: [], cells: [] },
        payload: { capabilityId: ITEM_DIRE_HIT_CAPABILITY_ID, action: 'grant', value: 2 },
      }),
    ]))
    const replay = executeItemOperationUseCase({ role: 'gm', command: direHitCommand }, { database, now: () => 200 })
    expect(replay.result).toMatchObject({ status: 'accepted', exactReplay: true })
    expect(readTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(1)
    expect(readMap(database).encounterState?.effects.filter(effect => (
      effect.kind === 'capability' && effect.payload.capabilityId === ITEM_DIRE_HIT_CAPABILITY_ID
    ))).toHaveLength(1)
  })

  it('atomically consumes a condition item, cures only its canonical scope, and replays without a second mutation', () => {
    const database = open()
    const target = pokemon()
    target.combat = { currentHp: 7, conditions: ['Badly Poisoned', 'Confused', 'Slowed'] }
    createSqliteMapRepository<TabletopMap>(database).save({ slug: 'arena', document: arena(), revision: 4, updatedAt: 10 })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({ kind: 'trainer', slug: 'ash', document: antidoteTrainer() as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
    sheets.save({ kind: 'pokemon', slug: 'pikachu', document: target as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
    const offer = buildEncounterPresentationProjection({
      role: 'gm', map: arena(), mapRevision: 4, pokemonSheets: [target],
      trainerSheets: [antidoteTrainer()], generatedAt: 10,
    }).offers.find(value => value.source.canonicalId === 'Antidote')!
    const antidoteCommand = command({ operationId: 'op_item_antidote_0001', offerId: offer.offerId })
    const first = executeItemOperationUseCase({ role: 'gm', command: antidoteCommand }, { database, now: () => 100 })
    expect(first.result).toMatchObject({ status: 'accepted', canonicalItemId: 'Antidote', exactReplay: false })
    expect(readTrainer(database).inventory?.medicalKit).toEqual([{ id: 'potion-row', name: 'Antidote', qty: 1 }])
    expect(readPokemon(database).combat?.conditions).toEqual(['Confused', 'Slowed'])
    const stored = createSqliteItemOperationRepository({ database }).get(antidoteCommand.operationId)!
    expect(stored.plan?.operations.find(operation => operation.kind === 'condition')?.payload).toMatchObject({
      currentConditions: ['Badly Poisoned', 'Confused', 'Slowed'],
      removedConditionIds: ['Badly Poisoned'], removedEntries: ['Badly Poisoned'],
      resultingConditions: ['Confused', 'Slowed'],
    })
    const replay = executeItemOperationUseCase({ role: 'gm', command: antidoteCommand }, { database, now: () => 200 })
    expect(replay.result).toMatchObject({ status: 'accepted', exactReplay: true })
    expect(readTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(1)
    expect(readPokemon(database).combat?.conditions).toEqual(['Confused', 'Slowed'])
  })

  it('rejects a condition item when no target has a condition inside its scope before reserving or consuming', () => {
    const database = open()
    const target = pokemon()
    target.combat = { currentHp: 7, conditions: ['Confused', 'Slowed'] }
    createSqliteMapRepository<TabletopMap>(database).save({ slug: 'arena', document: arena(), revision: 4, updatedAt: 10 })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({ kind: 'trainer', slug: 'ash', document: antidoteTrainer() as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
    sheets.save({ kind: 'pokemon', slug: 'pikachu', document: target as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map: arena(), mapRevision: 4, pokemonSheets: [target],
      trainerSheets: [antidoteTrainer()], generatedAt: 10,
    })
    const offer = projection.offers.find(value => value.source.canonicalId === 'Antidote')!
    expect(offer.availability).toMatchObject({ status: 'unavailable', reasons: [{ code: 'target.invalid' }] })
    expect(() => executeItemOperationUseCase({
      role: 'gm', command: command({ operationId: 'op_item_antidote_noop1', offerId: offer.offerId }),
    }, { database, now: () => 100 })).toThrow('projected item offer is stale')
    expect(readTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(2)
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM item_operations').get()).toEqual({ count: 0 })
  })

  it('fails closed when a group-inventory source was not projected as the authorized encounter offer', () => {
    const database = open()
    seed(database)
    const group: GroupInventoryDocument = {
      slug: 'main', revision: 1, updatedAt: 10, money: 0,
      inventory: { keyItems: [], pokemonItems: [], medicalKit: [{ id: 'shared-potion', name: 'Potion', qty: 1 }], pokeBalls: [], foodStuff: [], equipment: [] },
    }
    createSqliteGroupInventoryRepository(database).save({ slug: 'main', revision: 1, updatedAt: 10, document: group })
    const groupCommand = command({
      operationId: 'op_item_group_execute01',
      sourceInstanceId: 'item-instance:group:main:medicalKit:shared-potion',
      source: { kind: 'group', slug: 'main', section: 'medicalKit', rowId: 'shared-potion', expectedRevision: 1 },
      readSet: [
        ...command().readSet,
        { kind: 'group-inventory', id: 'main', revision: 1 },
      ],
    })
    expect(() => executeItemOperationUseCase({ role: 'gm', command: groupCommand }, { database, now: () => 100 }))
      .toThrow('projected item offer is stale')
    expect(createSqliteGroupInventoryRepository(database).get('main')?.document.inventory.medicalKit).toHaveLength(1)
    expect(readPokemon(database).combat?.currentHp).toBe(7)
  })

  it('returns an exact replay for timeout and tab-echo retries without consuming or spending twice', () => {
    const database = open()
    seed(database)
    const first = executeItemOperationUseCase({ role: 'gm', command: command() }, { database, now: () => 100 })
    const second = executeItemOperationUseCase({ role: 'gm', command: command() }, { database, now: () => 200 })
    expect(first.result).toMatchObject({ status: 'accepted', exactReplay: false })
    expect(second.result).toMatchObject({ status: 'accepted', exactReplay: true })
    expect(readTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(1)
    expect(readMap(database).encounterState?.turnResources['ash-placement']?.actions.standard.spent).toBe(1)
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM item_operations').get()).toEqual({ count: 1 })
    expect(() => executeItemOperationUseCase({
      role: 'gm', command: command({ targetIds: [], choices: [{ choiceId: 'target', optionIds: [] }] }),
    }, { database })).toThrow('already used for a different command')
  })

  it('survives an after-commit delivery failure and answers the client retry from the journal', () => {
    const database = open()
    seed(database)
    const failures: number[] = []
    const first = executeItemOperationUseCase({ role: 'gm', command: command() }, {
      database,
      now: () => 100,
      publishPersistedRealtimeEvent: () => { throw new Error('simulated disconnected client') },
      reportAfterCommitPublicationFailure: context => failures.push(context.sequence),
    })
    expect(first.result).toMatchObject({ status: 'accepted', exactReplay: false })
    expect(failures).toHaveLength(6)
    const retry = executeItemOperationUseCase({ role: 'gm', command: command() }, { database, now: () => 200 })
    expect(retry.result).toMatchObject({ status: 'accepted', exactReplay: true })
    expect(readTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(1)
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 6 })
  })

  it('replays accepted state after a server restart without rerunning mechanics or realtime publication', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rotom-item-replay-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'campaign.sqlite')
    const firstDatabase = open(path)
    seed(firstDatabase)
    executeItemOperationUseCase({ role: 'gm', command: command() }, { database: firstDatabase, now: () => 100 })
    firstDatabase.close()

    const restartedDatabase = open(path)
    const replay = executeItemOperationUseCase({ role: 'gm', command: command() }, { database: restartedDatabase, now: () => 200 })
    expect(replay.result).toMatchObject({ status: 'accepted', exactReplay: true })
    expect(readTrainer(restartedDatabase).inventory?.medicalKit?.[0]?.qty).toBe(1)
    expect(readMap(restartedDatabase).encounterState?.turnResources['ash-placement']?.actions.standard.spent).toBe(1)
    expect(restartedDatabase.connection.prepare('SELECT COUNT(*) AS count FROM item_operations').get()).toEqual({ count: 1 })
    expect(restartedDatabase.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 6 })
  })

  it('returns a durable terminal rejection exactly after reconnect without touching mechanics', () => {
    const database = open()
    seed(database)
    const repository = createSqliteItemOperationRepository({ database, clock: () => 100 })
    const pending = repository.createPending({
      command: command(), canonicalItemId: 'Potion', canonicalDefinitionSha256: 'a'.repeat(64),
      plan: {
        schemaVersion: 1, operationId: command().operationId, canonicalItemId: 'Potion',
        canonicalDefinitionSha256: 'a'.repeat(64), readSet: command().readSet,
        operations: [], receiptFacts: [],
      },
    })
    repository.complete({
      operationId: pending.operationId, commandSha256: pending.commandSha256, status: 'rejected',
      result: {
        schemaVersion: 1, operationId: pending.operationId, status: 'rejected', canonicalItemId: 'Potion',
        reasonId: 'item.target.stale', message: 'The target was no longer eligible.', exactReplay: false,
      },
    })
    const replay = executeItemOperationUseCase({ role: 'gm', command: command() }, { database })
    expect(replay.result).toEqual({
      schemaVersion: 1, operationId: pending.operationId, status: 'rejected', canonicalItemId: 'Potion',
      reasonId: 'item.target.stale', message: 'The target was no longer eligible.', exactReplay: true,
    })
    expect(readTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(2)
    expect(readPokemon(database).combat?.currentHp).toBe(7)
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 0 })
  })

  it('re-authorizes the projected offer identity before planning mechanics', () => {
    const database = open()
    seed(database)
    expect(() => executeItemOperationUseCase({
      role: 'gm', command: command({ offerId: 'offer:forged-item-authority' }),
    }, { database })).toThrow('projected item offer is stale')
    expect(readTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(2)
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM item_operations').get()).toEqual({ count: 0 })
  })

  it('persists an unresolved legal target decision and reservation without applying writes', () => {
    const database = open()
    seed(database)
    const invalidTarget = command({
      operationId: 'op_item_bad_target_0001',
      targetIds: [],
      choices: [{ choiceId: 'target', optionIds: [] }],
    })
    const response = executeItemOperationUseCase({ role: 'gm', command: invalidTarget }, { database, now: () => 100 })
    expect(response.result).toMatchObject({ status: 'pending', canonicalItemId: 'Potion', reservationId: expect.any(String) })
    expect(readTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(2)
    expect(createSqliteItemOperationRepository({ database }).get(invalidTarget.operationId)).toMatchObject({
      status: 'pending',
      pendingDecision: { choices: [expect.objectContaining({ choiceId: 'target' })] },
    })
    const events = createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0, limit: 10 }).events
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      access: { kind: 'map-access', mapSlug: 'arena' },
      event: {
        channel: 'map:arena', type: 'item-operation-presentation-invalidated', revision: 4,
        data: { mapSlug: 'arena' },
      },
    })
    const eventJson = JSON.stringify(events[0]?.event)
    expect(eventJson).not.toContain('Potion')
    expect(eventJson).not.toContain('potion-row')
    expect(eventJson).not.toContain('pikachu-placement')
    expect(eventJson).not.toContain(invalidTarget.operationId)
  })

  it('rejects stale state and unauthorized actors before any write', () => {
    const database = open()
    seed(database)
    const stale = command({ readSet: command().readSet.map(ref => ref.kind === 'map' ? { ...ref, revision: 3 } : ref) })
    expect(() => executeItemOperationUseCase({ role: 'gm', command: stale }, { database })).toThrow('map changed')
    expect(() => executeItemOperationUseCase({ role: 'player', playerProfile: null, command: command() }, { database })).toThrow('does not control')
    const clockBound = command({
      operationId: 'op_item_clock_stale_0001',
      readSet: [...command().readSet, { kind: 'campaign-clock', id: 'campaign', revision: 1 }],
    })
    expect(createSqliteCampaignClockRepository(database).get()).toMatchObject({ revision: 0, campaignMinute: 0 })
    expect(() => executeItemOperationUseCase({ role: 'gm', command: clockBound }, { database }))
      .toThrow('campaign clock changed')
    expect(readTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(2)
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM item_operations').get()).toEqual({ count: 0 })
  })

  it.each(['map', 'sheet', 'operation', 'realtime'] as const)('rolls all documents and journal rows back after the %s boundary', (boundary) => {
    const database = open()
    seed(database)
    expect(() => executeItemOperationUseCase({ role: 'gm', command: command() }, {
      database,
      now: () => 100,
      failAfterWrite: value => { if (value === boundary) throw new Error(`fixture failure after ${boundary}`) },
    })).toThrow(`fixture failure after ${boundary}`)
    expect(readTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(2)
    expect(readPokemon(database).combat?.currentHp).toBe(7)
    expect(readMap(database).revision).toBe(4)
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM item_operations').get()).toEqual({ count: 0 })
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 0 })
  })
})
