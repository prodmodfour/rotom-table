import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../../utils/auth'
import { badRequest, expectSlug, expectString, readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { turnMapTokenUseCase } from '../../../useCases/applyMapTokenAction'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { isTokenFacingDirection } from '~/utils/tokenFacing'
import type { TokenFacingDirection } from '~/types/tokenFacing'

interface TurnTokenBody {
  slug?: unknown
  placementId?: unknown
  facing?: unknown
  clientId?: unknown
  profileId?: unknown
}

const expectTokenFacingDirection = (value: unknown): TokenFacingDirection => {
  if (isTokenFacingDirection(value)) return value
  return badRequest('facing must be a token facing direction')
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<TurnTokenBody>(event)
  const slug = expectSlug(body.slug)
  const placementId = expectString(body.placementId, 'placementId', { maxLength: 120 })
  const facing = expectTokenFacingDirection(body.facing)

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(body.profileId)
      : null
    const result = turnMapTokenUseCase({
      role,
      slug,
      placementId,
      facing,
      clientId: normalizeRealtimeClientId(body.clientId),
      playerProfile,
    })
    publishUseCaseRealtimeEvents(result.events)
    return {
      ok: result.ok,
      path: result.path,
      map: result.map,
      placement: result.placement,
    }
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
