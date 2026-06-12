import { MAP_ACTION_REALTIME_EVENT_TYPE, isMapActionEventEnvelope, type MapActionEventEnvelope, type MapActionRealtimeEvent } from '#shared/mapActionEvents'
import { mapChannel } from '#shared/realtime'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import { canAccessMapForRole } from '../policies/mapPolicy'
import { actorCanControlMapPlacement } from '../policies/playerProfileTokenControlPolicy'
import { findMapFile, readMapFile } from '../utils/mapStorage'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export const MAP_ACTION_EVENT_MAX_PAYLOAD_BYTES = 64 * 1024
export const MAP_ACTION_EVENT_MAX_ID_LENGTH = 120
export const MAP_ACTION_EVENT_MAX_SOURCE_CLIENT_ID_LENGTH = 200

export class PublishMapActionEventUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 413> {}

export interface PublishMapActionEventInput {
  role: AuthRole
  slug: string
  event: unknown
  playerProfile?: PlayerProfile | null
}

export interface PublishMapActionEventDependencies {
  findMapPath?: (slug: string) => string | null
  readMap?: (path: string) => TabletopMap
  maxPayloadBytes?: number
}

export interface PublishMapActionEventResult {
  ok: true
  event: Omit<MapActionRealtimeEvent, 'timestamp'>
}

const controlDeniedMessage = (role: AuthRole, profile: PlayerProfile | null | undefined): string => (
  role === 'player' && !profile
    ? 'Select a player profile to control linked map tokens'
    : 'Token is not linked to selected player profile'
)

const requireMaxLength = (value: string, label: string, maxLength: number): void => {
  if (value.length > maxLength) {
    throw new PublishMapActionEventUseCaseError(400, `${label} too long (max ${maxLength} chars)`)
  }
}

const payloadSizeBytes = (payload: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(payload) ?? '', 'utf8')
  } catch (error) {
    throw new PublishMapActionEventUseCaseError(
      400,
      error instanceof Error ? error.message : 'payload could not be serialized',
    )
  }
}

const normalizePublishEvent = (
  value: unknown,
  maxPayloadBytes: number,
): MapActionEventEnvelope => {
  if (!isMapActionEventEnvelope(value)) {
    throw new PublishMapActionEventUseCaseError(400, 'event must be a valid map action event envelope')
  }

  requireMaxLength(value.id, 'event.id', MAP_ACTION_EVENT_MAX_ID_LENGTH)
  requireMaxLength(value.actorPlacementId, 'event.actorPlacementId', MAP_ACTION_EVENT_MAX_ID_LENGTH)
  requireMaxLength(value.sourceClientId, 'event.sourceClientId', MAP_ACTION_EVENT_MAX_SOURCE_CLIENT_ID_LENGTH)

  const sizeBytes = payloadSizeBytes(value.payload)
  if (sizeBytes > maxPayloadBytes) {
    throw new PublishMapActionEventUseCaseError(
      413,
      `event.payload too large (max ${maxPayloadBytes} bytes)`,
    )
  }

  return value
}

const findPlacement = (map: TabletopMap, placementId: string): SheetPlacement | null => (
  map.placements.find((placement) => placement.id === placementId) ?? null
)

export const publishMapActionEventUseCase = (
  input: PublishMapActionEventInput,
  dependencies: PublishMapActionEventDependencies = {},
): PublishMapActionEventResult => {
  const actionEvent = normalizePublishEvent(
    input.event,
    dependencies.maxPayloadBytes ?? MAP_ACTION_EVENT_MAX_PAYLOAD_BYTES,
  )
  const findMapPath = dependencies.findMapPath ?? findMapFile
  const readMap = dependencies.readMap ?? readMapFile

  const mapPath = findMapPath(input.slug)
  if (!mapPath) throw new PublishMapActionEventUseCaseError(404, `Map ${input.slug}.json not found`)

  const map = readMap(mapPath)
  if (!canAccessMapForRole(input.role, map)) {
    throw new PublishMapActionEventUseCaseError(403, 'Map is not player visible')
  }

  const actorPlacement = findPlacement(map, actionEvent.actorPlacementId)
  if (!actorPlacement) {
    throw new PublishMapActionEventUseCaseError(404, `Placement ${actionEvent.actorPlacementId} not found`)
  }

  if (!actorCanControlMapPlacement({
    role: input.role,
    profile: input.playerProfile,
    placement: actorPlacement,
  })) {
    throw new PublishMapActionEventUseCaseError(
      403,
      controlDeniedMessage(input.role, input.playerProfile),
    )
  }

  return {
    ok: true,
    event: {
      channel: mapChannel(input.slug),
      type: MAP_ACTION_REALTIME_EVENT_TYPE,
      clientId: actionEvent.sourceClientId,
      data: actionEvent,
    },
  }
}
