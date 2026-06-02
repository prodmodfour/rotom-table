import { computed, onMounted, watch } from 'vue'
import {
  APP_THEME_STORAGE_KEY,
  DEFAULT_APP_THEME_MODE,
  appThemeModeLabel,
  appThemeModeTitle,
  appThemeToggleLabel,
  nextAppThemeMode,
  parseAppThemeMode,
  serializeAppThemeMode,
  type AppThemeMode,
} from '~/utils/appTheme'

const readStoredAppThemeMode = (): AppThemeMode | null => {
  try {
    return parseAppThemeMode(window.localStorage.getItem(APP_THEME_STORAGE_KEY))
  } catch {
    return null
  }
}

const writeStoredAppThemeMode = (mode: AppThemeMode): void => {
  try {
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, serializeAppThemeMode(mode))
  } catch {
    // Keep the in-memory preference usable when browser storage is unavailable.
  }
}

const applyAppThemeMode = (mode: AppThemeMode): void => {
  document.documentElement.dataset.theme = mode
  document.documentElement.style.colorScheme = mode
}

export const useAppTheme = () => {
  const appThemeMode = useState<AppThemeMode>(
    'app-theme-mode',
    () => DEFAULT_APP_THEME_MODE,
  )

  if (import.meta.client) {
    onMounted(() => {
      const stored = readStoredAppThemeMode()
      if (stored !== null) appThemeMode.value = stored
      applyAppThemeMode(appThemeMode.value)
    })

    watch(appThemeMode, (mode) => {
      applyAppThemeMode(mode)
      writeStoredAppThemeMode(mode)
    })
  }

  const appThemeModeLabelText = computed(() => appThemeModeLabel(appThemeMode.value))
  const appThemeModeTitleText = computed(() => appThemeModeTitle(appThemeMode.value))
  const appThemeToggleLabelText = computed(() => appThemeToggleLabel(appThemeMode.value))
  const isLightAppTheme = computed(() => appThemeMode.value === 'light')

  const setAppThemeMode = (mode: AppThemeMode) => {
    appThemeMode.value = mode
  }

  const toggleAppThemeMode = () => {
    appThemeMode.value = nextAppThemeMode(appThemeMode.value)
  }

  return {
    appThemeMode,
    appThemeModeLabel: appThemeModeLabelText,
    appThemeModeTitle: appThemeModeTitleText,
    appThemeToggleLabel: appThemeToggleLabelText,
    isLightAppTheme,
    setAppThemeMode,
    toggleAppThemeMode,
  }
}
