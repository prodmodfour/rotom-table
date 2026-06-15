import { computed, watch } from 'vue'
import {
  DEFAULT_INITIATIVE_AUTO_FOCUS_ENABLED,
  INITIATIVE_AUTO_FOCUS_ENABLED_STORAGE_KEY,
  initiativeAutoFocusEnabledLabel,
  initiativeAutoFocusEnabledTitle,
  parseInitiativeAutoFocusEnabled,
  serializeInitiativeAutoFocusEnabled,
} from '~/utils/initiativeAutoFocusSettings'

export type InitiativeAutoFocusStorage = Pick<Storage, 'getItem' | 'setItem'>

const browserLocalStorage = (): InitiativeAutoFocusStorage | null => {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const readStoredInitiativeAutoFocusEnabled = (
  storage: InitiativeAutoFocusStorage | null = browserLocalStorage(),
): boolean | null => {
  if (!storage) return null

  try {
    return parseInitiativeAutoFocusEnabled(
      storage.getItem(INITIATIVE_AUTO_FOCUS_ENABLED_STORAGE_KEY),
    )
  } catch {
    return null
  }
}

export const writeStoredInitiativeAutoFocusEnabled = (
  enabled: boolean,
  storage: InitiativeAutoFocusStorage | null = browserLocalStorage(),
): void => {
  if (!storage) return

  try {
    storage.setItem(
      INITIATIVE_AUTO_FOCUS_ENABLED_STORAGE_KEY,
      serializeInitiativeAutoFocusEnabled(enabled),
    )
  } catch {
    // Keep the in-memory preference usable when browser storage is unavailable.
  }
}

export const useInitiativeAutoFocusSettings = () => {
  const initiativeAutoFocusEnabled = useState<boolean>(
    'initiative-auto-focus-enabled',
    () => DEFAULT_INITIATIVE_AUTO_FOCUS_ENABLED,
  )

  if (import.meta.client) {
    const stored = readStoredInitiativeAutoFocusEnabled()
    if (stored !== null) initiativeAutoFocusEnabled.value = stored

    watch(initiativeAutoFocusEnabled, (enabled) => {
      writeStoredInitiativeAutoFocusEnabled(enabled)
    })
  }

  const initiativeAutoFocusStatusLabel = computed(() => (
    initiativeAutoFocusEnabledLabel(initiativeAutoFocusEnabled.value)
  ))
  const initiativeAutoFocusStatusTitle = computed(() => (
    initiativeAutoFocusEnabledTitle(initiativeAutoFocusEnabled.value)
  ))
  const initiativeAutoFocusToggleLabel = computed(() => (
    initiativeAutoFocusEnabled.value
      ? 'Disable auto-focus active initiative'
      : 'Enable auto-focus active initiative'
  ))

  const setInitiativeAutoFocusEnabled = (enabled: boolean) => {
    initiativeAutoFocusEnabled.value = enabled
  }

  const toggleInitiativeAutoFocusEnabled = () => {
    initiativeAutoFocusEnabled.value = !initiativeAutoFocusEnabled.value
  }

  return {
    initiativeAutoFocusEnabled,
    initiativeAutoFocusStatusLabel,
    initiativeAutoFocusStatusTitle,
    initiativeAutoFocusToggleLabel,
    setInitiativeAutoFocusEnabled,
    toggleInitiativeAutoFocusEnabled,
  }
}
