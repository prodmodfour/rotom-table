import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const mocks = vi.hoisted(() => ({
  createMapUseCase: vi.fn(),
  createMapFolderUseCase: vi.fn(),
  deleteMapUseCase: vi.fn(),
  deleteMapFolderUseCase: vi.fn(),
  createSheetUseCase: vi.fn(),
  createSheetFolderUseCase: vi.fn(),
  deleteSheetUseCase: vi.fn(),
  deleteSheetFolderUseCase: vi.fn(),
}))

vi.mock('../../server/useCases/createMap', () => ({
  createMapUseCase: mocks.createMapUseCase,
}))
vi.mock('../../server/useCases/createMapFolder', () => ({
  createMapFolderUseCase: mocks.createMapFolderUseCase,
}))
vi.mock('../../server/useCases/deleteMap', () => ({
  deleteMapUseCase: mocks.deleteMapUseCase,
}))
vi.mock('../../server/useCases/deleteMapFolder', () => ({
  deleteMapFolderUseCase: mocks.deleteMapFolderUseCase,
}))
vi.mock('../../server/useCases/createSheet', () => ({
  createSheetUseCase: mocks.createSheetUseCase,
}))
vi.mock('../../server/useCases/createSheetFolder', () => ({
  createSheetFolderUseCase: mocks.createSheetFolderUseCase,
}))
vi.mock('../../server/useCases/deleteSheet', () => ({
  deleteSheetUseCase: mocks.deleteSheetUseCase,
}))
vi.mock('../../server/useCases/deleteSheetFolder', () => ({
  deleteSheetFolderUseCase: mocks.deleteSheetFolderUseCase,
}))

const createMapRoute = (await import('../../server/api/maps/create.post')).default
const createMapFolderRoute = (await import('../../server/api/maps/create-folder.post')).default
const deleteMapRoute = (await import('../../server/api/maps/delete.post')).default
const deleteMapFolderRoute = (await import('../../server/api/maps/delete-folder.post')).default
const createSheetRoute = (await import('../../server/api/sheets/create.post')).default
const createSheetFolderRoute = (await import('../../server/api/sheets/create-folder.post')).default
const deleteSheetRoute = (await import('../../server/api/sheets/delete.post')).default
const deleteSheetFolderRoute = (await import('../../server/api/sheets/delete-folder.post')).default

type ResourceAdminRouteHandler = EventHandler<EventHandlerRequest, unknown>

const invokeRoute = async (
  handler: ResourceAdminRouteHandler,
  options: { role?: 'gm' | 'player'; body?: unknown } = {},
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

const playerBlockedCases: Array<{
  label: string
  route: ResourceAdminRouteHandler
  useCase: Mock
  body: unknown
}> = [
  {
    label: 'map creation',
    route: createMapRoute,
    useCase: mocks.createMapUseCase,
    body: { name: 'Player Map' },
  },
  {
    label: 'map folder creation',
    route: createMapFolderRoute,
    useCase: mocks.createMapFolderUseCase,
    body: { folder: 'player-folder' },
  },
  {
    label: 'map deletion',
    route: deleteMapRoute,
    useCase: mocks.deleteMapUseCase,
    body: { slug: 'arena' },
  },
  {
    label: 'map folder deletion',
    route: deleteMapFolderRoute,
    useCase: mocks.deleteMapFolderUseCase,
    body: { folder: 'old-maps' },
  },
  {
    label: 'sheet creation',
    route: createSheetRoute,
    useCase: mocks.createSheetUseCase,
    body: { kind: 'pokemon', folder: 'party' },
  },
  {
    label: 'sheet folder creation',
    route: createSheetFolderRoute,
    useCase: mocks.createSheetFolderUseCase,
    body: { folder: 'party' },
  },
  {
    label: 'sheet deletion',
    route: deleteSheetRoute,
    useCase: mocks.deleteSheetUseCase,
    body: { kind: 'pokemon', slug: 'pikachu' },
  },
  {
    label: 'sheet folder deletion',
    route: deleteSheetFolderRoute,
    useCase: mocks.deleteSheetFolderUseCase,
    body: { folder: 'party' },
  },
]

describe('resource admin API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(playerBlockedCases)('rejects player $label before mutating storage', async ({ route, useCase, body }) => {
    await expect(invokeRoute(route, { role: 'player', body }))
      .rejects.toMatchObject({
        statusCode: 403,
        statusMessage: 'GM login required',
      })

    expect(useCase).not.toHaveBeenCalled()
  })

  it('keeps map creation available to GMs through the admin route', async () => {
    const map = {
      schemaVersion: 2,
      slug: 'gm-map',
      name: 'GM Map',
      dimensions: { x: 4, y: 2, z: 4 },
      voxels: [],
      hazards: [],
      fieldEffects: { weather: [], terrains: [], rooms: [] },
      placements: [],
      lights: [],
      playerVisible: false,
      initiative: { activeId: null, round: 1 },
    }
    mocks.createMapUseCase.mockReturnValue({ map, events: [] })

    await expect(invokeRoute(createMapRoute, {
      role: 'gm',
      body: { name: 'GM Map', folder: 'maps', clientId: 'client-1' },
    })).resolves.toEqual({ map })

    expect(mocks.createMapUseCase).toHaveBeenCalledWith({
      name: 'GM Map',
      folder: 'maps',
      clientId: 'client-1',
    })
  })

  it('keeps sheet creation available to GMs through the admin route', async () => {
    mocks.createSheetUseCase.mockReturnValue({
      ok: true,
      kind: 'pokemon',
      slug: 'new-pokemon',
      path: 'data/sheets/party/new-pokemon.json',
      events: [],
    })

    await expect(invokeRoute(createSheetRoute, {
      role: 'gm',
      body: { kind: 'pokemon', folder: 'party', clientId: 'client-1' },
    })).resolves.toEqual({
      ok: true,
      kind: 'pokemon',
      slug: 'new-pokemon',
      path: 'data/sheets/party/new-pokemon.json',
    })

    expect(mocks.createSheetUseCase).toHaveBeenCalledWith({
      kind: 'pokemon',
      folder: 'party',
      clientId: 'client-1',
    })
  })
})
