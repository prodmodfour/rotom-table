import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { createEmptySheetEquipmentState, parseSheetEquipmentStateForOwner } from '#shared/itemAutomation/equipment'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { InventoryActionOfferV1 } from '#shared/itemAutomation/inventoryActions'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteGroupInventoryRepository } from '../../server/storage/groupInventoryRepository'
import { createSqliteInventoryActionOperationRepository } from '../../server/storage/inventoryActionOperationRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { equipmentDefinitionSha256 } from '../../server/domain/itemAutomation/equipmentDefinitionRegistry'
import { executeTrainerInventoryActionUseCase } from '../../server/useCases/executeTrainerInventoryAction'
import { loadTrainerInventoryActionsUseCase } from '../../server/useCases/loadTrainerInventoryActions'

const databases: RotomDatabase[] = []
const temporaryRoots: string[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length) databases.pop()!.close()
  while (temporaryRoots.length) rmSync(temporaryRoots.pop()!, { recursive: true, force: true })
})

const seed = (database: RotomDatabase): void => {
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const trainer: TrainerSheet = {
    slug: 'ash', name: 'Ash', level: 10, revision: 3, currentTeam: ['pikachu'],
    inventory: {
      medicalKit: [{ id: 'potion-row', name: 'Potion', qty: 3 }],
      equipment: [
        { id: 're-breather-row', name: 'Re-Breather' },
        { id: 'focus-row', name: 'Focus' },
      ],
    },
    equipmentState: createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: 'ash' }),
  }
  const pokemon: CharacterSheet = {
    slug: 'pikachu', nickname: 'Pikachu', species: 'Pikachu', level: 5, revision: 2,
    stats: { hp: { added: 0 } }, combat: { currentHp: 7 },
    equipmentState: createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: 'pikachu' }),
  }
  sheets.save({ kind: 'trainer', slug: 'ash', revision: 3, updatedAt: 10, document: trainer as unknown as Record<string, unknown> })
  sheets.save({ kind: 'pokemon', slug: 'pikachu', revision: 2, updatedAt: 10, document: pokemon as unknown as Record<string, unknown> })
  createSqliteGroupInventoryRepository(database).getOrCreate({ now: 10 })
}

const declaration = (offer: InventoryActionOfferV1, operationId: string, quantity = 1) => {
  const destination = offer.destination.options.find(option => option.enabled)!
  return {
    schemaVersion: 1,
    operationId,
    offerId: offer.offerId,
    action: offer.action,
    sourceSelectionId: offer.source.sourceSelectionId,
    quantity,
    destinationId: destination.destinationId,
    confirmationOptionId: null,
    expectedRevisions: [...offer.revisionRequirements, ...destination.revisionRequirements]
      .map(row => ({ requirementId: row.requirementId, expectedRevision: row.expectedRevision })),
  }
}

describe('execute unified Trainer inventory actions', () => {
  it('gives one exact whole item atomically and exact-replays after the source row is gone', () => {
    const database = open()
    seed(database)
    const projection = loadTrainerInventoryActionsUseCase({ role: 'gm', trainerSlug: 'ash' }, { database, now: () => 100 })
    const offer = projection.offers.find(candidate => candidate.action === 'give')!
    const command = declaration(offer, 'inventory-action:v1:11111111111111111111111111111111')

    const first = executeTrainerInventoryActionUseCase({
      role: 'gm', trainerSlug: 'ash', declaration: command, clientId: 'client-one',
    }, { database, now: () => 101 })
    expect(first.result).toMatchObject({ action: 'give', exactReplay: false })
    const trainer = first.sheets.find(sheet => sheet.kind === 'trainer')!
    expect((trainer.sheet as unknown as TrainerSheet).inventory?.equipment).toEqual([
      expect.objectContaining({ id: 'focus-row', name: 'Focus' }),
    ])
    const acceptedPokemon = first.sheets.find(sheet => sheet.kind === 'pokemon')!
    const pokemonState = parseSheetEquipmentStateForOwner(
      (acceptedPokemon.sheet as unknown as CharacterSheet).equipmentState,
      { kind: 'pokemon', slug: 'pikachu' },
    )
    expect(pokemonState.slots.find(slot => slot.slotId === 'held')?.instanceId).toEqual(expect.any(String))
    expect(pokemonState.instances).toHaveLength(1)

    const replay = executeTrainerInventoryActionUseCase({
      role: 'gm', trainerSlug: 'ash', declaration: command, clientId: 'client-two',
    }, { database, now: () => 102 })
    expect(replay.result).toMatchObject({ action: 'give', exactReplay: true })
    expect(createSqliteInventoryActionOperationRepository(database).find(command.operationId)).toMatchObject({ status: 'accepted' })

    expect(() => executeTrainerInventoryActionUseCase({
      role: 'gm', trainerSlug: 'ash', declaration: { ...command, quantity: 2 },
    }, { database })).toThrow('operation ID was reused with changed input')
    expect(() => executeTrainerInventoryActionUseCase({
      role: 'player',
      playerProfile: {
        schemaVersion: 1,
        id: 'profile_fixture01',
        displayName: 'Player',
        linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'ash' }],
      } as unknown as PlayerProfile,
      trainerSlug: 'ash',
      declaration: command,
    }, { database })).toThrow('replay belongs to a different principal')
  })

  it('keeps a declared move pending and mechanically inert when reviewed equipment authority drifts', () => {
    const database = open()
    seed(database)
    const projection = loadTrainerInventoryActionsUseCase({ role: 'gm', trainerSlug: 'ash' }, { database, now: () => 100 })
    const offer = projection.offers.find(candidate => candidate.action === 'give')!
    const command = declaration(offer, 'inventory-action:v1:55555555555555555555555555555555')
    let definitionReads = 0
    expect(() => executeTrainerInventoryActionUseCase({
      role: 'gm', trainerSlug: 'ash', declaration: command,
    }, {
      database,
      now: () => 101,
      equipmentDefinitionSha256: canonicalItemId => {
        definitionReads += 1
        return definitionReads === 1 ? equipmentDefinitionSha256(canonicalItemId) : '0'.repeat(64)
      },
    })).toThrow('Equipment definition authority changed after inventory action declaration')
    expect(createSqliteInventoryActionOperationRepository(database).find(command.operationId)).toMatchObject({ status: 'pending' })
    const trainer = createSqliteSheetRepository<Record<string, unknown>>(database).getByRef('trainer', 'ash')!
    expect((trainer.sheet as unknown as TrainerSheet).inventory?.equipment).toEqual([
      expect.objectContaining({ id: 're-breather-row' }),
      expect.objectContaining({ id: 'focus-row' }),
    ])
  })

  it('recovers the immutable accepted action after a real database restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-inventory-action-'))
    temporaryRoots.push(root)
    const path = join(root, 'campaign.sqlite')
    const firstDatabase = openRotomDatabase({ path, enableWal: false })
    seed(firstDatabase)
    const projection = loadTrainerInventoryActionsUseCase({ role: 'gm', trainerSlug: 'ash' }, { database: firstDatabase, now: () => 100 })
    const offer = projection.offers.find(candidate => candidate.action === 'give')!
    const command = declaration(offer, 'inventory-action:v1:33333333333333333333333333333333')
    const accepted = executeTrainerInventoryActionUseCase({ role: 'gm', trainerSlug: 'ash', declaration: command }, { database: firstDatabase, now: () => 101 })
    expect(accepted.result.exactReplay).toBe(false)
    firstDatabase.close()

    const reopened = openRotomDatabase({ path, enableWal: false })
    databases.push(reopened)
    const recovered = executeTrainerInventoryActionUseCase({ role: 'gm', trainerSlug: 'ash', declaration: command }, { database: reopened, now: () => 500 })
    expect(recovered.result).toMatchObject({ action: 'give', exactReplay: true })
    expect(recovered.sheets.find(sheet => sheet.kind === 'pokemon')?.revision).toBe(3)
    expect(createSqliteInventoryActionOperationRepository(reopened).find(command.operationId)).toMatchObject({ status: 'accepted' })
  })

  it('equips one exact reviewed configuration without accepting client-authored configuration JSON', () => {
    const database = open()
    seed(database)
    const projection = loadTrainerInventoryActionsUseCase({ role: 'gm', trainerSlug: 'ash' }, { database, now: () => 100 })
    const offer = projection.offers.find(candidate => candidate.action === 'equip' && candidate.source.canonicalItemId === 'Focus')!
    const destination = offer.destination.options.find(option => option.label.endsWith('Stat: Special Attack'))!
    const command = {
      ...declaration(offer, 'inventory-action:v1:44444444444444444444444444444444'),
      destinationId: destination.destinationId,
      expectedRevisions: [...offer.revisionRequirements, ...destination.revisionRequirements]
        .map(row => ({ requirementId: row.requirementId, expectedRevision: row.expectedRevision })),
    }
    const accepted = executeTrainerInventoryActionUseCase({
      role: 'gm', trainerSlug: 'ash', declaration: command,
    }, { database, now: () => 101 })
    const trainerSheet = accepted.sheets.find(sheet => sheet.kind === 'trainer')!
    const state = parseSheetEquipmentStateForOwner(
      (trainerSheet.sheet as unknown as TrainerSheet).equipmentState,
      { kind: 'trainer', slug: 'ash' },
    )
    const instance = state.instances.find(candidate => candidate.canonicalItemId === 'Focus')!
    expect(instance.configuration).toMatchObject({
      configurationId: 'equipment.focus.v1',
      values: { statId: 'satk' },
    })
    expect((trainerSheet.sheet as unknown as TrainerSheet).inventory?.equipment).toEqual([
      expect.objectContaining({ id: 're-breather-row' }),
    ])
  })

  it('transfers an exact bounded quantity and atomically stores an accepted replay receipt', () => {
    const database = open()
    seed(database)
    const projection = loadTrainerInventoryActionsUseCase({ role: 'gm', trainerSlug: 'ash' }, { database, now: () => 100 })
    const offer = projection.offers.find(candidate => candidate.action === 'transfer' && candidate.source.canonicalItemId === 'Potion')!
    const command = declaration(offer, 'inventory-action:v1:22222222222222222222222222222222', 2)

    const first = executeTrainerInventoryActionUseCase({ role: 'gm', trainerSlug: 'ash', declaration: command }, { database, now: () => 101 })
    expect(first.result).toMatchObject({ action: 'transfer', exactReplay: false })
    expect((first.sheets[0]!.sheet as unknown as TrainerSheet).inventory?.medicalKit).toEqual([
      expect.objectContaining({ id: 'potion-row', qty: 1 }),
    ])
    expect(first.groupInventories[0]!.inventory.medicalKit).toEqual([
      expect.objectContaining({ name: 'Potion', qty: 2 }),
    ])
    expect(createSqliteInventoryActionOperationRepository(database).find(command.operationId)).toMatchObject({ status: 'accepted' })

    const replay = executeTrainerInventoryActionUseCase({ role: 'gm', trainerSlug: 'ash', declaration: command }, { database, now: () => 102 })
    expect(replay.result.exactReplay).toBe(true)
    expect(replay.groupInventories[0]!.inventory.medicalKit).toEqual([
      expect.objectContaining({ name: 'Potion', qty: 2 }),
    ])
  })
})
