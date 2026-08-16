import { computed, onMounted, onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  itemCommandFromAuthorizedSheetAction,
  parseAuthorizedSheetItemActionOffer,
  parseSheetItemActionProjection,
  type SheetItemActionOfferV1,
  type SheetItemActionProjectionV1,
} from '#shared/itemAutomation/sheetActions'
import { parseItemOperationResult, type ItemOperationResultV1, type UseItemCommandV1 } from '#shared/itemAutomation/operations'
import {
  projectSheetItemInventorySources,
  type InventorySourceSelectionV1,
} from '#shared/itemAutomation/inventorySourceSelection'
import type { SheetKind } from '#shared/sheets'
import type { TrainerInventoryKey } from '~/utils/sheets/trainerInventorySections'
import type { TrainerSheet } from '~/types/trainerSheet'
import { useApiClient } from '~/composables/useApiClient'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import {
  clearPendingSheetItemOperation,
  createSheetItemOperationId,
  isPendingSheetItemStorageEvent,
  loadPendingSheetItemOperation,
  retainPendingSheetItemOperation,
} from '~/utils/sheetItemOperationStorage'
import { InventoryRecoveryConflictError } from '~/utils/inventoryRecoveryStorage'
import { useInventoryRecoveryConnectivity } from '~/composables/inventory/useInventoryRecoveryConnectivity'
import type { SaveStatus } from '~/composables/useEditableSheet'
import {
  loadInventorySourcePresentationPreference,
  orderInventorySourceOptions,
  rememberInventorySourcePresentationPreference,
  type InventorySourcePresentationPreferenceV1,
} from '~/utils/inventorySourcePreference'

export type TrainerSheetItemActionStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'submitting'
  | 'accepted'
  | 'pending-gm'
  | 'conflict'
  | 'uncertain'
  | 'error'

export interface AcceptedItemSheetDocument {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
  readonly updatedAt: number
  readonly sheet: Record<string, unknown>
}

export interface TrainerSheetItemAcceptedResult {
  readonly result: ItemOperationResultV1
  readonly sheets: readonly AcceptedItemSheetDocument[]
}

export interface UseTrainerSheetItemActionsOptions {
  readonly sheet: MaybeRefOrGetter<TrainerSheet>
  readonly saveStatus: MaybeRefOrGetter<SaveStatus>
  readonly profileId: MaybeRefOrGetter<string | null>
  readonly prepareForAction?: () => Promise<void>
  readonly reconcileAuthority?: () => Promise<void>
  readonly onStartExtendedAction?: (
    offer: SheetItemActionOfferV1,
    targetIds: readonly string[],
    choices: readonly { readonly choiceId: string, readonly optionIds: readonly string[] }[],
  ) => Promise<boolean>
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
  return numericErrorField(error && typeof error === 'object' ? (error as Record<string, unknown>).response : null, 'status')
}

const cleanSaveBoundary = (status: SaveStatus): boolean => status === 'idle' || status === 'saved'

const parseExecutionResponse = (
  value: unknown,
  command: UseItemCommandV1,
): TrainerSheetItemAcceptedResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Item use returned an invalid response.')
  const input = value as Record<string, unknown>
  if (!input.result || typeof input.result !== 'object' || Array.isArray(input.result) || !Array.isArray(input.sheets)) {
    throw new Error('Item use returned incomplete authoritative evidence.')
  }
  if (Object.keys(input).some(key => !['result', 'sheets'].includes(key))) {
    throw new Error('Sheet item use returned an unexpected resource payload.')
  }
  const result = parseItemOperationResult(input.result)
  if (result.operationId !== command.operationId) {
    throw new Error('Item use result does not match the submitted exact command.')
  }
  const sheets = input.sheets.map((entry, index): AcceptedItemSheetDocument => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Item use sheet ${index + 1} is invalid.`)
    const sheet = entry as Record<string, unknown>
    if (Object.keys(sheet).some(key => !['kind', 'slug', 'revision', 'updatedAt', 'sheet'].includes(key))
      || (sheet.kind !== 'pokemon' && sheet.kind !== 'trainer')
      || typeof sheet.slug !== 'string' || !sheet.slug.trim()
      || !Number.isSafeInteger(sheet.revision) || Number(sheet.revision) < 0
      || !Number.isSafeInteger(sheet.updatedAt) || Number(sheet.updatedAt) < 0
      || !sheet.sheet || typeof sheet.sheet !== 'object' || Array.isArray(sheet.sheet)) {
      throw new Error(`Item use sheet ${index + 1} has invalid authority.`)
    }
    const document = sheet.sheet as Record<string, unknown>
    if (document.slug !== undefined && document.slug !== sheet.slug) throw new Error(`Item use sheet ${index + 1} changed identity.`)
    if (document.revision !== undefined && document.revision !== sheet.revision) throw new Error(`Item use sheet ${index + 1} changed revision.`)
    return Object.freeze({
      kind: sheet.kind as SheetKind,
      slug: sheet.slug,
      revision: Number(sheet.revision),
      updatedAt: Number(sheet.updatedAt),
      sheet: Object.freeze({ ...document }),
    })
  })
  return Object.freeze({ result, sheets: Object.freeze(sheets) })
}

export const useTrainerSheetItemActions = (options: UseTrainerSheetItemActionsOptions) => {
  const { getJson, postJson } = useApiClient()
  const projection = ref<SheetItemActionProjectionV1 | null>(null)
  const selectedOfferId = ref<string | null>(null)
  const sourcePreference = ref<InventorySourcePresentationPreferenceV1 | null>(null)
  const selectedTargetIds = ref<string[]>([])
  const selectedChoices = ref<Record<string, readonly string[]>>({})
  const status = ref<TrainerSheetItemActionStatus>('idle')
  const message = ref<string | null>(null)
  const lastCommand = ref<UseItemCommandV1 | null>(null)
  const acceptedSheetLinks = ref<readonly { readonly href: string, readonly label: string }[]>([])
  const reconciling = ref(false)
  const { online } = useInventoryRecoveryConnectivity()
  let loadSequence = 0

  const sheet = computed(() => toValue(options.sheet))
  const saveStatus = computed(() => toValue(options.saveStatus))
  const profileId = computed(() => toValue(options.profileId))
  const selectedOffer = computed(() => projection.value?.offers.find(offer => offer.offerId === selectedOfferId.value) ?? null)
  const sourceSelection = computed<InventorySourceSelectionV1 | null>(() => {
    const current = projectSheetItemInventorySources(projection.value, selectedOffer.value)
    return current
      ? Object.freeze({ ...current, options: orderInventorySourceOptions(current.options, sourcePreference.value) })
      : null
  })
  const busy = computed(() => status.value === 'loading' || status.value === 'submitting' || reconciling.value)
  const exactRetryAvailable = computed(() => lastCommand.value !== null)
  const projectedChoices = computed(() => {
    const offer = selectedOffer.value
    if (!offer || selectedTargetIds.value.length !== 1) return []
    return offer.targeting?.options.find(option => option.targetId === selectedTargetIds.value[0])?.choices ?? []
  })
  const choiceSelections = computed(() => projectedChoices.value.map(choice => ({
    choiceId: choice.choiceId,
    optionIds: Object.freeze([...(selectedChoices.value[choice.choiceId] ?? [])]),
  })))
  const choicesComplete = computed(() => projectedChoices.value.every((choice) => {
    const values = selectedChoices.value[choice.choiceId] ?? []
    return values.length >= choice.minimum && values.length <= choice.maximum
      && values.every(optionId => choice.options.some(option => option.optionId === optionId))
  }))
  const canBegin = computed(() => cleanSaveBoundary(saveStatus.value) && !busy.value
    && (status.value === 'idle' || status.value === 'ready'))

  const offersForSection = (section: TrainerInventoryKey): readonly SheetItemActionOfferV1[] => (
    projection.value?.offers.filter(offer => offer.source.section === section) ?? []
  )
  const offerForRow = (section: TrainerInventoryKey, rowIndex: number): SheetItemActionOfferV1 | null => (
    offersForSection(section).find(offer => offer.source.rowIndex === rowIndex) ?? null
  )

  const requestParams = (): Record<string, string> => ({
    trainerSlug: sheet.value.slug,
    ...(profileId.value ? { profileId: profileId.value } : {}),
  })

  const loadProjection = async (): Promise<void> => {
    if (!cleanSaveBoundary(saveStatus.value) || reconciling.value) return
    const sequence = ++loadSequence
    const preserveResultState = status.value === 'uncertain' || status.value === 'accepted'
    if (!preserveResultState) status.value = 'loading'
    try {
      const response = await getJson<unknown>(ITEM_API_PATHS.sheetActions, { params: requestParams() })
      if (sequence !== loadSequence) return
      projection.value = parseSheetItemActionProjection(response)
      if (projection.value.trainerSlug !== sheet.value.slug
        || projection.value.trainerRevision !== Number(sheet.value.revision ?? 0)) {
        throw new Error('Sheet item actions do not match the open Trainer revision.')
      }
      if (selectedOfferId.value && !projection.value.offers.some(offer => offer.offerId === selectedOfferId.value)) {
        selectedOfferId.value = null
        selectedTargetIds.value = []
        selectedChoices.value = {}
      }
      if (!preserveResultState) {
        status.value = selectedOfferId.value ? 'ready' : 'idle'
        message.value = null
      }
    }
    catch (error) {
      if (sequence !== loadSequence) return
      projection.value = null
      if (!preserveResultState) {
        status.value = errorStatusCode(error) === 409 ? 'conflict' : 'error'
        message.value = getErrorMessage(error)
      }
    }
  }

  const rememberSource = (offer: SheetItemActionOfferV1): void => {
    sourcePreference.value = rememberInventorySourcePresentationPreference({
      containerKind: offer.source.containerKind,
      section: offer.source.section,
    })
  }

  const openOffer = (offer: SheetItemActionOfferV1): void => {
    const use = offer.actions.find(action => action.kind === 'use')
    if (!canBegin.value || !offer.availability.enabled || !use?.enabled) return
    rememberSource(offer)
    selectedOfferId.value = offer.offerId
    selectedTargetIds.value = []
    selectedChoices.value = {}
    status.value = 'ready'
    message.value = null
    acceptedSheetLinks.value = []
  }

  const chooseSource = (sourceSelectionId: string): void => {
    if (busy.value || status.value === 'uncertain') return
    const option = sourceSelection.value?.options.find(candidate => candidate.sourceSelectionId === sourceSelectionId)
    const offer = option
      ? projection.value?.offers.find(candidate => candidate.offerId === option.offerId) ?? null
      : null
    if (!option || !offer || offer.offerId === selectedOfferId.value) return
    const use = offer.actions.find(action => action.kind === 'use')
    if (!offer.availability.enabled || !use?.enabled) return
    rememberSource(offer)
    selectedOfferId.value = offer.offerId
    selectedTargetIds.value = []
    selectedChoices.value = {}
    status.value = 'ready'
    message.value = 'Source changed. Choose the target again before submitting.'
  }

  const chooseTarget = (targetId: string): void => {
    const offer = selectedOffer.value
    const option = offer?.targeting?.options.find(candidate => candidate.targetId === targetId)
    if (!offer || !option?.enabled || busy.value) return
    if ((offer.targeting?.maximum ?? 1) === 1) {
      if (selectedTargetIds.value[0] !== targetId) selectedChoices.value = {}
      selectedTargetIds.value = [targetId]
    }
    else if (selectedTargetIds.value.includes(targetId)) {
      selectedTargetIds.value = selectedTargetIds.value.filter(value => value !== targetId)
    }
    else if (selectedTargetIds.value.length < (offer.targeting?.maximum ?? 0)) {
      selectedTargetIds.value = [...selectedTargetIds.value, targetId]
    }
  }

  const chooseOption = (choiceId: string, optionId: string): void => {
    if (busy.value) return
    const choice = projectedChoices.value.find(value => value.choiceId === choiceId)
    if (!choice || !choice.options.some(option => option.optionId === optionId)) return
    const current = selectedChoices.value[choiceId] ?? []
    const next = choice.presentation === 'confirmation' && current.includes(optionId)
      ? []
      : choice.maximum === 1
        ? [optionId]
        : current.includes(optionId)
          ? current.filter(value => value !== optionId)
          : current.length < choice.maximum ? [...current, optionId] : current
    selectedChoices.value = { ...selectedChoices.value, [choiceId]: Object.freeze(next) }
  }

  const closeDecision = (): void => {
    if (busy.value || status.value === 'uncertain') return
    selectedOfferId.value = null
    selectedTargetIds.value = []
    selectedChoices.value = {}
    message.value = null
    status.value = 'idle'
  }

  const acceptedLinks = (sheets: readonly AcceptedItemSheetDocument[]): readonly { readonly href: string, readonly label: string }[] => {
    const seen = new Set<string>()
    return sheets.flatMap((value) => {
      const key = `${value.kind}:${value.slug}`
      if (seen.has(key)) return []
      seen.add(key)
      const record = value.sheet
      const label = value.kind === 'trainer'
        ? (typeof record.name === 'string' && record.name.trim() ? record.name.trim() : value.slug)
        : (typeof record.nickname === 'string' && record.nickname.trim()
            ? record.nickname.trim()
            : typeof record.species === 'string' && record.species.trim() ? record.species.trim() : value.slug)
      return [{
        href: value.kind === 'trainer'
          ? `/sheets/trainers/${encodeURIComponent(value.slug)}`
          : `/sheets/${encodeURIComponent(value.slug)}`,
        label,
      }]
    })
  }

  const executeExact = async (command: UseItemCommandV1): Promise<void> => {
    lastCommand.value = command
    status.value = 'submitting'
    message.value = 'Waiting for the accepted item result…'
    try {
      const response = parseExecutionResponse(await postJson<unknown>(ITEM_API_PATHS.use, {
        command,
        ...(profileId.value ? { profileId: profileId.value } : {}),
        clientId: getClientId(),
      }), command)
      if (response.result.status !== 'accepted') {
        if (response.result.status === 'pending') {
          clearPendingSheetItemOperation(sheet.value.slug, command.operationId)
          lastCommand.value = null
          status.value = 'pending-gm'
          message.value = 'Request sent. The item is reserved and no mechanics apply until the GM accepts a bounded outcome.'
        }
        else {
          status.value = 'conflict'
          message.value = response.result.message
        }
        return
      }
      clearPendingSheetItemOperation(sheet.value.slug, command.operationId)
      lastCommand.value = null
      acceptedSheetLinks.value = acceptedLinks(response.sheets)
      status.value = 'accepted'
      message.value = response.result.exactReplay
        ? 'The original accepted item result was recovered without using the item twice.'
        : 'Item use accepted. Authoritative sheets are up to date.'
      await options.onAccepted?.(response)
    }
    catch (error) {
      const statusCode = errorStatusCode(error)
      if (error instanceof InventoryRecoveryConflictError) {
        lastCommand.value = null
        status.value = 'conflict'
        message.value = error.message
      }
      else if (statusCode !== null && statusCode >= 400 && statusCode < 500) {
        clearPendingSheetItemOperation(sheet.value.slug, command.operationId)
        lastCommand.value = null
        status.value = 'conflict'
        message.value = getErrorMessage(error)
      }
      else {
        status.value = 'uncertain'
        message.value = online.value
          ? 'The result is uncertain. Retry the exact same use to recover it safely; do not start a new use.'
          : 'The connection was lost. This exact item use is retained until you reconnect and choose retry.'
      }
    }
  }

  const submit = async (): Promise<void> => {
    const offer = selectedOffer.value
    if (!offer || busy.value || !cleanSaveBoundary(saveStatus.value)) return
    const targeting = offer.targeting
    if (targeting && (selectedTargetIds.value.length < targeting.minimum
      || selectedTargetIds.value.length > targeting.maximum)) {
      message.value = targeting.minimum === targeting.maximum
        ? `Choose ${targeting.minimum} target before confirming.`
        : `Choose ${targeting.minimum}–${targeting.maximum} targets before confirming.`
      return
    }
    if (!choicesComplete.value) {
      message.value = 'Complete every permanent item choice before confirming.'
      return
    }
    if (offer.timingLabel === 'Extended Action' && options.onStartExtendedAction) {
      status.value = 'submitting'
      message.value = 'Starting the durable Extended Action without applying item mechanics…'
      try {
        const started = await options.onStartExtendedAction(
          offer,
          selectedTargetIds.value,
          choiceSelections.value,
        )
        if (started) {
          selectedOfferId.value = null
          selectedTargetIds.value = []
          selectedChoices.value = {}
          status.value = 'idle'
          message.value = null
        }
        else {
          status.value = 'ready'
          message.value = 'The Extended Action did not start. Review current activity before retrying.'
        }
      }
      catch (error) {
        status.value = error instanceof InventoryRecoveryConflictError || errorStatusCode(error) === 409 ? 'conflict' : 'error'
        message.value = getErrorMessage(error)
      }
      return
    }
    try {
      await options.prepareForAction?.()
      if (!cleanSaveBoundary(saveStatus.value)
        || Number(sheet.value.revision ?? -1) !== offer.actor.revision) {
        status.value = 'conflict'
        message.value = 'The Trainer sheet changed. Refresh item actions before confirming.'
        return
      }
      status.value = 'submitting'
      message.value = 'Checking current item and target authority…'
      const declared = parseAuthorizedSheetItemActionOffer(await postJson<unknown>(ITEM_API_PATHS.declareSheetAction, {
        intent: {
          schemaVersion: 1,
          trainerSlug: offer.actor.sheetSlug,
          trainerRevision: offer.actor.revision,
          offerId: offer.offerId,
          action: 'use',
        },
        ...(profileId.value ? { profileId: profileId.value } : {}),
      }))
      const command = itemCommandFromAuthorizedSheetAction({
        offer: declared,
        operationId: createSheetItemOperationId(),
        targetIds: selectedTargetIds.value,
        choices: choiceSelections.value,
      })
      retainPendingSheetItemOperation({
        schemaVersion: 1,
        trainerSlug: sheet.value.slug,
        profileId: profileId.value,
        command,
      })
      await executeExact(command)
    }
    catch (error) {
      status.value = error instanceof InventoryRecoveryConflictError || errorStatusCode(error) === 409 ? 'conflict' : 'error'
      message.value = getErrorMessage(error)
    }
  }

  const retryExact = async (): Promise<void> => {
    if (busy.value) return
    if (!online.value) {
      status.value = 'uncertain'
      message.value = 'The connection is offline. This exact item use remains retained; retry is available after reconnection.'
      return
    }
    const stored = loadPendingSheetItemOperation(sheet.value.slug)
    const command = lastCommand.value ?? (stored?.profileId === profileId.value ? stored.command : null)
    if (!command) {
      status.value = 'conflict'
      message.value = 'No exact item use is available to retry. Refresh the authoritative sheet.'
      return
    }
    await executeExact(command)
  }

  const refresh = async (): Promise<void> => {
    if (busy.value || status.value === 'uncertain') return
    const needsReconciliation = status.value === 'conflict' || status.value === 'error'
    reconciling.value = true
    if (needsReconciliation) message.value = 'Reloading the authoritative Trainer inventory and item actions…'
    try {
      if (needsReconciliation) await options.reconcileAuthority?.()
      selectedOfferId.value = null
      selectedTargetIds.value = []
      selectedChoices.value = {}
      acceptedSheetLinks.value = []
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
    if (status.value === 'idle') await loadProjection()
  }

  const restorePending = (fromAnotherTab = false): void => {
    const stored = loadPendingSheetItemOperation(sheet.value.slug)
    if (!stored) {
      if (fromAnotherTab && status.value === 'uncertain') {
        lastCommand.value = null
        status.value = 'conflict'
        message.value = 'This retained item use was resolved in another tab. Reload authoritative inventory before continuing.'
      }
      return
    }
    lastCommand.value = stored.profileId === profileId.value ? stored.command : null
    status.value = 'uncertain'
    message.value = stored.profileId === profileId.value
      ? 'A previous item use may have reached the server. Retry that exact use before starting another.'
      : 'A previous item use belongs to another player profile. Select that profile before exact retry.'
  }
  const handleStorage = (event: StorageEvent): void => {
    if (isPendingSheetItemStorageEvent(event, sheet.value.slug)) restorePending(true)
  }

  watch(
    () => [sheet.value.slug, Number(sheet.value.revision ?? 0), profileId.value, saveStatus.value] as const,
    ([nextSlug, nextRevision, nextProfileId, nextSaveStatus], previous) => {
      if (!cleanSaveBoundary(nextSaveStatus)) return
      if (previous && previous[0] === nextSlug && previous[1] === nextRevision
        && previous[2] === nextProfileId && previous[3] === nextSaveStatus) return
      if (previous && previous[2] !== nextProfileId) restorePending()
      void loadProjection()
    },
  )

  onMounted(() => {
    sourcePreference.value = loadInventorySourcePresentationPreference()
    restorePending()
    window.addEventListener('storage', handleStorage)
    void loadProjection()
  })
  onUnmounted(() => window.removeEventListener('storage', handleStorage))

  return {
    projection,
    selectedOffer,
    sourceSelection,
    selectedTargetIds,
    selectedChoices,
    projectedChoices,
    choicesComplete,
    status,
    message,
    lastCommand,
    acceptedSheetLinks,
    busy,
    reconciling,
    online,
    exactRetryAvailable,
    canBegin,
    offerForRow,
    openOffer,
    chooseSource,
    chooseTarget,
    chooseOption,
    closeDecision,
    submit,
    retryExact,
    refresh,
  }
}
