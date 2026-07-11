import {
  createLivePlayAcceptedResult,
  createLivePlayRejectedResult,
  validateLivePlayCommandEnvelope,
  type LivePlayCommandAccepted,
  type LivePlayCommandEnvelope,
  type LivePlayCommandRejected,
  type LivePlayCommandRejectionReason,
  type LivePlayCommandResult,
  type LivePlayPatch,
} from '#shared/livePlayCommands'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { AppendRealtimeEventInput } from '../storage/realtimeEventRepository'
import {
  LIVE_PLAY_MODE_REQUIRED_FOR_COMMAND_MESSAGE,
  MAP_INTERACTION_MODES,
  type MapInteractionMode,
} from '#shared/mapInteractionMode'
import { isRevision, normalizeRevision } from '#shared/sessionRevisions'
import {
  createLivePlayCommandHash,
  createLivePlayIdempotencyViolationResult,
  isLivePlayOperationResultConflictError,
  type LivePlayCommandHash,
  type StorableLivePlayCommandResult,
} from './opResult'
import { livePlayOpStore, type LivePlayOpRecord, type LivePlayOpStore, type SaveLivePlayOpResultInput } from './opStore'
import { livePlayMapWriteQueue, type MapWriteQueue } from './mapWriteQueue'
import {
  evaluateLivePlayCommandConflicts,
  type LivePlayAcceptedOperationHistoryStore,
  type LivePlayConflictRejected,
} from './conflicts'

export type MaybePromise<T> = T | Promise<T>

export interface LivePlayCommandRejectionOptions {
  readonly currentRevision?: number
  readonly currentState?: unknown
}

export class LivePlayCommandRejectionError extends Error {
  readonly reason: LivePlayCommandRejectionReason
  readonly currentRevision?: number
  readonly currentState?: unknown

  constructor(
    reason: LivePlayCommandRejectionReason,
    message: string,
    options: LivePlayCommandRejectionOptions = {},
  ) {
    super(message)
    this.name = 'LivePlayCommandRejectionError'
    this.reason = reason
    this.currentRevision = options.currentRevision
    this.currentState = options.currentState
  }
}

export const rejectLivePlayCommand = (
  reason: LivePlayCommandRejectionReason,
  message: string,
  options: LivePlayCommandRejectionOptions = {},
): never => {
  throw new LivePlayCommandRejectionError(reason, message, options)
}

export interface LivePlayCommandActorContext<
  TCommand extends LivePlayCommandEnvelope,
  TActorInput,
> {
  readonly command: TCommand
  readonly actor: TActorInput | undefined
}

export interface LivePlayCommandReadMapContext<
  TCommand extends LivePlayCommandEnvelope,
  TActor,
> {
  readonly command: TCommand
  readonly actor: TActor
}

export interface LivePlayCommandMapContext<
  TCommand extends LivePlayCommandEnvelope,
  TActor,
  TMap,
> extends LivePlayCommandReadMapContext<TCommand, TActor> {
  readonly map: TMap
  readonly currentRevision: number
}

export interface LivePlayCommandApplyContext<
  TCommand extends LivePlayCommandEnvelope,
  TActor,
  TMap,
> extends LivePlayCommandMapContext<TCommand, TActor, TMap> {}

export interface AcceptedLivePlayCommandApplication<TMap> {
  readonly status: 'accepted'
  readonly nextMap: TMap
  readonly patches: readonly LivePlayPatch[]
  readonly previousRevision?: number
  readonly revision?: number
}

/** A durable, non-terminal acknowledgement that must never enter the op store. */
export interface LivePlayCommandSuspendedResult extends LivePlayCommandAccepted {
  readonly pending: true
}

export interface SuspendedLivePlayCommandApplication<TMap> {
  readonly status: 'suspended'
  readonly nextMap: TMap
  readonly result: LivePlayCommandSuspendedResult
}

export interface NonTerminalRejectedLivePlayCommandApplication {
  readonly status: 'non-terminal-rejected'
  readonly result: LivePlayCommandRejected
}

export interface RejectedLivePlayCommandApplication {
  readonly status: 'rejected'
  readonly reason: LivePlayCommandRejectionReason
  readonly message: string
  readonly currentRevision?: number
  readonly currentState?: unknown
}

export type LivePlayCommandApplication<TMap> =
  | AcceptedLivePlayCommandApplication<TMap>
  | SuspendedLivePlayCommandApplication<TMap>
  | NonTerminalRejectedLivePlayCommandApplication
  | RejectedLivePlayCommandApplication

export interface LivePlayCommandPersistContext<
  TCommand extends LivePlayCommandEnvelope,
  TActor,
  TMap,
> extends LivePlayCommandMapContext<TCommand, TActor, TMap> {
  readonly nextMap: TMap
  readonly result: LivePlayCommandAccepted
}

export interface LivePlayCommandCommitContext<
  TCommand extends LivePlayCommandEnvelope,
  TActor,
  TMap,
> extends LivePlayCommandPersistContext<TCommand, TActor, TMap> {
  readonly commandHash: LivePlayCommandHash
  recordRealtimeEvents(inputs: readonly AppendRealtimeEventInput[]): readonly PersistedRealtimeEvent[]
  saveOpResult(): LivePlayOpRecord
}

export interface LivePlayCommandSuspendContext<
  TCommand extends LivePlayCommandEnvelope,
  TActor,
  TMap,
> extends Omit<LivePlayCommandPersistContext<TCommand, TActor, TMap>, 'result'> {
  readonly result: LivePlayCommandSuspendedResult
  readonly commandHash: LivePlayCommandHash
  recordRealtimeEvents(inputs: readonly AppendRealtimeEventInput[]): readonly PersistedRealtimeEvent[]
}

export interface LivePlayCommandPublishContext<
  TCommand extends LivePlayCommandEnvelope,
  TActor,
  TMap,
> extends LivePlayCommandPersistContext<TCommand, TActor, TMap> {}

export interface ExecuteAuthoritativeLivePlayCommandOptions<
  TCommand extends LivePlayCommandEnvelope = LivePlayCommandEnvelope,
  TMap = unknown,
  TActorInput = unknown,
  TActor = TActorInput,
> {
  readonly command: unknown
  readonly actor?: TActorInput
  readonly normalizeActor?: (
    context: LivePlayCommandActorContext<TCommand, TActorInput>,
  ) => MaybePromise<TActor>
  readonly readMap: (
    context: LivePlayCommandReadMapContext<TCommand, TActor>,
  ) => MaybePromise<TMap>
  readonly getMapRevision?: (map: TMap) => number
  readonly authorize?: (
    context: LivePlayCommandMapContext<TCommand, TActor, TMap>,
  ) => MaybePromise<void>
  readonly detectConflicts?: (
    context: LivePlayCommandMapContext<TCommand, TActor, TMap>,
  ) => MaybePromise<void>
  readonly apply: (
    context: LivePlayCommandApplyContext<TCommand, TActor, TMap>,
  ) => MaybePromise<LivePlayCommandApplication<TMap>>
  readonly persist: (
    context: LivePlayCommandPersistContext<TCommand, TActor, TMap>,
  ) => MaybePromise<void>
  readonly commit?: (
    context: LivePlayCommandCommitContext<TCommand, TActor, TMap>,
  ) => MaybePromise<void>
  /** Finalize a durable suspension without writing a terminal operation result. */
  readonly commitSuspended?: (
    context: LivePlayCommandSuspendContext<TCommand, TActor, TMap>,
  ) => MaybePromise<void>
  readonly publish?: (
    context: LivePlayCommandPublishContext<TCommand, TActor, TMap>,
  ) => MaybePromise<void>
  readonly publishSuspended?: (
    context: Omit<LivePlayCommandPublishContext<TCommand, TActor, TMap>, 'result'> & {
      readonly result: LivePlayCommandSuspendedResult
    },
  ) => MaybePromise<void>
  /**
   * Resolve an already durable suspension before authorization or planning.
   * A conflict result returned here is intentionally non-stored because the
   * originating operation identity belongs to the pending-resolution store.
   */
  readonly findSuspendedResult?: (context: {
    readonly command: TCommand
    readonly commandHash: LivePlayCommandHash
  }) => MaybePromise<LivePlayCommandSuspendedResult | LivePlayCommandRejected | null>
  readonly recordedAt?: string
}

export interface AcceptedLivePlayRealtimeRecordContext {
  readonly command: LivePlayCommandEnvelope
  readonly result: LivePlayCommandAccepted
  readonly clientId?: string
}

export type AcceptedLivePlayRealtimeRecorder = (
  context: AcceptedLivePlayRealtimeRecordContext,
) => PersistedRealtimeEvent

export type AcceptedLivePlayRealtimePublisher = (
  event: PersistedRealtimeEvent,
) => MaybePromise<void>

export type LivePlayRealtimeEventRecorder = (
  inputs: readonly AppendRealtimeEventInput[],
) => readonly PersistedRealtimeEvent[]

export type PersistedLivePlayRealtimeEventPublisher = (
  event: PersistedRealtimeEvent,
) => MaybePromise<void>

export interface AcceptedLivePlayAfterCommitPublicationFailureContext {
  readonly phase: 'use-case' | 'accepted-realtime' | 'persisted-realtime'
  readonly command: LivePlayCommandEnvelope
  readonly result: LivePlayCommandAccepted
  readonly error: unknown
  readonly event?: PersistedRealtimeEvent
  readonly sequence?: number
  readonly channel?: string
  readonly type?: string
  readonly mapSlug?: string
  readonly opId?: string
}

export type AcceptedLivePlayAfterCommitPublicationFailureReporter = (
  context: AcceptedLivePlayAfterCommitPublicationFailureContext,
) => void

export interface AuthoritativeLivePlayCommandExecutorOptions {
  readonly opStore?: LivePlayOpStore
  readonly queue?: MapWriteQueue
  readonly readMapInteractionMode?: (mapSlug: string) => MaybePromise<MapInteractionMode>
  readonly recordRealtimeEvents?: LivePlayRealtimeEventRecorder
  readonly recordAcceptedRealtimeEvent?: AcceptedLivePlayRealtimeRecorder
  readonly publishPersistedRealtimeEvent?: PersistedLivePlayRealtimeEventPublisher
  readonly publishAcceptedRealtimeEvent?: AcceptedLivePlayRealtimePublisher
  readonly reportAfterCommitPublicationFailure?: AcceptedLivePlayAfterCommitPublicationFailureReporter
}

interface ValidCommandExecutionContext<
  TCommand extends LivePlayCommandEnvelope,
  TMap,
  TActorInput,
  TActor,
> {
  readonly command: TCommand
  readonly commandHash: LivePlayCommandHash
  readonly options: ExecuteAuthoritativeLivePlayCommandOptions<TCommand, TMap, TActorInput, TActor>
}

type RawCommandRecord = Record<string, unknown>
type CommandRecordingOpStore = LivePlayOpStore & {
  saveCommandResult(input: SaveLivePlayOpResultInput & { readonly command: unknown }): LivePlayOpRecord
}

const isRecord = (value: unknown): value is RawCommandRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const defaultResultOpId = (value: unknown): string => (
  isRecord(value) && typeof value.opId === 'string' ? value.opId : 'invalid-op-id'
)

const defaultResultMapSlug = (value: unknown): string => (
  isRecord(value) && typeof value.mapSlug === 'string' ? value.mapSlug : 'invalid-map'
)

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
)

const httpStatusToRejectionReason = (statusCode: number): LivePlayCommandRejectionReason => {
  if (statusCode === 401 || statusCode === 403) return 'unauthorized'
  if (statusCode === 404) return 'not-found'
  if (statusCode === 409) return 'conflict'
  return 'invalid'
}

const rejectionFromError = (
  command: LivePlayCommandEnvelope,
  error: unknown,
  currentRevision?: number,
): LivePlayCommandRejected => {
  if (error instanceof LivePlayCommandRejectionError) {
    return createLivePlayRejectedResult({
      opId: command.opId,
      mapSlug: command.mapSlug,
      reason: error.reason,
      message: error.message,
      currentRevision: error.currentRevision ?? currentRevision,
      currentState: error.currentState,
    })
  }

  if (error instanceof Error) {
    const statusCode = (error as Error & { readonly statusCode?: unknown }).statusCode
    if (typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 400) {
      return createLivePlayRejectedResult({
        opId: command.opId,
        mapSlug: command.mapSlug,
        reason: httpStatusToRejectionReason(statusCode),
        message: error.message,
        currentRevision,
      })
    }
  }

  return createLivePlayRejectedResult({
    opId: command.opId,
    mapSlug: command.mapSlug,
    reason: 'invalid',
    message: errorMessage(error),
    currentRevision,
  })
}

const invalidEnvelopeResult = (
  value: unknown,
  message: string,
): LivePlayCommandRejected => createLivePlayRejectedResult({
  opId: defaultResultOpId(value),
  mapSlug: defaultResultMapSlug(value),
  reason: 'invalid',
  message,
})

const persistenceFailedResult = (
  command: LivePlayCommandEnvelope,
  error: unknown,
  currentRevision: number,
): LivePlayCommandRejected => createLivePlayRejectedResult({
  opId: command.opId,
  mapSlug: command.mapSlug,
  reason: 'persistence-failed',
  message: `Could not persist live-play command: ${errorMessage(error)}`,
  currentRevision,
})

const defaultMapRevision = (map: unknown): number => (
  isRecord(map) ? normalizeRevision(map.revision) : 0
)

const parseApplicationRevision = (value: number, label: string): number => {
  if (!isRevision(value)) {
    throw new LivePlayCommandRejectionError('invalid', `${label} must be a safe non-negative integer revision`)
  }
  return value
}

const validateAcceptedPatches = (
  command: LivePlayCommandEnvelope,
  revision: number,
  patches: readonly LivePlayPatch[],
): void => {
  for (const [index, patch] of patches.entries()) {
    if (patch.mapSlug !== command.mapSlug) {
      throw new LivePlayCommandRejectionError(
        'invalid',
        `patches[${index}].mapSlug must match the command mapSlug`,
      )
    }
    if (patch.revision !== revision) {
      throw new LivePlayCommandRejectionError(
        'invalid',
        `patches[${index}].revision must match the accepted command revision`,
      )
    }
  }
}

const storedResultOrViolation = (
  command: LivePlayCommandEnvelope,
  commandHash: LivePlayCommandHash,
  record: LivePlayOpRecord | null,
): StorableLivePlayCommandResult | null => {
  if (!record) return null
  if (record.commandHash !== commandHash) {
    return createLivePlayIdempotencyViolationResult(command, record)
  }
  return record.result
}

const createRevisionConflictResult = (
  command: LivePlayCommandEnvelope,
  rejection: LivePlayConflictRejected,
): LivePlayCommandRejected => createLivePlayRejectedResult({
  opId: command.opId,
  mapSlug: command.mapSlug,
  reason: rejection.reason,
  message: rejection.message,
  currentRevision: rejection.currentRevision,
})

const canRecordCommand = (store: LivePlayOpStore): store is CommandRecordingOpStore => (
  typeof (store as { readonly saveCommandResult?: unknown }).saveCommandResult === 'function'
)

const collisionResultForCommand = (
  command: LivePlayCommandEnvelope,
  commandHash: LivePlayCommandHash,
  error: unknown,
): StorableLivePlayCommandResult | null => {
  if (!isLivePlayOperationResultConflictError(error)) return null
  if (error.mapSlug !== command.mapSlug || error.opId !== command.opId || error.commandHash !== commandHash) return null
  return error.existingResult
}

type OperationHistoryOpStore = LivePlayOpStore & LivePlayAcceptedOperationHistoryStore

const canReadOperationHistory = (store: LivePlayOpStore): store is OperationHistoryOpStore => (
  typeof (store as { readonly listAcceptedOpsSinceRevision?: unknown }).listAcceptedOpsSinceRevision === 'function'
)

interface AcceptedLivePlayCommandCommitResult {
  readonly realtimeEvents: readonly PersistedRealtimeEvent[]
}

export class AuthoritativeLivePlayCommandExecutor {
  private readonly opStore: LivePlayOpStore
  private readonly queue: MapWriteQueue
  private readonly readMapInteractionMode?: (mapSlug: string) => MaybePromise<MapInteractionMode>
  private readonly recordRealtimeEventInputs?: LivePlayRealtimeEventRecorder
  private readonly recordAcceptedRealtimeEvent?: AcceptedLivePlayRealtimeRecorder
  private readonly publishPersistedRealtimeEvent?: PersistedLivePlayRealtimeEventPublisher
  private readonly reportAfterCommitPublicationFailure: AcceptedLivePlayAfterCommitPublicationFailureReporter

  constructor(options: AuthoritativeLivePlayCommandExecutorOptions = {}) {
    this.opStore = options.opStore ?? livePlayOpStore
    this.queue = options.queue ?? livePlayMapWriteQueue
    this.readMapInteractionMode = options.readMapInteractionMode
    this.recordRealtimeEventInputs = options.recordRealtimeEvents
    this.recordAcceptedRealtimeEvent = options.recordAcceptedRealtimeEvent
    this.publishPersistedRealtimeEvent = options.publishPersistedRealtimeEvent ?? options.publishAcceptedRealtimeEvent
    this.reportAfterCommitPublicationFailure = options.reportAfterCommitPublicationFailure
      ?? ((context) => console.error(`[live-play] after-commit ${context.phase} publication failed`, context.error))
  }

  async execute<
    TCommand extends LivePlayCommandEnvelope,
    TMap,
    TActorInput,
    TActor = TActorInput,
  >(
    options: ExecuteAuthoritativeLivePlayCommandOptions<TCommand, TMap, TActorInput, TActor>,
  ): Promise<LivePlayCommandResult> {
    const validation = validateLivePlayCommandEnvelope<TCommand>(options.command)
    if (!validation.valid) {
      const summary = validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
      return invalidEnvelopeResult(options.command, `Invalid live-play command envelope: ${summary}`)
    }

    const command = validation.command
    let commandHash: LivePlayCommandHash
    try {
      commandHash = createLivePlayCommandHash(command)
    } catch (error) {
      return invalidEnvelopeResult(command, errorMessage(error))
    }

    const preQueueResult = storedResultOrViolation(
      command,
      commandHash,
      this.opStore.getOpRecord(command.mapSlug, command.opId),
    )
    if (preQueueResult) return preQueueResult

    const preQueueSuspended = await this.findSuspendedResult({
      command,
      commandHash,
      options,
    })
    if (preQueueSuspended) return preQueueSuspended

    const modeRejection = await this.livePlayModeRejection(command)
    if (modeRejection) return modeRejection

    return this.queue.withMapWriteQueue(command.mapSlug, () => this.executeQueued({
      command,
      commandHash,
      options,
    }))
  }

  private async findSuspendedResult<
    TCommand extends LivePlayCommandEnvelope,
    TMap,
    TActorInput,
    TActor,
  >(
    context: ValidCommandExecutionContext<TCommand, TMap, TActorInput, TActor>,
  ): Promise<LivePlayCommandSuspendedResult | LivePlayCommandRejected | null> {
    const finder = context.options.findSuspendedResult
    if (!finder) return null

    try {
      const result = await finder({
        command: context.command,
        commandHash: context.commandHash,
      })
      if (!result) return null
      if (result.opId !== context.command.opId) {
        throw new Error('Suspended live-play result opId must match the command opId')
      }
      if (result.mapSlug !== context.command.mapSlug) {
        throw new Error('Suspended live-play result mapSlug must match the command mapSlug')
      }
      if (result.ok) {
        if (result.pending !== true) {
          throw new Error('A non-terminal accepted result must be marked pending')
        }
        parseApplicationRevision(result.previousRevision, 'suspended previousRevision')
        const revision = parseApplicationRevision(result.revision, 'suspended revision')
        validateAcceptedPatches(context.command, revision, result.patches)
      }
      return result
    }
    catch (error) {
      // The pending store owns this opId, so even a collision rejection must
      // not be inserted into the terminal operation-result store.
      return rejectionFromError(context.command, error)
    }
  }

  private async livePlayModeRejection(
    command: LivePlayCommandEnvelope,
  ): Promise<LivePlayCommandRejected | null> {
    if (!this.readMapInteractionMode) return null
    const interactionMode = await this.readMapInteractionMode(command.mapSlug)
    if (interactionMode === MAP_INTERACTION_MODES.LIVE_PLAY) return null
    return createLivePlayRejectedResult({
      opId: command.opId,
      mapSlug: command.mapSlug,
      reason: 'conflict',
      message: LIVE_PLAY_MODE_REQUIRED_FOR_COMMAND_MESSAGE,
    })
  }

  private async executeQueued<
    TCommand extends LivePlayCommandEnvelope,
    TMap,
    TActorInput,
    TActor,
  >(
    context: ValidCommandExecutionContext<TCommand, TMap, TActorInput, TActor>,
  ): Promise<LivePlayCommandResult> {
    const { command, commandHash, options } = context
    const queuedResult = storedResultOrViolation(
      command,
      commandHash,
      this.opStore.getOpRecord(command.mapSlug, command.opId),
    )
    if (queuedResult) return queuedResult

    const queuedSuspended = await this.findSuspendedResult(context)
    if (queuedSuspended) return queuedSuspended

    let currentRevision: number | undefined

    const modeRejection = await this.livePlayModeRejection(command)
    if (modeRejection) return modeRejection

    try {
      const actor = options.normalizeActor
        ? await options.normalizeActor({ command, actor: options.actor })
        : options.actor as unknown as TActor
      const map = await options.readMap({ command, actor })
      currentRevision = this.currentRevision(map, options)

      const revisionConflict = this.revisionConflict(command, currentRevision)
      if (revisionConflict) {
        return this.saveResult(command, commandHash, createRevisionConflictResult(command, revisionConflict))
      }

      await options.authorize?.({ command, actor, map, currentRevision })
      await options.detectConflicts?.({ command, actor, map, currentRevision })

      const application = await options.apply({ command, actor, map, currentRevision })
      if (application.status === 'non-terminal-rejected') {
        return application.result
      }

      if (application.status === 'rejected') {
        return this.saveResult(command, commandHash, createLivePlayRejectedResult({
          opId: command.opId,
          mapSlug: command.mapSlug,
          reason: application.reason,
          message: application.message,
          currentRevision: application.currentRevision ?? currentRevision,
          currentState: application.currentState,
        }))
      }

      if (application.status === 'suspended') {
        return await this.finishSuspendedApplication({
          command,
          commandHash,
          options,
          actor,
          map,
          currentRevision,
          application,
        })
      }

      const result = this.acceptedResult(command, map, application, options)
      let commitResult: AcceptedLivePlayCommandCommitResult
      try {
        commitResult = await this.commitAcceptedResult({
          command,
          commandHash,
          options,
          actor,
          map,
          currentRevision,
          nextMap: application.nextMap,
          result,
        })
      } catch (error) {
        if (error instanceof LivePlayCommandRejectionError) {
          return rejectionFromError(command, error, currentRevision)
        }
        return collisionResultForCommand(command, commandHash, error)
          ?? persistenceFailedResult(command, error, currentRevision)
      }

      await this.publishAcceptedResultAfterCommit({
        command,
        options,
        actor,
        map,
        currentRevision,
        nextMap: application.nextMap,
        result,
        realtimeEvents: commitResult.realtimeEvents,
      })

      return result
    } catch (error) {
      const rejection = rejectionFromError(command, error, currentRevision)
      return this.saveResult(command, commandHash, rejection)
    }
  }

  private async finishSuspendedApplication<
    TCommand extends LivePlayCommandEnvelope,
    TMap,
    TActorInput,
    TActor,
  >(context: ValidCommandExecutionContext<TCommand, TMap, TActorInput, TActor> & {
    readonly actor: TActor
    readonly map: TMap
    readonly currentRevision: number
    readonly application: SuspendedLivePlayCommandApplication<TMap>
  }): Promise<LivePlayCommandResult> {
    const {
      command,
      commandHash,
      options,
      actor,
      map,
      currentRevision,
      application,
    } = context
    const { result, nextMap } = application

    try {
      if (result.opId !== command.opId || result.mapSlug !== command.mapSlug) {
        throw new Error('Suspended live-play result identity must match its command')
      }
      if (result.previousRevision !== currentRevision) {
        throw new Error('Suspended live-play result must start from the current map revision')
      }
      const revision = parseApplicationRevision(result.revision, 'suspended revision')
      validateAcceptedPatches(command, revision, result.patches)
      if (!options.commitSuspended) {
        throw new Error('Suspended live-play commands require a non-terminal commit hook')
      }

      const eventsBySequence = new Map<number, PersistedRealtimeEvent>()
      await options.commitSuspended({
        command,
        actor,
        map,
        currentRevision,
        nextMap,
        result,
        commandHash,
        recordRealtimeEvents: (inputs) => {
          if (inputs.length === 0) return []
          if (!this.recordRealtimeEventInputs) {
            throw new Error('durable live-play realtime event recording is not configured')
          }
          const events = this.recordRealtimeEventInputs(inputs)
          for (const event of events) eventsBySequence.set(event.sequence, event)
          return events
        },
      })

      const realtimeEvents = [...eventsBySequence.values()]
        .sort((left, right) => left.sequence - right.sequence)
      await this.publishSuspendedResultAfterCommit({
        command,
        options,
        actor,
        map,
        currentRevision,
        nextMap,
        result,
        realtimeEvents,
      })
      return result
    }
    catch (error) {
      return error instanceof LivePlayCommandRejectionError
        ? rejectionFromError(command, error, currentRevision)
        : persistenceFailedResult(command, error, currentRevision)
    }
  }

  private async publishSuspendedResultAfterCommit<
    TCommand extends LivePlayCommandEnvelope,
    TMap,
    TActorInput,
    TActor,
  >(context: {
    readonly command: TCommand
    readonly options: ExecuteAuthoritativeLivePlayCommandOptions<TCommand, TMap, TActorInput, TActor>
    readonly actor: TActor
    readonly map: TMap
    readonly currentRevision: number
    readonly nextMap: TMap
    readonly result: LivePlayCommandSuspendedResult
    readonly realtimeEvents: readonly PersistedRealtimeEvent[]
  }): Promise<void> {
    const {
      command,
      options,
      actor,
      map,
      currentRevision,
      nextMap,
      result,
      realtimeEvents,
    } = context

    try {
      await options.publishSuspended?.({
        command,
        actor,
        map,
        currentRevision,
        nextMap,
        result,
      })
    }
    catch (error) {
      this.reportAfterCommitPublicationFailure({ phase: 'use-case', command, result, error })
    }

    if (!this.publishPersistedRealtimeEvent) return
    for (const event of realtimeEvents) {
      try {
        await this.publishPersistedRealtimeEvent(event)
      }
      catch (error) {
        this.reportAfterCommitPublicationFailure({
          phase: 'persisted-realtime',
          command,
          result,
          error,
          event,
          sequence: event.sequence,
          channel: event.event.channel,
          type: event.event.type,
          mapSlug: command.mapSlug,
          opId: command.opId,
        })
      }
    }
  }

  private async commitAcceptedResult<
    TCommand extends LivePlayCommandEnvelope,
    TMap,
    TActorInput,
    TActor,
  >(context: ValidCommandExecutionContext<TCommand, TMap, TActorInput, TActor> & {
    readonly actor: TActor
    readonly map: TMap
    readonly currentRevision: number
    readonly nextMap: TMap
    readonly result: LivePlayCommandAccepted
  }): Promise<AcceptedLivePlayCommandCommitResult> {
    const { command, commandHash, options, actor, map, currentRevision, nextMap, result } = context
    const persistContext: LivePlayCommandPersistContext<TCommand, TActor, TMap> = {
      command,
      actor,
      map,
      currentRevision,
      nextMap,
      result,
    }

    if (!options.commit) {
      if (this.recordAcceptedRealtimeEvent || this.recordRealtimeEventInputs) {
        throw new Error('accepted live-play commands with durable realtime recording must persist through the accepted-result commit hook')
      }
      await options.persist(persistContext)
      this.saveOpResult(command, commandHash, result, options.recordedAt)
      return { realtimeEvents: [] }
    }

    let savedRecord: LivePlayOpRecord | null = null
    let saveOpResultCalled = false
    const eventsBySequence = new Map<number, PersistedRealtimeEvent>()
    const retainRealtimeEvents = (events: readonly PersistedRealtimeEvent[]): void => {
      for (const event of events) {
        if (eventsBySequence.has(event.sequence)) continue
        eventsBySequence.set(event.sequence, event)
      }
    }
    const sortedRealtimeEvents = (): readonly PersistedRealtimeEvent[] => (
      [...eventsBySequence.values()].sort((left, right) => left.sequence - right.sequence)
    )

    await options.commit({
      ...persistContext,
      commandHash,
      recordRealtimeEvents: (inputs) => {
        if (saveOpResultCalled) {
          throw new Error('supplemental live-play realtime events must be recorded before saveOpResult()')
        }
        if (inputs.length === 0) return []
        if (!this.recordRealtimeEventInputs) {
          throw new Error('durable live-play realtime event recording is not configured')
        }
        const events = this.recordRealtimeEventInputs(inputs)
        retainRealtimeEvents(events)
        return events
      },
      saveOpResult: () => {
        if (savedRecord) return savedRecord
        saveOpResultCalled = true
        const record = this.saveOpResult(command, commandHash, result, options.recordedAt)
        const realtimeEvent = this.recordAcceptedRealtimeEvent?.({
          command,
          result,
          clientId: this.clientIdFromActor(actor),
        }) ?? null
        if (realtimeEvent) retainRealtimeEvents([realtimeEvent])
        savedRecord = record
        return savedRecord
      },
    })

    if (!savedRecord) {
      throw new Error('accepted live-play command commit did not save its operation result')
    }
    return { realtimeEvents: sortedRealtimeEvents() }
  }

  private clientIdFromActor(actor: unknown): string | undefined {
    if (!isRecord(actor)) return undefined
    const clientId = actor.clientId
    return typeof clientId === 'string' ? clientId : undefined
  }

  private async publishAcceptedResultAfterCommit<
    TCommand extends LivePlayCommandEnvelope,
    TMap,
    TActorInput,
    TActor,
  >(context: {
    readonly command: TCommand
    readonly options: ExecuteAuthoritativeLivePlayCommandOptions<TCommand, TMap, TActorInput, TActor>
    readonly actor: TActor
    readonly map: TMap
    readonly currentRevision: number
    readonly nextMap: TMap
    readonly result: LivePlayCommandAccepted
    readonly realtimeEvents: readonly PersistedRealtimeEvent[]
  }): Promise<void> {
    const {
      command,
      options,
      actor,
      map,
      currentRevision,
      nextMap,
      result,
      realtimeEvents,
    } = context

    try {
      await options.publish?.({
        command,
        actor,
        map,
        currentRevision,
        nextMap,
        result,
      })
    } catch (error) {
      this.reportAfterCommitPublicationFailure({ phase: 'use-case', command, result, error })
    }

    if (!this.publishPersistedRealtimeEvent) return

    for (const event of realtimeEvents) {
      try {
        await this.publishPersistedRealtimeEvent(event)
      } catch (error) {
        this.reportAfterCommitPublicationFailure({
          phase: event.event.type === 'live-play-command-accepted' ? 'accepted-realtime' : 'persisted-realtime',
          command,
          result,
          error,
          event,
          sequence: event.sequence,
          channel: event.event.channel,
          type: event.event.type,
          mapSlug: command.mapSlug,
          opId: command.opId,
        })
      }
    }
  }

  private currentRevision<TCommand extends LivePlayCommandEnvelope, TMap, TActorInput, TActor>(
    map: TMap,
    options: ExecuteAuthoritativeLivePlayCommandOptions<TCommand, TMap, TActorInput, TActor>,
  ): number {
    const revision = options.getMapRevision ? options.getMapRevision(map) : defaultMapRevision(map)
    return parseApplicationRevision(revision, 'current map revision')
  }

  private revisionConflict(
    command: LivePlayCommandEnvelope,
    currentRevision: number,
  ): LivePlayConflictRejected | null {
    if (command.baseRevision === currentRevision) return null

    if (!canReadOperationHistory(this.opStore)) {
      const decision = evaluateLivePlayCommandConflicts({
        command,
        baseRevision: command.baseRevision,
        currentRevision,
        recentAcceptedOps: null,
      })
      return decision.ok ? null : decision
    }

    try {
      const recentAcceptedOps = command.baseRevision < currentRevision
        ? this.opStore.listAcceptedOpsSinceRevision({
            mapSlug: command.mapSlug,
            baseRevision: command.baseRevision,
            currentRevision,
          })
        : null
      const decision = evaluateLivePlayCommandConflicts({
        command,
        baseRevision: command.baseRevision,
        currentRevision,
        recentAcceptedOps,
      })
      return decision.ok ? null : decision
    } catch (error) {
      return {
        ok: false,
        reason: 'stale-revision',
        message: `Command baseRevision ${command.baseRevision} is stale and accepted operation history through revision ${currentRevision} is unavailable: ${errorMessage(error)}`,
        currentRevision,
      }
    }
  }

  private acceptedResult<TCommand extends LivePlayCommandEnvelope, TMap, TActorInput, TActor>(
    command: TCommand,
    map: TMap,
    application: AcceptedLivePlayCommandApplication<TMap>,
    options: ExecuteAuthoritativeLivePlayCommandOptions<TCommand, TMap, TActorInput, TActor>,
  ): LivePlayCommandAccepted {
    const previousRevision = parseApplicationRevision(
      application.previousRevision ?? this.currentRevision(map, options),
      'accepted previousRevision',
    )
    const revision = parseApplicationRevision(
      application.revision ?? this.currentRevision(application.nextMap, options),
      'accepted revision',
    )
    validateAcceptedPatches(command, revision, application.patches)
    return createLivePlayAcceptedResult({
      opId: command.opId,
      mapSlug: command.mapSlug,
      previousRevision,
      revision,
      patches: application.patches,
    })
  }

  private saveOpResult(
    command: LivePlayCommandEnvelope,
    commandHash: LivePlayCommandHash,
    result: StorableLivePlayCommandResult,
    recordedAt?: string,
  ): LivePlayOpRecord {
    const input = {
      mapSlug: command.mapSlug,
      opId: command.opId,
      commandHash,
      result,
      ...(recordedAt === undefined ? {} : { recordedAt }),
    }
    return canRecordCommand(this.opStore)
      ? this.opStore.saveCommandResult({ ...input, command })
      : this.opStore.saveOpResult(input)
  }

  private saveResult(
    command: LivePlayCommandEnvelope,
    commandHash: LivePlayCommandHash,
    result: StorableLivePlayCommandResult,
  ): LivePlayCommandRejected | StorableLivePlayCommandResult {
    try {
      this.saveOpResult(command, commandHash, result)
      return result
    } catch (error) {
      return collisionResultForCommand(command, commandHash, error)
        ?? persistenceFailedResult(command, error, result.ok ? result.previousRevision : result.currentRevision ?? 0)
    }
  }
}

export const createAuthoritativeLivePlayCommandExecutor = (
  options: AuthoritativeLivePlayCommandExecutorOptions = {},
): AuthoritativeLivePlayCommandExecutor => new AuthoritativeLivePlayCommandExecutor(options)

export const livePlayCommandExecutor = createAuthoritativeLivePlayCommandExecutor()

export const executeAuthoritativeLivePlayCommand = <
  TCommand extends LivePlayCommandEnvelope,
  TMap,
  TActorInput,
  TActor = TActorInput,
>(
  options: ExecuteAuthoritativeLivePlayCommandOptions<TCommand, TMap, TActorInput, TActor>,
): Promise<LivePlayCommandResult> => livePlayCommandExecutor.execute(options)
