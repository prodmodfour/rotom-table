import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import {
  parseFinishEncounterView,
  type FinishEncounterView,
} from '#shared/encounterSettlement/finish'
import { ENCOUNTER_SETTLEMENT_API_PATHS } from '~/utils/apiRoutes'
import {
  ENCOUNTER_SETTLEMENT_PENDING_SCHEMA_VERSION,
  clearPendingEncounterSettlementOperation,
  EncounterSettlementRecoveryConflictError,
  pendingEncounterSettlementStorageKey,
  readPendingEncounterSettlementOperation,
  writePendingEncounterSettlementOperation,
  type PendingEncounterSettlementOperation,
} from '~/utils/encounterSettlementOperationStorage'
import { useApiClient } from '~/composables/useApiClient'

export type FinishEncounterClientState =
  | 'closed'
  | 'loading'
  | 'reviewing'
  | 'saving'
  | 'uncertain'
  | 'checking'
  | 'accepted'
  | 'error'

interface SettlementOperationStatus {
  readonly status: 'unknown' | 'accepted'
  readonly operationKind?: 'commit' | 'correction'
  readonly retry: 'explicit-only' | 'not-needed'
}

const errorStatus = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null) return null
  const row = error as Record<string, unknown>
  const response = typeof row.response === 'object' && row.response !== null
    ? row.response as Record<string, unknown>
    : null
  const value = row.statusCode ?? row.status ?? response?.status
  return Number.isInteger(value) ? Number(value) : null
}
const errorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
const browserStorage = (): Storage | null => typeof window !== 'undefined' ? window.localStorage : null

export const useFinishEncounter = (input: {
  readonly encounterId: Ref<string>
  readonly enabled: Ref<boolean>
}) => {
  const api = useApiClient()
  const state = ref<FinishEncounterClientState>('closed')
  const view = ref<FinishEncounterView | null>(null)
  const error = ref<string | null>(null)
  const pending = ref<PendingEncounterSettlementOperation | null>(null)
  const unknownVerified = ref(false)
  const online = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)

  const isOpen = computed(() => state.value !== 'closed')
  const busy = computed(() => ['loading', 'saving', 'checking'].includes(state.value))
  const canCommit = computed(() => state.value === 'reviewing'
    && view.value?.state === 'ready' && view.value.command !== null && pending.value === null)
  const canRetry = computed(() => state.value === 'uncertain' && pending.value !== null && online.value)
  const canDiscard = computed(() => state.value === 'uncertain' && pending.value !== null && unknownVerified.value)

  const loadPending = (): PendingEncounterSettlementOperation | null => {
    const storage = browserStorage()
    pending.value = storage
      ? readPendingEncounterSettlementOperation(storage, input.encounterId.value)
      : null
    return pending.value
  }

  const prepare = async (): Promise<void> => {
    if (!input.enabled.value) return
    if (loadPending()) {
      view.value = null
      unknownVerified.value = false
      error.value = 'A Finish Encounter outcome is uncertain. Check the server before reviewing or sending another settlement.'
      state.value = 'uncertain'
      return
    }
    state.value = 'loading'
    error.value = null
    try {
      view.value = parseFinishEncounterView(await api.postJson(
        ENCOUNTER_SETTLEMENT_API_PATHS.prepareFinish,
        { encounterId: input.encounterId.value },
      ))
      state.value = view.value.state === 'accepted' ? 'accepted' : 'reviewing'
    }
    catch (cause) {
      view.value = null
      error.value = errorMessage(cause, 'The current settlement review could not be loaded.')
      state.value = 'error'
    }
  }

  const open = async (): Promise<void> => {
    if (isOpen.value || !input.enabled.value) return
    await prepare()
  }

  const close = (): void => {
    if (busy.value) return
    state.value = 'closed'
    error.value = null
  }

  const refresh = async (): Promise<void> => {
    if (busy.value || pending.value) return
    await prepare()
  }

  const clearRetainedPending = (retained: PendingEncounterSettlementOperation | null): void => {
    const storage = browserStorage()
    if (storage && retained) clearPendingEncounterSettlementOperation(storage, retained)
  }

  const acceptResponse = (
    response: unknown,
    retained: PendingEncounterSettlementOperation | null,
  ): void => {
    view.value = parseFinishEncounterView(response)
    unknownVerified.value = false
    clearRetainedPending(retained)
    pending.value = null
    state.value = 'accepted'
    error.value = null
  }

  const commit = async (): Promise<void> => {
    const command = view.value?.command
    if (!canCommit.value || !command) return
    const storage = browserStorage()
    if (!storage) {
      error.value = 'Durable browser storage is required before Finish Encounter can commit.'
      state.value = 'error'
      return
    }
    unknownVerified.value = false
    try {
      pending.value = writePendingEncounterSettlementOperation(storage, {
        schemaVersion: ENCOUNTER_SETTLEMENT_PENDING_SCHEMA_VERSION,
        encounterId: input.encounterId.value,
        command,
        createdAt: Date.now(),
      })
    }
    catch (cause) {
      loadPending()
      state.value = 'uncertain'
      error.value = cause instanceof EncounterSettlementRecoveryConflictError
        ? cause.message
        : 'The exact settlement command could not be retained durably. No command was sent.'
      return
    }
    const retained = pending.value
    state.value = 'saving'
    error.value = null
    try {
      acceptResponse(await api.postJson(ENCOUNTER_SETTLEMENT_API_PATHS.commitFinish, { command }), retained)
    }
    catch (cause) {
      const status = errorStatus(cause)
      if (status !== null && status >= 400 && status < 500) {
        clearPendingEncounterSettlementOperation(storage, retained!)
        pending.value = null
        error.value = status === 409
          ? 'Encounter authority changed. Refresh and explicitly review the new settlement before confirming again.'
          : errorMessage(cause, 'Finish Encounter was rejected before application.')
        state.value = 'error'
        return
      }
      error.value = 'The Finish Encounter response was interrupted. Do not send a new settlement; check the server or retry this exact command.'
      state.value = 'uncertain'
    }
  }

  const checkServer = async (): Promise<void> => {
    if (!pending.value || state.value === 'checking') return
    if (!online.value) {
      error.value = 'Reconnect before checking the settlement outcome.'
      return
    }
    const retained = pending.value
    unknownVerified.value = false
    state.value = 'checking'
    error.value = null
    try {
      const response = await api.postJson<SettlementOperationStatus>(
        ENCOUNTER_SETTLEMENT_API_PATHS.operationStatus,
        { command: retained.command },
      )
      if (response.status === 'accepted' && response.operationKind === 'commit') {
        clearRetainedPending(retained)
        pending.value = null
        await prepare()
        return
      }
      unknownVerified.value = true
      state.value = 'uncertain'
      error.value = 'The server has no accepted result for this exact command. You may explicitly retry it or discard it and review fresh authority.'
    }
    catch (cause) {
      state.value = 'uncertain'
      error.value = errorMessage(cause, 'The settlement outcome could not be checked.')
    }
  }

  const retryExact = async (): Promise<void> => {
    if (!canRetry.value || !pending.value) return
    const retained = pending.value
    unknownVerified.value = false
    state.value = 'saving'
    error.value = null
    try {
      acceptResponse(await api.postJson(
        ENCOUNTER_SETTLEMENT_API_PATHS.commitFinish,
        { command: retained.command },
      ), retained)
    }
    catch (cause) {
      const status = errorStatus(cause)
      if (status === 409) {
        clearRetainedPending(retained)
        pending.value = null
        state.value = 'error'
        error.value = 'The retained command is no longer current. Review fresh authority before declaring another settlement.'
        return
      }
      state.value = 'uncertain'
      error.value = errorMessage(cause, 'The exact retry did not return a certain outcome. Check the server again.')
    }
  }

  const discardAndReviewFresh = async (): Promise<void> => {
    if (!pending.value || busy.value || !unknownVerified.value) return
    clearRetainedPending(pending.value)
    pending.value = null
    unknownVerified.value = false
    await prepare()
  }

  const handleOnline = (): void => { online.value = true }
  const handleOffline = (): void => { online.value = false }
  const handleStorage = (event: StorageEvent): void => {
    if (event.key !== pendingEncounterSettlementStorageKey(input.encounterId.value) || busy.value) return
    const hadPending = pending.value !== null
    const retained = loadPending()
    if (!retained && hadPending && state.value !== 'saving') {
      unknownVerified.value = false
      state.value = 'error'
      error.value = 'Another tab released the retained command. Refresh current authority before continuing.'
      return
    }
    if (retained && state.value !== 'saving') {
      view.value = null
      unknownVerified.value = false
      state.value = 'uncertain'
      error.value = 'Another tab retained an uncertain Finish Encounter command. Check the server before continuing.'
    }
  }
  onMounted(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('storage', handleStorage)
    loadPending()
  })
  onBeforeUnmount(() => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    window.removeEventListener('storage', handleStorage)
  })

  return {
    state: computed(() => state.value),
    view: computed(() => view.value),
    error: computed(() => error.value),
    pending: computed(() => pending.value),
    online: computed(() => online.value),
    isOpen,
    busy,
    canCommit,
    canRetry,
    canDiscard,
    open,
    close,
    refresh,
    commit,
    checkServer,
    retryExact,
    discardAndReviewFresh,
  }
}
