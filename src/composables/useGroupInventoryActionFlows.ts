import { computed, onMounted, onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  parseInventoryActionDeclaration,
  parseInventoryActionProjection,
  type InventoryActionDeclarationV1,
  type InventoryActionOfferV1,
  type InventoryActionProjectionV1,
} from '#shared/itemAutomation/inventoryActions'
import type { PlayerProfileId } from '#shared/playerProfiles'
import type { GroupInventoryDocument, GroupInventorySectionKey } from '~/types/groupInventory'
import { useApiClient } from '~/composables/useApiClient'
import type { ApiClient } from '~/utils/apiClient'
import { INVENTORY_ACTION_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import {
  clearPendingGroupInventoryActionOperation,
  isPendingGroupInventoryActionStorageEvent,
  loadPendingGroupInventoryActionOperation,
  retainPendingGroupInventoryActionOperation,
} from '~/utils/groupInventoryActionOperationStorage'
import { InventoryRecoveryConflictError } from '~/utils/inventoryRecoveryStorage'
import { useInventoryRecoveryConnectivity } from '~/composables/inventory/useInventoryRecoveryConnectivity'
import {
  parseInventoryActionAcceptedResponse,
  type InventoryActionAcceptedResult,
  type InventoryActionFlowStatus,
} from '~/composables/sheets/useTrainerInventoryActionFlows'

export interface UseGroupInventoryActionFlowsOptions {
  readonly document: MaybeRefOrGetter<GroupInventoryDocument | null | undefined>
  readonly hasUnsavedEdits: MaybeRefOrGetter<boolean>
  readonly profileId: MaybeRefOrGetter<PlayerProfileId | null | undefined>
  readonly reconcileAuthority?: () => Promise<void>
  readonly onAccepted?: (response: InventoryActionAcceptedResult) => Promise<void> | void
  readonly apiClient?: ApiClient
}

const numericErrorField = (value: unknown, field: string): number | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as Record<string, unknown>)[field]
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}
const errorStatusCode = (error: unknown): number | null => {
  for (const field of ['statusCode', 'status']) {
    const status = numericErrorField(error, field)
    if (status !== null) return status
  }
  return numericErrorField(error && typeof error === 'object' ? (error as Record<string, unknown>).response : null, 'status')
}
const randomHex32 = (): string => {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Secure browser randomness is required for inventory action identity.')
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
const createOperationId = (): string => `inventory-action:v1:${randomHex32()}`
const groupRevisionRequirements = (offer: InventoryActionOfferV1) => [
  ...offer.revisionRequirements,
  ...offer.destination.options.flatMap(destination => destination.revisionRequirements),
].filter(requirement => (
  (offer.source.locationKind === 'group-inventory' && requirement.resourceKind === 'source-container')
  || (offer.source.locationKind === 'trainer-inventory' && requirement.resourceKind === 'destination-container')
))

export const useGroupInventoryActionFlows = (options: UseGroupInventoryActionFlowsOptions) => {
  const apiClient = options.apiClient ?? useApiClient()
  const projection = ref<InventoryActionProjectionV1 | null>(null)
  const selectedOfferId = ref<string | null>(null)
  const selectedDestinationId = ref<string | null>(null)
  const selectedQuantity = ref(1)
  const selectedConfirmationOptionId = ref<string | null>(null)
  const status = ref<InventoryActionFlowStatus>('idle')
  const message = ref<string | null>(null)
  const lastDeclaration = ref<InventoryActionDeclarationV1 | null>(null)
  const reconciling = ref(false)
  const { online } = useInventoryRecoveryConnectivity()
  let loadSequence = 0

  const document = computed(() => toValue(options.document))
  const hasUnsavedEdits = computed(() => toValue(options.hasUnsavedEdits))
  const profileId = computed(() => toValue(options.profileId) ?? null)
  const selectedOffer = computed(() => projection.value?.offers.find(offer => offer.offerId === selectedOfferId.value) ?? null)
  const selectedDestination = computed(() => selectedOffer.value?.destination.options
    .find(option => option.destinationId === selectedDestinationId.value) ?? null)
  const busy = computed(() => status.value === 'loading' || status.value === 'submitting' || reconciling.value)
  const uncertain = computed(() => status.value === 'uncertain')
  const exactRetryAvailable = computed(() => lastDeclaration.value !== null)
  const mutationBlocked = computed(() => busy.value || uncertain.value
    || status.value === 'conflict' || Boolean(selectedOffer.value))
  const canBegin = computed(() => Boolean(document.value) && !hasUnsavedEdits.value && !busy.value
    && (status.value === 'idle' || status.value === 'ready'))

  const offersForSection = (
    section: GroupInventorySectionKey,
    direction: 'group-to-trainer' | 'trainer-to-group',
  ): readonly InventoryActionOfferV1[] => projection.value?.offers.filter(offer => (
    offer.action === 'transfer'
    && offer.source.section === section
    && offer.source.locationKind === (direction === 'group-to-trainer' ? 'group-inventory' : 'trainer-inventory')
  )) ?? []
  const requestParams = (current: GroupInventoryDocument): Record<string, string> => ({
    groupSlug: current.slug,
    ...(profileId.value ? { profileId: profileId.value } : {}),
  })

  const load = async (): Promise<void> => {
    const current = document.value
    if (!current || hasUnsavedEdits.value || status.value === 'uncertain' || reconciling.value) return
    const sequence = ++loadSequence
    const preserve = status.value === 'accepted'
    if (!preserve) status.value = 'loading'
    try {
      const parsed = parseInventoryActionProjection(await apiClient.getJson<unknown>(
        INVENTORY_ACTION_API_PATHS.actions,
        { params: requestParams(current) },
      ))
      if (sequence !== loadSequence) return
      const currentRevision = current.revision
      if (parsed.offers.some(offer => !groupRevisionRequirements(offer)
        .some(requirement => requirement.expectedRevision === currentRevision))) {
        throw new Error('Inventory actions do not match the open group inventory revision.')
      }
      projection.value = parsed
      if (selectedOfferId.value && !parsed.offers.some(offer => offer.offerId === selectedOfferId.value)) {
        selectedOfferId.value = null
        selectedDestinationId.value = null
        selectedConfirmationOptionId.value = null
      }
      if (!preserve) {
        status.value = selectedOfferId.value ? 'ready' : 'idle'
        message.value = null
      }
    }
    catch (error) {
      if (sequence !== loadSequence) return
      projection.value = null
      if (!preserve) {
        const errorMessage = getErrorMessage(error)
        status.value = errorStatusCode(error) === 409
          || errorMessage === 'Inventory actions do not match the open group inventory revision.'
          ? 'conflict'
          : 'error'
        message.value = errorMessage
      }
    }
  }

  const open = (offer: InventoryActionOfferV1): void => {
    if (!canBegin.value || !offer.enabled || !['transfer', 'split', 'merge', 'discard'].includes(offer.action)) return
    selectedOfferId.value = offer.offerId
    selectedDestinationId.value = offer.destination.options.find(destination => destination.enabled)?.destinationId ?? null
    selectedQuantity.value = offer.quantity.defaultValue ?? 1
    selectedConfirmationOptionId.value = null
    status.value = 'ready'
    message.value = null
  }
  const chooseDestination = (destinationId: string): void => {
    const destination = selectedOffer.value?.destination.options.find(candidate => candidate.destinationId === destinationId)
    if (!destination?.enabled || busy.value) return
    selectedDestinationId.value = destinationId
  }
  const setConfirmation = (accepted: boolean): void => {
    if (busy.value || selectedOffer.value?.confirmation.mode !== 'explicit-choice') return
    selectedConfirmationOptionId.value = accepted ? selectedOffer.value.confirmation.optionId : null
  }
  const setQuantity = (value: number): void => {
    const minimum = selectedOffer.value?.quantity.minimum ?? 1
    const maximum = selectedOffer.value?.quantity.maximum ?? 1
    if (!Number.isSafeInteger(value)) return
    selectedQuantity.value = Math.max(minimum, Math.min(maximum, value))
  }
  const close = (): void => {
    if (busy.value || uncertain.value) return
    selectedOfferId.value = null
    selectedDestinationId.value = null
    selectedQuantity.value = 1
    selectedConfirmationOptionId.value = null
    status.value = 'idle'
    message.value = null
  }

  const executeExact = async (declaration: InventoryActionDeclarationV1): Promise<void> => {
    const current = document.value
    if (!current) {
      status.value = 'conflict'
      message.value = 'Load authoritative group inventory before retrying.'
      return
    }
    lastDeclaration.value = declaration
    status.value = 'submitting'
    message.value = 'Rechecking exact source, destination, quantity, and revisions…'
    try {
      retainPendingGroupInventoryActionOperation({
        schemaVersion: 1,
        groupSlug: current.slug,
        profileId: profileId.value,
        declaration,
      })
      const response = parseInventoryActionAcceptedResponse(await apiClient.postJson<unknown>(
        INVENTORY_ACTION_API_PATHS.execute,
        {
          groupSlug: current.slug,
          declaration,
          ...(profileId.value ? { profileId: profileId.value } : {}),
          clientId: getClientId(),
        },
      ), declaration)
      status.value = 'accepted'
      message.value = response.result.message
      await options.onAccepted?.(response)
      clearPendingGroupInventoryActionOperation(current.slug, declaration.operationId)
      lastDeclaration.value = null
    }
    catch (error) {
      const code = errorStatusCode(error)
      if (error instanceof InventoryRecoveryConflictError) {
        lastDeclaration.value = null
        status.value = 'conflict'
        message.value = error.message
      }
      else if (code !== null && code >= 400 && code < 500) {
        clearPendingGroupInventoryActionOperation(current.slug, declaration.operationId)
        lastDeclaration.value = null
        status.value = code === 409 ? 'conflict' : 'error'
        message.value = getErrorMessage(error)
      }
      else {
        status.value = 'uncertain'
        message.value = online.value
          ? 'The inventory result is uncertain. Retry this exact action; do not change the item another way.'
          : 'The connection was lost. This exact shared inventory action is retained until you reconnect and choose retry.'
      }
    }
  }

  const submit = async (): Promise<void> => {
    const offer = selectedOffer.value
    const destination = selectedDestination.value
    const current = document.value
    const destinationReady = offer?.destination.mode !== 'required' || destination?.enabled === true
    const confirmationReady = offer?.confirmation.mode !== 'explicit-choice'
      || selectedConfirmationOptionId.value === offer.confirmation.optionId
    if (!current || !offer || !destinationReady || !confirmationReady || busy.value || hasUnsavedEdits.value) return
    const currentRevision = current.revision
    if (![...offer.revisionRequirements, ...(destination?.revisionRequirements ?? [])].some(requirement => (
      requirement.expectedRevision === currentRevision
      && ((offer.source.locationKind === 'group-inventory' && requirement.resourceKind === 'source-container')
        || (offer.source.locationKind === 'trainer-inventory' && requirement.resourceKind === 'destination-container'))
    ))) {
      status.value = 'conflict'
      message.value = 'The group inventory changed. Refresh actions before submitting.'
      return
    }
    try {
      const declaration = parseInventoryActionDeclaration({
        schemaVersion: 1,
        operationId: createOperationId(),
        offerId: offer.offerId,
        action: offer.action,
        sourceSelectionId: offer.source.sourceSelectionId,
        quantity: selectedQuantity.value,
        destinationId: offer.destination.mode === 'required' ? destination?.destinationId ?? null : null,
        confirmationOptionId: selectedConfirmationOptionId.value,
        expectedRevisions: [...offer.revisionRequirements, ...(destination?.revisionRequirements ?? [])]
          .map(requirement => ({
            requirementId: requirement.requirementId,
            expectedRevision: requirement.expectedRevision,
          })),
      })
      await executeExact(declaration)
    }
    catch (error) {
      status.value = errorStatusCode(error) === 409 ? 'conflict' : 'error'
      message.value = getErrorMessage(error)
    }
  }
  const retryExact = async (): Promise<void> => {
    if (busy.value) return
    if (!online.value) {
      status.value = 'uncertain'
      message.value = 'The connection is offline. This exact shared inventory action remains retained; retry is available after reconnection.'
      return
    }
    const current = document.value
    if (!current) {
      status.value = 'conflict'
      message.value = 'Load authoritative group inventory before retrying.'
      return
    }
    const pending = loadPendingGroupInventoryActionOperation(current.slug)
    const declaration = lastDeclaration.value ?? (pending?.profileId === profileId.value ? pending.declaration : null)
    if (!declaration) {
      status.value = 'conflict'
      message.value = 'No exact inventory action is available to retry. Refresh authoritative inventory.'
      return
    }
    await executeExact(declaration)
  }
  const refresh = async (): Promise<void> => {
    if (busy.value || uncertain.value) return
    reconciling.value = true
    message.value = 'Reloading authoritative shared inventory before requesting current actions…'
    try {
      await options.reconcileAuthority?.()
      selectedOfferId.value = null
      selectedDestinationId.value = null
      selectedQuantity.value = 1
      selectedConfirmationOptionId.value = null
      status.value = 'idle'
      message.value = null
    }
    catch (error) {
      status.value = 'error'
      message.value = getErrorMessage(error)
    }
    finally {
      reconciling.value = false
    }
    if (status.value === 'idle') await load()
  }
  const dismiss = (): void => {
    if (busy.value || uncertain.value) return
    const reloadAcceptedAuthority = status.value === 'accepted'
    selectedOfferId.value = null
    selectedDestinationId.value = null
    selectedQuantity.value = 1
    selectedConfirmationOptionId.value = null
    status.value = 'idle'
    message.value = null
    if (reloadAcceptedAuthority) void load()
  }
  const restorePending = (fromAnotherTab = false): void => {
    const current = document.value
    if (!current) return
    const pending = loadPendingGroupInventoryActionOperation(current.slug)
    if (!pending) {
      if (fromAnotherTab && status.value === 'uncertain') {
        lastDeclaration.value = null
        status.value = 'conflict'
        message.value = 'This retained action was resolved in another tab. Reload authoritative shared inventory before continuing.'
      }
      return
    }
    lastDeclaration.value = pending.profileId === profileId.value ? pending.declaration : null
    status.value = 'uncertain'
    message.value = pending.profileId === profileId.value
      ? 'A previous inventory action may have reached the server. Retry that exact action before changing another item.'
      : 'A previous inventory action belongs to another player profile. Select that profile before exact retry.'
  }
  const handleStorage = (event: StorageEvent): void => {
    const current = document.value
    if (current && isPendingGroupInventoryActionStorageEvent(event, current.slug)) restorePending(true)
  }

  watch(
    () => [document.value?.slug ?? null, document.value?.revision ?? null, profileId.value, hasUnsavedEdits.value] as const,
    (next, previous) => {
      if (next.every((value, index) => value === previous?.[index])) return
      if (previous && next[2] !== previous[2]) restorePending()
      if (status.value === 'uncertain' || hasUnsavedEdits.value) return
      void load()
    },
  )
  onMounted(() => {
    restorePending()
    window.addEventListener('storage', handleStorage)
    if (status.value !== 'uncertain' && !hasUnsavedEdits.value) void load()
  })
  onUnmounted(() => window.removeEventListener('storage', handleStorage))

  return {
    projection,
    selectedOffer,
    selectedDestinationId,
    selectedQuantity,
    selectedConfirmationOptionId,
    status,
    message,
    busy,
    reconciling,
    online,
    uncertain,
    exactRetryAvailable,
    mutationBlocked,
    canBegin,
    offersForSection,
    load,
    open,
    chooseDestination,
    setConfirmation,
    setQuantity,
    close,
    submit,
    retryExact,
    refresh,
    dismiss,
  }
}
