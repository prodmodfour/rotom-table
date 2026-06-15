export const INITIATIVE_AUTO_FOCUS_ENABLED_STORAGE_KEY = 'rotom-table:initiative-auto-focus-enabled' as const
export const DEFAULT_INITIATIVE_AUTO_FOCUS_ENABLED = true as const
export const INITIATIVE_AUTO_FOCUS_HELP_TEXT = 'When initiative advances, move the map camera to the active token on this device.' as const

export type InitiativeAutoFocusEnabledSetting = boolean

const TRUE_SETTING_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled'])
const FALSE_SETTING_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled'])

export const parseInitiativeAutoFocusEnabled = (
  value: unknown,
): InitiativeAutoFocusEnabledSetting | null => {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()
  if (TRUE_SETTING_VALUES.has(normalized)) return true
  if (FALSE_SETTING_VALUES.has(normalized)) return false

  return null
}

export const resolveInitiativeAutoFocusEnabled = (
  value: unknown,
  fallback: InitiativeAutoFocusEnabledSetting = DEFAULT_INITIATIVE_AUTO_FOCUS_ENABLED,
): InitiativeAutoFocusEnabledSetting => parseInitiativeAutoFocusEnabled(value) ?? fallback

export const serializeInitiativeAutoFocusEnabled = (
  enabled: InitiativeAutoFocusEnabledSetting,
): 'true' | 'false' => (enabled ? 'true' : 'false')

export const initiativeAutoFocusEnabledLabel = (
  enabled: InitiativeAutoFocusEnabledSetting,
): 'Auto-focus active initiative on' | 'Auto-focus active initiative off' => (
  enabled ? 'Auto-focus active initiative on' : 'Auto-focus active initiative off'
)

export const initiativeAutoFocusEnabledTitle = (
  _enabled: InitiativeAutoFocusEnabledSetting,
): typeof INITIATIVE_AUTO_FOCUS_HELP_TEXT => INITIATIVE_AUTO_FOCUS_HELP_TEXT
