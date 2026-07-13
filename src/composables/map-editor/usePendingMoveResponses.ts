import {
  computed,
  getCurrentScope,
  onMounted,
  onScopeDispose,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue'
import { isAuthRole, type AuthRole } from '#shared/auth'
import {
  createLivePlayOpId,
  type LivePlayCommandResult,
} from '#shared/livePlayCommands'
import { validateTerminalLivePlayCommandResponse } from '#shared/livePlayCommandResults'
import {
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  parseMoveResponseCommand,
  type MoveResponseCommand,
  type MoveResponseCommandType,
} from '#shared/moveAutomation/responseCommands'
import {
  parsePendingMoveResponseWindowList,
  type PendingMoveResponseWindowView,
} from '#shared/moveAutomation/responseViews'
import { isPlayerProfileId, type PlayerProfileId } from '#shared/playerProfiles'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import {
  getLivePlayCommandOutbox,
  isMoveResponseCommandOutboxEntry,
  type LivePlayCommandOutbox,
  type LivePlayCommandOutboxAuthContext,
  type MoveResponseCommandOutboxEntry,
} from '~/utils/livePlayCommandOutbox'
import type { TabletopMap } from '~/types/map'
import { useApiClient } from '~/composables/useApiClient'

interface ReadonlyValueRef<TValue> {
  readonly value: TValue
}

export type PendingMoveResponseLoadStatus = 'idle' | 'loading' | 'error'
export type PendingMoveResponseSendStatus = 'pending' | 'sending' | 'uncertain'

export interface PendingMoveResponseWindowState {
  readonly status: PendingMoveResponseSendStatus
  readonly opId?: string
  readonly message?: string
}

export interface PendingMoveResponseReference {
  readonly resolutionId: string
  readonly windowId: string
}

export interface PendingMoveResponseOptionReference extends PendingMoveResponseReference {
  readonly optionId: string
}

export interface PendingMoveResponseDispatchResult {
  readonly dispatched: boolean
  readonly opId?: string
  readonly accepted?: boolean
  readonly uncertain?: boolean
  readonly message?: string
}

export interface PendingMoveResponseSheetUpdate {
  readonly kind: 'pokemon' | 'trainer'
  readonly slug: string
  readonly path?: string
  readonly sheet: Record<string, unknown>
}

export interface UsePendingMoveResponsesOptions {
  readonly slug: string
  readonly authRole: ReadonlyValueRef<AuthRole | null | undefined>
  readonly playerProfileId?: ReadonlyValueRef<PlayerProfileId | null | undefined>
  readonly mapRevision: ReadonlyValueRef<number | null | undefined>
  readonly enabled?: ReadonlyValueRef<boolean>
  readonly applyPersistedMap?: (map: TabletopMap) => void
  readonly applySheetUpdate?: (update: PendingMoveResponseSheetUpdate) => void
  readonly onTerminalResult?: (result: LivePlayCommandResult) => void
  readonly outbox?: LivePlayCommandOutbox
  readonly leaseOwner?: string
  readonly autoLoad?: boolean
}

export interface UsePendingMoveResponsesReturn {
  readonly windows: Ref<readonly PendingMoveResponseWindowView[]>
  readonly loadStatus: Ref<PendingMoveResponseLoadStatus>
  readonly loadError: Ref<string | null>
  readonly responseStateByWindow: ComputedRef<Readonly<Record<string, PendingMoveResponseWindowState>>>
  readonly responseOutboxEntries: Ref<readonly MoveResponseCommandOutboxEntry[]>
  readonly refresh: () => Promise<readonly PendingMoveResponseWindowView[]>
  readonly choose: (input: PendingMoveResponseOptionReference) => Promise<PendingMoveResponseDispatchResult>
  readonly pass: (input: PendingMoveResponseReference) => Promise<PendingMoveResponseDispatchResult>
  readonly forcePass: (input: PendingMoveResponseReference) => Promise<PendingMoveResponseDispatchResult>
  readonly cancel: (resolutionId: string) => Promise<PendingMoveResponseDispatchResult>
  readonly retry: (opId: string) => Promise<PendingMoveResponseDispatchResult>
}

type MoveResponseRouteEnvelope = {
  readonly result: LivePlayCommandResult
  readonly map?: TabletopMap
  readonly sheetUpdates?: readonly PendingMoveResponseSheetUpdate[]
}

const MOVE_RESPONSE_REQUEST_PATHS: Record<MoveResponseCommandType, string> = {
  [MOVE_RESPONSE_COMMAND_TYPES.CHOOSE]: MAP_API_PATHS.chooseMoveResponse,
  [MOVE_RESPONSE_COMMAND_TYPES.REACT]: MAP_API_PATHS.reactMoveResponse,
  [MOVE_RESPONSE_COMMAND_TYPES.PASS]: MAP_API_PATHS.passMoveResponse,
  [MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL]: MAP_API_PATHS.cancelMoveResolution,
  [MOVE_RESPONSE_COMMAND_TYPES.GM_FORCE_RESOLVE]: MAP_API_PATHS.forceResolveMoveResolution,
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

export const pendingMoveResponseWindowKey = (
  input: PendingMoveResponseReference,
): string => `${input.resolutionId}:${input.windowId}`

const commandWindowKey = (command: MoveResponseCommand): string | null => (
  'windowId' in command.payload
    ? pendingMoveResponseWindowKey({
        resolutionId: command.payload.resolutionId,
        windowId: command.payload.windowId,
      })
    : null
)

const commandResolutionId = (command: MoveResponseCommand): string => command.payload.resolutionId

const acceptedTerminalResult = (result: LivePlayCommandResult): boolean => {
  if (!result.ok) return false
  if ('duplicate' in result && result.duplicate === true) return result.original.ok
  return true
}

const terminalResultMessage = (result: LivePlayCommandResult): string | undefined => {
  if (!result.ok) return result.message
  if ('duplicate' in result && result.duplicate === true && !result.original.ok) {
    return result.original.message
  }
  return undefined
}

const routeEnvelope = (
  value: unknown,
  command: MoveResponseCommand,
): MoveResponseRouteEnvelope => {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'result')) {
    throw new Error('Move response did not contain a terminal result envelope.')
  }
  const validation = validateTerminalLivePlayCommandResponse(value.result)
  if (!validation.valid) {
    throw new Error(validation.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '))
  }
  if (validation.response.opId !== command.opId) {
    throw new Error('Move response operation ID did not match the journaled command.')
  }
  const resultMapSlug = validation.response.ok && 'duplicate' in validation.response
    ? validation.response.original.mapSlug
    : validation.response.mapSlug
  if (resultMapSlug !== command.mapSlug) {
    throw new Error('Move response map did not match the journaled command.')
  }

  const sheetUpdates = Array.isArray(value.sheetUpdates)
    ? value.sheetUpdates as unknown as readonly PendingMoveResponseSheetUpdate[]
    : undefined
  return {
    result: validation.response,
    ...(isRecord(value.map) ? { map: value.map as unknown as TabletopMap } : {}),
    ...(sheetUpdates === undefined ? {} : { sheetUpdates }),
  }
}

const responseEntryCommand = (entry: MoveResponseCommandOutboxEntry): MoveResponseCommand => (
  parseMoveResponseCommand(entry.body)
)

const responseEntryMatchesContext = (
  entry: MoveResponseCommandOutboxEntry,
  slug: string,
  authContext: LivePlayCommandOutboxAuthContext,
): boolean => (
  entry.mapSlug === slug
  && entry.authContext.role === authContext.role
  && (entry.authContext.profileId ?? null) === (authContext.profileId ?? null)
)

const responseLeaseOwner = (): string => `move-response:${getClientId()}`

export const usePendingMoveResponses = (
  options: UsePendingMoveResponsesOptions,
): UsePendingMoveResponsesReturn => {
  const api = useApiClient()
  const outbox = options.outbox ?? getLivePlayCommandOutbox()
  const leaseOwner = options.leaseOwner ?? responseLeaseOwner()
  const windows = ref<readonly PendingMoveResponseWindowView[]>([])
  const loadStatus = ref<PendingMoveResponseLoadStatus>('idle')
  const loadError = ref<string | null>(null)
  const responseOutboxEntries = ref<readonly MoveResponseCommandOutboxEntry[]>([])
  const processedTerminalOpIds = new Set<string>()
  const activeDispatches = new Map<string, Promise<PendingMoveResponseDispatchResult>>()
  let refreshSequence = 0
  let mounted = false

  const enabled = (): boolean => options.enabled?.value !== false

  const currentAuthContext = (): LivePlayCommandOutboxAuthContext | null => {
    const role = options.authRole.value
    if (!isAuthRole(role)) return null
    if (role === 'gm') return { role: 'gm', profileId: null }
    const profileId = options.playerProfileId?.value
    return isPlayerProfileId(profileId) ? { role: 'player', profileId } : null
  }

  const currentBaseRevision = (): number => {
    const revision = options.mapRevision.value
    return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0
      ? revision
      : 0
  }

  const listResponseOutboxEntries = async (
    authContext: LivePlayCommandOutboxAuthContext,
  ): Promise<readonly MoveResponseCommandOutboxEntry[]> => {
    const entries = await outbox.list({ mapSlug: options.slug, authContext })
    return entries.filter((entry): entry is MoveResponseCommandOutboxEntry => (
      isMoveResponseCommandOutboxEntry(entry)
      && responseEntryMatchesContext(entry, options.slug, authContext)
    ))
  }

  const refreshOutboxEntries = async (): Promise<void> => {
    const authContext = currentAuthContext()
    responseOutboxEntries.value = authContext
      ? await listResponseOutboxEntries(authContext)
      : []
  }

  const refresh: UsePendingMoveResponsesReturn['refresh'] = async () => {
    const sequence = ++refreshSequence
    const authContext = currentAuthContext()
    if (!enabled() || !authContext) {
      windows.value = []
      responseOutboxEntries.value = []
      loadStatus.value = 'idle'
      loadError.value = null
      return windows.value
    }

    loadStatus.value = 'loading'
    loadError.value = null
    try {
      const profileId = authContext.role === 'player' ? authContext.profileId : undefined
      const [rawList, entries] = await Promise.all([
        api.getJson<unknown>(MAP_API_PATHS.pendingMoveResponses, {
          params: {
            slug: options.slug,
            ...(profileId ? { profileId } : {}),
          },
        }),
        listResponseOutboxEntries(authContext),
      ])
      const parsed = parsePendingMoveResponseWindowList(rawList)
      if (parsed.mapSlug !== options.slug) throw new Error('Pending move responses belong to another map.')
      if (sequence !== refreshSequence) return windows.value
      windows.value = parsed.windows
      responseOutboxEntries.value = entries
      loadStatus.value = 'idle'
      loadError.value = null
      return windows.value
    }
    catch (error) {
      if (sequence !== refreshSequence) return windows.value
      loadStatus.value = 'error'
      loadError.value = getErrorMessage(error, { fallback: 'Pending move responses could not be loaded.' })
      return windows.value
    }
  }

  const responseStateByWindow = computed<Readonly<Record<string, PendingMoveResponseWindowState>>>(() => {
    const states: Record<string, PendingMoveResponseWindowState> = {}
    for (const view of windows.value) {
      states[pendingMoveResponseWindowKey({
        resolutionId: view.resolution.resolutionId,
        windowId: view.window.windowId,
      })] = { status: 'pending' }
    }

    for (const entry of responseOutboxEntries.value) {
      let command: MoveResponseCommand
      try {
        command = responseEntryCommand(entry)
      }
      catch {
        continue
      }
      const state: PendingMoveResponseWindowState = {
        status: entry.state === 'uncertain' ? 'uncertain' : 'sending',
        opId: entry.opId,
        ...(entry.lastError ? { message: entry.lastError } : {}),
      }
      const key = commandWindowKey(command)
      if (key) states[key] = state
      else {
        for (const view of windows.value) {
          if (view.resolution.resolutionId === commandResolutionId(command)) {
            states[pendingMoveResponseWindowKey({
              resolutionId: view.resolution.resolutionId,
              windowId: view.window.windowId,
            })] = state
          }
        }
      }
    }
    return Object.freeze(states)
  })

  const windowFor = (input: PendingMoveResponseReference): PendingMoveResponseWindowView | null => (
    windows.value.find(view => (
      view.resolution.resolutionId === input.resolutionId
      && view.window.windowId === input.windowId
    )) ?? null
  )

  const existingEntryFor = (
    resolutionId: string,
    windowId?: string,
  ): MoveResponseCommandOutboxEntry | null => {
    for (const entry of responseOutboxEntries.value) {
      try {
        const command = responseEntryCommand(entry)
        if (commandResolutionId(command) !== resolutionId) continue
        if (windowId === undefined || commandWindowKey(command) === pendingMoveResponseWindowKey({ resolutionId, windowId })) {
          return entry
        }
      }
      catch {
        // The outbox parser already rejects malformed records; ignore a stale detached snapshot.
      }
    }
    return null
  }

  const localFailure = (message: string, opId?: string): PendingMoveResponseDispatchResult => ({
    dispatched: false,
    ...(opId ? { opId } : {}),
    message,
  })

  const applyTerminalEnvelopeOnce = (
    envelope: MoveResponseRouteEnvelope,
    opId: string,
  ): void => {
    if (processedTerminalOpIds.has(opId)) return
    processedTerminalOpIds.add(opId)
    if (envelope.map) options.applyPersistedMap?.(envelope.map)
    for (const update of envelope.sheetUpdates ?? []) options.applySheetUpdate?.(update)
    options.onTerminalResult?.(envelope.result)
  }

  const markUncertain = async (
    entry: MoveResponseCommandOutboxEntry,
    message: string,
  ): Promise<PendingMoveResponseDispatchResult> => {
    try {
      await outbox.markUncertain({ opId: entry.opId, leaseOwner, error: message })
      await refreshOutboxEntries()
    }
    catch (error) {
      const storageMessage = getErrorMessage(error, { fallback: 'Durable response state could not be updated.' })
      return {
        dispatched: false,
        opId: entry.opId,
        uncertain: true,
        message: `${message} ${storageMessage}`,
      }
    }
    return { dispatched: false, opId: entry.opId, uncertain: true, message }
  }

  const dispatchClaimedEntry = async (
    entry: MoveResponseCommandOutboxEntry,
  ): Promise<PendingMoveResponseDispatchResult> => {
    let command: MoveResponseCommand
    try {
      command = responseEntryCommand(entry)
    }
    catch (error) {
      return localFailure(getErrorMessage(error, { fallback: 'Stored move response is invalid.' }), entry.opId)
    }

    let rawResponse: unknown
    try {
      rawResponse = await api.postJson<unknown>(entry.requestPath, entry.body)
    }
    catch (error) {
      return markUncertain(
        entry,
        `The move response outcome is uncertain. Retrying will reuse the exact response operation. ${getErrorMessage(error, { fallback: 'The HTTP request failed.' })}`,
      )
    }

    let envelope: MoveResponseRouteEnvelope
    try {
      envelope = routeEnvelope(rawResponse, command)
    }
    catch (error) {
      return markUncertain(
        entry,
        `The move response outcome is uncertain because the server response was invalid. ${getErrorMessage(error, { fallback: 'Invalid terminal response.' })}`,
      )
    }

    let acknowledgementWarning: string | undefined
    try {
      await outbox.acknowledgeTerminal(entry.opId)
    }
    catch (error) {
      acknowledgementWarning = getErrorMessage(error, {
        fallback: 'The terminal response was accepted but its local journal entry could not be removed.',
      })
    }

    applyTerminalEnvelopeOnce(envelope, entry.opId)
    await refresh()
    const accepted = acceptedTerminalResult(envelope.result)
    const message = [terminalResultMessage(envelope.result), acknowledgementWarning]
      .filter((part): part is string => Boolean(part))
      .join(' ') || undefined
    return {
      dispatched: accepted,
      accepted,
      opId: entry.opId,
      ...(message ? { message } : {}),
    }
  }

  const dispatchEntry = (
    entry: MoveResponseCommandOutboxEntry,
  ): Promise<PendingMoveResponseDispatchResult> => {
    const active = activeDispatches.get(entry.opId)
    if (active) return active

    const dispatch = (async (): Promise<PendingMoveResponseDispatchResult> => {
      let claim
      try {
        claim = await outbox.claimForSend({ opId: entry.opId, leaseOwner })
      }
      catch (error) {
        await refreshOutboxEntries().catch(() => undefined)
        return localFailure(getErrorMessage(error, { fallback: 'The response journal could not be claimed for sending.' }), entry.opId)
      }
      await refreshOutboxEntries().catch(() => undefined)
      if (!claim.claimed) {
        return localFailure(
          claim.reason === 'missing'
            ? 'The pending move response disappeared before it could be sent.'
            : 'Another tab is already sending this move response.',
          entry.opId,
        )
      }
      if (!isMoveResponseCommandOutboxEntry(claim.entry)) {
        return localFailure('The claimed journal entry is not a move response command.', entry.opId)
      }
      return dispatchClaimedEntry(claim.entry)
    })().finally(() => {
      activeDispatches.delete(entry.opId)
    })
    activeDispatches.set(entry.opId, dispatch)
    return dispatch
  }

  const enqueueAndDispatch = async (
    command: MoveResponseCommand,
  ): Promise<PendingMoveResponseDispatchResult> => {
    const authContext = currentAuthContext()
    if (!enabled() || !authContext) {
      return localFailure('A current GM or selected player profile is required to answer this move response.')
    }
    let entry
    try {
      entry = await outbox.enqueue({
        requestPath: MOVE_RESPONSE_REQUEST_PATHS[command.type],
        body: command as unknown as Record<string, unknown>,
        authContext,
      })
    }
    catch (error) {
      return localFailure(
        `The move response was not sent because it could not be journaled first. ${getErrorMessage(error, { fallback: 'Durable storage failed.' })}`,
        command.opId,
      )
    }
    await refreshOutboxEntries().catch(() => undefined)
    if (!isMoveResponseCommandOutboxEntry(entry)) {
      return localFailure('The response journal did not preserve a move response command.', command.opId)
    }
    return dispatchEntry(entry)
  }

  const buildCommand = (
    type: MoveResponseCommandType,
    payload: MoveResponseCommand['payload'],
  ): MoveResponseCommand => {
    const authContext = currentAuthContext()
    return parseMoveResponseCommand({
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: createLivePlayOpId(),
      mapSlug: options.slug,
      baseRevision: currentBaseRevision(),
      ...(authContext?.role === 'player' && authContext.profileId
        ? { profileId: authContext.profileId }
        : {}),
      type,
      payload,
    }, type)
  }

  const choose: UsePendingMoveResponsesReturn['choose'] = async (input) => {
    const view = windowFor(input)
    if (!view) return localFailure('This move response window is no longer available.')
    if (!view.window.options.some(option => option.id === input.optionId)) {
      return localFailure('This move response option is no longer available.')
    }
    const existing = existingEntryFor(input.resolutionId, input.windowId)
    if (existing) return localFailure('This move response is already pending confirmation.', existing.opId)
    const type = view.window.kind === 'reaction'
      ? MOVE_RESPONSE_COMMAND_TYPES.REACT
      : MOVE_RESPONSE_COMMAND_TYPES.CHOOSE
    return enqueueAndDispatch(buildCommand(type, {
      resolutionId: input.resolutionId,
      windowId: input.windowId,
      optionId: input.optionId,
    }))
  }

  const pass: UsePendingMoveResponsesReturn['pass'] = async (input) => {
    const view = windowFor(input)
    if (!view || !view.window.allowPass) return localFailure('This move response window does not allow pass.')
    const existing = existingEntryFor(input.resolutionId, input.windowId)
    if (existing) return localFailure('This move response is already pending confirmation.', existing.opId)
    return enqueueAndDispatch(buildCommand(MOVE_RESPONSE_COMMAND_TYPES.PASS, input))
  }

  const forcePass: UsePendingMoveResponsesReturn['forcePass'] = async (input) => {
    if (options.authRole.value !== 'gm') return localFailure('Only a GM can force-pass a move response window.')
    if (!windowFor(input)) return localFailure('This move response window is no longer available.')
    const existing = existingEntryFor(input.resolutionId, input.windowId)
    if (existing) return localFailure('This move response is already pending confirmation.', existing.opId)
    return enqueueAndDispatch(buildCommand(MOVE_RESPONSE_COMMAND_TYPES.GM_FORCE_RESOLVE, input))
  }

  const cancel: UsePendingMoveResponsesReturn['cancel'] = async (resolutionId) => {
    if (options.authRole.value !== 'gm') return localFailure('Only a GM can cancel a pending move resolution.')
    if (!windows.value.some(view => view.resolution.resolutionId === resolutionId)) {
      return localFailure('This pending move resolution is no longer available.')
    }
    const existing = existingEntryFor(resolutionId)
    if (existing) return localFailure('This move resolution already has a response pending confirmation.', existing.opId)
    return enqueueAndDispatch(buildCommand(MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL, { resolutionId }))
  }

  const retry: UsePendingMoveResponsesReturn['retry'] = async (opId) => {
    const authContext = currentAuthContext()
    if (!authContext) return localFailure('A current GM or selected player profile is required to retry this response.', opId)
    let entry
    try {
      entry = await outbox.get(opId)
    }
    catch (error) {
      return localFailure(getErrorMessage(error, { fallback: 'The stored move response could not be loaded.' }), opId)
    }
    if (!entry || !isMoveResponseCommandOutboxEntry(entry)) {
      return localFailure('The stored move response is no longer available.', opId)
    }
    if (!responseEntryMatchesContext(entry, options.slug, authContext)) {
      return localFailure('The stored move response belongs to another map or participant.', opId)
    }
    if (entry.state === 'sending') return localFailure('This move response is already being sent.', opId)
    return dispatchEntry(entry)
  }

  if (getCurrentScope()) {
    onMounted(() => {
      mounted = true
      if (options.autoLoad !== false) void refresh()
    })
    watch(
      () => [
        options.authRole.value,
        options.playerProfileId?.value ?? null,
        options.mapRevision.value ?? null,
        options.enabled?.value ?? true,
      ] as const,
      () => {
        if (mounted && options.autoLoad !== false) void refresh()
      },
    )
    onScopeDispose(() => {
      mounted = false
      refreshSequence += 1
    })
  }

  return {
    windows,
    loadStatus,
    loadError,
    responseStateByWindow,
    responseOutboxEntries,
    refresh,
    choose,
    pass,
    forcePass,
    cancel,
    retry,
  }
}
