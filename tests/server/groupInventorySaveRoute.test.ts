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
import { HOSTED_WRITES_DISABLED_MESSAGE } from '~~/server/utils/http'

const saveRoute = (await import('../../server/api/group-inventory/save.post')).default

type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const originalDatabasePath = process.env[ROTOM_DB_PATH_ENV]
const originalNodeEnv = process.env.NODE_ENV
const originalHostedWrites = process.env.ROTOM_ENABLE_HOSTED_WRITES
let tempDirectory: string | null = null

const restoreEnvValue = (key: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

const useFreshTestDatabase = (): void => {
  closeRotomDatabase()
  tempDirectory = mkdtempSync(join(tmpdir(), 'rotom-group-inventory-save-'))
  process.env[ROTOM_DB_PATH_ENV] = join(tempDirectory, 'rotom-table.sqlite')
}

const cleanupTestDatabase = (): void => {
  closeRotomDatabase()
  restoreEnvValue(ROTOM_DB_PATH_ENV, originalDatabasePath)
  restoreEnvValue('NODE_ENV', originalNodeEnv)
  restoreEnvValue('ROTOM_ENABLE_HOSTED_WRITES', originalHostedWrites)
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true })
  tempDirectory = null
}

const emptyInventory = () => Object.fromEntries(
  GROUP_INVENTORY_SECTION_KEYS.map((section) => [section, []]),
) as unknown as GroupInventoryDocument['inventory']

const storedGroupInventory = (): GroupInventoryDocument => {
  const row = getRotomDatabase().connection.prepare(`
    SELECT document_json
    FROM group_inventories
    WHERE slug = ?
  `).get(GROUP_INVENTORY_MAIN_SLUG) as { readonly document_json?: unknown } | undefined
  if (!row || typeof row.document_json !== 'string') throw new Error('Missing saved group inventory')
  return JSON.parse(row.document_json) as GroupInventoryDocument
}

const seedGroupInventory = (document: GroupInventoryDocument): void => {
  getRotomDatabase().connection.prepare(`
    INSERT INTO group_inventories (slug, document_json, revision, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(document.slug, JSON.stringify(document), document.revision, document.updatedAt)
}

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

const invokeRoute = async (
  handler: RouteHandler,
  options: { role?: 'gm' | 'player'; body?: unknown; method?: string } = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  return handler({
    method: options.method ?? 'POST',
    path: GROUP_INVENTORY_API_PATHS.save,
    node: {
      req: {
        url: GROUP_INVENTORY_API_PATHS.save,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    },
    context: {},
  } as unknown as H3Event)
}

beforeEach(() => {
  useFreshTestDatabase()
})

afterEach(() => {
  cleanupTestDatabase()
})

describe('group inventory save API route', () => {
  it('allows GMs to save direct edits and returns the normalized authoritative document', async () => {
    const current = groupInventoryDocument({ revision: 1, updatedAt: 100, money: 25 })
    seedGroupInventory(current)

    const response = await invokeRoute(saveRoute, {
      role: 'gm',
      body: {
        slug: GROUP_INVENTORY_MAIN_SLUG,
        expectedRevision: 1,
        document: {
          ...current,
          money: '250.7',
          notes: '  Shared supplies  ',
          inventory: {
            ...current.inventory,
            pokemonItems: [
              { id: ' potion-row ', name: ' Potion ', qty: '3.9', editing: true },
            ],
          },
        },
      },
    }) as { readonly ok: true; readonly changed: boolean; readonly document: GroupInventoryDocument }

    expect(response.ok).toBe(true)
    expect(response.changed).toBe(true)
    expect(response.document).toMatchObject({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 2,
      money: 250,
      notes: 'Shared supplies',
    })
    expect(typeof response.document.updatedAt).toBe('number')
    expect(response.document.inventory.pokemonItems).toEqual([
      { id: 'potion-row', name: 'Potion', qty: 3 },
    ])
    expect(Object.keys(response.document.inventory).sort()).toEqual([...GROUP_INVENTORY_SECTION_KEYS].sort())
    expect(storedGroupInventory()).toEqual(response.document)
  })

  it('returns unchanged no-op behavior when submitted semantic content matches storage', async () => {
    const current = groupInventoryDocument({ revision: 4, updatedAt: 400, money: 80 })
    seedGroupInventory(current)

    const response = await invokeRoute(saveRoute, {
      role: 'gm',
      body: {
        slug: GROUP_INVENTORY_MAIN_SLUG,
        expectedRevision: 4,
        document: {
          ...current,
          revision: 999,
          updatedAt: 999,
        },
      },
    }) as { readonly ok: true; readonly changed: boolean; readonly document: GroupInventoryDocument }

    expect(response).toEqual({ ok: true, changed: false, document: current })
    expect(storedGroupInventory()).toEqual(current)
  })

  it('rejects stale expected revisions with a conflict and preserves storage', async () => {
    const current = groupInventoryDocument({ revision: 5, updatedAt: 500, money: 100 })
    seedGroupInventory(current)

    await expect(invokeRoute(saveRoute, {
      role: 'gm',
      body: {
        slug: GROUP_INVENTORY_MAIN_SLUG,
        expectedRevision: 4,
        document: { ...current, money: 999 },
      },
    })).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: expect.stringContaining('reload before saving'),
    })

    expect(storedGroupInventory()).toEqual(current)
  })

  it('rejects invalid save payloads before writing', async () => {
    await expect(invokeRoute(saveRoute, {
      role: 'gm',
      body: {
        slug: GROUP_INVENTORY_MAIN_SLUG,
        expectedRevision: '0',
        document: groupInventoryDocument(),
      },
    })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'expectedRevision must be a safe non-negative integer',
    })

    const row = getRotomDatabase().connection.prepare('SELECT COUNT(*) AS count FROM group_inventories').get() as {
      readonly count: number | bigint
    }
    expect(Number(row.count)).toBe(0)
  })

  it('rejects production writes when hosted campaign writes are disabled', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.ROTOM_ENABLE_HOSTED_WRITES

    await expect(invokeRoute(saveRoute, {
      role: 'gm',
      body: {
        slug: GROUP_INVENTORY_MAIN_SLUG,
        expectedRevision: 0,
        document: groupInventoryDocument(),
      },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: HOSTED_WRITES_DISABLED_MESSAGE,
    })

    const row = getRotomDatabase().connection.prepare('SELECT COUNT(*) AS count FROM group_inventories').get() as {
      readonly count: number | bigint
    }
    expect(Number(row.count)).toBe(0)
  })

  it('rejects player and guest saves', async () => {
    const body = {
      slug: GROUP_INVENTORY_MAIN_SLUG,
      expectedRevision: 0,
      document: groupInventoryDocument(),
    }

    await expect(invokeRoute(saveRoute, { role: 'player', body })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Only GMs can save group inventory',
    })

    await expect(invokeRoute(saveRoute, { body })).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'Login required',
    })
  })
})
