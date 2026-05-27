import { ref, type Ref } from 'vue'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
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

export interface DocumentMapTokenActionResponse {
  ok: true
  path: string
  map: TabletopMap
  placement: SheetPlacement
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
}

export interface UseDocumentMapTokenActionsReturn {
  status: Ref<DocumentMapTokenActionStatus>
  lastError: Ref<string | null>
  clearError: () => void
  moveToken: (payload: {
    placementId: string
    position: GridAnchor
    pathLength?: number | null
  }) => Promise<DocumentMapTokenActionDispatchResult>
  turnToken: (payload: {
    placementId: string
    facing: TokenFacingDirection
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

  const runAction = async (
    request: string,
    body: Record<string, unknown>,
  ): Promise<DocumentMapTokenActionDispatchResult> => {
    status.value = 'saving'
    lastError.value = null
    try {
      const response = await postJson<DocumentMapTokenActionResponse>(request, {
        slug: options.slug,
        clientId: getClientId(),
        ...profileBody(),
        ...body,
      })
      options.applyPersistedMap?.(response.map)
      status.value = 'idle'
      return { dispatched: true, response }
    } catch (error) {
      const message = getErrorMessage(error, { fallback: 'Token action failed' })
      status.value = 'error'
      lastError.value = message
      return { dispatched: false, message }
    }
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

  return {
    status,
    lastError,
    clearError,
    moveToken,
    turnToken,
  }
}
