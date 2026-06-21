import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import {
  DEFAULT_SOUND_EFFECTS_ENABLED,
  SOUND_EFFECTS_ENABLED_STORAGE_KEY,
  parseSoundEffectsEnabled,
  serializeSoundEffectsEnabled,
  soundEffectsEnabledLabel,
  soundEffectsEnabledTitle,
} from '~/utils/soundEffectSettings'
import {
  installSoundEffectUnlockListeners,
  setSoundEffectsEnabled,
  unlockSoundEffects,
} from '~/utils/soundEffects'

const readStoredSoundEffectsEnabled = (): boolean | null => {
  try {
    return parseSoundEffectsEnabled(window.localStorage.getItem(SOUND_EFFECTS_ENABLED_STORAGE_KEY))
  } catch {
    return null
  }
}

const writeStoredSoundEffectsEnabled = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(SOUND_EFFECTS_ENABLED_STORAGE_KEY, serializeSoundEffectsEnabled(enabled))
  } catch {
    // Keep the in-memory preference usable when browser storage is unavailable.
  }
}

export const useSoundEffectSettings = () => {
  const soundEffectsEnabled = useState<boolean>(
    'sound-effects-enabled',
    () => DEFAULT_SOUND_EFFECTS_ENABLED,
  )

  let cleanupUnlockListeners: (() => void) | null = null

  if (import.meta.client) {
    onMounted(() => {
      const stored = readStoredSoundEffectsEnabled()
      if (stored !== null) soundEffectsEnabled.value = stored
      setSoundEffectsEnabled(soundEffectsEnabled.value)
      cleanupUnlockListeners = installSoundEffectUnlockListeners()
    })

    onBeforeUnmount(() => {
      cleanupUnlockListeners?.()
      cleanupUnlockListeners = null
    })

    watch(soundEffectsEnabled, (enabled) => {
      writeStoredSoundEffectsEnabled(enabled)
      setSoundEffectsEnabled(enabled)
    })
  }

  const soundEffectsStatusLabel = computed(() => soundEffectsEnabledLabel(soundEffectsEnabled.value))
  const soundEffectsStatusTitle = computed(() => soundEffectsEnabledTitle(soundEffectsEnabled.value))
  const soundEffectsToggleLabel = computed(() => (
    soundEffectsEnabled.value ? 'Disable sound effects' : 'Enable sound effects'
  ))

  const setSoundEffectsSettingEnabled = (enabled: boolean) => {
    soundEffectsEnabled.value = enabled
    if (enabled) void unlockSoundEffects()
  }

  const toggleSoundEffectsEnabled = () => {
    const enabled = !soundEffectsEnabled.value
    soundEffectsEnabled.value = enabled
    if (enabled) void unlockSoundEffects()
  }

  return {
    soundEffectsEnabled,
    soundEffectsStatusLabel,
    soundEffectsStatusTitle,
    soundEffectsToggleLabel,
    setSoundEffectsEnabled: setSoundEffectsSettingEnabled,
    toggleSoundEffectsEnabled,
  }
}
