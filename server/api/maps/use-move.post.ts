import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../utils/auth'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { expectSlug, expectString, readObjectBody } from '../../utils/http'
import { resolvePlayerProfileForPolicy } from '../../policies/playerProfilePolicy'
import { recordMoveUsageUseCase } from '../../useCases/recordMoveUsage'
import { normalizeRealtimeClientId } from '#shared/realtime'

interface UseMoveBody {
  slug?: unknown
  placementId?: unknown
  moveName?: unknown
  clientId?: unknown
  profileId?: unknown
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  const body = await readObjectBody<UseMoveBody>(event)
  const slug = expectSlug(body.slug)
  const placementId = expectString(body.placementId, 'placementId', { maxLength: 120 })
  const moveName = expectString(body.moveName, 'moveName', { maxLength: 120 })

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(body.profileId)
      : null
    const result = recordMoveUsageUseCase({
      role,
      slug,
      placementId,
      moveName,
      clientId: normalizeRealtimeClientId(body.clientId),
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
