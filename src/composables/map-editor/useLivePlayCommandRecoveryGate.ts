import {
  computed,
  getCurrentScope,
  onScopeDispose,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue'
import { MAP_INTERACTION_MODES, type MapInteractionMode } from '#shared/mapInteractionMode'
import type {
  LivePlayCommandDispatchResult,
  LivePlayCommandOutboxRecoveryStatus,
  LivePlayCommandStatus,
} from '~/composables/map-editor/useLivePlayCommands'
import type { LivePlayCommandOutboxEntry } from '~/utils/livePlayCommandOutbox'

interface ReadonlyValueRef<TValue> {
  readonly value: TValue
}

type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>

type TimerApi = Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>

interface BrowserEventTarget {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void
}

interface VisibilityDocument extends BrowserEventTarget {
  readonly hidden: boolean
}

export interface UseLivePlayCommandRecoveryGateClock {
  readonly now?: () => number
  readonly timers?: TimerApi
}

export interface UseLivePlayCommandRecoveryGateBrowserBindings {
  readonly isClient?: boolean
  readonly document?: VisibilityDocument | null
  readonly window?: BrowserEventTarget | null
}

export interface UseLivePlayCommandRecoveryGateOptions {
  readonly contextKey: ReadonlyValueRef<string | null>
  readonly enabled: ReadonlyValueRef<boolean>
  readonly interactionMode: ReadonlyValueRef<MapInteractionMode>

  readonly commandStatus: ReadonlyValueRef<LivePlayCommandStatus>
  readonly entries: ReadonlyValueRef<readonly LivePlayCommandOutboxEntry[]>
  readonly recoveryStatus: ReadonlyValueRef<LivePlayCommandOutboxRecoveryStatus>
  readonly recoveryError: ReadonlyValueRef<string | null>

  readonly recoverInterrupted: () => Promise<readonly LivePlayCommandOutboxEntry[]>
  readonly refresh: () => Promise<readonly LivePlayCommandOutboxEntry[]>
  readonly retry: (opId: string) => Promise<LivePlayCommandDispatchResult>

  readonly clock?: UseLivePlayCommandRecoveryGateClock
  readonly browser?: UseLivePlayCommandRecoveryGateBrowserBindings
}

export interface UseLivePlayCommandRecoveryGateReturn {
  readonly readyForCurrentContext: ComputedRef<boolean>
  readonly blocksNewLiveCommands: ComputedRef<boolean>
  readonly blockMessage: ComputedRef<string | null>
  readonly panelVisible: ComputedRef<boolean>
  readonly retryingOpId: Ref<string | null>
  readonly refreshRecovery: () => Promise<void>
  readonly retryEntry: (opId: string) => Promise<LivePlayCommandDispatchResult>
}

const RECOVERY_INSPECTION_MESSAGE = 'Checking for interrupted live-play commands before actions resume.'
const RECOVERY_ERROR_MESSAGE = 'Durable command recovery is unavailable. Refresh recovery before sending live-play actions.'
const REALTIME_SYNCHRONIZING_MESSAGE = 'Synchronizing accepted command with the authoritative live table snapshot.'
const RETRYING_MESSAGE = 'Retrying the pending live-play command with its original operation ID.'

const pendingCommandMessage = (count: number): string => (
  count === 1
    ? 'Resolve the pending live-play command before sending another action.'
    : `Resolve the ${count} pending live-play commands before sending another action.`
)

const activeContextKey = (options: UseLivePlayCommandRecoveryGateOptions, isClient: boolean): string | null => {
  if (!isClient) return null
  if (!options.enabled.value) return null
  return options.contextKey.value
}

const resolveIsClient = (bindings: UseLivePlayCommandRecoveryGateBrowserBindings | undefined): boolean => (
  bindings?.isClient ?? import.meta.client === true
)

const resolveDocument = (
  bindings: UseLivePlayCommandRecoveryGateBrowserBindings | undefined,
  isClient: boolean,
): VisibilityDocument | null => {
  if (!isClient) return null
  if (bindings && 'document' in bindings) return bindings.document ?? null
  return typeof document === 'undefined' ? null : document
}

const resolveWindow = (
  bindings: UseLivePlayCommandRecoveryGateBrowserBindings | undefined,
  isClient: boolean,
): BrowserEventTarget | null => {
  if (!isClient) return null
  if (bindings && 'window' in bindings) return bindings.window ?? null
  return typeof window === 'undefined' ? null : window
}

export const useLivePlayCommandRecoveryGate = (
  options: UseLivePlayCommandRecoveryGateOptions,
): UseLivePlayCommandRecoveryGateReturn => {
  const isClient = resolveIsClient(options.browser)
  const now = options.clock?.now ?? (() => Date.now())
  const timers = options.clock?.timers ?? globalThis
  const readyContextKey = ref<string | null>(null)
  const retryingOpId = ref<string | null>(null)

  let requestGeneration = 0
  let activeRecovery: Promise<readonly LivePlayCommandOutboxEntry[]> | null = null
  let activeRecoveryContextKey: string | null = null
  let activeRecoveryGeneration: number | null = null
  let activeRetry: Promise<LivePlayCommandDispatchResult> | null = null
  let activeRetryOpId: string | null = null
  let leaseTimer: TimeoutHandle | null = null

  const clearLeaseTimer = (): void => {
    if (leaseTimer === null) return
    timers.clearTimeout(leaseTimer)
    leaseTimer = null
  }

  const currentContextKey = (): string | null => activeContextKey(options, isClient)

  const contextStillCurrent = (contextKey: string, generation: number): boolean => (
    currentContextKey() === contextKey && requestGeneration === generation
  )

  const earliestFutureLeaseExpiry = (): number | null => {
    const currentTime = now()
    let earliest: number | null = null

    for (const entry of options.entries.value) {
      if (entry.state !== 'sending') continue
      if (typeof entry.leaseExpiresAt !== 'number') continue
      if (entry.leaseExpiresAt <= currentTime) return currentTime
      if (earliest === null || entry.leaseExpiresAt < earliest) earliest = entry.leaseExpiresAt
    }

    return earliest
  }

  const scheduleLeaseRecovery = (): void => {
    clearLeaseTimer()
    if (currentContextKey() === null) return

    const expiry = earliestFutureLeaseExpiry()
    if (expiry === null) return

    const delay = Math.max(0, expiry - now())
    leaseTimer = timers.setTimeout(() => {
      leaseTimer = null
      void runRecoveryForCurrentContext()
    }, delay)
  }

  const runRecoveryForCurrentContext = async (): Promise<readonly LivePlayCommandOutboxEntry[]> => {
    const contextKey = currentContextKey()
    if (contextKey === null) {
      readyContextKey.value = null
      clearLeaseTimer()
      return []
    }

    if (
      activeRecovery
      && activeRecoveryContextKey === contextKey
      && activeRecoveryGeneration === requestGeneration
    ) {
      return activeRecovery
    }

    requestGeneration += 1
    const generation = requestGeneration
    readyContextKey.value = null
    clearLeaseTimer()

    activeRecoveryContextKey = contextKey
    activeRecoveryGeneration = generation
    let recoveredSuccessfully = false
    activeRecovery = options.recoverInterrupted()
      .then((entries) => {
        recoveredSuccessfully = true
        if (contextStillCurrent(contextKey, generation)) readyContextKey.value = contextKey
        return entries
      })
      .finally(() => {
        if (activeRecoveryContextKey === contextKey && activeRecoveryGeneration === generation) {
          activeRecovery = null
          activeRecoveryContextKey = null
          activeRecoveryGeneration = null
        }
        if (recoveredSuccessfully && currentContextKey() === contextKey && requestGeneration === generation) {
          scheduleLeaseRecovery()
        }
      })

    return activeRecovery
  }

  const refreshRecovery = async (): Promise<void> => {
    await runRecoveryForCurrentContext()
  }

  const refreshAfterRetry = async (): Promise<void> => {
    const contextKey = currentContextKey()
    if (contextKey === null) return
    try {
      await options.refresh()
    } finally {
      if (currentContextKey() === contextKey) scheduleLeaseRecovery()
    }
  }

  const retryEntry = (opId: string): Promise<LivePlayCommandDispatchResult> => {
    if (activeRetry !== null) {
      if (activeRetryOpId === opId) return activeRetry
      return Promise.resolve({
        dispatched: false,
        message: RETRYING_MESSAGE,
        opId,
      })
    }

    retryingOpId.value = opId
    activeRetryOpId = opId
    activeRetry = options.retry(opId)
      .finally(async () => {
        try {
          await refreshAfterRetry().catch(() => undefined)
        } finally {
          if (activeRetryOpId === opId) {
            retryingOpId.value = null
            activeRetryOpId = null
          }
          activeRetry = null
        }
      })

    return activeRetry
  }

  const readyForCurrentContext = computed(() => {
    const contextKey = currentContextKey()
    return contextKey !== null && readyContextKey.value === contextKey
  })

  const hasRecoveryError = computed(() => (
    options.recoveryStatus.value === 'error' || options.recoveryError.value !== null
  ))

  const blocksNewLiveCommands = computed(() => {
    if (options.interactionMode.value !== MAP_INTERACTION_MODES.LIVE_PLAY) return false
    return !readyForCurrentContext.value
      || options.recoveryStatus.value === 'loading'
      || options.recoveryStatus.value === 'synchronizing'
      || hasRecoveryError.value
      || options.entries.value.length > 0
      || retryingOpId.value !== null
  })

  const blockMessage = computed<string | null>(() => {
    if (options.interactionMode.value !== MAP_INTERACTION_MODES.LIVE_PLAY) return null
    if (retryingOpId.value !== null) return RETRYING_MESSAGE
    if (options.recoveryStatus.value === 'synchronizing') return REALTIME_SYNCHRONIZING_MESSAGE
    if (hasRecoveryError.value) return options.recoveryError.value ?? RECOVERY_ERROR_MESSAGE
    if (!readyForCurrentContext.value || options.recoveryStatus.value === 'loading') return RECOVERY_INSPECTION_MESSAGE
    if (options.entries.value.length > 0) return pendingCommandMessage(options.entries.value.length)
    return null
  })

  const ordinaryImmediateSendingOnly = computed(() => (
    options.commandStatus.value === 'saving'
    && options.recoveryStatus.value !== 'retrying'
    && readyForCurrentContext.value
    && options.entries.value.length === 1
    && options.entries.value[0]?.state === 'sending'
    && retryingOpId.value === null
  ))

  const panelVisible = computed(() => {
    if (!isClient) return false
    if (ordinaryImmediateSendingOnly.value) return false
    const hasActiveContext = currentContextKey() !== null
    return options.recoveryStatus.value === 'loading'
      || options.recoveryStatus.value === 'retrying'
      || options.recoveryStatus.value === 'synchronizing'
      || (hasActiveContext && !readyForCurrentContext.value)
      || hasRecoveryError.value
      || options.entries.value.length > 0
      || retryingOpId.value !== null
  })

  watch(
    () => [options.contextKey.value, options.enabled.value] as const,
    () => {
      requestGeneration += 1
      readyContextKey.value = null
      retryingOpId.value = null
      activeRetry = null
      activeRetryOpId = null
      clearLeaseTimer()
      void runRecoveryForCurrentContext().catch(() => undefined)
    },
    { flush: 'sync', immediate: true },
  )

  watch(
    () => options.entries.value.map((entry) => `${entry.opId}:${entry.state}:${entry.leaseExpiresAt ?? ''}`).join('|'),
    () => scheduleLeaseRecovery(),
    { flush: 'post' },
  )

  const visibilityDocument = resolveDocument(options.browser, isClient)
  const focusWindow = resolveWindow(options.browser, isClient)

  const handleVisibilityChange: EventListener = () => {
    if (visibilityDocument?.hidden) return
    void runRecoveryForCurrentContext().catch(() => undefined)
  }
  const handleFocus: EventListener = () => {
    void runRecoveryForCurrentContext().catch(() => undefined)
  }

  if (isClient) {
    visibilityDocument?.addEventListener('visibilitychange', handleVisibilityChange)
    focusWindow?.addEventListener('focus', handleFocus)
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      clearLeaseTimer()
      if (isClient) {
        visibilityDocument?.removeEventListener('visibilitychange', handleVisibilityChange)
        focusWindow?.removeEventListener('focus', handleFocus)
      }
    })
  }

  return {
    readyForCurrentContext,
    blocksNewLiveCommands,
    blockMessage,
    panelVisible,
    retryingOpId,
    refreshRecovery,
    retryEntry,
  }
}
