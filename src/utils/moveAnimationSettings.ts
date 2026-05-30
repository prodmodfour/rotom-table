export const MOVE_ANIMATIONS_ENABLED_STORAGE_KEY = 'rotom-table:move-animations-enabled' as const
export const DEFAULT_MOVE_ANIMATIONS_ENABLED = true as const

export type MoveAnimationsEnabledSetting = boolean

const TRUE_SETTING_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled'])
const FALSE_SETTING_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled'])

export const parseMoveAnimationsEnabled = (value: unknown): MoveAnimationsEnabledSetting | null => {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()
  if (TRUE_SETTING_VALUES.has(normalized)) return true
  if (FALSE_SETTING_VALUES.has(normalized)) return false

  return null
}

export const resolveMoveAnimationsEnabled = (
  value: unknown,
  fallback: MoveAnimationsEnabledSetting = DEFAULT_MOVE_ANIMATIONS_ENABLED,
): MoveAnimationsEnabledSetting => parseMoveAnimationsEnabled(value) ?? fallback

export const serializeMoveAnimationsEnabled = (
  enabled: MoveAnimationsEnabledSetting,
): 'true' | 'false' => (enabled ? 'true' : 'false')

export const moveAnimationsEnabledLabel = (
  enabled: MoveAnimationsEnabledSetting,
): 'Move animations on' | 'Move animations off' => (
  enabled ? 'Move animations on' : 'Move animations off'
)

export const moveAnimationsEnabledTitle = (
  enabled: MoveAnimationsEnabledSetting,
): string => (
  enabled
    ? 'Move automation will play transient visual effects.'
    : 'Move automation stays usable, but transient move visual effects are skipped.'
)
