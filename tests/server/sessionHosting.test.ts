import { describe, expect, it } from 'vitest'
import {
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
  assertSessionHostEnabled,
  isSessionHostEnabled,
} from '~~/server/utils/sessionHosting'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE }

describe('session hosting runtime gate', () => {
  it('is disabled unless the exact documented flag value is present', () => {
    expect(isSessionHostEnabled({})).toBe(false)
    expect(isSessionHostEnabled({ [SESSION_HOST_ENABLE_ENV]: '' })).toBe(false)
    expect(isSessionHostEnabled({ [SESSION_HOST_ENABLE_ENV]: 'true' })).toBe(false)
    expect(isSessionHostEnabled({ [SESSION_HOST_ENABLE_ENV]: ' 1' })).toBe(false)
    expect(isSessionHostEnabled({ [SESSION_HOST_ENABLE_ENV]: '1 ' })).toBe(false)
    expect(isSessionHostEnabled(enabledEnv)).toBe(true)
  })

  it('throws an HTTP-compatible fail-closed error when disabled', () => {
    expect(() => assertSessionHostEnabled({})).toThrowErrorMatchingInlineSnapshot(
      `[SessionHostDisabledError: Track 2 session hosting is disabled. Set ROTOM_ENABLE_SESSION_HOST=1 to enable session endpoints.]`,
    )

    try {
      assertSessionHostEnabled({ [SESSION_HOST_ENABLE_ENV]: 'true' })
      throw new Error('expected assertSessionHostEnabled to throw')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 403 })
    }
  })

  it('allows session-hosting work when explicitly enabled', () => {
    expect(() => assertSessionHostEnabled(enabledEnv)).not.toThrow()
  })
})
