import type { H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import type { PlayerProfileId } from '../../shared/playerProfiles'
import {
  BREEDING_GM_WRITE_LIMIT_PER_MINUTE,
  BREEDING_PLAYER_WRITE_LIMIT_PER_MINUTE,
  BREEDING_WRITE_RATE_WINDOW_MILLISECONDS,
  BreedingWriteRateLimitError,
  BreedingWriteRateLimiter,
  enforceBreedingWriteRateLimit,
} from '../../server/security/breedingWriteRateLimit'

const owner = 'profile_rateowner' as PlayerProfileId
const other = 'profile_rateother' as PlayerProfileId

const playerInput = (profileId: PlayerProfileId, nowMilliseconds: number) => ({
  role: 'player' as const,
  profileId,
  nowMilliseconds,
})
const gmInput = (nowMilliseconds: number) => ({
  role: 'gm' as const,
  profileId: null,
  nowMilliseconds,
})

describe('breeding write-rate admission', () => {
  it('binds the exact security-policy limits and rejects excess player writes with a bounded retry', () => {
    expect(BREEDING_PLAYER_WRITE_LIMIT_PER_MINUTE).toBe(30)
    expect(BREEDING_GM_WRITE_LIMIT_PER_MINUTE).toBe(120)
    const limiter = new BreedingWriteRateLimiter()

    for (let index = 0; index < BREEDING_PLAYER_WRITE_LIMIT_PER_MINUTE; index += 1) {
      expect(limiter.consume(playerInput(owner, 1_000))).toEqual({
        accepted: true,
        limit: 30,
        remaining: 29 - index,
        retryAfterSeconds: 0,
      })
    }

    expect(limiter.consume(playerInput(owner, 1_000))).toEqual({
      accepted: false,
      limit: 30,
      remaining: 0,
      retryAfterSeconds: 60,
    })
    expect(limiter.consume(playerInput(owner, 31_001)).retryAfterSeconds).toBe(30)
  })

  it('isolates player Profile buckets and applies the stricter aggregate GM-session bucket', () => {
    const limiter = new BreedingWriteRateLimiter()
    for (let index = 0; index < BREEDING_PLAYER_WRITE_LIMIT_PER_MINUTE; index += 1) {
      expect(limiter.consume(playerInput(owner, 0)).accepted).toBe(true)
    }
    expect(limiter.consume(playerInput(owner, 0)).accepted).toBe(false)
    expect(limiter.consume(playerInput(other, 0)).accepted).toBe(true)

    for (let index = 0; index < BREEDING_GM_WRITE_LIMIT_PER_MINUTE; index += 1) {
      expect(limiter.consume(gmInput(10_000)).accepted).toBe(true)
    }
    expect(limiter.consume(gmInput(10_000))).toEqual({
      accepted: false,
      limit: 120,
      remaining: 0,
      retryAfterSeconds: 60,
    })
  })

  it('opens a new fixed window only after sixty seconds and treats clock regression as denial', () => {
    const limiter = new BreedingWriteRateLimiter()
    expect(limiter.consume(playerInput(owner, 5_000)).accepted).toBe(true)
    expect(limiter.consume(playerInput(owner, 4_999))).toEqual({
      accepted: false,
      limit: 30,
      remaining: 0,
      retryAfterSeconds: 60,
    })
    expect(limiter.consume(playerInput(owner, 5_000 + BREEDING_WRITE_RATE_WINDOW_MILLISECONDS - 1)).remaining).toBe(28)
    expect(limiter.consume(playerInput(owner, 5_000 + BREEDING_WRITE_RATE_WINDOW_MILLISECONDS))).toEqual({
      accepted: true,
      limit: 30,
      remaining: 29,
      retryAfterSeconds: 0,
    })
  })

  it('bounds bucket memory, fails closed for a new key, and prunes only expired windows', () => {
    const limiter = new BreedingWriteRateLimiter({ maximumKeys: 2 })
    expect(limiter.consume(playerInput(owner, 0)).accepted).toBe(true)
    expect(limiter.consume(playerInput(other, 0)).accepted).toBe(true)
    expect(limiter.consume(playerInput('profile_ratethird' as PlayerProfileId, 1))).toEqual({
      accepted: false,
      limit: 30,
      remaining: 0,
      retryAfterSeconds: 60,
    })
    expect(limiter.consume(playerInput('profile_ratethird' as PlayerProfileId, 60_000)).accepted).toBe(true)
  })

  it('emits only Retry-After and a bounded 429 when route admission is exhausted', () => {
    const limiter = new BreedingWriteRateLimiter()
    for (let index = 0; index < BREEDING_PLAYER_WRITE_LIMIT_PER_MINUTE; index += 1) {
      limiter.consume(playerInput(owner, 1_000))
    }
    const setHeader = vi.fn()
    const event = { node: { res: { setHeader } } } as unknown as H3Event

    expect(() => enforceBreedingWriteRateLimit(event, {
      role: 'player', profileId: owner,
    }, { limiter, nowMilliseconds: 1_000 })).toThrow(BreedingWriteRateLimitError)
    expect(setHeader).toHaveBeenCalledOnce()
    expect(setHeader).toHaveBeenCalledWith('Retry-After', 60)
  })

  it('rejects malformed authority, time, and limiter configuration before admission', () => {
    const limiter = new BreedingWriteRateLimiter()
    expect(() => limiter.consume({ role: 'player', profileId: null, nowMilliseconds: 0 })).toThrow(
      'requires an exact Profile ID',
    )
    expect(() => limiter.consume({ role: 'gm', profileId: owner, nowMilliseconds: 0 })).toThrow(
      'cannot adopt a player Profile ID',
    )
    expect(() => limiter.consume(playerInput(owner, -1))).toThrow('nonnegative safe integer')
    expect(() => limiter.consume(playerInput(owner, Number.MAX_SAFE_INTEGER + 1))).toThrow('nonnegative safe integer')
    expect(() => new BreedingWriteRateLimiter({ maximumKeys: 0 })).toThrow('positive bounded safe integer')
    expect(() => new BreedingWriteRateLimiter({ maximumKeys: 4_097 })).toThrow('positive bounded safe integer')
  })
})
