import { ref, type Ref } from 'vue'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  createLivePlayOpId,
  type LivePlayCommandDuplicate,
  type LivePlayCommandResult,
  type LivePlayTokenScope,
  type MoveTokenPayload,
  type TurnTokenPayload,
} from '#shared/livePlayCommands'
import { normalizeRevision } from '#shared/sessionRevisions'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { sendJsonWithUnloadFallback } from '~/utils/autosaveUnload'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import { useApiClient } from '~/composables/useApiClient'
import type { PlayerProfileId } from '#shared/playerProfiles'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import type { TokenFacingDirection } from '~/types/tokenFacing'

interface ReadonlyValueRef<TValue> {
  readonly value: TValue
}

export type DocumentMapTokenActionStatus = 'idle' | 'saving' | 'error'

export interface DocumentMapTokenActionSheetUpdate {
  kind: 'pokemon' | 'trainer'
  slug: string
  path: string
  sheet: Record<string, unknown>
}

export interface DocumentMapTokenActionResponse {
  ok: true
  path: string
  map: TabletopMap
  placement?: SheetPlacement
  action?: {
    type: 'maneuver' | 'ability' | 'order'
    placementId: string
    targetPlacementId?: string
    name: string
    category?: string
  }
  sheetUpdates?: DocumentMapTokenActionSheetUpdate[]
}

export type LivePlayMapTokenActionResponse = LivePlayCommandResult & {
  path?: string
  map?: TabletopMap
  placement?: SheetPlacement
}

export interface DocumentMapTokenActionDispatchResult {
  dispatched: boolean
  message?: string
  response?: DocumentMapTokenActionResponse | LivePlayMapTokenActionResponse
}

export interface UseDocumentMapTokenActionsOptions {
  slug: string
  playerProfileId?: ReadonlyValueRef<PlayerProfileId | null | undefined>
  mapRevision?: ReadonlyValueRef<number | null | undefined>
  livePlayCommandBlocked?: ReadonlyValueRef<boolean>
  livePlayCommandBlockedMessage?: ReadonlyValueRef<string | null | undefined>
  applyPersistedMap?: (map: TabletopMap) => void
  applySheetUpdate?: (update: DocumentMapTokenActionSheetUpdate) => void
}

export interface UseDocumentMapTokenActionsReturn {
  status: Ref<DocumentMapTokenActionStatus>
  lastError: Ref<string | null>
  clearError: () => void
  spawnToken: (payload: {
    placement: SheetPlacement
    unloadFallback?: boolean
  }) => Promise<DocumentMapTokenActionDispatchResult>
  moveToken: (payload: {
    placementId: string
    position: GridAnchor
    pathLength?: number | null
  }) => Promise<DocumentMapTokenActionDispatchResult>
  turnToken: (payload: {
    placementId: string
    facing: TokenFacingDirection
  }) => Promise<DocumentMapTokenActionDispatchResult>
  useManeuver: (payload: {
    placementId: string
    maneuverName: string
    targetPlacementId?: string
  }) => Promise<DocumentMapTokenActionDispatchResult>
  useAbility: (payload: {
    placementId: string
    abilityName: string
    targetPlacementId?: string
  }) => Promise<DocumentMapTokenActionDispatchResult>
  useOrder: (payload: {
    placementId: string
    orderName: string
    targetPlacementId?: string
  }) => Promise<DocumentMapTokenActionDispatchResult>
}

type TokenCommandType = typeof LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN | typeof LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN

type TokenCommandPayload = MoveTokenPayload | TurnTokenPayload

const isDuplicateResult = (response: LivePlayMapTokenActionResponse): response is LivePlayCommandDuplicate & LivePlayMapTokenActionResponse => (
  response.ok === true && 'duplicate' in response && response.duplicate === true
)

const livePlayResponseMessage = (response: LivePlayMapTokenActionResponse): string | null => {
  if (!response.ok) return response.message
  if (isDuplicateResult(response) && !response.original.ok) return response.original.message
  return null
}

const acceptedLivePlayResponse = (response: LivePlayMapTokenActionResponse): boolean => {
  if (!response.ok) return false
  return !isDuplicateResult(response) || response.original.ok
}

export const useDocumentMapTokenActions = (
  options: UseDocumentMapTokenActionsOptions,
): UseDocumentMapTokenActionsReturn => {
  const { postJson } = useApiClient()
  const status = ref<DocumentMapTokenActionStatus>('idle')
  const lastError = ref<string | null>(null)

  const clearError = () => {
    if (status.value === 'error') status.value = 'idle'
    lastError.value = null
  }

  const profileBody = (): { profileId?: PlayerProfileId } => {
    const profileId = options.playerProfileId?.value ?? null
    return profileId ? { profileId } : {}
  }

  const actionBody = (body: Record<string, unknown>): Record<string, unknown> => ({
    slug: options.slug,
    clientId: getClientId(),
    ...profileBody(),
    ...body,
  })

  const tokenScope = (payload: TokenCommandPayload, field: LivePlayTokenScope['field']): LivePlayTokenScope => ({
    kind: 'token',
    placementId: payload.placementId,
    field,
  })

  const commandBody = (
    type: TokenCommandType,
    payload: TokenCommandPayload,
    field: LivePlayTokenScope['field'],
  ): Record<string, unknown> => ({
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId: createLivePlayOpId(),
    mapSlug: options.slug,
    baseRevision: normalizeRevision(options.mapRevision?.value),
    type,
    scopes: [tokenScope(payload, field)],
    payload,
    clientId: getClientId(),
    ...profileBody(),
  })

  const sendActionWithUnloadFallback = (
    request: string,
    body: Record<string, unknown>,
  ): boolean => {
    try {
      sendJsonWithUnloadFallback(request, JSON.stringify(actionBody(body)))
      return true
    } catch (error) {
      const message = getErrorMessage(error, { fallback: 'Token action failed' })
      status.value = 'error'
      lastError.value = message
      return false
    }
  }

  const runAction = async (
    request: string,
    body: Record<string, unknown>,
  ): Promise<DocumentMapTokenActionDispatchResult> => {
    status.value = 'saving'
    lastError.value = null
    try {
      const response = await postJson<DocumentMapTokenActionResponse>(request, actionBody(body))
      options.applyPersistedMap?.(response.map)
      for (const update of response.sheetUpdates ?? []) options.applySheetUpdate?.(update)
      status.value = 'idle'
      return { dispatched: true, response }
    } catch (error) {
      const message = getErrorMessage(error, { fallback: 'Token action failed' })
      status.value = 'error'
      lastError.value = message
      return { dispatched: false, message }
    }
  }

  const runLivePlayTokenCommand = async (
    request: string,
    body: Record<string, unknown>,
  ): Promise<DocumentMapTokenActionDispatchResult> => {
    if (options.livePlayCommandBlocked?.value) {
      const message = options.livePlayCommandBlockedMessage?.value
        ?? 'Live-play commands are paused until realtime reconciliation completes'
      status.value = 'error'
      lastError.value = message
      return { dispatched: false, message }
    }

    status.value = 'saving'
    lastError.value = null
    try {
      const response = await postJson<LivePlayMapTokenActionResponse>(request, body)
      if (!acceptedLivePlayResponse(response)) {
        const message = livePlayResponseMessage(response) ?? 'Token action was rejected'
        status.value = 'error'
        lastError.value = message
        return { dispatched: false, message, response }
      }

      if (response.map) options.applyPersistedMap?.(response.map)
      status.value = 'idle'
      return { dispatched: true, response }
    } catch (error) {
      const message = getErrorMessage(error, { fallback: 'Token action failed' })
      status.value = 'error'
      lastError.value = message
      return { dispatched: false, message }
    }
  }

  const spawnToken: UseDocumentMapTokenActionsReturn['spawnToken'] = (payload) => {
    const body = { placement: payload.placement }
    if (payload.unloadFallback) sendActionWithUnloadFallback(MAP_API_PATHS.spawnToken, body)
    return runAction(MAP_API_PATHS.spawnToken, body)
  }

  const moveToken: UseDocumentMapTokenActionsReturn['moveToken'] = (payload) => runLivePlayTokenCommand(
    MAP_API_PATHS.moveToken,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      {
        placementId: payload.placementId,
        position: payload.position,
        ...(payload.pathLength === undefined || payload.pathLength === null ? {} : { pathLength: payload.pathLength }),
      },
      'position',
    ),
  )

  const turnToken: UseDocumentMapTokenActionsReturn['turnToken'] = (payload) => runLivePlayTokenCommand(
    MAP_API_PATHS.turnToken,
    commandBody(
      LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
      {
        placementId: payload.placementId,
        facing: payload.facing,
      },
      'facing',
    ),
  )

  const useManeuver: UseDocumentMapTokenActionsReturn['useManeuver'] = (payload) => runAction(
    MAP_API_PATHS.useManeuver,
    {
      placementId: payload.placementId,
      maneuverName: payload.maneuverName,
      ...(payload.targetPlacementId ? { targetPlacementId: payload.targetPlacementId } : {}),
    },
  )

  const useAbility: UseDocumentMapTokenActionsReturn['useAbility'] = (payload) => runAction(
    MAP_API_PATHS.useAbility,
    {
      placementId: payload.placementId,
      abilityName: payload.abilityName,
      ...(payload.targetPlacementId ? { targetPlacementId: payload.targetPlacementId } : {}),
    },
  )

  const useOrder: UseDocumentMapTokenActionsReturn['useOrder'] = (payload) => runAction(
    MAP_API_PATHS.useOrder,
    {
      placementId: payload.placementId,
      orderName: payload.orderName,
      ...(payload.targetPlacementId ? { targetPlacementId: payload.targetPlacementId } : {}),
    },
  )

  return {
    status,
    lastError,
    clearError,
    spawnToken,
    moveToken,
    turnToken,
    useManeuver,
    useAbility,
    useOrder,
  }
}
