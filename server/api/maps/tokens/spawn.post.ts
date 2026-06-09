import { defineEventHandler } from 'h3'
import { requireAuthRole } from '../../../utils/auth'
import { badRequest, expectRecord, expectSheetKind, expectSlug, expectString, readObjectBody, requireWritableCampaignMode } from '../../../utils/http'
import { publishUseCaseRealtimeEvents, throwUseCaseHttpError } from '../../../utils/useCaseHttp'
import { spawnMapTokenUseCase } from '../../../useCases/applyMapTokenAction'
import { normalizeRealtimeClientId } from '#shared/realtime'
import { isTokenFacingDirection } from '~/utils/tokenFacing'
import type { GridAnchor, SheetPlacement } from '~/types/map'

interface SpawnTokenBody {
  slug?: unknown
  placement?: unknown
  clientId?: unknown
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

const expectPlacement = (value: unknown): SheetPlacement => {
  const record = expectRecord(value, 'placement')
  const facingInput = record.facing
  if (facingInput !== undefined && !isTokenFacingDirection(facingInput)) {
    badRequest('placement.facing must be a token facing direction')
  }
  const facing = isTokenFacingDirection(facingInput) ? facingInput : undefined

  return {
    id: expectString(record.id, 'placement.id', { maxLength: 120 }),
    sheetKind: expectSheetKind(record.sheetKind),
    sheetSlug: expectString(record.sheetSlug, 'placement.sheetSlug', { maxLength: 200 }),
    position: expectGridAnchor(record.position, 'placement.position'),
    ...(facing === undefined ? {} : { facing }),
    ...(typeof record.turned === 'boolean' ? { turned: record.turned } : {}),
  }
}

export default defineEventHandler(async (event) => {
  const role = requireAuthRole(event)
  requireWritableCampaignMode()

  const body = await readObjectBody<SpawnTokenBody>(event)
  const slug = expectSlug(body.slug)
  const placement = expectPlacement(body.placement)

  try {
    const result = spawnMapTokenUseCase({
      role,
      slug,
      placement,
      clientId: normalizeRealtimeClientId(body.clientId),
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
