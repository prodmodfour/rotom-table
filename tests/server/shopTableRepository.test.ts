import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { ShopTableDocument } from '~/types/shop'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteShopTableRepository } from '~~/server/storage/shopTableRepository'

const openDatabases: RotomDatabase[] = []

const openMemoryDatabase = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  openDatabases.push(database)
  return database
}

const rawShopJson = (connection: DatabaseSync, slug: string): ShopTableDocument => {
  const row = connection.prepare('SELECT document_json FROM shop_tables WHERE slug = ?').get(slug)
  if (!row || typeof row.document_json !== 'string') throw new Error(`Missing shop table row ${slug}`)
  return JSON.parse(row.document_json) as ShopTableDocument
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

describe('SQLite shop table repository', () => {
  it('creates normalized shop documents and reads authoritative fields back', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteShopTableRepository(database)

    expect(repository.get('viridian-mart')).toBeNull()

    const created = repository.create({
      slug: 'viridian-mart',
      now: 100,
      document: {
        slug: 'spoofed-slug',
        revision: 99,
        updatedAt: 999,
        name: '  Viridian Mart  ',
        description: '  Field supplies.  ',
        playerVisible: 'true',
        open: 1,
        allowedPaymentSources: ['groupInventory', 'trainer', 'unknown-source'],
        entries: [
          {
            id: ' potion-row ',
            itemName: '  Potion  ',
            section: 'Medicine',
            price: '300.9',
            stock: '5.2',
            gmNotes: '  Back room discount.  ',
          },
        ],
      },
    })

    expect(created).toEqual({
      slug: 'viridian-mart',
      revision: 0,
      updatedAt: 100,
      document: {
        slug: 'viridian-mart',
        revision: 0,
        updatedAt: 100,
        name: 'Viridian Mart',
        description: 'Field supplies.',
        playerVisible: true,
        open: true,
        allowedPaymentSources: ['groupInventory', 'trainer'],
        allowedDeliveryTargets: ['trainer'],
        entries: [
          {
            id: 'potion-row',
            itemName: 'Potion',
            section: 'medicalKit',
            price: 300,
            stock: 5,
            gmNotes: 'Back room discount.',
          },
        ],
      },
    })
    expect(repository.get('viridian-mart')).toEqual(created)
    expect(rawShopJson(database.connection, 'viridian-mart')).toEqual(created.document)
  })

  it('lists shops in slug order and allocates unique slugs from display names', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteShopTableRepository(database)

    expect(repository.allocateSlug('Viridian Mart')).toBe('viridian-mart')
    const viridian = repository.create({ slug: 'viridian-mart', now: 100, name: 'Viridian Mart' })
    expect(repository.allocateSlug('Viridian Mart')).toBe('viridian-mart-1')
    const allocated = repository.create({ baseSlug: 'Viridian Mart', now: 150, document: { name: '  Viridian Mart Annex  ' } })
    const pewter = repository.create({ slug: 'pewter-mart', now: 200, name: 'Pewter Mart' })

    expect(allocated.slug).toBe('viridian-mart-1')
    expect(repository.list()).toEqual([pewter, viridian, allocated])
    expect(() => repository.create({ slug: 'viridian-mart', now: 250 })).toThrow('already exists')
  })

  it('returns an unchanged setup result when semantic content matches storage', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteShopTableRepository(database)
    const current = repository.create({
      slug: 'celadon-dept-store',
      now: 100,
      document: {
        name: 'Celadon Dept. Store',
        description: '  Multiple floors of supplies.  ',
        entries: [{ id: 'water-stone', itemName: 'Water Stone', price: 2100, stock: null }],
      },
    }).document

    const result = repository.replaceSetupShop({
      slug: current.slug,
      expectedRevision: current.revision,
      now: 200,
      document: {
        ...current,
        revision: 999,
        updatedAt: 999,
        description: '  Multiple floors of supplies.  ',
      },
    })

    expect(result.stale).toBe(false)
    if (result.stale) throw new Error('Expected setup replacement not to be stale')
    expect(result.changed).toBe(false)
    expect(result.document).toEqual(current)
    expect(repository.get(current.slug)?.document).toEqual(current)
    expect(rawShopJson(database.connection, current.slug)).toEqual(current)
  })

  it('increments revision when setup replacement changes semantic shop content', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteShopTableRepository(database)
    const current = repository.create({
      slug: 'pewter-mart',
      now: 100,
      document: {
        name: 'Pewter Mart',
        entries: [{ id: 'poke-ball', itemName: 'Poké Ball', price: 200, stock: 10 }],
      },
    }).document

    const result = repository.replaceSetupShop({
      slug: current.slug,
      expectedRevision: current.revision,
      now: 250,
      document: {
        ...current,
        open: true,
        gmNotes: '  Open after Brock is defeated.  ',
        entries: [{ id: 'poke-ball', itemName: 'Poké Ball', price: '180.5', stock: '12' }],
      },
    })

    expect(result.stale).toBe(false)
    if (result.stale) throw new Error('Expected setup replacement not to be stale')
    expect(result.changed).toBe(true)
    expect(result.document).toEqual({
      ...current,
      revision: 1,
      updatedAt: 250,
      open: true,
      gmNotes: 'Open after Brock is defeated.',
      entries: [{ id: 'poke-ball', itemName: 'Poké Ball', section: 'keyItems', price: 180, stock: 12 }],
    })
    expect(repository.get(current.slug)?.document).toEqual(result.document)
  })

  it('returns stale setup results without changing storage', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteShopTableRepository(database)
    const current = repository.create({
      slug: 'saffron-mart',
      now: 100,
      document: { name: 'Saffron Mart', entries: [] },
    }).document
    const changed = repository.replaceSetupShop({
      slug: current.slug,
      expectedRevision: 0,
      now: 200,
      document: { ...current, name: 'Saffron City Mart' },
    })
    if (changed.stale) throw new Error('Expected first setup replacement to apply')

    const stale = repository.replaceSetupShop({
      slug: current.slug,
      expectedRevision: 0,
      now: 300,
      document: { ...changed.document, name: 'Stale Overwrite' },
    })

    expect(stale).toEqual({ stale: true, current: changed.document })
    expect(repository.get(current.slug)?.document).toEqual(changed.document)
    expect(repository.replaceSetupShop({
      slug: 'missing-shop',
      expectedRevision: 0,
      document: { name: 'Missing' },
    })).toEqual({ stale: true, current: null })
  })

  it('applies live-play updates only when expected revision matches and normalizes payloads', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteShopTableRepository(database)
    const current = repository.create({
      slug: 'lavender-mart',
      now: 400,
      document: {
        name: 'Lavender Mart',
        entries: [
          { id: 'super-potion', itemName: 'Super Potion', section: 'Medicine', price: 700, stock: 2 },
        ],
      },
    }).document

    const stale = repository.applyLivePlayUpdate({
      slug: current.slug,
      expectedRevision: 99,
      now: 500,
      nextDocument: { ...current, entries: [] },
    })

    expect(stale).toEqual({ status: 'stale', current })
    expect(repository.get(current.slug)?.document).toEqual(current)

    const applied = repository.applyLivePlayUpdate({
      slug: current.slug,
      expectedRevision: current.revision,
      nextDocument: {
        slug: 'spoofed-slug',
        revision: 100,
        updatedAt: 600,
        name: '  Lavender Mart  ',
        entries: [
          { id: 'super-potion', itemName: '  Super Potion  ', section: 'medical', price: '700', stock: '1' },
          { id: 'escape-rope', itemName: 'Escape Rope', price: 550, stock: null },
        ],
      },
    })

    expect(applied.status).toBe('applied')
    if (applied.status !== 'applied') throw new Error('Expected live-play update to apply')
    expect(applied.document).toEqual({
      slug: current.slug,
      revision: 1,
      updatedAt: 600,
      name: 'Lavender Mart',
      playerVisible: false,
      open: false,
      allowedPaymentSources: ['trainer'],
      allowedDeliveryTargets: ['trainer'],
      entries: [
        { id: 'super-potion', itemName: 'Super Potion', section: 'medicalKit', price: 700, stock: 1 },
        { id: 'escape-rope', itemName: 'Escape Rope', section: 'keyItems', price: 550, stock: null },
      ],
    })
    expect(repository.get(current.slug)?.document).toEqual(applied.document)
    expect(rawShopJson(database.connection, current.slug)).toEqual(applied.document)
  })

  it('deletes shop documents and returns the removed authoritative document', () => {
    const database = openMemoryDatabase()
    const repository = createSqliteShopTableRepository(database)
    const created = repository.create({ slug: 'fuchsia-mart', now: 100, name: 'Fuchsia Mart' })

    expect(repository.deleteDocument('missing-shop')).toBeNull()
    expect(repository.deleteDocument('fuchsia-mart')).toEqual({ document: created.document })
    expect(repository.get('fuchsia-mart')).toBeNull()
    expect(repository.list()).toEqual([])
  })
})
