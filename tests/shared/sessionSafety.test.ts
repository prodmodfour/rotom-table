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
    })

    expect(status.exposure).toBe('local')
    expect(status.severity).toBe('caution')
    expect(status.effectiveHost).toBe('localhost')
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
    expect(status.recommendedActions.join('\n')).toContain('Verify the server bind address')
  })
})
