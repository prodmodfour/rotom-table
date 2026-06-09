import { computed, onMounted, watch } from 'vue'
import {
  ACTION_SPLASH_SPEED_LINES_DURATION_STORAGE_KEY,
  DEFAULT_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
  actionSplashSpeedLinesDurationLabel,
  actionSplashSpeedLinesDurationTitle,
  parseActionSplashSpeedLinesDurationMs,
  resolveActionSplashSpeedLinesDurationMs,
  serializeActionSplashSpeedLinesDurationMs,
} from '~/utils/actionSplashSettings'

const readStoredActionSplashSpeedLinesDurationMs = (): number | null => {
  try {
    return parseActionSplashSpeedLinesDurationMs(
      window.localStorage.getItem(ACTION_SPLASH_SPEED_LINES_DURATION_STORAGE_KEY),
    )
  } catch {
    return null
  }
}

const writeStoredActionSplashSpeedLinesDurationMs = (durationMs: number): void => {
  try {
    window.localStorage.setItem(
      ACTION_SPLASH_SPEED_LINES_DURATION_STORAGE_KEY,
      serializeActionSplashSpeedLinesDurationMs(durationMs),
    )
  } catch {
    // Keep the in-memory preference usable when browser storage is unavailable.
  }
}

export const useActionSplashSettings = () => {
  const actionSplashSpeedLinesDurationMs = useState<number>(
    'action-splash-speed-lines-duration-ms',
    () => DEFAULT_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
  )

  if (import.meta.client) {
    onMounted(() => {
      const stored = readStoredActionSplashSpeedLinesDurationMs()
      if (stored !== null) actionSplashSpeedLinesDurationMs.value = stored
    })

    watch(actionSplashSpeedLinesDurationMs, (durationMs) => {
      writeStoredActionSplashSpeedLinesDurationMs(durationMs)
    })
  }

  const actionSplashSpeedLinesDurationLabelText = computed(() => (
    actionSplashSpeedLinesDurationLabel(actionSplashSpeedLinesDurationMs.value)
  ))
  const actionSplashSpeedLinesDurationTitleText = computed(() => (
    actionSplashSpeedLinesDurationTitle(actionSplashSpeedLinesDurationMs.value)
  ))

  const setActionSplashSpeedLinesDurationMs = (durationMs: unknown) => {
    actionSplashSpeedLinesDurationMs.value = resolveActionSplashSpeedLinesDurationMs(
      durationMs,
      actionSplashSpeedLinesDurationMs.value,
    )
  }

  const resetActionSplashSpeedLinesDurationMs = () => {
    actionSplashSpeedLinesDurationMs.value = DEFAULT_ACTION_SPLASH_SPEED_LINES_DURATION_MS
  }

  return {
    actionSplashSpeedLinesDurationMs,
    actionSplashSpeedLinesDurationLabel: actionSplashSpeedLinesDurationLabelText,
    actionSplashSpeedLinesDurationTitle: actionSplashSpeedLinesDurationTitleText,
    setActionSplashSpeedLinesDurationMs,
    resetActionSplashSpeedLinesDurationMs,
  }
}
