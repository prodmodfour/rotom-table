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
  TransferTrainerInventoryToGroupUseCaseError,
  transferTrainerInventoryToGroupUseCase,
} from '~~/server/useCases/transferTrainerInventoryToGroup'

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
    expect(error).toBeInstanceOf(TransferTrainerInventoryToGroupUseCaseError)
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

describe('trainer inventory to group inventory transfer use case', () => {
  it('atomically transfers stackable trainer inventory quantities into the group inventory', () => {
    const database = openMemoryDatabase()
    const groupInventory = seedGroupInventory(database, groupInventoryDocument({
      revision: 3,
      updatedAt: 300,
      inventory: {
        ...emptyInventory(),
        pokemonItems: [{ id: 'group-potion-row', name: 'pótîon', qty: 2, description: 'Existing group notes' }],
      },
    }))
    const trainer = seedTrainer(database, trainerSheetDocument({
      inventory: {
        ...emptyInventory(),
        pokemonItems: [{ name: 'Potion', qty: 5, cost: '$200' }],
      },
    }), 8, 800)
    const realtimeEventRepository = createSqliteRealtimeEventRepository({ database, clock: () => 901 })
    const published: PersistedRealtimeEvent[] = []

    const response = transferTrainerInventoryToGroupUseCase({
      role: 'gm',
      trainerSlug: trainer.slug,
      trainerRevision: trainer.revision,
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      section: 'pokemonItems',
      trainerRowIndex: 0,
      quantity: 3,
      clientId: 'client-transfer',
    }, {
      database,
      realtimeEventRepository,
      now: () => 900,
      publishPersistedRealtimeEvent: (event) => published.push(event),
    })

    expect(response.ok).toBe(true)
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
      { name: 'Potion', qty: 2, cost: '$200' },
    ])
    expect(response.groupInventory).toMatchObject({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 4,
      updatedAt: 900,
    })
    expect(response.groupInventory.inventory.pokemonItems).toEqual([
      { id: 'group-potion-row', name: 'pótîon', qty: 5, description: 'Existing group notes' },
    ])
    expect(storedGroupInventoryJson(database)).toEqual(response.groupInventory)
    expect((storedTrainerJson(database).inventory as TrainerSheet['inventory'])?.pokemonItems).toEqual([
      { name: 'Potion', qty: 2, cost: '$200' },
    ])
    expect(published.map((event) => event.event.channel)).toEqual([
      'sheet:trainer:misty',
      'sheets',
      'group-inventory:main',
    ])
    expect(published.map((event) => event.access)).toEqual([
      { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: 'misty' },
      { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: 'misty' },
      { kind: 'group-inventory-access', groupSlug: GROUP_INVENTORY_MAIN_SLUG },
    ])
    expect(published[0]?.event).toMatchObject({
      type: 'updated',
      clientId: 'client-transfer',
      timestamp: 901,
      data: { kind: 'trainer', slug: 'misty', sheet: response.trainerSheet.sheet },
    })
    expect(published[2]?.event).toMatchObject({
      type: 'updated',
      revision: response.groupInventory.revision,
      clientId: 'client-transfer',
      timestamp: 901,
      data: { slug: GROUP_INVENTORY_MAIN_SLUG, document: response.groupInventory },
    })
  })

  it('moves trainer equipment as whole rows into group inventory rows with stable IDs', () => {
    const database = openMemoryDatabase()
    const groupInventory = seedGroupInventory(database, groupInventoryDocument({ revision: 1, updatedAt: 100 }))
    const trainer = seedTrainer(database, trainerSheetDocument({
      inventory: {
        ...emptyInventory(),
        equipment: [{ name: 'Fishing Rod', slot: 'Main Hand', cost: '$500' }],
      },
    }), 2, 200)

    const response = transferTrainerInventoryToGroupUseCase({
      role: 'gm',
      trainerSlug: trainer.slug,
      trainerRevision: trainer.revision,
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      section: 'equipment',
      trainerRowIndex: 0,
      quantity: 1,
    }, {
      database,
      createTargetGroupRowId: ({ section, index }) => `target-${section}-${index}`,
      now: () => 300,
    })

    expect((response.trainerSheet.sheet.inventory as TrainerSheet['inventory'])?.equipment).toEqual([])
    expect(response.groupInventory.inventory.equipment).toEqual([
      { id: 'target-equipment-0', name: 'Fishing Rod', slot: 'Main Hand', cost: '$500' },
    ])
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
    const trainer = seedTrainer(database, trainerSheetDocument({
      inventory: {
        ...emptyInventory(),
        keyItems: [{ name: 'Bike Voucher', qty: 1 }],
      },
    }), 5, 500)
    const groupBefore = storedGroupInventoryJson(database)
    const trainerBefore = storedTrainerJson(database)

    expectTransferUseCaseError(() => transferTrainerInventoryToGroupUseCase({
      role: 'gm',
      trainerSlug: trainer.slug,
      trainerRevision: 4,
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      section: 'keyItems',
      trainerRowIndex: 0,
      quantity: 1,
    }, { database, now: () => 600 }), 409, 'Trainer sheet misty changed')

    expect(storedGroupInventoryJson(database)).toEqual(groupBefore)
    expect(storedTrainerJson(database)).toEqual(trainerBefore)
  })

  it('rejects stale group revisions before changing either document', () => {
    const database = openMemoryDatabase()
    const groupInventory = seedGroupInventory(database, groupInventoryDocument({ revision: 2, updatedAt: 200 }))
    const trainer = seedTrainer(database, trainerSheetDocument({
      inventory: {
        ...emptyInventory(),
        keyItems: [{ name: 'Bike Voucher', qty: 1 }],
      },
    }), 5, 500)
    const groupBefore = storedGroupInventoryJson(database)
    const trainerBefore = storedTrainerJson(database)

    expectTransferUseCaseError(() => transferTrainerInventoryToGroupUseCase({
      role: 'gm',
      trainerSlug: trainer.slug,
      trainerRevision: trainer.revision,
      groupSlug: groupInventory.slug,
      groupRevision: 1,
      section: 'keyItems',
      trainerRowIndex: 0,
      quantity: 1,
    }, { database, now: () => 600 }), 409, 'Group inventory main changed')

    expect(storedGroupInventoryJson(database)).toEqual(groupBefore)
    expect(storedTrainerJson(database)).toEqual(trainerBefore)
  })

  it('rejects invalid quantity, missing rows, missing group inventories, and equipment partial transfers clearly', () => {
    const database = openMemoryDatabase()
    const groupInventory = seedGroupInventory(database, groupInventoryDocument({ revision: 1, updatedAt: 100 }))
    const trainer = seedTrainer(database, trainerSheetDocument({
      inventory: {
        ...emptyInventory(),
        medicalKit: [{ name: 'Potion', qty: 1 }],
        equipment: [{ name: 'Bike', slot: 'Accessory' }],
      },
    }), 2, 200)
    const groupBefore = storedGroupInventoryJson(database)
    const trainerBefore = storedTrainerJson(database)

    expectTransferUseCaseError(() => transferTrainerInventoryToGroupUseCase({
      role: 'gm',
      trainerSlug: trainer.slug,
      trainerRevision: trainer.revision,
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      section: 'medicalKit',
      trainerRowIndex: 0,
      quantity: 0,
    }, { database }), 400, 'positive integer')

    expectTransferUseCaseError(() => transferTrainerInventoryToGroupUseCase({
      role: 'gm',
      trainerSlug: trainer.slug,
      trainerRevision: trainer.revision,
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      section: 'medicalKit',
      trainerRowIndex: 4,
      quantity: 1,
    }, { database }), 404, 'source inventory row was not found')

    expectTransferUseCaseError(() => transferTrainerInventoryToGroupUseCase({
      role: 'gm',
      trainerSlug: trainer.slug,
      trainerRevision: trainer.revision,
      groupSlug: 'missing-group',
      groupRevision: 0,
      section: 'medicalKit',
      trainerRowIndex: 0,
      quantity: 1,
    }, { database }), 404, 'Group inventory missing-group not found')

    expectTransferUseCaseError(() => transferTrainerInventoryToGroupUseCase({
      role: 'gm',
      trainerSlug: 'missing-trainer',
      trainerRevision: 0,
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      section: 'medicalKit',
      trainerRowIndex: 0,
      quantity: 1,
    }, { database }), 404, 'Trainer sheet missing-trainer.json not found')

    expectTransferUseCaseError(() => transferTrainerInventoryToGroupUseCase({
      role: 'gm',
      trainerSlug: trainer.slug,
      trainerRevision: trainer.revision,
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      section: 'equipment',
      trainerRowIndex: 0,
      quantity: 2,
    }, { database }), 400, 'whole row')

    expect(storedGroupInventoryJson(database)).toEqual(groupBefore)
    expect(storedTrainerJson(database)).toEqual(trainerBefore)
  })

  it('rolls back the trainer sheet update when the group inventory write fails', () => {
    const database = openMemoryDatabase()
    const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
    const groupRepository = createSqliteGroupInventoryRepository(database)
    const groupInventory = groupRepository.save({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 1,
      updatedAt: 100,
      document: groupInventoryDocument({ revision: 1, updatedAt: 100 }),
    }).document
    sheetRepository.save({
      kind: 'trainer',
      slug: 'misty',
      revision: 2,
      updatedAt: 200,
      document: trainerSheetDocument({
        revision: 2,
        updatedAt: 200,
        inventory: {
          ...emptyInventory(),
          foodStuff: [{ name: 'Lava Cookie', qty: 2 }],
        },
      }),
    })
    const trainer = sheetRepository.getByRef('trainer', 'misty')
    if (!trainer) throw new Error('Expected seeded trainer')
    const groupBefore = storedGroupInventoryJson(database)
    const trainerBefore = storedTrainerJson(database)

    expect(() => transferTrainerInventoryToGroupUseCase({
      role: 'gm',
      trainerSlug: trainer.slug,
      trainerRevision: trainer.revision,
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      section: 'foodStuff',
      trainerRowIndex: 0,
      quantity: 1,
    }, {
      database,
      sheetRepository,
      groupInventoryRepository: {
        database,
        get: groupRepository.get,
        applyLivePlayUpdate: () => {
          throw new Error('forced group write failure')
        },
      },
      now: () => 300,
    })).toThrow('forced group write failure')

    expect(storedGroupInventoryJson(database)).toEqual(groupBefore)
    expect(storedTrainerJson(database)).toEqual(trainerBefore)
  })

  it('allows a player with a linked trainer profile to transfer that trainer inventory to the group', () => {
    const database = openMemoryDatabase()
    const groupInventory = seedGroupInventory(database, groupInventoryDocument({ revision: 1, updatedAt: 100 }))
    const trainer = seedTrainer(database, trainerSheetDocument({
      inventory: {
        ...emptyInventory(),
        medicalKit: [{ name: 'Potion', qty: 2 }],
      },
    }), 2, 200)

    const response = transferTrainerInventoryToGroupUseCase({
      role: 'player',
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: trainer.slug }]),
      trainerSlug: trainer.slug,
      trainerRevision: trainer.revision,
      groupSlug: groupInventory.slug,
      groupRevision: groupInventory.revision,
      section: 'medicalKit',
      trainerRowIndex: 0,
      quantity: 1,
    }, {
      database,
      createTargetGroupRowId: ({ section, index }) => `target-${section}-${index}`,
      now: () => 300,
    })

    expect(response.trainerSheet.sheet.revision).toBe(3)
    expect((response.trainerSheet.sheet.inventory as TrainerSheet['inventory'])?.medicalKit).toEqual([
      { name: 'Potion', qty: 1 },
    ])
    expect(response.groupInventory.revision).toBe(2)
    expect(response.groupInventory.inventory.medicalKit).toEqual([
      { id: 'target-medicalKit-0', name: 'Potion', qty: 1 },
    ])
  })

  it('requires player transfers to include a selected profile linked to the source trainer', () => {
    const transferInput = {
      role: 'player' as const,
      trainerSlug: 'misty',
      trainerRevision: 0,
      groupSlug: GROUP_INVENTORY_MAIN_SLUG,
      groupRevision: 0,
      section: 'keyItems',
      trainerRowIndex: 0,
      quantity: 1,
    }

    expectTransferUseCaseError(() => transferTrainerInventoryToGroupUseCase({
      ...transferInput,
      playerProfile: null,
    }), 403, 'Choose a player profile')

    expectTransferUseCaseError(() => transferTrainerInventoryToGroupUseCase({
      ...transferInput,
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'brock' }]),
    }), 403, 'Trainer sheet misty is not linked')
  })
})
