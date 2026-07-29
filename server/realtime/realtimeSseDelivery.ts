import type {
  RealtimeReplayCaughtUpControl,
  RealtimeReplayCursorRequest,
  RealtimeReplayReconcileRequiredControl,
} from '#shared/realtimeReplay'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import {
  DEFAULT_REALTIME_EVENT_READ_LIMIT,
  sqliteRealtimeEventRepository,
  type ReadRealtimeEventsAfterResult,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import {
  SSE_HEARTBEAT_COMMENT,
  SSE_KEEPALIVE_MS,
  createSseConnectionId,
  createSseSerializedWriter,
  setSseHeaders,
  type SseLogger,
  type SseRequest,
  type SseResponse,
  type SseSerializedWriter,
} from '../utils/sseStream'
import {
  defaultRealtimeHub,
  type RealtimeHub,
  type ScopedTransientRealtimeEvent,
} from '../utils/realtime'
import {
  evaluateRealtimeEventAccess,
  type RealtimeDeliveryPrincipal,
  type RealtimeEventAccessDependencies,
} from './realtimeEventAccessPolicy'
import { redactRealtimeEventForPrincipal } from './realtimeEventRedaction'
import { createSqliteRealtimeEventAccessDependencies } from './sqliteRealtimeEventAccessAdapter'

export const DEFAULT_REALTIME_SSE_POLL_INTERVAL_MS = 500
export const DEFAULT_REALTIME_TRANSIENT_QUEUE_LIMIT = 100

export interface OpenRealtimeSseStreamOptions {
  readonly req: SseRequest
  readonly res: SseResponse
  readonly cursor: RealtimeReplayCursorRequest
  readonly principal: RealtimeDeliveryPrincipal
  readonly realtimeEventRepository?: Pick<RealtimeEventRepository, 'cursorState' | 'readAfter'>
  readonly accessDependencies?: RealtimeEventAccessDependencies
  readonly realtimeHub?: Pick<RealtimeHub, 'subscribeDurableRealtimeWakeup' | 'subscribeTransientRealtime'>
  readonly readLimit?: number
  readonly pollIntervalMs?: number
  readonly transientQueueLimit?: number
  readonly keepaliveMs?: number
  readonly logger?: SseLogger
  readonly connectionId?: string
  readonly connectionLabel?: string
}

type StreamDisconnectReason = 'close' | 'error'
type RealtimeCursorMismatchResult = ReadRealtimeEventsAfterResult & { readonly status: 'gap' | 'ahead' }

interface LogContext {
  readonly connectionId: string
  readonly connectionLabel?: string
}

interface DeliveredPersistedPage {
  readonly scannedThroughSequence: number
  readonly lastAllowedSequence: number | null
}

const caughtUpControl = (input: {
  readonly requestedAfterSequence: number | null
  readonly earliestAvailableSequence: number
  readonly latestSequence: number
  readonly replayedThroughSequence: number
}): RealtimeReplayCaughtUpControl => ({
  kind: 'realtime-control',
  type: 'replay-caught-up',
  requestedAfterSequence: input.requestedAfterSequence,
  earliestAvailableSequence: input.earliestAvailableSequence,
  latestSequence: input.latestSequence,
  replayedThroughSequence: input.replayedThroughSequence,
})

const reconcileRequiredControl = (
  result: RealtimeCursorMismatchResult,
): RealtimeReplayReconcileRequiredControl => ({
  kind: 'realtime-control',
  type: 'reconcile-required',
  reason: result.status,
  requestedAfterSequence: result.requestedAfterSequence,
  earliestAvailableSequence: result.earliestAvailableSequence,
  latestSequence: result.latestSequence,
})

const sortBySequence = (events: readonly PersistedRealtimeEvent[]): readonly PersistedRealtimeEvent[] =>
  [...events].sort((left, right) => left.sequence - right.sequence)

const isCursorMismatchResult = (
  result: ReadRealtimeEventsAfterResult,
): result is RealtimeCursorMismatchResult => result.status === 'gap' || result.status === 'ahead'

class RealtimeSseConnection {
  private readonly req: SseRequest
  private readonly res: SseResponse
  private readonly cursor: RealtimeReplayCursorRequest
  private readonly principal: RealtimeDeliveryPrincipal
  private readonly realtimeEventRepository: Pick<RealtimeEventRepository, 'cursorState' | 'readAfter'>
  private readonly accessDependencies: RealtimeEventAccessDependencies
  private readonly realtimeHub: Pick<RealtimeHub, 'subscribeDurableRealtimeWakeup' | 'subscribeTransientRealtime'>
  private readonly readLimit: number
  private readonly pollIntervalMs: number
  private readonly transientQueueLimit: number
  private readonly keepaliveMs: number
  private readonly logger: SseLogger
  private readonly logContext: LogContext
  private readonly writer: SseSerializedWriter
  private readonly transientQueue: ScopedTransientRealtimeEvent[] = []
  private readonly unsubscribe: Array<() => void> = []

  private scanCursor = 0
  private keepalive: ReturnType<typeof setInterval> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private closed = false
  private cleaned = false
  private initialReplayComplete = false
  private durableProcessing = false
  private durableScheduled = false
  private transientFlushing = false
  private resolveClosed!: () => void
  private readonly closedPromise = new Promise<void>((resolve) => {
    this.resolveClosed = resolve
  })

  constructor(options: OpenRealtimeSseStreamOptions) {
    this.req = options.req
    this.res = options.res
    this.cursor = options.cursor
    this.principal = options.principal
    this.realtimeEventRepository = options.realtimeEventRepository ?? sqliteRealtimeEventRepository
    this.accessDependencies = options.accessDependencies ?? createSqliteRealtimeEventAccessDependencies()
    this.realtimeHub = options.realtimeHub ?? defaultRealtimeHub
    this.readLimit = options.readLimit ?? DEFAULT_REALTIME_EVENT_READ_LIMIT
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_REALTIME_SSE_POLL_INTERVAL_MS
    this.transientQueueLimit = options.transientQueueLimit ?? DEFAULT_REALTIME_TRANSIENT_QUEUE_LIMIT
    this.keepaliveMs = options.keepaliveMs ?? SSE_KEEPALIVE_MS
    this.logger = options.logger ?? console
    this.logContext = {
      connectionId: options.connectionId ?? createSseConnectionId(),
      ...(options.connectionLabel ? { connectionLabel: options.connectionLabel } : {}),
    }
    this.writer = createSseSerializedWriter(this.res)
  }

  async run(): Promise<void> {
    setSseHeaders(this.res)
    this.registerLifecycleHandlers()

    try {
      await this.writeComment('ok')
      this.logger.info?.('[events] SSE connected', {
        ...this.logContext,
        keepaliveMs: this.keepaliveMs,
        pollIntervalMs: this.pollIntervalMs,
      })
      this.startHeartbeat()
      this.subscribeLocalWakeups()
      await this.runInitialReplay()
      if (this.closed) return this.closedPromise
      this.initialReplayComplete = true
      this.startPolling()
      this.scheduleDurableRead()
      await this.flushTransientQueue()
    } catch (error) {
      this.logger.error?.('[events] SSE startup failed', { ...this.logContext, error })
      this.cleanup('error')
    }

    return this.closedPromise
  }

  private registerLifecycleHandlers(): void {
    this.req.on('close', () => this.cleanup('close'))
    this.req.on('error', () => this.cleanup('error'))
  }

  private startHeartbeat(): void {
    this.keepalive = setInterval(() => {
      void this.writeComment(SSE_HEARTBEAT_COMMENT).catch(() => this.cleanup('error'))
    }, this.keepaliveMs)
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => this.scheduleDurableRead(), this.pollIntervalMs)
  }

  private subscribeLocalWakeups(): void {
    this.unsubscribe.push(
      this.realtimeHub.subscribeDurableRealtimeWakeup(() => this.scheduleDurableRead()),
      this.realtimeHub.subscribeTransientRealtime((publication) => this.enqueueTransient(publication)),
    )
  }

  private cleanup(reason: StreamDisconnectReason): void {
    if (this.cleaned) return
    this.cleaned = true
    this.closed = true
    if (this.keepalive !== null) clearInterval(this.keepalive)
    if (this.pollTimer !== null) clearInterval(this.pollTimer)
    for (const unsubscribe of this.unsubscribe.splice(0)) {
      try {
        unsubscribe()
      } catch (error) {
        this.logger.warn?.('[events] SSE unsubscribe failed', { ...this.logContext, error })
      }
    }
    this.transientQueue.splice(0)
    this.writer.close()
    if (reason === 'error') {
      try {
        this.res.end?.()
      } catch {
        // Socket may already be gone.
      }
    }
    const log = reason === 'error' ? (this.logger.warn ?? this.logger.info) : this.logger.info
    log?.('[events] SSE disconnected', { ...this.logContext, reason })
    this.resolveClosed()
  }

  private async writeComment(comment: string): Promise<void> {
    if (this.closed) return
    await this.writer.writeComment(comment)
  }

  private async writeData(data: unknown, id?: number): Promise<void> {
    if (this.closed) return
    await this.writer.writeData(data, id === undefined ? undefined : { id })
  }

  private async writeCaughtUp(input: {
    readonly requestedAfterSequence: number | null
    readonly earliestAvailableSequence: number
    readonly latestSequence: number
    readonly replayedThroughSequence: number
  }): Promise<void> {
    await this.writeData(caughtUpControl(input), input.replayedThroughSequence)
  }

  private async writeReconcile(result: RealtimeCursorMismatchResult): Promise<void> {
    await this.writeData(reconcileRequiredControl(result), result.latestSequence)
  }

  private async runInitialReplay(): Promise<void> {
    if (this.cursor.afterSequence === null) {
      const state = this.realtimeEventRepository.cursorState()
      this.scanCursor = state.latestSequence
      await this.writeCaughtUp({
        requestedAfterSequence: null,
        earliestAvailableSequence: state.earliestAvailableSequence,
        latestSequence: state.latestSequence,
        replayedThroughSequence: state.latestSequence,
      })
      return
    }

    await this.replayFromCursor(this.cursor.afterSequence)
  }

  private async replayFromCursor(requestedAfterSequence: number): Promise<void> {
    let afterSequence = requestedAfterSequence

    while (!this.closed) {
      const result = this.realtimeEventRepository.readAfter({ afterSequence, limit: this.readLimit })
      if (isCursorMismatchResult(result)) {
        await this.writeReconcile(result)
        this.scanCursor = result.latestSequence
        return
      }

      if (result.events.length === 0) {
        this.scanCursor = afterSequence
        await this.writeCaughtUp({
          requestedAfterSequence,
          earliestAvailableSequence: result.earliestAvailableSequence,
          latestSequence: result.latestSequence,
          replayedThroughSequence: afterSequence,
        })
        return
      }

      const beforePageCursor = afterSequence
      const delivered = await this.deliverPersistedEvents(result.events)
      afterSequence = delivered.scannedThroughSequence
      this.scanCursor = afterSequence

      if (result.hasMore
        && delivered.scannedThroughSequence > beforePageCursor
        && delivered.lastAllowedSequence !== delivered.scannedThroughSequence) {
        await this.writeCaughtUp({
          requestedAfterSequence,
          earliestAvailableSequence: result.earliestAvailableSequence,
          latestSequence: result.latestSequence,
          replayedThroughSequence: delivered.scannedThroughSequence,
        })
      }

      if (!result.hasMore) {
        await this.writeCaughtUp({
          requestedAfterSequence,
          earliestAvailableSequence: result.earliestAvailableSequence,
          latestSequence: result.latestSequence,
          replayedThroughSequence: afterSequence,
        })
        return
      }
    }
  }

  private async deliverPersistedEvents(
    events: readonly PersistedRealtimeEvent[],
  ): Promise<DeliveredPersistedPage> {
    let scannedThroughSequence = this.scanCursor
    let lastAllowedSequence: number | null = null

    for (const record of sortBySequence(events)) {
      if (this.closed) break
      if (record.sequence <= scannedThroughSequence) continue

      const decision = evaluateRealtimeEventAccess({
        access: record.access,
        principal: this.principal,
        dependencies: this.accessDependencies,
      })
      scannedThroughSequence = record.sequence

      if (!decision.allowed) continue

      await this.writeData(redactRealtimeEventForPrincipal(
        record.event, this.principal, this.accessDependencies,
      ), record.sequence)
      lastAllowedSequence = record.sequence
    }

    return { scannedThroughSequence, lastAllowedSequence }
  }

  private scheduleDurableRead(): void {
    if (this.closed) return
    this.durableScheduled = true
    if (!this.initialReplayComplete || this.durableProcessing || this.transientFlushing) return
    void this.processScheduledDurableReads()
  }

  private async processScheduledDurableReads(): Promise<void> {
    if (this.closed || this.durableProcessing || this.transientFlushing) return
    this.durableProcessing = true

    try {
      while (!this.closed && this.durableScheduled) {
        this.durableScheduled = false
        await this.readDurableTailOnce()
      }
    } catch (error) {
      this.logger.error?.('[events] durable SSE tail failed', { ...this.logContext, error })
      this.cleanup('error')
    } finally {
      this.durableProcessing = false
    }

    if (!this.closed) await this.flushTransientQueue()
    if (!this.closed && this.durableScheduled) void this.processScheduledDurableReads()
  }

  private async readDurableTailOnce(): Promise<void> {
    while (!this.closed) {
      const beforePageCursor = this.scanCursor
      const result = this.realtimeEventRepository.readAfter({
        afterSequence: beforePageCursor,
        limit: this.readLimit,
      })

      if (isCursorMismatchResult(result)) {
        await this.writeReconcile(result)
        this.scanCursor = result.latestSequence
        return
      }

      if (result.events.length === 0) return

      const delivered = await this.deliverPersistedEvents(result.events)
      this.scanCursor = delivered.scannedThroughSequence

      if (delivered.scannedThroughSequence > beforePageCursor
        && delivered.lastAllowedSequence !== delivered.scannedThroughSequence) {
        await this.writeCaughtUp({
          requestedAfterSequence: beforePageCursor,
          earliestAvailableSequence: result.earliestAvailableSequence,
          latestSequence: result.latestSequence,
          replayedThroughSequence: delivered.scannedThroughSequence,
        })
      }

      if (!result.hasMore) return
    }
  }

  private enqueueTransient(publication: ScopedTransientRealtimeEvent): void {
    if (this.closed) return
    if (this.transientQueue.length >= this.transientQueueLimit) {
      this.logger.error?.('[events] transient SSE queue overflow', this.logContext)
      this.cleanup('error')
      return
    }
    this.transientQueue.push(publication)
    if (this.initialReplayComplete && !this.durableProcessing && !this.durableScheduled) {
      void this.flushTransientQueue()
    }
  }

  private async flushTransientQueue(): Promise<void> {
    if (this.closed || this.transientFlushing || this.durableProcessing || this.durableScheduled) return
    this.transientFlushing = true

    try {
      while (!this.closed && !this.durableScheduled && this.transientQueue.length > 0) {
        const publication = this.transientQueue.shift()
        if (!publication) continue
        const decision = evaluateRealtimeEventAccess({
          access: publication.access,
          principal: this.principal,
          dependencies: this.accessDependencies,
        })
        if (!decision.allowed) continue
        await this.writeData(redactRealtimeEventForPrincipal(
          publication.event, this.principal, this.accessDependencies,
        ))
      }
    } catch (error) {
      this.logger.error?.('[events] transient SSE delivery failed', { ...this.logContext, error })
      this.cleanup('error')
    } finally {
      this.transientFlushing = false
    }

    if (!this.closed && this.durableScheduled) void this.processScheduledDurableReads()
  }
}

export const openRealtimeSseStream = async (options: OpenRealtimeSseStreamOptions): Promise<void> => {
  const connection = new RealtimeSseConnection(options)
  await connection.run()
}
