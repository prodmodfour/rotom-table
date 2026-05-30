import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import {
  DEFAULT_MOVE_ANIMATIONS_ENABLED,
  DEFAULT_MOVE_ANIMATIONS_REDUCED_MOTION,
  MOVE_ANIMATIONS_ENABLED_STORAGE_KEY,
  moveAnimationsEnabledLabel,
  moveAnimationsEnabledTitle,
  parseMoveAnimationsEnabled,
  readPrefersReducedMotion,
  serializeMoveAnimationsEnabled,
  subscribePrefersReducedMotion,
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
  const moveAnimationsReducedMotion = useState<boolean>(
    'move-animations-reduced-motion',
    () => DEFAULT_MOVE_ANIMATIONS_REDUCED_MOTION,
  )

  let cleanupPrefersReducedMotion: (() => void) | null = null

  if (import.meta.client) {
    onMounted(() => {
      const stored = readStoredMoveAnimationsEnabled()
      if (stored !== null) moveAnimationsEnabled.value = stored

      moveAnimationsReducedMotion.value = readPrefersReducedMotion()
      cleanupPrefersReducedMotion = subscribePrefersReducedMotion((reducedMotion) => {
        moveAnimationsReducedMotion.value = reducedMotion
      })
    })

    onBeforeUnmount(() => {
      cleanupPrefersReducedMotion?.()
      cleanupPrefersReducedMotion = null
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
    moveAnimationsReducedMotion,
    moveAnimationsStatusLabel,
    moveAnimationsStatusTitle,
    moveAnimationsToggleLabel,
    setMoveAnimationsEnabled,
    toggleMoveAnimationsEnabled,
  }
}
