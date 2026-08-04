import { computed } from 'vue'
import type { EncounterWorkspaceFeaturePolicy } from '#shared/encounterWorkspace/routes'

const runtimeBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return fallback
}

export const useEncounterWorkspaceFeaturePolicy = () => {
  const config = useRuntimeConfig()
  return computed<EncounterWorkspaceFeaturePolicy>(() => ({
    enabled: runtimeBoolean(config.public.encounterWorkspaceEnabled, true),
    defaultForLivePlay: runtimeBoolean(config.public.encounterWorkspaceDefaultForLivePlay, false),
    compatibilityWorkshopEnabled: runtimeBoolean(config.public.battlefieldWorkshopEnabled, true),
  }))
}
