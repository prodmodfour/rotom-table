import { computed, onMounted, watch } from 'vue'
import {
  ACTION_SPLASH_DISPLAY_DURATION_STORAGE_KEY,
  ACTION_SPLASH_SPEED_LINES_DURATION_STORAGE_KEY,
  DEFAULT_ACTION_SPLASH_DISPLAY_DURATION_MS,
  DEFAULT_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
  actionSplashDisplayDurationLabel,
  actionSplashDisplayDurationTitle,
  actionSplashSpeedLinesDurationLabel,
  actionSplashSpeedLinesDurationTitle,
  parseActionSplashDisplayDurationMs,
  parseActionSplashSpeedLinesDurationMs,
  resolveActionSplashDisplayDurationMs,
  resolveActionSplashSpeedLinesDurationMs,
  serializeActionSplashDisplayDurationMs,
  serializeActionSplashSpeedLinesDurationMs,
} from '~/utils/actionSplashSettings'

interface StoredActionSplashDurationSetting {
  readonly storageKey: string
  readonly parse: (value: unknown) => number | null
  readonly serialize: (durationMs: number) => string
}

const actionSplashDisplayDurationStorage: StoredActionSplashDurationSetting = {
  storageKey: ACTION_SPLASH_DISPLAY_DURATION_STORAGE_KEY,
  parse: parseActionSplashDisplayDurationMs,
  serialize: serializeActionSplashDisplayDurationMs,
}

const actionSplashSpeedLinesDurationStorage: StoredActionSplashDurationSetting = {
  storageKey: ACTION_SPLASH_SPEED_LINES_DURATION_STORAGE_KEY,
  parse: parseActionSplashSpeedLinesDurationMs,
  serialize: serializeActionSplashSpeedLinesDurationMs,
}

const readStoredActionSplashDurationMs = (
  setting: StoredActionSplashDurationSetting,
): number | null => {
  try {
    return setting.parse(window.localStorage.getItem(setting.storageKey))
  } catch {
    return null
  }
}

const writeStoredActionSplashDurationMs = (
  setting: StoredActionSplashDurationSetting,
  durationMs: number,
): void => {
  try {
    window.localStorage.setItem(setting.storageKey, setting.serialize(durationMs))
  } catch {
    // Keep the in-memory preference usable when browser storage is unavailable.
  }
}

export const useActionSplashSettings = () => {
  const actionSplashDisplayDurationMs = useState<number>(
    'action-splash-display-duration-ms',
    () => DEFAULT_ACTION_SPLASH_DISPLAY_DURATION_MS,
  )
  const actionSplashSpeedLinesDurationMs = useState<number>(
    'action-splash-speed-lines-duration-ms',
    () => DEFAULT_ACTION_SPLASH_SPEED_LINES_DURATION_MS,
  )

  if (import.meta.client) {
    onMounted(() => {
      const storedDisplayDuration = readStoredActionSplashDurationMs(actionSplashDisplayDurationStorage)
      if (storedDisplayDuration !== null) actionSplashDisplayDurationMs.value = storedDisplayDuration

      const storedSpeedLinesDuration = readStoredActionSplashDurationMs(actionSplashSpeedLinesDurationStorage)
      if (storedSpeedLinesDuration !== null) actionSplashSpeedLinesDurationMs.value = storedSpeedLinesDuration
    })

    watch(actionSplashDisplayDurationMs, (durationMs) => {
      writeStoredActionSplashDurationMs(actionSplashDisplayDurationStorage, durationMs)
    })

    watch(actionSplashSpeedLinesDurationMs, (durationMs) => {
      writeStoredActionSplashDurationMs(actionSplashSpeedLinesDurationStorage, durationMs)
    })
  }

  const actionSplashDisplayDurationLabelText = computed(() => (
    actionSplashDisplayDurationLabel(actionSplashDisplayDurationMs.value)
  ))
  const actionSplashDisplayDurationTitleText = computed(() => (
    actionSplashDisplayDurationTitle(actionSplashDisplayDurationMs.value)
  ))
  const actionSplashSpeedLinesDurationLabelText = computed(() => (
    actionSplashSpeedLinesDurationLabel(actionSplashSpeedLinesDurationMs.value)
  ))
  const actionSplashSpeedLinesDurationTitleText = computed(() => (
    actionSplashSpeedLinesDurationTitle(actionSplashSpeedLinesDurationMs.value)
  ))

  const setActionSplashDisplayDurationMs = (durationMs: unknown) => {
    actionSplashDisplayDurationMs.value = resolveActionSplashDisplayDurationMs(
      durationMs,
      actionSplashDisplayDurationMs.value,
    )
  }

  const resetActionSplashDisplayDurationMs = () => {
    actionSplashDisplayDurationMs.value = DEFAULT_ACTION_SPLASH_DISPLAY_DURATION_MS
  }

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
    actionSplashDisplayDurationMs,
    actionSplashDisplayDurationLabel: actionSplashDisplayDurationLabelText,
    actionSplashDisplayDurationTitle: actionSplashDisplayDurationTitleText,
    setActionSplashDisplayDurationMs,
    resetActionSplashDisplayDurationMs,
    actionSplashSpeedLinesDurationMs,
    actionSplashSpeedLinesDurationLabel: actionSplashSpeedLinesDurationLabelText,
    actionSplashSpeedLinesDurationTitle: actionSplashSpeedLinesDurationTitleText,
    setActionSplashSpeedLinesDurationMs,
    resetActionSplashSpeedLinesDurationMs,
  }
}
