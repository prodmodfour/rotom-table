import { defineEventHandler } from 'h3'
import { LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { requireAuthRole } from '../../utils/auth'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { expectSlug, expectString, readObjectBody, requireWritableCampaignMode } from '../../utils/http'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { recordMoveUsageUseCase } from '../../useCases/recordMoveUsage'
import {
  executeLivePlayUseMoveCommandUseCase,
  type LivePlayUseMoveCommandResponse,
} from '../../useCases/applyLivePlayUseMoveCommand'

interface LegacyUseMoveBody {
  slug?: unknown
  placementId?: unknown
  moveName?: unknown
  clientId?: unknown
  profileId?: unknown
}

type UseMoveBody = Record<string, unknown> & LegacyUseMoveBody

const bodyField = (body: UseMoveBody, key: string): unknown => body[key]

const looksLikeLivePlayCommand = (body: UseMoveBody): boolean => (
  body.schemaVersion !== undefined
  || body.opId !== undefined
  || body.mapSlug !== undefined
  || body.baseRevision !== undefined
  || body.type !== undefined
  || body.scopes !== undefined
  || body.payload !== undefined
)

const livePlayRouteResponse = (response: LivePlayUseMoveCommandResponse) => {
  if (!response.result.ok) return response.result
  return {
    ...response.result,
    ...(response.path === undefined ? {} : { path: response.path }),
    ...(response.map === undefined ? {} : { map: response.map }),
    ...(response.placement === undefined ? {} : { placement: response.placement }),
    ...(response.usage === undefined ? {} : { usage: response.usage }),
  }
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<UseMoveBody>(event)
  const clientId = normalizeRealtimeClientId(bodyField(body, 'clientId'))

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(bodyField(body, 'profileId'))
      : null

    if (looksLikeLivePlayCommand(body)) {
      const response = await executeLivePlayUseMoveCommandUseCase({
        role,
        command: body,
        clientId,
        playerProfile,
        expectedType: LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
      })
      return livePlayRouteResponse(response)
    }

    const slug = expectSlug(body.slug)
    const placementId = expectString(body.placementId, 'placementId', { maxLength: 120 })
    const moveName = expectString(body.moveName, 'moveName', { maxLength: 120 })
    const result = recordMoveUsageUseCase({
      role,
      slug,
      placementId,
      moveName,
      clientId,
      playerProfile,
    })
    publishUseCaseRealtimeEvents(result.events)
    return {
      ok: result.ok,
      usage: result.usage,
      map: result.map,
      mapPath: result.mapPath,
      sheet: result.sheet,
      sheetPath: result.sheetPath,
      sheetKind: result.sheetKind,
      sheetSlug: result.sheetSlug,
    }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
