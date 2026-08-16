import { computed, onMounted, onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  parseEquipmentOperationCommand,
  parseEquipmentOperationResult,
  type EquipmentActivityReasonCommandV1,
  type EquipmentOperationCommandV1,
  type EquipmentOperationResultV1,
} from '#shared/itemAutomation/equipmentOperations'
import type { SheetKind } from '#shared/sheets'
import type { SheetItemActionOfferV1 } from '#shared/itemAutomation/sheetActions'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { SaveStatus } from '~/composables/useEditableSheet'
import { useApiClient } from '~/composables/useApiClient'
import { EQUIPMENT_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import { createEquipmentOperationId, trainerEquipmentSlotOption } from '~/utils/equipmentOperationClient'
import {
  clearPendingEquipmentOperation,
  isPendingEquipmentStorageEvent,
  loadPendingEquipmentOperation,
  retainPendingEquipmentOperation,
} from '~/utils/equipmentOperationStorage'
import { InventoryRecoveryConflictError } from '~/utils/inventoryRecoveryStorage'
import { useInventoryRecoveryConnectivity } from '~/composables/inventory/useInventoryRecoveryConnectivity'
import { itemInventoryInstanceId } from '#shared/itemAutomation/inventory'

export type TrainerEquipmentOperationStatus = 'idle' | 'submitting' | 'accepted' | 'conflict' | 'uncertain' | 'error'

export interface AcceptedEquipmentSheetDocument {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
  readonly updatedAt: number
  readonly sheet: Record<string, unknown>
}

export interface TrainerEquipmentAcceptedResult {
  readonly result: EquipmentOperationResultV1
  readonly sheets: readonly AcceptedEquipmentSheetDocument[]
}

export interface UseTrainerEquipmentOperationsOptions {
  readonly sheet: MaybeRefOrGetter<TrainerSheet>
  readonly saveStatus: MaybeRefOrGetter<SaveStatus>
  readonly profileId: MaybeRefOrGetter<string | null>
  readonly canAdjudicateLifecycle?: MaybeRefOrGetter<boolean>
  readonly prepareForAction?: () => Promise<void>
  readonly reconcileAuthority?: () => Promise<void>
  readonly onAccepted?: (response: TrainerEquipmentAcceptedResult) => Promise<void> | void
}

export interface TrainerEquipmentLifecycleChange {
  readonly instanceId: string
  readonly commandKind: 'suppress' | 'deactivate' | 'break' | 'restore' | 'repair' | 'damage' | 'restore-durability'
  readonly amount?: number
  readonly reason?: EquipmentActivityReasonCommandV1
  readonly note: string
}

const cleanSaveBoundary = (status: SaveStatus): boolean => status === 'idle' || status === 'saved'
const statusCode = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') return null
  const input = error as Record<string, unknown>
  for (const value of [input.statusCode, input.status, (input.response as Record<string, unknown> | undefined)?.status]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}
export const parseEquipmentOperationResponse = (value: unknown, command: EquipmentOperationCommandV1): TrainerEquipmentAcceptedResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Equipment operation returned an invalid response.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['result', 'sheets', 'groupInventories'].includes(key))
    || !Array.isArray(input.sheets) || !Array.isArray(input.groupInventories)) {
    throw new Error('Equipment operation returned incomplete resource authority.')
  }
  const result = parseEquipmentOperationResult(input.result)
  if (result.operationId !== command.operationId || result.commandKind !== command.commandKind) {
    throw new Error('Equipment operation result does not match the submitted exact command.')
  }
  const sheets = input.sheets.map((entry, index): AcceptedEquipmentSheetDocument => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Equipment sheet ${index + 1} is invalid.`)
    const row = entry as Record<string, unknown>
    if (Object.keys(row).some(key => !['kind', 'slug', 'revision', 'updatedAt', 'sheet'].includes(key))
      || (row.kind !== 'trainer' && row.kind !== 'pokemon')
      || typeof row.slug !== 'string' || !row.slug
      || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0
      || !Number.isSafeInteger(row.updatedAt) || Number(row.updatedAt) < 0
      || !row.sheet || typeof row.sheet !== 'object' || Array.isArray(row.sheet)) {
      throw new Error(`Equipment sheet ${index + 1} has invalid authority.`)
    }
    const document = row.sheet as Record<string, unknown>
    if (document.slug !== undefined && document.slug !== row.slug) throw new Error(`Equipment sheet ${index + 1} changed identity.`)
    if (document.revision !== undefined && document.revision !== row.revision) throw new Error(`Equipment sheet ${index + 1} changed revision.`)
    return Object.freeze({
      kind: row.kind as SheetKind,
      slug: row.slug,
      revision: Number(row.revision),
      updatedAt: Number(row.updatedAt),
      sheet: Object.freeze({ ...document }),
    })
  })
  return Object.freeze({ result, sheets: Object.freeze(sheets) })
}

export const useTrainerEquipmentOperations = (options: UseTrainerEquipmentOperationsOptions) => {
  const { postJson } = useApiClient()
  const status = ref<TrainerEquipmentOperationStatus>('idle')
  const message = ref<string | null>(null)
  const lastCommand = ref<EquipmentOperationCommandV1 | null>(null)
  const reconciling = ref(false)
  const { online } = useInventoryRecoveryConnectivity()
  const sheet = computed(() => toValue(options.sheet))
  const saveStatus = computed(() => toValue(options.saveStatus))
  const profileId = computed(() => toValue(options.profileId))
  const canAdjudicateLifecycle = computed(() => options.canAdjudicateLifecycle === undefined
    ? false
    : toValue(options.canAdjudicateLifecycle))
  const busy = computed(() => status.value === 'submitting' || reconciling.value)
  const exactRetryAvailable = computed(() => lastCommand.value !== null)
  const canBegin = computed(() => cleanSaveBoundary(saveStatus.value) && !busy.value && status.value === 'idle')

  const execute = async (command: EquipmentOperationCommandV1): Promise<void> => {
    lastCommand.value = command
    status.value = 'submitting'
    message.value = command.commandKind === 'unequip'
      ? 'Returning whole item…'
      : command.commandKind === 'equip'
        ? 'Equipping whole item…'
        : 'Applying equipment lifecycle change…'
    try {
      retainPendingEquipmentOperation({
        schemaVersion: 1,
        trainerSlug: sheet.value.slug,
        profileId: profileId.value,
        command,
      })
      const response = parseEquipmentOperationResponse(await postJson(EQUIPMENT_API_PATHS.operations, {
        command,
        profileId: profileId.value,
        clientId: getClientId(),
      }), command)
      clearPendingEquipmentOperation(sheet.value.slug, command.operationId)
      lastCommand.value = null
      status.value = 'accepted'
      message.value = response.result.exactReplay
        ? command.commandKind === 'equip' || command.commandKind === 'unequip'
          ? 'Already accepted; no item moved twice.'
          : 'Already accepted; no equipment change was applied twice.'
        : command.commandKind === 'unequip'
          ? `${response.result.canonicalItemId} returned to inventory.`
          : command.commandKind === 'equip'
            ? `${response.result.canonicalItemId} equipped.`
            : `${response.result.canonicalItemId} lifecycle updated.`
      await options.onAccepted?.(response)
    }
    catch (error) {
      const code = statusCode(error)
      message.value = getErrorMessage(error)
      if (error instanceof InventoryRecoveryConflictError) {
        lastCommand.value = null
        status.value = 'conflict'
      }
      else if (code === 409 || (code !== null && code >= 400 && code < 500)) {
        clearPendingEquipmentOperation(sheet.value.slug, command.operationId)
        lastCommand.value = null
        status.value = code === 409 ? 'conflict' : 'error'
      }
      else {
        status.value = 'uncertain'
        message.value = online.value
          ? 'The equipment result is uncertain. Retry the exact same command; do not move this item again.'
          : 'The connection was lost. This exact equipment command is retained until you reconnect and choose retry.'
      }
    }
  }

  const equipRow = async (offer: SheetItemActionOfferV1): Promise<void> => {
    if (!canBegin.value) return
    try {
      await options.prepareForAction?.()
      const current = sheet.value
      const revision = Number(current.revision ?? 0)
      const canonicalItemId = offer.source.canonicalId
      const row = current.inventory?.[offer.source.section]?.[offer.source.rowIndex]
      const authority = current.equipmentState ?? current.equipmentProjection
      const slotIds = canonicalItemId ? trainerEquipmentSlotOption({ canonicalItemId, authority }) : null
      if (!Number.isSafeInteger(revision) || revision < 0 || !canonicalItemId || !row?.id?.trim() || !slotIds) {
        throw new Error('Refresh the sheet and choose a currently compatible unconfigured equipment slot.')
      }
      const equipmentRevision = authority?.revision
      if (!Number.isSafeInteger(equipmentRevision) || Number(equipmentRevision) < 0) throw new Error('Current equipment revision is unavailable.')
      const command = parseEquipmentOperationCommand({
        schemaVersion: 1,
        operationId: createEquipmentOperationId(),
        commandKind: 'equip',
        actorProfileId: profileId.value,
        source: {
          kind: 'inventory', containerKind: 'trainer', containerSlug: current.slug,
          section: offer.source.section, rowId: row.id,
          sourceInstanceId: itemInventoryInstanceId({
            containerKind: 'trainer', containerSlug: current.slug,
            section: offer.source.section, rowId: row.id,
          }),
          expectedRevision: revision,
        },
        destination: {
          kind: 'equipment', ownerKind: 'trainer', ownerSlug: current.slug,
          slotIds, expectedSheetRevision: revision, expectedEquipmentRevision: equipmentRevision,
        },
        replacedInstanceId: null,
        swapReturnDestination: null,
        configuration: null,
      })
      await execute(command)
    }
    catch (error) {
      status.value = 'error'
      message.value = getErrorMessage(error)
    }
  }

  const unequip = async (instanceId: string): Promise<void> => {
    if (!canBegin.value) return
    try {
      await options.prepareForAction?.()
      const current = sheet.value
      const revision = Number(current.revision ?? 0)
      const authority = current.equipmentState ?? current.equipmentProjection
      const instance = authority?.instances.find(candidate => candidate.instanceId === instanceId)
      if (!instance || !Number.isSafeInteger(revision) || revision < 0 || !authority) {
        throw new Error('Refresh the sheet before returning this equipment item.')
      }
      const command = parseEquipmentOperationCommand({
        schemaVersion: 1,
        operationId: createEquipmentOperationId(),
        commandKind: 'unequip',
        actorProfileId: profileId.value,
        source: {
          kind: 'equipment', ownerKind: 'trainer', ownerSlug: current.slug,
          instanceId, expectedSheetRevision: revision,
          expectedEquipmentRevision: authority.revision,
          expectedInstanceRevision: instance.revision,
        },
        destination: {
          kind: 'inventory', containerKind: 'trainer', containerSlug: current.slug,
          section: 'equipment', expectedRevision: revision,
        },
        replacedInstanceId: null,
        swapReturnDestination: null,
        configuration: null,
      })
      await execute(command)
    }
    catch (error) {
      status.value = 'error'
      message.value = getErrorMessage(error)
    }
  }

  const adjudicateLifecycle = async (change: TrainerEquipmentLifecycleChange): Promise<void> => {
    if (!canBegin.value || !canAdjudicateLifecycle.value) return
    try {
      await options.prepareForAction?.()
      const current = sheet.value
      const revision = Number(current.revision ?? 0)
      const authority = current.equipmentState
      const instance = authority?.instances.find(candidate => candidate.instanceId === change.instanceId)
      if (!instance || !Number.isSafeInteger(revision) || revision < 0 || !authority) {
        throw new Error('Refresh the authoritative sheet before adjudicating this equipment item.')
      }
      const operationId = createEquipmentOperationId()
      const guidance = { kind: 'guided-adjudication' as const, note: change.note.trim() }
      const source = {
        kind: 'equipment' as const,
        ownerKind: 'trainer' as const,
        ownerSlug: current.slug,
        instanceId: change.instanceId,
        expectedSheetRevision: revision,
        expectedEquipmentRevision: authority.revision,
        expectedInstanceRevision: instance.revision,
      }
      const durabilityChange = change.commandKind === 'damage' || change.commandKind === 'restore-durability'
      const reason = change.reason ?? (change.commandKind === 'suppress'
        ? { code: 'equipment.suppression.guided', sourceId: operationId }
        : change.commandKind === 'deactivate'
          ? { code: 'equipment.inactive.guided', sourceId: operationId }
          : change.commandKind === 'break'
            ? { code: 'equipment.breakage.narrative', sourceId: operationId }
            : null)
      if (!guidance.note) throw new Error('Add a concise evidence note before applying this lifecycle change.')
      if (durabilityChange && (!Number.isSafeInteger(change.amount) || Number(change.amount) <= 0)) {
        throw new Error('Enter a positive whole-number durability amount.')
      }
      if (!durabilityChange && !reason) {
        throw new Error('Choose the exact durable reason to restore or repair.')
      }
      const command = parseEquipmentOperationCommand(durabilityChange ? {
        schemaVersion: 1,
        operationId,
        commandKind: change.commandKind,
        actorProfileId: profileId.value,
        source,
        amount: change.amount,
        guidance,
      } : {
        schemaVersion: 1,
        operationId,
        commandKind: change.commandKind,
        actorProfileId: profileId.value,
        source,
        reason,
        guidance,
      })
      await execute(command)
    }
    catch (error) {
      status.value = 'error'
      message.value = getErrorMessage(error)
    }
  }

  const retryExact = async (): Promise<void> => {
    if (busy.value) return
    if (!online.value) {
      status.value = 'uncertain'
      message.value = 'The connection is offline. This exact equipment command remains retained; retry is available after reconnection.'
      return
    }
    const stored = loadPendingEquipmentOperation(sheet.value.slug)
    const command = lastCommand.value ?? (stored?.profileId === profileId.value ? stored.command : null)
    if (!command || command.actorProfileId !== profileId.value) {
      status.value = 'uncertain'
      message.value = 'Select the same player profile that began this equipment command, then retry it exactly.'
      return
    }
    await execute(command)
  }
  const dismiss = (): void => {
    if (status.value === 'uncertain' || status.value === 'conflict' || status.value === 'error') return
    status.value = 'idle'
    message.value = null
  }
  const reconcile = async (): Promise<void> => {
    if (busy.value || status.value === 'uncertain') return
    reconciling.value = true
    message.value = 'Reloading authoritative equipment and inventory custody…'
    try {
      await options.reconcileAuthority?.()
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
  }
  const restorePending = (fromAnotherTab = false): void => {
    const pending = loadPendingEquipmentOperation(sheet.value.slug)
    if (!pending) {
      if (fromAnotherTab && status.value === 'uncertain') {
        lastCommand.value = null
        status.value = 'conflict'
        message.value = 'This retained equipment command was resolved in another tab. Reload authoritative inventory before continuing.'
      }
      return
    }
    lastCommand.value = pending.profileId === profileId.value ? pending.command : null
    status.value = 'uncertain'
    message.value = pending.profileId === profileId.value
      ? 'A previous equipment command may have reached the server. Retry that exact command before moving another item.'
      : 'A previous equipment command belongs to another player profile. Select that profile before retrying it exactly.'
  }
  const handleStorage = (event: StorageEvent): void => {
    if (isPendingEquipmentStorageEvent(event, sheet.value.slug)) restorePending(true)
  }

  watch(
    () => [sheet.value.slug, profileId.value] as const,
    ([nextSlug, nextProfile], previous) => {
      if (previous?.[0] === nextSlug && previous[1] === nextProfile) return
      restorePending()
    },
  )
  onMounted(() => {
    restorePending()
    window.addEventListener('storage', handleStorage)
  })
  onUnmounted(() => window.removeEventListener('storage', handleStorage))

  return {
    status, message, busy, reconciling, online, exactRetryAvailable, canBegin, canAdjudicateLifecycle,
    equipRow, unequip, adjudicateLifecycle, retryExact, reconcile, dismiss,
  }
}
