export const ROTOM_REALTIME_EVENT_RETENTION_DAYS_ENV = 'ROTOM_REALTIME_EVENT_RETENTION_DAYS'
export const ROTOM_REALTIME_EVENT_MAX_ROWS_ENV = 'ROTOM_REALTIME_EVENT_MAX_ROWS'
export const ROTOM_REALTIME_EVENT_PRUNE_INTERVAL_MS_ENV = 'ROTOM_REALTIME_EVENT_PRUNE_INTERVAL_MS'
export const ROTOM_REALTIME_EVENT_RETENTION_ENABLED_ENV = 'ROTOM_REALTIME_EVENT_RETENTION_ENABLED'

export const DEFAULT_REALTIME_EVENT_RETENTION_DAYS = 30
export const DEFAULT_REALTIME_EVENT_MAX_ROWS = 250_000
export const DEFAULT_REALTIME_EVENT_PRUNE_INTERVAL_MS = 15 * 60 * 1000
export const DEFAULT_REALTIME_EVENT_RETENTION_ENABLED = true

export const MIN_REALTIME_EVENT_RETENTION_DAYS = 1
export const MAX_REALTIME_EVENT_RETENTION_DAYS = 3_650
export const MIN_REALTIME_EVENT_MAX_ROWS = 1
export const MAX_REALTIME_EVENT_MAX_ROWS = 10_000_000
export const MIN_REALTIME_EVENT_PRUNE_INTERVAL_MS = 10_000
export const MAX_REALTIME_EVENT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface RealtimeEventRetentionPolicy {
  readonly enabled: boolean
  readonly retentionDays: number
  readonly maxRows: number
  readonly pruneIntervalMs: number
}

export type RealtimeEventRetentionEnv = Readonly<Record<string, string | undefined>>

export class RealtimeEventRetentionConfigError extends Error {
  constructor(message: string) {
    super(`Invalid realtime event retention configuration: ${message}`)
    this.name = 'RealtimeEventRetentionConfigError'
  }
}

const parseIntegerEnv = (input: {
  readonly env: RealtimeEventRetentionEnv
  readonly name: string
  readonly defaultValue: number
  readonly min: number
  readonly max: number
}): number => {
  const rawValue = input.env[input.name]
  const trimmed = rawValue?.trim()
  const value = trimmed ? Number(trimmed) : input.defaultValue

  if (!Number.isSafeInteger(value)) {
    throw new RealtimeEventRetentionConfigError(`${input.name} must be a safe integer`)
  }
  if (value < input.min || value > input.max) {
    throw new RealtimeEventRetentionConfigError(`${input.name} must be between ${input.min} and ${input.max}`)
  }
  return value
}

const parseBooleanEnv = (input: {
  readonly env: RealtimeEventRetentionEnv
  readonly name: string
  readonly defaultValue: boolean
}): boolean => {
  const rawValue = input.env[input.name]
  const trimmed = rawValue?.trim().toLowerCase()
  if (!trimmed) return input.defaultValue
  if (['1', 'true', 'yes', 'on'].includes(trimmed)) return true
  if (['0', 'false', 'no', 'off'].includes(trimmed)) return false
  throw new RealtimeEventRetentionConfigError(`${input.name} must be true or false`)
}

export const loadRealtimeEventRetentionPolicy = (
  env: RealtimeEventRetentionEnv = process.env,
): RealtimeEventRetentionPolicy => ({
  enabled: parseBooleanEnv({
    env,
    name: ROTOM_REALTIME_EVENT_RETENTION_ENABLED_ENV,
    defaultValue: DEFAULT_REALTIME_EVENT_RETENTION_ENABLED,
  }),
  retentionDays: parseIntegerEnv({
    env,
    name: ROTOM_REALTIME_EVENT_RETENTION_DAYS_ENV,
    defaultValue: DEFAULT_REALTIME_EVENT_RETENTION_DAYS,
    min: MIN_REALTIME_EVENT_RETENTION_DAYS,
    max: MAX_REALTIME_EVENT_RETENTION_DAYS,
  }),
  maxRows: parseIntegerEnv({
    env,
    name: ROTOM_REALTIME_EVENT_MAX_ROWS_ENV,
    defaultValue: DEFAULT_REALTIME_EVENT_MAX_ROWS,
    min: MIN_REALTIME_EVENT_MAX_ROWS,
    max: MAX_REALTIME_EVENT_MAX_ROWS,
  }),
  pruneIntervalMs: parseIntegerEnv({
    env,
    name: ROTOM_REALTIME_EVENT_PRUNE_INTERVAL_MS_ENV,
    defaultValue: DEFAULT_REALTIME_EVENT_PRUNE_INTERVAL_MS,
    min: MIN_REALTIME_EVENT_PRUNE_INTERVAL_MS,
    max: MAX_REALTIME_EVENT_PRUNE_INTERVAL_MS,
  }),
})
