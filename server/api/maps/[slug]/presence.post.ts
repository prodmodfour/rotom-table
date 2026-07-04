import { createHash } from 'node:crypto'
import { defineEventHandler, getCookie, getHeader, getQuery, getRouterParam, type H3Event } from 'h3'
import {
  SESSION_CLIENT_IDENTITY_COOKIE,
  deserializeSessionClientIdentityCookieHint,
  type SessionClientIdentityCookieHint,
} from '#shared/sessionClientIdentity'
import {
  CLIENT_ID_PATTERN_DESCRIPTION,
  isClientId,
} from '#shared/sessionIdentity'
import type { AuthRole } from '#shared/auth'
import { resolvePlayerProfileForPolicy } from '../../../policies/playerProfilePolicy'
import { publishLivePlayPresenceHeartbeat } from '../../../livePlay/presenceAccess'
import { publishLivePlayPresenceSnapshotRealtime } from '../../../livePlay/presenceRealtime'
import { requireAuthRole } from '../../../utils/auth'
import { badRequest, readObjectBody } from '../../../utils/http'
import { getPlayerSessionAccessGrant } from '../../../utils/sessionPlayerAccess'
import { setPrivateNoStoreHeaders } from '../../../utils/cacheHeaders'
import { throwUseCaseHttpError } from '../../../utils/useCaseHttp'

type PresenceHeartbeatRequestBody = Record<string, unknown>

interface ParsedPresenceHeartbeatBody {
  readonly update: unknown
  readonly profileId: unknown
  readonly clientId: string | null
}

const WRAPPED_HEARTBEAT_BODY_FIELDS = new Set(['presence', 'profileId', 'clientId'])

const hasOwn = (record: Record<string, unknown>, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(record, key)
)

const assertWrappedHeartbeatBodyFields = (body: PresenceHeartbeatRequestBody): void => {
  for (const key of Object.keys(body)) {
    if (WRAPPED_HEARTBEAT_BODY_FIELDS.has(key)) continue
    badRequest(`request body contains unsupported presence heartbeat field "${key}"`)
  }
}

const normalizeBodyClientId = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null
  if (!isClientId(value)) badRequest(`clientId must match ${CLIENT_ID_PATTERN_DESCRIPTION}`)
  return value as string
}

const parsePresenceHeartbeatBody = (body: PresenceHeartbeatRequestBody): ParsedPresenceHeartbeatBody => {
  if (!hasOwn(body, 'presence')) {
    return { update: body, profileId: undefined, clientId: null }
  }

  assertWrappedHeartbeatBodyFields(body)
  return {
    update: body.presence,
    profileId: body.profileId,
    clientId: normalizeBodyClientId(body.clientId),
  }
}

const queryProfileId = (event: H3Event): unknown => getQuery(event).profileId

const matchingSessionIdentityCookie = (
  event: H3Event,
  role: AuthRole,
): SessionClientIdentityCookieHint | null => {
  const encoded = getCookie(event, SESSION_CLIENT_IDENTITY_COOKIE)
  if (!encoded) return null

  const parsed = deserializeSessionClientIdentityCookieHint(encoded)
  if (!parsed.ok || parsed.identity.role !== role) return null
  return parsed.identity
}

const hashedFallbackClientId = (event: H3Event, role: AuthRole): string => {
  const source = JSON.stringify({
    role,
    forwardedFor: getHeader(event, 'x-forwarded-for') ?? null,
    userAgent: getHeader(event, 'user-agent') ?? null,
  })
  return `client_${createHash('sha256').update(source).digest('hex').slice(0, 12)}`
}

const sessionContextKey = (identity: SessionClientIdentityCookieHint | null): string | null => {
  if (identity === null) return null
  if (identity.role === 'player') return `session:${identity.sessionId}:player:${identity.playerId}`
  return `session:${identity.sessionId}:gm`
}

const resolvePresenceClientContext = (
  event: H3Event,
  role: AuthRole,
  bodyClientId: string | null,
): { readonly clientId: string; readonly sessionContextKey: string | null } => {
  const identity = matchingSessionIdentityCookie(event, role)
  return {
    clientId: identity?.clientId ?? bodyClientId ?? hashedFallbackClientId(event, role),
    sessionContextKey: sessionContextKey(identity),
  }
}

export default defineEventHandler(async (event) => {
  setPrivateNoStoreHeaders(event)
  const role = requireAuthRole(event)
  const body = await readObjectBody<PresenceHeartbeatRequestBody>(event)
  const heartbeat = parsePresenceHeartbeatBody(body)

  try {
    const playerProfile = role === 'player'
      ? resolvePlayerProfileForPolicy(heartbeat.profileId ?? queryProfileId(event))
      : null
    const sessionAccess = role === 'player'
      ? getPlayerSessionAccessGrant(event)
      : null
    const clientContext = resolvePresenceClientContext(event, role, heartbeat.clientId)

    const snapshot = publishLivePlayPresenceHeartbeat({
      slug: getRouterParam(event, 'slug'),
      viewer: {
        role,
        playerProfile,
        sessionAccess,
      },
      update: heartbeat.update,
      clientId: clientContext.clientId,
      sessionContextKey: clientContext.sessionContextKey,
    })

    try {
      publishLivePlayPresenceSnapshotRealtime(snapshot)
    } catch (publishError) {
      console.warn('[presence] transient realtime publication failed', {
        mapSlug: snapshot.mapSlug,
        error: publishError,
      })
    }

    return snapshot
  } catch (error) {
    throwUseCaseHttpError(error)
  }
})
