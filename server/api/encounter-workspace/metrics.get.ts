import { defineEventHandler } from 'h3'
import { createEncounterUxMetricRepository } from '../../storage/encounterUxMetricRepository'
import { requireGm } from '../../utils/auth'
import { requireEncounterWorkspaceFeature } from '../../utils/encounterWorkspaceFeature'

export default defineEventHandler((event) => {
  requireEncounterWorkspaceFeature(event)
  requireGm(event)
  return {
    schemaVersion: 1,
    privacy: 'aggregate-only',
    aggregates: createEncounterUxMetricRepository().list(),
  }
})
