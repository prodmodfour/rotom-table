import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { GROUP_INVENTORY_API_PATHS } from '~/utils/apiRoutes'
import { closeRotomDatabase, getRotomDatabase, ROTOM_DB_PATH_ENV } from '~~/server/storage/database'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'

const mocks = vi.hoisted(() => {
  const profilesById = new Map<string, unknown>()

  return {
    profilesById,
    readPlayerProfile: vi.fn((profileId: string) => profilesById.get(profileId) ?? null),
  }
})

vi.mock('../../server/utils/playerProfileStorage', () => ({
  readPlayerProfile: mocks.readPlayerProfile,
}))

const transferRoute = (await import('../../server/api/group-inventory/transfer-to-trainer.post')).default

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
  tempDirectory = mkdtempSync(join(tmpdir(), 'rotom-group-transfer-to-trainer-'))
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

const seedGroupInventory = (document: GroupInventoryDocument): GroupInventoryDocument => (
  createSqliteGroupInventoryRepository(getRotomDatabase()).save({
    slug: document.slug,
    revision: document.revision,
    updatedAt: document.updatedAt,
    document,
  }).document
)

const seedTrainer = (document: TrainerSheet & Record<string, unknown>, revision: number, updatedAt: number): void => {
  createSqliteSheetRepository<Record<string, unknown>>(getRotomDatabase()).save({
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

const trainerSheetDocument = (
  overrides: Partial<TrainerSheet> & Record<string, unknown> = {},
): TrainerSheet & Record<string, unknown> => ({
  slug: 'brock',
  name: 'Brock',
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

const setProfile = (profile: PlayerProfile): void => {
  mocks.profilesById.set(profile.id, profile)
}

const invokeRoute = async (
  handler: RouteHandler,
  options: { role?: 'gm' | 'player'; body?: unknown; method?: string } = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  return handler({
    method: options.method ?? 'POST',
    path: GROUP_INVENTORY_API_PATHS.transferToTrainer,
    node: {
      req: {
        url: GROUP_INVENTORY_API_PATHS.transferToTrainer,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    },
    context: {},
  } as unknown as H3Event)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.profilesById.clear()
  useFreshTestDatabase()
})

afterEach(() => {
  cleanupTestDatabase()
})

describe('group inventory to trainer transfer API route', () => {
  it('allows GMs to transfer item quantities and returns authoritative documents', async () => {
    const groupInventory = seedGroupInventory(groupInventoryDocument({
      revision: 1,
      updatedAt: 100,
      inventory: {
        ...emptyInventory(),
        medicalKit: [{ id: 'group-potion-row', name: 'Potion', qty: 4 }],
      },
    }))
    seedTrainer(trainerSheetDocument({
      inventory: {
        ...emptyInventory(),
        medicalKit: [{ name: 'Potion', qty: 1 }],
      },
    }), 2, 200)

    const response = await invokeRoute(transferRoute, {
      role: 'gm',
      body: {
        groupSlug: groupInventory.slug,
        groupRevision: groupInventory.revision,
        trainerSlug: 'brock',
        trainerRevision: 2,
        section: 'medicalKit',
        itemId: 'group-potion-row',
        quantity: 3,
      },
    }) as {
      readonly ok: true
      readonly groupInventory: GroupInventoryDocument
      readonly trainerSheet: { readonly sheet: TrainerSheet }
    }

    expect(response.ok).toBe(true)
    expect(response.groupInventory.revision).toBe(2)
    expect(response.groupInventory.inventory.medicalKit).toEqual([
      { id: 'group-potion-row', name: 'Potion', qty: 1 },
    ])
    expect(response.trainerSheet.sheet.revision).toBe(3)
    expect(response.trainerSheet.sheet.inventory?.medicalKit).toEqual([
      { name: 'Potion', qty: 4 },
    ])
  })

  it('allows players with a linked trainer profile to transfer item quantities', async () => {
    const groupInventory = seedGroupInventory(groupInventoryDocument({
      revision: 1,
      updatedAt: 100,
      inventory: {
        ...emptyInventory(),
        medicalKit: [{ id: 'group-potion-row', name: 'Potion', qty: 2 }],
      },
    }))
    seedTrainer(trainerSheetDocument(), 2, 200)
    setProfile(playerProfile([{ sheetKind: 'trainer', sheetSlug: 'brock' }]))

    const response = await invokeRoute(transferRoute, {
      role: 'player',
      body: {
        groupSlug: groupInventory.slug,
        groupRevision: groupInventory.revision,
        trainerSlug: 'brock',
        trainerRevision: 2,
        section: 'medicalKit',
        itemId: 'group-potion-row',
        quantity: 1,
        profileId: 'profile_ash00000',
      },
    }) as {
      readonly ok: true
      readonly groupInventory: GroupInventoryDocument
      readonly trainerSheet: { readonly sheet: TrainerSheet }
    }

    expect(mocks.readPlayerProfile).toHaveBeenCalledWith('profile_ash00000')
    expect(response.ok).toBe(true)
    expect(response.groupInventory.revision).toBe(2)
    expect(response.trainerSheet.sheet.revision).toBe(3)
  })

  it('rejects player transfers without a selected linked profile and still rejects guests', async () => {
    const body = {
      groupSlug: GROUP_INVENTORY_MAIN_SLUG,
      groupRevision: 0,
      trainerSlug: 'brock',
      trainerRevision: 0,
      section: 'medicalKit',
      itemId: 'group-potion-row',
      quantity: 1,
    }

    await expect(invokeRoute(transferRoute, { role: 'player', body })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Choose a player profile before transferring inventory for linked trainer sheets.',
    })

    setProfile(playerProfile([{ sheetKind: 'trainer', sheetSlug: 'misty' }]))
    await expect(invokeRoute(transferRoute, {
      role: 'player',
      body: { ...body, profileId: 'profile_ash00000' },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Trainer sheet brock is not linked to the selected player profile.',
    })

    await expect(invokeRoute(transferRoute, { body })).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'Login required',
    })
  })
})
