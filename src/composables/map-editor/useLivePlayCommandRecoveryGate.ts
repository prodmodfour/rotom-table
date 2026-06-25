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
  LivePlayOperationAbandonmentClientResult,
  LivePlayOperationStatusCheckResult,
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

export interface LivePlayCommandStatusInspection {
  readonly status: 'unknown' | 'error'
  readonly message: string
  readonly checkedAt: number
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
  readonly checkStatus: (opId: string) => Promise<LivePlayOperationStatusCheckResult>
  readonly abandon: (opId: string) => Promise<LivePlayOperationAbandonmentClientResult>

  readonly clock?: UseLivePlayCommandRecoveryGateClock
  readonly browser?: UseLivePlayCommandRecoveryGateBrowserBindings
}

export interface UseLivePlayCommandRecoveryGateReturn {
  readonly readyForCurrentContext: ComputedRef<boolean>
  readonly blocksNewLiveCommands: ComputedRef<boolean>
  readonly blockMessage: ComputedRef<string | null>
  readonly panelVisible: ComputedRef<boolean>
  readonly retryingOpId: Ref<string | null>
  readonly checkingOpId: Ref<string | null>
  readonly confirmingAbandonOpId: Ref<string | null>
  readonly abandoningOpId: Ref<string | null>
  readonly statusResultByOpId: Readonly<Ref<Record<string, LivePlayCommandStatusInspection>>>
  readonly resolutionNotice: Ref<string | null>
  readonly refreshRecovery: () => Promise<void>
  readonly retryEntry: (opId: string) => Promise<LivePlayCommandDispatchResult>
  readonly checkEntry: (opId: string) => Promise<LivePlayOperationStatusCheckResult>
  readonly requestAbandonConfirmation: (opId: string) => void
  readonly cancelAbandonConfirmation: () => void
  readonly confirmAbandon: (opId: string) => Promise<LivePlayOperationAbandonmentClientResult>
  readonly clearResolutionNotice: () => void
}

const RECOVERY_INSPECTION_MESSAGE = 'Checking for interrupted live-play commands before actions resume.'
const RECOVERY_ERROR_MESSAGE = 'Durable command recovery is unavailable. Refresh recovery before sending live-play actions.'
const REALTIME_SYNCHRONIZING_MESSAGE = 'Synchronizing accepted command with the authoritative live table snapshot.'
const RETRYING_MESSAGE = 'Retrying the pending live-play command with its original operation ID.'
const STATUS_CHECKING_MESSAGE = 'Checking the server for a terminal command result without resending the command.'
const ABANDONING_MESSAGE = 'Abandoning the pending live-play operation safely on the server.'
const STATUS_CHECK_BLOCKED_BY_RETRY_MESSAGE = 'A live-play command retry is already active. Wait for it to finish before checking the server.'
const RETRY_BLOCKED_BY_STATUS_CHECK_MESSAGE = 'A read-only server status check is already active. Wait for it to finish before retrying.'
const RETRY_BLOCKED_BY_ABANDON_MESSAGE = 'A live-play operation abandonment is already active. Wait for it to finish before retrying.'
const STATUS_CHECK_BLOCKED_BY_ABANDON_MESSAGE = 'A live-play operation abandonment is already active. Wait for it to finish before checking the server.'
const ABANDON_BLOCKED_BY_RETRY_MESSAGE = 'A live-play command retry is already active. Wait for it to finish before abandoning an operation.'
const ABANDON_BLOCKED_BY_STATUS_CHECK_MESSAGE = 'A read-only server status check is already active. Wait for it to finish before abandoning an operation.'
const ABANDON_CONFIRMATION_REQUIRED_MESSAGE = 'Choose Abandon… for this operation before confirming abandonment.'

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
  const checkingOpId = ref<string | null>(null)
  const confirmingAbandonOpId = ref<string | null>(null)
  const abandoningOpId = ref<string | null>(null)
  const statusResultByOpId = ref<Record<string, LivePlayCommandStatusInspection>>({})
  const resolutionNotice = ref<string | null>(null)

  let requestGeneration = 0
  let statusContextGeneration = 0
  let disposed = false
  let activeRecovery: Promise<readonly LivePlayCommandOutboxEntry[]> | null = null
  let activeRecoveryContextKey: string | null = null
  let activeRecoveryGeneration: number | null = null
  let activeRetry: Promise<LivePlayCommandDispatchResult> | null = null
  let activeRetryOpId: string | null = null
  let activeStatusCheck: Promise<LivePlayOperationStatusCheckResult> | null = null
  let activeStatusCheckOpId: string | null = null
  let activeStatusCheckContextKey: string | null = null
  let activeStatusCheckGeneration: number | null = null
  let activeAbandonment: Promise<LivePlayOperationAbandonmentClientResult> | null = null
  let activeAbandonmentOpId: string | null = null
  let activeAbandonmentContextKey: string | null = null
  let activeAbandonmentGeneration: number | null = null
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

  const entryExists = (opId: string): boolean => options.entries.value.some((entry) => entry.opId === opId)

  const clearStatusInspection = (opId: string): void => {
    if (!Object.prototype.hasOwnProperty.call(statusResultByOpId.value, opId)) return
    const next = { ...statusResultByOpId.value }
    delete next[opId]
    statusResultByOpId.value = next
  }

  const clearAllStatusInspections = (): void => {
    statusResultByOpId.value = {}
  }

  const recordStatusInspection = (
    opId: string,
    status: LivePlayCommandStatusInspection['status'],
    message: string,
  ): void => {
    if (!entryExists(opId)) {
      clearStatusInspection(opId)
      return
    }
    statusResultByOpId.value = {
      ...statusResultByOpId.value,
      [opId]: { status, message, checkedAt: now() },
    }
  }

  const pruneStatusInspections = (): void => {
    const existingOpIds = new Set(options.entries.value.map((entry) => entry.opId))
    const next: Record<string, LivePlayCommandStatusInspection> = {}
    for (const [opId, inspection] of Object.entries(statusResultByOpId.value)) {
      if (existingOpIds.has(opId)) next[opId] = inspection
    }
    if (Object.keys(next).length !== Object.keys(statusResultByOpId.value).length) {
      statusResultByOpId.value = next
    }
  }

  const clearActiveStatusCheck = (): void => {
    activeStatusCheck = null
    activeStatusCheckOpId = null
    activeStatusCheckContextKey = null
    activeStatusCheckGeneration = null
    checkingOpId.value = null
  }

  const statusCheckResultBlocked = (
    opId: string,
    message: string,
  ): LivePlayOperationStatusCheckResult => ({ status: 'error', opId, message })

  const abandonmentResultBlocked = (
    opId: string,
    message: string,
  ): LivePlayOperationAbandonmentClientResult => ({ status: 'error', opId, message })

  const clearAbandonConfirmation = (): void => {
    confirmingAbandonOpId.value = null
  }

  const clearResolutionNotice = (): void => {
    resolutionNotice.value = null
  }

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

    if (activeAbandonment !== null) {
      await activeAbandonment.catch(() => undefined)
      return options.entries.value
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
    if (activeAbandonment !== null) {
      await activeAbandonment.catch(() => undefined)
      return
    }
    if (activeStatusCheck !== null) {
      await activeStatusCheck.catch(() => undefined)
      return
    }
    if (activeRetry !== null) {
      await activeRetry.catch(() => undefined)
      return
    }
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
    if (activeAbandonment !== null) {
      return Promise.resolve({
        dispatched: false,
        message: RETRY_BLOCKED_BY_ABANDON_MESSAGE,
        opId,
      })
    }

    if (activeStatusCheck !== null) {
      return Promise.resolve({
        dispatched: false,
        message: RETRY_BLOCKED_BY_STATUS_CHECK_MESSAGE,
        opId,
      })
    }

    if (activeRetry !== null) {
      if (activeRetryOpId === opId) return activeRetry
      return Promise.resolve({
        dispatched: false,
        message: RETRYING_MESSAGE,
        opId,
      })
    }

    clearAbandonConfirmation()
    clearStatusInspection(opId)
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

  const applyStatusCheckResult = (
    opId: string,
    result: LivePlayOperationStatusCheckResult,
    contextKey: string,
    generation: number,
  ): void => {
    if (disposed) return
    if (currentContextKey() !== contextKey || statusContextGeneration !== generation) return

    if (result.status === 'unknown' || result.status === 'error') {
      recordStatusInspection(opId, result.status, result.message)
      return
    }

    clearStatusInspection(opId)
    pruneStatusInspections()
  }

  const checkEntry = (opId: string): Promise<LivePlayOperationStatusCheckResult> => {
    if (activeAbandonment !== null) {
      recordStatusInspection(opId, 'error', STATUS_CHECK_BLOCKED_BY_ABANDON_MESSAGE)
      return Promise.resolve(statusCheckResultBlocked(opId, STATUS_CHECK_BLOCKED_BY_ABANDON_MESSAGE))
    }

    if (activeStatusCheck !== null) {
      if (activeStatusCheckOpId === opId) return activeStatusCheck
      const message = `Live-play operation ${activeStatusCheckOpId ?? '(unknown)'} is already being checked with the server. Wait for that read-only status check to finish before checking another operation.`
      recordStatusInspection(opId, 'error', message)
      return Promise.resolve(statusCheckResultBlocked(opId, message))
    }

    if (activeRetry !== null) {
      recordStatusInspection(opId, 'error', STATUS_CHECK_BLOCKED_BY_RETRY_MESSAGE)
      return Promise.resolve(statusCheckResultBlocked(opId, STATUS_CHECK_BLOCKED_BY_RETRY_MESSAGE))
    }

    const contextKey = currentContextKey()
    if (contextKey === null) {
      const message = 'A valid live-play recovery context is required before checking the server.'
      recordStatusInspection(opId, 'error', message)
      return Promise.resolve(statusCheckResultBlocked(opId, message))
    }

    const generation = statusContextGeneration
    clearAbandonConfirmation()
    clearStatusInspection(opId)
    checkingOpId.value = opId
    activeStatusCheckOpId = opId
    activeStatusCheckContextKey = contextKey
    activeStatusCheckGeneration = generation
    activeStatusCheck = options.checkStatus(opId)
      .catch((error): LivePlayOperationStatusCheckResult => {
        const message = error instanceof Error
          ? error.message
          : 'The server status check failed before a result was returned.'
        return { status: 'error', opId, message }
      })
      .then((result) => {
        applyStatusCheckResult(opId, result, contextKey, generation)
        return result
      })
      .finally(() => {
        if (
          activeStatusCheckOpId === opId
          && activeStatusCheckContextKey === contextKey
          && activeStatusCheckGeneration === generation
        ) {
          clearActiveStatusCheck()
        }
      })

    return activeStatusCheck
  }

  const requestAbandonConfirmation = (opId: string): void => {
    if (!entryExists(opId)) return
    if (activeAbandonment !== null) return
    confirmingAbandonOpId.value = opId
    clearResolutionNotice()
  }

  const cancelAbandonConfirmation = (): void => {
    if (activeAbandonment !== null) return
    clearAbandonConfirmation()
  }

  const applyAbandonmentResult = (
    opId: string,
    result: LivePlayOperationAbandonmentClientResult,
    contextKey: string,
    generation: number,
  ): void => {
    if (disposed) return
    if (currentContextKey() !== contextKey || statusContextGeneration !== generation) return

    if (result.status === 'error') {
      recordStatusInspection(opId, 'error', result.message)
      return
    }

    clearStatusInspection(opId)
    pruneStatusInspections()
    resolutionNotice.value = result.message ?? (
      result.status === 'accepted'
        ? 'The operation had already been accepted by the server. The authoritative table state was synchronized.'
        : 'The pending live-play operation reached a terminal server result.'
    )
  }

  const confirmAbandon = (opId: string): Promise<LivePlayOperationAbandonmentClientResult> => {
    if (activeAbandonment !== null) {
      if (activeAbandonmentOpId === opId) return activeAbandonment
      return Promise.resolve(abandonmentResultBlocked(
        opId,
        `Live-play operation ${activeAbandonmentOpId ?? '(unknown)'} is already being abandoned. Wait for it to finish before abandoning another operation.`,
      ))
    }

    if (activeRetry !== null) return Promise.resolve(abandonmentResultBlocked(opId, ABANDON_BLOCKED_BY_RETRY_MESSAGE))
    if (activeStatusCheck !== null) return Promise.resolve(abandonmentResultBlocked(opId, ABANDON_BLOCKED_BY_STATUS_CHECK_MESSAGE))

    const contextKey = currentContextKey()
    if (contextKey === null) {
      return Promise.resolve(abandonmentResultBlocked(
        opId,
        'A valid live-play recovery context is required before abandoning an operation.',
      ))
    }

    if (confirmingAbandonOpId.value !== opId) {
      return Promise.resolve(abandonmentResultBlocked(opId, ABANDON_CONFIRMATION_REQUIRED_MESSAGE))
    }

    if (!entryExists(opId)) {
      clearAbandonConfirmation()
      return Promise.resolve(abandonmentResultBlocked(
        opId,
        'The live-play operation is no longer present in the recovery list.',
      ))
    }

    const generation = statusContextGeneration
    clearStatusInspection(opId)
    abandoningOpId.value = opId
    activeAbandonmentOpId = opId
    activeAbandonmentContextKey = contextKey
    activeAbandonmentGeneration = generation
    activeAbandonment = options.abandon(opId)
      .catch((error): LivePlayOperationAbandonmentClientResult => ({
        status: 'error',
        opId,
        message: error instanceof Error
          ? error.message
          : 'Live-play operation abandonment failed before a result was returned.',
      }))
      .then((result) => {
        applyAbandonmentResult(opId, result, contextKey, generation)
        return result
      })
      .finally(() => {
        const belongsToThisRequest = activeAbandonmentOpId === opId && activeAbandonmentContextKey === contextKey
        const stillCurrent = belongsToThisRequest && activeAbandonmentGeneration === generation
        if (stillCurrent) {
          abandoningOpId.value = null
          clearAbandonConfirmation()
          scheduleLeaseRecovery()
        }
        if (belongsToThisRequest) {
          activeAbandonmentOpId = null
          activeAbandonmentContextKey = null
          activeAbandonmentGeneration = null
          activeAbandonment = null
        }
      })

    return activeAbandonment
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
      || options.recoveryStatus.value === 'checking'
      || options.recoveryStatus.value === 'abandoning'
      || options.recoveryStatus.value === 'synchronizing'
      || hasRecoveryError.value
      || options.entries.value.length > 0
      || retryingOpId.value !== null
      || checkingOpId.value !== null
      || abandoningOpId.value !== null
  })

  const blockMessage = computed<string | null>(() => {
    if (options.interactionMode.value !== MAP_INTERACTION_MODES.LIVE_PLAY) return null
    if (retryingOpId.value !== null) return RETRYING_MESSAGE
    if (checkingOpId.value !== null || options.recoveryStatus.value === 'checking') return STATUS_CHECKING_MESSAGE
    if (abandoningOpId.value !== null || options.recoveryStatus.value === 'abandoning') return ABANDONING_MESSAGE
    if (options.recoveryStatus.value === 'synchronizing') return REALTIME_SYNCHRONIZING_MESSAGE
    if (hasRecoveryError.value) return options.recoveryError.value ?? RECOVERY_ERROR_MESSAGE
    if (!readyForCurrentContext.value || options.recoveryStatus.value === 'loading') return RECOVERY_INSPECTION_MESSAGE
    if (options.entries.value.length > 0) return pendingCommandMessage(options.entries.value.length)
    return null
  })

  const ordinaryImmediateSendingOnly = computed(() => (
    options.commandStatus.value === 'saving'
    && options.recoveryStatus.value !== 'retrying'
    && options.recoveryStatus.value !== 'checking'
    && options.recoveryStatus.value !== 'abandoning'
    && readyForCurrentContext.value
    && options.entries.value.length === 1
    && options.entries.value[0]?.state === 'sending'
    && retryingOpId.value === null
    && checkingOpId.value === null
    && abandoningOpId.value === null
  ))

  const panelVisible = computed(() => {
    if (!isClient) return false
    if (ordinaryImmediateSendingOnly.value) return false
    const hasActiveContext = currentContextKey() !== null
    return options.recoveryStatus.value === 'loading'
      || options.recoveryStatus.value === 'retrying'
      || options.recoveryStatus.value === 'checking'
      || options.recoveryStatus.value === 'abandoning'
      || options.recoveryStatus.value === 'synchronizing'
      || (hasActiveContext && !readyForCurrentContext.value)
      || hasRecoveryError.value
      || options.entries.value.length > 0
      || retryingOpId.value !== null
      || checkingOpId.value !== null
      || confirmingAbandonOpId.value !== null
      || abandoningOpId.value !== null
      || resolutionNotice.value !== null
  })

  watch(
    () => [options.contextKey.value, options.enabled.value] as const,
    () => {
      requestGeneration += 1
      statusContextGeneration += 1
      readyContextKey.value = null
      retryingOpId.value = null
      confirmingAbandonOpId.value = null
      abandoningOpId.value = null
      resolutionNotice.value = null
      activeRetry = null
      activeRetryOpId = null
      clearActiveStatusCheck()
      clearAllStatusInspections()
      clearLeaseTimer()
      void runRecoveryForCurrentContext().catch(() => undefined)
    },
    { flush: 'sync', immediate: true },
  )

  watch(
    () => options.entries.value.map((entry) => `${entry.opId}:${entry.state}:${entry.leaseExpiresAt ?? ''}`).join('|'),
    () => {
      pruneStatusInspections()
      if (confirmingAbandonOpId.value !== null && !entryExists(confirmingAbandonOpId.value)) {
        confirmingAbandonOpId.value = null
      }
      scheduleLeaseRecovery()
    },
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
      disposed = true
      statusContextGeneration += 1
      confirmingAbandonOpId.value = null
      abandoningOpId.value = null
      resolutionNotice.value = null
      clearActiveStatusCheck()
      clearAllStatusInspections()
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
    checkingOpId,
    confirmingAbandonOpId,
    abandoningOpId,
    statusResultByOpId,
    resolutionNotice,
    refreshRecovery,
    retryEntry,
    checkEntry,
    requestAbandonConfirmation,
    cancelAbandonConfirmation,
    confirmAbandon,
    clearResolutionNotice,
  }
}
