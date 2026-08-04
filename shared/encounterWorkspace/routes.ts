export const ENCOUNTER_LIBRARY_PATH = '/play' as const
export const BATTLEFIELD_WORKSHOP_PATH = '/maps' as const

export interface EncounterWorkspaceFeaturePolicy {
  readonly enabled: boolean
  readonly defaultForLivePlay: boolean
  readonly compatibilityWorkshopEnabled: boolean
}

export const DEFAULT_ENCOUNTER_WORKSPACE_FEATURE_POLICY: EncounterWorkspaceFeaturePolicy = Object.freeze({
  enabled: true,
  defaultForLivePlay: false,
  compatibilityWorkshopEnabled: true,
})

const safeSegment = (value: string): string => encodeURIComponent(value.trim())

export const encounterLibraryPath = (): typeof ENCOUNTER_LIBRARY_PATH => ENCOUNTER_LIBRARY_PATH

export const encounterWorkspacePath = (encounterId: string): string => (
  `${ENCOUNTER_LIBRARY_PATH}/${safeSegment(encounterId)}`
)

export const encounterTacticalPath = (encounterId: string): string => (
  `${encounterWorkspacePath(encounterId)}/tactical`
)

export const battlefieldWorkshopPath = (mapSlug: string): string => (
  `${BATTLEFIELD_WORKSHOP_PATH}/${safeSegment(mapSlug)}`
)

export const resolveLivePlayEntryPath = (input: {
  readonly mapSlug: string
  readonly policy?: EncounterWorkspaceFeaturePolicy
  readonly explicitWorkspaceOptIn?: boolean
}): string => {
  const policy = input.policy ?? DEFAULT_ENCOUNTER_WORKSPACE_FEATURE_POLICY
  if (policy.enabled && (policy.defaultForLivePlay || input.explicitWorkspaceOptIn)) {
    return encounterWorkspacePath(input.mapSlug)
  }
  return battlefieldWorkshopPath(input.mapSlug)
}

export const encounterWorkspaceRouteAvailable = (
  policy: EncounterWorkspaceFeaturePolicy,
): boolean => policy.enabled
