import { afterEach, describe, expect, it } from 'vitest'
import {
  areHostedWritesEnabled,
  HOSTED_WRITES_DISABLED_MESSAGE,
  isWritableCampaignMode,
  requireWritableCampaignMode,
} from '~~/server/utils/http'

const originalNodeEnv = process.env.NODE_ENV
const originalHostedWrites = process.env.ROTOM_ENABLE_HOSTED_WRITES

const restoreEnvValue = (key: 'NODE_ENV' | 'ROTOM_ENABLE_HOSTED_WRITES', value: string | undefined): void => {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(() => {
  restoreEnvValue('NODE_ENV', originalNodeEnv)
  restoreEnvValue('ROTOM_ENABLE_HOSTED_WRITES', originalHostedWrites)
})

describe('hosted write policy', () => {
  it('preserves non-production campaign writes without the hosted-write flag', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.ROTOM_ENABLE_HOSTED_WRITES

    expect(areHostedWritesEnabled()).toBe(false)
    expect(isWritableCampaignMode()).toBe(true)
    expect(() => requireWritableCampaignMode()).not.toThrow()
  })

  it('fails closed in production unless the exact hosted-write flag is set', () => {
    process.env.NODE_ENV = 'production'

    delete process.env.ROTOM_ENABLE_HOSTED_WRITES
    expect(isWritableCampaignMode()).toBe(false)

    process.env.ROTOM_ENABLE_HOSTED_WRITES = 'true'
    expect(areHostedWritesEnabled()).toBe(false)
    expect(isWritableCampaignMode()).toBe(false)

    process.env.ROTOM_ENABLE_HOSTED_WRITES = '1'
    expect(areHostedWritesEnabled()).toBe(true)
    expect(isWritableCampaignMode()).toBe(true)
    expect(() => requireWritableCampaignMode()).not.toThrow()
  })

  it('throws a clear 403 error when production hosted writes are disabled', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.ROTOM_ENABLE_HOSTED_WRITES

    expect(HOSTED_WRITES_DISABLED_MESSAGE).toContain('database-backed live-play commands')
    expect(() => requireWritableCampaignMode()).toThrow(HOSTED_WRITES_DISABLED_MESSAGE)
    try {
      requireWritableCampaignMode()
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 403,
        statusMessage: HOSTED_WRITES_DISABLED_MESSAGE,
      })
    }
  })
})
