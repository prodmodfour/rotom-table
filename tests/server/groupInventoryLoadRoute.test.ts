import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GROUP_INVENTORY_API_PATHS } from '~/utils/apiRoutes'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  GROUP_INVENTORY_SECTION_KEYS,
  type GroupInventoryDocument,
} from '~/types/groupInventory'
import { closeRotomDatabase, getRotomDatabase, ROTOM_DB_PATH_ENV } from '~~/server/storage/database'

const loadRoute = (await import('../../server/api/group-inventory/load.get')).default

type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const originalDatabasePath = process.env[ROTOM_DB_PATH_ENV]
let tempDirectory: string | null = null

const restoreEnvValue = (value: string | undefined): void => {
  if (value === undefined) delete process.env[ROTOM_DB_PATH_ENV]
  else process.env[ROTOM_DB_PATH_ENV] = value
}

const useFreshTestDatabase = (): void => {
  closeRotomDatabase()
  tempDirectory = mkdtempSync(join(tmpdir(), 'rotom-group-inventory-load-'))
  process.env[ROTOM_DB_PATH_ENV] = join(tempDirectory, 'rotom-table.sqlite')
}

const cleanupTestDatabase = (): void => {
  closeRotomDatabase()
  restoreEnvValue(originalDatabasePath)
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true })
  tempDirectory = null
}

const invokeRoute = async (
  handler: RouteHandler,
  options: { role?: 'gm' | 'player'; query?: Record<string, unknown> } = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`

  const query = new URLSearchParams(
    Object.entries(options.query ?? {}).map(([key, value]) => [key, String(value)]),
  ).toString()
  const path = `${GROUP_INVENTORY_API_PATHS.load}${query ? `?${query}` : ''}`

  return handler({
    method: 'GET',
    path,
    node: {
      req: {
        url: path,
        headers,
      },
    },
    context: {},
  } as unknown as H3Event)
}

const groupInventoryCount = (): number => {
  const row = getRotomDatabase().connection.prepare('SELECT COUNT(*) AS count FROM group_inventories').get() as {
    readonly count: number | bigint
  }
  return Number(row.count)
}

const insertRawGroupInventory = (document: Record<string, unknown>): void => {
  getRotomDatabase().connection.prepare(`
    INSERT INTO group_inventories (slug, document_json, revision, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(
    GROUP_INVENTORY_MAIN_SLUG,
    JSON.stringify(document),
    7,
    123,
  )
}

beforeEach(() => {
  useFreshTestDatabase()
})

afterEach(() => {
  cleanupTestDatabase()
})

describe('group inventory load API route', () => {
  it('loads and normalizes the shared inventory for GMs', async () => {
    insertRawGroupInventory({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 7,
      updatedAt: 123,
      money: '250.9',
      inventory: {
        pokemonItems: [
          { id: ' potion-row ', name: ' Potion ', qty: '2.8', editing: true },
        ],
        equipment: [
          { id: ' boots-row ', name: ' Heavy Boots ', qty: 99, slot: ' Feet ' },
        ],
      },
    })

    const response = await invokeRoute(loadRoute, {
      role: 'gm',
      query: { slug: GROUP_INVENTORY_MAIN_SLUG },
    }) as GroupInventoryDocument

    expect(response).toMatchObject({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 7,
      updatedAt: 123,
      money: 250,
    })
    expect(Object.keys(response.inventory).sort()).toEqual([...GROUP_INVENTORY_SECTION_KEYS].sort())
    expect(response.inventory.pokemonItems).toEqual([
      { id: 'potion-row', name: 'Potion', qty: 2 },
    ])
    expect(response.inventory.equipment).toEqual([
      { id: 'boots-row', name: 'Heavy Boots', slot: 'Feet' },
    ])
  })

  it('allows players to load the default shared inventory and creates it when missing', async () => {
    expect(groupInventoryCount()).toBe(0)

    const response = await invokeRoute(loadRoute, { role: 'player' }) as GroupInventoryDocument

    expect(response.slug).toBe(GROUP_INVENTORY_MAIN_SLUG)
    expect(response.revision).toBe(0)
    expect(typeof response.updatedAt).toBe('number')
    expect(response.money).toBe(0)
    expect(Object.keys(response.inventory).sort()).toEqual([...GROUP_INVENTORY_SECTION_KEYS].sort())
    expect(Object.values(response.inventory).every((section) => Array.isArray(section))).toBe(true)
    expect(groupInventoryCount()).toBe(1)
  })

  it('rejects malformed slugs before creating an inventory document', async () => {
    await expect(invokeRoute(loadRoute, {
      role: 'gm',
      query: { slug: '../bad' },
    })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'group inventory slug must match /^[a-z0-9-]+$/',
    })

    expect(groupInventoryCount()).toBe(0)
  })
})
