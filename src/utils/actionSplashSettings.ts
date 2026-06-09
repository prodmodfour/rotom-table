export const ACTION_SPLASH_SPEED_LINES_DURATION_STORAGE_KEY = 'rotom-table:action-splash-speed-lines-duration-ms' as const
export const DEFAULT_ACTION_SPLASH_SPEED_LINES_DURATION_MS = 800 as const
export const MIN_ACTION_SPLASH_SPEED_LINES_DURATION_MS = 100 as const
export const MAX_ACTION_SPLASH_SPEED_LINES_DURATION_MS = 5000 as const
export const ACTION_SPLASH_SPEED_LINES_DURATION_STEP_MS = 50 as const

export type ActionSplashSpeedLinesDurationMs = number

const numberFromSettingValue = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export const parseActionSplashSpeedLinesDurationMs = (
  value: unknown,
): ActionSplashSpeedLinesDurationMs | null => {
  const parsed = numberFromSettingValue(value)
  if (parsed === null) return null

  const rounded = Math.round(parsed)
  return Math.min(
    MAX_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
    Math.max(MIN_ACTION_SPLASH_SPEED_LINES_DURATION_MS, rounded),
  )
}

export const resolveActionSplashSpeedLinesDurationMs = (
  value: unknown,
  fallback: ActionSplashSpeedLinesDurationMs = DEFAULT_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
): ActionSplashSpeedLinesDurationMs => parseActionSplashSpeedLinesDurationMs(value) ?? fallback

export const serializeActionSplashSpeedLinesDurationMs = (
  durationMs: ActionSplashSpeedLinesDurationMs,
): string => String(resolveActionSplashSpeedLinesDurationMs(durationMs))

export const actionSplashSpeedLinesDurationLabel = (
  durationMs: ActionSplashSpeedLinesDurationMs,
): string => `${resolveActionSplashSpeedLinesDurationMs(durationMs)} ms`

export const actionSplashSpeedLinesDurationTitle = (
  durationMs: ActionSplashSpeedLinesDurationMs,
): string => (
  `Horizontal speed lines loop every ${resolveActionSplashSpeedLinesDurationMs(durationMs)} ms. Lower values move faster.`
)
