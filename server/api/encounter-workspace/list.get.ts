import { defineEventHandler } from 'h3'
import { listEncounterWorkspacesUseCase } from '../../useCases/listEncounterWorkspaces'
import { requireAuthRole } from '../../utils/auth'
import { requireEncounterWorkspaceFeature } from '../../utils/encounterWorkspaceFeature'

export default defineEventHandler((event) => {
  requireEncounterWorkspaceFeature(event)
  return listEncounterWorkspacesUseCase({ role: requireAuthRole(event) })
})
