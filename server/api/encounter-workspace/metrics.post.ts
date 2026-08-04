import { defineEventHandler, readBody } from 'h3'
import { parseEncounterUxMetricSample } from '#shared/encounterWorkspace/metrics'
import { createEncounterUxMetricRepository } from '../../storage/encounterUxMetricRepository'
import { requireAuthRole } from '../../utils/auth'
import { requireEncounterWorkspaceFeature } from '../../utils/encounterWorkspaceFeature'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'

const enabled = (value: unknown): boolean => value === true || value === 'true' || value === '1'

export default defineEventHandler(async (event) => {
  requireEncounterWorkspaceFeature(event)
  const role = requireAuthRole(event)
  if (!enabled(useRuntimeConfig(event).public.encounterWorkspaceMetricsEnabled)) {
    return { ok: true, recorded: false }
  }
  try {
    const parsed = parseEncounterUxMetricSample(await readBody(event))
    const sample = role === 'player' && parsed.dimensions.roleKind !== 'player'
      ? parseEncounterUxMetricSample({
          ...parsed,
          dimensions: { ...parsed.dimensions, roleKind: 'player' },
        })
      : parsed
    createEncounterUxMetricRepository().record(sample)
    return { ok: true, recorded: true }
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
