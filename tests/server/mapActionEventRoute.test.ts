import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UseCaseHttpError } from '~~/server/utils/useCaseErrors'
import { subscribeRealtime } from '~~/server/utils/realtime'
import {
  MAP_ACTION_EVENT_SCHEMA_VERSION,
  MAP_ACTION_REALTIME_EVENT_TYPE,
  type MapActionEventEnvelope,
} from '../../shared/mapActionEvents'

const mocks = vi.hoisted(() => ({
  publishMapActionEventUseCase: vi.fn(),
  resolvePlayerProfileForPolicy: vi.fn(),
}))

vi.mock('../../server/useCases/publishMapActionEvent', () => ({
  publishMapActionEventUseCase: mocks.publishMapActionEventUseCase,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy,
}))

const actionEventRoute = (await import('../../server/api/maps/action-event.post')).default

type MapActionEventRouteHandler = EventHandler<EventHandlerRequest, unknown>
type SplashEvent = Extract<MapActionEventEnvelope, { kind: 'action-splash' }>

const actionSplashEvent = (): SplashEvent => ({
  schemaVersion: MAP_ACTION_EVENT_SCHEMA_VERSION,
  id: 'event-1',
  kind: 'action-splash',
  actorPlacementId: 'token-1',
  sourceClientId: 'client-1',
  createdAt: 1_000,
  payload: { actionName: 'Thunderbolt', verb: 'used' },
})

const invokeRoute = async (
  handler: MapActionEventRouteHandler,
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

describe('map action event API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves selected player profiles and publishes validated map-action realtime events', async () => {
    const event = actionSplashEvent()
    const profile = {
      schemaVersion: 1,
      id: 'profile_ash00000',
      displayName: 'Ash',
      linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }],
    }
    const realtimeEvent = {
      channel: 'map:arena',
      type: MAP_ACTION_REALTIME_EVENT_TYPE,
      clientId: 'client-1',
      data: event,
    }
    const received: unknown[] = []
    const unsubscribe = subscribeRealtime((incoming) => received.push(incoming))
    const now = vi.spyOn(Date, 'now').mockReturnValue(777_000)

    try {
      mocks.resolvePlayerProfileForPolicy.mockReturnValue(profile)
      mocks.publishMapActionEventUseCase.mockReturnValue({ ok: true, event: realtimeEvent })

      await expect(invokeRoute(actionEventRoute, {
        role: 'player',
        body: {
          slug: 'arena',
          event,
          profileId: 'profile_ash00000',
        },
      })).resolves.toEqual({ ok: true })
    } finally {
      unsubscribe()
      now.mockRestore()
    }

    expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_ash00000')
    expect(mocks.publishMapActionEventUseCase).toHaveBeenCalledWith({
      role: 'player',
      slug: 'arena',
      event,
      playerProfile: profile,
    })
    expect(received).toEqual([{ ...realtimeEvent, timestamp: 777_000 }])
  })

  it('keeps GM publishes independent from player profile selection', async () => {
    const event = actionSplashEvent()
    mocks.publishMapActionEventUseCase.mockReturnValue({
      ok: true,
      event: { channel: 'map:arena', type: MAP_ACTION_REALTIME_EVENT_TYPE, clientId: 'gm-client', data: event },
    })

    await expect(invokeRoute(actionEventRoute, {
      role: 'gm',
      body: {
        slug: 'arena',
        event: { ...event, sourceClientId: 'gm-client' },
        profileId: 'profile_ash00000',
      },
    })).resolves.toEqual({ ok: true })

    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
    expect(mocks.publishMapActionEventUseCase).toHaveBeenCalledWith({
      role: 'gm',
      slug: 'arena',
      event: { ...event, sourceClientId: 'gm-client' },
      playerProfile: null,
    })
  })

  it('maps selected-profile errors before publishing', async () => {
    mocks.resolvePlayerProfileForPolicy.mockImplementation(() => {
      throw new UseCaseHttpError(404, 'Player profile profile_missing1 not found')
    })

    await expect(invokeRoute(actionEventRoute, {
      role: 'player',
      body: {
        slug: 'arena',
        event: actionSplashEvent(),
        profileId: 'profile_missing1',
      },
    })).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Player profile profile_missing1 not found',
    })
    expect(mocks.publishMapActionEventUseCase).not.toHaveBeenCalled()
  })

  it('maps publish validation errors to HTTP responses', async () => {
    mocks.publishMapActionEventUseCase.mockImplementation(() => {
      throw new UseCaseHttpError(403, 'Token is not linked to selected player profile')
    })

    await expect(invokeRoute(actionEventRoute, {
      role: 'gm',
      body: {
        slug: 'arena',
        event: actionSplashEvent(),
      },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Token is not linked to selected player profile',
    })
  })
})
