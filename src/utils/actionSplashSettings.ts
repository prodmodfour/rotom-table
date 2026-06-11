export const ACTION_SPLASH_DISPLAY_DURATION_STORAGE_KEY = 'rotom-table:action-splash-display-duration-ms' as const
export const DEFAULT_ACTION_SPLASH_DISPLAY_DURATION_MS = 1850 as const
export const MIN_ACTION_SPLASH_DISPLAY_DURATION_MS = 250 as const
export const MAX_ACTION_SPLASH_DISPLAY_DURATION_MS = 5000 as const
export const ACTION_SPLASH_DISPLAY_DURATION_STEP_MS = 50 as const

export const ACTION_SPLASH_SPEED_LINES_DURATION_STORAGE_KEY = 'rotom-table:action-splash-speed-lines-duration-ms' as const
export const DEFAULT_ACTION_SPLASH_SPEED_LINES_DURATION_MS = 800 as const
export const MIN_ACTION_SPLASH_SPEED_LINES_DURATION_MS = 100 as const
export const MAX_ACTION_SPLASH_SPEED_LINES_DURATION_MS = 5000 as const
export const ACTION_SPLASH_SPEED_LINES_DURATION_STEP_MS = 50 as const

export type ActionSplashDisplayDurationMs = number
export type ActionSplashSpeedLinesDurationMs = number

const numberFromSettingValue = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

const parseBoundedDurationMs = (value: unknown, minMs: number, maxMs: number): number | null => {
  const parsed = numberFromSettingValue(value)
  if (parsed === null) return null

  const rounded = Math.round(parsed)
  return Math.min(maxMs, Math.max(minMs, rounded))
}

const formatDurationLabel = (durationMs: number): string => `${durationMs} ms`

export const parseActionSplashDisplayDurationMs = (
  value: unknown,
): ActionSplashDisplayDurationMs | null => (
  parseBoundedDurationMs(
    value,
    MIN_ACTION_SPLASH_DISPLAY_DURATION_MS,
    MAX_ACTION_SPLASH_DISPLAY_DURATION_MS,
  )
)

export const resolveActionSplashDisplayDurationMs = (
  value: unknown,
  fallback: ActionSplashDisplayDurationMs = DEFAULT_ACTION_SPLASH_DISPLAY_DURATION_MS,
): ActionSplashDisplayDurationMs => parseActionSplashDisplayDurationMs(value) ?? fallback

export const serializeActionSplashDisplayDurationMs = (
  durationMs: ActionSplashDisplayDurationMs,
): string => String(resolveActionSplashDisplayDurationMs(durationMs))

export const actionSplashDisplayDurationLabel = (
  durationMs: ActionSplashDisplayDurationMs,
): string => formatDurationLabel(resolveActionSplashDisplayDurationMs(durationMs))

export const actionSplashDisplayDurationTitle = (
  durationMs: ActionSplashDisplayDurationMs,
): string => (
  `Action splash banners stay visible for ${resolveActionSplashDisplayDurationMs(durationMs)} ms before the action continues.`
)

export const parseActionSplashSpeedLinesDurationMs = (
  value: unknown,
): ActionSplashSpeedLinesDurationMs | null => (
  parseBoundedDurationMs(
    value,
    MIN_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
    MAX_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
  )
)

export const resolveActionSplashSpeedLinesDurationMs = (
  value: unknown,
  fallback: ActionSplashSpeedLinesDurationMs = DEFAULT_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
): ActionSplashSpeedLinesDurationMs => parseActionSplashSpeedLinesDurationMs(value) ?? fallback

export const serializeActionSplashSpeedLinesDurationMs = (
  durationMs: ActionSplashSpeedLinesDurationMs,
): string => String(resolveActionSplashSpeedLinesDurationMs(durationMs))

export const actionSplashSpeedLinesDurationLabel = (
  durationMs: ActionSplashSpeedLinesDurationMs,
): string => formatDurationLabel(resolveActionSplashSpeedLinesDurationMs(durationMs))

export const actionSplashSpeedLinesDurationTitle = (
  durationMs: ActionSplashSpeedLinesDurationMs,
): string => (
  `Horizontal speed lines loop every ${resolveActionSplashSpeedLinesDurationMs(durationMs)} ms. Lower values move faster.`
)
