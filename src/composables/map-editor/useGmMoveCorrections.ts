import { ref, type Ref } from 'vue'
import {
  createLivePlayOpId,
  type LivePlayCommandAccepted,
  type LivePlayCommandRejected,
  type LivePlayCommandResult,
} from '#shared/livePlayCommands'
import { validateTerminalLivePlayCommandResponse } from '#shared/livePlayCommandResults'
import {
  GM_MOVE_CORRECTION_COMMAND_TYPE,
  MOVE_CORRECTION_COMMAND_SCHEMA_VERSION,
  parseGmMoveCorrectionCommand,
} from '#shared/moveAutomation/correctionCommands'
import {
  parseGmMoveCorrectionDetails,
  type GmMoveCorrectionDetails,
} from '#shared/moveAutomation/correctionViews'
import { useApiClient } from '~/composables/useApiClient'
import type { TabletopMap } from '~/types/map'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'

interface ReadonlyValueRef<Value> {
  readonly value: Value
}

export type GmMoveCorrectionPanelStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'pending'
  | 'accepted'
  | 'conflicted'
  | 'error'

export interface GmMoveCorrectionSheetUpdate {
  readonly kind: 'pokemon' | 'trainer'
  readonly slug: string
  readonly sheet: Record<string, unknown>
}

export interface UseGmMoveCorrectionsOptions {
  readonly slug: string
  readonly enabled: ReadonlyValueRef<boolean>
  readonly mapRevision: ReadonlyValueRef<number | null | undefined>
  readonly applyPersistedMap?: (map: TabletopMap) => void
  readonly applySheetUpdate?: (update: GmMoveCorrectionSheetUpdate) => void
  readonly createOperationId?: () => string
}

export interface UseGmMoveCorrectionsReturn {
  readonly originOperationId: Ref<string | null>
  readonly details: Ref<GmMoveCorrectionDetails | null>
  readonly status: Ref<GmMoveCorrectionPanelStatus>
  readonly message: Ref<string | null>
  readonly open: (originOperationId: string) => Promise<GmMoveCorrectionDetails | null>
  readonly refresh: () => Promise<GmMoveCorrectionDetails | null>
  readonly apply: (operationIds: readonly string[]) => Promise<LivePlayCommandResult | null>
  readonly close: () => void
}

type CorrectionRouteResponse = Record<string, unknown> & {
  readonly map?: unknown
  readonly sheetUpdates?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const currentRevision = (value: unknown): number | null => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
)

const sheetUpdatesFromResponse = (value: unknown): readonly GmMoveCorrectionSheetUpdate[] => {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Move correction sheet updates must be an array.')
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Move correction sheet update ${index} is invalid.`)
    if (item.kind !== 'pokemon' && item.kind !== 'trainer') {
      throw new Error(`Move correction sheet update ${index} has an invalid kind.`)
    }
    if (typeof item.slug !== 'string' || !isRecord(item.sheet)) {
      throw new Error(`Move correction sheet update ${index} is incomplete.`)
    }
    return { kind: item.kind, slug: item.slug, sheet: item.sheet }
  })
}

const canonicalTerminal = (
  result: LivePlayCommandResult,
): LivePlayCommandAccepted | LivePlayCommandRejected => {
  if (result.ok && 'duplicate' in result && result.duplicate === true) return result.original
  return result as LivePlayCommandAccepted | LivePlayCommandRejected
}

export const useGmMoveCorrections = (
  options: UseGmMoveCorrectionsOptions,
): UseGmMoveCorrectionsReturn => {
  const api = useApiClient()
  const originOperationId = ref<string | null>(null)
  const details = ref<GmMoveCorrectionDetails | null>(null)
  const status = ref<GmMoveCorrectionPanelStatus>('idle')
  const message = ref<string | null>(null)
  let requestSequence = 0

  const fetchDetails = async (operationId: string): Promise<GmMoveCorrectionDetails> => {
    const raw = await api.getJson<unknown>(MAP_API_PATHS.moveCorrectionDetails, {
      params: { slug: options.slug, originOperationId: operationId },
    })
    const parsed = parseGmMoveCorrectionDetails(raw)
    if (parsed.mapSlug !== options.slug || parsed.originOperationId !== operationId) {
      throw new Error('Move correction details belong to another operation.')
    }
    return parsed
  }

  const open: UseGmMoveCorrectionsReturn['open'] = async (operationId) => {
    const sequence = ++requestSequence
    originOperationId.value = operationId
    details.value = null
    status.value = 'loading'
    message.value = null
    if (!options.enabled.value) {
      status.value = 'error'
      message.value = 'Only a GM can inspect move correction details.'
      return null
    }
    try {
      const loaded = await fetchDetails(operationId)
      if (sequence !== requestSequence || originOperationId.value !== operationId) return null
      details.value = loaded
      status.value = 'ready'
      return loaded
    }
    catch (error) {
      if (sequence !== requestSequence) return null
      status.value = 'error'
      message.value = getErrorMessage(error, {
        fallback: 'Move correction details could not be loaded.',
      })
      return null
    }
  }

  const refresh: UseGmMoveCorrectionsReturn['refresh'] = async () => {
    const operationId = originOperationId.value
    if (!operationId) return null
    return open(operationId)
  }

  const apply: UseGmMoveCorrectionsReturn['apply'] = async (operationIds) => {
    const source = details.value
    if (!options.enabled.value || !source || source.originOperationId !== originOperationId.value) {
      status.value = 'error'
      message.value = 'Load an accepted move before applying a correction.'
      return null
    }
    if (status.value === 'pending') return null

    const alreadyCorrectedOperationIds = new Set(
      source.corrections
        .filter(correction => correction.status === 'accepted')
        .flatMap(correction => correction.operationIds),
    )
    const offeredOperationIds = new Set(
      source.operations
        .filter(operation => (
          operation.availability === 'available'
          && !alreadyCorrectedOperationIds.has(operation.operationId)
        ))
        .map(operation => operation.operationId),
    )
    const uniqueOperationIds = [...new Set(operationIds)]
    if (
      uniqueOperationIds.length === 0
      || uniqueOperationIds.length !== operationIds.length
      || uniqueOperationIds.some(operationId => !offeredOperationIds.has(operationId))
    ) {
      status.value = 'error'
      message.value = 'Select one or more currently offered safe compensation operations.'
      return null
    }

    const baseRevision = currentRevision(options.mapRevision.value)
    if (baseRevision === null) {
      status.value = 'error'
      message.value = 'The authoritative map revision is unavailable.'
      return null
    }

    const command = parseGmMoveCorrectionCommand({
      schemaVersion: MOVE_CORRECTION_COMMAND_SCHEMA_VERSION,
      opId: (options.createOperationId ?? createLivePlayOpId)(),
      mapSlug: options.slug,
      baseRevision,
      type: GM_MOVE_CORRECTION_COMMAND_TYPE,
      payload: {
        originOperationId: source.originOperationId,
        operationIds: uniqueOperationIds,
      },
    })
    status.value = 'pending'
    message.value = null

    let raw: unknown
    try {
      raw = await api.postJson<unknown>(MAP_API_PATHS.applyMoveCorrection, {
        ...command,
        clientId: getClientId(),
      })
    }
    catch (error) {
      status.value = 'error'
      message.value = getErrorMessage(error, {
        fallback: 'The move correction request failed before a terminal result was received.',
      })
      return null
    }

    const validation = validateTerminalLivePlayCommandResponse(raw)
    if (!validation.valid) {
      status.value = 'error'
      message.value = `Move correction returned an invalid terminal result: ${validation.issues.map(issue => issue.message).join('; ')}`
      return null
    }
    const terminal = canonicalTerminal(validation.response)
    if (terminal.opId !== command.opId || terminal.mapSlug !== command.mapSlug) {
      status.value = 'error'
      message.value = 'Move correction returned a terminal result for another operation.'
      return null
    }

    if (terminal.ok) {
      const envelope = raw as CorrectionRouteResponse
      try {
        if (!isRecord(envelope.map)) {
          throw new Error('Accepted move correction omitted its authoritative map.')
        }
        options.applyPersistedMap?.(envelope.map as unknown as TabletopMap)
        for (const update of sheetUpdatesFromResponse(envelope.sheetUpdates)) {
          options.applySheetUpdate?.(update)
        }
      }
      catch (error) {
        status.value = 'error'
        message.value = getErrorMessage(error, {
          fallback: 'The accepted correction could not be adopted locally.',
        })
        return validation.response
      }
      status.value = 'accepted'
      message.value = 'Correction accepted. The original move remains linked to this audit entry.'
    }
    else {
      status.value = 'conflicted'
      message.value = terminal.message
    }

    try {
      const refreshed = await fetchDetails(source.originOperationId)
      if (originOperationId.value === source.originOperationId) details.value = refreshed
    }
    catch (error) {
      const refreshMessage = getErrorMessage(error, {
        fallback: 'Correction history could not be refreshed.',
      })
      message.value = message.value ? `${message.value} ${refreshMessage}` : refreshMessage
    }
    return validation.response
  }

  const close = (): void => {
    requestSequence += 1
    originOperationId.value = null
    details.value = null
    status.value = 'idle'
    message.value = null
  }

  return {
    originOperationId,
    details,
    status,
    message,
    open,
    refresh,
    apply,
    close,
  }
}
