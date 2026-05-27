import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../../utils/auth'
import { badRequest, expectRecord, expectSlug, expectString, readObjectBody } from '../../../utils/http'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { moveMapTokenUseCase } from '../../../useCases/applyMapTokenAction'
import { normalizeRealtimeClientId } from '#shared/realtime'
import type { GridAnchor } from '~/types/map'

interface MoveTokenBody {
  slug?: unknown
  placementId?: unknown
  position?: unknown
  pathLength?: unknown
  clientId?: unknown
  profileId?: unknown
}

const expectCoordinate = (value: unknown, label: string): number => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) badRequest(`${label} must be a finite number`)
  return numberValue
}

const expectGridAnchor = (value: unknown, label: string): GridAnchor => {
  const record = expectRecord(value, label)
  return {
    x: expectCoordinate(record.x, `${label}.x`),
    y: expectCoordinate(record.y, `${label}.y`),
    z: expectCoordinate(record.z, `${label}.z`),
  }
}

const optionalPathLength = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue < 0) badRequest('pathLength must be a non-negative finite number')
  return numberValue
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  const body = await readObjectBody<MoveTokenBody>(event)
  const slug = expectSlug(body.slug)
  const placementId = expectString(body.placementId, 'placementId', { maxLength: 120 })
  const position = expectGridAnchor(body.position, 'position')
  const pathLength = optionalPathLength(body.pathLength)

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(body.profileId)
      : null
    const result = moveMapTokenUseCase({
      role,
      slug,
      placementId,
      position,
      pathLength,
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
