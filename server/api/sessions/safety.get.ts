/**
 * GET /api/sessions/safety
 *
 * Returns a no-secret Track 2 hosting safety summary for the current request.
 * Unlike session creation/join routes, this endpoint is intentionally readable
 * while hosting is disabled so the lobby can explain that session endpoints fail
 * closed until ROTOM_ENABLE_SESSION_HOST=1 is set.
 */
import { defineEventHandler, getHeader } from 'h3'
import { createSessionSafetyStatus } from '#shared/sessionSafety'
import { isSessionHostEnabled } from '../../utils/sessionHosting'

export default defineEventHandler((event) => createSessionSafetyStatus({
  hostEnabled: isSessionHostEnabled(),
  requestHost: getHeader(event, 'host'),
  forwardedHost: getHeader(event, 'x-forwarded-host'),
  forwardedProto: getHeader(event, 'x-forwarded-proto'),
  forwardedFor: getHeader(event, 'x-forwarded-for'),
  cloudflareRay: getHeader(event, 'cf-ray'),
}))
