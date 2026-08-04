import { onBeforeUnmount, onMounted, ref, toValue, type MaybeRefOrGetter } from 'vue'
import {
  ENCOUNTER_UX_METRIC_SCHEMA_VERSION,
  encounterUxViewportClass,
  type EncounterUxEvent,
  type EncounterUxMetricSample,
} from '#shared/encounterWorkspace/metrics'
import type { EncounterWorkspacePreferences } from '#shared/encounterWorkspace/preferences'
import type { EncounterProjectionAudience } from '#shared/encounterPresentation'
import { ENCOUNTER_WORKSPACE_API_PATHS } from '~/utils/apiRoutes'

export interface EncounterWorkspaceMetricOverrides {
  readonly spatialityLevel?: EncounterUxMetricSample['dimensions']['spatialityLevel']
  readonly terminalStatus?: EncounterUxMetricSample['dimensions']['terminalStatus']
}

export const useEncounterWorkspaceMetrics = (options: {
  readonly audience: MaybeRefOrGetter<EncounterProjectionAudience | null>
  readonly role: MaybeRefOrGetter<'gm' | 'player' | null>
  readonly preferences: MaybeRefOrGetter<EncounterWorkspacePreferences>
}) => {
  const config = useRuntimeConfig()
  const { postJson } = useApiClient()
  const lastInputKind = ref<EncounterUxMetricSample['dimensions']['inputKind']>('unknown')
  const enabled = config.public.encounterWorkspaceMetricsEnabled

  const noteKeyboard = (): void => { lastInputKind.value = 'keyboard' }
  const notePointer = (event: PointerEvent): void => {
    lastInputKind.value = event.pointerType === 'touch' ? 'touch' : 'pointer'
  }
  onMounted(() => {
    window.addEventListener('keydown', noteKeyboard, { passive: true })
    window.addEventListener('pointerdown', notePointer, { passive: true })
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', noteKeyboard)
    window.removeEventListener('pointerdown', notePointer)
  })

  const record = async (
    event: EncounterUxEvent,
    value: number,
    overrides: EncounterWorkspaceMetricOverrides = {},
  ): Promise<boolean> => {
    if (!enabled || !import.meta.client) return false
    const preferences = toValue(options.preferences)
    const audience = toValue(options.audience)
    const role = toValue(options.role)
    const roleKind: EncounterUxMetricSample['dimensions']['roleKind'] = audience === 'public' || audience === 'diagnostic'
      ? audience
      : role === 'player' || audience === 'actor-owner' || audience === 'responder-owner'
        ? 'player'
        : 'gm'
    const sample: EncounterUxMetricSample = {
      schemaVersion: ENCOUNTER_UX_METRIC_SCHEMA_VERSION,
      event,
      value: Math.max(0, Math.min(3_600_000, Number.isFinite(value) ? value : 0)),
      dimensions: {
        roleKind,
        viewportClass: encounterUxViewportClass(window.innerWidth, preferences.layout === 'table-display'),
        inputKind: lastInputKind.value,
        motionPreference: preferences.motion,
        fixtureId: 'runtime',
        spatialityLevel: overrides.spatialityLevel ?? 'none',
        terminalStatus: overrides.terminalStatus ?? 'none',
      },
    }
    try {
      const result = await postJson<{ ok: boolean, recorded: boolean }>(ENCOUNTER_WORKSPACE_API_PATHS.metrics, sample)
      return result.ok && result.recorded
    }
    catch {
      // Metrics never block or alter an encounter workflow.
      return false
    }
  }

  return Object.freeze({ record, lastInputKind })
}
