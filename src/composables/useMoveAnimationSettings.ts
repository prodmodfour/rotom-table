import { computed, onMounted, watch } from 'vue'
import {
  DEFAULT_MOVE_ANIMATIONS_ENABLED,
  MOVE_ANIMATIONS_ENABLED_STORAGE_KEY,
  moveAnimationsEnabledLabel,
  moveAnimationsEnabledTitle,
  parseMoveAnimationsEnabled,
  serializeMoveAnimationsEnabled,
} from '~/utils/moveAnimationSettings'

const readStoredMoveAnimationsEnabled = (): boolean | null => {
  try {
    return parseMoveAnimationsEnabled(window.localStorage.getItem(MOVE_ANIMATIONS_ENABLED_STORAGE_KEY))
  } catch {
    return null
  }
}

const writeStoredMoveAnimationsEnabled = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(MOVE_ANIMATIONS_ENABLED_STORAGE_KEY, serializeMoveAnimationsEnabled(enabled))
  } catch {
    // Keep the in-memory preference usable when browser storage is unavailable.
  }
}

export const useMoveAnimationSettings = () => {
  const moveAnimationsEnabled = useState<boolean>(
    'move-animations-enabled',
    () => DEFAULT_MOVE_ANIMATIONS_ENABLED,
  )

  if (import.meta.client) {
    onMounted(() => {
      const stored = readStoredMoveAnimationsEnabled()
      if (stored !== null) moveAnimationsEnabled.value = stored
    })

    watch(moveAnimationsEnabled, (enabled) => {
      writeStoredMoveAnimationsEnabled(enabled)
    })
  }

  const moveAnimationsStatusLabel = computed(() => moveAnimationsEnabledLabel(moveAnimationsEnabled.value))
  const moveAnimationsStatusTitle = computed(() => moveAnimationsEnabledTitle(moveAnimationsEnabled.value))
  const moveAnimationsToggleLabel = computed(() => (
    moveAnimationsEnabled.value ? 'Disable move animations' : 'Enable move animations'
  ))

  const setMoveAnimationsEnabled = (enabled: boolean) => {
    moveAnimationsEnabled.value = enabled
  }

  const toggleMoveAnimationsEnabled = () => {
    moveAnimationsEnabled.value = !moveAnimationsEnabled.value
  }

  return {
    moveAnimationsEnabled,
    moveAnimationsStatusLabel,
    moveAnimationsStatusTitle,
    moveAnimationsToggleLabel,
    setMoveAnimationsEnabled,
    toggleMoveAnimationsEnabled,
  }
}
