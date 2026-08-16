import { computed, onMounted, onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  itemCommandFromAuthorizedSheetAction,
  type SheetItemActionOfferV1,
} from '#shared/itemAutomation/sheetActions'
import {
  parseAuthorizedGroupInventoryItemAction,
  parseGroupInventoryItemActionProjection,
  type GroupInventoryItemActionProjectionV1,
} from '#shared/itemAutomation/groupInventoryItemActions'
import { parseItemOperationResult, type ItemOperationResultV1, type UseItemCommandV1 } from '#shared/itemAutomation/operations'
import type { PlayerProfileId } from '#shared/playerProfiles'
import type { SheetKind } from '#shared/sheets'
import type { GroupInventoryDocument, GroupInventorySectionKey } from '~/types/groupInventory'
import { useApiClient } from '~/composables/useApiClient'
import type { ApiClient } from '~/utils/apiClient'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import {
  clearPendingGroupItemOperation,
  createGroupItemOperationId,
  isPendingGroupItemStorageEvent,
  loadPendingGroupItemOperation,
  retainPendingGroupItemOperation,
} from '~/utils/groupItemOperationStorage'
import { InventoryRecoveryConflictError } from '~/utils/inventoryRecoveryStorage'
import { useInventoryRecoveryConnectivity } from '~/composables/inventory/useInventoryRecoveryConnectivity'
import type {
  AcceptedItemSheetDocument,
  TrainerSheetItemActionStatus,
} from '~/composables/sheets/useTrainerSheetItemActions'

export interface GroupItemAcceptedResult {
  readonly result: ItemOperationResultV1
  readonly sheets: readonly AcceptedItemSheetDocument[]
  readonly groupInventory?: GroupInventoryDocument
}

export interface UseGroupInventoryItemActionsOptions {
  readonly document: MaybeRefOrGetter<GroupInventoryDocument | null | undefined>
  readonly hasUnsavedEdits: MaybeRefOrGetter<boolean>
  readonly externallyBlocked?: MaybeRefOrGetter<boolean>
  readonly profileId: MaybeRefOrGetter<PlayerProfileId | null | undefined>
  readonly reconcileAuthority?: () => Promise<void>
  readonly onAccepted?: (response: GroupItemAcceptedResult) => Promise<void> | void
  readonly onPending?: () => Promise<void> | void
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
  return numericErrorField(error && typeof error === 'object'
    ? (error as Record<string, unknown>).response : null, 'status')
}

const parseSheet = (entry: unknown, index: number): AcceptedItemSheetDocument => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Shared item sheet ${index + 1} is invalid.`)
  const sheet = entry as Record<string, unknown>
  if (Object.keys(sheet).some(key => !['kind', 'slug', 'revision', 'updatedAt', 'sheet'].includes(key))
    || (sheet.kind !== 'pokemon' && sheet.kind !== 'trainer')
    || typeof sheet.slug !== 'string' || !sheet.slug.trim()
    || !Number.isSafeInteger(sheet.revision) || Number(sheet.revision) < 0
    || !Number.isSafeInteger(sheet.updatedAt) || Number(sheet.updatedAt) < 0
    || !sheet.sheet || typeof sheet.sheet !== 'object' || Array.isArray(sheet.sheet)) {
    throw new Error(`Shared item sheet ${index + 1} has invalid authority.`)
  }
  const document = sheet.sheet as Record<string, unknown>
  if ((document.slug !== undefined && document.slug !== sheet.slug)
    || (document.revision !== undefined && document.revision !== sheet.revision)) {
    throw new Error(`Shared item sheet ${index + 1} changed identity or revision.`)
  }
  return Object.freeze({
    kind: sheet.kind as SheetKind,
    slug: sheet.slug,
    revision: Number(sheet.revision),
    updatedAt: Number(sheet.updatedAt),
    sheet: Object.freeze({ ...document }),
  })
}
const parseGroup = (value: unknown, expectedSlug: string): GroupInventoryDocument => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Shared item use returned invalid group inventory.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['slug', 'revision', 'updatedAt', 'money', 'inventory', 'notes'].includes(key))
    || input.slug !== expectedSlug
    || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0
    || !Number.isSafeInteger(input.updatedAt) || Number(input.updatedAt) < 0
    || !Number.isSafeInteger(input.money) || Number(input.money) < 0
    || !input.inventory || typeof input.inventory !== 'object' || Array.isArray(input.inventory)
    || (input.notes !== undefined && typeof input.notes !== 'string')) {
    throw new Error('Shared item use returned inconsistent group authority.')
  }
  return Object.freeze({ ...input }) as unknown as GroupInventoryDocument
}
const parseExecutionResponse = (
  value: unknown,
  command: UseItemCommandV1,
): GroupItemAcceptedResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Shared item use returned an invalid response.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['result', 'sheets', 'groupInventory'].includes(key))
    || !Array.isArray(input.sheets)) throw new Error('Shared item use returned incomplete authoritative evidence.')
  const result = parseItemOperationResult(input.result)
  if (result.operationId !== command.operationId) throw new Error('Shared item result does not match its exact command.')
  const sheets = Object.freeze(input.sheets.map(parseSheet))
  const groupInventory = input.groupInventory === undefined
    ? undefined
    : parseGroup(input.groupInventory, command.source.slug)
  if (groupInventory && (result.status !== 'accepted'
    || !result.aggregateRefs.some(ref => ref.kind === 'group-inventory'
      && ref.id === groupInventory.slug && ref.revision === groupInventory.revision))) {
    throw new Error('Shared item group result does not match its accepted aggregate receipt.')
  }
  return Object.freeze({ result, sheets, ...(groupInventory ? { groupInventory } : {}) })
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

export const useGroupInventoryItemActions = (options: UseGroupInventoryItemActionsOptions) => {
  const apiClient = options.apiClient ?? useApiClient()
  const projection = ref<GroupInventoryItemActionProjectionV1 | null>(null)
  const selectedOfferId = ref<string | null>(null)
  const selectedTargetIds = ref<string[]>([])
  const selectedChoices = ref<Record<string, readonly string[]>>({})
  const status = ref<TrainerSheetItemActionStatus>('idle')
  const message = ref<string | null>(null)
  const lastCommand = ref<UseItemCommandV1 | null>(null)
  const acceptedSheetLinks = ref<readonly { readonly href: string, readonly label: string }[]>([])
  const reconciling = ref(false)
  const { online } = useInventoryRecoveryConnectivity()
  let loadSequence = 0

  const document = computed(() => toValue(options.document))
  const hasUnsavedEdits = computed(() => toValue(options.hasUnsavedEdits))
  const externallyBlocked = computed(() => options.externallyBlocked ? toValue(options.externallyBlocked) : false)
  const profileId = computed(() => toValue(options.profileId) ?? null)
  const selectedOffer = computed(() => projection.value?.offers.find(offer => offer.offerId === selectedOfferId.value) ?? null)
  const busy = computed(() => status.value === 'loading' || status.value === 'submitting' || reconciling.value)
  const uncertain = computed(() => status.value === 'uncertain')
  const exactRetryAvailable = computed(() => lastCommand.value !== null)
  const mutationBlocked = computed(() => busy.value || uncertain.value
    || status.value === 'conflict' || Boolean(selectedOffer.value))
  const canBegin = computed(() => Boolean(document.value) && !hasUnsavedEdits.value
    && !externallyBlocked.value && !busy.value && (status.value === 'idle' || status.value === 'ready'))
  const projectedChoices = computed(() => {
    if (!selectedOffer.value || selectedTargetIds.value.length !== 1) return []
    return selectedOffer.value.targeting?.options.find(option => option.targetId === selectedTargetIds.value[0])?.choices ?? []
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

  const offersForSection = (section: GroupInventorySectionKey): readonly SheetItemActionOfferV1[] => (
    projection.value?.offers.filter(offer => offer.source.section === section) ?? []
  )
  const offerForRow = (section: GroupInventorySectionKey, rowIndex: number): SheetItemActionOfferV1 | null => (
    offersForSection(section).find(offer => offer.source.rowIndex === rowIndex) ?? null
  )
  const requestParams = (actorSelectionId?: string | null): Record<string, string> => ({
    groupSlug: document.value?.slug ?? '',
    ...(actorSelectionId ? { actorSelectionId } : {}),
    ...(profileId.value ? { profileId: profileId.value } : {}),
  })

  const loadProjection = async (actorSelectionId?: string | null): Promise<void> => {
    const current = document.value
    if (!current || hasUnsavedEdits.value || uncertain.value || reconciling.value) return
    const sequence = ++loadSequence
    const preserve = status.value === 'accepted' || status.value === 'pending-gm'
    if (!preserve) status.value = 'loading'
    try {
      const parsed = parseGroupInventoryItemActionProjection(await apiClient.getJson<unknown>(
        ITEM_API_PATHS.groupActions,
        { params: requestParams(actorSelectionId) },
      ))
      if (sequence !== loadSequence) return
      if (parsed.groupSlug !== current.slug || parsed.groupRevision !== current.revision) {
        throw new Error('Shared item actions do not match the open group inventory revision.')
      }
      projection.value = parsed
      if (selectedOfferId.value && !parsed.offers.some(offer => offer.offerId === selectedOfferId.value)) {
        selectedOfferId.value = null
        selectedTargetIds.value = []
        selectedChoices.value = {}
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
        status.value = errorStatusCode(error) === 409 ? 'conflict' : 'error'
        message.value = getErrorMessage(error)
      }
    }
  }
  const chooseActor = async (actorSelectionId: string): Promise<void> => {
    if (busy.value || uncertain.value || actorSelectionId === projection.value?.selectedActorSelectionId) return
    selectedOfferId.value = null
    selectedTargetIds.value = []
    selectedChoices.value = {}
    message.value = null
    status.value = 'loading'
    await loadProjection(actorSelectionId)
  }
  const openOffer = (offer: SheetItemActionOfferV1): void => {
    const use = offer.actions.find(action => action.kind === 'use')
    if (!canBegin.value || !offer.availability.enabled || !use?.enabled) return
    selectedOfferId.value = offer.offerId
    selectedTargetIds.value = []
    selectedChoices.value = {}
    acceptedSheetLinks.value = []
    status.value = 'ready'
    message.value = null
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
    if (busy.value || uncertain.value) return
    selectedOfferId.value = null
    selectedTargetIds.value = []
    selectedChoices.value = {}
    status.value = 'idle'
    message.value = null
  }

  const executeExact = async (command: UseItemCommandV1): Promise<void> => {
    const current = document.value
    if (!current) return
    lastCommand.value = command
    status.value = 'submitting'
    message.value = 'Waiting for the accepted shared item result…'
    try {
      const response = parseExecutionResponse(await apiClient.postJson<unknown>(ITEM_API_PATHS.use, {
        command,
        ...(profileId.value ? { profileId: profileId.value } : {}),
        clientId: getClientId(),
      }), command)
      if (response.result.status === 'pending') {
        clearPendingGroupItemOperation(current.slug, command.operationId)
        lastCommand.value = null
        status.value = 'pending-gm'
        message.value = 'Request sent. The exact shared quantity is reserved; no mechanics apply until the GM accepts a bounded outcome.'
        await options.onPending?.()
        return
      }
      if (response.result.status !== 'accepted') {
        status.value = 'conflict'
        message.value = response.result.message
        return
      }
      clearPendingGroupItemOperation(current.slug, command.operationId)
      lastCommand.value = null
      acceptedSheetLinks.value = acceptedLinks(response.sheets)
      status.value = 'accepted'
      message.value = response.result.exactReplay
        ? 'The original shared item result was recovered without consuming it twice.'
        : 'Shared item use accepted. Authoritative inventory and sheets are up to date.'
      await options.onAccepted?.(response)
    }
    catch (error) {
      const code = errorStatusCode(error)
      if (error instanceof InventoryRecoveryConflictError) {
        lastCommand.value = null
        status.value = 'conflict'
        message.value = error.message
      }
      else if (code !== null && code >= 400 && code < 500) {
        clearPendingGroupItemOperation(current.slug, command.operationId)
        lastCommand.value = null
        status.value = 'conflict'
        message.value = getErrorMessage(error)
      }
      else {
        status.value = 'uncertain'
        message.value = online.value
          ? 'The shared item result is uncertain. Retry this exact use before changing any inventory.'
          : 'The connection was lost. This exact shared item use is retained until you reconnect and choose retry.'
      }
    }
  }
  const submit = async (): Promise<void> => {
    const current = document.value
    const offer = selectedOffer.value
    const selectedActorSelectionId = projection.value?.selectedActorSelectionId
    if (!current || !offer || !selectedActorSelectionId || busy.value
      || hasUnsavedEdits.value || externallyBlocked.value) return
    const targeting = offer.targeting
    if (targeting && (selectedTargetIds.value.length < targeting.minimum
      || selectedTargetIds.value.length > targeting.maximum)) {
      message.value = `Choose ${targeting.minimum === targeting.maximum ? targeting.minimum : `${targeting.minimum}–${targeting.maximum}`} target before confirming.`
      return
    }
    if (!choicesComplete.value) {
      message.value = 'Complete every server-issued item choice before confirming.'
      return
    }
    if (current.revision !== projection.value?.groupRevision) {
      status.value = 'conflict'
      message.value = 'The group inventory changed. Refresh shared item actions before confirming.'
      return
    }
    try {
      status.value = 'submitting'
      message.value = 'Rechecking actor, source, target, and reservation authority…'
      const declared = parseAuthorizedGroupInventoryItemAction(await apiClient.postJson<unknown>(
        ITEM_API_PATHS.declareGroupAction,
        {
          intent: {
            schemaVersion: 1,
            groupSlug: current.slug,
            groupRevision: current.revision,
            actorSelectionId: selectedActorSelectionId,
            offerId: offer.offerId,
            action: 'use',
          },
          ...(profileId.value ? { profileId: profileId.value } : {}),
        },
      ))
      const command = itemCommandFromAuthorizedSheetAction({
        offer: declared.offer,
        operationId: createGroupItemOperationId(),
        targetIds: selectedTargetIds.value,
        choices: choiceSelections.value,
      })
      retainPendingGroupItemOperation({
        schemaVersion: 1,
        groupSlug: current.slug,
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
      message.value = 'The connection is offline. This exact shared item use remains retained; retry is available after reconnection.'
      return
    }
    const current = document.value
    if (!current) return
    const stored = loadPendingGroupItemOperation(current.slug)
    const command = lastCommand.value ?? (stored?.profileId === profileId.value ? stored.command : null)
    if (!command) {
      status.value = 'conflict'
      message.value = 'No exact shared item use is available to retry. Refresh authoritative inventory.'
      return
    }
    await executeExact(command)
  }
  const refresh = async (): Promise<void> => {
    if (busy.value || uncertain.value) return
    const needsReconciliation = status.value === 'conflict' || status.value === 'error'
    const actorSelectionId = projection.value?.selectedActorSelectionId
    reconciling.value = true
    if (needsReconciliation) message.value = 'Reloading authoritative shared inventory and current item actions…'
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
    if (status.value === 'idle') await loadProjection(actorSelectionId)
  }
  const restorePending = (fromAnotherTab = false): void => {
    const current = document.value
    if (!current) return
    const pending = loadPendingGroupItemOperation(current.slug)
    if (!pending) {
      if (fromAnotherTab && status.value === 'uncertain') {
        lastCommand.value = null
        status.value = 'conflict'
        message.value = 'This retained shared item use was resolved in another tab. Reload authoritative inventory before continuing.'
      }
      return
    }
    lastCommand.value = pending.profileId === profileId.value ? pending.command : null
    status.value = 'uncertain'
    message.value = pending.profileId === profileId.value
      ? 'A previous shared item use may have reached the server. Retry that exact use before changing inventory.'
      : 'A previous shared item use belongs to another player profile. Select that profile before exact retry.'
  }
  const handleStorage = (event: StorageEvent): void => {
    const current = document.value
    if (current && isPendingGroupItemStorageEvent(event, current.slug)) restorePending(true)
  }

  watch(
    () => [document.value?.slug ?? null, document.value?.revision ?? null, profileId.value, hasUnsavedEdits.value] as const,
    (next, previous) => {
      if (next.every((value, index) => value === previous?.[index])) return
      if (previous && next[2] !== previous[2]) restorePending()
      if (uncertain.value || hasUnsavedEdits.value) return
      void loadProjection()
    },
  )
  onMounted(() => {
    restorePending()
    window.addEventListener('storage', handleStorage)
    if (!uncertain.value && !hasUnsavedEdits.value) void loadProjection()
  })
  onUnmounted(() => window.removeEventListener('storage', handleStorage))

  return {
    projection,
    selectedOffer,
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
    uncertain,
    exactRetryAvailable,
    mutationBlocked,
    canBegin,
    offersForSection,
    offerForRow,
    loadProjection,
    chooseActor,
    openOffer,
    chooseTarget,
    chooseOption,
    closeDecision,
    submit,
    retryExact,
    refresh,
  }
}
