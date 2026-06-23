import { describe, expect, it, vi } from 'vitest'
import {
  MAP_ACTION_EVENT_MAX_PAYLOAD_BYTES,
  PublishMapActionEventUseCaseError,
  publishMapActionEventUseCase,
} from '../../server/useCases/publishMapActionEvent'
import {
  MAP_ACTION_EVENT_SCHEMA_VERSION,
  MAP_ACTION_REALTIME_EVENT_TYPE,
  type MapActionEventEnvelope,
} from '../../shared/mapActionEvents'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '../../shared/playerProfiles'
import type { TabletopMap } from '~/types/map'

type SplashEvent = Extract<MapActionEventEnvelope, { kind: 'action-splash' }>

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_action' as PlayerProfileId,
  displayName: 'Action Player' as PlayerProfileDisplayName,
  linkedCharacters,
})

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    { id: 'linked-token', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 1, y: 0, z: 1 } },
    { id: 'unlinked-token', sheetKind: 'trainer', sheetSlug: 'giovanni', position: { x: 2, y: 0, z: 2 } },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  createdAt: 10,
  updatedAt: 20,
  ...overrides,
})

const actionSplashEvent = (overrides: Partial<SplashEvent> = {}): SplashEvent => ({
  schemaVersion: MAP_ACTION_EVENT_SCHEMA_VERSION,
  id: 'event-1',
  kind: 'action-splash',
  actorPlacementId: 'linked-token',
  sourceClientId: 'client-1',
  createdAt: 1_000,
  payload: { actionName: 'Thunderbolt', verb: 'used' },
  ...overrides,
})

const createDeps = (existing: TabletopMap | null = baseMap()) => {
  const deps = {
    mapRepository: {
      getBySlug: vi.fn((slug: string) => (slug === 'arena' ? existing : null)),
    },
  }
  return { deps }
}

describe('transient map action event publishing', () => {
  it('returns a map-scoped realtime event for GM actors without mutating saved state', () => {
    const event = actionSplashEvent({ actorPlacementId: 'unlinked-token' })
    const { deps } = createDeps(baseMap({ playerVisible: false }))

    const result = publishMapActionEventUseCase({
      role: 'gm',
      slug: 'arena',
      event,
      playerProfile: null,
    }, deps)

    expect(result).toEqual({
      ok: true,
      event: {
        channel: 'map:arena',
        type: MAP_ACTION_REALTIME_EVENT_TYPE,
        clientId: 'client-1',
        data: event,
      },
    })
    expect(deps.mapRepository.getBySlug).toHaveBeenCalledWith('arena')
  })

  it('allows a player to publish for a selected-profile linked token', () => {
    const event = actionSplashEvent()
    const { deps } = createDeps()

    const result = publishMapActionEventUseCase({
      role: 'player',
      slug: 'arena',
      event,
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
    }, deps)

    expect(result.event).toMatchObject({
      channel: 'map:arena',
      type: 'map-action',
      clientId: 'client-1',
    })
  })

  it('rejects player action events for uncontrolled tokens', () => {
    const event = actionSplashEvent({ actorPlacementId: 'unlinked-token' })
    const { deps } = createDeps()

    expect(() => publishMapActionEventUseCase({
      role: 'player',
      slug: 'arena',
      event,
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
    }, deps)).toThrow(PublishMapActionEventUseCaseError)

    try {
      publishMapActionEventUseCase({
        role: 'player',
        slug: 'arena',
        event,
        playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
      }, deps)
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 403,
        message: 'Token is not linked to selected player profile',
      })
    }
  })

  it('rejects hidden maps for players before exposing placement information', () => {
    const event = actionSplashEvent({ actorPlacementId: 'missing-token' })
    const { deps } = createDeps(baseMap({ playerVisible: false }))
    const publish = () => publishMapActionEventUseCase({
      role: 'player',
      slug: 'arena',
      event,
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
    }, deps)

    expect(publish).toThrow(PublishMapActionEventUseCaseError)
    try {
      publish()
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 403,
        message: 'Map is not player visible',
      })
    }
  })

  it('rejects missing maps and missing actor placements', () => {
    const { deps: missingMapDeps } = createDeps(null)

    expect(() => publishMapActionEventUseCase({
      role: 'gm',
      slug: 'arena',
      event: actionSplashEvent(),
      playerProfile: null,
    }, missingMapDeps)).toThrowError(/Map arena\.json not found/)

    const { deps } = createDeps()
    expect(() => publishMapActionEventUseCase({
      role: 'gm',
      slug: 'arena',
      event: actionSplashEvent({ actorPlacementId: 'missing-token' }),
      playerProfile: null,
    }, deps)).toThrowError(/Placement missing-token not found/)
  })

  it('rejects malformed or unknown event payloads before publishing', () => {
    const { deps } = createDeps()

    expect(() => publishMapActionEventUseCase({
      role: 'gm',
      slug: 'arena',
      event: { ...actionSplashEvent(), kind: 'unknown-action' },
      playerProfile: null,
    }, deps)).toThrowError(/valid map action event envelope/)

    expect(() => publishMapActionEventUseCase({
      role: 'gm',
      slug: 'arena',
      event: { ...actionSplashEvent(), payload: { actionName: '' } },
      playerProfile: null,
    }, deps)).toThrowError(/valid map action event envelope/)
  })

  it('rejects oversized event payloads', () => {
    const { deps } = createDeps()
    const event = actionSplashEvent({
      payload: { actionName: 'x'.repeat(MAP_ACTION_EVENT_MAX_PAYLOAD_BYTES + 1) },
    })
    const publish = () => publishMapActionEventUseCase({
      role: 'gm',
      slug: 'arena',
      event,
      playerProfile: null,
    }, deps)

    expect(publish).toThrow(PublishMapActionEventUseCaseError)
    try {
      publish()
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 413,
        message: `event.payload too large (max ${MAP_ACTION_EVENT_MAX_PAYLOAD_BYTES} bytes)`,
      })
    }
  })
})
