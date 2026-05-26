import { EventEmitter } from 'node:events'
import type { H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTH_ROLE_COOKIE } from '#shared/auth'
import eventsRoute from '~~/server/api/events.get'
import { SESSION_HOST_ENABLE_ENV } from '~~/server/utils/sessionHosting'
import { publishRealtime } from '~~/server/utils/realtime'
import type { SseResponse } from '~~/server/utils/sseStream'

const createSseRouteEvent = () => {
  const headers = new Map<string, string>()
  const writes: string[] = []
  const req = Object.assign(new EventEmitter(), {
    headers: {
      cookie: `${AUTH_ROLE_COOKIE}=gm`,
    },
  })
  const res: SseResponse = {
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name, value)
    }),
    write: vi.fn((chunk: string) => {
      writes.push(chunk)
    }),
    flushHeaders: vi.fn(),
  }
  const event = {
    node: { req, res },
  } as unknown as H3Event

  return { event, headers, writes, req, res }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('legacy realtime SSE boundary', () => {
  it('keeps /api/events available for authenticated local realtime when session hosting is disabled', async () => {
    vi.stubEnv(SESSION_HOST_ENABLE_ENV, '')
    vi.spyOn(Date, 'now').mockReturnValue(48_000)
    const { event, headers, writes, req, res } = createSseRouteEvent()

    const stream = eventsRoute(event)

    expect(headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8')
    expect(headers.get('Cache-Control')).toBe('no-cache, no-transform')
    expect(headers.get('Connection')).toBe('keep-alive')
    expect(res.flushHeaders).toHaveBeenCalledOnce()
    expect(writes).toEqual([': ok\n\n'])

    publishRealtime({
      channel: 'maps',
      type: 'updated',
      data: { slug: 'pallet-town' },
      clientId: 'client-local-tab',
    })

    expect(writes.at(-1)).toBe(
      'data: {"channel":"maps","type":"updated","data":{"slug":"pallet-town"},"clientId":"client-local-tab","timestamp":48000}\n\n',
    )
    expect(writes.join('')).not.toContain('session-host-disabled')

    req.emit('close')
    await stream
  })
})
