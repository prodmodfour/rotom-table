export const SSE_KEEPALIVE_MS = 15_000

export interface SseResponse {
  setHeader(name: string, value: string): void
  write(chunk: string): unknown
  flushHeaders?: () => void
}

export interface SseRequest {
  on(event: 'close' | 'error', listener: () => void): unknown
}

export interface SseLogger {
  error(message?: unknown, ...optionalParams: unknown[]): void
}

export type SseUnsubscribe = () => void
export type SseSubscriber<TEvent> = (handler: (event: TEvent) => void) => SseUnsubscribe

export interface OpenSseEventStreamOptions<TEvent> {
  req: SseRequest
  res: SseResponse
  subscribe: SseSubscriber<TEvent>
  keepaliveMs?: number
  logger?: SseLogger
}

export const setSseHeaders = (res: SseResponse): void => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  // Disable proxy buffering (nginx, vite dev server middlewares).
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
}

export const formatSseComment = (comment: string): string => `: ${comment}\n\n`

export const formatSseData = (event: unknown): string => `data: ${JSON.stringify(event)}\n\n`

export const writeSseComment = (res: SseResponse, comment: string): void => {
  res.write(formatSseComment(comment))
}

export const writeSseData = (res: SseResponse, event: unknown): void => {
  res.write(formatSseData(event))
}

export const openSseEventStream = async <TEvent>({
  req,
  res,
  subscribe,
  keepaliveMs = SSE_KEEPALIVE_MS,
  logger = console,
}: OpenSseEventStreamOptions<TEvent>): Promise<void> => {
  setSseHeaders(res)
  // Initial comment so the browser flushes the response head and fires
  // ``onopen`` immediately.
  writeSseComment(res, 'ok')

  const unsubscribe = subscribe((event) => {
    try {
      writeSseData(res, event)
    } catch (err) {
      logger.error('[events] write failed', err)
    }
  })

  const keepalive = setInterval(() => {
    try {
      writeSseComment(res, 'ping')
    } catch {
      /* socket already gone — close handler will clean up */
    }
  }, keepaliveMs)

  await new Promise<void>((resolve) => {
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      clearInterval(keepalive)
      unsubscribe()
      resolve()
    }
    req.on('close', cleanup)
    req.on('error', cleanup)
  })
}
