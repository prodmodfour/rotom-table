import { ref, type Ref } from 'vue'
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

export interface DocumentMapTokenActionDispatchResult {
  dispatched: boolean
  message?: string
  response?: DocumentMapTokenActionResponse
}

export interface UseDocumentMapTokenActionsOptions {
  slug: string
  playerProfileId?: ReadonlyValueRef<PlayerProfileId | null | undefined>
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

  const spawnToken: UseDocumentMapTokenActionsReturn['spawnToken'] = (payload) => {
    const body = { placement: payload.placement }
    if (payload.unloadFallback) sendActionWithUnloadFallback(MAP_API_PATHS.spawnToken, body)
    return runAction(MAP_API_PATHS.spawnToken, body)
  }

  const moveToken: UseDocumentMapTokenActionsReturn['moveToken'] = (payload) => runAction(
    MAP_API_PATHS.moveToken,
    {
      placementId: payload.placementId,
      position: payload.position,
      ...(payload.pathLength === undefined || payload.pathLength === null ? {} : { pathLength: payload.pathLength }),
    },
  )

  const turnToken: UseDocumentMapTokenActionsReturn['turnToken'] = (payload) => runAction(
    MAP_API_PATHS.turnToken,
    {
      placementId: payload.placementId,
      facing: payload.facing,
    },
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
