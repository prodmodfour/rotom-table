import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../../utils/auth'
import { expectSlug, expectString, readObjectBody } from '../../../utils/http'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { useMapTokenAbilityUseCase } from '../../../useCases/applyMapTokenTableAction'
import { normalizeRealtimeClientId } from '#shared/realtime'

interface UseAbilityBody {
  slug?: unknown
  placementId?: unknown
  abilityName?: unknown
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
  const body = await readObjectBody<UseAbilityBody>(event)
  const slug = expectSlug(body.slug)
  const placementId = expectString(body.placementId, 'placementId', { maxLength: 120 })
  const abilityName = expectString(body.abilityName, 'abilityName', { maxLength: 120 })
  const targetPlacementId = optionalPlacementId(body.targetPlacementId)

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(body.profileId)
      : null
    const result = useMapTokenAbilityUseCase({
      role,
      slug,
      placementId,
      abilityName,
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
