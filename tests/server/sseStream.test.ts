import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatSseComment,
  formatSseData,
  openSseEventStream,
  setSseHeaders,
  type SseResponse,
} from '../../server/utils/sseStream'
import type { RealtimeEvent } from '../../shared/realtime'

const createResponse = () => {
  const headers = new Map<string, string>()
  const writes: string[] = []
  const res: SseResponse = {
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name, value)
    }),
    write: vi.fn((chunk: string) => {
      writes.push(chunk)
    }),
    flushHeaders: vi.fn(),
  }
  return { headers, writes, res }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SSE stream helpers', () => {
  it('formats SSE comments and data frames', () => {
    expect(formatSseComment('ok')).toBe(': ok\n\n')
    expect(formatSseData({ channel: 'maps', type: 'updated' })).toBe(
      'data: {"channel":"maps","type":"updated"}\n\n',
    )
  })

  it('sets event-stream headers and flushes response headers when supported', () => {
    const { headers, res } = createResponse()

    setSseHeaders(res)

    expect(headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8')
    expect(headers.get('Cache-Control')).toBe('no-cache, no-transform')
    expect(headers.get('Connection')).toBe('keep-alive')
    expect(headers.get('X-Accel-Buffering')).toBe('no')
    expect(res.flushHeaders).toHaveBeenCalledOnce()
  })

  it('opens a realtime event stream, writes subscribed events, pings, and cleans up once', async () => {
    vi.useFakeTimers()
    const req = new EventEmitter()
    const { headers, writes, res } = createResponse()
    const unsubscribe = vi.fn()
    let handler: (event: RealtimeEvent) => void = () => {
      throw new Error('Realtime handler was not registered')
    }

    const stream = openSseEventStream<RealtimeEvent>({
      req,
      res,
      keepaliveMs: 25,
      subscribe: vi.fn((next) => {
        handler = next
        return unsubscribe
      }),
    })

    expect(headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8')
    expect(writes).toEqual([': ok\n\n'])

    handler({ channel: 'maps', type: 'updated', timestamp: 123 })
    expect(writes.at(-1)).toBe('data: {"channel":"maps","type":"updated","timestamp":123}\n\n')

    await vi.advanceTimersByTimeAsync(25)
    expect(writes.at(-1)).toBe(': ping\n\n')

    req.emit('close')
    req.emit('error')
    await stream

    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('logs event write failures without dropping stream cleanup', async () => {
    vi.useFakeTimers()
    const req = new EventEmitter()
    const writes: string[] = []
    const writeError = new Error('socket closed')
    const res: SseResponse = {
      setHeader: vi.fn(),
      write: vi.fn((chunk: string) => {
        writes.push(chunk)
        if (chunk.startsWith('data:')) throw writeError
      }),
    }
    const logger = { error: vi.fn() }
    const unsubscribe = vi.fn()
    let handler: (event: RealtimeEvent) => void = () => {
      throw new Error('Realtime handler was not registered')
    }

    const stream = openSseEventStream<RealtimeEvent>({
      req,
      res,
      keepaliveMs: 25,
      logger,
      subscribe: (next) => {
        handler = next
        return unsubscribe
      },
    })

    handler({ channel: 'maps', type: 'updated', timestamp: 123 })
    expect(logger.error).toHaveBeenCalledWith('[events] write failed', writeError)

    req.emit('close')
    await stream
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(writes[0]).toBe(': ok\n\n')
  })
})
