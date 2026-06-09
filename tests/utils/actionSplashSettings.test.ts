import { describe, expect, it } from 'vitest'
import {
  ACTION_SPLASH_SPEED_LINES_DURATION_STORAGE_KEY,
  ACTION_SPLASH_SPEED_LINES_DURATION_STEP_MS,
  DEFAULT_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
  MAX_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
  MIN_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
  actionSplashSpeedLinesDurationLabel,
  actionSplashSpeedLinesDurationTitle,
  parseActionSplashSpeedLinesDurationMs,
  resolveActionSplashSpeedLinesDurationMs,
  serializeActionSplashSpeedLinesDurationMs,
} from '~/utils/actionSplashSettings'

describe('action splash settings', () => {
  it('defaults horizontal speed-line duration to 800ms', () => {
    expect(DEFAULT_ACTION_SPLASH_SPEED_LINES_DURATION_MS).toBe(800)
    expect(ACTION_SPLASH_SPEED_LINES_DURATION_STORAGE_KEY).toBe('rotom-table:action-splash-speed-lines-duration-ms')
    expect(ACTION_SPLASH_SPEED_LINES_DURATION_STEP_MS).toBe(50)
    expect(resolveActionSplashSpeedLinesDurationMs(undefined)).toBe(800)
    expect(resolveActionSplashSpeedLinesDurationMs('unexpected')).toBe(800)
  })

  it('parses, serializes, and bounds the duration setting', () => {
    expect(parseActionSplashSpeedLinesDurationMs(800)).toBe(800)
    expect(parseActionSplashSpeedLinesDurationMs(' 1200 ')).toBe(1200)
    expect(parseActionSplashSpeedLinesDurationMs(825.6)).toBe(826)
    expect(parseActionSplashSpeedLinesDurationMs('')).toBeNull()
    expect(parseActionSplashSpeedLinesDurationMs('fast')).toBeNull()
    expect(parseActionSplashSpeedLinesDurationMs(Number.POSITIVE_INFINITY)).toBeNull()

    expect(parseActionSplashSpeedLinesDurationMs(MIN_ACTION_SPLASH_SPEED_LINES_DURATION_MS - 1))
      .toBe(MIN_ACTION_SPLASH_SPEED_LINES_DURATION_MS)
    expect(parseActionSplashSpeedLinesDurationMs(MAX_ACTION_SPLASH_SPEED_LINES_DURATION_MS + 1))
      .toBe(MAX_ACTION_SPLASH_SPEED_LINES_DURATION_MS)
    expect(serializeActionSplashSpeedLinesDurationMs(700)).toBe('700')
  })

  it('describes lower durations as faster horizontal lines', () => {
    expect(actionSplashSpeedLinesDurationLabel(800)).toBe('800 ms')
    expect(actionSplashSpeedLinesDurationTitle(800)).toContain('Lower values move faster')
  })
})
