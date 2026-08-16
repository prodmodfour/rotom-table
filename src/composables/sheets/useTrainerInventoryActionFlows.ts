import { computed, onMounted, onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  parseInventoryActionDeclaration,
  parseInventoryActionExecutionResult,
  parseInventoryActionProjection,
  type InventoryActionDeclarationV1,
  type InventoryActionOfferV1,
  type InventoryActionProjectionV1,
} from '#shared/itemAutomation/inventoryActions'
import type { SheetKind } from '#shared/sheets'
import type { SaveStatus } from '~/composables/useEditableSheet'
import { useApiClient } from '~/composables/useApiClient'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { TrainerSheet } from '~/types/trainerSheet'
import { INVENTORY_ACTION_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import {
  clearPendingInventoryActionOperation,
  isPendingInventoryActionStorageEvent,
  loadPendingInventoryActionOperation,
  retainPendingInventoryActionOperation,
} from '~/utils/inventoryActionOperationStorage'
import { InventoryRecoveryConflictError } from '~/utils/inventoryRecoveryStorage'
import { useInventoryRecoveryConnectivity } from '~/composables/inventory/useInventoryRecoveryConnectivity'

export type InventoryActionFlowStatus =
  | 'idle' | 'loading' | 'ready' | 'submitting' | 'accepted' | 'conflict' | 'uncertain' | 'error'
/** @deprecated Use the surface-neutral InventoryActionFlowStatus. */
export type TrainerInventoryActionFlowStatus = InventoryActionFlowStatus

export interface AcceptedInventoryActionSheetDocument {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
  readonly updatedAt: number
  readonly sheet: Record<string, unknown>
}

export interface InventoryActionAcceptedResult {
  readonly result: ReturnType<typeof parseInventoryActionExecutionResult>
  readonly sheets: readonly AcceptedInventoryActionSheetDocument[]
  readonly groupInventories: readonly GroupInventoryDocument[]
}
/** @deprecated Use the surface-neutral InventoryActionAcceptedResult. */
export type TrainerInventoryActionAcceptedResult = InventoryActionAcceptedResult

export interface UseTrainerInventoryActionFlowsOptions {
  readonly sheet: MaybeRefOrGetter<TrainerSheet>
  readonly saveStatus: MaybeRefOrGetter<SaveStatus>
  readonly profileId: MaybeRefOrGetter<string | null>
  readonly prepareForAction?: () => Promise<void>
  readonly reconcileAuthority?: () => Promise<void>
  readonly onAccepted?: (response: InventoryActionAcceptedResult) => Promise<void> | void
}

const cleanSaveBoundary = (status: SaveStatus): boolean => status === 'idle' || status === 'saved'
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

export const parseInventoryActionAcceptedResponse = (
  value: unknown,
  declaration: InventoryActionDeclarationV1,
): InventoryActionAcceptedResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Inventory action returned an invalid response.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['result', 'sheets', 'groupInventories'].includes(key))
    || !Array.isArray(input.sheets) || !Array.isArray(input.groupInventories)) {
    throw new Error('Inventory action returned incomplete resource authority.')
  }
  const result = parseInventoryActionExecutionResult(input.result)
  if (result.operationId !== declaration.operationId || result.action !== declaration.action) {
    throw new Error('Inventory action result does not match the exact submitted declaration.')
  }
  const sheets = input.sheets.map((entry, index): AcceptedInventoryActionSheetDocument => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Inventory action sheet ${index + 1} is invalid.`)
    const row = entry as Record<string, unknown>
    if (Object.keys(row).some(key => !['kind', 'slug', 'revision', 'updatedAt', 'sheet'].includes(key))
      || (row.kind !== 'trainer' && row.kind !== 'pokemon')
      || typeof row.slug !== 'string' || !row.slug
      || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0
      || !Number.isSafeInteger(row.updatedAt) || Number(row.updatedAt) < 0
      || !row.sheet || typeof row.sheet !== 'object' || Array.isArray(row.sheet)) {
      throw new Error(`Inventory action sheet ${index + 1} has invalid authority.`)
    }
    const document = row.sheet as Record<string, unknown>
    if (document.slug !== undefined && document.slug !== row.slug) throw new Error(`Inventory action sheet ${index + 1} changed identity.`)
    if (document.revision !== undefined && document.revision !== row.revision) throw new Error(`Inventory action sheet ${index + 1} changed revision.`)
    return Object.freeze({
      kind: row.kind,
      slug: row.slug,
      revision: Number(row.revision),
      updatedAt: Number(row.updatedAt),
      sheet: Object.freeze({ ...document }),
    })
  })
  const groupInventories = input.groupInventories.map((entry, index): GroupInventoryDocument => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Inventory action group document ${index + 1} is invalid.`)
    const row = entry as Record<string, unknown>
    if (typeof row.slug !== 'string' || !row.slug
      || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0
      || !Number.isSafeInteger(row.updatedAt) || Number(row.updatedAt) < 0
      || !row.inventory || typeof row.inventory !== 'object' || Array.isArray(row.inventory)) {
      throw new Error(`Inventory action group document ${index + 1} has invalid authority.`)
    }
    return Object.freeze({ ...row }) as unknown as GroupInventoryDocument
  })
  return Object.freeze({ result, sheets: Object.freeze(sheets), groupInventories: Object.freeze(groupInventories) })
}

export const useTrainerInventoryActionFlows = (options: UseTrainerInventoryActionFlowsOptions) => {
  const { getJson, postJson } = useApiClient()
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

  const sheet = computed(() => toValue(options.sheet))
  const saveStatus = computed(() => toValue(options.saveStatus))
  const profileId = computed(() => toValue(options.profileId))
  const selectedOffer = computed(() => projection.value?.offers.find(offer => offer.offerId === selectedOfferId.value) ?? null)
  const selectedDestination = computed(() => selectedOffer.value?.destination.options
    .find(option => option.destinationId === selectedDestinationId.value) ?? null)
  const busy = computed(() => status.value === 'loading' || status.value === 'submitting' || reconciling.value)
  const exactRetryAvailable = computed(() => lastDeclaration.value !== null)
  const canBegin = computed(() => cleanSaveBoundary(saveStatus.value) && !busy.value
    && (status.value === 'idle' || status.value === 'ready'))

  const offersForSource = (sourceSelectionId: string | null | undefined): readonly InventoryActionOfferV1[] => (
    sourceSelectionId
      ? projection.value?.offers.filter(offer => offer.source.sourceSelectionId === sourceSelectionId) ?? []
      : []
  )
  const requestParams = (): Record<string, string> => ({
    trainerSlug: sheet.value.slug,
    ...(profileId.value ? { profileId: profileId.value } : {}),
  })
  const load = async (): Promise<void> => {
    if (!cleanSaveBoundary(saveStatus.value) || status.value === 'uncertain' || reconciling.value) return
    const sequence = ++loadSequence
    const preserve = status.value === 'accepted'
    if (!preserve) status.value = 'loading'
    try {
      const parsed = parseInventoryActionProjection(await getJson<unknown>(INVENTORY_ACTION_API_PATHS.actions, { params: requestParams() }))
      if (sequence !== loadSequence) return
      const sourceRevision = Number(sheet.value.revision ?? 0)
      if (parsed.offers.some(offer => !offer.revisionRequirements.some(requirement => (
        requirement.resourceKind === 'source-container' && requirement.expectedRevision === sourceRevision
      )))) {
        throw new Error('Inventory actions do not match the open Trainer revision.')
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
        status.value = errorStatusCode(error) === 409 || errorMessage === 'Inventory actions do not match the open Trainer revision.'
          ? 'conflict'
          : 'error'
        message.value = errorMessage
      }
    }
  }

  const open = (offer: InventoryActionOfferV1): void => {
    if (!canBegin.value || !offer.enabled || !['equip', 'give', 'transfer', 'split', 'merge', 'discard'].includes(offer.action)) return
    selectedOfferId.value = offer.offerId
    selectedDestinationId.value = offer.destination.options.find(option => option.enabled)?.destinationId ?? null
    selectedQuantity.value = offer.quantity.defaultValue ?? 1
    selectedConfirmationOptionId.value = null
    status.value = 'ready'
    message.value = null
  }
  const chooseDestination = (destinationId: string): void => {
    const destination = selectedOffer.value?.destination.options.find(option => option.destinationId === destinationId)
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
    if (busy.value || status.value === 'uncertain') return
    selectedOfferId.value = null
    selectedDestinationId.value = null
    selectedQuantity.value = 1
    selectedConfirmationOptionId.value = null
    status.value = 'idle'
    message.value = null
  }

  const executeExact = async (declaration: InventoryActionDeclarationV1): Promise<void> => {
    lastDeclaration.value = declaration
    status.value = 'submitting'
    message.value = 'Rechecking exact source, destination, quantity, and revisions…'
    try {
      retainPendingInventoryActionOperation({
        schemaVersion: 1,
        trainerSlug: sheet.value.slug,
        profileId: profileId.value,
        declaration,
      })
      const response = parseInventoryActionAcceptedResponse(await postJson<unknown>(INVENTORY_ACTION_API_PATHS.execute, {
        trainerSlug: sheet.value.slug,
        declaration,
        ...(profileId.value ? { profileId: profileId.value } : {}),
        clientId: getClientId(),
      }), declaration)
      status.value = 'accepted'
      message.value = response.result.message
      await options.onAccepted?.(response)
      clearPendingInventoryActionOperation(sheet.value.slug, declaration.operationId)
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
        clearPendingInventoryActionOperation(sheet.value.slug, declaration.operationId)
        lastDeclaration.value = null
        status.value = code === 409 ? 'conflict' : 'error'
        message.value = getErrorMessage(error)
      }
      else {
        status.value = 'uncertain'
        message.value = online.value
          ? 'The inventory result is uncertain. Retry this exact action; do not move the item another way.'
          : 'The connection was lost. This exact inventory action is retained until you reconnect and choose retry.'
      }
    }
  }

  const submit = async (): Promise<void> => {
    const offer = selectedOffer.value
    const destination = selectedDestination.value
    const destinationReady = offer?.destination.mode !== 'required' || destination?.enabled === true
    const confirmationReady = offer?.confirmation.mode !== 'explicit-choice'
      || selectedConfirmationOptionId.value === offer.confirmation.optionId
    if (!offer || !destinationReady || !confirmationReady || busy.value || !cleanSaveBoundary(saveStatus.value)) return
    try {
      await options.prepareForAction?.()
      const sourceRevision = offer.revisionRequirements.find(requirement => requirement.resourceKind === 'source-container')
      if (!cleanSaveBoundary(saveStatus.value) || sourceRevision?.expectedRevision !== Number(sheet.value.revision ?? -1)) {
        status.value = 'conflict'
        message.value = 'The Trainer inventory changed. Refresh actions before submitting.'
        return
      }
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
      message.value = 'The connection is offline. This exact inventory action remains retained; retry is available after reconnection.'
      return
    }
    const pending = loadPendingInventoryActionOperation(sheet.value.slug)
    const declaration = lastDeclaration.value ?? (pending?.profileId === profileId.value ? pending.declaration : null)
    if (!declaration) {
      status.value = 'conflict'
      message.value = 'No exact inventory action is available to retry. Refresh authoritative inventory.'
      return
    }
    await executeExact(declaration)
  }
  const refresh = async (): Promise<void> => {
    if (busy.value || status.value === 'uncertain') return
    reconciling.value = true
    message.value = 'Reloading authoritative inventory before requesting current actions…'
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
    if (busy.value || status.value === 'uncertain') return
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
    const pending = loadPendingInventoryActionOperation(sheet.value.slug)
    if (!pending) {
      if (fromAnotherTab && status.value === 'uncertain') {
        lastDeclaration.value = null
        status.value = 'conflict'
        message.value = 'This retained action was resolved in another tab. Reload authoritative inventory before continuing.'
      }
      return
    }
    lastDeclaration.value = pending.profileId === profileId.value ? pending.declaration : null
    status.value = 'uncertain'
    message.value = pending.profileId === profileId.value
      ? 'A previous inventory action may have reached the server. Retry that exact action before moving another item.'
      : 'A previous inventory action belongs to another player profile. Select that profile before exact retry.'
  }
  const handleStorage = (event: StorageEvent): void => {
    if (isPendingInventoryActionStorageEvent(event, sheet.value.slug)) restorePending(true)
  }

  watch(
    () => [sheet.value.slug, Number(sheet.value.revision ?? 0), profileId.value, saveStatus.value] as const,
    (next, previous) => {
      if (next.every((value, index) => value === previous?.[index])) return
      if (previous && next[2] !== previous[2]) restorePending()
      if (status.value === 'uncertain') return
      void load()
    },
  )
  onMounted(() => {
    restorePending()
    window.addEventListener('storage', handleStorage)
    if (status.value !== 'uncertain') void load()
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
    exactRetryAvailable,
    canBegin,
    offersForSource,
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
