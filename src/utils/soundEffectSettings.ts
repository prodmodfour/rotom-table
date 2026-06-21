export const SOUND_EFFECTS_ENABLED_STORAGE_KEY = 'rotom-table:sound-effects-enabled' as const
export const DEFAULT_SOUND_EFFECTS_ENABLED = true as const

export type SoundEffectsEnabledSetting = boolean

const TRUE_SETTING_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled'])
const FALSE_SETTING_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled'])

export const parseSoundEffectsEnabled = (value: unknown): SoundEffectsEnabledSetting | null => {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()
  if (TRUE_SETTING_VALUES.has(normalized)) return true
  if (FALSE_SETTING_VALUES.has(normalized)) return false

  return null
}

export const resolveSoundEffectsEnabled = (
  value: unknown,
  fallback: SoundEffectsEnabledSetting = DEFAULT_SOUND_EFFECTS_ENABLED,
): SoundEffectsEnabledSetting => parseSoundEffectsEnabled(value) ?? fallback

export const serializeSoundEffectsEnabled = (
  enabled: SoundEffectsEnabledSetting,
): 'true' | 'false' => (enabled ? 'true' : 'false')

export const soundEffectsEnabledLabel = (
  enabled: SoundEffectsEnabledSetting,
): 'Sound effects on' | 'Sound effects off' => (
  enabled ? 'Sound effects on' : 'Sound effects off'
)

export const soundEffectsEnabledTitle = (
  enabled: SoundEffectsEnabledSetting,
): string => (
  enabled
    ? 'Dice rolls and table action moments can play short procedural sound effects after browser audio is unlocked by a user interaction.'
    : 'Sound effects are disabled; gameplay and visual feedback continue normally.'
)
