import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_THEME_MODE,
  appThemeModeLabel,
  appThemeToggleLabel,
  isAppThemeMode,
  nextAppThemeMode,
  parseAppThemeMode,
  serializeAppThemeMode,
} from '~/utils/appTheme'

describe('app theme utilities', () => {
  it('defaults to dark mode', () => {
    expect(DEFAULT_APP_THEME_MODE).toBe('dark')
  })

  it('validates persisted theme modes', () => {
    expect(isAppThemeMode('dark')).toBe(true)
    expect(isAppThemeMode('light')).toBe(true)
    expect(isAppThemeMode('system')).toBe(false)
    expect(parseAppThemeMode('light')).toBe('light')
    expect(parseAppThemeMode('')).toBeNull()
  })

  it('serializes and advances theme modes', () => {
    expect(serializeAppThemeMode('light')).toBe('light')
    expect(nextAppThemeMode('dark')).toBe('light')
    expect(nextAppThemeMode('light')).toBe('dark')
  })

  it('provides user-facing labels', () => {
    expect(appThemeModeLabel('dark')).toBe('Dark mode')
    expect(appThemeModeLabel('light')).toBe('Light mode')
    expect(appThemeToggleLabel('dark')).toBe('Switch to light mode')
    expect(appThemeToggleLabel('light')).toBe('Switch to dark mode')
  })
})
