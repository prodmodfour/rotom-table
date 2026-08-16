import { afterEach, describe, expect, it } from 'vitest'
import type { InventoryActionOfferV1 } from '#shared/itemAutomation/inventoryActions'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteGroupInventoryRepository } from '../../server/storage/groupInventoryRepository'
import { createSqliteInventoryActionOperationRepository } from '../../server/storage/inventoryActionOperationRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { executeGroupInventoryActionUseCase } from '../../server/useCases/executeGroupInventoryAction'
import { loadGroupInventoryActionsUseCase } from '../../server/useCases/loadGroupInventoryActions'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length) databases.pop()!.close()
})

const seed = (database: RotomDatabase): void => {
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({
    kind: 'trainer', slug: 'ash', revision: 3, updatedAt: 10,
    document: {
      slug: 'ash', name: 'Ash', level: 10, revision: 3, updatedAt: 10,
      inventory: { medicalKit: [{ id: 'trainer-bandages', name: 'Bandages', qty: 4 }] },
    },
  })
  sheets.save({
    kind: 'trainer', slug: 'misty', revision: 6, updatedAt: 10,
    document: {
      slug: 'misty', name: 'Misty', level: 10, revision: 6, updatedAt: 10,
      inventory: { medicalKit: [{ id: 'trainer-ether', name: 'Ether', qty: 1 }] },
    },
  })
  createSqliteGroupInventoryRepository(database).save({
    slug: 'main', revision: 2, updatedAt: 10,
    document: {
      slug: 'main', revision: 2, updatedAt: 10, money: 0,
      inventory: { medicalKit: [{ id: 'group-potion', name: 'Potion', qty: 5 }] },
    },
  })
}
const declaration = (offer: InventoryActionOfferV1, operationId: string, quantity: number) => {
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
      .map(requirement => ({
        requirementId: requirement.requirementId,
        expectedRevision: requirement.expectedRevision,
      })),
  }
}

describe('execute group inventory actions through existing transfer handoffs', () => {
  it('projects and executes only Trainers controlled by the selected player profile', () => {
    const database = open()
    seed(database)
    const profile = {
      schemaVersion: 1,
      id: 'profile_fixture01',
      displayName: 'Ash player',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'ash' }],
    } as unknown as PlayerProfile
    const projection = loadGroupInventoryActionsUseCase({
      role: 'player', playerProfile: profile, groupSlug: 'main',
    }, { database, now: () => 100 })
    expect(projection.offers.flatMap(offer => [
      offer.source.containerLabel,
      ...offer.destination.options.map(destination => destination.label),
    ]).join(' ')).toContain('Ash')
    expect(JSON.stringify(projection)).not.toContain('Misty')
    expect(projection.offers.some(offer => offer.source.itemLabel === 'Ether')).toBe(false)
    expect(() => loadGroupInventoryActionsUseCase({
      role: 'player', playerProfile: null, groupSlug: 'main',
    }, { database })).toThrow('Choose a player profile')
  })

  it('moves group inventory to one bounded Trainer destination and exact-replays', () => {
    const database = open()
    seed(database)
    const projection = loadGroupInventoryActionsUseCase({ role: 'gm', groupSlug: 'main' }, { database, now: () => 100 })
    const offer = projection.offers.find(candidate => (
      candidate.source.locationKind === 'group-inventory' && candidate.source.itemLabel === 'Potion'
    ))!
    const command = declaration(offer, `inventory-action:v1:${'1'.repeat(32)}`, 2)

    const accepted = executeGroupInventoryActionUseCase({
      role: 'gm', groupSlug: 'main', declaration: command, clientId: 'client-one',
    }, { database, now: () => 101 })
    expect(accepted.result).toMatchObject({ action: 'transfer', exactReplay: false })
    expect(accepted.groupInventories[0]?.inventory.medicalKit).toEqual([
      expect.objectContaining({ id: 'group-potion', qty: 3 }),
    ])
    expect((accepted.sheets[0]?.sheet as unknown as TrainerSheet).inventory?.medicalKit).toEqual([
      expect.objectContaining({ id: 'trainer-bandages', qty: 4 }),
      expect.objectContaining({ name: 'Potion', qty: 2 }),
    ])
    expect(createSqliteInventoryActionOperationRepository(database).find(command.operationId)).toMatchObject({
      status: 'accepted',
      downstreamCommand: { kind: 'transfer-to-trainer', itemId: 'group-potion' },
    })

    const replay = executeGroupInventoryActionUseCase({
      role: 'gm', groupSlug: 'main', declaration: command,
    }, { database, now: () => 500 })
    expect(replay.result.exactReplay).toBe(true)
    expect(replay.groupInventories[0]?.inventory.medicalKit[0]?.qty).toBe(3)
    expect(() => executeGroupInventoryActionUseCase({
      role: 'gm', groupSlug: 'other', declaration: command,
    }, { database })).toThrow('replay belongs to a different group inventory')
  })

  it('moves an exact Trainer source into group inventory through the same journal', () => {
    const database = open()
    seed(database)
    const projection = loadGroupInventoryActionsUseCase({ role: 'gm', groupSlug: 'main' }, { database, now: () => 100 })
    const offer = projection.offers.find(candidate => (
      candidate.source.locationKind === 'trainer-inventory' && candidate.source.itemLabel === 'Bandages'
    ))!
    const command = declaration(offer, `inventory-action:v1:${'2'.repeat(32)}`, 3)
    const accepted = executeGroupInventoryActionUseCase({
      role: 'gm', groupSlug: 'main', declaration: command,
    }, { database, now: () => 101 })

    expect((accepted.sheets[0]?.sheet as unknown as TrainerSheet).inventory?.medicalKit).toEqual([
      expect.objectContaining({ id: 'trainer-bandages', qty: 1 }),
    ])
    expect(accepted.groupInventories[0]?.inventory.medicalKit).toEqual([
      expect.objectContaining({ id: 'group-potion', qty: 5 }),
      expect.objectContaining({ name: 'Bandages', qty: 3 }),
    ])
    expect(createSqliteInventoryActionOperationRepository(database).find(command.operationId)).toMatchObject({
      status: 'accepted',
      downstreamCommand: { kind: 'transfer-to-group', trainerItemId: 'trainer-bandages' },
    })
  })

  it('rolls both inventory mutations back when the atomic adapter receipt cannot be stored', () => {
    const database = open()
    seed(database)
    const projection = loadGroupInventoryActionsUseCase({ role: 'gm', groupSlug: 'main' }, { database, now: () => 100 })
    const offer = projection.offers.find(candidate => candidate.source.locationKind === 'group-inventory')!
    const command = declaration(offer, `inventory-action:v1:${'3'.repeat(32)}`, 2)
    const repository = createSqliteInventoryActionOperationRepository(database)
    expect(() => executeGroupInventoryActionUseCase({
      role: 'gm', groupSlug: 'main', declaration: command,
    }, {
      database,
      operationRepository: {
        ...repository,
        accept: () => { throw new Error('simulated receipt write failure') },
      },
      now: () => 101,
    })).toThrow('simulated receipt write failure')

    expect(createSqliteGroupInventoryRepository(database).get('main')?.document.inventory.medicalKit).toEqual([
      expect.objectContaining({ id: 'group-potion', qty: 5 }),
    ])
    expect((createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('trainer', 'ash')?.sheet as unknown as TrainerSheet).inventory?.medicalKit).toEqual([
      expect.objectContaining({ id: 'trainer-bandages', qty: 4 }),
    ])
    expect(repository.find(command.operationId)).toMatchObject({ status: 'pending' })
  })
})
