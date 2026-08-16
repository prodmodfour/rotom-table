import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteItemOperationRepository } from '../../server/storage/itemOperationRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { executeItemOperationUseCase } from '../../server/useCases/executeItemOperation'
import { recoverItemOperationUseCase } from '../../server/useCases/recoverItemOperation'
import { buildEncounterPresentationProjection } from '../../server/domain/encounterPresentation/buildProjection'
import type { ItemOperationRecoveryCommandV1 } from '#shared/itemAutomation/recovery'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { PlayerProfile } from '#shared/playerProfiles'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => { while (databases.length) databases.pop()!.close() })

const trainer = (): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 3, updatedAt: 10,
  inventory: { medicalKit: [{ id: 'potion-row', name: 'Potion', qty: 2 }] },
})
const pokemon = (): CharacterSheet => ({
  slug: 'pikachu', nickname: 'Pikachu', species: 'Pikachu', level: 5, revision: 2, updatedAt: 10,
  stats: { hp: { added: 0 } }, combat: { currentHp: 1 },
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
const profile = (): PlayerProfile => ({
  schemaVersion: 1, id: 'profile_fixture01', displayName: 'Player',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'ash' }],
})
const offerId = (): string => buildEncounterPresentationProjection({
  role: 'gm', map: arena(), mapRevision: 4, pokemonSheets: [pokemon()], trainerSheets: [trainer()], generatedAt: 10,
}).offers.find(offer => offer.source.sourceKind === 'item' && offer.source.canonicalId === 'Potion')!.offerId
const useCommand = (overrides: Partial<UseItemCommandV1> = {}): UseItemCommandV1 => ({
  schemaVersion: 1, operationId: 'op_item_recover_0001', context: 'encounter', offerId: offerId(),
  sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row', actorParticipantId: 'ash-placement',
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
  source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'potion-row', expectedRevision: 3 },
  targetIds: ['pikachu-placement'], choices: [{ choiceId: 'target', optionIds: ['pikachu-placement'] }],
  readSet: [
    { kind: 'map', id: 'arena', revision: 4 }, { kind: 'encounter', id: 'arena', revision: 4 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
  ],
  ...overrides,
})
const correction = (overrides: Partial<Extract<ItemOperationRecoveryCommandV1, { action: 'correct' }>> = {}): ItemOperationRecoveryCommandV1 => ({
  schemaVersion: 1, operationId: useCommand().operationId, action: 'correct',
  correctionOperationId: 'op_item_correction_0001', reason: 'The item was used on the wrong target.', ...overrides,
})
const abandonment = (operationId: string): ItemOperationRecoveryCommandV1 => ({
  schemaVersion: 1, operationId, action: 'abandon', reason: 'The pending choice is no longer needed.',
})
const seed = (database: RotomDatabase): void => {
  createSqliteMapRepository<TabletopMap>(database).save({ slug: 'arena', document: arena(), revision: 4, updatedAt: 10 })
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({ kind: 'trainer', slug: 'ash', document: trainer() as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
  sheets.save({ kind: 'pokemon', slug: 'pikachu', document: pokemon() as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
}
const storedTrainer = (database: RotomDatabase): TrainerSheet => createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet
const storedPokemon = (database: RotomDatabase): CharacterSheet => createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('pokemon', 'pikachu')!.sheet as unknown as CharacterSheet
const storedMap = (database: RotomDatabase): TabletopMap => createSqliteMapRepository<TabletopMap>(database).get('arena')!.document

const accept = (database: RotomDatabase): void => {
  executeItemOperationUseCase({ role: 'gm', command: useCommand() }, { database, now: () => 100 })
}

describe('item operation recovery', () => {
  it('atomically corrects an accepted receipt from private before/after evidence', () => {
    const database = open(); seed(database); accept(database)
    const acceptedHp = storedPokemon(database).combat?.currentHp
    expect(acceptedHp).toBeGreaterThan(1)
    const response = recoverItemOperationUseCase({ role: 'gm', command: correction(), clientId: 'recover-client' }, {
      database, now: () => 200,
    })
    expect(response.result).toMatchObject({
      action: 'correct', status: 'corrected', inventoryDisposition: 'restored', exactReplay: false,
      operationId: useCommand().operationId, correctionOperationId: 'op_item_correction_0001',
    })
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([{ id: 'potion-row', name: 'Potion', qty: 2 }])
    expect(storedPokemon(database).combat?.currentHp).toBe(1)
    expect(storedMap(database).encounterState?.turnResources['ash-placement']?.actions.standard.spent).toBe(0)
    expect(storedMap(database).revision).toBe(6)
    expect(createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', 'ash')?.revision).toBe(5)
    expect(createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('pokemon', 'pikachu')?.revision).toBe(4)
    const operations = createSqliteItemOperationRepository({ database })
    expect(operations.get(useCommand().operationId)).toMatchObject({ status: 'accepted', recoveryCommand: null })
    expect(operations.findCorrectionOf(useCommand().operationId)).toMatchObject({
      operationId: 'op_item_correction_0001', status: 'corrected', correctionOfOperationId: useCommand().operationId,
    })
    const events = createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0, limit: 50 }).events
    expect(events).toHaveLength(12)
    const invalidation = events.filter(event => event.event.type === 'item-operation-presentation-invalidated')
    expect(invalidation).toHaveLength(0)
    const eventJson = JSON.stringify(events.slice(6))
    // Authorized sheet channels necessarily carry the restored private inventory document;
    // map/global invalidations must not add command evidence or recovery intent.
    expect(eventJson).not.toContain('sourceInstanceId')
    expect(eventJson).not.toContain(correction().reason)
    expect(eventJson).not.toContain(correction().operationId)
    expect(eventJson).not.toContain(correction().correctionOperationId)
  })

  it('restores exact pre-Snack storage and inventory on correction', () => {
    const database = open(); seed(database)
    const snackTrainer = trainer()
    snackTrainer.inventory = { foodStuff: [{ id: 'snack-row', name: 'Leftovers', qty: 1 }] }
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({ kind: 'trainer', slug: 'ash', document: snackTrainer as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
    const snackOffer = buildEncounterPresentationProjection({
      role: 'gm', map: arena(), mapRevision: 4, pokemonSheets: [pokemon()], trainerSheets: [snackTrainer], generatedAt: 10,
    }).offers.find(offer => offer.source.sourceKind === 'item' && offer.source.canonicalId === 'Leftovers')!.offerId
    const snackCommand = useCommand({
      operationId: 'op_item_snack_recover_01', offerId: snackOffer,
      sourceInstanceId: 'item-instance:trainer:ash:foodStuff:snack-row',
      source: { kind: 'trainer', slug: 'ash', section: 'foodStuff', rowId: 'snack-row', expectedRevision: 3 },
    })
    executeItemOperationUseCase({ role: 'gm', command: snackCommand }, { database, now: () => 100 })
    expect(storedPokemon(database).items?.digestionFood).toBe('Leftovers')
    const result = recoverItemOperationUseCase({
      role: 'gm', command: correction({
        operationId: snackCommand.operationId,
        correctionOperationId: 'op_item_snack_fix_0001',
      }),
    }, { database, now: () => 200 })
    expect(result.result).toMatchObject({ status: 'corrected', inventoryDisposition: 'restored' })
    expect(storedPokemon(database).items?.digestionFood).toBeUndefined()
    expect(storedTrainer(database).inventory?.foodStuff).toEqual([{ id: 'snack-row', name: 'Leftovers', qty: 1 }])
    expect(storedMap(database).encounterState?.turnResources['ash-placement']?.actions.standard.spent).toBe(0)
  })

  it('restores exact pre-revival HP, Fainted state, inventory, and action resources on correction', () => {
    const database = open()
    const sourceTrainer = trainer()
    sourceTrainer.inventory = { medicalKit: [{ id: 'potion-row', name: 'Revive', qty: 2 }] }
    const target = pokemon()
    target.combat = { currentHp: 0, conditions: ['Fainted', 'Slowed'] }
    createSqliteMapRepository<TabletopMap>(database).save({ slug: 'arena', document: arena(), revision: 4, updatedAt: 10 })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({ kind: 'trainer', slug: 'ash', document: sourceTrainer as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
    sheets.save({ kind: 'pokemon', slug: 'pikachu', document: target as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
    const offer = buildEncounterPresentationProjection({
      role: 'gm', map: arena(), mapRevision: 4, pokemonSheets: [target],
      trainerSheets: [sourceTrainer], generatedAt: 10,
    }).offers.find(value => value.source.canonicalId === 'Revive')!
    executeItemOperationUseCase({ role: 'gm', command: useCommand({ offerId: offer.offerId }) }, { database, now: () => 100 })
    expect(storedPokemon(database).combat).toMatchObject({ currentHp: 20, conditions: ['Slowed'] })
    const response = recoverItemOperationUseCase({ role: 'gm', command: correction() }, { database, now: () => 200 })
    expect(response.result).toMatchObject({ status: 'corrected', inventoryDisposition: 'restored' })
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([{ id: 'potion-row', name: 'Revive', qty: 2 }])
    expect(storedPokemon(database).combat).toMatchObject({ currentHp: 0, conditions: ['Fainted', 'Slowed'] })
    expect(storedMap(database).encounterState?.turnResources['ash-placement']?.actions.standard.spent).toBe(0)
  })

  it('restores exact pre-use condition state when correcting an accepted condition item', () => {
    const database = open()
    const sourceTrainer = trainer()
    sourceTrainer.inventory = { medicalKit: [{ id: 'potion-row', name: 'Antidote', qty: 2 }] }
    const target = pokemon()
    target.combat = { currentHp: 1, conditions: ['Poisoned', 'Confused', 'Slowed'] }
    createSqliteMapRepository<TabletopMap>(database).save({ slug: 'arena', document: arena(), revision: 4, updatedAt: 10 })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({ kind: 'trainer', slug: 'ash', document: sourceTrainer as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
    sheets.save({ kind: 'pokemon', slug: 'pikachu', document: target as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
    const offer = buildEncounterPresentationProjection({
      role: 'gm', map: arena(), mapRevision: 4, pokemonSheets: [target],
      trainerSheets: [sourceTrainer], generatedAt: 10,
    }).offers.find(value => value.source.canonicalId === 'Antidote')!
    const command = useCommand({ offerId: offer.offerId })
    executeItemOperationUseCase({ role: 'gm', command }, { database, now: () => 100 })
    expect(storedPokemon(database).combat?.conditions).toEqual(['Confused', 'Slowed'])
    const response = recoverItemOperationUseCase({ role: 'gm', command: correction() }, { database, now: () => 200 })
    expect(response.result).toMatchObject({ status: 'corrected', inventoryDisposition: 'restored' })
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([{ id: 'potion-row', name: 'Antidote', qty: 2 }])
    expect(storedPokemon(database).combat?.conditions).toEqual(['Poisoned', 'Confused', 'Slowed'])
  })

  it('restores exact pre-use stage and temporary-effect state from correction evidence', () => {
    for (const canonicalId of ['X Attack', 'Dire Hit'] as const) {
      const database = open()
      const sourceTrainer = trainer()
      sourceTrainer.inventory = { medicalKit: [{ id: 'potion-row', name: canonicalId, qty: 2 }] }
      const sourceMap = arena()
      const target = pokemon()
      if (canonicalId === 'X Attack') {
        target.stats = { ...target.stats, atk: { added: 0, stage: 4 } }
      }
      createSqliteMapRepository<TabletopMap>(database).save({ slug: 'arena', document: sourceMap, revision: 4, updatedAt: 10 })
      const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
      sheets.save({ kind: 'trainer', slug: 'ash', document: sourceTrainer as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
      sheets.save({ kind: 'pokemon', slug: 'pikachu', document: target as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
      const offer = buildEncounterPresentationProjection({
        role: 'gm', map: sourceMap, mapRevision: 4, pokemonSheets: [target],
        trainerSheets: [sourceTrainer], generatedAt: 10,
      }).offers.find(value => value.source.canonicalId === canonicalId)!
      const command = useCommand({ offerId: offer.offerId })
      executeItemOperationUseCase({ role: 'gm', command }, { database, now: () => 100 })
      if (canonicalId === 'X Attack') expect(storedPokemon(database).stats?.atk?.stage).toBe(6)
      else expect(storedMap(database).encounterState?.effects).toHaveLength(1)
      const response = recoverItemOperationUseCase({ role: 'gm', command: correction() }, { database, now: () => 200 })
      expect(response.result).toMatchObject({ status: 'corrected', inventoryDisposition: 'restored' })
      expect(storedTrainer(database).inventory?.medicalKit).toEqual([{ id: 'potion-row', name: canonicalId, qty: 2 }])
      if (canonicalId === 'X Attack') expect(storedPokemon(database).stats?.atk?.stage).toBe(4)
      else expect(storedMap(database).encounterState?.effects).toEqual([])
    }
  })

  it('refuses to resurrect a temporary effect after authoritative encounter cleanup', () => {
    const database = open()
    const sourceTrainer = trainer()
    sourceTrainer.inventory = { medicalKit: [{ id: 'potion-row', name: 'Dire Hit', qty: 2 }] }
    const sourceMap = arena()
    const target = pokemon()
    const maps = createSqliteMapRepository<TabletopMap>(database)
    maps.save({ slug: 'arena', document: sourceMap, revision: 4, updatedAt: 10 })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({ kind: 'trainer', slug: 'ash', document: sourceTrainer as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
    sheets.save({ kind: 'pokemon', slug: 'pikachu', document: target as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
    const offer = buildEncounterPresentationProjection({
      role: 'gm', map: sourceMap, mapRevision: 4, pokemonSheets: [target],
      trainerSheets: [sourceTrainer], generatedAt: 10,
    }).offers.find(value => value.source.canonicalId === 'Dire Hit')!
    executeItemOperationUseCase({ role: 'gm', command: useCommand({ offerId: offer.offerId }) }, { database, now: () => 100 })
    const accepted = maps.get('arena')!
    expect(accepted.document.encounterState?.effects).toHaveLength(1)
    expect(maps.applyLivePlayUpdate({
      slug: 'arena', expectedRevision: accepted.revision,
      nextMap: {
        ...accepted.document,
        encounterState: { ...accepted.document.encounterState!, effects: [] },
        revision: accepted.revision + 1,
      },
    })).toBe('applied')

    expect(() => recoverItemOperationUseCase({ role: 'gm', command: correction() }, { database, now: () => 200 }))
      .toThrow('changed after the accepted item operation')
    expect(storedTrainer(database).inventory?.medicalKit).toEqual([{ id: 'potion-row', name: 'Dire Hit', qty: 1 }])
    expect(storedMap(database).encounterState?.effects).toEqual([])
  })

  it('replays the exact correction without restoring, spending, journaling, or publishing twice', () => {
    const database = open(); seed(database); accept(database)
    const first = recoverItemOperationUseCase({ role: 'gm', command: correction() }, { database, now: () => 200 })
    const eventCount = database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()
    const retry = recoverItemOperationUseCase({ role: 'gm', command: correction() }, { database, now: () => 300 })
    expect(first.result.exactReplay).toBe(false)
    expect(retry.result).toMatchObject({ status: 'corrected', exactReplay: true })
    expect(storedTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(2)
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM item_operations').get()).toEqual({ count: 2 })
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual(eventCount)
    expect(() => recoverItemOperationUseCase({ role: 'gm', command: correction({ reason: 'A different recovery reason.' }) }, { database }))
      .toThrow('different recovery evidence')
  })

  it('rejects player correction and refuses to overwrite a resource changed after acceptance', () => {
    const database = open(); seed(database); accept(database)
    expect(() => recoverItemOperationUseCase({ role: 'player', playerProfile: profile(), command: correction() }, { database }))
      .toThrow('GM authorization')
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const current = sheets.getByRef('pokemon', 'pikachu')!
    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'pikachu', expectedRevision: current.revision,
      nextSheet: { ...current.sheet, updatedAt: 150 }, sourceOperationId: 'external-change',
    })).toBe('applied')
    expect(() => recoverItemOperationUseCase({ role: 'gm', command: correction() }, { database, now: () => 200 }))
      .toThrow('changed after the accepted item operation')
    expect(storedTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(1)
    expect(createSqliteItemOperationRepository({ database }).findCorrectionOf(useCommand().operationId)).toBeNull()
  })

  it.each(['map', 'sheet', 'operation', 'realtime'] as const)(
    'rolls correction documents, receipt, and realtime back after the %s boundary',
    boundary => {
      const database = open(); seed(database); accept(database)
      const beforeEvents = database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()
      expect(() => recoverItemOperationUseCase({ role: 'gm', command: correction() }, {
        database, now: () => 200,
        failAfterWrite: value => { if (value === boundary) throw new Error(`failure after ${boundary}`) },
      })).toThrow(`failure after ${boundary}`)
      expect(storedTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(1)
      expect(storedPokemon(database).combat?.currentHp).toBeGreaterThan(1)
      expect(storedMap(database).revision).toBe(5)
      expect(createSqliteItemOperationRepository({ database }).findCorrectionOf(useCommand().operationId)).toBeNull()
      expect(database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual(beforeEvents)
    },
  )

  it('abandons a pending reservation without consuming, spending, or applying effects and replays exactly', () => {
    const database = open(); seed(database)
    const pendingCommand = useCommand({
      operationId: 'op_item_abandon_0001', targetIds: [], choices: [{ choiceId: 'target', optionIds: [] }],
    })
    const pending = executeItemOperationUseCase({ role: 'player', playerProfile: profile(), command: pendingCommand }, { database, now: () => 100 })
    expect(pending.result.status).toBe('pending')
    const first = recoverItemOperationUseCase({
      role: 'player', playerProfile: profile(), command: abandonment(pendingCommand.operationId),
    }, { database, now: () => 200 })
    expect(first.result).toMatchObject({ status: 'abandoned', inventoryDisposition: 'reservation-released', exactReplay: false })
    expect(storedTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(2)
    expect(storedPokemon(database).combat?.currentHp).toBe(1)
    expect(storedMap(database).encounterState?.turnResources['ash-placement']?.actions.standard.spent).toBe(0)
    const retry = recoverItemOperationUseCase({
      role: 'player', playerProfile: profile(), command: abandonment(pendingCommand.operationId),
    }, { database, now: () => 300 })
    expect(retry.result).toMatchObject({ status: 'abandoned', exactReplay: true })
    expect(createSqliteItemOperationRepository({ database }).reservedQuantity(pendingCommand.sourceInstanceId)).toBe(0)
  })

  it('rejects correction of pending operations without consuming their reservation', () => {
    const database = open(); seed(database)
    const pendingCommand = useCommand({
      operationId: 'op_item_pending_correct01', targetIds: [], choices: [{ choiceId: 'target', optionIds: [] }],
    })
    executeItemOperationUseCase({ role: 'gm', command: pendingCommand }, { database, now: () => 100 })
    expect(() => recoverItemOperationUseCase({
      role: 'gm',
      command: correction({ operationId: pendingCommand.operationId, correctionOperationId: 'op_item_pending_fix_0001' }),
    }, { database })).toThrow('must be abandoned or completed')
    expect(storedTrainer(database).inventory?.medicalKit?.[0]?.qty).toBe(2)
    expect(createSqliteItemOperationRepository({ database }).reservedQuantity(pendingCommand.sourceInstanceId)).toBe(1)
  })

  it('returns an explicit unchanged disposition for terminal abandonment and rejects unrelated players', () => {
    const database = open(); seed(database); accept(database)
    const result = recoverItemOperationUseCase({ role: 'gm', command: abandonment(useCommand().operationId) }, { database })
    expect(result.result).toMatchObject({ status: 'already-terminal', inventoryDisposition: 'unchanged' })
    const secondDatabase = open(); seed(secondDatabase)
    const pendingCommand = useCommand({
      operationId: 'op_item_abandon_auth01', targetIds: [], choices: [{ choiceId: 'target', optionIds: [] }],
    })
    executeItemOperationUseCase({ role: 'gm', command: pendingCommand }, { database: secondDatabase, now: () => 200 })
    expect(() => recoverItemOperationUseCase({
      role: 'player', playerProfile: null, command: abandonment(pendingCommand.operationId),
    }, { database: secondDatabase })).toThrow('does not control')
  })
})
