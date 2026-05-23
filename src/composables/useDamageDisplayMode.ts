import { computed, onMounted, watch } from 'vue'
import {
  DEFAULT_MOVE_DAMAGE_DISPLAY_MODE,
  isMoveDamageDisplayMode,
  moveDamageDisplayModeLabel,
  moveDamageDisplayModeTitle,
  nextMoveDamageDisplayMode,
  type MoveDamageDisplayMode,
} from '~/utils/moveDamageDisplay'

const STORAGE_KEY = 'rotom-table:damage-display-mode'

export const useDamageDisplayMode = () => {
  const damageDisplayMode = useState<MoveDamageDisplayMode>(
    'damage-display-mode',
    () => DEFAULT_MOVE_DAMAGE_DISPLAY_MODE,
  )

  if (import.meta.client) {
    onMounted(() => {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (isMoveDamageDisplayMode(stored)) damageDisplayMode.value = stored
    })

    watch(damageDisplayMode, (mode) => {
      window.localStorage.setItem(STORAGE_KEY, mode)
    })
  }

  const damageDisplayModeLabel = computed(() => moveDamageDisplayModeLabel(damageDisplayMode.value))
  const damageDisplayModeTitle = computed(() => moveDamageDisplayModeTitle(damageDisplayMode.value))
  const isAverageDamageMode = computed(() => damageDisplayMode.value === 'average')

  const setDamageDisplayMode = (mode: MoveDamageDisplayMode) => {
    damageDisplayMode.value = mode
  }

  const toggleDamageDisplayMode = () => {
    damageDisplayMode.value = nextMoveDamageDisplayMode(damageDisplayMode.value)
  }

  return {
    damageDisplayMode,
    damageDisplayModeLabel,
    damageDisplayModeTitle,
    isAverageDamageMode,
    setDamageDisplayMode,
    toggleDamageDisplayMode,
  }
}
