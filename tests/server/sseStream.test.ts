import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SSE_HEARTBEAT_COMMENT,
  createSseSerializedWriter,
  formatSseComment,
  formatSseData,
  normalizeSseEventId,
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
  it('formats SSE comments, data frames, and sequenced ids', () => {
    expect(formatSseComment('ok')).toBe(': ok\n\n')
    expect(formatSseData({ channel: 'maps', type: 'updated' })).toBe(
      'data: {"channel":"maps","type":"updated"}\n\n',
    )
    expect(formatSseData({ channel: 'maps', type: 'updated' }, { id: 42 })).toBe(
      'id: 42\ndata: {"channel":"maps","type":"updated"}\n\n',
    )
    expect(normalizeSseEventId('0')).toBe('0')
    expect(() => normalizeSseEventId('1\n2')).toThrow('control characters')
  })

  it('serializes SSE writes and waits for drain when backpressure is exposed', async () => {
    const drain = new EventEmitter()
    const writes: string[] = []
    let writeCount = 0
    const res: SseResponse = {
      setHeader: vi.fn(),
      write: vi.fn((chunk: string) => {
        writes.push(chunk)
        writeCount += 1
        return writeCount !== 1
      }),
      once: (event, listener) => drain.once(event, listener),
    }
    const writer = createSseSerializedWriter(res)

    const first = writer.writeData({ order: 1 }, { id: 1 })
    const second = writer.writeData({ order: 2 }, { id: 2 })
    await Promise.resolve()

    expect(writes).toEqual(['id: 1\ndata: {"order":1}\n\n'])
    drain.emit('drain')
    await Promise.all([first, second])

    expect(writes).toEqual([
      'id: 1\ndata: {"order":1}\n\n',
      'id: 2\ndata: {"order":2}\n\n',
    ])
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

  it('opens a realtime event stream, writes subscribed events, heartbeats, logs, and cleans up once', async () => {
    vi.useFakeTimers()
    const req = new EventEmitter()
    const { headers, writes, res } = createResponse()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const unsubscribe = vi.fn()
    let handler: (event: RealtimeEvent) => void = () => {
      throw new Error('Realtime handler was not registered')
    }

    const stream = openSseEventStream<RealtimeEvent>({
      req,
      res,
      keepaliveMs: 25,
      logger,
      connectionId: 'sse-test-1',
      connectionLabel: 'role:gm',
      subscribe: vi.fn((next) => {
        handler = next
        return unsubscribe
      }),
    })

    expect(headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8')
    expect(writes).toEqual([': ok\n\n'])
    expect(logger.info).toHaveBeenCalledWith('[events] SSE connected', {
      connectionId: 'sse-test-1',
      connectionLabel: 'role:gm',
      keepaliveMs: 25,
    })

    handler({ channel: 'maps', type: 'updated', timestamp: 123 })
    expect(writes.at(-1)).toBe('data: {"channel":"maps","type":"updated","timestamp":123}\n\n')

    await vi.advanceTimersByTimeAsync(25)
    expect(writes.at(-1)).toBe(formatSseComment(SSE_HEARTBEAT_COMMENT))

    req.emit('close')
    req.emit('error')
    await stream

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(logger.info).toHaveBeenCalledWith('[events] SSE disconnected', {
      connectionId: 'sse-test-1',
      connectionLabel: 'role:gm',
      reason: 'close',
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('logs SSE error disconnects separately from ordinary closes', async () => {
    vi.useFakeTimers()
    const req = new EventEmitter()
    const { res } = createResponse()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const unsubscribe = vi.fn()

    const stream = openSseEventStream<RealtimeEvent>({
      req,
      res,
      keepaliveMs: 25,
      logger,
      connectionId: 'sse-test-error',
      subscribe: () => unsubscribe,
    })

    req.emit('error')
    await stream

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(logger.warn).toHaveBeenCalledWith('[events] SSE disconnected', {
      connectionId: 'sse-test-error',
      reason: 'error',
    })
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
    const logger = { info: vi.fn(), error: vi.fn() }
    const unsubscribe = vi.fn()
    let handler: (event: RealtimeEvent) => void = () => {
      throw new Error('Realtime handler was not registered')
    }

    const stream = openSseEventStream<RealtimeEvent>({
      req,
      res,
      keepaliveMs: 25,
      logger,
      connectionId: 'sse-test-write-failure',
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
