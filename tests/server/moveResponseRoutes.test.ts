import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePendingMoveResolution } from '#shared/moveAutomation/pendingResolution'
import {
  MOVE_RESPONSE_COMMAND_LIMITS,
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  type MoveResponseCommandType,
} from '#shared/moveAutomation/responseCommands'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'
import { createMoveResponseRoute } from '~~/server/livePlay/moveResponseRoute'
import {
  closeRotomDatabase,
  getRotomDatabase,
  ROTOM_DB_PATH_ENV,
} from '~~/server/storage/database'
import {
  createSqlitePendingMoveResolutionRepository,
  type PendingMoveResolutionRepository,
} from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import {
  createPendingMoveResolutionFixture,
  createTerminalMoveResolutionFixture,
} from '../fixtures/moveAutomation/pendingResolution'

const chooseRoute = (await import('../../server/api/maps/move-responses/choose.post')).default
const cancelRoute = (await import('../../server/api/maps/move-responses/cancel.post')).default
const forceResolveRoute = (await import('../../server/api/maps/move-responses/force-resolve.post')).default

interface ResponseCommandOptions {
  readonly type?: MoveResponseCommandType
  readonly opId?: string
  readonly payload?: Record<string, unknown>
}

const responseCommand = (options: ResponseCommandOptions = {}): Record<string, unknown> => {
  const type = options.type ?? MOVE_RESPONSE_COMMAND_TYPES.CHOOSE
  return {
    schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
    opId: options.opId ?? 'op_responseroute01',
    mapSlug: 'pending-arena',
    baseRevision: 12,
    ...(type === MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL
      || type === MOVE_RESPONSE_COMMAND_TYPES.GM_FORCE_RESOLVE
      ? {}
      : { profileId: 'profile_attacker1' }),
    type,
    payload: options.payload ?? (
      type === MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL
        ? { resolutionId: 'resolution-pending-1' }
        : type === MOVE_RESPONSE_COMMAND_TYPES.PASS
          || type === MOVE_RESPONSE_COMMAND_TYPES.GM_FORCE_RESOLVE
          ? { resolutionId: 'resolution-pending-1', windowId: 'window.branch' }
          : {
              resolutionId: 'resolution-pending-1',
              windowId: 'window.branch',
              optionId: 'option.attack',
            }
    ),
  }
}

type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const invokeRoute = async (
  handler: RouteHandler,
  options: {
    readonly role?: 'gm' | 'player'
    readonly body?: unknown
  } = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  return handler({
    method: 'POST',
    node: {
      req: {
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    },
  } as unknown as H3Event)
}

const selectedProfile: PlayerProfile = {
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_attacker1' as PlayerProfileId,
  displayName: 'Attacker' as PlayerProfileDisplayName,
  linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'actor' }],
}

const responseMap = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'pending-arena',
  name: 'Pending Arena',
  folder: '',
  revision: 12,
  dimensions: { x: 4, y: 2, z: 4 },
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [{
    id: 'actor-token',
    sheetKind: 'pokemon',
    sheetSlug: 'actor',
    position: { x: 0, y: 0, z: 0 },
  }],
  lights: [],
  initiative: { activeId: null, round: 1 },
})

const accessDependencies = () => ({
  mapRepository: {
    getBySlug: vi.fn((slug: string) => slug === 'pending-arena' ? responseMap() : null),
  },
  sheetRepository: { getByRef: vi.fn(() => null) },
})

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
  tempDirectory = mkdtempSync(join(tmpdir(), 'rotom-move-response-route-'))
  process.env[ROTOM_DB_PATH_ENV] = join(tempDirectory, 'rotom-table.sqlite')
}

const repositoryWithPending = (
  terminal = false,
): Pick<PendingMoveResolutionRepository, 'getById'> => {
  const resolution = terminal
    ? createTerminalMoveResolutionFixture({ status: 'expired' })
    : createPendingMoveResolutionFixture()
  return {
    getById: vi.fn(id => id === resolution.resolutionId
      ? {
          schemaVersion: 1 as const,
          resolutionId: resolution.resolutionId,
          originMapSlug: resolution.originMapSlug,
          originOpId: resolution.originOpId,
          status: resolution.status,
          resolution,
          revision: 0,
          createdAt: resolution.createdAt,
          updatedAt: resolution.updatedAt,
          terminalOpId: null,
        }
      : null),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useFreshTestDatabase()
})

afterEach(() => {
  closeRotomDatabase()
  restoreEnvValue(ROTOM_DB_PATH_ENV, originalDatabasePath)
  restoreEnvValue('NODE_ENV', originalNodeEnv)
  restoreEnvValue('ROTOM_ENABLE_HOSTED_WRITES', originalHostedWrites)
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true })
  tempDirectory = null
})

describe('move response API route boundary', () => {
  it('passes only fully parsed current references to the injected use-case seam', async () => {
    const execute = vi.fn(() => ({ acceptedForTest: true }))
    const route = createMoveResponseRoute({
      expectedType: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
      parserDependencies: { pendingResolutionRepository: repositoryWithPending() },
      accessDependencies: accessDependencies(),
      resolvePlayerProfile: () => selectedProfile,
      execute,
    })

    await expect(invokeRoute(route, {
      role: 'player',
      body: responseCommand(),
    })).resolves.toEqual({ acceptedForTest: true })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      role: 'player',
      playerProfile: selectedProfile,
      authorization: {
        source: 'window-owner',
        chosenBy: { kind: 'actor', id: null },
      },
      command: expect.objectContaining({ type: 'choose', profileId: selectedProfile.id }),
      window: expect.objectContaining({ windowId: 'window.branch' }),
      option: expect.objectContaining({ id: 'option.attack' }),
    }))
  })

  it('rejects forged, expired, oversized, and wrong-route references before the use-case seam', async () => {
    const execute = vi.fn()
    const pendingRepository = repositoryWithPending()
    const route = createMoveResponseRoute({
      expectedType: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
      parserDependencies: { pendingResolutionRepository: pendingRepository },
      accessDependencies: accessDependencies(),
      resolvePlayerProfile: () => selectedProfile,
      execute,
    })
    const expiredRoute = createMoveResponseRoute({
      expectedType: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
      parserDependencies: { pendingResolutionRepository: repositoryWithPending(true) },
      accessDependencies: accessDependencies(),
      resolvePlayerProfile: () => selectedProfile,
      execute,
    })

    const candidates: Array<{ route: RouteHandler; body: Record<string, unknown>; statusCode: number }> = [
      {
        route,
        body: responseCommand({
          payload: {
            resolutionId: 'resolution-pending-1',
            windowId: 'window.branch',
            optionId: 'option.forged',
          },
        }),
        statusCode: 400,
      },
      { route: expiredRoute, body: responseCommand(), statusCode: 409 },
      {
        route,
        body: responseCommand({
          payload: {
            resolutionId: 'resolution-pending-1',
            windowId: 'window.branch',
            optionId: 'o'.repeat(MOVE_RESPONSE_COMMAND_LIMITS.optionIdChars + 1),
          },
        }),
        statusCode: 400,
      },
      {
        route,
        body: responseCommand({ type: MOVE_RESPONSE_COMMAND_TYPES.REACT }),
        statusCode: 400,
      },
    ]

    for (const candidate of candidates) {
      await expect(invokeRoute(candidate.route, {
        role: 'player',
        body: candidate.body,
      })).rejects.toMatchObject({ statusCode: candidate.statusCode })
    }
    expect(execute).not.toHaveBeenCalled()
  })

  it('denies ineligible windows before resolving private option IDs', async () => {
    const source = createPendingMoveResolutionFixture()
    const targetOwned = parsePendingMoveResolution({
      ...source,
      outstandingWindows: source.outstandingWindows.map(window => ({
        ...window,
        ownership: [{ kind: 'target', id: 'target-token' }],
      })),
    })
    const pendingResolutionRepository = repositoryWithPending()
    ;(pendingResolutionRepository.getById as ReturnType<typeof vi.fn>).mockImplementation(
      (id: string) => id === targetOwned.resolutionId
        ? {
            schemaVersion: 1,
            resolutionId: targetOwned.resolutionId,
            originMapSlug: targetOwned.originMapSlug,
            originOpId: targetOwned.originOpId,
            status: targetOwned.status,
            resolution: targetOwned,
            revision: 0,
            createdAt: targetOwned.createdAt,
            updatedAt: targetOwned.updatedAt,
            terminalOpId: null,
          }
        : null,
    )
    const execute = vi.fn()
    const route = createMoveResponseRoute({
      expectedType: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
      parserDependencies: { pendingResolutionRepository },
      accessDependencies: accessDependencies(),
      resolvePlayerProfile: () => selectedProfile,
      execute,
    })

    await expect(invokeRoute(route, {
      role: 'player',
      body: responseCommand({
        payload: {
          resolutionId: targetOwned.resolutionId,
          windowId: 'window.branch',
          optionId: 'option.forged',
        },
      }),
    })).rejects.toMatchObject({ statusCode: 403 })
    expect(execute).not.toHaveBeenCalled()
  })

  it('requires authentication and reserves GM controls for GMs', async () => {
    await expect(invokeRoute(chooseRoute, { body: responseCommand() })).rejects.toMatchObject({
      statusCode: 401,
    })
    await expect(invokeRoute(cancelRoute, {
      role: 'player',
      body: responseCommand({ type: MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL }),
    })).rejects.toMatchObject({ statusCode: 403, statusMessage: 'GM login required' })
    await expect(invokeRoute(forceResolveRoute, {
      role: 'player',
      body: responseCommand({ type: MOVE_RESPONSE_COMMAND_TYPES.GM_FORCE_RESOLVE }),
    })).rejects.toMatchObject({ statusCode: 403, statusMessage: 'GM login required' })
  })

  it('requires hosted writes before reading pending response authority', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.ROTOM_ENABLE_HOSTED_WRITES

    await expect(invokeRoute(chooseRoute, {
      role: 'player',
      body: responseCommand(),
    })).rejects.toMatchObject({ statusCode: 403 })
    expect(getRotomDatabase().connection.prepare(
      'SELECT COUNT(*) AS count FROM pending_move_resolutions',
    ).get()).toEqual({ count: 0 })
  })

  it('executes authorized response routes while rejecting forged mechanics and options', async () => {
    createSqlitePendingMoveResolutionRepository(getRotomDatabase()).create({
      resolution: createPendingMoveResolutionFixture(),
    })
    const map = responseMap()
    createSqliteMapRepository<TabletopMap>(getRotomDatabase()).save({
      slug: map.slug,
      document: map,
      revision: map.revision ?? 0,
      updatedAt: 1_000,
    })
    const gmCommand = responseCommand()
    delete gmCommand.profileId

    await expect(invokeRoute(chooseRoute, {
      role: 'gm',
      body: {
        ...gmCommand,
        payload: {
          resolutionId: 'resolution-pending-1',
          windowId: 'window.branch',
          optionId: 'option.forged',
        },
      },
    })).rejects.toMatchObject({ statusCode: 400 })

    await expect(invokeRoute(chooseRoute, {
      role: 'gm',
      body: {
        ...gmCommand,
        payload: {
          ...(gmCommand.payload as Record<string, unknown>),
          damage: 999,
        },
      },
    })).rejects.toMatchObject({ statusCode: 400 })

    await expect(invokeRoute(chooseRoute, {
      role: 'gm',
      body: gmCommand,
    })).resolves.toMatchObject({
      result: {
        ok: false,
        reason: 'conflict',
      },
    })
  })
})
