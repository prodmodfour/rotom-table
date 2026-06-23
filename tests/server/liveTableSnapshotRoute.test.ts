import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION } from '#shared/liveTableSnapshot'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'

const mocks = vi.hoisted(() => ({
  loadLiveTableSnapshotUseCase: vi.fn(),
  resolvePlayerProfileForPolicy: vi.fn(),
  getPlayerSessionAccessGrant: vi.fn(),
}))

vi.mock('../../server/useCases/loadLiveTableSnapshot', () => ({
  loadLiveTableSnapshotUseCase: mocks.loadLiveTableSnapshotUseCase,
}))

vi.mock('../../server/policies/playerProfilePolicy', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../server/policies/playerProfilePolicy')>(),
  resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy,
}))

vi.mock('../../server/utils/sessionPlayerAccess', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../server/utils/sessionPlayerAccess')>(),
  getPlayerSessionAccessGrant: mocks.getPlayerSessionAccessGrant,
}))

const liveStateRoute = (await import('../../server/api/maps/live-state.get')).default

type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  revision: 4,
  name: 'Arena',
  folder: '',
  dimensions: { x: 4, y: 2, z: 4 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  ...overrides,
})

const profile = (): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_ash00000' as PlayerProfileId,
  displayName: 'Ash' as PlayerProfileDisplayName,
  linkedCharacters: [],
})

const invokeRoute = async (
  handler: RouteHandler,
  options: { role?: 'gm' | 'player'; query?: Record<string, unknown> } = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`

  const query = new URLSearchParams(
    Object.entries(options.query ?? {}).map(([key, value]) => [key, String(value)]),
  ).toString()
  const path = `/api/maps/live-state${query ? `?${query}` : ''}`

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

describe('map live-state API route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('parses slug and optional profileId, then returns the shared live snapshot contract', async () => {
    const selectedProfile = profile()
    const sessionAccess = { visibleMapSlugs: new Set<string>(), sheetKeys: new Set<'pokemon:pika'>(['pokemon:pika']) }
    const response = {
      schemaVersion: LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION,
      map: mapFixture(),
      mapRevision: 4,
      interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
      interactionModeUpdatedAt: 99,
      pokemonSheets: [{ slug: 'pika', nickname: 'Pika', species: 'Pikachu', level: 5, revision: 8 }],
      trainerSheets: [],
    }
    mocks.resolvePlayerProfileForPolicy.mockReturnValue(selectedProfile)
    mocks.getPlayerSessionAccessGrant.mockReturnValue(sessionAccess)
    mocks.loadLiveTableSnapshotUseCase.mockReturnValue(response)

    await expect(invokeRoute(liveStateRoute, {
      role: 'player',
      query: { slug: 'arena', profileId: 'profile_ash00000' },
    })).resolves.toEqual(response)

    expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_ash00000')
    expect(mocks.getPlayerSessionAccessGrant).toHaveBeenCalledOnce()
    expect(mocks.loadLiveTableSnapshotUseCase).toHaveBeenCalledWith({
      role: 'player',
      slug: 'arena',
      playerProfile: selectedProfile,
      sessionAccess,
    })
  })

  it('does not resolve player-only profile or session context for GMs', async () => {
    const response = {
      schemaVersion: LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION,
      map: mapFixture(),
      mapRevision: 4,
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      interactionModeUpdatedAt: 44,
      pokemonSheets: [],
      trainerSheets: [],
    }
    mocks.loadLiveTableSnapshotUseCase.mockReturnValue(response)

    await expect(invokeRoute(liveStateRoute, {
      role: 'gm',
      query: { slug: 'arena', profileId: 'profile_ash00000' },
    })).resolves.toEqual(response)

    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
    expect(mocks.getPlayerSessionAccessGrant).not.toHaveBeenCalled()
    expect(mocks.loadLiveTableSnapshotUseCase).toHaveBeenCalledWith({
      role: 'gm',
      slug: 'arena',
      playerProfile: null,
      sessionAccess: null,
    })
  })

  it('rejects malformed slugs before invoking the snapshot use case', async () => {
    await expect(invokeRoute(liveStateRoute, {
      role: 'gm',
      query: { slug: '../bad' },
    })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'slug must match /^[a-z0-9-]+$/',
    })

    expect(mocks.loadLiveTableSnapshotUseCase).not.toHaveBeenCalled()
  })
})
