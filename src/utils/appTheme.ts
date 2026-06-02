export type AppThemeMode = 'dark' | 'light'

export const DEFAULT_APP_THEME_MODE: AppThemeMode = 'dark'
export const APP_THEME_STORAGE_KEY = 'rotom-table:theme-mode'

export const isAppThemeMode = (value: unknown): value is AppThemeMode => (
  value === 'dark' || value === 'light'
)

export const parseAppThemeMode = (value: unknown): AppThemeMode | null => (
  isAppThemeMode(value) ? value : null
)

export const serializeAppThemeMode = (mode: AppThemeMode): string => mode

export const appThemeModeLabel = (mode: AppThemeMode): string => (
  mode === 'light' ? 'Light mode' : 'Dark mode'
)

export const appThemeModeTitle = (mode: AppThemeMode): string => (
  mode === 'light'
    ? 'The app is using the light appearance theme.'
    : 'The app is using the dark appearance theme.'
)

export const appThemeToggleLabel = (mode: AppThemeMode): string => (
  mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'
)

export const nextAppThemeMode = (mode: AppThemeMode): AppThemeMode => (
  mode === 'light' ? 'dark' : 'light'
)
