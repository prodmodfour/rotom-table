import { computed, onBeforeUnmount, onMounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  parseItemGuidedAdjudicationProjection,
  parseItemGuidedAdjudicationResult,
  type ItemGuidedAdjudicationCommandV1,
  type ItemGuidedAdjudicationProjectionV1,
  type ItemGuidedAdjudicationResultV1,
  type ItemGuidedDecisionOptionV1,
  type ItemGuidedReBreatherOfferV1,
  type ItemGuidedRequestProjectionV1,
} from '#shared/itemAutomation/guidedAdjudication'
import type { SheetKind } from '#shared/sheets'
import { useApiClient } from '~/composables/useApiClient'
import { subscribeChannel } from '~/composables/useRealtime'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import type { AcceptedItemSheetDocument } from '~/composables/sheets/useTrainerSheetItemActions'
import { getErrorMessage } from '~/utils/errorMessages'
import {
  clearPendingItemGuidedOperation,
  createItemGuidedOperationId,
  loadPendingItemGuidedOperation,
  retainPendingItemGuidedOperation,
} from '~/utils/itemGuidedOperationStorage'

export type ItemGuidedUiStatus =
  | 'idle' | 'loading' | 'ready' | 'submitting' | 'accepted' | 'conflict' | 'uncertain' | 'error'

export interface UseItemGuidedAdjudicationOptions {
  readonly mode: MaybeRefOrGetter<'gm' | 'owner'>
  readonly ownerKind?: MaybeRefOrGetter<SheetKind | null>
  readonly ownerSlug?: MaybeRefOrGetter<string | null>
  readonly ownerRevision?: MaybeRefOrGetter<number | null>
  readonly profileId?: MaybeRefOrGetter<string | null>
  readonly onAccepted?: (response: ItemGuidedAcceptedResult) => Promise<void> | void
}

export interface ItemGuidedAcceptedResult {
  readonly result: ItemGuidedAdjudicationResultV1
  readonly sheets: readonly AcceptedItemSheetDocument[]
}

interface MutationResponse {
  readonly result: unknown
  readonly sheets: readonly unknown[]
}

const errorStatusCode = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') return null
  const input = error as Record<string, unknown>
  for (const candidate of [input.statusCode, input.status, (input.response as Record<string, unknown> | undefined)?.status]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
  }
  return null
}

export const useItemGuidedAdjudication = (options: UseItemGuidedAdjudicationOptions) => {
  const { getJson, postJson } = useApiClient()
  const projection = ref<ItemGuidedAdjudicationProjectionV1 | null>(null)
  const status = ref<ItemGuidedUiStatus>('idle')
  const message = ref<string | null>(null)
  const activeRequestId = ref<string | null>(null)
  const lastAcceptedRequest = ref<ItemGuidedRequestProjectionV1 | null>(null)

  const mode = computed(() => toValue(options.mode))
  const ownerKind = computed(() => options.ownerKind === undefined ? null : toValue(options.ownerKind))
  const ownerSlug = computed(() => options.ownerSlug === undefined ? null : toValue(options.ownerSlug))
  const ownerRevision = computed(() => options.ownerRevision === undefined ? null : toValue(options.ownerRevision))
  const profileId = computed(() => options.profileId === undefined ? null : toValue(options.profileId))
  const scope = computed(() => mode.value === 'gm' ? 'gm' : ownerKind.value && ownerSlug.value
    ? `${ownerKind.value}:${ownerSlug.value}` : '')
  const uncertain = computed(() => status.value === 'uncertain')
  const busy = computed(() => status.value === 'loading' || status.value === 'submitting')
  const requests = computed(() => projection.value?.requests ?? [])
  const reBreatherOffers = computed(() => projection.value?.reBreatherOffers ?? [])
  const activeRequest = computed(() => requests.value.find(request => request.requestId === activeRequestId.value)
    ?? requests.value[0] ?? null)
  const canRefresh = computed(() => !uncertain.value && !busy.value)

  const query = () => ({
    ...(mode.value === 'owner' && ownerKind.value && ownerSlug.value
      ? { ownerKind: ownerKind.value, ownerSlug: ownerSlug.value } : {}),
    ...(profileId.value ? { profileId: profileId.value } : {}),
  })

  const load = async (): Promise<void> => {
    if (!scope.value || uncertain.value || status.value === 'submitting') return
    status.value = 'loading'
    message.value = null
    try {
      projection.value = parseItemGuidedAdjudicationProjection(await getJson<unknown>(ITEM_API_PATHS.guided, { params: query() }))
      if (activeRequestId.value && !requests.value.some(request => request.requestId === activeRequestId.value)) {
        activeRequestId.value = null
      }
      status.value = 'ready'
    }
    catch (error) {
      status.value = 'error'
      message.value = getErrorMessage(error)
    }
  }

  const reconcileResult = (command: ItemGuidedAdjudicationCommandV1, value: unknown): ItemGuidedAcceptedResult => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Guided item operation returned an invalid response.')
    const input = value as Record<string, unknown>
    if (!Object.hasOwn(input, 'result') || !Object.hasOwn(input, 'sheets') || !Array.isArray(input.sheets)
      || Object.keys(input).some(key => key !== 'result' && key !== 'sheets')) {
      throw new Error('Guided item operation returned incomplete authoritative evidence.')
    }
    const result = parseItemGuidedAdjudicationResult(input.result)
    if (result.operationId !== command.operationId) throw new Error('Guided item result does not match its exact command.')
    const sheets = (input.sheets as unknown[]).map((entry, index): AcceptedItemSheetDocument => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Guided item sheet ${index + 1} is invalid.`)
      const sheet = entry as Record<string, unknown>
      if ((sheet.kind !== 'trainer' && sheet.kind !== 'pokemon') || typeof sheet.slug !== 'string' || !sheet.slug
        || !Number.isSafeInteger(sheet.revision) || Number(sheet.revision) < 0
        || !Number.isSafeInteger(sheet.updatedAt) || Number(sheet.updatedAt) < 0
        || !sheet.sheet || typeof sheet.sheet !== 'object' || Array.isArray(sheet.sheet)) {
        throw new Error(`Guided item sheet ${index + 1} has invalid authority.`)
      }
      return Object.freeze({
        kind: sheet.kind,
        slug: sheet.slug,
        revision: Number(sheet.revision),
        updatedAt: Number(sheet.updatedAt),
        sheet: Object.freeze({ ...(sheet.sheet as Record<string, unknown>) }),
      })
    })
    lastAcceptedRequest.value = result.request
    if (result.request.status === 'pending') {
      const current = projection.value ?? { schemaVersion: 1, requests: [], reBreatherOffers: [] }
      projection.value = {
        ...current,
        requests: Object.freeze([
          result.request,
          ...current.requests.filter(request => request.requestId !== result.request.requestId),
        ]),
      }
      activeRequestId.value = result.request.requestId
    }
    else if (projection.value) {
      projection.value = {
        ...projection.value,
        requests: Object.freeze(projection.value.requests.filter(request => request.requestId !== result.request.requestId)),
      }
      if (activeRequestId.value === result.request.requestId) activeRequestId.value = null
    }
    return Object.freeze({ result, sheets: Object.freeze(sheets) })
  }

  const executeExact = async (command: ItemGuidedAdjudicationCommandV1): Promise<boolean> => {
    const currentScope = scope.value
    if (!currentScope) return false
    retainPendingItemGuidedOperation({
      schemaVersion: 1,
      scope: currentScope,
      profileId: profileId.value,
      command,
    })
    status.value = 'submitting'
    message.value = 'Waiting for the authoritative guided-item result…'
    try {
      const response = await postJson<MutationResponse>(ITEM_API_PATHS.guided, {
        command,
        ...(profileId.value ? { profileId: profileId.value } : {}),
        clientId: getClientId(),
      })
      const acceptedResponse = reconcileResult(command, response)
      clearPendingItemGuidedOperation(currentScope, command.operationId)
      status.value = 'accepted'
      message.value = lastAcceptedRequest.value?.status === 'pending'
        ? 'Request sent. No mechanics apply until the GM accepts it.'
        : lastAcceptedRequest.value?.status === 'cancelled'
          ? 'Request cancelled. Its reservation was released without applying mechanics.'
          : lastAcceptedRequest.value?.acceptedSummary ?? 'Guided item request accepted.'
      if (lastAcceptedRequest.value?.status === 'accepted') await options.onAccepted?.(acceptedResponse)
      return true
    }
    catch (error) {
      const code = errorStatusCode(error)
      if (code !== null && code >= 400 && code < 500) {
        clearPendingItemGuidedOperation(currentScope, command.operationId)
        status.value = 'conflict'
        message.value = getErrorMessage(error)
      }
      else {
        status.value = 'uncertain'
        message.value = 'The result is uncertain. Retry this exact command; refresh, cancellation, and competing decisions are disabled.'
      }
      return false
    }
  }

  const resolve = async (request: ItemGuidedRequestProjectionV1, option: ItemGuidedDecisionOptionV1): Promise<boolean> => {
    if (busy.value || uncertain.value || request.status !== 'pending'
      || !request.choices.some(candidate => candidate.optionId === option.optionId)) return false
    return executeExact({
      schemaVersion: 1,
      operationId: createItemGuidedOperationId(),
      action: 'resolve',
      requestId: request.requestId,
      expectedRevision: request.revision,
      optionId: option.optionId,
    })
  }

  const cancel = async (request: ItemGuidedRequestProjectionV1): Promise<boolean> => {
    if (busy.value || uncertain.value || request.status !== 'pending' || !request.canCancel) return false
    return executeExact({
      schemaVersion: 1,
      operationId: createItemGuidedOperationId(),
      action: 'cancel',
      requestId: request.requestId,
      expectedRevision: request.revision,
    })
  }

  const declareReBreather = async (offer: ItemGuidedReBreatherOfferV1): Promise<boolean> => {
    if (busy.value || uncertain.value || mode.value !== 'owner' || ownerKind.value !== offer.ownerKind
      || ownerSlug.value !== offer.ownerSlug || !offer.enabled || ownerRevision.value === null) return false
    return executeExact({
      schemaVersion: 1,
      operationId: createItemGuidedOperationId(),
      action: 'declare-re-breather',
      ownerKind: offer.ownerKind,
      ownerSlug: offer.ownerSlug,
      ownerRevision: ownerRevision.value,
      offerId: offer.offerId,
    })
  }

  const retryExact = async (): Promise<boolean> => {
    if (!uncertain.value || !scope.value) return false
    const pending = loadPendingItemGuidedOperation(scope.value)
    if (!pending || pending.profileId !== profileId.value) {
      status.value = 'conflict'
      message.value = 'No exact guided-item command is available for this profile and scope.'
      return false
    }
    return executeExact(pending.command)
  }

  const selectRequest = (requestId: string): void => {
    if (uncertain.value || !requests.value.some(request => request.requestId === requestId)) return
    activeRequestId.value = requestId
  }

  const dismiss = (): void => {
    if (uncertain.value || busy.value) return
    status.value = projection.value ? 'ready' : 'idle'
    message.value = null
    lastAcceptedRequest.value = null
  }

  let unsubscribe: (() => void) | null = null
  const bindRealtime = (): void => {
    unsubscribe?.()
    unsubscribe = null
    if (!scope.value) return
    const channel = mode.value === 'gm' ? 'item-guided:gm' : `item-guided:${ownerKind.value}:${ownerSlug.value}`
    unsubscribe = subscribeChannel(channel, () => {
      if (!uncertain.value && status.value !== 'submitting') void load()
    })
  }

  watch(scope, () => {
    bindRealtime()
    projection.value = null
    activeRequestId.value = null
    if (scope.value) {
      const pending = loadPendingItemGuidedOperation(scope.value)
      if (pending && pending.profileId === profileId.value) {
        status.value = 'uncertain'
        message.value = 'An exact guided-item command may be unresolved. Retry it before doing anything else.'
      }
      else void load()
    }
  })
  watch([profileId, ownerRevision], () => {
    if (scope.value && !uncertain.value) void load()
  })
  onMounted(() => {
    bindRealtime()
    if (!scope.value) return
    const pending = loadPendingItemGuidedOperation(scope.value)
    if (pending && pending.profileId === profileId.value) {
      status.value = 'uncertain'
      message.value = 'An exact guided-item command may be unresolved. Retry it before doing anything else.'
    }
    else void load()
  })
  onBeforeUnmount(() => unsubscribe?.())

  return {
    projection,
    requests,
    reBreatherOffers,
    activeRequest,
    activeRequestId,
    lastAcceptedRequest,
    status,
    message,
    busy,
    uncertain,
    canRefresh,
    load,
    selectRequest,
    resolve,
    cancel,
    declareReBreather,
    retryExact,
    dismiss,
  }
}
