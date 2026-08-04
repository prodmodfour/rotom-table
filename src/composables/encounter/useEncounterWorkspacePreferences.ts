import { computed, onMounted, readonly, ref, watch } from 'vue'
import {
  DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES,
  encounterWorkspacePreferenceAttributes,
  loadEncounterWorkspacePreferences,
  parseEncounterWorkspacePreferences,
  saveEncounterWorkspacePreferences,
  type EncounterWorkspacePreferences,
} from '#shared/encounterWorkspace/preferences'

export const useEncounterWorkspacePreferences = () => {
  const preferences = ref<EncounterWorkspacePreferences>({ ...DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES })
  const hydrated = ref(false)

  onMounted(() => {
    preferences.value = loadEncounterWorkspacePreferences(window.localStorage)
    hydrated.value = true
  })

  watch(preferences, (value) => {
    if (!hydrated.value) return
    saveEncounterWorkspacePreferences(window.localStorage, value)
  }, { deep: true })

  const update = (patch: Partial<Omit<EncounterWorkspacePreferences, 'schemaVersion'>>): void => {
    preferences.value = parseEncounterWorkspacePreferences({ ...preferences.value, ...patch })
  }
  const reset = (): void => {
    preferences.value = { ...DEFAULT_ENCOUNTER_WORKSPACE_PREFERENCES }
  }

  return Object.freeze({
    preferences: readonly(preferences),
    hydrated: readonly(hydrated),
    attributes: computed(() => encounterWorkspacePreferenceAttributes(preferences.value)),
    update,
    reset,
  })
}
