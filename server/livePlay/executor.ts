import type { LivePlayCommandEnvelope, LivePlayCommandResult } from '#shared/livePlayCommands'
import {
  assertLivePlayResultMatchesCommand,
  createLivePlayCommandHash,
  createLivePlayIdempotencyViolationResult,
  isStorableLivePlayCommandResult,
  type StorableLivePlayCommandResult,
} from './opResult'
import { livePlayOpStore, type LivePlayOpStore } from './opStore'

export type LivePlayCommandHandler<TCommand extends LivePlayCommandEnvelope = LivePlayCommandEnvelope> = (
  command: TCommand,
) => StorableLivePlayCommandResult | Promise<StorableLivePlayCommandResult>

export interface ExecuteLivePlayCommandOptions<TCommand extends LivePlayCommandEnvelope = LivePlayCommandEnvelope> {
  readonly command: TCommand
  readonly handler: LivePlayCommandHandler<TCommand>
  readonly recordedAt?: string
}

export interface LivePlayCommandExecutorOptions {
  readonly opStore?: LivePlayOpStore
}

export class LivePlayCommandExecutor {
  private readonly opStore: LivePlayOpStore

  constructor(options: LivePlayCommandExecutorOptions = {}) {
    this.opStore = options.opStore ?? livePlayOpStore
  }

  async execute<TCommand extends LivePlayCommandEnvelope>(
    options: ExecuteLivePlayCommandOptions<TCommand>,
  ): Promise<LivePlayCommandResult> {
    const { command, handler } = options
    const commandHash = createLivePlayCommandHash(command)
    const existing = this.opStore.getOpRecord(command.mapSlug, command.opId)

    if (existing) {
      if (existing.commandHash !== commandHash) {
        return createLivePlayIdempotencyViolationResult(command, existing)
      }
      return existing.result
    }

    const result = await handler(command)
    if (!isStorableLivePlayCommandResult(result)) {
      throw new Error('Live-play command handlers must return accepted or rejected results for opId tracking')
    }
    assertLivePlayResultMatchesCommand(command, result)

    this.opStore.saveOpResult({
      mapSlug: command.mapSlug,
      opId: command.opId,
      commandHash,
      result,
      recordedAt: options.recordedAt,
    })

    return result
  }
}

export const createLivePlayCommandExecutor = (
  options: LivePlayCommandExecutorOptions = {},
): LivePlayCommandExecutor => new LivePlayCommandExecutor(options)

export const livePlayCommandExecutor = createLivePlayCommandExecutor()
