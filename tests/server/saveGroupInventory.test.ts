import { afterEach, describe, expect, it } from 'vitest'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  GROUP_INVENTORY_SECTION_KEYS,
  type GroupInventoryDocument,
} from '~/types/groupInventory'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import {
  SaveGroupInventoryUseCaseError,
  saveGroupInventoryUseCase,
} from '~~/server/useCases/saveGroupInventory'

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

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

describe('save group inventory use case', () => {
  it('lets GMs save changed semantic content with revision protection and normalization', () => {
    const database = openMemoryDatabase()
    const groupInventoryRepository = createSqliteGroupInventoryRepository(database)
    const current = groupInventoryRepository.save({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 2,
      updatedAt: 200,
      document: groupInventoryDocument({ revision: 2, updatedAt: 200, money: 10 }),
    }).document

    const result = saveGroupInventoryUseCase({
      role: 'gm',
      slug: GROUP_INVENTORY_MAIN_SLUG,
      expectedRevision: 2,
      document: {
        ...current,
        money: '300.9',
        notes: '  Party stash  ',
        transientUiState: { expanded: true },
        inventory: {
          ...current.inventory,
          pokemonItems: [
            { id: ' potion-row ', name: ' Potion ', qty: '4.8', editing: true },
          ],
          equipment: [
            { id: ' boots-row ', name: ' Heavy Boots ', qty: 99, slot: ' Feet ', custom: 'ignored' },
          ],
          unknownSection: [{ id: 'unsafe', name: 'Unsafe' }],
        },
      },
    }, {
      groupInventoryRepository,
      now: () => 400,
    })

    expect(result).toEqual({
      ok: true,
      changed: true,
      document: {
        slug: GROUP_INVENTORY_MAIN_SLUG,
        revision: 3,
        updatedAt: 400,
        money: 300,
        notes: 'Party stash',
        inventory: {
          ...emptyInventory(),
          pokemonItems: [{ id: 'potion-row', name: 'Potion', qty: 4 }],
          equipment: [{ id: 'boots-row', name: 'Heavy Boots', slot: 'Feet' }],
        },
      },
    })
    expect(groupInventoryRepository.get()?.document).toEqual(result.document)
  })

  it('returns unchanged without advancing revision when semantic content matches storage', () => {
    const database = openMemoryDatabase()
    const groupInventoryRepository = createSqliteGroupInventoryRepository(database)
    const current = groupInventoryRepository.save({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 5,
      updatedAt: 500,
      document: groupInventoryDocument({
        revision: 5,
        updatedAt: 500,
        money: 125,
        notes: 'Keep this',
      }),
    }).document

    const result = saveGroupInventoryUseCase({
      role: 'gm',
      slug: GROUP_INVENTORY_MAIN_SLUG,
      expectedRevision: 5,
      document: {
        ...current,
        revision: 999,
        updatedAt: 999,
      },
    }, {
      groupInventoryRepository,
      now: () => 900,
    })

    expect(result).toEqual({ ok: true, changed: false, document: current })
    expect(groupInventoryRepository.get()?.document).toEqual(current)
  })

  it('rejects stale expected revisions without overwriting the authoritative document', () => {
    const database = openMemoryDatabase()
    const groupInventoryRepository = createSqliteGroupInventoryRepository(database)
    const current = groupInventoryRepository.save({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 3,
      updatedAt: 300,
      document: groupInventoryDocument({ revision: 3, updatedAt: 300, money: 50 }),
    }).document

    let thrownError: unknown
    try {
      saveGroupInventoryUseCase({
        role: 'gm',
        slug: GROUP_INVENTORY_MAIN_SLUG,
        expectedRevision: 2,
        document: { ...current, money: 999 },
      }, {
        groupInventoryRepository,
        now: () => 400,
      })
    } catch (error) {
      thrownError = error
    }

    expect(thrownError).toBeInstanceOf(SaveGroupInventoryUseCaseError)
    expect(thrownError).toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('reload before saving'),
    })
    expect(groupInventoryRepository.get()?.document).toEqual(current)
  })

  it('rejects player saves', () => {
    const database = openMemoryDatabase()
    const groupInventoryRepository = createSqliteGroupInventoryRepository(database)

    expect(() => saveGroupInventoryUseCase({
      role: 'player',
      slug: GROUP_INVENTORY_MAIN_SLUG,
      expectedRevision: 0,
      document: groupInventoryDocument(),
    }, { groupInventoryRepository })).toThrow('Only GMs can save group inventory')
  })

  it('validates slug, expected revision, and matching document slug before saving', () => {
    const database = openMemoryDatabase()
    const groupInventoryRepository = createSqliteGroupInventoryRepository(database)

    expect(() => saveGroupInventoryUseCase({
      role: 'gm',
      slug: '../bad',
      expectedRevision: 0,
      document: groupInventoryDocument(),
    }, { groupInventoryRepository })).toThrow('group inventory slug must match /^[a-z0-9-]+$/')

    expect(() => saveGroupInventoryUseCase({
      role: 'gm',
      slug: GROUP_INVENTORY_MAIN_SLUG,
      expectedRevision: -1,
      document: groupInventoryDocument(),
    }, { groupInventoryRepository })).toThrow('expectedRevision must be a safe non-negative integer')

    expect(() => saveGroupInventoryUseCase({
      role: 'gm',
      slug: GROUP_INVENTORY_MAIN_SLUG,
      expectedRevision: 0,
      document: { ...groupInventoryDocument(), slug: 'other' },
    }, { groupInventoryRepository })).toThrow('document.slug "other" must match request slug "main"')
  })
})
