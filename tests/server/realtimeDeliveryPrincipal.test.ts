import { EventEmitter } from 'node:events'
import type { H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import { AUTH_ROLE_COOKIE } from '#shared/auth'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import { parseRealtimeConnectionRequest } from '#shared/realtimeReplay'
import {
  resolveRealtimeDeliveryPrincipal,
} from '../../server/realtime/realtimeDeliveryPrincipal'
import eventsRoute from '../../server/api/events.get'
import type { SseResponse } from '../../server/utils/sseStream'

const profileId = 'profile_abcdefgh' as PlayerProfileId
const profile: PlayerProfile = {
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: profileId,
  displayName: 'Ash' as PlayerProfileDisplayName,
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'ash' }],
}

const h3Event = {} as H3Event

describe('realtime connection request parsing', () => {
  it('uses a valid non-empty Last-Event-ID before an explicit query cursor', () => {
    expect(parseRealtimeConnectionRequest({ lastEventId: '42', after: '7' }).cursor).toEqual({
      afterSequence: 42,
      source: 'last-event-id',
    })
  })

  it('uses the after query when the Last-Event-ID header is empty', () => {
    expect(parseRealtimeConnectionRequest({ lastEventId: '', after: '7' }).cursor).toEqual({
      afterSequence: 7,
      source: 'query',
    })
  })

  it('rejects malformed cursors and malformed profile ids before a stream can open', () => {
    expect(() => parseRealtimeConnectionRequest({ lastEventId: '1\n2' })).toThrow('control characters')
    expect(() => parseRealtimeConnectionRequest({ after: ['1', '2'] })).toThrow('at most once')
    expect(() => parseRealtimeConnectionRequest({ profileId: 'bad' })).toThrow('profileId must match')
  })

  it('rejects an invalid route cursor before writing SSE headers', async () => {
    const req = Object.assign(new EventEmitter(), {
      headers: {
        cookie: `${AUTH_ROLE_COOKIE}=gm`,
        'last-event-id': '1\n2',
      },
    })
    const res: SseResponse = {
      setHeader: vi.fn(),
      write: vi.fn(),
      flushHeaders: vi.fn(),
    }

    await expect(eventsRoute({ node: { req, res } } as unknown as H3Event)).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(res.setHeader).not.toHaveBeenCalled()
    expect(res.write).not.toHaveBeenCalled()
  })
})

describe('realtime delivery principal resolution', () => {
  it('rejects a GM profile query', () => {
    const request = parseRealtimeConnectionRequest({ profileId })

    expect(() => resolveRealtimeDeliveryPrincipal({ event: h3Event, role: 'gm', request })).toThrow(
      expect.objectContaining({ statusCode: 400 }),
    )
  })

  it('resolves an exact player profile and session access grant', () => {
    const request = parseRealtimeConnectionRequest({ profileId })
    const resolvePlayerProfile = vi.fn(() => profile)
    const getSessionAccess = vi.fn(() => ({ sheetKeys: new Set(['pokemon:pika' as const]) }))

    expect(resolveRealtimeDeliveryPrincipal(
      { event: h3Event, role: 'player', request },
      { resolvePlayerProfile, getSessionAccess },
    )).toEqual({
      role: 'player',
      playerProfile: profile,
      sessionAccess: { sheetKeys: new Set(['pokemon:pika']) },
    })
    expect(resolvePlayerProfile).toHaveBeenCalledWith(profileId)
    expect(getSessionAccess).toHaveBeenCalledWith(h3Event)
  })

  it('preserves unprofiled player context as distinct from a selected profile', () => {
    const request = parseRealtimeConnectionRequest({})
    const resolvePlayerProfile = vi.fn(() => null)

    expect(resolveRealtimeDeliveryPrincipal(
      { event: h3Event, role: 'player', request },
      { resolvePlayerProfile, getSessionAccess: () => null },
    )).toEqual({
      role: 'player',
      playerProfile: null,
      sessionAccess: null,
    })
    expect(resolvePlayerProfile).toHaveBeenCalledWith(null)
  })
})
