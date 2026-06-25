import { createError, getHeader, getQuery, type H3Event } from 'h3'
import {
  parseRealtimeConnectionRequest,
  type RealtimeConnectionRequest,
} from '#shared/realtimeReplay'
import type { PlayerProfile, PlayerProfileId } from '#shared/playerProfiles'
import type { AuthRole } from '../utils/auth'
import { requireAuthRole } from '../utils/auth'
import { resolvePlayerProfileForPolicy } from '../policies/playerProfilePolicy'
import { getPlayerSessionAccessGrant } from '../utils/sessionPlayerAccess'
import { throwUseCaseHttpError } from '../utils/useCaseHttp'
import type {
  RealtimeDeliveryPrincipal,
  RealtimeSessionAccessGrant,
} from './realtimeEventAccessPolicy'

export interface H3RealtimeConnectionContext {
  readonly request: RealtimeConnectionRequest
  readonly principal: RealtimeDeliveryPrincipal
}

export interface ResolveRealtimeDeliveryPrincipalDependencies {
  readonly resolvePlayerProfile?: (profileId: PlayerProfileId | null) => PlayerProfile | null
  readonly getSessionAccess?: (event: H3Event) => RealtimeSessionAccessGrant | null
}

const badRealtimeRequest = (message: string): never => {
  throw createError({ statusCode: 400, statusMessage: message })
}

const queryCursorValue = (value: unknown): string | readonly string[] | null | undefined => {
  if (value === undefined || value === null) return value
  if (Array.isArray(value)) return value.map((item) => String(item))
  return String(value)
}

const parseConnectionRequestOrThrow = (event: H3Event): RealtimeConnectionRequest => {
  try {
    const query = getQuery(event)
    return parseRealtimeConnectionRequest({
      lastEventId: getHeader(event, 'last-event-id') ?? null,
      after: queryCursorValue(query.after),
      profileId: query.profileId,
    })
  } catch (error) {
    return badRealtimeRequest(error instanceof Error ? error.message : String(error))
  }
}

const defaultResolvePlayerProfile = (profileId: PlayerProfileId | null): PlayerProfile | null => {
  try {
    return resolvePlayerProfileForPolicy(profileId)
  } catch (error) {
    return throwUseCaseHttpError(error)
  }
}

const defaultGetSessionAccess = (event: H3Event): RealtimeSessionAccessGrant | null => {
  const grant = getPlayerSessionAccessGrant(event)
  return grant === null ? null : { sheetKeys: grant.sheetKeys }
}

export const resolveRealtimeDeliveryPrincipal = (
  input: {
    readonly event: H3Event
    readonly role: AuthRole
    readonly request: RealtimeConnectionRequest
  },
  dependencies: ResolveRealtimeDeliveryPrincipalDependencies = {},
): RealtimeDeliveryPrincipal => {
  if (input.role === 'gm') {
    if (input.request.profileId !== null) badRealtimeRequest('GM event streams must not include profileId')
    return { role: 'gm' }
  }

  const resolveProfile = dependencies.resolvePlayerProfile ?? defaultResolvePlayerProfile
  const getSessionAccess = dependencies.getSessionAccess ?? defaultGetSessionAccess
  return {
    role: 'player',
    playerProfile: resolveProfile(input.request.profileId),
    sessionAccess: getSessionAccess(input.event),
  }
}

export const resolveH3RealtimeConnectionContext = (
  event: H3Event,
  dependencies: ResolveRealtimeDeliveryPrincipalDependencies = {},
): H3RealtimeConnectionContext => {
  const request = parseConnectionRequestOrThrow(event)
  const role = requireAuthRole(event)
  return {
    request,
    principal: resolveRealtimeDeliveryPrincipal({ event, role, request }, dependencies),
  }
}
