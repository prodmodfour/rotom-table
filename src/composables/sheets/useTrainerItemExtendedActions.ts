import { computed, onMounted, onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  parseItemExtendedActionProjection,
  parseItemExtendedActionResult,
  type ItemExtendedActionCommandV1,
  type ItemExtendedActionProjectionV1,
} from '#shared/itemAutomation/extendedActions'
import { ITEM_OPERATION_REALTIME_EVENT_TYPES } from '#shared/itemAutomation/realtime'
import type { SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'
import { isRealtimeEcho, sheetChannel } from '#shared/realtime'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { SaveStatus } from '~/composables/useEditableSheet'
import { useApiClient } from '~/composables/useApiClient'
import { subscribeChannel, type RealtimeEvent } from '~/composables/useRealtime'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import { InventoryRecoveryConflictError } from '~/utils/inventoryRecoveryStorage'
import { useInventoryRecoveryConnectivity } from '~/composables/inventory/useInventoryRecoveryConnectivity'
import {
  clearPendingItemExtendedAction,
  createItemExtendedActionId,
  createItemExtendedActionOperationId,
  isPendingItemExtendedActionStorageEvent,
  loadPendingItemExtendedAction,
  retainPendingItemExtendedAction,
} from '~/utils/itemExtendedActionStorage'
import { createSheetItemOperationId } from '~/utils/sheetItemOperationStorage'
import type {
  AcceptedItemSheetDocument,
  TrainerSheetItemAcceptedResult,
} from './useTrainerSheetItemActions'

export type TrainerItemExtendedActionStatus =
  | 'idle'
  | 'loading'
  | 'submitting'
  | 'in-progress'
  | 'completed'
  | 'interrupted'
  | 'conflict'
  | 'uncertain'
  | 'error'

export interface UseTrainerItemExtendedActionsOptions {
  readonly sheet: MaybeRefOrGetter<TrainerSheet>
  readonly saveStatus: MaybeRefOrGetter<SaveStatus>
  readonly profileId: MaybeRefOrGetter<string | null>
  readonly prepareForAction?: () => Promise<void>
  readonly onAccepted?: (response: TrainerSheetItemAcceptedResult) => Promise<void> | void
}

const numericErrorField = (value: unknown, field: string): number | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as Record<string, unknown>)[field]
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}

const errorStatusCode = (error: unknown): number | null => {
  for (const field of ['statusCode', 'status']) {
    const value = numericErrorField(error, field)
    if (value !== null) return value
  }
  return numericErrorField(error && typeof error === 'object'
    ? (error as Record<string, unknown>).response
    : null, 'status')
}

const cleanSaveBoundary = (status: SaveStatus): boolean => status === 'idle' || status === 'saved'

const parseSheet = (entry: unknown, index: number): AcceptedItemSheetDocument => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Extended Action sheet ${index + 1} is invalid.`)
  const sheet = entry as Record<string, unknown>
  if (Object.keys(sheet).some(key => !['kind', 'slug', 'revision', 'updatedAt', 'sheet'].includes(key))
    || (sheet.kind !== 'pokemon' && sheet.kind !== 'trainer')
    || typeof sheet.slug !== 'string' || !sheet.slug.trim()
    || !Number.isSafeInteger(sheet.revision) || Number(sheet.revision) < 0
    || !Number.isSafeInteger(sheet.updatedAt) || Number(sheet.updatedAt) < 0
    || !sheet.sheet || typeof sheet.sheet !== 'object' || Array.isArray(sheet.sheet)) {
    throw new Error(`Extended Action sheet ${index + 1} has invalid authority.`)
  }
  return Object.freeze({
    kind: sheet.kind,
    slug: sheet.slug,
    revision: Number(sheet.revision),
    updatedAt: Number(sheet.updatedAt),
    sheet: Object.freeze({ ...(sheet.sheet as Record<string, unknown>) }),
  })
}

const parseResponse = (value: unknown, command: ItemExtendedActionCommandV1) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Extended Action returned an invalid response.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 3
    || !['result', 'activity', 'sheets'].every(field => Object.hasOwn(input, field))
    || !Array.isArray(input.sheets)) {
    throw new Error('Extended Action returned incomplete authoritative evidence.')
  }
  const result = parseItemExtendedActionResult(input.result)
  const activity = parseItemExtendedActionProjection(input.activity)
  const historicalStartReplay = command.kind === 'start'
    && result.exactReplay && result.status === 'in-progress' && result.revision === 0
    && activity.revision >= result.revision
  if (result.operationId !== command.operationId || result.activityId !== command.activityId
    || activity.activityId !== command.activityId
    || (!historicalStartReplay
      && (result.revision !== activity.revision || result.status !== activity.status))) {
    throw new Error('Extended Action result does not match its submitted exact command.')
  }
  return Object.freeze({
    result,
    activity,
    sheets: Object.freeze(input.sheets.map(parseSheet)),
  })
}

export const useTrainerItemExtendedActions = (options: UseTrainerItemExtendedActionsOptions) => {
  const { getJson, postJson } = useApiClient()
  const activities = ref<readonly ItemExtendedActionProjectionV1[]>([])
  const status = ref<TrainerItemExtendedActionStatus>('idle')
  const message = ref<string | null>(null)
  const lastCommand = ref<ItemExtendedActionCommandV1 | null>(null)
  const dismissedActivityId = ref<string | null>(null)
  const { online } = useInventoryRecoveryConnectivity()
  let loadSequence = 0
  let unsubscribe: (() => void) | null = null

  const sheet = computed(() => toValue(options.sheet))
  const saveStatus = computed(() => toValue(options.saveStatus))
  const profileId = computed(() => toValue(options.profileId))
  const activeActivity = computed(() => activities.value.find(activity => activity.status === 'in-progress') ?? null)
  const latestActivity = computed(() => activeActivity.value ?? activities.value[0] ?? null)
  const busy = computed(() => status.value === 'loading' || status.value === 'submitting')
  const uncertain = computed(() => status.value === 'uncertain')
  const exactRetryAvailable = computed(() => lastCommand.value !== null)
  const canStart = computed(() => cleanSaveBoundary(saveStatus.value)
    && !busy.value && !uncertain.value && !activeActivity.value)

  const params = (): Record<string, string> => ({
    trainerSlug: sheet.value.slug,
    ...(profileId.value ? { profileId: profileId.value } : {}),
  })

  const reconcilePending = (): void => {
    const pending = loadPendingItemExtendedAction(sheet.value.slug)
    if (!pending || pending.profileId !== profileId.value) return
    const activity = activities.value.find(candidate => candidate.activityId === pending.command.activityId)
    const reached = pending.command.kind === 'start'
      ? Boolean(activity)
      : pending.command.kind === 'complete'
        ? activity?.status === 'completed'
        : activity?.status === 'interrupted'
    if (reached) {
      clearPendingItemExtendedAction(sheet.value.slug, pending.command.operationId)
      lastCommand.value = null
      return
    }
    lastCommand.value = pending.command
    status.value = 'uncertain'
    message.value = 'Extended Action status is uncertain. Retry the exact same command before taking another action.'
  }

  const load = async (): Promise<void> => {
    if (!cleanSaveBoundary(saveStatus.value)) return
    const sequence = ++loadSequence
    if (status.value !== 'uncertain') status.value = 'loading'
    try {
      const response = await getJson<unknown>(ITEM_API_PATHS.extendedActions, { params: params() })
      if (sequence !== loadSequence) return
      if (!Array.isArray(response)) throw new Error('Extended Action activity list is invalid.')
      const parsed = response.map(parseItemExtendedActionProjection)
      if (new Set(parsed.map(activity => activity.activityId)).size !== parsed.length
        || parsed.some(activity => activity.actor.sheetSlug !== sheet.value.slug)
        || parsed.filter(activity => activity.status === 'in-progress').length > 1) {
        throw new Error('Extended Action activity authority is inconsistent.')
      }
      activities.value = Object.freeze(parsed)
      if (status.value !== 'uncertain') {
        status.value = activeActivity.value ? 'in-progress'
          : latestActivity.value?.activityId === dismissedActivityId.value ? 'idle'
            : latestActivity.value?.status === 'completed' ? 'completed'
              : latestActivity.value?.status === 'interrupted' ? 'interrupted' : 'idle'
        message.value = null
      }
      reconcilePending()
    }
    catch (error) {
      if (sequence !== loadSequence) return
      if (status.value !== 'uncertain') {
        status.value = errorStatusCode(error) === 409 ? 'conflict' : 'error'
        message.value = getErrorMessage(error)
      }
    }
  }

  const executeExact = async (command: ItemExtendedActionCommandV1): Promise<boolean> => {
    lastCommand.value = command
    status.value = 'submitting'
    message.value = command.kind === 'start'
      ? 'Starting the Extended Action without applying item mechanics…'
      : command.kind === 'complete'
        ? 'Waiting for the accepted Extended Action result…'
        : 'Interrupting before item mechanics are applied…'
    try {
      const response = parseResponse(await postJson<unknown>(ITEM_API_PATHS.extendedActions, {
        command,
        ...(profileId.value ? { profileId: profileId.value } : {}),
        clientId: getClientId(),
      }), command)
      clearPendingItemExtendedAction(sheet.value.slug, command.operationId)
      lastCommand.value = null
      const others = activities.value.filter(activity => activity.activityId !== response.activity.activityId)
      activities.value = Object.freeze([response.activity, ...others])
      dismissedActivityId.value = null
      status.value = response.activity.status === 'in-progress'
        ? 'in-progress'
        : response.activity.status
      message.value = response.result.exactReplay
        ? 'The original Extended Action result was recovered without applying it twice.'
        : response.activity.status === 'in-progress'
          ? 'Extended Action started. No resource, sheet, condition, or inventory change has been applied yet.'
          : response.activity.terminal?.message ?? null
      if (response.result.status === 'completed') {
        await options.onAccepted?.({ result: response.result.itemResult, sheets: response.sheets })
      }
      return true
    }
    catch (error) {
      const statusCode = errorStatusCode(error)
      if (statusCode !== null && statusCode >= 400 && statusCode < 500) {
        clearPendingItemExtendedAction(sheet.value.slug, command.operationId)
        lastCommand.value = null
        status.value = 'conflict'
        message.value = getErrorMessage(error)
      }
      else {
        status.value = 'uncertain'
        message.value = online.value
          ? 'The Extended Action result is uncertain. Retry this exact command; do not start or complete it again.'
          : 'The connection was lost. This exact Extended Action command is retained until you reconnect and choose retry.'
      }
      return false
    }
  }

  const retainAndExecute = async (command: ItemExtendedActionCommandV1): Promise<boolean> => {
    try {
      retainPendingItemExtendedAction({
        schemaVersion: 1,
        trainerSlug: sheet.value.slug,
        profileId: profileId.value,
        command,
      })
      return executeExact(command)
    }
    catch (error) {
      status.value = error instanceof InventoryRecoveryConflictError ? 'conflict' : 'error'
      message.value = getErrorMessage(error)
      return false
    }
  }

  const start = async (
    offer: SheetItemActionOfferV1,
    targetIds: readonly string[],
    choices: readonly { readonly choiceId: string, readonly optionIds: readonly string[] }[] = [],
  ): Promise<boolean> => {
    if (!canStart.value || offer.timingLabel !== 'Extended Action') return false
    await options.prepareForAction?.()
    if (!cleanSaveBoundary(saveStatus.value) || Number(sheet.value.revision ?? -1) !== offer.actor.revision) {
      status.value = 'conflict'
      message.value = 'The Trainer sheet changed. Refresh item actions before starting the Extended Action.'
      return false
    }
    return retainAndExecute({
      schemaVersion: 1,
      kind: 'start',
      operationId: createItemExtendedActionOperationId(),
      activityId: createItemExtendedActionId(),
      settlementOperationId: createSheetItemOperationId(),
      trainerSlug: offer.actor.sheetSlug,
      trainerRevision: offer.actor.revision,
      offerId: offer.offerId,
      targetIds: Object.freeze([...targetIds]),
      choices: Object.freeze(choices.map(choice => Object.freeze({
        choiceId: choice.choiceId,
        optionIds: Object.freeze([...choice.optionIds]),
      }))),
    })
  }

  const complete = async (): Promise<boolean> => {
    const activity = activeActivity.value
    if (!activity || busy.value || uncertain.value || !activity.permissions.canComplete) return false
    await options.prepareForAction?.()
    if (!cleanSaveBoundary(saveStatus.value)) {
      status.value = 'conflict'
      message.value = 'Save the Trainer sheet before completing the Extended Action.'
      return false
    }
    return retainAndExecute({
      schemaVersion: 1,
      kind: 'complete',
      operationId: createItemExtendedActionOperationId(),
      activityId: activity.activityId,
      expectedRevision: activity.revision,
    })
  }

  const interrupt = async (): Promise<boolean> => {
    const activity = activeActivity.value
    if (!activity || busy.value || uncertain.value || !activity.permissions.canInterrupt) return false
    return retainAndExecute({
      schemaVersion: 1,
      kind: 'interrupt',
      operationId: createItemExtendedActionOperationId(),
      activityId: activity.activityId,
      expectedRevision: activity.revision,
      reason: 'user-cancelled',
    })
  }

  const retryExact = async (): Promise<void> => {
    if (busy.value) return
    if (!online.value) {
      status.value = 'uncertain'
      message.value = 'The connection is offline. This exact Extended Action command remains retained; retry is available after reconnection.'
      return
    }
    const stored = loadPendingItemExtendedAction(sheet.value.slug)
    const command = lastCommand.value ?? (stored?.profileId === profileId.value ? stored.command : null)
    if (!command) {
      status.value = 'conflict'
      message.value = 'No exact Extended Action command is available to retry. Refresh current activity.'
      return
    }
    await executeExact(command)
  }

  const refresh = async (): Promise<void> => {
    if (!busy.value) await load()
  }

  const dismiss = (): void => {
    if (busy.value || status.value === 'uncertain') return
    dismissedActivityId.value = latestActivity.value?.activityId ?? null
    status.value = activeActivity.value ? 'in-progress' : 'idle'
    message.value = null
  }

  const subscribe = (): void => {
    if (typeof window === 'undefined') return
    unsubscribe?.()
    unsubscribe = subscribeChannel(sheetChannel('trainer', sheet.value.slug), (event: RealtimeEvent) => {
      if (isRealtimeEcho(event, getClientId())) return
      if (event.type === ITEM_OPERATION_REALTIME_EVENT_TYPES.EXTENDED_ACTION_UPDATED) void load()
    })
  }

  watch(
    () => [sheet.value.slug, profileId.value, saveStatus.value] as const,
    ([nextSlug, nextProfile, nextSave], previous) => {
      if (previous?.[0] !== nextSlug) subscribe()
      if (previous && previous[1] !== nextProfile) restorePending()
      if (cleanSaveBoundary(nextSave)) void load()
    },
  )

  const restorePending = (fromAnotherTab = false): void => {
    const stored = loadPendingItemExtendedAction(sheet.value.slug)
    if (!stored) {
      if (fromAnotherTab && status.value === 'uncertain') {
        lastCommand.value = null
        status.value = 'conflict'
        message.value = 'This retained Extended Action command was resolved in another tab. Refresh current activity before continuing.'
      }
      return
    }
    lastCommand.value = stored.profileId === profileId.value ? stored.command : null
    status.value = 'uncertain'
    message.value = stored.profileId === profileId.value
      ? 'A previous Extended Action command may have reached the server. Retry that exact command before continuing.'
      : 'A previous Extended Action command belongs to another player profile. Select that profile before exact retry.'
  }
  const handleStorage = (event: StorageEvent): void => {
    if (isPendingItemExtendedActionStorageEvent(event, sheet.value.slug)) restorePending(true)
  }

  onMounted(() => {
    subscribe()
    restorePending()
    window.addEventListener('storage', handleStorage)
    void load()
  })
  onUnmounted(() => {
    unsubscribe?.()
    window.removeEventListener('storage', handleStorage)
  })

  return {
    activities,
    activeActivity,
    latestActivity,
    status,
    message,
    lastCommand,
    busy,
    online,
    uncertain,
    exactRetryAvailable,
    canStart,
    load,
    start,
    complete,
    interrupt,
    retryExact,
    refresh,
    dismiss,
  }
}
