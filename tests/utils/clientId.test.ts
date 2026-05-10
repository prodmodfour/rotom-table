import { describe, expect, it } from 'vitest'
import { createClientIdProvider, formatClientId } from '~/utils/clientId'

describe('client id helpers', () => {
  it('formats ids with the existing random/date base36 shape', () => {
    expect(formatClientId(0.123456789, 1234567890)).toBe('c-4fzzzxjy-kf12oi')
  })

  it('returns the SSR sentinel without caching it when no window is available', () => {
    let hasWindow = false
    let randomCalls = 0
    const getClientId = createClientIdProvider({
      hasWindow: () => hasWindow,
      random: () => {
        randomCalls += 1
        return 0.25
      },
      now: () => 1000,
    })

    expect(getClientId()).toBe('ssr')
    expect(randomCalls).toBe(0)

    hasWindow = true
    expect(getClientId()).toBe('c-9-rs')
    expect(randomCalls).toBe(1)
  })

  it('caches one browser id per provider instance', () => {
    let nextRandom = 0.5
    const getClientId = createClientIdProvider({
      hasWindow: () => true,
      random: () => nextRandom,
      now: () => 36,
    })

    expect(getClientId()).toBe('c-i-10')
    nextRandom = 0.75
    expect(getClientId()).toBe('c-i-10')
  })
})
