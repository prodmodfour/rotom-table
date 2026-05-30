export const MOVE_ANIMATIONS_ENABLED_STORAGE_KEY = 'rotom-table:move-animations-enabled' as const
export const DEFAULT_MOVE_ANIMATIONS_ENABLED = true as const
export const DEFAULT_MOVE_ANIMATIONS_REDUCED_MOTION = false as const
export const PREFERS_REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)' as const

export type MoveAnimationsEnabledSetting = boolean
export type MoveAnimationsReducedMotionSetting = boolean

export type MoveAnimationPreferenceMediaQueryChangeEvent = {
  readonly matches?: boolean
}

export type MoveAnimationPreferenceMediaQueryList = {
  readonly matches: boolean
  addEventListener?: (
    type: 'change',
    listener: (event: MoveAnimationPreferenceMediaQueryChangeEvent) => void,
  ) => void
  removeEventListener?: (
    type: 'change',
    listener: (event: MoveAnimationPreferenceMediaQueryChangeEvent) => void,
  ) => void
  addListener?: (listener: (event: MoveAnimationPreferenceMediaQueryChangeEvent) => void) => void
  removeListener?: (listener: (event: MoveAnimationPreferenceMediaQueryChangeEvent) => void) => void
}

export type MoveAnimationPreferenceMatchMedia = (
  query: typeof PREFERS_REDUCED_MOTION_QUERY,
) => MoveAnimationPreferenceMediaQueryList

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

const browserMatchMedia = (): MoveAnimationPreferenceMatchMedia | null => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia.bind(window) as MoveAnimationPreferenceMatchMedia
}

const prefersReducedMotionQueryList = (
  matchMedia: MoveAnimationPreferenceMatchMedia | null | undefined,
): MoveAnimationPreferenceMediaQueryList | null => {
  if (typeof matchMedia !== 'function') return null

  try {
    return matchMedia(PREFERS_REDUCED_MOTION_QUERY)
  } catch {
    return null
  }
}

export const readPrefersReducedMotion = (
  matchMedia: MoveAnimationPreferenceMatchMedia | null | undefined = browserMatchMedia(),
): MoveAnimationsReducedMotionSetting => (
  prefersReducedMotionQueryList(matchMedia)?.matches === true
)

const reducedMotionMatchesFromEvent = (
  queryList: MoveAnimationPreferenceMediaQueryList,
  event: MoveAnimationPreferenceMediaQueryChangeEvent | undefined,
): MoveAnimationsReducedMotionSetting => (
  typeof event?.matches === 'boolean' ? event.matches : queryList.matches === true
)

export const subscribePrefersReducedMotion = (
  onChange: (reducedMotion: MoveAnimationsReducedMotionSetting) => void,
  matchMedia: MoveAnimationPreferenceMatchMedia | null | undefined = browserMatchMedia(),
): (() => void) => {
  const queryList = prefersReducedMotionQueryList(matchMedia)
  if (!queryList) return () => {}

  const listener = (event?: MoveAnimationPreferenceMediaQueryChangeEvent) => {
    onChange(reducedMotionMatchesFromEvent(queryList, event))
  }

  if (typeof queryList.addEventListener === 'function' && typeof queryList.removeEventListener === 'function') {
    try {
      queryList.addEventListener('change', listener)
      return () => {
        try {
          queryList.removeEventListener?.('change', listener)
        } catch {
          // Ignore cleanup failures from mocked or partially implemented media query lists.
        }
      }
    } catch {
      return () => {}
    }
  }

  if (typeof queryList.addListener === 'function' && typeof queryList.removeListener === 'function') {
    try {
      queryList.addListener(listener)
      return () => {
        try {
          queryList.removeListener?.(listener)
        } catch {
          // Ignore cleanup failures from mocked or partially implemented media query lists.
        }
      }
    } catch {
      return () => {}
    }
  }

  return () => {}
}
