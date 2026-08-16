import { computed, onMounted, onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  ITEM_EXPLORATION_CLOCK_REALTIME_EVENT_TYPE,
  parseItemExplorationOperationResult,
  type ItemExplorationOperationCommandV1,
  type ItemExplorationOperationResultV1,
  type ItemExplorationProjectionV1,
} from '#shared/itemAutomation/exploration'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { SaveStatus } from '~/composables/useEditableSheet'
import { useApiClient } from '~/composables/useApiClient'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { isRealtimeEcho, sheetChannel } from '#shared/realtime'
import { subscribeChannel, type RealtimeEvent } from '~/composables/useRealtime'
import { getErrorMessage } from '~/utils/errorMessages'
import { InventoryRecoveryConflictError } from '~/utils/inventoryRecoveryStorage'
import { useInventoryRecoveryConnectivity } from '~/composables/inventory/useInventoryRecoveryConnectivity'
import {
  clearPendingItemExplorationOperation,
  createItemExplorationOperationId,
  isPendingItemExplorationStorageEvent,
  loadPendingItemExplorationOperation,
  retainPendingItemExplorationOperation,
} from '~/utils/itemExplorationOperationStorage'

export type TrainerItemExplorationStatus =
  | 'idle'
  | 'loading'
  | 'submitting'
  | 'accepted'
  | 'conflict'
  | 'uncertain'
  | 'error'

export interface TrainerItemExplorationAuthority {
  readonly schemaVersion: 1
  readonly kind: 'trainer'
  readonly trainerSlug: string
  readonly trainerRevision: number
  readonly campaignClockRevision: number
  readonly campaignMinute: number
  readonly generatedAt: number
  readonly projection: ItemExplorationProjectionV1
  readonly permissions: {
    readonly canResolveChecks: boolean
    readonly canCancelOwnLure: boolean
    readonly canSettleEncounter: boolean
    readonly canAdjudicateLureLoss: boolean
  }
}

export interface UseTrainerItemExplorationOptions {
  readonly sheet: MaybeRefOrGetter<TrainerSheet>
  readonly saveStatus: MaybeRefOrGetter<SaveStatus>
  readonly profileId: MaybeRefOrGetter<string | null>
  readonly prepareForAction?: () => Promise<void>
}

const errorStatusCode = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') return null
  const source = error as Record<string, unknown>
  for (const value of [source.statusCode, source.status, (source.response as Record<string, unknown> | undefined)?.status]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}
const cleanSaveBoundary = (status: SaveStatus): boolean => status === 'idle' || status === 'saved'
const finiteInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0

export const parseTrainerItemExplorationAuthority = (value: unknown, trainerSlug: string): TrainerItemExplorationAuthority => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Exploration activity returned an invalid projection.')
  const row = value as Record<string, unknown>
  const fields = [
    'schemaVersion', 'kind', 'trainerSlug', 'trainerRevision', 'campaignClockRevision',
    'campaignMinute', 'generatedAt', 'projection', 'permissions',
  ]
  if (Object.keys(row).length !== fields.length || fields.some(field => !Object.hasOwn(row, field))
    || row.schemaVersion !== 1 || row.kind !== 'trainer' || row.trainerSlug !== trainerSlug
    || !finiteInteger(row.trainerRevision) || !finiteInteger(row.campaignClockRevision)
    || !finiteInteger(row.campaignMinute) || !finiteInteger(row.generatedAt)
    || !row.projection || typeof row.projection !== 'object' || Array.isArray(row.projection)
    || !row.permissions || typeof row.permissions !== 'object' || Array.isArray(row.permissions)) {
    throw new Error('Exploration activity projection has invalid authority.')
  }
  const projection = row.projection as ItemExplorationProjectionV1
  const permissions = row.permissions as Record<string, unknown>
  if (projection.schemaVersion !== 1 || !Array.isArray(projection.routeLures)
    || !Array.isArray(projection.repels) || !projection.dowsing
    || ['canResolveChecks', 'canCancelOwnLure', 'canSettleEncounter', 'canAdjudicateLureLoss']
      .some(field => typeof permissions[field] !== 'boolean')) {
    throw new Error('Exploration activity projection is incomplete.')
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: 'trainer',
    trainerSlug,
    trainerRevision: Number(row.trainerRevision),
    campaignClockRevision: Number(row.campaignClockRevision),
    campaignMinute: Number(row.campaignMinute),
    generatedAt: Number(row.generatedAt),
    projection,
    permissions: {
      canResolveChecks: permissions.canResolveChecks as boolean,
      canCancelOwnLure: permissions.canCancelOwnLure as boolean,
      canSettleEncounter: permissions.canSettleEncounter as boolean,
      canAdjudicateLureLoss: permissions.canAdjudicateLureLoss as boolean,
    },
  })
}

export const useTrainerItemExploration = (options: UseTrainerItemExplorationOptions) => {
  const { getJson, postJson } = useApiClient()
  const authority = ref<TrainerItemExplorationAuthority | null>(null)
  const status = ref<TrainerItemExplorationStatus>('idle')
  const message = ref<string | null>(null)
  const lastCommand = ref<ItemExplorationOperationCommandV1 | null>(null)
  const { online } = useInventoryRecoveryConnectivity()
  let loadSequence = 0
  let unsubscribe: (() => void) | null = null
  let subscribedSlug: string | null = null

  const sheet = computed(() => toValue(options.sheet))
  const saveStatus = computed(() => toValue(options.saveStatus))
  const profileId = computed(() => toValue(options.profileId))
  const scopeKey = computed(() => `trainer:${sheet.value.slug}`)
  const busy = computed(() => status.value === 'loading' || status.value === 'submitting')
  const uncertain = computed(() => status.value === 'uncertain')
  const exactRetryAvailable = computed(() => lastCommand.value !== null)
  const projection = computed(() => authority.value?.projection ?? null)
  const activeRouteLure = computed(() => projection.value?.routeLures.find(activity => (
    activity.status === 'active' || activity.status === 'awaiting-encounter'
  )) ?? null)
  const hasActivity = computed(() => Boolean(activeRouteLure.value)
    || Boolean(projection.value?.repels.some(repel => repel.active))
    || Boolean(projection.value?.dowsing.latest))

  const params = (): Record<string, string> => ({
    trainerSlug: sheet.value.slug,
    ...(profileId.value ? { profileId: profileId.value } : {}),
  })

  const reconcilePending = (fromAnotherTab = false): void => {
    const pending = loadPendingItemExplorationOperation(scopeKey.value)
    if (!pending) {
      if (fromAnotherTab && status.value === 'uncertain') {
        lastCommand.value = null
        status.value = 'conflict'
        message.value = 'This retained exploration command was resolved in another tab. Refresh authoritative activity before continuing.'
      }
      return
    }
    lastCommand.value = pending.profileId === profileId.value ? pending.command : null
    status.value = 'uncertain'
    message.value = pending.profileId === profileId.value
      ? 'Exploration result is uncertain. Retry the exact same command before resolving another check.'
      : 'A retained exploration command belongs to another player profile. Select that profile before exact retry.'
  }
  const handleStorage = (event: StorageEvent): void => {
    if (isPendingItemExplorationStorageEvent(event, scopeKey.value)) reconcilePending(true)
  }

  const load = async (): Promise<void> => {
    if (!cleanSaveBoundary(saveStatus.value)) return
    const sequence = ++loadSequence
    if (status.value !== 'uncertain') status.value = 'loading'
    try {
      const next = parseTrainerItemExplorationAuthority(
        await getJson<unknown>(ITEM_API_PATHS.exploration, { params: params() }),
        sheet.value.slug,
      )
      if (sequence !== loadSequence) return
      authority.value = next
      if (status.value !== 'uncertain') {
        status.value = 'idle'
        message.value = null
      }
      reconcilePending()
    }
    catch (error) {
      if (sequence !== loadSequence || status.value === 'uncertain') return
      status.value = errorStatusCode(error) === 409 ? 'conflict' : 'error'
      message.value = getErrorMessage(error)
    }
  }

  const executeExact = async (command: ItemExplorationOperationCommandV1): Promise<ItemExplorationOperationResultV1 | null> => {
    lastCommand.value = command
    status.value = 'submitting'
    message.value = command.kind === 'resolve-route-lure-check'
      ? 'Resolving the due server-owned route check…'
      : 'Waiting for accepted exploration settlement…'
    try {
      const response = await postJson<unknown>(ITEM_API_PATHS.exploration, {
        command,
        ...(profileId.value ? { profileId: profileId.value } : {}),
        clientId: getClientId(),
      })
      if (!response || typeof response !== 'object' || Array.isArray(response)
        || Object.keys(response as Record<string, unknown>).length !== 1
        || !Object.hasOwn(response as Record<string, unknown>, 'result')) {
        throw new Error('Exploration operation returned an invalid response.')
      }
      const result = parseItemExplorationOperationResult((response as Record<string, unknown>).result)
      if (result.operationId !== command.operationId || result.kind !== command.kind) {
        throw new Error('Exploration result does not match its exact command.')
      }
      clearPendingItemExplorationOperation(scopeKey.value, command.operationId)
      lastCommand.value = null
      status.value = 'accepted'
      message.value = result.exactReplay
        ? 'The original exploration result was recovered without resolving or consuming anything twice.'
        : result.message
      await load()
      status.value = 'accepted'
      message.value = result.exactReplay
        ? 'The original exploration result was recovered without resolving or consuming anything twice.'
        : result.message
      return result
    }
    catch (error) {
      const code = errorStatusCode(error)
      if (code !== null && code >= 400 && code < 500) {
        clearPendingItemExplorationOperation(scopeKey.value, command.operationId)
        lastCommand.value = null
        status.value = 'conflict'
        message.value = getErrorMessage(error)
      }
      else {
        status.value = 'uncertain'
        message.value = online.value
          ? 'The exploration result is uncertain. Retry this exact command; do not submit another check.'
          : 'The connection was lost. This exact exploration command is retained until you reconnect and choose retry.'
      }
      return null
    }
  }

  const retainAndExecute = async (command: ItemExplorationOperationCommandV1) => {
    try {
      retainPendingItemExplorationOperation({
        schemaVersion: 1,
        scopeKey: scopeKey.value,
        profileId: profileId.value,
        command,
      })
      return executeExact(command)
    }
    catch (error) {
      status.value = error instanceof InventoryRecoveryConflictError ? 'conflict' : 'error'
      message.value = getErrorMessage(error)
      return null
    }
  }

  const routeCommandBase = () => {
    const current = authority.value
    const activity = activeRouteLure.value
    if (!current || !activity) return null
    return {
      trainerSlug: current.trainerSlug,
      trainerRevision: current.trainerRevision,
      campaignClockRevision: current.campaignClockRevision,
      activityId: activity.activityId,
    }
  }

  const resolveCheck = async (): Promise<void> => {
    const base = routeCommandBase()
    if (!base || busy.value || uncertain.value || !activeRouteLure.value?.canResolveCheck
      || !authority.value?.permissions.canResolveChecks) return
    await options.prepareForAction?.()
    if (!cleanSaveBoundary(saveStatus.value)) return
    await retainAndExecute({
      schemaVersion: 1,
      operationId: createItemExplorationOperationId(),
      kind: 'resolve-route-lure-check',
      ...base,
    })
  }

  const settle = async (
    outcome: 'encounter-introduced' | 'cancelled' | 'lure-lost',
    encounterReferenceId: string | null = null,
  ): Promise<void> => {
    const base = routeCommandBase()
    if (!base || busy.value || uncertain.value) return
    await options.prepareForAction?.()
    if (!cleanSaveBoundary(saveStatus.value)) return
    await retainAndExecute({
      schemaVersion: 1,
      operationId: createItemExplorationOperationId(),
      kind: 'settle-route-lure',
      ...base,
      outcome,
      encounterSelection: outcome === 'encounter-introduced' && encounterReferenceId
        ? { referenceId: encounterReferenceId, comparablePartyLevelConfirmed: true }
        : null,
    })
  }

  const retryExact = async (): Promise<void> => {
    if (busy.value) return
    if (!online.value) {
      status.value = 'uncertain'
      message.value = 'The connection is offline. This exact exploration command remains retained; retry is available after reconnection.'
      return
    }
    const stored = loadPendingItemExplorationOperation(scopeKey.value)
    const command = lastCommand.value ?? (stored?.profileId === profileId.value ? stored.command : null)
    if (!command) {
      status.value = 'conflict'
      message.value = 'No exact exploration command is available to retry. Refresh activity.'
      return
    }
    await executeExact(command)
  }

  const dismiss = (): void => {
    if (busy.value || uncertain.value) return
    status.value = 'idle'
    message.value = null
  }

  const subscribe = (): void => {
    if (typeof window === 'undefined' || subscribedSlug === sheet.value.slug) return
    unsubscribe?.()
    subscribedSlug = sheet.value.slug
    unsubscribe = subscribeChannel(sheetChannel('trainer', sheet.value.slug), (event: RealtimeEvent) => {
      if (isRealtimeEcho(event, getClientId())) return
      if (event.type === 'updated' || event.type === ITEM_EXPLORATION_CLOCK_REALTIME_EVENT_TYPE) void load()
    })
  }

  watch(() => [sheet.value.slug, Number(sheet.value.revision ?? 0), profileId.value, saveStatus.value] as const,
    ([nextSlug, , nextProfile, nextSave], previous) => {
      if (previous?.[0] !== nextSlug) subscribe()
      if (previous && previous[2] !== nextProfile) reconcilePending()
      if (cleanSaveBoundary(nextSave)) void load()
    })
  onMounted(() => {
    subscribe()
    reconcilePending()
    window.addEventListener('storage', handleStorage)
    void load()
  })
  onUnmounted(() => {
    unsubscribe?.()
    window.removeEventListener('storage', handleStorage)
  })

  return {
    authority,
    projection,
    activeRouteLure,
    hasActivity,
    status,
    message,
    lastCommand,
    busy,
    online,
    uncertain,
    exactRetryAvailable,
    load,
    resolveCheck,
    settle,
    retryExact,
    dismiss,
  }
}
