/**
 * GET /api/sessions/safety
 *
 * Returns a no-secret live session hosting safety summary for the current request.
 * Unlike session creation/join routes, this endpoint is intentionally readable
 * while hosting is disabled so the lobby can explain that session endpoints fail
 * closed until ROTOM_ENABLE_SESSION_HOST=1 is set.
 */
import { defineEventHandler, getHeader } from 'h3'
import { createSessionSafetyStatus } from '#shared/sessionSafety'
import { isSessionHostEnabled } from '../../utils/sessionHosting'
import { sessionStore, type SessionStoreRecord } from '../../utils/sessionStore'

const hasSessionCredentials = (record: SessionStoreRecord): boolean =>
  typeof record.gmKey === 'string'
  && record.gmKey.length > 0
  && typeof record.joinCode === 'string'
  && record.joinCode.length > 0

const hasAuthoritativeSessionState = (record: SessionStoreRecord): boolean =>
  record.state !== undefined && record.state.sessionId === record.sessionId

const summarizeSessionSettings = () => {
  const activeSessions = sessionStore.listActive()

  return {
    activeSessionCount: activeSessions.length,
    credentialedSessionCount: activeSessions.filter(hasSessionCredentials).length,
    stateBackedSessionCount: activeSessions.filter(hasAuthoritativeSessionState).length,
  }
}

export default defineEventHandler((event) => {
  const hostEnabled = isSessionHostEnabled()

  return createSessionSafetyStatus({
    hostEnabled,
    requestHost: getHeader(event, 'host'),
    forwardedHost: getHeader(event, 'x-forwarded-host'),
    forwardedProto: getHeader(event, 'x-forwarded-proto'),
    forwardedFor: getHeader(event, 'x-forwarded-for'),
    cloudflareRay: getHeader(event, 'cf-ray'),
    sessionSettings: hostEnabled ? summarizeSessionSettings() : undefined,
  })
})
