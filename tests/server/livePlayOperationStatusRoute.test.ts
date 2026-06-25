import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type LivePlayCommandEnvelope,
} from '#shared/livePlayCommands'
import { LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION } from '#shared/livePlayOperationStatus'

const mocks = vi.hoisted(() => ({
  getLivePlayOperationStatusUseCase: vi.fn(),
  resolvePlayerProfileForPolicy: vi.fn(),
}))

vi.mock('../../server/useCases/getLivePlayOperationStatus', () => ({
  getLivePlayOperationStatusUseCase: mocks.getLivePlayOperationStatusUseCase,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy,
}))

const route = (await import('../../server/api/maps/operations/status.post')).default

type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const originalNodeEnv = process.env.NODE_ENV
const originalHostedWrites = process.env.ROTOM_ENABLE_HOSTED_WRITES

const command = (overrides: Partial<LivePlayCommandEnvelope> & Record<string, unknown> = {}): LivePlayCommandEnvelope & Record<string, unknown> => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_routestatus1',
  mapSlug: 'arena-map',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  scopes: [{ kind: 'token', placementId: 'token-1', field: 'position' }],
  payload: { placementId: 'token-1', position: { x: 2, y: 0, z: 1 } },
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
    node: {
      req: {
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    },
  } as unknown as H3Event)
}

const restoreEnv = (): void => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  if (originalHostedWrites === undefined) delete process.env.ROTOM_ENABLE_HOSTED_WRITES
  else process.env.ROTOM_ENABLE_HOSTED_WRITES = originalHostedWrites
}

describe('operation-status API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    restoreEnv()
  })

  it('requires an authenticated role', async () => {
    await expect(invokeRoute(route, { body: { command: command() } })).rejects.toMatchObject({
      statusCode: 401,
    })
    expect(mocks.getLivePlayOperationStatusUseCase).not.toHaveBeenCalled()
  })

  it('requires a plain object command body', async () => {
    await expect(invokeRoute(route, { role: 'gm', body: { command: [] } })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'command must be an object',
    })
    expect(mocks.getLivePlayOperationStatusUseCase).not.toHaveBeenCalled()
  })

  it('checks GM command status without resolving a player profile', async () => {
    const body = { command: command({ clientId: 'gm-client' }) }
    mocks.getLivePlayOperationStatusUseCase.mockResolvedValueOnce({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'unknown',
      mapSlug: 'arena-map',
      opId: 'op_routestatus1',
    })

    await expect(invokeRoute(route, { role: 'gm', body })).resolves.toEqual({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'unknown',
      mapSlug: 'arena-map',
      opId: 'op_routestatus1',
    })
    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
    expect(mocks.getLivePlayOperationStatusUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command: body.command,
      playerProfile: null,
    })
  })

  it('resolves player profile context from the supplied command envelope', async () => {
    const profile = {
      schemaVersion: 1,
      id: 'profile_ash00000',
      displayName: 'Ash',
      linkedCharacters: [],
    }
    const body = { command: command({ profileId: 'profile_ash00000', clientId: 'player-client' }) }
    mocks.resolvePlayerProfileForPolicy.mockReturnValueOnce(profile)
    mocks.getLivePlayOperationStatusUseCase.mockResolvedValueOnce({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'unknown',
      mapSlug: 'arena-map',
      opId: 'op_routestatus1',
    })

    await expect(invokeRoute(route, { role: 'player', body })).resolves.toMatchObject({ status: 'unknown' })
    expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_ash00000')
    expect(mocks.getLivePlayOperationStatusUseCase).toHaveBeenCalledWith({
      role: 'player',
      command: body.command,
      playerProfile: profile,
    })
  })

  it('does not require hosted writable campaign mode in production', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.ROTOM_ENABLE_HOSTED_WRITES
    const body = { command: command() }
    mocks.getLivePlayOperationStatusUseCase.mockResolvedValueOnce({
      schemaVersion: LIVE_PLAY_OPERATION_STATUS_SCHEMA_VERSION,
      status: 'unknown',
      mapSlug: 'arena-map',
      opId: 'op_routestatus1',
    })

    await expect(invokeRoute(route, { role: 'gm', body })).resolves.toMatchObject({ status: 'unknown' })
    expect(mocks.getLivePlayOperationStatusUseCase).toHaveBeenCalledTimes(1)
  })
})
