import { describe, expect, it } from 'vitest'
import {
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
  createSessionSafetyStatus,
  isSessionHostFlagEnabled,
} from '#shared/sessionSafety'

describe('session safety status', () => {
  it('keeps the runtime flag disabled unless the exact documented value is present', () => {
    expect(isSessionHostFlagEnabled({})).toBe(false)
    expect(isSessionHostFlagEnabled({ [SESSION_HOST_ENABLE_ENV]: 'true' })).toBe(false)
    expect(isSessionHostFlagEnabled({ [SESSION_HOST_ENABLE_ENV]: ' 1' })).toBe(false)
    expect(isSessionHostFlagEnabled({ [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE })).toBe(true)
  })

  it('reports disabled session hosting as fail-closed and local-auth safe', () => {
    const status = createSessionSafetyStatus({
      hostEnabled: false,
      requestHost: 'localhost:3000',
    })

    expect(status).toMatchObject({
      hostEnabled: false,
      exposure: 'disabled',
      severity: 'safe',
      requestHost: 'localhost',
      effectiveHost: 'localhost',
      sessionReadiness: 'disabled',
      startupIssues: [],
      title: 'Session hosting disabled',
    })
    expect(status.requiredFlag).toEqual({
      name: SESSION_HOST_ENABLE_ENV,
      value: SESSION_HOST_ENABLE_VALUE,
    })
    expect(status.warnings.join('\n')).toContain('fail closed')
    expect(status.warnings.join('\n')).toContain('not public authentication')
  })

  it('classifies enabled localhost requests as local caution', () => {
    const status = createSessionSafetyStatus({
      hostEnabled: true,
      requestHost: 'http://LOCALHOST:3000/sessions',
      sessionSettings: {
        activeSessionCount: 1,
        credentialedSessionCount: 1,
        stateBackedSessionCount: 1,
      },
    })

    expect(status.exposure).toBe('local')
    expect(status.severity).toBe('caution')
    expect(status.effectiveHost).toBe('localhost')
    expect(status.sessionReadiness).toBe('ready')
    expect(status.startupIssues).toEqual([])
    expect(status.summary).toContain('looks local')
    expect(status.warnings.join('\n')).toContain('GM keys and join codes')
  })

  it('classifies enabled private IP and single-label host requests as LAN exposure', () => {
    expect(createSessionSafetyStatus({
      hostEnabled: true,
      requestHost: '192.168.1.40:3000',
    }).exposure).toBe('lan')
    expect(createSessionSafetyStatus({
      hostEnabled: true,
      requestHost: '10.0.0.5',
    }).exposure).toBe('lan')
    expect(createSessionSafetyStatus({
      hostEnabled: true,
      requestHost: 'rotom-table:3000',
    }).exposure).toBe('lan')
  })

  it('classifies public hosts and Cloudflare-style forwarded hosts as remote exposure', () => {
    const publicHostStatus = createSessionSafetyStatus({
      hostEnabled: true,
      requestHost: 'table.example.com',
    })
    const tunnelStatus = createSessionSafetyStatus({
      hostEnabled: true,
      requestHost: 'localhost:3000',
      forwardedHost: 'campaign.example.net',
      forwardedProto: 'https',
      cloudflareRay: 'abc123',
    })

    expect(publicHostStatus.exposure).toBe('remote')
    expect(publicHostStatus.severity).toBe('danger')
    expect(tunnelStatus).toMatchObject({
      exposure: 'remote',
      severity: 'danger',
      forwarded: true,
      requestHost: 'localhost',
      forwardedHost: 'campaign.example.net',
      effectiveHost: 'campaign.example.net',
    })
    expect(tunnelStatus.warnings.join('\n')).toContain('named Cloudflare Tunnel')
    expect(tunnelStatus.warnings.join('\n')).toContain('Quick Tunnel is development smoke-test only')
  })

  it('falls back to unknown when enabled hosting has no classifiable host', () => {
    const status = createSessionSafetyStatus({ hostEnabled: true })

    expect(status.exposure).toBe('unknown')
    expect(status.severity).toBe('danger')
    expect(status.effectiveHost).toBeNull()
    expect(status.sessionReadiness).toBe('unknown')
    expect(status.startupIssues).toContain('host-enabled-session-readiness-unknown')
    expect(status.recommendedActions.join('\n')).toContain('Verify the server bind address')
  })

  it('warns when hosting is enabled before a GM session creates keys and a join code', () => {
    const status = createSessionSafetyStatus({
      hostEnabled: true,
      requestHost: 'localhost:3000',
      forwardedHost: 'table.example.com',
      forwardedProto: 'https',
      sessionSettings: {
        activeSessionCount: 0,
        credentialedSessionCount: 0,
        stateBackedSessionCount: 0,
      },
    })

    expect(status).toMatchObject({
      exposure: 'remote',
      severity: 'danger',
      sessionReadiness: 'not-started',
      sessionSettings: {
        activeSessionCount: 0,
        credentialedSessionCount: 0,
        stateBackedSessionCount: 0,
      },
    })
    expect(status.startupIssues).toEqual([
      'host-enabled-without-active-session',
      'remote-exposure-before-session-start',
    ])
    expect(status.warnings.join('\n')).toContain('no active session-local GM key and join code')
    expect(status.warnings.join('\n')).toContain('remotely exposed before a join code/session')
    expect(status.recommendedActions.join('\n')).toContain('start a session, verify a fresh join code')
    expect(JSON.stringify(status)).not.toContain('gmkey_')
  })

  it('marks incomplete active session startup settings as unsafe without exposing secrets', () => {
    const status = createSessionSafetyStatus({
      hostEnabled: true,
      requestHost: '192.168.1.40:3000',
      sessionSettings: {
        activeSessionCount: 2,
        credentialedSessionCount: 1,
        stateBackedSessionCount: 1,
      },
    })

    expect(status.exposure).toBe('lan')
    expect(status.severity).toBe('danger')
    expect(status.sessionReadiness).toBe('unsafe')
    expect(status.startupIssues).toEqual([
      'host-enabled-without-session-secrets',
      'host-enabled-without-authoritative-state',
    ])
    expect(status.warnings.join('\n')).toContain('missing its expected session-local GM key or join code')
    expect(status.warnings.join('\n')).toContain('missing authoritative session state')
    expect(status.recommendedActions.join('\n')).toContain('start a new hosted session')
    expect(JSON.stringify(status)).not.toContain('joinCode')
  })
})
