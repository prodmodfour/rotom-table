import { describe, expect, it, vi } from 'vitest'
import {
  isHttpUseCaseError,
  publishUseCaseRealtimeEvents,
  throwUseCaseHttpError,
} from '~~/server/utils/useCaseHttp'
import { subscribeRealtime } from '~~/server/utils/realtime'

class ExampleUseCaseError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
  }
}

describe('useCaseHttp utilities', () => {
  it('recognizes HTTP-compatible use-case errors', () => {
    expect(isHttpUseCaseError(new ExampleUseCaseError(409, 'conflict'))).toBe(true)
    expect(isHttpUseCaseError(new ExampleUseCaseError(399, 'not http error'))).toBe(false)
    expect(isHttpUseCaseError(new Error('plain'))).toBe(false)
    expect(isHttpUseCaseError({ statusCode: 400, message: 'structural only' })).toBe(false)
  })

  it('converts use-case errors to H3 errors and rethrows unknown errors unchanged', () => {
    try {
      throwUseCaseHttpError(new ExampleUseCaseError(404, 'Missing thing'))
      throw new Error('expected throwUseCaseHttpError to throw')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 404, statusMessage: 'Missing thing' })
    }

    const unknown = new Error('boom')
    expect(() => throwUseCaseHttpError(unknown)).toThrow(unknown)
  })

  it('publishes use-case realtime events through the realtime adapter', () => {
    vi.spyOn(Date, 'now').mockReturnValue(12345)
    const received: unknown[] = []
    const unsubscribe = subscribeRealtime((event) => received.push(event))

    try {
      publishUseCaseRealtimeEvents([
        { channel: 'maps', type: 'updated', data: { slug: 'demo' }, clientId: 'client-1' },
        { channel: 'map:demo', type: 'deleted', data: { slug: 'demo' } },
      ])
    } finally {
      unsubscribe()
      vi.restoreAllMocks()
    }

    expect(received).toEqual([
      { channel: 'maps', type: 'updated', data: { slug: 'demo' }, clientId: 'client-1', timestamp: 12345 },
      { channel: 'map:demo', type: 'deleted', data: { slug: 'demo' }, timestamp: 12345 },
    ])
  })
})
