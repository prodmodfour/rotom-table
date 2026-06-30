import { afterEach, describe, expect, it } from 'vitest'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  GROUP_INVENTORY_SECTION_KEYS,
  type GroupInventoryDocument,
} from '~/types/groupInventory'
import type { TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteSheetRepository, type PersistedSheet } from '~~/server/storage/sheetRepository'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import {
  TransferGroupInventoryToTrainerUseCaseError,
  transferGroupInventoryToTrainerUseCase,
} from '~~/server/useCases/transferGroupInventoryToTrainer'

const openDatabases: RotomDatabase[] = []

const openMemoryDatabase = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  openDatabases.push(database)
  return database
}

const emptyInventory = () => Object.fromEntries(
  GROUP_INVENTORY_SECTION_KEYS.map((section) => [section, []]),
) as unknown as GroupInventoryDocument['inventory']

const groupInventoryDocument = (
  overrides: Partial<GroupInventoryDocument> = {},
): GroupInventoryDocument => ({
  slug: GROUP_INVENTORY_MAIN_SLUG,
  revision: 0,
  updatedAt: 100,
  money: 0,
  inventory: emptyInventory(),
  ...overrides,
})

const trainerSheetDocument = (
  overrides: Partial<TrainerSheet> & Record<string, unknown> = {},
): TrainerSheet & Record<string, unknown> => ({
  slug: 'misty',
  name: 'Misty',
  level: 1,
  inventory: emptyInventory(),
  ...overrides,
})

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_ash00000' as PlayerProfileId,
  displayName: 'Ash' as PlayerProfileDisplayName,
  linkedCharacters,
})

const storedGroupInventoryJson = (database: RotomDatabase): GroupInventoryDocument => {
  const row = database.connection.prepare(`
    SELECT document_json
    FROM group_inventories
    WHERE slug = ?
  `).get(GROUP_INVENTORY_MAIN_SLUG) as { readonly document_json?: unknown } | undefined
  if (!row || typeof row.document_json !== 'string') throw new Error('Missing group inventory')
  return JSON.parse(row.document_json) as GroupInventoryDocument
}

const storedTrainerJson = (database: RotomDatabase, slug = 'misty'): Record<string, unknown> => {
  const row = database.connection.prepare(`
    SELECT document_json
    FROM sheets
    WHERE kind = 'trainer' AND slug = ?
  `).get(slug) as { readonly document_json?: unknown } | undefined
  if (!row || typeof row.document_json !== 'string') throw new Error(`Missing trainer ${slug}`)
  return JSON.parse(row.document_json) as Record<string, unknown>
}

const expectTransferUseCaseError = (
  action: () => unknown,
  statusCode: number,
  message: string,
): void => {
  try {
    action()
    throw new Error('Expected transfer use case to throw')
  } catch (error) {
    expect(error).toBeInstanceOf(TransferGroupInventoryToTrainerUseCaseError)
    expect(error).toMatchObject({
      statusCode,
      message: expect.stringContaining(message),
    })
  }
}

const seedGroupInventory = (
  database: RotomDatabase,
  document: GroupInventoryDocument,
): GroupInventoryDocument => createSqliteGroupInventoryRepository(database).save({
  slug: document.slug,
  revision: document.revision,
  updatedAt: document.updatedAt,
  document,
}).document

const seedTrainer = (
  database: RotomDatabase,
  document: TrainerSheet,
  revision: number,
  updatedAt: number,
): PersistedSheet => {
  const repository = createSqliteSheetRepository<Record<string, unknown>>(database)
  repository.save({
    kind: 'trainer',
    slug: document.slug,
    revision,
    updatedAt,
    document: {
      ...document,
      revision,
      updatedAt,
    },
  })
  const persisted = repository.getByRef('trainer', document.slug)
  if (!persisted) throw new Error(`Trainer ${document.slug} was not persisted`)
  return persisted
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

describe('group inventory to trainer transfer use case', () => {
  it('atomically transfers stackable group inventory quantities into a trainer sheet', () => {
    const database = openMemoryDatabase()
    const groupInventory = seedGroupInventory(database, groupInventoryDocument({
      revision: 3,
      updatedAt: 300,
      inventory: {
        ...emptyInventory(),
        pokemonItems: [{ id: 'group-potion-row', name: 'Potion', qty: 5, cost: '$200' }],
      },
    }))
    const trainer = seedTrainer(database, trainerSheetDocument({
      inventory: {
        ...emptyInventory(),
        pokemonItems: [{ name: 'pótîon', qty: 2, description: 'Existing trainer notes' }],
      },
    }), 8, 800)
    const realtimeEventRepository = createSqliteRealtimeEventRepository({ database, clock: () => 901 })
    const published: PersistedRealtimeEvent[] = []

    const response = transferGroupInventoryToTrainerUseCase({
      role: 'gm',
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      trainerSlug: trainer.slug,
      trainerRevision: trainer.revision,
      section: 'pokemonItems',
      itemId: 'group-potion-row',
      quantity: 3,
      clientId: 'client-transfer',
    }, {
      database,
      realtimeEventRepository,
      now: () => 900,
      publishPersistedRealtimeEvent: (event) => published.push(event),
    })

    expect(response.ok).toBe(true)
    expect(response.groupInventory).toMatchObject({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 4,
      updatedAt: 900,
    })
    expect(response.groupInventory.inventory.pokemonItems).toEqual([
      { id: 'group-potion-row', name: 'Potion', qty: 2, cost: '$200' },
    ])
    expect(response.trainerSheet).toMatchObject({
      kind: 'trainer',
      slug: 'misty',
      sheet: {
        slug: 'misty',
        revision: 9,
        updatedAt: 900,
      },
    })
    expect((response.trainerSheet.sheet.inventory as TrainerSheet['inventory'])?.pokemonItems).toEqual([
      { name: 'pótîon', qty: 5, description: 'Existing trainer notes' },
    ])
    expect(storedGroupInventoryJson(database)).toEqual(response.groupInventory)
    expect((storedTrainerJson(database).inventory as TrainerSheet['inventory'])?.pokemonItems).toEqual([
      { name: 'pótîon', qty: 5, description: 'Existing trainer notes' },
    ])
    expect(published.map((event) => event.event.channel)).toEqual([
      'group-inventory:main',
      'sheet:trainer:misty',
      'sheets',
    ])
    expect(published.map((event) => event.access)).toEqual([
      { kind: 'group-inventory-access', groupSlug: GROUP_INVENTORY_MAIN_SLUG },
      { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: 'misty' },
      { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: 'misty' },
    ])
    expect(published[0]?.event).toMatchObject({
      type: 'updated',
      revision: response.groupInventory.revision,
      clientId: 'client-transfer',
      timestamp: 901,
      data: { slug: GROUP_INVENTORY_MAIN_SLUG, document: response.groupInventory },
    })
    expect(published[1]?.event).toMatchObject({
      type: 'updated',
      clientId: 'client-transfer',
      timestamp: 901,
      data: { kind: 'trainer', slug: 'misty', sheet: response.trainerSheet.sheet },
    })
  })

  it('rejects stale group revisions before changing either document', () => {
    const database = openMemoryDatabase()
    const groupInventory = seedGroupInventory(database, groupInventoryDocument({
      revision: 2,
      updatedAt: 200,
      inventory: {
        ...emptyInventory(),
        keyItems: [{ id: 'group-map-row', name: 'Town Map', qty: 1 }],
      },
    }))
    const trainer = seedTrainer(database, trainerSheetDocument(), 5, 500)
    const trainerBefore = storedTrainerJson(database)

    expectTransferUseCaseError(() => transferGroupInventoryToTrainerUseCase({
      role: 'gm',
      groupSlug: groupInventory.slug,
      groupRevision: 1,
      trainerSlug: trainer.slug,
      trainerRevision: trainer.revision,
      section: 'keyItems',
      itemId: 'group-map-row',
      quantity: 1,
    }, { database, now: () => 600 }), 409, 'Group inventory main changed')

    expect(storedGroupInventoryJson(database)).toEqual(groupInventory)
    expect(storedTrainerJson(database)).toEqual(trainerBefore)
  })

  it('rejects stale trainer revisions before changing either document', () => {
    const database = openMemoryDatabase()
    const groupInventory = seedGroupInventory(database, groupInventoryDocument({
      revision: 2,
      updatedAt: 200,
      inventory: {
        ...emptyInventory(),
        keyItems: [{ id: 'group-map-row', name: 'Town Map', qty: 1 }],
      },
    }))
    const trainer = seedTrainer(database, trainerSheetDocument(), 5, 500)
    const groupBefore = storedGroupInventoryJson(database)
    const trainerBefore = storedTrainerJson(database)

    expectTransferUseCaseError(() => transferGroupInventoryToTrainerUseCase({
      role: 'gm',
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      trainerSlug: trainer.slug,
      trainerRevision: 4,
      section: 'keyItems',
      itemId: 'group-map-row',
      quantity: 1,
    }, { database, now: () => 600 }), 409, 'Trainer sheet misty changed')

    expect(storedGroupInventoryJson(database)).toEqual(groupBefore)
    expect(storedTrainerJson(database)).toEqual(trainerBefore)
  })

  it('rejects invalid quantity, missing rows, missing trainers, and equipment partial transfers clearly', () => {
    const database = openMemoryDatabase()
    const groupInventory = seedGroupInventory(database, groupInventoryDocument({
      revision: 1,
      updatedAt: 100,
      inventory: {
        ...emptyInventory(),
        medicalKit: [{ id: 'group-potion-row', name: 'Potion', qty: 1 }],
        equipment: [{ id: 'group-bike-row', name: 'Bike', slot: 'Accessory' }],
      },
    }))
    const trainer = seedTrainer(database, trainerSheetDocument(), 2, 200)
    const groupBefore = storedGroupInventoryJson(database)
    const trainerBefore = storedTrainerJson(database)

    expectTransferUseCaseError(() => transferGroupInventoryToTrainerUseCase({
      role: 'gm',
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      trainerSlug: trainer.slug,
      trainerRevision: trainer.revision,
      section: 'medicalKit',
      itemId: 'group-potion-row',
      quantity: 0,
    }, { database }), 400, 'positive integer')

    expectTransferUseCaseError(() => transferGroupInventoryToTrainerUseCase({
      role: 'gm',
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      trainerSlug: trainer.slug,
      trainerRevision: trainer.revision,
      section: 'medicalKit',
      itemId: 'missing-row',
      quantity: 1,
    }, { database }), 404, 'source inventory row was not found')

    expectTransferUseCaseError(() => transferGroupInventoryToTrainerUseCase({
      role: 'gm',
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      trainerSlug: 'missing-trainer',
      trainerRevision: 0,
      section: 'medicalKit',
      itemId: 'group-potion-row',
      quantity: 1,
    }, { database }), 404, 'Trainer sheet missing-trainer.json not found')

    expectTransferUseCaseError(() => transferGroupInventoryToTrainerUseCase({
      role: 'gm',
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      trainerSlug: trainer.slug,
      trainerRevision: trainer.revision,
      section: 'equipment',
      itemId: 'group-bike-row',
      quantity: 2,
    }, { database }), 400, 'whole row')

    expect(storedGroupInventoryJson(database)).toEqual(groupBefore)
    expect(storedTrainerJson(database)).toEqual(trainerBefore)
  })

  it('rolls back the group inventory update when the trainer sheet write fails', () => {
    const database = openMemoryDatabase()
    const groupRepository = createSqliteGroupInventoryRepository(database)
    const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
    const groupInventory = groupRepository.save({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 1,
      updatedAt: 100,
      document: groupInventoryDocument({
        revision: 1,
        updatedAt: 100,
        inventory: {
          ...emptyInventory(),
          foodStuff: [{ id: 'group-cookie-row', name: 'Lava Cookie', qty: 2 }],
        },
      }),
    }).document
    sheetRepository.save({
      kind: 'trainer',
      slug: 'misty',
      revision: 2,
      updatedAt: 200,
      document: trainerSheetDocument({ revision: 2, updatedAt: 200 }),
    })
    const trainer = sheetRepository.getByRef('trainer', 'misty')
    if (!trainer) throw new Error('Expected seeded trainer')
    const groupBefore = storedGroupInventoryJson(database)
    const trainerBefore = storedTrainerJson(database)

    expect(() => transferGroupInventoryToTrainerUseCase({
      role: 'gm',
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      trainerSlug: trainer.slug,
      trainerRevision: trainer.revision,
      section: 'foodStuff',
      itemId: 'group-cookie-row',
      quantity: 1,
    }, {
      database,
      groupInventoryRepository: groupRepository,
      sheetRepository: {
        database,
        getByRef: sheetRepository.getByRef,
        applyLivePlayUpdate: () => {
          throw new Error('forced trainer write failure')
        },
      },
      now: () => 300,
    })).toThrow('forced trainer write failure')

    expect(storedGroupInventoryJson(database)).toEqual(groupBefore)
    expect(storedTrainerJson(database)).toEqual(trainerBefore)
  })

  it('allows a player with a linked trainer profile to transfer group inventory to that trainer', () => {
    const database = openMemoryDatabase()
    const groupInventory = seedGroupInventory(database, groupInventoryDocument({
      revision: 1,
      updatedAt: 100,
      inventory: {
        ...emptyInventory(),
        medicalKit: [{ id: 'group-potion-row', name: 'Potion', qty: 2 }],
      },
    }))
    const trainer = seedTrainer(database, trainerSheetDocument(), 2, 200)

    const response = transferGroupInventoryToTrainerUseCase({
      role: 'player',
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: trainer.slug }]),
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      trainerSlug: trainer.slug,
      trainerRevision: trainer.revision,
      section: 'medicalKit',
      itemId: 'group-potion-row',
      quantity: 1,
    }, {
      database,
      now: () => 300,
    })

    expect(response.groupInventory.revision).toBe(2)
    expect(response.trainerSheet.sheet.revision).toBe(3)
    expect((response.trainerSheet.sheet.inventory as TrainerSheet['inventory'])?.medicalKit).toEqual([
      { name: 'Potion', qty: 1 },
    ])
  })

  it('requires player transfers to include a selected profile linked to the target trainer', () => {
    const transferInput = {
      role: 'player' as const,
      groupSlug: GROUP_INVENTORY_MAIN_SLUG,
      groupRevision: 0,
      trainerSlug: 'misty',
      trainerRevision: 0,
      section: 'keyItems',
      itemId: 'row-1',
      quantity: 1,
    }

    expectTransferUseCaseError(() => transferGroupInventoryToTrainerUseCase({
      ...transferInput,
      playerProfile: null,
    }), 403, 'Choose a player profile')

    expectTransferUseCaseError(() => transferGroupInventoryToTrainerUseCase({
      ...transferInput,
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'brock' }]),
    }), 403, 'Trainer sheet misty is not linked')
  })
})
