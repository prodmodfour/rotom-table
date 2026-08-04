import { defineEventHandler, readBody } from 'h3'
import { requireGm } from '../../utils/auth'
import { requireWritableCampaignMode } from '../../utils/http'
import { applyEncounterDirectorCommandUseCase } from '../../useCases/encounterDocuments'

export default defineEventHandler(async (event) => {
  requireGm(event)
  requireWritableCampaignMode()
  return applyEncounterDirectorCommandUseCase(await readBody<unknown>(event))
})
