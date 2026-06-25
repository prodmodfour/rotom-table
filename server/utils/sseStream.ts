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
  once?: (event: 'drain', listener: () => void) => unknown
  end?: () => void
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

export interface FormatSseDataOptions {
  readonly id?: string | number
}

export interface SseSerializedWriter {
  writeComment(comment: string): Promise<void>
  writeData(event: unknown, options?: FormatSseDataOptions): Promise<void>
  writeRaw(chunk: string): Promise<void>
  close(): void
}

const SSE_ID_CONTROL_CHARACTER_RE = /[\u0000-\u001F\u007F]/

export const normalizeSseEventId = (id: string | number): string => {
  const text = typeof id === 'number' ? String(id) : id
  if (text.length === 0) throw new Error('SSE event id must not be empty')
  if (SSE_ID_CONTROL_CHARACTER_RE.test(text)) {
    throw new Error('SSE event id must not contain control characters')
  }
  return text
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

export const formatSseData = (event: unknown, options: FormatSseDataOptions = {}): string => {
  const id = options.id === undefined ? null : normalizeSseEventId(options.id)
  return `${id === null ? '' : `id: ${id}\n`}data: ${JSON.stringify(event)}\n\n`
}

export const writeSseComment = (res: SseResponse, comment: string): void => {
  res.write(formatSseComment(comment))
}

export const writeSseData = (res: SseResponse, event: unknown, options?: FormatSseDataOptions): void => {
  res.write(formatSseData(event, options))
}

export const createSseSerializedWriter = (res: SseResponse): SseSerializedWriter => {
  let closed = false
  let chain: Promise<void> = Promise.resolve()
  const pendingDrainResolvers = new Set<() => void>()

  const waitForDrain = (): Promise<void> => {
    if (typeof res.once !== 'function') return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => {
        pendingDrainResolvers.delete(done)
        resolve()
      }
      pendingDrainResolvers.add(done)
      res.once?.('drain', done)
    })
  }

  const writeChunk = async (chunk: string): Promise<void> => {
    if (closed) throw new Error('SSE writer is closed')
    const result = res.write(chunk)
    if (result === false) await waitForDrain()
  }

  const enqueue = (chunk: string): Promise<void> => {
    const write = chain.then(() => writeChunk(chunk))
    chain = write.catch(() => {})
    return write
  }

  return {
    writeComment: (comment) => enqueue(formatSseComment(comment)),
    writeData: (event, options) => enqueue(formatSseData(event, options)),
    writeRaw: (chunk) => enqueue(chunk),
    close: () => {
      closed = true
      for (const resolve of [...pendingDrainResolvers]) resolve()
      pendingDrainResolvers.clear()
    },
  }
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
