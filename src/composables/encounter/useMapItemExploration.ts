import { computed, onMounted, onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  parseItemExplorationOperationResult,
  type ItemExplorationOperationCommandV1,
  type ItemExplorationOperationResultV1,
} from '#shared/itemAutomation/exploration'
import type { GridAnchor } from '~/types/map'
import { useApiClient } from '~/composables/useApiClient'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { isRealtimeEcho, mapChannel } from '#shared/realtime'
import { subscribeChannel, type RealtimeEvent } from '~/composables/useRealtime'
import { getErrorMessage } from '~/utils/errorMessages'
import {
  clearPendingItemExplorationOperation,
  createItemExplorationOperationId,
  loadPendingItemExplorationOperation,
  retainPendingItemExplorationOperation,
} from '~/utils/itemExplorationOperationStorage'

export interface DirectRepelPositioningProjectionV1 {
  readonly decisionId: string
  readonly itemLabel: string
  readonly sourcePlacementId: string
  readonly sourceLabel: string
  readonly sourcePosition: Readonly<GridAnchor>
  readonly targetPlacementId: string
  readonly targetLabel: string
  readonly targetPosition: Readonly<GridAnchor>
  readonly destinationBounds: Readonly<{
    x: readonly [number, number]
    y: readonly [number, number]
    z: readonly [number, number]
  }>
  readonly maximumAffectedWildLevel: number
  readonly prompt: string
}

export interface MapItemExplorationAuthorityV1 {
  readonly schemaVersion: 1
  readonly kind: 'map'
  readonly mapSlug: string
  readonly mapRevision: number
  readonly generatedAt: number
  readonly repelPositioning: readonly DirectRepelPositioningProjectionV1[]
}

export type MapItemExplorationStatus = 'idle' | 'loading' | 'submitting' | 'accepted' | 'conflict' | 'uncertain' | 'error'

export interface UseMapItemExplorationOptions {
  readonly mapSlug: MaybeRefOrGetter<string>
  readonly mapRevision: MaybeRefOrGetter<number>
  readonly enabled: MaybeRefOrGetter<boolean>
  readonly commandsBlocked?: MaybeRefOrGetter<boolean>
  readonly afterAccepted?: (result: ItemExplorationOperationResultV1) => void | Promise<void>
}

const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && Number(value) >= minimum
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const anchor = (value: unknown, bounds?: readonly (readonly [number, number])[]): value is GridAnchor => {
  if (!object(value) || Object.keys(value).length !== 3 || !['x', 'y', 'z'].every(field => Object.hasOwn(value, field))) return false
  const coordinates = [value.x, value.y, value.z]
  return coordinates.every((coordinate, index) => Number.isSafeInteger(coordinate)
    && (!bounds || (Number(coordinate) >= bounds[index]![0] && Number(coordinate) <= bounds[index]![1])))
}
const pair = (value: unknown): value is readonly [number, number] => Array.isArray(value) && value.length === 2
  && integer(value[0]) && integer(value[1]) && value[0] <= value[1]
const boundedText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 500

const parseAuthority = (value: unknown, expectedSlug: string): MapItemExplorationAuthorityV1 => {
  if (!object(value)) throw new Error('Direct Repel authority returned an invalid projection.')
  const fields = ['schemaVersion', 'kind', 'mapSlug', 'mapRevision', 'generatedAt', 'repelPositioning']
  if (Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))
    || value.schemaVersion !== 1 || value.kind !== 'map' || value.mapSlug !== expectedSlug
    || !integer(value.mapRevision) || !integer(value.generatedAt) || !Array.isArray(value.repelPositioning)
    || value.repelPositioning.length > 32) {
    throw new Error('Direct Repel authority has invalid map evidence.')
  }
  const seen = new Set<string>()
  const repelPositioning = value.repelPositioning.map((entry, index): DirectRepelPositioningProjectionV1 => {
    if (!object(entry)) throw new Error(`Direct Repel decision ${index + 1} is invalid.`)
    const entryFields = [
      'decisionId', 'itemLabel', 'sourcePlacementId', 'sourceLabel', 'sourcePosition',
      'targetPlacementId', 'targetLabel', 'targetPosition', 'destinationBounds',
      'maximumAffectedWildLevel', 'prompt',
    ]
    if (Object.keys(entry).length !== entryFields.length || entryFields.some(field => !Object.hasOwn(entry, field))
      || !boundedText(entry.decisionId) || seen.has(entry.decisionId)
      || !boundedText(entry.itemLabel) || !boundedText(entry.sourcePlacementId) || !boundedText(entry.sourceLabel)
      || !boundedText(entry.targetPlacementId) || !boundedText(entry.targetLabel) || !boundedText(entry.prompt)
      || !object(entry.destinationBounds) || Object.keys(entry.destinationBounds).length !== 3
      || !pair(entry.destinationBounds.x) || !pair(entry.destinationBounds.y) || !pair(entry.destinationBounds.z)
      || !anchor(entry.sourcePosition) || !anchor(entry.targetPosition)
      || ![15, 25, 35].includes(Number(entry.maximumAffectedWildLevel))) {
      throw new Error(`Direct Repel decision ${index + 1} has invalid bounded authority.`)
    }
    seen.add(entry.decisionId)
    return Object.freeze({
      decisionId: entry.decisionId,
      itemLabel: entry.itemLabel,
      sourcePlacementId: entry.sourcePlacementId,
      sourceLabel: entry.sourceLabel,
      sourcePosition: Object.freeze({ ...(entry.sourcePosition as GridAnchor) }),
      targetPlacementId: entry.targetPlacementId,
      targetLabel: entry.targetLabel,
      targetPosition: Object.freeze({ ...(entry.targetPosition as GridAnchor) }),
      destinationBounds: Object.freeze({
        x: Object.freeze([...entry.destinationBounds.x] as [number, number]),
        y: Object.freeze([...entry.destinationBounds.y] as [number, number]),
        z: Object.freeze([...entry.destinationBounds.z] as [number, number]),
      }),
      maximumAffectedWildLevel: Number(entry.maximumAffectedWildLevel),
      prompt: entry.prompt,
    })
  })
  return Object.freeze({
    schemaVersion: 1,
    kind: 'map',
    mapSlug: expectedSlug,
    mapRevision: Number(value.mapRevision),
    generatedAt: Number(value.generatedAt),
    repelPositioning: Object.freeze(repelPositioning),
  })
}

const statusCode = (error: unknown): number | null => {
  if (!object(error)) return null
  for (const candidate of [error.statusCode, error.status, object(error.response) ? error.response.status : null]) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
  }
  return null
}

export const useMapItemExploration = (options: UseMapItemExplorationOptions) => {
  const { getJson, postJson } = useApiClient()
  const authority = ref<MapItemExplorationAuthorityV1 | null>(null)
  const status = ref<MapItemExplorationStatus>('idle')
  const message = ref<string | null>(null)
  const lastCommand = ref<ItemExplorationOperationCommandV1 | null>(null)
  const mapSlug = computed(() => toValue(options.mapSlug))
  const mapRevision = computed(() => toValue(options.mapRevision))
  const enabled = computed(() => toValue(options.enabled))
  const commandsBlocked = computed(() => options.commandsBlocked ? toValue(options.commandsBlocked) : false)
  const scopeKey = computed(() => `map:${mapSlug.value}`)
  const busy = computed(() => status.value === 'loading' || status.value === 'submitting')
  const uncertain = computed(() => status.value === 'uncertain')
  const decisions = computed(() => authority.value?.repelPositioning ?? [])
  let sequence = 0
  let unsubscribe: (() => void) | null = null
  let subscribedSlug: string | null = null

  const reconcilePending = (): void => {
    const pending = loadPendingItemExplorationOperation(scopeKey.value)
    if (!pending || pending.profileId !== null || pending.command.kind !== 'settle-direct-repel') return
    lastCommand.value = pending.command
    status.value = 'uncertain'
    message.value = 'Direct Repel settlement is uncertain. Retry the exact same command before choosing another endpoint.'
  }

  const load = async (): Promise<void> => {
    if (!enabled.value || !mapSlug.value) {
      authority.value = null
      return
    }
    const loadId = ++sequence
    if (!uncertain.value) status.value = 'loading'
    try {
      const next = parseAuthority(await getJson<unknown>(ITEM_API_PATHS.exploration, {
        params: { mapSlug: mapSlug.value },
      }), mapSlug.value)
      if (loadId !== sequence) return
      authority.value = next
      if (!uncertain.value) {
        status.value = 'idle'
        message.value = null
      }
      reconcilePending()
    }
    catch (error) {
      if (loadId !== sequence || uncertain.value) return
      status.value = statusCode(error) === 409 ? 'conflict' : 'error'
      message.value = getErrorMessage(error)
    }
  }

  const executeExact = async (command: ItemExplorationOperationCommandV1): Promise<ItemExplorationOperationResultV1 | null> => {
    if (command.kind !== 'settle-direct-repel') return null
    status.value = 'submitting'
    lastCommand.value = command
    message.value = 'Validating the exact Shift endpoint and committing its next-Shift forfeiture…'
    try {
      const response = await postJson<unknown>(ITEM_API_PATHS.exploration, {
        command,
        clientId: getClientId(),
      })
      if (!object(response) || Object.keys(response).length !== 1 || !Object.hasOwn(response, 'result')) {
        throw new Error('Direct Repel settlement returned an invalid response.')
      }
      const result = parseItemExplorationOperationResult(response.result)
      if (result.operationId !== command.operationId || result.kind !== command.kind
        || result.mapSlug !== command.mapSlug) {
        throw new Error('Direct Repel result does not match its exact command.')
      }
      clearPendingItemExplorationOperation(scopeKey.value, command.operationId)
      lastCommand.value = null
      status.value = 'accepted'
      message.value = result.exactReplay
        ? 'The original direct Repel settlement was recovered without moving or forfeiting twice.'
        : result.message
      await options.afterAccepted?.(result)
      await load()
      status.value = 'accepted'
      message.value = result.exactReplay
        ? 'The original direct Repel settlement was recovered without moving or forfeiting twice.'
        : result.message
      return result
    }
    catch (error) {
      const code = statusCode(error)
      if (code !== null && code >= 400 && code < 500) {
        clearPendingItemExplorationOperation(scopeKey.value, command.operationId)
        lastCommand.value = null
        status.value = 'conflict'
        message.value = getErrorMessage(error)
      }
      else {
        status.value = 'uncertain'
        message.value = 'Direct Repel settlement is uncertain. Retry this exact command; do not choose another endpoint.'
      }
      return null
    }
  }

  const settle = async (decisionId: string, destination: GridAnchor): Promise<void> => {
    const current = authority.value
    if (!current || busy.value || uncertain.value || commandsBlocked.value
      || !current.repelPositioning.some(decision => decision.decisionId === decisionId)) return
    const command: ItemExplorationOperationCommandV1 = {
      schemaVersion: 1,
      operationId: createItemExplorationOperationId(),
      kind: 'settle-direct-repel',
      mapSlug: current.mapSlug,
      mapRevision: current.mapRevision,
      decisionId,
      destination: { ...destination },
    }
    retainPendingItemExplorationOperation({ schemaVersion: 1, scopeKey: scopeKey.value, profileId: null, command })
    await executeExact(command)
  }

  const retryExact = async (): Promise<void> => {
    if (busy.value) return
    const stored = loadPendingItemExplorationOperation(scopeKey.value)
    const command = lastCommand.value ?? stored?.command ?? null
    if (!command || command.kind !== 'settle-direct-repel') {
      status.value = 'conflict'
      message.value = 'No exact direct Repel command is available to retry. Refresh authority.'
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
    if (typeof window === 'undefined') return
    if (!enabled.value || !mapSlug.value) {
      unsubscribe?.()
      unsubscribe = null
      subscribedSlug = null
      return
    }
    if (subscribedSlug === mapSlug.value) return
    unsubscribe?.()
    subscribedSlug = mapSlug.value
    unsubscribe = subscribeChannel(mapChannel(mapSlug.value), (event: RealtimeEvent) => {
      if (isRealtimeEcho(event, getClientId())) return
      if (event.type === 'updated') void load()
    })
  }

  watch([mapSlug, mapRevision, enabled], () => {
    subscribe()
    void load()
  })
  onMounted(() => {
    subscribe()
    reconcilePending()
    void load()
  })
  onUnmounted(() => unsubscribe?.())

  return { authority, decisions, status, message, busy, uncertain, load, settle, retryExact, dismiss }
}
