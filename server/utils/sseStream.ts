export const SSE_KEEPALIVE_MS = 15_000
export const SSE_HEARTBEAT_COMMENT = 'heartbeat'

let sseConnectionSequence = 0

export const createSseConnectionId = (): string => {
  sseConnectionSequence += 1
  return `sse-${Date.now().toString(36)}-${sseConnectionSequence.toString(36)}`
}

export interface SseResponse {
  setHeader(name: string, value: string): void
  write(chunk: string): unknown
  flushHeaders?: () => void
}

export interface SseRequest {
  on(event: 'close' | 'error', listener: () => void): unknown
}

export interface SseLogger {
  info?(message?: unknown, ...optionalParams: unknown[]): void
  warn?(message?: unknown, ...optionalParams: unknown[]): void
  error?(message?: unknown, ...optionalParams: unknown[]): void
}

export type SseUnsubscribe = () => void
export type SseSubscriber<TEvent> = (handler: (event: TEvent) => void) => SseUnsubscribe

export interface OpenSseEventStreamOptions<TEvent> {
  req: SseRequest
  res: SseResponse
  subscribe: SseSubscriber<TEvent>
  keepaliveMs?: number
  logger?: SseLogger
  connectionId?: string
  connectionLabel?: string
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
  connectionId = createSseConnectionId(),
  connectionLabel,
}: OpenSseEventStreamOptions<TEvent>): Promise<void> => {
  const logContext = {
    connectionId,
    ...(connectionLabel ? { connectionLabel } : {}),
  }

  setSseHeaders(res)
  // Initial comment so the browser flushes the response head and fires
  // ``onopen`` immediately.
  writeSseComment(res, 'ok')
  logger.info?.('[events] SSE connected', { ...logContext, keepaliveMs })

  const unsubscribe = subscribe((event) => {
    try {
      writeSseData(res, event)
    } catch (err) {
      logger.error?.('[events] write failed', err)
    }
  })

  const keepalive = setInterval(() => {
    try {
      writeSseComment(res, SSE_HEARTBEAT_COMMENT)
    } catch {
      /* socket already gone — close handler will clean up */
    }
  }, keepaliveMs)

  await new Promise<void>((resolve) => {
    let cleaned = false
    const cleanup = (reason: 'close' | 'error') => {
      if (cleaned) return
      cleaned = true
      clearInterval(keepalive)
      unsubscribe()
      const log = reason === 'error' ? (logger.warn ?? logger.info) : logger.info
      log?.('[events] SSE disconnected', { ...logContext, reason })
      resolve()
    }
    req.on('close', () => cleanup('close'))
    req.on('error', () => cleanup('error'))
  })
}
