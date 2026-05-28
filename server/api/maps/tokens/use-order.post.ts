import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../../utils/auth'
import { expectSlug, expectString, readObjectBody } from '../../../utils/http'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { useMapTokenOrderUseCase } from '../../../useCases/applyMapTokenTableAction'
import { normalizeRealtimeClientId } from '#shared/realtime'

interface UseOrderBody {
  slug?: unknown
  placementId?: unknown
  orderName?: unknown
  targetPlacementId?: unknown
  clientId?: unknown
  profileId?: unknown
}

const optionalPlacementId = (value: unknown): string | undefined => {
  const text = expectString(value, 'targetPlacementId', { required: false, maxLength: 120 })
  return text || undefined
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  const body = await readObjectBody<UseOrderBody>(event)
  const slug = expectSlug(body.slug)
  const placementId = expectString(body.placementId, 'placementId', { maxLength: 120 })
  const orderName = expectString(body.orderName, 'orderName', { maxLength: 120 })
  const targetPlacementId = optionalPlacementId(body.targetPlacementId)

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(body.profileId)
      : null
    const result = useMapTokenOrderUseCase({
      role,
      slug,
      placementId,
      orderName,
      ...(targetPlacementId ? { targetPlacementId } : {}),
      clientId: normalizeRealtimeClientId(body.clientId),
      playerProfile,
    })
    publishUseCaseRealtimeEvents(result.events)
    return {
      ok: result.ok,
      path: result.path,
      map: result.map,
      action: result.action,
      sheetUpdates: result.sheetUpdates,
    }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
