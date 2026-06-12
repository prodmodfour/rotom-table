import { computed, ref, type ComputedRef } from 'vue'
import type { LivePlayCommandRejectionReason } from '#shared/livePlayCommands'
import type { MapRealtimeReconciliationStatus, MapSaveStatus } from '~/composables/useEditableMap'

export type LivePlayConnectionState =
  | 'loading'
  | 'ready'
  | 'saving-command'
  | 'reconnecting'
  | 'reconciling'
  | 'stale'
  | 'error'

interface ReadonlyValueRef<TValue> {
  readonly value: TValue
}

export interface LivePlayCommandRejectionTransition {
  readonly reason?: LivePlayCommandRejectionReason | null
  readonly message?: string | null
}

export interface UseLivePlayStateMachineOptions {
  readonly mapStatus: ReadonlyValueRef<MapSaveStatus>
  readonly mapError?: ReadonlyValueRef<string | null | undefined>
  readonly realtimeStatus: ReadonlyValueRef<MapRealtimeReconciliationStatus>
  readonly realtimeNotice?: ReadonlyValueRef<string | null | undefined>
}

export interface UseLivePlayStateMachineReturn {
  readonly state: ComputedRef<LivePlayConnectionState>
  readonly notice: ComputedRef<string | null>
  readonly commandsAllowed: ComputedRef<boolean>
  readonly commandBlockMessage: ComputedRef<string | null>
  readonly commandStarted: () => void
  readonly commandAccepted: () => void
  readonly commandRejected: (transition: LivePlayCommandRejectionTransition) => void
  readonly commandFailed: (message: string) => void
  readonly commandBlocked: (message: string) => void
  readonly clearCommandError: () => void
  readonly reconcile: <TResult>(task: () => Promise<TResult> | TResult) => Promise<TResult>
}

type CommandPhase = 'idle' | 'saving' | 'stale' | 'error'

const DEFAULT_MESSAGES: Record<Exclude<LivePlayConnectionState, 'ready'>, string> = {
  loading: 'Loading the authoritative map before live play starts.',
  'saving-command': 'Sending live-play command to the server.',
  reconnecting: 'Realtime connection lost. Reconnecting before more live-play commands are sent.',
  reconciling: 'Reloading the authoritative map before live play resumes.',
  stale: 'Command was based on an older map revision. Reconciling with the server before live play resumes.',
  error: 'Live-play command failed. Resolve the error or reload the map before sending more commands.',
}

const mapStatusBlocksLivePlay = (status: MapSaveStatus): LivePlayConnectionState | null => {
  switch (status) {
    case 'loading':
      return 'loading'
    case 'error':
    case 'not-found':
      return 'error'
    default:
      return null
  }
}

const realtimeStatusBlocksLivePlay = (status: MapRealtimeReconciliationStatus): LivePlayConnectionState | null => {
  switch (status) {
    case 'reconnecting':
      return 'reconnecting'
    case 'reconciling':
      return 'reconciling'
    case 'error':
      return 'error'
    default:
      return null
  }
}

const commandPhaseState = (phase: CommandPhase): LivePlayConnectionState | null => {
  switch (phase) {
    case 'saving':
      return 'saving-command'
    case 'stale':
      return 'stale'
    case 'error':
      return 'error'
    default:
      return null
  }
}

export const useLivePlayStateMachine = (
  options: UseLivePlayStateMachineOptions,
): UseLivePlayStateMachineReturn => {
  const commandPhase = ref<CommandPhase>('idle')
  const commandMessage = ref<string | null>(null)
  const manualReconciliationDepth = ref(0)

  const externalState = computed<LivePlayConnectionState | null>(() => {
    if (manualReconciliationDepth.value > 0) return 'reconciling'
    return realtimeStatusBlocksLivePlay(options.realtimeStatus.value)
      ?? mapStatusBlocksLivePlay(options.mapStatus.value)
  })

  const state = computed<LivePlayConnectionState>(() => (
    externalState.value
      ?? commandPhaseState(commandPhase.value)
      ?? 'ready'
  ))

  const notice = computed<string | null>(() => {
    switch (state.value) {
      case 'ready':
        return options.realtimeStatus.value === 'reconciled'
          ? options.realtimeNotice?.value ?? null
          : null
      case 'loading':
        return DEFAULT_MESSAGES.loading
      case 'saving-command':
        return commandMessage.value ?? DEFAULT_MESSAGES['saving-command']
      case 'reconnecting':
      case 'reconciling':
        return options.realtimeNotice?.value ?? DEFAULT_MESSAGES[state.value]
      case 'stale':
        return commandMessage.value ?? DEFAULT_MESSAGES.stale
      case 'error':
        return commandMessage.value
          ?? options.mapError?.value
          ?? options.realtimeNotice?.value
          ?? DEFAULT_MESSAGES.error
      default:
        return null
    }
  })

  const commandsAllowed = computed(() => state.value === 'ready')

  const commandBlockMessage = computed<string | null>(() => {
    if (commandsAllowed.value) return null
    return notice.value ?? DEFAULT_MESSAGES[state.value as Exclude<LivePlayConnectionState, 'ready'>]
  })

  const clearCommandError = () => {
    commandPhase.value = 'idle'
    commandMessage.value = null
  }

  const commandStarted = () => {
    commandPhase.value = 'saving'
    commandMessage.value = DEFAULT_MESSAGES['saving-command']
  }

  const commandAccepted = () => {
    clearCommandError()
  }

  const commandRejected = (transition: LivePlayCommandRejectionTransition) => {
    const message = transition.message ?? DEFAULT_MESSAGES.error
    if (transition.reason === 'stale-revision') {
      commandPhase.value = 'stale'
      commandMessage.value = message || DEFAULT_MESSAGES.stale
      return
    }
    commandPhase.value = 'error'
    commandMessage.value = message
  }

  const commandFailed = (message: string) => {
    commandPhase.value = 'error'
    commandMessage.value = message || DEFAULT_MESSAGES.error
  }

  const commandBlocked = (message: string) => {
    commandMessage.value = message || commandBlockMessage.value || DEFAULT_MESSAGES.error
  }

  const reconcile = async <TResult>(task: () => Promise<TResult> | TResult): Promise<TResult> => {
    manualReconciliationDepth.value += 1
    try {
      const result = await task()
      clearCommandError()
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : DEFAULT_MESSAGES.error
      commandFailed(message)
      throw error
    } finally {
      manualReconciliationDepth.value = Math.max(0, manualReconciliationDepth.value - 1)
    }
  }

  return {
    state,
    notice,
    commandsAllowed,
    commandBlockMessage,
    commandStarted,
    commandAccepted,
    commandRejected,
    commandFailed,
    commandBlocked,
    clearCommandError,
    reconcile,
  }
}
