import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { describe, expect, it, vi, afterEach } from 'vitest'
import safetyRoute from '~~/server/api/sessions/safety.get'
import { SESSION_HOST_ENABLE_ENV } from '~~/server/utils/sessionHosting'
import { sessionStore } from '~~/server/utils/sessionStore'
import type { SessionSafetyStatus } from '#shared/sessionSafety'
import { parseGmKey, parseJoinCode, parseSessionId } from '#shared/sessionIdentity'
import { INITIAL_SESSION_REVISION } from '#shared/sessionRevisions'
import { createAuthoritativeSessionState } from '#shared/sessionState'

type SafetyRouteHandler = EventHandler<EventHandlerRequest, SessionSafetyStatus>

const invokeSafetyRoute = async (
  headers: Record<string, string> = {},
): Promise<SessionSafetyStatus> => (safetyRoute as SafetyRouteHandler)({
  node: {
    req: { headers },
  },
} as unknown as H3Event)

describe('session safety endpoint startup checks', () => {
  afterEach(() => {
    sessionStore.clear()
    vi.unstubAllEnvs()
  })

  it('warns when enabled remote exposure has no active session credentials yet', async () => {
    vi.stubEnv(SESSION_HOST_ENABLE_ENV, '1')

    const status = await invokeSafetyRoute({
      host: 'localhost:3000',
      'x-forwarded-host': 'table.example.com',
      'x-forwarded-proto': 'https',
      'cf-ray': 'abc123',
    })

    expect(status).toMatchObject({
      hostEnabled: true,
      exposure: 'remote',
      severity: 'danger',
      sessionReadiness: 'not-started',
      sessionSettings: {
        activeSessionCount: 0,
        credentialedSessionCount: 0,
        stateBackedSessionCount: 0,
      },
      startupIssues: [
        'host-enabled-without-active-session',
        'remote-exposure-before-session-start',
      ],
    })
    expect(status.warnings.join('\n')).toContain('no active session-local GM key and join code')
    expect(status.recommendedActions.join('\n')).toContain('start a session, verify a fresh join code')
    expect(JSON.stringify(status)).not.toContain('gmkey_')
  })

  it('reports ready without exposing key or code values after a session is active', async () => {
    vi.stubEnv(SESSION_HOST_ENABLE_ENV, '1')

    const sessionId = parseSessionId('session_safetyready01')
    const timestamp = '2026-05-26T12:00:00.000Z'
    sessionStore.create({
      sessionId,
      gmKey: parseGmKey('gmkey_safetyreadysecretvalue001'),
      joinCode: parseJoinCode('ABCD23'),
      revision: INITIAL_SESSION_REVISION,
      createdAt: timestamp,
      updatedAt: timestamp,
      state: createAuthoritativeSessionState({
        sessionId,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    })

    const status = await invokeSafetyRoute({ host: '192.168.1.42:3000' })

    expect(status).toMatchObject({
      hostEnabled: true,
      exposure: 'lan',
      sessionReadiness: 'ready',
      sessionSettings: {
        activeSessionCount: 1,
        credentialedSessionCount: 1,
        stateBackedSessionCount: 1,
      },
      startupIssues: [],
    })
    expect(JSON.stringify(status)).not.toContain('gmkey_safetyreadysecretvalue001')
    expect(JSON.stringify(status)).not.toContain('ABCD23')
  })
})
