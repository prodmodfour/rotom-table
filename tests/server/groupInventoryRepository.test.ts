import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  GROUP_INVENTORY_SECTION_KEYS,
  type GroupInventoryDocument,
} from '~/types/groupInventory'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'

const openDatabases: RotomDatabase[] = []

const openMemoryDatabase = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  openDatabases.push(database)
  return database
}

const emptyInventory = () => Object.fromEntries(
  GROUP_INVENTORY_SECTION_KEYS.map((section) => [section, []]),
) as unknown as GroupInventoryDocument['inventory']

const rawGroupInventoryJson = (connection: DatabaseSync, slug = GROUP_INVENTORY_MAIN_SLUG): GroupInventoryDocument => {
  const row = connection.prepare('SELECT document_json FROM group_inventories WHERE slug = ?').get(slug)
  if (!row || typeof row.document_json !== 'string') throw new Error(`Missing group inventory row ${slug}`)
  return JSON.parse(row.document_json) as GroupInventoryDocument
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

describe('SQLite group inventory repository', () => {
  it('creates the default main document and reads it back', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteGroupInventoryRepository(database)

    expect(repository.get()).toBeNull()

    const created = repository.getOrCreate({ now: 100 })

    expect(created).toEqual({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 0,
      updatedAt: 100,
      document: {
        slug: GROUP_INVENTORY_MAIN_SLUG,
        revision: 0,
        updatedAt: 100,
        money: 0,
        inventory: emptyInventory(),
      },
    })
    expect(repository.get()).toEqual(created)
    expect(repository.getOrCreate({ now: 200 })).toEqual(created)
  })

  it('normalizes documents before saving and persistence', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteGroupInventoryRepository(database)

    const saved = repository.save({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 2,
      updatedAt: 200,
      document: {
        slug: 'spoofed-slug',
        revision: 99,
        updatedAt: 999,
        money: '1500.8',
        notes: '  Party stash  ',
        unsafeClientState: { expanded: true },
        inventory: {
          pokemonItems: [
            { id: ' potion-row ', name: ' Potion ', qty: '2.9', editing: true },
          ],
          equipment: [
            { id: ' boots-row ', name: ' Heavy Boots ', qty: 5, slot: ' Feet ', custom: 'ignored' },
          ],
          unknownSection: [{ name: 'Should not persist' }],
        },
      },
    })

    expect(saved.document).toEqual({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 2,
      updatedAt: 200,
      money: 1500,
      notes: 'Party stash',
      inventory: {
        ...emptyInventory(),
        pokemonItems: [{ id: 'potion-row', name: 'Potion', qty: 2 }],
        equipment: [{ id: 'boots-row', name: 'Heavy Boots', slot: 'Feet' }],
      },
    })
    expect(repository.get()?.document).toEqual(saved.document)
    expect(rawGroupInventoryJson(database.connection)).toEqual(saved.document)
  })

  it('returns an unchanged setup result when semantic content matches storage', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteGroupInventoryRepository(database)
    const current = repository.getOrCreate({ now: 100 }).document

    const result = repository.replaceSetupInventory({
      expectedRevision: current.revision,
      now: 200,
      document: {
        ...current,
        revision: 999,
        updatedAt: 999,
      },
    })

    expect(result.stale).toBe(false)
    if (result.stale) throw new Error('Expected setup replacement not to be stale')
    expect(result.changed).toBe(false)
    expect(result.document).toEqual(current)
    expect(repository.get()?.document).toEqual(current)
  })

  it('increments revision when a setup replacement changes semantic content', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteGroupInventoryRepository(database)
    const current = repository.getOrCreate({ now: 100 }).document

    const result = repository.replaceSetupInventory({
      expectedRevision: current.revision,
      now: 250,
      document: {
        ...current,
        money: 500,
        notes: '  Found in Viridian Forest  ',
      },
    })

    expect(result.stale).toBe(false)
    if (result.stale) throw new Error('Expected setup replacement not to be stale')
    expect(result.changed).toBe(true)
    expect(result.document).toEqual({
      ...current,
      revision: 1,
      updatedAt: 250,
      money: 500,
      notes: 'Found in Viridian Forest',
    })
    expect(repository.get()?.document).toEqual(result.document)
  })

  it('returns stale for setup replacements with an outdated expected revision', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteGroupInventoryRepository(database)
    const current = repository.save({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 3,
      updatedAt: 300,
      document: {
        slug: GROUP_INVENTORY_MAIN_SLUG,
        revision: 3,
        updatedAt: 300,
        money: 25,
        inventory: emptyInventory(),
      },
    }).document

    const result = repository.replaceSetupInventory({
      expectedRevision: 2,
      now: 400,
      document: { ...current, money: 999 },
    })

    expect(result).toEqual({ stale: true, current })
    expect(repository.get()?.document).toEqual(current)
  })

  it('applies live-play updates only when expected revision matches and normalizes payloads', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteGroupInventoryRepository(database)
    const current = repository.save({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 4,
      updatedAt: 400,
      document: {
        slug: GROUP_INVENTORY_MAIN_SLUG,
        revision: 4,
        updatedAt: 400,
        money: 10,
        inventory: emptyInventory(),
      },
    }).document

    const stale = repository.applyLivePlayUpdate({
      expectedRevision: 3,
      now: 500,
      nextDocument: { ...current, money: 999 },
    })

    expect(stale).toEqual({ status: 'stale', current })
    expect(repository.get()?.document).toEqual(current)

    const applied = repository.applyLivePlayUpdate({
      expectedRevision: 4,
      nextDocument: {
        slug: 'spoofed-slug',
        revision: 100,
        updatedAt: 600,
        money: '42',
        inventory: {
          keyItems: [
            { id: ' town-map ', name: ' Town Map ', qty: '3' },
          ],
        },
      },
    })

    expect(applied.status).toBe('applied')
    if (applied.status !== 'applied') throw new Error('Expected live-play update to apply')
    expect(applied.document).toEqual({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 5,
      updatedAt: 600,
      money: 42,
      inventory: {
        ...emptyInventory(),
        keyItems: [{ id: 'town-map', name: 'Town Map', qty: 3 }],
      },
    })
    expect(repository.get()?.document).toEqual(applied.document)
    expect(rawGroupInventoryJson(database.connection)).toEqual(applied.document)
  })
})
