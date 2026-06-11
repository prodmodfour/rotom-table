import { describe, expect, it } from 'vitest'
import {
  ACTION_SPLASH_DISPLAY_DURATION_STORAGE_KEY,
  ACTION_SPLASH_DISPLAY_DURATION_STEP_MS,
  ACTION_SPLASH_SPEED_LINES_DURATION_STORAGE_KEY,
  ACTION_SPLASH_SPEED_LINES_DURATION_STEP_MS,
  DEFAULT_ACTION_SPLASH_DISPLAY_DURATION_MS,
  DEFAULT_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
  MAX_ACTION_SPLASH_DISPLAY_DURATION_MS,
  MAX_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
  MIN_ACTION_SPLASH_DISPLAY_DURATION_MS,
  MIN_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
  actionSplashDisplayDurationLabel,
  actionSplashDisplayDurationTitle,
  actionSplashSpeedLinesDurationLabel,
  actionSplashSpeedLinesDurationTitle,
  parseActionSplashDisplayDurationMs,
  parseActionSplashSpeedLinesDurationMs,
  resolveActionSplashDisplayDurationMs,
  resolveActionSplashSpeedLinesDurationMs,
  serializeActionSplashDisplayDurationMs,
  serializeActionSplashSpeedLinesDurationMs,
} from '~/utils/actionSplashSettings'

describe('action splash settings', () => {
  it('defaults display duration to 1850ms', () => {
    expect(DEFAULT_ACTION_SPLASH_DISPLAY_DURATION_MS).toBe(1850)
    expect(ACTION_SPLASH_DISPLAY_DURATION_STORAGE_KEY).toBe('rotom-table:action-splash-display-duration-ms')
    expect(ACTION_SPLASH_DISPLAY_DURATION_STEP_MS).toBe(50)
    expect(resolveActionSplashDisplayDurationMs(undefined)).toBe(1850)
    expect(resolveActionSplashDisplayDurationMs('unexpected')).toBe(1850)
  })

  it('parses, serializes, and bounds the display duration setting', () => {
    expect(parseActionSplashDisplayDurationMs(1850)).toBe(1850)
    expect(parseActionSplashDisplayDurationMs(' 2200 ')).toBe(2200)
    expect(parseActionSplashDisplayDurationMs(1875.6)).toBe(1876)
    expect(parseActionSplashDisplayDurationMs('')).toBeNull()
    expect(parseActionSplashDisplayDurationMs('fast')).toBeNull()
    expect(parseActionSplashDisplayDurationMs(Number.POSITIVE_INFINITY)).toBeNull()

    expect(parseActionSplashDisplayDurationMs(MIN_ACTION_SPLASH_DISPLAY_DURATION_MS - 1))
      .toBe(MIN_ACTION_SPLASH_DISPLAY_DURATION_MS)
    expect(parseActionSplashDisplayDurationMs(MAX_ACTION_SPLASH_DISPLAY_DURATION_MS + 1))
      .toBe(MAX_ACTION_SPLASH_DISPLAY_DURATION_MS)
    expect(serializeActionSplashDisplayDurationMs(2000)).toBe('2000')
  })

  it('describes display duration as the visible action splash time', () => {
    expect(actionSplashDisplayDurationLabel(1850)).toBe('1850 ms')
    expect(actionSplashDisplayDurationTitle(1850)).toContain('stay visible')
  })

  it('defaults horizontal speed-line duration to 800ms', () => {
    expect(DEFAULT_ACTION_SPLASH_SPEED_LINES_DURATION_MS).toBe(800)
    expect(ACTION_SPLASH_SPEED_LINES_DURATION_STORAGE_KEY).toBe('rotom-table:action-splash-speed-lines-duration-ms')
    expect(ACTION_SPLASH_SPEED_LINES_DURATION_STEP_MS).toBe(50)
    expect(resolveActionSplashSpeedLinesDurationMs(undefined)).toBe(800)
    expect(resolveActionSplashSpeedLinesDurationMs('unexpected')).toBe(800)
  })

  it('parses, serializes, and bounds the speed-line duration setting', () => {
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
