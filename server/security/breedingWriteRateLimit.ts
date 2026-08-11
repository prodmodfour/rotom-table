import { setResponseHeader, type H3Event } from 'h3'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfileId } from '#shared/playerProfiles'
import { UseCaseHttpError } from '../utils/useCaseErrors'

const limits = securityPolicyJson.definition.abuseLimits
export const BREEDING_PLAYER_WRITE_LIMIT_PER_MINUTE = limits.writeCommandsPerProfilePerMinute
export const BREEDING_GM_WRITE_LIMIT_PER_MINUTE = limits.gmWriteCommandsPerSessionPerMinute
export const BREEDING_WRITE_RATE_WINDOW_MILLISECONDS = 60_000 as const
export const BREEDING_WRITE_RATE_MAXIMUM_KEYS = 4_096 as const

interface BreedingWriteRateBucket {
  readonly windowStartedAtMilliseconds: number
  readonly count: number
}

export interface BreedingWriteRateLimitInput {
  readonly role: AuthRole
  readonly profileId: PlayerProfileId | null
  readonly nowMilliseconds: number
}

export interface BreedingWriteRateLimitDecision {
  readonly accepted: boolean
  readonly limit: number
  readonly remaining: number
  readonly retryAfterSeconds: number
}

export interface BreedingWriteRateLimiterOptions {
  readonly maximumKeys?: number
}

const decision = (
  accepted: boolean,
  limit: number,
  remaining: number,
  retryAfterSeconds: number,
): BreedingWriteRateLimitDecision => Object.freeze({ accepted, limit, remaining, retryAfterSeconds })

/**
 * Process-local liveplay request admission. This is deliberately not campaign
 * authority: it cannot advance time, settle an operation, or alter exact retry.
 */
export class BreedingWriteRateLimiter {
  readonly #buckets = new Map<string, BreedingWriteRateBucket>()
  readonly #maximumKeys: number

  constructor(options: BreedingWriteRateLimiterOptions = {}) {
    const maximumKeys = options.maximumKeys ?? BREEDING_WRITE_RATE_MAXIMUM_KEYS
    if (!Number.isSafeInteger(maximumKeys) || maximumKeys < 1 || maximumKeys > BREEDING_WRITE_RATE_MAXIMUM_KEYS) {
      throw new Error('Breeding write-rate maximum keys must be a positive bounded safe integer.')
    }
    this.#maximumKeys = maximumKeys
  }

  consume(input: BreedingWriteRateLimitInput): BreedingWriteRateLimitDecision {
    if (!Number.isSafeInteger(input.nowMilliseconds) || input.nowMilliseconds < 0) {
      throw new Error('Breeding write-rate time must be a nonnegative safe integer.')
    }
    if (input.role === 'player' && input.profileId === null) {
      throw new Error('Player breeding write-rate admission requires an exact Profile ID.')
    }
    if (input.role === 'gm' && input.profileId !== null) {
      throw new Error('GM breeding write-rate admission cannot adopt a player Profile ID.')
    }

    const key = input.role === 'player' ? `player:${input.profileId}` : 'gm:authenticated-liveplay-session'
    const limit = input.role === 'player'
      ? BREEDING_PLAYER_WRITE_LIMIT_PER_MINUTE
      : BREEDING_GM_WRITE_LIMIT_PER_MINUTE
    const previous = this.#buckets.get(key)
    const elapsed = previous ? input.nowMilliseconds - previous.windowStartedAtMilliseconds : 0
    const expired = previous !== undefined && elapsed >= BREEDING_WRITE_RATE_WINDOW_MILLISECONDS

    if (!previous || expired) {
      if (!previous && this.#buckets.size >= this.#maximumKeys) this.#prune(input.nowMilliseconds)
      if (!previous && this.#buckets.size >= this.#maximumKeys) {
        return decision(false, limit, 0, 60)
      }
      this.#buckets.set(key, Object.freeze({ windowStartedAtMilliseconds: input.nowMilliseconds, count: 1 }))
      return decision(true, limit, limit - 1, 0)
    }

    if (elapsed < 0 || previous.count >= limit) {
      const remainingMilliseconds = Math.max(
        1,
        BREEDING_WRITE_RATE_WINDOW_MILLISECONDS - Math.max(0, elapsed),
      )
      return decision(false, limit, 0, Math.ceil(remainingMilliseconds / 1_000))
    }

    const count = previous.count + 1
    this.#buckets.set(key, Object.freeze({
      windowStartedAtMilliseconds: previous.windowStartedAtMilliseconds,
      count,
    }))
    return decision(true, limit, limit - count, 0)
  }

  clear(): void {
    this.#buckets.clear()
  }

  #prune(nowMilliseconds: number): void {
    for (const [key, bucket] of this.#buckets) {
      const elapsed = nowMilliseconds - bucket.windowStartedAtMilliseconds
      if (elapsed >= BREEDING_WRITE_RATE_WINDOW_MILLISECONDS) this.#buckets.delete(key)
    }
  }
}

const liveLimiter = new BreedingWriteRateLimiter()

export class BreedingWriteRateLimitError extends UseCaseHttpError<429> {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super(429, 'Breeding write rate limit exceeded')
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export const enforceBreedingWriteRateLimit = (
  event: H3Event,
  input: Omit<BreedingWriteRateLimitInput, 'nowMilliseconds'>,
  options: {
    readonly limiter?: BreedingWriteRateLimiter
    readonly nowMilliseconds?: number
  } = {},
): void => {
  const result = (options.limiter ?? liveLimiter).consume({
    ...input,
    nowMilliseconds: options.nowMilliseconds ?? Date.now(),
  })
  if (result.accepted) return
  setResponseHeader(event, 'Retry-After', result.retryAfterSeconds)
  throw new BreedingWriteRateLimitError(result.retryAfterSeconds)
}

export const resetBreedingWriteRateLimitForTests = (): void => liveLimiter.clear()
