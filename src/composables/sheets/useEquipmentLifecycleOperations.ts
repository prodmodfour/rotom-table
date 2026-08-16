import { computed, onMounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  parseEquipmentOperationCommand,
  type EquipmentActivityReasonCommandV1,
} from '#shared/itemAutomation/equipmentOperations'
import type { SheetEquipmentStateV1 } from '#shared/itemAutomation/equipment'
import type { SaveStatus } from '~/composables/useEditableSheet'
import { useApiClient } from '~/composables/useApiClient'
import { EQUIPMENT_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { createEquipmentOperationId } from '~/utils/equipmentOperationClient'
import { getErrorMessage } from '~/utils/errorMessages'
import {
  clearPendingEquipmentLifecycleOperation,
  loadPendingEquipmentLifecycleOperation,
  retainPendingEquipmentLifecycleOperation,
  type EquipmentLifecycleOperationCommand,
} from '~/utils/equipmentLifecycleOperationStorage'
import {
  parseEquipmentOperationResponse,
  type TrainerEquipmentAcceptedResult,
  type TrainerEquipmentLifecycleChange,
  type TrainerEquipmentOperationStatus,
} from './useTrainerEquipmentOperations'

interface EquipmentLifecycleSheet {
  readonly slug: string
  readonly revision?: number
  readonly equipmentState?: SheetEquipmentStateV1
}

export interface UseEquipmentLifecycleOperationsOptions {
  readonly sheet: MaybeRefOrGetter<EquipmentLifecycleSheet>
  readonly saveStatus: MaybeRefOrGetter<SaveStatus>
  readonly canAdjudicate: MaybeRefOrGetter<boolean>
  readonly prepareForAction?: () => Promise<void>
  readonly onAccepted?: (response: TrainerEquipmentAcceptedResult) => Promise<void> | void
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

export const useEquipmentLifecycleOperations = (options: UseEquipmentLifecycleOperationsOptions) => {
  const { postJson } = useApiClient()
  const sheet = computed(() => toValue(options.sheet))
  const saveStatus = computed(() => toValue(options.saveStatus))
  const canAdjudicate = computed(() => toValue(options.canAdjudicate))
  const status = ref<TrainerEquipmentOperationStatus>('idle')
  const message = ref<string | null>(null)
  const lastCommand = ref<EquipmentLifecycleOperationCommand | null>(null)
  const busy = computed(() => status.value === 'submitting')
  const canBegin = computed(() => canAdjudicate.value
    && cleanSaveBoundary(saveStatus.value) && !busy.value && status.value !== 'uncertain')

  const owner = () => {
    const state = sheet.value.equipmentState
    if (!state || state.owner.slug !== sheet.value.slug) {
      throw new Error('Refresh the authoritative sheet before adjudicating equipment.')
    }
    return state.owner
  }

  const execute = async (command: EquipmentLifecycleOperationCommand): Promise<void> => {
    const target = owner()
    lastCommand.value = command
    retainPendingEquipmentLifecycleOperation({
      schemaVersion: 1,
      ownerKind: target.kind,
      ownerSlug: target.slug,
      command,
    })
    status.value = 'submitting'
    message.value = 'Applying equipment lifecycle change…'
    try {
      const response = parseEquipmentOperationResponse(await postJson(EQUIPMENT_API_PATHS.operations, {
        command,
        clientId: getClientId(),
      }), command)
      clearPendingEquipmentLifecycleOperation(target.kind, target.slug, command.operationId)
      lastCommand.value = null
      status.value = 'accepted'
      message.value = response.result.exactReplay
        ? 'Already accepted; no equipment change was applied twice.'
        : `${response.result.canonicalItemId} lifecycle updated.`
      await options.onAccepted?.(response)
    }
    catch (error) {
      const code = statusCode(error)
      message.value = getErrorMessage(error)
      if (code === 409 || (code !== null && code >= 400 && code < 500)) {
        clearPendingEquipmentLifecycleOperation(target.kind, target.slug, command.operationId)
        lastCommand.value = null
        status.value = code === 409 ? 'conflict' : 'error'
      }
      else {
        status.value = 'uncertain'
        message.value = 'The equipment result is uncertain. Retry the exact same command before adjudicating it again.'
      }
    }
  }

  const adjudicate = async (change: TrainerEquipmentLifecycleChange): Promise<void> => {
    if (!canBegin.value) return
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
      const note = change.note.trim()
      const durabilityChange = change.commandKind === 'damage' || change.commandKind === 'restore-durability'
      const reason: EquipmentActivityReasonCommandV1 | null = change.reason ?? (change.commandKind === 'suppress'
        ? { code: 'equipment.suppression.guided', sourceId: operationId }
        : change.commandKind === 'deactivate'
          ? { code: 'equipment.inactive.guided', sourceId: operationId }
          : change.commandKind === 'break'
            ? { code: 'equipment.breakage.narrative', sourceId: operationId }
            : null)
      if (!note) throw new Error('Add a concise evidence note before applying this lifecycle change.')
      if (durabilityChange && (!Number.isSafeInteger(change.amount) || Number(change.amount) <= 0)) {
        throw new Error('Enter a positive whole-number durability amount.')
      }
      if (!durabilityChange && !reason) throw new Error('Choose the exact durable reason to restore or repair.')
      const source = {
        kind: 'equipment' as const,
        ownerKind: authority.owner.kind,
        ownerSlug: authority.owner.slug,
        instanceId: change.instanceId,
        expectedSheetRevision: revision,
        expectedEquipmentRevision: authority.revision,
        expectedInstanceRevision: instance.revision,
      }
      const command = parseEquipmentOperationCommand(durabilityChange ? {
        schemaVersion: 1,
        operationId,
        commandKind: change.commandKind,
        actorProfileId: null,
        source,
        amount: change.amount,
        guidance: { kind: 'guided-adjudication', note },
      } : {
        schemaVersion: 1,
        operationId,
        commandKind: change.commandKind,
        actorProfileId: null,
        source,
        reason,
        guidance: { kind: 'guided-adjudication', note },
      }) as EquipmentLifecycleOperationCommand
      await execute(command)
    }
    catch (error) {
      status.value = 'error'
      message.value = getErrorMessage(error)
    }
  }

  const retryExact = async (): Promise<void> => {
    const target = owner()
    const stored = loadPendingEquipmentLifecycleOperation(target.kind, target.slug)
    const command = lastCommand.value ?? stored?.command ?? null
    if (!command) {
      status.value = 'uncertain'
      message.value = 'The exact equipment lifecycle command is unavailable. Refresh before continuing.'
      return
    }
    await execute(command)
  }
  const dismiss = (): void => {
    if (status.value === 'uncertain') return
    status.value = 'idle'
    message.value = null
  }
  const restorePending = (): void => {
    if (!sheet.value.equipmentState) return
    const target = owner()
    const pending = loadPendingEquipmentLifecycleOperation(target.kind, target.slug)
    if (!pending) return
    lastCommand.value = pending.command
    status.value = 'uncertain'
    message.value = 'A previous equipment lifecycle command may have reached the server. Retry that exact command before continuing.'
  }

  watch(() => [sheet.value.equipmentState?.owner.kind, sheet.value.slug] as const, restorePending)
  onMounted(restorePending)

  return { status, message, busy, canBegin, adjudicate, retryExact, dismiss }
}
