import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  parseCampaignDayPreflightProjection,
  type CampaignDayAcceptedPostflightV1,
  type CampaignDayPreflightProjectionV1,
} from '#shared/campaignDayPreflight'
import {
  parseCampaignNextDayResult,
  type CampaignDayOperationCommandV1,
  type CampaignNextDayResult,
} from '#shared/campaignDay'
import { useApiClient } from '~/composables/useApiClient'
import { CAMPAIGN_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import {
  CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY,
  clearPendingCampaignDayOperation,
  loadPendingCampaignDayOperation,
  pendingCampaignDayOperation,
  retainPendingCampaignDayOperation,
} from '~/utils/campaignDayOperationStorage'

export type CampaignDayPreflightPhase =
  | 'idle' | 'loading' | 'ready' | 'blocked' | 'committing' | 'accepted' | 'error'

export interface CampaignDayPostflightState {
  readonly clock: CampaignDayPreflightProjectionV1['clock']
  readonly accepted: CampaignDayAcceptedPostflightV1
}

const statusCode = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null) return null
  const row = error as Record<string, unknown>
  const data = typeof row.data === 'object' && row.data !== null ? row.data as Record<string, unknown> : null
  for (const value of [row.statusCode, row.status, data?.statusCode, data?.status]) {
    if (Number.isSafeInteger(value)) return Number(value)
  }
  return null
}

const acceptedFromResult = (
  result: CampaignNextDayResult,
  preview: CampaignDayPreflightProjectionV1,
): CampaignDayPostflightState => {
  const keepRows = preview.impact.affectedSheetCount === result.updatedSheets
  const impact = {
    totalSheets: result.totalSheets,
    affectedSheetCount: result.updatedSheets,
    affectedSheets: keepRows ? preview.impact.affectedSheets : [],
    additionalAffectedSheets: keepRows ? preview.impact.additionalAffectedSheets : result.updatedSheets,
    pokemonAffected: result.pokemonUpdated,
    trainerAffected: result.trainerUpdated,
    hitPointsRestored: result.hitPointsRestored,
    injuriesHealed: result.injuriesHealed,
    conditionsCleared: result.conditionsCleared,
    dailyMoveUsesCleared: result.dailyMoveUsesCleared,
    dailyMoveEntriesCleared: result.dailyMoveEntriesCleared,
    trainerApRestored: result.trainerApRestored,
    reconciledEggs: result.campaignClock.reconciledEggs,
    creditedEggCampaignMinutes: result.campaignClock.creditedEggCampaignMinutes,
    skippedPausedEggCampaignMinutes: result.campaignClock.skippedPausedEggCampaignMinutes,
    expiredEffects: result.expiredEffects.length,
  }
  const parsed = parseCampaignDayPreflightProjection({
    schemaVersion: 1,
    state: 'already-accepted',
    preflightId: null,
    clock: {
      currentCampaignMinute: result.campaignClock.previousCampaignMinute,
      targetCampaignMinute: result.campaignClock.campaignMinute,
      minutesAdvanced: result.campaignClock.minutesAdvanced,
    },
    blockers: [],
    impact,
    accepted: { replayed: result.replayed, impact },
  })
  return Object.freeze({ clock: parsed.clock, accepted: parsed.accepted! })
}

export const useCampaignDayPreflight = (options: {
  readonly onAccepted?: () => void | Promise<void>
} = {}) => {
  const apiClient = useApiClient()
  const open = ref(false)
  const phase = ref<CampaignDayPreflightPhase>('idle')
  const projection = ref<CampaignDayPreflightProjectionV1 | null>(null)
  const postflight = ref<CampaignDayPostflightState | null>(null)
  const command = ref<CampaignDayOperationCommandV1 | null>(null)
  const confirmed = ref(false)
  const error = ref<string | null>(null)
  const uncertain = ref(false)
  const online = ref(true)
  let requestGeneration = 0

  const sameCommand = (
    left: CampaignDayOperationCommandV1 | null,
    right: CampaignDayOperationCommandV1 | null,
  ): boolean => Boolean(left && right
    && left.schemaVersion === right.schemaVersion
    && left.operationId === right.operationId
    && left.kind === right.kind
    && left.days === right.days)

  const busy = computed(() => phase.value === 'loading' || phase.value === 'committing')
  const canCommit = computed(() => phase.value === 'ready'
    && projection.value?.state === 'ready'
    && projection.value.preflightId !== null
    && confirmed.value
    && online.value)

  const notifyAccepted = async (): Promise<void> => {
    await options.onAccepted?.()
  }

  const check = async (): Promise<void> => {
    const exactCommand = command.value ?? pendingCampaignDayOperation()
    command.value = exactCommand
    const generation = ++requestGeneration
    phase.value = 'loading'
    error.value = null
    confirmed.value = false
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      online.value = false
      phase.value = 'error'
      error.value = 'Connection is offline. Reconnect before checking campaign-day authority.'
      return
    }
    try {
      const response = await apiClient.postJson<unknown>(CAMPAIGN_API_PATHS.nextDayPreflight, exactCommand)
      if (generation !== requestGeneration || command.value?.operationId !== exactCommand.operationId) return
      const parsed = parseCampaignDayPreflightProjection(response)
      projection.value = parsed
      uncertain.value = false
      if (parsed.state === 'already-accepted') {
        clearPendingCampaignDayOperation(exactCommand.operationId)
        postflight.value = Object.freeze({ clock: parsed.clock, accepted: parsed.accepted! })
        phase.value = 'accepted'
        await notifyAccepted()
      }
      else {
        retainPendingCampaignDayOperation(exactCommand)
        postflight.value = null
        phase.value = parsed.state
      }
    }
    catch (cause) {
      if (generation !== requestGeneration || command.value?.operationId !== exactCommand.operationId) return
      phase.value = 'error'
      error.value = getErrorMessage(cause)
    }
  }

  const show = async (): Promise<void> => {
    if (busy.value) return
    open.value = true
    command.value = pendingCampaignDayOperation()
    await check()
  }

  const commit = async (): Promise<void> => {
    const exactCommand = command.value
    const reviewed = projection.value
    if (!exactCommand || !reviewed || !canCommit.value || !reviewed.preflightId) return
    if (!sameCommand(loadPendingCampaignDayOperation(), exactCommand)) {
      phase.value = 'error'
      confirmed.value = false
      uncertain.value = true
      error.value = 'The retained campaign-day command changed in another tab. Check its exact accepted status before reviewing fresh authority.'
      return
    }
    const generation = ++requestGeneration
    phase.value = 'committing'
    error.value = null
    uncertain.value = false
    try {
      const response = await apiClient.postJson<unknown>(CAMPAIGN_API_PATHS.nextDay, {
        ...exactCommand,
        preflightId: reviewed.preflightId,
        clientId: getClientId(),
      })
      if (generation !== requestGeneration || command.value?.operationId !== exactCommand.operationId) return
      const result = parseCampaignNextDayResult(response)
      clearPendingCampaignDayOperation(exactCommand.operationId)
      postflight.value = acceptedFromResult(result, reviewed)
      phase.value = 'accepted'
      confirmed.value = false
      await notifyAccepted()
    }
    catch (cause) {
      if (generation !== requestGeneration || command.value?.operationId !== exactCommand.operationId) return
      phase.value = 'error'
      error.value = getErrorMessage(cause)
      uncertain.value = statusCode(cause) !== 409
    }
  }

  const close = (): void => {
    if (phase.value === 'committing') return
    requestGeneration += 1
    if (!uncertain.value && phase.value !== 'accepted' && command.value) {
      clearPendingCampaignDayOperation(command.value.operationId)
    }
    open.value = false
    if (phase.value !== 'accepted') {
      phase.value = 'idle'
      projection.value = null
      postflight.value = null
      confirmed.value = false
      error.value = null
    }
  }

  const handleOnline = (): void => { online.value = navigator.onLine }
  const handleStorage = (event: StorageEvent): void => {
    if (event.key !== CAMPAIGN_DAY_PENDING_OPERATION_STORAGE_KEY || !command.value
      || phase.value === 'idle' || phase.value === 'accepted') return
    if (sameCommand(loadPendingCampaignDayOperation(), command.value)) return
    requestGeneration += 1
    phase.value = 'error'
    confirmed.value = false
    uncertain.value = true
    error.value = 'The retained campaign-day command changed in another tab. Check its exact accepted status before reviewing fresh authority.'
  }
  onMounted(() => {
    online.value = navigator.onLine
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOnline)
    window.addEventListener('storage', handleStorage)
  })
  onBeforeUnmount(() => {
    requestGeneration += 1
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOnline)
    window.removeEventListener('storage', handleStorage)
  })

  return {
    open,
    phase,
    projection,
    postflight,
    confirmed,
    error,
    uncertain,
    online,
    busy,
    canCommit,
    show,
    check,
    commit,
    close,
  }
}
